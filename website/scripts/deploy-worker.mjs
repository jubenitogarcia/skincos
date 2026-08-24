import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BEAUTY_MOVEMENT_DATABASE = "espacofacial-beauty-movement";
const BEAUTY_MOVEMENT_ACTIVE_CAMPAIGN_QUERY =
  "SELECT COUNT(*) AS count FROM bm_campaigns WHERE status = 'active' AND ends_at_ms > (CAST(strftime('%s','now') AS INTEGER) * 1000);";

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

function runAndCapture(command, args, env, { echo = true } = {}) {
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
      if (echo) process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (echo) process.stderr.write(text);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const diagnosticOutput = [stdout, stderr].filter(Boolean).join("\n");
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code ?? "null"}${diagnosticOutput ? `\n${diagnosticOutput}` : ""}`,
        ),
      );
    });
  });
}

function getConfigSection(content, sectionName) {
  const marker = `[${sectionName}]`;
  const start = content.indexOf(marker);
  if (start < 0) return null;
  const nextSection = content.indexOf("\n[", start + marker.length);
  const end = nextSection < 0 ? content.length : nextSection;
  return { start, end, content: content.slice(start, end) };
}

function hasDisabledBeautyMovementProductionFlag(content) {
  const section = getConfigSection(content, "vars");
  return Boolean(section && /^BEAUTY_MOVEMENT_ENABLED\s*=\s*"false"\s*$/m.test(section.content));
}

export function parseActiveBeautyMovementCampaignCount(output) {
  const text = String(output ?? "").trim();
  const match = text.match(/\[[\s\S]*\]\s*$/);
  if (!match) throw new Error("beauty_movement_active_state_unreadable");

  let payload;
  try {
    payload = JSON.parse(match[0]);
  } catch {
    throw new Error("beauty_movement_active_state_unreadable");
  }

  const row = payload
    .flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []))
    .find((entry) => Object.prototype.hasOwnProperty.call(entry, "count"));
  const count = Number(row?.count);
  if (!Number.isInteger(count) || count < 0) throw new Error("beauty_movement_active_state_unreadable");
  return count;
}

export function isProductionWebsiteConfig({ configPath, wranglerEnvironment, content }) {
  return (
    !wranglerEnvironment &&
    path.basename(path.resolve(configPath)) === "wrangler.toml" &&
    content.includes(`database_name = "${BEAUTY_MOVEMENT_DATABASE}"`) &&
    hasDisabledBeautyMovementProductionFlag(content)
  );
}

export function writeBeautyMovementEnabledConfig(configPath, content) {
  const section = getConfigSection(content, "vars");
  if (!section || !hasDisabledBeautyMovementProductionFlag(content)) {
    throw new Error("beauty_movement_production_default_flag_changed");
  }
  const enabledSection = section.content.replace(
    /^(BEAUTY_MOVEMENT_ENABLED\s*=\s*)"false"\s*$/m,
    '$1"true"',
  );
  const outputPath = path.join(
    path.dirname(path.resolve(configPath)),
    `.beauty-movement-wrangler-enabled-${process.pid}.toml`,
  );
  fs.writeFileSync(outputPath, `${content.slice(0, section.start)}${enabledSection}${content.slice(section.end)}`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return outputPath;
}

async function readActiveBeautyMovementCampaignCount(configPath, env) {
  try {
    const { stdout } = await runAndCapture(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        BEAUTY_MOVEMENT_DATABASE,
        "--remote",
        "--config",
        configPath,
        "--command",
        BEAUTY_MOVEMENT_ACTIVE_CAMPAIGN_QUERY,
        "--json",
      ],
      env,
      { echo: false },
    );
    return parseActiveBeautyMovementCampaignCount(stdout);
  } catch {
    throw new Error("beauty_movement_active_state_unproven");
  }
}

function readSiteUrlFromConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const fallback = "https://espacofacial.com";

  if (!fs.existsSync(absolutePath)) return fallback;

  const content = fs.readFileSync(absolutePath, "utf8");
  const match = content.match(/NEXT_PUBLIC_SITE_URL\s*=\s*"([^"]+)"/);
  return match?.[1]?.trim() || fallback;
}

function parseOptionalArg(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function getWranglerEnvironmentArgs(environmentName) {
  if (!environmentName) return [];
  if (!/^[a-z][a-z0-9_-]*$/i.test(environmentName)) {
    throw new Error(`Invalid Wrangler environment name: ${environmentName}`);
  }
  return ["--env", environmentName];
}

async function getCurrentVersionId(configPath, env, wranglerEnvironmentArgs, allowMissingWorker = false) {
  try {
    const { stdout } = await runAndCapture("npx", ["wrangler", "deployments", "list", "-c", configPath, ...wranglerEnvironmentArgs], env);
    const match = stdout.match(/\(100%\)\s+([0-9a-f-]{36})/i);
    return match?.[1] ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (allowMissingWorker && message.includes("This Worker does not exist on your account")) {
      console.log("No prior staging Worker deployment found; proceeding without a rollback target.");
      return null;
    }
    throw error;
  }
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

export async function main(argv = process.argv.slice(2), processEnv = process.env) {
  const configPath = parseOptionalArg(argv, "--config") ?? "wrangler.toml";
  const wranglerEnvironment = parseOptionalArg(argv, "--env");
  const wranglerEnvironmentArgs = getWranglerEnvironmentArgs(wranglerEnvironment);
  const smokeRetries = Number.parseInt(processEnv.POST_DEPLOY_SMOKE_RETRIES ?? "6", 10);
  const smokeDelayMs = Number.parseInt(processEnv.POST_DEPLOY_SMOKE_DELAY_MS ?? "5000", 10);

  const env = {
    ...processEnv,
    NEXT_PUBLIC_BUILD_SHA: processEnv.NEXT_PUBLIC_BUILD_SHA || getBuildSha(),
    NEXT_PUBLIC_BUILD_TIME: processEnv.NEXT_PUBLIC_BUILD_TIME || getBuildTime(),
  };

  const siteUrl = processEnv.DEPLOY_SITE_URL?.trim() || readSiteUrlFromConfig(configPath);
  const configContent = fs.readFileSync(path.resolve(configPath), "utf8");
  let deploymentConfigPath = configPath;
  let enabledConfigPath = null;

  if (isProductionWebsiteConfig({ configPath, wranglerEnvironment, content: configContent })) {
    const activeCampaignCount = await readActiveBeautyMovementCampaignCount(configPath, env);
    if (activeCampaignCount > 0) {
      enabledConfigPath = writeBeautyMovementEnabledConfig(configPath, configContent);
      deploymentConfigPath = enabledConfigPath;
      console.log(
        `Beauty Movement has ${activeCampaignCount} active campaign(s); preserving the enabled production flag for this deploy.`,
      );
    } else {
      console.log("Beauty Movement has no active campaign; production deploy keeps the disabled default.");
    }
  }

  try {
    const previousVersionId = await getCurrentVersionId(
      configPath,
      env,
      wranglerEnvironmentArgs,
      wranglerEnvironment === "staging",
    );

    await run("node", ["scripts/assert-production-snapshot.mjs"], env);
    await run("npx", ["opennextjs-cloudflare", "build"], env);

    try {
      const deployArgs = ["wrangler", "deploy", "-c", deploymentConfigPath, ...wranglerEnvironmentArgs];
      if (enabledConfigPath) deployArgs.push("--keep-vars", "--var", "BEAUTY_MOVEMENT_ENABLED:true");
      await run("npx", deployArgs, env);
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
        await run(
          "npx",
          [
            "wrangler",
            "rollback",
            previousVersionId,
            "-c",
            deploymentConfigPath,
            ...wranglerEnvironmentArgs,
            "-y",
            "-m",
            `auto-rollback: smoke failure after deploy ${env.NEXT_PUBLIC_BUILD_SHA ?? "unknown"}`,
          ],
          env,
        );
        console.error(`Rollback completed to ${previousVersionId}.`);
      }

      process.exitCode = 1;
    }
  } finally {
    if (enabledConfigPath) fs.rmSync(enabledConfigPath, { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
