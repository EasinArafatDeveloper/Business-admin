import "server-only";

/** Talks to the internal WhatsApp service (wa/server.mjs) over the Docker network. */
export type WaStatus = { state: "connecting" | "qr" | "open" | "logged_out" | "offline"; qr: string | null; me: { id: string; name: string | null } | null };

const base = () => (process.env.WA_URL ?? "http://wa:4100").replace(/\/$/, "");

async function call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const secret = process.env.WA_SECRET;
  if (!secret) throw new Error("WA_SECRET is not set");
  const res = await fetch(`${base()}${path}`, {
    method: init.method ?? "GET",
    headers: { "x-wa-secret": secret, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000)
  });
  return (await res.json()) as T;
}

export async function getWaStatus(): Promise<WaStatus> {
  try {
    return await call<WaStatus>("/status", { timeoutMs: 5000 });
  } catch {
    return { state: "offline", qr: null, me: null };
  }
}

export async function waLogout() {
  await call("/logout", { method: "POST" }).catch(() => {});
}

/** ok | not_on_whatsapp | disconnected | error */
export async function waSend(to: string, text: string): Promise<{ ok: boolean; result: "ok" | "not_on_whatsapp" | "disconnected" | "error"; info?: string }> {
  try {
    const r = await call<{ ok: boolean; error?: string }>("/send", { method: "POST", body: { to, text }, timeoutMs: 30000 });
    if (r.ok) return { ok: true, result: "ok" };
    if (r.error === "not_on_whatsapp") return { ok: false, result: "not_on_whatsapp", info: "Not on WhatsApp" };
    if (r.error === "WhatsApp is not connected") return { ok: false, result: "disconnected", info: r.error };
    return { ok: false, result: "error", info: r.error };
  } catch (e) {
    return { ok: false, result: "disconnected", info: e instanceof Error ? e.message : "WhatsApp service unreachable" };
  }
}

/** Which numbers have WhatsApp (asks in batches of 50). null = WhatsApp isn't connected. */
export async function waCheck(numbers: string[]): Promise<Record<string, boolean> | null> {
  const out: Record<string, boolean> = {};
  for (let i = 0; i < numbers.length; i += 50) {
    try {
      const r = await call<{ results?: Record<string, boolean>; ok?: boolean }>("/check", {
        method: "POST",
        body: { numbers: numbers.slice(i, i + 50) },
        timeoutMs: 60_000
      });
      if (!r.results) return null;
      Object.assign(out, r.results);
    } catch {
      return null;
    }
  }
  return out;
}
