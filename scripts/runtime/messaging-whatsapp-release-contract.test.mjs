import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  canonicalJson,
  buildMessagingReleaseIdentity,
  isNativeLinuxPath,
  isolatedGitEnvironment,
  materializeMessagingReleaseCandidate,
  sha256File,
  sha256Text,
  snapshotMessagingReleaseCandidate,
  validateInstalledMessagingRelease,
  validateMessagingRollbackPair,
  validateMessagingReleaseCandidate,
} from "./messaging-whatsapp-release-contract.mjs";

const sha = (seed) => crypto.createHash("sha1").update(seed).digest("hex");
const contractCli = fileURLToPath(new URL("./messaging-whatsapp-release-contract.mjs", import.meta.url));

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function gitOutput(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    env: isolatedGitEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitBuffer(args) {
  return execFileSync("git", args, {
    env: isolatedGitEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function closure({ sourceCommit, sourceTree, inputBlob = sha("engine-input") }) {
  const material = {
    schemaVersion: 1,
    module: "messaging-whatsapp",
    inputs: [{ path: "messaging/channels/whatsapp/engine/src/main.ts", blob: inputBlob }],
    dependencyClosurePatterns: ["messaging/**"],
    dependencyClosureSharedInputPaths: [],
    dependencyClosureSharedInputs: false,
  };
  return {
    schemaVersion: 1,
    module: "messaging-whatsapp",
    sourceCommit,
    sourceTree,
    inputs: material.inputs,
    dependencyClosurePaths: material.inputs.map((entry) => entry.path),
    dependencyClosurePatterns: material.dependencyClosurePatterns,
    dependencyClosureSharedInputPaths: material.dependencyClosureSharedInputPaths,
    dependencyClosureSharedInputs: false,
    digest: sha256Text(canonicalJson(material)),
    material,
  };
}

function createCandidate(root, sourceCommit, sourceTree, repository) {
  assert.ok(repository, "A real Git source repository is required for a candidate fixture.");
  const candidate = path.join(root, "release-source-" + sourceCommit);
  fs.mkdirSync(candidate, { recursive: true });
  const archive = path.join(candidate, "source.tar.gz");
  fs.writeFileSync(archive, gitBuffer([
    "-C",
    repository,
    "archive",
    "--format=tar.gz",
    "--prefix=skincos-" + sourceCommit + "/",
    sourceCommit,
  ]));
  const archiveDigest = sha256File(archive);
  fs.writeFileSync(path.join(candidate, "source.sha256"), archiveDigest + "\n");
  writeJson(path.join(candidate, "release.json"), {
    schemaVersion: 1,
    sourceSha: sourceCommit,
    sourceTree,
    sourceArchiveSha256: archiveDigest,
  });
  const artifacts = [{ name: "source-archive", id: "source-archive", digest: archiveDigest }];
  writeJson(path.join(candidate, "release-manifest.json"), {
    schemaVersion: 1,
    sourceCommit,
    sourceTree,
    artifacts,
    artifactManifest: { schemaVersion: 1, sourceCommit, sourceTree, artifacts },
    releaseIdentity: { schemaVersion: 1, sourceCommit, sourceTree, artifacts },
  });
  const inputBlob = gitOutput([
    "-C",
    repository,
    "rev-parse",
    sourceCommit + ":messaging/channels/whatsapp/engine/src/main.ts",
  ]);
  writeJson(path.join(candidate, "messaging-whatsapp-closure.json"), closure({ sourceCommit, sourceTree, inputBlob }));
  return { candidate, sourceCommit, sourceTree, archiveDigest };
}

function createInstalledRelease(root, {
  sourceCommit,
  sourceTree,
  sourceArchiveSha256,
  releaseManifestSha256,
  closureValue,
  predecessor = null,
}) {
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "main.js"), "console.log('immutable');\n");
  writeJson(path.join(root, ".skincos-global-coordination-messaging-whatsapp.json"), closureValue);
  const artifactDigest = sha256File(path.join(root, "dist", "main.js"));
  const identity = {
    schemaVersion: 2,
    module: "messaging-whatsapp",
    sourceCommit,
    sourceTree,
    sourceArchiveSha256,
    releaseManifestSha256,
    dependencyClosureDigest: closureValue.digest,
    artifacts: [
      { name: "release-source-archive", id: "release-source:" + sourceCommit, digest: sourceArchiveSha256 },
      { name: "whatsapp-dist-main", id: "whatsapp-dist:" + sourceCommit, digest: artifactDigest },
    ],
    ...(predecessor ? { predecessor } : {}),
  };
  identity.identityDigest = sha256Text(canonicalJson(identity));
  writeJson(path.join(root, ".skincos-release-identity-messaging-whatsapp.json"), identity);
  return { ...identity, artifactDigest };
}

function fixture({ symlink = false, longPath = false, attributesFilter = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-messaging-contract-"));
  const repository = path.join(root, "source");
  fs.mkdirSync(path.join(repository, "messaging", "channels", "whatsapp", "engine", "src"), { recursive: true });
  gitOutput(["init", "--quiet", repository]);
  const sourceFile = path.join(repository, "messaging", "channels", "whatsapp", "engine", "src", "main.ts");
  fs.writeFileSync(sourceFile, "export const release = 'predecessor';\n");
  if (symlink) {
    fs.symlinkSync("src/main.ts", path.join(repository, "messaging", "channels", "whatsapp", "engine", "linked-main.ts"));
  }
  if (longPath) {
    const longDirectory = path.join(repository, "messaging", "channels", "whatsapp", "engine", "fixtures", "nested-".repeat(18));
    fs.mkdirSync(longDirectory, { recursive: true });
    fs.writeFileSync(path.join(longDirectory, "long-path.ts"), "export const longPath = true;\n");
  }
  if (attributesFilter) {
    fs.writeFileSync(path.join(repository, ".gitattributes"), "*.ts filter=untrusted-clean\n");
  }
  gitOutput(["-C", repository, "add", "--all"]);
  gitOutput([
    "-C",
    repository,
    "-c",
    "user.email=messaging-contract@example.invalid",
    "-c",
    "user.name=Messaging Contract",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--quiet",
    "-m",
    "predecessor",
  ]);
  const predecessor = {
    sourceCommit: gitOutput(["-C", repository, "rev-parse", "HEAD"]),
    sourceTree: gitOutput(["-C", repository, "rev-parse", "HEAD^{tree}"]),
  };
  fs.writeFileSync(sourceFile, "export const release = 'current';\n");
  gitOutput(["-C", repository, "add", "--all"]);
  gitOutput([
    "-C",
    repository,
    "-c",
    "user.email=messaging-contract@example.invalid",
    "-c",
    "user.name=Messaging Contract",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--quiet",
    "-m",
    "current",
  ]);
  const sourceCommit = gitOutput(["-C", repository, "rev-parse", "HEAD"]);
  const sourceTree = gitOutput(["-C", repository, "rev-parse", "HEAD^{tree}"]);
  const candidate = createCandidate(root, sourceCommit, sourceTree, repository);
  return { root, repository, predecessor, ...candidate };
}

function tarText(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  assert.ok(bytes.length <= length, "Synthetic TAR field must fit its header.");
  bytes.copy(header, offset);
}

function tarOctal(header, offset, length, value) {
  tarText(header, offset, length, value.toString(8).padStart(length - 1, "0") + "\0");
}

function tarHeader({ name, type = "0", data = Buffer.alloc(0), linkname = "", mode = 0o644 }) {
  const header = Buffer.alloc(512);
  tarText(header, 0, 100, name);
  tarOctal(header, 100, 8, mode);
  tarOctal(header, 108, 8, 0);
  tarOctal(header, 116, 8, 0);
  tarOctal(header, 124, 12, data.length);
  tarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  tarText(header, 157, 100, linkname);
  tarText(header, 257, 6, "ustar\0");
  tarText(header, 263, 2, "00");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  tarText(header, 148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
  return header;
}

function paddedTarPayload(data) {
  const padding = (512 - (data.length % 512)) % 512;
  return padding === 0 ? data : Buffer.concat([data, Buffer.alloc(padding)]);
}

function paxRecord(key, value) {
  const suffix = " " + key + "=" + value + "\n";
  let size = Buffer.byteLength(suffix);
  while (true) {
    const record = String(size) + suffix;
    const next = Buffer.byteLength(record);
    if (next === size) return Buffer.from(record, "utf8");
    size = next;
  }
}

function appendTarEntries(archive, entries) {
  const original = gunzipSync(fs.readFileSync(archive));
  let end = original.length;
  while (end >= 512 && original.subarray(end - 512, end).every((byte) => byte === 0)) end -= 512;
  const additions = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "", "utf8");
    additions.push(tarHeader({ ...entry, data }), paddedTarPayload(data));
  }
  fs.writeFileSync(archive, gzipSync(Buffer.concat([
    original.subarray(0, end),
    ...additions,
    Buffer.alloc(1024),
  ])));
}

function refreshCandidateArchiveMetadata(candidate) {
  const archive = path.join(candidate, "source.tar.gz");
  const archiveDigest = sha256File(archive);
  fs.writeFileSync(path.join(candidate, "source.sha256"), archiveDigest + "\n");
  const releaseFile = path.join(candidate, "release.json");
  const release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
  release.sourceArchiveSha256 = archiveDigest;
  writeJson(releaseFile, release);
  const manifestFile = path.join(candidate, "release-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  for (const artifacts of [manifest.artifacts, manifest.artifactManifest.artifacts, manifest.releaseIdentity.artifacts]) {
    artifacts.find((entry) => entry.name === "source-archive").digest = archiveDigest;
  }
  writeJson(manifestFile, manifest);
  return archiveDigest;
}

test("candidate fixture Git helpers never inherit shared worktree routing", () => {
  const environment = isolatedGitEnvironment({
    PATH: process.env.PATH,
    GIT_DIR: "/shared/.git",
    GIT_WORK_TREE: "/shared/worktree",
    GIT_COMMON_DIR: "/shared/common",
    GIT_CONFIG_COUNT: "1",
    git_dir: "/shared/lowercase.git",
  });
  assert.equal(environment.GIT_DIR, undefined);
  assert.equal(environment.GIT_WORK_TREE, undefined);
  assert.equal(environment.GIT_COMMON_DIR, undefined);
  assert.equal(environment.git_dir, undefined);
  assert.equal(Object.keys(environment).some((name) => name.toUpperCase().startsWith("GIT_")), false);
});

test("accepts a native release-source candidate bound by SHA, tree, archive and messaging closure", () => {
  const current = fixture();
  try {
    const result = validateMessagingReleaseCandidate({
      candidateDirectory: current.candidate,
      releaseSha: current.sourceCommit,
    });
    assert.equal(result.sourceCommit, current.sourceCommit);
    assert.equal(result.sourceTree, current.sourceTree);
    assert.equal(result.sourceArchiveSha256, current.archiveDigest);
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("accepts Git archive PAX paths and opaque symlink records without following them", () => {
  const current = fixture({ symlink: true, longPath: true });
  try {
    const result = validateMessagingReleaseCandidate({
      candidateDirectory: current.candidate,
      releaseSha: current.sourceCommit,
    });
    assert.equal(result.sourceTree, current.sourceTree);
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("captures a private candidate snapshot before later source-directory changes", () => {
  const current = fixture();
  try {
    const snapshotParent = path.join(current.root, "private-snapshot-parent");
    fs.mkdirSync(snapshotParent, { mode: 0o700 });
    const snapshotDirectory = path.join(snapshotParent, "release-source-" + current.sourceCommit);
    const originalArtifacts = new Map([
      "source.tar.gz",
      "source.sha256",
      "release.json",
      "release-manifest.json",
      "messaging-whatsapp-closure.json",
    ].map((artifact) => [artifact, fs.readFileSync(path.join(current.candidate, artifact))]));
    const snapshot = snapshotMessagingReleaseCandidate({
      candidateDirectory: current.candidate,
      releaseSha: current.sourceCommit,
      snapshotDirectory,
    });
    assert.equal(snapshot.sourceArchiveSha256, current.archiveDigest);
    for (const [artifact, contents] of originalArtifacts) {
      const copied = path.join(snapshotDirectory, artifact);
      assert.deepEqual(fs.readFileSync(copied), contents);
      assert.equal(fs.statSync(copied).mode & 0o077, 0);
    }

    fs.writeFileSync(path.join(current.candidate, "source.tar.gz"), "swapped-after-snapshot");
    const stage = path.join(current.root, "private-materialization-stage");
    fs.mkdirSync(stage, { mode: 0o700 });
    const materialized = materializeMessagingReleaseCandidate({
      candidateDirectory: snapshotDirectory,
      releaseSha: current.sourceCommit,
      stageDirectory: stage,
    });
    assert.equal(materialized.sourceRoot, path.join(stage, "skincos-" + current.sourceCommit));
    assert.ok(fs.existsSync(path.join(materialized.sourceRoot, "messaging", "channels", "whatsapp", "engine", "src", "main.ts")));
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects an oversized gzip before snapshotting reads it into memory", () => {
  const current = fixture();
  try {
    const snapshotParent = path.join(current.root, "oversized-snapshot-parent");
    fs.mkdirSync(snapshotParent, { mode: 0o700 });
    const snapshotDirectory = path.join(snapshotParent, "release-source-" + current.sourceCommit);
    fs.truncateSync(path.join(current.candidate, "source.tar.gz"), (256 * 1024 * 1024) + 1);
    assert.throws(
      () => snapshotMessagingReleaseCandidate({
        candidateDirectory: current.candidate,
        releaseSha: current.sourceCommit,
        snapshotDirectory,
      }),
      /safe snapshot size limit/,
    );
    assert.equal(fs.existsSync(snapshotDirectory), false);
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("snapshot-candidate rejects a FIFO source archive without blocking", () => {
  const current = fixture();
  try {
    const archive = path.join(current.candidate, "source.tar.gz");
    fs.rmSync(archive);
    execFileSync("mkfifo", [archive]);
    const snapshotParent = path.join(current.root, "fifo-snapshot-parent");
    fs.mkdirSync(snapshotParent, { mode: 0o700 });
    const snapshotDirectory = path.join(snapshotParent, "release-source-" + current.sourceCommit);
    const result = spawnSync(process.execPath, [
      contractCli,
      "snapshot-candidate",
      "--candidate", current.candidate,
      "--release-sha", current.sourceCommit,
      "--snapshot", snapshotDirectory,
    ], {
      encoding: "utf8",
      env: isolatedGitEnvironment(),
    });
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr), /must be a regular file/);
    assert.equal(fs.existsSync(snapshotDirectory), false);
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects oversized metadata before JSON parsing in direct candidate validation", () => {
  const current = fixture();
  try {
    fs.truncateSync(path.join(current.candidate, "release.json"), (8 * 1024 * 1024) + 1);
    assert.throws(
      () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
      /Release source identity exceeds the safe size limit/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("reconstructs raw Git trees without candidate attributes or HOME clean filters", () => {
  const current = fixture({ attributesFilter: true });
  const unsafeHome = path.join(current.root, "unsafe-home");
  const marker = path.join(current.root, "candidate-filter-executed");
  const bashMarker = path.join(current.root, "candidate-bash-env-executed");
  const unsafeBashEnv = path.join(current.root, "unsafe-bash-env");
  const priorHome = process.env.HOME;
  const priorBashEnv = process.env.BASH_ENV;
  try {
    fs.mkdirSync(unsafeHome, { mode: 0o700 });
    fs.writeFileSync(path.join(unsafeHome, ".gitconfig"), [
      '[filter "untrusted-clean"]',
      "\tclean = /bin/sh -c 'printf executed > " + marker + "'",
      "",
    ].join("\n"));
    fs.writeFileSync(unsafeBashEnv, "printf executed > " + bashMarker + "\n");
    process.env.HOME = unsafeHome;
    process.env.BASH_ENV = unsafeBashEnv;
    const result = validateMessagingReleaseCandidate({
      candidateDirectory: current.candidate,
      releaseSha: current.sourceCommit,
    });
    assert.equal(result.sourceTree, current.sourceTree);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(bashMarker), false);
  } finally {
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    if (priorBashEnv === undefined) delete process.env.BASH_ENV;
    else process.env.BASH_ENV = priorBashEnv;
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects hostile TAR records before they can escape the native stage", () => {
  const cases = [
    {
      name: "hard link",
      entries: ({ sourceCommit }) => [{
        name: "skincos-" + sourceCommit + "/hard-link",
        type: "1",
        linkname: "../../outside",
      }],
      expected: /hard links are not permitted/,
    },
    {
      name: "special file",
      entries: ({ sourceCommit }) => [{
        name: "skincos-" + sourceCommit + "/named-pipe",
        type: "6",
      }],
      expected: /unsupported TAR entry type/,
    },
    {
      name: "path traversal",
      entries: ({ sourceCommit }) => [{
        name: "skincos-" + sourceCommit + "/../escaped",
      }],
      expected: /checkout metadata or an escaping path/,
    },
    {
      name: "PAX effective path traversal",
      entries: ({ sourceCommit }) => [
        { name: "PaxHeaders.unsafe", type: "x", data: paxRecord("path", "skincos-" + sourceCommit + "/../escaped") },
        { name: "safe", data: "unsafe" },
      ],
      expected: /checkout metadata or an escaping path/,
    },
    {
      name: "PAX effective collision",
      entries: ({ sourceCommit }) => [
        { name: "PaxHeaders.collision", type: "x", data: paxRecord("path", "skincos-" + sourceCommit + "/messaging/channels/whatsapp/engine/src/main.ts") },
        { name: "replacement", data: "unsafe" },
      ],
      expected: /duplicate entries/,
    },
    {
      name: "child below a symlink pivot",
      entries: ({ sourceCommit, outside }) => [
        { name: "skincos-" + sourceCommit + "/pivot", type: "2", linkname: outside },
        { name: "skincos-" + sourceCommit + "/pivot/escaped", data: "unsafe" },
      ],
      expected: /writes through a non-directory ancestor/,
      assertNoEscape: true,
    },
  ];
  for (const hostile of cases) {
    const current = fixture();
    try {
      const outside = path.join(current.root, "must-not-exist-outside-stage");
      appendTarEntries(path.join(current.candidate, "source.tar.gz"), hostile.entries({ ...current, outside }));
      refreshCandidateArchiveMetadata(current.candidate);
      assert.throws(
        () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
        hostile.expected,
        hostile.name,
      );
      if (hostile.assertNoEscape) assert.equal(fs.existsSync(outside), false);
    } finally {
      fs.rmSync(current.root, { recursive: true, force: true });
    }
  }
});

test("rejects an oversized compressed archive before reading it into memory", () => {
  const current = fixture();
  try {
    fs.truncateSync(path.join(current.candidate, "source.tar.gz"), (256 * 1024 * 1024) + 1);
    assert.throws(
      () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
      /compressed size exceeds the safe limit/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects a candidate whose source SHA differs from its release-source directory", () => {
  const current = fixture();
  try {
    const releaseFile = path.join(current.candidate, "release.json");
    const release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
    release.sourceSha = sha("different-source");
    writeJson(releaseFile, release);
    assert.throws(
      () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
      /source identity does not match|source SHA/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects an archive whose refreshed digest metadata does not prove the claimed Git source", () => {
  const current = fixture();
  try {
    const sourceFile = path.join(current.repository, "messaging", "channels", "whatsapp", "engine", "src", "main.ts");
    fs.writeFileSync(sourceFile, "export const release = 'forged';\n");
    gitOutput(["-C", current.repository, "add", "--all"]);
    gitOutput([
      "-C",
      current.repository,
      "-c",
      "user.email=messaging-contract@example.invalid",
      "-c",
      "user.name=Messaging Contract",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--quiet",
      "-m",
      "forged",
    ]);
    const forgedCommit = gitOutput(["-C", current.repository, "rev-parse", "HEAD"]);
    const archive = path.join(current.candidate, "source.tar.gz");
    fs.writeFileSync(archive, gitBuffer([
      "-C",
      current.repository,
      "archive",
      "--format=tar.gz",
      "--prefix=skincos-" + current.sourceCommit + "/",
      forgedCommit,
    ]));
    const archiveDigest = sha256File(archive);
    fs.writeFileSync(path.join(current.candidate, "source.sha256"), archiveDigest + "\n");
    const releaseFile = path.join(current.candidate, "release.json");
    const release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
    release.sourceArchiveSha256 = archiveDigest;
    writeJson(releaseFile, release);
    const manifestFile = path.join(current.candidate, "release-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    for (const artifacts of [manifest.artifacts, manifest.artifactManifest.artifacts, manifest.releaseIdentity.artifacts]) {
      artifacts.find((entry) => entry.name === "source-archive").digest = archiveDigest;
    }
    writeJson(manifestFile, manifest);
    assert.throws(
      () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
      /Git commit differs/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects an archive whose self-consistent metadata claims a different source tree", () => {
  const current = fixture();
  try {
    const forgedTree = sha("forged-source-tree");
    const releaseFile = path.join(current.candidate, "release.json");
    const release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
    release.sourceTree = forgedTree;
    writeJson(releaseFile, release);

    const manifestFile = path.join(current.candidate, "release-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.sourceTree = forgedTree;
    manifest.artifactManifest.sourceTree = forgedTree;
    manifest.releaseIdentity.sourceTree = forgedTree;
    writeJson(manifestFile, manifest);

    const closureFile = path.join(current.candidate, "messaging-whatsapp-closure.json");
    const originalClosure = JSON.parse(fs.readFileSync(closureFile, "utf8"));
    writeJson(closureFile, closure({
      sourceCommit: current.sourceCommit,
      sourceTree: forgedTree,
      inputBlob: originalClosure.material.inputs[0].blob,
    }));

    assert.throws(
      () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
      /archive tree differs/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects a release candidate placed in a checkout or worktree", () => {
  const current = fixture();
  try {
    fs.writeFileSync(path.join(current.candidate, ".git"), "gitdir: /synthetic/worktree\\n");
    assert.throws(
      () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
      /must not be a checkout or worktree/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects a messaging closure whose tree differs even when its digest is internally valid", () => {
  const current = fixture();
  try {
    const closureFile = path.join(current.candidate, "messaging-whatsapp-closure.json");
    writeJson(closureFile, closure({ sourceCommit: current.sourceCommit, sourceTree: sha("different-tree") }));
    assert.throws(
      () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
      /closure source tree differs/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects a messaging closure whose input blob differs from the immutable source tree", () => {
  const current = fixture();
  try {
    const closureFile = path.join(current.candidate, "messaging-whatsapp-closure.json");
    const value = JSON.parse(fs.readFileSync(closureFile, "utf8"));
    value.inputs[0].blob = sha("forged-engine-input");
    value.material.inputs[0].blob = value.inputs[0].blob;
    value.digest = sha256Text(canonicalJson(value.material));
    writeJson(closureFile, value);
    assert.throws(
      () => validateMessagingReleaseCandidate({ candidateDirectory: current.candidate, releaseSha: current.sourceCommit }),
      /closure input does not match the immutable source tree/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("does not treat a Windows-mounted path as a native release candidate", () => {
  assert.equal(isNativeLinuxPath("/mnt/c/skincos/release-source-" + sha("candidate")), false);
});

test("builds a new release identity only from an attested installed predecessor", () => {
  const current = fixture();
  try {
    const predecessorCommit = current.predecessor.sourceCommit;
    const predecessorTree = current.predecessor.sourceTree;
    const predecessorCandidate = createCandidate(current.root, predecessorCommit, predecessorTree, current.repository);
    const predecessorClosure = JSON.parse(
      fs.readFileSync(path.join(predecessorCandidate.candidate, "messaging-whatsapp-closure.json"), "utf8"),
    );
    const predecessorRoot = path.join(current.root, "releases", predecessorCommit, "messaging-whatsapp");
    const predecessor = createInstalledRelease(predecessorRoot, {
      sourceCommit: predecessorCommit,
      sourceTree: predecessorTree,
      sourceArchiveSha256: predecessorCandidate.archiveDigest,
      releaseManifestSha256: sha256Text("predecessor-manifest"),
      closureValue: predecessorClosure,
    });
    const artifact = path.join(current.root, "candidate-dist.js");
    fs.writeFileSync(artifact, "console.log('candidate');\n");
    const identity = buildMessagingReleaseIdentity({
      candidateDirectory: current.candidate,
      releaseSha: current.sourceCommit,
      artifactFile: artifact,
      predecessorReleaseRoot: predecessorRoot,
    });
    assert.equal(identity.predecessor.sourceCommit, predecessor.sourceCommit);
    assert.equal(identity.predecessor.identityDigest, predecessor.identityDigest);
    assert.match(identity.identityDigest, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects rollback when the current identity does not attest the requested predecessor", () => {
  const current = fixture();
  try {
    const predecessorCommit = current.predecessor.sourceCommit;
    const predecessorTree = current.predecessor.sourceTree;
    const predecessorCandidate = createCandidate(current.root, predecessorCommit, predecessorTree, current.repository);
    const predecessorClosure = JSON.parse(
      fs.readFileSync(path.join(predecessorCandidate.candidate, "messaging-whatsapp-closure.json"), "utf8"),
    );
    const predecessorRoot = path.join(current.root, "releases", predecessorCommit, "messaging-whatsapp");
    const predecessor = createInstalledRelease(predecessorRoot, {
      sourceCommit: predecessorCommit,
      sourceTree: predecessorTree,
      sourceArchiveSha256: predecessorCandidate.archiveDigest,
      releaseManifestSha256: sha256Text("predecessor-manifest"),
      closureValue: predecessorClosure,
    });
    const currentClosure = closure({ sourceCommit: current.sourceCommit, sourceTree: current.sourceTree });
    const currentRoot = path.join(current.root, "releases", current.sourceCommit, "messaging-whatsapp");
    createInstalledRelease(currentRoot, {
      sourceCommit: current.sourceCommit,
      sourceTree: current.sourceTree,
      sourceArchiveSha256: current.archiveDigest,
      releaseManifestSha256: sha256Text("candidate-manifest"),
      closureValue: currentClosure,
      predecessor: {
        sourceCommit: sha("wrong-predecessor"),
        sourceTree: predecessor.sourceTree,
        identityDigest: predecessor.identityDigest,
        artifactDigest: predecessor.artifactDigest,
      },
    });
    assert.throws(
      () => validateMessagingRollbackPair({
        currentReleaseRoot: currentRoot,
        predecessorReleaseRoot: predecessorRoot,
        predecessorCandidateDirectory: predecessorCandidate.candidate,
        predecessorReleaseSha: predecessorCommit,
      }),
      /does not attest the exact rollback predecessor/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects an installed release whose built artifact changed after identity attestation", () => {
  const current = fixture();
  try {
    const releaseRoot = path.join(current.root, "release");
    const releaseClosure = closure({ sourceCommit: current.sourceCommit, sourceTree: current.sourceTree });
    createInstalledRelease(releaseRoot, {
      sourceCommit: current.sourceCommit,
      sourceTree: current.sourceTree,
      sourceArchiveSha256: current.archiveDigest,
      releaseManifestSha256: sha256Text("candidate-manifest"),
      closureValue: releaseClosure,
    });
    fs.writeFileSync(path.join(releaseRoot, "dist", "main.js"), "console.log('tampered');\n");
    assert.throws(
      () => validateInstalledMessagingRelease({ releaseRoot }),
      /whatsapp-dist-main artifact digest differs/,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});
