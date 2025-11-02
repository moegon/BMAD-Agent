#!/usr/bin/env node
const path = require("path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  try {
    process.env.ELECTRON_DISABLE_SANDBOX = "1";
    const extensionDevelopmentPath = path.resolve(__dirname, "../");
    const extensionTestsPath = path.resolve(__dirname, "../dist/test/suite");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        path.resolve(__dirname, "../sample-workspace"),
        "--disable-extensions",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-setuid-sandbox"
      ]
    });
  } catch (error) {
    console.error("Smoke test failed", error);
    process.exit(1);
  }
}

main();
