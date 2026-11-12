CREATE TABLE "chat_archive" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "server_id" text NOT NULL,
  "match_id" bigint NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "sent_at" timestamp with time zone NOT NULL,
  "line" jsonb NOT NULL,
  "fingerprint" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_archive_server_fingerprint_idx" ON "chat_archive" ("server_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX "chat_archive_match_idx" ON "chat_archive" ("server_id", "match_id", "id");
--> statement-breakpoint
CREATE INDEX "chat_archive_expiry_idx" ON "chat_archive" ("sent_at");
