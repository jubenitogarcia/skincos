import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SECRET_NAMES = [
  "PONTO_ACTOR_HMAC_KEY",
  "PONTO_NETWORK_CONTEXT_KEY",
  "PONTO_RELEASE_PROBE_HMAC_KEY",
];

export function validatePontoPagesEnvironment(payload, target) {
  const envVars = payload?.result?.deployment_configs?.production?.env_vars;
  if (
    payload?.success !== true
    || !envVars
    || typeof envVars !== "object"
    || Array.isArray(envVars)
  ) {
    throw new Error("Cloudflare Pages project response did not contain structured production env_vars");
  }

  const required = [...REQUIRED_SECRET_NAMES];
  if (target !== "staging") required.push("PONTO_API_TARGET");

  for (const name of required) {
    const binding = envVars[name];
    if (!binding) throw new Error(`remote Pages value is absent: ${name}`);
    if (binding.type !== "secret_text") {
      throw new Error(`remote Pages value must be secret_text: ${name}`);
    }
  }

  return {
    requiredSecretNames: required,
    secretPresence: Object.fromEntries(required.map((name) => [name, true])),
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  const [inputFile, target] = process.argv.slice(2);
  if (!inputFile || !target) throw new Error("Pages project JSON file and target are required");
  const payload = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  process.stdout.write(`${JSON.stringify(validatePontoPagesEnvironment(payload, target))}\n`);
}
