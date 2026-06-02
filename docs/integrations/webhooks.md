# Webhooks — HITL pause notifications

**Status:** **DEFERRED** — contract doc only. `DURABL_HITL_WEBHOOK_URL` handling and
`src/hitl-webhook.ts` are **not** merged on `main`; implement in a follow-up branch.

**Related:** [`docs/m5-hitl-export.md`](../m5-hitl-export.md),
[`src/hitl-workflow.ts`](../../src/hitl-workflow.ts).

---

## Intended behavior (design)

When a run durably reaches the HITL pause (`hitl_pause` journaled, awaiting human input),
optionally `POST` a small JSON payload to an operator URL (Slack bridge, PagerDuty, queue).

| Variable | Required | Description |
|----------|----------|-------------|
| `DURABL_HITL_WEBHOOK_URL` | No | `http://` or `https://` URL; unset → no outbound call |

- Fire **once per run** when the pause step is first recorded (idempotent with M1 journal).
- **Not** on resume, fork, or replay of an existing pause entry.
- Delivery **best-effort**; workflow must still suspend even if webhook fails.

---

## Payload (no PII)

```json
{
  "event": "durabl.hitl.pause",
  "runId": "<workflow-key>",
  "trajectory": "main",
  "stepName": "hitl-pause",
  "seq": 2,
  "awaitingInput": true
}
```

---

## DEFERRED

| Item | Status |
|------|--------|
| Env read in `HitlAgentRun` | **DEFERRED** |
| Retry / signing / HMAC | **DEFERRED** |
| Resume / export webhooks | **DEFERRED** |

---

## Related

- [`docs/INTEGRATIONS.md`](../INTEGRATIONS.md)
