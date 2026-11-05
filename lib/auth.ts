import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { SESSION_COOKIE, decrypt } from "@/lib/session";
import { type AdminArea, type Permission, can, homeFor } from "@/lib/permissions";

/** The signed-in user for this request (null if none / expired / revoked). Cached per request. */
export const getCurrentUser = cache(async () => {
  const session = await decrypt((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.uid)).limit(1);
  if (!user || user.workspaceId !== session.wid || user.sessionVersion !== session.v || user.status !== "active") return null;
  return user;
});

/** Use at the top of every protected page / action. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Pages: signed in AND allowed to open this section — otherwise go to a section they can open.
 * Actions/APIs pass { throws: true } to stop with an error instead of a redirect.
 */
export async function requireAccess(what: Permission | AdminArea, opts: { throws?: boolean } = {}) {
  const user = await requireUser();
  if (!can(user, what)) {
    if (opts.throws) throw new Error("You don't have access to this");
    redirect(homeFor(user));
  }
  return user;
}

/** For server actions: same check, but fails with an error the form can show. */
export const requireAction = (what: Permission | AdminArea) => requireAccess(what, { throws: true });

/** For API routes: the user, or null when not signed in / not allowed. */
export async function apiUser(what: Permission | AdminArea) {
  const user = await getCurrentUser();
  return user && can(user, what) ? user : null;
}

/** First-run setup is only allowed from this PC (http://localhost:3007), never through the public domain. */
export async function isLocalRequest() {
  const host = ((await headers()).get("host") ?? "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

/** Client IP as seen through Cloudflare (for login rate limiting). */
export async function clientIp() {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
