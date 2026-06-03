// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER REGISTRY (M4) — the config-only selection point.
//
// The active model provider is chosen by the DURABL_MODEL_PROVIDER environment
// variable. The workflow calls getModelProvider() and never names a concrete
// provider, so switching providers is a CONFIG change with NO code change — the
// literal M4 model-neutrality bar.
//
// Registered providers:
//   fake-echo   deterministic stand-in A (CI-safe, no key)
//   fake-upper  deterministic stand-in B (CI-safe, no key) — distinct output
//   openai      real OpenAI-compatible call when OPENAI_API_KEY present, else sim
//   anthropic   real Anthropic call when ANTHROPIC_API_KEY present, else sim
//   openrouter  real OpenRouter call when OPENROUTER_API_KEY present, else sim
//
// Default is fake-echo so a bare run is reproducible. Unknown ids fail loudly.
// ─────────────────────────────────────────────────────────────────────────────

import type { ModelProvider } from "./provider.js";
import { fakeEchoProvider, fakeUpperProvider } from "./fake-provider.js";
import { openAiProvider } from "./openai-provider.js";
import { anthropicProvider } from "./anthropic-provider.js";
import { openRouterProvider } from "./openrouter-provider.js";

const FACTORIES: Record<string, () => ModelProvider> = {
  "fake-echo": fakeEchoProvider,
  "fake-upper": fakeUpperProvider,
  openai: openAiProvider,
  anthropic: anthropicProvider,
  openrouter: openRouterProvider,
};

export const PROVIDER_IDS = Object.keys(FACTORIES);

export const DEFAULT_PROVIDER_ID = "fake-echo";

/** The configured provider id (env DURABL_MODEL_PROVIDER), defaulting to fake-echo. */
export function configuredProviderId(): string {
  return process.env.DURABL_MODEL_PROVIDER ?? DEFAULT_PROVIDER_ID;
}

/**
 * Resolve the active model provider from configuration. The ONLY input is the
 * environment — no code path names a concrete provider — which is what makes
 * the provider a config choice (the M4 neutrality contract).
 */
export function getModelProvider(id = configuredProviderId()): ModelProvider {
  const factory = FACTORIES[id];
  if (!factory) {
    throw new Error(
      `unknown DURABL_MODEL_PROVIDER=${JSON.stringify(id)}; ` +
        `known providers: ${PROVIDER_IDS.join(", ")}`,
    );
  }
  return factory();
}
