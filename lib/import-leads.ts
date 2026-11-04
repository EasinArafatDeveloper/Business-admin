import "server-only";
import { unlink } from "node:fs/promises";
import ExcelJS from "exceljs";
import { eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LeadStatus, NewLead } from "@/db/schema";

const L = schema.leads;
const BATCH = 500;

type Field = Exclude<keyof NewLead, "id" | "workspaceId" | "source" | "externalKey" | "createdAt" | "updatedAt">;
type Kind = "text" | "int" | "bool";

/** Excel header → lead column. Matches the FB Ad Lead Finder export ("All Leads" sheet). */
const COLUMNS: Record<string, [Field, Kind]> = {
  "lead score": ["score", "int"],
  priority: ["priority", "text"],
  "page name": ["pageName", "text"],
  industry: ["industry", "text"],
  category: ["category", "text"],
  "size tier": ["sizeTier", "text"],
  followers: ["followers", "int"],
  "primary service": ["primaryService", "text"],
  "service category": ["serviceCategory", "text"],
  "why (pain point)": ["painPoint", "text"],
  "other services": ["otherServices", "text"],
  "all fitting services": ["allServices", "text"],
  "# service gaps": ["serviceGaps", "int"],
  "pitch message (draft)": ["pitch", "text"],
  phone: ["phone", "text"],
  whatsapp: ["whatsapp", "text"],
  email: ["email", "text"],
  website: ["website", "text"],
  "website type": ["websiteType", "text"],
  "website platform": ["websitePlatform", "text"],
  "orders via": ["ordersVia", "text"],
  "active ads": ["activeAds", "int"],
  "running days": ["runningDays", "int"],
  offers: ["offers", "text"],
  "ad price range": ["adPriceRange", "text"],
  address: ["address", "text"],
  "page link": ["pageLink", "text"],
  "page ads (library)": ["adsLibraryLink", "text"],
  bangladesh: ["inBangladesh", "bool"],
  status: ["status", "text"]
};

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("").trim();
    if (o.text != null) return cellText(o.text);
    if (o.result != null) return cellText(o.result);
    if (o.hyperlink) return o.hyperlink;
  }
  return "";
}

