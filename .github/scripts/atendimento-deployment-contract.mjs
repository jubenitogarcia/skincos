import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ATENDIMENTO_CONTROL_FILE = "/etc/skincos/atendimento/module-control.json";

// These are identifiers resolved only by a future native executor allowlist.
// They are deliberately not shell command strings, and this script never
// invokes a command supplied by an environment variable.
export const ATENDIMENTO_COMMAND_IDS = Object.freeze({
  deploy: "atendimento-release-deploy-v1",
  rollback: "atendimento-release-rollback-v1",
  control: "atendimento-module-control-v1",
});

export const ATENDIMENTO_HEALTH_URLS = Object.freeze({
  staging: "https://crm-staging.skincos.com.br/api/atendimento/health",
  production: "https://crm.skincos.com.br/api/atendimento/health",
});

const TARGETS = new Set(["preview", "staging", "production"]);
const KINDS = new Set(["deploy", "availability"]);
const OPERATIONS = new Set(["deploy", "rollback"]);
const AVAILABILITY_STATES = new Set(["disabled", "maintenance", "active"]);
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function checkExact(report, errors, field, actual, expected, description) {
  const present = actual.length > 0;
  const matchesExpected = actual === expected;
  report[field] = { present, matchesExpected };
  if (!present) {
    errors.push(`${description} is required.`);
  } else if (!matchesExpected) {
    errors.push(`${description} must use the versioned, allowlisted contract identifier.`);
  }
}

export function validateAtendimentoDeploymentContract(environment = process.env) {
  const errors = [];
  const kind = string(environment.CONTRACT_KIND);
  const target = string(environment.CONTRACT_TARGET);
  const releaseSha = string(environment.RELEASE_SHA).toLowerCase();
  const operation = string(environment.ATENDIMENTO_OPERATION);
  const availabilityState = string(environment.ATENDIMENTO_AVAILABILITY_STATE);
  const report = {
    schemaVersion: 1,
    kind,
    target,
    releaseSha: SHA_PATTERN.test(releaseSha) ? releaseSha : null,
    mutation: {
      attempted: false,
      performed: false,
      remoteCommandExecuted: false,
      sharedCrmRestarted: false,
    },
    controls: {},
    result: "blocked",
    errors,
  };

  if (!KINDS.has(kind)) errors.push("CONTRACT_KIND must be deploy or availability.");
  if (!TARGETS.has(target)) errors.push("CONTRACT_TARGET must be preview, staging, or production.");
  if (!SHA_PATTERN.test(releaseSha)) errors.push("RELEASE_SHA must be a full 40-character lowercase hexadecimal commit SHA.");

  if (kind === "deploy" && !OPERATIONS.has(operation)) {
    errors.push("ATENDIMENTO_OPERATION must be deploy or rollback.");
  }
  if (kind === "availability" && !AVAILABILITY_STATES.has(availabilityState)) {
    errors.push("ATENDIMENTO_AVAILABILITY_STATE must be disabled, maintenance, or active.");
  }

  // Preview proves only the immutable source and its local validation. It must
  // not depend on, discover, or mutate a remote native runtime.
  if (target === "preview") {
    report.result = errors.length ? "blocked" : "validated-preview-only";
    return report;
  }

  const explicitlyEnabled = string(environment.ENABLE_ATENDIMENTO_DEPLOY) === "true";
  report.controls.releaseEnabled = { explicitlyEnabled };
  if (!explicitlyEnabled) {
    errors.push("ENABLE_ATENDIMENTO_DEPLOY must be explicitly true; no release or availability mutation was attempted.");
  }

  checkExact(
    report.controls,
    errors,
    "controlFile",
    string(environment.CRM_MODULE_CONTROL_FILE),
    ATENDIMENTO_CONTROL_FILE,
    "CRM_MODULE_CONTROL_FILE",
  );
  checkExact(
    report.controls,
    errors,
    "deployCommand",
    string(environment.CRM_ATENDIMENTO_DEPLOY_COMMAND),
    ATENDIMENTO_COMMAND_IDS.deploy,
    "CRM_ATENDIMENTO_DEPLOY_COMMAND",
  );
  checkExact(
    report.controls,
    errors,
    "rollbackCommand",
    string(environment.CRM_ATENDIMENTO_ROLLBACK_COMMAND),
    ATENDIMENTO_COMMAND_IDS.rollback,
    "CRM_ATENDIMENTO_ROLLBACK_COMMAND",
  );
  checkExact(
    report.controls,
    errors,
    "availabilityCommand",
    string(environment.CRM_ATENDIMENTO_CONTROL_COMMAND),
    ATENDIMENTO_COMMAND_IDS.control,
    "CRM_ATENDIMENTO_CONTROL_COMMAND",
  );
  checkExact(
    report.controls,
    errors,
    "healthUrl",
    string(environment.CRM_ATENDIMENTO_HEALTH_URL),
    ATENDIMENTO_HEALTH_URLS[target],
    "CRM_ATENDIMENTO_HEALTH_URL",
  );

  report.result = errors.length ? "blocked" : "configuration-attested-executor-unavailable";
  return report;
}

export function writeSanitizedContractReport(outputPath, report) {
  const destination = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || !string(argv[1])) {
    throw new Error("usage: atendimento-deployment-contract.mjs --output <sanitized-report.json>");
  }
  return { outputPath: argv[1] };
}

function run() {
  const { outputPath } = parseArguments(process.argv.slice(2));
  const report = validateAtendimentoDeploymentContract(process.env);
  writeSanitizedContractReport(outputPath, report);
  if (report.errors.length) {
    for (const error of report.errors) process.stderr.write(`atendimento deployment contract: ${error}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
