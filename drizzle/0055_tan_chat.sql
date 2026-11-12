CREATE TABLE "chat_archive_pending" (
	"server_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"line" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_archive_pending_server_fingerprint_idx" ON "chat_archive_pending" USING btree ("server_id","fingerprint");--> statement-breakpoint
CREATE INDEX "chat_archive_pending_expiry_idx" ON "chat_archive_pending" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "chat_archive_pending_first_seen_idx" ON "chat_archive_pending" USING btree ("first_seen_at");