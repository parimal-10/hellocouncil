# Temporal Runner Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pg-boss + reconcile-loop DB runner with self-hosted Temporal: one durable workflow execution per product workflow run, Postgres kept as the read/projection model, identical application behavior.

**Architecture:** One generic Temporal workflow (`workflowRunWorkflow`) per workflow run drives a durable step loop: timer → execute-step activity (window check, Twilio dial) → wait for `callCompleted` signal → apply follow-up decision → repeat. Human review is an indefinite signal wait. All IO lives in activities; pure policy code (follow-up-policy, review-policy, definitions) is imported into workflow scope. Webhooks/actions/tools persist projections app-side and signal the workflow.

**Tech Stack:** `@temporalio/workflow`, `@temporalio/worker`, `@temporalio/client`, `@temporalio/testing` (^1.12.x), self-hosted `temporalio/auto-setup` + `temporalio/ui` in docker-compose, existing Next.js + Drizzle + Vitest toolchain.

**Spec:** `docs/superpowers/specs/2026-08-26-temporal-runner-migration-design.md`

## Global Constraints

- Self-hosted Temporal only (no Temporal Cloud). Server address comes from `TEMPORAL_ADDRESS` (default `localhost:7233`), namespace `TEMPORAL_NAMESPACE` (default `hellocouncil`).
- Task queue name is exactly `hellocouncil-workflows`; workflow ID convention is exactly `workflow-run-${workflowRunId}`.
- `AUTO_OUTBOUND_CALLS=true` remains required for the worker; there is no simulated fallback (prior decision preserved verbatim).
- Domain retry ladder (no-answer → 2h → next business day 10:00 → human review at 3 failed connects) is unchanged; explicit `requestedByUser` follow-ups never snap to the business-hours window.
- Postgres stays the authority for dashboards/timelines/review queue reads; every transition keeps writing the same `workflow_events` audit rows as today.
- pg-boss is fully removed: dependency, env var `PG_BOSS_SCHEMA`, `src/worker/boss.ts`, `src/worker/reconcile-due-steps.ts`, `src/worker/run-due-step.ts`, and the `WorkflowStepScheduler` port.
- Workflow code imports only pure modules and `@temporalio/workflow`; the bundler must fail loudly on violations (do not weaken the bundler config to hide them).
- Verification gate before any "done" claim: `npm run test:run && npm run lint && npm run build`.
- Commit after every task with a conventional-commit message matching repo style (`feat:`, `refactor:`, `chore:`, `docs:`).

---

### Task 1: Dependencies and self-hosted Temporal deployment

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Create: `.env` additions are manual/local; do not commit `.env`.

**Interfaces:**
- Produces: running Temporal server at `localhost:7233`, UI at `localhost:8080`, namespace `hellocouncil`, database `temporal` inside the existing postgres container. Env vars `TEMPORAL_ADDRESS=localhost:7233` and `TEMPORAL_NAMESPACE=hellocouncil` available to later tasks. Installed packages `@temporalio/workflow`, `@temporalio/worker`, `@temporalio/client`, `@temporalio/testing`, `@temporalio/common`.

- [ ] **Step 1: Install Temporal SDK packages**

```bash
npm install @temporalio/workflow@^1.12.0 @temporalio/worker@^1.12.0 @temporalio/client@^1.12.0 @temporalio/common@^1.12.0
npm install -D @temporalio/testing@^1.12.0
```

- [ ] **Step 2: Extend docker-compose.yml**

Append to the top-level `services:` map (keep the existing `postgres` service untouched):

```yaml
  temporal:
    image: temporalio/auto-setup:1.26.2
    ports:
      - "7233:7233"
    environment:
      DB: postgres12
      DB_PORT: "5432"
      POSTGRES_USER: postgres
      POSTGRES_PWD: postgres
      POSTGRES_SEEDS: postgres
      DBNAME: temporal
    depends_on:
      postgres:
        condition: service_healthy

  temporal-ui:
    image: temporalio/ui:2.34.0
    ports:
      - "8080:8080"
    environment:
      TEMPORAL_ADDRESS: temporal:7233
    depends_on:
      - temporal

  temporal-namespace-init:
    image: temporalio/admin-tools:1.26.2
    depends_on:
      - temporal
    restart: "no"
    entrypoint: ["sh", "-c", "temporal operator namespace create --address temporal:7233 hellocouncil || true"]
```

- [ ] **Step 3: Update .env.example**

Add near the top (next to `DATABASE_URL`):

```text
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=hellocouncil
```

Remove the line `PG_BOSS_SCHEMA=pgboss` (the `.env` local copy can keep it harmlessly; do not edit `.env` in the repo — it is gitignored).

- [ ] **Step 4: Verify the stack boots**

```bash
docker compose up -d
docker compose logs temporal --tail 20
```

Expected: temporal reports successful schema setup and namespace registration; `curl -s http://localhost:7233/health` responds (200 or empty OK); UI loads at `http://localhost:8080`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json docker-compose.yml .env.example
git commit -m "chore: add self-hosted temporal deployment and sdk dependencies"
```

---

### Task 2: Extract `advanceDueStep` into a standalone execution module

The step-execution body leaves `WorkflowEngine` so a Temporal activity can host it without dragging the whole engine into workflow scope. Behavior is unchanged in this task; tests are retargeted, not rewritten.

**Files:**
- Create: `src/modules/workflows/execution.ts`
- Modify: `src/modules/workflows/engine.ts`
- Modify: `tests/worker-transitions.test.ts` (rename to `tests/execution-transitions.test.ts`)

**Interfaces:**
- Consumes: existing `WorkflowStore`, `OutboundFollowUpPort`, `workflowDefinitions`, `decideAttemptWindow` — all unchanged.
- Produces:

```ts
// src/modules/workflows/execution.ts
import type { OutboundFollowUpPort } from "./engine";
import type { WorkflowStore } from "./store";

export type ExecuteStepOutcome =
  | { kind: "placed" }
  | { kind: "deferred_to_window"; dueAt: Date }
  | { kind: "blocked_for_review" }
  | { kind: "noop" };

export type ExecutionDeps = {
  store: WorkflowStore;
  outboundCaller?: OutboundFollowUpPort;
};

