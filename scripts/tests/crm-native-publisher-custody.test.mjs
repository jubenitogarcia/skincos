import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCandidateTree,
  CrmNativePublisherCustodyError,
  renderCrmNativeUnit,
} from "../runtime/crm-native-publisher-custody.mjs";

const SHA = "a".repeat(40);

test("the native unit has fixed code, writer, PATH, and runtime boundaries", () => {
  const root = `/opt/skincos/releases/${SHA}/crm-service`;
  const unit = renderCrmNativeUnit({ releaseRoot: root, mediaRouteMode: "disabled" });
  assert.match(unit, new RegExp(`WorkingDirectory=${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(unit, /Environment=PONTO_LEGACY_RUNTIME_MODE=read-only/);
  assert.match(unit, /Environment=CRM_NATIVE_MEDIA_TOOLS_MODE=disabled/);
  assert.match(unit, /Environment=PATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
  assert.doesNotMatch(unit, /current\/source/);
  assert.throws(
    () => renderCrmNativeUnit({ releaseRoot: "/tmp/not-a-release", mediaRouteMode: "disabled" }),
    CrmNativePublisherCustodyError,
  );
});

test("candidate tree accounting rejects hard-linked files before a release is installed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-native-custody-"));
  try {
    fs.writeFileSync(path.join(root, "first"), "fixture");
    assert.deepEqual(assertCandidateTree(root, { maximumBytes: 100, maximumEntries: 10, expectedUid: null }), { bytes: 7, entries: 1 });
    fs.linkSync(path.join(root, "first"), path.join(root, "second"));
    assert.throws(
      () => assertCandidateTree(root, { maximumBytes: 100, maximumEntries: 10, expectedUid: null }),
      CrmNativePublisherCustodyError,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
