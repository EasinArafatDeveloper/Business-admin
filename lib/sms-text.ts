/** SMS helpers shared by the server and the campaign editor (no server-only imports). */

/** Any Bangladeshi mobile format → "8801XXXXXXXXX", or null if it isn't a BD mobile number. */
export function normalizeBdMobile(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0088")) d = d.slice(2);
  if (d.startsWith("01") && d.length === 11) d = `88${d}`;
  if (d.startsWith("1") && d.length === 10) d = `880${d}`;
  return /^8801[3-9]\d{8}$/.test(d) ? d : null;
}

/*
 * SMS "parts": phones split long messages into pieces and the provider charges per piece.
 * Plain English (GSM-7 alphabet): 160 chars in one piece, 153 per piece when longer.
 * One Bangla letter or emoji switches the WHOLE message to Unicode: 70 / 67 per piece.
 */
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€"; // allowed, but count as 2

const isGsm = (c: string) => GSM.includes(c) || GSM_EXT.includes(c);
export const isGsmText = (s: string) => [...s].every(isGsm);

/** Length as the network counts it: GSM weight (ext = 2) or Unicode code points. */
export function smsLength(s: string): { len: number; unicode: boolean } {
  const unicode = !isGsmText(s);
  return { len: unicode ? [...s].length : [...s].reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0), unicode };
}

export function partsFor(len: number, unicode: boolean) {
  if (unicode) return len <= 70 ? 1 : Math.ceil(len / 67);
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

export function smsParts(text: string): { parts: number; chars: number; unicode: boolean } {
  const { len, unicode } = smsLength(text);
  return { parts: partsFor(len, unicode), chars: len, unicode };
}

const NAME_FALLBACK = "Sir/Madam";
const SERVICE_FALLBACK = "website";

/**
 * Keeps only plain-English characters of a business name so it doesn't turn the SMS into
 * a 70-char Unicode message: "Smart Shop 🛍️" → "Smart Shop", "রাব্বানী Rabbani" → "Rabbani".
 * Returns null when too little is left (e.g. a fully Bangla name).
 */
export function cleanName(raw: string | null | undefined): string | null {
  const kept = [...(raw ?? "")]
    .filter((c) => isGsm(c) && c !== "\n" && c !== "\r")
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–|:,.·]+|[\s\-–|:,.·]+$/g, "")
    .trim();
  return (kept.match(/[A-Za-z]/g)?.length ?? 0) >= 2 ? kept : null;
}

/**
 * Spintax: "{Hi|Hello|Assalamu Alaikum}" → one option picked at random per person, so a
 * campaign isn't hundreds of identical texts. {name} {service} {link} (no "|") are left alone.
 */
const SPIN = /\{([^{}|]*(?:\|[^{}|]*)+)\}/g;
export function spin(text: string, pick: (n: number) => number = (n) => Math.floor(Math.random() * n)) {
  return text.replace(SPIN, (_, opts: string) => {
    const o = opts.split("|");
    return o[pick(o.length)];
  });
}
/** The longest version of a spintax text (for a safe cost estimate). */
export function spinLongest(text: string) {
  return text.replace(SPIN, (_, opts: string) => opts.split("|").reduce((a, b) => ([...b].length > [...a].length ? b : a), ""));
}

export type TemplateVars = { name?: string | null; service?: string | null; link: string; fields?: LeadFields };

/**
 * Lead data you can put in a message: {ads}, {days}, {followers}…
 * Write {ads:onek} to use "onek" when a lead has no number for it, so the sentence never breaks.
 */
export const LEAD_FIELDS = {
  industry: "Industry, e.g. Fashion",
  category: "Page category",
  ads: "Active ads, e.g. 16",
  days: "Days their ads have run, e.g. 242",
  followers: "Followers, e.g. 17,000",
  pain: "Their pain point (from analysis)",
  orders: "How they take orders, e.g. Messenger",
  size: "Page size, e.g. Small",
  address: "Address / area"
} as const;
export type LeadFieldKey = keyof typeof LEAD_FIELDS;
export type LeadFields = Partial<Record<LeadFieldKey, string | null>>;

const fmtNum = (n: number | null | undefined) => (n == null ? null : n.toLocaleString("en-US"));

/** The {placeholders} values for one lead. */
export function leadFields(l: {
  industry?: string | null;
  category?: string | null;
  activeAds?: number | null;
  runningDays?: number | null;
  followers?: number | null;
  painPoint?: string | null;
  ordersVia?: string | null;
  sizeTier?: string | null;
  address?: string | null;
}): LeadFields {
  return {
    industry: l.industry ?? null,
    category: l.category ?? null,
    ads: fmtNum(l.activeAds),
    days: fmtNum(l.runningDays),
    followers: fmtNum(l.followers),
    pain: l.painPoint ?? null,
    orders: l.ordersVia ?? null,
    size: l.sizeTier ?? null,
    address: l.address ?? null
  };
}

