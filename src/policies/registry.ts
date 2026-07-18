import type { WritingPolicyDefinition } from "./metadata";

export const HUMANIZER_UPSTREAM_REVISIONS = {
  english: "1b48564898e999219882660237fde01bf4843a0f",
  traditionalChinese: "ef82d8c8eba3509d0830e8793ceb641b0fd8a174",
  traditionalChineseParent: "91f3d394db8419c20d67ebe22a96cf8fee0a404b",
  stopSlop: "8da1f030185bdfe8471220585162991eaeb970e9",
} as const;

export const WRITING_POLICIES = [
  {
    id: "policy.factual-integrity.v1",
    version: 1,
    assetPath: "policies/factual-integrity-v1.md",
    supportedLocales: ["*"],
    description:
      "Prevent unsupported facts, citations, quotations, and claims.",
  },
  {
    id: "policy.protected-content.v1",
    version: 1,
    assetPath: "policies/protected-content-v1.md",
    supportedLocales: ["*"],
    description: "Preserve protected placeholders exactly and fail closed.",
  },
  {
    id: "policy.style.academic-neutral.v1",
    version: 1,
    assetPath: "policies/academic-neutral-v1.md",
    supportedLocales: ["*"],
    description: "Use direct, objective language without invented personality.",
  },
  {
    id: "policy.style.natural-restrained.v1",
    version: 1,
    assetPath: "policies/styles/natural-restrained-v1.md",
    supportedLocales: ["*"],
    description:
      "Use natural cadence while keeping instructional material restrained.",
  },
  {
    id: "policy.style.natural.v1",
    version: 1,
    assetPath: "policies/styles/natural-v1.md",
    supportedLocales: ["*"],
    description: "Use natural cadence while preserving the requested voice.",
  },
  {
    id: "policy.style.preserve-source.v1",
    version: 1,
    assetPath: "policies/styles/preserve-source-v1.md",
    supportedLocales: ["*"],
    description: "Preserve the source voice, register, density, and viewpoint.",
  },
  {
    id: "policy.humanizer.core.v1",
    version: 1,
    assetPath: "policies/humanizer/core-v1.md",
    supportedLocales: ["*"],
    description:
      "Language-neutral rules that reduce formulaic writing patterns.",
  },
  {
    id: "policy.humanizer.en.v1",
    version: 1,
    assetPath: "policies/humanizer/en-v1.md",
    supportedLocales: ["en", "en-*"],
    description: "English natural-writing rules adapted for AnvilNote.",
    provenance: [
      {
        sourceName: "Humanizer",
        repository: "https://github.com/blader/humanizer",
        upstreamCommit: HUMANIZER_UPSTREAM_REVISIONS.english,
        license: "MIT",
      },
    ],
  },
  {
    id: "policy.humanizer.zh-TW.v1",
    version: 1,
    assetPath: "policies/humanizer/zh-TW-v1.md",
    supportedLocales: ["zh-TW", "zh-Hant", "zh-Hant-*"],
    description:
      "Taiwan Traditional Chinese natural-writing rules adapted for AnvilNote.",
    provenance: [
      {
        sourceName: "Humanizer-zh-TW",
        repository: "https://github.com/kevintsai1202/Humanizer-zh-TW",
        upstreamCommit: HUMANIZER_UPSTREAM_REVISIONS.traditionalChinese,
        license: "MIT",
      },
      {
        sourceName: "Humanizer",
        repository: "https://github.com/blader/humanizer",
        upstreamCommit: HUMANIZER_UPSTREAM_REVISIONS.english,
        license: "MIT",
      },
    ],
  },
] satisfies WritingPolicyDefinition[];

export function getWritingPolicy(
  id: string,
): WritingPolicyDefinition | undefined {
  return WRITING_POLICIES.find((definition) => definition.id === id);
}
