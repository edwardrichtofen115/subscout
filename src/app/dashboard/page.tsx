import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db, subscriptions, settings, users } from "@/lib/db";
import { eq } from "drizzle-orm";
import { Header } from "@/components/header";
import { SubscriptionList } from "@/components/subscription-list";
import { Button } from "@/components/ui/button";
import { GmailService } from "@/lib/services/gmail";

async function setupGmailWatch(userId: string, accessToken: string) {
  "use server";

  try {
    const gmailService = new GmailService(accessToken, userId);
    await gmailService.setupWatch();
    return { success: true };
  } catch (error) {
    console.error("Failed to setup Gmail watch:", error);
    return { success: false, error: "Failed to setup Gmail monitoring" };
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

  const isWatchActive =
    user.gmailWatchExpiry && new Date(user.gmailWatchExpiry) > new Date();

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

          {!isWatchActive && user.googleAccessToken && (
            <form
              action={async () => {
                "use server";
                await setupGmailWatch(user.id, user.googleAccessToken!);
              }}
            >
              <Button type="submit">Enable Email Monitoring</Button>
            </form>
          )}

          {isWatchActive && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span>Monitoring active</span>
            </div>
          )}
        </div>

        <SubscriptionList initialSubscriptions={userSubscriptions} />
      </main>
    </div>
  );
}
