import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ApiKey, User } from "@/db/schema";

const K = schema.apiKeys;
export const KEY_PREFIX = "su_";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new key: the full value is returned once and never stored. */
export function newKey() {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, keyHash: hashKey(key), prefix: key.slice(0, 10) };
}

export type McpContext = { user: User; key: ApiKey };

/** The person behind "Authorization: Bearer su_…", if the key and the account are both active. */
export async function authenticate(req: Request): Promise<McpContext | null> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.match(/^Bearer\s+(su_[A-Za-z0-9_-]{20,80})$/)?.[1];
  if (!key) return null;
  const [row] = await db
    .select({ key: K, user: schema.users })
    .from(K)
    .innerJoin(schema.users, eq(schema.users.id, K.userId))
    .where(and(eq(K.keyHash, hashKey(key)), isNull(K.revokedAt)))
    .limit(1);
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
