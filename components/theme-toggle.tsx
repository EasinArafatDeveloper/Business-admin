"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEME_KEY as KEY } from "@/lib/theme";

type Theme = "light" | "dark";
const listeners = new Set<() => void>();
const read = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function ThemeToggle({ className, withLabel }: { className?: string; withLabel?: boolean }) {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  const toggle = () => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    listeners.forEach((l) => l());
  };

  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={cn("inline-flex items-center gap-2 rounded-lg p-1.5 text-muted hover:bg-surface hover:text-fg", className)}
    >
      <Icon className="h-4 w-4" />
      {withLabel && <span className="text-xs">{next === "light" ? "Light mode" : "Dark mode"}</span>}
    </button>
  );
}
