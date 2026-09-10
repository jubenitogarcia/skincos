import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function write(file, value, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode });
  fs.chmodSync(file, mode);
}

test("native CRM process disables the legacy Ponto writer after private backend config and never invokes npm", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-native-launcher-"));
  try {
    const apiScripts = path.join(root, "crm", "api", "scripts");
    const backendScripts = path.join(root, "backend", "scripts");
    fs.mkdirSync(apiScripts, { recursive: true });
    fs.mkdirSync(backendScripts, { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, "crm", "api", "scripts", "run.sh"), path.join(apiScripts, "run.sh"));
    fs.copyFileSync(path.join(repositoryRoot, "backend", "scripts", "env.sh"), path.join(backendScripts, "env.sh"));
    fs.chmodSync(path.join(apiScripts, "run.sh"), 0o755);
    fs.chmodSync(path.join(backendScripts, "env.sh"), 0o755);

    write(path.join(root, "crm", "api", "package.json"), `${JSON.stringify({ dependencies: { "fixture-dependency": "1.0.0" } })}\n`);
    fs.mkdirSync(path.join(root, "crm", "api", "node_modules", "fixture-dependency"), { recursive: true });
    // This models a private backend layer trying to undo the systemd/launcher
    // setting. The immutable native run script must win immediately before
    // `node server.js` is executed.
    write(path.join(root, "backend", "config", "workspace.local.env"), "PONTO_LEGACY_RUNTIME_MODE=enabled\n");

    const bin = path.join(root, "bin");
    const capture = path.join(root, "ponto-mode.txt");
    const npmMarker = path.join(root, "npm-was-called.txt");
    write(path.join(bin, "node"), `#!/usr/bin/env bash\nset -euo pipefail\nif [[ "\${1:-}" == '-e' ]]; then\n  printf '%s\\n' fixture-dependency\n  exit 0\nfi\nif [[ "\${1:-}" == 'server.js' ]]; then\n  printf '%s' "\${PONTO_LEGACY_RUNTIME_MODE:-}" > "\${CRM_NATIVE_TEST_CAPTURE:?}"\n  exit 0\nfi\necho "unexpected fake node invocation: $*" >&2\nexit 99\n`, 0o755);
    write(path.join(bin, "npm"), `#!/usr/bin/env bash\nprintf '%s\\n' invoked > "\${CRM_NATIVE_TEST_NPM_MARKER:?}"\nexit 99\n`, 0o755);

    const result = childProcess.spawnSync("/usr/bin/bash", [path.join(apiScripts, "run.sh"), "start", "--port", "8099"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CRM_NATIVE_RELEASE_ROOT: `/opt/skincos/releases/${"a".repeat(40)}/crm-service`,
        PONTO_LEGACY_RUNTIME_MODE: "enabled",
        CRM_NATIVE_TEST_CAPTURE: capture,
        CRM_NATIVE_TEST_NPM_MARKER: npmMarker,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(capture, "utf8"), "disabled");
    assert.equal(fs.existsSync(npmMarker), false);

    const launcher = fs.readFileSync(path.join(repositoryRoot, "scripts", "crm", "run-api-linux.sh"), "utf8");
    assert.ok(launcher.indexOf('source "$ENV_FILE"') < launcher.indexOf("export PONTO_LEGACY_RUNTIME_MODE='disabled'"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
