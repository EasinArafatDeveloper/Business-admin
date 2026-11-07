CREATE TABLE "enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"sequence_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_due_at" timestamp with time zone,
	"state" text DEFAULT 'active' NOT NULL,
	"note" text,
	"enrolled_by" integer,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"sequence_id" integer NOT NULL,
	"position" integer NOT NULL,
	"day" integer DEFAULT 1 NOT NULL,
	"channel" text NOT NULL,
	"mode" text DEFAULT 'manual' NOT NULL,
	"subject" text,
	"body" text DEFAULT '' NOT NULL,
	"campaign_id" integer
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"destination_url" text,
	"email_sender_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"enrollment_id" integer,
	"step_id" integer,
	"recipient_id" integer,
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"body" text,
	"contact" text,
	"due_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"assignee_id" integer,
	"done_at" timestamp with time zone,
	"done_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "sequence_id" integer;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_enrolled_by_users_id_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_email_sender_id_email_senders_id_fk" FOREIGN KEY ("email_sender_id") REFERENCES "public"."email_senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_step_id_sequence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_unique" ON "enrollments" USING btree ("sequence_id","lead_id");--> statement-breakpoint
CREATE INDEX "enrollments_due_idx" ON "enrollments" USING btree ("state","next_due_at");--> statement-breakpoint
CREATE INDEX "enrollments_lead_idx" ON "enrollments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "message_templates_ws_idx" ON "message_templates" USING btree ("workspace_id","channel");--> statement-breakpoint
CREATE INDEX "sequence_steps_seq_idx" ON "sequence_steps" USING btree ("sequence_id","position");--> statement-breakpoint
CREATE INDEX "sequences_ws_idx" ON "sequences" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("workspace_id","state","due_at");--> statement-breakpoint
CREATE INDEX "tasks_lead_idx" ON "tasks" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE set null ON UPDATE no action;