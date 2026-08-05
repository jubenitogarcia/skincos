import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("maps Atendimento to its isolated runtime release surfaces", () => {
  const env = { ...process.env };
  delete env.PROMOTION_RELEASE_INPUT_DIGEST;
  const digest = execFileSync(process.execPath, [
    ".github/scripts/promotion-evidence.mjs",
    "digest",
  ], {
    cwd: root,
    env: {
      ...env,
      PROMOTION_UNIT: "atendimento",
      PROMOTION_SOURCE_SHA: "HEAD",
    },
    encoding: "utf8",
  }).trim();

  assert.match(digest, /^[0-9a-f]{64}$/);
});
