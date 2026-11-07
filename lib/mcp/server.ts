import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { LEAD_STATUSES } from "@/lib/constants";
import { parseFilters, whereFor } from "@/lib/leads-query";
import { addLeads } from "@/lib/lists";
import { bulkUpdateLeads } from "@/lib/lead-bulk";
import { dhakaDate, enrollLeads, enrollmentCounts } from "@/lib/sequences";
import { getPlan, planOutreach, planReport, plannedBetween, updatePlanMessage } from "@/lib/plans";
import { stopSequencesForLead } from "@/lib/sequence-stop";
import { normalizeBdMobile } from "@/lib/sms-text";
import { normalizeEmail } from "@/lib/email";
import { ACTIVITY_KINDS, type ActivityType, MANUAL_TYPES, logActivity } from "@/lib/activity";
import { offerGroup } from "@/lib/offer";
import { createCampaignWithRecipients, dhakaNow, findLeadsByContacts } from "@/lib/campaigns";
import { getBilling, invoicePrefix, invoiceUrl, nextInvoiceNumber, publicToken } from "@/lib/billing";
import { fmtDate, invoiceState, parseTaka, taka, totals } from "@/lib/money";
import { safeUrl } from "@/lib/tracking";
import { can, type Permission } from "@/lib/permissions";
import { type McpContext, logAction } from "@/lib/mcp/keys";

const L = schema.leads;
const C = schema.campaigns;
const M = schema.inboundMessages;
const K = schema.clients;
const I = schema.invoices;

function origin() {
  const base = (process.env.LINK_BASE_URL ?? "https://admin.scaleupweb.xyz/go").replace(/\/go\/?$/, "");
  return new URL(base).origin;
}
const adminUrl = (path: string) => `${origin()}${path}`;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (message: string): Result => ({ content: [{ type: "text", text: message }], isError: true });

const leadFilterShape = {
  query: z.string().max(100).optional().describe("Search in business name, phone or email"),
  status: z.enum(LEAD_STATUSES).optional(),
  priority: z.enum(["A - Hot", "B - Warm", "C - Cold", "Skip"]).optional(),
  industry: z.string().max(100).optional().describe("Exact industry name, e.g. Fashion"),
  service: z.string().max(100).optional().describe("Best-fit service, e.g. E-commerce Website"),
  source: z.string().max(60).optional().describe("e.g. website-contact, website-audit, manual"),
  has: z
    .array(z.enum(["phone", "whatsapp", "email", "website"]))
    .optional()
    .describe("Only leads that have these"),
  minScore: z.number().int().min(0).max(100).optional().describe("Only leads with at least this score"),
  list: z.number().int().optional().describe("Only leads in this saved list (see list_lead_lists)"),
  tag: z.string().max(60).optional().describe("With list: only its entries in this offer group, e.g. Website / AI automation / WhatsApp automation"),
  label: z.string().max(40).optional().describe("Only leads carrying this tag, e.g. hot or batch-1 (lead tags, see bulk_update_leads)")
};
type LeadFilterInput = {
  query?: string;
  status?: string;
  priority?: string;
  industry?: string;
  service?: string;
  source?: string;
  has?: string[];
  minScore?: number;
  list?: number;
  tag?: string;
  label?: string;
};
const toFilters = (f: LeadFilterInput) =>
  parseFilters({
    q: f.query,
    status: f.status,
    priority: f.priority,
    industry: f.industry,
    service: f.service,
    source: f.source,
    has: f.has ?? [],
    minScore: f.minScore !== undefined ? String(f.minScore) : undefined,
    list: f.list !== undefined ? String(f.list) : undefined,
    tag: f.tag,
    label: f.label
  });

/**
 * A fresh MCP server for one request, with only the tools this key's owner may use.
 * "read" keys get look-up tools; "write" keys can also change leads and create drafts.
 * Nothing here sends a campaign or a message — those stay a human click in the admin.
 */
