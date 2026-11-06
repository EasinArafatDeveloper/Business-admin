ALTER TABLE "lead_list_items" ADD COLUMN "offer" text;--> statement-breakpoint
ALTER TABLE "lead_list_items" ADD COLUMN "tag" text;--> statement-breakpoint
CREATE INDEX "lead_list_items_tag_idx" ON "lead_list_items" USING btree ("list_id","tag");