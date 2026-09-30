import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reconstructedSourceTree } from "../token-vault-native-release-identity.mjs";

test("detached source reconstruction matches a known Git tree", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-tv-tree-"));
  try {
    fs.writeFileSync(path.join(directory, "a.txt"), "hello\n");
    fs.writeFileSync(path.join(directory, ".skincos-token-vault-release-identity.json"), "{}", { mode: 0o600 });
    fs.writeFileSync(path.join(directory, ".skincos-global-coordination-token-vault.json"), "{}", { mode: 0o600 });
    const source = reconstructedSourceTree(directory);
    assert.equal(source.sourceTree, "2e81171448eb9f2ee3821e3d447aa6b2fe3ddba1");
    assert.deepEqual(source.entries, [{ path: "a.txt", blob: "ce013625030ba8dba906f756967f9e9ca394464a" }]);
    fs.writeFileSync(path.join(directory, "a.txt"), "changed\n");
    assert.notEqual(reconstructedSourceTree(directory).sourceTree, source.sourceTree);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
