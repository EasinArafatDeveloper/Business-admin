"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bookmark,
  FileSpreadsheet,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  RadioTower,
  Settings,
  Users,
  Briefcase,
  type LucideIcon
} from "lucide-react";
import { logout } from "@/app/actions/auth";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

type Item = { href: string; label: string; icon: LucideIcon; soon?: boolean };

const GROUPS: { title?: string; items: Item[] }[] = [
  { items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Leads",
    items: [
      { href: "/leads", label: "All leads", icon: Users },
      { href: "/leads/lists", label: "Saved lists", icon: Bookmark },
      { href: "/leads/import", label: "Import", icon: FileSpreadsheet }
    ]
  },
  {
    title: "Outreach",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/channels", label: "Channels", icon: RadioTower }
    ]
  },
  {
    title: "Billing",
    items: [
      { href: "/clients", label: "Clients", icon: Briefcase },
      { href: "/invoices", label: "Invoices", icon: FileText }
    ]
  },
  { items: [{ href: "/settings", label: "Settings", icon: Settings }] }
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/leads") return pathname === "/leads" || /^\/leads\/\d+/.test(pathname);
  return pathname.startsWith(href);
}

function NavLink({ item, pathname, compact, badge }: { item: Item; pathname: string; compact?: boolean; badge?: number }) {
  const Icon = item.icon;
  const active = !item.soon && isActive(pathname, item.href);
  const cls = cn(
    "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
    compact && "shrink-0",
    active ? "bg-accent/15 text-fg" : "text-muted hover:bg-surface hover:text-fg",
    item.soon && "pointer-events-none opacity-50"
  );
  const content = (
    <>
      <Icon className={cn("h-4 w-4", active && "text-accent")} />
      <span>{item.label}</span>
      {!!badge && <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white">{badge > 99 ? "99+" : badge}</span>}
      {item.soon && !compact && <span className="ml-auto rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px]">soon</span>}
    </>
  );
  return item.soon ? (
    <span className={cls} aria-disabled>
      {content}
    </span>
  ) : (
    <Link href={item.href} className={cls}>
      {content}
    </Link>
  );
}

export function Sidebar({
  userName,
  workspace,
  badges = {},
  allowed
}: {
  userName: string;
  workspace: string;
  badges?: Record<string, number>;
  /** Links this person may open; others are hidden. */
  allowed: string[];
}) {
  const pathname = usePathname();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed.includes(i.href)) })).filter((g) => g.items.length > 0);
  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 print:!hidden shrink-0 flex-col border-r border-line bg-ink-alt px-3 py-5 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent">
            <span className="h-2 w-2 rounded-full bg-white" />
          </span>
          <span>
            <span className="block text-sm font-semibold leading-tight">{workspace}</span>
            <span className="block text-[11px] text-muted-2">Admin</span>
          </span>
        </Link>
        <nav className="flex-1 space-y-5">
          {groups.map((g, i) => (
            <div key={i} className="space-y-0.5">
              {g.title && <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-2">{g.title}</div>}
              {g.items.map((item) => (
                <NavLink key={item.label} item={item} pathname={pathname} badge={badges[item.href]} />
              ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-line px-2 pt-4">
          <span className="truncate text-xs text-muted">{userName}</span>
          <div className="flex items-center">
            <ThemeToggle />
            <form action={logout}>
              <button className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-fg" aria-label="Sign out" title="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile */}
      <header className="sticky top-0 z-30 border-b border-line bg-ink-alt/95 backdrop-blur print:hidden lg:hidden">
        <div className="scroll-thin flex items-center gap-1 overflow-x-auto px-3 py-2">
          {groups
            .flatMap((g) => g.items)
            .filter((i) => !i.soon)
            .map((item) => (
              <NavLink key={item.label} item={item} pathname={pathname} compact badge={badges[item.href]} />
            ))}
          <ThemeToggle className="ml-auto shrink-0 p-2" />
          <form action={logout} className="shrink-0">
            <button className="rounded-lg p-2 text-muted" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </header>
    </>
  );
}
