import assert from "node:assert/strict";
import test from "node:test";
import { parseDocumentV2 } from "../../src/document/index";

function doc(content: unknown[]) {
  return { version: 2, type: "doc", content };
}

const questionItemAttrs = {
  kind: "single",
  writtenMode: "lines",
  writtenLines: 3,
  writtenHeightPercent: 20,
  writtenHeightCm: null,
  multiForceOneColumn: true,
};

test("accepts a question hierarchy and a trailing footnotes list", () => {
  assert.doesNotThrow(() =>
    parseDocumentV2(
      doc([
        {
          type: "question",
          content: [
            {
              type: "questionItem",
              attrs: questionItemAttrs,
              content: [
                { type: "paragraph", content: [{ type: "text", text: "2 + 2?" }] },
                {
                  type: "choiceList",
                  content: [
                    { type: "choiceItem", content: [{ type: "paragraph", content: [{ type: "text", text: "4" }] }] },
                    { type: "choiceItem", content: [{ type: "paragraph", content: [{ type: "text", text: "5" }] }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "footnotes",
          content: [
            {
              type: "footnote",
              attrs: { localRef: "note-a" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Source" }] }],
            },
          ],
        },
      ]),
    ),
  );
});

test("accepts callout/proof/table with general block content and cell attrs", () => {
  const document = parseDocumentV2(
    doc([
      {
        type: "callout",
        attrs: { kind: "tip", title: "Tip" },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Careful" }] },
          {
            type: "proof",
            content: [{ type: "paragraph", content: [{ type: "text", text: "QED" }] }],
          },
        ],
      },
      {
        type: "table",
        attrs: { caption: "Values", variant: "three-line", align: "center", localRef: "tbl-1" },
        content: [
          {
            type: "tableRow",
            attrs: { rowHeight: 24 },
            content: [
              {
                type: "tableHeader",
                attrs: {
                  colspan: 1,
                  rowspan: 1,
                  colwidth: [160],
                  fill: "#336699",
                  stroke: "#000000",
                  inset: "4pt",
                  breakable: true,
                  verticalAlign: "middle",
                },
                content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }],
              },
            ],
          },
        ],
      },
    ]),
  );
  assert.equal(document.content.length, 2);
});

test("rejects an orphan choiceItem outside a choiceList", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "question",
          content: [
            {
              type: "questionItem",
              attrs: questionItemAttrs,
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Q" }] },
                { type: "choiceItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
              ],
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects an orphan choiceList outside a questionItem", () => {
  assert.throws(() => parseDocumentV2(doc([{ type: "choiceList", content: [
    { type: "choiceItem", content: [{ type: "paragraph", content: [] }] },
    { type: "choiceItem", content: [{ type: "paragraph", content: [] }] },
  ] }])));
});

test("rejects duplicate localRefs across different node kinds", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        { type: "heading", attrs: { level: 1, localRef: "dup" }, content: [{ type: "text", text: "H" }] },
        {
          type: "footnotes",
          content: [
            {
              type: "footnote",
              attrs: { localRef: "dup" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects a written question with a choiceList", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "question",
          content: [
            {
              type: "questionItem",
              attrs: { ...questionItemAttrs, kind: "written" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Explain." }] },
                {
                  type: "choiceList",
                  content: [
                    { type: "choiceItem", content: [{ type: "paragraph", content: [] }] },
                    { type: "choiceItem", content: [{ type: "paragraph", content: [] }] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects a single-choice question missing its choiceList", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "question",
          content: [
            {
              type: "questionItem",
              attrs: questionItemAttrs,
              content: [{ type: "paragraph", content: [{ type: "text", text: "Q" }] }],
            },
          ],
        },
      ]),
    ),
  );
});

test("crossRef resolves to a heading/table/blockMath/questionItem localRef", () => {
  const document = parseDocumentV2(
    doc([
      { type: "heading", attrs: { level: 1, localRef: "intro" }, content: [{ type: "text", text: "Intro" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "crossRef", attrs: { targetRef: "intro" } },
        ],
      },
    ]),
  );
  assert.equal(document.content.length, 2);
});

test("rejects a crossRef pointing at a footnote's localRef (wrong kind)", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "footnotes",
          content: [
            {
              type: "footnote",
              attrs: { localRef: "note-a" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "crossRef", attrs: { targetRef: "note-a" } }],
        },
      ]),
    ),
  );
});

test("rejects a footnoteReference pointing at a heading's localRef (wrong kind)", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        { type: "heading", attrs: { level: 1, localRef: "intro" }, content: [{ type: "text", text: "Intro" }] },
        {
          type: "paragraph",
          content: [{ type: "footnoteReference", attrs: { targetRef: "intro" } }],
        },
      ]),
    ),
  );
});

test("rejects a reference to a nonexistent localRef", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "paragraph",
          content: [{ type: "crossRef", attrs: { targetRef: "ghost" } }],
        },
      ]),
    ),
  );
});

test("footnoteReference and questionBlank and inlineBlank round-trip", () => {
  const document = parseDocumentV2(
    doc([
      {
        type: "question",
        content: [
          {
            type: "questionItem",
            attrs: { ...questionItemAttrs, localRef: "q1" },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Q" }] },
              {
                type: "choiceList",
                content: [
                  { type: "choiceItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                  { type: "choiceItem", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Answer: " },
          { type: "questionBlank", attrs: { targetRef: "q1" } },
          { type: "inlineBlank" },
          { type: "footnoteReference", attrs: { targetRef: "note-a" } },
        ],
      },
      {
        type: "footnotes",
        content: [
          {
            type: "footnote",
            attrs: { localRef: "note-a" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Detail" }] }],
          },
        ],
      },
    ]),
  );
  assert.equal(document.content.length, 3);
});

test("rejects illegal table children (non-tableRow in table, non-cell in tableRow)", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "table",
          content: [{ type: "paragraph", content: [] }],
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [{ type: "paragraph", content: [] }],
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects invalid colspan/rowspan and column-count overflow", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 0, rowspan: 1 },
                  content: [{ type: "paragraph", content: [] }],
                },
              ],
            },
          ],
        },
      ]),
    ),
  );

  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1 },
                  content: [{ type: "paragraph", content: [] }],
                },
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1 },
                  content: [{ type: "paragraph", content: [] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1 },
                  content: [{ type: "paragraph", content: [] }],
                },
              ],
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects derived attrs on crossRef/footnoteReference (resolvedKind/resolvedValue/broken)", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "paragraph",
          content: [
            {
              type: "crossRef",
              attrs: { targetRef: "intro", resolvedKind: "heading", resolvedValue: "Intro", broken: false },
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects derived attrs on questionItem (stashedChoiceJSON)", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "question",
          content: [
            {
              type: "questionItem",
              attrs: { ...questionItemAttrs, stashedChoiceJSON: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Q" }] }],
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects a question nested inside a blockquote (root-only placement)", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "blockquote",
          content: [
            {
              type: "question",
              content: [
                {
                  type: "questionItem",
                  attrs: questionItemAttrs,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Q" }] }],
                },
              ],
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects more than one footnotes node, and a footnotes node that isn't last", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "footnotes",
          content: [
            { type: "footnote", attrs: { localRef: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
          ],
        },
        {
          type: "footnotes",
          content: [
            { type: "footnote", attrs: { localRef: "b" }, content: [{ type: "paragraph", content: [{ type: "text", text: "y" }] }] },
          ],
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "footnotes",
          content: [
            { type: "footnote", attrs: { localRef: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "trailing" }] },
      ]),
    ),
  );
});
