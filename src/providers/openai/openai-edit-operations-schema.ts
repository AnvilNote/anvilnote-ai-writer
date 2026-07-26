import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { AI_EDIT_OPERATIONS_V1_VERSION } from "../../edits/edit-operations-v1";
import { AI_EDIT_LIMITS } from "../../document/v2/limits";
import { sanitizeOpenAIStrictSchema, validateOpenAIStrictSchema } from "./openai-strict-schema";

// OpenAI strict Structured Outputs wire schema for AI edit operations
// (anvilnote.ai.edit-operations.v1).
//
// This is deliberately a SEPARATE, SHALLOWER "wire" representation of
// AiEditOperationV1/AiEditOperationsResultV1 (edit-operations-v1.ts), not a
// reuse of the real, deeply-recursive per-node-type v2 Zod schemas directly
// — mirroring the existing compose/rewrite convention in
// openai-model-payload.ts (OpenAIComposePayloadV1Schema/
// OpenAIRewritePayloadV1Schema): every object sets additionalProperties:
// false and lists every property in `required`; a canonically OPTIONAL
// field becomes a REQUIRED-but-nullable wire field instead (OpenAI strict
// Structured Outputs has no notion of an optional property at all).
// openai-edit-operations-normalizer.ts is the other half of this pair: it
// undoes the nullable-for-optional wire convention (and a couple of
// genuinely required-nullable exceptions, documented there) before handing
// off to parseEditOperationsV1 — the REAL canonical parser — for actual
// semantic validation. This module only has to produce something the model
// CAN legally emit; it deliberately does not re-implement bounds/regex/
// refinement checks the canonical schemas already own (minLength/maxLength
// have no strict-mode equivalent and are stripped by
// sanitizeOpenAIStrictSchema regardless of what is written here), so the
// wire node/attrs shapes below are intentionally loose on value bounds and
// strict only on SHAPE (property names, required-ness, discriminants).
//
// --- Why every schema below carries an explicit `.meta({ id })` ---------
// Zod v4's `toJSONSchema` (which `zodTextFormat` calls under the hood) does
// NOT deduplicate a Zod schema object that is referenced from multiple
// places in the tree unless that schema has been explicitly registered via
// `.meta({ id })` — verified empirically during development: without any
// ids, the exact same reused subschema (e.g. the 8-arm "atomic block" union,
// reused by listItem/blockquote/callout/proof/tableHeader/tableCell/
// question) gets fully INLINED again at every use site, and the resulting
// wire schema blew past both validateOpenAIStrictSchema's ceilings (5,000
// properties AND 10 nesting levels) — a self-recursive version (one single
// "any block" union mirroring the real, unnarrowed v2 canonical schemas via
// z.lazy, matching core-nodes.ts/document.ts's own pattern) failed the same
// way even worse, since zodTextFormat partially unrolls recursive
// z.lazy references inline rather than emitting one clean self-referencing
// $ref. Giving a schema an id makes zod hoist it into the JSON Schema's
// `definitions` map exactly once and reference every other use site via
// `$ref` — collapsing both the duplicated property count AND the nesting
// depth (validateOpenAIStrictSchema's own `visit()` walks every
// `definitions` entry at the SAME depth as its container, so a `$ref`
// indirection costs nothing extra, while inlining the same subtree N times
// costs N times the properties). Every reusable node/attrs/mark shape below
// is given an id for this reason, even a few that are only referenced once
// today, so the budget stays comfortably safe as this schema evolves.
//
// --- Why this is a BOUNDED-DEPTH tier system, not one big recursive union -
// Even with `$ref` deduplication, block containers still cannot legally
// nest each other WITHOUT LIMIT in one wire node (the real, unnarrowed v2
// canonical schemas allow e.g. a table inside a callout inside a
// blockquote): each `$ref`'d definition's OWN internal depth still counts,
// and letting every container hold every OTHER container recursively would
// still make the deepest single definition too deep. So node "content"
// arrays are organized into a small, fixed tier system instead:
//   - ATOMIC block nodes (paragraph/heading/horizontalRule/blockMath/
//     codeBlock/mermaid/functionPlot/statsChart) never contain another
//     block node.
//   - "listItem" contains only ATOMIC blocks; bulletList/orderedList
//     contain only listItem.
//   - "container" nodes (blockquote/callout/proof/tableHeader/tableCell)
//     contain only ATOMIC blocks.
//   - table/tableRow/footnotes/footnote are their own small, already-bounded
//     tiers.
//   - question is flattened into ONE flat wire node (mirroring
//     openai-model-payload.ts's own `expandProviderQuestionWire`
//     convention exactly: "each wire question represents one item"),
//     expanded by the normalizer into the real nested question >
//     questionItem > choiceList > choiceItem shape.
// This means a model cannot express, say, "a table nested inside a callout"
// as ONE insertNode payload — but it was never meant to: the six operations
// apply strictly in array ORDER within one batch (see edit-structures-v2.md
// for the model-facing explanation), so a deeper composition is built with
// multiple flat operations in the same batch instead (insert the empty
// callout with a localRef, then insertNode the table as its child in a
// later operation of the SAME batch). This is a real, documented capability
// narrowing versus the fully general canonical AST — see this task's final
// report for the exact judgment call.

