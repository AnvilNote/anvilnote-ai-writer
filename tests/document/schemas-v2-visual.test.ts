import assert from "node:assert/strict";
import test from "node:test";
import { AI_EDIT_LIMITS, parseDocumentV2 } from "../../src/document/index";

function doc(content: unknown[]) {
  return { version: 2, type: "doc", content };
}

// The plan's own illustrative fixture used a 3-digit hex shorthand
// ("#d33") for the function-plot curve color. Judgment call (documented
// per the plan's own instruction to resolve this via real system
// behavior): anvilnote-web's function-plot-dialog.tsx builds its curve
// color from a native <input type="color"> swatch
// (`#${[r,g,b].map(...).join("")}`), which can only ever emit a 6-digit
// hex string — there is no code path by which the real editor produces or
// accepts a 3-digit color for this attr. So V2's hex validator (marks.ts's
// HEX_COLOR_V2) is 6-digit-only, and this fixture uses "#dd3333" (the
// 6-digit expansion of "#d33") instead of the plan's literal snippet.
const CURVE_COLOR = "#dd3333";

test("accepts one of every visual node type", () => {
  const document = parseDocumentV2(
    doc([
      { type: "mermaid", attrs: { source: "graph TD; A-->B", theme: "default", primaryColor: "#336699", width: 80 } },
      {
        type: "functionPlot",
        attrs: {
          curves: [{ formula: "sin(x)", color: CURVE_COLOR, dash: "solid", thickness: 2 }],
          xMin: -10,
          xMax: 10,
          showGridlines: true,
          showAxisTicks: true,
        },
      },
      {
        type: "statsChart",
        attrs: {
          chartType: "bar",
          data: [{ label: "A", value: 3 }],
          showValues: true,
          showGridLines: true,
          showBorder: false,
          width: 12,
          height: 7,
          xLabel: "Group",
          yLabel: "Value",
          yLabelRotated: true,
          fontFamily: "sans",
          caption: "Example",
        },
      },
    ]),
  );
  assert.equal(document.content.length, 3);
});

test("accepts every statsChart chartType variant", () => {
  const variants: unknown[] = [
    { chartType: "bar", data: [{ label: "A", value: 1 }], showValues: true, showGridLines: true, showBorder: true, fontFamily: "sans", xLabel: "", yLabel: "", yLabelRotated: true },
    { chartType: "column", data: [{ label: "A", value: 1 }], showValues: true, showGridLines: true, showBorder: true, fontFamily: "sans", xLabel: "", yLabel: "", yLabelRotated: true },
    {
      chartType: "stackedBar",
      data: [{ label: "A", values: [1, 2] }],
      seriesLabels: ["S1", "S2"],
      showLegend: true,
      showGridLines: true,
      showBorder: true,
      fontFamily: "sans",
      xLabel: "",
      yLabel: "",
      yLabelRotated: true,
    },
    {
      chartType: "stackedColumn",
      data: [{ label: "A", values: [1, 2] }],
      seriesLabels: ["S1", "S2"],
      seriesColors: ["#000000", "#595959"],
      showLegend: true,
      showGridLines: true,
      showBorder: true,
      fontFamily: "sans",
      xLabel: "",
      yLabel: "",
      yLabelRotated: true,
    },
    { chartType: "line", data: [{ label: "A", value: 1 }], fontFamily: "serif", xLabel: "", yLabel: "", yLabelRotated: false },
    {
      chartType: "scatter",
      data: [{ x: 1, y: 2 }],
      fontFamily: "sans",
      trendLine: "linear",
      trendLineColor: "#E3120B",
      showGridLines: true,
      xLabel: "",
      yLabel: "",
      yLabelRotated: true,
    },
    { chartType: "pie", data: [{ label: "A", value: 1 }], showLegend: true, showPercentage: "onSlice", fontFamily: "sans" },
    { chartType: "boxwhisker", data: [{ label: "A", min: 0, q1: 1, median: 2, q3: 3, max: 4 }], fontFamily: "sans" },
  ];

  for (const attrs of variants) {
    const document = parseDocumentV2(doc([{ type: "statsChart", attrs }]));
    assert.equal(document.content.length, 1);
  }
});

