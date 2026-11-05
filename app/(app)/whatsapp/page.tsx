import { redirect } from "next/navigation";

/** Old address — WhatsApp now lives under Channels. */
export default function WhatsappPage() {
  redirect("/channels?tab=whatsapp");
}