const refWireSchema = z.string();

const simpleMarkWireSchemas = ["bold", "italic", "strike", "underline", "code"].map((type) =>
  z
    .object({ type: z.literal(type) })
    .strict()
    .meta({ id: `mark-${type}` }),
);

const linkMarkWireSchema = z
  .object({
    type: z.literal("link"),
    attrs: z
      .object({
        href: z.string(),
        title: z.string().nullable(),
        target: z.enum(["_blank", "_self"]).nullable(),
      })
      .strict()
      .meta({ id: "link-mark-attrs" }),
  })
  .strict()
  .meta({ id: "mark-link" });

// textStyle's color is REQUIRED-but-nullable in the real v2 mark (not
// optional) — see openai-edit-operations-normalizer.ts's header comment for
// why this is one of the three fields whose wire `null` must be preserved
// rather than collapsed to "field omitted".
const textStyleMarkWireSchema = z
  .object({
    type: z.literal("textStyle"),
    attrs: z.object({ color: z.string().nullable() }).strict().meta({ id: "text-style-mark-attrs" }),
  })
  .strict()
  .meta({ id: "mark-text-style" });

const markWireSchema = z
  .union([...simpleMarkWireSchemas, linkMarkWireSchema, textStyleMarkWireSchema])
  .meta({ id: "mark" });

const textWireSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    marks: z.array(markWireSchema).nullable(),
  })
  .strict()
  .meta({ id: "node-text" });
const hardBreakWireSchema = z.object({ type: z.literal("hardBreak") }).strict().meta({ id: "node-hard-break" });
const inlineMathWireSchema = z
  .object({ type: z.literal("inlineMath"), attrs: z.object({ latex: z.string() }).strict() })
  .strict()
  .meta({ id: "node-inline-math" });
const crossRefWireSchema = z
  .object({ type: z.literal("crossRef"), attrs: z.object({ targetRef: refWireSchema }).strict() })
  .strict()
  .meta({ id: "node-cross-ref" });
const footnoteReferenceWireSchema = z
  .object({ type: z.literal("footnoteReference"), attrs: z.object({ targetRef: refWireSchema }).strict() })
  .strict()
  .meta({ id: "node-footnote-reference" });
const questionBlankWireSchema = z
  .object({ type: z.literal("questionBlank"), attrs: z.object({ targetRef: refWireSchema }).strict() })
  .strict()
  .meta({ id: "node-question-blank" });
const inlineBlankWireSchema = z
  .object({ type: z.literal("inlineBlank") })
  .strict()
  .meta({ id: "node-inline-blank" });

const inlineNodeWireSchema = z
  .discriminatedUnion("type", [
    textWireSchema,
    hardBreakWireSchema,
    inlineMathWireSchema,
    crossRefWireSchema,
    footnoteReferenceWireSchema,
    questionBlankWireSchema,
    inlineBlankWireSchema,
  ])
  .meta({ id: "inline-node" });

// --- Tier 0: ATOMIC blocks — never contain another block node ------------

const paragraphWireSchema = z
  .object({ type: z.literal("paragraph"), content: z.array(inlineNodeWireSchema) })
  .strict()
  .meta({ id: "node-paragraph" });
const headingLevelWireSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const headingWireSchema = z
  .object({
    type: z.literal("heading"),
    attrs: z
      .object({ level: headingLevelWireSchema, localRef: z.string().nullable() })
      .strict()
      .meta({ id: "heading-attrs" }),
    content: z.array(inlineNodeWireSchema),
  })
  .strict()
  .meta({ id: "node-heading" });