export async function advanceDueStep(
  deps: ExecutionDeps,
  stepId: string,
  now: Date,
): Promise<ExecuteStepOutcome>;
```

- [ ] **Step 1: Rename the test file and update imports**

```bash
git mv tests/worker-transitions.test.ts tests/execution-transitions.test.ts
```

In the renamed file, replace the two pg-boss-dependent describe blocks (they will fail compile once Task 3 lands, so remove them here): delete `"does not reject an existing standard due-step queue"`, `"uses fresh pg-boss job ids when the same reviewed step is rescheduled"`, `"rejects a pg-boss send that does not create a runnable job"`, `"enqueues the same workflow step again after human review reschedules it"` (only its `reconcileDueSteps` tail; keep the `applyAction` part as its own test ending at the review assertions), `"claims a due step once across concurrent reconciliation"`, `"releases a failed scheduling claim so reconciliation can retry"`, and `"retries reconciliation after a crashed scheduler claim expires"`, plus the `jobNames/PgBossWorkflowStepScheduler/reconcileDueSteps` imports. Change every `new WorkflowEngine({ store, definitions, outboundCaller })` + `engine.advanceDueStep(stepId, now)` call to `advanceDueStep({ store, outboundCaller }, stepId, now)` imported from `@/modules/workflows/execution`. Assertions stay identical except: for the deferral test add

```ts
const outcome = await advanceDueStep({ store, outboundCaller: caller }, "step-1", new Date("2026-08-23T01:00:00.000Z"));
expect(outcome).toEqual({ kind: "deferred_to_window", dueAt: new Date("2026-08-24T14:00:00.000Z") });
```

and expect `{ kind: "noop" }` for the future/completed-step cases.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/execution-transitions.test.ts`
Expected: FAIL — `@/modules/workflows/execution` does not exist.

- [ ] **Step 3: Create execution.ts**

Move the entire body of `WorkflowEngine.advanceDueStep` (engine.ts lines 37–94) plus the private helpers it alone uses (`shouldAutoDial`, `placeAutoDial`, `recoverClaimedStep`, `retryLimitFor`, `hasLiveOutboundCall`, `isPayload`, `payloadBoolean`, `errorMessage`) into a new `src/modules/workflows/execution.ts`, converting `this.input.store` → `deps.store`, `this.input.outboundCaller` → `deps.outboundCaller`, and returning outcomes instead of `void`:

```ts
import { decideAttemptWindow } from "@/modules/phone/follow-up-policy";
import { evaluateHumanReviewPolicyBlock } from "./execution-block"; // see note below
import { workflowDefinitions } from "./definitions";
import type { OutboundFollowUpPort } from "./engine";
import type { ReviewDecision } from "./types";
import type { WorkflowStepRecord, WorkflowStore } from "./store";

export type ExecuteStepOutcome =
  | { kind: "placed" }
  | { kind: "deferred_to_window"; dueAt: Date }
  | { kind: "blocked_for_review" }
  | { kind: "noop" };

export type ExecutionDeps = {
  store: WorkflowStore;
  outboundCaller?: OutboundFollowUpPort;
};

export async function advanceDueStep(deps: ExecutionDeps, stepId: string, now: Date): Promise<ExecuteStepOutcome> {
  const { store, outboundCaller } = deps;
  const existing = await store.getStep(stepId);
  if (existing.status !== "due" || existing.dueAt > now) return { kind: "noop" };

  const explicitlyRequested = payloadBoolean(existing.payload, "requestedByUser", false);
  if (!explicitlyRequested && outboundCaller && shouldAutoDial(outboundCaller, existing)) {
    const { timeZone } = await outboundCaller.evaluateWindow({ workflowRunId: existing.workflowRunId, now });
    const window = decideAttemptWindow({ now, timeZone });
    if (window.action === "defer_to_window") {
      await applyFollowUpDecisionForWindow(store, workflowDefinitionsById(), existing, window, now);
      return { kind: "deferred_to_window", dueAt: window.dueAt! };
    }
  }

  const step = await store.claimDueStep(stepId, now);
  if (!step) return { kind: "noop" };

  try {
    const run = await store.getRun(step.workflowRunId);
    if (step.stepType === "provider_follow_up" && !payloadBoolean(step.payload, "hasAuthorization", true)) {
      await blockStep(store, workflowDefinitionsById().get("medical-records-follow-up")!, run.id, step.id, step.attemptCount, {
        kind: "block",
        reason: "missing_authorization",
        severity: "high",
        recommendedAction: "Verify authorization before contacting the provider again.",
        summary: "Provider outreach is blocked until authorization is verified.",
      });
      return { kind: "blocked_for_review" };
    }

    if (!outboundCaller) {
      throw new Error(
        "Automatic outbound calling is not configured. Due follow-ups place real Twilio calls; set AUTO_OUTBOUND_CALLS=true with a phone runtime.",
      );
    }
    if (!shouldAutoDial(outboundCaller, step)) {
      throw new Error(`Step type ${step.stepType} has no outbound calling path.`);
    }

    await placeAutoDial(store, outboundCaller, step, now);
    return { kind: "placed" };
  } catch (error) {
    await recoverClaimedStep(store, workflowDefinitionsById(), step, error);
    throw error;
  }
}
```

Move `applyFollowUpDecisionForWindow` as a private function replicating the original inline block: log `scheduling.decision` via `store.appendEvent`, then `store.updateStepPayload(existing.id, decisionPayload(window))`, `store.rescheduleStep(existing.id, window.dueAt!)` (mirroring engine.applyFollowUpDecision's `defer_to_window` branch — reuse the engine's method instead where simpler: prefer instantiating `new WorkflowEngine({ store, definitions: workflowDefinitions }).applyFollowUpDecision({...})` so there is exactly one implementation). Concretely: the defer branch calls

```ts
await new WorkflowEngine({ store, definitions: workflowDefinitions }).applyFollowUpDecision({
  workflowRunId: existing.workflowRunId,
  stepId: existing.id,
  decision: window,
  now,
});
```

and `blockStep`/`recoverClaimedStep` likewise delegate to a shared internal helper module `src/modules/workflows/transitions.ts` created in this task, containing the moved private methods `blockStep`, `recoverClaimedStep`, `retryLimitFor`, `placeAutoDial`, `errorMessage`, `payloadBoolean`, `hasLiveOutboundCall`, `serializeDecision` — exported as free functions taking `store` as first argument. `WorkflowEngine` then delegates its remaining uses of those helpers to `transitions.ts` so no logic is duplicated.

- [ ] **Step 4: Slim WorkflowEngine.advanceDueStep to a delegation shim**

