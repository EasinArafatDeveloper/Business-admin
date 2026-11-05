import { randomBytes } from "node:crypto";
import { db, schema } from "@/db";
import { CORS, oauthError, redirectUriOk, sha256 } from "@/lib/oauth";
import { allow, requestIp } from "@/lib/public-invoice";

/**
 * Dynamic client registration (RFC 7591): an AI app introduces itself (name + redirect addresses).
 * Registering grants nothing — a person still has to sign in and approve it.
 */
export async function POST(req: Request) {
  if (!allow(`oauth-register:${requestIp(req)}`, 20, 3_600_000)) return oauthError("slow_down", "Too many registrations", 429);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return oauthError("invalid_client_metadata", "Send JSON");
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every((u) => u.length <= 500 && redirectUriOk(u)))
    return oauthError("invalid_redirect_uri", "redirect_uris must be https (or http://localhost) addresses");
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method))
    return oauthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method");
  const name = (typeof body.client_name === "string" ? body.client_name : "AI app").replace(/[^\p{L}\p{N} ._()&+-]/gu, "").slice(0, 60) || "AI app";

  const id = `suc-${randomBytes(12).toString("hex")}`;
  const secret = method === "none" ? null : randomBytes(32).toString("base64url");
  await db.insert(schema.oauthClients).values({ id, name, redirectUris: uris, secretHash: secret ? sha256(secret) : null });
  return Response.json(
    {
      client_id: id,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method
    },
    { status: 201, headers: { ...CORS, "Cache-Control": "no-store" } }
  );
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
