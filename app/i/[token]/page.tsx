import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { Lock } from "lucide-react";
import { db, schema } from "@/db";
import { loadPublicInvoice } from "@/lib/public-invoice";
import { fmtDate, invoiceState, taka } from "@/lib/money";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { DetailsStep, PayStep, PrintInvoice, ShareOffer } from "@/components/billing/public-flow";

export async function generateMetadata({ params }: PageProps<"/i/[token]">) {
  const data = await loadPublicInvoice((await params).token);
  return {
    title: { absolute: data ? `Invoice ${data.inv.number} · ${data.business}` : "Invoice" },
    robots: { index: false, follow: false }
  };
}

export default async function PublicInvoicePage({ params }: PageProps<"/i/[token]">) {
  const { token } = await params;
  const data = await loadPublicInvoice(token);
  if (!data) notFound();
  const { inv, client, items, payments, business, billing, submissions } = data;

  // First time the client (not you, signed in to the admin) opens it.
  if (!inv.viewedAt && !(await cookies()).has("su_session")) {
    await db
      .update(schema.invoices)
      .set({ viewedAt: new Date() })
      .where(and(eq(schema.invoices.id, inv.id), isNull(schema.invoices.viewedAt)));
  }

  const state = invoiceState(inv);
  const due = Math.max(0, inv.total - inv.amountPaid);
  const pendingPay = submissions.find((s) => s.kind === "payment" && s.status === "pending");
  const share = submissions.find((s) => s.kind === "share" && s.status !== "rejected");
  const detailsDone = Boolean(client.name && client.contactName && client.email && client.phone);
  const percent = billing.shareDiscountPercent ?? 0;

  return (
    <div className="min-h-screen bg-[#f3f5fa] text-[#0f172a] [color-scheme:light] print:bg-white">
      <header className="border-b border-black/5 bg-white print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3b6bff]">
              <span className="h-2 w-2 rounded-full bg-white" />
            </span>
            <span className="font-semibold">{business}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#6b7280]">
            <Lock className="h-3.5 w-3.5" /> Private invoice link
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 print:max-w-none print:p-0">
        {/* Summary */}
        <section className="rounded-2xl bg-white p-5 shadow-sm print:hidden">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-sm text-[#6b7280]">
                Invoice <span className="font-mono">{inv.number}</span> for {client.name}
              </div>
              <div className="mt-1 text-4xl font-bold tracking-tight">{state === "paid" ? taka(inv.total) : taka(due)}</div>
              <div className="mt-1 text-sm text-[#6b7280]">
                {state === "paid"
                  ? `Paid in full${inv.paidAt ? ` on ${fmtDate(inv.paidAt)}` : ""} — thank you!`
                  : state === "void"
                    ? "This invoice was cancelled."
                    : `${inv.amountPaid > 0 ? `${taka(inv.amountPaid)} paid · ` : ""}${inv.dueDate ? `due ${fmtDate(inv.dueDate)}` : "amount due"}`}
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                state === "paid"
                  ? "bg-[#e3f5ee] text-[#12875f]"
                  : state === "overdue"
                    ? "bg-[#fde8ea] text-[#d23645]"
                    : state === "void"
                      ? "bg-[#f3f4f6] text-[#6b7280]"
                      : pendingPay
                        ? "bg-[#fff4dc] text-[#a86a12]"
                        : "bg-[#e8eeff] text-[#2a52d4]"
              }`}
            >
              {state === "paid" ? "✓ Paid" : state === "void" ? "Cancelled" : pendingPay ? "Payment being checked" : state === "overdue" ? "Overdue" : "Unpaid"}
            </span>
          </div>
          {payments.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-black/5 pt-3 text-sm text-[#374151]">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between">
                  <span>
                    {fmtDate(p.paidAt)} · {p.method === "bkash" ? "bKash" : p.method === "nagad" ? "Nagad" : p.method}
                  </span>
                  <span className="font-medium text-[#12875f]">{taka(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {state !== "paid" && state !== "void" && (
          <>
            <DetailsStep
              token={token}
              done={detailsDone}
              initial={{ businessName: client.name, name: client.contactName ?? "", email: client.email ?? "", phone: client.phone ?? "" }}
            />
            <PayStep
              token={token}
              due={due}
              enabled={detailsDone}
              defaultEmail={client.email ?? ""}
              defaultPhone={client.phone ?? ""}
              pending={pendingPay ? { amount: pendingPay.amount ?? 0, reference: pendingPay.reference ?? "" } : null}
              methods={{
                bkash: billing.bkashNumber ? { number: billing.bkashNumber, type: billing.bkashType ?? "personal" } : null,
                nagad: billing.nagadNumber ?? null,
                bank: billing.bankDetails ?? null
              }}
            />
          </>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between print:hidden">
            <h2 className="font-semibold">Your invoice</h2>
            <PrintInvoice />
          </div>
          <InvoiceDocument inv={inv} items={items} client={client} business={business} billing={billing} payments={payments} />
        </section>

        {percent > 0 && state !== "void" && (
          <ShareOffer token={token} percent={percent} sent={share ? { status: share.status, url: share.shareUrl ?? "" } : null} />
        )}

        <p className="pb-6 text-center text-xs text-[#9ca3af] print:hidden">
          Questions? {billing.phone && `Call ${billing.phone}`} {billing.email && `· ${billing.email}`}
        </p>
      </main>
    </div>
  );
}
