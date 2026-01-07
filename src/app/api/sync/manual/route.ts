import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, users, processedEmails, subscriptions, settings } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { GmailService } from "@/lib/services/gmail";
import { ClaudeService } from "@/lib/services/claude";
import { CalendarService } from "@/lib/services/calendar";
import { getValidAccessToken } from "@/lib/services/token";

export async function POST(request: NextRequest) {
  let userEmail: string | undefined;
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    userEmail = session.user.email;

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

    if (messages.length === 0) {
      console.log(`[ManualSync] No messages found for user ${user.email}`);
      return NextResponse.json({
        success: true,
        processed: 0,
        newSubscriptions: 0,
        message: "No new emails to process.",
      });
    }

    console.log(
      `[ManualSync] Processing ${messages.length} message(s) for user ${user.email}`
    );

    let processedCount = 0;
    let skippedCount = 0;
    let newSubscriptionsCount = 0;
    let errorCount = 0;

    for (const message of messages) {
      const messageId = message.id;
      let emailSubject = "";
      let emailFrom = "";

      try {
        const emailContent = GmailService.extractEmailContent(message);
        emailSubject = emailContent.subject;
        emailFrom = emailContent.from;

        // Check if already processed
        const existing = await db.query.processedEmails.findFirst({
          where: and(
            eq(processedEmails.userId, user.id),
            eq(processedEmails.gmailMessageId, messageId)
          ),
        });

        if (existing) {
          console.log(
            `[ManualSync] Email ${messageId}: SKIPPED - already processed | Subject: "${emailSubject}"`
          );
          skippedCount++;
          continue;
        }

        // Classify with Claude
        const classification = await claudeService.classifyEmail(
          emailContent.subject,
          emailContent.from,
          emailContent.body,
          emailContent.date
        );

        // Mark as processed
        await db.insert(processedEmails).values({
          userId: user.id,
          gmailMessageId: messageId,
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

          if (existingSub) {
            console.log(
              `[ManualSync] Email ${messageId}: SKIPPED - subscription already exists | Subject: "${emailSubject}" | Service: ${classification.service_name}`
            );
            skippedCount++;
            continue;
          }

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
            try {
              calendarEventId = await calendarService.createReminder(
                classification.service_name || "Unknown Service",
                classification.type || "subscription",
                endDate,
                userSettings.reminderDaysBefore
              );
            } catch (calendarError) {
              console.error(
                `[ManualSync] Email ${messageId}: ERROR creating calendar event -`,
                calendarError
              );
            }
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
          console.log(
            `[ManualSync] Email ${messageId}: SUCCESS - Subscription created | Subject: "${emailSubject}" | From: ${emailFrom} | Service: ${classification.service_name} | Type: ${classification.type} | Confidence: ${Math.round(classification.confidence * 100)}% | Duration: ${classification.duration_days ? classification.duration_days + " days" : "N/A"} | EndDate: ${classification.end_date || "N/A"} | Reasoning: ${classification.reasoning || "N/A"}`
          );
        } else {
          console.log(
            `[ManualSync] Email ${messageId}: PROCESSED - Not a subscription | Subject: "${emailSubject}" | From: ${emailFrom} | IsSubscription: ${classification.is_subscription} | Confidence: ${Math.round(classification.confidence * 100)}% | Reasoning: ${classification.reasoning || "N/A"}`
          );
        }
      } catch (error) {
        errorCount++;
        console.error(
          `[ManualSync] Email ${messageId}: ERROR processing email | Subject: "${emailSubject}" | From: ${emailFrom} | Error:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    console.log(
      `[ManualSync] Summary for user ${user.email}: ${processedCount} processed, ${newSubscriptionsCount} subscriptions created, ${skippedCount} skipped, ${errorCount} errors`
    );

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
    console.error(
      `[ManualSync] FATAL ERROR${userEmail ? ` for user ${userEmail}` : ""}:`,
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined
    );
    return NextResponse.json(
      {
        error: "Failed to sync emails",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

