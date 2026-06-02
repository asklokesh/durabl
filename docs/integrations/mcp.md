# MCP (Model Context Protocol) integration

**Status:** **NOT IMPLEMENTED** — tool schema design and journal seam only. No MCP server
binary, stdio transport, or `@modelcontextprotocol/sdk` dependency in the core repo.

**Related:** [`docs/m1-slice.md`](../m1-slice.md), [`src/workflow.ts`](../../src/workflow.ts),
tool step pattern (`step2-tool_call` + `fireEffect`).

---

## What durabl owns vs MCP

| Layer | MCP (typical) | durabl |
|-------|---------------|--------|
| Tool discovery / JSON Schema | MCP host + server | — |
| Invoking tools with arguments | Host calls `tools/call` | Your code inside a **journaled** step |
| Crash durability | Host-defined | **Restate `ctx.run`** + journal |
| Exactly-once side effects | Host responsibility | **`fireEffect`** + `IdempotencyKey` |

durabl does not replace an MCP host. It records **logical tool steps** the same way as
the reference workflow’s tool step.

---

## Tool schema design (journal `output`)

When wrapping an MCP tool as one journal step, persist a JSON `output` shape that is
stable for replay:

| Field | Type | Purpose |
|-------|------|---------|
| `mcp.tool` | string | MCP tool name (stable idempotency key input) |
| `mcp.arguments` | object | Redacted/summary args (no secrets) |
| `mcp.resultSummary` | string | Truncated result for UI |
| `mcp.isError` | boolean | Maps from MCP error flag |

**`stepName`:** use `mcp-tool-<toolName>` or graph node id — must be stable across retries.

**`sideEffect`:** `true` for any tool that touches network, filesystem, or external state.

**`fireEffect`:** required before returning success (see [`src/workflow.ts`](../../src/workflow.ts)).

---

## Mapping MCP → reference workflow

| MCP concept | durabl field |
|-------------|--------------|
| Tool name | `stepName` suffix + `output.mcp.tool` |
| `tools/call` invocation | `recordStep` producer |
| Host session id | Map to `runId` (workflow key) |
| Multiple tools in one turn | One step per tool **or** one aggregated step (document choice) |

---

## DEFERRED

| Item | Status |
|------|--------|
| `src/mcp-server.ts` stub exposing journal inspect | **DEFERRED** |
| MCP resources / prompts | **DEFERRED** |
| Hosted MCP in `npm run service` | **DEFERRED** |

---

## Related

- [`docs/INTEGRATIONS.md`](../INTEGRATIONS.md)
- GitHub Actions CI: [`github-actions.md`](github-actions.md)
