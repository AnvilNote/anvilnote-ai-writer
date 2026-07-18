export interface AIModelDefinition {
  id: string;
  providerId: string;
  displayName: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  capabilities: {
    structuredOutputs: boolean;
    textInput: boolean;
    imageInput: boolean;
    fileInput: boolean;
  };
  limits: {
    maxOutputTokens?: number;
    contextWindowTokens?: number;
  };
  pricingId: string;
}

export interface ProviderSetupStep {
  titleKey: string;
  descriptionKey: string;
  suggestedValue?: string;
}

export interface ProviderSetupNotice {
  kind: "billing" | "security" | "privacy" | "cost";
  messageKey: string;
}

export interface ProviderSetupGuide {
  titleKey: string;
  descriptionKey: string;
  documentationUrl: string;
  steps: ProviderSetupStep[];
  notices: ProviderSetupNotice[];
}

export interface AIProviderDefinition {
  id: string;
  displayName: string;
  enabled: boolean;
  models: AIModelDefinition[];
  setupGuide: ProviderSetupGuide;
}

export interface AIProviderCredential {
  apiKey: string;
}
