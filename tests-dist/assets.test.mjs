import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { copyRegisteredAssets } from "../scripts/copy-assets.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const externalDirectory = mkdtempSync(
  path.join(tmpdir(), "anvilnote-ai-writer-assets-"),
);
const requireFromOutside = createRequire(
  path.join(externalDirectory, "entry.cjs"),
);
const previousCwd = process.cwd();
let server;
try {
  process.chdir(externalDirectory);
  server = requireFromOutside(path.join(packageRoot, "dist/server/index.js"));
} finally {
  process.chdir(previousCwd);
}

after(() => rmSync(externalDirectory, { recursive: true, force: true }));

test("all registry assets load from dist outside the repository cwd", () => {
  for (const definition of server.PROMPT_TEMPLATES) {
    assert.ok(server.loadPromptTemplate(definition.id).length > 20);
  }
  for (const definition of server.WRITING_POLICIES) {
    assert.ok(server.loadWritingPolicy(definition.id).length > 20);
  }
});

test("npm package contains runtime assets and excludes sources and tests", () => {
  const cache = mkdtempSync(path.join(tmpdir(), "anvilnote-ai-writer-npm-"));
  try {
    const result = spawnSync(
      "npm",
      ["pack", "--dry-run", "--json", "--cache", cache],
      { cwd: packageRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout)[0];
    const paths = report.files.map((file) => file.path);
    for (const definition of [
      ...server.PROMPT_TEMPLATES,
      ...server.WRITING_POLICIES,
    ]) {
      assert.ok(
        paths.includes(`dist/${definition.assetPath}`),
        `${definition.assetPath} is missing from the package`,
      );
    }
    const expectedRuntimeAssets = [
      ...server.PROMPT_TEMPLATES,
      ...server.WRITING_POLICIES,
    ]
      .map((definition) => `dist/${definition.assetPath}`)
      .sort();
    const packagedRuntimeAssets = paths
      .filter((file) => /^dist\/(?:prompts|policies)\/.+\.md$/.test(file))
      .sort();
    assert.deepEqual(packagedRuntimeAssets, expectedRuntimeAssets);
    assert.ok(paths.includes("THIRD_PARTY_NOTICES.md"));
    assert.equal(
      paths.some((file) => file.startsWith("src/")),
      false,
    );
    assert.equal(
      paths.some((file) => file.startsWith("tests")),
      false,
    );
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test("asset copier ignores unregistered Markdown files", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "anvilnote-asset-copy-"));
  const sourceRoot = path.join(root, "source");
  const destinationRoot = path.join(root, "destination");
  const registeredPath = "prompts/common/system-v1.md";
  const privatePath = "prompts/common/private-notes.md";
  try {
    mkdirSync(path.join(sourceRoot, "prompts/common"), { recursive: true });
    writeFileSync(path.join(sourceRoot, registeredPath), "registered", "utf8");
    writeFileSync(path.join(sourceRoot, privatePath), "private", "utf8");

    await copyRegisteredAssets({
      sourceRoot,
      destinationRoot,
      assetPaths: [registeredPath],
    });

    assert.equal(
      readFileSync(path.join(destinationRoot, registeredPath), "utf8"),
      "registered",
    );
    assert.equal(existsSync(path.join(destinationRoot, privatePath)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("browser-safe output does not embed prompt or policy text", () => {
  const browserFiles = [
    "dist/index.js",
    "dist/contracts/index.js",
    "dist/document/index.js",
    "dist/pricing/index.js",
  ];
  for (const filename of browserFiles) {
    const source = readFileSync(path.join(packageRoot, filename), "utf8");
    assert.doesNotMatch(
      source,
      /AnvilNote writer system policy|natural-writing policy/,
    );
    assert.doesNotMatch(source, /node:fs|node:path/);
  }
});
