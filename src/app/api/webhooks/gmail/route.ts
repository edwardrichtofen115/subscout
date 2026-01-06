import { NextRequest, NextResponse } from "next/server";
import { db, users, processedEmails, subscriptions, settings } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { GmailService } from "@/lib/services/gmail";
import { ClaudeService } from "@/lib/services/claude";
import { CalendarService } from "@/lib/services/calendar";
import { getValidAccessToken } from "@/lib/services/token";
import type { GmailPushData } from "@/types";

const PUBSUB_VERIFICATION_TOKEN = process.env.PUBSUB_VERIFICATION_TOKEN;

export async function POST(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (token !== PUBSUB_VERIFICATION_TOKEN) {
      return NextResponse.json({ error: "Invalid token" }, { status: 403 });
    }

    const body = await request.json();

    if (!body.message?.data) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const decodedData = Buffer.from(body.message.data, "base64").toString(
      "utf-8"
    );
    const pushData: GmailPushData = JSON.parse(decodedData);

    const user = await db.query.users.findFirst({
      where: eq(users.email, pushData.emailAddress),
    });

    if (!user || !user.googleAccessToken) {
      console.log("User not found or no access token:", pushData.emailAddress);
      return NextResponse.json({ status: "ok" });
    }

    const userSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, user.id),
    });

    if (!userSettings?.enabled) {
      return NextResponse.json({ status: "ok" });
    }

    // Get a valid access token, refreshing if expired
    const accessToken = await getValidAccessToken(user);
    if (!accessToken) {
      console.log("Failed to get valid access token for user:", user.email);
      return NextResponse.json({ status: "ok" });
    }

    const gmailService = new GmailService(accessToken, user.id);
    const claudeService = new ClaudeService();
    const calendarService = new CalendarService(accessToken);

    const historyId = user.gmailHistoryId || pushData.historyId;
    const { messages, latestHistoryId } =
      await gmailService.getMessagesSinceHistory(historyId);

    // Update historyId immediately to prevent reprocessing on retry
    const newHistoryId = latestHistoryId || pushData.historyId;
    await db
      .update(users)
      .set({
        gmailHistoryId: newHistoryId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    console.log(
      `Processing ${messages.length} messages for user ${user.email}`
    );

    for (const message of messages) {
      const existingProcessed = await db.query.processedEmails.findFirst({
        where: and(
          eq(processedEmails.userId, user.id),
          eq(processedEmails.gmailMessageId, message.id)
        ),
      });

      if (existingProcessed) {
        continue;
      }

      const emailContent = GmailService.extractEmailContent(message);

      const classification = await claudeService.classifyEmail(
        emailContent.subject,
        emailContent.from,
        emailContent.body
      );

      await db.insert(processedEmails).values({
        userId: user.id,
        gmailMessageId: message.id,
        isSubscription: classification.is_subscription,
      });

      if (classification.is_subscription && classification.confidence >= 0.7) {
        let endDate: Date | null = null;

        if (classification.end_date) {
          endDate = new Date(classification.end_date);
        } else if (classification.duration_days) {
          endDate = new Date(emailContent.date);
          endDate.setDate(endDate.getDate() + classification.duration_days);
        } else {
          endDate = new Date(emailContent.date);
          endDate.setDate(endDate.getDate() + 14);
        }

        let calendarEventId: string | null = null;
        if (endDate && userSettings) {
          calendarEventId = await calendarService.createReminder(
            classification.service_name || "Unknown Service",
            classification.type || "subscription",
            endDate,
            userSettings.reminderDaysBefore
          );
        }

        await db.insert(subscriptions).values({
          userId: user.id,
          serviceName: classification.service_name || "Unknown Service",
          type: classification.type || "subscription",
          detectedDate: emailContent.date,
          endDate,
          calendarEventId,
          status: "active",
          emailSubject: emailContent.subject,
          emailSnippet: message.snippet,
          confidence: Math.round(classification.confidence * 100),
        });
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Gmail webhook error:", error);
    // Return 200 to prevent Pub/Sub retries which cause quota exhaustion
    // Errors are logged and can be monitored separately
    return NextResponse.json({ status: "error_logged" });
  }
}

export async function GET() {
  return NextResponse.json({ status: "Gmail webhook endpoint ready" });
}
