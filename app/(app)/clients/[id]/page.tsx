import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, FileText, Mail, MessageCircle, Phone, Plus } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, invoiceState, taka } from "@/lib/money";
import { cn, digitsOnly } from "@/lib/utils";
import { Card } from "@/components/ui";
import { ClientBadge, InvoiceBadge } from "@/components/billing/badges";
import { ClientForm } from "@/components/billing/forms";

export async function generateMetadata({ params }: PageProps<"/clients/[id]">) {
  return { title: `Client #${(await params).id}` };
}

export default async function ClientPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const editing = (await searchParams).edit === "1";
  const K = schema.clients;
  const I = schema.invoices;
  const [c] = await db
    .select()
    .from(K)
    .where(and(eq(K.id, id), eq(K.workspaceId, user.workspaceId)))
    .limit(1);
  if (!c) notFound();
  const invoices = await db.select().from(I).where(eq(I.clientId, id)).orderBy(desc(I.issueDate), desc(I.id));

  const live = invoices.filter((i) => i.status !== "void" && i.status !== "draft");
  const billed = live.reduce((a, i) => a + i.total, 0);
  const paid = live.reduce((a, i) => a + i.amountPaid, 0);
  const overdue = live.filter((i) => invoiceState(i) === "overdue").reduce((a, i) => a + i.total - i.amountPaid, 0);
  const wa = digitsOnly(c.phone);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Clients
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-lg font-semibold text-accent-soft">
            {c.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
              <ClientBadge status={c.status} />
            </div>
            <p className="text-sm text-muted">
              {c.contactName ?? "No contact person"}
              {c.leadId && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/leads/${c.leadId}`} className="text-accent-soft hover:underline">
                    from lead
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/clients/${c.id}${editing ? "" : "?edit=1"}`}
            className="inline-flex h-9 items-center rounded-xl border border-line-strong px-3 text-sm hover:border-accent/60"
          >
            {editing ? "Done editing" : "Edit"}
          </Link>
          <Link href={`/invoices/new?client=${c.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-white">
            <Plus className="h-4 w-4" /> New invoice
          </Link>
        </div>
      </div>

      <Card className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
        <Kpi k="Billed" v={taka(billed)} />
        <Kpi k="Paid" v={taka(paid)} tone="text-success" />
        <Kpi k="Outstanding" v={taka(billed - paid)} tone={billed - paid > 0 ? "text-warning" : undefined} />
        <Kpi k="Overdue" v={taka(overdue)} tone={overdue > 0 ? "text-danger" : undefined} />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {editing && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-medium">Edit client</h2>
              <ClientForm id={c.id} initial={c} />
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-sm font-medium">Invoices</h2>
              <span className="text-xs text-muted-2">{invoices.length}</span>
            </div>
            {invoices.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted">
                <FileText className="mx-auto mb-3 h-7 w-7 text-muted-2" />
                No invoices yet.{" "}
                <Link href={`/invoices/new?client=${c.id}`} className="text-accent-soft hover:underline">
                  Create the first one
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {invoices.map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-ink-alt/60">
                      <span>
                        <span className="font-mono text-sm">{i.number}</span>
                        <span className="ml-2 text-xs text-muted-2">
                          {fmtDate(i.issueDate)}
                          {i.dueDate && ` · due ${fmtDate(i.dueDate)}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-sm font-medium">{taka(i.total)}</span>
                        <InvoiceBadge state={invoiceState(i)} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-5 text-sm">
            <h2 className="font-medium">Contact</h2>
            {c.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-2" />
                <a href={`tel:${c.phone}`} className="hover:text-accent-soft">
                  {c.phone}
                </a>
                {wa && (
                  <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="ml-auto text-wa" aria-label="WhatsApp">
                    <MessageCircle className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
            {c.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-2" />
                <a href={`mailto:${c.email}`} className="truncate hover:text-accent-soft">
                  {c.email}
                </a>
              </div>
            )}
            {c.address && <p className="text-muted">{c.address}</p>}
            {c.website && (
              <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer" className="block truncate text-accent-soft hover:underline">
                {c.website}
              </a>
            )}
            {!c.phone && !c.email && !c.address && <p className="text-muted-2">No contact details yet.</p>}
          </Card>
          {c.notes && (
            <Card className="p-5 text-sm">
              <h2 className="font-medium">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-muted">{c.notes}</p>
            </Card>
          )}
        </div>
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
