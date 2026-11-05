/** Money helpers shared by server and browser. Amounts are integers in poisha (৳1 = 100). */

const fmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 2550000 → "৳25,500" (Indian grouping, like Bangladesh: ৳1,25,000). */
export function taka(poisha: number) {
  return `৳${fmt.format(poisha / 100)}`;
}

/** "25,500.50" → 2550050. Returns null when it isn't a valid non-negative amount. */
export function parseTaka(input: string | number | null | undefined): number | null {
  const s = String(input ?? "")
    .replace(/[৳,\s]/g, "")
    .trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export type InvoiceState = "draft" | "sent" | "partial" | "overdue" | "paid" | "void";

/** What an invoice is right now: stored status plus amounts and the due date. */
export function invoiceState(inv: { status: string; total: number; amountPaid: number; dueDate: Date | null }, now = new Date()): InvoiceState {
  if (inv.status === "void") return "void";
  if (inv.status === "draft") return "draft";
  if (inv.total > 0 && inv.amountPaid >= inv.total) return "paid";
  if (inv.dueDate && inv.dueDate < now) return "overdue";
  if (inv.amountPaid > 0) return "partial";
  return "sent";
}

export const INVOICE_STATES: Record<InvoiceState, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-surface-2 text-muted" },
  sent: { label: "Sent", className: "bg-accent/15 text-accent-soft" },
  partial: { label: "Partly paid", className: "bg-violet/15 text-violet" },
  overdue: { label: "Overdue", className: "bg-danger/15 text-danger" },
  paid: { label: "Paid", className: "bg-success/15 text-success" },
  void: { label: "Void", className: "bg-surface-2 text-muted-2 line-through" }
};

export const PAYMENT_METHODS: Record<string, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  bank: "Bank transfer",
  cash: "Cash",
  card: "Card",
  other: "Other"
};

export type LineInput = { description: string; quantity: number; unitPrice: number };

export function totals(lines: LineInput[], discount: number) {
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const d = Math.min(Math.max(0, discount), subtotal);
  return { subtotal, discount: d, total: subtotal - d };
}

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" }) : "—";
