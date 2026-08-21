import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const helper = path.resolve(new URL('./ponto-wrangler-deploy.sh', import.meta.url).pathname);

function writeFakeWrangler(directory, body) {
  const file = path.join(directory, 'fake-wrangler.sh');
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o700 });
  return file;
}

test('retries only Cloudflare version propagation failures and preserves the deployment output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-wrangler-deploy-'));
  try {
    const countFile = path.join(directory, 'attempts');
    const outputFile = path.join(directory, 'deploy.ndjson');
    const fake = writeFakeWrangler(directory, `
      count=0
      if [[ -f "$FAKE_COUNT_FILE" ]]; then count=$(<"$FAKE_COUNT_FILE"); fi
      count=$((count + 1))
      printf '%s' "$count" > "$FAKE_COUNT_FILE"
      if (( count < 3 )); then
        echo 'The requested Worker version could not be found, please check the ID being passed and try again. [code: 100146]' >&2
        exit 1
      fi
      printf '%s\\n' '{"type":"version-deploy","deployment_id":"11111111-1111-4111-8111-111111111111"}' > "$WRANGLER_OUTPUT_FILE_PATH"
    `);

    const result = spawnSync('bash', [helper, outputFile, 'bash', fake], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_COUNT_FILE: countFile, PONTO_WRANGLER_DEPLOY_DELAY_SECONDS: '0' },
      timeout: 30_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(countFile, 'utf8'), '3');
    assert.match(fs.readFileSync(outputFile, 'utf8'), /version-deploy/);
    assert.match(result.stderr, /bounded propagation retry 1\/5/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('does not retry non-propagation deployment failures', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-wrangler-deploy-'));
  try {
    const countFile = path.join(directory, 'attempts');
    const outputFile = path.join(directory, 'deploy.ndjson');
    const fake = writeFakeWrangler(directory, `
      count=0
      if [[ -f "$FAKE_COUNT_FILE" ]]; then count=$(<"$FAKE_COUNT_FILE"); fi
      count=$((count + 1))
      printf '%s' "$count" > "$FAKE_COUNT_FILE"
      echo 'authentication denied' >&2
      exit 1
    `);

    const result = spawnSync('bash', [helper, outputFile, 'bash', fake], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_COUNT_FILE: countFile, PONTO_WRANGLER_DEPLOY_DELAY_SECONDS: '0' },
      timeout: 30_000,
    });

    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(countFile, 'utf8'), '1');
    assert.match(result.stderr, /non-propagation failure/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
