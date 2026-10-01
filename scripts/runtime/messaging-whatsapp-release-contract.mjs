#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export const MODULE = "messaging-whatsapp";
export const FULL_SHA = /^[0-9a-f]{40}$/i;
export const SHA256 = /^[0-9a-f]{64}$/i;

const TAR_BLOCK_BYTES = 512;
const MAX_RELEASE_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_RELEASE_TAR_BYTES = 512 * 1024 * 1024;
const MAX_RELEASE_TAR_ENTRIES = 200_000;
const MAX_RELEASE_METADATA_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_ARTIFACTS = Object.freeze([
  "source.tar.gz",
  "source.sha256",
  "release.json",
  "release-manifest.json",
  "messaging-whatsapp-closure.json",
]);

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function fullSha(value, label) {
  const normalized = lower(value);
  if (!FULL_SHA.test(normalized)) fail(label + " must be a full SHA.");
  return normalized;
}

function digest(value, label) {
  const normalized = lower(value);
  if (!SHA256.test(normalized)) fail(label + " must be a SHA-256 digest.");
  return normalized;
}

function safeRelativePath(value, label) {
  const normalized = text(value).replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    fail(label + " is not a safe relative path.");
  }
  return normalized;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function isNativeLinuxPath(candidate) {
  const normalized = path.resolve(String(candidate || ""));
  return normalized !== "/mnt" && !normalized.startsWith("/mnt/");
}

function nativeDirectory(candidate, label) {
  const requested = path.resolve(String(candidate || ""));
  if (!isNativeLinuxPath(requested)) fail(label + " must already be on native Linux storage, not /mnt.");
  let resolved;
  try {
    resolved = fs.realpathSync(requested);
  } catch {
    fail(label + " is unavailable.");
  }
  if (!isNativeLinuxPath(resolved)) fail(label + " must resolve to native Linux storage.");
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) fail(label + " must be a directory.");
  let gitMarker = null;
  try {
    gitMarker = fs.lstatSync(path.join(resolved, ".git"));
  } catch (error) {
    if (error?.code !== "ENOENT") fail(label + " cannot verify whether it is a checkout or worktree.");
  }
  if (gitMarker) fail(label + " must not be a checkout or worktree.");
  return resolved;
}

function regularFile(root, relative, label) {
  const candidate = path.resolve(root, relative);
  if (candidate === root || !candidate.startsWith(root + path.sep)) fail(label + " escapes its release root.");
  let entry;
  try {
    entry = fs.lstatSync(candidate);
  } catch {
    fail(label + " is unavailable.");
  }
  if (!entry.isFile() || entry.isSymbolicLink()) fail(label + " must be a regular file.");
  return candidate;
}

function boundedRegularFile(file, label, maximumBytes) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(label + " must be a regular file.");
    if (stat.size > maximumBytes) {
      fail(label + " exceeds the safe size limit.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    fail(label + " size cannot be verified.");
  }
  return file;
}

function boundedArchiveFile(file) {
  try {
    return boundedRegularFile(file, "Release source archive compressed size", MAX_RELEASE_ARCHIVE_BYTES);
  } catch (error) {
    if (error instanceof Error && /exceeds the safe size limit/.test(error.message)) {
      fail("Release source archive compressed size exceeds the safe limit.");
    }
    throw error;
  }
}

function boundedMetadataFile(file, label) {
  return boundedRegularFile(file, label, MAX_RELEASE_METADATA_BYTES);
}

function withBoundedRegularFile(file, label, maximumBytes, operation) {
  const noFollow = fs.constants.O_NOFOLLOW;
  const nonBlock = fs.constants.O_NONBLOCK;
  if (!Number.isInteger(noFollow) || !Number.isInteger(nonBlock)) {
    fail(label + " requires native no-follow and non-blocking file support.");
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow | nonBlock);
  } catch {
    fail(label + " cannot be opened without following links.");
  }
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) fail(label + " must be a regular file.");
    if (before.size > maximumBytes) fail(label + " exceeds the safe size limit.");
    const result = operation(descriptor, before.size);
    const after = fs.fstatSync(descriptor);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
      fail(label + " changed while it was read.");
    }
    return result;
  } finally {
    fs.closeSync(descriptor);
  }
}

function readBoundedRegularFile(file, label, maximumBytes) {
  return withBoundedRegularFile(file, label, maximumBytes, (descriptor, size) => {
    const contents = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const bytesRead = fs.readSync(descriptor, contents, offset, size - offset, null);
      if (bytesRead <= 0) fail(label + " changed while it was read.");
      offset += bytesRead;
    }
    return contents;
  });
}

function sha256BoundedRegularFile(file, label, maximumBytes) {
  return withBoundedRegularFile(file, label, maximumBytes, (descriptor, size) => {
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let remaining = size;
    while (remaining > 0) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, remaining), null);
      if (bytesRead <= 0) fail(label + " changed while it was read.");
      hash.update(buffer.subarray(0, bytesRead));
      remaining -= bytesRead;
    }
    return hash.digest("hex");
  });
}

export function isolatedGitEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !name.toUpperCase().startsWith("GIT_")));
}

