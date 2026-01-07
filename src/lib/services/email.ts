import { Resend } from "resend";

export interface FeedbackEmailData {
  userEmail: string;
  subscriptionId: string;
  serviceName: string;
  type: "trial" | "subscription";
  detectedDate: string;
  endDate: string | null;
  emailSubject: string;
  emailSnippet: string | null;
  confidence: number | null;
  feedbackReason: string;
  feedbackDescription: string;
}

export class EmailService {
  private static readonly FEEDBACK_RECIPIENT = "sbaluja1026@gmail.com";
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendFeedback(
    data: FeedbackEmailData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log("[Email] Attempting to send feedback email...");
      console.log("[Email] API Key present:", !!process.env.RESEND_API_KEY);

      const emailBody = this.buildFeedbackEmailBody(data);

      const { data: emailData, error } = await this.resend.emails.send({
        from: "SubScout <onboarding@resend.dev>",
        to: EmailService.FEEDBACK_RECIPIENT,
        subject: `[SubScout Feedback] ${data.feedbackReason} - ${data.serviceName}`,
        text: emailBody,
      });

      console.log("[Email] Resend response - data:", emailData);
      console.log("[Email] Resend response - error:", error);

      if (error) {
        console.error("[Email] Resend returned error:", error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error("[Email] Failed to send feedback:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  private buildFeedbackEmailBody(data: FeedbackEmailData): string {
    return `
SUBSCRIPTION FEEDBACK REPORT
============================

User: ${data.userEmail}
Submitted: ${new Date().toISOString()}

FEEDBACK
--------
Reason: ${data.feedbackReason}
Description: ${data.feedbackDescription || "(No additional details provided)"}

SUBSCRIPTION DETAILS
--------------------
ID: ${data.subscriptionId}
Service Name: ${data.serviceName}
Type: ${data.type}
Detected Date: ${data.detectedDate}
End Date: ${data.endDate || "Not specified"}
Confidence Score: ${data.confidence !== null ? `${data.confidence}%` : "N/A"}

ORIGINAL EMAIL
--------------
Subject: ${data.emailSubject}
Snippet: ${data.emailSnippet || "(No snippet available)"}
`.trim();
  }
}
