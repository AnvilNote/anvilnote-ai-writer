export interface WritingPolicyProvenance {
  sourceName: string;
  repository: string;
  upstreamCommit: string;
  license: string;
}

export interface WritingPolicyDefinition {
  id: string;
  version: number;
  assetPath: string;
  supportedLocales: string[];
  description: string;
  provenance?: WritingPolicyProvenance[];
}
