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

    /** SMS engagement — only verified human clicks count (see lib/tracking.ts). */
    smsOptOut: boolean("sms_opt_out").notNull().default(false),
    waOptOut: boolean("wa_opt_out").notNull().default(false),
    smsClicks: integer("sms_clicks").notNull().default(0),
    smsCampaignsClicked: integer("sms_campaigns_clicked").notNull().default(0),
    lastClickedAt: timestamp("last_clicked_at", { withTimezone: true }),

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

/* ------------------------------------------------------------------ SMS campaigns */

/** draft → sending ⇄ paused → done | cancelled */
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  /** Template with {name} {service} {link}. */
  message: text("message").notNull(),
  destinationUrl: text("destination_url").notNull(),
  /** The /leads filter query the audience was built from (for reference). */
  audienceQuery: text("audience_query"),
  status: text("status").notNull().default("draft"),
  /** sms | whatsapp */
  channel: text("channel").notNull().default("sms"),
  ratePerMinute: integer("rate_per_minute").notNull().default(30),
  /** WhatsApp pacing: random gap between messages, max per day (all WA campaigns of the workspace). */
  minDelaySec: integer("min_delay_sec").notNull().default(30),
  maxDelaySec: integer("max_delay_sec").notNull().default(90),
  dailyLimit: integer("daily_limit").notNull().default(150),
  nextSendAt: timestamp("next_send_at", { withTimezone: true }),
  totalRecipients: integer("total_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  humanClicks: integer("human_clicks").notNull().default(0),
  uniqueClickers: integer("unique_clickers").notNull().default(0),
  botClicks: integer("bot_clicks").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true })
});

/** One row per person in a campaign, with their own tracking code. */
export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
    phone: text("phone").notNull(),
    message: text("message").notNull(),
    /** SMS parts this message costs (see lib/sms-text.ts). */
    parts: integer("parts").notNull().default(1),
    trackingCode: text("tracking_code").notNull().unique(),
    /** queued | sending | sent | failed */
    status: text("status").notNull().default("queued"),
    providerCode: text("provider_code"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    clickCount: integer("click_count").notNull().default(0),
    botClickCount: integer("bot_click_count").notNull().default(0),
    firstClickedAt: timestamp("first_clicked_at", { withTimezone: true }),
    lastClickedAt: timestamp("last_clicked_at", { withTimezone: true })
  },
  (t) => [
    index("campaign_recipients_queue_idx").on(t.campaignId, t.status),
    index("campaign_recipients_lead_idx").on(t.leadId)
  ]
);

/** Every hit on a tracking link: bots are logged but never counted as clicks. */
export const clickEvents = pgTable(
  "click_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => campaignRecipients.id, { onDelete: "cascade" }),
    isBot: boolean("is_bot").notNull(),
    reason: text("reason").notNull(),
    /** One-time token the human-check page sends back; null for bots. */
    verifyToken: text("verify_token"),
    verified: boolean("verified").notNull().default(false),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    clientMeta: jsonb("client_meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true })
  },
  (t) => [index("click_events_token_idx").on(t.verifyToken), index("click_events_recipient_idx").on(t.recipientId, t.createdAt)]
);

export type Campaign = typeof campaigns.$inferSelect;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;

/** Messages people send back to us (WhatsApp replies now, email later) — matched to a lead when possible. */
export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // whatsapp | email
    sender: text("sender").notNull(),
    senderName: text("sender_name"),
    body: text("body").notNull(),
    leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
    optOut: boolean("opt_out").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("inbound_messages_ws_idx").on(t.workspaceId, t.createdAt)]
);
