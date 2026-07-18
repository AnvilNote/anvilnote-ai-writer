import assert from "node:assert/strict";
import test from "node:test";
import {
  ProtectedContentError,
  ProtectedContentRegistry,
} from "../../src/document/index";

test("formula, code, and URL placeholders restore exact content", () => {
  const registry = ProtectedContentRegistry.create("Ordinary source text");
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
      ProtectedContentRegistry.create(
        "{{ANVIL_PROTECTED_existingNamespace_0001}}",
      ),
    ProtectedContentError,
  );
});

test("each registry generates a distinct cryptographic namespace", () => {
  const first = ProtectedContentRegistry.create("source one").protect("value", {
    kind: "node",
  });
  const second = ProtectedContentRegistry.create("source two").protect(
    "value",
    {
      kind: "node",
    },
  );
  assert.notEqual(first, second);
});

test("missing, duplicated, changed, and reordered placeholders fail closed", () => {
  const registry = ProtectedContentRegistry.create("source");
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
  const registry = ProtectedContentRegistry.create("source");
  const expected = registry.protect("expected", { kind: "node" });
  const namespacePrefix = expected.slice(0, expected.lastIndexOf("_") + 1);
  assert.throws(
    () => registry.validateAndRestore(`${expected} ${namespacePrefix}0099}}`),
    ProtectedContentError,
  );
});

test("structured output restores placeholders without serializing through JSON text", () => {
  const registry = ProtectedContentRegistry.create("source");
  const formula = registry.protect("E = mc^2", {
    kind: "math",
    orderSensitive: true,
  });
  const url = registry.protect('https://example.com/a?x="quoted"', {
    kind: "url",
  });
  assert.deepEqual(
    registry.validateAndRestoreStructured({
      replacement: {
        content: [
          { type: "text", text: `Keep ${formula}.` },
          { type: "text", text: url },
        ],
      },
    }),
    {
      replacement: {
        content: [
          { type: "text", text: "Keep E = mc^2." },
          { type: "text", text: 'https://example.com/a?x="quoted"' },
        ],
      },
    },
  );
});

test("structured output fails closed when a protected placeholder is missing", () => {
  const registry = ProtectedContentRegistry.create("source");
  registry.protect("const value = 1;", { kind: "code" });
  assert.throws(
    () => registry.validateAndRestoreStructured({ text: "placeholder lost" }),
    ProtectedContentError,
  );
});