const dividerLineStyleWireSchema = z.enum(["solid", "dashed", "dotted", "dashdot"]);
const horizontalRuleWireSchema = z
  .object({
    type: z.literal("horizontalRule"),
    attrs: z
      .object({ thicknessPt: z.number().nullable(), lineStyle: dividerLineStyleWireSchema.nullable() })
      .strict()
      .nullable()
      .meta({ id: "horizontal-rule-attrs" }),
  })
  .strict()
  .meta({ id: "node-horizontal-rule" });
const blockMathWireSchema = z
  .object({
    type: z.literal("blockMath"),
    attrs: z
      .object({
        latex: z.string(),
        refName: z.string().nullable(),
        localRef: z.string().nullable(),
      })
      .strict()
      .meta({ id: "block-math-attrs" }),
  })
  .strict()
  .meta({ id: "node-block-math" });
const codeBlockTextWireSchema = z
  .object({ type: z.literal("text"), text: z.string(), marks: z.null() })
  .strict()
  .meta({ id: "code-block-text" });
const codeBlockWireSchema = z
  .object({
    type: z.literal("codeBlock"),
    attrs: z.object({ language: z.string() }).strict().meta({ id: "code-block-attrs" }),
    content: z.array(codeBlockTextWireSchema),
  })
  .strict()
  .meta({ id: "node-code-block" });

const MERMAID_THEMES_WIRE = ["default", "base", "dark", "forest", "neutral", "monochrome"] as const;
const mermaidWireSchema = z
  .object({
    type: z.literal("mermaid"),
    attrs: z
      .object({
        source: z.string(),
        theme: z.enum(MERMAID_THEMES_WIRE),
        primaryColor: z.string().nullable(),
        width: z.number().nullable(),
      })
      .strict()
      .meta({ id: "mermaid-attrs" }),
  })
  .strict()
  .meta({ id: "node-mermaid" });
const functionPlotCurveWireSchema = z
  .object({
    formula: z.string(),
    color: z.string(),
    dash: z.enum(["solid", "dashed", "dotted", "dash-dot"]),
    thickness: z.number(),
  })
  .strict()
  .meta({ id: "function-plot-curve" });
const functionPlotWireSchema = z
  .object({
    type: z.literal("functionPlot"),
    attrs: z
      .object({
        curves: z.array(functionPlotCurveWireSchema).max(AI_EDIT_LIMITS.maxFunctionCurves),
        xMin: z.number(),
        xMax: z.number(),
        showGridlines: z.boolean(),
        showAxisTicks: z.boolean(),
      })
      .strict()
      .meta({ id: "function-plot-attrs" }),
  })
  .strict()
  .meta({ id: "node-function-plot" });

const categoricalEntryWireSchema = z
  .object({ label: z.string(), value: z.number(), color: z.string().nullable() })
  .strict()
  .meta({ id: "chart-categorical-entry" });
const stackedEntryWireSchema = z
  .object({ label: z.string(), values: z.array(z.number()) })
  .strict()
  .meta({ id: "chart-stacked-entry" });
const scatterEntryWireSchema = z.object({ x: z.number(), y: z.number() }).strict().meta({ id: "chart-scatter-entry" });
const boxWhiskerEntryWireSchema = z
  .object({
    label: z.string(),
    min: z.number(),
    q1: z.number(),
    median: z.number(),
    q3: z.number(),
    max: z.number(),
  })
  .strict()
  .meta({ id: "chart-box-whisker-entry" });
const chartFontFamilyWireSchema = z.enum(["sans", "serif"]);
const axisLabelWireShape = { xLabel: z.string(), yLabel: z.string(), yLabelRotated: z.boolean() };
const chartSizeWireShape = { width: z.number().nullable(), height: z.number().nullable() };
const chartCaptionWireShape = { caption: z.string().nullable() };

const barLikeChartWireSchema = (chartType: "bar" | "column") =>
  z
    .object({
      chartType: z.literal(chartType),
      data: z.array(categoricalEntryWireSchema),
      showValues: z.boolean(),
      showGridLines: z.boolean(),
      showBorder: z.boolean(),
      fontFamily: chartFontFamilyWireSchema,
      ...axisLabelWireShape,
      ...chartSizeWireShape,
      ...chartCaptionWireShape,
    })
    .strict()
    .meta({ id: `chart-${chartType}` });
