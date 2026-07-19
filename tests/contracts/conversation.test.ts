import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONVERSATION_LIMITS,
  ConversationPromptContextSchema,
} from "../../src/contracts/index";

function messageAt(index: number) {
  return {
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Message ${index + 1}`,
  };
}

test("conversation context accepts no more than eight alternating display messages", () => {
  const messages = Array.from(
    { length: AI_CONVERSATION_LIMITS.maxMessages },
    (_, index) => messageAt(index),
  );
  assert.deepEqual(ConversationPromptContextSchema.parse({ messages }), {
    messages,
  });
  assert.equal(
    ConversationPromptContextSchema.safeParse({
      messages: [...messages, { role: "user", content: "Too many." }],
    }).success,
    false,
  );
  assert.equal(
    ConversationPromptContextSchema.safeParse({
      messages: [
        { role: "user", content: "First." },
        { role: "user", content: "Second." },
      ],
    }).success,
    false,
  );
});

test("conversation context rejects oversize text and non-display fields", () => {
  assert.equal(
    ConversationPromptContextSchema.safeParse({
      messages: [
        {
          role: "user",
          content: "x".repeat(AI_CONVERSATION_LIMITS.maxCharactersPerMessage + 1),
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    ConversationPromptContextSchema.safeParse({
      messages: [
        {
          role: "assistant",
          content: "Only display text belongs in the prompt context.",
          draft: { document: "must not be accepted" },
          providerUsage: { totalTokens: 1 },
          attachmentText: "must not be accepted",
        },
      ],
    }).success,
    false,
  );
});
