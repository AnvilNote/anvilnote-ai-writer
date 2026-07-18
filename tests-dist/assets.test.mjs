import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createRequire } from "node:module";

const packageRoot = path.resolve(import.meta.dirname, "..");
const requireFromOutside = createRequire(
  path.join(
    mkdtempSync(path.join(tmpdir(), "anvilnote-ai-writer-assets-")),
    "entry.cjs",
  ),
);
const server = requireFromOutside(
  path.join(packageRoot, "dist/server/index.js"),
);

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
    assert.ok(paths.includes("dist/prompts/common/system-v1.md"));
    assert.ok(paths.includes("dist/policies/humanizer/en-v1.md"));
    assert.ok(paths.includes("dist/policies/humanizer/zh-TW-v1.md"));
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
