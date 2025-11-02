import * as assert from "assert";
import * as vscode from "vscode";

describe("BMAD Chat Participant", () => {
  it("registers BMAD commands", async () => {
    const extension = vscode.extensions.getExtension("bmad-code-org.bmad-agent");
    assert.ok(extension, "Extension should be discoverable");
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("bmad.generateScaffolding"),
      "Expected bmad.generateScaffolding command to be registered"
    );
    assert.ok(
      commands.includes("bmad.refinePhase"),
      "Expected bmad.refinePhase command to be registered"
    );
  });
});
