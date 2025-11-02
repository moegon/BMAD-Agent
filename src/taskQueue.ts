import * as vscode from "vscode";
import type { PhaseId } from "./bmadResources";

export type TaskPriority = "low" | "medium" | "high";

export interface BmadTask {
  phaseId: PhaseId;
  questionId: string;
  answer: string;
  priority: TaskPriority;
  notes?: string;
}

const TASK_QUEUE_KEY = "bmad.taskQueue";

let taskQueue: BmadTask[] = [];

export function initializeTaskQueue(context: vscode.ExtensionContext): void {
  const stored = context.workspaceState.get<BmadTask[]>(TASK_QUEUE_KEY);
  taskQueue = stored ?? [];
}

export async function enqueueTasks(
  context: vscode.ExtensionContext,
  tasks: BmadTask[]
): Promise<void> {
  if (!tasks.length) {
    return;
  }

  taskQueue.push(...tasks);
  await context.workspaceState.update(TASK_QUEUE_KEY, taskQueue);
}

export function getQueuedTasks(): BmadTask[] {
  return [...taskQueue];
}

export function renderTasksMarkdown(tasks: BmadTask[]): string {
  if (!tasks.length) {
    return "";
  }

  const lines: string[] = ["### LM Studio TODOs"];
  for (const task of tasks) {
    const noteSegment = task.notes ? ` – ${task.notes}` : "";
    lines.push(
      `- (${task.priority.toUpperCase()}) [${task.phaseId}] ${task.questionId}: ${task.answer}${noteSegment}`
    );
  }
  return lines.join("\n");
}
