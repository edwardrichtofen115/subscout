import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, subscriptions, users } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { CalendarService } from "@/lib/services/calendar";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const subscription = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.id, id),
        eq(subscriptions.userId, user.id)
      ),
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    if (subscription.calendarEventId && user.googleAccessToken) {
      const calendarService = new CalendarService(user.googleAccessToken);
      await calendarService.deleteReminder(subscription.calendarEventId);
    }

    await db
      .delete(subscriptions)
      .where(
        and(eq(subscriptions.id, id), eq(subscriptions.userId, user.id))
      );

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Delete subscription error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();

    const subscription = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.id, id),
        eq(subscriptions.userId, user.id)
      ),
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    const updates: Partial<{
      endDate: Date;
      status: "active" | "expiring_soon" | "expired" | "cancelled";
      updatedAt: Date;
    }> = {
      updatedAt: new Date(),
    };

    if (body.endDate) {
      updates.endDate = new Date(body.endDate);
    }

    if (body.status) {
      updates.status = body.status;
    }

    await db
      .update(subscriptions)
      .set(updates)
      .where(
        and(eq(subscriptions.id, id), eq(subscriptions.userId, user.id))
      );

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Update subscription error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
