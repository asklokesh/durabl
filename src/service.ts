// Service entry point: starts the Restate SDK HTTP service hosting the reference
// agent workflow. Importing ./workflow registers and serves it (guarded so the
// module can also be imported by tooling without auto-serving). Run via:
//   npm run service
import "./workflow.js";
