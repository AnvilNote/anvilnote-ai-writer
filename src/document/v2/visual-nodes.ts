import { z } from "zod";
import { hexColorV2Schema } from "./marks";
import { registerBlockSchemasV2 } from "./document";
import { AI_EDIT_LIMITS } from "./limits";

// Canonical AI document v2 — strict visual nodes (mermaid, functionPlot,
// statsChart). See capability-manifest.ts's header comment for the overall
// picture. These are all atom nodes: their "content" is entirely in attrs,
// re-rendered by AnvilNote's own trusted renderer — none of them accept a
// caller-supplied `svg` attr (the real editor's own mermaid/functionPlot/
// statsChart extensions each have one, populated by the CLIENT after
// rendering, purely a rendered-output cache; accepting it as AI input would
// let a model inject arbitrary SVG markup instead of the source it
// describes, so it is simply absent from every attrs shape below).
//
// Numeric/text bounds below come from limits.ts's AI_EDIT_LIMITS (see that
// file's header comment for why these are deliberately more generous than
// anvilnote-web's own dialog-level constants, not a mirror of them).

export const MERMAID_THEMES_V2 = [
  "default",
  "base",
  "dark",
  "forest",
  "neutral",
  "monochrome",
] as const;
export type AiMermaidThemeV2 = (typeof MERMAID_THEMES_V2)[number];

export interface AiMermaidNodeV2 {
  readonly type: "mermaid";
  readonly attrs: {
    readonly source: string;
    readonly theme: AiMermaidThemeV2;
    readonly primaryColor?: string | null;
    readonly width?: number;
  };
}

export type AiFunctionPlotDashStyleV2 = "solid" | "dashed" | "dotted" | "dash-dot";

export interface AiFunctionPlotCurveV2 {
  readonly formula: string;
  readonly color: string;
  readonly dash: AiFunctionPlotDashStyleV2;
  readonly thickness: number;
}

export interface AiFunctionPlotNodeV2 {
  readonly type: "functionPlot";
  readonly attrs: {
    readonly curves: readonly AiFunctionPlotCurveV2[];
    readonly xMin: number;
    readonly xMax: number;
    readonly showGridlines: boolean;
    readonly showAxisTicks: boolean;
  };
}

export type AiChartFontFamilyV2 = "sans" | "serif";

export interface AiChartAxisLabelFieldsV2 {
  readonly xLabel: string;
  readonly yLabel: string;
  readonly yLabelRotated: boolean;
}

export interface AiChartCustomSizeFieldsV2 {
  readonly width?: number;
  readonly height?: number;
}

export interface AiCategoricalEntryV2 {
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}

export interface AiBoxWhiskerEntryV2 {
  readonly label: string;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
}

export interface AiScatterEntryV2 {
  readonly x: number;
  readonly y: number;
}

export interface AiStackedEntryV2 {
  readonly label: string;
  readonly values: readonly number[];
}

export type AiChartPercentagePlacementV2 = "none" | "onSlice" | "beside";
export type AiChartTrendLineV2 = "none" | "linear" | "lowess";

// Mirrors anvilnote-web's stats-chart.ts StatsChartSpec union shape exactly
// (bar/column kept as separate arms, stackedBar/stackedColumn merged into
// one — same grouping the real type uses), independently redefined here
// (never imported — see this file's header comment and the package-wide
// "no anvilnote-web imports" rule), plus a shared optional `caption` on
// every arm (a real flat attr on the Tiptap node per stats-chart.ts's own
// `caption` attribute, not part of the semantic union there, but needed
// here since this task's own fixture requires it to parse).
export type AiStatsChartSpecV2 =
  | ({
      chartType: "bar";
      data: readonly AiCategoricalEntryV2[];
      showValues: boolean;
      showGridLines: boolean;
      showBorder: boolean;
      fontFamily: AiChartFontFamilyV2;
      caption?: string;
    } & AiChartAxisLabelFieldsV2 &
      AiChartCustomSizeFieldsV2)
  | ({
      chartType: "column";
      data: readonly AiCategoricalEntryV2[];
      showValues: boolean;
      showGridLines: boolean;
      showBorder: boolean;
      fontFamily: AiChartFontFamilyV2;
      caption?: string;
    } & AiChartAxisLabelFieldsV2 &
      AiChartCustomSizeFieldsV2)
  | ({
      chartType: "stackedBar" | "stackedColumn";
      data: readonly AiStackedEntryV2[];
      seriesLabels: readonly string[];
      seriesColors?: readonly string[];
      showLegend: boolean;
      showGridLines: boolean;
      showBorder: boolean;
      fontFamily: AiChartFontFamilyV2;
      caption?: string;
    } & AiChartAxisLabelFieldsV2 &
      AiChartCustomSizeFieldsV2)
  | ({
      chartType: "line";
      data: readonly AiCategoricalEntryV2[];
      fontFamily: AiChartFontFamilyV2;
      caption?: string;
    } & AiChartAxisLabelFieldsV2 &
      AiChartCustomSizeFieldsV2)
  | ({
      chartType: "scatter";
      data: readonly AiScatterEntryV2[];
      fontFamily: AiChartFontFamilyV2;
      trendLine: AiChartTrendLineV2;
      trendLineColor: string;
      showGridLines: boolean;
      caption?: string;
    } & AiChartAxisLabelFieldsV2 &
      AiChartCustomSizeFieldsV2)
  | ({
      chartType: "pie";
      data: readonly AiCategoricalEntryV2[];
      showLegend: boolean;
      showPercentage: AiChartPercentagePlacementV2;
      fontFamily: AiChartFontFamilyV2;
      caption?: string;
    } & AiChartCustomSizeFieldsV2)
  | ({
      chartType: "boxwhisker";
      data: readonly AiBoxWhiskerEntryV2[];
      fontFamily: AiChartFontFamilyV2;
      caption?: string;
    } & AiChartCustomSizeFieldsV2);

