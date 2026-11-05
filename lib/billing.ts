import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BillingProfile } from "@/db/schema";

const I = schema.invoices;

export async function getBilling(workspaceId: number): Promise<{ name: string; billing: BillingProfile }> {
  const [ws] = await db
    .select({ name: schema.workspaces.name, billing: schema.workspaces.billing })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return { name: ws?.name ?? "", billing: ws?.billing ?? {} };
}

export const invoicePrefix = (b: BillingProfile) => (b.invoicePrefix?.trim() || "INV").toUpperCase().replace(/[^A-Z0-9-]/g, "");

/** Next number like "SU-2026-0007": prefix, year, then a running count for that year. */
export async function nextInvoiceNumber(workspaceId: number, prefix: string, now = new Date()) {
  const year = now.getFullYear();
  const stem = `${prefix}-${year}-`;
  const [last] = await db
    .select({ number: I.number })
    .from(I)
    .where(and(eq(I.workspaceId, workspaceId), like(I.number, `${stem}%`)))
    .orderBy(desc(sql`length(${I.number})`), desc(I.number))
    .limit(1);
  const n = last ? Number(last.number.slice(stem.length)) || 0 : 0;
  return `${stem}${String(n + 1).padStart(4, "0")}`;
}

export const publicToken = () => randomBytes(18).toString("base64url");

/** Public invoice address (same host as the admin). */
export function invoiceUrl(token: string) {
  const base = (process.env.LINK_BASE_URL ?? "https://admin.scaleupweb.xyz/go").replace(/\/go\/?$/, "");
  return `${new URL(base).origin}/i/${token}`;
}

/** Re-adds payments onto the invoice (after a payment is recorded or deleted). */
export async function refreshPaid(invoiceId: number) {
  const P = schema.payments;
  const [{ paid }] = await db
    .select({ paid: sql<number>`coalesce(sum(${P.amount}), 0)::int` })
    .from(P)
    .where(eq(P.invoiceId, invoiceId));
  const [inv] = await db.select({ total: I.total, status: I.status, paidAt: I.paidAt }).from(I).where(eq(I.id, invoiceId)).limit(1);
  if (!inv) return;
  const fullyPaid = inv.total > 0 && paid >= inv.total;
  await db
    .update(I)
    .set({
      amountPaid: paid,
      paidAt: fullyPaid ? (inv.paidAt ?? new Date()) : null,
      // Recording money on a draft means it went out.
      status: inv.status === "draft" && paid > 0 ? "sent" : inv.status,
      updatedAt: new Date()
    })
    .where(eq(I.id, invoiceId));
}
