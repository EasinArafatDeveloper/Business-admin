ALTER TABLE "email_senders" ADD COLUMN "imap_host" text;--> statement-breakpoint
ALTER TABLE "email_senders" ADD COLUMN "imap_uid_validity" text;--> statement-breakpoint
ALTER TABLE "email_senders" ADD COLUMN "imap_last_uid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_senders" ADD COLUMN "imap_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_senders" ADD COLUMN "imap_error" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "email_sender_id" integer;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_email_sender_id_email_senders_id_fk" FOREIGN KEY ("email_sender_id") REFERENCES "public"."email_senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_external_idx" ON "inbound_messages" USING btree ("workspace_id","external_id");