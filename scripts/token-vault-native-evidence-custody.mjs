#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDetachedRelease } from "./token-vault-native-release-identity.mjs";
import { verifyPromotionEvidence } from "./token-vault-native-transaction.mjs";

const SHA = /^[0-9a-f]{40}$/;
const TRANSACTION = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const OPERATOR_ROOT = "/home/admin/.local/state/skincos/token-vault";
const STORE_ROOT = "/var/lib/skincos-runtime/token-vault/promotion-evidence";

function identity(args) {
  const [mode, ...rest] = args;
  if (mode !== "seal") throw new Error("usage: token-vault-native-evidence-custody.mjs seal --source-sha <sha> --target staging|production --transaction-id <id> --evidence-file <private file>");
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!["--source-sha", "--target", "--transaction-id", "--evidence-file"].includes(key) || !value || options[key]) {
      throw new Error("native evidence custody arguments are invalid");
    }
    options[key] = value;
  }
  if (!SHA.test(String(options["--source-sha"] || ""))
    || !["staging", "production"].includes(options["--target"])
    || !TRANSACTION.test(String(options["--transaction-id"] || ""))
    || !options["--evidence-file"]) throw new Error("native evidence custody identity is incomplete");
  return options;
}

function uid(name, option) {
  const result = spawnSync("id", [option, name], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C" },
    stdio: ["ignore", "pipe", "pipe"] });
  const value = Number(String(result.stdout || "").trim());
  if (result.status !== 0 || !Number.isSafeInteger(value) || value < 1) throw new Error("native evidence operator identity is unavailable");
  return value;
}

function ownedDirectory(directory, adminGid) {
  const parent = fs.lstatSync(path.dirname(directory));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022) !== 0) {
    throw new Error("native evidence store parent is unsafe");
  }
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { mode: 0o750 });
    fs.chownSync(directory, 0, adminGid);
    fs.chmodSync(directory, 0o750);
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("native evidence store directory is unsafe");
  const after = fs.statSync(directory);
  if (after.uid !== 0 || after.gid !== adminGid || (after.mode & 0o777) !== 0o750) {
    throw new Error("native evidence store must be root-owned and read-only to the operator");
  }
}

export function sealedEvidencePath(sourceSha, target, transactionId) {
  if (!SHA.test(sourceSha) || !["staging", "production"].includes(target) || !TRANSACTION.test(transactionId)) {
    throw new Error("native evidence store identity is invalid");
  }
  return path.join(STORE_ROOT, sourceSha, `${target}-${transactionId}.json`);
}

function seal() {
  if (process.platform !== "linux" || process.env.WSL_DISTRO_NAME !== "Ubuntu-24.04" || process.getuid() !== 0) {
    throw new Error("native evidence custody must run as root in Ubuntu-24.04");
  }
  const options = identity(process.argv.slice(2));
  const sourceSha = options["--source-sha"];
  const target = options["--target"];
  const transactionId = options["--transaction-id"];
  const root = path.resolve(import.meta.dirname, "..");
  const { identity: release } = verifyDetachedRelease({ root, sourceSha });
  const input = options["--evidence-file"];
  if (!path.isAbsolute(input) || !input.startsWith(`${OPERATOR_ROOT}/`)
    || fs.realpathSync(input) !== input) throw new Error("native promotion evidence is outside private operator custody");
  const adminUid = uid("admin", "-u");
  const adminGid = uid("admin", "-g");
  const inputFd = fs.openSync(input, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let content;
  try {
    const inputStat = fs.fstatSync(inputFd);
    if (!inputStat.isFile() || inputStat.uid !== adminUid || (inputStat.mode & 0o777) !== 0o600
      || inputStat.size > 1024 * 1024) throw new Error("native promotion evidence input metadata is unsafe");
    content = fs.readFileSync(inputFd);
    if (fs.fstatSync(inputFd).size !== inputStat.size) throw new Error("native promotion evidence changed during readback");
  } finally { fs.closeSync(inputFd); }
  const evidence = verifyPromotionEvidence(JSON.parse(content.toString("utf8")), {
    target, sourceSha, sourceTree: release.sourceTree,
    releaseInputDigest: release.releaseInputDigest,
    dependencyClosureDigest: release.dependencyClosureDigest,
    transactionId,
  });
  const journalFile = path.join(OPERATOR_ROOT, "transactions", transactionId, "journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  if (journal?.target !== target || journal?.sourceSha !== sourceSha
    || journal?.status !== "in_progress"
    || !journal.events?.some((event) => event.event === "lease_released")
    || !journal.events?.some((event) => event.event === "promotion_evidence_written"
      && event.evidenceDigest === evidence.evidenceDigest)) {
    throw new Error("native promotion evidence has no matching completed transaction journal");
  }
  ownedDirectory(path.dirname(STORE_ROOT), adminGid);
  ownedDirectory(STORE_ROOT, adminGid);
  const destination = sealedEvidencePath(sourceSha, target, transactionId);
  ownedDirectory(path.dirname(destination), adminGid);
  const temporary = `${destination}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    fs.fchownSync(fd, 0, adminGid);
    fs.fchmodSync(fd, 0o640);
  } finally { fs.closeSync(fd); }
  try { fs.linkSync(temporary, destination); } finally { fs.unlinkSync(temporary); }
  const directoryFd = fs.openSync(path.dirname(destination), "r");
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  process.stdout.write(`${destination}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { seal(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
