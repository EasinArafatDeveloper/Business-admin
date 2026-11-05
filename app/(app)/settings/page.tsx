import Link from "next/link";
import { KeyRound, MonitorSmartphone, UserRound, type LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { signOutEverywhere } from "@/app/actions/auth";
import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/ui";
import { ChangePasswordForm } from "@/components/settings-forms";

export const metadata = { title: "Settings" };

const TABS: { key: string; label: string; desc: string; icon: LucideIcon }[] = [
  { key: "account", label: "Account", desc: "Your name and email", icon: UserRound },
  { key: "password", label: "Password", desc: "Change your password", icon: KeyRound },
  { key: "devices", label: "Devices", desc: "Sign out everywhere", icon: MonitorSmartphone }
];

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Your account and sign-in security.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="grid grid-cols-3 gap-2 lg:sticky lg:top-6 lg:flex lg:h-fit lg:flex-col" aria-label="Settings">
          {TABS.map((t) => {
            const active = t.key === tab.key;
            return (
              <Link
                key={t.key}
                href={`/settings?tab=${t.key}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors lg:flex-row lg:gap-3 lg:text-left",
                  active ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface hover:border-line-strong"
                )}
              >
                <span
                  className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", active ? "bg-accent/15 text-accent-soft" : "bg-surface-2 text-muted")}
                >
                  <t.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="hidden text-xs text-muted-2 lg:block">{t.desc}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <section className="min-w-0 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{tab.label}</h2>
            <p className="text-xs text-muted">{tab.desc}</p>
          </div>

          {tab.key === "account" && (
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-lg font-semibold text-white">{initials}</span>
                <div className="min-w-0">
                  <div className="font-semibold">{user.name}</div>
                  <div className="truncate text-sm text-muted">{user.email}</div>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-line pt-5 text-sm sm:grid-cols-2">
                <Field k="Role" v={<span className="capitalize">{user.role}</span>} />
                <Field
                  k="Last sign-in"
                  v={user.lastLoginAt ? user.lastLoginAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }) : "—"}
                />
              </dl>
            </Card>
          )}

          {tab.key === "password" && (
            <Card className="p-5">
              <p className="mb-4 text-sm text-muted">Use at least 10 characters. Changing it signs you out on every other device.</p>
              <ChangePasswordForm />
            </Card>
          )}

          {tab.key === "devices" && (
            <Card className="p-5">
              <p className="text-sm text-muted">
                Signed in on someone else&apos;s computer or phone, or lost a device? This signs you out everywhere, including here.
              </p>
              <form action={signOutEverywhere} className="mt-4">
                <Button variant="danger">Sign out of all devices</Button>
              </form>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-ink-alt px-3.5 py-2.5">
      <dt className="text-xs text-muted-2">{k}</dt>
      <dd className="mt-0.5">{v}</dd>
    </div>
  );
}
