import assert from "node:assert/strict";
import test from "node:test";
import { parseDocumentV2 } from "../../src/document/index";

function doc(content: unknown[]) {
  return { version: 2, type: "doc", content };
}

test("parses a document with blockquote/paragraph/text/marks", () => {
  const document = parseDocumentV2({
    version: 2,
    type: "doc",
    content: [
      {
        type: "blockquote",
        attrs: { author: "Ada", source: "Notes" },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Read",
                marks: [
                  { type: "bold" },
                  { type: "textStyle", attrs: { color: "#336699" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(document.version, 2);
  assert.equal(document.content.length, 1);
});

test("accepts one of every core node/mark type", () => {
  const document = parseDocumentV2(
    doc([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          { type: "text", text: "Title", marks: [{ type: "italic" }] },
        ],
      },
      {
        type: "paragraph",
        attrs: { indent: 2 },
        content: [
          { type: "text", text: "Hello ", marks: [{ type: "strike" }] },
          {
            type: "text",
            text: "world",
            marks: [
              { type: "underline" },
              { type: "code" },
              {
                type: "link",
                attrs: { href: "https://example.com", title: "Ex", target: "_blank" },
              },
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
            content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }],
          },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [] }],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "typescript" },
        content: [{ type: "text", text: "const x = 1;" }],
      },
      { type: "blockMath", attrs: { latex: "E = mc^2" } },
      { type: "horizontalRule", attrs: { thicknessPt: 1.5, lineStyle: "dashed" } },
      { type: "horizontalRule" },
    ]),
  );
  assert.equal(document.content.length, 8);
});

test("rejects unknown attrs on core nodes", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([{ type: "heading", attrs: { level: 2, icon: "star" }, content: [] }]),
    ),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "blockquote",
          attrs: { author: "Ada", source: "Notes", extra: true },
          content: [{ type: "paragraph", content: [] }],
        },
      ]),
    ),
  );
});

test("rejects invalid textStyle colors", () => {
  for (const color of ["#fff", "#336699aa", "not-a-color", "rgb(1,2,3)", "336699"]) {
    assert.throws(() =>
      parseDocumentV2(
        doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x", marks: [{ type: "textStyle", attrs: { color } }] },
            ],
          },
        ]),
      ),
    );
  }
});

test("accepts a null textStyle color (explicit clear)", () => {
  const document = parseDocumentV2(
    doc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "x", marks: [{ type: "textStyle", attrs: { color: null } }] },
        ],
      },
    ]),
  );
  assert.equal(document.content.length, 1);
});

test("rejects unsafe link protocols", () => {
  for (const href of ["javascript:alert(1)", "data:text/html;base64,AAAA", "ftp://example.com/file"]) {
    assert.throws(() =>
      parseDocumentV2(
        doc([
          {
            type: "paragraph",
            content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }],
          },
        ]),
      ),
    );
  }
});

test("accepts safe link protocols", () => {
  for (const href of ["https://example.com", "http://example.com", "mailto:a@example.com"]) {
    const document = parseDocumentV2(
      doc([
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }],
        },
      ]),
    );
    assert.equal(document.content.length, 1);
  }
});

test("rejects heading level 4 (and 0)", () => {
  for (const level of [4, 0, -1, 1.5]) {
    assert.throws(() =>
      parseDocumentV2(doc([{ type: "heading", attrs: { level }, content: [] }])),
    );
  }
});

test("rejects marks on non-text nodes", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "paragraph",
          content: [
            // hardBreak carries no `marks` key at all — strict() rejects it.
            { type: "hardBreak", marks: [{ type: "bold" }] },
          ],
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "paragraph",
          content: [
            { type: "inlineMath", attrs: { latex: "x" }, marks: [{ type: "bold" }] },
          ],
        },
      ]),
    ),
  );
});

test("rejects hand-authored stable IDs on every node that could carry one", () => {
  assert.throws(() =>
    parseDocumentV2(doc([{ type: "heading", attrs: { level: 1 }, content: [], id: "h1" }])),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([{ type: "heading", attrs: { level: 1, id: "h1" }, content: [] }]),
    ),
  );
  assert.throws(() =>
    parseDocumentV2(doc([{ type: "blockMath", attrs: { latex: "x", id: "eq1" } }])),
  );
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", id: "t1" }],
        },
      ]),
    ),
  );
});

test("code-block text cannot carry marks", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "codeBlock",
          attrs: { language: "text" },
          content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }],
        },
      ]),
    ),
  );
});

test("list item must start with a paragraph", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "horizontalRule" }],
            },
          ],
        },
      ]),
    ),
  );
});

test("rejects duplicate marks on one text node", () => {
  assert.throws(() =>
    parseDocumentV2(
      doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] },
          ],
        },
      ]),
    ),
  );
});

test("rejects an unknown top-level node type", () => {
  assert.throws(() => parseDocumentV2(doc([{ type: "rawHtml", html: "<script>" }])));
});

test("rejects a malformed document envelope", () => {
  assert.throws(() => parseDocumentV2({ version: 1, type: "doc", content: [] }));
  assert.throws(() => parseDocumentV2({ version: 2, type: "fragment", content: [] }));
  assert.throws(() => parseDocumentV2({ version: 2, type: "doc" }));
});
