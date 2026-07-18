# @anvilnote/ai-writer

Provider-neutral contracts, a versioned document AST, validation, supported
model metadata, pricing, and trusted writing orchestration for AnvilNote Smart
Mode.

Phase 1 exposes browser-safe `contracts`, `document`, and `pricing` entrypoints.
Provider SDKs and prompt loading belong exclusively to the future `server`
entrypoint.

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

`pnpm verify` runs the complete Phase 1 verification sequence, including a
clean dist rebuild and package-export import test.
