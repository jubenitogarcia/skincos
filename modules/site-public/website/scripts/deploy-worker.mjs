import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function getBuildSha() {
  if (process.env.NEXT_PUBLIC_BUILD_SHA) return process.env.NEXT_PUBLIC_BUILD_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function getBuildTime() {
  if (process.env.NEXT_PUBLIC_BUILD_TIME) return process.env.NEXT_PUBLIC_BUILD_TIME;
  return String(Date.now());
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "null"}`));
    });
  });
}

function runAndCapture(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "null"}`));
    });
  });
}

function readSiteUrlFromConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const fallback = "https://espacofacial.com";

  if (!fs.existsSync(absolutePath)) return fallback;

  const content = fs.readFileSync(absolutePath, "utf8");
  const match = content.match(/NEXT_PUBLIC_SITE_URL\s*=\s*"([^"]+)"/);
  return match?.[1]?.trim() || fallback;
}

async function getCurrentVersionId(configPath, env) {
  const { stdout } = await runAndCapture("npx", ["wrangler", "deployments", "list", "-c", configPath], env);
  const match = stdout.match(/\(100%\)\s+([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}

async function runPostDeploySmoke({ env, siteUrl, retries, delayMs }) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    if (attempt > 1) {
      console.log(`Retrying post-deploy smoke (${attempt}/${retries}) after ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      await run("node", ["scripts/smoke.mjs"], {
        ...env,
        SMOKE_BASE_URL: siteUrl,
        SMOKE_EXPECT_BUILD_SHA: env.NEXT_PUBLIC_BUILD_SHA ?? "",
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("post-deploy smoke failed");
}

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const configPath = configIndex >= 0 ? args[configIndex + 1] : "wrangler.toml";
const smokeRetries = Number.parseInt(process.env.POST_DEPLOY_SMOKE_RETRIES ?? "6", 10);
const smokeDelayMs = Number.parseInt(process.env.POST_DEPLOY_SMOKE_DELAY_MS ?? "5000", 10);

const env = {
  ...process.env,
  NEXT_PUBLIC_BUILD_SHA: getBuildSha(),
  NEXT_PUBLIC_BUILD_TIME: getBuildTime(),
};

const siteUrl = readSiteUrlFromConfig(configPath);
const previousVersionId = await getCurrentVersionId(configPath, env);

await run("node", ["scripts/assert-production-snapshot.mjs"], env);
await run("npx", ["opennextjs-cloudflare", "build"], env);

try {
  await run("npx", ["wrangler", "deploy", "-c", configPath], env);
  await runPostDeploySmoke({
    env,
    siteUrl,
    retries: Number.isFinite(smokeRetries) && smokeRetries > 0 ? smokeRetries : 6,
    delayMs: Number.isFinite(smokeDelayMs) && smokeDelayMs >= 0 ? smokeDelayMs : 5000,
  });
  console.log("Post-deploy smoke passed.");
} catch (error) {
  console.error(`Post-deploy validation failed: ${error instanceof Error ? error.message : error}`);

  if (previousVersionId) {
    console.error(`Rolling back to previous Worker version ${previousVersionId}...`);
    await run("npx", [
      "wrangler",
      "rollback",
      previousVersionId,
      "-c",
      configPath,
      "-y",
      "-m",
      `auto-rollback: smoke failure after deploy ${env.NEXT_PUBLIC_BUILD_SHA ?? "unknown"}`,
    ], env);
    console.error(`Rollback completed to ${previousVersionId}.`);
  }

  process.exit(1);
}
