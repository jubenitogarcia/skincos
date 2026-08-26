import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("campaign report exports operational data only for confirmed invitations with explicit consent", async () => {
    const report = await readFile(new URL("../scripts/beauty-movement-report.ts", import.meta.url), "utf8");

    assert.match(report, /WHERE i\.campaign_id = .*confirmed_at_ms IS NOT NULL AND i\.operational_consent_at_ms IS NOT NULL/);
    assert.match(report, /beauty_movement_report_output_must_be_private/);
    assert.match(report, /mode: 0o700/);
    assert.match(report, /mode: 0o600/);
    assert.match(report, /formulaSafe/);
    assert.match(report, /outcome_protocol_version: string \| null/);
    assert.match(report, /i\.outcome_key, i\.outcome_protocol_version, i\.outcome_snapshot_json/);
    assert.match(report, /outcome_key,outcome_protocol_version,outcome_snapshot_json/);
    assert.match(report, /row\.outcome_key,\s*row\.outcome_protocol_version,\s*row\.outcome_snapshot_json/);
});
