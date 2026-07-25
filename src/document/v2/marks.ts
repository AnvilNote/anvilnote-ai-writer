import { z } from "zod";

// Canonical AI document v2 — strict marks.
//
// This is the mark half of the "canonical AI document AST v2" (see
// capability-manifest.ts's own header comment for the full picture): a
// stricter, more complete replacement for the V1 AST (marks-v1.ts) that
// covers every mark name AnvilNote's real editor schema actually registers
// (see capability-manifest.ts's AiMarkTypeV2), so a later phase can let an
// AI model read/edit the full document. This file only defines shape +
// per-attribute validation — no edit operations, no provider wiring.

export const AI_SIMPLE_MARK_TYPES_V2 = [
  "bold",
  "italic",
  "strike",
  "underline",
  "code",
] as const;

export interface AiBoldMarkV2 {
  readonly type: "bold";
}

export interface AiItalicMarkV2 {
  readonly type: "italic";
}

export interface AiStrikeMarkV2 {
  readonly type: "strike";
}

export interface AiUnderlineMarkV2 {
  readonly type: "underline";
}

export interface AiCodeMarkV2 {
  readonly type: "code";
}

export interface AiLinkMarkV2 {
  readonly type: "link";
  readonly attrs: {
    readonly href: string;
    readonly title?: string | null;
    readonly target?: "_blank" | "_self" | null;
  };
}

export interface AiTextStyleMarkV2 {
  readonly type: "textStyle";
  readonly attrs: {
    readonly color: string | null;
  };
}

export type AiMarkV2 =
  | AiBoldMarkV2
  | AiItalicMarkV2
  | AiStrikeMarkV2
  | AiUnderlineMarkV2
  | AiCodeMarkV2
  | AiLinkMarkV2
  | AiTextStyleMarkV2;

// Shared 6-digit-only hex color validator for every V2 color attr
// (textStyle.color here; mermaid primaryColor, functionPlot curve color,
// statsChart entry/series/trendLine colors in visual-nodes.ts). Judgment
// call: anvilnote-web's own table-attributes.ts normalizeCellColor accepts
// a WIDER `/^#[0-9a-f]{3,8}$/i` (3-8 hex digits, for arbitrary
// hand-authored table-cell HTML), but every color VALUE the real editor's
// UI actually ever *produces* — the native <input type="color"> swatches in
// function-plot-dialog.tsx and stats-chart-dialog.tsx's color pickers, and
// the DEFAULT_COLOR_CYCLE/COLOR_CYCLE palettes themselves — is always a
// 6-digit hex string; browsers' native color inputs cannot emit 3/4/8-digit
// forms. Since the AI layer only ever needs to reproduce colors the real
// dialogs could have produced, V2 accepts 6-digit hex only, for every color
// attr, everywhere (not just table cells).
export const HEX_COLOR_V2 = /^#[0-9a-fA-F]{6}$/;

export function hexColorV2Schema(): z.ZodString {
  return z.string().regex(HEX_COLOR_V2, "Expected a 6-digit hex color (e.g. #336699).");
}

const simpleMarkSchemasV2 = AI_SIMPLE_MARK_TYPES_V2.map((type) =>
  z.object({ type: z.literal(type) }).strict(),
);

// Mirrors schemas.ts's V1 linkMarkSchema exactly — the protocol allowlist is
// a security property (see this task's plan text: "Use the existing V1 URL
// ... validators instead of weakening or duplicating them"), so it is
// duplicated verbatim here (not imported) to keep V1 and V2 as independent
// type namespaces per this package's "no cross-version coupling" style; if
// schemas.ts's allowlist ever changes, keep this one in sync by hand.
const ALLOWED_LINK_PROTOCOLS_V2 = new Set(["https:", "http:", "mailto:"]);

const linkMarkSchemaV2 = z
  .object({
    type: z.literal("link"),
    attrs: z
      .object({
        href: z.string().trim().min(1).max(4096),
        title: z.string().max(1024).nullable().optional(),
        target: z.enum(["_blank", "_self"]).nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((mark, context) => {
    try {
      const protocol = new URL(mark.attrs.href).protocol;
      if (!ALLOWED_LINK_PROTOCOLS_V2.has(protocol)) {
        context.addIssue({
          code: "custom",
          path: ["attrs", "href"],
          message: "Unsafe link protocol.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["attrs", "href"],
        message: "Invalid link URL.",
      });
    }
  });

const textStyleMarkSchemaV2 = z
  .object({
    type: z.literal("textStyle"),
    attrs: z
      .object({
        color: hexColorV2Schema().nullable(),
      })
      .strict(),
  })
  .strict();

export const aiMarkV2Schema: z.ZodType<AiMarkV2> = z.union([
  ...simpleMarkSchemasV2,
  linkMarkSchemaV2,
  textStyleMarkSchemaV2,
]) as z.ZodType<AiMarkV2>;
