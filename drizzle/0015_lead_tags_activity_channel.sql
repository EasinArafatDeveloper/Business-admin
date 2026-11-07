ALTER TABLE "lead_activities" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_tags_idx" ON "leads" USING gin ("tags");--> statement-breakpoint
-- Backfill: every message already sent by a campaign becomes a timeline row on its lead.
INSERT INTO "lead_activities" ("workspace_id", "lead_id", "type", "channel", "body", "meta", "created_at")
SELECT r."workspace_id", r."lead_id", (CASE c."channel" WHEN 'whatsapp' THEN 'wa' ELSE c."channel" END) || '_sent', c."channel",
  left(coalesce(r."subject" || E'\n', '') || r."message", 1000),
  jsonb_build_object('campaignId', c."id", 'campaign', c."name", 'recipientId', r."id"),
  coalesce(r."sent_at", now())
FROM "campaign_recipients" r JOIN "campaigns" c ON c."id" = r."campaign_id"
WHERE r."status" = 'sent' AND r."lead_id" IS NOT NULL;--> statement-breakpoint
UPDATE "lead_activities" SET "channel" = 'whatsapp' WHERE "channel" IS NULL AND "type" IN ('wa_reply', 'wa_out');--> statement-breakpoint
UPDATE "lead_activities" SET "channel" = 'email' WHERE "channel" IS NULL AND "type" IN ('email_reply', 'email_out', 'email_optout');
