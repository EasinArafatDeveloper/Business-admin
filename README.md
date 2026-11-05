# ScaleUp Admin

Operations dashboard for ScaleUp Web — `admin.scaleupweb.xyz`. Built multi-tenant (workspaces) so it can become a SaaS later.

**Phase 1 (now):** sign-in, leads (Excel import, filters, pipeline, notes, CSV export), website form leads.
**Next:** WhatsApp / SMS campaigns, clients, agreements, invoices.

Stack: Next.js 16, PostgreSQL + Drizzle ORM, Tailwind CSS 4.

## Run on the server
```bash
cd ~/apps/scaleup-admin && git pull && docker compose up -d --build
```
Settings go in `.env` (see `.env.example`). Database migrations run automatically on start.
First account: open http://localhost:3007 on the server PC (setup only works from localhost).

## Change the database
Edit `db/schema.ts`, then `npm run db:generate` and commit the new file in `drizzle/`.
