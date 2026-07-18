export type ProtectedContentKind =
  "math" | "code" | "url" | "identifier" | "node";

export interface ProtectContentOptions {
  kind: ProtectedContentKind;
  orderSensitive?: boolean;
}

interface ProtectedContentEntry {
  placeholder: string;
  value: string;
  kind: ProtectedContentKind;
  orderSensitive: boolean;
}

export class ProtectedContentError extends Error {
  readonly code = "invalid_structured_output" as const;

  constructor(message: string) {
    super(message);
    this.name = "ProtectedContentError";
  }
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let fromIndex = 0;
  while (fromIndex <= value.length) {
    const index = value.indexOf(needle, fromIndex);
    if (index === -1) return count;
    count += 1;
    fromIndex = index + needle.length;
  }
  return count;
}

export class ProtectedContentRegistry {
  private readonly namespacePrefix: string;
  private readonly entries: ProtectedContentEntry[] = [];

  static create(sourceText: string): ProtectedContentRegistry {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi || typeof cryptoApi.randomUUID !== "function") {
      throw new ProtectedContentError(
        "Cryptographically secure randomness is unavailable.",
      );
    }
    return new ProtectedContentRegistry(cryptoApi.randomUUID(), sourceText);
  }

  private constructor(requestNonce: string, sourceText: string) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestNonce)) {
      throw new ProtectedContentError("Protected-content nonce is invalid.");
    }
    this.namespacePrefix = `{{ANVIL_PROTECTED_${requestNonce}_`;
    if (sourceText.includes("{{ANVIL_PROTECTED_")) {
      throw new ProtectedContentError(
        "Protected-content namespace collides with source text.",
      );
    }
  }

  protect(value: string, options: ProtectContentOptions): string {
    const sequence = String(this.entries.length + 1).padStart(4, "0");
    const placeholder = `${this.namespacePrefix}${sequence}}}`;
    this.entries.push({
      placeholder,
      value,
      kind: options.kind,
      orderSensitive: options.orderSensitive ?? false,
    });
    return placeholder;
  }

  validateAndRestore(output: string): string {
    for (const entry of this.entries) {
      if (countOccurrences(output, entry.placeholder) !== 1) {
        throw new ProtectedContentError(
          `Protected ${entry.kind} placeholder must appear exactly once.`,
        );
      }
    }

    const orderedEntries = this.entries.filter((entry) => entry.orderSensitive);
    let priorIndex = -1;
    for (const entry of orderedEntries) {
      const index = output.indexOf(entry.placeholder);
      if (index <= priorIndex) {
        throw new ProtectedContentError("Protected-content order changed.");
      }
      priorIndex = index;
    }

    const remainingNamespacePattern = new RegExp(
      `${this.namespacePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^}]+}}`,
      "g",
    );
    const unknownPlaceholders = output.match(remainingNamespacePattern) ?? [];
    if (
      unknownPlaceholders.some(
        (placeholder) =>
          !this.entries.some((entry) => entry.placeholder === placeholder),
      )
    ) {
      throw new ProtectedContentError(
        "Unknown protected-content placeholder found.",
      );
    }

    let restored = output;
    for (const entry of this.entries) {
      restored = restored.replace(entry.placeholder, entry.value);
    }
    return restored;
  }
}
