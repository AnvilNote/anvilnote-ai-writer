export function formatEstimatedCost(value: number): string {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError("Cost must be non-negative.");
  if (value < 0.01) return "< US$0.01";
  return `US$${value.toFixed(4)}`;
}
