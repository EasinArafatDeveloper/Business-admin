"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, KeyRound, Plus, X } from "lucide-react";
import { createApiKey, revokeApiKey } from "@/app/actions/ai";
import { cn } from "@/lib/utils";
import { Button, Label, inputClass } from "@/components/ui";

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      {label && <div className="mb-1 text-xs font-medium text-muted">{label}</div>}
      <pre className="scroll-thin overflow-x-auto rounded-xl border border-line bg-ink-alt p-3 pr-20 text-[11.5px] leading-relaxed text-fg">{text}</pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className={cn(
          "absolute right-2 inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs text-muted hover:text-fg",
          label ? "top-7" : "top-2"
        )}
      >
        {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const TABS = ["Claude Desktop", "Claude Code", "Cursor"] as const;

/** Copy-paste setup for each AI app, with the user's real key filled in. */
export function SetupGuide({ endpoint, apiKey }: { endpoint: string; apiKey: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Claude Desktop");
  const desktop = JSON.stringify(
    { mcpServers: { scaleup: { command: "npx", args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${apiKey}`] } } },
    null,
    2
  );
  const cursor = JSON.stringify({ mcpServers: { scaleup: { url: endpoint, headers: { Authorization: `Bearer ${apiKey}` } } } }, null, 2);
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-xl border border-line bg-surface p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn("rounded-lg px-3 py-1.5", tab === t ? "bg-accent/15 text-fg" : "text-muted hover:text-fg")}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Claude Desktop" && (
        <div className="space-y-2 text-sm text-muted">
          <p>
            1. Claude Desktop → <b className="text-fg">Settings → Developer → Edit Config</b>. 2. Paste this into <code>claude_desktop_config.json</code> (merge
            with what&apos;s there). 3. Restart Claude. Needs Node.js on the PC.
          </p>
          <CopyBlock text={desktop} />
        </div>
      )}
      {tab === "Claude Code" && (
        <div className="space-y-2 text-sm text-muted">
          <p>Run this once in a terminal:</p>
          <CopyBlock text={`claude mcp add --transport http scaleup ${endpoint} --header "Authorization: Bearer ${apiKey}"`} />
        </div>
      )}
      {tab === "Cursor" && (
        <div className="space-y-2 text-sm text-muted">
          <p>
            Cursor → <b className="text-fg">Settings → MCP → Add new MCP server</b>, or paste into <code>~/.cursor/mcp.json</code>:
          </p>
          <CopyBlock text={cursor} />
        </div>
      )}
      <p className="text-xs text-muted-2">Then ask things like “What happened in the business today?” or “Which invoices are overdue?”</p>
    </div>
  );
}

export function CreateKey({ endpoint }: { endpoint: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createApiKey, undefined);

  if (state?.key)
    return (
      <div className="space-y-4 rounded-2xl border border-success/40 bg-success/5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-success">
          <KeyRound className="h-4 w-4" /> Key “{state.name}” created — copy it now, it won&apos;t be shown again
        </div>
        <CopyBlock text={state.key} />
        <SetupGuide endpoint={endpoint} apiKey={state.key} />
      </div>
    );

  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New API key
      </Button>
    );

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">New API key</h3>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:text-fg" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <label className="block">
        <Label hint="so you know where it's used">Name</Label>
        <input name="name" required placeholder="e.g. Claude on my laptop" className={inputClass} />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[
          ["read", "Read only", "Look up leads, campaigns, replies, invoices. Can't change anything."],
          ["write", "Read + make drafts", "Also update leads, add notes, and create campaign / invoice DRAFTS. Never sends anything."]
        ].map(([v, l, d], i) => (
          <label
            key={v}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10"
          >
            <input type="radio" name="scope" value={v} defaultChecked={i === 0} className="mt-1 accent-[#3b6bff]" />
            <span>
              <span className="block text-sm font-medium">{l}</span>
              <span className="text-xs text-muted">{d}</span>
            </span>
          </label>
        ))}
      </div>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create key"}
      </Button>
    </form>
  );
}

export function RevokeKey({ id, name }: { id: number; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => confirm(`Revoke “${name}”? Any AI using it stops working right away.`) && start(() => revokeApiKey(id))}
    >
      Revoke
    </Button>
  );
}

/** claude.ai and ChatGPT: paste one link, then sign in — no key needed. */
export function ConnectApps({ endpoint }: { endpoint: string }) {
  const [tab, setTab] = useState<"claude" | "chatgpt">("claude");
  return (
    <div className="space-y-3 rounded-2xl border border-accent/30 bg-accent/5 p-5">
      <div className="text-sm font-semibold">Connect claude.ai or ChatGPT — just sign in</div>
      <CopyBlock text={endpoint} />
      <div className="inline-flex rounded-xl border border-line bg-surface p-1 text-sm">
        {(
          [
            ["claude", "claude.ai"],
            ["chatgpt", "ChatGPT"]
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn("rounded-lg px-3 py-1.5", tab === k ? "bg-accent/15 text-fg" : "text-muted hover:text-fg")}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "claude" ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            claude.ai → <b className="text-fg">Settings → Connectors → Add custom connector</b>
          </li>
          <li>Name it “ScaleUp Admin” and paste the link above → Add</li>
          <li>Press Connect — this admin opens, sign in and choose Read only or Read + drafts → Allow</li>
          <li>Works on Claude web, desktop and phone apps</li>
        </ol>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            ChatGPT → <b className="text-fg">Settings → Apps &amp; Connectors → Advanced settings</b> → turn on Developer mode
          </li>
          <li>Back in Apps &amp; Connectors → Create → paste the link above, Authentication: OAuth</li>
          <li>Connect → sign in here → Allow</li>
        </ol>
      )}
    </div>
  );
}
