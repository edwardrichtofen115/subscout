import { db, users } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { User } from "@/lib/db/schema";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// Buffer time before expiry to refresh token (5 minutes in milliseconds)
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * Gets a valid access token for the user, refreshing if necessary.
 *
 * @param user - The user object from the database
 * @returns Valid access token string, or null if refresh fails
 */
export async function getValidAccessToken(user: User): Promise<string | null> {
  // If no access token exists at all, return null
  if (!user.googleAccessToken) {
    console.log(`No access token found for user ${user.id}`);
    return null;
  }

  // Check if token is still valid (with 5 minute buffer)
  if (isTokenValid(user.googleTokenExpiry)) {
    return user.googleAccessToken;
  }

  // Token is expired or expiring soon, need to refresh
  console.log(`Token expired or expiring soon for user ${user.id}, refreshing...`);

  // If no refresh token, we cannot refresh
  if (!user.googleRefreshToken) {
    console.log(`No refresh token available for user ${user.id}`);
    return null;
  }

  // Attempt to refresh the token
  const newTokenData = await refreshAccessToken(user.googleRefreshToken);

  if (!newTokenData) {
    console.error(`Failed to refresh token for user ${user.id}`);
    return null;
  }

  // Calculate new expiry time
  const newExpiry = new Date(Date.now() + newTokenData.expires_in * 1000);

  // Update database with new token and expiry
  try {
    await db
      .update(users)
      .set({
        googleAccessToken: newTokenData.access_token,
        googleTokenExpiry: newExpiry,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    console.log(`Successfully refreshed token for user ${user.id}`);
    return newTokenData.access_token;
  } catch (error) {
    console.error(`Failed to update token in database for user ${user.id}:`, error);
    // Return the new token even if DB update fails - it's still valid
    return newTokenData.access_token;
  }
}

/**
 * Checks if a token expiry date is still valid (with buffer).
 *
 * @param expiry - Token expiry date, or null if unknown
 * @returns true if token is valid, false if expired or expiring soon
 */
function isTokenValid(expiry: Date | null): boolean {
  // If no expiry is set, assume token might be expired
  if (!expiry) {
    return false;
  }

  const now = Date.now();
  const expiryTime = expiry.getTime();

  // Token is valid if it expires more than EXPIRY_BUFFER_MS from now
  return expiryTime > now + EXPIRY_BUFFER_MS;
}

/**
 * Refreshes an access token using the refresh token.
 *
 * @param refreshToken - The Google refresh token
 * @returns New token data, or null if refresh fails
 */
async function refreshAccessToken(refreshToken: string): Promise<TokenRefreshResponse | null> {
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Token refresh failed with status ${response.status}:`, errorText);
      return null;
    }

    const data: TokenRefreshResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Error refreshing access token:", error);
    return null;
  }
}