const stackedChartWireSchema = (chartType: "stackedBar" | "stackedColumn") =>
  z
    .object({
      chartType: z.literal(chartType),
      data: z.array(stackedEntryWireSchema),
      seriesLabels: z.array(z.string()),
      seriesColors: z.array(z.string()).nullable(),
      showLegend: z.boolean(),
      showGridLines: z.boolean(),
      showBorder: z.boolean(),
      fontFamily: chartFontFamilyWireSchema,
      ...axisLabelWireShape,
      ...chartSizeWireShape,
      ...chartCaptionWireShape,
    })
    .strict()
    .meta({ id: `chart-${chartType}` });
const lineChartWireSchema = z
  .object({
    chartType: z.literal("line"),
    data: z.array(categoricalEntryWireSchema),
    fontFamily: chartFontFamilyWireSchema,
    ...axisLabelWireShape,
    ...chartSizeWireShape,
    ...chartCaptionWireShape,
  })
  .strict()
  .meta({ id: "chart-line" });
const scatterChartWireSchema = z
  .object({
    chartType: z.literal("scatter"),
    data: z.array(scatterEntryWireSchema),
    fontFamily: chartFontFamilyWireSchema,
    trendLine: z.enum(["none", "linear", "lowess"]),
    trendLineColor: z.string(),
    showGridLines: z.boolean(),
    ...axisLabelWireShape,
    ...chartSizeWireShape,
    ...chartCaptionWireShape,
  })
  .strict()
  .meta({ id: "chart-scatter" });
const pieChartWireSchema = z
  .object({
    chartType: z.literal("pie"),
    data: z.array(categoricalEntryWireSchema),
    showLegend: z.boolean(),
    showPercentage: z.enum(["none", "onSlice", "beside"]),
    fontFamily: chartFontFamilyWireSchema,
    ...chartSizeWireShape,
    ...chartCaptionWireShape,
  })
  .strict()
  .meta({ id: "chart-pie" });
const boxwhiskerChartWireSchema = z
  .object({
    chartType: z.literal("boxwhisker"),
    data: z.array(boxWhiskerEntryWireSchema),
    fontFamily: chartFontFamilyWireSchema,
    ...chartSizeWireShape,
    ...chartCaptionWireShape,
  })
  .strict()
  .meta({ id: "chart-boxwhisker" });
const statsChartAttrsWireSchema = z
  .discriminatedUnion("chartType", [
    barLikeChartWireSchema("bar"),
    barLikeChartWireSchema("column"),
    stackedChartWireSchema("stackedBar"),
    stackedChartWireSchema("stackedColumn"),
    lineChartWireSchema,
    scatterChartWireSchema,
    pieChartWireSchema,
    boxwhiskerChartWireSchema,
  ])
  .meta({ id: "stats-chart-attrs" });
const statsChartWireSchema = z
  .object({ type: z.literal("statsChart"), attrs: statsChartAttrsWireSchema })
  .strict()
  .meta({ id: "node-stats-chart" });

const atomicBlockWireSchema = z
  .discriminatedUnion("type", [
    paragraphWireSchema,
    headingWireSchema,
    horizontalRuleWireSchema,
    blockMathWireSchema,
    codeBlockWireSchema,
    mermaidWireSchema,
    functionPlotWireSchema,
    statsChartWireSchema,
  ])
  .meta({ id: "atomic-block" });

// --- Tier 1: list container (content: ATOMIC only, one level) -----------

const listItemWireSchema = z
  .object({ type: z.literal("listItem"), content: z.array(atomicBlockWireSchema).min(1) })
  .strict()
  .meta({ id: "node-list-item" });
const bulletListWireSchema = z
  .object({ type: z.literal("bulletList"), content: z.array(listItemWireSchema).min(1) })
  .strict()
  .meta({ id: "node-bullet-list" });
const orderedListWireSchema = z
  .object({
    type: z.literal("orderedList"),
    attrs: z.object({ start: z.number().nullable() }).strict().nullable().meta({ id: "ordered-list-attrs" }),
    content: z.array(listItemWireSchema).min(1),
  })
  .strict()
  .meta({ id: "node-ordered-list" });

// --- Tier 1: "container child" — ATOMIC blocks, used by blockquote/
// callout/proof/tableHeader/tableCell (content: ATOMIC only) -------------

const containerChildWireSchema = atomicBlockWireSchema;

