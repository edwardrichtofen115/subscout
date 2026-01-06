import { google, gmail_v1 } from "googleapis";
import { db, users } from "../db";
import { eq } from "drizzle-orm";
import type { GmailMessage } from "@/types";

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID!;
const TOPIC_NAME = `projects/${GCP_PROJECT_ID}/topics/subscout-gmail`;

export class GmailService {
  private gmail: gmail_v1.Gmail;
  private userId: string;

  constructor(accessToken: string, userId: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth });
    this.userId = userId;
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
    maxMessages: number = 5
  ): Promise<{ messages: GmailMessage[]; latestHistoryId: string | null }> {
    try {
      console.log(`[Gmail] Calling history.list with startHistoryId: ${historyId}`);
      const historyResponse = await this.gmail.users.history.list({
        userId: "me",
        startHistoryId: historyId,
        historyTypes: ["messageAdded"],
      });

      console.log(`[Gmail] history.list response:`, JSON.stringify({
        historyId: historyResponse.data.historyId,
        historyCount: historyResponse.data.history?.length || 0,
      }));

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
      console.log(
        `Found ${messageIds.size} messages, processing ${limitedIds.length}`
      );

      const messages: GmailMessage[] = [];
      for (const messageId of limitedIds) {
        const message = await this.getMessage(messageId);
        if (message) {
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
        return { messages: [], latestHistoryId: null };
      }
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
    } catch {
      return null;
    }
  }

  async getRecentMessages(maxResults: number = 10): Promise<GmailMessage[]> {
    const listResponse = await this.gmail.users.messages.list({
      userId: "me",
      maxResults,
      labelIds: ["INBOX"],
    });

    const messages: GmailMessage[] = [];
    for (const msg of listResponse.data.messages || []) {
      const message = await this.getMessage(msg.id!);
      if (message) {
        messages.push(message);
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
