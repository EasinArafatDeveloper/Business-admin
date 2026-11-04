"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/actions/auth";
import { Button, Label, inputClass } from "@/components/ui";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="max-w-sm space-y-3">
      <label className="block">
        <Label>Current password</Label>
        <input name="current" type="password" autoComplete="current-password" required className={inputClass} />
      </label>
      <label className="block">
        <Label hint="at least 10 characters">New password</Label>
        <input name="next" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </label>
      <label className="block">
        <Label>Confirm new password</Label>
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </label>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
