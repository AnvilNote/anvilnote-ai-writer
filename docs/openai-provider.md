# OpenAI provider boundary

Status: Implemented in Phase 3 on `feat/ai-smart-mode`

Last synchronized: 2026-07-19

## Runtime boundary

The official `openai` SDK is imported only by
`@anvilnote/ai-writer/server`. Root, contracts, document, and pricing exports
remain browser-safe. A provider execution receives the API key through a
separate `AIProviderCredential`; the domain writer request never contains a
credential. The short-lived SDK client sets its own retry count to zero and is
not cached between executions.

## Responses request

Every writer request uses the Responses API with:

- an allowlisted OpenAI model;
- ordered system/developer/user message sections from prompt preparation;
- strict `text.format` JSON Schema;
- `store: false` and `background: false`;
- no tools, conversation, previous response, Files API, or persistent state;
- a fixed output limit and disabled automatic truncation;
- one request-scoped AbortSignal and overall deadline.

The connection test sends a separate minimal `{ "status": "ok" }` schema to
the selected model. It has no user document, attachment, selection, or
Humanizer content and does not retry. It is a real provider request when called
by the trusted API/Desktop integration and may incur a very small charge.

## Strict schema adapter

OpenAI SDK 6.48.0 provides the Responses types and Zod schema generator. The
provider does not pass the domain AST schema directly: strict Structured
Outputs requires all object fields to be required, while the domain AST has
meaningful optional fields.

The wire representation therefore makes optional fields required and nullable.
Text marks use the same discriminated mark-array representation as the public
AST; `null` means an unmarked text node. At the provider boundary, only the
observed omission of `marks` on an otherwise valid text node is normalized to
`null`; legacy flag objects and every other malformed mark shape remain
invalid. Callout and Proof use their canonical public node shapes. Question is
the one intentional depth adaptation: each OpenAI wire `question` represents
one item with flattened semantic fields, direct `body`, and nullable `choices`.
The adapter expands it into the public
`question → questionItem → choiceList → choiceItem` hierarchy before the full
public semantic validator runs. The SDK first parses JSON; the adapter
normalizes only these allowlisted values and always runs local Zod, AST
whitelist, URL, table, Question placement/kind, depth, node, and document-size
validation. Recursive block nodes remain recursive through `$ref`. Before
sending, the adapter removes SDK-emitted draft metadata and
string-length keywords outside the provider subset. The helper's hidden eager
Zod parse hook is excluded because normalization must precede the complete
local contract. Static tests
use an explicit supported-keyword allowlist and enforce an object root, full
required lists, `additionalProperties: false`, at most 5,000 properties, and at
most 10 schema nesting levels.

Trusted output instructions distinguish Callout from quotation, Proof/QED from
ordinary prose, all three Question kinds, and inline from display math. Proof
labels/QED squares are never model-authored. Choice questions require at least
two paragraph or math choices; written questions require `choices: null`.
Image choices and statistics-chart generation are not in the wire schema.

## Trust assembly

The compose model payload contains only title suggestion, document, summary,
and warnings. The rewrite payload contains only replacement fragment, change
summary, preserved elements, and warnings. Model-authored payload schemas reject
usage, provider/model IDs, prices, profile/prompt/policy versions, request IDs,
and extra fields.

`AIProviderAdapter` carries this model-authored payload through a
provider-neutral orchestration type. OpenAI-specific code owns only its strict
wire representation, parsing, and normalization.

After local validation, trusted orchestration adds:

- profile, prompt, schema, and policy versions from the prepared request;
- provider and model from the registered adapter execution;
- normalized usage from the Responses API;
- estimated actual cost from the versioned pricing registry.

The final public compose/rewrite result schema runs once more. Provider/model or
usage metadata mismatches fail closed.

## Failure, retry, and cancellation

Normalized errors distinguish invalid key, permission, credit, model, rate,
context length, invalid request schema, invalid structured output, refusal,
incomplete response, timeout, caller cancellation, network, and provider
failures. Raw SDK errors, prompts, credentials, attachments, selected content,
and response bodies are never exposed.

Only diagnostic IDs matching the expected OpenAI request/response ID shape are
eligible for logs or results, and values resembling API keys are rejected. The
successful execution path prefers the SDK's `_request_id` instead of treating
the response resource ID as an HTTP request ID.

Only rate limits, transient network/timeouts, HTTP 408/409/5xx provider
failures, and invalid structured output can retry, at most once. Retry-After
takes precedence over the small exponential
backoff and jitter. Backoff is abortable. A request cancelled before execution
never reaches the SDK; a response arriving after cancellation or deadline is
discarded.

When a retry follows an invalid output, network, timeout, or transient provider
failure, usage from
every potentially billable attempt cannot be proven. The successful result
therefore reports unknown usage and cost instead of presenting only the final
attempt as the operation total. A pure rate-limit retry retains final usage
because no model output was produced by the rejected attempt.

## Usage and pricing

Responses usage maps input, cached input, output, reasoning, and total tokens.
Missing usage remains null/undefined. Invalid negative, subset, or total
relationships produce no cost. Cached input is charged at its cached rate and
is subtracted from ordinary input first. Reasoning tokens are already included
in output usage and are not billed twice.

The current public usage contract does not expose cache-write tokens. If OpenAI
reports a positive cache-write count, normalized token counts are retained but
the cost remains null instead of applying an incorrect standard-input rate.

The standard-price calculator returns no amount above 272,000 input tokens,
where the current GPT-5.6 long-context multiplier begins. This is intentionally
conservative until tiered pricing is implemented.

## Testing

All automated tests inject a fake SDK client and cover request shape, strict
schemas, model payloads, trusted assembly, connection statuses, usage, cached
pricing, errors, Retry-After, maximum retries, timeout, pre/during/backoff
cancellation, late responses, protected placeholders, safe logs, dist imports,
and browser/server export separation. No automated command calls OpenAI.
