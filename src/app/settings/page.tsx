import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db, settings, users } from "@/lib/db";
import { eq } from "drizzle-orm";
import { Header } from "@/components/header";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
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
    <div className="min-h-screen bg-background">
      <Header user={session.user} />

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Customize how SubScout monitors your subscriptions
          </p>
        </div>

        <SettingsForm initialSettings={userSettings} />
      </main>
    </div>
  );
}
