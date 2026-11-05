CREATE TABLE "lead_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"message" text,
	"subject" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_list_items" ADD CONSTRAINT "lead_list_items_list_id_lead_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_list_items" ADD CONSTRAINT "lead_list_items_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_lists" ADD CONSTRAINT "lead_lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_lists" ADD CONSTRAINT "lead_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_list_items_unique" ON "lead_list_items" USING btree ("list_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_list_items_lead_idx" ON "lead_list_items" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_lists_ws_idx" ON "lead_lists" USING btree ("workspace_id","updated_at");