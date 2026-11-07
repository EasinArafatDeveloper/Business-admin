"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/constants";
import { setLeadsStatus } from "@/app/actions/leads";
import { PriorityText, STATUS_STYLES, StatusBadge } from "@/components/ui";
import { cn, nf } from "@/lib/utils";
import { BulkTools } from "@/components/leads/bulk-tools";

export type LeadRow = {
  id: number;
  pageName: string | null;
  category: string | null;
  industry: string | null;
  score: number | null;
  priority: string | null;
  primaryService: string | null;
  sizeTier: string | null;
  followers: number | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  activeAds: number | null;
  status: LeadStatus;
  tags: string[];
};

export function LeadsTable({
  rows,
  lists = [],
  sequences = []
}: {
  rows: LeadRow[];
  lists?: { id: number; name: string }[];
  sequences?: { id: number; name: string; status: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulk = (status: string) =>
    startTransition(async () => {
      await setLeadsStatus([...selected], status);
      setSelected(new Set());
      router.refresh();
    });

  return (
    <div className="rounded-2xl border border-line bg-surface">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent/10 px-4 py-2.5 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-muted">→ set status:</span>
          {LEAD_STATUSES.map((s) => (
            <button
              key={s}
              disabled={pending}
              onClick={() => bulk(s)}
              className={cn("rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50", STATUS_STYLES[s].className)}
            >
              {STATUS_STYLES[s].label}
            </button>
          ))}
          <BulkTools ids={[...selected]} lists={lists} sequences={sequences} />
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted hover:text-fg">
            Clear
          </button>
        </div>
      )}

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted-2">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPage}
                  onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="accent-[#3b6bff]"
                />
              </th>
              <th className="px-3 py-3 font-medium">Business</th>
              <th className="px-3 py-3 font-medium">Score</th>
              <th className="px-3 py-3 font-medium">Industry</th>
              <th className="px-3 py-3 font-medium">Best-fit service</th>
              <th className="px-3 py-3 font-medium">Followers</th>
              <th className="px-3 py-3 font-medium">Ads</th>
              <th className="px-3 py-3 font-medium">Reach</th>
              <th className="px-3 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-line last:border-0 hover:bg-ink-alt/60", selected.has(r.id) && "bg-accent/5")}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" aria-label={`Select ${r.pageName}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-[#3b6bff]" />
                </td>
                <td className="max-w-[280px] px-3 py-2.5">
                  <Link href={`/leads/${r.id}`} className="block truncate font-medium text-fg hover:text-accent-soft">
                    {r.pageName ?? "Untitled"}
                  </Link>
                  <span className="block truncate text-[11px] text-muted-2">
                    {r.category}
                    {r.tags.map((t) => (
                      <Link key={t} href={`/leads?label=${encodeURIComponent(t)}`} className="ml-1.5 text-accent-soft hover:underline">
                        #{t}
                      </Link>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium">{r.score ?? "—"}</div>
                  <PriorityText priority={r.priority} />
                </td>
                <td className="max-w-[160px] truncate px-3 py-2.5 text-muted">{r.industry}</td>
                <td className="max-w-[180px] truncate px-3 py-2.5 text-muted">{r.primaryService ?? "—"}</td>
                <td className="px-3 py-2.5 text-muted">{r.followers != null ? nf.format(r.followers) : "—"}</td>
                <td className="px-3 py-2.5 text-muted">{r.activeAds ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <span className="flex gap-1.5">
                    <MessageCircle className={cn("h-4 w-4", r.whatsapp ? "text-success" : "text-muted-2/40")} aria-label={r.whatsapp ? "Has WhatsApp" : "No WhatsApp"} />
                    <Phone className={cn("h-4 w-4", r.phone ? "text-accent-soft" : "text-muted-2/40")} aria-label={r.phone ? "Has phone" : "No phone"} />
                    <Mail className={cn("h-4 w-4", r.email ? "text-warning" : "text-muted-2/40")} aria-label={r.email ? "Has email" : "No email"} />
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted">No leads match these filters.</p>}
    </div>
  );
}
