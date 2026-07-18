export interface AttachmentContext {
  id: string;
  filename: string;
  mimeType: string;
  extractedText: string;
  pageCount?: number;
  characterCount: number;
  truncated: boolean;
  warnings: string[];
}

export const AI_ATTACHMENT_LIMITS = Object.freeze({
  maxFiles: 5,
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxTotalSizeBytes: 25 * 1024 * 1024,
  maxCharactersPerFile: 100_000,
  maxTotalExtractedCharacters: 200_000,
});

export const AI_TIMEOUTS = Object.freeze({
  connectionTestMs: 20_000,
  writerRequestMs: 120_000,
});
