import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { isLocalRequest } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { SetupForm } from "@/components/auth-forms";

export const metadata = { title: "First-time setup" };

/** Only reachable from this PC (localhost) and only before the first account exists. */
export default async function SetupPage() {
  if (!(await isLocalRequest())) notFound();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
  if (count > 0) redirect("/login");

  return (
    <AuthShell title="Create your account" subtitle="One-time setup. You'll sign in with this email and password.">
      <SetupForm />
    </AuthShell>
  );
}
