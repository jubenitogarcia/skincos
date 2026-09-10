#!/usr/bin/env node
/**
 * Contract for the future native CRM-only publisher.
 *
 * This file intentionally knows nothing about systemd, credentials, or an
 * application route.  It validates immutable, local release material and the
 * narrow `crm-service` pointers that a separately-custodied host publisher
 * may change.  The contract deliberately has no production layout.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const RELEASE_NAME = "crm-service";
const RELEASE_METADATA = ".skincos-crm-native-release.json";
const REQUIRED_ARTIFACTS = Object.freeze({
  apiEntrypoint: "scripts/crm/run-api-linux.sh",
  apiPackageLock: "crm/api/package-lock.json",
  consoleRoot: "crm/console",
});

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
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label} must be a regular file.`);
  }
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

export function assertTargetLayout({ target, releaseBase, currentLink, previousLink }) {
  if (target !== "test" && target !== "staging") {
    fail("CRM native publisher accepts only test or staging targets.", 64);
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
  } else if (base !== "/opt/skincos/staging/releases"
    || current !== "/opt/skincos/staging/current/crm-service"
    || previous !== "/opt/skincos/staging/current/crm-service.previous") {
    fail("Staging CRM pointers must use the fixed isolated /opt/skincos/staging layout.");
  }
  return { target, releaseBase: base, currentLink: current, previousLink: previous };
}

function assertCustody(custody, releaseSha, sourceArchiveSha256) {
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
  ], "Release custody");
  if (value.schemaVersion !== 1
    || value.issuer !== "github-actions"
    || value.repository !== "jubenitogarcia/skincos"
    || value.workflow !== "prepare-release-candidate.yml"
    || !/^[1-9][0-9]*$/.test(String(value.runId))
    || value.artifactName !== `release-source-${releaseSha}`
    || assertReleaseSha(value.sourceSha, "Custody source SHA") !== releaseSha
    || assertDigest(value.sourceArchiveSha256, "Custody source archive digest") !== sourceArchiveSha256) {
    fail("Release custody does not bind the exact source artifact.");
  }
  return value;
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
  if (target !== "test" && target !== "staging") {
    fail("Release target must be test or staging.", 64);
  }
  assertNoSymbolicLinks(root);
  const metadata = readJson(path.join(root, RELEASE_METADATA), "CRM release identity");
  assertExactKeys(metadata, [
    "schemaVersion",
    "kind",
    "releaseSha",
    "sourceTree",
    "sourceArchiveSha256",
    "target",
    "custody",
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
  assertCustody(metadata.custody, expectedSha, sourceArchiveSha256);
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
  assertDirectory(path.join(root, REQUIRED_ARTIFACTS.consoleRoot), "CRM console root");
  return {
    releaseSha: expectedSha,
    sourceTree: metadata.sourceTree,
    sourceArchiveSha256,
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
