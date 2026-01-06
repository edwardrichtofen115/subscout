import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, users, processedEmails, subscriptions, settings } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { GmailService } from "@/lib/services/gmail";
import { ClaudeService } from "@/lib/services/claude";
import { CalendarService } from "@/lib/services/calendar";
import { getValidAccessToken } from "@/lib/services/token";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, user.id),
    });

    const accessToken = await getValidAccessToken(user);
    if (!accessToken) {
      return NextResponse.json(
        { error: "No valid access token. Please reconnect your Google account." },
        { status: 401 }
      );
    }

    const gmailService = new GmailService(accessToken, user.id);
    const claudeService = new ClaudeService();
    const calendarService = new CalendarService(accessToken);

    // Fetch recent messages (check last 20 emails)
    const messages = await gmailService.getRecentMessages(20);

    let processedCount = 0;
    let newSubscriptionsCount = 0;

    for (const message of messages) {
      const emailContent = GmailService.extractEmailContent(message);

      // Check if already processed
      const existing = await db.query.processedEmails.findFirst({
        where: and(
          eq(processedEmails.userId, user.id),
          eq(processedEmails.gmailMessageId, message.id)
        ),
      });

      if (existing) {
        continue;
      }

      // Classify with Claude
      const classification = await claudeService.classifyEmail(
        emailContent.subject,
        emailContent.from,
        emailContent.body
      );

      // Mark as processed
      await db.insert(processedEmails).values({
        userId: user.id,
        gmailMessageId: message.id,
        isSubscription: classification.is_subscription,
      });

      processedCount++;

      if (classification.is_subscription && classification.confidence >= 0.7) {
        // Check if subscription already exists for this email
        const existingSub = await db.query.subscriptions.findFirst({
          where: and(
            eq(subscriptions.userId, user.id),
            eq(subscriptions.emailSubject, emailContent.subject)
          ),
        });

        if (!existingSub) {
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

          newSubscriptionsCount++;
        }
      }
    }

    // Update lastSyncAt timestamp
    await db
      .update(users)
      .set({
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return NextResponse.json({
      success: true,
      processed: processedCount,
      newSubscriptions: newSubscriptionsCount,
      message: `Processed ${processedCount} new email(s). Found ${newSubscriptionsCount} new subscription(s).`,
    });
  } catch (error) {
    console.error("Manual sync error:", error);
    return NextResponse.json(
      {
        error: "Failed to sync emails",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

