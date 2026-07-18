import { z } from "zod";
import {
  AnvilNoteDocumentFragmentV1Schema,
  AnvilNoteDocumentV1Schema,
  type AnvilNoteDocumentFragmentV1,
  type AnvilNoteDocumentV1,
} from "../document/index";
import {
  AI_ATTACHMENT_LIMITS,
  type AttachmentContext,
} from "./attachment-context";
import type { AIProviderCredential } from "./provider";
import type { AIWriterIntent, WritingStyle } from "./writer-intent";

export interface AIWriterRequest {
  requestId: string;
  intent: AIWriterIntent;
  provider: {
    id: string;
    model: string;
  };
  instruction: string;
  context: {
    locale: string;
    documentType?: string;
    writingStyle: WritingStyle;
    currentDocument?: AnvilNoteDocumentV1;
    selectedContent?: AnvilNoteDocumentFragmentV1;
    attachments?: AttachmentContext[];
  };
  options: {
    humanizerEnabled: boolean;
    maxOutputTokens?: number;
  };
}

const attachmentContextSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    filename: z.string().trim().min(1).max(512),
    mimeType: z.string().trim().min(1).max(128),
    extractedText: z.string().max(AI_ATTACHMENT_LIMITS.maxCharactersPerFile),
    pageCount: z.number().int().positive().optional(),
    characterCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    warnings: z.array(z.string().trim().min(1).max(256)).max(32),
  })
  .strict()
  .superRefine((attachment, context) => {
    if (attachment.characterCount !== attachment.extractedText.length) {
      context.addIssue({
        code: "custom",
        path: ["characterCount"],
        message: "Attachment character count does not match extracted text.",
      });
    }
  });

export const AIWriterRequestSchema: z.ZodType<AIWriterRequest> = z
  .object({
    requestId: z.string().trim().min(1).max(128),
    intent: z.enum([
      "compose",
      "compose-from-attachments",
      "rewrite-selection",
    ]),
    provider: z
      .object({
        id: z.string().trim().min(1).max(64),
        model: z.string().trim().min(1).max(128),
      })
      .strict(),
    instruction: z.string().trim().min(1).max(50_000),
    context: z
      .object({
        locale: z.string().trim().min(2).max(64),
        documentType: z.string().trim().min(1).max(128).optional(),
        writingStyle: z.enum(["auto", "neutral", "natural", "preserve-source"]),
        currentDocument: AnvilNoteDocumentV1Schema.optional(),
        selectedContent: AnvilNoteDocumentFragmentV1Schema.optional(),
        attachments: z
          .array(attachmentContextSchema)
          .max(AI_ATTACHMENT_LIMITS.maxFiles)
          .optional(),
      })
      .strict(),
    options: z
      .object({
        humanizerEnabled: z.boolean(),
        maxOutputTokens: z.number().int().positive().max(128_000).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    const attachments = request.context.attachments ?? [];
    if (
      request.intent === "rewrite-selection" &&
      !request.context.selectedContent
    ) {
      context.addIssue({
        code: "custom",
        path: ["context", "selectedContent"],
        message: "Rewrite requests require selected content.",
      });
    }
    if (
      request.intent !== "rewrite-selection" &&
      request.context.selectedContent
    ) {
      context.addIssue({
        code: "custom",
        path: ["context", "selectedContent"],
        message: "Selected content requires rewrite-selection intent.",
      });
    }
    if (
      request.intent === "compose-from-attachments" &&
      attachments.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["context", "attachments"],
        message: "Attachment composition requires at least one attachment.",
      });
    }
    if (request.intent === "compose" && attachments.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["context", "attachments"],
        message: "Attachments require compose-from-attachments intent.",
      });
    }
    const totalCharacters = attachments.reduce(
      (total, attachment) => total + attachment.characterCount,
      0,
    );
    if (totalCharacters > AI_ATTACHMENT_LIMITS.maxTotalExtractedCharacters) {
      context.addIssue({
        code: "custom",
        path: ["context", "attachments"],
        message: "Total extracted attachment text is too large.",
      });
    }
  });

export const AIProviderCredentialSchema: z.ZodType<AIProviderCredential> = z
  .object({
    apiKey: z.string().trim().min(1).max(4096),
  })
  .strict();
