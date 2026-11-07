import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Email unsubscribe. GET shows a confirm button (link scanners must not unsubscribe people);
 * POST unsubscribes — also used by Gmail/Outlook's one-click "Unsubscribe" (RFC 8058).
 */
const R = schema.campaignRecipients;

async function recipientFor(code: string) {
  if (!/^[a-z0-9]{6,12}$/.test(code)) return null;
  const [r] = await db.select({ id: R.id, leadId: R.leadId, workspaceId: R.workspaceId, email: R.phone }).from(R).where(eq(R.trackingCode, code)).limit(1);
  return r ?? null;
}

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Arial,sans-serif;background:#f3f5fa;color:#0f172a}
main{max-width:420px;margin:24px;padding:32px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#556074;font-size:14px;line-height:1.5}button{margin-top:12px;height:42px;padding:0 20px;border:0;border-radius:10px;background:#3b6bff;color:#fff;font-size:14px;cursor:pointer}</style>
</head><body><main>${body}</main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } }
  );

export async function GET(_: Request, ctx: RouteContext<"/u/[code]">) {
  const { code } = await ctx.params;
  const r = await recipientFor(code);
  if (!r) return page("Link not found", "<h1>Link not found</h1><p>This unsubscribe link is not valid.</p>");
  return page(
    "Unsubscribe",
    `<h1>Unsubscribe?</h1><p>You won't get any more emails from us at <b>${r.email.replace(/[<>&"]/g, "")}</b>.</p><form method="post"><button type="submit">Yes, unsubscribe me</button></form>`
  );
}

export async function POST(_: Request, ctx: RouteContext<"/u/[code]">) {
  const { code } = await ctx.params;
  const r = await recipientFor(code);
  if (r?.leadId) {
    const L = schema.leads;
    const [lead] = await db
      .update(L)
      .set({ emailOptOut: true, updatedAt: new Date() })
      .where(and(eq(L.id, r.leadId), eq(L.workspaceId, r.workspaceId), eq(L.emailOptOut, false)))
      .returning({ id: L.id });
    if (lead) {
      await db.insert(schema.leadActivities).values({ workspaceId: r.workspaceId, leadId: r.leadId, type: "email_optout", channel: "email", body: "Unsubscribed from emails" });
    }
  }
  return page("Unsubscribed", "<h1>You're unsubscribed</h1><p>You won't receive any more emails from us. Sorry for the bother.</p>");
}
