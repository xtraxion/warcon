-- Per-server kill feed relays: forward incoming kill batches to additional HTTP endpoints.
CREATE TABLE "server_feed_relays" (
	"id" text PRIMARY KEY,
	"server_id" text NOT NULL REFERENCES "servers" ("id") ON DELETE CASCADE,
	"label" text NOT NULL DEFAULT '',
	"url" text NOT NULL,
	"enabled" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "server_feed_relays_server_idx" ON "server_feed_relays" USING btree ("server_id");
