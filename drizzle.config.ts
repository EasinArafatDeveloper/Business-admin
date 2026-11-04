import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes SQL migrations to ./drizzle from db/schema.ts.
// They are applied on container start by scripts/migrate.mjs.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" }
});
