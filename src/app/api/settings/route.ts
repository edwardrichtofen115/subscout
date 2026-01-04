import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, settings, users } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET() {
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

    const userSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, user.id),
    });

    if (!userSettings) {
      const [newSettings] = await db
        .insert(settings)
        .values({
          userId: user.id,
          reminderDaysBefore: 2,
          enabled: true,
        })
        .returning();

      return NextResponse.json(newSettings);
    }

    return NextResponse.json(userSettings);
  } catch (error) {
    console.error("Get settings error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
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

    const updates: Partial<{
      reminderDaysBefore: number;
      enabled: boolean;
      updatedAt: Date;
    }> = {
      updatedAt: new Date(),
    };

    if (typeof body.reminderDaysBefore === "number") {
      updates.reminderDaysBefore = Math.min(14, Math.max(1, body.reminderDaysBefore));
    }

    if (typeof body.enabled === "boolean") {
      updates.enabled = body.enabled;
    }

    await db.update(settings).set(updates).where(eq(settings.userId, user.id));

    const updatedSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, user.id),
    });

    return NextResponse.json(updatedSettings);
  } catch (error) {
    console.error("Update settings error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
