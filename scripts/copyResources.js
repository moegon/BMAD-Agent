#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const sourceDir = path.resolve(__dirname, "../src/resources");
const targetDir = path.resolve(__dirname, "../dist/resources");

async function copyDirectory(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

(async () => {
  try {
    await copyDirectory(sourceDir, targetDir);
    console.log(`Copied resources to ${targetDir}`);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn("No resources directory found to copy.");
      return;
    }
    console.error("Failed to copy resources", error);
    process.exit(1);
  }
})();
