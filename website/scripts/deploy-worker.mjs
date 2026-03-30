import { execFileSync, spawn } from "node:child_process";

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

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const configPath = configIndex >= 0 ? args[configIndex + 1] : "wrangler.toml";

const env = {
  ...process.env,
  NEXT_PUBLIC_BUILD_SHA: getBuildSha(),
  NEXT_PUBLIC_BUILD_TIME: getBuildTime(),
};

await run("node", ["scripts/assert-production-snapshot.mjs"], env);
await run("npx", ["opennextjs-cloudflare", "build"], env);
await run("npx", ["wrangler", "deploy", "-c", configPath], env);
