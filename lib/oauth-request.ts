import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { mcpResource, normalizeScope } from "@/lib/oauth";

export type AuthorizeParams = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  scope: "read" | "write";
};

/**
 * Checks a sign-in request. "fatal" errors (unknown app, unregistered redirect) are shown on our page —
 * never redirected, so nobody can bounce people to a fake site. Other errors go back to the app.
 */
export async function checkAuthorize(p: Record<string, string | undefined>) {
  const [client] = p.client_id ? await db.select().from(schema.oauthClients).where(eq(schema.oauthClients.id, p.client_id)).limit(1) : [];
  if (!client) return { fatal: "This app isn't registered. Remove the connector and add it again." } as const;
  const redirect = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirect)) return { fatal: "This app asked to return to an address it didn't register." } as const;

  const back = (error: string, description: string) => {
    const u = new URL(redirect);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (p.state) u.searchParams.set("state", p.state);
    return { redirectTo: u.toString() } as const;
  };
  if (p.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  if (!p.code_challenge || p.code_challenge_method !== "S256") return back("invalid_request", "PKCE with S256 is required");
  if (p.resource && p.resource.replace(/\/$/, "") !== mcpResource()) return back("invalid_target", "Unknown resource");

  const params: AuthorizeParams = {
    client_id: client.id,
    redirect_uri: redirect,
    state: (p.state ?? "").slice(0, 500),
    code_challenge: p.code_challenge,
    scope: normalizeScope(p.scope)
  };
  return { client, params } as const;
}
