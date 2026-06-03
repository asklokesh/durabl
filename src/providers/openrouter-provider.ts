// ─────────────────────────────────────────────────────────────────────────────
// OPENROUTER PROVIDER (M4) — OpenAI-compatible routing when a key is present.
//
// Selected by DURABL_MODEL_PROVIDER=openrouter. Reads OPENROUTER_API_KEY from env
// at call time. If NO key is present, it runs in a deterministic SIMULATED mode
// (labelled mode:"simulated") so the seam is exercisable in CI; a real key plugs
// in by configuration alone — NO code change.
//
// SECURITY (baseline §1, §3, §7):
//   - the key is read from env, never hardcoded, never logged.
//   - describe()/meta are redacted (provider+model only), safe to journal.
//   - the Authorization header is the ONLY place the key is used and is never
//     emitted to a log or returned to the caller.
// Endpoint defaults to https://openrouter.ai/api/v1 (OpenAI-compatible).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ModelCompletion,
  ModelProvider,
  ModelRequest,
  ProviderDescriptor,
} from "./provider.js";
import { ProviderError } from "./provider-errors.js";
import {
  defaultProviderHttpPolicy,
  fetchWithProviderPolicy,
} from "./provider-http.js";

export function openRouterProvider(): ModelProvider {
  const model = process.env.DURABL_OPENROUTER_MODEL ?? "openai/gpt-oss-120b:free";
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const hasKey = Boolean(process.env.OPENROUTER_API_KEY);

  return {
    id: "openrouter",
    describe(): ProviderDescriptor {
      return {
        provider: "openrouter",
        model,
        real: hasKey,
        note: hasKey
          ? `real OpenRouter call to ${baseUrl} (key present; value not logged)`
          : "no OPENROUTER_API_KEY in env → deterministic simulated mode (config-ready for real)",
      };
    },
    async complete(req: ModelRequest): Promise<ModelCompletion> {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) {
        return {
          text: `openrouter-sim[${req.prompt}]`,
          meta: { provider: "openrouter", model, mode: "simulated" },
        };
      }
      // SECURITY-REVIEW: external HTTP call with key from env (Authorization
      // header only); key value is never logged or returned.
      const policy = defaultProviderHttpPolicy("openrouter");
      let res: Response;
      try {
        res = await fetchWithProviderPolicy(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model,
              max_tokens: req.maxTokens ?? 64,
              messages: [
                { role: "system", content: req.system },
                { role: "user", content: req.prompt },
              ],
            }),
          },
          policy,
        );
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        throw new ProviderError(
          "network",
          "openrouter",
          "openrouter provider request failed",
          undefined,
          e,
        );
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, meta: { provider: "openrouter", model, mode: "real" } };
    },
  };
}
