# LangGraph minimal (PROTOTYPE)

> **PROTOTYPE** — Not LangGraph Python. Same Restate + `recordStep` pattern as
> [`src/workflow.ts`](../../../src/workflow.ts). `LangGraphMinimal` is **not** registered.

- [`node-map.ts`](node-map.ts) — node id → `stepName` / `seq` / `kind`
- [`workflow.ts`](workflow.ts) — plan → tool → summarize

```bash
npm run build
npx tsc -p examples/integrations/langgraph-minimal/tsconfig.json
npm run demo   # uses shipped AgentRun
```

[`docs/integrations/langgraph.md`](../../../docs/integrations/langgraph.md)
