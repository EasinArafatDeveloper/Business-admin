import Link from "next/link";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Megaphone } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { PAGE_SIZE, filterOptions, filtersToQuery, findLeads, parseFilters } from "@/lib/leads-query";
import { FilterBar } from "@/components/leads/filter-bar";
import { LeadsTable } from "@/components/leads/leads-table";
import { nf } from "@/lib/utils";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const user = await requireAccess("leads");
  const filters = parseFilters(await searchParams);
  const [{ rows, total }, options] = await Promise.all([findLeads(user.workspaceId, filters), filterOptions(user.workspaceId)]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, filters.page * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted">{nf.format(total)} matching</p>
        </div>
        <div className="flex gap-2">
          <Link href="/leads/import" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm hover:border-accent/60">
            <FileSpreadsheet className="h-4 w-4" /> Import Excel
          </Link>
          <Link
            href={`/campaigns/new${filtersToQuery({ ...filters, page: 1 })}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-white"
            title="Send an SMS or WhatsApp campaign to the leads matching these filters"
          >
            <Megaphone className="h-4 w-4" /> Campaign ({nf.format(total)})
          </Link>
        </div>
      </div>

      <FilterBar options={options} />
      <LeadsTable rows={rows} />

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            {nf.format(from)}–{nf.format(to)} of {nf.format(total)}
          </span>
          <div className="flex items-center gap-1">
            <PageLink disabled={filters.page <= 1} href={`/leads${filtersToQuery(filters, { page: filters.page - 1 })}`} label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </PageLink>
            <span className="px-2">
              Page {filters.page} / {nf.format(pages)}
            </span>
            <PageLink disabled={filters.page >= pages} href={`/leads${filtersToQuery(filters, { page: filters.page + 1 })}`} label="Next">
              <ChevronRight className="h-4 w-4" />
            </PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled)
    return (
      <span aria-disabled className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted-2/50">
        {children}
      </span>
    );
  return (
    <Link href={href} aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong hover:border-accent/60 hover:text-fg">
      {children}
    </Link>
  );
}
