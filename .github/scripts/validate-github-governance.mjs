import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fail = (message) => {
  process.stderr.write(`GitHub governance validation failed: ${message}\n`);
  process.exitCode = 1;
};
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const codeowners = read(".github/CODEOWNERS");
for (const ownedPath of ["/.github/", "/website/", "/crm/console/", "/crm/api/", "/api/", "/finance/", "/workforce/timekeeping/", "/workforce/schedule/", "/ads/", "/messaging/", "/orb/"]) {
  if (!codeowners.includes(ownedPath)) fail(`CODEOWNERS is missing ${ownedPath}`);
}

const workflowDirectory = path.join(root, ".github", "workflows");
for (const filename of fs.readdirSync(workflowDirectory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))) {
  const source = fs.readFileSync(path.join(workflowDirectory, filename), "utf8");
  for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s|#|$)/gm)) {
    const action = match[1];
    if (action.startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/i.test(action)) fail(`${filename} has an unpinned action: ${action}`);
  }
}

const ruleset = JSON.parse(read(".github/governance/main-ruleset.json"));
if (ruleset.enforcement !== "active" || ruleset.target !== "branch") fail("main ruleset must be an active branch ruleset");
for (const rule of ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]) {
  if (!ruleset.rules.some((item) => item.type === rule)) fail(`main ruleset is missing ${rule}`);
}

if (!process.exitCode) process.stdout.write("GitHub governance validation OK.\n");
