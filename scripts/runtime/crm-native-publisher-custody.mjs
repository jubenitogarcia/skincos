#!/usr/bin/env node
/*
 * Root-owned custody boundary for the dedicated CRM native release.
 *
 * The GitHub runner can invoke only `preflight` and `publish` through a
 * literal sudoers rule.  It never supplies a destination, service name, unit
 * body, or executable path.  A root-installed policy pins the exact source
 * artifact, staging receipt, runtime attestation and public signing key.
 */
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  publisherPolicySha256,
  sha256Hex,
  validatePublisherPolicy,
  verifyPublisherAuthorization,
} from "./crm-native-publisher-claims.mjs";
import { extractCrmNativeSourceArchive } from "./crm-native-source-bundle.mjs";
import {
  validateCrmNativePointer,
  validateCrmNativeRelease,
  validateCrmNativeSuccessor,
} from "./crm-native-release-contract.mjs";
import { checkGlobalLease } from "../codex-global-coordination-client.mjs";

export const CRM_NATIVE_POLICY_DIR = "/etc/skincos/crm-native-publisher";
export const CRM_NATIVE_POLICY_FILE = path.join(CRM_NATIVE_POLICY_DIR, "policy.json");
export const CRM_NATIVE_STATE_DIR = "/var/lib/skincos-runtime/crm-native-publisher";
export const CRM_NATIVE_GLOBAL_COORDINATION_FILE = "/etc/skincos/global-coordination/native-runtime.env";
const MAX_AUTHORIZATION_BYTES = 128 * 1024;
const COPY_BUFFER_BYTES = 128 * 1024;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CrmNativePublisherCustodyError extends Error {
  constructor(message) {
    super(`CRM native publisher custody: ${message}`);
    this.name = "CrmNativePublisherCustodyError";
  }
}

function fail(message) {
  throw new CrmNativePublisherCustodyError(message);
}

function assertLinuxRoot() {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0) {
    fail("command requires Linux root");
  }
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) fail("native no-follow support is required");
}

function exactChild(parent, name, label) {
  const resolvedParent = path.resolve(parent);
  const candidate = path.resolve(resolvedParent, name);
  if (path.dirname(candidate) !== resolvedParent || path.basename(candidate) !== name) fail(`${label} path is invalid`);
  return candidate;
}

function assertDirectory(directory, { uid = null, mode = null } = {}) {
  const resolved = path.resolve(directory);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { fail("required directory is unavailable"); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(resolved) !== resolved) {
    fail("required directory is not a real directory");
  }
  if (uid !== null && stat.uid !== uid) fail("required directory owner is invalid");
  if (mode !== null && (stat.mode & 0o777) !== mode) fail("required directory mode is invalid");
  return resolved;
}

function assertRootSystemDirectory(directory, label) {
  const resolved = path.resolve(directory);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { fail(`${label} is unavailable`); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(resolved) !== resolved
    || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
    fail(`${label} is not a root-owned safe directory`);
  }
  return resolved;
}

function ensurePrivateDirectory(directory) {
  const resolved = path.resolve(directory);
  try {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
    fs.chownSync(resolved, 0, 0);
    fs.chmodSync(resolved, 0o700);
  } catch { fail("private directory cannot be created"); }
  return assertDirectory(resolved, { uid: 0, mode: 0o700 });
}

function assertPrivateFile(file) {
  const resolved = path.resolve(file);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { fail("private file is unavailable"); }
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(resolved) !== resolved
    || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) {
    fail("private file metadata is invalid");
  }
  return resolved;
}

function writePrivateFile(file, value) {
  const directory = assertDirectory(path.dirname(file), { uid: 0, mode: 0o700 });
  const destination = exactChild(directory, path.basename(file), "private file");
  const temporary = exactChild(directory, `.${path.basename(file)}.tmp.${process.pid}.${crypto.randomBytes(12).toString("hex")}`, "private file");
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, raw);
    fs.fchownSync(descriptor, 0, 0);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, destination);
    assertPrivateFile(destination);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  } finally {
    if (!Buffer.isBuffer(value)) raw.fill(0);
  }
}

function readPrivateJson(file) {
  const trusted = assertPrivateFile(file);
  const descriptor = fs.openSync(trusted, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let raw;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > 256 * 1024) {
      fail("private file changed during read");
    }
    raw = fs.readFileSync(descriptor, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof CrmNativePublisherCustodyError) throw error;
    fail("private JSON is invalid");
  } finally {
    if (typeof raw === "string") raw = "";
    fs.closeSync(descriptor);
  }
}

