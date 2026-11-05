CREATE TABLE "invoice_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"kind" text NOT NULL,
	"method" text,
	"amount" integer,
	"reference" text,
	"share_url" text,
	"screenshot" "bytea",
	"screenshot_type" text,
	"payer_email" text,
	"payer_phone" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_id" integer,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invoice_submissions" ADD CONSTRAINT "invoice_submissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_submissions" ADD CONSTRAINT "invoice_submissions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_submissions" ADD CONSTRAINT "invoice_submissions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_submissions_invoice_idx" ON "invoice_submissions" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_submissions_pending_idx" ON "invoice_submissions" USING btree ("workspace_id","status");