export interface AiStatsChartNodeV2 {
  readonly type: "statsChart";
  readonly attrs: AiStatsChartSpecV2;
}

export type AiVisualBlockV2 = AiMermaidNodeV2 | AiFunctionPlotNodeV2 | AiStatsChartNodeV2;

const mermaidSchema = z
  .object({
    type: z.literal("mermaid"),
    attrs: z
      .object({
        source: z.string().min(1).max(AI_EDIT_LIMITS.maxMermaidCharacters),
        theme: z.enum(MERMAID_THEMES_V2),
        primaryColor: hexColorV2Schema().nullable().optional(),
        width: z.number().finite().positive().max(100).optional(),
      })
      .strict(),
  })
  .strict();

// Real editor bounds (function-plot-defaults.ts) for a single curve's
// stroke width — a genuine rendering-domain range, not a volume/safety
// limit, so kept local here rather than in AI_EDIT_LIMITS (whose own field
// list, given verbatim by this task's plan, has no thickness entry).
const MIN_CURVE_THICKNESS_V2 = 0.5;
const MAX_CURVE_THICKNESS_V2 = 4;
const FUNCTION_PLOT_DASH_STYLES_V2 = ["solid", "dashed", "dotted", "dash-dot"] as const;

const functionPlotCurveSchema = z
  .object({
    formula: z.string().trim().min(1).max(AI_EDIT_LIMITS.maxFormulaCharacters),
    color: hexColorV2Schema(),
    dash: z.enum(FUNCTION_PLOT_DASH_STYLES_V2),
    thickness: z.number().finite().min(MIN_CURVE_THICKNESS_V2).max(MAX_CURVE_THICKNESS_V2),
  })
  .strict();

const functionPlotSchema = z
  .object({
    type: z.literal("functionPlot"),
    attrs: z
      .object({
        curves: z.array(functionPlotCurveSchema).min(1).max(AI_EDIT_LIMITS.maxFunctionCurves),
        xMin: z.number().finite(),
        xMax: z.number().finite(),
        showGridlines: z.boolean(),
        showAxisTicks: z.boolean(),
      })
      .strict()
      .superRefine((attrs, context) => {
        if (attrs.xMin >= attrs.xMax) {
          context.addIssue({
            code: "custom",
            path: ["xMax"],
            message: "xMax must be greater than xMin (reversed or degenerate axes).",
          });
        }
      }),
  })
  .strict();

const categoricalEntrySchema = z
  .object({
    label: z.string().max(512),
    value: z.number().finite(),
    color: hexColorV2Schema().optional(),
  })
  .strict();

const boxWhiskerEntrySchema = z
  .object({
    label: z.string().max(512),
    min: z.number().finite(),
    q1: z.number().finite(),
    median: z.number().finite(),
    q3: z.number().finite(),
    max: z.number().finite(),
  })
  .strict();

const scatterEntrySchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

const stackedEntrySchema = z
  .object({
    label: z.string().max(512),
    values: z.array(z.number().finite()).min(1).max(AI_EDIT_LIMITS.maxChartSeries),
  })
  .strict();

const fontFamilySchema = z.enum(["sans", "serif"]);

const axisLabelShape = {
  xLabel: z.string().max(256),
  yLabel: z.string().max(256),
  yLabelRotated: z.boolean(),
};

const customSizeShape = {
  width: z.number().finite().positive().max(1_000).optional(),
  height: z.number().finite().positive().max(1_000).optional(),
};

