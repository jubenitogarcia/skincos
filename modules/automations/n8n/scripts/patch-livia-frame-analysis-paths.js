#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.token-vault.export.json'),
];

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function exportWorkflow(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function getWorkflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: {},
    meta: parseJson(row.meta, null),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    updatedAt: row.updatedAt,
  };
}

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Unable to find Frame Analysis block: ${label}`);
  }
  return source.replace(before, after);
}

function patchFrameAnalysis(node) {
  let command = String(node.parameters?.command || '');

  command = replaceOnce(
    command,
    `  const inFile = String($('Write File').item.json.fileName);
  const base = inFile.split('.').slice(0, -1).join('.') || inFile;

  const mediaPath = isVideo ? \`\${base}_compressed.mp4\` : \`\${base}_ig.jpg\`;
  const thumbPath = \`\${base}_thumb.jpg\`;
  const outJson = \`\${base}_frame_analysis.json\`;`,
    `  const inFile = String($('Write File').item.json.fileName);
  const lastSlash = inFile.lastIndexOf('/');
  const dir = lastSlash >= 0 ? inFile.substring(0, lastSlash) : '';
  const file = lastSlash >= 0 ? inFile.substring(lastSlash + 1) : inFile;
  const parts = file.split('.');
  if (parts.length > 1) parts.pop();
  const baseName = parts.join('.') || file;
  const base = dir ? \`\${dir}/\${baseName}\` : baseName;
  const outputBase = base.endsWith('_temp') ? base.slice(0, -5) : base;

  const optimizedPath = isVideo ? \`\${outputBase}.mp4\` : \`\${outputBase}.jpg\`;
  const legacyPath = isVideo ? \`\${base}_compressed.mp4\` : \`\${base}_ig.jpg\`;
  const thumbPath = \`\${base}_thumb.jpg\`;
  const outJson = \`\${base}_frame_analysis.json\`;`,
    'path resolution',
  );

  command = replaceOnce(
    command,
    `    return \`set -e\\n\` +
      \`cp -f \${JSON.stringify(mediaPath)} \${JSON.stringify(thumbPath)} || true\\n\` +
      \`cat > \${JSON.stringify(outJson)} <<'JSON'\\n\` +`,
    `    return \`set -e\\n\` +
      \`ORIGINAL=\${JSON.stringify(inFile)}\\n\` +
      \`OPTIMIZED=\${JSON.stringify(optimizedPath)}\\n\` +
      \`LEGACY=\${JSON.stringify(legacyPath)}\\n\` +
      \`THUMB=\${JSON.stringify(thumbPath)}\\n\` +
      \`OUTJSON=\${JSON.stringify(outJson)}\\n\` +
      \`INPUT=""\\n\` +
      \`for candidate in "$OPTIMIZED" "$LEGACY" "$ORIGINAL"; do if [ -f "$candidate" ]; then INPUT="$candidate"; break; fi; done\\n\` +
      \`if [ -z "$INPUT" ]; then if [ -f "$OUTJSON" ] && [ -f "$THUMB" ]; then cat "$OUTJSON"; exit 0; fi; echo "FrameAnalysis input file missing: $OPTIMIZED | $LEGACY | $ORIGINAL" 1>&2; exit 1; fi\\n\` +
      \`cp -f "$INPUT" "$THUMB"\\n\` +
      \`test -f "$THUMB" || (echo "FrameAnalysis failed to create image thumbnail: $THUMB" 1>&2; exit 1)\\n\` +
      \`cat > "$OUTJSON" <<'JSON'\\n\` +`,
    'image input resolution',
  );

  command = replaceOnce(
    command,
    `\`INPUT=\${JSON.stringify(mediaPath)}\\n\` +
\`if [ ! -f "$INPUT" ]; then INPUT=\${JSON.stringify(inFile)}; fi\\n\` +
\`THUMB=\${JSON.stringify(thumbPath)}\\n\` +
\`OUTJSON=\${JSON.stringify(outJson)}\\n\` +`,
    `\`ORIGINAL=\${JSON.stringify(inFile)}\\n\` +
\`OPTIMIZED=\${JSON.stringify(optimizedPath)}\\n\` +
\`LEGACY=\${JSON.stringify(legacyPath)}\\n\` +
\`THUMB=\${JSON.stringify(thumbPath)}\\n\` +
\`OUTJSON=\${JSON.stringify(outJson)}\\n\` +
\`INPUT=""\\n\` +
\`for candidate in "$OPTIMIZED" "$LEGACY" "$ORIGINAL"; do if [ -f "$candidate" ]; then INPUT="$candidate"; break; fi; done\\n\` +
\`if [ -z "$INPUT" ]; then if [ -f "$OUTJSON" ] && [ -f "$THUMB" ]; then cat "$OUTJSON"; exit 0; fi; echo "FrameAnalysis input file missing: $OPTIMIZED | $LEGACY | $ORIGINAL" 1>&2; exit 1; fi\\n\` +`,
    'video input resolution',
  );

  command = replaceOnce(
    command,
    `);\\n\` +
\`\\n\` +
\`cat "$OUTJSON"\\n\`;`,
    `);\\n\` +
\`\\n\` +
\`if [ ! -f "$THUMB" ]; then echo "FrameAnalysis failed to create thumbnail: $THUMB" 1>&2; exit 1; fi\\n\` +
\`cat "$OUTJSON"\\n\`;`,
    'thumbnail existence check',
  );

  node.parameters = {
    ...(node.parameters || {}),
    command,
  };
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = getWorkflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-frame-analysis-paths.${timestamp}.json`);
  exportWorkflow(current, backupPath);

  const patched = {
    ...current,
    nodes: JSON.parse(JSON.stringify(current.nodes || [])),
    connections: JSON.parse(JSON.stringify(current.connections || {})),
    settings: JSON.parse(JSON.stringify(current.settings || {})),
    staticData: current.staticData || {},
    pinData: {},
    meta: {
      ...(current.meta || {}),
      codexPatch: {
        ...(current.meta?.codexPatch || {}),
        name: 'livia-frame-analysis-paths',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  const frameNode = patched.nodes.find((node) => node.name === 'Frame Analysis + Save Thumb');
  if (!frameNode) throw new Error('Frame Analysis + Save Thumb node not found');
  patchFrameAnalysis(frameNode);

  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const nodes = JSON.stringify(patched.nodes);
  const connections = JSON.stringify(patched.connections);
  const settings = JSON.stringify(patched.settings || {});
  const staticData = JSON.stringify(patched.staticData || {});
  const meta = JSON.stringify(patched.meta || {});
  const description = row.description || null;

  const save = db.transaction(() => {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      WORKFLOW_ID,
      'Codex',
      updatedAt,
      updatedAt,
      nodes,
      connections,
      patched.name,
      0,
      description,
    );

    db.prepare(`
      UPDATE workflow_entity
      SET
        nodes = ?,
        connections = ?,
        settings = ?,
        staticData = ?,
        meta = ?,
        versionId = ?,
        activeVersionId = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      nodes,
      connections,
      settings,
      staticData,
      meta,
      versionId,
      versionId,
      updatedAt,
      WORKFLOW_ID,
    );
  });

  save();

  const exported = {
    ...patched,
    versionId,
    activeVersionId: versionId,
    updatedAt,
  };

  for (const exportPath of EXPORT_PATHS) {
    exportWorkflow(exported, exportPath);
  }

  const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
  const pinKeys = Object.keys(parseJson(row.pinData, {}) || {});
  db.close();
  if (fkIssues.length) throw new Error(`foreign_key_check failed: ${JSON.stringify(fkIssues)}`);

  console.log(JSON.stringify({
    ok: true,
    workflowId: WORKFLOW_ID,
    previousVersionId: current.versionId,
    versionId,
    backupPath,
    exports: EXPORT_PATHS,
    nodes: exported.nodes.length,
    connectionSources: Object.keys(exported.connections || {}).length,
    preservedDatabasePinDataKeys: pinKeys.length,
  }, null, 2));
}

main();
