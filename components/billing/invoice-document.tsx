import type { BillingProfile, Client, Invoice, InvoiceItem, Payment } from "@/db/schema";
import { INVOICE_STATES, PAYMENT_METHODS, fmtDate, invoiceState, taka } from "@/lib/money";

/**
 * The invoice as the client sees it — a white "paper" in any theme, and print-ready
 * (the browser's "Save as PDF" gives a clean A4 PDF).
 */
export function InvoiceDocument({
  inv,
  items,
  client,
  business,
  billing,
  payments = []
}: {
  inv: Invoice;
  items: InvoiceItem[];
  client: Client;
  business: string;
  billing: BillingProfile;
  payments?: Payment[];
}) {
  const state = invoiceState(inv);
  const due = Math.max(0, inv.total - inv.amountPaid);
  const stamp = state === "paid" ? "PAID" : state === "void" ? "VOID" : state === "overdue" ? "OVERDUE" : null;
  const bkashHow = billing.bkashType === "merchant" ? "Payment" : billing.bkashType === "agent" ? "Cash Out" : "Send Money";
  const howToPay = [
    billing.bkashNumber && `bKash (${billing.bkashType ?? "personal"}, ${bkashHow}): ${billing.bkashNumber}`,
    billing.nagadNumber && `Nagad (Send Money): ${billing.nagadNumber}`,
    billing.bankDetails && `Bank:\n${billing.bankDetails}`,
    billing.paymentInfo
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <article className="invoice-paper relative overflow-hidden rounded-2xl bg-white p-6 text-[13px] leading-relaxed text-[#1f2937] shadow-sm sm:p-10 print:rounded-none print:p-0 print:shadow-none">
      {stamp && (
        <div
          className={`pointer-events-none absolute right-6 top-44 rotate-[-12deg] rounded-lg border-4 px-4 py-1 text-2xl font-black tracking-widest opacity-25 sm:right-10 ${
            stamp === "PAID" ? "border-[#12875f] text-[#12875f]" : stamp === "VOID" ? "border-[#6b7280] text-[#6b7280]" : "border-[#d23645] text-[#d23645]"
          }`}
        >
          {stamp}
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e5e7eb] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3b6bff]">
              <span className="h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <span className="text-lg font-bold text-[#0f172a]">{billing.legalName || business}</span>
          </div>
          <div className="mt-2 whitespace-pre-line text-[12px] text-[#6b7280]">
            {[billing.address, billing.phone, billing.email, billing.website].filter(Boolean).join("\n")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tracking-tight text-[#0f172a]">INVOICE</div>
          <div className="mt-1 font-mono text-[12px] text-[#6b7280]">{inv.number}</div>
          <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium print:hidden ${pill(state)}`}>
            {INVOICE_STATES[state].label}
          </span>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 py-6 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af]">Bill to</div>
          <div className="mt-1 font-semibold text-[#0f172a]">{client.name}</div>
          <div className="whitespace-pre-line text-[12px] text-[#6b7280]">
            {[client.contactName, client.address, client.phone, client.email].filter(Boolean).join("\n")}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-y-1 text-[12px] sm:justify-self-end">
          <dt className="text-[#9ca3af]">Issue date</dt>
          <dd className="text-right font-medium">{fmtDate(inv.issueDate)}</dd>
          <dt className="text-[#9ca3af]">Due date</dt>
          <dd className="text-right font-medium">{fmtDate(inv.dueDate)}</dd>
          <dt className="text-[#9ca3af]">Amount due</dt>
          <dd className="text-right text-base font-bold text-[#0f172a]">{taka(due)}</dd>
        </dl>
      </section>

      <table className="w-full text-left">
        <thead>
          <tr className="border-y border-[#e5e7eb] text-[11px] uppercase tracking-wider text-[#9ca3af]">
            <th className="py-2 pr-2 font-semibold">Description</th>
            <th className="w-14 py-2 text-right font-semibold">Qty</th>
            <th className="w-28 py-2 text-right font-semibold">Price</th>
            <th className="w-28 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-[#f3f4f6] align-top">
              <td className="whitespace-pre-line py-2.5 pr-2">{it.description}</td>
              <td className="py-2.5 text-right">{it.quantity}</td>
              <td className="py-2.5 text-right">{taka(it.unitPrice)}</td>
              <td className="py-2.5 text-right font-medium">{taka(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <dl className="grid w-full max-w-xs grid-cols-2 gap-y-1.5">
          <dt className="text-[#6b7280]">Subtotal</dt>
          <dd className="text-right">{taka(inv.subtotal)}</dd>
          {inv.discount > 0 && (
            <>
              <dt className="text-[#6b7280]">Discount</dt>
              <dd className="text-right">−{taka(inv.discount)}</dd>
            </>
          )}
          <dt className="border-t border-[#e5e7eb] pt-1.5 font-semibold">Total</dt>
          <dd className="border-t border-[#e5e7eb] pt-1.5 text-right font-semibold">{taka(inv.total)}</dd>
          {inv.amountPaid > 0 && (
            <>
              <dt className="text-[#12875f]">Paid</dt>
              <dd className="text-right text-[#12875f]">−{taka(inv.amountPaid)}</dd>
            </>
          )}
          <dt className="rounded-l-lg bg-[#f3f5fa] py-2 pl-3 font-bold text-[#0f172a]">Amount due</dt>
          <dd className="rounded-r-lg bg-[#f3f5fa] py-2 pr-3 text-right text-base font-bold text-[#0f172a]">{taka(due)}</dd>
        </dl>
      </section>

      {payments.length > 0 && (
        <section className="mt-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af]">Payments received</div>
          <ul className="mt-1 text-[12px] text-[#6b7280]">
            {payments.map((p) => (
              <li key={p.id}>
                {fmtDate(p.paidAt)} · {PAYMENT_METHODS[p.method] ?? p.method}
                {p.reference ? ` (${p.reference})` : ""} · <span className="font-medium text-[#1f2937]">{taka(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {((howToPay && due > 0) || inv.notes || inv.terms) && (
        <section className="mt-8 grid grid-cols-1 gap-6 border-t border-[#e5e7eb] pt-6 sm:grid-cols-2">
          {howToPay && due > 0 && state !== "void" && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af]">How to pay</div>
              <p className="mt-1 whitespace-pre-line">{howToPay}</p>
              <p className="mt-1 text-[12px] text-[#6b7280]">Please use {inv.number} as the reference.</p>
            </div>
          )}
          {(inv.notes || inv.terms) && (
            <div>
              {inv.notes && (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af]">Notes</div>
                  <p className="mt-1 whitespace-pre-line">{inv.notes}</p>
                </>
              )}
              {inv.terms && (
                <>
                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af]">Terms</div>
                  <p className="mt-1 whitespace-pre-line text-[12px] text-[#6b7280]">{inv.terms}</p>
                </>
              )}
            </div>
          )}
        </section>
      )}

      <footer className="mt-10 text-center text-[11px] text-[#9ca3af]">Thank you for your business.</footer>
    </article>
  );
}

function pill(state: string) {
  return (
    {
      draft: "bg-[#f3f4f6] text-[#6b7280]",
      sent: "bg-[#e8eeff] text-[#2a52d4]",
      partial: "bg-[#f1ecff] text-[#6d4ed8]",
      overdue: "bg-[#fde8ea] text-[#d23645]",
      paid: "bg-[#e3f5ee] text-[#12875f]",
      void: "bg-[#f3f4f6] text-[#9ca3af]"
    } as Record<string, string>
  )[state];
}