```ts
async advanceDueStep(stepId: string, now: Date): Promise<ExecuteStepOutcome> {
  return advanceDueStepExternal({ store: this.input.store, outboundCaller: this.input.outboundCaller }, stepId, now);
}
```

(imported with an alias to avoid name collision). This keeps `runFollowUpNow` working until Task 8 rewires voice tools; the shim is deleted there.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/execution-transitions.test.ts tests/workflow-actions.test.ts`
Expected: PASS (all retained tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/workflows tests/execution-transitions.test.ts
git commit -m "refactor: extract due-step execution from workflow engine"
```

---

### Task 3: Remove pg-boss, the reconcile loop, and the scheduling-claim machinery

**Files:**
- Delete: `src/worker/boss.ts`, `src/worker/reconcile-due-steps.ts`, `src/worker/run-due-step.ts`
- Modify: `src/modules/workflows/engine.ts` (remove `WorkflowStepScheduler`, scheduler branches)
- Modify: `src/modules/workflows/store.ts` (remove claim/scheduling methods and fields)
- Modify: `src/db/schema.ts` (drop queue columns, add `temporal_workflow_id`)
- Modify: `tests/test-store.ts`
- Create: new Drizzle migration via `npm run db:generate`
- Modify: `src/dashboard` read paths if they select dropped columns (check `src/modules/dashboard/queries.ts`)

**Interfaces:**
- Consumes: nothing removed from surviving modules.
- Produces:
  - `WorkflowStore` without `getDueSteps`, `claimDueStepForScheduling`, `markDueStepScheduled`, `releaseDueStepSchedulingClaim` (note: `claimDueStep`, used by execution.ts, survives).
  - `WorkflowStepRecord` without `queueJobScheduledAt`/`queueSchedulingClaimUntil`.
  - `workflowRuns.temporal_workflow_id: text | null` column + index (written by Task 7).
  - Engine constructor without `scheduler?: WorkflowStepScheduler`; `applyAction`'s `schedule_follow_up` branch no longer enqueues (creates step + `step.scheduled` event only; execution wiring arrives with the workflow in Tasks 6–8).

- [ ] **Step 1: Delete pg-boss files and scheduler plumbing**

```bash
git rm src/worker/boss.ts src/worker/reconcile-due-steps.ts src/worker/run-due-step.ts
```

In `engine.ts`: delete the `WorkflowStepScheduler` export, the `scheduler` constructor field, `enqueueIfPresent`, `markScheduleFailed`, and the try/catch around `scheduleDueStep` in the `schedule_follow_up` branch of `applyAction` (keep step creation and the `step.scheduled` event). In `applyFollowUpDecision`'s `retry` branch, drop the `enqueueIfPresent` call.

- [ ] **Step 2: Slim the store and schema**

Remove from `DrizzleWorkflowStore` and the `WorkflowStore` type: `getDueSteps`, `claimDueStepForScheduling`, `markDueStepScheduled`, `releaseDueStepSchedulingClaim`. Remove `queueJobScheduledAt`/`queueSchedulingClaimUntil` from `WorkflowStepRecord`, from the `transitionClaimedStepAfterFailure` and `rescheduleStep` setters, and mirror the same removals in `tests/test-store.ts` (`getDueSteps`, `claimDueStepForScheduling`, `markDueStepScheduled`, `releaseDueStepSchedulingClaim`, and both fields in `createStep`). In `src/db/schema.ts`:

```ts
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    // ...existing columns...
    temporalWorkflowId: text("temporal_workflow_id"),
  },
  (table) => ({
    temporalIdIdx: index("workflow_runs_temporal_workflow_id_idx").on(table.temporalWorkflowId),
  }),
);
```

and delete `queueJobScheduledAt`/`queueSchedulingClaimUntil` from `workflowSteps`. Check `src/modules/dashboard/queries.ts` and `app/**` for references to the dropped columns and remove any.

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/000X_*.sql` containing approximately:

```sql
ALTER TABLE "workflow_runs" ADD COLUMN "temporal_workflow_id" text;
CREATE INDEX IF NOT EXISTS "workflow_runs_temporal_workflow_id_idx" ON "workflow_runs" USING btree ("temporal_workflow_id");
ALTER TABLE "workflow_steps" DROP COLUMN IF EXISTS "queue_job_scheduled_at";
ALTER TABLE "workflow_steps" DROP COLUMN IF EXISTS "queue_scheduling_claim_until";
```

- [ ] **Step 4: Remove pg-boss dependency and env**

```bash
npm uninstall pg-boss
```

Confirm `PG_BOSS_SCHEMA` appears nowhere under `src/` or `app/`.

- [ ] **Step 5: Point the old worker entrypoint at a stub so `npm run worker` fails loudly, not cryptically**

Replace the contents of `src/worker/start.ts` temporarily:

```ts
throw new Error("The DB runner was removed; the Temporal worker arrives in Task 7.");
```

(Task 7 replaces this file's role entirely.)

- [ ] **Step 6: Run the suite**

Run: `npm run test:run`
Expected: PASS — no test may reference deleted exports. Fix stragglers by deleting obsolete assertions (never by weakening surviving ones).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove pg-boss runner and scheduling-claim machinery"
```

---

### Task 4: Temporal client singleton and runtime config

**Files:**
- Create: `src/temporal/config.ts`
- Create: `src/temporal/client.ts`
- Test: `tests/temporal-config.test.ts`

**Interfaces:**
- Produces:

```ts
// src/temporal/config.ts
export type TemporalRuntimeConfig = { address: string; namespace: string; taskQueue: string };
export const TASK_QUEUE = "hellocouncil-workflows";
export function loadTemporalConfig(): TemporalRuntimeConfig; // TEMPORAL_ADDRESS ?? "localhost:7233", TEMPORAL_NAMESPACE ?? "hellocouncil"

// src/temporal/client.ts
export async function getTemporalClient(): Promise<WorkflowClient>; // memoized singleton
export function workflowIdFor(workflowRunId: string): string; // `workflow-run-${workflowRunId}`
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/temporal-config.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { TASK_QUEUE, loadTemporalConfig } from "@/temporal/config";

describe("temporal runtime config", () => {
  afterEach(() => {
    delete process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_NAMESPACE;
  });

  it("defaults to the local self-hosted server and hellocouncil namespace", () => {
    expect(loadTemporalConfig()).toEqual({
      address: "localhost:7233",
      namespace: "hellocouncil",
      taskQueue: TASK_QUEUE,
    });
    expect(TASK_QUEUE).toBe("hellocouncil-workflows");
  });

  it("reads overrides from the environment", () => {
    process.env.TEMPORAL_ADDRESS = "temporal:7233";
    process.env.TEMPORAL_NAMESPACE = "other";
    expect(loadTemporalConfig()).toMatchObject({ address: "temporal:7233", namespace: "other" });
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/temporal-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement config and client**

```ts
// src/temporal/config.ts
export const TASK_QUEUE = "hellocouncil-workflows";

