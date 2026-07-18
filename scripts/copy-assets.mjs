import { copyFile, mkdir, readdir, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function validateRegisteredAssetPath(assetPath) {
  if (
    path.isAbsolute(assetPath) ||
    assetPath.includes("\\") ||
    !/^(?:prompts|policies)\/[A-Za-z0-9][A-Za-z0-9./-]*\.md$/.test(assetPath)
  ) {
    throw new Error(`Build asset path is not allowlisted: ${assetPath}`);
  }
  const normalized = path.posix.normalize(assetPath);
  if (normalized !== assetPath || normalized.includes("..")) {
    throw new Error(`Build asset path is unsafe: ${assetPath}`);
  }
  return normalized;
}

async function removeMarkdownFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await removeMarkdownFiles(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        await unlink(entryPath);
      }
    }),
  );
}

export async function copyRegisteredAssets({
  sourceRoot,
  destinationRoot,
  assetPaths,
}) {
  const registeredPaths = [
    ...new Set(assetPaths.map(validateRegisteredAssetPath)),
  ];
  await Promise.all(
    ["prompts", "policies"].map((directory) =>
      removeMarkdownFiles(path.join(destinationRoot, directory)),
    ),
  );

  for (const assetPath of registeredPaths) {
    const source = path.join(sourceRoot, ...assetPath.split("/"));
    const destination = path.join(destinationRoot, ...assetPath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await copyFile(source, destination);
    } catch (error) {
      throw new Error(`Registered build asset is missing: ${assetPath}`, {
        cause: error,
      });
    }
  }
}

async function main() {
  const require = createRequire(import.meta.url);
  const { PROMPT_TEMPLATES } = require("../dist/prompts/registry.js");
  const { WRITING_POLICIES } = require("../dist/policies/registry.js");
  await copyRegisteredAssets({
    sourceRoot: fileURLToPath(new URL("../src/", import.meta.url)),
    destinationRoot: fileURLToPath(new URL("../dist/", import.meta.url)),
    assetPaths: [...PROMPT_TEMPLATES, ...WRITING_POLICIES].map(
      (definition) => definition.assetPath,
    ),
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await main();
