import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, subscriptions, settings, users, processedEmails, account } from "@/lib/db";
import { eq, sql, gte, and } from "drizzle-orm";
import { Header } from "@/components/header";
import { SubscriptionList } from "@/components/subscription-list";
import { Button } from "@/components/ui/button";
import { GmailService } from "@/lib/services/gmail";
import { getValidAccessToken } from "@/lib/services/token";
import { SyncButton } from "@/components/sync-button";
import { getRelativeTime } from "@/lib/utils";
import { EmailsProcessedStat } from "@/components/emails-processed-stat";

async function setupGmailWatch(userId: string) {
  "use server";

  try {
    // Get fresh access token
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    const accessToken = await getValidAccessToken(user);
    if (!accessToken) {
      return { success: false, error: "Failed to get access token" };
    }

    const gmailService = new GmailService(accessToken, userId);
    await gmailService.setupWatch();

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    console.error("Failed to setup Gmail watch:", error);
    return { success: false, error: "Failed to setup Gmail monitoring" };
  }
}

async function disableGmailWatch(userId: string) {
  "use server";

  try {
    // Get fresh access token
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    const accessToken = await getValidAccessToken(user);
    if (!accessToken) {
      return { success: false, error: "Failed to get access token" };
    }

    // Stop the Gmail watch
    const gmailService = new GmailService(accessToken, userId);
    await gmailService.stopWatch();

    // Disable monitoring in settings
    await db
      .update(settings)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(settings.userId, userId));

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    console.error("Failed to disable Gmail watch:", error);
    return { success: false, error: "Failed to disable Gmail monitoring" };
  }
}

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/signin");
  }

  let user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });

  // Handle race condition: user might not exist in app's users table yet
  // This can happen on mobile when the signIn event hasn't completed
  if (!user) {
    console.log("Dashboard: user not found in users table, attempting to create from session");

    try {
      // Get OAuth tokens from NextAuth's account table
      const authAccount = await db.query.account.findFirst({
        where: eq(account.userId, session.user.id),
      });

      // Create the user in the app's users table
      const [newUser] = await db.insert(users).values({
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
        googleAccessToken: authAccount?.access_token ?? null,
        googleRefreshToken: authAccount?.refresh_token ?? null,
        googleTokenExpiry: authAccount?.expires_at
          ? new Date(authAccount.expires_at * 1000)
          : null,
      }).returning();

      user = newUser;
      console.log("Dashboard: user created successfully");
    } catch (error) {
      // If insert fails (e.g., duplicate key), try to fetch again
      // This handles the case where the signIn event completed between our check and insert
      console.log("Dashboard: insert failed, retrying fetch", error);
      user = await db.query.users.findFirst({
        where: eq(users.email, session.user.email),
      });

      if (!user) {
        console.error("Dashboard: still no user after retry, redirecting to signin");
        redirect("/signin");
      }
    }
  }

  const userSettings = await db.query.settings.findFirst({
    where: eq(settings.userId, user.id),
  });

  if (!userSettings) {
    await db.insert(settings).values({
      userId: user.id,
      reminderDaysBefore: 2,
      enabled: true,
    });
  }

  const userSubscriptions = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, user.id),
    orderBy: (subscriptions, { desc }) => [desc(subscriptions.createdAt)],
  });

  // Get processed emails count for last 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const processedEmailsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(processedEmails)
    .where(
      and(
        eq(processedEmails.userId, user.id),
        gte(processedEmails.processedAt, twentyFourHoursAgo)
      )
    );

  const processedEmailsCount = Number(processedEmailsResult[0]?.count || 0);

  const isWatchActive =
    user.gmailWatchExpiry && new Date(user.gmailWatchExpiry) > new Date();
  const isMonitoringEnabled = userSettings?.enabled ?? false;

  return (
    <div className="min-h-screen bg-background">
      <Header user={session.user} />

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Your Subscriptions</h1>
            <p className="text-muted-foreground">
              Track and manage your trials and subscriptions
            </p>
          </div>

          {/* Show enable button if: no active watch OR monitoring disabled */}
          {(!isWatchActive || !isMonitoringEnabled) && user.googleAccessToken && (
            <form
              action={async () => {
                "use server";
                // Enable in settings if disabled
                await db
                  .update(settings)
                  .set({ enabled: true, updatedAt: new Date() })
                  .where(eq(settings.userId, user.id));
                await setupGmailWatch(user.id);
              }}
            >
              <Button type="submit">Enable Email Monitoring</Button>
            </form>
          )}

          {/* Show status and disable button if monitoring is active */}
          {isWatchActive && isMonitoringEnabled && user.googleAccessToken && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <span>Monitoring active</span>
              </div>
              <form
                action={async () => {
                  "use server";
                  await disableGmailWatch(user.id);
                }}
              >
                <Button type="submit" variant="outline">
                  Disable Email Monitoring
                </Button>
              </form>
            </div>
          )}
        </div>

        {/* Stats and Sync Section */}
        <div className="mb-8 p-6 bg-muted/50 rounded-lg border">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-8">
              <EmailsProcessedStat count={processedEmailsCount} />
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Last Sync
                </p>
                <p className="text-lg font-semibold">
                  {getRelativeTime(user.lastSyncAt)}
                </p>
              </div>
            </div>
            {user.googleAccessToken && isMonitoringEnabled && <SyncButton />}
          </div>
        </div>

        <SubscriptionList initialSubscriptions={userSubscriptions} />
      </main>
    </div>
  );
}
