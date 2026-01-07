import { NextRequest, NextResponse } from "next/server";
import { db, users, processedEmails, subscriptions, settings } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { GmailService } from "@/lib/services/gmail";
import { ClaudeService } from "@/lib/services/claude";
import { CalendarService } from "@/lib/services/calendar";
import { getValidAccessToken } from "@/lib/services/token";
import type { GmailPushData, GmailMessage } from "@/types";

const PUBSUB_VERIFICATION_TOKEN = process.env.PUBSUB_VERIFICATION_TOKEN;
const BATCH_SIZE = 10;

/**
 * Process items in parallel batches with controlled concurrency
 */
async function processInBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = BATCH_SIZE
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

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
      console.log(
        `[Webhook] User not found or no access token: ${pushData.emailAddress}`
      );
      return NextResponse.json({ status: "ok" });
    }

    const userSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, user.id),
    });

    if (!userSettings?.enabled) {
      console.log(`[Webhook] Monitoring disabled for user: ${user.email}`);
      return NextResponse.json({ status: "ok" });
    }

    // Get a valid access token, refreshing if expired
    const accessToken = await getValidAccessToken(user);
    if (!accessToken) {
      console.error(
        `[Webhook] Failed to get valid access token for user: ${user.email}`
      );
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
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    if (messages.length === 0) {
      console.log(`[Webhook] No new messages for user ${user.email}`);
      return NextResponse.json({ status: "ok" });
    }

    console.log(
      `[Webhook] Processing ${messages.length} message(s) for user ${user.email}`
    );

    let processedCount = 0;
    let skippedCount = 0;
    let subscriptionCount = 0;
    let errorCount = 0;

    // Step 1: Filter out promotional emails
    const nonPromotionalMessages = messages.filter((message) => {
      const hasPromotionLabel = message.labelIds?.some(
        (label) => label === "CATEGORY_PROMOTIONS"
      );
      if (hasPromotionLabel) {
        console.log(
          `[Webhook] Email ${message.id}: SKIPPED - promotional email`
        );
        skippedCount++;
        return false;
      }
      return true;
    });

    // Step 2: Batch check which emails are already processed
    const messageIds = nonPromotionalMessages.map((m) => m.id);
    const alreadyProcessed = messageIds.length > 0
      ? await db.query.processedEmails.findMany({
          where: and(
            eq(processedEmails.userId, user.id),
            inArray(processedEmails.gmailMessageId, messageIds)
          ),
        })
      : [];
    const processedIdSet = new Set(alreadyProcessed.map((p) => p.gmailMessageId));

    // Filter to only unprocessed messages
    const messagesToProcess = nonPromotionalMessages.filter((message) => {
      if (processedIdSet.has(message.id)) {
        console.log(
          `[Webhook] Email ${message.id}: SKIPPED - already processed`
        );
        skippedCount++;
        return false;
      }
      return true;
    });

    if (messagesToProcess.length === 0) {
      console.log(
        `[Webhook] Summary for user ${user.email}: ${processedCount} processed, ${subscriptionCount} subscriptions created, ${skippedCount} skipped, ${errorCount} errors`
      );
      return NextResponse.json({ status: "ok" });
    }

    // Step 3: Classify all emails in parallel batches
    type ClassificationResult = {
      message: GmailMessage;
      emailContent: { subject: string; from: string; body: string; date: Date };
      classification: Awaited<ReturnType<typeof claudeService.classifyEmail>>;
    };

    const classificationResults = await processInBatches(
      messagesToProcess,
      async (message): Promise<ClassificationResult> => {
        const emailContent = GmailService.extractEmailContent(message);
        const classification = await claudeService.classifyEmail(
          emailContent.subject,
          emailContent.from,
          emailContent.body,
          emailContent.date
        );
        return { message, emailContent, classification };
      }
    );

    // Step 4: Process results in parallel batches (DB writes + calendar)
    const successfulClassifications = classificationResults
      .filter(
        (result): result is PromiseFulfilledResult<ClassificationResult> =>
          result.status === "fulfilled"
      )
      .map((result) => result.value);

    // Log failed classifications
    classificationResults
      .filter((result) => result.status === "rejected")
      .forEach((result) => {
        errorCount++;
        console.error(
          `[Webhook] ERROR classifying email:`,
          (result as PromiseRejectedResult).reason
        );
      });

    await processInBatches(
      successfulClassifications,
      async ({ message, emailContent, classification }) => {
        const messageId = message.id;

        try {
          // Insert processed email record
          await db.insert(processedEmails).values({
            userId: user.id,
            gmailMessageId: messageId,
            isSubscription: classification.is_subscription,
          });

          processedCount++;

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
              try {
                calendarEventId = await calendarService.createReminder(
                  classification.service_name || "Unknown Service",
                  classification.type || "subscription",
                  endDate,
                  userSettings.reminderDaysBefore
                );
              } catch (calendarError) {
                console.error(
                  `[Webhook] Email ${messageId}: ERROR creating calendar event -`,
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

            subscriptionCount++;
            console.log(
              `[Webhook] Email ${messageId}: SUCCESS - Subscription created | Subject: "${emailContent.subject}" | From: ${emailContent.from} | Service: ${classification.service_name} | Type: ${classification.type} | Confidence: ${Math.round(classification.confidence * 100)}% | Duration: ${classification.duration_days ? classification.duration_days + " days" : "N/A"} | EndDate: ${classification.end_date || "N/A"} | Reasoning: ${classification.reasoning || "N/A"}`
            );
          } else {
            console.log(
              `[Webhook] Email ${messageId}: PROCESSED - Not a subscription | Subject: "${emailContent.subject}" | From: ${emailContent.from} | IsSubscription: ${classification.is_subscription} | Confidence: ${Math.round(classification.confidence * 100)}% | Reasoning: ${classification.reasoning || "N/A"}`
            );
          }
        } catch (error) {
          errorCount++;
          console.error(
            `[Webhook] Email ${messageId}: ERROR processing email | Subject: "${emailContent.subject}" | From: ${emailContent.from} | Error:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    );

    console.log(
      `[Webhook] Summary for user ${user.email}: ${processedCount} processed, ${subscriptionCount} subscriptions created, ${skippedCount} skipped, ${errorCount} errors`
    );

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error(
      `[Webhook] FATAL ERROR:`,
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined
    );
    // Return 200 to prevent Pub/Sub retries which cause quota exhaustion
    // Errors are logged and can be monitored separately
    return NextResponse.json({ status: "error_logged" });
  }
}

export async function GET() {
  return NextResponse.json({ status: "Gmail webhook endpoint ready" });
}
