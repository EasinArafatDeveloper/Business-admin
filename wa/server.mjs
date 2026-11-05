// ScaleUp WhatsApp service — one WhatsApp Web session (linked by QR) behind a tiny internal HTTP API.
// Only reachable inside Docker (no public port). Every request needs the x-wa-secret header.
//
//   GET  /status            → { state, qr, me }
//   POST /check  {numbers}  → { results: { "8801…": true|false } }   (is the number on WhatsApp?)
//   POST /send   {to, text} → { ok, id } | { ok:false, error }
//   POST /logout            → unlink the device (a new QR appears)
//
// Incoming messages are forwarded to ADMIN_WEBHOOK_URL (for replies and "STOP" opt-outs).
import http from "node:http";
import { rm } from "node:fs/promises";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";

const PORT = Number(process.env.PORT ?? 4100);
const SECRET = process.env.WA_SECRET ?? "";
const AUTH_DIR = process.env.WA_AUTH_DIR ?? "/data/auth";
const WEBHOOK = process.env.ADMIN_WEBHOOK_URL ?? "";
if (SECRET.length < 32) throw new Error("WA_SECRET must be set (32+ characters)");

const logger = pino({ level: process.env.LOG_LEVEL ?? "warn" });
let sock = null;
let state = "connecting"; // connecting | qr | open | logged_out
let qrDataUrl = null;
let me = null;
let starting = false;

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const jidOf = (num) => `${digits(num)}@s.whatsapp.net`;

async function start() {
  if (starting) return;
  starting = true;
  try {
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    sock = makeWASocket({
      auth,
      version,
      logger,
      browser: Browsers.ubuntu("ScaleUp Admin"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (u.qr) {
        state = "qr";
        qrDataUrl = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
      }
      if (u.connection === "open") {
        state = "open";
        qrDataUrl = null;
        me = { id: digits(sock.user?.id?.split(":")[0]), name: sock.user?.name ?? null };
        console.log(`[wa] connected as ${me.id}`);
      }
      if (u.connection === "close") {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        me = null;
        if (code === DisconnectReason.loggedOut) {
          console.log("[wa] logged out — clearing session, new QR next");
          state = "logged_out";
          await rm(AUTH_DIR, { recursive: true, force: true });
        } else {
          state = "connecting";
        }
        starting = false;
        setTimeout(start, code === DisconnectReason.loggedOut ? 1000 : 3000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" || !WEBHOOK) return;
      for (const m of messages) {
        const jid = m.key.remoteJid ?? "";
        if (m.key.fromMe || !jid.endsWith("@s.whatsapp.net")) continue; // skip groups, status, own messages
        const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? "";
        if (!text) continue;
        fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-wa-secret": SECRET },
          body: JSON.stringify({ from: digits(jid), text: text.slice(0, 2000), name: m.pushName ?? null, at: Number(m.messageTimestamp) * 1000 })
        }).catch((e) => console.error("[wa] webhook failed", e.message));
      }
    });
  } catch (e) {
    console.error("[wa] start failed", e);
    starting = false;
    setTimeout(start, 5000);
  }
  starting = false;
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const send = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};

http
  .createServer(async (req, res) => {
    if (req.url === "/health") return send(res, 200, { ok: true, state });
    if (req.headers["x-wa-secret"] !== SECRET) return send(res, 403, { error: "forbidden" });
    try {
      if (req.method === "GET" && req.url === "/status") return send(res, 200, { state, qr: qrDataUrl, me });

      if (req.method === "POST" && req.url === "/logout") {
        await sock?.logout().catch(() => {});
        return send(res, 200, { ok: true });
      }

      if (state !== "open") return send(res, 409, { ok: false, error: "WhatsApp is not connected" });

      if (req.method === "POST" && req.url === "/check") {
        const { numbers = [] } = await readJson(req);
        const results = {};
        for (const n of numbers.slice(0, 50)) {
          const [r] = (await sock.onWhatsApp(jidOf(n)).catch(() => [])) ?? [];
          results[digits(n)] = Boolean(r?.exists);
        }
        return send(res, 200, { results });
      }

      if (req.method === "POST" && req.url === "/send") {
        const { to, text } = await readJson(req);
        if (!digits(to) || !text) return send(res, 400, { ok: false, error: "to and text are required" });
        const [r] = (await sock.onWhatsApp(jidOf(to)).catch(() => [])) ?? [];
        if (!r?.exists) return send(res, 200, { ok: false, error: "not_on_whatsapp" });
        // Show "typing…" briefly like a person would.
        await sock.presenceSubscribe(r.jid).catch(() => {});
        await sock.sendPresenceUpdate("composing", r.jid).catch(() => {});
        await new Promise((ok) => setTimeout(ok, 1200 + Math.random() * 1800));
        await sock.sendPresenceUpdate("paused", r.jid).catch(() => {});
        const sent = await sock.sendMessage(r.jid, { text: String(text).slice(0, 4000) });
        return send(res, 200, { ok: true, id: sent?.key?.id ?? null });
      }

      send(res, 404, { error: "not found" });
    } catch (e) {
      console.error("[wa] request failed", e);
      send(res, 500, { ok: false, error: e instanceof Error ? e.message : "error" });
    }
  })
  .listen(PORT, () => console.log(`[wa] listening on :${PORT}`));

start();
