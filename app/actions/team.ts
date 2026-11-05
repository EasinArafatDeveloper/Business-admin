"use server";

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { hashToken as hash } from "@/lib/team";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAction } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { sendEmail } from "@/lib/email";
import { cleanPermissions, homeFor } from "@/lib/permissions";
import { findInvite } from "@/lib/team";

export type TeamState = { error?: string; ok?: string; link?: string } | undefined;

const U = schema.users;
const V = schema.invites;
const INVITE_DAYS = 7;

function adminOrigin() {
  const base = (process.env.LINK_BASE_URL ?? "https://admin.scaleupweb.xyz/go").replace(/\/go\/?$/, "");
  return new URL(base).origin;
}

/** Who may set which role: only the owner can make admins. */
function allowedRole(actorRole: string, role: string) {
  if (role === "member") return true;
  if (role === "admin") return actorRole === "owner";
  return false;
}

async function emailInvite(workspaceId: number, to: string, name: string | null, inviter: string, link: string) {
  const [sender] = await db
    .select()
    .from(schema.emailSenders)
    .where(eq(schema.emailSenders.workspaceId, workspaceId))
    .orderBy(asc(schema.emailSenders.id))
    .limit(1);
  const [ws] = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).limit(1);
  if (!sender) return false;
  const res = await sendEmail(sender, {
    to,
    subject: `${inviter} invited you to ${ws?.name ?? "the"} admin`,
    text: `Hi${name ? ` ${name}` : ""},\n\n${inviter} added you to the ${ws?.name ?? ""} admin dashboard.\n\nSet your password and sign in here (the link works for ${INVITE_DAYS} days):\n${link}\n\nIf you weren't expecting this, you can ignore this email.`
  });
  return res.ok;
}

async function newInviteToken() {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: hash(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) };
}

const inviteSchema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.email("Enter their email").transform((e) => e.trim().toLowerCase()),
  role: z.enum(["admin", "member"]).default("member")
});

export async function inviteMember(_: TeamState, formData: FormData): Promise<TeamState> {
  const me = await requireAction("team");
  const p = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { name, email, role } = p.data;
  if (!allowedRole(me.role, role)) return { error: "Only the owner can add admins" };
  const permissions = role === "member" ? cleanPermissions(formData.getAll("permissions")) : [];
  if (role === "member" && permissions.length === 0) return { error: "Tick at least one section they can open" };

  const [exists] = await db.select({ id: U.id }).from(U).where(eq(U.email, email)).limit(1);
  if (exists) return { error: "Someone with this email already has an account" };
  // A newer invite replaces an older pending one for the same email.
  await db.delete(V).where(and(eq(V.workspaceId, me.workspaceId), eq(V.email, email), isNull(V.acceptedAt)));

  const t = await newInviteToken();
  await db
    .insert(V)
    .values({ workspaceId: me.workspaceId, email, name: name || null, role, permissions, tokenHash: t.tokenHash, invitedBy: me.id, expiresAt: t.expiresAt });
  const link = `${adminOrigin()}/invite/${t.token}`;
  const sent = await emailInvite(me.workspaceId, email, name || null, me.name, link);
  revalidatePath("/settings");
  return { ok: sent ? `Invite emailed to ${email}` : "Invite created — copy the link and send it to them", link };
}

export async function resendInvite(id: number): Promise<TeamState> {
  const me = await requireAction("team");
  const [inv] = await db
    .select()
    .from(V)
    .where(and(eq(V.id, id), eq(V.workspaceId, me.workspaceId), isNull(V.acceptedAt)))
    .limit(1);
  if (!inv) return { error: "Invite not found" };
  const t = await newInviteToken();
  await db.update(V).set({ tokenHash: t.tokenHash, expiresAt: t.expiresAt }).where(eq(V.id, id));
  const link = `${adminOrigin()}/invite/${t.token}`;
  const sent = await emailInvite(me.workspaceId, inv.email, inv.name, me.name, link);
  revalidatePath("/settings");
  return { ok: sent ? "New invite emailed" : "New link ready — copy it", link };
}

