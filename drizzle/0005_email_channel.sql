CREATE TABLE "email_senders" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_user" text NOT NULL,
	"smtp_pass_enc" text NOT NULL,
	"daily_limit" integer DEFAULT 100 NOT NULL,
	"signature" text,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "sender_id" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "email_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_senders" ADD CONSTRAINT "email_senders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_id_email_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."email_senders"("id") ON DELETE set null ON UPDATE no action;