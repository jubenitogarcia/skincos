const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const exporter = require('./insumos-d1-export.cjs');

const root = path.resolve(__dirname, '..', '..');

function sampleSnapshot() {
  const d1 = Object.fromEntries(exporter.TABLES.map((spec, index) => [spec.key, index === 0
    ? [{ registro: 'REG-1', dataAtualizacao: '2026-08-07T12:00:00.000Z' }]
    : []]));
  const tableMetadata = Object.fromEntries(exporter.TABLES.map((spec) => [spec.key, {
    table: spec.table,
    available: true,
    count: d1[spec.key].length,
    watermark: d1[spec.key][0]?.[spec.watermark] || null,
  }]));
  return exporter.createPreviewSnapshot({
    options: {
      dbName: 'skincos-db',
      databaseId: '13e59612-99ba-450e-9014-ddefbee72965',
      environment: 'production',
      migrationsDir: path.join(root, 'inventory', 'migrations'),
    },
    d1,
    tableMetadata,
    startedAt: '2026-08-07T12:00:00.000Z',
    finishedAt: '2026-08-07T12:00:01.000Z',
  });
}

test('preview snapshot is a complete, redacted inventory-only contract', () => {
  const snapshot = sampleSnapshot();
  assert.equal(snapshot.version, exporter.PREVIEW_VERSION);
  assert.equal(snapshot.kind, exporter.PREVIEW_KIND);
  assert.equal(snapshot.sources.d1.readOnly, true);
  assert.equal(snapshot.sources.d1.databaseName, 'skincos-db');
  assert.ok(snapshot.sources.d1.migrationDigest.match(/^[a-f0-9]{64}$/));
  assert.deepEqual(Object.keys(snapshot.d1), exporter.TABLES.map(({ key }) => key));
  assert.ok(snapshot.redaction.omittedTables.includes('crm_users'));
  assert.ok(snapshot.redaction.omittedTables.includes('audit_log'));
  assert.equal('crmUsers' in snapshot.d1, false);
  assert.equal('auditLog' in snapshot.d1, false);
  assert.equal(exporter.verifyPreviewSnapshot(snapshot), snapshot);
});

test('preview snapshot integrity and private output boundary fail closed', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'insumos-preview-export-'));
  try {
    const snapshot = sampleSnapshot();
    const output = path.join(temporary, 'runtime', 'snapshots', 'insumos.json');
    exporter.assertPreviewOutputPath(output, {
      INSUMOS_PREVIEW_SNAPSHOT_MODE: '1',
      INSUMOS_PREVIEW_SNAPSHOT_ROOT: path.join(temporary, 'runtime', 'snapshots'),
    });
    assert.throws(() => exporter.assertPreviewOutputPath(path.join(temporary, 'outside.json'), {
      INSUMOS_PREVIEW_SNAPSHOT_MODE: '1',
      INSUMOS_PREVIEW_SNAPSHOT_ROOT: path.join(temporary, 'runtime', 'snapshots'),
    }), /OUTSIDE_RUNTIME/);

    exporter.writeSnapshotAtomically(output, snapshot);
    const metadata = exporter.previewMetadata(exporter.readPreviewSnapshot(output));
    assert.equal(metadata.snapshotId, snapshot.snapshotId);
    assert.equal(metadata.tables.insumosItems.count, 1);
    assert.equal(metadata.tables.insumosMovements.count, 0);

    const tampered = JSON.parse(fs.readFileSync(output, 'utf8'));
    tampered.d1.insumosItems[0].registro = 'REG-2';
    fs.writeFileSync(output, JSON.stringify(tampered));
    assert.throws(() => exporter.readPreviewSnapshot(output), /DIGEST_INVALID/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('wrangler command is argument-based, configured, and read-only', () => {
  const args = exporter.wranglerArguments({
    executable: 'npx',
    dbName: 'skincos-db',
    configPath: '/private/source/inventory/wrangler.toml',
  }, ' SELECT  *\n FROM insumos_items ');
  assert.deepEqual(args, [
    '--no-install', 'wrangler', 'd1', 'execute', 'skincos-db', '--remote', '--json',
    '--config', '/private/source/inventory/wrangler.toml', '--command', 'SELECT * FROM insumos_items',
  ]);
  assert.equal(args.some((value) => String(value).includes('&&') || String(value).includes(';')), false);
});
