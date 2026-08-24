CREATE TABLE "phone_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"voice_session_id" uuid,
	"contact_attempt_id" uuid,
	"twilio_call_sid" text,
	"to_number" text NOT NULL,
	"from_number" text NOT NULL,
	"time_zone" text NOT NULL,
	"briefing" text DEFAULT '' NOT NULL,
	"connection_status" text DEFAULT 'initiated' NOT NULL,
	"twilio_call_status" text,
	"answered_by" text,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structured_outcome" jsonb,
	"compliance_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "time_zone_source" text;--> statement-breakpoint
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_voice_session_id_voice_sessions_id_fk" FOREIGN KEY ("voice_session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_contact_attempt_id_contact_attempts_id_fk" FOREIGN KEY ("contact_attempt_id") REFERENCES "public"."contact_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_calls_twilio_call_sid_unique" ON "phone_calls" USING btree ("twilio_call_sid");--> statement-breakpoint
CREATE INDEX "phone_calls_case_idx" ON "phone_calls" USING btree ("case_id","created_at");