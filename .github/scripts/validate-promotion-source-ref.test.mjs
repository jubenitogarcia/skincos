import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { assertCanonicalPromotionSourceRef } from './validate-promotion-source-ref.mjs';

test('cross-repository promotion accepts only the protected default branch', () => {
  assert.deepEqual(
    assertCanonicalPromotionSourceRef({
      sourceRef: 'refs/heads/main',
      defaultBranch: 'main',
      branchProtected: true,
    }),
    { sourceRef: 'refs/heads/main', defaultBranch: 'main', canonicalRef: 'refs/heads/main' },
  );
});

test('cross-repository promotion rejects a feature branch even with a valid source identity', () => {
  assert.throws(
    () => assertCanonicalPromotionSourceRef({
      sourceRef: 'refs/heads/feature/release-candidate',
      defaultBranch: 'main',
      branchProtected: true,
    }),
    /must equal the producer protected default branch/,
  );
});

test('cross-repository promotion rejects an unprotected default branch', () => {
  assert.throws(
    () => assertCanonicalPromotionSourceRef({
      sourceRef: 'refs/heads/main',
      defaultBranch: 'main',
      branchProtected: false,
    }),
    /is not protected/,
  );
});

test('promotion gate resolves and validates the producer default branch instead of caller branch input', () => {
  const workflow = fs.readFileSync(new URL('../workflows/promotion-gate.yml', import.meta.url), 'utf8');

  assert.match(workflow, /remote_default_branch="\$\(gh api "repos\/\$\{source_repository\}" --jq '\.default_branch'\)"/);
  assert.match(workflow, /remote_branch_protected="\$\(gh api "repos\/\$\{source_repository\}\/branches\/\$\{remote_default_branch\}" --jq '\.protected'\)"/);
  assert.match(workflow, /node \.github\/scripts\/validate-promotion-source-ref\.mjs "\$source_ref" "\$remote_default_branch" "\$remote_branch_protected"/);
  assert.match(workflow, /compare\/\$\{source_sha\}\.\.\.\$\{remote_default_branch\}/);
  assert.doesNotMatch(workflow, /source_branch="\$\{source_ref#refs\/heads\/\}"/);
});
