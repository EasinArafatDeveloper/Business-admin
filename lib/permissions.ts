/** Sections of the admin you can give a team member. Shared by server and browser. */
export const PERMISSIONS = [
  { key: "leads", label: "Leads", desc: "See, edit, import and export leads", href: "/leads" },
  { key: "campaigns", label: "Campaigns", desc: "Create and send SMS, WhatsApp and email campaigns", href: "/campaigns" },
  { key: "inbox", label: "Inbox", desc: "Read and answer replies", href: "/inbox" },
  { key: "channels", label: "Channels", desc: "Connect WhatsApp, email senders, SMS", href: "/channels" },
  { key: "clients", label: "Clients", desc: "See and edit clients, convert leads", href: "/clients" },
  { key: "invoices", label: "Invoices", desc: "Create and send invoices, confirm payments", href: "/invoices" }
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
/** Only owners and admins: team management and business/invoice settings. */
export type AdminArea = "team" | "business";

export const ROLES = {
  owner: { label: "Owner", desc: "Everything, including the team" },
  admin: { label: "Admin", desc: "Everything except changing the owner" },
  member: { label: "Member", desc: "Only the sections you tick" }
} as const;
export type Role = keyof typeof ROLES;

const KEYS = PERMISSIONS.map((p) => p.key) as string[];
export const cleanPermissions = (list: unknown): Permission[] =>
  Array.isArray(list) ? ([...new Set(list.filter((p): p is string => typeof p === "string" && KEYS.includes(p)))] as Permission[]) : [];

export function can(user: { role: string; permissions: string[] | null }, what: Permission | AdminArea) {
  if (user.role === "owner" || user.role === "admin") return true;
  if (what === "team" || what === "business") return false;
  return (user.permissions ?? []).includes(what);
}

/** Where to send someone after sign-in: the dashboard, or the first section they can open. */
export function homeFor(user: { role: string; permissions: string[] | null }) {
  if (can(user, "leads")) return "/";
  return PERMISSIONS.find((p) => can(user, p.key))?.href ?? "/settings";
}
