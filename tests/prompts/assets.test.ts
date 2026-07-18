import assert from "node:assert/strict";
import test from "node:test";
import {
  PROMPT_TEMPLATES,
  WRITING_POLICIES,
  getPromptAssetMetrics,
  loadPromptTemplate,
  loadWritingPolicy,
  resolveAllowlistedAssetPath,
} from "../../src/server/index";

test("every registered prompt and policy asset loads by allowlisted ID", () => {
  for (const prompt of PROMPT_TEMPLATES) {
    assert.ok(loadPromptTemplate(prompt.id).length > 20);
  }
  for (const policy of WRITING_POLICIES) {
    assert.ok(loadWritingPolicy(policy.id).length > 20);
  }
});

test("asset loader rejects unknown IDs and path traversal", () => {
  assert.throws(() => loadPromptTemplate("prompt.missing.v1"), /unknown/i);
  assert.throws(
    () => resolveAllowlistedAssetPath("prompts/../package.json"),
    /allowlisted|unsafe/i,
  );
  assert.throws(
    () => resolveAllowlistedAssetPath("/tmp/prompt.md"),
    /allowlisted|unsafe/i,
  );
});

test("runtime prompt assets stay compact and exclude upstream tooling prose", () => {
  const metrics = getPromptAssetMetrics();
  assert.equal(
    metrics.length,
    PROMPT_TEMPLATES.length + WRITING_POLICIES.length,
  );
  for (const metric of metrics) {
    assert.ok(metric.characters <= 8_000, `${metric.id} is too large`);
    assert.ok(
      metric.estimatedTokens <= 3_000,
      `${metric.id} token estimate is too large`,
    );
    const content =
      metric.kind === "prompt"
        ? loadPromptTemplate(metric.id)
        : loadWritingPolicy(metric.id);
    assert.doesNotMatch(
      content,
      /npx skills|(?:^|\s)\/humanizer(?:\s|$)|installation|version history|quality score/im,
    );
  }
});
