import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiUser } from "@/lib/auth";
import { runImport } from "@/lib/import-leads";

const MAX_BYTES = 60 * 1024 * 1024; // 60 MB

/** Upload an .xlsx → saved to a temp file → imported in the background. Returns the import id to poll. */
export async function POST(request: Request) {
  const user = await apiUser("leads");
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Please upload an .xlsx file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 60 MB" }, { status: 413 });

  const path = join(tmpdir(), `lead-import-${randomUUID()}.xlsx`);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));

  const [imp] = await db
    .insert(schema.imports)
    .values({ workspaceId: user.workspaceId, userId: user.id, fileName: file.name.slice(0, 200) })
    .returning({ id: schema.imports.id });

  // Not awaited: the browser polls GET /api/leads/import?id=… for progress.
  void runImport(imp.id, user.workspaceId, path);
  return NextResponse.json({ id: imp.id });
}

/** Progress of one import (?id=) or the 10 most recent imports. */
export async function GET(request: Request) {
  const user = await apiUser("leads");
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  const I = schema.imports;
  if (id) {
    const [row] = await db.select().from(I).where(eq(I.id, id)).limit(1);
    if (!row || row.workspaceId !== user.workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  }
  const rows = await db.select().from(I).where(eq(I.workspaceId, user.workspaceId)).orderBy(desc(I.id)).limit(10);
  return NextResponse.json(rows);
}
