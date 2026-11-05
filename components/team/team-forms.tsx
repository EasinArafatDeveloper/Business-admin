"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Mail, Power, RotateCw, Trash2, UserPlus, X } from "lucide-react";
import { acceptInvite, inviteMember, removeMember, resendInvite, revokeInvite, setMemberStatus, updateMember, type TeamState } from "@/app/actions/team";
import { PERMISSIONS, ROLES } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Button, Label, inputClass } from "@/components/ui";

function Msg({ state }: { state?: TeamState }) {
  if (state?.error) return <p className="text-sm text-danger">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-success">{state.ok}</p>;
  return null;
}

function CopyLink({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-ink-alt p-2">
      <code className="min-w-0 flex-1 truncate text-xs text-muted">{link}</code>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Role picker + the sections a member can open. */
function AccessFields({ canMakeAdmin, role: initialRole = "member", permissions = [] }: { canMakeAdmin: boolean; role?: string; permissions?: string[] }) {
  const [role, setRole] = useState(initialRole);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["member", "admin"] as const).map((r) => (
          <label
            key={r}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
              role === r ? "border-accent bg-accent/10" : "border-line",
              r === "admin" && !canMakeAdmin && "pointer-events-none opacity-50"
            )}
          >
            <input
              type="radio"
              name="role"
              value={r}
              checked={role === r}
              onChange={() => setRole(r)}
              disabled={r === "admin" && !canMakeAdmin}
              className="mt-1 accent-[#3b6bff]"
            />
            <span>
              <span className="block text-sm font-medium">{ROLES[r].label}</span>
              <span className="text-xs text-muted">{r === "admin" && !canMakeAdmin ? "Only the owner can add admins" : ROLES[r].desc}</span>
            </span>
          </label>
        ))}
      </div>
      {role === "member" && (
        <div>
          <Label hint="tick what they can open">Access</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-ink-alt p-3 hover:border-line-strong">
                <input type="checkbox" name="permissions" value={p.key} defaultChecked={permissions.includes(p.key)} className="mt-0.5 accent-[#3b6bff]" />
                <span>
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="text-xs text-muted">{p.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function InviteForm({ canMakeAdmin }: { canMakeAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(inviteMember, undefined);
  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Invite someone
      </Button>
    );
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium">Invite a team member</h3>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:text-fg" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <form action={action} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <Label>Name</Label>
            <input name="name" placeholder="e.g. Rakib" className={inputClass} />
          </label>
          <label className="block">
            <Label>Email</Label>
            <input name="email" type="email" required placeholder="they sign in with this" className={inputClass} />
          </label>
        </div>
        <AccessFields canMakeAdmin={canMakeAdmin} />
        <Msg state={state} />
        {state?.link && <CopyLink link={state.link} />}
        <Button type="submit" disabled={pending}>
          <Mail className="h-4 w-4" /> {pending ? "Sending…" : "Send invite"}
        </Button>
      </form>
    </div>
  );
}

export function MemberEditor({ id, role, permissions, canMakeAdmin }: { id: number; role: string; permissions: string[]; canMakeAdmin: boolean }) {
  const [state, action, pending] = useActionState(updateMember.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-3 border-t border-line pt-4">
      <AccessFields canMakeAdmin={canMakeAdmin} role={role} permissions={permissions} />
      <Msg state={state} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save access"}
      </Button>
    </form>
  );
}

export function MemberActions({ id, status, name }: { id: number; status: string; name: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<TeamState>();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          (status === "active" ? confirm(`Turn off ${name}? They'll be signed out and can't sign in until you turn them back on.`) : true) &&
          start(async () => setState(await setMemberStatus(id, status === "active" ? "disabled" : "active")))
        }
      >
        <Power className="h-3.5 w-3.5" /> {status === "active" ? "Turn off" : "Turn on"}
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => confirm(`Remove ${name} from the team? This can't be undone.`) && start(async () => setState(await removeMember(id)))}
      >
        <Trash2 className="h-3.5 w-3.5" /> Remove
      </Button>
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
    </div>
  );
}

export function InviteActions({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<TeamState>();
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => setState(await resendInvite(id)))}>
          <RotateCw className="h-3.5 w-3.5" /> Resend
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Cancel this invite?") && start(() => revokeInvite(id))}>
          Cancel
        </Button>
      </div>
      {state?.link && <CopyLink link={state.link} />}
      {state?.error && <p className="text-xs text-danger">{state.error}</p>}
    </div>
  );
}

export function AcceptInviteForm({ token, name }: { token: string; name: string | null }) {
  const [state, action, pending] = useActionState(acceptInvite.bind(null, token), undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <Label>Your name</Label>
        <input name="name" required defaultValue={name ?? ""} autoComplete="name" className={inputClass} />
      </label>
      <label className="block">
        <Label hint="at least 10 characters">Choose a password</Label>
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </label>
      <label className="block">
        <Label>Confirm password</Label>
        <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </label>
      <Msg state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Setting up…" : "Join and sign in"}
      </Button>
    </form>
  );
}
