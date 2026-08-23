ALTER TABLE "voice_sessions" ADD COLUMN "room_name" text;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "participant_identity" text;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "provider_session_id" text;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "ended_reason" text;