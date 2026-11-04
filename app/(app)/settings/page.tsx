import { requireUser } from "@/lib/auth";
import { signOutEverywhere } from "@/app/actions/auth";
import { Button, Card } from "@/components/ui";
import { ChangePasswordForm } from "@/components/settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card className="p-5">
        <h2 className="text-sm font-medium">Account</h2>
        <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Name</dt>
          <dd>{user.name}</dd>
          <dt className="text-muted">Email</dt>
          <dd>{user.email}</dd>
          <dt className="text-muted">Role</dt>
          <dd className="capitalize">{user.role}</dd>
          <dt className="text-muted">Last sign-in</dt>
          <dd>{user.lastLoginAt ? user.lastLoginAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd>
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-medium">Change password</h2>
        <ChangePasswordForm />
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-medium">Sign out everywhere</h2>
        <p className="mt-1 text-sm text-muted">Use this if you signed in on someone else&apos;s computer or phone.</p>
        <form action={signOutEverywhere} className="mt-4">
          <Button variant="danger">Sign out of all devices</Button>
        </form>
      </Card>
    </div>
  );
}
