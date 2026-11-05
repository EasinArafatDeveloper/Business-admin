CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"grant_id" integer NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "oauth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"grant_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "kind" text DEFAULT 'key' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_grant_id_api_keys_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_api_keys_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant_idx" ON "oauth_tokens" USING btree ("grant_id");