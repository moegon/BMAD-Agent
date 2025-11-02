import * as vscode from "vscode";
import type { LmStudioConfig } from "./lmStudioClient";

const SELECTED_MODEL_KEY = "bmad.selectedModel";

type DownstreamModelKind = "copilot" | "lmstudio";

export interface DownstreamModelSelection {
  kind: DownstreamModelKind;
  label: string;
  copilotModelId?: string;
  lmStudioConfig?: LmStudioConfig;
}

function coerceKind(value: string | undefined): DownstreamModelKind | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "copilot" || normalized === "lmstudio") {
    return normalized;
  }

  return undefined;
}

function readPreferredModelSetting(configuration: vscode.WorkspaceConfiguration): DownstreamModelKind | undefined {
  const inspected = configuration.inspect<string>("preferredModel");
  const explicitValue =
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue;
  return coerceKind(explicitValue);
}

function readCopilotModelId(configuration: vscode.WorkspaceConfiguration): string | undefined {
  const value = configuration.get<string>("copilotModelId");
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readLmStudioConfig(configuration: vscode.WorkspaceConfiguration): LmStudioConfig {
  const baseUrl = configuration.get<string>("lmStudio.url")?.trim() || "http://127.0.0.1:1234/v1";
  const apiKey = configuration.get<string>("lmStudio.apiKey")?.trim();
  const model = configuration.get<string>("lmStudio.model")?.trim() || "lmstudio";
  return {
    url: baseUrl.replace(/\/+$/, ""),
    apiKey: apiKey || undefined,
    model: model || "lmstudio"
  };
}

function createSelection(
  kind: DownstreamModelKind,
  configuration: vscode.WorkspaceConfiguration
): DownstreamModelSelection {
  if (kind === "copilot") {
    return {
      kind: "copilot",
      label: "GitHub Copilot",
      copilotModelId: readCopilotModelId(configuration)
    };
  }

  return {
    kind: "lmstudio",
    label: "LM Studio",
    lmStudioConfig: readLmStudioConfig(configuration)
  };
}

interface ModelQuickPickItem extends vscode.QuickPickItem {
  downstreamKind: DownstreamModelKind;
}

async function promptForModel(
  context: vscode.ExtensionContext,
  configuration: vscode.WorkspaceConfiguration
): Promise<DownstreamModelSelection | undefined> {
  const copilotSelection = createSelection("copilot", configuration);
  const lmStudioSelection = createSelection("lmstudio", configuration);

  const items: ModelQuickPickItem[] = [
    {
      label: copilotSelection.label,
      description: copilotSelection.copilotModelId
        ? `Model: ${copilotSelection.copilotModelId}`
        : "Use active Copilot chat model",
      detail: "Delegates to GitHub Copilot services.",
      downstreamKind: "copilot"
    },
    {
      label: lmStudioSelection.label,
      description: `Model: ${lmStudioSelection.lmStudioConfig?.model ?? "lmstudio"}`,
      detail: `Endpoint: ${lmStudioSelection.lmStudioConfig?.url ?? "http://127.0.0.1:1234/v1"}`,
      downstreamKind: "lmstudio"
    }
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "Select downstream model",
    placeHolder: "Choose where BMAD should delegate the captured context.",
    ignoreFocusOut: true
  });

  if (!picked) {
    return undefined;
  }

  const selection =
    picked.downstreamKind === "copilot" ? copilotSelection : lmStudioSelection;

  await context.globalState.update(SELECTED_MODEL_KEY, selection.kind);
  return selection;
}

export async function resolveDownstreamModelSelection(
  context: vscode.ExtensionContext
): Promise<DownstreamModelSelection | undefined> {
  const configuration = vscode.workspace.getConfiguration("bmadAgent");

  const forced = readPreferredModelSetting(configuration);
  if (forced) {
    return createSelection(forced, configuration);
  }

  const storedKind = context.globalState.get<DownstreamModelKind>(SELECTED_MODEL_KEY);
  if (storedKind) {
    return createSelection(storedKind, configuration);
  }

  return promptForModel(context, configuration);
}

export async function clearStoredModelSelection(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(SELECTED_MODEL_KEY, undefined);
}
