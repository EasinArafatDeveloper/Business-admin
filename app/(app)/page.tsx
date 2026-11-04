import Link from "next/link";
import { and, desc, eq, isNotNull, like, ne, sql } from "drizzle-orm";
import { ArrowUpRight, FileSpreadsheet, Globe, Mail, MessageCircle, Phone } from "lucide-react";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { LEAD_STATUSES } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { nf, timeAgo } from "@/lib/utils";
import { Card, StatusBadge } from "@/components/ui";

export const metadata = { title: "Dashboard" };

const L = schema.leads;

export default async function DashboardPage() {
  const user = await requireUser();
  const ws = eq(L.workspaceId, user.workspaceId);
  const filled = (c: AnyPgColumn) => sql<number>`count(*) filter (where ${c} is not null and ${c} <> '')::int`;

  const [[totals], byStatus, byPriority, topIndustries, websiteLeads, [lastImport]] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int`, whatsapp: filled(L.whatsapp), phone: filled(L.phone), email: filled(L.email) })
      .from(L)
      .where(ws),
    db.select({ status: L.status, n: sql<number>`count(*)::int` }).from(L).where(ws).groupBy(L.status),
    db.select({ priority: L.priority, n: sql<number>`count(*)::int` }).from(L).where(ws).groupBy(L.priority),
    db
      .select({ industry: L.industry, n: sql<number>`count(*)::int` })
      .from(L)
      .where(and(ws, isNotNull(L.industry), ne(L.priority, "Skip")))
      .groupBy(L.industry)
      .orderBy(sql`count(*) desc`)
      .limit(8),
    db
      .select({ id: L.id, pageName: L.pageName, source: L.source, status: L.status, createdAt: L.createdAt, phone: L.phone })
      .from(L)
      .where(and(ws, like(L.source, "website-%")))
      .orderBy(desc(L.createdAt))
      .limit(8),
    db.select().from(schema.imports).where(eq(schema.imports.workspaceId, user.workspaceId)).orderBy(desc(schema.imports.id)).limit(1)
  ]);

  const statusCount = Object.fromEntries(byStatus.map((s) => [s.status, s.n]));
  const prio = Object.fromEntries(byPriority.map((p) => [p.priority ?? "—", p.n]));
  const maxInd = Math.max(1, ...topIndustries.map((i) => i.n));

  if (totals.total === 0) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <FileSpreadsheet className="mx-auto h-10 w-10 text-accent" />
        <h1 className="mt-5 text-2xl font-semibold">Welcome, {user.name.split(" ")[0]}</h1>
        <p className="mt-2 text-muted">No leads yet. Import your Excel file to get started.</p>
        <Link href="/leads/import" className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white">
          Import leads <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const stats = [
    { label: "Total leads", value: totals.total, href: "/leads" },
    { label: "Hot", value: prio["A - Hot"] ?? 0, href: "/leads?priority=A+-+Hot" },
    { label: "Warm", value: prio["B - Warm"] ?? 0, href: "/leads?priority=B+-+Warm" },
    { label: "Cold", value: prio["C - Cold"] ?? 0, href: "/leads?priority=C+-+Cold" }
  ];
  const reach = [
    { label: "WhatsApp", value: totals.whatsapp, icon: MessageCircle, href: "/leads?has=whatsapp" },
    { label: "Phone", value: totals.phone, icon: Phone, href: "/leads?has=phone" },
    { label: "Email", value: totals.email, icon: Mail, href: "/leads?has=email" }
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">
          {lastImport ? `Last import ${timeAgo(lastImport.createdAt)} · ${lastImport.fileName}` : "Your sales pipeline at a glance."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="p-5 transition-colors hover:border-line-strong">
              <div className="text-xs text-muted">{s.label}</div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">{nf.format(s.value)}</div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Pipeline */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Pipeline</h2>
            <span className="text-xs text-muted-2">click a stage to open it</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {LEAD_STATUSES.map((s) => (
              <Link
                key={s}
                href={`/leads?status=${s}`}
                className="rounded-xl border border-line bg-ink-alt p-3 transition-colors hover:border-line-strong"
              >
                <StatusBadge status={s} />
                <div className="mt-2 text-xl font-semibold">{nf.format(statusCount[s] ?? 0)}</div>
              </Link>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {reach.map((r) => (
              <Link key={r.label} href={r.href} className="rounded-xl border border-line p-3 hover:border-line-strong">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <r.icon className="h-3.5 w-3.5" /> Has {r.label}
                </div>
                <div className="mt-1 text-lg font-semibold">{nf.format(r.value)}</div>
              </Link>
            ))}
          </div>
        </Card>

        {/* Website leads */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4 text-accent" /> From the website
            </h2>
            <Link href="/leads?source=website-contact" className="text-xs text-muted hover:text-fg">
              all
            </Link>
          </div>
          {websiteLeads.length === 0 ? (
            <p className="mt-6 text-sm text-muted-2">No form submissions yet. They appear here as soon as someone fills in the contact or free-audit form.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {websiteLeads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent-soft">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{l.pageName}</span>
                      <span className="text-[11px] text-muted-2">
                        {l.source === "website-audit" ? "Free audit" : "Contact"} · {timeAgo(l.createdAt)}
                      </span>
                    </span>
                    <StatusBadge status={l.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Industries */}
      <Card className="p-5">
        <h2 className="text-sm font-medium">Top industries (excluding Skip)</h2>
        <div className="mt-4 space-y-2.5">
          {topIndustries.map((i) => (
            <Link key={i.industry} href={`/leads?industry=${encodeURIComponent(i.industry ?? "")}`} className="group block">
              <div className="flex justify-between text-sm">
                <span className="text-fg group-hover:text-accent-soft">{i.industry}</span>
                <span className="text-muted">{nf.format(i.n)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent/70" style={{ width: `${(i.n / maxInd) * 100}%` }} />
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
