"use client";

import { useEffect, useState } from "react";
import { CircleCheck, LoaderCircle, Smartphone, TriangleAlert, Unplug } from "lucide-react";
import { Button, Card } from "@/components/ui";

type Status = { state: "connecting" | "qr" | "open" | "logged_out" | "offline"; qr: string | null; me: { id: string; name: string | null } | null };

export function WaConnect() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await fetch("/api/wa/status", { cache: "no-store" }).catch(() => null);
      if (alive && r?.ok) setS(await r.json());
    };
    load();
    // Faster while waiting for a scan, slower once connected.
    const t = setInterval(load, s?.state === "open" ? 15000 : 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [s?.state]);

  const disconnect = async () => {
    if (!confirm("Disconnect this WhatsApp number from the admin?")) return;
    setBusy(true);
    await fetch("/api/wa/status", { method: "DELETE" }).catch(() => {});
    setBusy(false);
    setS(null);
  };

  return (
    <Card className="p-6">
      {!s || s.state === "connecting" ? (
        <div className="flex items-center gap-3 text-sm text-muted">
          <LoaderCircle className="h-5 w-5 animate-spin text-accent" /> Connecting to WhatsApp…
        </div>
      ) : s.state === "offline" ? (
        <div className="flex items-start gap-3 text-sm">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <span>The WhatsApp service isn&apos;t running on the server. Ask your admin to start the <code>scaleup-wa</code> container.</span>
        </div>
      ) : s.state === "open" ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CircleCheck className="h-8 w-8 text-success" />
            <div>
              <div className="font-semibold">Connected</div>
              <div className="text-sm text-muted">
                +{s.me?.id} {s.me?.name ? `· ${s.me.name}` : ""}
              </div>
            </div>
          </div>
          <Button variant="danger" size="sm" disabled={busy} onClick={disconnect}>
            <Unplug className="h-4 w-4" /> Disconnect
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[auto_1fr]">
          {s.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.qr} alt="WhatsApp QR code" width={240} height={240} className="rounded-xl bg-white p-2" />
          ) : (
            <div className="flex h-[240px] w-[240px] items-center justify-center rounded-xl bg-surface-2">
              <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
            </div>
          )}
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 font-semibold">
              <Smartphone className="h-4 w-4 text-accent" /> Link your WhatsApp
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>Open WhatsApp on the phone with the <b className="text-fg">campaign number</b> (not your main one).</li>
              <li>Tap ⋮ → <b className="text-fg">Linked devices</b> → <b className="text-fg">Link a device</b>.</li>
              <li>Scan this QR. It refreshes automatically.</li>
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}
