import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPromptTemplate } from "./registry";
import { getWritingPolicy } from "../policies/registry";

export class PromptAssetConfigurationError extends Error {
  readonly code = "prompt_asset_configuration_error";

  constructor(message: string) {
    super(message);
    this.name = "PromptAssetConfigurationError";
  }
}

const runtimeAssetRoot = path.resolve(__dirname, "..");

export function resolveAllowlistedAssetPath(assetPath: string): string {
  if (
    path.isAbsolute(assetPath) ||
    assetPath.includes("\\") ||
    !/^(prompts|policies)\/[A-Za-z0-9][A-Za-z0-9./-]*\.md$/.test(assetPath)
  ) {
    throw new PromptAssetConfigurationError(
      `Prompt asset path is not allowlisted: ${assetPath}`,
    );
  }
  const normalized = path.posix.normalize(assetPath);
  if (normalized !== assetPath || normalized.includes("..")) {
    throw new PromptAssetConfigurationError(
      `Prompt asset path is unsafe: ${assetPath}`,
    );
  }
  const resolved = path.resolve(runtimeAssetRoot, ...normalized.split("/"));
  const rootWithSeparator = `${runtimeAssetRoot}${path.sep}`;
  if (!resolved.startsWith(rootWithSeparator)) {
    throw new PromptAssetConfigurationError(
      `Prompt asset resolves outside the package: ${assetPath}`,
    );
  }
  return resolved;
}

export function registeredAssetExists(assetPath: string): boolean {
  return existsSync(resolveAllowlistedAssetPath(assetPath));
}

function readRegisteredAsset(assetPath: string): string {
  const resolved = resolveAllowlistedAssetPath(assetPath);
  try {
    return readFileSync(resolved, "utf8").trim();
  } catch {
    throw new PromptAssetConfigurationError(
      `Registered prompt asset is missing or unreadable: ${assetPath}`,
    );
  }
}

export function loadPromptTemplate(id: string): string {
  const definition = getPromptTemplate(id);
  if (!definition) {
    throw new PromptAssetConfigurationError(`Unknown prompt template: ${id}`);
  }
  return readRegisteredAsset(definition.assetPath);
}

export function loadWritingPolicy(id: string): string {
  const definition = getWritingPolicy(id);
  if (!definition) {
    throw new PromptAssetConfigurationError(`Unknown writing policy: ${id}`);
  }
  return readRegisteredAsset(definition.assetPath);
}
