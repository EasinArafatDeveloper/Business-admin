import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { FileText, Plus } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { type InvoiceState, fmtDate, invoiceState, taka } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui";
import { InvoiceBadge } from "@/components/billing/badges";

export const metadata = { title: "Invoices" };

const TABS: { key: string; label: string; states: InvoiceState[] | null }[] = [
  { key: "all", label: "All invoices", states: null },
  { key: "unpaid", label: "Unpaid", states: ["sent", "partial", "overdue"] },
  { key: "overdue", label: "Overdue", states: ["overdue"] },
  { key: "draft", label: "Drafts", states: ["draft"] },
  { key: "paid", label: "Paid", states: ["paid"] },
  { key: "void", label: "Void", states: ["void"] }
];

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const user = await requireAccess("invoices");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const I = schema.invoices;
  const K = schema.clients;

  const all = (
    await db
      .select({ inv: I, client: K.name })
      .from(I)
      .innerJoin(K, eq(K.id, I.clientId))
      .where(eq(I.workspaceId, user.workspaceId))
      .orderBy(desc(I.issueDate), desc(I.id))
      .limit(1000)
  ).map((r) => ({ ...r, state: invoiceState(r.inv) }));

  const rows = tab.states ? all.filter((r) => tab.states!.includes(r.state)) : all;
  const count = (t: (typeof TABS)[number]) => (t.states ? all.filter((r) => t.states!.includes(r.state)).length : all.length);
  const due = (states: InvoiceState[]) => all.filter((r) => states.includes(r.state)).reduce((a, r) => a + r.inv.total - r.inv.amountPaid, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  // Money received this month, from recorded payments.
  const P = schema.payments;
  const [{ received }] = await db
    .select({ received: sql<number>`coalesce(sum(${P.amount}), 0)::int` })
    .from(P)
    .where(and(eq(P.workspaceId, user.workspaceId), gte(P.paidAt, monthStart)));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted">Bill clients, send a link they can pay from, and record bKash / bank payments.</p>
        </div>
        <Link href="/invoices/new" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-[#5a83ff]">
          <Plus className="h-4 w-4" /> New invoice
        </Link>
      </div>

      <Card className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
        <Kpi k="Outstanding" v={taka(due(["sent", "partial", "overdue"]))} tone="text-warning" />
        <Kpi k="Overdue" v={taka(due(["overdue"]))} tone={due(["overdue"]) > 0 ? "text-danger" : undefined} />
        <Kpi k="Received this month" v={taka(received)} tone="text-success" />
        <Kpi k="Drafts" v={String(count(TABS[3]))} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="flex flex-wrap gap-1 lg:sticky lg:top-6 lg:h-fit lg:flex-col" aria-label="Invoice filter">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "all" ? "/invoices" : `/invoices?tab=${t.key}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm",
                tab.key === t.key ? "bg-accent/15 text-fg" : "text-muted hover:bg-surface hover:text-fg"
              )}
            >
              {t.label}
              <span className={cn("text-xs", t.key === "overdue" && count(t) > 0 ? "text-danger" : "text-muted-2")}>{count(t)}</span>
            </Link>
          ))}
        </nav>

        <section className="min-w-0">
          {rows.length === 0 ? (
            <Card className="px-6 py-16 text-center">
              <FileText className="mx-auto h-9 w-9 text-accent" />
              <p className="mt-4 font-medium">{all.length === 0 ? "No invoices yet" : "Nothing here"}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">Pick a client, add what you&apos;re charging for, then send them the link by email or WhatsApp.</p>
              <Link href="/invoices/new" className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-white">
                <Plus className="h-4 w-4" /> New invoice
              </Link>
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {rows.map(({ inv, client, state }) => (
                <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5 transition-colors hover:bg-ink-alt/60">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{client}</span>
                      <InvoiceBadge state={state} />
                    </div>
                    <div className="text-xs text-muted-2">
                      <span className="font-mono">{inv.number}</span> · {fmtDate(inv.issueDate)}
                      {inv.dueDate && state !== "paid" && state !== "void" && (
                        <span className={cn(state === "overdue" && "text-danger")}> · due {fmtDate(inv.dueDate)}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{taka(inv.total)}</div>
                    {inv.amountPaid > 0 && state !== "paid" && <div className="text-[11px] text-muted-2">{taka(inv.total - inv.amountPaid)} left</div>}
                  </div>
                </Link>
              ))}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="p-4">
      <div className="text-xs text-muted">{k}</div>
      <div className={cn("mt-1 text-xl font-semibold tracking-tight", tone)}>{v}</div>
    </div>
  );
}
