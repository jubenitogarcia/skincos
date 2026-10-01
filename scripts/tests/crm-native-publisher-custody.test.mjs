import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCandidateTree,
  CrmNativePublisherCustodyError,
  renderCrmNativeUnit,
} from "../runtime/crm-native-publisher-custody.mjs";
import {
  buildCrmNativeDependencyManifest,
  canonicalCrmNativeDependencyManifest,
  CRM_NATIVE_DEPENDENCY_MANIFEST,
  validateCrmNativeDependencyManifest,
} from "../runtime/crm-native-release-contract.mjs";

const SHA = "a".repeat(40);

test("the native unit has fixed code, writer, PATH, and runtime boundaries", () => {
  const root = `/opt/skincos/releases/${SHA}/crm-service`;
  const unit = renderCrmNativeUnit({ releaseRoot: root, mediaRouteMode: "disabled" });
  assert.match(unit, new RegExp(`WorkingDirectory=${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(unit, /Environment=PONTO_LEGACY_RUNTIME_MODE=disabled/);
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

function normalizedTree(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    fs.chmodSync(current, 0o755);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else fs.chmodSync(file, file.endsWith(".sh") ? 0o755 : 0o644);
    }
  }
}

function withDependencyManifestFixture(fn) {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "crm-native-dependency-manifest-"));
  try {
    const api = path.join(releaseRoot, "crm", "api");
    fs.mkdirSync(path.join(api, "node_modules", "express", "lib"), { recursive: true });
    fs.mkdirSync(path.join(api, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(api, "package.json"), JSON.stringify({ dependencies: { express: "4.21.2" } }));
    fs.writeFileSync(path.join(api, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    fs.writeFileSync(path.join(api, "node_modules", "express", "index.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(api, "node_modules", "express", "lib", "route.sh"), "#!/usr/bin/env sh\nexit 0\n");
    fs.writeFileSync(path.join(api, "node_modules", ".bin", "express"), "#!/usr/bin/env node\n");
    normalizedTree(path.join(api, "node_modules"));
    const manifest = buildCrmNativeDependencyManifest({ apiRoot: api, requireNormalizedModes: true });
    const raw = Buffer.from(`${canonicalCrmNativeDependencyManifest(manifest)}\n`, "utf8");
    const manifestFile = path.join(releaseRoot, CRM_NATIVE_DEPENDENCY_MANIFEST);
    fs.writeFileSync(manifestFile, raw, { mode: 0o644 });
    fs.chmodSync(manifestFile, 0o644);
    const expected = { sha256: crypto.createHash("sha256").update(raw).digest("hex"), bytes: raw.length };
    fn({ releaseRoot, api, expected });
  } finally {
    fs.rmSync(releaseRoot, { recursive: true, force: true });
  }
}

test("a normalized dependency manifest binds the lockfile and complete final tree", () => {
  withDependencyManifestFixture(({ releaseRoot, expected }) => {
    const verified = validateCrmNativeDependencyManifest({
      releaseRoot,
      expectedSha256: expected.sha256,
      expectedBytes: expected.bytes,
      requireNormalizedModes: true,
    });
    assert.equal(verified.sha256, expected.sha256);
    assert.equal(verified.bytes, expected.bytes);
  });
});

test("dependency manifest rejects altered, extra, absent, linked, and mismatched inputs", () => {
  const mutations = [
    ["altered manifest", ({ releaseRoot }) => fs.appendFileSync(path.join(releaseRoot, CRM_NATIVE_DEPENDENCY_MANIFEST), " ")],
    ["altered lockfile", ({ api }) => fs.appendFileSync(path.join(api, "package-lock.json"), " ")],
    ["extra file", ({ api }) => fs.writeFileSync(path.join(api, "node_modules", "express", "extra.js"), "extra\n")],
    ["absent file", ({ api }) => fs.rmSync(path.join(api, "node_modules", "express", "index.js"))],
    ["missing direct dependency", ({ api }) => fs.rmSync(path.join(api, "node_modules", "express"), { recursive: true })],
    ["symbolic link", ({ api }) => fs.symlinkSync("index.js", path.join(api, "node_modules", "express", "linked.js"))],
    ["hard link", ({ api }) => fs.linkSync(path.join(api, "node_modules", "express", "index.js"), path.join(api, "node_modules", "express", "linked.js"))],
  ];
  for (const [label, mutate] of mutations) {
    withDependencyManifestFixture((fixture) => {
      mutate(fixture);
      assert.throws(
        () => validateCrmNativeDependencyManifest({
          releaseRoot: fixture.releaseRoot,
          expectedSha256: fixture.expected.sha256,
          expectedBytes: fixture.expected.bytes,
          requireNormalizedModes: true,
        }),
        /CRM dependency manifest|Dependency manifest|CRM API direct production dependency/,
        label,
      );
    });
  }
});