function archiveGitCommit(archiveFile) {
  // `git get-tar-commit-id` stops after the PAX header.  For a sufficiently
  // large archive gzip can then legitimately exit with SIGPIPE (141), even
  // though Git read and verified the source header successfully.  Capture the
  // two process statuses explicitly so that only that narrow, expected case is
  // accepted; any other decompression or Git failure remains fail-closed.
  const gitHome = fs.mkdtempSync("/var/tmp/skincos-messaging-git-home-");
  let result;
  try {
    result = spawnSync(
      "/usr/bin/bash",
      [
        "-c",
        [
          "set +e",
          "set +o pipefail",
          "gzip -cd -- \"$1\" | git get-tar-commit-id",
          "statuses=(\"${PIPESTATUS[@]}\")",
          "printf '__SKINCOS_ARCHIVE_PIPESTATUS__=%s,%s\\n' \"${statuses[0]}\" \"${statuses[1]}\" >&2",
          "exit 0",
        ].join("\n"),
        "messaging-release-candidate",
        archiveFile,
      ],
      {
        encoding: "utf8",
        env: {
          PATH: "/usr/bin:/bin",
          HOME: gitHome,
          XDG_CONFIG_HOME: path.join(gitHome, "xdg"),
          GIT_CONFIG_NOSYSTEM: "1",
          LANG: "C",
          LC_ALL: "C",
        },
        cwd: gitHome,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 128 * 1024 * 1024,
      },
    );
  } finally {
    fs.rmSync(gitHome, { recursive: true, force: true });
  }
  const marker = /__SKINCOS_ARCHIVE_PIPESTATUS__=(\d+),(\d+)/.exec(String(result.stderr || ""));
  if (result.error || result.status !== 0 || result.signal || !marker) {
    fail("Release source archive Git commit could not be verified.");
  }
  const gzipStatus = Number(marker[1]);
  const gitStatus = Number(marker[2]);
  if (gitStatus !== 0 || (gzipStatus !== 0 && gzipStatus !== 141)) {
    fail("Release source archive Git commit could not be verified.");
  }
  return lower(result.stdout);
}

function boundedTarNumber(value, label) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) fail(label + " is out of range.");
  return Number(value);
}

function tarNumber(field, label) {
  if (field.length === 0) return 0;
  if (field[0] & 0x80) {
    if (field[0] & 0x40) fail(label + " cannot be negative.");
    let value = BigInt(field[0] & 0x7f);
    for (let index = 1; index < field.length; index += 1) value = (value << 8n) + BigInt(field[index]);
    return boundedTarNumber(value, label);
  }
  const terminator = field.indexOf(0);
  const raw = field.subarray(0, terminator === -1 ? field.length : terminator).toString("ascii").trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) fail(label + " is not an octal TAR number.");
  return boundedTarNumber(BigInt("0o" + raw), label);
}

function paxNumber(value, label) {
  if (!/^[0-9]+$/.test(value)) fail(label + " is not a decimal PAX number.");
  return boundedTarNumber(BigInt(value), label);
}

function tarString(field) {
  const terminator = field.indexOf(0);
  return field.subarray(0, terminator === -1 ? field.length : terminator).toString("utf8");
}

function isZeroTarBlock(block) {
  return block.every((byte) => byte === 0);
}

function assertTarChecksum(header) {
  const expected = tarNumber(header.subarray(148, 156), "Release source archive header checksum");
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) fail("Release source archive header checksum is invalid.");
}

function parsePaxAttributes(payload, label) {
  const attributes = new Map();
  let offset = 0;
  while (offset < payload.length) {
    const separator = payload.indexOf(0x20, offset);
    if (separator <= offset) fail(label + " has an invalid record length.");
    const recordLength = paxNumber(payload.subarray(offset, separator).toString("ascii"), label + " record length");
    const end = offset + recordLength;
    if (end > payload.length || payload[end - 1] !== 0x0a) fail(label + " has a truncated record.");
    const record = payload.subarray(separator + 1, end - 1);
    const equals = record.indexOf(0x3d);
    if (equals <= 0) fail(label + " has an invalid key.");
    const key = record.subarray(0, equals).toString("utf8");
    const value = record.subarray(equals + 1).toString("utf8");
    if (!key || key.includes("\0") || value.includes("\0")) fail(label + " contains a NUL byte.");
    attributes.set(key, value);
    offset = end;
  }
  return attributes;
}

function tarArchivePathParts(entryPath, sourceCommit) {
  const prefix = "skincos-" + sourceCommit + "/";
  if (typeof entryPath !== "string" || entryPath.includes("\0") || /[\r\n]/.test(entryPath) || !entryPath.startsWith(prefix)) {
    fail("Release source archive contains an entry outside its immutable source prefix.");
  }
  const relative = entryPath.slice(prefix.length).replace(/\/+$/, "");
  if (!relative) return [];
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part === ".git")) {
    fail("Release source archive contains checkout metadata or an escaping path.");
  }
  return parts;
}

function archiveDestination(sourceRoot, parts) {
  const destination = path.resolve(sourceRoot, ...parts);
  if (destination !== sourceRoot && !destination.startsWith(sourceRoot + path.sep)) {
    fail("Release source archive entry escapes its native extraction stage.");
  }
  return destination;
}

function ensureArchiveParents(sourceRoot, parts, entries) {
  let current = sourceRoot;
  const parentParts = parts.slice(0, -1);
  for (let index = 0; index < parentParts.length; index += 1) {
    current = path.join(current, parentParts[index]);
    const relative = parentParts.slice(0, index + 1).join("/");
    const known = entries.get(relative);
    if (known === "file" || known === "symlink") {
      fail("Release source archive writes through a non-directory ancestor.");
    }
    if (!known) {
      try {
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          fail("Release source archive parent is not a confined directory.");
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        fs.mkdirSync(current, { mode: 0o755 });
      }
      entries.set(relative, "implicit-directory");
    }
  }
}

function opaqueSymlinkTarget(target) {
  if (!target || target.includes("\0")) {
    fail("Release source archive symlink target is invalid.");
  }
  return target;
}

