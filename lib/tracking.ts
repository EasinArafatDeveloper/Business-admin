import "server-only";
import crypto from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Click tracking engine (ported from the Postman / sms-campain engine).
 *
 * 1. Every recipient gets a unique short code → /go/<code>.
 * 2. A hit is classified: link-preview bots, prefetch requests and scripts get a plain
 *    redirect and are logged as bot hits only.
 * 3. A possible human gets a tiny page whose JavaScript posts a one-time token back
 *    (/go/verify). Only that verified beacon counts as a real click — preview bots
 *    don't run JavaScript, so they never inflate the numbers.
 */

const R = schema.campaignRecipients;
const C = schema.campaigns;
const E = schema.clickEvents;
const L = schema.leads;

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // no 0/o, 1/l/i — easy to read in an SMS
export const CODE_LENGTH = 6;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 2000;

export function newCode(length = CODE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function linkBase() {
  return (process.env.LINK_BASE_URL ?? "https://admin.scaleupweb.xyz/go").replace(/\/$/, "");
}

export type HitMeta = {
  ip?: string | null;
  userAgent?: string | null;
  purpose?: string | null;
  secPurpose?: string | null;
  secFetchDest?: string | null;
  secFetchMode?: string | null;
};

const BOT_SIGNATURES: [string, string][] = [
  ["truecaller", "Truecaller SMS scanner"],
  ["dalvik", "Android system fetch (Dalvik)"],
  ["android-sms", "Android SMS link preview"],
  ["samsungservice", "Samsung anti-spam scanner"],
  ["okhttp", "OkHttp client"],
  ["apache-httpclient", "Apache HttpClient"],
  ["cfnetwork", "Apple CFNetwork"],
  ["google-page-preview", "Google page preview"],
  ["google-read-aloud", "Google Read Aloud"],
  ["googlebot", "Googlebot"],
  ["applebot", "Applebot / iMessage preview"],
  ["facebookexternalhit", "Facebook preview"],
  ["facebot", "Facebot"],
  ["whatsapp", "WhatsApp preview"],
  ["telegrambot", "Telegram preview"],
  ["twitterbot", "Twitterbot"],
  ["slackbot", "Slackbot"],
  ["skypeuripreview", "Skype preview"],
  ["viber", "Viber preview"],
  ["discordbot", "Discordbot"],
  ["bingbot", "Bingbot"],
  ["duckduckbot", "DuckDuckBot"],
  ["yandex", "Yandex"],
  ["bytespider", "ByteSpider"],
  ["petalbot", "PetalBot"],
  ["x11; linux x86_64", "Cloud headless crawler"],
  ["headlesschrome", "Headless Chrome"],
  ["headless", "Headless browser"],
  ["phantomjs", "PhantomJS"],
  ["lighthouse", "Lighthouse"],
  ["curl", "cURL"],
  ["python", "Python script"],
  ["go-http-client", "Go HTTP client"],
  ["node-fetch", "Node fetch"],
  ["postman", "Postman"],
  ["wget", "Wget"],
  ["winhttp", "WinHTTP"],
  ["scrapy", "Scrapy"],
  ["axios", "Axios"],
  ["semrush", "Semrush"],
  ["ahrefs", "Ahrefs"]
];

export function detectBot(m: HitMeta): { isBot: boolean; reason: string } {
  const purpose = (m.purpose || m.secPurpose || "").toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("preview")) return { isBot: true, reason: `prefetch (${purpose})` };
  if (m.secFetchDest === "empty" && m.secFetchMode === "no-cors") return { isBot: true, reason: "background fetch" };
  const ua = (m.userAgent || "").toLowerCase();
  if (!ua) return { isBot: true, reason: "no user agent" };
  for (const [pattern, name] of BOT_SIGNATURES) if (ua.includes(pattern)) return { isBot: true, reason: name };
  if (/bot|spider|crawler|preview|scanner/.test(ua)) return { isBot: true, reason: "crawler keyword" };
  return { isBot: false, reason: "pending human check" };
}

const ipHash = (ip?: string | null) => (ip ? crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16) : null);

