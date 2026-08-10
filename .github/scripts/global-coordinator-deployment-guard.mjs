#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argument(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function booleanArgument(args, name) {
  return String(argument(args, name, "false")).trim().toLowerCase() === "true";
}

export function validateDeploymentIntent({
  target,
  ref,
  sha,
  runAttempt,
  coordinatorUrl = "",
  expectedCoordinatorUrl = "",
  workerExists,
  allowBootstrap = false,
}) {
  const normalizedTarget = String(target || "").trim().toLowerCase();
  const normalizedRef = String(ref || "").trim();
  const normalizedSha = String(sha || "").trim().toLowerCase();
  const normalizedAttempt = String(runAttempt || "").trim();
  const normalizedUrl = String(coordinatorUrl || "").trim();
  const normalizedExpectedUrl = String(expectedCoordinatorUrl || "").trim();

  if (!["staging", "production"].includes(normalizedTarget)) {
    throw new Error("global coordinator deployment target is invalid");
  }
  if (normalizedRef !== "refs/heads/main") {
    throw new Error("global coordinator deployment must run from main");
  }
  if (!FULL_SHA.test(normalizedSha)) {
    throw new Error("global coordinator deployment source SHA is invalid");
  }
  if (normalizedAttempt !== "1") {
    throw new Error("global coordinator deployment cannot run from a workflow rerun");
  }
  if (typeof workerExists !== "boolean") {
    throw new Error("global coordinator deployment existence probe is ambiguous");
  }
  if (normalizedExpectedUrl && normalizedUrl && normalizedUrl !== normalizedExpectedUrl) {
    throw new Error("global coordinator deployment endpoint does not match the canonical target");
  }

  const bootstrap = normalizedTarget === "production" && !normalizedUrl;
  if (bootstrap) {
    if (!allowBootstrap) {
      throw new Error("production coordinator bootstrap requires explicit bootstrap intent");
    }
    if (workerExists) {
      throw new Error("production coordinator bootstrap is forbidden when a Worker already exists");
    }
  } else {
    if (!normalizedUrl) {
      throw new Error("non-bootstrap coordinator deployment requires an existing endpoint");
    }
    if (!workerExists) {
      throw new Error(`${normalizedTarget} coordinator deployment requires an existing Worker`);
    }
  }

  return {
    schemaVersion: 1,
    target: normalizedTarget,
    sourceSha: normalizedSha,
    coordinatorUrl: normalizedUrl,
    expectedCoordinatorUrl: normalizedExpectedUrl,
    bootstrap,
    remoteLeaseRequired: !bootstrap,
  };
}

function main(args) {
  const result = validateDeploymentIntent({
    target: argument(args, "--target"),
    ref: argument(args, "--ref"),
    sha: argument(args, "--sha"),
    runAttempt: argument(args, "--run-attempt"),
    coordinatorUrl: argument(args, "--coordinator-url"),
    expectedCoordinatorUrl: argument(args, "--expected-coordinator-url"),
    workerExists: booleanArgument(args, "--worker-exists"),
    allowBootstrap: booleanArgument(args, "--allow-bootstrap"),
  });
  const outputFile = argument(args, "--output-file");
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (outputFile) {
    const destination = path.resolve(outputFile);
    if (destination === ROOT || destination.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error("global coordinator deployment proof must live outside the repository");
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, rendered, { mode: 0o600 });
  }
  process.stdout.write(rendered);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