function convert(raw: string, kind: Kind): string | number | boolean | null {
  if (raw === "") return null;
  if (kind === "int") {
    const n = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  if (kind === "bool") return /^(yes|true|1)$/i.test(raw);
  return raw.slice(0, 4000);
}

/** Same Facebook page written differently (m./web./http/trailing slash/query) → one key. */
function normalizeLink(link: string) {
  return link
    .trim()
    .toLowerCase()
    .replace(/^http:\/\//, "https://")
    .replace(/^https:\/\/(m|web|mbasic)\.facebook\.com/, "https://www.facebook.com")
    .replace(/^https:\/\/facebook\.com/, "https://www.facebook.com")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function toStatus(raw: unknown): LeadStatus {
  return String(raw ?? "").toLowerCase() === "contacted" ? "contacted" : "new";
}

async function setProgress(id: number, values: Partial<typeof schema.imports.$inferInsert>) {
  await db.update(schema.imports).set(values).where(eq(schema.imports.id, id));
}

/**
 * On re-import, refresh every imported column from the file, but never touch work done in the admin:
 * status only moves "new" → whatever the sheet says (e.g. "contacted"); notes live in another table.
 */
const UPSERT_SET: Record<string, SQL> = {
  ...Object.fromEntries(
    Object.values(COLUMNS)
      .map(([field]) => field)
      .filter((field) => field !== "status")
      .map((field) => [field, sql.raw(`excluded."${getTableColumns(L)[field].name}"`)])
  ),
  status: sql`case when ${L.status} = 'new' then excluded.status else ${L.status} end`,
  updatedAt: sql`now()`
};

type Counts = { processed: number; inserted: number; updated: number; skipped: number };

/** Imports one worksheet if it is a lead sheet. Returns true if it was. Always reads the sheet to the end. */
async function importSheet(
  ws: AsyncIterable<unknown> & { name?: string },
  ctx: { importId: number; workspaceId: number; counts: Counts; skip: boolean }
) {
  const { importId, workspaceId, counts } = ctx;
  let map: ([Field, Kind] | undefined)[] | null = null;
  let isLeadSheet = false;
  let statusIdx = -1;
  let batch = new Map<string, NewLead>();

  const flush = async () => {
    if (batch.size === 0) return;
    const rows = [...batch.values()];
    batch = new Map();
    const res = await db
      .insert(L)
      .values(rows)
      .onConflictDoUpdate({ target: [L.workspaceId, L.externalKey], set: UPSERT_SET })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const r of res) {
      if (r.inserted) counts.inserted++;
      else counts.updated++;
    }
    await setProgress(importId, { total: counts.processed, inserted: counts.inserted, updated: counts.updated, skipped: counts.skipped });
  };

  for await (const row of ws) {
    if (ctx.skip) continue;
    const values = ((row as { values?: unknown[] }).values ?? []).slice(1).map(cellText);

    if (!map) {
      map = values.map((h) => COLUMNS[h.toLowerCase()]);
      isLeadSheet = map.some((m) => m?.[0] === "pageLink" || m?.[0] === "pageName");
      statusIdx = map.findIndex((m) => m?.[0] === "status");
      if (isLeadSheet) await setProgress(importId, { sheet: ws.name ?? null });
      continue;
    }
    if (!isLeadSheet) continue; // Summary, Playbook… — read through, don't import

    counts.processed++;
    const lead: Record<string, unknown> = {};
    map.forEach((m, i) => {
      if (m && m[0] !== "status") lead[m[0]] = convert(values[i] ?? "", m[1]);
    });
    const link = lead.pageLink ? normalizeLink(String(lead.pageLink)) : "";
    const key = link || (lead.pageName ? `name:${String(lead.pageName).toLowerCase()}|${lead.phone ?? ""}` : "");
    if (!key) {
      counts.skipped++;
      continue;
    }
    batch.set(key, {
      ...(lead as Partial<NewLead>),
      workspaceId,
      source: "import",
      externalKey: key,
      status: toStatus(statusIdx >= 0 ? values[statusIdx] : "")
    });
    if (batch.size >= BATCH) await flush();
  }
  await flush();
  return isLeadSheet;
}

/**
 * Runs in the background after upload. Imports the "All Leads" sheet (or the first sheet with a
 * "Page Link" / "Page Name" column). Sheets named "Hot …" are a subset, so they're only used when
 * nothing else matches.
 */
export async function runImport(importId: number, workspaceId: number, filePath: string) {
  const counts: Counts = { processed: 0, inserted: 0, updated: 0, skipped: 0 };
  try {
    await setProgress(importId, { status: "running" });
    let imported = false;
    for (const allowHot of [false, true]) {
      if (imported) break;
      const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
        sharedStrings: "cache",
        hyperlinks: "ignore",
        styles: "ignore",
        worksheets: "emit"
      });
      for await (const ws of reader) {
        const sheet = ws as unknown as AsyncIterable<unknown> & { name?: string };
        const skip = imported || (!allowHot && /hot/i.test(sheet.name ?? ""));
        if (await importSheet(sheet, { importId, workspaceId, counts, skip })) imported = true;
      }
    }
    if (!imported) throw new Error("No sheet with a 'Page Link' or 'Page Name' column was found.");
    await setProgress(importId, { status: "done", total: counts.processed, inserted: counts.inserted, updated: counts.updated, skipped: counts.skipped, finishedAt: new Date() });
  } catch (e) {
    await setProgress(importId, {
      status: "failed",
      error: e instanceof Error ? e.message.slice(0, 500) : String(e),
      total: counts.processed,
      inserted: counts.inserted,
      updated: counts.updated,
      skipped: counts.skipped,
      finishedAt: new Date()
    });
  } finally {
    await unlink(filePath).catch(() => {});
  }
}
