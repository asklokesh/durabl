// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC FAKE PROVIDERS (M4).
//
// Two GENUINELY DISTINCT deterministic providers so the neutrality gate can run
// model-provider-A vs model-provider-B with NO keys, in CI, fully reproducibly:
//
//   fake-echo  → returns a stable "echo[...]" completion.
//   fake-upper → returns the SAME logical transform but UPPER-CASED + tagged.
//
// They are different implementations (different output text), which is exactly
// what makes "the same agent runs against two providers, config-only" a real
// claim and not a relabel: the journal records a DIFFERENT model output per
// provider, yet durability/exactly-once/replay are identical. Both are pure
// functions of the request, so the determinism contract (record once, replay
// from journal) is trivially satisfied — no key, no network.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ModelCompletion,
  ModelProvider,
  ModelRequest,
  ProviderDescriptor,
} from "./provider.js";

/** Provider A: a stable echo of the prompt. */
export function fakeEchoProvider(): ModelProvider {
  const model = "fake-echo-1";
  return {
    id: "fake-echo",
    describe(): ProviderDescriptor {
      return {
        provider: "fake-echo",
        model,
        real: false,
        note: "deterministic stand-in (no network, no key); CI-safe provider A",
      };
    },
    async complete(req: ModelRequest): Promise<ModelCompletion> {
      return {
        text: `echo[${req.prompt}]`,
        meta: { provider: "fake-echo", model, mode: "simulated" },
      };
    },
  };
}

/** Provider B: a distinct transform (upper-cased + tagged) of the prompt. */
export function fakeUpperProvider(): ModelProvider {
  const model = "fake-upper-1";
  return {
    id: "fake-upper",
    describe(): ProviderDescriptor {
      return {
        provider: "fake-upper",
        model,
        real: false,
        note: "deterministic stand-in (no network, no key); CI-safe provider B",
      };
    },
    async complete(req: ModelRequest): Promise<ModelCompletion> {
      return {
        text: `UPPER<${req.prompt.toUpperCase()}>`,
        meta: { provider: "fake-upper", model, mode: "simulated" },
      };
    },
  };
}
