import * as path from "path";
import * as vscode from "vscode";
import type { PhasePrompt } from "./bmadResources";

export interface PhaseResourceContent {
  phase: string;
  summary: string;
  guidelines?: string[];
  questions?: string[];
  checklist?: string[];
  deliverables?: string[];
  references?: string[];
}

async function readResource(relativePath: string, extensionUri: vscode.Uri): Promise<PhaseResourceContent | undefined> {
  const segments = relativePath.split("/").filter(Boolean);
  const resourceUri = vscode.Uri.joinPath(extensionUri, "dist", ...segments);

  try {
    const data = await vscode.workspace.fs.readFile(resourceUri);
    const text = Buffer.from(data).toString("utf8");
    return JSON.parse(text) as PhaseResourceContent;
  } catch (error) {
    console.warn(`Failed to load BMAD resource ${relativePath}`, error);
    return undefined;
  }
}

export async function loadPhaseResources(
  phase: PhasePrompt,
  extensionUri: vscode.Uri
): Promise<PhaseResourceContent[]> {
  const results: PhaseResourceContent[] = [];

  for (const resourcePath of phase.resources ?? []) {
    const resource = await readResource(resourcePath, extensionUri);
    if (resource) {
      results.push(resource);
    }
  }

  return results;
}

export function renderResourceMarkdown(
  phase: PhasePrompt,
  resources: PhaseResourceContent[]
): string | undefined {
  if (!resources.length) {
    return undefined;
  }

  const guidelines = new Set<string>();
  const deliverables = new Set<string>(phase.deliverables ?? []);
  const checklist = new Set<string>(phase.checklist ?? []);
  const questions = new Set<string>();
  const references = new Set<string>();

  for (const resource of resources) {
    resource.guidelines?.forEach((item) => guidelines.add(item));
    resource.deliverables?.forEach((item) => deliverables.add(item));
    resource.checklist?.forEach((item) => checklist.add(item));
    resource.questions?.forEach((item) => questions.add(item));
    resource.references?.forEach((item) => references.add(item));
  }

  const lines: string[] = [`### ${phase.title} guidance`];
  if (guidelines.size) {
    lines.push("**Guidelines:**");
    guidelines.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  if (questions.size) {
    lines.push("**Reflection prompts:**");
    questions.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  if (deliverables.size) {
    lines.push("**Deliverables to produce:**");
    deliverables.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  if (checklist.size) {
    lines.push("**Checklist:**");
    checklist.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  if (references.size) {
    lines.push("**References:**");
    references.forEach((ref) => lines.push(`- ${ref}`));
    lines.push("");
  }

  return lines.join("\n").trim();
}
