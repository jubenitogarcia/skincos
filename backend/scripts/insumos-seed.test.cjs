const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const seeder = path.join(__dirname, 'insumos-seed.sh');

test('seed failure emits a classified safe code without logging the private token or response body', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'insumos-seed-test-'));
  const bin = path.join(temporary, 'bin');
  const payload = path.join(temporary, 'payload.json');
  fs.mkdirSync(bin);
  fs.writeFileSync(payload, '{}');
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w) shift 2 ;;
    *) shift ;;
  esac
done
printf '%s' '{"success":false,"error":"FOREIGN KEY constraint failed"}' > "$output"
printf '500'
`, { mode: 0o755 });

  const token = 'private-token-not-for-output';
  const result = spawnSync('bash', [seeder, payload], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      INSUMOS_SEED_TOKEN: token,
      INSUMOS_API_URL: 'http://127.0.0.1:1/insumos',
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /INSUMOS_SEED_HTTP_500_SQL_FOREIGN_KEY_CONSTRAINT/);
  assert.doesNotMatch(output, new RegExp(token));
  assert.doesNotMatch(output, /FOREIGN KEY constraint failed/);
});
