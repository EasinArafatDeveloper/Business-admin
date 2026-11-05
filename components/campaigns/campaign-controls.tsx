"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useTransition } from "react";
import { Pause, Play, X } from "lucide-react";
import { cancelCampaign, pauseCampaign, sendTestSms, startCampaign } from "@/app/actions/campaigns";
import { Button, Label, inputClass } from "@/components/ui";

export function CampaignControls({ id, status, total, cost }: { id: number; status: string; total: number; cost: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: (id: number) => Promise<void>) => startTransition(async () => {
    await fn(id);
    router.refresh();
  });

  // Live numbers while sending.
  useEffect(() => {
    if (status !== "sending") return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [status, router]);

  return (
    <div className="flex flex-wrap gap-2">
      {(status === "draft" || status === "paused") && (
        <Button
          disabled={pending}
          onClick={() => {
            if (status === "draft" && !confirm(`Send this campaign to ${total} people?${cost ? ` Estimated cost ${cost}.` : ""}`)) return;
            run(startCampaign);
          }}
        >
          <Play className="h-4 w-4" /> {status === "draft" ? "Start sending" : "Resume"}
        </Button>
      )}
      {status === "sending" && (
        <Button variant="secondary" disabled={pending} onClick={() => run(pauseCampaign)}>
          <Pause className="h-4 w-4" /> Pause
        </Button>
      )}
      {["draft", "paused", "sending"].includes(status) && (
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => confirm("Cancel this campaign? Unsent messages will not be sent.") && run(cancelCampaign)}
        >
          <X className="h-4 w-4" /> Cancel
        </Button>
      )}
    </div>
  );
}

export function TestSmsForm({ id, channel = "sms" }: { id: number; channel?: string }) {
  const [state, action, pending] = useActionState(sendTestSms.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-2">
      <Label hint={channel === "whatsapp" ? "link goes straight to the destination" : "costs 1 SMS · link goes straight to the destination"}>
        Send a test {channel === "whatsapp" ? "WhatsApp" : "SMS"} to your phone
      </Label>
      <div className="flex gap-2">
        <input name="phone" required placeholder="01XXXXXXXXX" inputMode="tel" className={inputClass} />
        <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
          {pending ? "Sending…" : "Send test"}
        </Button>
      </div>
      {state?.error && <p className="text-xs text-danger">{state.error}</p>}
      {state?.ok && <p className="text-xs text-success">{state.ok}</p>}
    </form>
  );
}
