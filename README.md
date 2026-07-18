# @anvilnote/ai-writer

Provider-neutral contracts, a versioned document AST, validation, supported
model metadata, pricing, and trusted writing orchestration for AnvilNote Smart
Mode.

Browser-safe consumers use `contracts`, `document`, and `pricing`. Trusted Node
runtimes use `server` for prompt loading, profile selection, language/style
routing, and prepared writer requests. Phase 2 does not install a provider SDK
or call OpenAI.

## Writing configuration

- A **prompt template** describes a stable task: common constraints, compose,
  compose from attachments, or rewrite selection.
- A **writing policy** adds one versioned constraint, such as factual integrity,
  protected-content preservation, document style, or Humanizer rules.
- A **writing profile** connects one intent to a task prompt, output schema ID,
  required policies, attachment capabilities, and input/output limits.

Profile selection is deterministic: selected content uses
`rewrite.selection.v1`; attachments without a selection use
`compose.from-attachments.v1`; otherwise the request uses
`compose.default.v1`. Domain validation rejects inconsistent intent/context
combinations before selection.

Public compose/rewrite results carry trusted profile, prompt, schema, and
policy IDs together with their versions. Result validation rejects metadata
that does not match the result kind or selected v1 profile. Policy metadata is
limited to the registered v1 policies and must include factual integrity,
protected content, and exactly one resolved style; Humanizer is optional but
cannot be stacked. The future provider payload will contain model-authored
fields only; orchestration, not the model, adds execution metadata and usage.

`auto` writing style resolves academic, legal, technical, and reference
documents to neutral; handouts and notes to restrained natural; blogs and
essays to natural; and selection rewrites to preserve-source. Explicit styles
override this routing.

Humanizer language routing prefers `requestedOutputLocale`, then the request
locale. `zh-TW`/`zh-Hant` use the Taiwan Traditional Chinese policy, `en-*`
uses the English policy, and other locales use the language-neutral core with
fallback metadata. Mixed-language data uses one primary policy and preserves
the other language rather than stacking full language policies.

## Prompt assets

Prompt and policy Markdown is allowlisted in registries. `pnpm build` copies
only those exact registered assets from `src` to matching paths under `dist`
and removes stale Markdown assets; the loader resolves them relative to its
compiled module, never the repository or process cwd.
Only `@anvilnote/ai-writer/server` imports the loader. Browser-safe exports do
not import Node filesystem/path modules or embed prompt text.

## Protected-content integration boundary

Phase 2 applies the protected-content policy but deliberately does not rewrite
typed AST nodes into placeholders. Math, code, and safe links remain structured
AST data. During the later Web converter phase, Tiptap content that cannot be
safely model-edited will either be represented by the browser-safe,
request-scoped `ProtectedContentRegistry` or block submission with a specific
unsupported-selection error. The registry validates exact placeholder counts
before restoration and fails closed. No converter may silently discard an
unknown node, mark, or attribute.

To add a policy:

1. add a concise versioned Markdown asset under `src/policies`;
2. add explicit ID, version, locale, description, path, and provenance metadata
   to the policy registry;
3. reference it from profile or runtime policy selection;
4. add registry, content, size, and dist-packaging tests.

To add a profile, define it in `src/profiles`, register it, use only existing
prompt/policy/schema IDs, and add intent/context selection tests. Registry
validation fails on duplicate IDs, invalid versions/locales/limits, unsafe or
missing assets, unresolved references, and incompatible prompt intents.

Humanizer policies are adapted under the MIT License. Exact revisions,
copyright notices, source lineage, and adapted files are recorded in
`THIRD_PARTY_NOTICES.md`. These policies reduce formulaic writing patterns;
they do not promise or target AI-detector evasion.

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm clean
pnpm build
pnpm test:dist
```

`pnpm verify` runs lint, source and test typechecks, source tests, a clean dist
build, external-cwd asset/export tests, and a package dry-run that verifies
runtime assets are included while source tests are excluded.
