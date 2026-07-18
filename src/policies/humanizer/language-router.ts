export type HumanizerLanguage = "en" | "zh-TW" | "general";

export interface HumanizerLanguageRoutingInput {
  requestLocale: string;
  requestedOutputLocale?: string;
  contentSamples?: string[];
}

export interface HumanizerLanguageRoute {
  requestedLocale: string;
  language: HumanizerLanguage;
  policyId:
    | "policy.humanizer.en.v1"
    | "policy.humanizer.zh-TW.v1"
    | "policy.humanizer.core.v1";
  fallback: boolean;
  mixedContent: boolean;
  preserveOtherLanguages: boolean;
}

function routeLocale(
  locale: string,
): Pick<HumanizerLanguageRoute, "language" | "policyId" | "fallback"> {
  const normalized = locale.trim().toLowerCase();
  if (
    normalized === "zh-tw" ||
    normalized === "zh-hant" ||
    normalized.startsWith("zh-hant-")
  ) {
    return {
      language: "zh-TW",
      policyId: "policy.humanizer.zh-TW.v1",
      fallback: false,
    };
  }
  if (normalized === "en" || normalized.startsWith("en-")) {
    return {
      language: "en",
      policyId: "policy.humanizer.en.v1",
      fallback: false,
    };
  }
  return {
    language: "general",
    policyId: "policy.humanizer.core.v1",
    fallback: true,
  };
}

export function resolveHumanizerLanguage({
  requestLocale,
  requestedOutputLocale,
  contentSamples = [],
}: HumanizerLanguageRoutingInput): HumanizerLanguageRoute {
  const requestedLocale = requestedOutputLocale?.trim() || requestLocale.trim();
  const route = routeLocale(requestedLocale);
  const combinedContent = contentSamples.join("\n");
  const mixedContent =
    /\p{Script=Han}/u.test(combinedContent) &&
    /\p{Script=Latin}/u.test(combinedContent);
  return {
    requestedLocale,
    ...route,
    mixedContent,
    preserveOtherLanguages: mixedContent,
  };
}