export type TemporalRuntimeConfig = { address: string; namespace: string; taskQueue: string };

export function loadTemporalConfig(): TemporalRuntimeConfig {
  return {
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    namespace: process.env.TEMPORAL_NAMESPACE ?? "hellocouncil",
    taskQueue: TASK_QUEUE,
  };
}
```

```ts
// src/temporal/client.ts
import { Client, Connection } from "@temporalio/client";
import { loadTemporalConfig } from "./config";

let cached: Promise<Client> | undefined;

export async function getTemporalClient() {
  if (!cached) {
    cached = (async () => {
      const config = loadTemporalConfig();
      const connection = await Connection.connect({ address: config.address });
      return new Client({ connection, namespace: config.namespace });
    })();
  }
  return cached;
}

export function workflowIdFor(workflowRunId: string): string {
  return `workflow-run-${workflowRunId}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/temporal-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/temporal tests/temporal-config.test.ts
git commit -m "feat: add temporal client singleton and runtime config"
```

---

### Task 5: Temporal activities

**Files:**
- Create: `src/temporal/activities/types.ts`
- Create: `src/temporal/activities/index.ts`
- Create: `src/temporal/activities/runtime.ts`
- Test: `tests/temporal-activities.test.ts`

**Interfaces:**
- Consumes: `advanceDueStep` (Task 2), `applyOutboundCallFollowUp` (`src/modules/phone/orchestration.ts`, unchanged), `DrizzlePhoneCallStore.claimOrchestration/getCall`, `DrizzleWorkflowStore`.
- Produces (all exported from `src/temporal/activities/index.ts`; the injectable core functions live in `runtime.ts` and take stores as parameters so tests use fakes):

```ts
// src/temporal/activities/types.ts
import type { WorkflowRunStatus } from "@/modules/workflows/types";

export type RunStateSnapshot = {
  runStatus: WorkflowRunStatus;
  awaitingCallCompletion: boolean;
  openReviewId: string | null;
  dueStepId: string | null;      // earliest step with status "due" and dueAt <= now
  nextDueAt: number | null;      // epoch ms of the earliest future due step
};

export type ActivityDeps = {
  workflowStore: Pick<
    WorkflowStore,
    "getRun" | "listSteps" | "getStep" | "updateRunStatus" | "updateStepStatus" | "updateStepPayload"
  >;
};
```

```ts
// src/temporal/activities/index.ts — production wrappers
export async function loadRunState(input: { workflowRunId: string }): Promise<RunStateSnapshot>;
export async function executeDueStep(input: { stepId: string }): Promise<ExecuteStepOutcome>;
export async function applyCallOutcome(input: { callId: string }): Promise<{ applied: boolean }>;
export async function recordTemporalWorkflowId(input: { workflowRunId: string; temporalWorkflowId: string }): Promise<void>;
```

`runtime.ts` exports the injectable cores:

```ts
export function makeLoadRunState(deps: { workflowStore: WorkflowStore }): (input: { workflowRunId: string }) => Promise<RunStateSnapshot>;
export function makeExecuteDueStep(deps: ExecutionDeps): (input: { stepId: string }) => Promise<ExecuteStepOutcome>; // wraps advanceDueStep
export function makeApplyCallOutcome(deps: { engineFactory: () => WorkflowEngine; phoneStore: Pick<PhoneCallStore, "getCall" | "claimOrchestration"> }): (input: { callId: string }) => Promise<{ applied: boolean }>;
```

- [ ] **Step 1: Write failing tests for the injectable cores**

```ts
// tests/temporal-activities.test.ts
import { describe, expect, it } from "vitest";
import { makeLoadRunState } from "@/temporal/activities/runtime";
import { TestWorkflowStore } from "./test-store";
import { clientCheckInDefinition } from "@/modules/workflows/definitions";

describe("loadRunState", () => {
  it("reports the earliest due step and awaiting-call state", async () => {
    const store = new TestWorkflowStore();
    store.runs.set("run-1", { id: "run-1", definitionId: "client-check-in", caseId: "case-1", status: "active", title: "T", summary: "" });
    store.steps.set("step-1", {
      id: "step-1", workflowRunId: "run-1", stepType: "client_check_in", label: "Check in",
      status: "running", dueAt: new Date(0), attemptCount: 1,
      payload: { outboundCallId: "call-1", awaitingCallCompletion: true },
    });
    const load = makeLoadRunState({ workflowStore: store });

    const snapshot = await load({ workflowRunId: "run-1" });

    expect(snapshot).toEqual({
      runStatus: "active",
      awaitingCallCompletion: true,
      openReviewId: null,
      dueStepId: null,
      nextDueAt: null,
    });
  });

  it("surfaces an open review and future due step", async () => {
    const store = new TestWorkflowStore();
    store.runs.set("run-1", { id: "run-1", definitionId: "client-check-in", caseId: "case-1", status: "waiting_for_human", title: "T", summary: "" });
    store.steps.set("step-1", {
      id: "step-1", workflowRunId: "run-1", stepType: "client_check_in", label: "Check in",
      status: "waiting_for_human", dueAt: new Date(0), attemptCount: 1, payload: {},
    });
    store.steps.set("step-2", {
      id: "step-2", workflowRunId: "run-1", stepType: "client_check_in", label: "Next",
      status: "due", dueAt: new Date("2027-01-01T00:00:00.000Z"), attemptCount: 0, payload: {},
    });
    store.reviews.push({
      id: "review-1", status: "open", workflowRunId: "run-1", workflowStepId: "step-1",
      decision: { kind: "block", reason: "provider_refusal", severity: "high", recommendedAction: "Call provider.", summary: "Refused." },
    });
    const load = makeLoadRunState({ workflowStore: store });

    const snapshot = await load({ workflowRunId: "run-1" });

    expect(snapshot.openReviewId).toBe("review-1");
    expect(snapshot.nextDueAt).toBe(new Date("2027-01-01T00:00:00.000Z").getTime());
    expect(snapshot.dueStepId).toBeNull(); // review pending outranks execution
  });
});
```

Add analogous tests for `makeApplyCallOutcome` with a fake phone store: terminal call + first claim → `applied: true` and engine consulted; second invocation (already claimed) → `{ applied: false }`; non-terminal call → `{ applied: false }` without claiming.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/temporal-activities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement runtime.ts and index.ts**

`makeApplyCallOutcome` body mirrors the webhook's orchestration block:

```ts
export function makeApplyCallOutcome(deps: {
  engineFactory: () => WorkflowEngine;
  phoneStore: Pick<PhoneCallStore, "getCall" | "claimOrchestration">;
}) {
  return async function applyCallOutcome(input: { callId: string }): Promise<{ applied: boolean }> {
    const now = new Date();
    const call = await deps.phoneStore.getCall(input.callId);
    if (!call || !isTerminalConnectionStatus(call.connectionStatus)) return { applied: false };
    if (!(await deps.phoneStore.claimOrchestration(call.id, now))) return { applied: false };
    const decision = await applyOutboundCallFollowUp({ call, now, engine: deps.engineFactory(), phoneStore: deps.phoneStore });
    return { applied: decision !== null };
  };
}
```

`index.ts` production wrappers construct `DrizzleWorkflowStore`, `new WorkflowEngine({ store, definitions: workflowDefinitions })`, `DrizzlePhoneCallStore`, and `createWorkerOutboundDialer()` (which enforces `AUTO_OUTBOUND_CALLS`), e.g.:

```ts
export async function executeDueStep(input: { stepId: string }) {
  const dialer = createWorkerOutboundDialer();
  return advanceDueStep({ store: new DrizzleWorkflowStore(), outboundCaller: dialer }, input.stepId, new Date());
}

export async function loadRunState(input: { workflowRunId: string }) {
  return makeLoadRunState({ workflowStore: new DrizzleWorkflowStore() })(input);
}

export async function applyCallOutcome(input: { callId: string }) {
  const store = new DrizzleWorkflowStore();
  return makeApplyCallOutcome({
    engineFactory: () => new WorkflowEngine({ store, definitions: workflowDefinitions }),
    phoneStore: new DrizzlePhoneCallStore(),
  })(input);
}

export async function recordTemporalWorkflowId(input: { workflowRunId: string; temporalWorkflowId: string }) {
  await db.update(workflowRuns)
    .set({ temporalWorkflowId: input.temporalWorkflowId })
    .where(eq(workflowRuns.id, input.workflowRunId));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/temporal-activities.test.ts tests/execution-transitions.test.ts tests/follow-up-orchestration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/temporal tests/temporal-activities.test.ts
git commit -m "feat: add temporal activities for step execution and call outcomes"
```

---

### Task 6: The durable workflow-run workflow

**Files:**
- Create: `src/temporal/workflows/workflow-run.ts`
- Test: `tests/temporal-workflow-run.test.ts`

**Interfaces:**
- Consumes: activity surface from Task 5 (via `proxyActivities`).
- Produces:

```ts
export const workflowRunWorkflow: (input: { workflowRunId: string }) => Promise<void>;

export const workflowSignals = {
  callCompleted: defineSignal<[payload: { callId: string }]>("callCompleted"),
  reviewResolved: defineSignal<[]>("reviewResolved"),
  runFollowUpNow: defineSignal<[]>("runFollowUpNow"),
  scheduleFollowUp: defineSignal<[payload: { stepType: string; dueAt: string; reason: string }]>("scheduleFollowUp"),
};

export const runStateQuery = defineQuery<{ lastWake: string | null }>("runState");
```

Activity options: `startToCloseTimeout: "2 minutes"`, `retry: { maximumAttempts: 5, initialInterval: "5 seconds", backoffCoefficient: 2 }` for `loadRunState`; `executeDueStep` gets its retry limit from the step template at runtime is not possible in `proxyActivities` — use `maximumAttempts: 10` default and rely on `advanceDueStep`'s own `recoverClaimedStep` domain limit for exhaustion semantics.

- [ ] **Step 1: Write the failing workflow test**

```ts
// @vitest-environment node
// tests/temporal-workflow-run.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkflowClient } from "@temporalio/client";
import type * as activities from "@/temporal/activities/index";
import { TASK_QUEUE } from "@/temporal/config";
import { workflowRunWorkflow, workflowSignals } from "@/temporal/workflows/workflow-run";

function fakeActivities(log: string[], state: { dueStepId: string | null; awaiting: boolean; runStatus: string }) {
  const fake = {
    async loadRunState() {
      log.push("load");
      return { runStatus: state.runStatus as never, awaitingCallCompletion: state.awaiting, openReviewId: null, dueStepId: state.dueStepId, nextDueAt: null };
    },
    async executeDueStep(input: { stepId: string }) {
      log.push(`execute:${input.stepId}`);
      state.awaiting = true;
      state.dueStepId = null;
      return { kind: "placed" } as never;
    },
    async applyCallOutcome(input: { callId: string }) {
      log.push(`outcome:${input.callId}`);
      state.awaiting = false;
      state.runStatus = "completed";
      return { applied: true } as never;
    },
    async recordTemporalWorkflowId() {},
  };
  return fake as unknown as typeof activities;
}

describe("workflowRunWorkflow", () => {
  let env: TestWorkflowEnvironment;
  beforeEach(async () => { env = await TestWorkflowEnvironment.createTimeSkipping(); });
  afterEach(async () => { await env.teardown(); });

  it("executes the due step, waits for the call signal, and finishes when the run completes", async () => {
    const log: string[] = [];
    const state = { dueStepId: "step-1", awaiting: false, runStatus: "active" };
    const client = env.client as unknown as WorkflowClient;

    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-1" }],
      workflowId: "workflow-run-test-1",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve("@/temporal/workflows/workflow-run"),
      activities: fakeActivities(log, state),
    });
    const run = Promise.all([handle.result(), worker.run()]);
    await env.sleep("100ms"); // let the first poll happen
    await handle.signal(workflowSignals.callCompleted, { callId: "call-1" });
    await run;
    worker.shutdown();

    expect(log).toEqual(["load", "execute:step-1", "load", "outcome:call-1"]);
  });

  it("stays alive until review resolution and resumes execution afterward", async () => {
    // arrange state machine: first load → openReviewId set, run waiting_for_human;
    // after reviewResolved signal → run active, dueStepId present; after execute → completed.
    // assert log contains "execute:step-1" only after the signal, and handle.result() resolves.
  });
});
```

Write the second test in full following the comment: make the fake `loadRunState` closure switch states when a mutable `resolved` flag flips, signal `workflowSignals.reviewResolved` after `env.sleep("50ms")`, and assert the same style of ordered log.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/temporal-workflow-run.test.ts`
Expected: FAIL — workflow module not found.

- [ ] **Step 3: Implement the workflow**

```ts
// src/temporal/workflows/workflow-run.ts
import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities";

export type WorkflowRunInput = { workflowRunId: string };

export const workflowSignals = {
  callCompleted: defineSignal<[payload: { callId: string }]>("callCompleted"),
  reviewResolved: defineSignal<[]>("reviewResolved"),
  runFollowUpNow: defineSignal<[]>("runFollowUpNow"),
  scheduleFollowUp: defineSignal<[payload: { stepType: string; dueAt: string; reason: string }]>("scheduleFollowUp"),
};

export const runStateQuery = defineQuery<{ lastWake: string | null }>("runState");

const { loadRunState, executeDueStep, applyCallOutcome } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 5, initialInterval: "5 seconds", backoffCoefficient: 2 },
});

