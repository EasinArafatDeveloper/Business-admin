"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAction } from "@/lib/auth";

export type TemplateState = { error?: string; ok?: number } | undefined;

const TT = schema.messageTemplates;

const templateSchema = z.object({
  id: z.coerce.number().int().optional(),
  channel: z.enum(["sms", "whatsapp", "email"]),
  name: z.string().trim().min(2, "Name the template").max(100),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1, "Write the message").max(10000)
});

/** Creates a template, or updates it when an id is sent. */
export async function saveTemplate(_: TemplateState, formData: FormData): Promise<TemplateState> {
  const user = await requireAction("campaigns");
  const raw = Object.fromEntries(formData);
  const p = templateSchema.safeParse({ ...raw, id: raw.id || undefined });
  if (!p.success) return { error: p.error.issues[0]?.message };
  const d = p.data;
  const values = { channel: d.channel, name: d.name, subject: d.channel === "email" ? d.subject || null : null, body: d.body, updatedAt: new Date() };
  let id = d.id;
  if (id) {
    const rows = await db
      .update(TT)
      .set(values)
      .where(and(eq(TT.id, id), eq(TT.workspaceId, user.workspaceId)))
      .returning({ id: TT.id });
    if (!rows.length) return { error: "Template not found" };
  } else {
    const [row] = await db
      .insert(TT)
      .values({ ...values, workspaceId: user.workspaceId, createdBy: user.id })
      .returning({ id: TT.id });
    id = row.id;
  }
  revalidatePath("/templates");
  return { ok: id };
}

export async function deleteTemplate(id: number) {
  const user = await requireAction("campaigns");
  await db.delete(TT).where(and(eq(TT.id, id), eq(TT.workspaceId, user.workspaceId)));
  revalidatePath("/templates");
}
