import test from "node:test";
import assert from "node:assert/strict";
import { openRouterProvider } from "../dist/providers/openrouter-provider.js";

test("openrouter provider — simulated when OPENROUTER_API_KEY unset", async () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  const prevProvider = process.env.DURABL_MODEL_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.DURABL_MODEL_PROVIDER;

  try {
    const provider = openRouterProvider();
    const desc = provider.describe();
    assert.equal(desc.provider, "openrouter");
    assert.equal(desc.real, false);

    const completion = await provider.complete({
      system: "test",
      prompt: "ping",
    });
    assert.equal(completion.meta.mode, "simulated");
    assert.match(completion.text, /^openrouter-sim\[ping\]$/);
  } finally {
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
    if (prevProvider === undefined) delete process.env.DURABL_MODEL_PROVIDER;
    else process.env.DURABL_MODEL_PROVIDER = prevProvider;
  }
});
