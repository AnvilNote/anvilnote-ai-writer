import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseFormatTextJSONSchemaConfig } from "openai/resources/responses/responses";
import {
  OpenAIComposePayloadV1Schema,
  OpenAIRewritePayloadV1Schema,
  type OpenAIWriterOutputSchemaId,
} from "./openai-model-payload";

// NOTE: getOpenAIModelPayloadFormat below does NOT statically import
// openai-edit-operations-schema.ts, even though that module is the third
// arm of OpenAIWriterOutputSchemaId — openai-edit-operations-schema.ts
// itself imports `validateOpenAIStrictSchema` FROM this file (to reuse the
// real budget-check logic rather than forking it), so importing it back
// here would create a circular module dependency (verified empirically:
// it throws "Cannot access 'OMITTED_SDK_SCHEMA_KEYWORDS' before
// initialization" at runtime, a real TDZ failure, not a hypothetical one).
// build-openai-request.ts — the ONLY caller of this function — instead
// imports openai-edit-operations-schema.ts's precomputed format directly
// and branches on the edit-operations id BEFORE ever calling this
// function, so this function is only ever invoked for the original two
// ids. See build-openai-request.ts's own comment for the other half of
// this judgment call.

const SUPPORTED_STRICT_KEYWORDS = new Set([
  "$defs",
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "definitions",
  "description",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxItems",
  "maximum",
  "minItems",
  "minimum",
  "multipleOf",
  "pattern",
  "properties",
  "required",
  "type",
]);

const OMITTED_SDK_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "maxLength",
  "minLength",
]);

export interface OpenAIStrictSchemaMetrics {
  propertyCount: number;
  maximumNestingDepth: number;
}

export function sanitizeOpenAIStrictSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !OMITTED_SDK_SCHEMA_KEYWORDS.has(key))
        .map(([key, nested]) => [key, sanitize(nested)]),
    );
  };
  return sanitize(schema) as Record<string, unknown>;
}

export function validateOpenAIStrictSchema(
  schema: Record<string, unknown>,
): OpenAIStrictSchemaMetrics {
  if (schema.type !== "object") {
    throw new Error("OpenAI strict output schema root must be an object.");
  }
  if ("anyOf" in schema) {
    throw new Error("OpenAI strict output schema root cannot use anyOf.");
  }

  let propertyCount = 0;
  let maximumNestingDepth = 0;
  const seen = new Set<object>();

  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    maximumNestingDepth = Math.max(maximumNestingDepth, depth);

    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth);
      return;
    }

    const record = value as Record<string, unknown>;
    for (const keyword of Object.keys(record)) {
      if (!SUPPORTED_STRICT_KEYWORDS.has(keyword)) {
        throw new Error(
          `OpenAI strict output schema contains unsupported keyword: ${keyword}`,
        );
      }
    }

    const properties = record.properties;
    if (
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties)
    ) {
      const propertyNames = Object.keys(properties);
      propertyCount += propertyNames.length;
      if (record.additionalProperties !== false) {
        throw new Error(
          "Every OpenAI strict object must set additionalProperties to false.",
        );
      }
      const required = Array.isArray(record.required)
        ? record.required.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      if (
        required.length !== propertyNames.length ||
        propertyNames.some((name) => !required.includes(name))
      ) {
        throw new Error(
          "Every OpenAI strict object property must be required.",
        );
      }
      for (const property of Object.values(properties)) {
        visit(property, depth + 1);
      }
    }
    for (const definitionsKey of ["$defs", "definitions"] as const) {
      const definitions = record[definitionsKey];
      if (
        definitions &&
        typeof definitions === "object" &&
        !Array.isArray(definitions)
      ) {
        for (const definition of Object.values(definitions)) {
          visit(definition, depth);
        }
      }
    }
    if (record.items) visit(record.items, depth + 1);
    if (Array.isArray(record.anyOf)) {
      for (const variant of record.anyOf) visit(variant, depth);
    }
  };

  visit(schema, 1);
  if (propertyCount > 5_000) {
    throw new Error("OpenAI strict output schema exceeds 5,000 properties.");
  }
  if (maximumNestingDepth > 10) {
    throw new Error("OpenAI strict output schema exceeds 10 nesting levels.");
  }
  return { propertyCount, maximumNestingDepth };
}

export function getOpenAIModelPayloadFormat(
  outputSchemaId: OpenAIWriterOutputSchemaId,
): ResponseFormatTextJSONSchemaConfig {
  // anvilnote.ai.edit-operations.v1 is handled entirely by
  // build-openai-request.ts BEFORE this function is ever called (see the
  // comment above the imports for why: avoiding a circular module
  // dependency with openai-edit-operations-schema.ts). Fail loudly rather
  // than silently falling through to the rewrite branch below if that
  // invariant is ever violated.
  if (outputSchemaId === "anvilnote.ai.edit-operations.v1") {
    throw new Error(
      "getOpenAIModelPayloadFormat does not handle anvilnote.ai.edit-operations.v1 directly — callers must use openai-edit-operations-schema.ts's precomputed format instead.",
    );
  }

  const generated =
    outputSchemaId === "anvilnote.ai.compose-result.v1"
      ? zodTextFormat(
          OpenAIComposePayloadV1Schema,
          "anvilnote_compose_payload_v1",
        )
      : zodTextFormat(
          OpenAIRewritePayloadV1Schema,
          "anvilnote_rewrite_payload_v1",
        );
  const schema = sanitizeOpenAIStrictSchema(generated.schema);
  validateOpenAIStrictSchema(schema);

  // Do not return the helper's hidden `$parseRaw` hook. OpenAI strict mode
  // supports a smaller JSON-Schema subset than the local Zod contract, so the
  // transmitted schema intentionally omits constraints such as minLength.
  // Let the SDK JSON.parse the payload first, then run our explicit
  // normalization and full local Zod/semantic validation in
  // parseOpenAIModelPayload().
  return {
    type: "json_schema",
    name: generated.name,
    strict: true,
    schema,
    ...(generated.description ? { description: generated.description } : {}),
  };
}
