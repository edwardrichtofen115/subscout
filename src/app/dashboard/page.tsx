import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, subscriptions, settings, users, processedEmails } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { Header } from "@/components/header";
import { SubscriptionList } from "@/components/subscription-list";
import { Button } from "@/components/ui/button";
import { GmailService } from "@/lib/services/gmail";
import { getValidAccessToken } from "@/lib/services/token";
import { SyncButton } from "@/components/sync-button";

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

  if (!session?.user) {
    redirect("/signin");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email!),
  });

  if (!user) {
    redirect("/signin");
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

  // Get processed emails count
  const processedEmailsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(processedEmails)
    .where(eq(processedEmails.userId, user.id));

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
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Emails Processed
                </p>
                <p className="text-2xl font-bold">{processedEmailsCount}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Last Sync
                </p>
                <p className="text-lg font-semibold">
                  {user.lastSyncAt
                    ? new Date(user.lastSyncAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "Never"}
                </p>
              </div>
            </div>
            {user.googleAccessToken && <SyncButton />}
          </div>
        </div>

        <SubscriptionList initialSubscriptions={userSubscriptions} />
      </main>
    </div>
  );
}