const captionShape = {
  caption: z.string().max(10_000).optional(),
};

const barChartSchema = z
  .object({
    chartType: z.literal("bar"),
    data: z.array(categoricalEntrySchema).min(1).max(AI_EDIT_LIMITS.maxChartDataPoints),
    showValues: z.boolean(),
    showGridLines: z.boolean(),
    showBorder: z.boolean(),
    fontFamily: fontFamilySchema,
    ...axisLabelShape,
    ...customSizeShape,
    ...captionShape,
  })
  .strict();

const columnChartSchema = z
  .object({
    chartType: z.literal("column"),
    data: z.array(categoricalEntrySchema).min(1).max(AI_EDIT_LIMITS.maxChartDataPoints),
    showValues: z.boolean(),
    showGridLines: z.boolean(),
    showBorder: z.boolean(),
    fontFamily: fontFamilySchema,
    ...axisLabelShape,
    ...customSizeShape,
    ...captionShape,
  })
  .strict();

const stackedBarChartSchema = z
  .object({
    chartType: z.literal("stackedBar"),
    data: z.array(stackedEntrySchema).min(1).max(AI_EDIT_LIMITS.maxChartDataPoints),
    seriesLabels: z.array(z.string().max(256)).min(1).max(AI_EDIT_LIMITS.maxChartSeries),
    seriesColors: z.array(hexColorV2Schema()).max(AI_EDIT_LIMITS.maxChartSeries).optional(),
    showLegend: z.boolean(),
    showGridLines: z.boolean(),
    showBorder: z.boolean(),
    fontFamily: fontFamilySchema,
    ...axisLabelShape,
    ...customSizeShape,
    ...captionShape,
  })
  .strict();

const stackedColumnChartSchema = z
  .object({
    chartType: z.literal("stackedColumn"),
    data: z.array(stackedEntrySchema).min(1).max(AI_EDIT_LIMITS.maxChartDataPoints),
    seriesLabels: z.array(z.string().max(256)).min(1).max(AI_EDIT_LIMITS.maxChartSeries),
    seriesColors: z.array(hexColorV2Schema()).max(AI_EDIT_LIMITS.maxChartSeries).optional(),
    showLegend: z.boolean(),
    showGridLines: z.boolean(),
    showBorder: z.boolean(),
    fontFamily: fontFamilySchema,
    ...axisLabelShape,
    ...customSizeShape,
    ...captionShape,
  })
  .strict();

const lineChartSchema = z
  .object({
    chartType: z.literal("line"),
    data: z.array(categoricalEntrySchema).min(1).max(AI_EDIT_LIMITS.maxChartDataPoints),
    fontFamily: fontFamilySchema,
    ...axisLabelShape,
    ...customSizeShape,
    ...captionShape,
  })
  .strict();

const scatterChartSchema = z
  .object({
    chartType: z.literal("scatter"),
    data: z.array(scatterEntrySchema).min(1).max(AI_EDIT_LIMITS.maxChartDataPoints),
    fontFamily: fontFamilySchema,
    trendLine: z.enum(["none", "linear", "lowess"]),
    trendLineColor: hexColorV2Schema(),
    showGridLines: z.boolean(),
    ...axisLabelShape,
    ...customSizeShape,
    ...captionShape,
  })
  .strict();

const pieChartSchema = z
  .object({
    chartType: z.literal("pie"),
    data: z.array(categoricalEntrySchema).min(1).max(AI_EDIT_LIMITS.maxChartDataPoints),
    showLegend: z.boolean(),
    showPercentage: z.enum(["none", "onSlice", "beside"]),
    fontFamily: fontFamilySchema,
    ...customSizeShape,
    ...captionShape,
  })
  .strict();

const boxwhiskerChartSchema = z
  .object({
    chartType: z.literal("boxwhisker"),
    data: z.array(boxWhiskerEntrySchema).min(1).max(AI_EDIT_LIMITS.maxChartDataPoints),
    fontFamily: fontFamilySchema,
    ...customSizeShape,
    ...captionShape,
  })
  .strict();

const statsChartAttrsSchema = z.discriminatedUnion("chartType", [
  barChartSchema,
  columnChartSchema,
  stackedBarChartSchema,
  stackedColumnChartSchema,
  lineChartSchema,
  scatterChartSchema,
  pieChartSchema,
  boxwhiskerChartSchema,
]);

const statsChartSchema = z
  .object({
    type: z.literal("statsChart"),
    attrs: statsChartAttrsSchema,
  })
  .strict();

export const visualBlockSchemasV2 = [mermaidSchema, functionPlotSchema, statsChartSchema] as const;

registerBlockSchemasV2(visualBlockSchemasV2);
