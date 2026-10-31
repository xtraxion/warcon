CREATE TABLE "steam_friends" (
	"steam_id" text NOT NULL,
	"friend_steam_id" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steam_friends_steam_id_friend_steam_id_pk" PRIMARY KEY("steam_id","friend_steam_id")
);
--> statement-breakpoint
CREATE INDEX "steam_friends_steam_idx" ON "steam_friends" USING btree ("steam_id");
