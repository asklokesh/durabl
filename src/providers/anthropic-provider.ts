// ─────────────────────────────────────────────────────────────────────────────
// ANTHROPIC PROVIDER (M4) — real network call when a key is present.
//
// Selected by DURABL_MODEL_PROVIDER=anthropic. Reads ANTHROPIC_API_KEY from env
// at call time. If NO key is present it runs in a deterministic SIMULATED mode
// (labelled mode:"simulated"); a real key plugs in by configuration alone — NO
// code change. Same honest "config-ready real provider" contract as OpenAI.
//
// SECURITY (baseline §1, §3, §7): key read from env, never hardcoded/logged;
// used only in the x-api-key header; describe()/meta are redacted/key-free.
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

export function anthropicProvider(): ModelProvider {
  const model = process.env.DURABL_ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1";
  const version = process.env.ANTHROPIC_VERSION ?? "2023-06-01";
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  return {
    id: "anthropic",
    describe(): ProviderDescriptor {
      return {
        provider: "anthropic",
        model,
        real: hasKey,
        note: hasKey
          ? `real Anthropic call to ${baseUrl} (key present; value not logged)`
          : "no ANTHROPIC_API_KEY in env → deterministic simulated mode (config-ready for real)",
      };
    },
    async complete(req: ModelRequest): Promise<ModelCompletion> {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) {
        return {
          text: `anthropic-sim[${req.prompt}]`,
          meta: { provider: "anthropic", model, mode: "simulated" },
        };
      }
      // SECURITY-REVIEW: external HTTP call with key from env (x-api-key header
      // only); key value is never logged or returned.
      const policy = defaultProviderHttpPolicy("anthropic");
      let res: Response;
      try {
        res = await fetchWithProviderPolicy(
          `${baseUrl}/messages`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": key,
              "anthropic-version": version,
            },
            body: JSON.stringify({
              model,
              max_tokens: req.maxTokens ?? 64,
              system: req.system,
              messages: [{ role: "user", content: req.prompt }],
            }),
          },
          policy,
        );
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        throw new ProviderError(
          "network",
          "anthropic",
          "anthropic provider request failed",
          undefined,
          e,
        );
      }
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text =
        data.content?.find((b) => b.type === "text")?.text ??
        data.content?.[0]?.text ??
        "";
      return { text, meta: { provider: "anthropic", model, mode: "real" } };
    },
  };
}
