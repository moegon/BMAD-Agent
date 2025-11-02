import * as vscode from "vscode";
import type { CollectedAnswers } from "./copilotBridge";
import { buildPrompt } from "./copilotBridge";
import type { BmadTask } from "./taskQueue";
import { renderTasksMarkdown } from "./taskQueue";
import type { AccessMode } from "./accessControl";
import { LATEST_LM_CHAT_KEY } from "./storageKeys";

export type LmChatRole = "system" | "user" | "assistant";

export interface StoredLmChatMessage {
  id: string;
  role: LmChatRole;
  content: string;
  timestamp: number;
}

export interface StoredLmChatContext {
  answers: CollectedAnswers;
  docs?: string;
  summaryMarkdown: string;
  lmStudioModelId?: string;
  lmStudioResponseMarkdown?: string;
  tasks: BmadTask[];
  originalPrompt: string;
  copilotPrompt: string;
  recordedAt: number;
  accessMode?: AccessMode;
  messages: StoredLmChatMessage[];
}

let messageCounter = 0;

function nextMessageId(role: LmChatRole): string {
  messageCounter += 1;
  const base = Date.now().toString(36);
  return `lmchat-${role}-${base}-${messageCounter}`;
}

export function createStoredLmChatMessage(role: LmChatRole, content: string): StoredLmChatMessage {
  return {
    id: nextMessageId(role),
    role,
    content,
    timestamp: Date.now()
  };
}

export function getStoredLmChatContext(
  context: vscode.ExtensionContext
): StoredLmChatContext | undefined {
  return context.workspaceState.get<StoredLmChatContext>(LATEST_LM_CHAT_KEY);
}

export async function setStoredLmChatContext(
  context: vscode.ExtensionContext,
  value: StoredLmChatContext | undefined
): Promise<void> {
  await context.workspaceState.update(LATEST_LM_CHAT_KEY, value);
}

export function computeCopilotPrompt(context: StoredLmChatContext): string {
  const promptSegments = buildPrompt(context.answers, context.originalPrompt, context.docs);
  const sections: string[] = [promptSegments.user];

  const conversationMessages = context.messages.slice(2);
  if (conversationMessages.length) {
    const convoLines: string[] = ["## LM Studio Conversation"];
    for (const message of conversationMessages) {
      const speaker = message.role === "assistant" ? "LM Studio" : "You";
      convoLines.push(`**${speaker}:** ${message.content}`);
    }
    sections.push(convoLines.join("\n\n"));
  }

  if (context.tasks.length) {
    sections.push(renderTasksMarkdown(context.tasks));
  }

  return sections.join("\n\n").trim();
}