function materializeGitArchive(archiveFile, stage, sourceCommit) {
  let tarBytes;
  try {
    boundedArchiveFile(archiveFile);
    tarBytes = gunzipSync(
      readBoundedRegularFile(archiveFile, "Release source archive", MAX_RELEASE_ARCHIVE_BYTES),
      { maxOutputLength: MAX_RELEASE_TAR_BYTES },
    );
  } catch {
    fail("Release source archive cannot be decompressed safely.");
  }
  if (!tarBytes.length || tarBytes.length % TAR_BLOCK_BYTES !== 0) {
    fail("Release source archive is not a block-aligned TAR stream.");
  }

  const sourceRoot = path.join(stage, "skincos-" + sourceCommit);
  fs.mkdirSync(sourceRoot, { mode: 0o755 });
  const entries = new Map([["", "implicit-directory"]]);
  const globalPax = new Map();
  const symlinks = [];
  let pendingPax = new Map();
  let offset = 0;
  let terminated = false;
  let headerCount = 0;
  while (offset < tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (isZeroTarBlock(header)) {
      if (offset + (2 * TAR_BLOCK_BYTES) > tarBytes.length
        || !isZeroTarBlock(tarBytes.subarray(offset + TAR_BLOCK_BYTES, offset + (2 * TAR_BLOCK_BYTES)))
        || !isZeroTarBlock(tarBytes.subarray(offset + (2 * TAR_BLOCK_BYTES)))) {
        fail("Release source archive has data after its TAR terminator.");
      }
      terminated = true;
      break;
    }
    headerCount += 1;
    if (headerCount > MAX_RELEASE_TAR_ENTRIES) fail("Release source archive exceeds the safe entry limit.");
    assertTarChecksum(header);
    const headerName = tarString(header.subarray(0, 100));
    const headerPrefix = tarString(header.subarray(345, 500));
    const headerPath = headerPrefix ? headerPrefix + "/" + headerName : headerName;
    const type = String.fromCharCode(header[156] || 0);
    const headerSize = tarNumber(header.subarray(124, 136), "Release source archive entry size");
    const headerMode = tarNumber(header.subarray(100, 108), "Release source archive entry mode");
    const rawPayloadStart = offset + TAR_BLOCK_BYTES;
    const rawPayloadEnd = rawPayloadStart + headerSize;
    const nextOffset = rawPayloadStart + (Math.ceil(headerSize / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES);
    if (rawPayloadEnd > tarBytes.length || nextOffset > tarBytes.length) fail("Release source archive entry is truncated.");
    const rawPayload = tarBytes.subarray(rawPayloadStart, rawPayloadEnd);
    offset = nextOffset;

    if (type === "g" || type === "x") {
      const attributes = parsePaxAttributes(rawPayload, "Release source archive PAX header");
      if (type === "g") {
        if (attributes.has("path") || attributes.has("linkpath") || attributes.has("size")) {
          fail("Release source archive global PAX header changes entry identity.");
        }
        for (const [key, value] of attributes) globalPax.set(key, value);
      } else {
        for (const [key, value] of attributes) pendingPax.set(key, value);
      }
      continue;
    }

    const attributes = new Map([...globalPax, ...pendingPax]);
    pendingPax = new Map();
    const payloadSize = attributes.has("size")
      ? paxNumber(attributes.get("size"), "Release source archive PAX entry size")
      : headerSize;
    if (payloadSize !== headerSize) {
      fail("Release source archive PAX size does not match its TAR entry.");
    }
    const entryPath = attributes.get("path") || headerPath;
    const parts = tarArchivePathParts(entryPath, sourceCommit);
    const destination = archiveDestination(sourceRoot, parts);
    const relative = parts.join("/");

    if (type === "1") fail("Release source archive hard links are not permitted.");
    if (type !== "\0" && type !== "0" && type !== "2" && type !== "5") {
      fail("Release source archive contains an unsupported TAR entry type.");
    }
    if ((type === "2" || type === "5") && rawPayload.length !== 0) {
      fail("Release source archive link or directory entry has unexpected data.");
    }
    if (parts.length === 0) {
      if (type !== "5") fail("Release source archive root is not a directory.");
      entries.set("", "directory");
      continue;
    }
    ensureArchiveParents(sourceRoot, parts, entries);
    const existing = entries.get(relative);
    if (type === "5") {
      if (existing === "implicit-directory") {
        entries.set(relative, "directory");
        continue;
      }
      if (existing) fail("Release source archive contains duplicate entries.");
      fs.mkdirSync(destination, { mode: 0o755 });
      entries.set(relative, "directory");
      continue;
    }
    if (existing) fail("Release source archive contains duplicate entries.");
    if (type === "2") {
      const target = attributes.get("linkpath") || tarString(header.subarray(157, 257));
      symlinks.push({ destination, target: opaqueSymlinkTarget(target) });
      entries.set(relative, "symlink");
      continue;
    }
    fs.writeFileSync(destination, rawPayload, {
      flag: "wx",
      mode: headerMode & 0o111 ? 0o755 : 0o644,
    });
    entries.set(relative, "file");
  }
  if (!terminated || pendingPax.size > 0) fail("Release source archive is missing a complete TAR terminator.");
  for (const { destination, target } of symlinks) fs.symlinkSync(target, destination);
  return sourceRoot;
}

function gitObjectDigest(type, contents) {
  const header = Buffer.from(type + " " + contents.length + "\0", "utf8");
  return crypto.createHash("sha1").update(header).update(contents).digest("hex");
}

function gitBlobDigest(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("Release source archive Git blob is not a regular file.");
  const hash = crypto.createHash("sha1");
  hash.update(Buffer.from("blob " + stat.size + "\0", "utf8"));
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let remaining = stat.size;
    while (remaining > 0) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, remaining), null);
      if (bytesRead <= 0) fail("Release source archive Git blob changed while its tree was reconstructed.");
      hash.update(buffer.subarray(0, bytesRead));
      remaining -= bytesRead;
    }
    const after = fs.fstatSync(descriptor);
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size) {
      fail("Release source archive Git blob changed while its tree was reconstructed.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function gitTreeSort(left, right) {
  const leftName = Buffer.from(left.name + (left.kind === "tree" ? "/" : ""), "utf8");
  const rightName = Buffer.from(right.name + (right.kind === "tree" ? "/" : ""), "utf8");
  return Buffer.compare(leftName, rightName);
}

function reconstructedTreeEntries(sourceRoot, sourceTree) {
  const entries = new Map();
  const rebuildDirectory = (directory, prefix) => {
    const treeEntries = [];
    for (const name of fs.readdirSync(directory)) {
      if (!name || name.includes("\0") || /[\r\n]/.test(name) || name === ".git") {
        fail("Release source archive Git tree path is invalid.");
      }
      const candidate = path.join(directory, name);
      const relative = prefix ? prefix + "/" + name : name;
      const stat = fs.lstatSync(candidate);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        treeEntries.push({ name, kind: "tree", mode: "40000", digest: rebuildDirectory(candidate, relative) });
        continue;
      }
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(candidate);
        if (!target || target.includes("\0")) fail("Release source archive symlink target is invalid.");
        const blob = gitObjectDigest("blob", Buffer.from(target, "utf8"));
        if (entries.has(relative)) fail("Release source archive Git tree contains duplicate paths.");
        entries.set(relative, blob);
        treeEntries.push({ name, kind: "blob", mode: "120000", digest: blob });
        continue;
      }
      if (!stat.isFile()) fail("Release source archive contains an unsupported materialized entry.");
      const blob = gitBlobDigest(candidate);
      if (entries.has(relative)) fail("Release source archive Git tree contains duplicate paths.");
      entries.set(relative, blob);
      treeEntries.push({ name, kind: "blob", mode: stat.mode & 0o111 ? "100755" : "100644", digest: blob });
    }
    treeEntries.sort(gitTreeSort);
    const contents = Buffer.concat(treeEntries.map((entry) => Buffer.concat([
      Buffer.from(entry.mode + " " + entry.name + "\0", "utf8"),
      Buffer.from(entry.digest, "hex"),
    ])));
    return gitObjectDigest("tree", contents);
  };

  const rebuiltTree = rebuildDirectory(sourceRoot, "");
  if (rebuiltTree !== sourceTree) {
    fail("Release source archive tree differs from the requested immutable source tree.");
  }
  return entries;
}

