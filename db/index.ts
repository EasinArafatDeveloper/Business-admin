import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// During `next build` routes are loaded to read their config but never query the database,
// and the image is built without secrets. postgres.js only connects on the first query.
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const url = process.env.DATABASE_URL ?? (isBuild ? "postgres://build@localhost:5432/build" : undefined);
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

// One pool per server process (kept across dev hot-reloads).
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };
const sql = globalForDb.sql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
