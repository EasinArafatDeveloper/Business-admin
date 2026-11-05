import { INVOICE_STATES, type InvoiceState } from "@/lib/money";
import { cn } from "@/lib/utils";

export function InvoiceBadge({ state }: { state: InvoiceState }) {
  const s = INVOICE_STATES[state];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", s.className)}>{s.label}</span>;
}

const CLIENT: Record<string, [string, string]> = {
  active: ["Active", "bg-success/15 text-success"],
  paused: ["Paused", "bg-warning/15 text-warning"],
  past: ["Past", "bg-surface-2 text-muted-2"]
};

export function ClientBadge({ status }: { status: string }) {
  const [label, cls] = CLIENT[status] ?? [status, "bg-surface-2 text-muted"];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{label}</span>;
}
