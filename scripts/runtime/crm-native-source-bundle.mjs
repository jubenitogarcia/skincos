#!/usr/bin/env node
/**
 * Extracts the deliberately small source closure required by crm.service from
 * a GitHub `release-source-<sha>` artifact.  The generic artifact is a
 * provenance container for the whole monorepo and may legitimately contain
 * symlinks belonging to unrelated products; this utility never materializes
 * those entries.
 */
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const SAFE_MEMBER = /^[A-Za-z0-9._-][A-Za-z0-9._@+=:-]*$/;

export const CRM_NATIVE_SOURCE_PATHS = Object.freeze([
  "crm/api",
  "crm/console",
  "scripts/crm/run-api-linux.sh",
  "backend/scripts/env.sh",
  "backend/capabilities.json",
  "shared/crm-auth",
]);

export class CrmNativeSourceBundleError extends Error {
  constructor(message) {
    super(`CRM native source bundle: ${message}`);
    this.name = "CrmNativeSourceBundleError";
  }
}

function fail(message) {
  throw new CrmNativeSourceBundleError(message);
}

function requiredSha(value) {
  if (typeof value !== "string" || !SHA.test(value)) fail("source SHA is invalid");
  return value;
}

function regularArchive(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) fail("source archive must be a non-empty regular file");
  return path.resolve(file);
}

function realEmptyDirectory(directory) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(resolved) !== resolved) {
    fail("output directory must be a real directory");
  }
  if (fs.readdirSync(resolved).length !== 0) fail("output directory must be empty");
  return resolved;
}

function command(command, args) {
  const result = childProcess.spawnSync(command, args, {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail("tar command failed");
  return result.stdout;
}

function safeMember(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    fail(`${label} is invalid`);
  }
  const withoutSlash = value.endsWith("/") ? value.slice(0, -1) : value;
  if (!withoutSlash || withoutSlash.startsWith("/") || withoutSlash.includes("//") || withoutSlash.split("/").some((part) => !part || part === "." || part === ".." || !SAFE_MEMBER.test(part))) {
    fail(`${label} is invalid`);
  }
  return withoutSlash;
}

export function selectedCrmNativeArchiveMembers({ archive, sourceSha }) {
  const trustedArchive = regularArchive(archive);
  const prefix = `skincos-${requiredSha(sourceSha)}/`;
  const raw = command("/usr/bin/tar", ["--list", "--gzip", "--file", trustedArchive]);
  const text = raw.toString("utf8");
  raw.fill(0);
  if (!text || text.includes("\r")) fail("source archive listing is invalid");
  const entries = text.split("\n").filter(Boolean);
  if (entries.length === 0 || entries.length > 500_000) fail("source archive listing is invalid");
  const selected = [];
  const found = new Set();
  for (const member of entries) {
    if (!member.startsWith(prefix)) continue;
    // GNU tar can spell an otherwise canonical archive root as `prefix/./`.
    // Accept only that single harmless spelling and normalize it before all
    // path checks; any other dot segment remains forbidden.
    const archiveMember = member.startsWith(`${prefix}./`)
      ? `${prefix}${member.slice(`${prefix}./`.length)}`
      : member;
    const normalized = safeMember(archiveMember, "source archive member");
    const relative = normalized.slice(prefix.length);
    if (!relative) continue;
    const expected = CRM_NATIVE_SOURCE_PATHS.find((item) => relative === item || relative.startsWith(`${item}/`));
    if (!expected) continue;
    // Preserve the archive spelling for tar's member lookup.  The normalized
    // form above is only for validation and closure matching.
    selected.push(member);
    found.add(expected);
  }
  for (const expected of CRM_NATIVE_SOURCE_PATHS) {
    if (!found.has(expected)) fail(`source archive is missing ${expected}`);
  }
  const exactMembers = [...new Set(selected)];
  const verbose = command("/usr/bin/tar", [
    "--list",
    "--verbose",
    "--gzip",
    "--file", trustedArchive,
    "--no-recursion",
    ...exactMembers,
  ]).toString("utf8");
  const verboseEntries = verbose.split("\n").filter(Boolean);
  if (verboseEntries.length !== exactMembers.length || verboseEntries.some((line) => !["-", "d"].includes(line[0]))) {
    fail("source archive contains a non-regular selected member");
  }
  return Object.freeze(exactMembers);
}

export function extractCrmNativeSourceArchive({ archive, sourceSha, outputDirectory }) {
  const trustedArchive = regularArchive(archive);
  const output = realEmptyDirectory(outputDirectory);
  const members = selectedCrmNativeArchiveMembers({ archive: trustedArchive, sourceSha });
  command("/usr/bin/tar", [
    "--extract",
    "--gzip",
    "--file", trustedArchive,
    "--directory", output,
    "--strip-components=1",
    "--no-same-owner",
    "--no-same-permissions",
    "--no-recursion",
    ...members,
  ]);
  return { outputDirectory: output, memberCount: members.length };
}

function parseArguments(argv) {
  const [commandName, ...rest] = argv;
  const args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(args, key.slice(2))) {
      fail("arguments are invalid");
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  if (commandName !== "extract" || Object.keys(args).sort().join(",") !== "output,source-archive,source-sha") {
    fail("usage: extract --source-archive <tar.gz> --source-sha <sha> --output <empty-directory>");
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = extractCrmNativeSourceArchive({
      archive: args["source-archive"],
      sourceSha: args["source-sha"],
      outputDirectory: args.output,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`CRM_NATIVE_SOURCE_BUNDLE: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 78;
  }
}
