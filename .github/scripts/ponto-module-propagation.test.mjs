import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./ponto-module-propagation.mjs", import.meta.url));

test("incumbent fallback refuses active even with an exact release SHA", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-propagation-"));
  try {
    const primary = path.join(directory, "primary.json");
    const alternate = path.join(directory, "alternate.json");
    const report = path.join(directory, "report.json");
    fs.writeFileSync(primary, JSON.stringify({
      state: "maintenance",
      changedAt: "2026-07-30T12:00:00.000Z",
    }));
    fs.writeFileSync(alternate, JSON.stringify({
      state: "active",
      changedAt: "2026-07-30T12:00:01.000Z",
      releaseSha: "a".repeat(40),
      source: "control",
    }));

    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PONTO_MODULE_EXPECTATION_FILE: primary,
        PONTO_MODULE_ALTERNATE_EXPECTATION_FILE: alternate,
        PONTO_MODULE_PROPAGATION_REPORT: report,
        PONTO_MODULE_HEALTH_URL: "https://api-staging.skincos.com.br/api/ponto/health",
        PONTO_MODULE_EXPECTED_SOURCE: "emergency-latch-active",
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /incumbent propagation fallback must be exact maintenance from control/);
    assert.equal(fs.existsSync(report), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