type WakeReason = "call_completed" | "review_resolved" | "run_now" | "scheduled" | null;

export async function workflowRunWorkflow(input: WorkflowRunInput): Promise<void> {
  const { workflowRunId } = input;

  let wake: WakeReason = null;
  const completedCallIds: string[] = [];
  let lastWake: string | null = null;

  setHandler(workflowSignals.callCompleted, (payload) => {
    completedCallIds.push(payload.callId);
    wake = "call_completed";
  });
  setHandler(workflowSignals.reviewResolved, () => { wake = "review_resolved"; });
  setHandler(workflowSignals.runFollowUpNow, () => { wake = "run_now"; });
  setHandler(workflowSignals.scheduleFollowUp, () => { wake = "scheduled"; });
  setHandler(runStateQuery, () => ({ lastWake }));

  while (true) {
    const state = await loadRunState({ workflowRunId });

    if (state.runStatus === "completed" || state.runStatus === "failed" || state.runStatus === "cancelled") {
      return;
    }

    if (state.awaitingCallCompletion) {
      await condition(() => wake === "call_completed");
      const callId = completedCallIds.shift()!;
      wake = null;
      lastWake = `outcome:${callId}`;
      await applyCallOutcome({ callId });
      continue;
    }

    if (state.openReviewId) {
      await condition(() => wake === "review_resolved");
      wake = null;
      lastWake = "review_resolved";
      continue; // reviewer wrote projections app-side; loop reloads state
    }

    if (state.dueStepId) {
      lastWake = `execute:${state.dueStepId}`;
      const outcome = await executeDueStep({ stepId: state.dueStepId });
      if (outcome.kind === "noop") {
        // avoid a hot loop if another actor claimed the step; retry on next wake or short delay
        await condition(() => wake !== null, 60_000);
        wake = null;
      }
      continue; // placed → awaiting; deferred → new dueAt; blocked → openReviewId
    }

    const dueInMs = state.nextDueAt === null ? null : Math.max(0, state.nextDueAt - Date.now());
    if (dueInMs === null) {
      await condition(() => wake !== null);
    } else {
      const wokeBySignal = await condition(() => wake !== null, dueInMs);
      if (!wokeBySignal) lastWake = "timer_elapsed";
    }
    wake = null; // run_now/scheduled wakes simply trigger a state reload
  }
}
```

- [ ] **Step 4: Run workflow tests**

Run: `npx vitest run tests/temporal-workflow-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/temporal/workflows tests/temporal-workflow-run.test.ts
git commit -m "feat: add durable workflow-run temporal workflow"
```

---

### Task 7: Worker entrypoint and workflow starter helper

**Files:**
- Delete: `src/worker/start.ts` (and the empty `src/worker/` directory)
- Create: `src/temporal/worker.ts`
- Create: `src/temporal/start-run.ts`
- Modify: `package.json` scripts
- Test: extend `tests/temporal-config.test.ts` OR create `tests/temporal-start-run.test.ts` (config-parse level only — starting real executions is verified in Task 9)

**Interfaces:**
- Consumes: `loadTemporalConfig`, `TASK_QUEUE` (Task 4), workflow (Task 6), activities (Task 5).
- Produces:

```ts
// src/temporal/start-run.ts
import type { WorkflowHandle } from "@temporalio/client";

