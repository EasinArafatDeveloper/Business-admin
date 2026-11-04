// Applies pending SQL migrations from ./drizzle, then exits. Runs before the server starts (Docker CMD).
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  console.log("migrations: up to date");
} catch (e) {
  console.error("migrations failed:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
