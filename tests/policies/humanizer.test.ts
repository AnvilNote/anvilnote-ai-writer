import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  HUMANIZER_UPSTREAM_REVISIONS,
  WRITING_POLICIES,
  loadWritingPolicy,
} from "../../src/server/index";

test("factual integrity covers unsupported facts and preserves source meaning", () => {
  const policy = loadWritingPolicy("policy.factual-integrity.v1");
  for (const requirement of [
    "sources",
    "authors",
    "years",
    "statistics",
    "direct quotations",
    "attachment",
    "warnings",
    "preserve the original meaning",
    "numbers",
    "dates",
    "proper names",
  ]) {
    assert.match(policy.toLowerCase(), new RegExp(requirement));
  }
});

test("protected-content policy requires exact placeholder preservation", () => {
  const policy = loadWritingPolicy("policy.protected-content.v1");
  for (const requirement of [
    "verbatim",
    "translate",
    "rewrite",
    "delete",
    "duplicate",
    "reorder",
    "create",
    "guess",
  ]) {
    assert.match(policy.toLowerCase(), new RegExp(requirement));
  }
});

test("English Humanizer reduces formulaic patterns without forcing personality", () => {
  const policy = loadWritingPolicy("policy.humanizer.en.v1");
  for (const requirement of [
    "promotional",
    "vague attribution",
    "rule of three",
    "negative parallelism",
    "filler",
    "generic conclusion",
    "chatbot",
    "manufactured punchline",
    "first person",
    "technical",
    "legal",
    "academic",
  ]) {
    assert.match(policy.toLowerCase(), new RegExp(requirement));
  }
  assert.match(policy, /do not require(?: or add)? first person/i);
  assert.doesNotMatch(policy, /bypass|undetectable|AI detector/i);
});

test("zh-TW Humanizer uses Taiwan terminology without inventing a personal voice", () => {
  const policy = loadWritingPolicy("policy.humanizer.zh-TW.v1");
  for (const requirement of [
    "台灣繁體中文",
    "空泛",
    "誇張",
    "模糊歸因",
    "此外",
    "綜上所述",
    "三段式",
    "否定式排比",
    "同義詞",
    "小標題",
    "粗體",
    "破折號",
    "第一人稱",
    "學術",
    "設定",
    "檔案",
    "連線",
    "資訊",
    "智慧模式",
    "儲存",
    "產生",
  ]) {
    assert.match(policy, new RegExp(requirement));
  }
  assert.doesNotMatch(policy, /請配置|提供信息|智能模式/);
  assert.doesNotMatch(policy, /繞過.*偵測|保證.*真人/);
});

test("Humanizer provenance records exact MIT-licensed upstream revisions", () => {
  const english = WRITING_POLICIES.find(
    (definition) => definition.id === "policy.humanizer.en.v1",
  );
  const traditionalChinese = WRITING_POLICIES.find(
    (definition) => definition.id === "policy.humanizer.zh-TW.v1",
  );
  assert.equal(
    english?.provenance?.[0]?.upstreamCommit,
    HUMANIZER_UPSTREAM_REVISIONS.english,
  );
  assert.equal(
    traditionalChinese?.provenance?.[0]?.upstreamCommit,
    HUMANIZER_UPSTREAM_REVISIONS.traditionalChinese,
  );
  assert.ok(
    [
      ...(english?.provenance ?? []),
      ...(traditionalChinese?.provenance ?? []),
    ].every((source) => source.license === "MIT"),
  );

  const notices = readFileSync(path.resolve("THIRD_PARTY_NOTICES.md"), "utf8");
  for (const value of [
    "blader/humanizer",
    HUMANIZER_UPSTREAM_REVISIONS.english,
    "kevintsai1202/Humanizer-zh-TW",
    HUMANIZER_UPSTREAM_REVISIONS.traditionalChinese,
    "op7418/Humanizer-zh",
    HUMANIZER_UPSTREAM_REVISIONS.traditionalChineseParent,
    "hardikpandya/stop-slop",
    HUMANIZER_UPSTREAM_REVISIONS.stopSlop,
    "Copyright (c) 2025 Siqi Chen",
    "Copyright (c) 2026 歸藏",
  ]) {
    assert.match(
      notices,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});
