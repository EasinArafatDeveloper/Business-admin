/**
 * Tracking engine test against a throwaway database (no SMS is sent):
 *   DATABASE_URL=postgres://…/scaleup_admin_test npx tsx --conditions=react-server scripts/test-tracking.ts
 */
import { eq } from "drizzle-orm";

const UA = {
  whatsapp: "WhatsApp/2.23.20.0 A",
  truecaller: "Mozilla/5.0 (Linux; Android 13) Truecaller/13.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"
};

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

async function main() {
  if (!/_test\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must point at a *_test database");
  const { runMigrations } = await import("../db/migrate");
  await runMigrations();
  const { db, schema } = await import("../db");
  const { createCampaignWithRecipients } = await import("../lib/campaigns");
  const { handleHit, verifyHuman, detectBot } = await import("../lib/tracking");
  const { parseFilters } = await import("../lib/leads-query");

  const [ws] = await db.insert(schema.workspaces).values({ name: "T", slug: `t-${Date.now()}` }).returning();
  await db.insert(schema.leads).values([
    { workspaceId: ws.id, externalKey: "a", pageName: "Shop A", phone: "01711-000001", priority: "A - Hot" },
    { workspaceId: ws.id, externalKey: "b", pageName: "Shop B", phone: "+8801711000001", priority: "A - Hot" }, // same number
    { workspaceId: ws.id, externalKey: "c", pageName: "Shop C", phone: "12345", priority: "A - Hot" }, // invalid
    { workspaceId: ws.id, externalKey: "d", pageName: "Shop D", whatsapp: "8801911000002", priority: "A - Hot", smsOptOut: true }
  ]);

  const [u] = await db.insert(schema.users).values({ workspaceId: ws.id, name: "t", email: `t${Date.now()}@test.local`, passwordHash: "x" }).returning();
  const id = await createCampaignWithRecipients({
    workspaceId: ws.id,
    userId: u.id,
    name: "Test",
    message: "Hi {name}, see {link}",
    destinationUrl: "https://scaleupweb.xyz/free-audit",
    audienceQuery: "",
    ratePerMinute: 30,
    filters: parseFilters({}),
    cleanNames: true
  });

  const recs = await db.select().from(schema.campaignRecipients).where(eq(schema.campaignRecipients.campaignId, id));
  check("audience: 1 person (duplicate number, invalid number and opted-out lead removed)", recs.length === 1);
  const r = recs[0];
  check(`message rendered with name + unique link: "${r.message}"`, r.message.startsWith("Hi Shop A, see ") && r.message.includes(`/${r.trackingCode}`));

  check("detectBot: WhatsApp preview is a bot", detectBot({ userAgent: UA.whatsapp }).isBot);
  check("detectBot: Chrome on Android is not a bot", !detectBot({ userAgent: UA.chromeAndroid }).isBot);
  check("detectBot: prefetch header is a bot", detectBot({ userAgent: UA.chromeAndroid, secPurpose: "prefetch" }).isBot);

  const bot = await handleHit(r.trackingCode, { userAgent: UA.truecaller });
  check("bot hit → plain redirect, no check page", Boolean(bot && !bot.html && bot.destination.includes("free-audit")));

  const human = await handleHit(r.trackingCode, { userAgent: UA.chromeAndroid, ip: "1.2.3.4" });
  check("human-looking hit → check page", Boolean(human?.html?.includes("/go/verify")));
  const token = human?.html?.match(/t:"([a-f0-9]{32})"/)?.[1] ?? "";

  let [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  check("before the beacon nothing is counted as a click", c.humanClicks === 0 && c.botClicks === 1);

  check("beacon with the token verifies", await verifyHuman(token, { screenWidth: 412 }));
  check("same token can't be used twice", !(await verifyHuman(token, {})));
  check("made-up token is rejected", !(await verifyHuman("0".repeat(32), {})));

  // second tap right away → duplicate (not counted)
  const again = await handleHit(r.trackingCode, { userAgent: UA.chromeAndroid });
  const t2 = again?.html?.match(/t:"([a-f0-9]{32})"/)?.[1] ?? "";
  await verifyHuman(t2, {});

  [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  const [rec] = await db.select().from(schema.campaignRecipients).where(eq(schema.campaignRecipients.id, r.id));
  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, r.leadId!));
  check(`counts: 1 real click, 1 person, 1 bot hit (got ${c.humanClicks}/${c.uniqueClickers}/${c.botClicks})`, c.humanClicks === 1 && c.uniqueClickers === 1 && c.botClicks === 1);
  check("recipient marked clicked", rec.clickCount === 1 && Boolean(rec.firstClickedAt));
  check(`lead moved new → interested (got ${lead.status}), smsClicks=${lead.smsClicks}`, lead.status === "interested" && lead.smsClicks === 1);

  // ---- name cleaning + exact cost estimate
  const { cleanName, groupAudience, estimateParts, renderTemplate, smsParts } = await import("../lib/sms-text");
  check("cleanName drops emoji", cleanName("Smart Shop 🛍️") === "Smart Shop");
  check("cleanName keeps the English part", cleanName("রাব্বানী Rabbani") === "Rabbani");
  check("cleanName: fully Bangla → null (Sir/Madam)", cleanName("রাব্বানী দাওয়া") === null);
  const people = [
    { name: "Sign of Modesty", service: "AI Chatbot (Messenger)" },
    { name: "Smart Shop 🛍️", service: "E-commerce Website" },
    { name: "রাব্বানী দাওয়া সেন্টার বাংলাদেশ", service: "Business Website" },
    { name: "Hijama Planet: Cupping & Ruqyah Center — Dhaka branch with a very long page name", service: null },
    { name: null, service: null }
  ];
  const link = "https://admin.scaleupweb.xyz/go/abc234";
  for (const tpl of [
    "Assalamu Alaikum {name}! Apnar business er jonno ekta fast website + auto order system banale order 24/7 ashbe. Free audit nite: {link} - ScaleUp Web",
    "Hi {name}, {service} ready? {link}",
    "আসসালামু আলাইকুম {name}! {link}"
  ]) {
    for (const cleanNames of [false, true]) {
      const real = people.reduce((n, p) => n + smsParts(renderTemplate(tpl, { ...p, link }, { cleanNames })).parts, 0);
      const est = estimateParts(tpl, groupAudience(people), link.length, { cleanNames }).totalParts;
      check(`estimate = real parts (${real}) for "${tpl.slice(0, 22)}…" cleanNames=${cleanNames}`, est === real);
    }
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
