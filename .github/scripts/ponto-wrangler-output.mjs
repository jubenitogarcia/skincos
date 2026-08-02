import fs from "node:fs";

const [file, expectedType, expectedName] = process.argv.slice(2);
if (!file || !expectedType || !expectedName) {
  throw new Error("usage: ponto-wrangler-output.mjs <ndjson-file> <entry-type> <worker-or-project>");
}
const records = fs.readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const failed = records.find((record) => record.type === "command-failed");
if (failed) throw new Error(`Wrangler reported command-failed (${failed.code || "unknown"})`);
const record = records.filter((item) => item.type === expectedType).at(-1);
if (!record) throw new Error(`Wrangler output does not contain ${expectedType}`);
const actualName = String(record.worker_name || record.project_name || record.name || "");
if (actualName !== expectedName) throw new Error(`Wrangler output target differs: ${actualName || "missing"}`);
const expectedEnvironment = String(process.env.PONTO_EXPECTED_WRANGLER_ENV || "").trim();
const actualEnvironment = String(record.wrangler_environment || record.environment || "");
// Wrangler's version-deploy NDJSON record identifies the exact Worker and
// deployment, but does not currently repeat the --env value. Keep strict
// environment validation for records that expose it and for version-upload;
// the exact Worker name remains mandatory for version-deploy.
const missingEnvironmentAllowed = expectedType === "version-deploy" && !actualEnvironment;
if (expectedEnvironment && actualEnvironment !== expectedEnvironment && !missingEnvironmentAllowed) {
  throw new Error(`Wrangler output environment differs: ${actualEnvironment || "missing"}`);
}
const versionId = String(record.version_id || "");
const deploymentId = String(record.deployment_id || record.id || "");
const url = String(record.url || record.deployment_url || record.targets?.[0] || record.preview_url || "");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (expectedType === "version-upload" && !uuid.test(versionId)) throw new Error("Wrangler version-upload is missing a UUID version_id");
if (["version-deploy", "pages-deploy"].includes(expectedType) && !uuid.test(deploymentId)) throw new Error(`${expectedType} is missing a UUID deployment_id`);
if (expectedType === "pages-deploy" && !/^https:\/\//i.test(url)) throw new Error("Pages deploy is missing an HTTPS URL");
const expectedHost = String(process.env.PONTO_EXPECTED_URL_HOST || "").trim().toLowerCase();
if (expectedHost && new URL(url).hostname.toLowerCase() !== expectedHost) throw new Error("Wrangler output URL host differs");
const values = { name: actualName, version_id: versionId, deployment_id: deploymentId, url };
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
}
process.stdout.write(`${expectedType} output verified for ${actualName}.\n`);