function readBoundedJsonLine(descriptor = 0) {
  const chunks = [];
  const byte = Buffer.allocUnsafe(1);
  let length = 0;
  try {
    while (length <= MAX_AUTHORIZATION_BYTES) {
      const read = fs.readSync(descriptor, byte, 0, 1, null);
      if (read === 0) fail("authorization input is missing");
      if (byte[0] === 0x0a) break;
      if (byte[0] === 0x0d) fail("authorization input contains CR");
      chunks.push(Buffer.from(byte));
      length += 1;
    }
    if (length < 2 || length > MAX_AUTHORIZATION_BYTES) fail("authorization input size is invalid");
    const raw = Buffer.concat(chunks, length);
    try { return JSON.parse(raw.toString("utf8")); }
    catch { fail("authorization input is not valid JSON"); }
    finally { raw.fill(0); }
  } finally {
    byte.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

function copyExactFromStdin({ destination, bytes, expectedSha256, maximumBytes }) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximumBytes || !DIGEST.test(expectedSha256)) {
    fail("incoming archive contract is invalid");
  }
  const directory = assertDirectory(path.dirname(destination), { uid: 0, mode: 0o700 });
  const output = exactChild(directory, path.basename(destination), "incoming archive");
  const descriptor = fs.openSync(output, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, bytes));
  let remaining = bytes;
  try {
    while (remaining > 0) {
      const read = fs.readSync(0, buffer, 0, Math.min(buffer.length, remaining), null);
      if (read <= 0) fail("incoming archive ended early");
      hash.update(buffer.subarray(0, read));
      let offset = 0;
      while (offset < read) offset += fs.writeSync(descriptor, buffer, offset, read - offset);
      remaining -= read;
    }
    fs.fsyncSync(descriptor);
    const actual = hash.digest("hex");
    const stat = fs.fstatSync(descriptor);
    if (actual !== expectedSha256 || stat.size !== bytes || !stat.isFile() || stat.nlink !== 1) {
      fail("incoming archive digest or size differs");
    }
  } finally {
    buffer.fill(0);
    fs.closeSync(descriptor);
  }
  return output;
}

function assertEndOfInput() {
  const byte = Buffer.allocUnsafe(1);
  try {
    if (fs.readSync(0, byte, 0, 1, null) !== 0) fail("incoming publisher stream contains trailing bytes");
  } finally { byte.fill(0); }
}

function command(binary, args, { timeout = 30_000, input = "ignore", maxBuffer = 4 * 1024 * 1024 } = {}) {
  const result = childProcess.spawnSync(binary, args, {
    encoding: "buffer",
    timeout,
    maxBuffer,
    stdio: [input, "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || result.signal) fail("fixed host command failed");
  return result.stdout;
}

function readSystemctlProperties() {
  const fields = ["LoadState", "ActiveState", "SubState", "MainPID", "FragmentPath", "DropInPaths", "WorkingDirectory"];
  const output = command("/usr/bin/systemctl", ["show", "crm.service", `--property=${fields.join(",")}`], { timeout: 10_000 });
  const result = Object.fromEntries(fields.map((field) => [field, ""]));
  for (const line of output.toString("utf8").split("\n")) {
    const index = line.indexOf("=");
    if (index > 0 && Object.hasOwn(result, line.slice(0, index))) result[line.slice(0, index)] = line.slice(index + 1);
  }
  if (result.LoadState !== "loaded" || !/^[1-9][0-9]*$/.test(result.MainPID) || !result.FragmentPath) {
    fail("crm.service incumbent systemd state is unavailable");
  }
  return result;
}

function regularRootFile(file, label) {
  const resolved = path.resolve(file);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { fail(`${label} is unavailable`); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.nlink !== 1 || (stat.mode & 0o022) !== 0) fail(`${label} is invalid`);
  return resolved;
}

function readDropIns(paths) {
  const values = String(paths || "").split(" ").filter(Boolean);
  const seen = new Set();
  const entries = [];
  for (const candidate of values) {
    const file = regularRootFile(candidate, "crm.service drop-in");
    if (!file.startsWith("/etc/systemd/system/crm.service.d/") || seen.has(file)) fail("crm.service drop-in path is invalid");
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    if (/^(?:ExecStart|WorkingDirectory|EnvironmentFile)\s*=/m.test(source)
      || /^Environment\s*=\s*(?:CRM_NATIVE_RELEASE_ROOT|CRM_NATIVE_DEPLOYMENT_TARGET|PATH)=/m.test(source)) {
      fail("crm.service drop-in may redirect the dedicated runtime");
    }
    entries.push({ path: file, sha256: sha256Hex(source), mode: statMode(file) });
  }
  return entries;
}

function describeDropInDirectory() {
  const directory = "/etc/systemd/system/crm.service.d";
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || fs.realpathSync.native(directory) !== directory) {
      fail("crm.service drop-in directory is invalid");
    }
    assertRootSystemDirectory(directory, "crm.service drop-in directory");
    return { exists: true, path: directory, mode: stat.mode & 0o777 };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, path: directory };
    throw error;
  }
}

function statMode(file) {
  return fs.lstatSync(file).mode & 0o777;
}

