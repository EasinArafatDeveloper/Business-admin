import * as React from "react";
import { cn } from "@/lib/utils";
import type { LeadStatus } from "@/lib/constants";

export const inputClass =
  "h-10 w-full rounded-xl border border-line-strong bg-ink-alt px-3 text-sm text-fg placeholder:text-muted-2 outline-none transition-colors focus:border-accent";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-white hover:bg-[#5a83ff]",
        variant === "secondary" && "border border-line-strong bg-surface text-fg hover:border-accent/60",
        variant === "ghost" && "text-muted hover:bg-surface hover:text-fg",
        variant === "danger" && "border border-danger/40 text-danger hover:bg-danger/10",
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-surface", className)} {...props} />;
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-muted">
      {children}
      {hint && <span className="font-normal text-muted-2">{hint}</span>}
    </span>
  );
}

export const STATUS_STYLES: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-accent/15 text-accent-soft" },
  contacted: { label: "Contacted", className: "bg-warning/15 text-warning" },
  interested: { label: "Interested", className: "bg-[#a78bfa]/15 text-violet" },
  proposal: { label: "Proposal", className: "bg-[#38bdf8]/15 text-sky" },
  won: { label: "Won", className: "bg-success/15 text-success" },
  lost: { label: "Lost", className: "bg-danger/15 text-danger" },
  skip: { label: "Skip", className: "bg-surface-2 text-muted-2" }
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  const s = STATUS_STYLES[status];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", s.className)}>{s.label}</span>;
}

const PRIORITY_STYLES: Record<string, string> = {
  "A - Hot": "text-orange",
  "B - Warm": "text-warning",
  "C - Cold": "text-accent-soft",
  Skip: "text-muted-2"
};

export function PriorityText({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-muted-2">—</span>;
  return <span className={cn("text-xs font-medium", PRIORITY_STYLES[priority] ?? "text-muted")}>{priority}</span>;
}
