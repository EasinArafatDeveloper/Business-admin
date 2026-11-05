import Link from "next/link";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Briefcase, Plus, Search } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { taka } from "@/lib/money";
import { cn, timeAgo } from "@/lib/utils";
import { Card, inputClass } from "@/components/ui";
import { ClientBadge } from "@/components/billing/badges";

export const metadata = { title: "Clients" };

const TABS = [
  ["all", "All clients"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["past", "Past"]
] as const;

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const user = await requireAccess("clients");
  const sp = await searchParams;
  const tab = TABS.find(([k]) => k === sp.status)?.[0] ?? "all";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const K = schema.clients;
  const I = schema.invoices;

  const conds: SQL[] = [eq(K.workspaceId, user.workspaceId)];
  if (tab !== "all") conds.push(eq(K.status, tab));
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(or(ilike(K.name, like), ilike(K.contactName, like), ilike(K.phone, like), ilike(K.email, like))!);
  }
  const billed = sql<number>`coalesce(sum(${I.total}) filter (where ${I.status} in ('sent','paid')), 0)::int`;
  const paid = sql<number>`coalesce(sum(${I.amountPaid}) filter (where ${I.status} <> 'void'), 0)::int`;
  const overdue = sql<number>`count(*) filter (where ${I.status} = 'sent' and ${I.dueDate} < now() and ${I.amountPaid} < ${I.total})::int`;

  const [rows, counts] = await Promise.all([
    db
      .select({ c: K, billed, paid, overdue, invoices: sql<number>`count(${I.id})::int` })
      .from(K)
      .leftJoin(I, eq(I.clientId, K.id))
      .where(and(...conds))
      .groupBy(K.id)
      .orderBy(desc(K.updatedAt))
      .limit(300),
    db.select({ status: K.status, n: sql<number>`count(*)::int` }).from(K).where(eq(K.workspaceId, user.workspaceId)).groupBy(K.status)
  ]);
  const count = (k: string) => counts.filter((c) => k === "all" || c.status === k).reduce((a, c) => a + c.n, 0);
  const href = (status: string) => {
    const p = new URLSearchParams();
    if (status !== "all") p.set("status", status);
    if (q) p.set("q", q);
    return `/clients${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted">Businesses you work for. Turn a lead into a client from its lead page.</p>
        </div>
        <Link href="/clients/new" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-[#5a83ff]">
          <Plus className="h-4 w-4" /> New client
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-6 lg:h-fit">
          <form action="/clients" className="relative">
            {tab !== "all" && <input type="hidden" name="status" value={tab} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
            <input name="q" defaultValue={q} placeholder="Search clients…" className={cn(inputClass, "pl-9")} />
          </form>
          <nav className="flex flex-wrap gap-1 lg:flex-col" aria-label="Client status">
            {TABS.map(([k, l]) => (
              <Link
                key={k}
                href={href(k)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm",
                  tab === k ? "bg-accent/15 text-fg" : "text-muted hover:bg-surface hover:text-fg"
                )}
              >
                {l}
                <span className="text-xs text-muted-2">{count(k)}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <section className="min-w-0">
          {rows.length === 0 ? (
            <Card className="px-6 py-16 text-center">
              <Briefcase className="mx-auto h-9 w-9 text-accent" />
              <p className="mt-4 font-medium">{q || tab !== "all" ? "No clients match" : "No clients yet"}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">Open a lead and press “Convert to client”, or add one by hand.</p>
              <Link href="/clients/new" className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-white">
                <Plus className="h-4 w-4" /> New client
              </Link>
            </Card>
          ) : (
            <div className="space-y-2">
              {rows.map(({ c, billed, paid, overdue, invoices }) => {
                const due = Math.max(0, billed - paid);
                return (
                  <Link key={c.id} href={`/clients/${c.id}`} className="block">
                    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 transition-colors hover:border-line-strong">
                      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-sm font-semibold text-accent-soft">
                          {c.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{c.name}</span>
                            <ClientBadge status={c.status} />
                          </div>
                          <div className="truncate text-xs text-muted-2">
                            {[c.contactName, c.phone, c.email].filter(Boolean).join(" · ") || `added ${timeAgo(c.createdAt)}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-6 text-right">
                        <Stat k="invoices" v={String(invoices)} />
                        <Stat k="billed" v={taka(billed)} />
                        <Stat k="due" v={taka(due)} tone={overdue ? "text-danger" : due ? "text-warning" : "text-success"} />
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <div className={cn("text-sm font-semibold", tone)}>{v}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-2">{k}</div>
    </div>
  );
}
