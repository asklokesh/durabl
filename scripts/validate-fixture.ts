#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = join(ROOT, "schemas/journal-v1.json");
const FIXTURES_DIR = join(ROOT, "test/fixtures");

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function collectJsonlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...collectJsonlFiles(path));
    else if (name.endsWith(".jsonl")) out.push(path);
  }
  return out.sort();
}

function validateFile(path: string): string[] {
  const rel = relative(ROOT, path);
  const text = readFileSync(path, "utf8");
  const errors: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    let obj: unknown;
    try { obj = JSON.parse(raw) as unknown; }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${rel}:${i + 1}: invalid JSON — ${msg}`);
      continue;
    }
    if (!validate(obj)) {
      const detail = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim()).join("; ");
      errors.push(`${rel}:${i + 1}: schema mismatch — ${detail}`);
    }
  }
  return errors;
}

const files = collectJsonlFiles(FIXTURES_DIR);
if (files.length === 0) { console.error(`No *.jsonl under ${relative(ROOT, FIXTURES_DIR)}`); process.exit(1); }
const allErrors = files.flatMap(validateFile);
if (allErrors.length > 0) { console.error("Fixture validation failed:\n"); for (const e of allErrors) console.error(`  ${e}`); process.exit(1); }
console.log(`OK — ${files.length} fixture file(s), schema journal-v1`);
