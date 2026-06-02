# durabl examples

Runnable TypeScript samples that show how to wire **Restate** (`ctx.run`) with the
**durabl journal** (`ensureRunMeta`, `recordStep`, `fireEffect`).

Build the library first (`npm run build` from the repo root). Examples import
from `dist/` and reuse devDependencies (`@restatedev/restate-sdk`, local
`restate-server` binary).

## minimal-workflow

Two-step durable loop (prepare → idempotent side effect). Same layering as
[`src/workflow.ts`](../src/workflow.ts), stripped to the essentials.

```bash
npm run examples:minimal
```

Or manually:

```bash
npm run build
npx tsc -p examples/minimal-workflow/tsconfig.json
node --enable-source-maps examples/minimal-workflow/dist/run.js
```

Files:

| File | Role |
|------|------|
| `minimal-workflow/workflow.ts` | Restate workflow + journal idempotency |
| `minimal-workflow/run.ts` | Starts restate-server, registers, invokes once |
