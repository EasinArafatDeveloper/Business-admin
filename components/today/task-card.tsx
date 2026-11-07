"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Phone, SkipForward } from "lucide-react";
import { completeTask, skipTask } from "@/app/actions/tasks";
import { Button, Card, StatusBadge } from "@/components/ui";
import { CHANNELS } from "@/components/campaigns/channel";
import type { LeadStatus } from "@/lib/constants";
import { cn, digitsOnly } from "@/lib/utils";

export type TaskView = {
  id: number;
  channel: string;
  title: string;
  subject: string | null;
  body: string | null;
  contact: string | null;
  dueAt: string;
  overdue: boolean;
  lead: { id: number; name: string | null; status: string };
};

/** Where "Open" goes: WhatsApp with the text filled in, the phone's SMS app, the mail app, or a call. */
function openHref(t: TaskView) {
  const to = t.contact ?? "";
  const body = t.body ?? "";
  if (t.channel === "whatsapp") return `https://wa.me/${digitsOnly(to)}?text=${encodeURIComponent(body)}`;
  if (t.channel === "sms") return `sms:+${digitsOnly(to)}?body=${encodeURIComponent(body)}`;
  if (t.channel === "email") return `mailto:${to}?subject=${encodeURIComponent(t.subject ?? "")}&body=${encodeURIComponent(body)}`;
  return `tel:+${digitsOnly(to)}`;
}

const OPEN_LABEL: Record<string, string> = { whatsapp: "Open WhatsApp", sms: "Open SMS app", email: "Open email", call: "Call" };

export function TaskCard({ task }: { task: TaskView }) {
  const [done, setDone] = useState<"sent" | "skipped" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const ch = task.channel === "call" ? null : CHANNELS[task.channel as keyof typeof CHANNELS];
  const Icon = ch?.icon ?? Phone;

  if (done)
    return (
      <Card className="flex items-center gap-2 px-4 py-3 text-sm text-muted">
        <Check className="h-4 w-4 text-success" />
        {task.lead.name ?? "Lead"} — {done === "sent" ? (task.channel === "call" ? "done" : "marked sent") : "skipped"}
      </Card>
    );

  return (
    <Card className={cn("space-y-3 p-4", task.overdue && "border-warning/40")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", ch?.tint ?? "bg-accent/15", ch?.text ?? "text-accent-soft")}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/leads/${task.lead.id}`} className="truncate font-medium hover:text-accent-soft">
              {task.lead.name ?? `Lead #${task.lead.id}`}
            </Link>
            <StatusBadge status={task.lead.status as LeadStatus} />
            {task.overdue && <span className="text-[11px] text-warning">overdue</span>}
          </div>
          <div className="text-xs text-muted">
            {task.title} · <span className="font-mono">{task.contact}</span>
          </div>
        </div>
      </div>
      {task.subject && <div className="text-sm font-medium">{task.subject}</div>}
      {task.body && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-ink-alt p-3 text-sm">{task.body}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={openHref(task)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-medium text-white hover:bg-[#5a83ff]"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {OPEN_LABEL[task.channel] ?? "Open"}
        </a>
        {task.body && (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(task.body ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await completeTask(task.id);
              if (r.error) setError(r.error);
              else setDone("sent");
            })
          }
          className="border-success/40 text-success"
        >
          <Check className="h-3.5 w-3.5" /> {task.channel === "call" ? "Done" : "Mark sent"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await skipTask(task.id);
              if (r.error) setError(r.error);
              else setDone("skipped");
            })
          }
        >
          <SkipForward className="h-3.5 w-3.5" /> Skip
        </Button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </Card>
  );
}
