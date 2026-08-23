ALTER TABLE "voice_sessions" ADD COLUMN "launch_id" text;--> statement-breakpoint
UPDATE "voice_sessions"
SET "launch_id" = "id"::text
WHERE "provider" = 'livekit' AND "launch_id" IS NULL;--> statement-breakpoint
WITH "legacy_sessions" AS (
	UPDATE "voice_sessions"
	SET
		"status" = 'failed',
		"ended_reason" = 'legacy_launch_unbound',
		"ended_at" = now()
	WHERE "provider" = 'livekit' AND "status" IN ('pending', 'running')
	RETURNING "id"
)
INSERT INTO "voice_session_events" ("voice_session_id", "type", "payload", "occurred_at")
SELECT
	"id",
	'session.failed',
	jsonb_build_object('reason', 'legacy_launch_unbound'),
	now()
FROM "legacy_sessions";--> statement-breakpoint
WITH "ranked_rooms" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "room_name"
			ORDER BY "started_at" DESC, "id" DESC
		) AS "duplicate_rank"
	FROM "voice_sessions"
	WHERE "room_name" IS NOT NULL
)
UPDATE "voice_sessions" AS "sessions"
SET "room_name" = "sessions"."room_name" || '-legacy-' || "sessions"."id"::text
FROM "ranked_rooms"
WHERE "sessions"."id" = "ranked_rooms"."id" AND "ranked_rooms"."duplicate_rank" > 1;--> statement-breakpoint
WITH "ranked_participants" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "participant_identity"
			ORDER BY "started_at" DESC, "id" DESC
		) AS "duplicate_rank"
	FROM "voice_sessions"
	WHERE "participant_identity" IS NOT NULL
)
UPDATE "voice_sessions" AS "sessions"
SET "participant_identity" = "sessions"."participant_identity" || '-legacy-' || "sessions"."id"::text
FROM "ranked_participants"
WHERE "sessions"."id" = "ranked_participants"."id" AND "ranked_participants"."duplicate_rank" > 1;--> statement-breakpoint
WITH "ranked_tool_events" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "voice_session_id", "tool_call_id", "type"
			ORDER BY "occurred_at", "id"
		) AS "duplicate_rank"
	FROM "voice_session_events"
	WHERE "tool_call_id" IS NOT NULL
)
DELETE FROM "voice_session_events" AS "events"
USING "ranked_tool_events"
WHERE "events"."id" = "ranked_tool_events"."id" AND "ranked_tool_events"."duplicate_rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_sessions_launch_id_unique" ON "voice_sessions" USING btree ("launch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_sessions_room_name_unique" ON "voice_sessions" USING btree ("room_name");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_sessions_participant_identity_unique" ON "voice_sessions" USING btree ("participant_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_session_events_tool_call_unique" ON "voice_session_events" USING btree ("voice_session_id","tool_call_id","type");
