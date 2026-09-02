import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

/**
 * The browser's side of the auth API: sign-in, sign-out, and OAuth consent.
 * The OAuth provider plugin forwards the signed authorization query on the
 * page's URL with each request, so a sign-in or consent that started from an
 * MCP client's authorization request resumes that request.
 */
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
});

/** Where the auth API tells the browser to go next, when it does. */
export function continuation(data: unknown): string | null {
  if (
    data &&
    typeof data === "object" &&
    "redirect" in data &&
    data.redirect === true &&
    "url" in data &&
    typeof data.url === "string"
  ) {
    return data.url;
  }
  return null;
}