export function buildServer(ctx: McpContext) {
  const { user, key } = ctx;
  const ws = user.workspaceId;
  const writable = key.scope === "write";
  const server = new McpServer({ name: "scaleup-admin", version: "1.0.0" });

  function tool<S extends z.ZodRawShape>(
    name: string,
    opts: { title: string; description: string; section: Permission | null; write?: boolean; input: S },
    run: (args: z.infer<z.ZodObject<S>>) => Promise<Result>
  ) {
    if (opts.write && !writable) return;
    if (opts.section && !can(user, opts.section)) return;
    server.registerTool(
      name,
      {
        title: opts.title,
        description: opts.description,
        inputSchema: opts.input,
        annotations: { readOnlyHint: !opts.write, destructiveHint: false, openWorldHint: false }
      },
      // The SDK validates the input against the schema before calling this.
      (async (args: z.infer<z.ZodObject<S>>) => {
        try {
          const res = await run(args);
          await logAction(ctx, name, args as Record<string, unknown>, !res.isError, res.content[0]?.text.slice(0, 200) ?? "");
          return res;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Something went wrong";
          await logAction(ctx, name, args as Record<string, unknown>, false, msg);
          return fail(msg);
        }
      }) as never
    );
  }

  /* ------------------------------------------------------------ overview */

  tool(
    "get_overview",
    { title: "Business overview", description: "Today's snapshot: leads by status, unread replies, campaigns running, money owed.", section: null, input: {} },
    async () => {
      const out: Record<string, unknown> = { you: { name: user.name, role: user.role } };
      if (can(user, "leads")) {
        const byStatus = await db
          .select({ status: L.status, n: sql<number>`count(*)::int` })
          .from(L)
          .where(eq(L.workspaceId, ws))
          .groupBy(L.status);
        const [{ week }] = await db
          .select({ week: sql<number>`count(*)::int` })
          .from(L)
          .where(and(eq(L.workspaceId, ws), sql`${L.source} like 'website-%'`, gte(L.createdAt, new Date(Date.now() - 7 * 86_400_000))));
        out.leads = { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), websiteEnquiriesLast7Days: week };
      }
      if (can(user, "inbox")) {
        const [{ n }] = await db
          .select({ n: sql<number>`count(distinct ${M.sender})::int` })
          .from(M)
          .where(and(eq(M.workspaceId, ws), eq(M.direction, "in"), isNull(M.readAt)));
        out.inbox = { unreadConversations: n, open: adminUrl("/inbox?filter=unread") };
      }
      if (can(user, "campaigns")) {
        const { startOfDay } = dhakaNow();
        const active = await db
          .select({ id: C.id, name: C.name, channel: C.channel, status: C.status, sent: C.sentCount, total: C.totalRecipients })
          .from(C)
          .where(and(eq(C.workspaceId, ws), inArray(C.status, ["sending", "paused"])));
        const [{ today }] = await db
          .select({ today: sql<number>`count(*)::int` })
          .from(schema.campaignRecipients)
          .where(
            and(eq(schema.campaignRecipients.workspaceId, ws), eq(schema.campaignRecipients.status, "sent"), gte(schema.campaignRecipients.sentAt, startOfDay))
          );
        out.campaigns = { active, messagesSentToday: today };
      }
      if (can(user, "invoices")) {
        const invs = await db.select().from(I).where(eq(I.workspaceId, ws));
        const states = invs.map((i) => ({ i, s: invoiceState(i) }));
        const owed = states.filter((x) => ["sent", "partial", "overdue"].includes(x.s)).reduce((a, x) => a + x.i.total - x.i.amountPaid, 0);
        const overdue = states.filter((x) => x.s === "overdue");
        const [{ pending }] = await db
          .select({ pending: sql<number>`count(*)::int` })
          .from(schema.invoiceSubmissions)
          .where(and(eq(schema.invoiceSubmissions.workspaceId, ws), eq(schema.invoiceSubmissions.status, "pending")));
        out.invoices = {
          outstanding: taka(owed),
          overdue: { count: overdue.length, amount: taka(overdue.reduce((a, x) => a + x.i.total - x.i.amountPaid, 0)) },
          paymentsWaitingForYourConfirmation: pending
        };
      }
      return ok(out);
    }
  );

  /* ------------------------------------------------------------ leads */

  tool(
    "search_leads",
    {
      title: "Search leads",
      description:
        "Find leads with filters, best score first. Page with offset/limit (max 100 per call). Set detailed=true to get what you need to analyse them (pain point, pitch, ads, followers, website, how they take orders). Returns the total that match.",
      section: "leads",
      input: {
        ...leadFilterShape,
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(100000).optional(),
        detailed: z.boolean().optional()
      }
    },
    async (a) => {
      const where = whereFor(ws, toFilters(a));
      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(L)
          .where(where)
          .orderBy(sql`${L.score} desc nulls last`, asc(L.id))
          .limit(a.limit ?? 25)
          .offset(a.offset ?? 0),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(L)
          .where(where)
      ]);
      return ok({
        total,
        offset: a.offset ?? 0,
        leads: rows.map((l) => ({
          id: l.id,
          name: l.pageName,
          status: l.status,
          priority: l.priority,
          score: l.score,
          industry: l.industry,
          bestService: l.primaryService,
          phone: l.phone,
          whatsapp: l.whatsapp,
          email: l.email,
          tags: l.tags,
          lastContactedAt: l.lastContactedAt,
          ...(a.detailed
            ? {
                category: l.category,
                size: l.sizeTier,
                followers: l.followers,
                painPoint: l.painPoint,
                pitch: l.pitch,
                otherServices: l.otherServices,
                activeAds: l.activeAds,
                runningDays: l.runningDays,
                offers: l.offers,
                adPrices: l.adPriceRange,
                website: l.website,
                websiteType: l.websiteType,
                platform: l.websitePlatform,
                ordersVia: l.ordersVia,
                page: l.pageLink,
                address: l.address,
                inBangladesh: l.inBangladesh,
                optedOut: { sms: l.smsOptOut, whatsapp: l.waOptOut, email: l.emailOptOut }
              }
            : {}),
          url: adminUrl(`/leads/${l.id}`)
        }))
      });
    }
  );

  tool(
    "get_lead",
    { title: "Lead details", description: "Everything about one lead, with its recent history.", section: "leads", input: { id: z.number().int() } },
    async (a) => {
      const [lead] = await db
        .select()
        .from(L)
        .where(and(eq(L.id, a.id), eq(L.workspaceId, ws)))
        .limit(1);
      if (!lead) return fail("No lead with that id");
      const history = await db
        .select({
          type: schema.leadActivities.type,
          channel: schema.leadActivities.channel,
          body: schema.leadActivities.body,
          meta: schema.leadActivities.meta,
          at: schema.leadActivities.createdAt
        })
        .from(schema.leadActivities)
        .where(eq(schema.leadActivities.leadId, lead.id))
        .orderBy(desc(schema.leadActivities.createdAt))
        .limit(40);
      const { details, ...rest } = lead;
      return ok({ ...rest, formAnswers: details, history, url: adminUrl(`/leads/${lead.id}`) });
    }
  );

  tool(
    "update_lead_status",
    {
      title: "Change lead status",
      description: "Move a lead in the pipeline (new → contacted → interested → proposal → won/lost).",
      section: "leads",
      write: true,
      input: { id: z.number().int(), status: z.enum(LEAD_STATUSES) }
    },
    async (a) => {
      const [lead] = await db
        .update(L)
        .set({ status: a.status, updatedAt: new Date() })
        .where(and(eq(L.id, a.id), eq(L.workspaceId, ws)))
        .returning({ id: L.id, name: L.pageName });
      if (!lead) return fail("No lead with that id");
      await db
        .insert(schema.leadActivities)
        .values({ workspaceId: ws, leadId: lead.id, userId: user.id, type: "status", body: `Status → ${a.status} (via AI)` });
      return ok({ updated: lead.name, status: a.status });
    }
  );

  tool(
    "add_lead_note",
    {
      title: "Add a note to a lead",
      description: "Save a note on a lead's history (call summary, next step…).",
      section: "leads",
      write: true,
      input: { id: z.number().int(), note: z.string().min(1).max(2000) }
    },
    async (a) => {
      const [lead] = await db
        .select({ id: L.id })
        .from(L)
        .where(and(eq(L.id, a.id), eq(L.workspaceId, ws)))
        .limit(1);
      if (!lead) return fail("No lead with that id");
      await db.insert(schema.leadActivities).values({ workspaceId: ws, leadId: lead.id, userId: user.id, type: "note", body: a.note, meta: { via: "ai" } });
      return ok({ saved: true });
    }
  );

  tool(
    "bulk_update_leads",
    {
      title: "Update many leads at once",
      description:
        "Change status, add/remove tags, and/or add the same note on up to 500 leads in one call. Each change is written to every lead's timeline. Tags are short lower-case labels (e.g. hot, clinic, batch-1); filter by them with search_leads label.",
      section: "leads",
      write: true,
      input: {
        ids: z.array(z.number().int()).min(1).max(500),
        status: z.enum(LEAD_STATUSES).optional(),
        addTags: z.array(z.string().max(40)).max(20).optional(),
        removeTags: z.array(z.string().max(40)).max(20).optional(),
        note: z.string().max(2000).optional().describe("Same note added to each lead")
      }
    },
    async (a) => {
      if (!a.status && !a.addTags?.length && !a.removeTags?.length && !a.note) return fail("Nothing to change: give status, addTags, removeTags or note.");
      const r = await bulkUpdateLeads(ws, user.id, a.ids, { status: a.status, addTags: a.addTags, removeTags: a.removeTags, note: a.note, via: "ai" });
      const missing = a.ids.filter((id) => !r.ids.includes(id));
      return ok({ updated: r.updated, tagsAdded: r.tagsAdded, tagsRemoved: r.tagsRemoved, ...(missing.length ? { notFound: missing } : {}) });
    }
  );

  tool(
    "log_activity",
    {
      title: "Log a touch on a lead",
      description:
        "Record something that already happened outside the app, so the lead's timeline stays complete: a WhatsApp sent from a phone, a call, a meeting, or a reply they sent. This does NOT send anything. Logging an outgoing touch moves a 'new' lead to 'contacted'; a reply moves 'new'/'contacted' to 'interested'.",
      section: "leads",
      write: true,
      input: {
        id: z.number().int().describe("Lead id"),
        type: z.enum(MANUAL_TYPES as [ActivityType, ...ActivityType[]]).describe(
          MANUAL_TYPES.map((t) => `${t} = ${ACTIVITY_KINDS[t].label}`).join("; ")
        ),
        body: z.string().max(4000).describe("What was sent or said"),
        at: z.string().datetime({ offset: true }).optional().describe("When it happened (ISO 8601). Defaults to now; cannot be in the future.")
      }
    },
    async (a) => {
      const at = a.at ? new Date(a.at) : new Date();
      if (at.getTime() > Date.now() + 60_000) return fail("'at' cannot be in the future");
      const id = await logActivity({ workspaceId: ws, leadId: a.id, userId: user.id, type: a.type, body: a.body, meta: { via: "ai" }, at });
      if (!id) return fail("No lead with that id");
      return ok({ logged: true, activityId: id, url: adminUrl(`/leads/${a.id}`) });
    }
  );

  /* ------------------------------------------------------------ saved lists */

  const listItemShape = z.object({
    id: z.number().int().describe("Lead id"),
    reason: z.string().max(1000).optional().describe("Why you picked this lead — shown in the admin"),
    message: z
      .string()
      .max(5000)
      .optional()
      .describe("This person's own SMS/WhatsApp/email text. Use {link} where the tracking link goes (added at the end if left out)."),
    subject: z.string().max(200).optional().describe("Their own email subject"),
    emailBody: z.string().max(10000).optional().describe("Their own email body (email campaigns use this; SMS/WhatsApp use message)"),
    offer: z.string().max(300).optional().describe("What you would offer them, e.g. AI Messenger Chatbot — ৳10,000 (its group is worked out automatically)")
  });

  /** Only leads from this workspace; returns the valid ids. */
  async function validLeadIds(ids: number[]) {
    if (!ids.length) return new Set<number>();
    const rows = await db
      .select({ id: L.id })
      .from(L)
      .where(and(eq(L.workspaceId, ws), inArray(L.id, ids)));
    return new Set(rows.map((r) => r.id));
  }

  tool(
    "list_lead_lists",
    { title: "Saved lead lists", description: "Saved lists of leads, with how many have their own message.", section: "leads", input: {} },
    async () => {
      const LL = schema.leadLists;
      const LI = schema.leadListItems;
      const rows = await db
        .select({
          id: LL.id,
          name: LL.name,
          description: LL.description,
          source: LL.source,
          updatedAt: LL.updatedAt,
          leads: sql<number>`count(${LI.id})::int`,
          withOwnMessage: sql<number>`count(${LI.id}) filter (where ${LI.message} is not null and ${LI.message} <> '')::int`
        })
        .from(LL)
        .leftJoin(LI, eq(LI.listId, LL.id))
        .where(eq(LL.workspaceId, ws))
        .groupBy(LL.id)
        .orderBy(desc(LL.updatedAt));
      return ok(rows.map((r) => ({ ...r, url: adminUrl(`/leads/lists/${r.id}`) })));
    }
  );

  tool(
    "get_lead_list",
    {
      title: "Saved list details",
      description: "The leads in one saved list, with the reason and own message for each.",
      section: "leads",
      input: { id: z.number().int() }
    },
    async (a) => {
      const LL = schema.leadLists;
      const LI = schema.leadListItems;
      const [list] = await db
        .select()
        .from(LL)
        .where(and(eq(LL.id, a.id), eq(LL.workspaceId, ws)))
        .limit(1);
      if (!list) return fail("No saved list with that id");
      const items = await db
        .select({
          leadId: LI.leadId,
          name: L.pageName,
          status: L.status,
          reason: LI.reason,
          offer: LI.offer,
          group: LI.tag,
          message: LI.message,
          subject: LI.subject
        })
        .from(LI)
        .innerJoin(L, eq(L.id, LI.leadId))
        .where(eq(LI.listId, list.id))
        .orderBy(asc(LI.position));
      return ok({ id: list.id, name: list.name, description: list.description, leads: items, url: adminUrl(`/leads/lists/${list.id}`) });
    }
  );

  tool(
    "create_lead_list",
    {
      title: "Save leads as a list",
      description:
        "Save your picked leads as a named list in the admin (e.g. after analysing them). For each lead you can add why you picked it and their own personalised message — campaigns sent to this list will send each person their own message. Max 1000 leads.",
      section: "leads",
      write: true,
      input: {
        name: z.string().min(2).max(120),
        description: z.string().max(1000).optional(),
        leads: z.array(listItemShape).min(1).max(1000)
      }
    },
    async (a) => {
      const valid = await validLeadIds(a.leads.map((l) => l.id));
      const items = a.leads.filter((l) => valid.has(l.id));
      if (!items.length) return fail("None of those lead ids exist");
      const [list] = await db
        .insert(schema.leadLists)
        .values({ workspaceId: ws, name: a.name, description: a.description ?? null, source: "ai", createdBy: user.id })
        .returning({ id: schema.leadLists.id });
      const added = await addLeads(
        list.id,
        items.map((l) => ({
          leadId: l.id,
          reason: l.reason,
          message: l.message,
          subject: l.subject,
          emailBody: l.emailBody,
          offer: l.offer,
          tag: offerGroup(l.offer)
        }))
      );
      return ok({
        listId: list.id,
        saved: added,
        skippedUnknownIds: a.leads.length - items.length,
        withOwnMessage: items.filter((l) => l.message?.trim()).length,
        url: adminUrl(`/leads/lists/${list.id}`)
      });
    }
  );

  tool(
    "add_to_lead_list",
    {
      title: "Add to a saved list",
      description: "Add leads to an existing list, or update the reason / own message of leads already in it.",
      section: "leads",
      write: true,
      input: { listId: z.number().int(), leads: z.array(listItemShape).min(1).max(1000) }
    },
    async (a) => {
      const LL = schema.leadLists;
      const LI = schema.leadListItems;
      const [list] = await db
        .select({ id: LL.id })
        .from(LL)
        .where(and(eq(LL.id, a.listId), eq(LL.workspaceId, ws)))
        .limit(1);
      if (!list) return fail("No saved list with that id");
      const valid = await validLeadIds(a.leads.map((l) => l.id));
      const items = a.leads.filter((l) => valid.has(l.id));
      const existing = new Set(
        (
          await db
            .select({ leadId: LI.leadId })
            .from(LI)
            .where(and(eq(LI.listId, list.id), inArray(LI.leadId, items.map((i) => i.id).concat(-1))))
        ).map((r) => r.leadId)
      );
      let updated = 0;
      for (const it of items.filter((i) => existing.has(i.id))) {
        const patch: Record<string, string | null> = {};
        if (it.reason !== undefined) patch.reason = it.reason;
        if (it.message !== undefined) patch.message = it.message || null;
        if (it.subject !== undefined) patch.subject = it.subject || null;
        if (it.emailBody !== undefined) patch.emailBody = it.emailBody || null;
        if (it.offer !== undefined) {
          patch.offer = it.offer || null;
          patch.tag = offerGroup(it.offer);
        }
        if (Object.keys(patch).length) {
          await db
            .update(LI)
            .set(patch)
            .where(and(eq(LI.listId, list.id), eq(LI.leadId, it.id)));
          updated++;
        }
      }
      const added = await addLeads(
        list.id,
        items
          .filter((i) => !existing.has(i.id))
          .map((l) => ({
            leadId: l.id,
            reason: l.reason,
            message: l.message,
            subject: l.subject,
            emailBody: l.emailBody,
            offer: l.offer,
            tag: offerGroup(l.offer)
          }))
      );
      return ok({ listId: list.id, added, updated, skippedUnknownIds: a.leads.length - items.length, url: adminUrl(`/leads/lists/${list.id}`) });
    }
  );

  /* ------------------------------------------------------------ templates, sequences, today */

  const TT = schema.messageTemplates;
  const SQ = schema.sequences;
  const SS = schema.sequenceSteps;

  tool(
    "list_templates",
    {
      title: "Message templates",
      description: "Saved reusable messages (WhatsApp, SMS, email).",
      section: "campaigns",
      input: { channel: z.enum(["sms", "whatsapp", "email"]).optional() }
    },
    async (a) => {
      const rows = await db
        .select({ id: TT.id, channel: TT.channel, name: TT.name, subject: TT.subject, body: TT.body })
        .from(TT)
        .where(and(eq(TT.workspaceId, ws), a.channel ? eq(TT.channel, a.channel) : undefined))
        .orderBy(desc(TT.updatedAt))
        .limit(100);
      return ok(rows);
    }
  );

  tool(
    "create_template",
    {
      title: "Save a message template",
      description:
        "Save a reusable message. Placeholders: {name} {service} {link} (tracked link) and lead data {industry} {ads} {days} {followers} {pain} {orders} {size} {category} {address}; {ads:onek} uses 'onek' when missing; {a|b} picks one at random.",
      section: "campaigns",
      write: true,
      input: {
        channel: z.enum(["sms", "whatsapp", "email"]),
        name: z.string().min(2).max(100),
        subject: z.string().max(200).optional(),
        body: z.string().min(1).max(10000)
      }
    },
    async (a) => {
      const [row] = await db
        .insert(TT)
        .values({ workspaceId: ws, createdBy: user.id, channel: a.channel, name: a.name, subject: a.channel === "email" ? (a.subject ?? null) : null, body: a.body })
        .returning({ id: TT.id });
      return ok({ id: row.id, url: adminUrl("/templates") });
    }
  );

  tool(
    "list_sequences",
    {
      title: "Sequences",
      description: "Follow-up plans with their steps and how many leads are running / waiting / replied / finished.",
      section: "campaigns",
      input: {}
    },
    async () => {
      const seqs = await db.select().from(SQ).where(eq(SQ.workspaceId, ws)).orderBy(desc(SQ.updatedAt)).limit(50);
      const steps = seqs.length
        ? await db
            .select()
            .from(SS)
            .where(
              inArray(
                SS.sequenceId,
                seqs.map((s) => s.id)
              )
            )
            .orderBy(asc(SS.position))
        : [];
      const counts = await enrollmentCounts(ws);
      return ok(
        seqs.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          link: s.destinationUrl,
          steps: steps.filter((x) => x.sequenceId === s.id).map((x) => ({ day: x.day, channel: x.channel, mode: x.mode, subject: x.subject, body: x.body })),
          leads: counts.get(s.id) ?? {},
          url: adminUrl(`/sequences/${s.id}`)
        }))
      );
    }
  );

  tool(
    "create_sequence",
    {
      title: "Create a sequence (as a draft)",
      description:
        "Create a follow-up plan, e.g. Day 1 email (auto) → Day 2 SMS (auto) → Day 4 WhatsApp (manual). It is saved as a DRAFT: nothing is sent until the user turns it on in the admin. mode 'manual' puts the step on the user's Today screen to send from their own phone (use this for cold WhatsApp); 'auto' lets the app send it. Same placeholders as create_template.",
      section: "campaigns",
      write: true,
      input: {
        name: z.string().min(2).max(120),
        link: z.string().url().max(500).optional().describe("Where {link} goes, e.g. https://scaleupweb.xyz/free-audit"),
        steps: z
          .array(
            z.object({
              day: z.number().int().min(1).max(90).describe("Day counted from enrolment, 1 = same day"),
              channel: z.enum(["email", "sms", "whatsapp", "call"]),
              mode: z.enum(["auto", "manual"]).default("manual"),
              subject: z.string().max(200).optional(),
              body: z.string().max(10000)
            })
          )
          .min(1)
          .max(15)
      }
    },
    async (a) => {
      const link = a.link ? safeUrl(a.link) : null;
      if (a.link && !link) return fail("link must start with https://");
      if (!link && a.steps.some((s) => /\{link\}/i.test(s.body))) return fail("A step uses {link}: give the link it should open");
      const [sender] = await db
        .select({ id: schema.emailSenders.id })
        .from(schema.emailSenders)
        .where(eq(schema.emailSenders.workspaceId, ws))
        .limit(1);
      const [s] = await db
        .insert(SQ)
        .values({ workspaceId: ws, name: a.name, createdBy: user.id, destinationUrl: link, emailSenderId: sender?.id ?? null, status: "draft" })
        .returning({ id: SQ.id });
      const steps = [...a.steps].sort((x, y) => x.day - y.day);
      await db.insert(SS).values(
        steps.map((st, position) => ({
          sequenceId: s.id,
          position,
          day: st.day,
          channel: st.channel,
          mode: st.channel === "call" ? "manual" : st.mode,
          subject: st.channel === "email" ? (st.subject ?? null) : null,
          body: st.body
        }))
      );
      return ok({ id: s.id, status: "draft", note: "Ask the user to review and turn it on in the admin.", url: adminUrl(`/sequences/${s.id}`) });
    }
  );

  tool(
    "enroll_leads",
    {
      title: "Add leads to a sequence",
      description:
        "Add leads (by id) to a sequence. They are added as WAITING: nothing is sent until the user clicks Start on the sequence page. Won/lost/skipped leads and leads already in it are left out.",
      section: "campaigns",
      write: true,
      input: { sequenceId: z.number().int(), ids: z.array(z.number().int()).min(1).max(1000) }
    },
    async (a) => {
      const r = await enrollLeads(ws, a.sequenceId, a.ids, user.id, "waiting");
      if ("error" in r) return fail(r.error ?? "Could not enroll");
      return ok({ ...r, note: "Waiting for the user's OK on the sequence page.", url: adminUrl(`/sequences/${a.sequenceId}`) });
    }
  );

  tool(
    "get_today_tasks",
    {
      title: "Tasks for a day",
      description:
        "What the user has to do by hand on a day (default today, Dhaka): WhatsApp/SMS/email to send and calls, overdue first, with the message. For a future date it also lists the plan messages scheduled that day. Plus unread replies. Tasks are completed by the user in the admin.",
      section: "campaigns",
      input: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("YYYY-MM-DD, Dhaka. Default today")
      }
    },
    async (a) => {
      const T = schema.tasks;
      const today = dhakaDate(new Date());
      const date = a.date ?? today;
      const dayStart = new Date(`${date}T00:00:00+06:00`);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const rows = await db
        .select({ t: T, name: L.pageName, status: L.status })
        .from(T)
        .innerJoin(L, eq(L.id, T.leadId))
        .where(and(eq(T.workspaceId, ws), eq(T.state, "open"), lte(T.dueAt, dayEnd), date === today ? undefined : gte(T.dueAt, dayStart)))
        .orderBy(asc(T.dueAt))
        .limit(200);
      const planned = await plannedBetween(ws, dayStart, dayEnd);
      const [unread] = await db
        .select({ n: sql<number>`count(distinct ${M.sender})::int` })
        .from(M)
        .where(and(eq(M.workspaceId, ws), eq(M.direction, "in"), isNull(M.readAt)));
      return ok({
        date,
        unreadReplies: unread?.n ?? 0,
        tasks: rows.map(({ t, name, status }) => ({
          id: t.id,
          lead: { id: t.leadId, name, status },
          channel: t.channel,
          title: t.title,
          to: t.contact,
          subject: t.subject,
          message: t.body,
          due: t.dueAt
        })),
        plannedThatDay: planned,
        url: adminUrl("/today")
      });
    }
  );

  tool(
    "find_leads_by_contact",
    {
      title: "Find leads by phone, email or Facebook page",
      description:
        "Match pasted phone numbers (any BD format), emails and Facebook page links to existing leads. Returns matched lead ids and what was not found. Use before plan_outreach.",
      section: "leads",
      input: {
        phones: z.array(z.string().max(40)).max(500).optional(),
        emails: z.array(z.string().max(200)).max(500).optional(),
        fb_urls: z.array(z.string().max(500)).max(500).optional()
      }
    },
    async (a) => {
      const matched: { input: string; leadId: number; name: string | null; status: string; by: string }[] = [];
      const notFound: string[] = [];
      const phones = (a.phones ?? []).map((p) => ({ input: p, n: normalizeBdMobile(p) }));
      for (const p of phones.filter((x) => !x.n)) notFound.push(`${p.input} (not a BD mobile)`);
      if (phones.some((p) => p.n)) {
        const { byKey, keyOf } = await findLeadsByContacts(
          ws,
          phones.filter((p) => p.n).map((p) => p.n!),
          "sms"
        );
        for (const p of phones.filter((x) => x.n)) {
          const l = byKey.get(keyOf(p.n!));
          if (l) matched.push({ input: p.input, leadId: l.id, name: l.name, status: l.status, by: "phone" });
          else notFound.push(p.input);
        }
      }
      const emails = (a.emails ?? []).map((e) => ({ input: e, n: normalizeEmail(e) }));
      for (const e of emails.filter((x) => !x.n)) notFound.push(`${e.input} (not an email)`);
      if (emails.some((e) => e.n)) {
        const { byKey, keyOf } = await findLeadsByContacts(
          ws,
          emails.filter((e) => e.n).map((e) => e.n!),
          "email"
        );
        for (const e of emails.filter((x) => x.n)) {
          const l = byKey.get(keyOf(e.n!));
          if (l) matched.push({ input: e.input, leadId: l.id, name: l.name, status: l.status, by: "email" });
          else notFound.push(e.input);
        }
      }
      for (const u of a.fb_urls ?? []) {
        const key = u
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/^(www|m|web|mbasic)\./, "")
          .replace(/[?#].*$/, "")
          .replace(/\/+$/, "");
        if (key.length < 6) {
          notFound.push(`${u} (not a page link)`);
          continue;
        }
        const like = `%${key.replace(/[%_]/g, "\\$&")}%`;
        const [l] = await db
          .select({ id: L.id, name: L.pageName, status: L.status })
          .from(L)
          .where(and(eq(L.workspaceId, ws), or(ilike(L.pageLink, like), ilike(L.externalKey, like))))
          .limit(1);
        if (l) matched.push({ input: u, leadId: l.id, name: l.name, status: l.status, by: "facebook page" });
        else notFound.push(u);
      }
      return ok({ matched, leadIds: [...new Set(matched.map((m) => m.leadId))], notFound });
    }
  );

  tool(
    "plan_outreach",
    {
      title: "Plan day-by-day outreach for some leads",
      description:
        "The main tool for 'set up a day-by-day follow-up for these leads'. In one call it builds a saved list, a sequence (steps by day/time/channel/mode), adds the leads, and stores each person's own message per step. dry_run defaults to TRUE: you get a day-by-day preview (who gets what, problems like missing numbers) and nothing is saved. Call again with dry_run=false to save. Calling again with the same name updates that plan instead of making a duplicate. Max 200 leads. NOTHING is sent: the leads wait until the user clicks 'Approve & start' in the admin. mode 'manual' = user sends from their phone via Today (use for cold WhatsApp); 'auto' = app sends 9am–9pm. Messages can use {name} {link} {ads} {days} {followers} etc; a step's body is used for leads without their own message.",
      section: "campaigns",
      write: true,
      input: {
        name: z.string().min(2).max(120).describe("e.g. Batch 1 – Clinic"),
        lead_ids: z.array(z.number().int()).min(1).max(200),
        steps: z
          .array(
            z.object({
              day: z.number().int().min(1).max(90).describe("1 = start day"),
              time: z.string().optional().describe("Dhaka time, e.g. 10:00"),
              channel: z.enum(["email", "sms", "whatsapp", "call"]),
              mode: z.enum(["auto", "manual"]).optional().describe("default manual"),
              subject: z.string().max(200).optional().describe("Default email subject"),
              body: z.string().max(10000).optional().describe("Default message for leads without their own")
            })
          )
          .min(1)
          .max(15),
        messages: z
          .array(
            z.object({
              lead_id: z.number().int(),
              day: z.number().int(),
              channel: z.enum(["email", "sms", "whatsapp", "call"]),
              subject: z.string().max(200).optional(),
              body: z.string().min(1).max(10000)
            })
          )
          .max(3000)
          .default([]),
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Day 1 date (YYYY-MM-DD). Default: the day the user approves"),
        timezone: z.string().optional().describe("Only Asia/Dhaka is supported"),
        link: z.string().max(500).optional().describe("Where {link} goes, e.g. https://scaleupweb.xyz/free-audit"),
        dry_run: z.boolean().default(true)
      }
    },
    async (a) => {
      const r = await planOutreach(ws, user.id, {
        name: a.name,
        leadIds: a.lead_ids,
        steps: a.steps,
        messages: a.messages.map((m) => ({ leadId: m.lead_id, day: m.day, channel: m.channel, subject: m.subject, body: m.body })),
        startDate: a.start_date,
        link: a.link,
        dryRun: a.dry_run
      });
      if ("error" in r) return fail(r.error ?? "Could not plan");
      const tzNote = a.timezone && a.timezone !== "Asia/Dhaka" ? "Times are Dhaka time (Asia/Dhaka); other time zones are not supported yet." : undefined;
      if (r.dryRun)
        return ok({
          ...r,
          ...(tzNote ? { note: tzNote } : {}),
          next: a.dry_run ? "Preview only — nothing saved. Fix any problems, then call again with dry_run=false." : "Not saved because of the problems listed."
        });
      return ok({
        ...r,
        preview: undefined,
        note: `Saved. ${r.newlyAdded} leads are waiting: ask the user to open the plan, check the messages and click 'Approve & start'.${tzNote ? " " + tzNote : ""}`,
        url: adminUrl(`/sequences/${r.planId}?tab=plan`)
      });
    }
  );

  tool(
    "get_plan",
    {
      title: "A plan, lead × day",
      description: "Every lead and step of a plan (sequence) with the message and status: draft / approved / planned / queued / task (on Today) / sent / skipped / cancelled / failed.",
      section: "campaigns",
      input: { plan_id: z.number().int() }
    },
    async (a) => {
      const p = await getPlan(ws, a.plan_id);
      if (!p) return fail("No plan with that id");
      return ok({
        id: p.seq.id,
        name: p.seq.name,
        status: p.seq.status,
        startDate: p.seq.startDate,
        steps: p.steps.map((s) => ({ stepId: s.id, day: s.day, time: s.sendTime, channel: s.channel, mode: s.mode })),
        leads: p.rows.map((r) => ({
          leadId: r.lead.id,
          name: r.lead.name,
          state: r.enrollment.state,
          cells: r.cells.map((c, i) => ({ day: p.steps[i].day, channel: p.steps[i].channel, status: c.status, at: c.at, own: c.personal, subject: c.subject, message: c.body }))
        })),
        url: adminUrl(`/sequences/${p.seq.id}?tab=plan`)
      });
    }
  );

  tool(
    "update_plan_message",
    {
      title: "Change one message in a plan",
      description:
        "Rewrite one lead's message for one day of a plan (e.g. 'make Taqwa's Day 4 message shorter'), or skip it. Only works before the message is prepared for sending.",
      section: "campaigns",
      write: true,
      input: {
        plan_id: z.number().int(),
        lead_id: z.number().int(),
        day: z.number().int(),
        channel: z.enum(["email", "sms", "whatsapp", "call"]).optional().describe("Needed when that day has more than one step"),
        body: z.string().max(10000).optional(),
        subject: z.string().max(200).optional(),
        skip: z.boolean().optional().describe("true = don't send this one; false = put it back")
      }
    },
    async (a) => {
      const steps = await db
        .select({ id: SS.id, channel: SS.channel })
        .from(SS)
        .innerJoin(SQ, eq(SQ.id, SS.sequenceId))
        .where(and(eq(SS.sequenceId, a.plan_id), eq(SQ.workspaceId, ws), eq(SS.day, a.day)));
      const step = a.channel ? steps.find((s) => s.channel === a.channel) : steps.length === 1 ? steps[0] : undefined;
      if (!step) return fail(steps.length > 1 ? `Day ${a.day} has ${steps.map((s) => s.channel).join(" and ")}: say which channel` : `No step on day ${a.day}`);
      if (a.body === undefined && a.subject === undefined && a.skip === undefined) return fail("Give body, subject or skip");
      const r = await updatePlanMessage(ws, a.plan_id, a.lead_id, step.id, { body: a.body, subject: a.subject, skip: a.skip });
      if ("error" in r) return fail(r.error ?? "Could not update");
      return ok({ updated: true, status: r.status, url: adminUrl(`/sequences/${a.plan_id}?tab=plan`) });
    }
  );

  tool(
    "mark_replied",
    {
      title: "Record that a lead replied",
      description:
        "The lead replied (on WhatsApp, SMS, email or a call). Logs it on their timeline, moves new/contacted to interested, and stops all their sequences so no more follow-ups go out. Sends nothing.",
      section: "leads",
      write: true,
      input: {
        lead_id: z.number().int(),
        channel: z.enum(["whatsapp", "sms", "email", "phone"]),
        note: z.string().max(4000).optional().describe("What they said")
      }
    },
    async (a) => {
      const type = a.channel === "whatsapp" ? "wa_reply" : a.channel === "email" ? "email_reply" : a.channel === "sms" ? "sms_reply" : "call";
      const id = await logActivity({ workspaceId: ws, leadId: a.lead_id, userId: user.id, type, body: a.note ?? "Replied", meta: { via: "ai" } });
      if (!id) return fail("No lead with that id");
      // A phone reply is logged as a call; stop their sequences too.
      if (type === "call") await stopSequencesForLead(a.lead_id, "replied", "Replied on a call");
      return ok({ logged: true, sequencesStopped: true, url: adminUrl(`/leads/${a.lead_id}`) });
    }
  );

  tool(
    "get_plan_report",
    {
      title: "How a plan is doing",
      description: "Sent, replied, demo and won for a plan — per lead and per channel.",
      section: "campaigns",
      input: { plan_id: z.number().int() }
    },
    async (a) => {
      const r = await planReport(ws, a.plan_id);
      if (!r) return fail("No plan with that id");
      return ok({ ...r, url: adminUrl(`/sequences/${a.plan_id}?tab=plan`) });
    }
  );

  /* ------------------------------------------------------------ campaigns */

  tool(
    "list_campaigns",
    {
      title: "List campaigns",
      description: "Campaigns with their real-click results.",
      section: "campaigns",
      input: { channel: z.enum(["sms", "whatsapp", "email"]).optional(), limit: z.number().int().min(1).max(50).optional() }
    },
    async (a) => {
      const conds: SQL[] = [eq(C.workspaceId, ws)];
      if (a.channel) conds.push(eq(C.channel, a.channel));
      const rows = await db
        .select()
        .from(C)
        .where(and(...conds))
        .orderBy(desc(C.id))
        .limit(a.limit ?? 20);
      return ok(
        rows.map((c) => ({
          id: c.id,
          name: c.name,
          channel: c.channel,
          status: c.status,
          sent: `${c.sentCount}/${c.totalRecipients}`,
          realClicks: c.humanClicks,
          peopleClicked: c.uniqueClickers,
          clickRate: c.sentCount ? `${((c.uniqueClickers / c.sentCount) * 100).toFixed(1)}%` : null,
          botHitsBlocked: c.botClicks,
          created: fmtDate(c.createdAt),
          url: adminUrl(`/campaigns/${c.id}`)
        }))
      );
    }
  );

  tool(
    "get_campaign",
    { title: "Campaign details", description: "One campaign's results and who clicked.", section: "campaigns", input: { id: z.number().int() } },
    async (a) => {
      const [c] = await db
        .select()
        .from(C)
        .where(and(eq(C.id, a.id), eq(C.workspaceId, ws)))
        .limit(1);
      if (!c) return fail("No campaign with that id");
      const R = schema.campaignRecipients;
      const clickers = await db
        .select({ leadId: R.leadId, to: R.phone, clicks: R.clickCount, name: L.pageName })
        .from(R)
        .leftJoin(L, eq(L.id, R.leadId))
        .where(and(eq(R.campaignId, c.id), sql`${R.clickCount} > 0`))
        .orderBy(desc(R.clickCount))
        .limit(25);
      return ok({ ...c, peopleWhoClicked: clickers, url: adminUrl(`/campaigns/${c.id}`) });
    }
  );

  tool(
    "create_campaign_draft",
    {
      title: "Create a campaign draft",
      description:
        "Prepare an SMS, WhatsApp or email campaign for leads matching the filters. It is saved as a DRAFT — nothing is sent. A person must review it in the admin and press Start. The message must contain {link}; you can use {name}, {service} and {a|b|c} variations.",
      section: "campaigns",
      write: true,
      input: {
        channel: z.enum(["sms", "whatsapp", "email"]),
        name: z.string().min(2).max(120),
        message: z.string().min(10).max(5000),
        subject: z.string().max(200).optional().describe("Email only"),
        destinationUrl: z.string().max(500).optional().describe("Where {link} goes. Default: the free-audit page"),
        filters: z.object(leadFilterShape).optional().describe("Who gets it — same filters as search_leads"),
        listId: z.number().int().optional().describe("Send to a saved list instead of filters"),
        usePersonalMessages: z.boolean().optional().describe("For a list: send each lead their own saved message when they have one (default true)")
      }
    },
    async (a) => {
      if (!/\{link\}/i.test(a.message)) return fail("The message must contain {link}");
      if (a.channel !== "email" && a.message.length > 1000) return fail("SMS/WhatsApp messages can be 1000 characters at most");
      const destination = safeUrl(a.destinationUrl ?? "https://scaleupweb.xyz/free-audit");
      if (!destination) return fail("destinationUrl must be a full https:// link");
      let senderId: number | undefined;
      if (a.channel === "email") {
        if (!a.subject) return fail("Email campaigns need a subject");
        const [s] = await db
          .select({ id: schema.emailSenders.id })
          .from(schema.emailSenders)
          .where(eq(schema.emailSenders.workspaceId, ws))
          .orderBy(asc(schema.emailSenders.id))
          .limit(1);
        if (!s) return fail("No email sender is connected yet (Channels → Email)");
        senderId = s.id;
      }
      if (!a.filters && a.listId === undefined) return fail("Give filters or a listId");
      if (a.listId !== undefined) {
        const [list] = await db
          .select({ id: schema.leadLists.id })
          .from(schema.leadLists)
          .where(and(eq(schema.leadLists.id, a.listId), eq(schema.leadLists.workspaceId, ws)))
          .limit(1);
        if (!list) return fail("No saved list with that id");
      }
      const filters = toFilters({ ...(a.filters ?? {}), list: a.listId ?? a.filters?.list });
      const id = await createCampaignWithRecipients({
        workspaceId: ws,
        userId: user.id,
        name: `${a.name} (AI draft)`,
        message: a.message,
        destinationUrl: destination,
        audienceQuery: "",
        ratePerMinute: 30,
        filters,
        cleanNames: a.channel === "sms",
        channel: a.channel,
        minDelaySec: a.channel === "email" ? 60 : 30,
        maxDelaySec: a.channel === "email" ? 180 : 90,
        dailyLimit: a.channel === "whatsapp" ? 30 : 100,
        subject: a.subject,
        senderId,
        usePersonal: a.usePersonalMessages ?? true
      });
      const [c] = await db.select({ total: C.totalRecipients }).from(C).where(eq(C.id, id)).limit(1);
      return ok({ draftId: id, recipients: c?.total, status: "draft — NOT sent", reviewAndStart: adminUrl(`/campaigns/${id}`) });
    }
  );

  /* ------------------------------------------------------------ inbox */

  tool(
    "list_conversations",
    {
      title: "List replies",
      description: "Latest WhatsApp and email conversations in the Inbox.",
      section: "inbox",
      input: { unreadOnly: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }
    },
    async (a) => {
      const rows = await db.execute(sql`
        select ${M.sender} as contact, max(${M.channel}) as channel, max(${M.senderName}) as name, max(${M.leadId}) as "leadId",
               max(${M.createdAt}) as "lastAt", (array_agg(${M.body} order by ${M.createdAt} desc))[1] as "lastMessage",
               (count(*) filter (where ${M.direction} = 'in' and ${M.readAt} is null))::int as unread
        from ${M} where ${M.workspaceId} = ${ws}
        group by ${M.sender}
        ${a.unreadOnly ? sql`having count(*) filter (where ${M.direction} = 'in' and ${M.readAt} is null) > 0` : sql``}
        order by max(${M.createdAt}) desc limit ${a.limit ?? 20}`);
      return ok([...rows]);
    }
  );

  tool(
    "get_conversation",
    {
      title: "Read a conversation",
      description: "All messages with one contact (phone number or email).",
      section: "inbox",
      input: { contact: z.string().min(3).max(254) }
    },
    async (a) => {
      const contact = a.contact.trim().toLowerCase().replace(/^\+/, "");
      const msgs = await db
        .select({ direction: M.direction, channel: M.channel, subject: M.subject, body: M.body, at: M.createdAt, optOut: M.optOut })
        .from(M)
        .where(and(eq(M.workspaceId, ws), eq(M.sender, contact)))
        .orderBy(asc(M.createdAt))
        .limit(200);
      if (!msgs.length) return fail("No conversation with that contact");
      return ok({ contact, messages: msgs, open: adminUrl(`/inbox?c=${encodeURIComponent(contact)}`) });
    }
  );

  /* ------------------------------------------------------------ clients */

  tool(
    "list_clients",
    {
      title: "List clients",
      description: "Clients with what they've been billed and still owe.",
      section: "clients",
      input: { query: z.string().max(100).optional() }
    },
    async (a) => {
      const conds: SQL[] = [eq(K.workspaceId, ws)];
      if (a.query) {
        const like = `%${a.query.replace(/[%_\\]/g, "\\$&")}%`;
        conds.push(or(ilike(K.name, like), ilike(K.contactName, like), ilike(K.email, like), ilike(K.phone, like))!);
      }
      const rows = await db
        .select({
          c: K,
          billed: sql<number>`coalesce(sum(${I.total}) filter (where ${I.status} = 'sent'), 0)::int`,
          paid: sql<number>`coalesce(sum(${I.amountPaid}) filter (where ${I.status} <> 'void'), 0)::int`
        })
        .from(K)
        .leftJoin(I, eq(I.clientId, K.id))
        .where(and(...conds))
        .groupBy(K.id)
        .orderBy(asc(K.name))
        .limit(100);
      return ok(
        rows.map(({ c, billed, paid }) => ({
          id: c.id,
          name: c.name,
          contact: c.contactName,
          phone: c.phone,
          email: c.email,
          status: c.status,
          billed: taka(billed),
          owes: taka(Math.max(0, billed - paid)),
          url: adminUrl(`/clients/${c.id}`)
        }))
      );
    }
  );

  tool(
    "create_client",
    {
      title: "Add a client",
      description: "Add a new client (or turn a lead into one by passing leadId).",
      section: "clients",
      write: true,
      input: {
        name: z.string().min(2).max(160),
        contactName: z.string().max(120).optional(),
        phone: z.string().max(40).optional(),
        email: z.string().max(160).optional(),
        address: z.string().max(400).optional(),
        leadId: z.number().int().optional()
      }
    },
    async (a) => {
      if (a.leadId) {
        const [existing] = await db
          .select({ id: K.id })
          .from(K)
          .where(and(eq(K.workspaceId, ws), eq(K.leadId, a.leadId)))
          .limit(1);
        if (existing) return ok({ clientId: existing.id, note: "This lead is already a client", url: adminUrl(`/clients/${existing.id}`) });
        const [lead] = await db
          .select({ id: L.id })
          .from(L)
          .where(and(eq(L.id, a.leadId), eq(L.workspaceId, ws)))
          .limit(1);
        if (!lead) return fail("No lead with that id");
        await db.update(L).set({ status: "won", updatedAt: new Date() }).where(eq(L.id, a.leadId));
      }
      const [c] = await db
        .insert(K)
        .values({
          workspaceId: ws,
          name: a.name,
          contactName: a.contactName,
          phone: a.phone,
          email: a.email?.toLowerCase(),
          address: a.address,
          leadId: a.leadId
        })
        .returning({ id: K.id });
      return ok({ clientId: c.id, url: adminUrl(`/clients/${c.id}`) });
    }
  );

  /* ------------------------------------------------------------ invoices */

  tool(
    "list_invoices",
    {
      title: "List invoices",
      description: "Invoices with their payment state.",
      section: "invoices",
      input: { state: z.enum(["all", "unpaid", "overdue", "paid", "draft"]).optional() }
    },
    async (a) => {
      const rows = await db
        .select({ inv: I, client: K.name })
        .from(I)
        .innerJoin(K, eq(K.id, I.clientId))
        .where(eq(I.workspaceId, ws))
        .orderBy(desc(I.issueDate))
        .limit(300);
      const want = a.state ?? "all";
      const list = rows
        .map((r) => ({ ...r, state: invoiceState(r.inv) }))
        .filter((r) => want === "all" || (want === "unpaid" ? ["sent", "partial", "overdue"].includes(r.state) : r.state === want));
      return ok(
        list.slice(0, 100).map(({ inv, client, state }) => ({
          id: inv.id,
          number: inv.number,
          client,
          state,
          total: taka(inv.total),
          due: taka(Math.max(0, inv.total - inv.amountPaid)),
          dueDate: fmtDate(inv.dueDate),
          clientLink: inv.status === "draft" ? null : invoiceUrl(inv.publicToken),
          url: adminUrl(`/invoices/${inv.id}`)
        }))
      );
    }
  );

  tool(
    "get_invoice",
    {
      title: "Invoice details",
      description: "One invoice by id or number (e.g. SU-2026-0001), with lines and payments.",
      section: "invoices",
      input: { id: z.number().int().optional(), number: z.string().max(40).optional() }
    },
    async (a) => {
      if (!a.id && !a.number) return fail("Give an id or a number");
      const [row] = await db
        .select({ inv: I, client: K })
        .from(I)
        .innerJoin(K, eq(K.id, I.clientId))
        .where(and(eq(I.workspaceId, ws), a.id ? eq(I.id, a.id) : eq(I.number, a.number!.toUpperCase())))
        .limit(1);
      if (!row) return fail("No such invoice");
      const [items, payments] = await Promise.all([
        db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, row.inv.id)).orderBy(asc(schema.invoiceItems.position)),
        db.select().from(schema.payments).where(eq(schema.payments.invoiceId, row.inv.id))
      ]);
      return ok({
        number: row.inv.number,
        client: row.client.name,
        state: invoiceState(row.inv),
        total: taka(row.inv.total),
        paid: taka(row.inv.amountPaid),
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, price: taka(i.unitPrice), amount: taka(i.amount) })),
        payments: payments.map((p) => ({ amount: taka(p.amount), method: p.method, reference: p.reference, date: fmtDate(p.paidAt) })),
        clientLink: row.inv.status === "draft" ? null : invoiceUrl(row.inv.publicToken),
        url: adminUrl(`/invoices/${row.inv.id}`)
      });
    }
  );

  tool(
    "create_invoice_draft",
    {
      title: "Create an invoice draft",
      description: "Create a DRAFT invoice for a client. It is not sent — a person reviews it and sends the link from the admin. Prices are in taka.",
      section: "invoices",
      write: true,
      input: {
        clientId: z.number().int(),
        items: z
          .array(
            z.object({
              description: z.string().min(1).max(500),
              quantity: z.number().int().min(1).max(10000).default(1),
              price: z.number().min(0).max(100_000_000)
            })
          )
          .min(1)
          .max(50),
        discount: z.number().min(0).optional().describe("Taka off the subtotal"),
        dueInDays: z.number().int().min(0).max(120).optional(),
        notes: z.string().max(2000).optional()
      }
    },
    async (a) => {
      const [client] = await db
        .select({ id: K.id, name: K.name })
        .from(K)
        .where(and(eq(K.id, a.clientId), eq(K.workspaceId, ws)))
        .limit(1);
      if (!client) return fail("No client with that id (use list_clients or create_client)");
      const lines = a.items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: parseTaka(it.price) ?? 0 }));
      const t = totals(lines, parseTaka(a.discount ?? 0) ?? 0);
      const { billing } = await getBilling(ws);
      const now = new Date();
      let id: number | null = null;
      let number = "";
      for (let attempt = 0; attempt < 5 && !id; attempt++) {
        number = await nextInvoiceNumber(ws, invoicePrefix(billing));
        const [row] = await db
          .insert(I)
          .values({
            workspaceId: ws,
            clientId: client.id,
            number,
            issueDate: now,
            dueDate: new Date(now.getTime() + (a.dueInDays ?? billing.dueDays ?? 7) * 86_400_000),
            ...t,
            notes: a.notes ?? null,
            terms: billing.defaultTerms ?? null,
            publicToken: publicToken(),
            createdBy: user.id
          })
          .onConflictDoNothing()
          .returning({ id: I.id });
        id = row?.id ?? null;
      }
      if (!id) return fail("Could not number the invoice — try again");
      await db.insert(schema.invoiceItems).values(lines.map((l, i) => ({ invoiceId: id!, position: i, ...l, amount: l.quantity * l.unitPrice })));
      return ok({ invoiceId: id, number, client: client.name, total: taka(t.total), status: "draft — NOT sent", reviewAndSend: adminUrl(`/invoices/${id}`) });
    }
  );

  return server;
}
