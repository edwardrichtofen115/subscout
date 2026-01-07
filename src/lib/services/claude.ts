import Anthropic from "@anthropic-ai/sdk";
import type { EmailClassification } from "@/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const CLASSIFICATION_PROMPT = `You are analyzing an email to determine if it represents a subscription signup, trial activation, or free trial confirmation.

Analyze the following email:
Subject: {subject}
From: {from}
Body: {body}

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "is_subscription": boolean,
  "confidence": number between 0 and 1,
  "service_name": "extracted service/company name" or null,
  "type": "trial" | "subscription" | null,
  "duration_days": estimated duration in days or null,
  "end_date": "YYYY-MM-DD" if explicitly mentioned or null,
  "reasoning": "brief explanation"
}

Classification criteria:

IS A SUBSCRIPTION (set is_subscription = true):
- Trial emails: Any email confirming registration for a free trial, trial activation, trial started, "trial period", "free trial", "trial will remain active until", "trial access", "trial account", "trial plan"
- Subscription emails: Payment confirmed, subscription started, membership activated, billing started, recurring subscription begun
- Both trial AND subscription emails should be marked as is_subscription = true
- Even if the email says "trial" or "free trial", it should still be marked as a subscription with type = "trial"

IS NOT A SUBSCRIPTION (set is_subscription = false):
- Newsletters, marketing emails, promotional offers
- Receipts for one-time purchases (unless subscription signup)
- Shipping notifications
- Password resets
- Account verifications (unless they're for a trial/subscription signup)
- General product updates or announcements

Important extraction rules:
- Extract service name from sender domain, email content, or signature
- If end date is explicitly mentioned (e.g., "until January 24th, 2026", "trial expires on 2026-01-24"), extract it in YYYY-MM-DD format
- If duration is mentioned (e.g., "14-day trial", "30 days free"), extract the number of days
- If an email confirms a trial registration or activation, it IS a subscription regardless of whether payment was mentioned
- For trial emails, set type = "trial"
- For paid subscriptions, set type = "subscription"`;

export class ClaudeService {
  async classifyEmail(
    subject: string,
    from: string,
    body: string
  ): Promise<EmailClassification> {
    const prompt = CLASSIFICATION_PROMPT.replace("{subject}", subject)
      .replace("{from}", from)
      .replace("{body}", body.substring(0, 4000));

    let response;
    try {
      response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      let jsonStr = content.text.trim();
      
      // Strip markdown code blocks if present (Claude sometimes wraps JSON in ```json ... ```)
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
      
      const classification: EmailClassification = JSON.parse(jsonStr);

      return classification;
    } catch (error) {
      console.error("[Claude] Error classifying email:", error);
      console.error("[Claude] Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
      // Log the raw response for debugging if available
      if (response?.content?.[0]?.type === "text") {
        console.error("[Claude] Raw response:", response.content[0].text);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        is_subscription: false,
        confidence: 0,
        service_name: null,
        type: null,
        duration_days: null,
        end_date: null,
        reasoning: `Failed to classify: ${errorMessage}`,
      };
    }
  }
}
