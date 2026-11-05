"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Download, Search, X } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/constants";
import type { FilterOptions } from "@/lib/leads-query";
import { STATUS_STYLES } from "@/components/ui";
import { cn, nf } from "@/lib/utils";

const selectClass = "h-9 rounded-xl border border-line-strong bg-ink-alt px-2.5 text-sm text-fg outline-none focus:border-accent max-w-[200px]";

const HAS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" }
] as const;

const SOURCE_LABEL: Record<string, string> = {
  import: "Excel import",
  "website-contact": "Website · contact",
  "website-audit": "Website · free audit",
  manual: "Manual"
};

export function FilterBar({ options, lists = [] }: { options: FilterOptions; lists?: { id: number; name: string }[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const push = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(sp.toString());
    mutate(p);
    p.delete("page");
    startTransition(() => router.push(`/leads${p.toString() ? `?${p}` : ""}`));
  };
  const setParam = (key: string, value: string) => push((p) => (value ? p.set(key, value) : p.delete(key)));
  const toggleHas = (key: string) =>
    push((p) => {
      const cur = p.getAll("has");
      p.delete("has");
      (cur.includes(key) ? cur.filter((h) => h !== key) : [...cur, key]).forEach((h) => p.append("has", h));
    });

  // Search after typing stops for 400 ms.
  useEffect(() => {
    if ((sp.get("q") ?? "") === q) return;
    const t = setTimeout(() => setParam("q", q.trim()), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sel = (key: string, label: string, list: { value: string | null; count: number }[], fmt?: (v: string) => string) => (
    <select
      aria-label={label}
      value={sp.get(key) ?? ""}
      onChange={(e) => setParam(key, e.target.value)}
      className={cn(selectClass, sp.get(key) && "border-accent/60")}
    >
      <option value="">{label}</option>
      {list.map((o) => (
        <option key={o.value} value={o.value ?? ""}>
          {(fmt ? fmt(o.value ?? "") : o.value) + ` (${nf.format(o.count)})`}
        </option>
      ))}
    </select>
  );

  const activeCount = [...sp.keys()].filter((k) => !["page", "sort"].includes(k)).length;
  const has = sp.getAll("has");

  return (
    <div className={cn("space-y-3 transition-opacity", pending && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, email, address, category…"
            className="h-9 w-full rounded-xl border border-line-strong bg-ink-alt pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <select
          aria-label="Sort"
          value={sp.get("sort") ?? "score"}
          onChange={(e) => setParam("sort", e.target.value === "score" ? "" : e.target.value)}
          className={selectClass}
        >
          <option value="score">Sort: score</option>
          <option value="followers">Sort: followers</option>
          <option value="ads">Sort: active ads</option>
          <option value="newest">Sort: newest</option>
          <option value="name">Sort: name A–Z</option>
        </select>
        <a
          href={`/api/leads/export${sp.toString() ? `?${sp}` : ""}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm text-fg hover:border-accent/60"
        >
          <Download className="h-4 w-4" /> CSV
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {lists.length > 0 && (
          <select
            aria-label="Saved list"
            value={sp.get("list") ?? ""}
            onChange={(e) => setParam("list", e.target.value)}
            className={cn(selectClass, sp.get("list") && "border-accent/60")}
          >
            <option value="">Saved list</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Status"
          value={sp.get("status") ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
          className={cn(selectClass, sp.get("status") && "border-accent/60")}
        >
          <option value="">Status</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_STYLES[s].label}
            </option>
          ))}
        </select>
        {sel("priority", "Priority", options.priority)}
        {sel("industry", "Industry", options.industry)}
        {sel("service", "Best-fit service", options.service)}
        {sel("size", "Page size", options.size)}
        {sel("webType", "Website type", options.webType)}
        {sel("platform", "Platform", options.platform)}
        {sel("source", "Source", options.source, (v) => SOURCE_LABEL[v] ?? v)}
        <select
          aria-label="Orders via"
          value={sp.get("orders") ?? ""}
          onChange={(e) => setParam("orders", e.target.value)}
          className={cn(selectClass, sp.get("orders") && "border-accent/60")}
        >
          <option value="">Orders via</option>
          {["Messenger", "WhatsApp", "Website", "Call", "App"].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select
          aria-label="Country"
          value={sp.get("bd") ?? ""}
          onChange={(e) => setParam("bd", e.target.value)}
          className={cn(selectClass, sp.get("bd") && "border-accent/60")}
        >
          <option value="">Country</option>
          <option value="yes">Bangladesh</option>
          <option value="no">Outside / unclear</option>
        </select>
        <select
          aria-label="Minimum score"
          value={sp.get("minScore") ?? ""}
          onChange={(e) => setParam("minScore", e.target.value)}
          className={cn(selectClass, sp.get("minScore") && "border-accent/60")}
        >
          <option value="">Min score</option>
          {[40, 50, 60, 70, 80, 90].map((n) => (
            <option key={n} value={n}>
              Score ≥ {n}
            </option>
          ))}
        </select>
        <select
          aria-label="Minimum active ads"
          value={sp.get("minAds") ?? ""}
          onChange={(e) => setParam("minAds", e.target.value)}
          className={cn(selectClass, sp.get("minAds") && "border-accent/60")}
        >
          <option value="">Min ads</option>
          {[2, 3, 5, 10].map((n) => (
            <option key={n} value={n}>
              {n}+ active ads
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-2">Must have:</span>
        {HAS.map((h) => (
          <button
            key={h.key}
            onClick={() => toggleHas(h.key)}
            className={cn(
              "h-7 rounded-full border px-3 text-xs transition-colors",
              has.includes(h.key) ? "border-accent bg-accent/15 text-fg" : "border-line-strong text-muted hover:text-fg"
            )}
          >
            {h.label}
          </button>
        ))}
        {activeCount > 0 && (
          <button
            onClick={() => {
              setQ("");
              startTransition(() => router.push("/leads"));
            }}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
