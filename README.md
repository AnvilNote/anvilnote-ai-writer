# @anvilnote/ai-writer

Provider-neutral contracts, a versioned document AST, validation, supported
model metadata, pricing, and trusted writing orchestration for AnvilNote Smart
Mode.

Browser-safe consumers use `contracts`, `document`, and `pricing`. Trusted Node
runtimes use `server` for prompt loading, profile selection, language/style
routing, prepared writer requests, and provider execution. The official OpenAI
SDK is reachable only through the `server` export. AnvilNote API consumes that
trusted export, while Web imports only the browser-safe subpaths.

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
cannot be stacked. The provider payload contains model-authored fields only;
trusted orchestration, not the model, adds execution metadata, provider usage,
and pricing.

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

Prompt preparation applies the protected-content policy but deliberately does not rewrite
typed AST nodes into placeholders. Math, code, and safe links remain structured
AST data. During the later Web converter phase, Tiptap content that cannot be
safely model-edited will either be represented by the browser-safe,
request-scoped `ProtectedContentRegistry` or block submission with a specific
unsupported-selection error. The registry validates exact placeholder counts
across structured output before exact restoration and fails closed. Provider
execution accepts that request-scoped registry without persisting it. No
converter may silently discard an
unknown node, mark, or attribute.

## OpenAI provider

The server adapter uses `openai@6.48.0`, the Responses API, and Zod 4 JSON
Schema generation. Requests set `store: false`, `background: false`, no
conversation/previous response, and an empty tools list. Writer requests use a
central low reasoning effort; the minimal connection test uses `none`.

The OpenAI wire schema is intentionally separate from the domain AST schema.
Strict Structured Outputs requires every object property to be required, so
optional AST fields use required nullable values on the wire. Provider text
marks use fixed boolean fields plus one nullable link, which makes duplicate
mark types unrepresentable. The SDK parses JSON without the helper's eager Zod
hook; allowlisted null/empty fields normalize, marks convert to the domain
array, and the result is validated again through the provider-neutral
AnvilNote AST and semantic validators. A static schema
check enforces an object root, complete `required` lists,
`additionalProperties: false`, an explicit supported-keyword allowlist, and
documented property/nesting limits. SDK-emitted draft metadata and unsupported
string-length keywords are omitted from the provider schema; the full local
Zod parser still enforces those limits after normalization. Recursive `$ref` remains
enabled because the current Structured Outputs subset supports recursion.

The provider abstraction carries a provider-neutral model payload; OpenAI owns
only its wire schema and conversion. The model authors only compose/rewrite
content fields. Trusted orchestration
adds profile, prompt, policy, provider/model, usage, and pricing metadata.
Refusal, incomplete output, malformed JSON, missing parsed output, unknown
nodes, unsafe links, and protected-placeholder violations all fail closed.

The SDK client is short-lived, receives the BYOK credential as a separate
trusted argument, and disables SDK retries. AnvilNote permits at most one retry
for rate limiting, transient network/timeout failures, or invalid structured
output; it respects Retry-After and cancellation during backoff. Connection
tests do not retry. Caller cancellation and the overall request deadline share
one request-scoped signal, and late responses are discarded.

If a retry follows an invalid output, network failure, or timeout, aggregate
usage cannot be proven from all potentially billable attempts. The returned
usage and cost are therefore unknown rather than reporting only the final
attempt and understating charges.

Responses usage is normalized without inventing missing counts. Cached input
is removed from ordinary input before applying its lower cached rate, while
reasoning tokens remain a subset of output usage rather than a second output
charge. If the provider reports cache-write tokens, pricing fails closed until
that separate billing tier is represented by the public usage contract.
Standard pricing also fails closed above 272,000 input tokens because the
provider applies a long-context multiplier beyond that threshold.

All automated provider tests use injected fake clients. They never read
`OPENAI_API_KEY` and never call a paid API.

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
