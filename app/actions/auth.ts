"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { createSession, deleteSession } from "@/lib/session";
import { clientIp, isLocalRequest, requireUser } from "@/lib/auth";
import { clearFailures, isBlocked, recordFailure } from "@/lib/rate-limit";

export type FormState = { error?: string; ok?: string } | undefined;

const BCRYPT_COST = 12;
/** Compared against when the email doesn't exist, so both cases take the same time. */
const DUMMY_HASH = bcrypt.hashSync("no-such-user", BCRYPT_COST);
const passwordRule = z.string().min(10, "Password must be at least 10 characters").max(200);

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const ip = await clientIp();
  if (isBlocked(ip)) return { error: "Too many wrong attempts. Try again in 15 minutes." };

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

  // Always run bcrypt so a wrong email and a wrong password take the same time.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    recordFailure(ip);
    return { error: "Wrong email or password." };
  }

  clearFailures(ip);
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  await createSession({ uid: user.id, wid: user.workspaceId, v: user.sessionVersion });
  redirect("/");
}

const setupSchema = z.object({
  workspace: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((e) => e.toLowerCase()),
  password: passwordRule
});

/** Creates the first workspace + owner. Only from localhost, and only while no user exists. */
export async function setup(_: FormState, formData: FormData): Promise<FormState> {
  if (!(await isLocalRequest())) return { error: "Setup is only available on http://localhost." };
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
  if (count > 0) return { error: "Setup is already done. Please sign in." };

  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  if (formData.get("password") !== formData.get("confirm")) return { error: "Passwords do not match." };

  const { workspace, name, email, password } = parsed.data;
  const user = await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({
        name: workspace,
        slug:
          workspace
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "main"
      })
      .returning();
    const [u] = await tx
      .insert(schema.users)
      .values({ workspaceId: ws.id, name, email, passwordHash: await bcrypt.hash(password, BCRYPT_COST), role: "owner" })
      .returning();
    return u;
  });

  await createSession({ uid: user.id, wid: user.workspaceId, v: user.sessionVersion });
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}

export async function changePassword(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = passwordRule.safeParse(String(formData.get("next") ?? ""));
  if (!next.success) return { error: next.error.issues[0]?.message };
  if (formData.get("next") !== formData.get("confirm")) return { error: "New passwords do not match." };
  if (!(await bcrypt.compare(current, user.passwordHash))) return { error: "Current password is wrong." };

  const version = user.sessionVersion + 1; // signs out every other device
  await db
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(next.data, BCRYPT_COST), sessionVersion: version })
    .where(eq(schema.users.id, user.id));
  await createSession({ uid: user.id, wid: user.workspaceId, v: version });
  return { ok: "Password changed. Other devices were signed out." };
}

export async function signOutEverywhere() {
  const user = await requireUser();
  await db
    .update(schema.users)
    .set({ sessionVersion: user.sessionVersion + 1 })
    .where(eq(schema.users.id, user.id));
  await deleteSession();
  redirect("/login");
}
