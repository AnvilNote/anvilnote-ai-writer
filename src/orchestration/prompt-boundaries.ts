import { createHash } from "node:crypto";

export interface PromptBoundaryInput {
  requestId: string;
  label: string;
  contents: readonly string[];
}

export function createPromptBoundary({
  requestId,
  label,
  contents,
}: PromptBoundaryInput): string {
  const digest = createHash("sha256")
    .update(`${requestId}\0${label}`)
    .digest("hex")
    .slice(0, 20);
  for (let counter = 0; counter < 10_000; counter += 1) {
    const candidate = `ANVIL_BOUNDARY_${digest}_${counter}`;
    if (contents.every((content) => !content.includes(candidate))) {
      return candidate;
    }
  }
  throw new Error("Unable to create a collision-free prompt boundary.");
}

export type UntrustedPromptDataKind =
  | "ATTACHMENT"
  | "CONTEXT"
  | "CONVERSATION_HISTORY"
  | "CURRENT_DOCUMENT"
  | "INSTRUCTION"
  | "SELECTION";

export interface WrapUntrustedPromptDataInput {
  requestId: string;
  label: string;
  kind: UntrustedPromptDataKind;
  content: string;
  metadata?: Record<string, unknown>;
}

export function wrapUntrustedPromptData({
  requestId,
  label,
  kind,
  content,
  metadata,
}: WrapUntrustedPromptDataInput): string {
  const metadataText = metadata ? JSON.stringify(metadata) : "";
  const boundary = createPromptBoundary({
    requestId,
    label,
    contents: [metadataText, content],
  });
  const startTag = `<ANVIL_UNTRUSTED_${kind} boundary="${boundary}">`;
  const endTag = `</ANVIL_UNTRUSTED_${kind} boundary="${boundary}">`;
  return [startTag, metadataText, content, endTag].filter(Boolean).join("\n");
}
