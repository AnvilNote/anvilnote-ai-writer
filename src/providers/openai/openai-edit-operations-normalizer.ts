import { parseEditOperationsV1, type AiEditOperationsResultV1 } from "../../edits/edit-operations-v1";

// Normalizes the OpenAI wire shape produced against
// OPENAI_EDIT_OPERATIONS_SCHEMA (openai-edit-operations-schema.ts) back into
// a real AiEditOperationsResultV1 by calling parseEditOperationsV1 — the
// canonical parser from Task 21.1 — never re-implementing its validation.
//
// --- The nullable-for-optional convention, and its three exceptions ------
// OpenAI strict Structured Outputs has no notion of an optional property:
// every property must be `required`, so every canonically OPTIONAL field is
// represented on the wire as a REQUIRED field whose value may be `null`
// ("this field was not supplied"). `stripWireNulls` below walks the entire
// parsed JSON value and deletes every null-valued key, which is exactly
// equivalent to "the caller omitted this optional field" for every
// canonically optional field in this package's v2 AST.
//
// Three fields break that equivalence, because they are REQUIRED-BUT-
// NULLABLE in the real canonical schema (not optional at all — the key must
// be present, but its value may legitimately be `null`):
//   - callout.attrs.title           (AiCalloutNodeV2)
//   - questionItem.attrs.writtenHeightCm (AiQuestionItemAttrsV2)
//   - textStyle mark's attrs.color  (AiTextStyleMarkV2)
// For these three, deleting a `null` value would leave the key entirely
// ABSENT, which the real (`.strict()`, not `.partial()`) schema rejects as
// a MISSING required property. `stripWireNulls` special-cases exactly these
// three (keyed on the node/mark's own `type` — see below for why this is
// unambiguous) and restores the literal `null` after the generic strip.
//
// This restoration is deliberately keyed on the FULL node/mark's own `type`
// field (`"callout"`, `"questionItem"`, `"textStyle"`), which is what makes
// it safe to run the exact same generic walk over `updateAttrs` PATCH
// payloads too: a patch's outer operation object always has
// `type: "updateAttrs"` with the actual target kind carried in a SIBLING
// `nodeType` field, never as the object's own `type` — so this restoration
// never fires inside a patch, which is correct: on a PATCH, every field
// (including title/writtenHeightCm/color) is optional by definition
// (`Partial<...>` in edit-operations-v1.ts), so wire `null` there uniformly
// means "leave this field untouched". This is a real, intentional
// limitation worth documenting explicitly: a model can never use
// `updateAttrs` to explicitly CLEAR title/writtenHeightCm/color back to
// `null` — only `replaceNode` (supplying a brand new full node) can do
// that. See this task's final report for this judgment call.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const REQUIRED_NULLABLE_ATTR_BY_NODE_TYPE: Readonly<Record<string, string>> = {
  callout: "title",
  questionItem: "writtenHeightCm",
  textStyle: "color",
};

function stripWireNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripWireNulls);
  if (!isPlainRecord(value)) return value;

  const stripped: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested === null) continue;
    stripped[key] = stripWireNulls(nested);
  }

  const preservedAttrKey =
    typeof value.type === "string" ? REQUIRED_NULLABLE_ATTR_BY_NODE_TYPE[value.type] : undefined;
  if (preservedAttrKey && isPlainRecord(value.attrs) && value.attrs[preservedAttrKey] === null) {
    const strippedAttrs = isPlainRecord(stripped.attrs) ? stripped.attrs : {};
    stripped.attrs = { ...strippedAttrs, [preservedAttrKey]: null };
  }

  return stripped;
}

// OpenAI strict Structured Outputs has no minLength either, so an OPTIONAL
// string identifier (localRef/refName — every other required identifier
// stays fail-closed) can legally come back as `""` instead of being
// omitted. Mirrors openai-model-payload.ts's own
// `normalizeEmptyNullableIdentifiers` convention: fold an empty/whitespace
// identifier into `null` BEFORE the generic strip above, so it collapses to
// "field omitted" exactly like an explicit `null` would.
const NULLABLE_STRING_IDENTIFIER_KEYS = new Set(["localRef", "refName"]);

function normalizeEmptyIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeEmptyIdentifiers);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      NULLABLE_STRING_IDENTIFIER_KEYS.has(key) && typeof nested === "string" && nested.trim().length === 0
        ? null
        : normalizeEmptyIdentifiers(nested),
    ]),
  );
}

// Expands the flattened wire "question" node (see
// openai-edit-operations-schema.ts's own header comment: mirrors
// openai-model-payload.ts's `expandProviderQuestionWire` exactly) back into
// the real, nested `question > questionItem > choiceList > choiceItem`
// shape parseEditOperationsV1/the v2 canonical schemas expect. Runs BEFORE
// stripWireNulls so the resulting real `questionItem` node's own `type`
// field is in place in time for the required-nullable-preserve check above
// to see it.
function expandWireQuestionNodes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandWireQuestionNodes);
  if (!isPlainRecord(value)) return value;

  if (value.type === "question" && Array.isArray(value.body)) {
    const choices = Array.isArray(value.choices) ? value.choices : null;
    return {
      type: "question",
      content: [
        {
          type: "questionItem",
          attrs: {
            kind: value.kind,
            writtenMode: value.writtenMode,
            writtenLines: value.writtenLines,
            writtenHeightPercent: value.writtenHeightPercent,
            writtenHeightCm: value.writtenHeightCm,
            multiForceOneColumn: value.multiForceOneColumn,
            localRef: value.localRef,
          },
          content: [
            ...value.body.map(expandWireQuestionNodes),
            ...(choices === null
              ? []
              : [
                  {
                    type: "choiceList",
                    content: choices.map((choice) => ({
                      type: "choiceItem",
                      content: [expandWireQuestionNodes(choice)],
                    })),
                  },
                ]),
          ],
        },
      ],
    };
  }

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, expandWireQuestionNodes(nested)]));
}

export function normalizeOpenAiEditOperations(value: unknown): AiEditOperationsResultV1 {
  const withEmptyIdentifiersNormalized = normalizeEmptyIdentifiers(value);
  const withQuestionsExpanded = expandWireQuestionNodes(withEmptyIdentifiersNormalized);
  const withNullsStripped = stripWireNulls(withQuestionsExpanded);
  return parseEditOperationsV1(withNullsStripped);
}
