import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { LEAD_STATUSES } from "@/lib/constants";

export { LEAD_STATUSES, type LeadStatus } from "@/lib/constants";

/**
 * Multi-tenant from day one: every row belongs to a workspace (one business).
 * Today there is one workspace (ScaleUp Web); later each SaaS customer gets their own.
 */
export const workspaces = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"), // owner | admin | member
  /** Bumped on password change / "sign out everywhere" — invalidates old session cookies. */
  sessionVersion: integer("session_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true })
});

export const leadStatus = pgEnum("lead_status", LEAD_STATUSES);

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** import | website-contact | website-audit | manual */
    source: text("source").notNull().default("import"),
    /** De-duplication key inside a workspace (e.g. the Facebook page link). */
    externalKey: text("external_key").notNull(),

    pageName: text("page_name"),
    industry: text("industry"),
    category: text("category"),
    sizeTier: text("size_tier"),
    followers: integer("followers"),
    score: integer("score"),
    priority: text("priority"),
    primaryService: text("primary_service"),
    serviceCategory: text("service_category"),
    painPoint: text("pain_point"),
    otherServices: text("other_services"),
    allServices: text("all_services"),
    serviceGaps: integer("service_gaps"),
    pitch: text("pitch"),

    phone: text("phone"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    website: text("website"),
    websiteType: text("website_type"),
    websitePlatform: text("website_platform"),
    ordersVia: text("orders_via"),
    activeAds: integer("active_ads"),
    runningDays: integer("running_days"),
    offers: text("offers"),
    adPriceRange: text("ad_price_range"),
    address: text("address"),
    pageLink: text("page_link"),
    adsLibraryLink: text("ads_library_link"),
    inBangladesh: boolean("in_bangladesh"),

    status: leadStatus("status").notNull().default("new"),
    /** Extra data that has no column (e.g. website form answers). */
    details: jsonb("details").$type<Record<string, string>>(),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("leads_workspace_key_idx").on(t.workspaceId, t.externalKey),
    index("leads_status_idx").on(t.workspaceId, t.status),
    index("leads_priority_idx").on(t.workspaceId, t.priority),
    index("leads_industry_idx").on(t.workspaceId, t.industry),
    index("leads_service_idx").on(t.workspaceId, t.primaryService),
    index("leads_score_idx").on(t.workspaceId, t.score),
    index("leads_source_idx").on(t.workspaceId, t.source, t.createdAt)
  ]
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** note | status | created | form */
    type: text("type").notNull(),
    body: text("body"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("lead_activities_lead_idx").on(t.leadId, t.createdAt)]
);

export const imports = pgTable("imports", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  sheet: text("sheet"),
  /** queued | running | done | failed */
  status: text("status").notNull().default("queued"),
  total: integer("total").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true })
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type User = typeof users.$inferSelect;
