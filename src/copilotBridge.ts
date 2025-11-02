import * as vscode from "vscode";
import type { PhaseId } from "./bmadResources";

export interface CollectedAnswers {
  [phase: string]: Record<string, string>;
}

const SYSTEM_PROMPT =
  "You are GitHub Copilot. Apply the BMAD-METHOD context provided below to propose next actions, code scaffolding, and recommended follow-ups.";

const MAX_DOC_SECTION_LENGTH = 2000;
const MAX_MODELS_PER_CONVERSATION = 5;

interface CachedModelEntry {
  model: vscode.LanguageModelChat;
  lastUsed: number;
}

const conversationModelCache = new Map<string, Map<string, CachedModelEntry>>();

function getConversationCache(conversationId: string): Map<string, CachedModelEntry> {
  let cache = conversationModelCache.get(conversationId);
  if (!cache) {
    cache = new Map<string, CachedModelEntry>();
    conversationModelCache.set(conversationId, cache);
  }
  return cache;
}

function pruneConversationCache(cache: Map<string, CachedModelEntry>): void {
  if (cache.size <= MAX_MODELS_PER_CONVERSATION) {
    return;
  }

  while (cache.size > MAX_MODELS_PER_CONVERSATION) {
    let oldestKey: string | undefined;
    let oldestTimestamp = Number.POSITIVE_INFINITY;

    for (const [key, entry] of cache) {
      if (entry.lastUsed < oldestTimestamp) {
        oldestTimestamp = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
    } else {
      break;
    }
  }
}

async function resolveModel(
  request: vscode.ChatRequest,
  targetModelId?: string,
  conversationId?: string
): Promise<vscode.LanguageModelChat> {
  const requestedModelId = targetModelId ?? request.model.id;

  if (conversationId) {
    const cache = conversationModelCache.get(conversationId);
    const cached = cache?.get(requestedModelId);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.model;
    }
  }

  let model: vscode.LanguageModelChat;
  if (!targetModelId) {
    model = request.model;
  } else {
    const models = await vscode.lm.selectChatModels({ id: targetModelId });
    if (models.length === 0) {
      throw new Error(`Unable to locate chat model with id ${targetModelId}`);
    }
    model = models[0];
  }

  if (conversationId) {
    const cache = getConversationCache(conversationId);
    cache.set(model.id, { model, lastUsed: Date.now() });
    pruneConversationCache(cache);
  }

  return model;
}

export interface PromptSegments {
  system: string;
  user: string;
}

function truncateDocumentation(input: string): string {
  if (input.length <= MAX_DOC_SECTION_LENGTH) {
    return input;
  }

  const sliced = input.slice(0, MAX_DOC_SECTION_LENGTH).trimEnd();
  return `${sliced}\n\n...(documentation truncated)`;
}

export function buildPrompt(
  answers: CollectedAnswers,
  originalPrompt: string,
  docs?: string
): PromptSegments {
  const summary = renderSummary(answers).trim();

  const sections: string[] = ["## BMAD Summary", summary];

  if (docs?.trim()) {
    sections.push("## Generated Documentation", truncateDocumentation(docs.trim()));
  }

  sections.push("## Original Prompt", originalPrompt);

  return {
    system: SYSTEM_PROMPT,
    user: sections.join("\n\n").trim()
  };
}

export interface SendToCopilotOptions {
  targetModelId?: string;
  docs?: string;
  conversationId?: string;
}

export async function sendToCopilot(
  request: vscode.ChatRequest,
  answers: CollectedAnswers,
  options?: SendToCopilotOptions
): Promise<vscode.ChatResponsePart> {
  const prompt = buildPrompt(answers, request.prompt, options?.docs);

  const model = await resolveModel(request, options?.targetModelId, options?.conversationId);
  const messages = [
    new vscode.LanguageModelChatMessage(
      vscode.LanguageModelChatMessageRole.User,
      prompt.system,
      "system"
    ),
    vscode.LanguageModelChatMessage.User(prompt.user)
  ];
  const response = await model.sendRequest(messages);

  let generated = "";
  for await (const chunk of response.text) {
    generated += chunk;
  }

  if (!generated.trim()) {
    generated =
      "Copilot did not produce a response. Copy the BMAD summary above and retry manually.";
  }

  return new vscode.ChatResponseMarkdownPart(generated);
}

export function renderSummary(answers: CollectedAnswers): string {
  const lines: string[] = [];
  (Object.keys(answers) as PhaseId[]).forEach((phase) => {
    lines.push(`### ${phase.toUpperCase()}`);
    for (const [questionId, value] of Object.entries(answers[phase] || {})) {
      lines.push(`- **${questionId}**: ${value}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}
