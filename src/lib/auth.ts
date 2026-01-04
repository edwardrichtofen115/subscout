import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "./db";
import { users, user, account, session, verificationToken } from "./db/schema";
import { eq } from "drizzle-orm";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: user,
    accountsTable: account,
    sessionsTable: session,
    verificationTokensTable: verificationToken,
  }),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.accessToken = token.accessToken as string;
      }
      return session;
    },
  },
  events: {
    async signIn({ user: authUser, account: authAccount }) {
      if (authAccount && authUser.id && authUser.email) {
        // Sync user to the app's users table (separate from NextAuth's user table)
        // First, check if user exists in app's users table
        const existingUser = await db
          .select()
          .from(users)
          .where(eq(users.email, authUser.email))
          .limit(1);

        if (existingUser.length === 0) {
          // Create new user in app's users table
          await db.insert(users).values({
            email: authUser.email,
            name: authUser.name,
            image: authUser.image,
            googleAccessToken: authAccount.access_token,
            googleRefreshToken: authAccount.refresh_token,
            googleTokenExpiry: authAccount.expires_at
              ? new Date(authAccount.expires_at * 1000)
              : null,
          });
        } else {
          // Update existing user with new tokens
          await db
            .update(users)
            .set({
              googleAccessToken: authAccount.access_token,
              googleRefreshToken: authAccount.refresh_token,
              googleTokenExpiry: authAccount.expires_at
                ? new Date(authAccount.expires_at * 1000)
                : null,
              updatedAt: new Date(),
            })
            .where(eq(users.email, authUser.email));
        }
      }
    },
  },
  pages: {
    signIn: "/signin",
  },
  session: {
    strategy: "jwt",
  },
});

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
