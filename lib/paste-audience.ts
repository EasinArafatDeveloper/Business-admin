/** Reads pasted numbers / emails (one per line, optional name) — shared by the browser and the server. */
import { normalizeBdMobile } from "@/lib/sms-text";

export type PastedEntry = { to: string; name: string | null };
export type PasteResult = { entries: PastedEntry[]; invalid: string[]; duplicates: number };

export const MAX_PASTE = 5000;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Accepts things like:
 *   01711-000001
 *   +880 1811 000002, Rahim Store
 *   Glow Skincare <01911000003>
 *   info@shop.com  Sign of Modesty
 * Several numbers on one line are fine too (then names are ignored).
 */
export function parsePasted(text: string, channel: "sms" | "whatsapp" | "email"): PasteResult {
  const seen = new Set<string>();
  const entries: PastedEntry[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const contacts: string[] = [];
    let rest = line;

    if (channel === "email") {
      for (const m of line.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []) {
        if (EMAIL_RE.test(m)) contacts.push(m.toLowerCase());
        rest = rest.replace(m, " ");
      }
    } else {
      // Phone-looking runs: digits with spaces, dashes, dots, brackets or a leading +.
      for (const m of line.match(/\+?\d[\d\s().-]{8,}\d/g) ?? []) {
        const whole = normalizeBdMobile(m);
        if (whole) {
          contacts.push(whole);
          rest = rest.replace(m, " ");
          continue;
        }
        // "01711000001 01811000002": several numbers separated by spaces — rebuild them piece by piece.
        let buf = "";
        let found = false;
        for (const tok of m.split(/\s+/)) {
          buf += tok;
          const n = normalizeBdMobile(buf);
          if (n) {
            contacts.push(n);
            buf = "";
            found = true;
          } else if (buf.replace(/\D/g, "").length > 13) buf = tok;
        }
        if (found) rest = rest.replace(m, " ");
      }
    }

    if (contacts.length === 0) {
      invalid.push(line.slice(0, 80));
      continue;
    }
    // A name only makes sense when the line has one contact.
    const name =
      contacts.length === 1
        ? rest
            .replace(/[<>()[\]"'|;,\t:-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || null
        : null;
    for (const to of contacts) {
      if (seen.has(to)) {
        duplicates++;
        continue;
      }
      seen.add(to);
      if (entries.length < MAX_PASTE) entries.push({ to, name });
    }
  }
  return { entries, invalid, duplicates };
}

/** "8801711000001" → "01711-000001" for display. */
export const prettyBd = (n: string) => (n.startsWith("880") ? `0${n.slice(3, 7)}-${n.slice(7)}` : n);
