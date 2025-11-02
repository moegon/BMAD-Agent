import * as vscode from "vscode";
import {
  computeCopilotPrompt,
  createStoredLmChatMessage,
  getStoredLmChatContext,
  setStoredLmChatContext,
  type StoredLmChatContext,
  type StoredLmChatMessage
} from "./lmChatContext";
import { chatWithLmStudio, listLmStudioModels, type LmStudioChatMessage } from "./lmStudioClient";
import { readLmStudioConfig } from "./modelSelection";
import { ACCESS_MODE_KEY } from "./storageKeys";
import { enqueueTasks } from "./taskQueue";
import {
  DEFAULT_ACCESS_MODE,
  describeAccessMode,
  type AccessMode
} from "./accessControl";

type IncomingMessage =
  | { type: "ready" }
  | { type: "sendMessage"; text?: string }
  | { type: "requestModels" }
  | { type: "selectModel"; modelId?: string }
  | { type: "openControlPanel" }
  | { type: "clearConversation" };

interface ChatMessagePayload {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ChatStatePayload {
  hasContext: boolean;
  accessMode: AccessMode;
  accessModeLabel: string;
  modelId: string;
  endpoint: string;
  summary?: string;
  docs?: string;
  tasks: { description: string }[];
  messages: ChatMessagePayload[];
  isBusy: boolean;
  warning?: string;
}

interface ModelsPayload {
  models: string[];
  error?: string;
}

export class BmadLmChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "bmad.lmChatView";

  private view?: vscode.WebviewView;
  private pendingRefresh = false;
  private isSending = false;
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

