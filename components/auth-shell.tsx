/** Centered card used by /login and /setup. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ background: "radial-gradient(60% 50% at 50% 0%, rgba(59,107,255,0.18), transparent 70%)" }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent">
            <span className="h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          <span className="text-lg font-semibold">ScaleUp Admin</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6">{children}</div>
      </div>
    </main>
  );
}
