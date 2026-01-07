import Anthropic from "@anthropic-ai/sdk";
import type { EmailClassification } from "@/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SUBSCRIPTION_CLASSIFIER_PROMPT = `You are an email classification assistant helping users track subscriptions and trials so they can review them before renewal or expiration.

## Your Task
Analyze the provided email and determine if it represents a subscription signup, trial activation, or free trial confirmation that the user should be reminded about.

## Email to Analyze
Subject: {subject}
From: {from}
Date: {date}
Body: {body}

## Classification Guidelines

**Mark as subscription (is_subscription = true) when the email explicitly confirms:**
- Trial activation: "free trial", "trial period", "trial started", "trial access", "X-day trial", "trial expires on", "trial will end"
- Subscription start: "subscription confirmed", "membership activated", "billing started", "recurring payment", "subscription plan"
- Time-limited access: explicit mention of access ending on a specific date or after a duration

**Mark as NOT a subscription (is_subscription = false) for:**
- Generic welcome/onboarding emails that only say "thanks for signing up" without trial or billing language
- Account creation confirmations without subscription context
- One-time purchase receipts
- Newsletters, marketing emails, promotional offers
- Password resets, account verifications, shipping notifications
- Product updates, feedback requests, team introductions

The key distinction: the email must explicitly reference a trial period, subscription, billing cycle, or time-limited access—not just account creation.

## Extraction Rules
1. **Service name**: Extract from sender name, email domain, or prominent branding in the body
2. **End date**: If explicitly stated (e.g., "expires January 24, 2026"), convert to YYYY-MM-DD format
3. **Duration**: If mentioned (e.g., "14-day trial"), extract the number; for monthly/yearly, convert to days (30/365)
4. **Type**: Use "trial" for free trials, "subscription" for paid recurring services

## Response Format
Respond with valid JSON only—no markdown formatting, no code blocks, no additional text:

{"is_subscription": boolean, "confidence": number, "service_name": string | null, "type": "trial" | "subscription" | null, "duration_days": number | null, "end_date": "YYYY-MM-DD" | null, "reasoning": string}

Where:
- confidence: 0.0 to 1.0 indicating classification certainty
- reasoning: one sentence explaining your classification decision`;

const EXAMPLES = `
## Examples

Email: "Welcome to Notion! Your 14-day Pro trial has started. Your trial ends on Feb 1, 2026."
→ {"is_subscription": true, "confidence": 0.95, "service_name": "Notion", "type": "trial", "duration_days": 14, "end_date": "2026-02-01", "reasoning": "Explicitly confirms 14-day trial activation with end date."}

Email: "Thanks for joining Acme! We're excited to have you. Check out our getting started guide."
→ {"is_subscription": false, "confidence": 0.9, "service_name": "Acme", "type": null, "duration_days": null, "end_date": null, "reasoning": "Generic welcome email with no mention of trial, subscription, or billing."}
`;

export class ClaudeService {
  async classifyEmail(
    subject: string,
    from: string,
    body: string,
    date?: Date
  ): Promise<EmailClassification> {
    const dateStr = date
      ? date.toLocaleString("en-US", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : "Not provided";

    const prompt = (
      SUBSCRIPTION_CLASSIFIER_PROMPT + EXAMPLES
    )
      .replace("{subject}", subject)
      .replace("{from}", from)
      .replace("{date}", dateStr)
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
