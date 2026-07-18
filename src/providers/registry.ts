import type {
  AIModelDefinition,
  AIProviderDefinition,
} from "../contracts/provider";
import { OPENAI_PROVIDER_DEFINITION } from "./openai/index";

const PROVIDERS: AIProviderDefinition[] = [OPENAI_PROVIDER_DEFINITION];

export function getEnabledAIProviders(): AIProviderDefinition[] {
  return PROVIDERS.filter((provider) => provider.enabled).map((provider) => ({
    ...provider,
    models: provider.models.filter((model) => model.enabled),
  }));
}

export function getProviderDefinition(
  providerId: string,
): AIProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === providerId);
}

export function getModelDefinition(
  providerId: string,
  modelId: string,
): AIModelDefinition | undefined {
  return getProviderDefinition(providerId)?.models.find(
    (model) => model.id === modelId,
  );
}

export function getDefaultAIModel(
  providerId: string,
): AIModelDefinition | undefined {
  return getProviderDefinition(providerId)?.models.find(
    (model) => model.enabled && model.isDefault,
  );
}
