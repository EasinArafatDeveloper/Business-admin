ALTER TABLE "inbound_messages" ADD COLUMN "direction" text DEFAULT 'in' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_messages_sender_idx" ON "inbound_messages" USING btree ("workspace_id","sender");