import {
  boolean,
  customType,
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
  /** Business details printed on invoices (address, phone, payment instructions…). */
  billing: jsonb("billing").$type<BillingProfile>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export type BillingProfile = {
  legalName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** e.g. "bKash (personal): 01XXXXXXXXX
Bank: …" */
  paymentInfo?: string;
  /** Shown on the public invoice so clients can pay by themselves. */
  bkashNumber?: string;
  bkashType?: "personal" | "merchant" | "agent";
  nagadNumber?: string;
  bankDetails?: string;
  /** Discount for sharing a post about you (0 = off). */
  shareDiscountPercent?: number;
  invoicePrefix?: string;
  defaultTerms?: string;
  dueDays?: number;
};

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"), // owner | admin | member
  /** Sections a member can open (see lib/permissions.ts). Owners and admins can open everything. */
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  /** active | disabled — disabled people cannot sign in. */
  status: text("status").notNull().default("active"),
  invitedBy: integer("invited_by"),
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
    emailOptOut: boolean("email_opt_out").notNull().default(false),
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
  /** sms | whatsapp | email */
  channel: text("channel").notNull().default("sms"),
  /** Email only: subject template and the sender account it goes out from. */
  subject: text("subject"),
  senderId: integer("sender_id").references(() => emailSenders.id, { onDelete: "set null" }),
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

/**
 * Email accounts a workspace sends from (e.g. hello@scaleupweb.xyz via Gmail SMTP, later Brevo/SES).
 * One per business/domain; the SMTP password is stored encrypted (lib/secrets.ts).
 */
export const emailSenders = pgTable("email_senders", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  replyTo: text("reply_to"),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(465),
  smtpUser: text("smtp_user").notNull(),
  smtpPassEnc: text("smtp_pass_enc").notNull(),
  /** Max emails per day from this sender, across all campaigns (Gmail allows ~500). */
  dailyLimit: integer("daily_limit").notNull().default(100),
  signature: text("signature"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastError: text("last_error"),
  /** Reply sync: read this mailbox over IMAP and bring replies from leads into the Inbox. */
  imapHost: text("imap_host"),
  imapUidValidity: text("imap_uid_validity"),
  imapLastUid: integer("imap_last_uid").notNull().default(0),
  imapCheckedAt: timestamp("imap_checked_at", { withTimezone: true }),
  imapError: text("imap_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
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
    /** Mobile number, or the email address for email campaigns. */
    phone: text("phone").notNull(),
    message: text("message").notNull(),
    subject: text("subject"),
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
export type EmailSender = typeof emailSenders.$inferSelect;
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
    /** in = they wrote to us · out = our reply from the Inbox */
    direction: text("direction").notNull().default("in"),
    /** Email only: subject, the Message-ID (for threading + de-duplication) and the mailbox it came through. */
    subject: text("subject"),
    externalId: text("external_id"),
    emailSenderId: integer("email_sender_id").references(() => emailSenders.id, { onDelete: "set null" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("inbound_messages_ws_idx").on(t.workspaceId, t.createdAt), index("inbound_messages_sender_idx").on(t.workspaceId, t.sender),
    uniqueIndex("inbound_messages_external_idx").on(t.workspaceId, t.externalId)
  ]
);

/* ---------------------------------------------------------------- clients & billing */

/** A business you work for. Can come from a lead (leadId) or be added by hand. */
export const clients = pgTable(
  "clients",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    website: text("website"),
    notes: text("notes"),
    /** active | paused | past */
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("clients_ws_idx").on(t.workspaceId, t.name), uniqueIndex("clients_lead_idx").on(t.workspaceId, t.leadId)]
);

/**
 * Amounts are stored in poisha (৳1 = 100) so totals never round wrongly.
 * status: draft | sent | paid | void  (partly paid / overdue are worked out from amounts and the due date)
 */
export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    status: text("status").notNull().default("draft"),
    issueDate: timestamp("issue_date", { withTimezone: true }).notNull().defaultNow(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    currency: text("currency").notNull().default("BDT"),
    subtotal: integer("subtotal").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    total: integer("total").notNull().default(0),
    amountPaid: integer("amount_paid").notNull().default(0),
    notes: text("notes"),
    terms: text("terms"),
    /** Secret for the public invoice link (/i/<token>). */
    publicToken: text("public_token").notNull().unique(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("invoices_number_idx").on(t.workspaceId, t.number), index("invoices_client_idx").on(t.clientId)]
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: integer("unit_price").notNull().default(0),
    amount: integer("amount").notNull().default(0)
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId, t.position)]
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    /** bkash | nagad | rocket | bank | cash | card | other */
    method: text("method").notNull(),
    reference: text("reference"),
    note: text("note"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)]
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * What a client sends from the public invoice page: a payment (TrxID + screenshot) or a share
 * (link to their post, for the share discount). Nothing counts until you approve it in the admin.
 */
export const invoiceSubmissions = pgTable(
  "invoice_submissions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** payment | share */
    kind: text("kind").notNull(),
    method: text("method"),
    amount: integer("amount"),
    reference: text("reference"),
    shareUrl: text("share_url"),
    screenshot: bytea("screenshot"),
    screenshotType: text("screenshot_type"),
    payerEmail: text("payer_email"),
    payerPhone: text("payer_phone"),
    /** pending | approved | rejected */
    status: text("status").notNull().default("pending"),
    paymentId: integer("payment_id").references(() => payments.id, { onDelete: "set null" }),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
  },
  (t) => [index("invoice_submissions_invoice_idx").on(t.invoiceId, t.createdAt), index("invoice_submissions_pending_idx").on(t.workspaceId, t.status)]
);

