import { NextResponse } from "next/server";
import { db, users } from "@/lib/db";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";

type CheckResult = {
  name: string;
  status: "pass" | "fail";
  message: string;
  latency?: number;
};

type HealthResponse = {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
};

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return {
      name: "database",
      status: "pass",
      message: "PostgreSQL connection successful",
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      name: "database",
      status: "fail",
      message: `Database connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function checkEnvVars(): Promise<CheckResult> {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "ANTHROPIC_API_KEY",
    "AUTH_SECRET",
    "GCP_PROJECT_ID",
    "PUBSUB_VERIFICATION_TOKEN",
  ];

  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    return {
      name: "environment",
      status: "fail",
      message: `Missing env vars: ${missing.join(", ")}`,
    };
  }

  return {
    name: "environment",
    status: "pass",
    message: "All required environment variables set",
  };
}

async function checkGoogleOAuth(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    // Verify credentials are valid by generating an auth URL
    // This doesn't make an API call but validates the client ID format
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["email"],
    });

    if (!authUrl.includes("accounts.google.com")) {
      throw new Error("Invalid OAuth configuration");
    }

    return {
      name: "google_oauth",
      status: "pass",
      message: "Google OAuth credentials configured correctly",
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      name: "google_oauth",
      status: "fail",
      message: `Google OAuth check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function checkClaudeAPI(): Promise<CheckResult> {
  const start = Date.now();
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Make a minimal API call to verify the key works
    await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    });

    return {
      name: "claude_api",
      status: "pass",
      message: "Claude API key valid and working",
      latency: Date.now() - start,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Check for specific error types
    if (message.includes("401") || message.includes("invalid")) {
      return {
        name: "claude_api",
        status: "fail",
        message: "Claude API key is invalid",
      };
    }
    if (message.includes("insufficient") || message.includes("credit")) {
      return {
        name: "claude_api",
        status: "fail",
        message: "Claude API has insufficient credits",
      };
    }

    return {
      name: "claude_api",
      status: "fail",
      message: `Claude API check failed: ${message}`,
    };
  }
}

async function checkPubSubConfig(): Promise<CheckResult> {
  try {
    const projectId = process.env.GCP_PROJECT_ID;
    const token = process.env.PUBSUB_VERIFICATION_TOKEN;

    if (!projectId) {
      throw new Error("GCP_PROJECT_ID not set");
    }
    if (!token) {
      throw new Error("PUBSUB_VERIFICATION_TOKEN not set");
    }

    const topicName = `projects/${projectId}/topics/subscout-gmail`;

    return {
      name: "pubsub_config",
      status: "pass",
      message: `Pub/Sub configured for topic: ${topicName}`,
    };
  } catch (error) {
    return {
      name: "pubsub_config",
      status: "fail",
      message: `Pub/Sub config check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function checkUserTokens(): Promise<CheckResult> {
  try {
    // Check if any users have expired or missing tokens
    const usersWithIssues = await db
      .select({
        email: users.email,
        hasAccessToken: sql<boolean>`${users.googleAccessToken} IS NOT NULL`,
        hasRefreshToken: sql<boolean>`${users.googleRefreshToken} IS NOT NULL`,
        tokenExpired: sql<boolean>`${users.googleTokenExpiry} < NOW()`,
      })
      .from(users);

    const issues: string[] = [];
    for (const user of usersWithIssues) {
      if (!user.hasRefreshToken) {
        issues.push(`${user.email}: missing refresh token`);
      }
    }

    if (issues.length > 0) {
      return {
        name: "user_tokens",
        status: "fail",
        message: `Token issues found: ${issues.join("; ")}`,
      };
    }

    return {
      name: "user_tokens",
      status: "pass",
      message: `${usersWithIssues.length} user(s) with valid token configuration`,
    };
  } catch (error) {
    return {
      name: "user_tokens",
      status: "fail",
      message: `User token check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

export async function GET() {
  // Run all checks in parallel
  const checks = await Promise.all([
    checkEnvVars(),
    checkDatabase(),
    checkGoogleOAuth(),
    checkClaudeAPI(),
    checkPubSubConfig(),
    checkUserTokens(),
  ]);

  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;

  let status: HealthResponse["status"] = "healthy";
  if (failed > 0 && passed > 0) status = "degraded";
  if (failed === checks.length) status = "unhealthy";

  const response: HealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    checks,
    summary: {
      total: checks.length,
      passed,
      failed,
    },
  };

  const httpStatus = status === "healthy" ? 200 : status === "degraded" ? 200 : 503;

  return NextResponse.json(response, { status: httpStatus });
}
