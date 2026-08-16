import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const websiteRoot = path.join(repositoryRoot, "website");
const configPath = path.join(websiteRoot, "next.config.mjs");
const configSource = readFileSync(configPath, "utf8");
// Keep the test independent from an installed website dependency tree. The
// production config is evaluated unchanged apart from OpenNext setup and the
// CSP import, neither of which affects the local-preview contract.
const testableConfigSource = configSource
  .replace(
    'import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";',
    "const initOpenNextCloudflareForDev = () => {};",
  )
  .replace(
    'import { contentSecurityPolicy } from "./contentSecurityPolicy.mjs";',
    'const contentSecurityPolicy = "default-src \'self\'";',
  )
  .replace(
    "const appRoot = path.dirname(fileURLToPath(import.meta.url));",
    'const appRoot = "/skincos/website";',
  );
const configModuleUrl = `data:text/javascript;base64,${Buffer.from(testableConfigSource).toString("base64")}`;

function loadConfig(environment = {}) {
  const env = { ...process.env };
  for (const name of [
    "SKINCOS_LOCAL_PREVIEW",
    "SKINCOS_LOCAL_PREVIEW_DIST_DIR",
    "SKINCOS_LOCAL_PREVIEW_FINGERPRINT",
    "SKINCOS_LOCAL_PREVIEW_INSTANCE",
  ]) {
    delete env[name];
  }
  Object.assign(env, environment);

  const program = `
    const { default: config } = await import(${JSON.stringify(configModuleUrl)});
    const rules = await config.headers();
    const headers = rules.flatMap((rule) => rule.headers);
    console.log("__SKINCOS_LOCAL_PREVIEW_CONTRACT__" + JSON.stringify({ distDir: config.distDir ?? null, headers }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: websiteRoot,
    encoding: "utf8",
    env,
  });

  const marker = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("__SKINCOS_LOCAL_PREVIEW_CONTRACT__"));
  return { result, contract: marker ? JSON.parse(marker.slice("__SKINCOS_LOCAL_PREVIEW_CONTRACT__".length)) : null };
}

function headerValue(contract, name) {
  return contract.headers.find((header) => header.key === name)?.value;
}

test("normal Next configuration keeps the standard output directory and has no local-preview attestation", () => {
  const { result, contract } = loadConfig();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(contract.distDir, null);
  assert.equal(headerValue(contract, "X-Skincos-Preview-Fingerprint"), undefined);
  assert.equal(headerValue(contract, "X-Skincos-Preview-Instance"), undefined);
});

test("local preview configuration isolates output and sends the exact attested identity", () => {
  const { result, contract } = loadConfig({
    SKINCOS_LOCAL_PREVIEW: "true",
    SKINCOS_LOCAL_PREVIEW_DIST_DIR: ".next-codex-preview/preview-identity-v2",
    SKINCOS_LOCAL_PREVIEW_FINGERPRINT: "v2:ab12cd34",
    SKINCOS_LOCAL_PREVIEW_INSTANCE: "instance-20260816-001",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(contract.distDir, ".next-codex-preview/preview-identity-v2");
  assert.equal(headerValue(contract, "X-Skincos-Preview-Fingerprint"), "v2:ab12cd34");
  assert.equal(headerValue(contract, "X-Skincos-Preview-Instance"), "instance-20260816-001");
});

test("local preview refuses unsafe identity inputs instead of falling back to .next", () => {
  const { result } = loadConfig({
    SKINCOS_LOCAL_PREVIEW: "true",
    SKINCOS_LOCAL_PREVIEW_DIST_DIR: ".next-codex-preview/../shared",
    SKINCOS_LOCAL_PREVIEW_FINGERPRINT: "v2:ab12cd34",
    SKINCOS_LOCAL_PREVIEW_INSTANCE: "instance-20260816-001",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SKINCOS_LOCAL_PREVIEW_DIST_DIR must be \.next-codex-preview/);
});

test("the isolated local-preview build output is ignored", () => {
  const gitignore = readFileSync(path.join(websiteRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.next-codex-preview\/$/m);
});
