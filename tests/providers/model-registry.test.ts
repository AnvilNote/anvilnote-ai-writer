import assert from "node:assert/strict";
import test from "node:test";
import {
  getDefaultAIModel,
  getEnabledAIProviders,
  getProviderDefinition,
} from "../../src/index";

test("registry exposes only the enabled OpenAI provider", () => {
  const providers = getEnabledAIProviders();
  assert.deepEqual(
    providers.map((provider) => provider.id),
    ["openai"],
  );
});

test("OpenAI registry exposes exactly the three supported models", () => {
  const provider = getProviderDefinition("openai");
  assert.ok(provider);
  assert.deepEqual(
    provider.models.map((model) => model.id),
    ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  );
  assert.deepEqual(
    provider.models.map((model) => model.pricingId),
    ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  );
});

test("Terra is the only default model", () => {
  const provider = getProviderDefinition("openai");
  assert.ok(provider);
  assert.deepEqual(
    provider.models.filter((model) => model.isDefault).map((model) => model.id),
    ["gpt-5.6-terra"],
  );
  assert.equal(getDefaultAIModel("openai")?.id, "gpt-5.6-terra");
});