function describePointer(link, releaseBase) {
  const resolvedLink = path.resolve(link);
  assertRootSystemDirectory(path.dirname(resolvedLink), "CRM dedicated pointer directory");
  let stat;
  try {
    stat = fs.lstatSync(resolvedLink);
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
  if (!stat.isSymbolicLink()) fail("CRM dedicated pointer is not a symbolic link");
  const value = validateCrmNativePointer({ releaseBase, link: resolvedLink });
  return { exists: true, target: fs.realpathSync.native(resolvedLink), releaseSha: value.releaseSha };
}

function describeSharedSourcePointer() {
  const pointer = "/opt/skincos/current/source";
  assertRootSystemDirectory(path.dirname(pointer), "shared source pointer directory");
  try {
    const stat = fs.lstatSync(pointer);
    if (!stat.isSymbolicLink()) fail("shared source pointer is not a symbolic link");
    const target = fs.realpathSync.native(pointer);
    return { exists: true, target, sha256: sha256Hex(target) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

export function collectIncumbentState(policy) {
  const target = policy.target;
  const systemd = readSystemctlProperties();
  if (path.resolve(systemd.FragmentPath) !== target.unitFile) fail("crm.service fragment path differs from policy");
  const unitFile = regularRootFile(target.unitFile, "crm.service unit");
  const mainPid = Number(systemd.MainPID);
  let cwd = null;
  try { cwd = fs.realpathSync.native(`/proc/${mainPid}/cwd`); } catch { fail("crm.service main process is unavailable"); }
  const state = {
    schemaVersion: 1,
    service: target.service,
    unit: { path: unitFile, sha256: sha256Hex(fs.readFileSync(unitFile)), mode: statMode(unitFile) },
    dropIns: readDropIns(systemd.DropInPaths),
    dropInDirectory: describeDropInDirectory(),
    systemd: {
      activeState: systemd.ActiveState,
      subState: systemd.SubState,
      mainPid,
      workingDirectory: systemd.WorkingDirectory,
      processCwd: cwd,
    },
    dedicatedPointers: {
      current: describePointer(target.currentLink, target.releaseBase),
      previous: describePointer(target.previousLink, target.releaseBase),
    },
    sharedSourcePointer: describeSharedSourcePointer(),
  };
  return { state, sha256: sha256Hex(canonicalJson(state)) };
}

function consumeAuthorization(directory, claims) {
  const ledger = exactChild(directory, `${claims.authorizationId}.json`, "authorization ledger");
  const record = `${JSON.stringify({ schemaVersion: 1, authorizationId: claims.authorizationId, policySha256: claims.policySha256, consumedAt: new Date().toISOString() })}\n`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(ledger, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, record);
    fs.fchownSync(descriptor, 0, 0);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error?.code === "EEXIST") fail("authorization was already consumed");
    throw error;
  } finally { if (descriptor !== null) fs.closeSync(descriptor); }
}

export function assertCandidateTree(root, { maximumBytes, maximumEntries, expectedUid = 0 }) {
  const trusted = assertDirectory(root, { uid: expectedUid });
  const stack = [trusted];
  let bytes = 0;
  let entries = 0;
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const stat = fs.lstatSync(file);
      entries += 1;
      if (entries > maximumEntries) fail("candidate entry count exceeds policy");
      if (entry.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) fail("candidate contains a link or special file");
      if (entry.isFile()) {
        if (stat.nlink !== 1 || stat.size < 0) fail("candidate contains a hard-linked file");
        bytes += stat.size;
        if (bytes > maximumBytes) fail("candidate extracted bytes exceed policy");
      } else {
        stack.push(file);
      }
    }
  }
  return { bytes, entries };
}

function safeArchiveMember(member) {
  if (typeof member !== "string" || !member || member.includes("\\") || member.includes("\0") || member.includes("\r") || member.includes("\n")) fail("dependency archive member is invalid");
  const normalized = member.startsWith("./") ? member.slice(2) : member;
  const clean = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  if (!clean || clean.startsWith("/") || clean.includes("//") || clean.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("dependency archive member is invalid");
  }
  return { original: member, normalized: clean };
}

