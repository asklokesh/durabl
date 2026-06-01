// Copy the static web/ assets into dist/web so the built server can serve them.
// Zero-dep build step (Node fs only).
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "web");
const dest = join(root, "dist", "web");

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[build] copied web/ → dist/web`);
} else {
  console.log(`[build] no web/ dir to copy`);
}
