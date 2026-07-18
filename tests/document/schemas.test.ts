import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  AI_DOCUMENT_LIMITS,
  AnvilNoteDocumentV1Schema,
  AnvilNoteDocumentFragmentV1Schema,
} from "../../src/document/index";

const validDocument = {
  schemaVersion: "anvilnote.document.v1",
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [
        { type: "text", text: "Safe heading", marks: [{ type: "bold" }] },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Read " },
        {
          type: "text",
          text: "the source",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://example.com/source",
                title: "Source",
                target: "_blank",
              },
            },
            { type: "underline" },
          ],
        },
        { type: "hardBreak" },
        { type: "inlineMath", attrs: { latex: "x^2" } },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Item" }] },
          ],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "const value = 1;" }],
    },
    { type: "mathBlock", attrs: { latex: "E = mc^2" } },
    {
      type: "table",
      attrs: { caption: "Values", variant: "normal", align: "center" },
      content: [
        {
          type: "tableRow",
          attrs: { rowHeight: 24 },
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: [160] },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "A" }] },
              ],
            },
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: [160] },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "B" }] },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          attrs: { rowHeight: null },
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 2, rowspan: 1, colwidth: [160, 160] },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Value" }],
                },
              ],
            },
          ],
        },
      ],
    },
    { type: "horizontalRule", attrs: { thicknessPt: 0.5, lineStyle: "solid" } },
    { type: "blockquote", content: [{ type: "paragraph", content: [] }] },
  ],
} as const;

test("valid document and fragment pass", () => {
  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse(validDocument).success,
    true,
  );
  assert.equal(
    AnvilNoteDocumentFragmentV1Schema.safeParse({
      schemaVersion: "anvilnote.fragment.v1",
      type: "fragment",
      content: validDocument.content,
    }).success,
    true,
  );
});

test("unknown and raw HTML nodes are rejected", () => {
  for (const node of [
    { type: "callout", content: [] },
    { type: "rawHtml", html: "<script>alert(1)</script>" },
  ]) {
    assert.equal(
      AnvilNoteDocumentV1Schema.safeParse({
        schemaVersion: "anvilnote.document.v1",
        type: "doc",
        content: [node],
      }).success,
      false,
    );
  }
});

test("container-only nodes are rejected outside their structural parent", () => {
  for (const node of [
    { type: "listItem", content: [{ type: "paragraph", content: [] }] },
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
  ]) {
    assert.equal(
      AnvilNoteDocumentV1Schema.safeParse({
        schemaVersion: "anvilnote.document.v1",
        type: "doc",
        content: [node],
      }).success,
      false,
    );
  }
});

test("invalid heading level is rejected", () => {
  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse({
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content: [{ type: "heading", attrs: { level: 4 }, content: [] }],
    }).success,
    false,
  );
});

test("malformed table geometry is rejected", () => {
  const unevenTable = {
    schemaVersion: "anvilnote.document.v1",
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 2, rowspan: 1, colwidth: [100, 100] },
                content: [{ type: "paragraph", content: [] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1, colwidth: [100] },
                content: [{ type: "paragraph", content: [] }],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(AnvilNoteDocumentV1Schema.safeParse(unevenTable).success, false);

  const escapingRowspan = structuredClone(unevenTable);
  escapingRowspan.content[0].content = [
    {
      type: "tableRow",
      content: [
        {
          type: "tableCell",
          attrs: { colspan: 1, rowspan: 2, colwidth: [100] },
          content: [{ type: "paragraph", content: [] }],
        },
      ],
    },
  ];
  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse(escapingRowspan).success,
    false,
  );
});

test("a row fully covered by a valid rowspan may contain no explicit cells", () => {
  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse({
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 2 },
                  content: [{ type: "paragraph", content: [] }],
                },
              ],
            },
            { type: "tableRow", content: [] },
          ],
        },
      ],
    }).success,
    true,
  );
});

test("unsafe links and unknown attributes are rejected", () => {
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "ftp://example.com/file",
  ]) {
    assert.equal(
      AnvilNoteDocumentV1Schema.safeParse({
        schemaVersion: "anvilnote.document.v1",
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "unsafe",
                marks: [{ type: "link", attrs: { href } }],
              },
            ],
          },
        ],
      }).success,
      false,
    );
  }

  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse({
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content: [
        { type: "paragraph", content: [], attrs: { class: "injected" } },
      ],
    }).success,
    false,
  );

  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse({
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "marked", marks: [{ type: "highlight" }] },
          ],
        },
      ],
    }).success,
    false,
  );
});

test("oversized document is rejected", () => {
  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse({
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x".repeat(AI_DOCUMENT_LIMITS.maxTextCharacters + 1),
            },
          ],
        },
      ],
    }).success,
    false,
  );
});

test("deep untrusted AST is rejected without exponential union parsing", () => {
  const workerPath = path.resolve("tests/document/deep-schema-worker.ts");
  const result = spawnSync(process.execPath, ["--import", "tsx", workerPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 1_500,
  });
  assert.equal(
    result.status,
    0,
    `deep-schema worker failed or timed out: ${result.stderr || result.stdout}`,
  );
});

test("empty text nodes are rejected because ProseMirror cannot represent them", () => {
  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse({
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
    }).success,
    false,
  );
});
