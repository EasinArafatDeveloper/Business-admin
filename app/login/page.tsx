import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, isLocalRequest } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const raw = (await searchParams).next;
  const next = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : undefined;
  if (await getCurrentUser()) redirect(next ?? "/");
  // First run on this PC: no account yet → go create one.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
  if (count === 0 && (await isLocalRequest())) redirect("/setup");

  return (
    <AuthShell title="Sign in" subtitle="Private dashboard for ScaleUp Web.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
