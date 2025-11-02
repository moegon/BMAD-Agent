import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    process.env.ELECTRON_DISABLE_SANDBOX = "1";
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        "--disable-extensions",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-setuid-sandbox"
      ]
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

main();
