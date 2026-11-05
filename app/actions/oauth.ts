"use server";

import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { adminOrigin, issueCode, sha256 } from "@/lib/oauth";
import { checkAuthorize } from "@/lib/oauth-request";
import { randomBytes } from "node:crypto";

const params = (fd: FormData) =>
  Object.fromEntries(
    ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type", "resource"].map((k) => [
      k,
      String(fd.get(k) ?? "") || undefined
    ])
  );

/** You pressed "Allow": the app gets a one-time code (then tokens) acting as you, with the access you chose. */
export async function approveConnection(formData: FormData) {
  const user = await requireUser();
  const check = await checkAuthorize({ ...params(formData), scope: String(formData.get("scope") ?? "read") });
  if ("fatal" in check) throw new Error(check.fatal);
  if ("redirectTo" in check) redirect(check.redirectTo!);
  const { client, params: p } = check;
  const scope = formData.get("scope") === "write" ? "write" : "read";

  // The grant shows up next to API keys and can be revoked the same way. Its "key" can't be used as a bearer.
  // Reconnecting the same app updates its existing grant instead of adding another row.
  const A = schema.apiKeys;
  const [existing] = await db
    .select({ id: A.id })
    .from(A)
    .where(and(eq(A.userId, user.id), eq(A.oauthClientId, client.id), eq(A.kind, "oauth"), isNull(A.revokedAt)))
    .limit(1);
  const [grant] = existing
    ? await db.update(A).set({ scope }).where(eq(A.id, existing.id)).returning({ id: A.id })
    : await db
        .insert(A)
        .values({
          workspaceId: user.workspaceId,
          userId: user.id,
          name: client.name,
          prefix: "app",
          keyHash: sha256(`oauth-grant:${randomBytes(24).toString("hex")}`),
          scope,
          kind: "oauth",
          oauthClientId: client.id
        })
        .returning({ id: A.id });
  const code = await issueCode({ clientId: client.id, grantId: grant.id, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge });

  const back = new URL(p.redirect_uri);
  back.searchParams.set("code", code);
  if (p.state) back.searchParams.set("state", p.state);
  back.searchParams.set("iss", adminOrigin());
  redirect(back.toString());
}

export async function denyConnection(formData: FormData) {
  await requireUser();
  const check = await checkAuthorize(params(formData));
  if ("fatal" in check) throw new Error(check.fatal);
  if ("redirectTo" in check) redirect(check.redirectTo!);
  const back = new URL(check.params.redirect_uri);
  back.searchParams.set("error", "access_denied");
  if (check.params.state) back.searchParams.set("state", check.params.state);
  redirect(back.toString());
}
