export type AccessMode = "read" | "workspace" | "full";

export const DEFAULT_ACCESS_MODE: AccessMode = "workspace";

export function describeAccessMode(mode: AccessMode): string {
  switch (mode) {
    case "read":
      return "Read-only (no file writes)";
    case "workspace":
      return "Workspace (can write inside the current workspace)";
    case "full":
      return "Full access (can modify any accessible path)";
    default:
      return mode;
  }
}
