# AnvilNote AI Writer

`@anvilnote/ai-writer` is the provider-neutral writing package behind AnvilNote
Smart Mode. It defines browser-safe request and result contracts, a versioned
AnvilNote document AST, prompt profiles, writing policies, pricing, validation,
and trusted provider execution. OpenAI is the first supported provider.

This package is not a standalone end-user application. The AnvilNote Web, API,
and Desktop repositories provide the editor, credential boundary, persistence,
and product UI around it.

## OpenAI Build Week

AnvilNote Smart Mode was developed during OpenAI Build Week with Codex
supporting the main implementation and integration work. Codex was used for
architecture planning, provider contract design, OpenAI Responses API
integration, AST validation, test generation, integration debugging, and
security-boundary review. It did not generate the whole AnvilNote project.

GPT-5.6 models handle three current writing tasks:

- structured document composition from an instruction;
- composition using locally extracted attachment text as context;
- selected-text rewriting.

The provider uses the OpenAI Responses API and strict Structured Outputs.
Model output still passes local Zod parsing, document limits, URL checks, node
placement rules, and semantic validation before it can reach the editor.

## What Smart Mode does

In the full AnvilNote application, Smart Mode can:

- compose a structured document from an instruction;
- use extracted TXT, Markdown, text-layer PDF, or DOCX content as context;
- rewrite a selected range;
- preview every assistant draft before an editor change;
- insert a draft at the captured cursor, replace the whole document, or accept
  and reject a selection rewrite;
- cancel an in-flight request and use normal editor history to undo an applied
  change;
- estimate tokens and cost before execution;
- use a person's own OpenAI API key through trusted application boundaries.

Smart Mode does not silently write to the document database. Applying a draft
is always a separate user action in the product UI.

## Architecture

The package keeps provider details away from the public document contract:

```text
Web editor
  -> AnvilNote AST
  -> AnvilNote API
  -> AI Writer
  -> OpenAI Responses API
  -> provider wire validation
  -> public AST and semantic validation
  -> preview
  -> user-approved editor transaction
```

Browser-safe consumers import `@anvilnote/ai-writer/contracts`,
`@anvilnote/ai-writer/document`, or `@anvilnote/ai-writer/pricing`. Trusted Node
runtimes import `@anvilnote/ai-writer/server` for prompt loading, profile
selection, provider execution, retries, usage normalization, and error mapping.
Only the server export reaches the OpenAI SDK or prompt and policy assets.

### Writing configuration

- A **prompt template** describes one stable task: common constraints,
  composition, attachment-assisted composition, or selection rewrite.
- A **writing policy** adds a versioned constraint such as factual integrity,
  protected-content preservation, document style, or Humanizer guidance.
- A **writing profile** connects an intent to its prompt, output schema,
  policies, attachment capability, and input/output limits.

Profile selection is deterministic. Selected content uses
`rewrite.selection.v1`; attachments without a selection use
`compose.from-attachments.v1`; other requests use `compose.default.v1`.
Domain validation rejects inconsistent intent and context combinations before
provider execution.

`auto` writing style resolves academic, legal, technical, and reference
documents to neutral; handouts and notes to restrained natural; blogs and
essays to natural; and selection rewrites to preserve-source. Humanizer policies
aim to reduce stiff or formulaic patterns. They do not promise or target AI
detector evasion.

### Document boundary

The public AST supports paragraphs, headings, lists, blockquotes, code, math,
tables, horizontal rules, safe links, registered text marks, Callouts,
Proof/QED, and the `single`, `multi`, and `written` Question kinds. Proof labels
and the terminal QED square are rendered by the product, not authored by the
model. Image choices and statistics-chart generation remain unsupported.

Tiptap content that is not safe to rewrite must either be represented by the
request-scoped protected-content registry or block submission. Converters may
not silently discard an unknown node, mark, or attribute.

## OpenAI provider

The server adapter uses `openai@6.48.0`, the Responses API, and Zod 4 JSON
Schema generation. Writer requests use `store: false`, `background: false`, no
tools, no previous response or provider conversation, and one request-scoped
AbortSignal. Connection tests use a separate minimal schema and do not include
document content.

The OpenAI wire schema is deliberately distinct only where strict Structured
Outputs needs an adaptation. Every object property is required and optional
domain fields become required nullable wire fields. Text marks use the same
strict discriminated mark-array representation as the public AST:

```json
{
  "type": "text",
  "text": "Important text",
  "marks": [{ "type": "bold" }]
}
```

