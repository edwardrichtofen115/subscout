import { NextRequest, NextResponse } from "next/server";
import { db, users, processedEmails, subscriptions, settings } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { GmailService } from "@/lib/services/gmail";
import { ClaudeService } from "@/lib/services/claude";
import { CalendarService } from "@/lib/services/calendar";
import { getValidAccessToken } from "@/lib/services/token";

// Test endpoint: GET /api/test/scan-recent?email=you@email.com&count=3
// Requires: Authorization: Bearer <CRON_SECRET>
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = request.nextUrl.searchParams.get("email");
  const count = parseInt(request.nextUrl.searchParams.get("count") || "3");

  if (!email) {
    return NextResponse.json({ error: "?email= required" }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userSettings = await db.query.settings.findFirst({
    where: eq(settings.userId, user.id),
  });

  const accessToken = await getValidAccessToken(user);
  if (!accessToken) {
    return NextResponse.json({ error: "No valid token" }, { status: 401 });
  }

  const gmailService = new GmailService(accessToken, user.id);
  const claudeService = new ClaudeService();
  const calendarService = new CalendarService(accessToken);

  // Fetch recent messages directly (bypasses historyId)
  const messages = await gmailService.getRecentMessages(count);

  const results = [];

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
      results.push({
        subject: emailContent.subject,
        from: emailContent.from,
        status: "already_processed",
      });
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

      results.push({
        subject: emailContent.subject,
        from: emailContent.from,
        status: "subscription_created",
        classification,
      });
    } else {
      results.push({
        subject: emailContent.subject,
        from: emailContent.from,
        status: "not_subscription",
        classification,
      });
    }
  }

  return NextResponse.json({ processed: messages.length, results });
}
