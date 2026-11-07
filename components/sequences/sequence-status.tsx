import { cn } from "@/lib/utils";

const STYLE: Record<string, [string, string]> = {
  draft: ["Draft", "bg-muted/15 text-muted"],
  active: ["Running", "bg-success/15 text-success"],
  paused: ["Paused", "bg-warning/15 text-warning"]
};

export function SequenceStatus({ status }: { status: string }) {
  const [label, cls] = STYLE[status] ?? [status, "bg-muted/15 text-muted"];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{label}</span>;
}