function validateArchiveGitProvenance({ archiveFile, sourceCommit, sourceTree }) {
  const archiveCommit = archiveGitCommit(archiveFile);
  if (archiveCommit !== sourceCommit) {
    fail("Release source archive Git commit differs from the requested immutable source SHA.");
  }

  // The archive's PAX header binds it to the Git source SHA. Reconstruct the
  // complete Git tree directly from raw materialized blobs and canonical Git
  // tree objects. This deliberately never runs `git add`, so candidate
  // .gitattributes and any user/system clean/process filters cannot execute.
  const stage = fs.mkdtempSync("/var/tmp/skincos-messaging-candidate-tree-");
  try {
    const sourceRoot = materializeGitArchive(archiveFile, stage, sourceCommit);
    return reconstructedTreeEntries(sourceRoot, sourceTree);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function externalRegularFile(candidate, label) {
  const resolved = path.resolve(String(candidate || ""));
  let entry;
  try {
    entry = fs.lstatSync(resolved);
  } catch {
    fail(label + " is unavailable.");
  }
  if (!entry.isFile() || entry.isSymbolicLink()) fail(label + " must be a regular file.");
  return resolved;
}

function jsonFile(file, label) {
  try {
    const value = JSON.parse(readBoundedRegularFile(file, label, MAX_RELEASE_METADATA_BYTES).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(label + " must contain a JSON object.");
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    fail(label + " is not valid JSON.");
  }
}

function matchingArtifact(records, name, expectedDigest, label) {
  if (!Array.isArray(records)) fail(label + " artifacts are missing.");
  const matches = records.filter((entry) => entry && typeof entry === "object" && entry.name === name);
  if (matches.length !== 1) fail(label + " must include exactly one " + name + " artifact.");
  if (digest(matches[0].digest, label + " artifact digest") !== expectedDigest) {
    fail(label + " " + name + " artifact digest differs from the attested source archive.");
  }
  return matches[0];
}

export function validateMessagingClosure(closureFile, { sourceSha, sourceTree, sourceEntries = null } = {}) {
  const closure = jsonFile(closureFile, "Messaging closure");
  const expectedSourceSha = fullSha(sourceSha, "Expected source SHA");
  const expectedSourceTree = fullSha(sourceTree, "Expected source tree");
  if (closure.schemaVersion !== 1 || lower(closure.module) !== MODULE) {
    fail("Messaging closure module is invalid.");
  }
  if (fullSha(closure.sourceCommit, "Messaging closure source commit") !== expectedSourceSha) {
    fail("Messaging closure source SHA differs from the release candidate.");
  }
  if (fullSha(closure.sourceTree, "Messaging closure source tree") !== expectedSourceTree) {
    fail("Messaging closure source tree differs from the release candidate.");
  }
  const closureDigest = digest(closure.digest, "Messaging closure digest");
  const material = closure.material;
  if (!material || typeof material !== "object" || Array.isArray(material)
    || material.schemaVersion !== 1 || lower(material.module) !== MODULE || !Array.isArray(material.inputs) || material.inputs.length === 0) {
    fail("Messaging closure material is invalid.");
  }
  if (sha256Text(canonicalJson(material)) !== closureDigest) {
    fail("Messaging closure digest does not match its material.");
  }
  const inputs = material.inputs.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("Messaging closure input is invalid.");
    return {
      path: safeRelativePath(entry.path, "Messaging closure input path"),
      blob: fullSha(entry.blob, "Messaging closure input blob"),
    };
  });
  const sortedPaths = [...inputs.map((entry) => entry.path)].sort((left, right) => left.localeCompare(right));
  if (new Set(sortedPaths).size !== sortedPaths.length || canonicalJson(inputs.map((entry) => entry.path)) !== canonicalJson(sortedPaths)) {
    fail("Messaging closure inputs must be unique and sorted.");
  }
  const declaredPaths = Array.isArray(closure.dependencyClosurePaths)
    ? closure.dependencyClosurePaths.map((entry) => safeRelativePath(entry, "Messaging closure declared path")).sort((left, right) => left.localeCompare(right))
    : sortedPaths;
  if (canonicalJson(declaredPaths) !== canonicalJson(sortedPaths)) {
    fail("Messaging closure declared paths are not bound to its material.");
  }
  if (!Array.isArray(material.dependencyClosurePatterns) || !material.dependencyClosurePatterns.includes("messaging/**")) {
    fail("Messaging closure does not declare the messaging source boundary.");
  }
  if (sourceEntries) {
    for (const entry of inputs) {
      if (sourceEntries.get(entry.path) !== entry.blob) {
        fail("Messaging closure input does not match the immutable source tree.");
      }
    }
  }
  return {
    sourceCommit: expectedSourceSha,
    sourceTree: expectedSourceTree,
    digest: closureDigest,
    paths: sortedPaths,
  };
}

export function validateMessagingReleaseCandidate({ candidateDirectory, releaseSha }) {
  const sourceCommit = fullSha(releaseSha, "Release SHA");
  const root = nativeDirectory(candidateDirectory, "Release candidate");
  if (path.basename(root) !== "release-source-" + sourceCommit) {
    fail("Release candidate must be named release-source-" + sourceCommit + ".");
  }

  const archiveFile = boundedArchiveFile(regularFile(root, "source.tar.gz", "Release source archive"));
  const checksumFile = boundedMetadataFile(regularFile(root, "source.sha256", "Release source checksum"), "Release source checksum");
  const releaseFile = boundedMetadataFile(regularFile(root, "release.json", "Release source identity"), "Release source identity");
  const manifestFile = boundedMetadataFile(regularFile(root, "release-manifest.json", "Release source manifest"), "Release source manifest");
  const closureFile = boundedMetadataFile(regularFile(root, "messaging-whatsapp-closure.json", "Messaging closure"), "Messaging closure");
  const archiveDigest = sha256BoundedRegularFile(archiveFile, "Release source archive", MAX_RELEASE_ARCHIVE_BYTES);
  if (lower(readBoundedRegularFile(checksumFile, "Release source checksum", MAX_RELEASE_METADATA_BYTES).toString("utf8")) !== archiveDigest) {
    fail("Release source checksum does not match the native archive.");
  }

  const release = jsonFile(releaseFile, "Release source identity");
  if (release.schemaVersion !== 1
    || fullSha(release.sourceSha, "Release source SHA") !== sourceCommit
    || !FULL_SHA.test(lower(release.sourceTree))
    || digest(release.sourceArchiveSha256, "Release source archive checksum") !== archiveDigest) {
    fail("Release source identity does not match the requested candidate.");
  }
  const sourceTree = lower(release.sourceTree);
  const sourceEntries = validateArchiveGitProvenance({ archiveFile, sourceCommit, sourceTree });

  const manifest = jsonFile(manifestFile, "Release source manifest");
  if (manifest.schemaVersion !== 1
    || fullSha(manifest.sourceCommit, "Release manifest source SHA") !== sourceCommit
    || fullSha(manifest.sourceTree, "Release manifest source tree") !== sourceTree) {
    fail("Release source manifest identity differs from the candidate.");
  }
  matchingArtifact(manifest.artifacts, "source-archive", archiveDigest, "Release source manifest");
  if (!manifest.artifactManifest || typeof manifest.artifactManifest !== "object"
    || fullSha(manifest.artifactManifest.sourceCommit, "Release artifact manifest source SHA") !== sourceCommit
    || fullSha(manifest.artifactManifest.sourceTree, "Release artifact manifest source tree") !== sourceTree) {
    fail("Release artifact manifest identity differs from the candidate.");
  }
  matchingArtifact(manifest.artifactManifest.artifacts, "source-archive", archiveDigest, "Release artifact manifest");
  if (!manifest.releaseIdentity || typeof manifest.releaseIdentity !== "object"
    || fullSha(manifest.releaseIdentity.sourceCommit, "Release manifest identity source SHA") !== sourceCommit
    || fullSha(manifest.releaseIdentity.sourceTree, "Release manifest identity source tree") !== sourceTree) {
    fail("Release manifest release identity differs from the candidate.");
  }
  matchingArtifact(manifest.releaseIdentity.artifacts, "source-archive", archiveDigest, "Release manifest release identity");

  const closure = validateMessagingClosure(closureFile, { sourceSha: sourceCommit, sourceTree, sourceEntries });
  return {
    sourceCommit,
    sourceTree,
    sourceArchiveSha256: archiveDigest,
    releaseManifestSha256: sha256BoundedRegularFile(manifestFile, "Release source manifest", MAX_RELEASE_METADATA_BYTES),
    closureDigest: closure.digest,
    closureFile,
    archiveFile,
  };
}

function snapshotArtifactLimit(relative) {
  return relative === "source.tar.gz" ? MAX_RELEASE_ARCHIVE_BYTES : MAX_RELEASE_METADATA_BYTES;
}

function copySnapshotRegularFile(root, snapshot, relative) {
  const label = "Release candidate " + relative;
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(root + path.sep)) fail(label + " escapes its release root.");
  const noFollow = fs.constants.O_NOFOLLOW;
  const nonBlock = fs.constants.O_NONBLOCK;
  if (!Number.isInteger(noFollow) || !Number.isInteger(nonBlock)) {
    fail("Release candidate snapshot requires native no-follow and non-blocking file support.");
  }
  let sourceDescriptor = null;
  let snapshotDescriptor = null;
  try {
    sourceDescriptor = fs.openSync(candidate, fs.constants.O_RDONLY | noFollow | nonBlock);
  } catch {
    fail(label + " cannot be opened without following links.");
  }
  try {
    const before = fs.fstatSync(sourceDescriptor);
    if (!before.isFile()) fail(label + " must be a regular file.");
    if (before.size > snapshotArtifactLimit(relative)) {
      fail(label + " exceeds the safe snapshot size limit.");
    }
    const destination = path.join(snapshot, relative);
    snapshotDescriptor = fs.openSync(
      destination,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(before.size, 1)));
    let copied = 0;
    while (copied < before.size) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, Math.min(buffer.length, before.size - copied), null);
      if (bytesRead <= 0) fail(label + " changed while its private snapshot was captured.");
      let written = 0;
      while (written < bytesRead) {
        const bytesWritten = fs.writeSync(snapshotDescriptor, buffer, written, bytesRead - written, null);
        if (bytesWritten <= 0) fail(label + " cannot be copied into the private snapshot.");
        written += bytesWritten;
      }
      copied += bytesRead;
    }
    const after = fs.fstatSync(sourceDescriptor);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
      fail(label + " changed while its private snapshot was captured.");
    }
    fs.fsyncSync(snapshotDescriptor);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    fail(label + " cannot be copied into the private snapshot.");
  } finally {
    if (snapshotDescriptor !== null) fs.closeSync(snapshotDescriptor);
    if (sourceDescriptor !== null) fs.closeSync(sourceDescriptor);
  }
}

