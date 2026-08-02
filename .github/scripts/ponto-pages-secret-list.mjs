import fs from "node:fs";

function findJsonArrayEnd(source, start) {
  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

export function parsePagesSecretListOutput(output) {
  const source = String(output || "").replace(/^\uFEFF/, "");
  for (let start = source.indexOf("["); start >= 0; start = source.indexOf("[", start + 1)) {
    const end = findJsonArrayEnd(source, start);
    if (end < 0) continue;
    try {
      const value = JSON.parse(source.slice(start, end));
      if (Array.isArray(value)) return value;
    } catch {
      // Continue searching in case a non-JSON bracket appears in the CLI banner.
    }
  }
  throw new Error("Wrangler Pages secret list did not contain a JSON array");
}

export function readPagesSecretList(file) {
  return parsePagesSecretListOutput(fs.readFileSync(file, "utf8"));
}
