import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { ACCESS_TTL_S, CORS, authClient, findToken, issueTokens, oauthError, pkceOk, sha256 } from "@/lib/oauth";
import { allow, requestIp } from "@/lib/public-invoice";

/** Exchanges a sign-in code (with its PKCE verifier) or a refresh token for an access token. */
export async function POST(req: Request) {
  if (!allow(`oauth-token:${requestIp(req)}`, 60, 60_000)) return oauthError("slow_down", "Too many requests", 429);
  const form = new URLSearchParams(await req.text());
  const client = await authClient(req, form);
  if (!client) return oauthError("invalid_client", "Unknown client or wrong secret", 401);
  const grantType = form.get("grant_type");

  let grantId: number;
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const C = schema.oauthCodes;
    // Mark used in the same step, so a code can never be exchanged twice.
    const [row] = await db
      .update(C)
      .set({ usedAt: new Date() })
      .where(and(eq(C.codeHash, sha256(code)), isNull(C.usedAt)))
      .returning();
    if (!row || row.expiresAt < new Date() || row.clientId !== client.id) return oauthError("invalid_grant", "Code is invalid, expired or already used");
    if (row.redirectUri !== form.get("redirect_uri")) return oauthError("invalid_grant", "redirect_uri does not match");
    if (!pkceOk(form.get("code_verifier") ?? "", row.codeChallenge)) return oauthError("invalid_grant", "PKCE verification failed");
    grantId = row.grantId;
  } else if (grantType === "refresh_token") {
    const old = await findToken(form.get("refresh_token") ?? "", "refresh");
    if (!old || old.clientId !== client.id) return oauthError("invalid_grant", "Refresh token is invalid or expired");
    // Rotate: the old refresh token stops working.
    await db.update(schema.oauthTokens).set({ revokedAt: new Date() }).where(eq(schema.oauthTokens.id, old.id));
    grantId = old.grantId;
  } else {
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  }

  const [grant] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, grantId)).limit(1);
  if (!grant || grant.revokedAt) return oauthError("invalid_grant", "Access was revoked — connect again");
  const t = await issueTokens(grant.id, client.id);
  return Response.json(
    {
      access_token: t.access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: t.refresh,
      scope: grant.scope === "write" ? "read write" : "read"
    },
    { headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
