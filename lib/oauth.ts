import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

/** Public address of the admin (same host as tracking links). */
export function adminOrigin() {
  const base = (process.env.LINK_BASE_URL ?? "https://admin.scaleupweb.xyz/go").replace(/\/go\/?$/, "");
  return new URL(base).origin;
}
export const mcpResource = () => `${adminOrigin()}/api/mcp`;
export const resourceMetadataUrl = () => `${adminOrigin()}/.well-known/oauth-protected-resource/api/mcp`;

export const SCOPES = ["read", "write"] as const;
export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 30 * 86_400_000;
const CODE_TTL_MS = 5 * 60_000;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

/** RFC 9728 — where to find the sign-in server for /api/mcp. */
export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [adminOrigin()],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "ScaleUp Admin"
  };
}

/** RFC 8414 — how to register, sign in and get tokens. */
export function authServerMetadata() {
  const o = adminOrigin();
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/api/oauth/token`,
    registration_endpoint: `${o}/api/oauth/register`,
    revocation_endpoint: `${o}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: SCOPES,
    service_documentation: `${o}/settings?tab=ai`
  };
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version"
};

/** Redirect addresses an app may register: https anywhere, or http only on this computer (desktop apps). */
export function redirectUriOk(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge sent at sign-in. */
export function pkceOk(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read scope from a request like "read write" → "write" (write includes read). */
export const normalizeScope = (s: string | null | undefined): "read" | "write" => (/\bwrite\b/.test(s ?? "") ? "write" : "read");

export async function issueCode(opts: { clientId: string; grantId: number; redirectUri: string; codeChallenge: string }) {
  const code = token("suc_");
  await db.insert(schema.oauthCodes).values({ ...opts, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return code;
}

/** A fresh access + refresh pair for a grant. */
export async function issueTokens(grantId: number, clientId: string) {
  const access = token("sua_");
  const refresh = token("sur_");
  await db.insert(schema.oauthTokens).values([
    { tokenHash: sha256(access), kind: "access", grantId, clientId, expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000) },
    { tokenHash: sha256(refresh), kind: "refresh", grantId, clientId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) }
  ]);
  return { access, refresh };
}

/** The grant behind a live (unexpired, unrevoked) token of this kind. */
export async function findToken(raw: string, kind: "access" | "refresh") {
  const T = schema.oauthTokens;
  const [row] = await db
    .select()
    .from(T)
    .where(and(eq(T.tokenHash, sha256(raw)), eq(T.kind, kind), isNull(T.revokedAt), gt(T.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Client authentication at the token endpoint: public clients have no secret; confidential ones must send it. */
export async function authClient(req: Request, form: URLSearchParams) {
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  const basic = req.headers.get("authorization")?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const [u, p] = Buffer.from(basic, "base64").toString().split(":");
    id = decodeURIComponent(u ?? "");
    secret = decodeURIComponent(p ?? "");
  }
  if (!id) return null;
  const [client] = await db.select().from(schema.oauthClients).where(eq(schema.oauthClients.id, id)).limit(1);
  if (!client) return null;
  if (client.secretHash) {
    if (!secret) return null;
    const a = Buffer.from(sha256(secret));
    const b = Buffer.from(client.secretHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  }
  return client;
}

export const oauthError = (error: string, description: string, status = 400) =>
  Response.json({ error, error_description: description }, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
