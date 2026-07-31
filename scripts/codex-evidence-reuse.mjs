#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { findReusableEvidence } from "./codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const manifestFile = argument("--manifest");
const evidenceFile = argument("--evidence");
if (!manifestFile || !evidenceFile) throw new Error("usage: codex-evidence-reuse.mjs --manifest <file> --evidence <json-array>");
const manifest = JSON.parse(fs.readFileSync(path.resolve(root, manifestFile), "utf8"));
const records = JSON.parse(fs.readFileSync(path.resolve(root, evidenceFile), "utf8"));
if (!Array.isArray(records)) throw new Error("evidence input must be a JSON array");
const reusable = findReusableEvidence(records, manifest);
const result = {
  schemaVersion: 1,
  releaseInputDigest: manifest.releaseInputDigest,
  reused: Boolean(reusable),
  evidence: reusable ? { name: reusable.name ?? null, artifactDigest: reusable.artifactDigest ?? null } : null
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `reused=${result.reused}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_input_digest=${result.releaseInputDigest}\n`);
}