const FIELD_RE = new RegExp(`\\{(${Object.keys(LEAD_FIELDS).join("|")})(?::([^{}]*))?\\}`, "gi");
export type RenderOptions = { cleanNames?: boolean; pick?: (n: number) => number };

/** Fills {name} {service} {link}. With cleanNames, Bangla/emoji in names are dropped (see cleanName). */
export function renderTemplate(template: string, v: TemplateVars, opts: RenderOptions = {}) {
  const name = opts.cleanNames ? (cleanName(v.name) ?? NAME_FALLBACK) : (v.name ?? "").trim() || NAME_FALLBACK;
  const service = opts.cleanNames ? (cleanName(v.service) ?? SERVICE_FALLBACK) : (v.service ?? "").trim() || SERVICE_FALLBACK;
  return spin(template, opts.pick)
    .replace(
      FIELD_RE,
      (_, key: string, fallback?: string) => (v.fields?.[key.toLowerCase() as LeadFieldKey] ?? "").toString().trim() || (fallback ?? "").trim()
    )
    .replace(/\{name\}/gi, name)
    .replace(/\{service\}/gi, service)
    .replace(/\{link\}/gi, v.link);
}

/** Length a tracking link adds to the SMS (base + "/" + 6-char code). */
export const sampleLink = (base: string) => `${base.replace(/\/$/, "")}/abc234`;

/* ------------------------------------------------------------------ exact cost */

/**
 * The audience reduced to "shapes": people whose name/service have the same SMS length and
 * alphabet cost the same, so 50,000 people become a few hundred groups the browser can price.
 */
export type AudienceGroup = {
  n: number;
  nameLen: number;
  nameUni: boolean;
  cleanNameLen: number; // length after cleanName (or of the fallback)
  svcLen: number;
  svcUni: boolean;
  cleanSvcLen: number;
};

export function groupAudience(people: { name: string | null; service: string | null }[]): AudienceGroup[] {
  const map = new Map<string, AudienceGroup>();
  for (const p of people) {
    const name = (p.name ?? "").trim() || NAME_FALLBACK;
    const svc = (p.service ?? "").trim() || SERVICE_FALLBACK;
    const n = smsLength(name);
    const s = smsLength(svc);
    const g: AudienceGroup = {
      n: 1,
      nameLen: n.len,
      nameUni: n.unicode,
      cleanNameLen: (cleanName(p.name) ?? NAME_FALLBACK).length,
      svcLen: s.len,
      svcUni: s.unicode,
      cleanSvcLen: (cleanName(p.service) ?? SERVICE_FALLBACK).length
    };
    const key = `${g.nameLen}|${+g.nameUni}|${g.cleanNameLen}|${g.svcLen}|${+g.svcUni}|${g.cleanSvcLen}`;
    const hit = map.get(key);
    if (hit) hit.n++;
    else map.set(key, g);
  }
  return [...map.values()];
}

/** Exact total parts for a template over the grouped audience. */
export function estimateParts(rawTemplate: string, groups: AudienceGroup[], linkLen: number, opts: RenderOptions = {}) {
  const template = spinLongest(rawTemplate);
  const fixed = template
    .replace(/\{name\}/gi, "")
    .replace(/\{service\}/gi, "")
    .replace(/\{link\}/gi, "");
  const fixedLen = smsLength(fixed);
  const nName = (template.match(/\{name\}/gi) ?? []).length;
  const nSvc = (template.match(/\{service\}/gi) ?? []).length;
  const nLink = (template.match(/\{link\}/gi) ?? []).length;

  let totalParts = 0;
  const byParts = new Map<number, number>(); // parts → people
  let unicodePeople = 0;
  for (const g of groups) {
    const nameLen = opts.cleanNames ? g.cleanNameLen : g.nameLen;
    const svcLen = opts.cleanNames ? g.cleanSvcLen : g.svcLen;
    const unicode = fixedLen.unicode || (!opts.cleanNames && ((nName > 0 && g.nameUni) || (nSvc > 0 && g.svcUni)));
    // In Unicode every character counts 1, so re-measure the fixed text as code points.
    const fixedChars = unicode ? [...fixed].length : fixedLen.len;
    const len = fixedChars + nName * nameLen + nSvc * svcLen + nLink * linkLen;
    const parts = partsFor(len, unicode);
    totalParts += parts * g.n;
    byParts.set(parts, (byParts.get(parts) ?? 0) + g.n);
    if (unicode) unicodePeople += g.n;
  }
  return { totalParts, byParts: [...byParts.entries()].sort((a, b) => a[0] - b[0]), unicodePeople };
}
