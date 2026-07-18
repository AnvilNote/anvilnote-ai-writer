export interface TokenEstimate {
  inputTokens: number;
  estimatedOutputTokensMin: number;
  estimatedOutputTokensMax: number;
  confidence: "high" | "medium" | "low";
}

export interface TextTokenEstimate {
  tokens: number;
  confidence: "low";
}

export type TokenEstimationContentKind = "text" | "code" | "json-schema";

const TOKEN_PARTS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+|\r?\n|\s+|[^\s]/gu;

export function estimateTextTokens(
  text: string,
  kind: TokenEstimationContentKind = "text",
): TextTokenEstimate {
  if (text.length === 0) return { tokens: 0, confidence: "low" };
  let tokens = 0;
  for (const match of text.matchAll(TOKEN_PARTS)) {
    const part = match[0];
    if (
      /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(
        part,
      )
    ) {
      tokens += 1;
    } else if (part === "\n" || part === "\r\n") {
      tokens += 1;
    } else if (/^\s+$/u.test(part)) {
      tokens += Math.ceil(part.length / 12);
    } else if (/^[\p{L}\p{N}_]+$/u.test(part)) {
      tokens += Math.max(1, Math.ceil(part.length / (kind === "code" ? 3 : 4)));
    } else {
      tokens += kind === "json-schema" ? 1 : 0.75;
    }
  }
  return { tokens: Math.max(1, Math.ceil(tokens)), confidence: "low" };
}

export function createTokenEstimate(
  inputs: Array<{ text: string; kind?: TokenEstimationContentKind }>,
  outputRange: { minimum: number; maximum: number },
): TokenEstimate {
  if (
    !Number.isFinite(outputRange.minimum) ||
    !Number.isFinite(outputRange.maximum) ||
    outputRange.minimum < 0 ||
    outputRange.maximum < 0 ||
    outputRange.minimum > outputRange.maximum
  ) {
    throw new RangeError(
      "Output token range must be finite, non-negative, and ordered.",
    );
  }
  const inputTokens = inputs.reduce(
    (total, input) => total + estimateTextTokens(input.text, input.kind).tokens,
    0,
  );
  return {
    inputTokens,
    estimatedOutputTokensMin: Math.floor(outputRange.minimum),
    estimatedOutputTokensMax: Math.ceil(outputRange.maximum),
    confidence: "low",
  };
}
