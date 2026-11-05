import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiUser } from "@/lib/auth";
import { parseFilters, whereFor } from "@/lib/leads-query";

const L = schema.leads;
const COLUMNS = [
  ["Page Name", L.pageName],
  ["Status", L.status],
  ["Priority", L.priority],
  ["Lead Score", L.score],
  ["Industry", L.industry],
  ["Category", L.category],
  ["Size Tier", L.sizeTier],
  ["Followers", L.followers],
  ["Primary Service", L.primaryService],
  ["Pitch Message", L.pitch],
  ["Phone", L.phone],
  ["WhatsApp", L.whatsapp],
  ["Email", L.email],
  ["Website", L.website],
  ["Website Type", L.websiteType],
  ["Orders Via", L.ordersVia],
  ["Active Ads", L.activeAds],
  ["Address", L.address],
  ["Page Link", L.pageLink],
  ["Source", L.source]
] as const;

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of every lead matching the current filters (same URL params as /leads). */
export async function GET(request: Request) {
  const user = await apiUser("leads");
  if (!user) return new Response("Not signed in", { status: 401 });

  const filters = parseFilters(Object.fromEntries(new URL(request.url).searchParams.entries()));
  // `has` can repeat in the URL — re-read all values.
  filters.has = parseFilters({ has: new URL(request.url).searchParams.getAll("has") }).has;

  const select = Object.fromEntries(COLUMNS.map(([, col], i) => [`c${i}`, col])) as Record<string, (typeof COLUMNS)[number][1]>;
  const rows = await db.select(select).from(L).where(whereFor(user.workspaceId, filters)).orderBy(asc(L.id)).limit(200_000);

  const lines = [COLUMNS.map(([name]) => name).join(",")];
  for (const r of rows) lines.push(COLUMNS.map((_, i) => csvCell((r as Record<string, unknown>)[`c${i}`])).join(","));

  const stamp = new Date().toISOString().slice(0, 10);
  // BOM so Excel opens Bangla text correctly.
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`
    }
  });
}