const blockquoteWireSchema = z
  .object({
    type: z.literal("blockquote"),
    attrs: z
      .object({ author: z.string().nullable(), source: z.string().nullable() })
      .strict()
      .nullable()
      .meta({ id: "blockquote-attrs" }),
    content: z.array(containerChildWireSchema).min(1),
  })
  .strict()
  .meta({ id: "node-blockquote" });

const CALLOUT_KINDS_WIRE = [
  "note",
  "abstract",
  "info",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
] as const;
// callout.attrs.title is REQUIRED-but-nullable canonically (not optional) —
// see the normalizer's header comment; same treatment as textStyle.color.
const calloutWireSchema = z
  .object({
    type: z.literal("callout"),
    attrs: z
      .object({ kind: z.enum(CALLOUT_KINDS_WIRE), title: z.string().nullable() })
      .strict()
      .meta({ id: "callout-attrs" }),
    content: z.array(containerChildWireSchema).min(1),
  })
  .strict()
  .meta({ id: "node-callout" });
const proofWireSchema = z
  .object({ type: z.literal("proof"), content: z.array(containerChildWireSchema).min(1) })
  .strict()
  .meta({ id: "node-proof" });

const tableCellAttrsWireSchema = z
  .object({
    colspan: z.number(),
    rowspan: z.number(),
    colwidth: z.array(z.number()).nullable(),
    fill: z.string().nullable(),
    stroke: z.string().nullable(),
    inset: z.string().nullable(),
    breakable: z.boolean().nullable(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).nullable(),
  })
  .strict()
  .meta({ id: "table-cell-attrs" });
const tableHeaderWireSchema = z
  .object({
    type: z.literal("tableHeader"),
    attrs: tableCellAttrsWireSchema,
    content: z.array(containerChildWireSchema).min(1),
  })
  .strict()
  .meta({ id: "node-table-header" });
const tableCellWireSchema = z
  .object({
    type: z.literal("tableCell"),
    attrs: tableCellAttrsWireSchema,
    content: z.array(containerChildWireSchema).min(1),
  })
  .strict()
  .meta({ id: "node-table-cell" });
const tableRowWireSchema = z
  .object({
    type: z.literal("tableRow"),
    attrs: z.object({ rowHeight: z.number().nullable() }).strict().nullable().meta({ id: "table-row-attrs" }),
    content: z.array(z.union([tableHeaderWireSchema, tableCellWireSchema])).min(1),
  })
  .strict()
  .meta({ id: "node-table-row" });
const tableWireSchema = z
  .object({
    type: z.literal("table"),
    attrs: z
      .object({
        caption: z.string().nullable(),
        variant: z.enum(["normal", "three-line"]).nullable(),
        align: z.enum(["left", "center", "right"]).nullable(),
        localRef: z.string().nullable(),
      })
      .strict()
      .nullable()
      .meta({ id: "table-attrs" }),
    content: z.array(tableRowWireSchema).min(1),
  })
  .strict()
  .meta({ id: "node-table" });

const footnoteBodyWireSchema = z.union([paragraphWireSchema, blockMathWireSchema]).meta({ id: "footnote-body" });
const footnoteWireSchema = z
  .object({
    type: z.literal("footnote"),
    attrs: z.object({ localRef: z.string() }).strict().meta({ id: "footnote-attrs" }),
    content: z.array(footnoteBodyWireSchema).min(1),
  })
  .strict()
  .meta({ id: "node-footnote" });
const footnotesWireSchema = z
  .object({ type: z.literal("footnotes"), content: z.array(footnoteWireSchema).min(1) })
  .strict()
  .meta({ id: "node-footnotes" });

// --- Flattened "question" wire node --------------------------------------
//
// Mirrors openai-model-payload.ts's own `expandProviderQuestionWire`
// convention exactly ("each wire question represents one item. Emit
// multiple questions as multiple wire question blocks."): the real
// canonical AST nests question > questionItem > choiceList > choiceItem;
// the wire shape flattens all four into one node so the model never has to
// reason about that nesting, and openai-edit-operations-normalizer.ts
// expands it back before calling parseEditOperationsV1.
const QUESTION_KINDS_WIRE = ["single", "multi", "written"] as const;
const WRITTEN_MODES_WIRE = ["lines", "blank"] as const;
const questionWireSchema = z
  .object({
    type: z.literal("question"),
    kind: z.enum(QUESTION_KINDS_WIRE),
    writtenMode: z.enum(WRITTEN_MODES_WIRE),
    writtenLines: z.number(),
    writtenHeightPercent: z.number(),
    writtenHeightCm: z.number().nullable(),
    multiForceOneColumn: z.boolean(),
    localRef: z.string().nullable(),
    body: z.array(containerChildWireSchema).min(1),
    choices: z.array(footnoteBodyWireSchema).min(2).nullable(),
  })
  .strict()
  .meta({ id: "node-question" });

