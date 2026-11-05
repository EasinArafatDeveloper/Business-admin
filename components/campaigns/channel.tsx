import { Mail, MessageCircle, MessageSquareText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChannelKey = "sms" | "whatsapp" | "email";

/** One look per channel, used everywhere a channel appears. */
export const CHANNELS: Record<ChannelKey, { label: string; icon: LucideIcon; tint: string; text: string }> = {
  sms: { label: "SMS", icon: MessageSquareText, tint: "bg-accent/15", text: "text-accent-soft" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, tint: "bg-[#25d366]/15", text: "text-wa" },
  email: { label: "Email", icon: Mail, tint: "bg-[#f59e0b]/15", text: "text-amber" }
};

export function channelOf(c: string): ChannelKey {
  return c === "whatsapp" || c === "email" ? c : "sms";
}

export function ChannelIcon({ channel, size = "md", className }: { channel: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const ch = CHANNELS[channelOf(channel)];
  const Icon = ch.icon;
  const box = size === "sm" ? "h-6 w-6 rounded-md" : size === "lg" ? "h-11 w-11 rounded-xl" : "h-8 w-8 rounded-lg";
  const icon = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", box, ch.tint, ch.text, className)}>
      <Icon className={icon} />
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: string }) {
  const ch = CHANNELS[channelOf(channel)];
  const Icon = ch.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", ch.tint, ch.text)}>
      <Icon className="h-3 w-3" /> {ch.label}
    </span>
  );
}

/** Small "dot + text" health line (green ok / amber warn / red down / grey off). */
export function Health({ tone, children }: { tone: "ok" | "warn" | "down" | "off"; children: React.ReactNode }) {
  const dot = { ok: "bg-success", warn: "bg-warning", down: "bg-danger", off: "bg-muted-2" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot, tone === "ok" && "shadow-[0_0_0_3px_rgba(111,214,168,0.15)]")} />
      {children}
    </span>
  );
}
