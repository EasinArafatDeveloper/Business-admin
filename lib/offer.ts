/** Sorts an offer like "AI Messenger Chatbot — ৳10,000" into a short group for filtering. Shared by server and browser. */
export const OFFER_GROUPS = ["Website", "AI automation", "WhatsApp automation"] as const;

export function offerGroup(offer: string | null | undefined): string | null {
  const o = (offer ?? "").trim();
  if (!o) return null;
  // Order matters: "Launch Bundle (… WhatsApp button …)" is a website, not WhatsApp automation.
  if (/whatsapp\s*(business)?\s*(api|automation|bot|chatbot)/i.test(o)) return "WhatsApp automation";
  if (/(chat\s*bot|\bai\b|automation|\bcrm\b)/i.test(o)) return "AI automation";
  if (/(web\s*site|landing|e-?com|online store|launch bundle|grow bundle|\bsite\b)/i.test(o)) return "Website";
  if (/(seo|geo|pixel|capi|tracking)/i.test(o)) return "SEO & tracking";
  // Anything else: the name before " — " / "(" / "৳", e.g. "Custom ERP".
  return (
    o
      .split(/\s+[—–-]\s+|\(|৳/)[0]
      .trim()
      .slice(0, 40) || null
  );
}