function privateSnapshotDirectory(snapshotDirectory, sourceCommit) {
  const requested = path.resolve(String(snapshotDirectory || ""));
  const expectedName = "release-source-" + sourceCommit;
  if (path.basename(requested) !== expectedName) {
    fail("Release candidate snapshot must be named " + expectedName + ".");
  }
  const parent = nativeDirectory(path.dirname(requested), "Release candidate snapshot parent");
  const snapshot = path.join(parent, expectedName);
  if (!isNativeLinuxPath(snapshot)) fail("Release candidate snapshot must be on native Linux storage.");
  try {
    fs.mkdirSync(snapshot, { mode: 0o700 });
    fs.chmodSync(snapshot, 0o700);
  } catch {
    fail("Release candidate snapshot directory cannot be created privately.");
  }
  return snapshot;
}

export function snapshotMessagingReleaseCandidate({ candidateDirectory, releaseSha, snapshotDirectory } = {}) {
  const sourceCommit = fullSha(releaseSha, "Release SHA");
  const root = nativeDirectory(candidateDirectory, "Release candidate");
  if (path.basename(root) !== "release-source-" + sourceCommit) {
    fail("Release candidate must be named release-source-" + sourceCommit + ".");
  }
  const snapshot = privateSnapshotDirectory(snapshotDirectory, sourceCommit);
  try {
    for (const artifact of SNAPSHOT_ARTIFACTS) {
      copySnapshotRegularFile(root, snapshot, artifact);
    }
    return validateMessagingReleaseCandidate({ candidateDirectory: snapshot, releaseSha: sourceCommit });
  } catch (error) {
    fs.rmSync(snapshot, { recursive: true, force: true });
    throw error;
  }
}