// --- Top-level "any node" wire union (insertNode/replaceNode payload) ----

const blockNodeWireSchema = z
  .discriminatedUnion("type", [
    paragraphWireSchema,
    headingWireSchema,
    horizontalRuleWireSchema,
    blockMathWireSchema,
    codeBlockWireSchema,
    mermaidWireSchema,
    functionPlotWireSchema,
    statsChartWireSchema,
    listItemWireSchema,
    bulletListWireSchema,
    orderedListWireSchema,
    blockquoteWireSchema,
    calloutWireSchema,
    proofWireSchema,
    tableHeaderWireSchema,
    tableCellWireSchema,
    tableRowWireSchema,
    tableWireSchema,
    footnoteWireSchema,
    footnotesWireSchema,
    questionWireSchema,
  ])
  .meta({ id: "block-node" });

const anyNodeWireSchema = z.union([blockNodeWireSchema, inlineNodeWireSchema]).meta({ id: "any-node" });

// --- updateAttrs per-node-type patch shapes -----------------------------
//
// Every field here is nullable AND, semantically, always optional (a patch
// only ever touches a SUBSET of a node's attrs) — including title/
// writtenHeightCm/color, which are required-but-nullable on the FULL node
// but genuinely optional-and-nullable on a PATCH (Partial<...> makes every
// field optional, so a patch's own `null` uniformly means "leave this field
// untouched", never "clear this field to null"; see the normalizer's header
// comment for why this narrow limitation is the intentional, documented
// judgment call rather than an oversight).
const headingPatchAttrsWireSchema = z
  .object({ level: headingLevelWireSchema.nullable(), localRef: z.string().nullable() })
  .strict();
const orderedListPatchAttrsWireSchema = z.object({ start: z.number().nullable() }).strict();
const blockquotePatchAttrsWireSchema = z
  .object({ author: z.string().nullable(), source: z.string().nullable() })
  .strict();
const codeBlockPatchAttrsWireSchema = z.object({ language: z.string().nullable() }).strict();
const blockMathPatchAttrsWireSchema = z
  .object({ latex: z.string().nullable(), refName: z.string().nullable(), localRef: z.string().nullable() })
  .strict();
const horizontalRulePatchAttrsWireSchema = z
  .object({ thicknessPt: z.number().nullable(), lineStyle: dividerLineStyleWireSchema.nullable() })
  .strict();
const inlineMathPatchAttrsWireSchema = z.object({ latex: z.string().nullable() }).strict();
const calloutPatchAttrsWireSchema = z
  .object({ kind: z.enum(CALLOUT_KINDS_WIRE).nullable(), title: z.string().nullable() })
  .strict();
const questionItemPatchAttrsWireSchema = z
  .object({
    kind: z.enum(QUESTION_KINDS_WIRE).nullable(),
    writtenMode: z.enum(WRITTEN_MODES_WIRE).nullable(),
    writtenLines: z.number().nullable(),
    writtenHeightPercent: z.number().nullable(),
    writtenHeightCm: z.number().nullable(),
    multiForceOneColumn: z.boolean().nullable(),
    localRef: z.string().nullable(),
  })
  .strict();
const tablePatchAttrsWireSchema = z
  .object({
    caption: z.string().nullable(),
    variant: z.enum(["normal", "three-line"]).nullable(),
    align: z.enum(["left", "center", "right"]).nullable(),
    localRef: z.string().nullable(),
  })
  .strict();
const tableRowPatchAttrsWireSchema = z.object({ rowHeight: z.number().nullable() }).strict();
const tableCellPatchAttrsWireSchema = z
  .object({
    colspan: z.number().nullable(),
    rowspan: z.number().nullable(),
    colwidth: z.array(z.number()).nullable(),
    fill: z.string().nullable(),
    stroke: z.string().nullable(),
    inset: z.string().nullable(),
    breakable: z.boolean().nullable(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).nullable(),
  })
  .strict();
