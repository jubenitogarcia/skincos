#!/usr/bin/env node
/**
 * Contract for the future native CRM-only publisher.
 *
 * This file intentionally knows nothing about systemd, credentials, or an
 * application route.  It validates immutable, local release material and the
 * narrow `crm-service` pointers that a separately-custodied host publisher
 * may change.  Production is recognized only for the root-owned publisher;
 * the source-level prepare/rollback scripts remain unable to mutate it.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const RELEASE_NAME = "crm-service";
const RELEASE_METADATA = ".skincos-crm-native-release.json";
export const CRM_NATIVE_DEPENDENCY_MANIFEST = "crm/api/.skincos-crm-native-dependency-manifest.json";
const CRM_NATIVE_DEPENDENCY_ROOT = "crm/api/node_modules";
const CRM_NATIVE_DEPENDENCY_MANIFEST_KIND = "skincos-crm-native-dependency-manifest";
const MAX_DEPENDENCY_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_DEPENDENCY_MANIFEST_ENTRIES = 500_000;
const REQUIRED_ARTIFACTS = Object.freeze({
  apiEntrypoint: "scripts/crm/run-api-linux.sh",
  apiPackageLock: "crm/api/package-lock.json",
  backendEnvironment: "backend/scripts/env.sh",
  capabilitiesCatalog: "backend/capabilities.json",
  consoleRoot: "crm/console",
  productionDependencies: "crm/api/node_modules",
  sharedAuthRoot: "shared/crm-auth",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

export class ContractError extends Error {
  constructor(message, exitCode = 78) {
    super(message);
    this.name = "ContractError";
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 78) {
  throw new ContractError(message, exitCode);
}

function isOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(object, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(object).filter((key) => !allowed.has(key));
  const missing = allowedKeys.filter((key) => !isOwn(object, key));
  if (unexpected.length || missing.length) {
    fail(`${label} has an unexpected shape.`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

export function assertReleaseSha(value, label = "release SHA") {
  const normalized = assertString(value, label).toLowerCase();
  if (!SHA.test(normalized) || normalized !== value) {
    fail(`${label} must be a full lowercase SHA.`);
  }
  return normalized;
}

function assertDigest(value, label) {
  const normalized = assertString(value, label).toLowerCase();
  if (!DIGEST.test(normalized) || normalized !== value) {
    fail(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

export function nativeAbsolutePath(value, label) {
  const raw = assertString(value, label);
  if (!path.posix.isAbsolute(raw) || raw === "/" || raw === "/mnt" || raw.startsWith("/mnt/")) {
    fail(`${label} must be an absolute native Linux path.`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized !== raw || normalized.includes("/../") || normalized.endsWith("/..")) {
    fail(`${label} must be normalized.`);
  }
  return normalized;
}

function lstatRequired(file, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    fail(`${label} is unavailable.`);
  }
  return stat;
}

function assertRegularFile(file, label) {
  const stat = lstatRequired(file, label);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail(`${label} must be a regular file.`);
  }
  return stat;
}

function assertDirectory(file, label) {
  const stat = lstatRequired(file, label);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} must be a real directory.`);
  }
}

function assertNoSymbolicLinks(root) {
  assertDirectory(root, "Release root");
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`Release source must not contain symbolic links: ${entry.name}.`);
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (!entry.isFile()) {
        fail(`Release source must not contain special files: ${entry.name}.`);
      } else if (fs.lstatSync(entryPath).nlink !== 1) {
        fail(`Release source must not contain hard-linked files: ${entry.name}.`);
      }
    }
  }
}

function readJson(file, label) {
  assertRegularFile(file, label);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function compareText(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sha256File(file) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(128 * 1024);
  let size = 0;
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1) fail("dependency manifest input is not a regular file.");
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      size += read;
    }
    const after = fs.fstatSync(descriptor);
    if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size || after.nlink !== 1 || size !== before.size) {
      fail("dependency manifest input changed during read.");
    }
    return { sha256: hash.digest("hex"), size };
  } finally {
    buffer.fill(0);
    fs.closeSync(descriptor);
  }
}

function dependencyEntryPath(value) {
  const entry = assertString(value, "Dependency manifest entry path");
  if (entry.length > 4096 || entry.includes("\\") || entry.startsWith("/") || entry.includes("//")
    || entry.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("Dependency manifest entry path is invalid.");
  }
  return entry;
}

function normalizedDependencyMode(relativePath, type) {
  if (type === "directory") return "0755";
  return relativePath.endsWith(".sh") ? "0755" : "0644";
}

function safeDependencyName(value) {
  const name = assertString(value, "Dependency manifest direct dependency");
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    fail("Dependency manifest direct dependency is invalid.");
  }
  return name;
}

function assertNormalizedDependencyTree(root, { requireNormalizedModes }) {
  const dependencies = path.resolve(root);
  assertDirectory(dependencies, "CRM locked production dependencies");
  const stack = [{ directory: dependencies, relative: "" }];
  const entries = [];
  let fileCount = 0;
  let byteCount = 0;
  while (stack.length) {
    const current = stack.pop();
    const children = fs.readdirSync(current.directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const entry of children) {
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const file = path.join(current.directory, entry.name);
      const stat = fs.lstatSync(file);
      if (entry.isSymbolicLink() || stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        fail("Dependency manifest tree contains a link or special file.");
      }
      if (stat.isDirectory()) {
        const mode = normalizedDependencyMode(relative, "directory");
        if (requireNormalizedModes && (stat.mode & 0o777) !== Number.parseInt(mode, 8)) {
          fail("Dependency manifest directory mode differs.");
        }
        entries.push({ path: relative, type: "directory", mode });
        stack.push({ directory: file, relative });
        continue;
      }
      if (stat.nlink !== 1 || stat.size < 0) fail("Dependency manifest tree contains a hard-linked file.");
      const mode = normalizedDependencyMode(relative, "file");
      if (requireNormalizedModes && (stat.mode & 0o777) !== Number.parseInt(mode, 8)) {
        fail("Dependency manifest file mode differs.");
      }
      const hashed = sha256File(file);
      if (hashed.size !== stat.size) fail("Dependency manifest file changed during read.");
      entries.push({ path: relative, type: "file", mode, size: hashed.size, sha256: hashed.sha256 });
      fileCount += 1;
      byteCount += hashed.size;
      if (entries.length > MAX_DEPENDENCY_MANIFEST_ENTRIES || byteCount > MAX_ARCHIVE_BYTES) {
        fail("Dependency manifest tree exceeds its bounded contract.");
      }
    }
  }
  entries.sort((left, right) => compareText(left.path, right.path));
  return { entries, fileCount, byteCount };
}

export function canonicalCrmNativeDependencyManifest(value) {
  return canonicalJson(value);
}

export function buildCrmNativeDependencyManifest({ apiRoot, requireNormalizedModes = false } = {}) {
  const api = path.resolve(assertString(apiRoot, "CRM API root"));
  assertDirectory(api, "CRM API root");
  const packageJson = path.join(api, "package.json");
  const packageLock = path.join(api, "package-lock.json");
  const packageJsonHash = sha256File(packageJson);
  const packageLockHash = sha256File(packageLock);
  let packageManifest;
  try {
    packageManifest = JSON.parse(fs.readFileSync(packageJson, "utf8"));
  } catch {
    fail("CRM API package manifest is invalid.");
  }
  if (!packageManifest || typeof packageManifest !== "object" || Array.isArray(packageManifest)
    || (packageManifest.dependencies !== undefined && (!packageManifest.dependencies || typeof packageManifest.dependencies !== "object" || Array.isArray(packageManifest.dependencies)))) {
    fail("CRM API package manifest dependencies are invalid.");
  }
  const directDependencies = Object.keys(packageManifest.dependencies || {}).map(safeDependencyName).sort(compareText);
  if (new Set(directDependencies).size !== directDependencies.length) fail("CRM API package manifest dependencies are duplicated.");
  const dependencyRoot = path.join(api, "node_modules");
  for (const dependency of directDependencies) {
    assertDirectory(path.join(dependencyRoot, dependency), "CRM API direct production dependency");
  }
  const tree = assertNormalizedDependencyTree(dependencyRoot, { requireNormalizedModes });
  return {
    schemaVersion: 1,
    kind: CRM_NATIVE_DEPENDENCY_MANIFEST_KIND,
    apiPackageJsonSha256: packageJsonHash.sha256,
    apiPackageLockSha256: packageLockHash.sha256,
    directDependencies,
    entryCount: tree.entries.length,
    fileCount: tree.fileCount,
    byteCount: tree.byteCount,
    entries: tree.entries,
  };
}

function assertDependencyManifestShape(value) {
  const manifest = assertObject(value, "CRM dependency manifest");
  assertExactKeys(manifest, [
    "schemaVersion",
    "kind",
    "apiPackageJsonSha256",
    "apiPackageLockSha256",
    "directDependencies",
    "entryCount",
    "fileCount",
    "byteCount",
    "entries",
  ], "CRM dependency manifest");
  if (manifest.schemaVersion !== 1 || manifest.kind !== CRM_NATIVE_DEPENDENCY_MANIFEST_KIND) {
    fail("CRM dependency manifest schema is unsupported.");
  }
  assertDigest(manifest.apiPackageJsonSha256, "CRM dependency manifest package digest");
  assertDigest(manifest.apiPackageLockSha256, "CRM dependency manifest lock digest");
  if (!Array.isArray(manifest.directDependencies) || manifest.directDependencies.length > 10_000
    || JSON.stringify(manifest.directDependencies) !== JSON.stringify([...manifest.directDependencies].map(safeDependencyName).sort(compareText))) {
    fail("CRM dependency manifest direct dependencies are invalid.");
  }
  for (const field of ["entryCount", "fileCount", "byteCount"]) {
    if (!Number.isSafeInteger(manifest[field]) || manifest[field] < 0 || (field === "entryCount" && manifest[field] > MAX_DEPENDENCY_MANIFEST_ENTRIES)
      || (field === "byteCount" && manifest[field] > MAX_ARCHIVE_BYTES)) {
      fail("CRM dependency manifest counts are invalid.");
    }
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== manifest.entryCount || manifest.entries.length > MAX_DEPENDENCY_MANIFEST_ENTRIES) {
    fail("CRM dependency manifest entries are invalid.");
  }
  let previous = null;
  let files = 0;
  let bytes = 0;
  for (const entry of manifest.entries) {
    const record = assertObject(entry, "CRM dependency manifest entry");
    const type = assertString(record.type, "CRM dependency manifest entry type");
    if (type === "directory") assertExactKeys(record, ["path", "type", "mode"], "CRM dependency manifest directory");
    else if (type === "file") assertExactKeys(record, ["path", "type", "mode", "size", "sha256"], "CRM dependency manifest file");
    else fail("CRM dependency manifest entry type is invalid.");
    const entryPath = dependencyEntryPath(record.path);
    if (previous !== null && compareText(previous, entryPath) >= 0) fail("CRM dependency manifest entries are not strictly ordered.");
    previous = entryPath;
    if (record.mode !== normalizedDependencyMode(entryPath, type)) fail("CRM dependency manifest entry mode is invalid.");
    if (type === "file") {
      if (!Number.isSafeInteger(record.size) || record.size < 0 || record.size > MAX_ARCHIVE_BYTES) fail("CRM dependency manifest file size is invalid.");
      assertDigest(record.sha256, "CRM dependency manifest file digest");
      files += 1;
      bytes += record.size;
    }
  }
  if (files !== manifest.fileCount || bytes !== manifest.byteCount) fail("CRM dependency manifest counts differ.");
  return manifest;
}

export function validateCrmNativeDependencyManifest({
  releaseRoot,
  expectedSha256 = null,
  expectedBytes = null,
  requireNormalizedModes = true,
} = {}) {
  const root = path.resolve(assertString(releaseRoot, "CRM release root"));
  const file = path.join(root, CRM_NATIVE_DEPENDENCY_MANIFEST);
  const stat = assertRegularFile(file, "CRM dependency manifest");
  if (stat.size < 2 || stat.size > MAX_DEPENDENCY_MANIFEST_BYTES) fail("CRM dependency manifest size is invalid.");
  const raw = fs.readFileSync(file);
  try {
    const digest = crypto.createHash("sha256").update(raw).digest("hex");
    if (expectedSha256 !== null && digest !== assertDigest(expectedSha256, "Expected dependency manifest digest")) {
      fail("CRM dependency manifest digest differs.");
    }
    if (expectedBytes !== null && (stat.size !== expectedBytes || expectedBytes < 2 || expectedBytes > MAX_DEPENDENCY_MANIFEST_BYTES)) {
      fail("CRM dependency manifest size differs.");
    }
    let manifest;
    try { manifest = JSON.parse(raw.toString("utf8")); }
    catch { fail("CRM dependency manifest is not valid JSON."); }
    const trusted = assertDependencyManifestShape(manifest);
    if (!raw.equals(Buffer.from(`${canonicalCrmNativeDependencyManifest(trusted)}\n`, "utf8"))) {
      fail("CRM dependency manifest is not canonical.");
    }
    const actual = buildCrmNativeDependencyManifest({
      apiRoot: path.join(root, "crm", "api"),
      requireNormalizedModes,
    });
    if (canonicalCrmNativeDependencyManifest(actual) !== canonicalCrmNativeDependencyManifest(trusted)) {
      fail("CRM dependency manifest differs from the materialized dependency tree.");
    }
    return { sha256: digest, bytes: stat.size, manifest: trusted };
  } finally {
    raw.fill(0);
  }
}

export function assertTargetLayout({ target, releaseBase, currentLink, previousLink }) {
  if (target !== "test" && target !== "staging" && target !== "production") {
    fail("CRM native publisher accepts only test, staging, or production targets.", 64);
  }
  const base = nativeAbsolutePath(releaseBase, "Release base");
  const current = nativeAbsolutePath(currentLink, "Current CRM pointer");
  const previous = nativeAbsolutePath(previousLink, "Previous CRM pointer");
  if (target === "test") {
    const match = base.match(/^\/tmp\/skincos-crm-native-test-([A-Za-z0-9._-]+)\/releases$/);
    if (!match) {
      fail("Test release base must stay below /tmp/skincos-crm-native-test-<id>/releases.");
    }
    const root = `/tmp/skincos-crm-native-test-${match[1]}`;
    if (current !== `${root}/current/${RELEASE_NAME}`
      || previous !== `${root}/current/${RELEASE_NAME}.previous`) {
      fail("Test CRM pointers must stay in the matching isolated test root.");
    }
  } else if (target === "staging" && (base !== "/opt/skincos/staging/releases"
    || current !== "/opt/skincos/staging/current/crm-service"
    || previous !== "/opt/skincos/staging/current/crm-service.previous")) {
    fail("Staging CRM pointers must use the fixed isolated /opt/skincos/staging layout.");
  } else if (target === "production" && (base !== "/opt/skincos/releases"
    || current !== "/opt/skincos/current/crm-service"
    || previous !== "/opt/skincos/current/crm-service.previous")) {
    fail("Production CRM pointers must use the fixed isolated /opt/skincos layout.");
  }
  return { target, releaseBase: base, currentLink: current, previousLink: previous };
}

function assertCustody(custody, releaseSha, sourceArchiveSha256, sourceArchiveBytes) {
  const value = assertObject(custody, "Release custody");
  assertExactKeys(value, [
    "schemaVersion",
    "issuer",
    "repository",
    "workflow",
    "runId",
    "artifactName",
    "sourceSha",
    "sourceArchiveSha256",
    "sourceArchiveBytes",
  ], "Release custody");
  if (value.schemaVersion !== 1
    || value.issuer !== "github-actions"
    || value.repository !== "jubenitogarcia/skincos"
    || value.workflow !== "prepare-release-candidate.yml"
    || !/^[1-9][0-9]*$/.test(String(value.runId))
    || value.artifactName !== `release-source-${releaseSha}`
    || assertReleaseSha(value.sourceSha, "Custody source SHA") !== releaseSha
    || assertDigest(value.sourceArchiveSha256, "Custody source archive digest") !== sourceArchiveSha256
    || value.sourceArchiveBytes !== sourceArchiveBytes) {
    fail("Release custody does not bind the exact source artifact.");
  }
  return value;
}

function assertArchiveBytes(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ARCHIVE_BYTES) {
    fail(`${label} must be a bounded positive size.`);
  }
  return value;
}

function assertRuntimeCustody(value) {
  const custody = assertObject(value, "Native runtime custody");
  const commonFields = [
    "schemaVersion",
    "dependencyArchiveSha256",
    "dependencyArchiveBytes",
    "policySha256",
    "stagingProofSha256",
    "runtimeAttestationSha256",
    "authorizationId",
    "unitTemplateSha256",
    "coordinationProofSha256",
    "coordinationLeaseId",
    "coordinationFencingToken",
    "coordinationIntentDigest",
  ];
  if (custody.schemaVersion === 1) {
    // Releases already committed by the first custody protocol remain valid
    // rollback targets. New publishers always emit V2 below.
    assertExactKeys(custody, commonFields, "Native runtime custody");
  } else if (custody.schemaVersion === 2) {
    assertExactKeys(custody, [
      ...commonFields,
      "dependencyManifestSha256",
      "dependencyManifestBytes",
    ], "Native runtime custody");
    assertDigest(custody.dependencyManifestSha256, "Dependency manifest digest");
    if (!Number.isSafeInteger(custody.dependencyManifestBytes)
      || custody.dependencyManifestBytes < 2
      || custody.dependencyManifestBytes > MAX_DEPENDENCY_MANIFEST_BYTES) {
      fail("Dependency manifest size is invalid.");
    }
  } else fail("Native runtime custody schema is unsupported.");
  assertDigest(custody.dependencyArchiveSha256, "Dependency archive digest");
  assertArchiveBytes(custody.dependencyArchiveBytes, "Dependency archive size");
  assertDigest(custody.policySha256, "Native publisher policy digest");
  assertDigest(custody.stagingProofSha256, "Native publisher staging proof digest");
  assertDigest(custody.runtimeAttestationSha256, "Native publisher runtime attestation digest");
  if (typeof custody.authorizationId !== "string" || !UUID.test(custody.authorizationId)) {
    fail("Native publisher authorization id is invalid.");
  }
  assertDigest(custody.unitTemplateSha256, "Native publisher unit template digest");
  assertDigest(custody.coordinationProofSha256, "Native publisher coordination proof digest");
  if (typeof custody.coordinationLeaseId !== "string" || !UUID.test(custody.coordinationLeaseId)) {
    fail("Native publisher coordination lease id is invalid.");
  }
  if (!Number.isSafeInteger(custody.coordinationFencingToken) || custody.coordinationFencingToken < 1) {
    fail("Native publisher coordination fencing token is invalid.");
  }
  assertDigest(custody.coordinationIntentDigest, "Native publisher coordination intent digest");
  return custody;
}

function assertArtifacts(artifacts) {
  const value = assertObject(artifacts, "Release artifacts");
  assertExactKeys(value, Object.keys(REQUIRED_ARTIFACTS), "Release artifacts");
  for (const [key, expected] of Object.entries(REQUIRED_ARTIFACTS)) {
    if (value[key] !== expected) {
      fail(`Release artifact ${key} does not match the CRM-native contract.`);
    }
  }
  return value;
}

export function validateCrmNativeRelease({ releaseRoot, releaseSha, target }) {
  const root = nativeAbsolutePath(releaseRoot, "Release root");
  const expectedSha = assertReleaseSha(releaseSha);
  if (target !== "test" && target !== "staging" && target !== "production") {
    fail("Release target must be test, staging, or production.", 64);
  }
  assertNoSymbolicLinks(root);
  const metadata = readJson(path.join(root, RELEASE_METADATA), "CRM release identity");
  assertExactKeys(metadata, [
    "schemaVersion",
    "kind",
    "releaseSha",
    "sourceTree",
    "sourceArchiveSha256",
    "sourceArchiveBytes",
    "target",
    "custody",
    "runtimeCustody",
    "artifacts",
    "predecessor",
  ], "CRM release identity");
  if (metadata.schemaVersion !== 1 || metadata.kind !== "skincos-crm-native-release") {
    fail("CRM release identity schema is unsupported.");
  }
  if (assertReleaseSha(metadata.releaseSha, "Identity release SHA") !== expectedSha
    || !SHA.test(assertString(metadata.sourceTree, "Identity source tree"))
    || metadata.target !== target) {
    fail("CRM release identity does not match the requested source or target.");
  }
  const sourceArchiveSha256 = assertDigest(metadata.sourceArchiveSha256, "Identity source archive digest");
  const sourceArchiveBytes = assertArchiveBytes(metadata.sourceArchiveBytes, "Identity source archive size");
  assertCustody(metadata.custody, expectedSha, sourceArchiveSha256, sourceArchiveBytes);
  const runtimeCustody = assertRuntimeCustody(metadata.runtimeCustody);
  assertArtifacts(metadata.artifacts);
  let predecessor = null;
  if (metadata.predecessor !== null) {
    const predecessorMetadata = assertObject(metadata.predecessor, "Release predecessor");
    assertExactKeys(predecessorMetadata, ["releaseSha", "sourceTree"], "Release predecessor");
    const predecessorSha = assertReleaseSha(predecessorMetadata.releaseSha, "Predecessor SHA");
    const predecessorSourceTree = assertString(predecessorMetadata.sourceTree, "Predecessor source tree");
    if (predecessorSha === expectedSha || !SHA.test(predecessorSourceTree)) {
      fail("Release predecessor is invalid.");
    }
    predecessor = { releaseSha: predecessorSha, sourceTree: predecessorSourceTree };
  }
  assertRegularFile(path.join(root, REQUIRED_ARTIFACTS.apiEntrypoint), "CRM API entrypoint");
  assertRegularFile(path.join(root, REQUIRED_ARTIFACTS.apiPackageLock), "CRM API lockfile");
  assertRegularFile(path.join(root, REQUIRED_ARTIFACTS.backendEnvironment), "CRM backend environment helper");
  assertRegularFile(path.join(root, REQUIRED_ARTIFACTS.capabilitiesCatalog), "CRM capabilities catalog");
  assertDirectory(path.join(root, REQUIRED_ARTIFACTS.consoleRoot), "CRM console root");
  assertDirectory(path.join(root, REQUIRED_ARTIFACTS.productionDependencies), "CRM locked production dependencies");
  assertDirectory(path.join(root, REQUIRED_ARTIFACTS.sharedAuthRoot), "CRM shared authorization source");
  if (runtimeCustody.schemaVersion === 2) {
    validateCrmNativeDependencyManifest({
      releaseRoot: root,
      expectedSha256: runtimeCustody.dependencyManifestSha256,
      expectedBytes: runtimeCustody.dependencyManifestBytes,
      requireNormalizedModes: true,
    });
  }
  return {
    releaseSha: expectedSha,
    sourceTree: metadata.sourceTree,
    sourceArchiveSha256,
    sourceArchiveBytes,
    target,
    releaseRoot: root,
    predecessor,
  };
}

export function validateCrmNativeSuccessor({
  releaseRoot,
  releaseSha,
  target,
  activeReleaseRoot = null,
  activeReleaseSha = null,
}) {
  const candidate = validateCrmNativeRelease({ releaseRoot, releaseSha, target });
  if ((activeReleaseRoot === null) !== (activeReleaseSha === null)) {
    fail("Active CRM release root and SHA must be supplied together.", 64);
  }
  if (activeReleaseRoot === null) {
    if (candidate.predecessor !== null) {
      fail("Initial CRM release must not claim an unavailable predecessor.");
    }
    return candidate;
  }
  const active = validateCrmNativeRelease({
    releaseRoot: activeReleaseRoot,
    releaseSha: activeReleaseSha,
    target,
  });
  if (candidate.predecessor === null
    || candidate.predecessor.releaseSha !== active.releaseSha
    || candidate.predecessor.sourceTree !== active.sourceTree) {
    fail("CRM release predecessor does not bind the active immutable release.");
  }
  return candidate;
}

function parsePointerTarget(releaseBase, targetPath) {
  const relative = path.posix.relative(releaseBase, targetPath);
  const parts = relative.split("/");
  if (parts.length !== 2 || parts[1] !== RELEASE_NAME || !SHA.test(parts[0])) {
    fail("CRM pointer does not resolve to an immutable CRM-only release.");
  }
  const expected = path.posix.join(releaseBase, parts[0], RELEASE_NAME);
  if (expected !== targetPath) {
    fail("CRM pointer target is not canonical.");
  }
  return { releaseSha: parts[0], targetPath };
}

export function validateCrmNativePointer({ releaseBase, link, expectedSha = null }) {
  const base = nativeAbsolutePath(releaseBase, "Release base");
  const pointer = nativeAbsolutePath(link, "CRM pointer");
  const pointerStat = lstatRequired(pointer, "CRM pointer");
  if (!pointerStat.isSymbolicLink()) {
    fail("CRM pointer must be a symbolic link.");
  }
  let resolved;
  try {
    resolved = fs.realpathSync.native(pointer);
  } catch {
    fail("CRM pointer must resolve to an existing release.");
  }
  const target = parsePointerTarget(base, resolved);
  assertDirectory(target.targetPath, "CRM pointer target");
  if (expectedSha !== null && target.releaseSha !== assertReleaseSha(expectedSha, "Expected pointer SHA")) {
    fail("CRM pointer does not resolve to the requested release.");
  }
  return target;
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || token === "--") {
      fail(`Unknown argument: ${token}`, 64);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || isOwn(parsed, key)) {
      fail(`Argument --${key} requires one value.`, 64);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requireOnly(args, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(args).some((key) => !allowed.has(key)) || required.some((key) => !isOwn(args, key))) {
    fail("Arguments do not match the selected CRM-native contract command.", 64);
  }
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function runCli(argv) {
  const [command, ...rest] = argv;
  const args = parseArguments(rest);
  if (command === "validate-layout") {
    requireOnly(args, ["target", "release-base", "current-link", "previous-link"]);
    output(assertTargetLayout({
      target: args.target,
      releaseBase: args["release-base"],
      currentLink: args["current-link"],
      previousLink: args["previous-link"],
    }));
    return;
  }
  if (command === "validate-release") {
    requireOnly(args, ["release-root", "release-sha", "target"]);
    output(validateCrmNativeRelease({
      releaseRoot: args["release-root"],
      releaseSha: args["release-sha"],
      target: args.target,
    }));
    return;
  }
  if (command === "validate-successor") {
    requireOnly(args, ["release-root", "release-sha", "target"], ["active-release-root", "active-release-sha"]);
    output(validateCrmNativeSuccessor({
      releaseRoot: args["release-root"],
      releaseSha: args["release-sha"],
      target: args.target,
      activeReleaseRoot: args["active-release-root"] ?? null,
      activeReleaseSha: args["active-release-sha"] ?? null,
    }));
    return;
  }
  if (command === "validate-pointer") {
    requireOnly(args, ["release-base", "link"], ["expected-sha"]);
    output(validateCrmNativePointer({
      releaseBase: args["release-base"],
      link: args.link,
      expectedSha: args["expected-sha"] ?? null,
    }));
    return;
  }
  if (command === "pointer-release-sha") {
    requireOnly(args, ["release-base", "link"]);
    process.stdout.write(`${validateCrmNativePointer({
      releaseBase: args["release-base"],
      link: args.link,
    }).releaseSha}\n`);
    return;
  }
  fail(`Unknown CRM-native contract command: ${command || "<empty>"}.`, 64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CRM_NATIVE_CONTRACT: ${message}\n`);
    process.exitCode = error instanceof ContractError ? error.exitCode : 1;
  }
}