export function materializeMessagingReleaseCandidate({ candidateDirectory, releaseSha, stageDirectory } = {}) {
  const candidate = validateMessagingReleaseCandidate({ candidateDirectory, releaseSha });
  const stage = nativeDirectory(stageDirectory, "Release candidate materialization stage");
  if (fs.readdirSync(stage).length !== 0) fail("Release candidate materialization stage must be empty.");
  const sourceRoot = materializeGitArchive(candidate.archiveFile, stage, candidate.sourceCommit);
  const sourceEntries = reconstructedTreeEntries(sourceRoot, candidate.sourceTree);
  const closure = validateMessagingClosure(candidate.closureFile, {
    sourceSha: candidate.sourceCommit,
    sourceTree: candidate.sourceTree,
    sourceEntries,
  });
  if (closure.digest !== candidate.closureDigest) {
    fail("Release candidate materialization closure differs from its private snapshot.");
  }
  return { ...candidate, sourceRoot };
}

function releaseIdentityObject(identityFile) {
  const identity = jsonFile(identityFile, "Installed messaging release identity");
  if (identity.schemaVersion !== 2 || lower(identity.module) !== MODULE) {
    fail("Installed messaging release identity schema or module is invalid.");
  }
  const sourceCommit = fullSha(identity.sourceCommit, "Installed messaging source commit");
  const sourceTree = fullSha(identity.sourceTree, "Installed messaging source tree");
  const sourceArchiveSha256 = digest(identity.sourceArchiveSha256, "Installed messaging source archive checksum");
  const releaseManifestSha256 = digest(identity.releaseManifestSha256, "Installed messaging release manifest checksum");
  const dependencyClosureDigest = digest(identity.dependencyClosureDigest, "Installed messaging closure digest");
  const identityDigest = digest(identity.identityDigest, "Installed messaging identity digest");
  const signed = { ...identity };
  delete signed.identityDigest;
  if (sha256Text(canonicalJson(signed)) !== identityDigest) {
    fail("Installed messaging identity digest does not match its content.");
  }
  return {
    identity,
    sourceCommit,
    sourceTree,
    sourceArchiveSha256,
    releaseManifestSha256,
    dependencyClosureDigest,
    identityDigest,
  };
}

