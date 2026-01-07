import Anthropic from "@anthropic-ai/sdk";
import type { EmailClassification } from "@/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SUBSCRIPTION_CLASSIFIER_PROMPT = `You are an email classification assistant helping users track NEW subscriptions and trials so they can review them before unexpected charges occur.

## Your Task
Analyze the provided email and determine if it represents a NEW subscription signup, trial activation, or free trial confirmation that could result in future automatic charges the user should be reminded about.

## Examples

Example 1 - Trial Started (IS a subscription):
Subject: "Welcome to Notion - Your Pro trial has started"
Body: "Thanks for starting your 14-day Pro trial! Your trial ends on Feb 1, 2026. After your trial, you'll be automatically charged $10/month unless you cancel."
→ {"is_subscription": true, "confidence": 0.95, "service_name": "Notion", "type": "trial", "duration_days": 14, "end_date": "2026-02-01", "auto_renew_risk": true, "reasoning": "New trial activation with automatic billing after trial ends unless user cancels."}

Example 2 - Subscription Confirmed (IS a subscription):
Subject: "Your Spotify Premium subscription is confirmed"
Body: "Welcome to Spotify Premium! Your subscription has started and you'll be billed $9.99/month. Your next billing date is March 15, 2026."
→ {"is_subscription": true, "confidence": 0.95, "service_name": "Spotify Premium", "type": "subscription", "duration_days": 30, "end_date": "2026-03-15", "auto_renew_risk": true, "reasoning": "New paid subscription with recurring automatic billing confirmed."}

Example 3 - Membership Expiring, Auto-Renewal OFF (NOT a subscription):
Subject: "Your membership is ending soon"
Body: "Hello, Your Prime membership is expiring in 1 day and you will lose access to your Prime benefits at the end of your membership period. If you would like to stay with Prime, you can turn your renewal back on and your benefits will continue without interruption."
→ {"is_subscription": false, "confidence": 0.9, "service_name": "Amazon Prime", "type": null, "duration_days": null, "end_date": null, "auto_renew_risk": false, "reasoning": "Expiration notice for existing membership with auto-renewal OFF. User must take action to renew; no automatic charge risk."}

Example 4 - Generic Welcome Email (NOT a subscription):
Subject: "Welcome to Acme!"
Body: "Thanks for signing up! We're excited to have you on board. Check out our getting started guide to make the most of your account."
→ {"is_subscription": false, "confidence": 0.9, "service_name": "Acme", "type": null, "duration_days": null, "end_date": null, "auto_renew_risk": false, "reasoning": "Generic welcome email with no mention of trial, subscription, or billing."}

Example 5 - Cancellation Confirmed (NOT a subscription):
Subject: "Your subscription has been cancelled"
Body: "Hi, This confirms that your Netflix subscription has been cancelled. You'll continue to have access until your current billing period ends on Jan 20, 2026. We hope to see you again!"
→ {"is_subscription": false, "confidence": 0.95, "service_name": "Netflix", "type": null, "duration_days": null, "end_date": null, "auto_renew_risk": false, "reasoning": "Cancellation confirmation. No future automatic charges will occur."}

Example 6 - Payment Failed / Action Required (NOT a subscription):
Subject: "Action required: Update your payment method"
Body: "We couldn't process your payment for YouTube Premium. Please update your payment method to continue your subscription. If we can't charge you within 7 days, your subscription will be cancelled."
→ {"is_subscription": false, "confidence": 0.85, "service_name": "YouTube Premium", "type": null, "duration_days": null, "end_date": null, "auto_renew_risk": false, "reasoning": "Payment failure notice for existing subscription. User must take action to continue; no automatic charge until payment is fixed."}

## Email to Analyze
Subject: {subject}
From: {from}
Date: {date}
Body: {body}

## Classification Guidelines

**Mark as subscription (is_subscription = true) when the email confirms a NEW commitment that may auto-renew or convert to paid:**
- Trial activation: "free trial started", "trial period began", "your X-day trial has started"
- Subscription start: "subscription confirmed", "membership activated", "billing started", "you've subscribed"
- Auto-renewal enabled: confirmation that recurring billing is set up and will charge automatically
- Key phrases: "you'll be automatically charged", "unless you cancel", "auto-renews on"

**Mark as NOT a subscription (is_subscription = false) for:**

*Expiration/Cancellation notices (no charge risk):*
- Subscriptions ENDING or EXPIRING where auto-renewal is OFF
- Phrases like: "membership is expiring", "you will lose access", "ending soon"
- Emails asking user to "turn on renewal", "renew now", "reactivate" (meaning auto-renewal is currently off)
- Cancellation confirmations
- Payment failed notices (user must act to be charged)

*General non-subscription emails:*
- Generic welcome/onboarding emails without trial or billing language
- Account creation confirmations without subscription context
- One-time purchase receipts
- Newsletters, marketing, promotional offers
- Password resets, account verifications, shipping notifications

**Key distinction**: Flag emails where the user WILL be charged automatically unless they take action. Do NOT flag emails where the user WON'T be charged unless they take action.

## Extraction Rules
1. **Service name**: Extract from sender name, email domain, or prominent branding
2. **End date**: If a trial/subscription end date is stated, convert to YYYY-MM-DD format
3. **Duration**: If mentioned (e.g., "14-day trial"), extract the number
4. **Type**: Use "trial" for free trials, "subscription" for paid recurring services
5. **Auto-renewal status**: Determine whether auto-renewal is ON (charge risk) or OFF (no charge risk)

## Response Format
Respond with valid JSON only—no markdown formatting, no code blocks, no additional text:

{"is_subscription": true, "confidence": 0.95, "service_name": "Example Service", "type": "trial", "duration_days": 14, "end_date": "2026-02-01", "auto_renew_risk": true, "reasoning": "Brief explanation of classification decision."}

Field definitions:
- is_subscription: true only if this represents a NEW subscription/trial with potential auto-charge
- confidence: 0.0 to 1.0 indicating classification certainty
- type: "trial" | "subscription" | null
- auto_renew_risk: true if user will be charged automatically without action, false otherwise
- reasoning: one sentence explaining your decision, specifically noting charge risk status`;

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
      SUBSCRIPTION_CLASSIFIER_PROMPT
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
