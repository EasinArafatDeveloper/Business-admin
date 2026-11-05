import "server-only";

/**
 * BulkSMSBD (bulksmsbd.net) — settings live in .env:
 *   BULKSMSBD_API_KEY, BULKSMSBD_SENDER_ID, SMS_RATE_BDT (price per SMS part, default 0.35)
 */
const BASE = "https://bulksmsbd.net/api";

/** Provider response codes → plain words. */
export const SMS_CODES: Record<string, string> = {
  "202": "Sent",
  "1001": "Invalid number",
  "1002": "Sender ID not correct / disabled",
  "1003": "Missing fields",
  "1005": "Provider internal error",
  "1006": "Balance validity not available",
  "1007": "Balance insufficient",
  "1011": "User ID not found",
  "1012": "Masking SMS must be sent in Bengali",
  "1013": "Sender ID has no gateway",
  "1014": "Sender type name not found",
  "1015": "Sender ID has no valid gateway",
  "1016": "Sender type price not found",
  "1017": "Sender type price not found",
  "1018": "Account disabled",
  "1019": "Sender type price disabled",
  "1020": "Parent account not found",
  "1021": "Parent active price not found",
  "1031": "Account not verified",
  "1032": "IP not whitelisted"
};

/** Codes that mean "stop the whole campaign" (retrying other numbers won't help). */
export const FATAL_CODES = new Set(["1002", "1006", "1007", "1011", "1013", "1015", "1018", "1031", "1032"]);

export const smsRate = () => Number(process.env.SMS_RATE_BDT ?? "0.35") || 0.35;

function credentials() {
  const key = process.env.BULKSMSBD_API_KEY;
  const sender = process.env.BULKSMSBD_SENDER_ID;
  if (!key || !sender) throw new Error("SMS provider is not configured (BULKSMSBD_API_KEY / BULKSMSBD_SENDER_ID)");
  return { key, sender };
}

export async function sendSms(number: string, message: string): Promise<{ ok: boolean; code: string; info: string }> {
  const { key, sender } = credentials();
  const body = new URLSearchParams({ api_key: key, type: "text", number, senderid: sender, message });
  try {
    const res = await fetch(`${BASE}/smsapi`, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let code = "";
    try {
      code = String((JSON.parse(text) as { response_code?: unknown }).response_code ?? "");
    } catch {
      code = text.trim().slice(0, 20);
    }
    return { ok: code === "202", code, info: SMS_CODES[code] ?? text.slice(0, 200) };
  } catch (e) {
    return { ok: false, code: "network", info: e instanceof Error ? e.message : "network error" };
  }
}

export async function getBalance(): Promise<number | null> {
  try {
    const { key } = credentials();
    const res = await fetch(`${BASE}/getBalanceApi?api_key=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const data = (await res.json()) as { response_code?: number; balance?: number };
    return data.response_code === 202 && typeof data.balance === "number" ? Math.round(data.balance * 100) / 100 : null;
  } catch {
    return null;
  }
}
