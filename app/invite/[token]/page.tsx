import Link from "next/link";
import { findInvite } from "@/lib/team";
import { PERMISSIONS } from "@/lib/permissions";
import { AuthShell } from "@/components/auth-shell";
import { AcceptInviteForm } from "@/components/team/team-forms";

export const metadata = { title: "Join the team", robots: { index: false, follow: false } };

/** Where an invited person lands: set a name + password, then they're in. */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const found = await findInvite(token);
  if (!found)
    return (
      <AuthShell title="Invite link expired" subtitle="This link was already used or is more than 7 days old.">
        <p className="text-sm text-muted">Ask the person who invited you to send a new invite.</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-accent-soft hover:underline">
          Go to sign in
        </Link>
      </AuthShell>
    );
  const { inv, workspace } = found;
  const sections =
    inv.role === "admin"
      ? "everything"
      : PERMISSIONS.filter((p) => inv.permissions.includes(p.key))
          .map((p) => p.label)
          .join(", ");
  return (
    <AuthShell title={`Join ${workspace}`} subtitle={`You're signing in as ${inv.email}. You'll have access to: ${sections}.`}>
      <AcceptInviteForm token={token} name={inv.name} />
    </AuthShell>
  );
}
