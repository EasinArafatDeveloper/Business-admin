CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'interested', 'proposal', 'won', 'lost', 'skip');--> statement-breakpoint
CREATE TABLE "imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer,
	"file_name" text NOT NULL,
	"sheet" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"user_id" integer,
	"type" text NOT NULL,
	"body" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"source" text DEFAULT 'import' NOT NULL,
	"external_key" text NOT NULL,
	"page_name" text,
	"industry" text,
	"category" text,
	"size_tier" text,
	"followers" integer,
	"score" integer,
	"priority" text,
	"primary_service" text,
	"service_category" text,
	"pain_point" text,
	"other_services" text,
	"all_services" text,
	"service_gaps" integer,
	"pitch" text,
	"phone" text,
	"whatsapp" text,
	"email" text,
	"website" text,
	"website_type" text,
	"website_platform" text,
	"orders_via" text,
	"active_ads" integer,
	"running_days" integer,
	"offers" text,
	"ad_price_range" text,
	"address" text,
	"page_link" text,
	"ads_library_link" text,
	"in_bangladesh" boolean,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"details" jsonb,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_workspace_key_idx" ON "leads" USING btree ("workspace_id","external_key");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "leads_priority_idx" ON "leads" USING btree ("workspace_id","priority");--> statement-breakpoint
CREATE INDEX "leads_industry_idx" ON "leads" USING btree ("workspace_id","industry");--> statement-breakpoint
CREATE INDEX "leads_service_idx" ON "leads" USING btree ("workspace_id","primary_service");--> statement-breakpoint
CREATE INDEX "leads_score_idx" ON "leads" USING btree ("workspace_id","score");--> statement-breakpoint
CREATE INDEX "leads_source_idx" ON "leads" USING btree ("workspace_id","source","created_at");