import assert from "node:assert/strict";
import test from "node:test";
import { publicGitEnvironment } from "../codex-native-scheduled-source.mjs";
import { nativeScheduledUnits } from "../prepare-native-scheduled-units.mjs";
import { validateReleaseSymlink } from "../stage-native-scheduled-release.mjs";

test("scheduled source reads exclude tokens, inherited checkout and auth custody", () => {
  const env = publicGitEnvironment();
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_CONFIG_KEY_0, "credential.helper");
  assert.equal(env.GIT_CONFIG_VALUE_0, "");
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) assert.equal(env[name], undefined);
});

test("scheduled units keep daily architecture and weekly security outside checkout", () => {
  const sha = "a".repeat(40);
  const units = nativeScheduledUnits(sha);
  assert.equal(Object.keys(units).length, 4);
  assert.match(units["skincos-native-architecture-audit.timer"], /OnCalendar=\*-\*-\* 03:17:00 UTC/);
  assert.match(units["skincos-native-security-audit.timer"], /OnCalendar=Mon \*-\*-\* 03:17:00 UTC/);
  for (const name of ["skincos-native-architecture-audit.service", "skincos-native-security-audit.service"]) {
    assert.match(units[name], new RegExp(`releases/${sha}/scripts/run-native-scheduled-gate\\.mjs`));
    assert.match(units[name], /ProtectHome=tmpfs/);
    assert.match(units[name], /InaccessiblePaths=\/mnt\/c \/mnt\/wslg \/etc\/skincos/);
    assert.match(units[name], /flock --nonblock/);
    assert.doesNotMatch(units[name], /Actions|GITHUB_TOKEN|\.codex\/worktrees|DrvFS/);
  }
  assert.throws(() => nativeScheduledUnits("main"), /identity/);
});

test("immutable source preserves internal tracked pointers without accepting external targets", () => {
  validateReleaseSymlink("/source", "/source/backend/app/runtime", "../../var/runtime");
  assert.throws(() => validateReleaseSymlink("/source", "/source/link", "/etc/skincos"), /relative/);
  assert.throws(() => validateReleaseSymlink("/source", "/source/link", "C:/private"), /relative/);
  assert.throws(() => validateReleaseSymlink("/source", "/source/app/link", "../../private"), /escaped/);
});