/** Safe http(s) URL or null. */
export function safeUrl(url: string | null | undefined) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Looks up a code and logs the hit. Returns where to send the visitor and how. */
export async function handleHit(code: string, meta: HitMeta) {
  if (!/^[a-z0-9]{4,12}$/i.test(code)) return null;
  const [row] = await db
    .select({ id: R.id, workspaceId: R.workspaceId, campaignId: R.campaignId, destinationUrl: C.destinationUrl })
    .from(R)
    .innerJoin(C, eq(C.id, R.campaignId))
    .where(eq(R.trackingCode, code.toLowerCase()))
    .limit(1);
  if (!row) return null;
  const destination = safeUrl(row.destinationUrl);
  if (!destination) return null;

  const bot = detectBot(meta);
  const base = {
    workspaceId: row.workspaceId,
    campaignId: row.campaignId,
    recipientId: row.id,
    ipHash: ipHash(meta.ip),
    userAgent: (meta.userAgent ?? "").slice(0, 400) || null
  };

  if (bot.isBot) {
    await db.insert(E).values({ ...base, isBot: true, reason: bot.reason });
    await Promise.all([
      db
        .update(R)
        .set({ botClickCount: sql`${R.botClickCount} + 1` })
        .where(eq(R.id, row.id)),
      db
        .update(C)
        .set({ botClicks: sql`${C.botClicks} + 1` })
        .where(eq(C.id, row.campaignId))
    ]);
    return { destination, html: null as string | null };
  }

  const token = crypto.randomBytes(16).toString("hex");
  await db.insert(E).values({ ...base, isBot: false, reason: bot.reason, verifyToken: token });
  return { destination, html: trampolineHtml(destination, token) };
}

/** The human-check page: JS sends the token back, then forwards. No JS → plain redirect (not counted). */
function trampolineHtml(destination: string, token: string) {
  const attr = destination.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const json = (v: string) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><noscript><meta http-equiv="refresh" content="0;url=${attr}"></noscript><title>Opening…</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#060a14;color:#8b95ab;font:500 13px system-ui,sans-serif}
.s{width:28px;height:28px;margin:0 auto 14px;border:3px solid rgba(59,107,255,.25);border-top-color:#3b6bff;border-radius:50%;animation:r .6s linear infinite}@keyframes r{to{transform:rotate(360deg)}}</style></head>
<body><div><div class="s"></div>Opening…</div><script>(function(){var d=${json(destination)};try{var p=JSON.stringify({t:${json(token)},w:screen.width||0,h:screen.height||0,touch:('ontouchstart' in window)||navigator.maxTouchPoints>0,ms:Math.round(performance.now())});
if(navigator.sendBeacon){navigator.sendBeacon('/go/verify',new Blob([p],{type:'application/json'}))}else{fetch('/go/verify',{method:'POST',body:p,headers:{'Content-Type':'application/json'},keepalive:true})}}catch(e){}
setTimeout(function(){location.replace(d)},60)})()</script></body></html>`;
}

/** Called by the page's beacon. Turns a pending hit into a counted human click (once). */
export async function verifyHuman(token: string, clientMeta: Record<string, unknown>) {
  if (!/^[a-f0-9]{32}$/.test(token)) return false;
  const now = new Date();
  // Claim the token atomically: unverified, recent, not a bot.
  const [ev] = await db
    .update(E)
    .set({ verified: true, verifiedAt: now, reason: "real browser", clientMeta })
    .where(and(eq(E.verifyToken, token), eq(E.verified, false), eq(E.isBot, false), gt(E.createdAt, new Date(now.getTime() - TOKEN_TTL_MS))))
    .returning({ recipientId: E.recipientId, campaignId: E.campaignId });
  if (!ev) return false;

  const [rec] = await db
    .select({ firstClickedAt: R.firstClickedAt, lastClickedAt: R.lastClickedAt, leadId: R.leadId })
    .from(R)
    .where(eq(R.id, ev.recipientId))
    .limit(1);
  if (!rec) return true;
  // Same person tapping twice within 2 s = one click.
  if (rec.lastClickedAt && now.getTime() - rec.lastClickedAt.getTime() < DUPLICATE_WINDOW_MS) return true;

  const first = !rec.firstClickedAt;
  await db
    .update(R)
    .set({ clickCount: sql`${R.clickCount} + 1`, lastClickedAt: now, ...(first ? { firstClickedAt: now } : {}) })
    .where(eq(R.id, ev.recipientId));
  await db
    .update(C)
    .set({ humanClicks: sql`${C.humanClicks} + 1`, ...(first ? { uniqueClickers: sql`${C.uniqueClickers} + 1` } : {}) })
    .where(eq(C.id, ev.campaignId));

  if (rec.leadId) {
    await db
      .update(L)
      .set({
        smsClicks: sql`${L.smsClicks} + 1`,
        lastClickedAt: now,
        updatedAt: now,
        ...(first ? { smsCampaignsClicked: sql`${L.smsCampaignsClicked} + 1` } : {}),
        // First real click moves a fresh lead forward in the pipeline.
        ...(first ? { status: sql`case when ${L.status} in ('new','contacted') then 'interested'::lead_status else ${L.status} end` } : {})
      })
      .where(eq(L.id, rec.leadId));
    if (first) {
      const [camp] = await db.select({ name: C.name, workspaceId: C.workspaceId }).from(C).where(eq(C.id, ev.campaignId)).limit(1);
      if (camp)
        await db.insert(schema.leadActivities).values({
          workspaceId: camp.workspaceId,
          leadId: rec.leadId,
          type: "click",
          body: `Clicked the SMS link — campaign “${camp.name}”`
        });
    }
  }
  return true;
}
