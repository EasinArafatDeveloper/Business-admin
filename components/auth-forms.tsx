"use client";

import { useActionState } from "react";
import { login, setup, type FormState } from "@/app/actions/auth";
import { Button, Label, inputClass } from "@/components/ui";

function ErrorBox({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block">
        <Label>Email</Label>
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
      </label>
      <label className="block">
        <Label>Password</Label>
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </label>
      <ErrorBox state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setup, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <Label>Business / workspace name</Label>
        <input name="workspace" defaultValue="ScaleUp Web" required className={inputClass} />
      </label>
      <label className="block">
        <Label>Your name</Label>
        <input name="name" required className={inputClass} />
      </label>
      <label className="block">
        <Label>Email (you sign in with this)</Label>
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
      </label>
      <label className="block">
        <Label hint="at least 10 characters">Password</Label>
        <input name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </label>
      <label className="block">
        <Label>Confirm password</Label>
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </label>
      <ErrorBox state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create account"}
      </Button>
    </form>
  );
}
