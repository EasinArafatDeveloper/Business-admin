import Link from "next/link";
import { Bot, Building2, KeyRound, MonitorSmartphone, UserRound, Users, type LucideIcon } from "lucide-react";
import { CreateKey, RevokeKey } from "@/components/ai/ai-access";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { PERMISSIONS, ROLES, can } from "@/lib/permissions";
import { timeAgo } from "@/lib/utils";
import { InviteActions, InviteForm, MemberActions, MemberEditor } from "@/components/team/team-forms";
import { requireUser } from "@/lib/auth";
import { signOutEverywhere } from "@/app/actions/auth";
import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/ui";
import { ChangePasswordForm } from "@/components/settings-forms";
import { BillingForm } from "@/components/billing/forms";
import { getBilling } from "@/lib/billing";

export const metadata = { title: "Settings" };

const ALL_TABS: { key: string; label: string; desc: string; icon: LucideIcon; admin?: boolean }[] = [
  { key: "account", label: "Account", desc: "Your name and email", icon: UserRound },
  { key: "team", label: "Team", desc: "Invite people, set access", icon: Users, admin: true },
  { key: "ai", label: "AI access", desc: "Connect Claude, Cursor…", icon: Bot },
  { key: "business", label: "Business & invoices", desc: "Invoice details, bKash", icon: Building2, admin: true },
  { key: "password", label: "Password", desc: "Change your password", icon: KeyRound },
  { key: "devices", label: "Devices", desc: "Sign out everywhere", icon: MonitorSmartphone }
];

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = can(user, "team");
  const TABS = ALL_TABS.filter((t) => !t.admin || isAdmin);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const billing = await getBilling(user.workspaceId);
  const U = schema.users;
  const V = schema.invites;
  const [members, invites] =
    tab.key === "team"
      ? await Promise.all([
          db.select().from(U).where(eq(U.workspaceId, user.workspaceId)).orderBy(asc(U.id)),
          db
            .select()
            .from(V)
            .where(and(eq(V.workspaceId, user.workspaceId), isNull(V.acceptedAt)))
            .orderBy(desc(V.createdAt))
        ])
      : [[], []];
  const AK = schema.apiKeys;
  const AA = schema.aiActions;
  const [keys, actions] =
    tab.key === "ai"
      ? await Promise.all([
          db
            .select({ k: AK, owner: U.name })
            .from(AK)
            .innerJoin(U, eq(U.id, AK.userId))
            .where(and(eq(AK.workspaceId, user.workspaceId), isNull(AK.revokedAt), isAdmin ? undefined : eq(AK.userId, user.id)))
            .orderBy(desc(AK.createdAt)),
          db
            .select({ a: AA, who: U.name })
            .from(AA)
            .leftJoin(U, eq(U.id, AA.userId))
            .where(and(eq(AA.workspaceId, user.workspaceId), isAdmin ? undefined : eq(AA.userId, user.id)))
            .orderBy(desc(AA.createdAt))
            .limit(30)
        ])
      : [[], []];
  const endpoint = `${new URL((process.env.LINK_BASE_URL ?? "https://admin.scaleupweb.xyz/go").replace(/\/go\/?$/, "")).origin}/api/mcp`;
  const label = (keys: string[]) =>
    PERMISSIONS.filter((p) => keys.includes(p.key))
      .map((p) => p.label)
      .join(", ") || "Nothing yet";
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
        <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:sticky lg:top-6 lg:flex lg:h-fit lg:flex-col" aria-label="Settings">
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
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-accent/15 text-accent-soft" : "bg-surface-2 text-muted"
                  )}
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

          {tab.key === "team" && (
            <div className="space-y-4">
              <InviteForm canMakeAdmin={user.role === "owner"} />

              {invites.length > 0 && (
                <Card className="divide-y divide-line">
                  <div className="px-5 py-3 text-sm font-medium">Waiting to join ({invites.length})</div>
                  {invites.map((i) => (
                    <div key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <div className="font-medium">{i.name || i.email}</div>
                        <div className="text-xs text-muted-2">
                          {i.email} · {ROLES[i.role as keyof typeof ROLES]?.label ?? i.role} · invited {timeAgo(i.createdAt)}
                          {i.expiresAt < new Date() && <span className="text-danger"> · link expired</span>}
                        </div>
                        {i.role === "member" && <div className="mt-1 text-xs text-muted">Access: {label(i.permissions)}</div>}
                      </div>
                      <InviteActions id={i.id} />
                    </div>
                  ))}
                </Card>
              )}

              <Card className="divide-y divide-line">
                <div className="px-5 py-3 text-sm font-medium">Team ({members.length})</div>
                {members.map((m) => {
                  const editable = m.id !== user.id && m.role !== "owner" && (m.role === "member" || user.role === "owner");
                  return (
                    <details key={m.id} className="group px-5 py-4">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent-soft">
                            {m.name
                              .split(" ")
                              .map((w) => w[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {m.name} {m.id === user.id && <span className="text-xs font-normal text-muted-2">(you)</span>}
                            </span>
                            <span className="block truncate text-xs text-muted-2">
                              {m.email} · last sign-in {m.lastLoginAt ? timeAgo(m.lastLoginAt) : "never"}
                            </span>
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {m.status !== "active" && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] text-danger">Turned off</span>}
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                            {ROLES[m.role as keyof typeof ROLES]?.label ?? m.role}
                          </span>
                          {editable && <span className="text-xs text-accent-soft group-open:hidden">Edit</span>}
                        </span>
                      </summary>
                      <div className="mt-2 pl-12 text-xs text-muted">{m.role === "member" ? `Access: ${label(m.permissions)}` : "Access: everything"}</div>
                      {editable && (
                        <div className="mt-4 space-y-4 pl-12">
                          <MemberEditor id={m.id} role={m.role} permissions={m.permissions} canMakeAdmin={user.role === "owner"} />
                          <MemberActions id={m.id} status={m.status} name={m.name} />
                        </div>
                      )}
                    </details>
                  );
                })}
              </Card>
            </div>
          )}

          {tab.key === "ai" && (
            <div className="space-y-4">
              <Card className="p-5 text-sm text-muted">
                Let an AI assistant (Claude, Cursor…) work with this admin: ask “which leads replied today?”, “draft a WhatsApp campaign for Hot fashion leads”,
                or “make an invoice for Sign of Modesty”. A key can only do what <b className="text-fg">you</b> can do. AI never sends campaigns or messages —
                it makes drafts you review and send. Everything it does is logged below.
              </Card>
              <CreateKey endpoint={endpoint} />

              <Card className="divide-y divide-line">
                <div className="px-5 py-3 text-sm font-medium">Active keys ({keys.length})</div>
                {keys.length === 0 && <p className="px-5 py-6 text-sm text-muted-2">No keys yet.</p>}
                {keys.map(({ k, owner }) => (
                  <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {k.name}{" "}
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${k.scope === "write" ? "bg-warning/15 text-warning" : "bg-surface-2 text-muted"}`}
                        >
                          {k.scope === "write" ? "read + drafts" : "read only"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-2">
                        <code>{k.prefix}…</code>
                        {isAdmin && ` · ${owner}`} · created {timeAgo(k.createdAt)} · {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : "never used"}
                      </div>
                    </div>
                    <RevokeKey id={k.id} name={k.name} />
                  </div>
                ))}
              </Card>

              <Card>
                <div className="border-b border-line px-5 py-3 text-sm font-medium">What the AI did (latest 30)</div>
                {actions.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-2">Nothing yet.</p>
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {actions.map(({ a, who }) => (
                      <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-2.5">
                        <span className="min-w-0">
                          <span className={`font-mono text-xs ${a.ok ? "text-accent-soft" : "text-danger"}`}>{a.tool}</span>
                          <span className="ml-2 text-xs text-muted-2">{JSON.stringify(a.input).slice(0, 120)}</span>
                        </span>
                        <span className="text-xs text-muted-2">
                          {isAdmin && who ? `${who} · ` : ""}
                          {timeAgo(a.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}

          {tab.key === "business" && (
            <Card className="p-5">
              <p className="mb-4 text-sm text-muted">Printed on every invoice and shown on the payment link you send clients.</p>
              <BillingForm initial={billing.billing} workspaceName={billing.name} />
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