An unmarked wire text node uses `"marks": null`. At the OpenAI response
boundary, the adapter narrowly normalizes only an omitted `marks` property on
an otherwise valid text node to `null`. The strict schema sent to OpenAI still
requires `marks`. Legacy flag objects, unknown marks, duplicate marks, unsafe
links, unexpected attributes, and every other invalid shape remain rejected.

Question is the only intentional depth adaptation: the OpenAI wire DTO uses a
shallower item with direct `body` and nullable `choices`, then the adapter
expands it to the canonical public
`question -> questionItem -> choiceList -> choiceItem` hierarchy before public
validation. No product or non-OpenAI boundary accepts that wire DTO.

Static checks require an object root, complete `required` lists,
`additionalProperties: false`, a supported-keyword allowlist, and bounded
schema size and nesting. The full local parser then enforces constraints that
are not part of the transmitted Structured Outputs subset.

After validation, trusted orchestration adds profile, prompt, schema, and policy
versions together with provider/model metadata, usage, and pricing. Those
fields are never model-authored.

The SDK client is short-lived and disables SDK retries. AnvilNote can retry at
most once for a rate limit, transient network or provider failure, timeout, or
invalid structured output. Backoff observes cancellation and `Retry-After`.
Connection tests do not retry. When all potentially billable attempt usage
cannot be proven, usage and cost remain unknown instead of understating them.

## Security and privacy

- The API key is supplied as a separate trusted credential, never inside the
  model-authored writer request.
- Provider clients are short-lived and are not cached between operations.
- Requests disable OpenAI storage, background execution, tools, previous
  response state, and provider conversation state.
- Structured output is checked at the provider boundary and again against the
  public AST and semantic rules.
- Links allow only `http:`, `https:`, and `mailto:` protocols.
- Document node, depth, text, and JSON byte limits are enforced locally.
- Protected content fails closed if placeholders are missing, changed,
  duplicated, or reordered.
- Safe diagnostics contain structural counts and normalized identifiers, not
  API keys, prompts, attachment text, selected content, raw output, or full
  document JSON.
- Automated provider tests inject fake SDK clients. They do not read
  `OPENAI_API_KEY` or make paid OpenAI requests.

## Setup

Node.js 20 or later is required.

```bash
pnpm install
pnpm build
```

## Commands

The following scripts are defined in `package.json`:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm clean
pnpm build
pnpm test:dist
pnpm verify
```

`pnpm verify` runs linting, source and test type checks, source tests, a clean
build, and distribution tests for assets and package exports.

## Testing Smart Mode in the full application

Keep the repositories as siblings:

```text
parent-folder/
  anvilnote-ai-writer/
  anvilnote-api/
  anvilnote-web/
  anvilnote-desktop/
  anvilnote-renderer/
  anvilnote-docx-exporter/
```

Build AI Writer before refreshing the API file dependency:

```bash
cd anvilnote-ai-writer
pnpm install
pnpm build

cd ../anvilnote-api
pnpm install
make dev
```

In another terminal, start Web:

```bash
cd anvilnote-web
pnpm install
make dev
```

Then:

1. Open Settings and the AI section.
2. Select OpenAI and a supported GPT-5.6 model.
3. Enter your own OpenAI API key and run the connection test.
4. Open a document and launch Smart Mode.
5. Generate a short structured document and review the preview.
6. Insert or replace the draft, then use Undo.
7. Select text, request a rewrite, and accept or reject the proposal.

For hot reload with persistent encrypted Desktop key profiles, run
`make dev-hot` from `anvilnote-desktop` instead of opening Web directly in a
browser. Direct browser development keeps the key only for the current tab.

OpenAI API usage may incur charges on the user's OpenAI account. No shared key
is provided, and unit tests require no real API key.

## Related repositories

- [AnvilNote project overview](https://github.com/AnvilNote/anvilnote)
- [AnvilNote Web](https://github.com/AnvilNote/anvilnote-web)
- [AnvilNote API](https://github.com/AnvilNote/anvilnote-api)
- [AnvilNote Desktop](https://github.com/AnvilNote/anvilnote-desktop)
- [AnvilNote Renderer](https://github.com/AnvilNote/anvilnote-renderer)
- [AnvilNote DOCX Exporter](https://github.com/AnvilNote/anvilnote-docx-exporter)

## Limitations

- OpenAI is the first and currently only provider adapter.
- Smart Mode requires network access and the user's own OpenAI API key.
- Attachments provide extracted text context only. There is no OCR or image
  understanding.
- Unsupported or lossy editor nodes block rewriting rather than being dropped.
- Continue-writing and arbitrary paragraph targeting are not part of the
  current public contracts.

## License and third-party notices

This package is licensed under the [MIT License](LICENSE). Humanizer policy
sources, revisions, licenses, and adapted files are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
