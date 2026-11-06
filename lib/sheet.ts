import "server-only";
import ExcelJS from "exceljs";

export type Sheet = { headers: string[]; rows: string[][]; sheetName: string };
export const MAX_ROWS = 5000;

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText)
      return o.richText
        .map((r) => r.text)
        .join("")
        .trim();
    if (o.text != null) return cellText(o.text);
    if (o.result != null) return cellText(o.result);
    if (o.hyperlink) return o.hyperlink;
  }
  return "";
}

/** Small CSV reader: commas or semicolons, "quoted, fields" and "" escapes. */
function parseCsv(text: string): string[][] {
  const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cur.trim());
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur.trim());
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}

/** First sheet (or the one with the most rows), first non-empty row = headers. */
export async function readSheet(buf: Buffer, fileName: string): Promise<Sheet> {
  let table: string[][];
  let sheetName = "CSV";
  if (/\.csv$/i.test(fileName)) {
    table = parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
    if (!ws) throw new Error("The file has no sheets");
    sheetName = ws.name;
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map(cellText);
      table.push(vals);
    });
  }
  const start = table.findIndex((r) => r.filter(Boolean).length >= 2);
  if (start < 0) throw new Error("Couldn't find a header row");
  const headers = table[start].map((h, i) => h || `Column ${i + 1}`);
  const rows = table
    .slice(start + 1)
    .filter((r) => r.some(Boolean))
    .slice(0, MAX_ROWS)
    .map((r) => headers.map((_, i) => r[i] ?? ""));
  return { headers, rows, sheetName };
}

export const FIELDS = {
  name: "Business / name",
  phone: "Mobile / WhatsApp",
  email: "Email",
  message: "Their own SMS / WhatsApp message",
  subject: "Their email subject",
  emailBody: "Their email body",
  reason: "Why this lead (note)",
  industry: "Industry",
  address: "Address",
  page: "Facebook page"
} as const;
export type Field = keyof typeof FIELDS;
export type Mapping = Partial<Record<Field, number>>;

/** Best guess of which column is which, from the header names (and the data for phone/email). */
export function guessMapping(sheet: Sheet): Mapping {
  const h = sheet.headers.map((x) => x.toLowerCase());
  const used = new Set<number>();
  const pick = (re: RegExp, not?: RegExp) => {
    const i = h.findIndex((x, idx) => !used.has(idx) && re.test(x) && !(not && not.test(x)));
    if (i >= 0) used.add(i);
    return i >= 0 ? i : undefined;
  };
  const sample = (i: number) => sheet.rows.slice(0, 20).map((r) => r[i] ?? "");
  const m: Mapping = {};
  // Email columns first, so "Email Body" isn't mistaken for the SMS/WhatsApp message.
  m.subject = pick(/subject/);
  m.emailBody = pick(/(email body|email message|email text|mail body|^body$)/);
  m.message =
    pick(/(whatsapp (opener|message|text)|sms|opener)/, /(open whatsapp|pre-?filled|date|follow|email)/) ??
    pick(/(message|text|pitch|script)/, /(open whatsapp|pre-?filled|date|follow|email)/);
  m.email = pick(/e-?mail/) ?? h.findIndex((_, i) => sample(i).filter((v) => /@/.test(v)).length >= 3);
  m.phone =
    pick(/(whatsapp|mobile|phone|number|contact|cell)/, /(open|link|message|chat)/) ??
    h.findIndex((_, i) => sample(i).filter((v) => /(\+?88)?01[3-9]\d{8}/.test(v.replace(/\D/g, ""))).length >= 3);
  m.name = pick(/(business|page name|shop|company|brand|store)/) ?? pick(/(^name$|full name|client|customer)/);
  m.reason = pick(/(why|reason|note|insight)/);
  m.industry = pick(/(industry|category|niche)/);
  m.address = pick(/(address|location|city|area)/);
  m.page = pick(/(facebook|fb page|page link|page url|^page$)/, /(ads|library)/);
  for (const k of Object.keys(m) as Field[]) if (m[k] === undefined || m[k]! < 0) delete m[k];
  return m;
}
