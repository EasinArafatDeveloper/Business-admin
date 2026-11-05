import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A usable invite for this link (not expired, not used yet), with the workspace name. */
export async function findInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [inv] = await db
    .select({ inv: schema.invites, workspace: schema.workspaces.name })
    .from(schema.invites)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.invites.workspaceId))
    .where(eq(schema.invites.tokenHash, hashToken(token)))
    .limit(1);
  if (!inv || inv.inv.acceptedAt || inv.inv.expiresAt < new Date()) return null;
  return inv;
}
