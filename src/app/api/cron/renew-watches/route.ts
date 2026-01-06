import { NextRequest, NextResponse } from "next/server";
import { db, users } from "@/lib/db";
import { lt, isNotNull, and } from "drizzle-orm";
import { GmailService } from "@/lib/services/gmail";
import { getValidAccessToken } from "@/lib/services/token";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const expirationThreshold = new Date();
    expirationThreshold.setDate(expirationThreshold.getDate() + 1);

    const usersToRenew = await db.query.users.findMany({
      where: and(
        isNotNull(users.gmailWatchExpiry),
        lt(users.gmailWatchExpiry, expirationThreshold),
        isNotNull(users.googleAccessToken)
      ),
    });

    const results = [];

    for (const user of usersToRenew) {
      try {
        // Get a valid access token, refreshing if expired
        const accessToken = await getValidAccessToken(user);
        if (!accessToken) {
          console.error(`Failed to get valid access token for user ${user.id}`);
          results.push({ userId: user.id, status: "failed", error: "Token refresh failed" });
          continue;
        }

        const gmailService = new GmailService(accessToken, user.id);
        await gmailService.setupWatch();
        results.push({ userId: user.id, status: "renewed" });
      } catch (error) {
        console.error(`Failed to renew watch for user ${user.id}:`, error);
        results.push({ userId: user.id, status: "failed", error: String(error) });
      }
    }

    return NextResponse.json({
      processed: usersToRenew.length,
      results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
