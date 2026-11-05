/** SMS helpers shared by the server and the campaign editor (no server-only imports). */

/** Any Bangladeshi mobile format → "8801XXXXXXXXX", or null if it isn't a BD mobile number. */
export function normalizeBdMobile(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0088")) d = d.slice(2);
  if (d.startsWith("01") && d.length === 11) d = `88${d}`;
  if (d.startsWith("1") && d.length === 10) d = `880${d}`;
  return /^8801[3-9]\d{8}$/.test(d) ? d : null;
}

const GSM =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

/** How many SMS parts a message costs: 160/153 chars (English) or 70/67 (Bangla / emoji). */
export function smsParts(text: string): { parts: number; chars: number; unicode: boolean } {
  const unicode = [...text].some((c) => !GSM.includes(c) && !GSM_EXT.includes(c));
  if (unicode) {
    const chars = [...text].length;
    return { parts: chars <= 70 ? 1 : Math.ceil(chars / 67), chars, unicode };
  }
  const chars = [...text].reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0);
  return { parts: chars <= 160 ? 1 : Math.ceil(chars / 153), chars, unicode };
}

export type TemplateVars = { name?: string | null; service?: string | null; link: string };

/** Fills {name} {service} {link}. Unknown / empty values become sensible defaults. */
export function renderTemplate(template: string, v: TemplateVars) {
  return template
    .replace(/\{name\}/gi, (v.name ?? "").trim() || "Sir/Madam")
    .replace(/\{service\}/gi, (v.service ?? "").trim() || "website")
    .replace(/\{link\}/gi, v.link);
}

/** Length a tracking link adds to the SMS (base + "/" + 6-char code). */
export const sampleLink = (base: string) => `${base.replace(/\/$/, "")}/abc234`;
