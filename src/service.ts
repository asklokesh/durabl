// Service entry point: starts the Restate SDK HTTP service hosting the reference
// agent workflow + HITL workflow. Run via: npm run service

import { validateConfig } from "./config.js";
import { startRestateService } from "./restate-service.js";

validateConfig();

startRestateService().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`durabl service: ${message}`);
  process.exit(1);
});
