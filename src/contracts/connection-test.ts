export type ConnectionTestStatus =
  | "success"
  | "invalid-key"
  | "permission-denied"
  | "insufficient-credit"
  | "model-unavailable"
  | "rate-limited"
  | "network-error"
  | "timeout"
  | "cancelled"
  | "unknown-error";

export interface ConnectionTestOptions {
  model: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ConnectionTestResult {
  status: ConnectionTestStatus;
  provider: string;
  model: string;
  messageKey: string;
  latencyMs?: number;
}
