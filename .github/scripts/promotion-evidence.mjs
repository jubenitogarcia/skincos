import fs from "node:fs";
import path from "node:path";

const [mode, file] = process.argv.slice(2);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

if (mode === "write") {
  const evidence = {
    schemaVersion: 1,
    unit: required("PROMOTION_UNIT"),
    target: required("PROMOTION_TARGET"),
    sourceSha: required("PROMOTION_SOURCE_SHA"),
    sourceTree: required("PROMOTION_SOURCE_TREE"),
    runId: required("GITHUB_RUN_ID"),
    repository: required("GITHUB_REPOSITORY"),
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} else if (mode === "verify") {
  const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  const expectedUnit = required("PROMOTION_UNIT");
  const expectedTarget = required("PROMOTION_EXPECTED_TARGET");
  const expectedSha = process.env.PROMOTION_EXPECTED_SHA;
  if (evidence.schemaVersion !== 1 || evidence.unit !== expectedUnit || evidence.target !== expectedTarget || !/^[0-9a-f]{40}$/i.test(evidence.sourceSha) || !/^[0-9a-f]{40}$/i.test(evidence.sourceTree)) {
    throw new Error("promotion evidence has an invalid identity or stage");
  }
  if (expectedSha && evidence.sourceSha !== expectedSha) throw new Error("promotion evidence SHA differs from requested release SHA");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${evidence.sourceSha}\nsource_tree=${evidence.sourceTree}\n`);
  process.stdout.write(`Promotion evidence verified for ${evidence.unit} ${evidence.sourceSha} from ${evidence.target}.\n`);
} else {
  throw new Error("usage: promotion-evidence.mjs write|verify <file>");
}
