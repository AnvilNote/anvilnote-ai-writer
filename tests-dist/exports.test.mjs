import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

function resolveRelativeModule(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, path.join(base, "index.js")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
}

async function readReachableJavaScript(entryFiles) {
  const pending = [...entryFiles];
  const visited = new Set();
  const sources = [];
  const externalSpecifiers = new Set();
  while (pending.length > 0) {
    const filename = pending.pop();
    if (!filename || visited.has(filename)) continue;
    visited.add(filename);
    const source = await readFile(filename, "utf8");
    sources.push(source);
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const specifier = match[1];
      if (!specifier) continue;
      if (specifier.startsWith(".")) {
        pending.push(resolveRelativeModule(filename, specifier));
      } else {
        externalSpecifiers.add(specifier);
      }
    }
  }
  return {
    source: sources.join("\n"),
    externalSpecifiers: [...externalSpecifiers],
    files: [...visited],
  };
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
  const graph = await readReachableJavaScript([
    path.join(packageRoot, "dist/index.js"),
    path.join(packageRoot, "dist/contracts/index.js"),
    path.join(packageRoot, "dist/document/index.js"),
    path.join(packageRoot, "dist/pricing/index.js"),
  ]);
  for (const specifier of graph.externalSpecifiers) {
    assert.equal(specifier.startsWith("node:"), false);
    assert.equal(builtinModules.includes(specifier), false);
    assert.equal(
      specifier === "openai" || specifier.startsWith("openai/"),
      false,
    );
  }
  assert.equal(
    graph.files.some((file) => file.includes(`${path.sep}server${path.sep}`)),
    false,
  );
  for (const forbidden of [/[/\\](prompts|policies)[/\\]/, /\.md["']/]) {
    assert.doesNotMatch(graph.source, forbidden);
  }
});
