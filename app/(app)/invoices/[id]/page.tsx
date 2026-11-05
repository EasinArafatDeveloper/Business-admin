import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { ArrowLeft, Eye, Pencil } from "lucide-react";
import { db, schema } from "@/db";
import { requireAccess } from "@/lib/auth";
import { getBilling, invoiceUrl } from "@/lib/billing";
import { PAYMENT_METHODS, fmtDate, invoiceState, taka } from "@/lib/money";
import { timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui";
import { InvoiceBadge } from "@/components/billing/badges";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { CopyLink, DeletePaymentButton, InvoiceButtons, PaymentForm, PrintButton, ReviewButtons, SendForm } from "@/components/billing/forms";
import { pendingFor } from "@/lib/public-invoice";

export async function generateMetadata({ params }: PageProps<"/invoices/[id]">) {
  return { title: `Invoice #${(await params).id}` };
}

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const user = await requireAccess("invoices");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const I = schema.invoices;
  const [row] = await db
    .select({ inv: I, client: schema.clients })
    .from(I)
    .innerJoin(schema.clients, eq(schema.clients.id, I.clientId))
    .where(and(eq(I.id, id), eq(I.workspaceId, user.workspaceId)))
    .limit(1);
  if (!row) notFound();
  const { inv, client } = row;
  const [items, payments, { name, billing }, pending] = await Promise.all([
    db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, id)).orderBy(asc(schema.invoiceItems.position)),
    db.select().from(schema.payments).where(eq(schema.payments.invoiceId, id)).orderBy(desc(schema.payments.paidAt)),
    getBilling(user.workspaceId),
    pendingFor(id)
  ]);
  const state = invoiceState(inv);
  const due = Math.max(0, inv.total - inv.amountPaid);
  const locked = state === "paid" || state === "void";
  const url = invoiceUrl(inv.publicToken);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="print:hidden">
        <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Invoices
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-semibold tracking-tight">{inv.number}</h1>
              <InvoiceBadge state={state} />
            </div>
            <p className="mt-1 text-sm text-muted">
              <Link href={`/clients/${client.id}`} className="hover:text-accent-soft">
                {client.name}
              </Link>{" "}
              · {taka(inv.total)}
              {inv.sentAt && ` · sent ${timeAgo(inv.sentAt)}`}
              {inv.viewedAt && (
                <span className="text-success">
                  {" "}
                  · <Eye className="inline h-3.5 w-3.5" /> client opened it {timeAgo(inv.viewedAt)}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!locked && (
              <Link
                href={`/invoices/${id}/edit`}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-xs hover:border-accent/60"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            )}
            <InvoiceButtons id={id} status={inv.status} paid={state === "paid"} />
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <Card className="border-warning/40 p-5 print:hidden">
          <h2 className="text-sm font-semibold text-warning">Waiting for you ({pending.length})</h2>
          <ul className="mt-3 space-y-3">
            {pending.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-ink-alt p-3.5">
                {s.kind === "payment" ? (
                  <div className="flex gap-3">
                    <a href={`/api/admin/submissions/${s.id}/screenshot`} target="_blank" rel="noreferrer" className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/admin/submissions/${s.id}/screenshot`} alt="Payment screenshot" className="h-20 w-16 rounded-lg object-cover" />
                    </a>
                    <div className="text-sm">
                      <div className="font-semibold">
                        {taka(s.amount ?? 0)} by {PAYMENT_METHODS[s.method ?? ""] ?? s.method}
                      </div>
                      <div className="font-mono text-xs">TrxID {s.reference}</div>
                      <div className="mt-1 text-xs text-muted-2">
                        {[s.payerPhone, s.payerEmail].filter(Boolean).join(" · ")} · {timeAgo(s.createdAt)}
                      </div>
                      <div className="mt-1 text-xs text-warning">Check this TrxID in your bKash app before confirming.</div>
                      {(s.amount ?? 0) > due && (
                        <div className="mt-1 text-xs text-danger">
                          That&apos;s {taka((s.amount ?? 0) - due)} more than what&apos;s due now ({taka(due)}) — refund or credit the difference.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm">
                    <div className="font-semibold">Shared a post — wants {billing.shareDiscountPercent ?? 10}% off</div>
                    <a href={s.shareUrl ?? "#"} target="_blank" rel="noreferrer" className="break-all text-xs text-accent-soft hover:underline">
                      {s.shareUrl}
                    </a>
                    <div className="mt-1 text-xs text-muted-2">{timeAgo(s.createdAt)}</div>
                  </div>
                )}
                <ReviewButtons id={s.id} approveLabel={s.kind === "payment" ? "Confirm payment" : `Apply ${billing.shareDiscountPercent ?? 10}% off`} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <InvoiceDocument inv={inv} items={items} client={client} business={name} billing={billing} payments={payments} />

        <aside className="space-y-4 print:hidden lg:sticky lg:top-6 lg:h-fit">
          {state !== "void" && (
            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-medium">Send to client</h2>
              <SendForm invoiceId={id} channel="whatsapp" defaultTo={client.phone} />
              <SendForm invoiceId={id} channel="email" defaultTo={client.email} />
              {inv.status === "draft" ? (
                <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">The client link opens once you send it or press “Mark as sent”.</p>
              ) : (
                <CopyLink url={url} />
              )}
              <PrintButton />
              <p className="text-[11px] text-muted-2">The client gets a private link to view and download it. No login needed.</p>
            </Card>
          )}

          {!locked && (
            <Card className="p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-medium">Record payment</h2>
                <span className="text-xs text-muted-2">{taka(due)} due</span>
              </div>
              <PaymentForm invoiceId={id} due={due} />
            </Card>
          )}

          {payments.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-medium">Payments</h2>
              <ul className="mt-2 divide-y divide-line text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{taka(p.amount)}</span>
                      <span className="block text-xs text-muted-2">
                        {PAYMENT_METHODS[p.method] ?? p.method} · {fmtDate(p.paidAt)}
                        {p.reference && ` · ${p.reference}`}
                      </span>
                    </span>
                    <DeletePaymentButton id={p.id} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!billing.bkashNumber && !billing.bankDetails && !billing.paymentInfo && (
            <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
              Add your bKash / bank details in{" "}
              <Link href="/settings?tab=business" className="underline">
                Settings → Business
              </Link>{" "}
              so clients know how to pay.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
