import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-autonomy-lib.mjs";
import { dependencyClosureFromTree } from "./codex-global-coordinator.mjs";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SIDE_CARS = new Set([
  ".skincos-token-vault-release-identity.json",
  ".skincos-global-coordination-token-vault.json",
]);

function gitObjectDigest(kind, contents) {
  return createHash("sha1").update(`${kind} ${contents.length}\0`).update(contents).digest("hex");
}

function fileBlobDigest(file, size) {
  const hash = createHash("sha1").update(`blob ${size}\0`);
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < size) {
      const read = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - position), position);
      if (read < 1) throw new Error("native source blob changed during attestation");
      hash.update(chunk.subarray(0, read));
      position += read;
    }
    if (fs.fstatSync(fd).size !== size) throw new Error("native source blob changed during attestation");
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function treeSort(left, right) {
  return Buffer.compare(Buffer.from(left.name + (left.kind === "tree" ? "/" : "")),
    Buffer.from(right.name + (right.kind === "tree" ? "/" : "")));
}

export function reconstructedSourceTree(sourceRoot) {
  const entries = [];
  const rebuild = (directory, prefix = "") => {
    const children = [];
    for (const name of fs.readdirSync(directory)) {
      if (!name || name === ".git" || /[\0\r\n]/.test(name)) throw new Error("native source contains an unsafe Git tree path");
      if (!prefix && SIDE_CARS.has(name)) continue;
      const file = path.join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        children.push({ name, kind: "tree", mode: "40000", hash: rebuild(file, relative) });
      } else if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        if (!target || target.includes("\0")) throw new Error("native source has an unsafe symlink");
        const hash = gitObjectDigest("blob", Buffer.from(target));
        children.push({ name, kind: "blob", mode: "120000", hash });
        entries.push({ path: relative, blob: hash });
      } else if (stat.isFile()) {
        const hash = fileBlobDigest(file, stat.size);
        children.push({ name, kind: "blob", mode: stat.mode & 0o111 ? "100755" : "100644", hash });
        entries.push({ path: relative, blob: hash });
      } else {
        throw new Error("native source contains an unsupported materialized file");
      }
    }
    children.sort(treeSort);
    const contents = Buffer.concat(children.map((entry) => Buffer.concat([
      Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.hash, "hex"),
    ])));
    return gitObjectDigest("tree", contents);
  };
  return { sourceTree: rebuild(sourceRoot), entries };
}

function sha256File(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    const size = fs.fstatSync(fd).size;
    while (position < size) {
      const read = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - position), position);
      if (read < 1) throw new Error("native source archive changed during attestation");
      hash.update(chunk.subarray(0, read));
      position += read;
    }
    if (fs.fstatSync(fd).size !== size) throw new Error("native source archive changed during attestation");
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function rootOwned(file, label) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
    throw new Error(`${label} must be root-owned and immutable to other users`);
  }
  return stat;
}

export function verifyDetachedRelease({ root, sourceSha }) {
  if (!SHA.test(String(sourceSha || "")) || root !== `/opt/skincos/releases/${sourceSha}/source`
    || fs.realpathSync(root) !== root) {
    throw new Error("Token Vault source is not the selected immutable Linux release");
  }
  for (const component of ["/opt/skincos", "/opt/skincos/releases", path.dirname(root), root]) {
    rootOwned(component, "Token Vault release root");
  }
  const file = path.join(root, ".skincos-token-vault-release-identity.json");
  const closureFile = path.join(root, ".skincos-global-coordination-token-vault.json");
  const archive = path.join(path.dirname(root), "source.tar.gz");
  for (const item of [file, closureFile, archive]) rootOwned(item, "Token Vault release attestation");
  const identity = JSON.parse(fs.readFileSync(file, "utf8"));
  if (identity?.schemaVersion !== 1 || identity.sourceSha !== sourceSha || !SHA.test(identity.sourceTree)
    || !DIGEST.test(identity.releaseInputDigest) || !DIGEST.test(identity.dependencyClosureDigest)
    || !DIGEST.test(identity.sourceArchiveSha256)
    || Object.keys(identity).sort().join(",") !== ["dependencyClosureDigest", "releaseInputDigest", "schemaVersion", "sourceArchiveSha256", "sourceSha", "sourceTree"].sort().join(",")) {
    throw new Error("Token Vault detached release identity is invalid");
  }
  if (sha256File(archive) !== identity.sourceArchiveSha256) {
    throw new Error("Token Vault source archive SHA-256 differs from its attestation");
  }
  const source = reconstructedSourceTree(root);
  if (source.sourceTree !== identity.sourceTree) throw new Error("Token Vault installed source tree differs from its Git attestation");
  const computedClosure = dependencyClosureFromTree({ module: "token-vault", sourceCommit: sourceSha,
    sourceTree: identity.sourceTree, entries: source.entries });
  const closure = JSON.parse(fs.readFileSync(closureFile, "utf8"));
  if (computedClosure.digest !== identity.dependencyClosureDigest || closure.digest !== computedClosure.digest
    || closure.module !== "token-vault" || closure.sourceCommit !== sourceSha
    || closure.sourceTree !== identity.sourceTree || canonicalJson(closure.material) !== canonicalJson(computedClosure.material)) {
    throw new Error("Token Vault detached dependency closure differs from the installed source");
  }
  return { identity, closure: computedClosure };
}
