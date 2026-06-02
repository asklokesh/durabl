# openai-agents-stub

README-only stub for [OpenAI Agents SDK](https://github.com/openai/openai-agents-js).

## Why no `package.json`

`@openai/agents` is not a core dependency. See `docs/integrations/openai-agents.md` and
`src/providers/` for the config-only model seam.

## Wiring checklist

1. **Stable `runId`** for the session (Restate workflow key or your id).
2. **Per turn:** `recordStepAsync` with stable `stepName` / `seq`; producer calls
   `getModelProvider()` or Agents SDK once (replay never re-enters).
3. **Per tool:** `recordStep` + `fireEffect` (`src/workflow.ts` step 2).
4. **Env:** `DURABL_MODEL_PROVIDER`, `DURABL_JOURNAL_DB`, optional `OPENAI_API_KEY`.

## Verify without SDK

```bash
export DURABL_MODEL_PROVIDER=fake-echo
npm run gate:m1
npm run gate:m4
```

## Next

Implement in your app per `docs/integrations/openai-agents.md`; add a separate package
when you need full SDK imports.