test("rejects a caller-supplied svg attr on every visual node", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        { type: "mermaid", attrs: { source: "graph TD", theme: "default", svg: "<svg></svg>" } },
      ]),
    ),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "functionPlot",
          attrs: {
            curves: [{ formula: "x", color: CURVE_COLOR, dash: "solid", thickness: 1 }],
            xMin: -1,
            xMax: 1,
            showGridlines: true,
            showAxisTicks: true,
            svg: "<svg></svg>",
          },
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "statsChart",
          attrs: {
            chartType: "bar",
            data: [{ label: "A", value: 1 }],
            showValues: true,
            showGridLines: true,
            showBorder: true,
            fontFamily: "sans",
            xLabel: "",
            yLabel: "",
            yLabelRotated: true,
            svg: "<svg></svg>",
          },
        },
      ]),
    ),
  );
});

test("rejects an unknown chartType", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([{ type: "statsChart", attrs: { chartType: "donut", data: [], fontFamily: "sans" } }]),
    ),
  );
});

test("rejects non-finite numbers everywhere they appear", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "functionPlot",
          attrs: {
            curves: [{ formula: "x", color: CURVE_COLOR, dash: "solid", thickness: 1 }],
            xMin: Number.NaN,
            xMax: 10,
            showGridlines: true,
            showAxisTicks: true,
          },
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "statsChart",
          attrs: {
            chartType: "bar",
            data: [{ label: "A", value: Number.POSITIVE_INFINITY }],
            showValues: true,
            showGridLines: true,
            showBorder: true,
            fontFamily: "sans",
            xLabel: "",
            yLabel: "",
            yLabelRotated: true,
          },
        },
      ]),
    ),
  );
});

test("rejects reversed or degenerate function-plot axes", () => {
  for (const [xMin, xMax] of [
    [10, -10],
    [5, 5],
  ]) {
    assert.throws(() =>
      parseDocumentV2(
        doc([
          {
            type: "functionPlot",
            attrs: {
              curves: [{ formula: "x", color: CURVE_COLOR, dash: "solid", thickness: 1 }],
              xMin,
              xMax,
              showGridlines: true,
              showAxisTicks: true,
            },
          },
        ]),
      ),
    );
  }
});

test("rejects oversized datasets beyond AI_EDIT_LIMITS", () => {
  const tooManyCurves = Array.from({ length: AI_EDIT_LIMITS.maxFunctionCurves + 1 }, () => ({
    formula: "x",
    color: CURVE_COLOR,
    dash: "solid" as const,
    thickness: 1,
  }));
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "functionPlot",
          attrs: { curves: tooManyCurves, xMin: -1, xMax: 1, showGridlines: true, showAxisTicks: true },
        },
      ]),
    ),
  );

  const tooManyPoints = Array.from({ length: AI_EDIT_LIMITS.maxChartDataPoints + 1 }, (_, index) => ({
    x: index,
    y: index,
  }));
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "statsChart",
          attrs: {
            chartType: "scatter",
            data: tooManyPoints,
            fontFamily: "sans",
            trendLine: "none",
            trendLineColor: "#E3120B",
            showGridLines: true,
            xLabel: "",
            yLabel: "",
            yLabelRotated: true,
          },
        },
      ]),
    ),
  );
});

test("rejects invalid formulas and colors", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "functionPlot",
          attrs: {
            curves: [{ formula: "", color: CURVE_COLOR, dash: "solid", thickness: 1 }],
            xMin: -1,
            xMax: 1,
            showGridlines: true,
            showAxisTicks: true,
          },
        },
      ]),
    ),
  );
  for (const color of ["#d33", "red", "#zzzzzz", "rgb(1,2,3)"]) {
    assert.throws(() =>
      parseDocumentV2(
        doc([
          {
            type: "functionPlot",
            attrs: {
              curves: [{ formula: "x", color, dash: "solid", thickness: 1 }],
              xMin: -1,
              xMax: 1,
              showGridlines: true,
              showAxisTicks: true,
            },
          },
        ]),
      ),
    );
  }
});

test("rejects mermaid attrs outside their real theme/source/width bounds", () => {
  assert.throws(() =>
    parseDocumentV2(doc([{ type: "mermaid", attrs: { source: "", theme: "default" } }])),
  );
  assert.throws(() =>
    parseDocumentV2(doc([{ type: "mermaid", attrs: { source: "graph TD", theme: "rainbow" } }])),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([{ type: "mermaid", attrs: { source: "graph TD", theme: "default", width: 0 } }]),
    ),
  );
});
