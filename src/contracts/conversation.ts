import { z } from "zod";

export const AI_CONVERSATION_LIMITS = Object.freeze({
  maxMessages: 8,
  maxCharactersPerMessage: 6_000,
  maxTotalCharacters: 48_000,
});

export type ConversationPromptRole = "user" | "assistant";

/**
 * Browser-safe history supplied only by trusted product orchestration.
 * It deliberately excludes persistence identifiers, drafts, provider payloads,
 * usage, attachments, and credentials.
 */
export interface ConversationPromptMessage {
  role: ConversationPromptRole;
  content: string;
}

export interface ConversationPromptContext {
  messages: ConversationPromptMessage[];
}

export const ConversationPromptMessageSchema: z.ZodType<ConversationPromptMessage> =
  z
    .object({
      role: z.enum(["user", "assistant"]),
      content: z
        .string()
        .trim()
        .min(1)
        .max(AI_CONVERSATION_LIMITS.maxCharactersPerMessage),
    })
    .strict();

export const ConversationPromptContextSchema: z.ZodType<ConversationPromptContext> =
  z
    .object({
      messages: z
        .array(ConversationPromptMessageSchema)
        .min(1)
        .max(AI_CONVERSATION_LIMITS.maxMessages),
    })
    .strict()
    .superRefine((context, issueContext) => {
      const totalCharacters = context.messages.reduce(
        (total, message) => total + message.content.length,
        0,
      );
      if (totalCharacters > AI_CONVERSATION_LIMITS.maxTotalCharacters) {
        issueContext.addIssue({
          code: "custom",
          path: ["messages"],
          message: "Conversation context exceeds the total character limit.",
        });
      }

      for (let index = 1; index < context.messages.length; index += 1) {
        if (context.messages[index - 1].role === context.messages[index].role) {
          issueContext.addIssue({
            code: "custom",
            path: ["messages", index, "role"],
            message: "Conversation messages must alternate roles.",
          });
        }
      }
    });
