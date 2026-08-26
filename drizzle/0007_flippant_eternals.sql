ALTER TABLE "workflow_runs" ADD COLUMN "temporal_workflow_id" text;--> statement-breakpoint
CREATE INDEX "workflow_runs_temporal_workflow_id_idx" ON "workflow_runs" USING btree ("temporal_workflow_id");--> statement-breakpoint
ALTER TABLE "workflow_steps" DROP COLUMN "queue_job_scheduled_at";--> statement-breakpoint
ALTER TABLE "workflow_steps" DROP COLUMN "queue_scheduling_claim_until";
