import type { ProviderSetupGuide } from "../../contracts/provider";

export const OPENAI_SETUP_GUIDE: ProviderSetupGuide = {
  titleKey: "ai.settings.openaiGuide.title",
  descriptionKey: "ai.settings.openaiGuide.description",
  documentationUrl: "https://platform.openai.com/api-keys",
  steps: [
    {
      titleKey: "ai.settings.openaiGuide.openPlatform.title",
      descriptionKey: "ai.settings.openaiGuide.openPlatform.description",
    },
    {
      titleKey: "ai.settings.openaiGuide.createProject.title",
      descriptionKey: "ai.settings.openaiGuide.createProject.description",
      suggestedValue: "AnvilNote",
    },
    {
      titleKey: "ai.settings.openaiGuide.createKey.title",
      descriptionKey: "ai.settings.openaiGuide.createKey.description",
      suggestedValue: "AnvilNote Desktop – <Device Name>",
    },
    {
      titleKey: "ai.settings.openaiGuide.copyKey.title",
      descriptionKey: "ai.settings.openaiGuide.copyKey.description",
    },
    {
      titleKey: "ai.settings.openaiGuide.pasteKey.title",
      descriptionKey: "ai.settings.openaiGuide.pasteKey.description",
    },
    {
      titleKey: "ai.settings.openaiGuide.testConnection.title",
      descriptionKey: "ai.settings.openaiGuide.testConnection.description",
    },
  ],
  notices: [
    { kind: "billing", messageKey: "ai.settings.openaiGuide.billingSeparate" },
    { kind: "billing", messageKey: "ai.settings.openaiGuide.paymentRequired" },
    { kind: "security", messageKey: "ai.settings.openaiGuide.secretShownOnce" },
    { kind: "security", messageKey: "ai.settings.openaiGuide.revokeLostKey" },
    { kind: "security", messageKey: "ai.settings.openaiGuide.neverShareKey" },
    {
      kind: "security",
      messageKey: "ai.settings.openaiGuide.desktopSecureStorage",
    },
    {
      kind: "privacy",
      messageKey: "ai.settings.openaiGuide.providerDataNotice",
    },
    { kind: "cost", messageKey: "ai.settings.openaiGuide.connectionTestCost" },
  ],
};
