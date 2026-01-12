import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db, settings, users, account } from "@/lib/db";
import { eq } from "drizzle-orm";
import { Header } from "@/components/header";
import { SettingsForm } from "@/components/settings-form";
import { Footer } from "@/components/footer";

export default async function SettingsPage() {
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
    console.log("Settings: user not found in users table, attempting to create from session");

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
      console.log("Settings: user created successfully");
    } catch (error) {
      // If insert fails (e.g., duplicate key), try to fetch again
      console.log("Settings: insert failed, retrying fetch", error);
      user = await db.query.users.findFirst({
        where: eq(users.email, session.user.email),
      });

      if (!user) {
        console.error("Settings: still no user after retry, redirecting to signin");
        redirect("/signin");
      }
    }
  }

  let userSettings = await db.query.settings.findFirst({
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
    userSettings = newSettings;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header user={session.user} />

      <main className="container mx-auto px-4 py-8 max-w-2xl flex-1">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Customize how SubScout monitors your subscriptions
          </p>
        </div>

        <SettingsForm initialSettings={userSettings} />
      </main>
      <Footer />
    </div>
  );
}
