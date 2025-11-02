import * as vscode from "vscode";
import { bmadPhases, PhaseId } from "./bmadResources";
import { CollectedAnswers, buildPrompt, renderSummary, sendToCopilot } from "./copilotBridge";
import { sendToLmStudio } from "./lmStudioClient";
import { loadPhaseResources, renderResourceMarkdown } from "./resourceLoader";
import { resolveDownstreamModelSelection } from "./modelSelection";
import { generateBmAdScaffolding } from "./scaffolding";
import { enqueueTasks, initializeTaskQueue, renderTasksMarkdown, type BmadTask } from "./taskQueue";
import { BmadSidebarProvider } from "./sidebarProvider";
import { BmadLmChatViewProvider } from "./lmChatViewProvider";
import { ACCESS_MODE_KEY, LATEST_ANSWERS_KEY } from "./storageKeys";
import {
  createStoredLmChatMessage,
  getStoredLmChatContext,
  setStoredLmChatContext,
  computeCopilotPrompt,
  type StoredLmChatContext
} from "./lmChatContext";
import { DEFAULT_ACCESS_MODE, describeAccessMode, type AccessMode } from "./accessControl";
let latestAnswersCache: CollectedAnswers | undefined;
const conversationIds = new WeakMap<vscode.ChatContext, string>();
let conversationCounter = 0;

function formatTimestamp(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString();
  } catch (error) {
    console.warn("Failed to format timestamp", error);
    return new Date(epochMs).toISOString();
  }
}

