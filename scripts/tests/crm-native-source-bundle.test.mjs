import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CRM_NATIVE_SOURCE_PATHS,
  CrmNativeSourceBundleError,
  extractCrmNativeSourceArchive,
} from "../runtime/crm-native-source-bundle.mjs";

const SHA = "a".repeat(40);

function write(root, relative, contents = "fixture\n") {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function fixture(root, { omit = null, selectedLink = false } = {}) {
  for (const source of CRM_NATIVE_SOURCE_PATHS) {
    if (source === omit) continue;
    const isDirectory = !path.extname(source) || source.endsWith("crm-auth") || source.endsWith("sales_chart_messenger");
    write(root, isDirectory ? `${source}/.fixture` : source);
  }
  write(root, "unrelated/link-target", "not CRM\n");
  fs.symlinkSync("link-target", path.join(root, "unrelated", "legacy-link"));
  if (selectedLink) fs.symlinkSync(".fixture", path.join(root, "crm", "api", "unsafe-link"));
}

function archive(root) {
  const file = path.join(path.dirname(root), "source.tar.gz");
  const result = childProcess.spawnSync("/usr/bin/tar", [
    "--create",
    "--gzip",
    "--file", file,
    `--transform=s,^,skincos-${SHA}/,`,
    "-C", root,
    ".",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return file;
}

function withTemporaryDirectory(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-native-source-bundle-"));
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("extracts only the CRM runtime source closure from a generic monorepo archive", () => {
  withTemporaryDirectory((root) => {
    const source = path.join(root, "source");
    fs.mkdirSync(source);
    fixture(source);
    const destination = path.join(root, "candidate");
    fs.mkdirSync(destination);
    const result = extractCrmNativeSourceArchive({ archive: archive(source), sourceSha: SHA, outputDirectory: destination });
    assert.ok(result.memberCount >= CRM_NATIVE_SOURCE_PATHS.length);
    assert.equal(fs.existsSync(path.join(destination, "crm", "api", ".fixture")), true);
    assert.equal(fs.existsSync(path.join(destination, "shared", "crm-auth", ".fixture")), true);
    assert.equal(fs.existsSync(path.join(destination, "unrelated", "legacy-link")), false);
  });
});

test("fails before extraction when the source archive lacks a required closure member", () => {
  withTemporaryDirectory((root) => {
    const source = path.join(root, "source");
    fs.mkdirSync(source);
    fixture(source, { omit: "shared/crm-auth" });
    const destination = path.join(root, "candidate");
    fs.mkdirSync(destination);
    assert.throws(
      () => extractCrmNativeSourceArchive({ archive: archive(source), sourceSha: SHA, outputDirectory: destination }),
      CrmNativeSourceBundleError,
    );
    assert.deepEqual(fs.readdirSync(destination), []);
  });
});

test("rejects a selected CRM symlink even when unrelated links remain unmaterialized", () => {
  withTemporaryDirectory((root) => {
    const source = path.join(root, "source");
    fs.mkdirSync(source);
    fixture(source, { selectedLink: true });
    const destination = path.join(root, "candidate");
    fs.mkdirSync(destination);
    assert.throws(
      () => extractCrmNativeSourceArchive({ archive: archive(source), sourceSha: SHA, outputDirectory: destination }),
      CrmNativeSourceBundleError,
    );
    assert.deepEqual(fs.readdirSync(destination), []);
  });
});