export function validateInstalledMessagingRelease({
  releaseRoot,
  expectedReleaseSha = null,
  expectedSourceTree = null,
  expectedClosureDigest = null,
  expectedPredecessorSha = null,
} = {}) {
  const root = nativeDirectory(releaseRoot, "Installed messaging release");
  const identityFile = regularFile(root, ".skincos-release-identity-messaging-whatsapp.json", "Installed messaging release identity");
  const closureFile = regularFile(root, ".skincos-global-coordination-messaging-whatsapp.json", "Installed messaging closure");
  const artifactFile = regularFile(root, "dist/main.js", "Installed messaging artifact");
  const parsed = releaseIdentityObject(identityFile);
  if (expectedReleaseSha && parsed.sourceCommit !== fullSha(expectedReleaseSha, "Expected installed release SHA")) {
    fail("Installed messaging release SHA differs from the required release.");
  }
  if (expectedSourceTree && parsed.sourceTree !== fullSha(expectedSourceTree, "Expected installed source tree")) {
    fail("Installed messaging source tree differs from the required source tree.");
  }
  if (expectedClosureDigest && parsed.dependencyClosureDigest !== digest(expectedClosureDigest, "Expected installed closure digest")) {
    fail("Installed messaging closure digest differs from the required closure.");
  }
  const artifact = matchingArtifact(parsed.identity.artifacts, "whatsapp-dist-main", sha256File(artifactFile), "Installed messaging release");
  if (text(artifact.id) !== "whatsapp-dist:" + parsed.sourceCommit) {
    fail("Installed messaging artifact ID is not bound to its immutable source.");
  }
  const sourceArchive = matchingArtifact(parsed.identity.artifacts, "release-source-archive", parsed.sourceArchiveSha256, "Installed messaging release");
  if (text(sourceArchive.id) !== "release-source:" + parsed.sourceCommit) {
    fail("Installed messaging source archive ID is not bound to its immutable source.");
  }
  const closure = validateMessagingClosure(closureFile, {
    sourceSha: parsed.sourceCommit,
    sourceTree: parsed.sourceTree,
  });
  if (closure.digest !== parsed.dependencyClosureDigest) {
    fail("Installed messaging closure differs from its release identity.");
  }

  const predecessor = parsed.identity.predecessor;
  if (expectedPredecessorSha) {
    const expected = fullSha(expectedPredecessorSha, "Expected predecessor SHA");
    if (!predecessor || typeof predecessor !== "object" || Array.isArray(predecessor)
      || fullSha(predecessor.sourceCommit, "Installed messaging predecessor source SHA") !== expected
      || expected === parsed.sourceCommit
      || !FULL_SHA.test(lower(predecessor.sourceTree))
      || !SHA256.test(lower(predecessor.identityDigest))
      || !SHA256.test(lower(predecessor.artifactDigest))) {
      fail("Installed messaging release does not attest the exact rollback predecessor.");
    }
  }
  return {
    sourceCommit: parsed.sourceCommit,
    sourceTree: parsed.sourceTree,
    dependencyClosureDigest: parsed.dependencyClosureDigest,
    sourceArchiveSha256: parsed.sourceArchiveSha256,
    releaseManifestSha256: parsed.releaseManifestSha256,
    identityDigest: parsed.identityDigest,
    artifactDigest: artifact.digest,
    predecessor: predecessor || null,
  };
}

export function buildMessagingReleaseIdentity({ candidateDirectory, releaseSha, artifactFile, predecessorReleaseRoot }) {
  const candidate = validateMessagingReleaseCandidate({ candidateDirectory, releaseSha });
  const artifact = externalRegularFile(artifactFile, "Messaging build artifact");
  const predecessor = validateInstalledMessagingRelease({ releaseRoot: predecessorReleaseRoot });
  if (predecessor.sourceCommit === candidate.sourceCommit) {
    fail("Messaging release predecessor must differ from the candidate source.");
  }
  const identity = {
    schemaVersion: 2,
    module: MODULE,
    sourceCommit: candidate.sourceCommit,
    sourceTree: candidate.sourceTree,
    sourceArchiveSha256: candidate.sourceArchiveSha256,
    releaseManifestSha256: candidate.releaseManifestSha256,
    dependencyClosureDigest: candidate.closureDigest,
    artifacts: [
      { name: "release-source-archive", id: "release-source:" + candidate.sourceCommit, digest: candidate.sourceArchiveSha256 },
      { name: "whatsapp-dist-main", id: "whatsapp-dist:" + candidate.sourceCommit, digest: sha256File(artifact) },
    ],
    predecessor: {
      sourceCommit: predecessor.sourceCommit,
      sourceTree: predecessor.sourceTree,
      identityDigest: predecessor.identityDigest,
      artifactDigest: predecessor.artifactDigest,
    },
  };
  return { ...identity, identityDigest: sha256Text(canonicalJson(identity)) };
}

