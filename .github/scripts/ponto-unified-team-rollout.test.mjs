import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL("../workflows/deploy-core-workers.yml", import.meta.url),
  "utf8",
);

test("production unified Inventory rollout retains already-attested Identity secrets until deploy", () => {
  const custody = workflow.slice(
    workflow.indexOf("- name: Test v2 Identity caller and attest remote secret custody", workflow.indexOf("jobs:")),
    workflow.indexOf("- name: Resolve incumbent Identity version before pilot", workflow.indexOf("jobs:")),
  );
  const deploy = workflow.slice(
    workflow.indexOf("- name: Deploy only the selected operational unit"),
    workflow.indexOf("if: ${{ always() &&", workflow.indexOf("- name: Deploy only the selected operational unit")),
  );

  assert.match(custody, /secret list --config inventory\/wrangler\.toml/);
  assert.match(custody, /IDENTITY_PII_KEY/);
  assert.match(custody, /IDENTITY_WORKFORCE_HMAC_KEY/);
  assert.match(
    deploy,
    /if \[\[ "\$TARGET" == "staging" \]\]; then[\s\S]*?secret put "\$name" --config inventory\/wrangler\.toml \"\$\{env_args\[@\]\}\"/,
  );
  assert.match(deploy, /Production Identity secrets are retained after remote custody attestation/);
  assert.match(
    deploy,
    /if \[\[ "\$TARGET" == "staging" \]\]; then[\s\S]*?for name in IDENTITY_PII_KEY IDENTITY_WORKFORCE_HMAC_KEY; do[\s\S]*?secret put "\$name"[\s\S]*?else[\s\S]*?Production Identity secrets are retained/,
  );
});
