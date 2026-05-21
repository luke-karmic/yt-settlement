CREATE TABLE "wallets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"balance" bigint NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_lookup" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"wallet_id" bigint NOT NULL,
	"ledger_id" bigint,
	"tx_id" uuid NOT NULL,
	"action_type" smallint NOT NULL,
	"status" smallint NOT NULL,
	"payload_hash" "bytea" NOT NULL,
	"partition_hint" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_actions" (
	"id" bigserial NOT NULL,
	"wallet_id" bigint NOT NULL,
	"tx_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"game" varchar(255),
	"game_id" varchar(255),
	"action_type" smallint NOT NULL,
	"amount" bigint NOT NULL,
	"balance_before" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"status" smallint NOT NULL,
	"original_action_id" uuid,
	"previous_hash" "bytea",
	"current_hash" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollback_intents" (
	"original_action_id" uuid PRIMARY KEY NOT NULL,
	"rollback_action_id" uuid NOT NULL,
	"wallet_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rtp_hourly" (
	"hour_bucket" timestamp with time zone NOT NULL,
	"wallet_id" bigint NOT NULL,
	"currency" varchar(10) NOT NULL,
	"total_bet" bigint NOT NULL DEFAULT 0,
	"total_win" bigint NOT NULL DEFAULT 0,
	"rollback_bet" bigint NOT NULL DEFAULT 0,
	"rollback_win" bigint NOT NULL DEFAULT 0,
	"rounds" bigint NOT NULL DEFAULT 0,
	CONSTRAINT "rtp_hourly_hour_bucket_wallet_id_currency_pk" PRIMARY KEY("hour_bucket","wallet_id","currency")
);
--> statement-breakpoint
ALTER TABLE "action_lookup" ADD CONSTRAINT "action_lookup_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_actions" ADD CONSTRAINT "ledger_actions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback_intents" ADD CONSTRAINT "rollback_intents_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rtp_hourly" ADD CONSTRAINT "rtp_hourly_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_provider_user_id_currency_idx" ON "wallets" USING btree ("provider_user_id","currency");--> statement-breakpoint
CREATE INDEX "ledger_wallet_created_idx" ON "ledger_actions" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_original_action_idx" ON "ledger_actions" USING btree ("original_action_id") WHERE "ledger_actions"."original_action_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "rtp_hourly_bucket_idx" ON "rtp_hourly" USING btree ("hour_bucket");
