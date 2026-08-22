import type { WorkflowAction, WorkflowDefinition } from "./types";

export type WorkflowActionResult = {
  ok: boolean;
  message: string;
};

export type WorkflowActionEngine = {
  applyAction(action: WorkflowAction): Promise<WorkflowActionResult>;
};

export async function routeWorkflowAction(input: {
  action: WorkflowAction;
  definition: WorkflowDefinition;
  engine: WorkflowActionEngine;
}): Promise<WorkflowActionResult> {
  const { action, definition, engine } = input;

  if (!definition.allowedActions.includes(action.type)) {
    throw new Error(`Action ${action.type} is not allowed for workflow ${definition.id}`);
  }

  return engine.applyAction(action);
}
