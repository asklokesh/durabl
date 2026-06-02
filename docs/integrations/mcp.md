# MCP integration (design)

Durabl exposes a **tool dispatch stub** (`durabl/mcp`, `handleDurablMcpToolCall`) for Model Context Protocol hosts. The stub maps MCP tool calls to the existing journal inspection, replay, and fork APIs. A production MCP server still needs a transport (stdio or HTTP), authentication, and rate limits in the host process.

## Transport and trust boundary

| Layer | Responsibility |
| --- | --- |
| MCP host (Cursor, Claude Desktop, custom) | Authentication, network policy, argument size limits, logging redaction |
| `handleDurablMcpToolCall` | Typed dispatch, read-only inspect/replay, bounded fork mutations |
| Journal / substrate | Durable storage and workflow execution (not invoked by `fork_and_run` stub) |

**SECURITY-REVIEW:** Treat all MCP client input as untrusted. The optional `jsonl` argument hydrates an in-memory journal via `importJournalSource` and must be size-capped and validated by the transport before it reaches Durabl. Never pass credentials in tool arguments; use environment variables or the host secret store.

**SECURITY-REVIEW:** External calls (future HTTP/SSE MCP transport, remote journal fetch) require TLS 1.2+, allowlisted origins, and no PII in URLs or logs.

## Tool catalog

Stable names are listed in `DURABL_MCP_TOOLS` in `src/mcp-server.ts`.

### Inspect (read-only)

#### `inspect_run`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["runId"],
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "jsonl": {
      "type": "string",
      "description": "Optional portable export; when omitted, reads the live SQLite journal."
    }
  }
}
```

#### `inspect_lineage`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["runId"],
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "jsonl": { "type": "string" }
  }
}
```

#### `inspect_list_forks`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["runId"],
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "jsonl": { "type": "string" }
  }
}
```

#### `inspect_fork_tree`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["rootId"],
  "properties": {
    "rootId": { "type": "string", "minLength": 1 },
    "jsonl": { "type": "string" }
  }
}
```

### Replay (read-only)

#### `replay_reconstruct`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["runId"],
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "jsonl": { "type": "string" }
  }
}
```

#### `replay_state_at`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["runId", "n"],
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "n": { "type": "integer", "minimum": 1 },
    "jsonl": { "type": "string" }
  }
}
```

### Fork

#### `fork_validate` (read-only)

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["sourceRunId", "newRunId", "throughSeq", "decision"],
  "properties": {
    "sourceRunId": { "type": "string", "minLength": 1 },
    "newRunId": { "type": "string", "minLength": 1 },
    "throughSeq": { "type": "integer", "minimum": 1 },
    "decision": {
      "type": "object",
      "additionalProperties": false,
      "required": ["prompt", "trajectory"],
      "properties": {
        "prompt": { "type": "string" },
        "trajectory": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

#### `fork_seed` (mutates local journal)

Same input schema as `fork_validate`. Seeds entries through `throughSeq` into `newRunId`; does not invoke the substrate.

#### `fork_and_run`

Same input schema as `fork_validate`. **Not implemented** in the stub: returns `NOT_IMPLEMENTED`. Use `fork_seed` plus your workflow ingress with an injected `SubstrateInvoke`.

## Response envelope

All tools return:

```json
{
  "type": "object",
  "required": ["ok"],
  "properties": {
    "ok": { "type": "boolean" },
    "data": {},
    "error": { "type": "string" },
    "code": { "type": "string" }
  }
}
```

## Package import

```ts
import {
  DURABL_MCP_TOOLS,
  handleDurablMcpToolCall,
  type DurablMcpToolName,
} from "durabl/mcp";
```
