import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, subscriptions, users } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { EmailService } from "@/lib/services/email";
import { FEEDBACK_REASON_LABELS, type FeedbackReason } from "@/types";

export async function POST(request: NextRequest) {
  console.log("[Feedback API] Received feedback request");
  try {
    const session = await auth();
    console.log("[Feedback API] Session:", session?.user?.email ?? "No session");

    if (!session?.user?.email) {
      console.log("[Feedback API] Unauthorized - no session");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!user) {
      console.log("[Feedback API] User not found in database");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.log("[Feedback API] User found:", user.id);

    const body = await request.json();
    const { subscriptionId, reason, description } = body as {
      subscriptionId: string;
      reason: FeedbackReason;
      description: string;
    };
    console.log("[Feedback API] Request body:", { subscriptionId, reason, description });

    if (!subscriptionId || !reason) {
      console.log("[Feedback API] Missing required fields");
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const subscription = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.id, subscriptionId),
        eq(subscriptions.userId, user.id)
      ),
    });

    if (!subscription) {
      console.log("[Feedback API] Subscription not found:", subscriptionId);
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }
    console.log("[Feedback API] Subscription found:", subscription.serviceName);

    console.log("[Feedback API] Sending email...");
    const emailService = new EmailService();
    const result = await emailService.sendFeedback({
      userEmail: session.user.email,
      subscriptionId: subscription.id,
      serviceName: subscription.serviceName,
      type: subscription.type,
      detectedDate: subscription.detectedDate.toISOString(),
      endDate: subscription.endDate?.toISOString() || null,
      emailSubject: subscription.emailSubject,
      emailSnippet: subscription.emailSnippet,
      confidence: subscription.confidence,
      feedbackReason: FEEDBACK_REASON_LABELS[reason],
      feedbackDescription: description || "",
    });

    console.log("[Feedback API] Email result:", result);
    if (!result.success) {
      console.error("[Feedback API] Failed to send email:", result.error);
      return NextResponse.json(
        { error: "Failed to send feedback" },
        { status: 500 }
      );
    }

    console.log("[Feedback API] Success!");
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("[Feedback API] Uncaught error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
