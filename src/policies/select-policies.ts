import type { HumanizerLanguageRoute } from "./humanizer/language-router";
import {
  getWritingStylePolicyId,
  type ResolvedWritingStyle,
} from "./writing-style";

export interface WritingPolicySelectionInput {
  basePolicyIds: readonly string[];
  resolvedStyle: ResolvedWritingStyle;
  humanizerEnabled: boolean;
  languageRoute: HumanizerLanguageRoute;
}

export function selectWritingPolicyIds({
  basePolicyIds,
  resolvedStyle,
  humanizerEnabled,
  languageRoute,
}: WritingPolicySelectionInput): string[] {
  const policyIds = [...basePolicyIds, getWritingStylePolicyId(resolvedStyle)];
  if (humanizerEnabled) policyIds.push(languageRoute.policyId);
  return [...new Set(policyIds)];
}
