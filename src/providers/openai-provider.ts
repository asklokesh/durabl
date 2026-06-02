// ─────────────────────────────────────────────────────────────────────────────
// OPENAI-COMPATIBLE PROVIDER (M4) — real network call when a key is present.
//
// Selected by DURABL_MODEL_PROVIDER=openai. Reads OPENAI_API_KEY from env at
// call time. If NO key is present, it runs in a deterministic SIMULATED mode
// (clearly labelled mode:"simulated") so the seam is exercisable in CI, and a
// real key plugs in by configuration alone — NO code change. This is the honest
// "config-ready real provider" the brief asks for.
//
// SECURITY (baseline §1, §3, §7):
//   - the key is read from env, never hardcoded, never logged.
//   - describe()/meta are redacted (provider+model only), safe to journal.
//   - the Authorization header is the ONLY place the key is used and is never
//     emitted to a log or returned to the caller.
// Works against any OpenAI-compatible endpoint via OPENAI_BASE_URL (OpenAI,
// Azure OpenAI gateways, local vLLM, etc.) — itself a neutrality affordance.
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

export function openAiProvider(): ModelProvider {
  const model = process.env.DURABL_OPENAI_MODEL ?? "gpt-4o-mini";
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const hasKey = Boolean(process.env.OPENAI_API_KEY);

  return {
    id: "openai",
    describe(): ProviderDescriptor {
      return {
        provider: "openai",
        model,
        real: hasKey,
        note: hasKey
          ? `real OpenAI-compatible call to ${baseUrl} (key present; value not logged)`
          : "no OPENAI_API_KEY in env → deterministic simulated mode (config-ready for real)",
      };
    },
    async complete(req: ModelRequest): Promise<ModelCompletion> {
      const key = process.env.OPENAI_API_KEY;
      if (!key) {
        // Honest simulated fallback — deterministic, clearly labelled.
        return {
          text: `openai-sim[${req.prompt}]`,
          meta: { provider: "openai", model, mode: "simulated" },
        };
      }
      // SECURITY-REVIEW: external HTTP call with key from env (Authorization
      // header only); key value is never logged or returned.
      const policy = defaultProviderHttpPolicy("openai");
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
        throw new ProviderError("network", "openai", "openai provider request failed", undefined, e);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, meta: { provider: "openai", model, mode: "real" } };
    },
  };
}