export type Client = typeof clients.$inferSelect;
export type InvoiceSubmission = typeof invoiceSubmissions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;

/** A pending invitation to join a workspace. The link holds a random token; only its hash is stored. */
export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role").notNull().default("member"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("invites_ws_idx").on(t.workspaceId, t.createdAt)]
);

export type Invite = typeof invites.$inferSelect;

/* ---------------------------------------------------------------- AI access (MCP) */

/**
 * Personal API keys for connecting AI assistants (Claude, Cursor…) over MCP.
 * A key acts as its owner: same section access, and "read" keys can't change anything.
 * Only a SHA-256 hash is stored; the key itself is shown once when created.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First characters, to recognise the key in the list. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    /** read | write */
    scope: text("scope").notNull().default("read"),
    /** key = pasted API key · oauth = an app connected by signing in (claude.ai, ChatGPT…) */
    kind: text("kind").notNull().default("key"),
    oauthClientId: text("oauth_client_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("api_keys_user_idx").on(t.userId)]
);

/** Every tool an AI ran, with what it asked for — so you can always see what it did. */
export const aiActions = pgTable(
  "ai_actions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    keyId: integer("key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    tool: text("tool").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>(),
    ok: boolean("ok").notNull(),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("ai_actions_ws_idx").on(t.workspaceId, t.createdAt)]
);

export type ApiKey = typeof apiKeys.$inferSelect;

/** Apps that registered themselves to use "Sign in with ScaleUp" (OAuth dynamic client registration). */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  /** Only for confidential clients; public clients (most AI apps) use PKCE without a secret. */
  secretHash: text("secret_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

/** One-time codes handed back after you approve an app (valid 5 minutes, PKCE-bound). */
export const oauthCodes = pgTable("oauth_codes", {
  id: serial("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  grantId: integer("grant_id")
    .notNull()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true })
});

/** Access (1 hour) and refresh (30 days, rotated) tokens for a connected app. Revoking the grant kills them all. */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    /** access | refresh */
    kind: text("kind").notNull(),
    grantId: integer("grant_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("oauth_tokens_grant_idx").on(t.grantId)]
);
export type OAuthClient = typeof oauthClients.$inferSelect;

/* ---------------------------------------------------------------- saved lead lists */

/** A named, hand-picked (or AI-picked) set of leads — e.g. "Top 50 fashion shops for WhatsApp". */
export const leadLists = pgTable(
  "lead_lists",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** ai | manual */
    source: text("source").notNull().default("manual"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("lead_lists_ws_idx").on(t.workspaceId, t.updatedAt)]
);

/**
 * One lead in a list. `message` (and `subject` for email) is that person's own text:
 * campaigns built from the list send it instead of the shared template.
 */
export const leadListItems = pgTable(
  "lead_list_items",
  {
    id: serial("id").primaryKey(),
    listId: integer("list_id")
      .notNull()
      .references(() => leadLists.id, { onDelete: "cascade" }),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** Why this lead was picked (AI's reasoning or your note). */
    reason: text("reason"),
    message: text("message"),
    subject: text("subject"),
    /** Their own email body (email campaigns use this; SMS/WhatsApp use `message`). */
    emailBody: text("email_body"),
    /** What you plan to offer them (e.g. "AI Messenger Chatbot — ৳10,000") and its group for filtering (e.g. "AI automation"). */
    offer: text("offer"),
    tag: text("tag"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("lead_list_items_unique").on(t.listId, t.leadId),
    index("lead_list_items_lead_idx").on(t.leadId),
    index("lead_list_items_tag_idx").on(t.listId, t.tag)
  ]
);
export type LeadList = typeof leadLists.$inferSelect;
