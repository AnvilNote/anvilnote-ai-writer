// Canonical AI document v2 — shared safety limits for the full-structure AI
// editing layer (operations, node/text volume, nesting depth, Mermaid
// source, function-plot curves/formulas, table geometry, chart data).
//
// Deliberately NOT a mirror of anvilnote-web's own UI-level constants
// (mermaid.ts/function-plot-defaults.ts/stats-chart-defaults.ts) — those
// (e.g. MAX_CURVES=6, MAX_ENTRIES=20, SCATTER_MAX_ENTRIES=5000) bound what
// the DIALOG UI lets a human type in one sitting. AI_EDIT_LIMITS is a
// separate, more generous ceiling on what the model-facing structural edit
// layer will accept in one shot — the two are intentionally different
// numbers for a different purpose (protecting this layer from a runaway or
// adversarial generation, not matching a human dialog's row limits).
export const AI_EDIT_LIMITS = Object.freeze({
  maxOperations: 128,
  maxAddedNodes: 2_000,
  maxTotalCharacters: 200_000,
  maxDepth: 32,
  maxMermaidCharacters: 20_000,
  maxFunctionCurves: 16,
  maxFormulaCharacters: 1_000,
  maxTableRows: 200,
  maxTableColumns: 50,
  maxChartSeries: 32,
  maxChartDataPoints: 5_000,
});
