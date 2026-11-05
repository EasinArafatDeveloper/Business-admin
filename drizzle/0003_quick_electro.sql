CREATE TABLE "inbound_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"channel" text NOT NULL,
	"sender" text NOT NULL,
	"sender_name" text,
	"body" text NOT NULL,
	"lead_id" integer,
	"opt_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "channel" text DEFAULT 'sms' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "min_delay_sec" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "max_delay_sec" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "daily_limit" integer DEFAULT 150 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "next_send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "wa_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_messages_ws_idx" ON "inbound_messages" USING btree ("workspace_id","created_at");