import type { AIModelDefinition } from "../../contracts/provider";

export const OPENAI_SUPPORTED_MODELS: AIModelDefinition[] = [
  {
    id: "gpt-5.6-sol",
    providerId: "openai",
    displayName: "GPT-5.6 Sol",
    description: "Best quality",
    enabled: true,
    isDefault: false,
    capabilities: {
      structuredOutputs: true,
      textInput: true,
      imageInput: false,
      fileInput: false,
    },
    limits: {
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
    },
    pricingId: "gpt-5.6-sol",
  },
  {
    id: "gpt-5.6-terra",
    providerId: "openai",
    displayName: "GPT-5.6 Terra",
    description: "Balanced",
    enabled: true,
    isDefault: true,
    capabilities: {
      structuredOutputs: true,
      textInput: true,
      imageInput: false,
      fileInput: false,
    },
    limits: {
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
    },
    pricingId: "gpt-5.6-terra",
  },
  {
    id: "gpt-5.6-luna",
    providerId: "openai",
    displayName: "GPT-5.6 Luna",
    description: "Economy",
    enabled: true,
    isDefault: false,
    capabilities: {
      structuredOutputs: true,
      textInput: true,
      imageInput: false,
      fileInput: false,
    },
    limits: {
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
    },
    pricingId: "gpt-5.6-luna",
  },
];
