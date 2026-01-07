import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, subscriptions, users } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { EmailService } from "@/lib/services/email";
import { FEEDBACK_REASON_LABELS, type FeedbackReason } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();
    const { subscriptionId, reason, description } = body as {
      subscriptionId: string;
      reason: FeedbackReason;
      description: string;
    };

    if (!subscriptionId || !reason) {
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
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

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

    if (!result.success) {
      console.error("[Feedback API] Failed to send email:", result.error);
      return NextResponse.json(
        { error: "Failed to send feedback" },
        { status: 500 }
      );
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Feedback submission error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
