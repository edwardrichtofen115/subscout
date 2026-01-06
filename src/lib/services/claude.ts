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
- Trial: Free trial started, X days free, trial activation, trial welcome, free access period
- Subscription: Payment confirmed, subscription started, membership activated, billing started
- NOT subscription: Newsletters, marketing emails, receipts for one-time purchases, shipping notifications, password resets, account verifications, promotional offers

Extract the service name from sender domain or email content.
If duration is mentioned (e.g., "14-day trial"), extract it.
If specific end date mentioned, extract it.
Be conservative - only mark as subscription if clearly a signup/activation email.`;

export class ClaudeService {
  async classifyEmail(
    subject: string,
    from: string,
    body: string
  ): Promise<EmailClassification> {
    const prompt = CLASSIFICATION_PROMPT.replace("{subject}", subject)
      .replace("{from}", from)
      .replace("{body}", body.substring(0, 4000));

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-3-5-20241022",
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

      const jsonStr = content.text.trim();
      const classification: EmailClassification = JSON.parse(jsonStr);

      return classification;
    } catch (error) {
      console.error("Error classifying email:", error);
      return {
        is_subscription: false,
        confidence: 0,
        service_name: null,
        type: null,
        duration_days: null,
        end_date: null,
        reasoning: "Failed to classify email",
      };
    }
  }
}
