/**
 * End-to-end import test against a throwaway database:
 *   DATABASE_URL=postgres://…/scaleup_admin_test npx tsx --conditions=react-server scripts/test-import.ts <file.xlsx>
 * Runs migrations, imports the file twice (insert, then update), and checks filters.
 */
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: test-import.ts <file.xlsx>");
  if (!/_test\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run: DATABASE_URL must point at a *_test database");

  const { runMigrations } = await import("../db/migrate");
  await runMigrations();
  const { db, schema } = await import("../db");
  const { runImport } = await import("../lib/import-leads");
  const { findLeads, parseFilters, filterOptions } = await import("../lib/leads-query");

  const [ws] = await db.insert(schema.workspaces).values({ name: "Test", slug: `test-${Date.now()}` }).returning();

  for (const round of [1, 2]) {
    const copy = join(tmpdir(), `test-import-${round}.xlsx`);
    await copyFile(file, copy);
    const [imp] = await db.insert(schema.imports).values({ workspaceId: ws.id, fileName: "test.xlsx" }).returning();
    const t0 = Date.now();
    await runImport(imp.id, ws.id, copy);
    const [r] = await db.select().from(schema.imports).where(eq(schema.imports.id, imp.id));
    console.log(
      `round ${round}: ${r.status} sheet="${r.sheet}" rows=${r.total} new=${r.inserted} updated=${r.updated} skipped=${r.skipped} ` +
        `in ${((Date.now() - t0) / 1000).toFixed(1)}s${r.error ? ` ERROR ${r.error}` : ""}`
    );
    if (round === 1) {
      // Simulate admin work that a re-import must not undo.
      await db.execute(sql`update leads set status = 'interested' where id = (select min(id) from leads where workspace_id = ${ws.id})`);
    }
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(eq(schema.leads.workspaceId, ws.id));
  const kept = await db.execute(sql`select count(*)::int as n from leads where workspace_id = ${ws.id} and status = 'interested'`);
  console.log(`leads in db: ${n}; status kept after re-import: ${(kept as unknown as { n: number }[])[0].n === 1}`);

  const t1 = Date.now();
  const hot = await findLeads(ws.id, parseFilters({ priority: "A - Hot", industry: "Fashion / Clothing", has: "whatsapp", minAds: "2" }));
  const search = await findLeads(ws.id, parseFilters({ q: "dhaka" }));
  const opts = await filterOptions(ws.id);
  console.log(
    `filter Hot+Fashion+WhatsApp+2 ads: ${hot.total} (top: ${hot.rows[0]?.pageName}, score ${hot.rows[0]?.score}); ` +
      `search "dhaka": ${search.total}; industries: ${opts.industry.length}; in ${Date.now() - t1}ms`
  );
  console.log("priority counts:", opts.priority.map((p) => `${p.value}=${p.count}`).join(", "));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
