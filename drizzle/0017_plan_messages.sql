CREATE TABLE "plan_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"sequence_id" integer NOT NULL,
	"step_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"recipient_id" integer,
	"task_id" integer,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD COLUMN "send_time" text;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "start_date" text;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "list_id" integer;--> statement-breakpoint
ALTER TABLE "plan_messages" ADD CONSTRAINT "plan_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_messages" ADD CONSTRAINT "plan_messages_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_messages" ADD CONSTRAINT "plan_messages_step_id_sequence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_messages" ADD CONSTRAINT "plan_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_messages" ADD CONSTRAINT "plan_messages_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_messages" ADD CONSTRAINT "plan_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_messages_unique" ON "plan_messages" USING btree ("step_id","lead_id");--> statement-breakpoint
CREATE INDEX "plan_messages_seq_idx" ON "plan_messages" USING btree ("sequence_id","lead_id");--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_list_id_lead_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE set null ON UPDATE no action;