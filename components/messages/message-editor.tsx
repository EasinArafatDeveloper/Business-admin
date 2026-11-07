"use client";

import { useRef } from "react";
import { LEAD_FIELDS, smsParts } from "@/lib/sms-text";
import { cn } from "@/lib/utils";

export type TemplateOption = { id: number; channel: string; name: string; subject: string | null; body: string };

const BASIC: [string, string][] = [
  ["{name}", "business name"],
  ["{service}", "best-fit service"],
  ["{link}", "tracked link"],
  ["{Hi|Hello|Assalamu Alaikum}", "random variation per person"]
];

/** Message box with placeholder buttons, an SMS length counter and (optionally) "Use template". */
export function MessageEditor({
  value,
  onChange,
  channel,
  name,
  rows = 5,
  templates = [],
  onTemplate,
  placeholder
}: {
  value: string;
  onChange: (v: string) => void;
  channel: string;
  name?: string;
  rows?: number;
  templates?: TemplateOption[];
  /** Called with the picked template (to fill the subject too). */
  onTemplate?: (t: TemplateOption) => void;
  placeholder?: string;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ta.current;
    if (!el) return onChange(value + token);
    const { selectionStart: s, selectionEnd: e } = el;
    onChange(value.slice(0, s) + token + value.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = s + token.length;
    });
  };
  const usable = templates.filter((t) => t.channel === channel || (channel === "whatsapp" && t.channel === "sms") || (channel === "sms" && t.channel === "whatsapp"));
  const { parts, chars, unicode } = smsParts(value.replace(/\{link\}/gi, "https://x.co/abc123"));

  return (
    <div className="space-y-1.5">
      {usable.length > 0 && (
        <select
          aria-label="Use a template"
          value=""
          onChange={(e) => {
            const t = usable.find((x) => x.id === Number(e.target.value));
            if (!t) return;
            onChange(t.body);
            onTemplate?.(t);
          }}
          className="h-8 rounded-lg border border-line-strong bg-ink-alt px-2 text-xs text-muted outline-none focus:border-accent"
        >
          <option value="">Use a template…</option>
          {usable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <textarea
        ref={ta}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line-strong bg-ink-alt p-3 text-sm outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {BASIC.map(([t, hint]) => (
          <button key={t} type="button" title={hint} onClick={() => insert(t)} className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-muted hover:text-fg">
            {t}
          </button>
        ))}
        {(Object.keys(LEAD_FIELDS) as (keyof typeof LEAD_FIELDS)[]).map((k) => (
          <button
            key={k}
            type="button"
            title={LEAD_FIELDS[k]}
            onClick={() => insert(`{${k}}`)}
            className="rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 font-mono text-accent-soft hover:text-fg"
          >
            {`{${k}}`}
          </button>
        ))}
        {channel === "sms" && (
          <span className={cn("ml-auto", parts > 2 ? "text-warning" : "text-muted-2")}>
            ~{chars} chars · {parts} SMS{unicode ? " (Bangla: 70 per SMS)" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
