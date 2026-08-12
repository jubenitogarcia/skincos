import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../..", import.meta.url);
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), "utf8");

test("native custody uses a trusted dispatch-only runner and a narrow root helper", () => {
  const workflow = read(".github/workflows/provision-native-global-coordination-custody.yml");
  const helper = read("scripts/runtime/provision-global-coordination-custody.sh");
  const installer = read("scripts/runtime/install-native-custody-runner.sh");
  const sudoers = read("ops/runtime/github-actions-runner/skincos-native-custody.sudoers");

  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /runs-on: \[self-hosted, Linux, X64, skincos-native-custody\]/);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.match(workflow, /global:orb-coordination-custody/);
  assert.match(workflow, /provision-global-coordination write/);
  assert.match(workflow, /provision-global-coordination audit/);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY/);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATION_KEY_ID/);
  assert.doesNotMatch(workflow, /echo .*GLOBAL_COORDINATION_SHARED_SECRET/);

  assert.match(helper, /TARGET_FILE="\$TARGET_DIR\/orb-backup\.env"/);
  assert.match(helper, /read_contract/);
  assert.match(helper, /mv -f/);
  assert.match(helper, /mode=640/);
  assert.match(helper, /validate_key_id/);
  assert.match(helper, /SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY/);
  assert.match(helper, /Usage: provision-global-coordination-custody\.sh validate\|write\|audit/);
  assert.doesNotMatch(helper, /printf .*COORDINATION_SECRET/);

  assert.match(installer, /useradd --system/);
  assert.match(installer, /--shell \/usr\/sbin\/nologin/);
  assert.match(installer, /visudo -cf/);
  assert.match(installer, /--token "\$RUNNER_TOKEN"/);
  assert.match(sudoers, /skincos-actions ALL=\(root\) NOPASSWD/);
  assert.match(sudoers, /skincos-provision-global-coordination/);
  assert.doesNotMatch(sudoers, /systemctl|bash|sh -c|\/bin\/sudo/);
});
