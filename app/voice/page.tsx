import { runSimulatedVoiceSessionAction } from "../actions/voice";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const [{ db }, { workflowRuns }] = await Promise.all([import("@/db/client"), import("@/db/schema")]);
  const runs = await db.select().from(workflowRuns).limit(10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Simulated voice session</h1>
        <p className="text-sm text-muted">Replays transcript chunks and structured tool calls through the platform action router.</p>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-muted">There are no workflow runs available for a simulated session.</p>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <form key={run.id} action={runSimulatedVoiceSessionAction} className="rounded border border-line bg-white p-4">
              <input type="hidden" name="caseId" value={run.caseId} />
              <input type="hidden" name="workflowRunId" value={run.id} />
              <input type="hidden" name="definitionId" value={run.definitionId} />
              <p className="font-medium">{run.title}</p>
              <p className="text-sm text-muted">{run.summary}</p>
              <button className="mt-3 rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">
                Run simulated session
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
