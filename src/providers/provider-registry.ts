import type { AIProviderAdapter } from "./provider-adapter";

export class AIProviderRegistry {
  private readonly adapters: Map<string, AIProviderAdapter>;

  constructor(adapters: AIProviderAdapter[]) {
    this.adapters = new Map();
    for (const adapter of adapters) {
      const providerId = adapter.definition.id;
      if (this.adapters.has(providerId)) {
        throw new Error(`Duplicate AI provider adapter: ${providerId}`);
      }
      this.adapters.set(providerId, adapter);
    }
  }

  get(providerId: string): AIProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }
}
