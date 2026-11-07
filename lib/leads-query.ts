import "server-only";
import { and, asc, desc, eq, gte, ilike, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/constants";

const L = schema.leads;

/** Every filter lives in the URL (?industry=…&has=whatsapp…) so a view can be bookmarked. */
export type LeadFilters = {
  q?: string;
  status?: LeadStatus;
  priority?: string;
  industry?: string;
  service?: string;
  size?: string;
  webType?: string;
  platform?: string;
  orders?: string;
  source?: string;
  bd?: "yes" | "no";
  has: ("phone" | "whatsapp" | "email" | "website")[];
  minScore?: number;
  minAds?: number;
  /** Only leads saved in this list (Leads → Saved lists). */
  list?: number;
  /** With a list: only its entries in this offer group (e.g. "Website"). */
  tag?: string;
  /** Leads carrying this tag (leads.tags), e.g. "hot". */
  label?: string;
  sort: "score" | "followers" | "ads" | "newest" | "name";
  page: number;
};

export const PAGE_SIZE = 50;
const HAS = ["phone", "whatsapp", "email", "website"] as const;
const SORTS = ["score", "followers", "ads", "newest", "name"] as const;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export function parseFilters(sp: Params): LeadFilters {
  const hasRaw = sp.has === undefined ? [] : Array.isArray(sp.has) ? sp.has : [sp.has];
  const status = one(sp.status);
  const sort = one(sp.sort);
  return {
    q: one(sp.q),
    status: LEAD_STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : undefined,
    priority: one(sp.priority),
    industry: one(sp.industry),
    service: one(sp.service),
    size: one(sp.size),
    webType: one(sp.webType),
    platform: one(sp.platform),
    orders: one(sp.orders),
    source: one(sp.source),
    bd: one(sp.bd) === "yes" ? "yes" : one(sp.bd) === "no" ? "no" : undefined,
    has: hasRaw.filter((h): h is LeadFilters["has"][number] => (HAS as readonly string[]).includes(h)),
    minScore: num(one(sp.minScore)),
    minAds: num(one(sp.minAds)),
    list: num(one(sp.list)),
    tag: one(sp.tag)?.slice(0, 60),
    label: one(sp.label)?.toLowerCase().slice(0, 40),
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as LeadFilters["sort"]) : "score",
    page: Math.max(1, num(one(sp.page)) ?? 1)
  };
}

/** Builds the URL query for a filter set (used by links, pagination and export). */
export function filtersToQuery(f: LeadFilters, override: Partial<LeadFilters> = {}) {
  const merged = { ...f, ...override };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "" || (k === "page" && v === 1) || (k === "sort" && v === "score")) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function whereFor(workspaceId: number, f: LeadFilters): SQL {
  const conds: (SQL | undefined)[] = [eq(L.workspaceId, workspaceId)];
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    conds.push(
      or(
        ilike(L.pageName, like),
        ilike(L.category, like),
        ilike(L.phone, like),
        ilike(L.whatsapp, like),
        ilike(L.email, like),
        ilike(L.address, like),
        ilike(L.website, like)
      )
    );
  }
  if (f.status) conds.push(eq(L.status, f.status));
  if (f.priority) conds.push(eq(L.priority, f.priority));
  if (f.industry) conds.push(eq(L.industry, f.industry));
  if (f.service) conds.push(eq(L.primaryService, f.service));
  if (f.size) conds.push(eq(L.sizeTier, f.size));
  if (f.webType) conds.push(eq(L.websiteType, f.webType));
  if (f.platform) conds.push(eq(L.websitePlatform, f.platform));
  if (f.orders) conds.push(ilike(L.ordersVia, `%${f.orders}%`));
  if (f.source) conds.push(eq(L.source, f.source));
  if (f.label) conds.push(sql`${L.tags} @> array[${f.label}]::text[]`);
  if (f.bd) conds.push(eq(L.inBangladesh, f.bd === "yes"));
  if (f.minScore !== undefined) conds.push(gte(L.score, f.minScore));
  if (f.minAds !== undefined) conds.push(gte(L.activeAds, f.minAds));
  if (f.list !== undefined)
    conds.push(
      f.tag
        ? sql`exists (select 1 from lead_list_items li where li.list_id = ${f.list} and li.lead_id = ${L.id} and li.tag = ${f.tag})`
        : sql`exists (select 1 from lead_list_items li where li.list_id = ${f.list} and li.lead_id = ${L.id})`
    );
  for (const h of f.has) {
    const col = { phone: L.phone, whatsapp: L.whatsapp, email: L.email, website: L.website }[h];
    conds.push(and(isNotNull(col), ne(col, "")));
  }
  return and(...conds)!;
}

function orderFor(f: LeadFilters) {
  switch (f.sort) {
    case "followers":
      return [sql`${L.followers} desc nulls last`, desc(L.id)];
    case "ads":
      return [sql`${L.activeAds} desc nulls last`, desc(L.id)];
    case "newest":
      return [desc(L.createdAt), desc(L.id)];
    case "name":
      return [asc(L.pageName), asc(L.id)];
    default:
      return [sql`${L.score} desc nulls last`, desc(L.id)];
  }
}

export async function findLeads(workspaceId: number, f: LeadFilters) {
  const where = whereFor(workspaceId, f);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: L.id,
        pageName: L.pageName,
        industry: L.industry,
        category: L.category,
        score: L.score,
        priority: L.priority,
        primaryService: L.primaryService,
        sizeTier: L.sizeTier,
        followers: L.followers,
        phone: L.phone,
        whatsapp: L.whatsapp,
        email: L.email,
        websiteType: L.websiteType,
        ordersVia: L.ordersVia,
        activeAds: L.activeAds,
        status: L.status,
        tags: L.tags,
        source: L.source,
        createdAt: L.createdAt
      })
      .from(L)
      .where(where)
      .orderBy(...orderFor(f))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(L)
      .where(where)
  ]);
  return { rows, total };
}

/** Value + count lists for the filter dropdowns (most common first). */
export async function filterOptions(workspaceId: number) {
  const col = async (c: AnyPgColumn) =>
    db
      .select({ value: sql<string | null>`${c}`, count: sql<number>`count(*)::int` })
      .from(L)
      .where(and(eq(L.workspaceId, workspaceId), isNotNull(c), ne(c, "")))
      .groupBy(c)
      .orderBy(sql`count(*) desc`)
      .limit(60);
  const tagsQ = db
    .select({ value: sql<string | null>`t.tag`, count: sql<number>`count(*)::int` })
    .from(sql`${L}, unnest(${L.tags}) as t(tag)`)
    .where(eq(L.workspaceId, workspaceId))
    .groupBy(sql`t.tag`)
    .orderBy(sql`count(*) desc`)
    .limit(100);
  const [priority, industry, service, size, webType, platform, source, tags] = await Promise.all([
    col(L.priority),
    col(L.industry),
    col(L.primaryService),
    col(L.sizeTier),
    col(L.websiteType),
    col(L.websitePlatform),
    col(L.source),
    tagsQ
  ]);
  return { priority, industry, service, size, webType, platform, source, tags };
}

export type FilterOptions = Awaited<ReturnType<typeof filterOptions>>;
