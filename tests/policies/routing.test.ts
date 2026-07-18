import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveHumanizerLanguage,
  resolveWritingStyle,
  selectWritingPolicyIds,
} from "../../src/server/index";

test("auto writing style follows document type and rewrite context", () => {
  for (const documentType of ["academic", "legal", "technical", "reference"]) {
    assert.equal(
      resolveWritingStyle({
        writingStyle: "auto",
        documentType,
        intent: "compose",
      }),
      "neutral",
    );
  }
  assert.equal(
    resolveWritingStyle({
      writingStyle: "auto",
      documentType: "teaching-handout",
      intent: "compose",
    }),
    "natural-restrained",
  );
  assert.equal(
    resolveWritingStyle({
      writingStyle: "auto",
      documentType: "blog",
      intent: "compose",
    }),
    "natural",
  );
  assert.equal(
    resolveWritingStyle({
      writingStyle: "auto",
      documentType: "academic",
      intent: "rewrite-selection",
    }),
    "preserve-source",
  );
});

test("an explicit writing style overrides automatic routing", () => {
  assert.equal(
    resolveWritingStyle({
      writingStyle: "neutral",
      documentType: "blog",
      intent: "compose",
    }),
    "neutral",
  );
  assert.equal(
    resolveWritingStyle({
      writingStyle: "natural",
      documentType: "legal",
      intent: "compose",
    }),
    "natural",
  );
});

test("language routing prefers an explicit output locale", () => {
  assert.deepEqual(
    resolveHumanizerLanguage({
      requestLocale: "en-US",
      requestedOutputLocale: "zh-TW",
      contentSamples: ["English source with 中文內容."],
    }),
    {
      requestedLocale: "zh-TW",
      language: "zh-TW",
      policyId: "policy.humanizer.zh-TW.v1",
      fallback: false,
      mixedContent: true,
      preserveOtherLanguages: true,
    },
  );
});

test("language routing handles English and unsupported locales deterministically", () => {
  assert.equal(
    resolveHumanizerLanguage({ requestLocale: "en-US" }).policyId,
    "policy.humanizer.en.v1",
  );
  assert.deepEqual(resolveHumanizerLanguage({ requestLocale: "fr-FR" }), {
    requestedLocale: "fr-FR",
    language: "general",
    policyId: "policy.humanizer.core.v1",
    fallback: true,
    mixedContent: false,
    preserveOtherLanguages: false,
  });
});

test("disabling Humanizer keeps factual and protected policies", () => {
  const basePolicyIds = [
    "policy.factual-integrity.v1",
    "policy.protected-content.v1",
  ];
  const disabled = selectWritingPolicyIds({
    basePolicyIds,
    resolvedStyle: "neutral",
    humanizerEnabled: false,
    languageRoute: resolveHumanizerLanguage({ requestLocale: "zh-TW" }),
  });
  assert.deepEqual(disabled, [
    ...basePolicyIds,
    "policy.style.academic-neutral.v1",
  ]);
  assert.equal(
    disabled.some((id) => id.includes("humanizer")),
    false,
  );

  const enabled = selectWritingPolicyIds({
    basePolicyIds,
    resolvedStyle: "preserve-source",
    humanizerEnabled: true,
    languageRoute: resolveHumanizerLanguage({ requestLocale: "en-US" }),
  });
  assert.deepEqual(enabled, [
    ...basePolicyIds,
    "policy.style.preserve-source.v1",
    "policy.humanizer.en.v1",
  ]);
});