function extractDependencyArchive({ archive, outputDirectory, policy }) {
  const stat = fs.lstatSync(archive);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("dependency archive is invalid");
  const listing = command("/usr/bin/tar", ["--list", "--gzip", "--file", archive], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  const members = listing.split("\n").filter(Boolean);
  if (members.length < 1 || members.length > policy.maximumDependencyEntries) fail("dependency archive entry count is invalid");
  const selected = members.map(safeArchiveMember);
  for (const member of selected) {
    if (!(member.normalized === "crm" || member.normalized === "crm/api" || member.normalized === "crm/api/node_modules" || member.normalized.startsWith("crm/api/node_modules/"))) {
      fail("dependency archive contains a path outside crm/api/node_modules");
    }
  }
  const verbose = command("/usr/bin/tar", ["--list", "--verbose", "--gzip", "--file", archive, "--no-recursion", ...selected.map((item) => item.original)], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  const verboseEntries = verbose.split("\n").filter(Boolean);
  if (verboseEntries.length !== selected.length || verboseEntries.some((line) => !["-", "d"].includes(line[0]))) {
    fail("dependency archive contains a link or special member");
  }
  command("/usr/bin/tar", ["--extract", "--gzip", "--file", archive, "--directory", outputDirectory, "--no-same-owner", "--no-same-permissions", "--no-recursion", ...selected.map((item) => item.original)], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  return assertCandidateTree(path.join(outputDirectory, "crm", "api", "node_modules"), {
    maximumBytes: policy.maximumDependencyExtractedBytes,
    maximumEntries: policy.maximumDependencyEntries,
  });
}

function setCandidateOwnership(root) {
  const trusted = assertDirectory(root, { uid: 0 });
  const stack = [trusted];
  while (stack.length) {
    const current = stack.pop();
    fs.chownSync(current, 0, 0);
    fs.chmodSync(current, 0o755);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const stat = fs.lstatSync(file);
      if (entry.isDirectory()) stack.push(file);
      else if (entry.isFile() && !entry.isSymbolicLink() && stat.nlink === 1) {
        fs.chownSync(file, 0, 0);
        fs.chmodSync(file, file.endsWith(".sh") ? 0o755 : 0o644);
      } else fail("candidate ownership traversal encountered an unsafe entry");
    }
  }
}

function assertNoFileCapabilities(root) {
  // GNU tar extraction is deliberately not asked to preserve xattrs, but make
  // the final release tree prove that a crafted archive did not leave a Linux
  // file capability behind. `getcap` is fixed, root-owned host tooling.
  const output = command("/usr/sbin/getcap", ["-r", "--", root], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (output.toString("utf8").trim()) fail("candidate contains file capabilities");
}

export function renderCrmNativeUnit({ releaseRoot, mediaRouteMode }) {
  if (typeof releaseRoot !== "string" || !/^\/opt\/skincos\/releases\/[0-9a-f]{40}\/crm-service$/.test(releaseRoot)) fail("native unit release root is invalid");
  if (mediaRouteMode !== "enabled" && mediaRouteMode !== "disabled") fail("native unit media route mode is invalid");
  return `[Unit]\nDescription=Skincos CRM runtime (dedicated immutable release)\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=skincos\nGroup=skincos\nWorkingDirectory=${releaseRoot}\nEnvironmentFile=-/etc/skincos/crm.env\nEnvironmentFile=-/etc/skincos/crm-whatsapp.env\nUnsetEnvironment=NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_V8_COVERAGE NODE_REDIRECT_WARNINGS LD_PRELOAD LD_LIBRARY_PATH BASH_ENV ENV\nEnvironment=CRM_NATIVE_RELEASE_ROOT=${releaseRoot}\nEnvironment=CRM_NATIVE_DEPLOYMENT_TARGET=production\nEnvironment=PONTO_LEGACY_RUNTIME_MODE=read-only\nEnvironment=CRM_NATIVE_UNSUPPORTED_JOBS=sales-chart-messenger\nEnvironment=CRM_NATIVE_MEDIA_TOOLS_MODE=${mediaRouteMode}\nEnvironment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nEnvironment=CRM_RUNTIME_HOME=/var/lib/skincos-runtime/crm\nEnvironment=SKINCOS_CRM_API_ENV_FILE=/etc/skincos/crm.env\nEnvironment=VAR_DIR=/var/lib/skincos-runtime/crm/var\nEnvironment=BACKEND_DIR=${releaseRoot}/backend\nEnvironment=FRONTEND_DIR=${releaseRoot}/crm/console\nEnvironment=CONFIG_DIR=${releaseRoot}/backend/config\nExecStart=${releaseRoot}/scripts/crm/run-api-linux.sh\nRestart=always\nRestartSec=5\nTimeoutStopSec=20\nKillMode=control-group\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths=/var/lib/skincos-runtime/crm /var/log/skincos/crm\nUMask=0027\n\n[Install]\nWantedBy=multi-user.target\n`;
}

function atomicWriteSystemFile(destination, value, mode = 0o644) {
  const directory = assertRootSystemDirectory(path.dirname(destination), "system unit directory");
  const output = exactChild(directory, path.basename(destination), "system file");
  const temporary = exactChild(directory, `.${path.basename(destination)}.crm-native.${process.pid}.${crypto.randomBytes(8).toString("hex")}`, "system file");
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, mode);
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fchownSync(descriptor, 0, 0);
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, output);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function atomicPointer(link, target) {
  const directory = assertRootSystemDirectory(path.dirname(link), "CRM pointer directory");
  const destination = exactChild(directory, path.basename(link), "CRM pointer");
  const temporary = exactChild(directory, `.${path.basename(link)}.next.${process.pid}.${crypto.randomBytes(8).toString("hex")}`, "CRM pointer");
  fs.symlinkSync(target, temporary);
  try { fs.renameSync(temporary, destination); }
  catch (error) { try { fs.unlinkSync(temporary); } catch {}; throw error; }
}

function restorePointer(link, record) {
  if (record?.exists) {
    atomicPointer(link, record.target);
    return;
  }
  try {
    const stat = fs.lstatSync(link);
    if (!stat.isSymbolicLink()) fail("CRM pointer cannot be safely removed");
    fs.unlinkSync(link);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function snapshotIncumbent(transactionDirectory, incumbent) {
  const unitBackup = exactChild(transactionDirectory, "crm.service.incumbent", "transaction backup");
  fs.copyFileSync(incumbent.state.unit.path, unitBackup, fs.constants.COPYFILE_EXCL);
  fs.chownSync(unitBackup, 0, 0);
  fs.chmodSync(unitBackup, 0o600);
  const dropIns = [];
  for (const [index, entry] of incumbent.state.dropIns.entries()) {
    const backup = exactChild(transactionDirectory, `dropin-${index}`, "transaction backup");
    fs.copyFileSync(entry.path, backup, fs.constants.COPYFILE_EXCL);
    fs.chownSync(backup, 0, 0);
    fs.chmodSync(backup, 0o600);
    dropIns.push({ ...entry, backup });
  }
  return { unitBackup, dropIns, dropInDirectory: incumbent.state.dropInDirectory };
}

function restoreDropIns(backup) {
  const expected = backup.dropIns || [];
  const directoryState = backup.dropInDirectory;
  if (!directoryState || directoryState.path !== "/etc/systemd/system/crm.service.d") fail("drop-in backup is invalid");
  const directory = directoryState.path;
  if (!directoryState.exists) {
    try {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(directory).length !== 0) {
        fail("unexpected crm.service drop-ins prevent rollback");
      }
      fs.rmdirSync(directory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return;
  }
  try {
    fs.mkdirSync(directory, { recursive: true, mode: directoryState.mode });
    fs.chownSync(directory, 0, 0);
    fs.chmodSync(directory, directoryState.mode);
  } catch { fail("crm.service drop-in directory cannot be restored"); }
  const trusted = assertRootSystemDirectory(directory, "crm.service drop-in directory");
  for (const name of fs.readdirSync(trusted)) {
    const file = exactChild(trusted, name, "crm.service drop-in");
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.nlink !== 1) fail("unsafe crm.service drop-in blocks rollback");
    fs.unlinkSync(file);
  }
  for (const entry of expected) {
    const destination = exactChild(trusted, path.basename(entry.path), "crm.service drop-in");
    if (path.dirname(entry.path) !== trusted) fail("drop-in backup path is invalid");
    fs.copyFileSync(entry.backup, destination, fs.constants.COPYFILE_EXCL);
    fs.chownSync(destination, 0, 0);
    fs.chmodSync(destination, entry.mode);
  }
}

function writeJournal(transactionDirectory, value) {
  writePrivateFile(exactChild(transactionDirectory, "journal.json", "transaction journal"), `${JSON.stringify(value)}\n`);
}

function readJournal(transactionDirectory) {
  return readPrivateJson(exactChild(transactionDirectory, "journal.json", "transaction journal"));
}

function verifyNativeProcess({ releaseRoot, mediaRouteMode }) {
  command("/usr/bin/systemctl", ["is-active", "--quiet", "crm.service"], { timeout: 20_000 });
  const state = readSystemctlProperties();
  const pid = Number(state.MainPID);
  const expectedCwd = path.join(releaseRoot, "crm", "api");
  if (fs.realpathSync.native(`/proc/${pid}/cwd`) !== expectedCwd) fail("crm.service process cwd differs from dedicated release");
  const raw = fs.readFileSync(`/proc/${pid}/environ`);
  const environment = new Map(raw.toString("utf8").split("\0").filter(Boolean).map((entry) => {
    const index = entry.indexOf("=");
    return [entry.slice(0, index), entry.slice(index + 1)];
  }));
  raw.fill(0);
  const port = String(environment.get("CRM_API_PORT") || environment.get("PORT") || "8099");
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535
    || environment.get("CRM_NATIVE_RELEASE_ROOT") !== releaseRoot
    || environment.get("PONTO_LEGACY_RUNTIME_MODE") !== "read-only"
    || environment.get("CRM_NATIVE_MEDIA_TOOLS_MODE") !== mediaRouteMode
    || environment.get("PATH") !== "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin") {
    fail("crm.service native environment differs from custody contract");
  }
  command("/usr/bin/curl", ["--fail", "--silent", "--show-error", "--max-time", "5", "--noproxy", "*", `http://127.0.0.1:${port}/health`], { timeout: 10_000, maxBuffer: 64 * 1024 });
  return { pid, port: Number(port) };
}

function parseCoordinationCustody() {
  const file = regularRootFile(CRM_NATIVE_GLOBAL_COORDINATION_FILE, "global coordination custody");
  const values = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const index = line.indexOf("=");
    if (index < 1 || values.has(line.slice(0, index))) fail("global coordination custody is invalid");
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  const url = values.get("SKINCOS_GLOBAL_COORDINATOR_URL");
  const keyId = values.get("SKINCOS_GLOBAL_COORDINATION_KEY_ID") || "";
  const secret = values.get("SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY") || values.get("SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET") || "";
  if (!/^https:\/\//.test(String(url)) || !secret || (keyId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(keyId))) {
    fail("global coordination custody is unavailable");
  }
  return { url, keyId, secret };
}

async function revalidateCoordination(document, claims) {
  const custody = parseCoordinationCustody();
  let result;
  try {
    result = await checkGlobalLease({
      proof: document.coordinationProof,
      url: custody.url,
      secret: custody.secret,
      keyId: custody.keyId,
      authorization: {
        expectedResource: claims.coordinationResource,
        expectedIntentDigest: claims.coordinationIntentDigest,
      },
    });
  } catch {
    fail("global coordination lease revalidation failed");
  }
  if (result?.passed !== true || result?.lease?.leaseId !== claims.coordinationLeaseId
    || result.lease?.fencingToken !== claims.coordinationFencingToken
    || result.lease?.intentDigest !== claims.coordinationIntentDigest) {
    fail("global coordination lease differs from authorization");
  }
}

function productionMetadata({ claims, policy, releaseRoot, predecessor, unitTemplateSha256 }) {
  return {
    schemaVersion: 1,
    kind: "skincos-crm-native-release",
    releaseSha: claims.sourceSha,
    sourceTree: claims.sourceTree,
    sourceArchiveSha256: claims.sourceArchiveSha256,
    sourceArchiveBytes: claims.sourceArchiveBytes,
    target: "production",
    custody: {
      schemaVersion: 1,
      issuer: "github-actions",
      repository: claims.repository,
      workflow: "prepare-release-candidate.yml",
      runId: claims.sourceArtifactRunId,
      artifactName: claims.artifactName,
      sourceSha: claims.sourceSha,
      sourceArchiveSha256: claims.sourceArchiveSha256,
      sourceArchiveBytes: claims.sourceArchiveBytes,
    },
    runtimeCustody: {
      schemaVersion: 1,
      dependencyArchiveSha256: claims.dependencyArchiveSha256,
      dependencyArchiveBytes: claims.dependencyArchiveBytes,
      policySha256: claims.policySha256,
      stagingProofSha256: claims.stagingProofSha256,
      runtimeAttestationSha256: claims.runtimeAttestationSha256,
      authorizationId: claims.authorizationId,
      unitTemplateSha256,
      coordinationProofSha256: claims.coordinationProofSha256,
      coordinationLeaseId: claims.coordinationLeaseId,
      coordinationFencingToken: claims.coordinationFencingToken,
      coordinationIntentDigest: claims.coordinationIntentDigest,
    },
    artifacts: {
      apiEntrypoint: "scripts/crm/run-api-linux.sh",
      apiPackageLock: "crm/api/package-lock.json",
      backendEnvironment: "backend/scripts/env.sh",
      capabilitiesCatalog: "backend/capabilities.json",
      consoleRoot: "crm/console",
      productionDependencies: "crm/api/node_modules",
      sharedAuthRoot: "shared/crm-auth",
    },
    predecessor,
  };
}

function installCandidate({ policy, claims, sourceArchive, dependencyArchive, transactionDirectory }) {
  assertRootSystemDirectory(policy.target.releaseBase, "CRM release base");
  const stageParent = ensurePrivateDirectory(path.join(policy.target.releaseBase, ".crm-native-staging"));
  const stage = exactChild(stageParent, `${claims.authorizationId}.${crypto.randomBytes(8).toString("hex")}`, "candidate stage");
  fs.mkdirSync(stage, { mode: 0o700 });
  fs.chownSync(stage, 0, 0);
  fs.chmodSync(stage, 0o700);
  extractCrmNativeSourceArchive({ archive: sourceArchive, sourceSha: claims.sourceSha, outputDirectory: stage });
  assertCandidateTree(stage, { maximumBytes: policy.maximumSourceExtractedBytes, maximumEntries: policy.maximumSourceEntries });
  if (fs.existsSync(path.join(stage, "crm", "api", "node_modules"))) fail("source archive unexpectedly contains node_modules");
  extractDependencyArchive({ archive: dependencyArchive, outputDirectory: stage, policy });
  setCandidateOwnership(stage);
  assertNoFileCapabilities(stage);
  const active = describePointer(policy.target.currentLink, policy.target.releaseBase);
  const predecessor = active.exists
    ? (() => {
      const release = validateCrmNativeRelease({ releaseRoot: active.target, releaseSha: active.releaseSha, target: "production" });
      return { releaseSha: release.releaseSha, sourceTree: release.sourceTree };
    })()
    : null;
  const releaseRoot = path.join(policy.target.releaseBase, claims.sourceSha, "crm-service");
  const unit = renderCrmNativeUnit({ releaseRoot, mediaRouteMode: policy.runtimeAttestation.mediaRouteMode });
  const metadata = productionMetadata({ claims, policy, releaseRoot, predecessor, unitTemplateSha256: sha256Hex(unit) });
  fs.writeFileSync(path.join(stage, ".skincos-crm-native-release.json"), `${JSON.stringify(metadata)}\n`, { mode: 0o644 });
  fs.chownSync(path.join(stage, ".skincos-crm-native-release.json"), 0, 0);
  fs.chmodSync(path.join(stage, ".skincos-crm-native-release.json"), 0o644);
  validateCrmNativeSuccessor({
    releaseRoot: stage,
    releaseSha: claims.sourceSha,
    target: "production",
    activeReleaseRoot: active.exists ? active.target : null,
    activeReleaseSha: active.exists ? active.releaseSha : null,
  });
  const releaseParent = path.join(policy.target.releaseBase, claims.sourceSha);
  if (fs.existsSync(releaseParent)) fail("immutable CRM release SHA already exists");
  fs.mkdirSync(releaseParent, { mode: 0o755 });
  fs.chownSync(releaseParent, 0, 0);
  fs.chmodSync(releaseParent, 0o755);
  fs.renameSync(stage, releaseRoot);
  validateCrmNativeRelease({ releaseRoot, releaseSha: claims.sourceSha, target: "production" });
  return { releaseRoot, active, unit, metadata };
}

function restoreTransaction(transactionDirectory) {
  const journal = readJournal(transactionDirectory);
  const target = journal.policy.target;
  const backup = journal.backup;
  if (!journal.incumbent?.state || !backup?.unitBackup) fail("transaction journal is invalid");
  const unit = fs.readFileSync(backup.unitBackup, "utf8");
  atomicWriteSystemFile(target.unitFile, unit, journal.incumbent.state.unit.mode);
  restoreDropIns(backup);
  restorePointer(target.currentLink, journal.incumbent.state.dedicatedPointers.current);
  restorePointer(target.previousLink, journal.incumbent.state.dedicatedPointers.previous);
  command("/usr/bin/systemctl", ["daemon-reload"], { timeout: 20_000 });
  command("/usr/bin/systemctl", ["restart", target.service], { timeout: 60_000 });
  command("/usr/bin/systemctl", ["is-active", "--quiet", target.service], { timeout: 20_000 });
  journal.status = "rolled-back";
  journal.rolledBackAt = new Date().toISOString();
  writeJournal(transactionDirectory, journal);
  return journal;
}

function policyForRuntime() {
  return validatePublisherPolicy(readPrivateJson(CRM_NATIVE_POLICY_FILE));
}

export function bootstrapPolicy(policy) {
  const trusted = validatePublisherPolicy(policy);
  ensurePrivateDirectory(CRM_NATIVE_POLICY_DIR);
  writePrivateFile(CRM_NATIVE_POLICY_FILE, `${JSON.stringify(trusted)}\n`);
  return { policySha256: publisherPolicySha256(trusted) };
}

export function preflight(policy = policyForRuntime()) {
  const incumbent = collectIncumbentState(policy);
  return {
    schemaVersion: 1,
    policySha256: publisherPolicySha256(policy),
    incumbentStateSha256: incumbent.sha256,
    incumbent: incumbent.state,
    observedAt: new Date().toISOString(),
  };
}

async function publish() {
  const policy = policyForRuntime();
  const document = readBoundedJsonLine();
  const claims = verifyPublisherAuthorization(document, { policy });
  const incumbent = collectIncumbentState(policy);
  if (incumbent.sha256 !== claims.incumbentStateSha256) fail("incumbent state changed after preflight");
  await revalidateCoordination(document, claims);
  const stateRoot = ensurePrivateDirectory(CRM_NATIVE_STATE_DIR);
  const authorizations = ensurePrivateDirectory(path.join(stateRoot, "authorizations"));
  const transactions = ensurePrivateDirectory(path.join(stateRoot, "transactions"));
  const incoming = ensurePrivateDirectory(path.join(stateRoot, "incoming"));
  consumeAuthorization(authorizations, claims);
  const sourceArchive = copyExactFromStdin({
    destination: exactChild(incoming, `${claims.authorizationId}.source.tar.gz`, "incoming archive"),
    bytes: claims.sourceArchiveBytes,
    expectedSha256: claims.sourceArchiveSha256,
    maximumBytes: policy.maximumArchiveBytes,
  });
  const dependencyArchive = copyExactFromStdin({
    destination: exactChild(incoming, `${claims.authorizationId}.dependencies.tar.gz`, "incoming archive"),
    bytes: claims.dependencyArchiveBytes,
    expectedSha256: claims.dependencyArchiveSha256,
    maximumBytes: policy.maximumDependencyArchiveBytes,
  });
  assertEndOfInput();
  const transactionDirectory = ensurePrivateDirectory(path.join(transactions, claims.authorizationId));
  const backup = snapshotIncumbent(transactionDirectory, incumbent);
  const journal = {
    schemaVersion: 1,
    status: "prepared",
    authorizationId: claims.authorizationId,
    policy: { target: policy.target, policySha256: claims.policySha256 },
    incumbent,
    backup,
    createdAt: new Date().toISOString(),
  };
  writeJournal(transactionDirectory, journal);
  try {
    const release = installCandidate({ policy, claims, sourceArchive, dependencyArchive, transactionDirectory });
    const temporaryUnit = exactChild(transactionDirectory, "crm.service.next", "transaction unit");
    fs.writeFileSync(temporaryUnit, release.unit, { mode: 0o600 });
    command("/usr/bin/systemd-analyze", ["verify", temporaryUnit], { timeout: 30_000 });
    const beforeCommit = collectIncumbentState(policy);
    if (beforeCommit.sha256 !== claims.incumbentStateSha256) fail("incumbent state changed before service transfer");
    await revalidateCoordination(document, claims);
    const finalIncumbent = collectIncumbentState(policy);
    if (finalIncumbent.sha256 !== claims.incumbentStateSha256) fail("incumbent state changed during coordination revalidation");
    if (release.active.exists) atomicPointer(policy.target.previousLink, release.active.target);
    else restorePointer(policy.target.previousLink, { exists: false });
    atomicPointer(policy.target.currentLink, release.releaseRoot);
    atomicWriteSystemFile(policy.target.unitFile, release.unit, 0o644);
    command("/usr/bin/systemctl", ["daemon-reload"], { timeout: 20_000 });
    command("/usr/bin/systemctl", ["restart", policy.target.service], { timeout: 60_000 });
    const running = verifyNativeProcess({ releaseRoot: release.releaseRoot, mediaRouteMode: policy.runtimeAttestation.mediaRouteMode });
    journal.status = "committed";
    journal.release = { releaseSha: claims.sourceSha, releaseRoot: release.releaseRoot, sourceArchiveSha256: claims.sourceArchiveSha256, dependencyArchiveSha256: claims.dependencyArchiveSha256, pid: running.pid };
    journal.committedAt = new Date().toISOString();
    writeJournal(transactionDirectory, journal);
    writePrivateFile(path.join(stateRoot, "last-successful.json"), `${JSON.stringify({ transactionDirectory, authorizationId: claims.authorizationId, committedAt: journal.committedAt })}\n`);
    return { schemaVersion: 1, status: "published", authorizationId: claims.authorizationId, releaseSha: claims.sourceSha, releaseRoot: release.releaseRoot, policySha256: claims.policySha256, pid: running.pid, committedAt: journal.committedAt };
  } catch (error) {
    let rolledBack = false;
    try { restoreTransaction(transactionDirectory); rolledBack = true; } catch {}
    if (error instanceof CrmNativePublisherCustodyError) throw new CrmNativePublisherCustodyError(`${error.message.replace(/^CRM native publisher custody: /, "")} (rollback=${rolledBack})`);
    fail(`publish failed (rollback=${rolledBack})`);
  } finally {
    try { fs.unlinkSync(sourceArchive); } catch {}
    try { fs.unlinkSync(dependencyArchive); } catch {}
  }
}

function rollbackLast() {
  const stateRoot = assertDirectory(CRM_NATIVE_STATE_DIR, { uid: 0, mode: 0o700 });
  const last = readPrivateJson(path.join(stateRoot, "last-successful.json"));
  if (!last || typeof last.transactionDirectory !== "string" || !UUID.test(String(last.authorizationId || ""))) fail("last successful transaction is invalid");
  const transactions = assertDirectory(path.join(stateRoot, "transactions"), { uid: 0, mode: 0o700 });
  const directory = assertDirectory(last.transactionDirectory, { uid: 0, mode: 0o700 });
  if (path.dirname(directory) !== transactions) fail("last successful transaction path is invalid");
  const journal = readJournal(directory);
  if (journal.status !== "committed") fail("last successful transaction is not rollback eligible");
  const restored = restoreTransaction(directory);
  return { schemaVersion: 1, status: "rolled-back", authorizationId: restored.authorizationId, rolledBackAt: restored.rolledBackAt };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(argv) {
  assertLinuxRoot();
  if (argv.length !== 1) fail("command is invalid");
  if (argv[0] === "bootstrap") {
    output({ status: "policy-installed", ...bootstrapPolicy(readBoundedJsonLine()) });
    return;
  }
  if (argv[0] === "preflight") {
    output(preflight());
    return;
  }
  if (argv[0] === "publish") {
    output(await publish());
    return;
  }
  if (argv[0] === "rollback-last") {
    output(rollbackLast());
    return;
  }
  fail("command is invalid");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`CRM_NATIVE_PUBLISHER_CUSTODY: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 78;
  }
}
