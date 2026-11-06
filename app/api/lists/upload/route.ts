import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { FIELDS, type Mapping, guessMapping, readSheet } from "@/lib/sheet";
import { importSheetAsList } from "@/lib/list-import";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Upload an Excel/CSV of people with their own messages.
 * step=preview → columns, a best-guess mapping and the first rows; step=import → creates the saved list.
 */
export async function POST(req: Request) {
  const user = await apiUser("leads");
  if (!user) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose an Excel (.xlsx) or CSV file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is too big (8 MB max)" }, { status: 400 });
  if (!/\.(xlsx|csv)$/i.test(file.name)) return NextResponse.json({ error: "Only .xlsx or .csv files" }, { status: 400 });

  let sheet;
  try {
    sheet = await readSheet(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't read the file" }, { status: 400 });
  }

  if (form!.get("step") !== "import") {
    const mapping = guessMapping(sheet);
    return NextResponse.json({ sheetName: sheet.sheetName, headers: sheet.headers, total: sheet.rows.length, mapping, rows: sheet.rows.slice(0, 200) });
  }

  const mapping: Mapping = {};
  try {
    const raw = JSON.parse(String(form!.get("mapping") ?? "{}")) as Record<string, unknown>;
    for (const k of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
      const v = raw[k];
      if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < sheet.headers.length) mapping[k] = v;
    }
  } catch {
    return NextResponse.json({ error: "Bad column mapping" }, { status: 400 });
  }
  if (mapping.phone === undefined && mapping.email === undefined) return NextResponse.json({ error: "Pick the mobile or the email column" }, { status: 400 });
  const listName = String(form!.get("listName") ?? "").trim() || file.name.replace(/\.(xlsx|csv)$/i, "");
  try {
    const intoListId = Number(form!.get("listId")) || undefined;
    const result = await importSheetAsList({ workspaceId: user.workspaceId, userId: user.id, sheet, mapping, listName, fileName: file.name, intoListId });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 400 });
  }
}
