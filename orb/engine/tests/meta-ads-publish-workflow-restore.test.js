'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const restore = require('../scripts/restore-meta-ads-publish-workflow-snapshot');

const rollbackVersion = '11111111-1111-4111-8111-111111111111';
const expectedVersion = '22222222-2222-4222-8222-222222222222';

function snapshot(overrides = {}) {
  return {
    id: restore.WORKFLOW_ID,
    active: false,
    versionId: rollbackVersion,
    name: 'Meta Ads Publish',
    description: 'inactive workflow',
    nodes: [{ id: 'one', name: 'Build Payload', parameters: { jsCode: 'return [];' } }],
    connections: { 'Build Payload': { main: [[]] } },
    settings: { saveManualExecutions: true },
    meta: { templateCredsSetupCompleted: true },
    ...overrides,
  };
}

function historyFrom(value) {
  return { nodes: JSON.stringify(value.nodes), connections: JSON.stringify(value.connections) };
}

test('rollback parser requires explicit version identities and apply flag', () => {
  const parsed = restore.parseArguments([
    `--expected-version=${expectedVersion}`,
    `--rollback-version=${rollbackVersion}`,
    '--rollback-snapshot=/var/lib/skincos-runtime/orb/exports/workflow-patches/meta-ads-build-payload-2026-08-13T12-00-00-000Z/workflow.live.json',
    '--apply',
  ]);
  assert.equal(parsed.expectedVersion, expectedVersion);
  assert.equal(parsed.rollbackVersion, rollbackVersion);
  assert.equal(parsed.apply, true);
});

test('checkpoint location only accepts a regular full export below the controlled root', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ads-restore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = path.join(root, 'meta-ads-build-payload-2026-08-13T12-00-00-000Z');
  fs.mkdirSync(run);
  const checkpoint = path.join(run, 'workflow.live.json');
  fs.writeFileSync(checkpoint, '{}');
  assert.equal(restore.assertCheckpointPath(checkpoint, root), checkpoint);
  assert.throws(
    () => restore.assertCheckpointPath(path.join(root, 'workflow.live.json'), root),
    /controlled Meta Ads checkpoint directory/,
  );
  assert.throws(
    () => restore.assertCheckpointPath(path.join(run, 'other.json'), root),
    /controlled Meta Ads checkpoint directory/,
  );
  assert.throws(
    () => restore.assertCheckpointPath(`${run}${path.sep}.${path.sep}workflow.live.json`, root),
    /canonical absolute path/,
  );
  assert.throws(
    () => restore.assertCheckpointPath(`${root}${path.sep}..${path.sep}${path.basename(root)}${path.sep}${path.basename(run)}${path.sep}workflow.live.json`, root),
    /canonical absolute path/,
  );
  const linkedRun = path.join(root, 'meta-ads-build-payload-2026-08-13T12-00-01-000Z');
  fs.mkdirSync(linkedRun);
  const linked = path.join(linkedRun, 'workflow.live.json');
  fs.symlinkSync(checkpoint, linked);
  assert.throws(
    () => restore.assertCheckpointPath(linked, root),
    /regular file|symlinks/,
  );
});

test('checkpoint root itself may not be redirected through a symlink', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ads-restore-root-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const actualRoot = path.join(parent, 'actual');
  const linkedRoot = path.join(parent, 'linked');
  const run = path.join(actualRoot, 'meta-ads-build-payload-2026-08-13T12-00-00-000Z');
  fs.mkdirSync(run, { recursive: true });
  const checkpoint = path.join(run, 'workflow.live.json');
  fs.writeFileSync(checkpoint, '{}');
  fs.symlinkSync(actualRoot, linkedRoot);
  assert.throws(
    () => restore.assertCheckpointPath(path.join(linkedRoot, path.basename(run), 'workflow.live.json'), linkedRoot),
    /checkpoint root may not traverse symlinks/,
  );
});

test('rollback snapshot must exactly match its historical graph and immutable workflow identity', () => {
  const source = snapshot();
  const restored = restore.assertSnapshot(source, {
    rollbackVersion,
    history: historyFrom(source),
    live: { name: source.name, description: source.description },
  });
  assert.deepEqual(restored.nodes, source.nodes);
  assert.throws(
    () => restore.assertSnapshot(snapshot({ nodes: [{ id: 'changed' }] }), {
      rollbackVersion,
      history: historyFrom(source),
      live: { name: source.name, description: source.description },
    }),
    /does not match the recorded workflow history version/,
  );
  assert.throws(
    () => restore.assertSnapshot(snapshot({ active: true }), {
      rollbackVersion,
      history: historyFrom(source),
      live: { name: source.name, description: source.description },
    }),
    /expected inactive Meta Ads Publish workflow/,
  );
  assert.throws(
    () => restore.assertSnapshot(snapshot({ versionId: expectedVersion }), {
      rollbackVersion,
      history: historyFrom(source),
      live: { name: source.name, description: source.description },
    }),
    /does not match --rollback-version/,
  );
});

test('restore transaction locks the workflow, rejects drift, and writes a fresh history version', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'restore-meta-ads-publish-workflow-snapshot.js'), 'utf8');
  assert.match(source, /WHERE id = \$1 FOR UPDATE/);
  assert.match(source, /Refusing to restore an active workflow/);
  assert.match(source, /Live version changed: expected/);
  assert.match(source, /FROM n8n_runtime\.workflow_history/);
  assert.match(source, /FOR SHARE/);
  assert.match(source, /rollback snapshot graph does not match the recorded workflow history version/);
  assert.doesNotMatch(source, /path\.(?:join|resolve)\(/);
  assert.match(source, /INSERT INTO n8n_runtime\.workflow_history/);
  assert.match(source, /FROM n8n_runtime\.workflow_entity WHERE id = \$1 FOR UPDATE/);
  assert.match(source, /Validate the owned row before committing/);
  assert.match(source, /await client\.query\('COMMIT'\)/);
  assert.match(source, /graph_readback: 'matched'/);
});

test('native rollback wrapper pins an immutable source, postgres peer, and checkpoint arguments', () => {
  const wrapper = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'runtime', 'rollback-meta-ads-publish-tracking-release.sh'), 'utf8');
  assert.match(wrapper, /unset .*N8N_RUNTIME_HOME/);
  assert.match(wrapper, /\^\/opt\/skincos\/releases\/\[0-9a-f\]\{40\}\/source\$/);
  assert.match(wrapper, /Meta Ads tracking rollback requires the PostgreSQL peer user/);
  assert.match(wrapper, /--rollback-snapshot/);
  assert.match(wrapper, /restore-meta-ads-publish-workflow-snapshot\.js/);
  assert.match(wrapper, /alignment_script=.*inspect-meta-ads-publish-version-alignment\.js/);
  assert.match(wrapper, /"\$node_bin" "\$alignment_script" --strict/);
  assert.doesNotMatch(wrapper, /validate-meta-ads-publish-preflight\.js/);
});
