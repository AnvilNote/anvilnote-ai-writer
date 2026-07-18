import { AIWriterRequestSchema } from "../contracts/index";
import { getWritingProfile, type WritingProfileDefinition } from "./registry";

const PROFILE_BY_INTENT = {
  compose: "compose.default.v1",
  "compose-from-attachments": "compose.from-attachments.v1",
  "rewrite-selection": "rewrite.selection.v1",
} as const;

export function selectWritingProfile(
  untrustedRequest: unknown,
): WritingProfileDefinition {
  const request = AIWriterRequestSchema.parse(untrustedRequest);
  const profileId = PROFILE_BY_INTENT[request.intent];
  const profile = getWritingProfile(profileId);
  if (!profile) {
    throw new Error(`Writing profile is not configured: ${profileId}`);
  }
  return profile;
}
