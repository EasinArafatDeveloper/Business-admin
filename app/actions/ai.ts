"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { newKey } from "@/lib/mcp/keys";

export type KeyState = { error?: string; key?: string; name?: string } | undefined;

const A = schema.apiKeys;
const createSchema = z.object({
  name: z.string().trim().min(2, "Name the key, e.g. “Claude on my laptop”").max(60),
  scope: z.enum(["read", "write"]).default("read")
});

/** Anyone can make keys for themselves — a key can never do more than its owner. */
export async function createApiKey(_: KeyState, formData: FormData): Promise<KeyState> {
  const user = await requireUser();
  const p = createSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const live = await db
    .select({ id: A.id })
    .from(A)
    .where(and(eq(A.userId, user.id), isNull(A.revokedAt)));
  if (live.length >= 10) return { error: "You already have 10 keys — revoke one first" };
  const k = newKey();
  await db.insert(A).values({ workspaceId: user.workspaceId, userId: user.id, name: p.data.name, scope: p.data.scope, keyHash: k.keyHash, prefix: k.prefix });
  revalidatePath("/settings");
  return { key: k.key, name: p.data.name };
}

/** Your own keys; owners and admins can also revoke anyone's in the workspace. */
export async function revokeApiKey(id: number) {
  const user = await requireUser();
  const [key] = await db
    .select()
    .from(A)
    .where(and(eq(A.id, id), eq(A.workspaceId, user.workspaceId)))
    .limit(1);
  if (!key || (key.userId !== user.id && !can(user, "team"))) return;
  await db.update(A).set({ revokedAt: new Date() }).where(eq(A.id, id));
  revalidatePath("/settings");
}
