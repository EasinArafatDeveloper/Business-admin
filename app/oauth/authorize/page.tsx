import { redirect } from "next/navigation";
import { Check, ShieldCheck, X } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { checkAuthorize } from "@/lib/oauth-request";
import { PERMISSIONS, can } from "@/lib/permissions";
import { approveConnection, denyConnection } from "@/app/actions/oauth";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui";

export const metadata = { title: "Connect an app", robots: { index: false, follow: false } };

/** "Sign in with ScaleUp" — an AI app (claude.ai, ChatGPT…) asks to act as you; you choose read-only or read + drafts. */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const sp = await searchParams;
  const p = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const check = await checkAuthorize(p);
  if ("fatal" in check)
    return (
      <AuthShell title="Can't connect this app" subtitle={check.fatal ?? ""}>
        <p className="text-sm text-muted">Nothing was shared.</p>
      </AuthShell>
    );
  if ("redirectTo" in check) redirect(check.redirectTo!);

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(p as Record<string, string>)}`)}`);

  const { client, params } = check;
  const host = new URL(params.redirect_uri).host;
  const sections = PERMISSIONS.filter((x) => can(user, x.key)).map((x) => x.label);
  const hidden = { ...p, client_id: params.client_id, redirect_uri: params.redirect_uri };

  return (
    <AuthShell title={`Connect ${client.name}`} subtitle={`${client.name} wants to use ScaleUp Admin as ${user.name}.`}>
      <form className="space-y-4">
        {Object.entries(hidden).map(([k, v]) => (k === "scope" || v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}

        <div className="space-y-2">
          {[
            ["read", "Read only", "Look up leads, campaigns, replies, clients and invoices."],
            ["write", "Read + make drafts", "Also update leads, add notes, and create campaign and invoice drafts."]
          ].map(([v, l, d]) => (
            <label
              key={v}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10"
            >
              <input type="radio" name="scope" value={v} defaultChecked={v === params.scope} className="mt-1 accent-[#3b6bff]" />
              <span>
                <span className="block text-sm font-medium">{l}</span>
                <span className="text-xs text-muted">{d}</span>
              </span>
            </label>
          ))}
        </div>

        <ul className="space-y-1.5 rounded-xl bg-ink-alt p-3 text-xs text-muted">
          <li className="flex gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-success" /> Only what you can open: {sections.length ? sections.join(", ") : "nothing yet"}
          </li>
          <li className="flex gap-2">
            <X className="h-4 w-4 shrink-0 text-danger" /> It can never send campaigns, messages or invoices
          </li>
          <li className="flex gap-2">
            <Check className="h-4 w-4 shrink-0 text-accent-soft" /> Remove it any time in Settings → AI access
          </li>
        </ul>
        <p className="text-[11px] text-muted-2">You&apos;ll be sent back to {host}.</p>

        <div className="flex gap-2">
          <Button formAction={denyConnection} variant="secondary" className="flex-1">
            Cancel
          </Button>
          <Button formAction={approveConnection} className="flex-1">
            Allow
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