export async function startWorkflowRun(input: { workflowRunId: string }): Promise<string>; // returns firstExecutionRunId
export async function signalRun(options: {
  workflowRunId: string;
  signal: (typeof import("@/temporal/workflows/workflow-run"))["workflowSignals"][keyof (typeof import("@/temporal/workflows/workflow-run"))["workflowSignals"]];
  args: unknown[];
}): Promise<void>; // uses signalWithStart so signals survive a not-yet-started/lost execution
```

- [ ] **Step 1: Implement start-run.ts**

```ts
// src/temporal/start-run.ts
import { workflowRunWorkflow, workflowSignals } from "./workflows/workflow-run";
import { getTemporalClient, workflowIdFor } from "./client";
import { loadTemporalConfig } from "./config";
import { recordTemporalWorkflowId } from "./activities";

export async function startWorkflowRun(input: { workflowRunId: string }): Promise<string> {
  const client = await getTemporalClient();
  const handle = await client.start(workflowRunWorkflow, {
    args: [{ workflowRunId: input.workflowRunId }],
    workflowId: workflowIdFor(input.workflowRunId),
    taskQueue: loadTemporalConfig().taskQueue,
  });
  await recordTemporalWorkflowId({
    workflowRunId: input.workflowRunId,
    temporalWorkflowId: handle.firstExecutionRunId,
  });
  return handle.firstExecutionRunId;
}

