import { google, gmail_v1 } from "googleapis";
import { db, users } from "../db";
import { eq } from "drizzle-orm";
import type { GmailMessage } from "@/types";

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID!;
const TOPIC_NAME = `projects/${GCP_PROJECT_ID}/topics/subscout-gmail`;

export class GmailService {
  private gmail: gmail_v1.Gmail;
  private userId: string;
  private readonly PROMOTION_LABELS = ["CATEGORY_PROMOTIONS"];

  constructor(accessToken: string, userId: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth });
    this.userId = userId;
  }

  /**
   * Check if a message is a promotional email (has CATEGORY_PROMOTIONS label)
   */
  private isPromotionalMessage(message: GmailMessage): boolean {
    return message.labelIds?.some((label) =>
      this.PROMOTION_LABELS.includes(label)
    ) ?? false;
  }

  /**
   * Check if a message is in the primary inbox (has INBOX label but not promotional categories)
   */
  private isPrimaryInboxMessage(message: GmailMessage): boolean {
    const hasInboxLabel = message.labelIds?.includes("INBOX") ?? false;
    const isPromotional = this.isPromotionalMessage(message);
    return hasInboxLabel && !isPromotional;
  }

  async setupWatch(): Promise<{ historyId: string; expiration: number }> {
    const response = await this.gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: TOPIC_NAME,
        labelIds: ["INBOX"],
      },
    });

    const historyId = response.data.historyId!;
    const expiration = parseInt(response.data.expiration!, 10);

    await db
      .update(users)
      .set({
        gmailHistoryId: historyId,
        gmailWatchExpiry: new Date(expiration),
        updatedAt: new Date(),
      })
      .where(eq(users.id, this.userId));

    return { historyId, expiration };
  }

  async stopWatch(): Promise<void> {
    await this.gmail.users.stop({ userId: "me" });
    await db
      .update(users)
      .set({
        gmailHistoryId: null,
        gmailWatchExpiry: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, this.userId));
  }

  async getMessagesSinceHistory(
    historyId: string,
    maxMessages: number = 50
  ): Promise<{ messages: GmailMessage[]; latestHistoryId: string | null }> {
    try {
      const historyResponse = await this.gmail.users.history.list({
        userId: "me",
        startHistoryId: historyId,
        historyTypes: ["messageAdded"],
      });

      // Get the latest historyId from response for updating cursor
      const latestHistoryId = historyResponse.data.historyId || null;

      const messageIds = new Set<string>();
      for (const history of historyResponse.data.history || []) {
        for (const added of history.messagesAdded || []) {
          if (added.message?.id) {
            messageIds.add(added.message.id);
          }
        }
      }

      // Limit messages to prevent quota issues
      const limitedIds = Array.from(messageIds).slice(0, maxMessages);

      const messages: GmailMessage[] = [];
      for (const messageId of limitedIds) {
        const message = await this.getMessage(messageId);
        if (message && this.isPrimaryInboxMessage(message)) {
          messages.push(message);
        }
      }

      return { messages, latestHistoryId };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: number }).code === 404
      ) {
        // historyId too old, return empty and let caller update historyId
        console.log(
          `[Gmail] HistoryId ${historyId} is too old, returning empty result`
        );
        return { messages: [], latestHistoryId: null };
      }
      console.error(`[Gmail] Error fetching messages since history:`, error);
      throw error;
    }
  }

  async getMessage(messageId: string): Promise<GmailMessage | null> {
    try {
      const response = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      return response.data as GmailMessage;
    } catch (error) {
      console.error(`[Gmail] Error fetching message ${messageId}:`, error);
      return null;
    }
  }

  async getRecentMessages(maxResults: number = 10): Promise<GmailMessage[]> {
    // Use query parameter to exclude promotional emails from the API call itself
    const listResponse = await this.gmail.users.messages.list({
      userId: "me",
      maxResults: maxResults * 2, // Fetch more to account for filtering
      labelIds: ["INBOX"],
      q: "-category:promotions", // Exclude promotional emails
    });

    const messages: GmailMessage[] = [];
    for (const msg of listResponse.data.messages || []) {
      const message = await this.getMessage(msg.id!);
      // Double-check filtering even though we used query parameter
      if (message && this.isPrimaryInboxMessage(message)) {
        messages.push(message);
        // Stop once we have enough primary inbox messages
        if (messages.length >= maxResults) {
          break;
        }
      }
    }

    return messages;
  }

  static extractEmailContent(message: GmailMessage): {
    subject: string;
    from: string;
    body: string;
    date: Date;
  } {
    const headers = message.payload.headers;
    const subject =
      headers.find((h) => h.name.toLowerCase() === "subject")?.value ||
      "(No Subject)";
    const from =
      headers.find((h) => h.name.toLowerCase() === "from")?.value || "";
    const date = new Date(parseInt(message.internalDate, 10));

    let body = "";

    if (message.payload.body?.data) {
      body = Buffer.from(message.payload.body.data, "base64").toString("utf-8");
    } else if (message.payload.parts) {
      for (const part of message.payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
          break;
        }
        if (part.mimeType === "text/html" && part.body?.data && !body) {
          body = Buffer.from(part.body.data, "base64")
            .toString("utf-8")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
      }
    }

    body = body.substring(0, 5000);

    return { subject, from, body, date };
  }
}
