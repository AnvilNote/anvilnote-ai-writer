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

test("callout accepts every canonical kind and lossless child content", () => {
  const kinds = [
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
  for (const kind of kinds) {
    const result = AnvilNoteDocumentV1Schema.safeParse({
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { kind, title: kind === "note" ? null : "A useful title" },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "For " },
                { type: "inlineMath", attrs: { latex: "0 < |x-a| < delta" } },
              ],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Check the bound" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "codeBlock",
              attrs: { language: "text" },
              content: [{ type: "text", text: "epsilon > 0" }],
            },
            { type: "mathBlock", attrs: { latex: "L = M" } },
          ],
        },
      ],
    });
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  }
});

test("callout rejects unknown attrs, kinds, titles, and illegal child blocks", () => {
  const invalidAttrs = [
    { kind: "future", title: null },
    { kind: "tip", title: "" },
    { kind: "tip", title: null, icon: "sparkles" },
  ];
  for (const attrs of invalidAttrs) {
    assert.equal(
      AnvilNoteDocumentV1Schema.safeParse({
        schemaVersion: "anvilnote.document.v1",
        type: "doc",
        content: [
          {
            type: "callout",
            attrs,
            content: [{ type: "paragraph", content: [] }],
          },
        ],
      }).success,
      false,
    );
  }

  for (const child of [
    { type: "heading", attrs: { level: 2 }, content: [] },
    { type: "blockquote", content: [{ type: "paragraph", content: [] }] },
    { type: "horizontalRule" },
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
          ],
        },
      ],
    },
  ]) {
    assert.equal(
      AnvilNoteDocumentV1Schema.safeParse({
        schemaVersion: "anvilnote.document.v1",
        type: "doc",
        content: [
          {
            type: "callout",
            attrs: { kind: "tip", title: "Tip" },
            content: [child],
          },
        ],
      }).success,
      false,
    );
  }
});

test("callout titles count toward document text limits", () => {
  const content = Array.from({ length: 251 }, () => ({
    type: "callout",
    attrs: { kind: "note", title: "x".repeat(1_000) },
    content: [{ type: "paragraph", content: [] }],
  }));
  assert.equal(
    AnvilNoteDocumentV1Schema.safeParse({
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content,
    }).success,
    false,
  );
});

test("proof accepts canonical QED content without authored decorations", () => {
  const result = AnvilNoteDocumentV1Schema.safeParse({
    schemaVersion: "anvilnote.document.v1",
    type: "doc",
    content: [
      {
        type: "proof",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "For " },
              { type: "inlineMath", attrs: { latex: "0 < |x-a| < delta" } },
              { type: "text", text: ", choose the smaller bound." },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Apply the hypothesis." }],
                  },
                ],
              },
            ],
          },
          { type: "mathBlock", attrs: { latex: "L = M" } },
        ],
      },
    ],
  });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("proof rejects attrs and unsupported child blocks", () => {
  for (const proof of [
    {
      type: "proof",
      attrs: { label: "Proof" },
      content: [{ type: "paragraph", content: [] }],
    },
    {
      type: "proof",
      content: [{ type: "heading", attrs: { level: 2 }, content: [] }],
    },
    {
      type: "proof",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [] }],
        },
      ],
    },
  ]) {
    assert.equal(
      AnvilNoteDocumentV1Schema.safeParse({
        schemaVersion: "anvilnote.document.v1",
        type: "doc",
        content: [proof],
      }).success,
      false,
    );
  }
});

const questionAttrs = {
  writtenMode: "lines",
  writtenLines: 3,
  writtenHeightPercent: 20,
  writtenHeightCm: null,
  multiForceOneColumn: true,
} as const;

function choiceList(...choices: Array<Record<string, unknown>>) {
  return {
    type: "choiceList",
    content: choices.map((choice) => ({ type: "choiceItem", content: [choice] })),
  };
}

test("question accepts single, multi, and written items", () => {
  const result = AnvilNoteDocumentV1Schema.safeParse({
    schemaVersion: "anvilnote.document.v1",
    type: "doc",
    content: [
      {
        type: "question",
        content: [
          {
            type: "questionItem",
            attrs: { ...questionAttrs, kind: "single" },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Which statement is true?" }],
              },
              choiceList(
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "The limit is " },
                    { type: "inlineMath", attrs: { latex: "L" } },
                  ],
                },
                { type: "mathBlock", attrs: { latex: "L = M" } },
              ),
            ],
          },
          {
            type: "questionItem",
            attrs: {
              ...questionAttrs,
              kind: "multi",
              multiForceOneColumn: false,
            },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Select all." }] },
              choiceList(
                { type: "paragraph", content: [{ type: "text", text: "A" }] },
                { type: "paragraph", content: [{ type: "text", text: "B" }] },
              ),
            ],
          },
          {
            type: "questionItem",
            attrs: { ...questionAttrs, kind: "written" },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Explain why." }] },
            ],
          },
          {
            type: "questionItem",
            attrs: {
              ...questionAttrs,
              kind: "written",
              writtenMode: "blank",
              writtenHeightPercent: 35,
              writtenHeightCm: 8.4,
            },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Show your work." }] },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("question rejects kind/content mismatches and malformed choices", () => {
  const body = { type: "paragraph", content: [{ type: "text", text: "Prompt" }] };
  const choices = choiceList(
    { type: "paragraph", content: [{ type: "text", text: "A" }] },
    { type: "paragraph", content: [{ type: "text", text: "B" }] },
  );
  const invalidItems = [
    { attrs: { ...questionAttrs, kind: "single" }, content: [body] },
    { attrs: { ...questionAttrs, kind: "written" }, content: [body, choices] },
    { attrs: { ...questionAttrs, kind: "future" }, content: [body, choices] },
    {
      attrs: { ...questionAttrs, kind: "single", unexpected: true },
      content: [body, choices],
    },
    {
      attrs: { ...questionAttrs, kind: "single", writtenLines: 0 },
      content: [body, choices],
    },
    {
      attrs: { ...questionAttrs, kind: "single" },
      content: [choices, body],
    },
    {
      attrs: { ...questionAttrs, kind: "single" },
      content: [body, choices, choices],
    },
    {
      attrs: { ...questionAttrs, kind: "single" },
      content: [
        body,
        {
          type: "choiceList",
          content: [
            {
              type: "choiceItem",
              content: [
                { type: "paragraph", content: [] },
                { type: "paragraph", content: [] },
              ],
            },
            { type: "choiceItem", content: [{ type: "paragraph", content: [] }] },
          ],
        },
      ],
    },
    {
      attrs: { ...questionAttrs, kind: "single" },
      content: [
        body,
        choiceList(
          { type: "image", attrs: { src: "data:image/png;base64,AA==" } },
          { type: "paragraph", content: [] },
        ),
      ],
    },
  ];
  for (const item of invalidItems) {
    assert.equal(
      AnvilNoteDocumentV1Schema.safeParse({
        schemaVersion: "anvilnote.document.v1",
        type: "doc",
        content: [
          {
            type: "question",
            content: [{ type: "questionItem", ...item }],
          },
        ],
      }).success,
      false,
    );
  }
});

test("container-only nodes are rejected outside their structural parent", () => {
  for (const node of [
    { type: "listItem", content: [{ type: "paragraph", content: [] }] },
    {
      type: "questionItem",
      attrs: { ...questionAttrs, kind: "written" },
      content: [{ type: "paragraph", content: [] }],
    },
    { type: "choiceList", content: [] },
    { type: "choiceItem", content: [{ type: "paragraph", content: [] }] },
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
