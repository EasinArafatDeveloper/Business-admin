"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAction } from "@/lib/auth";
import { parseFilters, whereFor } from "@/lib/leads-query";
import { MAX_LIST, addLeads } from "@/lib/lists";

export type ListState = { error?: string; ok?: string } | undefined;

const LL = schema.leadLists;
const LI = schema.leadListItems;
const L = schema.leads;

async function ownedList(id: number, workspaceId: number) {
  const [list] = await db
    .select()
    .from(LL)
    .where(and(eq(LL.id, id), eq(LL.workspaceId, workspaceId)))
    .limit(1);
  return list ?? null;
}

/** "Save these leads": everything matching the current Leads filters (up to 1000) into a new or existing list. */
export async function saveFilterToList(_: ListState, formData: FormData): Promise<ListState> {
  const user = await requireAction("leads");
  const q = new URLSearchParams(String(formData.get("query") ?? ""));
  const filters = parseFilters({ ...Object.fromEntries(q.entries()), has: q.getAll("has") });
  const existingId = Number(formData.get("listId")) || null;
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 120);

  let listId = existingId;
  if (listId) {
    if (!(await ownedList(listId, user.workspaceId))) return { error: "List not found" };
  } else {
    if (name.length < 2) return { error: "Name the list" };
    [{ id: listId }] = await db.insert(LL).values({ workspaceId: user.workspaceId, name, createdBy: user.id, source: "manual" }).returning({ id: LL.id });
  }
  const leads = await db
    .select({ id: L.id })
    .from(L)
    .where(whereFor(user.workspaceId, { ...filters, list: filters.list === listId ? undefined : filters.list }))
    .orderBy(sql`${L.score} desc nulls last`, asc(L.id))
    .limit(MAX_LIST);
  const added = await addLeads(
    listId!,
    leads.map((l) => ({ leadId: l.id }))
  );
  revalidatePath("/leads/lists");
  redirect(`/leads/lists/${listId}?added=${added}`);
}

export async function renameList(id: number, _: ListState, formData: FormData): Promise<ListState> {
  const user = await requireAction("leads");
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 120);
  const description =
    String(formData.get("description") ?? "")
      .trim()
      .slice(0, 1000) || null;
  if (name.length < 2) return { error: "Name the list" };
  await db
    .update(LL)
    .set({ name, description, updatedAt: new Date() })
    .where(and(eq(LL.id, id), eq(LL.workspaceId, user.workspaceId)));
  revalidatePath(`/leads/lists/${id}`);
  return { ok: "Saved" };
}

export async function deleteList(id: number) {
  const user = await requireAction("leads");
  await db.delete(LL).where(and(eq(LL.id, id), eq(LL.workspaceId, user.workspaceId)));
  revalidatePath("/leads/lists");
  redirect("/leads/lists");
}

/** Edit (or clear) one person's own message in a list. */
export async function saveItemMessage(itemId: number, _: ListState, formData: FormData): Promise<ListState> {
  const user = await requireAction("leads");
  const [item] = await db
    .select({ id: LI.id, listId: LI.listId })
    .from(LI)
    .innerJoin(LL, eq(LL.id, LI.listId))
    .where(and(eq(LI.id, itemId), eq(LL.workspaceId, user.workspaceId)))
    .limit(1);
  if (!item) return { error: "Not found" };
  const message =
    String(formData.get("message") ?? "")
      .trim()
      .slice(0, 5000) || null;
  const subject =
    String(formData.get("subject") ?? "")
      .trim()
      .slice(0, 200) || null;
  const emailBody =
    String(formData.get("emailBody") ?? "")
      .trim()
      .slice(0, 10000) || null;
  await db.update(LI).set({ message, subject, emailBody }).where(eq(LI.id, itemId));
  revalidatePath(`/leads/lists/${item.listId}`);
  return { ok: message ? "Saved" : "Cleared — they'll get the shared message" };
}

export async function removeItem(itemId: number) {
  const user = await requireAction("leads");
  const [item] = await db
    .select({ id: LI.id, listId: LI.listId })
    .from(LI)
    .innerJoin(LL, eq(LL.id, LI.listId))
    .where(and(eq(LI.id, itemId), eq(LL.workspaceId, user.workspaceId)))
    .limit(1);
  if (!item) return;
  await db.delete(LI).where(eq(LI.id, itemId));
  revalidatePath(`/leads/lists/${item.listId}`);
}