const footnotePatchAttrsWireSchema = z.object({ localRef: z.string().nullable() }).strict();
const crossRefPatchAttrsWireSchema = z.object({ targetRef: z.string().nullable() }).strict();
const footnoteReferencePatchAttrsWireSchema = z.object({ targetRef: z.string().nullable() }).strict();
const questionBlankPatchAttrsWireSchema = z.object({ targetRef: z.string().nullable() }).strict();
const mermaidPatchAttrsWireSchema = z
  .object({
    source: z.string().nullable(),
    theme: z.enum(MERMAID_THEMES_WIRE).nullable(),
    primaryColor: z.string().nullable(),
    width: z.number().nullable(),
  })
  .strict();
const functionPlotPatchAttrsWireSchema = z
  .object({
    curves: z.array(functionPlotCurveWireSchema).nullable(),
    xMin: z.number().nullable(),
    xMax: z.number().nullable(),
    showGridlines: z.boolean().nullable(),
    showAxisTicks: z.boolean().nullable(),
  })
  .strict();

const barLikeChartPatchWireSchema = (chartType: "bar" | "column") =>
  z
    .object({
      chartType: z.literal(chartType),
      data: z.array(categoricalEntryWireSchema).nullable(),
      showValues: z.boolean().nullable(),
      showGridLines: z.boolean().nullable(),
      showBorder: z.boolean().nullable(),
      fontFamily: chartFontFamilyWireSchema.nullable(),
      xLabel: z.string().nullable(),
      yLabel: z.string().nullable(),
      yLabelRotated: z.boolean().nullable(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      caption: z.string().nullable(),
    })
    .strict();
const stackedChartPatchWireSchema = (chartType: "stackedBar" | "stackedColumn") =>
  z
    .object({
      chartType: z.literal(chartType),
      data: z.array(stackedEntryWireSchema).nullable(),
      seriesLabels: z.array(z.string()).nullable(),
      seriesColors: z.array(z.string()).nullable(),
      showLegend: z.boolean().nullable(),
      showGridLines: z.boolean().nullable(),
      showBorder: z.boolean().nullable(),
      fontFamily: chartFontFamilyWireSchema.nullable(),
      xLabel: z.string().nullable(),
      yLabel: z.string().nullable(),
      yLabelRotated: z.boolean().nullable(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      caption: z.string().nullable(),
    })
    .strict();
const lineChartPatchWireSchema = z
  .object({
    chartType: z.literal("line"),
    data: z.array(categoricalEntryWireSchema).nullable(),
    fontFamily: chartFontFamilyWireSchema.nullable(),
    xLabel: z.string().nullable(),
    yLabel: z.string().nullable(),
    yLabelRotated: z.boolean().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    caption: z.string().nullable(),
  })
  .strict();
const scatterChartPatchWireSchema = z
  .object({
    chartType: z.literal("scatter"),
    data: z.array(scatterEntryWireSchema).nullable(),
    fontFamily: chartFontFamilyWireSchema.nullable(),
    trendLine: z.enum(["none", "linear", "lowess"]).nullable(),
    trendLineColor: z.string().nullable(),
    showGridLines: z.boolean().nullable(),
    xLabel: z.string().nullable(),
    yLabel: z.string().nullable(),
    yLabelRotated: z.boolean().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    caption: z.string().nullable(),
  })
  .strict();
const pieChartPatchWireSchema = z
  .object({
    chartType: z.literal("pie"),
    data: z.array(categoricalEntryWireSchema).nullable(),
    showLegend: z.boolean().nullable(),
    showPercentage: z.enum(["none", "onSlice", "beside"]).nullable(),
    fontFamily: chartFontFamilyWireSchema.nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    caption: z.string().nullable(),
  })
  .strict();
const boxwhiskerChartPatchWireSchema = z
  .object({
    chartType: z.literal("boxwhisker"),
    data: z.array(boxWhiskerEntryWireSchema).nullable(),
    fontFamily: chartFontFamilyWireSchema.nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    caption: z.string().nullable(),
  })
  .strict();

const statsChartPatchAttrsWireSchema = z
  .discriminatedUnion("chartType", [
    barLikeChartPatchWireSchema("bar"),
    barLikeChartPatchWireSchema("column"),
    stackedChartPatchWireSchema("stackedBar"),
    stackedChartPatchWireSchema("stackedColumn"),
    lineChartPatchWireSchema,
    scatterChartPatchWireSchema,
    pieChartPatchWireSchema,
    boxwhiskerChartPatchWireSchema,
  ])
  .meta({ id: "stats-chart-patch-attrs" });

function updateAttrsVariantWireSchema<NodeType extends string>(
  nodeType: NodeType,
  attrsSchema: z.ZodTypeAny,
) {
  return z
    .object({
      type: z.literal("updateAttrs"),
      targetRef: refWireSchema,
      nodeType: z.literal(nodeType),
      attrs: attrsSchema,
    })
    .strict()
    .meta({ id: `op-update-attrs-${nodeType}` });
}

const updateAttrsOpWireSchemas = [
  updateAttrsVariantWireSchema("heading", headingPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("orderedList", orderedListPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("blockquote", blockquotePatchAttrsWireSchema),
  updateAttrsVariantWireSchema("codeBlock", codeBlockPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("blockMath", blockMathPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("horizontalRule", horizontalRulePatchAttrsWireSchema),
  updateAttrsVariantWireSchema("inlineMath", inlineMathPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("callout", calloutPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("questionItem", questionItemPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("table", tablePatchAttrsWireSchema),
  updateAttrsVariantWireSchema("tableRow", tableRowPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("tableHeader", tableCellPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("tableCell", tableCellPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("footnote", footnotePatchAttrsWireSchema),
  updateAttrsVariantWireSchema("crossRef", crossRefPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("footnoteReference", footnoteReferencePatchAttrsWireSchema),
  updateAttrsVariantWireSchema("questionBlank", questionBlankPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("mermaid", mermaidPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("functionPlot", functionPlotPatchAttrsWireSchema),
  updateAttrsVariantWireSchema("statsChart", statsChartPatchAttrsWireSchema),
];

const insertNodeOpWireSchema = z
  .object({
    type: z.literal("insertNode"),
    parentRef: refWireSchema,
    index: z.number().int().min(0),
    node: anyNodeWireSchema,
    localRef: refWireSchema.nullable(),
  })
  .strict()
  .meta({ id: "op-insert-node" });
const replaceNodeOpWireSchema = z
  .object({ type: z.literal("replaceNode"), targetRef: refWireSchema, node: anyNodeWireSchema })
  .strict()
  .meta({ id: "op-replace-node" });
const deleteNodeOpWireSchema = z
  .object({ type: z.literal("deleteNode"), targetRef: refWireSchema })
  .strict()
  .meta({ id: "op-delete-node" });
const moveNodeOpWireSchema = z
  .object({
    type: z.literal("moveNode"),
    targetRef: refWireSchema,
    newParentRef: refWireSchema,
    index: z.number().int().min(0),
  })
  .strict()
  .meta({ id: "op-move-node" });
const replaceTextOpWireSchema = z
  .object({
    type: z.literal("replaceText"),
    targetRef: refWireSchema,
    text: z.string(),
    marks: z.array(markWireSchema),
  })
  .strict()
  .meta({ id: "op-replace-text" });

const editOperationWireSchema = z
  .union([
    insertNodeOpWireSchema,
    replaceNodeOpWireSchema,
    deleteNodeOpWireSchema,
    moveNodeOpWireSchema,
    ...updateAttrsOpWireSchemas,
    replaceTextOpWireSchema,
  ])
  .meta({ id: "edit-operation" });

const editOperationsEnvelopeWireSchema = z
  .object({
    version: z.literal(AI_EDIT_OPERATIONS_V1_VERSION),
    operations: z.array(editOperationWireSchema).max(AI_EDIT_LIMITS.maxOperations),
  })
  .strict();

export const OPENAI_EDIT_OPERATIONS_SCHEMA_NAME = "anvilnote_edit_operations_v1";

const generatedEditOperationsFormat = zodTextFormat(
  editOperationsEnvelopeWireSchema,
  OPENAI_EDIT_OPERATIONS_SCHEMA_NAME,
);

export const OPENAI_EDIT_OPERATIONS_SCHEMA: Record<string, unknown> = sanitizeOpenAIStrictSchema(
  generatedEditOperationsFormat.schema,
);

// Fails at module load (import time) rather than only when a request is
// actually built — there is no per-request input that could change whether
// this fixed, build-time-known shape satisfies the strict-mode budget.
validateOpenAIStrictSchema(OPENAI_EDIT_OPERATIONS_SCHEMA);