function buildLmChatParticipantMarkdown(stored: StoredLmChatContext): string {
  const sections: string[] = ["## LM Studio Context Snapshot"];

  const metaLines: string[] = [`**Captured:** ${formatTimestamp(stored.recordedAt)}`];
  if (stored.lmStudioModelId) {
    metaLines.push(`**LM Studio model:** ${stored.lmStudioModelId}`);
  }
  if (stored.accessMode) {
    metaLines.push(`**Access mode:** ${describeAccessMode(stored.accessMode)}`);
  }
  if (metaLines.length) {
    sections.push(metaLines.join("  \n"));
  }

  const promptContent = computeCopilotPrompt(stored).trim();
  if (promptContent) {
    sections.push(promptContent);
  }

  sections.push("_Paste into Copilot to continue with the captured BMAD context._");

  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

function getConversationId(context: vscode.ChatContext): string {
  let id = conversationIds.get(context);
  if (!id) {
    conversationCounter += 1;
    id = `chat-${conversationCounter}`;
    conversationIds.set(context, id);
  }
  return id;
}

async function persistLmChatContext(
  context: vscode.ExtensionContext,
  payload: {
    answers: CollectedAnswers;
    docs?: string;
    originalPrompt: string;
    lmStudioResponseMarkdown?: string;
    tasks: BmadTask[];
    modelId?: string;
  }
): Promise<void> {
  const summaryMarkdown = renderSummary(payload.answers).trim();
  const promptSegments = buildPrompt(payload.answers, payload.originalPrompt, payload.docs);
  const lmDraft = payload.lmStudioResponseMarkdown?.trim();
  const accessMode = context.workspaceState.get<AccessMode>(ACCESS_MODE_KEY);

  const messages = [
    createStoredLmChatMessage("system", promptSegments.system),
    createStoredLmChatMessage("user", promptSegments.user)
  ];

  if (lmDraft) {
    messages.push(createStoredLmChatMessage("assistant", lmDraft));
  }

  const stored: StoredLmChatContext = {
    answers: payload.answers,
    docs: payload.docs,
    summaryMarkdown,
    lmStudioModelId: payload.modelId,
    lmStudioResponseMarkdown: lmDraft,
    tasks: payload.tasks,
    originalPrompt: payload.originalPrompt,
    copilotPrompt: "",
    recordedAt: Date.now(),
    accessMode,
    messages
  };

  stored.copilotPrompt = computeCopilotPrompt(stored);

  await setStoredLmChatContext(context, stored);
}

export async function activate(context: vscode.ExtensionContext) {
  latestAnswersCache = context.workspaceState.get<CollectedAnswers>(LATEST_ANSWERS_KEY);
  initializeTaskQueue(context);

  const existingAccessMode = context.workspaceState.get<AccessMode>(ACCESS_MODE_KEY);
  if (!existingAccessMode) {
    await context.workspaceState.update(ACCESS_MODE_KEY, DEFAULT_ACCESS_MODE);
  }

  const sidebarProvider = new BmadSidebarProvider(context);
  const lmChatProvider = new BmadLmChatViewProvider(context);

  sidebarProvider.setStateChangedHandler(() => {
    lmChatProvider.refresh();
  });

  lmChatProvider.setStateChangedHandler(() => {
    sidebarProvider.refresh();
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(BmadSidebarProvider.viewType, sidebarProvider)
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(BmadLmChatViewProvider.viewType, lmChatProvider)
  );

  const participantDisposable = vscode.chat.createChatParticipant(
    "bmad.agent",
    async (request, chatContext, stream) => {
      const trigger = request.prompt.trim().toLowerCase();
      const isStarter =
        trigger.includes("start bmad project") || trigger.includes("run bmad kickoff");

      if (!isStarter) {
        stream.markdown("Say `start bmad project` to launch the BMAD guided workflow.");
        return;
      }

      const collected: CollectedAnswers = {
        brainstorm: {},
        map: {},
        assemble: {},
        deploy: {}
      };

      for (const phase of bmadPhases) {
        stream.progress(`Collecting ${phase.title} insights…`);
        for (const question of phase.questions) {
          const result = await vscode.window.showInputBox({
            title: `${phase.title}: ${question.prompt}`,
            prompt: question.hint,
            ignoreFocusOut: true
          });

          collected[phase.id as PhaseId][question.id] = result?.trim() || "(no answer)";
        }

        const resources = await loadPhaseResources(phase, context.extensionUri);
        const guidance = renderResourceMarkdown(phase, resources);
        if (guidance) {
          stream.markdown(guidance);
        }
      }

      const summary = renderSummary(collected);
      stream.markdown(`## BMAD Summary\n\n${summary}`);

      const generateDocs = await vscode.window.showQuickPick(["Yes", "No"], {
        title: "Generate documentation from summary?",
        ignoreFocusOut: true
      });

      let docs: string | undefined;
      if (generateDocs === "Yes") {
        const model = await vscode.window.showQuickPick(
          ["Copilot", "Claude", "Haiku 4.5", "LM Studio"],
          {
            title: "Select a model for documentation generation",
            ignoreFocusOut: true
          }
        );

        if (model) {
          // This is a placeholder for the actual documentation generation logic
          docs = `Documentation generated by ${model}:\n\n${summary}`;
          const confirmDocs = await vscode.window.showQuickPick(["Yes", "No"], {
            title: `Happy with the generated documentation?\n\n${docs}`,
            ignoreFocusOut: true
          });

          if (confirmDocs !== "Yes") {
            docs = undefined;
          }
        }
      }

      latestAnswersCache = collected;
      await context.workspaceState.update(LATEST_ANSWERS_KEY, collected);

      const downstreamSelection = await resolveDownstreamModelSelection(context);
      if (!downstreamSelection) {
        stream.markdown(
          "> Cancelled sending BMAD context because no downstream model was selected."
        );
        return;
      }

      try {
        stream.progress(`Passing context to ${downstreamSelection.label}…`);

        const conversationId = getConversationId(chatContext);
        let downstreamPart: vscode.ChatResponsePart;
        let newTasksMarkdown: string | undefined;

        if (downstreamSelection.kind === "lmstudio") {
          const lmStudioConfig = downstreamSelection.lmStudioConfig;
          if (!lmStudioConfig) {
            throw new Error("LM Studio configuration is incomplete.");
          }
          const lmResult = await sendToLmStudio(request, collected, lmStudioConfig, { docs });
          await persistLmChatContext(context, {
            answers: collected,
            docs,
            originalPrompt: request.prompt,
            lmStudioResponseMarkdown: lmResult.rawText,
            tasks: lmResult.tasks,
            modelId: lmStudioConfig.model
          });
          downstreamPart = lmResult.responsePart;
          if (lmResult.tasks.length) {
            await enqueueTasks(context, lmResult.tasks);
            newTasksMarkdown = renderTasksMarkdown(lmResult.tasks);
          }
          sidebarProvider.refresh();
          lmChatProvider.refresh();
        } else {
          downstreamPart = await sendToCopilot(request, collected, {
            targetModelId: downstreamSelection.copilotModelId,
            docs,
            conversationId
          });
        }

        stream.push(downstreamPart);
        if (newTasksMarkdown) {
          stream.markdown(newTasksMarkdown);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error sending request to Copilot.";
        stream.markdown(
          [
            "> Failed to reach a language model automatically. Copy the summary above and paste it into Copilot manually.",
            "",
            `Details: ${message}`
          ].join("\n")
        );
      }
    }
  );

  context.subscriptions.push(participantDisposable);

  const lmChatParticipant = vscode.chat.createChatParticipant(
    "bmad-lmchat",
    async (request, _chatContext, stream) => {
      const stored = getStoredLmChatContext(context);
      if (!stored) {
        stream.markdown(
          "No LM Studio chat context is available yet. Run the BMAD intake and delegate to LM Studio first."
        );
        return;
      }

      const normalizedPrompt = request.prompt.trim().toLowerCase();
      const clipboardRequested =
        normalizedPrompt.includes("copy") || normalizedPrompt.includes("clipboard");

      const message = buildLmChatParticipantMarkdown(stored);

      if (clipboardRequested) {
        await vscode.env.clipboard.writeText(computeCopilotPrompt(stored));
        stream.markdown(`${message}\n\n> Copied BMAD context to your clipboard.`);
      } else {
        stream.markdown(message);
      }

      lmChatProvider.refresh();
      sidebarProvider.refresh();
    }
  );

  context.subscriptions.push(lmChatParticipant);

  context.subscriptions.push(
    vscode.commands.registerCommand("bmad.pushLmChatToCopilot", async () => {
      const stored = getStoredLmChatContext(context);
      if (!stored) {
        vscode.window.showWarningMessage(
          "No LM Studio chat context is available yet. Run the BMAD workflow before pushing to Copilot."
        );
        return;
      }

      const textToCopy = stored.copilotPrompt || stored.summaryMarkdown;
      if (!textToCopy?.trim()) {
        vscode.window.showWarningMessage(
          "BMAD context is empty. Re-run the workflow to capture new details."
        );
        return;
      }

      await vscode.env.clipboard.writeText(textToCopy);
      vscode.window.showInformationMessage(
        "Copied BMAD context. Paste into Copilot chat and continue the conversation."
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bmad.generateScaffolding", async () => {
      if (!latestAnswersCache) {
        vscode.window.showInformationMessage(
          "Run `@bmad.agent start bmad project` before generating scaffolding so the agent can use your responses."
        );
        return;
      }

      await generateBmAdScaffolding(latestAnswersCache);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bmad.refinePhase", async () => {
      const phaseItems = bmadPhases.map((phase) => ({
        label: phase.title,
        description: phase.description,
        phaseId: phase.id
      }));

      const picked = await vscode.window.showQuickPick(phaseItems, {
        title: "Select BMAD phase to refine"
      });

      if (!picked) {
        return;
      }

      const selectedPhase = bmadPhases.find((phase) => phase.id === picked.phaseId);
      if (!selectedPhase) {
        return;
      }

      const resources = await loadPhaseResources(selectedPhase, context.extensionUri);
      const guidance = renderResourceMarkdown(selectedPhase, resources);
      const lines: string[] = [
        `# ${selectedPhase.title} refinement`,
        "",
        selectedPhase.description,
        ""
      ];

      if (guidance) {
        lines.push(guidance, "");
      }

      if (selectedPhase.followUps?.length) {
        lines.push("**Follow-up prompts:**", ...selectedPhase.followUps.map((item) => `- ${item}`), "");
      }

      const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: lines.join("\n").trim() + "\n"
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );
}

export function deactivate() {
  // no-op for now
}
