import * as vscode from "vscode";
import {
  getStoredLmChatContext,
  setStoredLmChatContext,
  type StoredLmChatContext
} from "./lmChatContext";
import type { LmStudioConfig } from "./lmStudioClient";
import { listLmStudioModels } from "./lmStudioClient";
import { readLmStudioConfig } from "./modelSelection";
import { ACCESS_MODE_KEY } from "./storageKeys";
import { getQueuedTasks, type BmadTask } from "./taskQueue";
import {
  DEFAULT_ACCESS_MODE,
  describeAccessMode,
  type AccessMode
} from "./accessControl";

type IncomingMessage =
  | { type: "ready" }
  | { type: "requestModels" }
  | { type: "selectModel"; modelId?: string }
  | { type: "setAccessMode"; mode?: string }
  | { type: "pushToCopilot" };

interface StatePayload {
  accessMode: AccessMode;
  accessModeLabel: string;
  selectedModel: string;
  endpoint: string;
  hasApiKey: boolean;
  hasContext: boolean;
  copilotReady: boolean;
  lastCaptured?: number;
  queuedTasks: BmadTask[];
  lmDraftPreview?: string;
}

interface ModelsPayload {
  models: string[];
  error?: string;
}

export class BmadSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "bmad.controlPanel";

  private view?: vscode.WebviewView;
  private pendingRefresh = false;
  private onStateChanged?: () => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public setStateChangedHandler(handler: () => void): void {
    this.onStateChanged = handler;
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: IncomingMessage) => {
      await this.handleMessage(message);
    });

    if (this.pendingRefresh) {
      this.pendingRefresh = false;
      void this.postState();
    }
  }

  public refresh(): void {
    if (!this.view) {
      this.pendingRefresh = true;
      return;
    }

    void this.postState();
  }

  private getConfiguration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("bmadAgent");
  }

  private getLmStudioConfig(): LmStudioConfig {
    return readLmStudioConfig(this.getConfiguration());
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        void this.postState();
        break;
      case "requestModels":
        await this.provideModelList();
        break;
      case "selectModel":
        if (message.modelId) {
          await this.updateSelectedModel(message.modelId);
        }
        break;
      case "setAccessMode":
        if (message.mode) {
          const coerced = coerceAccessMode(message.mode);
          if (coerced) {
            await this.updateAccessMode(coerced);
          }
        }
        break;
      case "pushToCopilot":
        await vscode.commands.executeCommand("bmad.pushLmChatToCopilot");
        break;
      default:
        break;
    }
  }

  private async updateSelectedModel(modelId: string): Promise<void> {
    const configuration = this.getConfiguration();

    try {
      await configuration.update(
        "lmStudio.model",
        modelId,
        vscode.ConfigurationTarget.Workspace
      );
      vscode.window.showInformationMessage(`LM Studio model set to ${modelId}.`);
      this.refresh();
      this.onStateChanged?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update LM Studio model.";
      this.postModels({ models: [], error: message });
    }
  }

  private async updateAccessMode(mode: AccessMode): Promise<void> {
    const current = this.context.workspaceState.get<AccessMode>(ACCESS_MODE_KEY);
    if (current === mode) {
      return;
    }

    if (mode === "full") {
      const confirmation = await vscode.window.showWarningMessage(
        "Full access allows the BMAD Agent to read and modify files outside the current workspace. This may expose sensitive information. Continue?",
        { modal: true },
        "Enable Full Access",
        "Cancel"
      );

      if (confirmation !== "Enable Full Access") {
        await this.postState();
        return;
      }
    }

    await this.context.workspaceState.update(ACCESS_MODE_KEY, mode);

    const stored = getStoredLmChatContext(this.context);
    if (stored) {
      const updated: StoredLmChatContext = { ...stored, accessMode: mode };
      await setStoredLmChatContext(this.context, updated);
    }

    this.refresh();
    this.onStateChanged?.();
  }

  private async provideModelList(): Promise<void> {
    try {
      const models = await listLmStudioModels(this.getLmStudioConfig());
      this.postModels({ models });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load LM Studio models.";
      this.postModels({ models: [], error: message });
    }
  }

  private postModels(payload: ModelsPayload): void {
    this.view?.webview.postMessage({ type: "models", payload });
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      this.pendingRefresh = true;
      return;
    }

    const lmConfig = this.getLmStudioConfig();
    const accessMode =
      this.context.workspaceState.get<AccessMode>(ACCESS_MODE_KEY) ||
      DEFAULT_ACCESS_MODE;
    const contextSnapshot = getStoredLmChatContext(this.context);
    const tasks = getQueuedTasks();

    const payload: StatePayload = {
      accessMode,
      accessModeLabel: describeAccessMode(accessMode),
      selectedModel: lmConfig.model,
      endpoint: lmConfig.url,
      hasApiKey: Boolean(lmConfig.apiKey),
      hasContext: Boolean(contextSnapshot),
      copilotReady: Boolean(contextSnapshot?.copilotPrompt?.trim()),
      lastCaptured: contextSnapshot?.recordedAt,
      queuedTasks: tasks,
      lmDraftPreview: contextSnapshot?.lmStudioResponseMarkdown
        ? contextSnapshot.lmStudioResponseMarkdown.slice(0, 160)
        : undefined
    };

    this.view.webview.postMessage({ type: "state", payload });
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png")
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${
      webview.cspSource
    } https:; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BMAD Control</title>
    <style nonce="${nonce}">
      :root {
        color-scheme: light dark;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }
      body {
        margin: 0;
        padding: 0;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
      }
      .container {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      header h1 {
        font-size: 14px;
        font-weight: 600;
        margin: 0;
      }
      header img {
        height: 20px;
        width: 20px;
      }
      section {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-sideBarSectionHeader-border);
        border-radius: 6px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      section h2 {
        font-size: 12px;
        font-weight: 600;
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--vscode-descriptionForeground);
      }
      .radio-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .radio-row label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
      }
      select,
      button {
        font: inherit;
        padding: 6px 8px;
        border-radius: 4px;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-foreground);
      }
      button {
        cursor: pointer;
        border: 1px solid var(--vscode-button-border, var(--vscode-input-border));
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      button.secondary {
        background: transparent;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .meta {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      ul {
        margin: 0;
        padding-left: 18px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .warning {
        color: var(--vscode-editorWarning-foreground);
        font-size: 12px;
      }
      .status {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .task-empty {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }
      .link {
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <img src="${codiconsUri}" alt="BMAD" />
        <h1>BMAD Control</h1>
      </header>

      <section>
        <h2>Access Mode</h2>
        <div class="radio-row">
          <label><input type="radio" name="accessMode" value="read" /> Read-only</label>
          <label><input type="radio" name="accessMode" value="workspace" /> Workspace</label>
          <label><input type="radio" name="accessMode" value="full" /> Full access</label>
        </div>
        <p class="meta" id="accessModeDescription"></p>
        <p class="warning" id="accessWarning" hidden>
          Full access can touch any accessible path. Only enable this when you trust the model.
        </p>
      </section>

      <section>
        <h2>LM Studio Model</h2>
        <div class="radio-row">
          <select id="modelSelect"></select>
          <button class="secondary" id="refreshModels">Refresh</button>
        </div>
        <p class="meta" id="endpointMeta"></p>
        <p class="meta" id="modelStatus"></p>
      </section>

      <section>
        <h2>Copilot Handoff</h2>
        <button id="pushToCopilot">Copy BMAD context</button>
        <p class="status" id="contextStatus"></p>
        <p class="meta">
          Tip: mention <code>@bmad-lmchat</code> inside Copilot to pull this context inline.
        </p>
      </section>

      <section>
        <h2>Queued Tasks</h2>
        <ul id="taskList"></ul>
      </section>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const state = {
        accessMode: "workspace",
        selectedModel: "",
        endpoint: "",
        hasApiKey: false,
        hasContext: false,
        copilotReady: false,
        lastCaptured: undefined,
        queuedTasks: [],
        lmDraftPreview: undefined,
        models: []
      };

      const accessRadios = Array.from(document.querySelectorAll('input[name="accessMode"]'));
      const accessDescription = document.getElementById("accessModeDescription");
      const accessWarning = document.getElementById("accessWarning");
      const modelSelect = document.getElementById("modelSelect");
      const refreshButton = document.getElementById("refreshModels");
      const endpointMeta = document.getElementById("endpointMeta");
      const modelStatus = document.getElementById("modelStatus");
      const pushButton = document.getElementById("pushToCopilot");
      const contextStatus = document.getElementById("contextStatus");
      const taskList = document.getElementById("taskList");

      function updateAccessUI() {
        accessRadios.forEach((radio) => {
          radio.checked = radio.value === state.accessMode;
        });

        accessDescription.textContent = state.accessModeLabel || "";
        accessWarning.hidden = state.accessMode !== "full";
      }

      function updateModelOptions() {
        const selected = state.selectedModel;
        modelSelect.innerHTML = "";
        if (!state.models.length) {
          const option = document.createElement("option");
          option.value = selected || "";
          option.textContent = selected || "No models available";
          modelSelect.appendChild(option);
          modelSelect.disabled = !state.models.length;
          return;
        }

        state.models.forEach((modelId) => {
          const option = document.createElement("option");
          option.value = modelId;
          option.textContent = modelId;
          if (modelId === selected) {
            option.selected = true;
          }
          modelSelect.appendChild(option);
        });

        modelSelect.disabled = false;
        if (!state.models.includes(selected) && state.models.length) {
          modelSelect.value = state.models[0];
        }
      }

      function formatTimestamp(timestamp) {
        if (!timestamp) {
          return "";
        }
        return new Date(timestamp).toLocaleString();
      }

      function updateContextStatus() {
        if (!state.hasContext) {
          contextStatus.textContent = "No LM Studio conversation captured yet.";
          pushButton.disabled = true;
          return;
        }

        const captured = formatTimestamp(state.lastCaptured);
        const preview = state.lmDraftPreview
          ? " Preview: " + state.lmDraftPreview + "..."
          : "";
        contextStatus.textContent = \`Captured \${captured}.\${preview}\`;
        pushButton.disabled = !state.copilotReady;
      }

      function renderTasks() {
        taskList.innerHTML = "";
        if (!state.queuedTasks.length) {
          const empty = document.createElement("li");
          empty.className = "task-empty";
          empty.textContent = "No queued tasks.";
          taskList.appendChild(empty);
          return;
        }

        state.queuedTasks.forEach((task) => {
          const item = document.createElement("li");
          const priority = task.priority ? task.priority.toUpperCase() : "MEDIUM";
          const notes = task.notes ? \` — \${task.notes}\` : "";
          item.textContent = \`(\${priority}) [\${task.phaseId}] \${task.questionId}: \${task.answer}\${notes}\`;
          taskList.appendChild(item);
        });
      }

      function applyState(payload) {
        state.accessMode = payload.accessMode;
        state.accessModeLabel = payload.accessModeLabel;
        state.selectedModel = payload.selectedModel;
        state.endpoint = payload.endpoint;
        state.hasApiKey = payload.hasApiKey;
        state.hasContext = payload.hasContext;
        state.copilotReady = payload.copilotReady;
        state.lastCaptured = payload.lastCaptured;
        state.queuedTasks = payload.queuedTasks || [];
        state.lmDraftPreview = payload.lmDraftPreview;

        updateAccessUI();
        updateModelOptions();
        endpointMeta.textContent = \`Endpoint: \${state.endpoint}\${
          state.hasApiKey ? " (API key set)" : " (no API key)"
        }\`;
        modelStatus.textContent = state.selectedModel
          ? \`Using model \${state.selectedModel}\`
          : "No model selected.";
        updateContextStatus();
        renderTasks();
      }

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message) {
          return;
        }

        if (message.type === "state") {
          applyState(message.payload);
        } else if (message.type === "models") {
          const { payload } = message;
          state.models = payload.models || [];
          if (payload.error) {
            modelStatus.textContent = payload.error;
          }
          updateModelOptions();
        }
      });

      accessRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
          if (radio.checked) {
            vscode.postMessage({ type: "setAccessMode", mode: radio.value });
          }
        });
      });

      modelSelect.addEventListener("change", () => {
        const modelId = modelSelect.value;
        if (modelId) {
          vscode.postMessage({ type: "selectModel", modelId });
        }
      });

      refreshButton.addEventListener("click", () => {
        modelStatus.textContent = "Fetching models…";
        vscode.postMessage({ type: "requestModels" });
      });

      pushButton.addEventListener("click", () => {
        vscode.postMessage({ type: "pushToCopilot" });
      });

      vscode.postMessage({ type: "ready" });
      vscode.postMessage({ type: "requestModels" });
    </script>
  </body>
</html>`;
  }
}

function coerceAccessMode(value: string): AccessMode | undefined {
  if (value === "read" || value === "workspace" || value === "full") {
    return value;
  }
  return undefined;
}

function getNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 16; i += 1) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
