import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const JSON_START = /[\[{]/;

export function parseWranglerJson(rawOutput) {
  const raw = String(rawOutput || "");
  const start = raw.search(JSON_START);
  if (start < 0) throw new Error("Wrangler output did not contain a JSON document");

  const candidate = raw.slice(start).trim();
  try {
    return JSON.parse(candidate);
  } catch (error) {
    const lastArray = candidate.lastIndexOf("]");
    const lastObject = candidate.lastIndexOf("}");
    const end = Math.max(lastArray, lastObject);
    if (end < 0) throw error;
    return JSON.parse(candidate.slice(0, end + 1));
  }
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  const [inputFile] = process.argv.slice(2);
  if (!inputFile) throw new Error("Wrangler output file is required");
  const parsed = parseWranglerJson(fs.readFileSync(inputFile, "utf8"));
  process.stdout.write(`${JSON.stringify(parsed)}\n`);
}
