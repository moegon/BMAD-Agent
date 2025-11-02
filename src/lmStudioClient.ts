import * as vscode from "vscode";
import type { CollectedAnswers } from "./copilotBridge";
import { buildPrompt } from "./copilotBridge";
import type { PhaseId } from "./bmadResources";
import type { BmadTask, TaskPriority } from "./taskQueue";

export interface LmStudioChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LmStudioConfig {
  url: string;
  apiKey?: string;
  model: string;
}

interface ChatCompletionChoice {
  message?: {
    content?: string;
    tool_calls?: ChatCompletionToolCall[];
  };
  text?: string;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

interface ModelsResponse {
  data?: Array<{
    id?: string;
  }>;
}

interface ChatCompletionToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface SendToLmStudioOptions {
  docs?: string;
  timeoutMs?: number;
}

export interface LmStudioResult {
  responsePart: vscode.ChatResponsePart;
  tasks: BmadTask[];
  rawText: string;
}

export interface LmStudioChatResult {
  rawText: string;
  displayText: string;
  tasks: BmadTask[];
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL_LIST_TIMEOUT_MS = 10_000;
const TASK_TOOL_NAME = "record_task";
const VALID_PHASE_IDS = new Set<PhaseId>(["brainstorm", "map", "assemble", "deploy"]);

function ensureFetch(): typeof globalThis.fetch {
  const fetchFn = globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("Fetch API is not available in this environment.");
  }
  return fetchFn.bind(globalThis);
}

function buildEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function buildModelsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/models`;
}

function extractContent(payload: ChatCompletionResponse): string {
  const choice = payload.choices?.[0];
  if (!choice) {
    return "";
  }

  if (choice.message?.content) {
    return choice.message.content;
  }

  if (typeof choice.text === "string") {
    return choice.text;
  }

  return "";
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    console.warn("Failed to read LM Studio response body", error);
    return "";
  }
}

interface InternalRequestOptions {
  timeoutMs?: number;
  justInTime?: boolean;
}

interface InternalCallResult {
  payload: ChatCompletionResponse;
  rawText: string;
  tasks: BmadTask[];
}

function buildRequestBody(
  model: string,
  messages: LmStudioChatMessage[],
  justInTime: boolean
): Record<string, unknown> {
  return {
    model,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    tools: [
      {
        type: "function",
        function: {
          name: TASK_TOOL_NAME,
          description:
            "Capture a follow-up TODO item that should be queued for the BMAD delivery plan.",
          parameters: {
            type: "object",
            properties: {
              phaseId: {
                type: "string",
                enum: Array.from(VALID_PHASE_IDS),
                description:
                  "BMAD phase the task maps to. Must be brainstorm, map, assemble, or deploy."
              },
              questionId: {
                type: "string",
                description: "Identifier of the original BMAD question the task relates to."
              },
              answer: {
                type: "string",
                description: "Short description of the action item or next step."
              },
              priority: {
                type: "string",
                enum: ["low", "medium", "high"],
                description: "Relative urgency for the task."
              },
              notes: {
                type: "string",
                description: "Optional additional context or acceptance notes."
              }
            },
            required: ["phaseId", "questionId", "answer", "priority"]
          }
        }
      }
    ],
    tool_choice: "auto",
    temperature: 0.2,
    stream: false,
    just_in_time: justInTime,
    justInTime
  };
}

function determineAssistantText(rawText: string, tasks: BmadTask[]): string {
  const trimmed = rawText.trim();
  if (trimmed) {
    return trimmed;
  }

  return tasks.length
    ? "LM Studio returned follow-up tasks. See details below."
    : "LM Studio did not produce a response. Copy the BMAD summary above and retry manually.";
}

async function requestLmStudio(
  config: LmStudioConfig,
  messages: LmStudioChatMessage[],
  options?: InternalRequestOptions
): Promise<InternalCallResult> {
  const fetchFn = ensureFetch();
  const endpoint = buildEndpoint(config.url);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(
        buildRequestBody(config.model, messages, Boolean(options?.justInTime))
      ),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await readResponseBody(response);
      throw new Error(
        `LM Studio request failed (${response.status} ${response.statusText}): ${
          errorText || "No response body"
        }`
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const rawText = extractContent(payload).trim();
    const tasks = extractTasksFromToolCalls(payload);

    return { payload, rawText, tasks };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("LM Studio request timed out. Verify the endpoint is reachable.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendToLmStudio(
  request: vscode.ChatRequest,
  answers: CollectedAnswers,
  config: LmStudioConfig,
  options?: SendToLmStudioOptions
): Promise<LmStudioResult> {
  const prompt = buildPrompt(answers, request.prompt, options?.docs);
  const messages: LmStudioChatMessage[] = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user }
  ];

  const result = await requestLmStudio(config, messages, {
    timeoutMs: options?.timeoutMs,
    justInTime: false
  });

  const finalText = determineAssistantText(result.rawText, result.tasks);

  return {
    responsePart: new vscode.ChatResponseMarkdownPart(finalText),
    tasks: result.tasks,
    rawText: result.rawText
  };
}

export async function listLmStudioModels(
  config: LmStudioConfig,
  options?: { timeoutMs?: number }
): Promise<string[]> {
  const fetchFn = ensureFetch();
  const endpoint = buildModelsEndpoint(config.url);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_MODEL_LIST_TIMEOUT_MS
  );

  try {
    const response = await fetchFn(endpoint, {
      method: "GET",
      headers: {
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await readResponseBody(response);
      throw new Error(
        `LM Studio model list failed (${response.status} ${response.statusText}): ${
          errorText || "No response body"
        }`
      );
    }

    const payload = (await response.json()) as ModelsResponse;
    const modelIds = Array.isArray(payload.data)
      ? payload.data
          .map((entry) => (typeof entry?.id === "string" ? entry.id : undefined))
          .filter((id): id is string => Boolean(id))
      : [];

    if (modelIds.length === 0) {
      return [config.model];
    }

    return Array.from(new Set(modelIds));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("LM Studio model discovery timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function chatWithLmStudio(
  messages: LmStudioChatMessage[],
  config: LmStudioConfig,
  options?: { timeoutMs?: number; justInTime?: boolean }
): Promise<LmStudioChatResult> {
  const result = await requestLmStudio(config, messages, {
    timeoutMs: options?.timeoutMs,
    justInTime: options?.justInTime ?? true
  });

  const displayText = determineAssistantText(result.rawText, result.tasks);

  return {
    rawText: result.rawText,
    displayText,
    tasks: result.tasks
  };
}

function normalizePriority(value: unknown): TaskPriority {
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "low" || lowered === "medium" || lowered === "high") {
      return lowered;
    }
  }
  return "medium";
}

function parseTaskPayload(raw: unknown): BmadTask | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const payload = raw as Record<string, unknown>;
  const phaseIdInput = typeof payload.phaseId === "string" ? payload.phaseId.toLowerCase() : undefined;
  if (!phaseIdInput) {
    return undefined;
  }

  const normalizedPhaseId = phaseIdInput as PhaseId;
  if (!VALID_PHASE_IDS.has(normalizedPhaseId)) {
    return undefined;
  }

  const questionId = typeof payload.questionId === "string" ? payload.questionId : undefined;
  const answer = typeof payload.answer === "string" ? payload.answer : undefined;

  if (!questionId || !answer) {
    return undefined;
  }

  const priority = normalizePriority(payload.priority);
  const notes =
    typeof payload.notes === "string" && payload.notes.trim().length
      ? payload.notes.trim()
      : undefined;

  return {
    phaseId: normalizedPhaseId,
    questionId,
    answer,
    priority,
    notes
  };
}

function extractTasksFromToolCalls(payload: ChatCompletionResponse): BmadTask[] {
  const choice = payload.choices?.[0];
  const toolCalls = choice?.message?.tool_calls ?? [];
  const tasks: BmadTask[] = [];

  for (const toolCall of toolCalls) {
    if (toolCall.type !== "function" || toolCall.function?.name !== TASK_TOOL_NAME) {
      continue;
    }

    const args = toolCall.function?.arguments;
    if (!args) {
      continue;
    }

    try {
      const parsed = JSON.parse(args);
      const task = parseTaskPayload(parsed);
      if (task) {
        tasks.push(task);
      }
    } catch (error) {
      console.warn("Failed to parse LM Studio task payload", error);
    }
  }

  return tasks;
}
