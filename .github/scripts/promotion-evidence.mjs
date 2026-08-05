import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [mode, file] = process.argv.slice(2);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const releaseSurfacesByUnit = {
  "timekeeping": ["timekeeping"],
  "crm-pages": ["timekeeping"],
  "core-api": ["timekeeping"],
  "core-inventory": ["timekeeping"],
  "finance": ["runtime"],
  "finance-ui": ["website"],
  "escala-api": ["runtime"],
  "meta-ads-report": ["runtime"],
  "public-website-release": ["website"],
  // Atendimento is promoted as an isolated native CRM runtime.  Its release
  // identity spans the CRM/API source, native runtime custody and the
  // main-custodied workflow validators; keeping all three inputs in the
  // digest prevents a predecessor evidence record from being reused after a
  // contract or runtime change.
  "atendimento": ["timekeeping", "runtime", "github-governance"],
};

function releaseInputDigest(unit, sourceSha) {
  const surfaces = releaseSurfacesByUnit[unit];
  if (!surfaces) return null;
  const args = ["scripts/codex-release-manifest.mjs", "--source", sourceSha, ...surfaces.flatMap((surface) => ["--surface", surface])];
  const output = execFileSync("node", args, { encoding: "utf8" });
  return JSON.parse(output).releaseInputDigest;
}

if (mode === "write") {
  const unit = required("PROMOTION_UNIT");
  const sourceSha = required("PROMOTION_SOURCE_SHA");
  const evidence = {
    schemaVersion: 2,
    unit,
    target: required("PROMOTION_TARGET"),
    sourceSha,
    sourceTree: required("PROMOTION_SOURCE_TREE"),
    releaseInputDigest: process.env.PROMOTION_RELEASE_INPUT_DIGEST || releaseInputDigest(unit, sourceSha),
    artifacts: process.env.PROMOTION_ARTIFACT_DIGESTS_JSON ? JSON.parse(process.env.PROMOTION_ARTIFACT_DIGESTS_JSON) : [],
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
  const expectedReleaseInputDigest = process.env.PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST;
  if (![1, 2].includes(evidence.schemaVersion) || evidence.unit !== expectedUnit || evidence.target !== expectedTarget || !/^[0-9a-f]{40}$/i.test(evidence.sourceSha) || !/^[0-9a-f]{40}$/i.test(evidence.sourceTree)) {
    throw new Error("promotion evidence has an invalid identity or stage");
  }
  if (expectedSha && evidence.sourceSha !== expectedSha) throw new Error("promotion evidence SHA differs from requested release SHA");
  if (expectedReleaseInputDigest && evidence.releaseInputDigest !== expectedReleaseInputDigest) throw new Error("promotion evidence release-input digest differs from the requested candidate");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${evidence.sourceSha}\nsource_tree=${evidence.sourceTree}\nrelease_input_digest=${evidence.releaseInputDigest || ""}\n`);
  process.stdout.write(`Promotion evidence verified for ${evidence.unit} ${evidence.sourceSha} from ${evidence.target}.\n`);
} else if (mode === "digest") {
  const unit = required("PROMOTION_UNIT");
  const sourceSha = required("PROMOTION_SOURCE_SHA");
  const digest = process.env.PROMOTION_RELEASE_INPUT_DIGEST || releaseInputDigest(unit, sourceSha);
  if (!digest) throw new Error(`no release surface mapping exists for ${unit}; provide PROMOTION_RELEASE_INPUT_DIGEST explicitly`);
  process.stdout.write(`${digest}\n`);
} else {
  throw new Error("usage: promotion-evidence.mjs write|verify <file> | digest");
}
