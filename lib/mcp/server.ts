import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { LEAD_STATUSES } from "@/lib/constants";
import { findLeads, parseFilters } from "@/lib/leads-query";
import { createCampaignWithRecipients, dhakaNow } from "@/lib/campaigns";
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
    .describe("Only leads that have these")
};
type LeadFilterInput = { query?: string; status?: string; priority?: string; industry?: string; service?: string; source?: string; has?: string[] };
const toFilters = (f: LeadFilterInput) =>
  parseFilters({ q: f.query, status: f.status, priority: f.priority, industry: f.industry, service: f.service, source: f.source, has: f.has ?? [] });

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
      description: "Find leads with filters. Returns up to `limit` (max 50) plus the total that match.",
      section: "leads",
      input: { ...leadFilterShape, limit: z.number().int().min(1).max(50).optional() }
    },
    async (a) => {
      const { rows, total } = await findLeads(ws, toFilters(a));
      return ok({
        total,
        leads: rows.slice(0, a.limit ?? 20).map((l) => ({
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
        .select({ type: schema.leadActivities.type, body: schema.leadActivities.body, at: schema.leadActivities.createdAt })
        .from(schema.leadActivities)
        .where(eq(schema.leadActivities.leadId, lead.id))
        .orderBy(desc(schema.leadActivities.createdAt))
        .limit(15);
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
        filters: z.object(leadFilterShape).describe("Who gets it — same filters as search_leads")
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
      const filters = toFilters(a.filters);
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
        senderId
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
