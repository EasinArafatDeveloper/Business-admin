import { cn } from "@/lib/utils";

const STYLES: Record<string, [string, string]> = {
  draft: ["Draft", "bg-surface-2 text-muted"],
  sending: ["Sending", "bg-accent/15 text-accent-soft"],
  paused: ["Paused", "bg-warning/15 text-warning"],
  done: ["Done", "bg-success/15 text-success"],
  cancelled: ["Cancelled", "bg-danger/15 text-danger"]
};

export function CampaignStatus({ status }: { status: string }) {
  const [label, cls] = STYLES[status] ?? [status, "bg-surface-2 text-muted"];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>
    {status === "sending" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
    {label}
  </span>;
}
