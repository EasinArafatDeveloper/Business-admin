"use client";

import { useActionState, useEffect, useRef } from "react";
import { SendHorizontal } from "lucide-react";
import { replyToThread } from "@/app/actions/inbox";
import { Button } from "@/components/ui";

export function ReplyBox({ sender, disabledReason }: { sender: string; disabledReason?: string }) {
  const [state, action, pending] = useActionState(replyToThread.bind(null, sender), undefined);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state?.ok]);

  if (disabledReason) return <p className="border-t border-line px-4 py-3 text-xs text-muted-2">{disabledReason}</p>;

  return (
    <form ref={form} action={action} className="border-t border-line p-3">
      <div className="flex items-end gap-2">
        <textarea
          name="text"
          rows={2}
          required
          placeholder="Reply on WhatsApp…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.current?.requestSubmit();
          }}
          className="min-h-[44px] flex-1 resize-y rounded-xl border border-line-strong bg-ink-alt p-2.5 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" disabled={pending} className="shrink-0" aria-label="Send reply">
          <SendHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">{pending ? "Sending…" : "Send"}</span>
        </Button>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-2">
        <span>Sent from the linked campaign number · Ctrl+Enter to send</span>
        {state?.error && <span className="text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