export function validateMessagingRollbackPair({
  currentReleaseRoot,
  predecessorReleaseRoot,
  predecessorCandidateDirectory,
  predecessorReleaseSha,
} = {}) {
  const candidate = validateMessagingReleaseCandidate({
    candidateDirectory: predecessorCandidateDirectory,
    releaseSha: predecessorReleaseSha,
  });
  const predecessor = validateInstalledMessagingRelease({
    releaseRoot: predecessorReleaseRoot,
    expectedReleaseSha: candidate.sourceCommit,
    expectedSourceTree: candidate.sourceTree,
    expectedClosureDigest: candidate.closureDigest,
  });
  const current = validateInstalledMessagingRelease({
    releaseRoot: currentReleaseRoot,
    expectedPredecessorSha: predecessor.sourceCommit,
  });
  const recorded = current.predecessor;
  if (!recorded
    || lower(recorded.sourceTree) !== predecessor.sourceTree
    || lower(recorded.identityDigest) !== predecessor.identityDigest
    || lower(recorded.artifactDigest) !== predecessor.artifactDigest) {
    fail("Messaging rollback predecessor identity differs from the installed attested release.");
  }
  return { current, predecessor, candidate };
}

function argument(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function requiredArgument(args, name) {
  const value = argument(args, name);
  if (!value) fail(name + " is required.");
  return value;
}

function output(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function candidateSummary(candidate) {
  return {
    module: MODULE,
    sourceCommit: candidate.sourceCommit,
    sourceTree: candidate.sourceTree,
    sourceArchiveSha256: candidate.sourceArchiveSha256,
    releaseManifestSha256: candidate.releaseManifestSha256,
    dependencyClosureDigest: candidate.closureDigest,
  };
}

function installedSummary(release) {
  return {
    module: MODULE,
    sourceCommit: release.sourceCommit,
    sourceTree: release.sourceTree,
    dependencyClosureDigest: release.dependencyClosureDigest,
    sourceArchiveSha256: release.sourceArchiveSha256,
    releaseManifestSha256: release.releaseManifestSha256,
    identityDigest: release.identityDigest,
    artifactDigest: release.artifactDigest,
  };
}

async function main(args) {
  const command = args[0];
  if (command === "verify-candidate") {
    output(candidateSummary(validateMessagingReleaseCandidate({
      candidateDirectory: requiredArgument(args, "--candidate"),
      releaseSha: requiredArgument(args, "--release-sha"),
    })));
    return;
  }
  if (command === "snapshot-candidate") {
    output(candidateSummary(snapshotMessagingReleaseCandidate({
      candidateDirectory: requiredArgument(args, "--candidate"),
      releaseSha: requiredArgument(args, "--release-sha"),
      snapshotDirectory: requiredArgument(args, "--snapshot"),
    })));
    return;
  }
  if (command === "materialize-candidate") {
    const result = materializeMessagingReleaseCandidate({
      candidateDirectory: requiredArgument(args, "--candidate"),
      releaseSha: requiredArgument(args, "--release-sha"),
      stageDirectory: requiredArgument(args, "--stage"),
    });
    output({ ...candidateSummary(result), sourceRoot: result.sourceRoot });
    return;
  }
  if (command === "verify-installed") {
    output(installedSummary(validateInstalledMessagingRelease({
      releaseRoot: requiredArgument(args, "--release-root"),
      expectedReleaseSha: argument(args, "--expected-release-sha"),
      expectedSourceTree: argument(args, "--expected-source-tree"),
      expectedClosureDigest: argument(args, "--expected-closure-digest"),
      expectedPredecessorSha: argument(args, "--expected-predecessor-sha"),
    })));
    return;
  }
  if (command === "verify-installed-candidate") {
    const candidate = validateMessagingReleaseCandidate({
      candidateDirectory: requiredArgument(args, "--candidate"),
      releaseSha: requiredArgument(args, "--release-sha"),
    });
    output(installedSummary(validateInstalledMessagingRelease({
      releaseRoot: requiredArgument(args, "--release-root"),
      expectedReleaseSha: candidate.sourceCommit,
      expectedSourceTree: candidate.sourceTree,
      expectedClosureDigest: candidate.closureDigest,
    })));
    return;
  }
  if (command === "verify-rollback-pair") {
    const result = validateMessagingRollbackPair({
      currentReleaseRoot: requiredArgument(args, "--current-release-root"),
      predecessorReleaseRoot: requiredArgument(args, "--predecessor-release-root"),
      predecessorCandidateDirectory: requiredArgument(args, "--predecessor-candidate"),
      predecessorReleaseSha: requiredArgument(args, "--predecessor-release-sha"),
    });
    output({
      module: MODULE,
      currentSourceCommit: result.current.sourceCommit,
      predecessorSourceCommit: result.predecessor.sourceCommit,
      predecessorIdentityDigest: result.predecessor.identityDigest,
      predecessorArtifactDigest: result.predecessor.artifactDigest,
    });
    return;
  }
  if (command === "build-identity") {
    output(buildMessagingReleaseIdentity({
      candidateDirectory: requiredArgument(args, "--candidate"),
      releaseSha: requiredArgument(args, "--release-sha"),
      artifactFile: requiredArgument(args, "--artifact"),
      predecessorReleaseRoot: requiredArgument(args, "--predecessor-release-root"),
    }));
    return;
  }
  fail("Usage: messaging-whatsapp-release-contract.mjs verify-candidate|snapshot-candidate|materialize-candidate|verify-installed|verify-installed-candidate|verify-rollback-pair|build-identity ...");
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
