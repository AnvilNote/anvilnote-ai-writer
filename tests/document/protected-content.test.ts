import assert from "node:assert/strict";
import test from "node:test";
import {
  ProtectedContentError,
  ProtectedContentRegistry,
} from "../../src/document/index";

test("formula, code, and URL placeholders restore exact content", () => {
  const registry = new ProtectedContentRegistry(
    "requestABC123",
    "Ordinary source text",
  );
  const formula = registry.protect("E = mc^2", {
    kind: "math",
    orderSensitive: true,
  });
  const code = registry.protect("const n = 7;", {
    kind: "code",
    orderSensitive: true,
  });
  const url = registry.protect("https://example.com/a?b=1", { kind: "url" });

  const restored = registry.validateAndRestore(`${formula}\n${code}\n${url}`);
  assert.equal(restored, "E = mc^2\nconst n = 7;\nhttps://example.com/a?b=1");
});

test("placeholder namespace collision is rejected", () => {
  assert.throws(
    () =>
      new ProtectedContentRegistry(
        "requestABC123",
        "{{ANVIL_PROTECTED_requestABC123_0001}}",
      ),
    ProtectedContentError,
  );
});

test("missing, duplicated, changed, and reordered placeholders fail closed", () => {
  const registry = new ProtectedContentRegistry("requestXYZ789", "source");
  const first = registry.protect("first", {
    kind: "identifier",
    orderSensitive: true,
  });
  const second = registry.protect("second", {
    kind: "identifier",
    orderSensitive: true,
  });

  for (const output of [
    first,
    `${first} ${first} ${second}`,
    `${first.replace("_0001", "_0099")} ${second}`,
    `${second} ${first}`,
  ]) {
    assert.throws(
      () => registry.validateAndRestore(output),
      ProtectedContentError,
    );
  }
});

test("an unknown placeholder in the same request namespace fails closed", () => {
  const registry = new ProtectedContentRegistry("requestNEW123", "source");
  const expected = registry.protect("expected", { kind: "node" });
  assert.throws(
    () =>
      registry.validateAndRestore(
        `${expected} {{ANVIL_PROTECTED_requestNEW123_0099}}`,
      ),
    ProtectedContentError,
  );
});
