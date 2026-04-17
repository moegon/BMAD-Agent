import * as path from "path";
import * as vscode from "vscode";
import { bmadPhases } from "./bmadResources";
import type { CollectedAnswers } from "./copilotBridge";
import { renderSummary } from "./copilotBridge";

interface FileArtifact {
  uri: vscode.Uri;
  contents: string;
}

function convertAnswersToMarkdown(answers: CollectedAnswers): string {
  const summary = renderSummary(answers).trim();
  const timestamp = new Date().toISOString();
  const lines: string[] = [
    "# BMAD Delivery Plan",
    `Generated: ${timestamp}`,
    "",
    "## Executive Summary",
    summary,
    "## Phase Details"
  ];

  for (const phase of bmadPhases) {
    const answerEntries = Object.entries(answers[phase.id] ?? {});
    const questionLookup = new Map(phase.questions.map((q) => [q.id, q.prompt]));

    lines.push(`### ${phase.title}`);
    lines.push(phase.description);
    lines.push("");

    if (answerEntries.length) {
      lines.push("**Captured Responses**:");
      for (const [id, value] of answerEntries) {
        const prompt = questionLookup.get(id) ?? id;
        lines.push(`- **${prompt}**: ${value}`);
      }
      lines.push("");
    }

    if (phase.deliverables?.length) {
      lines.push("**Suggested Deliverables**:");
      for (const deliverable of phase.deliverables) {
        lines.push(`- ${deliverable}`);
      }
      lines.push("");
    }

    if (phase.followUps?.length) {
      lines.push("**Follow-up Prompts**:");
      for (const followUp of phase.followUps) {
        lines.push(`- ${followUp}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}

function generateCursorRules(answers: CollectedAnswers): string {
  const summary = renderSummary(answers).trim();
  const lines: string[] = [
    "# BMAD Project Context",
    "",
    "This project was scaffolded using the BMAD-METHOD (Brainstorm → Map → Assemble → Deploy).",
    "",
    "## Project Summary",
    "",
    summary,
    "",
    "## BMAD Phases",
    ""
  ];

  for (const phase of bmadPhases) {
    const answerEntries = Object.entries(answers[phase.id] ?? {});
    if (!answerEntries.length) {
      continue;
    }
    const questionLookup = new Map(phase.questions.map((q) => [q.id, q.prompt]));
    lines.push(`### ${phase.title}`);
    lines.push("");
    for (const [id, value] of answerEntries) {
      const prompt = questionLookup.get(id) ?? id;
      lines.push(`- **${prompt}**: ${value}`);
    }
    lines.push("");
  }

  lines.push("## Guidelines");
  lines.push("");
  lines.push("- Follow the BMAD delivery plan in `bmad/BMAD_PLAN.md`.");
  lines.push("- Track progress using `bmad/TASKS.todo.md`.");
  lines.push("- Consult `bmad/bmad-context.json` for structured project context.");
  lines.push("");

  return lines.join("\n").trim() + "\n";
}

function generateAntigravityRules(answers: CollectedAnswers): string {
  const summary = renderSummary(answers).trim();
  const lines: string[] = [
    "# BMAD Project Context",
    "",
    "This project was scaffolded using the BMAD-METHOD (Brainstorm → Map → Assemble → Deploy).",
    "",
    "## Project Summary",
    "",
    summary,
    "",
    "## Key References",
    "",
    "- Delivery plan: `bmad/BMAD_PLAN.md`",
    "- Structured context: `bmad/bmad-context.json`",
    "- Task checklist: `bmad/TASKS.todo.md`",
    "",
    "## Captured Decisions",
    ""
  ];

  for (const phase of bmadPhases) {
    const answerEntries = Object.entries(answers[phase.id] ?? {});
    if (!answerEntries.length) {
      continue;
    }
    const questionLookup = new Map(phase.questions.map((q) => [q.id, q.prompt]));
    lines.push(`### ${phase.title}`);
    lines.push("");
    for (const [id, value] of answerEntries) {
      const prompt = questionLookup.get(id) ?? id;
      lines.push(`- **${prompt}**: ${value}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function convertAnswersToTasks(answers: CollectedAnswers): string {
  const timestamp = new Date().toISOString();
  const lines: string[] = [
    "# BMAD Task Checklist",
    `Generated: ${timestamp}`,
    "",
    "- [ ] Review BMAD delivery plan and refine next steps"
  ];

  for (const phase of bmadPhases) {
    lines.push("");
    lines.push(`## ${phase.title}`);

    if (phase.checklist?.length) {
      for (const item of phase.checklist) {
        lines.push(`- [ ] ${item}`);
      }
    }

    const questionLookup = new Map(phase.questions.map((q) => [q.id, q.prompt]));
    for (const [id, value] of Object.entries(answers[phase.id] ?? {})) {
      if (!value || value === "(no answer)") {
        continue;
      }
      const prompt = questionLookup.get(id) ?? id;
      lines.push(`- [ ] Validate response for “${prompt}”: ${value}`);
    }

    if (phase.deliverables?.length) {
      lines.push("- [ ] Attach evidence for deliverables above");
    }
  }

  return lines.join("\n").trim() + "\n";
}

async function confirmOverwrite(files: vscode.Uri[]): Promise<boolean> {
  const existing: vscode.Uri[] = [];
  for (const file of files) {
    try {
      await vscode.workspace.fs.stat(file);
      existing.push(file);
    } catch {
      // file does not exist, ignore
    }
  }

  if (!existing.length) {
    return true;
  }

  const message = `BMAD scaffolding files already exist:\n${existing
    .map((file) => `• ${file.fsPath}`)
    .join("\n")}. Overwrite?`;
  const selection = await vscode.window.showWarningMessage(message, { modal: true }, "Overwrite");
  return selection === "Overwrite";
}

async function chooseTargetFolder(): Promise<vscode.Uri | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const defaultUri = workspaceFolders?.[0]?.uri;

  const result = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri,
    openLabel: "Select scaffolding destination"
  });

  if (result?.length) {
    return result[0];
  }

  return defaultUri;
}

export async function generateBmAdScaffolding(answers: CollectedAnswers): Promise<void> {
  const targetFolder = await chooseTargetFolder();
  if (!targetFolder) {
    if (!vscode.workspace.workspaceFolders?.length) {
      vscode.window.showWarningMessage(
        "Open a workspace folder before running BMAD scaffolding generation."
      );
      return;
    }
    vscode.window.showInformationMessage("Cancelled BMAD scaffolding generation.");
    return;
  }

  const outputDir = vscode.Uri.joinPath(targetFolder, "bmad");
  const planUri = vscode.Uri.joinPath(outputDir, "BMAD_PLAN.md");
  const contextUri = vscode.Uri.joinPath(outputDir, "bmad-context.json");
  const tasksUri = vscode.Uri.joinPath(outputDir, "TASKS.todo.md");

  // Cursor IDE config
  const cursorRulesDir = vscode.Uri.joinPath(targetFolder, ".cursor", "rules");
  const cursorRulesUri = vscode.Uri.joinPath(cursorRulesDir, "bmad-project-context.mdc");

  // Antigravity IDE config
  const agentsRulesDir = vscode.Uri.joinPath(targetFolder, ".agents", "rules");
  const agentsRulesUri = vscode.Uri.joinPath(agentsRulesDir, "bmad-project-context.md");

  const allFiles = [planUri, contextUri, tasksUri, cursorRulesUri, agentsRulesUri];
  const shouldProceed = await confirmOverwrite(allFiles);
  if (!shouldProceed) {
    vscode.window.showInformationMessage("Skipped overwriting existing BMAD scaffolding files.");
    return;
  }

  const artifacts: FileArtifact[] = [
    { uri: planUri, contents: convertAnswersToMarkdown(answers) },
    { uri: contextUri, contents: JSON.stringify(answers, null, 2) + "\n" },
    { uri: tasksUri, contents: convertAnswersToTasks(answers) },
    { uri: cursorRulesUri, contents: generateCursorRules(answers) },
    { uri: agentsRulesUri, contents: generateAntigravityRules(answers) }
  ];

  await vscode.workspace.fs.createDirectory(outputDir);
  await vscode.workspace.fs.createDirectory(cursorRulesDir);
  await vscode.workspace.fs.createDirectory(agentsRulesDir);
  for (const artifact of artifacts) {
    const directoryUri = vscode.Uri.file(path.dirname(artifact.uri.fsPath));
    await vscode.workspace.fs.createDirectory(directoryUri);
    await vscode.workspace.fs.writeFile(
      artifact.uri,
      Buffer.from(artifact.contents, "utf8")
    );
  }

  const doc = await vscode.workspace.openTextDocument(planUri);
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(
    `BMAD scaffolding created in ${outputDir.fsPath} (includes Cursor and Antigravity IDE configs)`
  );
}