  private getLmStudioConfig() {
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
      case "sendMessage":
        if (message.text) {
          await this.handleSendMessage(message.text);
        }
        break;
      case "openControlPanel":
        await vscode.commands.executeCommand("workbench.view.extension.bmad.explorer");
        break;
      case "clearConversation":
        await this.clearConversation();
        break;
      default:
        break;
    }
  }

  private async handleSendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.isSending) {
      return;
    }

    const stored = getStoredLmChatContext(this.context);
    if (!stored) {
      vscode.window.showInformationMessage(
        "Run `@bmad.agent start bmad project` before chatting with LM Studio."
      );
      await this.postState();
      return;
    }

    const accessMode =
      this.context.workspaceState.get<AccessMode>(ACCESS_MODE_KEY) || DEFAULT_ACCESS_MODE;
    const lmConfig = this.getLmStudioConfig();

    this.isSending = true;
    await this.postState();

    const userMessage = createStoredLmChatMessage("user", trimmed);
    const messages: StoredLmChatMessage[] = [...stored.messages, userMessage];
    const requestMessages: LmStudioChatMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content
    }));

    try {
      const result = await chatWithLmStudio(requestMessages, lmConfig, {
        justInTime: true
      });

      const assistantContent = result.rawText.trim() ? result.rawText : result.displayText;
      const assistantMessage = createStoredLmChatMessage("assistant", assistantContent);
      messages.push(assistantMessage);

      const updatedTasks = result.tasks.length ? [...stored.tasks, ...result.tasks] : stored.tasks;

      const updatedContext: StoredLmChatContext = {
        ...stored,
        messages,
        tasks: updatedTasks,
        lmStudioResponseMarkdown: assistantContent,
        lmStudioModelId: lmConfig.model,
        recordedAt: Date.now(),
        accessMode
      };
      updatedContext.copilotPrompt = computeCopilotPrompt(updatedContext);

      await setStoredLmChatContext(this.context, updatedContext);
      if (result.tasks.length) {
        await enqueueTasks(this.context, result.tasks);
      }

      this.onStateChanged?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "LM Studio request failed. Check the logs.";
      vscode.window.showErrorMessage(message);
    } finally {
      this.isSending = false;
      await this.postState();
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
      this.onStateChanged?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update LM Studio model.";
      this.postModels({ models: [], error: message });
    } finally {
      await this.postState();
    }
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

  private async clearConversation(): Promise<void> {
    const stored = getStoredLmChatContext(this.context);
    if (!stored) {
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      "Clear the stored LM Studio conversation? This keeps your BMAD summary but removes chat history.",
      { modal: true },
      "Clear",
      "Cancel"
    );

    if (confirmation !== "Clear") {
      return;
    }

    const preservedMessages = stored.messages.slice(0, 2); // system + initial user prompt
    const updatedContext: StoredLmChatContext = {
      ...stored,
      messages: preservedMessages,
      lmStudioResponseMarkdown: undefined,
      recordedAt: Date.now()
    };
    updatedContext.copilotPrompt = computeCopilotPrompt(updatedContext);

    await setStoredLmChatContext(this.context, updatedContext);
    this.onStateChanged?.();
    await this.postState();
  }

  private postModels(payload: ModelsPayload): void {
    this.view?.webview.postMessage({ type: "models", payload });
  }

  private buildState(): ChatStatePayload {
    const accessMode =
      this.context.workspaceState.get<AccessMode>(ACCESS_MODE_KEY) || DEFAULT_ACCESS_MODE;
    const stored = getStoredLmChatContext(this.context);
    const lmConfig = this.getLmStudioConfig();

    const messages: ChatMessagePayload[] = stored
      ? stored.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp
        }))
      : [];

    const tasks = stored?.tasks?.map((task) => ({
      description: `(${task.priority.toUpperCase()}) [${task.phaseId}] ${task.questionId}: ${task.answer}${
        task.notes ? ` — ${task.notes}` : ""
      }`
    })) ?? [];

    const warning = stored
      ? undefined
      : "No LM Studio conversation detected. Run the BMAD intake and delegate to LM Studio first.";

    return {
      hasContext: Boolean(stored),
      accessMode,
      accessModeLabel: describeAccessMode(accessMode),
      modelId: lmConfig.model,
      endpoint: lmConfig.url,
      summary: stored?.summaryMarkdown,
      docs: stored?.docs,
      tasks,
      messages,
      isBusy: this.isSending,
      warning
    };
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      this.pendingRefresh = true;
      return;
    }

    this.view.webview.postMessage({
      type: "state",
      payload: this.buildState()
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${
      webview.cspSource
    } https:; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BMAD LM Studio Chat</title>
    <style nonce="${nonce}">
      :root {
        color-scheme: light dark;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }
      body {
        margin: 0;
        padding: 0;
        background: var(--vscode-sideBar-background);
        color: var(--vscode-foreground);
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
      header {
        padding: 12px;
        border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
      }
      header h1 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .meta {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
      }
      .container {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        flex: 1;
        overflow: hidden;
      }
      .section {
        border: 1px solid var(--vscode-sideBarSectionHeader-border);
        border-radius: 6px;
        background: var(--vscode-editor-background);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .section h2 {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--vscode-descriptionForeground);
      }
      .summary {
        font-size: 12px;
        line-height: 1.5;
        max-height: 140px;
        overflow-y: auto;
        white-space: pre-wrap;
      }
      .controls {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      select,
      button,
      textarea {
        font: inherit;
        border-radius: 4px;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-foreground);
      }
      select,
      button {
        padding: 6px 8px;
      }
      button {
        cursor: pointer;
      }
      button.secondary {
        background: transparent;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      textarea {
        padding: 8px;
        resize: vertical;
        min-height: 48px;
        max-height: 140px;
      }
      .chat-scroll {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 4px;
      }
      .bubble {
        padding: 10px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-wrap: break-word;
        border: 1px solid transparent;
      }
      .bubble.system {
        background: var(--vscode-editorHoverWidget-background);
        border-color: var(--vscode-editorHoverWidget-border);
        color: var(--vscode-descriptionForeground);
      }
      .bubble.user {
        background: var(--vscode-editor-selectionHighlightBorder, rgba(100, 180, 255, 0.15));
        align-self: flex-end;
      }
      .bubble.assistant {
        background: var(--vscode-editorWidget-background);
        border-color: var(--vscode-editorWidget-border);
      }
      .warning {
        color: var(--vscode-editorWarning-foreground);
        font-size: 12px;
      }
      .tasks {
        font-size: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 120px;
        overflow-y: auto;
      }
      .footer-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
      }
      .small {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
    </style>
  </head>
  <body>
    <header>
      <h1>LM Studio Chat</h1>
      <div class="meta" id="accessMeta"></div>
    </header>
    <div class="container">
      <section class="section" id="summarySection">
        <h2>BMAD Summary</h2>
        <div class="summary" id="summaryContent"></div>
        <div class="summary" id="docsContent" style="display:none;"></div>
      </section>

      <section class="section">
        <h2>Model</h2>
        <div class="controls">
          <select id="modelSelect"></select>
          <button id="refreshModels">Refresh</button>
          <button class="secondary" id="openControl">Open Control Panel</button>
        </div>
        <div class="meta" id="endpointMeta"></div>
      </section>

      <section class="section" style="flex:1;">
        <h2>Conversation</h2>
        <div class="chat-scroll" id="chatScroll"></div>
        <div class="warning" id="chatWarning" hidden></div>
        <textarea id="chatInput" placeholder="Ask LM Studio about the BMAD plan…"></textarea>
        <div class="footer-actions">
          <div class="small" id="chatStatus"></div>
          <div style="display:flex; gap:8px;">
            <button class="secondary" id="clearChat">Clear History</button>
            <button id="sendMessage">Send</button>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Queued Tasks</h2>
        <div class="tasks" id="taskList"></div>
      </section>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const state = {
        hasContext: false,
        accessModeLabel: "",
        modelId: "",
        endpoint: "",
        summary: "",
        docs: "",
        tasks: [],
        messages: [],
        isBusy: false,
        warning: undefined,
        models: []
      };

      const summarySection = document.getElementById("summarySection");
      const summaryContent = document.getElementById("summaryContent");
      const docsContent = document.getElementById("docsContent");
      const modelSelect = document.getElementById("modelSelect");
      const refreshButton = document.getElementById("refreshModels");
      const openControl = document.getElementById("openControl");
      const endpointMeta = document.getElementById("endpointMeta");
      const chatScroll = document.getElementById("chatScroll");
      const chatInput = document.getElementById("chatInput");
      const sendButton = document.getElementById("sendMessage");
      const chatWarning = document.getElementById("chatWarning");
      const chatStatus = document.getElementById("chatStatus");
      const taskList = document.getElementById("taskList");
      const clearButton = document.getElementById("clearChat");
      const accessMeta = document.getElementById("accessMeta");

      function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
      }

      function renderMessages() {
        chatScroll.innerHTML = "";
        if (!state.messages.length) {
          const placeholder = document.createElement("div");
          placeholder.className = "bubble system";
          placeholder.textContent = "No conversation yet. Ask LM Studio about the plan to begin.";
          chatScroll.appendChild(placeholder);
          return;
        }

        state.messages.forEach((message) => {
          const bubble = document.createElement("div");
          bubble.className = "bubble " + message.role;
          const label = message.role === "assistant" ? "LM Studio" : message.role === "user" ? "You" : "System";
          bubble.textContent = label + ":\\n\\n" + message.content;
          chatScroll.appendChild(bubble);
        });

        chatScroll.scrollTop = chatScroll.scrollHeight;
      }

      function renderTasks() {
        taskList.innerHTML = "";
        if (!state.tasks.length) {
          const item = document.createElement("div");
          item.className = "meta";
          item.textContent = "No tasks queued yet.";
          taskList.appendChild(item);
          return;
        }

        state.tasks.forEach((task) => {
          const item = document.createElement("div");
          item.textContent = task.description;
          taskList.appendChild(item);
        });
      }

      function updateModelOptions() {
        modelSelect.innerHTML = "";
        if (!state.models.length) {
          const option = document.createElement("option");
          option.value = state.modelId || "";
          option.textContent = state.modelId ? state.modelId : "No models discovered";
          modelSelect.appendChild(option);
          modelSelect.disabled = !state.models.length;
          return;
        }

        state.models.forEach((modelId) => {
          const option = document.createElement("option");
          option.value = modelId;
          option.textContent = modelId;
          if (modelId === state.modelId) {
            option.selected = true;
          }
          modelSelect.appendChild(option);
        });
        modelSelect.disabled = false;
      }

      function applyState(payload) {
        state.hasContext = payload.hasContext;
        state.accessModeLabel = payload.accessModeLabel;
        state.modelId = payload.modelId;
        state.endpoint = payload.endpoint;
        state.summary = payload.summary || "";
        state.docs = payload.docs || "";
        state.tasks = payload.tasks || [];
        state.messages = payload.messages || [];
        state.isBusy = payload.isBusy;
        state.warning = payload.warning;

        accessMeta.textContent = "Access: " + state.accessModeLabel;
        summaryContent.textContent = state.summary || "(no summary captured yet)";
        docsContent.textContent = state.docs;
        docsContent.style.display = state.docs ? "block" : "none";
        endpointMeta.textContent = "Endpoint: " + state.endpoint;

        chatWarning.hidden = !state.warning;
        if (state.warning) {
          chatWarning.textContent = state.warning;
        }

        chatStatus.textContent = state.isBusy
          ? "Requesting response from LM Studio…"
          : state.hasContext
          ? "Ready."
          : "Run the BMAD workflow to capture context.";
        chatInput.disabled = !state.hasContext || state.isBusy;
        sendButton.disabled = !state.hasContext || state.isBusy;
        clearButton.disabled = !state.hasContext || state.isBusy;

        updateModelOptions();
        renderMessages();
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
          state.models = message.payload.models || [];
          if (message.payload.error) {
            chatStatus.textContent = message.payload.error;
          }
          updateModelOptions();
        }
      });

      sendButton.addEventListener("click", () => {
        const text = chatInput.value;
        chatInput.value = "";
        vscode.postMessage({ type: "sendMessage", text });
      });

      chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          sendButton.click();
        }
      });

      refreshButton.addEventListener("click", () => {
        chatStatus.textContent = "Fetching models…";
        vscode.postMessage({ type: "requestModels" });
      });

      modelSelect.addEventListener("change", () => {
        const modelId = modelSelect.value;
        if (modelId) {
          vscode.postMessage({ type: "selectModel", modelId });
        }
      });

      openControl.addEventListener("click", () => {
        vscode.postMessage({ type: "openControlPanel" });
      });

      clearButton.addEventListener("click", () => {
        vscode.postMessage({ type: "clearConversation" });
      });

      vscode.postMessage({ type: "ready" });
      vscode.postMessage({ type: "requestModels" });
    </script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 16; i += 1) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
