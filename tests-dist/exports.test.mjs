import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const packageRequire = createRequire(path.join(packageRoot, "package.json"));
const publicSpecifiers = [
  "@anvilnote/ai-writer",
  "@anvilnote/ai-writer/contracts",
  "@anvilnote/ai-writer/document",
  "@anvilnote/ai-writer/pricing",
  "@anvilnote/ai-writer/server",
];

async function readJavaScriptTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory())
      contents.push(...(await readJavaScriptTree(entryPath)));
    else if (entry.name.endsWith(".js"))
      contents.push(await readFile(entryPath, "utf8"));
  }
  return contents.join("\n");
}

test("all declared package exports load from dist outside the repository cwd", () => {
  const previousCwd = process.cwd();
  process.chdir(tmpdir());
  try {
    for (const specifier of publicSpecifiers) {
      const resolved = packageRequire.resolve(specifier);
      assert.match(resolved, /[/\\]dist[/\\]/);
      assert.doesNotThrow(() => packageRequire(specifier));
    }
  } finally {
    process.chdir(previousCwd);
  }
});

test("package export map never resolves source files", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  assert.doesNotMatch(JSON.stringify(packageJson.exports), /src[/\\]/);
});

test("browser-safe output has no server, OpenAI, Markdown, or Node-only imports", async () => {
  const safeOutput = await Promise.all([
    readFile(path.join(packageRoot, "dist/index.js"), "utf8"),
    readJavaScriptTree(path.join(packageRoot, "dist/contracts")),
    readJavaScriptTree(path.join(packageRoot, "dist/document")),
    readJavaScriptTree(path.join(packageRoot, "dist/pricing")),
    readJavaScriptTree(path.join(packageRoot, "dist/providers")),
  ]);
  const bundledText = safeOutput.join("\n");
  const requiredSpecifiers = Array.from(
    bundledText.matchAll(/require\(["']([^"']+)["']\)/g),
    (match) => match[1],
  );
  for (const specifier of requiredSpecifiers) {
    assert.equal(specifier.startsWith("node:"), false);
    assert.equal(builtinModules.includes(specifier), false);
  }
  for (const forbidden of [
    /require\(["']openai["']\)/,
    /require\(["']node:/,
    /[/\\]server[/\\]/,
    /[/\\](prompts|policies)[/\\]/,
    /\.md["']/,
  ]) {
    assert.doesNotMatch(bundledText, forbidden);
  }
});
