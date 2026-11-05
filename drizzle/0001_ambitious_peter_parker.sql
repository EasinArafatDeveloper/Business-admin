CREATE TABLE "campaign_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"lead_id" integer,
	"phone" text NOT NULL,
	"message" text NOT NULL,
	"tracking_code" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_code" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"click_count" integer DEFAULT 0 NOT NULL,
	"bot_click_count" integer DEFAULT 0 NOT NULL,
	"first_clicked_at" timestamp with time zone,
	"last_clicked_at" timestamp with time zone,
	CONSTRAINT "campaign_recipients_tracking_code_unique" UNIQUE("tracking_code")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"created_by" integer,
	"name" text NOT NULL,
	"message" text NOT NULL,
	"destination_url" text NOT NULL,
	"audience_query" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"rate_per_minute" integer DEFAULT 30 NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"human_clicks" integer DEFAULT 0 NOT NULL,
	"unique_clickers" integer DEFAULT 0 NOT NULL,
	"bot_clicks" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "click_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"is_bot" boolean NOT NULL,
	"reason" text NOT NULL,
	"verify_token" text,
	"verified" boolean DEFAULT false NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"client_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sms_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sms_clicks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sms_campaigns_clicked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_recipients_queue_idx" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_lead_idx" ON "campaign_recipients" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "click_events_token_idx" ON "click_events" USING btree ("verify_token");--> statement-breakpoint
CREATE INDEX "click_events_recipient_idx" ON "click_events" USING btree ("recipient_id","created_at");