export async function signalRun(options: {
  workflowRunId: string;
  signal: keyof typeof workflowSignals;
  args: unknown[];
}): Promise<void> {
  const client = await getTemporalClient();
  await client.signalWithStart(workflowRunWorkflow, {
    args: [{ workflowRunId: options.workflowRunId }],
    workflowId: workflowIdFor(options.workflowRunId),
    taskQueue: loadTemporalConfig().taskQueue,
    signal: workflowSignals[options.signal],
    signalArgs: options.args as never[],
  });
}
```

- [ ] **Step 2: Implement the worker entrypoint**

```ts
// src/temporal/worker.ts
import "dotenv/config";
import { Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { loadTemporalConfig } from "./config";
import { isAutomaticOutboundCallingEnabled } from "@/modules/phone/auto-dial";

async function main() {
  if (!isAutomaticOutboundCallingEnabled()) {
    throw new Error(
      "AUTO_OUTBOUND_CALLS=true is required. Due follow-ups place real Twilio calls; there is no simulated fallback.",
    );
  }
  console.log("Automatic outbound calling is enabled. Due phone follow-ups place Twilio calls.");

  const config = loadTemporalConfig();
  const worker = await Worker.create({
    workflowsPath: new URL("./workflows/workflow-run.ts", import.meta.url).pathname,
    activities,
    taskQueue: config.taskQueue,
    namespace: config.namespace,
  });
  console.log(`Temporal worker listening on ${config.address} [${config.namespace}] queue=${config.taskQueue}`);
  await worker.run();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Delete `src/worker/start.ts` and the directory. In `package.json` replace `"worker": "tsx src/worker/start.ts"` with `"worker": "tsx src/temporal/worker.ts"`.

- [ ] **Step 3: Smoke-check the worker boots**

```bash
docker compose up -d
AUTO_OUTBOUND_CALLS=false npm run worker
```

Expected: exits non-zero with the `AUTO_OUTBOUND_CALLS=true is required` error. Then with `AUTO_OUTBOUND_CALLS=true` and valid Twilio env: connects and polls (leave Ctrl-C'd after confirming the banner; no tasks exist yet).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add temporal worker entrypoint and workflow starter"
```

---

### Task 8: Rewire callers onto signals; delete dead engine paths

**Files:**
- Modify: `src/modules/cases/store.ts` (`createCaseRecord` starts the workflow)
- Modify: `src/db/seed.ts` (starts workflows for active seeded runs)
- Modify: `app/api/twilio/status/route.ts` (signal `callCompleted`)
- Modify: `app/actions/review.ts` (resolve + signal `reviewResolved`)
- Modify: `src/voice-agent/tools.ts` (`run_follow_up_now`, `schedule_follow_up`)
- Modify: `src/modules/workflows/engine.ts` (delete `advanceDueStep` shim, `runFollowUpNow`, `OutboundFollowUpPort` stays)
- Test: `tests/case-update.test.ts`, `tests/workflow-actions.test.ts`, `tests/voice-agent-tools.test.ts` adjustments

**Interfaces:**
- Consumes: `startWorkflowRun`, `signalRun` (Task 7), `engine.applyAction` (surviving subset).
- Produces:
  - `createCaseRecord(input)` gains an optional injected starter for tests: `opts?: { startWorkflowRun?: typeof startWorkflowRun }` — defaults to the real one. Returns `caseRecord.id` unchanged.
  - Voice `run_follow_up_now` result message: `"Follow-up requested. The workflow will place the call shortly."` (semantics become asynchronous; documented in Task 10).
  - Engine loses `runFollowUpNow` and the `advanceDueStep` shim; `OutboundFollowUpPort` type remains exported from engine.ts (used by execution + dialer).

- [ ] **Step 1: Case creation starts the run**

At the end of the `if (input.workflowDefinitionId)` block in `createCaseRecord`, after inserting the first step and `workflow.started` event:

```ts
const { startWorkflowRun } = await import("@/temporal/start-run");
try {
  await startWorkflowRun({ workflowRunId: run.id });
} catch (error) {
  await db.insert(workflowEvents).values({
    workflowRunId: run.id,
    type: "step.schedule_failed",
    summary: "Workflow execution could not be started; it will be recovered by the next signal or worker restart.",
    actorType: "system",
    payload: { error: error instanceof Error ? error.message : "unknown" },
  });
}
```

(The failure is logged, not thrown: case creation must not break when Temporal is briefly unavailable; `signalWithStart` recovers the run on the next signal.)

- [ ] **Step 2: Seed starts executions**

In `src/db/seed.ts`, after inserting each active run's steps, call `startWorkflowRun({ workflowRunId })` for the runs whose status is `active` (wrap in try/catch with a console warning so seeding against a Temporal-less database still succeeds for UI-only work).

- [ ] **Step 3: Webhook signals instead of orchestrating**

In `app/api/twilio/status/route.ts`, replace the `applyOutboundCallFollowUp` block with:

```ts
if (isTerminalConnectionStatus(call.connectionStatus)) {
  const { signalRun } = await import("@/temporal/start-run");
  await signalRun({
    workflowRunId: call.workflowRunId,
    signal: "callCompleted",
    args: [{ callId: call.id }],
  });
}
```

Keep `handleCallStatus` (transcript/structured-outcome persistence) exactly as-is.

- [ ] **Step 4: Review action resolves then signals**

In `app/actions/review.ts`: keep the `engine.applyAction(...)` calls unchanged (they perform validation + projections). After a successful `resolve_blocked_step` action, look up `review.workflowRunId` (fetch the review via `DrizzleWorkflowStore.getReview` *before* resolving) and:

```ts
const { signalRun } = await import("@/temporal/start-run");
await signalRun({ workflowRunId: reviewBefore.workflowRunId, signal: "reviewResolved", args: [] });
```

Note-only actions do not signal.

- [ ] **Step 5: Voice tools go through signals**

In `src/voice-agent/tools.ts`:

- `run_follow_up_now`: replace the engine call with: load run via store (same refusal messages as today for `waiting_for_human`/non-active runs — keep those exact strings), find earliest due step; if found and `dueAt > now`, `rescheduleStep(step.id, now)` + `updateStepPayload(step.id, { requestedByUser: true })`; if none, `createStep` with `dueAt: now`, `payload: { reason: "Immediate follow-up requested.", requestedByUser: true }` (identical to today's prelude); then `signalRun({ workflowRunId, signal: "runFollowUpNow", args: [] })` and return `{ ok: true, message: "Follow-up requested. The workflow will place the call shortly." }`.
- `schedule_follow_up`: keep `toWorkflowAction`/`resolveScheduleFollowUp` and the definition validation, but instead of `routeWorkflowAction` → `engine.applyAction` for this one action type, do: `engine.applyAction(resolvedAction)` (which creates step + event, no enqueue), then `signalRun({ workflowRunId, signal: "scheduleFollowUp", args: [{ stepType: resolvedAction.stepType, dueAt: resolvedAction.dueAt.toISOString(), reason: resolvedAction.reason }] })`. Other action types keep routing through `routeWorkflowAction` untouched.
- Delete `resolveOutboundCaller` and the `outboundCaller` parameter if no longer referenced anywhere in the file.

- [ ] **Step 6: Delete dead engine paths**

Remove from `engine.ts`: the `advanceDueStep` shim, `runFollowUpNow`, and now-unused private helpers (`definitionFor` usages re-checked; keep what `applyAction`/`applyFollowUpDecision` need). Run `rg -n "runFollowUpNow|advanceDueStep" src app` and confirm zero hits outside `execution.ts`/activities.

- [ ] **Step 7: Update affected tests**

- `tests/workflow-actions.test.ts`: remove assertions about scheduler/enqueue behavior for `schedule_follow_up`; assert step creation + `step.scheduled` event only.
- `tests/voice-agent-tools.test.ts`: update `run_follow_up_now` expectations to the new message and assert the step mutation happened on the fake store; inject a fake `signalRun` via a new optional input `signalRunImpl` on `executeVoiceWorkflowTool` (defaulting to the real one) so tests never need Temporal:

```ts
signalRunImpl?: (options: { workflowRunId: string; signal: string; args: unknown[] }) => Promise<void>;
```

- `tests/case-update.test.ts`: inject `{ startWorkflowRun: async () => "wf-run-id" }` and assert it was called with the created run id.

- [ ] **Step 8: Run the full suite**

Run: `npm run test:run && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: route workflow execution through temporal signals"
```

---

### Task 9: End-to-end verification against the real self-hosted stack

**Files:** none (verification only). Fix-forward any defects found, committing fixes normally.

- [ ] **Step 1: Boot the full stack**

```bash
docker compose up -d postgres temporal temporal-ui
npm run db:migrate && npm run db:seed
AUTO_OUTBOUND_CALLS=true npm run worker &
npm run dev
```

- [ ] **Step 2: Workflow creation and immediate execution**

Create a case with a workflow via `/cases`. Expected: run appears active; Temporal UI (`localhost:8080`, namespace `hellocouncil`) shows `workflow-run-<id>` executing; the worker places a Twilio call (or records the loud failure if outside the client's business hours — verify the `scheduling.decision` event and that the workflow is sleeping on a timer with the snapped `dueAt`).

- [ ] **Step 3: Timer durability / restart recovery**

While a workflow sleeps on a future `dueAt`: kill the worker (`Ctrl-C`), confirm the workflow stays `RUNNING` in the UI, restart the worker, and confirm it resumes without duplicate step execution (`attemptCount` increments only on actual execution).

- [ ] **Step 4: Signal paths**

Complete a call (Twilio callback or by pointing the status webhook manually via curl with a signed request): workflow wakes, `phone_calls.orchestration_applied_at` set once; send the same webhook twice — the second must be a no-op (`applied: false`, no duplicate events). Resolve a review from `/review` on a blocked run: workflow resumes and schedules/executes the next step; reject: run ends `failed` and the workflow closes in the UI.

- [ ] **Step 5: Gate checks**

```bash
npm run test:run && npm run lint && npm run build
```

All three must pass. Record results in the final report.

---

### Task 10: Documentation updates

**Files:**
- Modify: `README.md` (setup, processes, Temporal UI, worker requirements)
- Modify: `docs/assignment-note.md` (runner description, pg-boss → Temporal, async voice-tool semantics)
- Modify: `docs/superpowers/specs/2026-08-23-long-running-agents-platform-design.md` (mark the Future Orchestration Path section as superseded with a pointer to the new spec)
- Reference: `docs/superpowers/specs/2026-08-26-temporal-runner-migration-design.md`

- [ ] **Step 1: README rewrite of the Worker + Local Setup sections**

Document: prerequisites (Docker), `docker compose up -d` starting postgres + temporal + temporal-ui (:8080), migrate/seed, `npm run dev`, `npm run worker` (requires `AUTO_OUTBOUND_CALLS=true` + Twilio env), `TEMPORAL_ADDRESS`/`TEMPORAL_NAMESPACE` env vars, and the workflow-ID/task-queue conventions. State explicitly that durable timers, retries, and recovery are owned by Temporal and Postgres holds projections for the UI.

- [ ] **Step 2: Assignment note updates**

Replace the pg-boss paragraph (currently at `docs/assignment-note.md:40`) with the Temporal execution model: one execution per run, durable timers, signals for call completion/review resolution/voice actions, activity-based IO, Postgres projections. Document the one intentional behavior change: voice `run_follow_up_now`/`schedule_follow_up` are now asynchronous (accepted-and-executed-shortly rather than synchronously executed). Keep the follow-up policy description intact — it is unchanged.

- [ ] **Step 3: Cross-link specs**

Add to the old platform spec's "Future Orchestration Path" section: `> Superseded 2026-08-26: the DB-backed runner was migrated to self-hosted Temporal. See docs/superpowers/specs/2026-08-26-temporal-runner-migration-design.md.`

- [ ] **Step 4: Final gate and commit**

```bash
npm run test:run && npm run lint && npm run build
git add README.md docs
git commit -m "docs: document temporal-backed runner and local setup"
```

---

## Self-Review Notes

- Spec coverage: topology+compose (Tasks 1, 7), schema changes (Task 3), client/config (Task 4), activities+determinism boundary (Tasks 2, 5), workflow+signals/queries+failure semantics (Task 6), callers rewired + dead-path deletion (Task 8), testing incl. time-skipping workflow tests (Tasks 6, 9) and manual failure-recovery verification (Task 9), docs (Task 10). `recordTemporalWorkflowId` implements the spec's `temporal_workflow_id` requirement (Task 5/7).
- Type consistency checked: `ExecuteStepOutcome` shapes match between Task 2 (production) and Task 5/6 consumers; `RunStateSnapshot` matches between Task 5 and Task 6; `startWorkflowRun`/`signalRun` signatures match between Tasks 7 and 8.
- Known deliberate deviation from the spec text: `executeDueStep` uses a fixed activity retry cap (10) plus the domain `retryLimit` enforcement inside `advanceDueStep`, rather than reading `template.retryLimit` into the Temporal retry policy — the observable behavior (exhaustion → `failed` + event) is identical.