export async function revokeInvite(id: number) {
  const me = await requireAction("team");
  await db.delete(V).where(and(eq(V.id, id), eq(V.workspaceId, me.workspaceId), isNull(V.acceptedAt)));
  revalidatePath("/settings");
}

/** The person being changed, if the signed-in owner/admin is allowed to change them. */
async function editable(id: number) {
  const me = await requireAction("team");
  const [u] = await db
    .select()
    .from(U)
    .where(and(eq(U.id, id), eq(U.workspaceId, me.workspaceId)))
    .limit(1);
  if (!u) return { error: "Not found" as const };
  if (u.id === me.id) return { error: "You can't change your own access" as const };
  if (u.role === "owner") return { error: "The owner can't be changed" as const };
  if (u.role === "admin" && me.role !== "owner") return { error: "Only the owner can change admins" as const };
  return { me, u };
}

export async function updateMember(id: number, _: TeamState, formData: FormData): Promise<TeamState> {
  const r = await editable(id);
  if ("error" in r) return { error: r.error };
  const role = formData.get("role") === "admin" ? "admin" : "member";
  if (!allowedRole(r.me.role, role)) return { error: "Only the owner can make admins" };
  const permissions = role === "member" ? cleanPermissions(formData.getAll("permissions")) : [];
  if (role === "member" && permissions.length === 0) return { error: "Tick at least one section" };
  await db.update(U).set({ role, permissions }).where(eq(U.id, id));
  revalidatePath("/settings");
  return { ok: "Access updated — it applies on their next click" };
}

export async function setMemberStatus(id: number, status: "active" | "disabled"): Promise<TeamState> {
  const r = await editable(id);
  if ("error" in r) return { error: r.error };
  // Turning someone off also ends every session they have open.
  await db
    .update(U)
    .set({ status, sessionVersion: status === "disabled" ? sql`${U.sessionVersion} + 1` : r.u.sessionVersion })
    .where(eq(U.id, id));
  revalidatePath("/settings");
  return { ok: status === "disabled" ? "Turned off — they've been signed out" : "Turned back on" };
}

export async function removeMember(id: number): Promise<TeamState> {
  const r = await editable(id);
  if ("error" in r) return { error: r.error };
  await db.delete(U).where(and(eq(U.id, id), ne(U.role, "owner")));
  revalidatePath("/settings");
  return { ok: "Removed" };
}

/* ---------------------------------------------------------------- accepting an invite */

const acceptSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  password: z.string().min(10, "Password must be at least 10 characters").max(200)
});

export async function acceptInvite(token: string, _: TeamState, formData: FormData): Promise<TeamState> {
  const found = await findInvite(token);
  if (!found) return { error: "This invite link has expired or was already used. Ask for a new one." };
  const p = acceptSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message };
  if (formData.get("password") !== formData.get("confirm")) return { error: "Passwords do not match" };
  const { inv } = found;
  const [exists] = await db.select({ id: U.id }).from(U).where(eq(U.email, inv.email)).limit(1);
  if (exists) return { error: "An account with this email already exists — sign in instead" };

  const [user] = await db
    .insert(U)
    .values({
      workspaceId: inv.workspaceId,
      name: p.data.name,
      email: inv.email,
      passwordHash: await bcrypt.hash(p.data.password, 12),
      role: inv.role === "admin" ? "admin" : "member",
      permissions: cleanPermissions(inv.permissions),
      invitedBy: inv.invitedBy,
      lastLoginAt: new Date()
    })
    .returning();
  await db.update(V).set({ acceptedAt: new Date() }).where(eq(V.id, inv.id));
  await createSession({ uid: user.id, wid: user.workspaceId, v: user.sessionVersion });
  redirect(homeFor(user));
}
