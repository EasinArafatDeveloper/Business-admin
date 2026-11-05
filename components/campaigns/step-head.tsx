export function StepHead({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent-soft">{n}</span>
      <h2 className="font-medium">{title}</h2>
      {hint && <span className="text-xs text-muted-2">{hint}</span>}
    </div>
  );
}
