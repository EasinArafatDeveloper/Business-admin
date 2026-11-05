import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ApiKey, User } from "@/db/schema";
import { findToken } from "@/lib/oauth";

const K = schema.apiKeys;
export const KEY_PREFIX = "su_";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new key: the full value is returned once and never stored. */
export function newKey() {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, keyHash: hashKey(key), prefix: key.slice(0, 10) };
}

export type McpContext = { user: User; key: ApiKey };

/**
 * The person behind "Authorization: Bearer …", if the key/grant and the account are both active.
 * su_…  = an API key pasted into Claude Desktop / Cursor
 * sua_… = an access token from "Sign in with ScaleUp" (claude.ai, ChatGPT)
 */
export async function authenticate(req: Request): Promise<McpContext | null> {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.match(/^Bearer\s+(su[a-z]?_[A-Za-z0-9_-]{20,80})$/)?.[1];
  if (!bearer) return null;
  let where;
  if (bearer.startsWith("sua_")) {
    const t = await findToken(bearer, "access");
    if (!t) return null;
    where = and(eq(K.id, t.grantId), isNull(K.revokedAt));
  } else if (bearer.startsWith(KEY_PREFIX)) {
    where = and(eq(K.keyHash, hashKey(bearer)), isNull(K.revokedAt), eq(K.kind, "key"));
  } else return null;
  const [row] = await db.select({ key: K, user: schema.users }).from(K).innerJoin(schema.users, eq(schema.users.id, K.userId)).where(where).limit(1);
  if (!row || row.user.status !== "active" || row.user.workspaceId !== row.key.workspaceId) return null;
  // Note "last used" at most once a minute.
  if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000) {
    await db.update(K).set({ lastUsedAt: new Date() }).where(eq(K.id, row.key.id));
  }
  return row;
}

export async function logAction(ctx: McpContext, tool: string, input: Record<string, unknown>, ok: boolean, summary: string) {
  await db
    .insert(schema.aiActions)
    .values({ workspaceId: ctx.user.workspaceId, userId: ctx.user.id, keyId: ctx.key.id, tool, input, ok, summary: summary.slice(0, 500) })
    .catch((e) => console.error("[mcp] log failed", e));
}
