import fs from "node:fs";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  throw new Error("usage: ponto-json-output.mjs <input> <output>");
}

const source = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");

const parseDocumentAt = (start) => {
  const opening = source[start];
  if (opening !== "{" && opening !== "[") return undefined;

  const closing = opening === "{" ? "}" : "]";
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      if (!stack.length) return undefined;
      const expected = stack.at(-1) === "{" ? "}" : "]";
      if (character !== expected) return undefined;
      stack.pop();
      if (!stack.length && character === closing) {
        try {
          return JSON.parse(source.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
};

let document;
for (let index = 0; index < source.length && document === undefined; index += 1) {
  if (source[index] !== "{" && source[index] !== "[") continue;
  document = parseDocumentAt(index);
}

if (document === undefined) {
  throw new Error("command output did not contain a valid JSON document");
}

fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
