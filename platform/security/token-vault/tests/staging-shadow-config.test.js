import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = fs.readFileSync(path.join(here, '..', 'wrangler.toml'), 'utf8');

function section(name) {
  const marker = `[${name}]`;
  const start = config.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const next = config.indexOf('\n[', start + marker.length);
  return config.slice(start, next === -1 ? config.length : next);
}

test('only staging exposes the bounded Influencer Intelligence analytics shadow gate', () => {
  assert.match(section('vars'), /INFLUENCER_INTELLIGENCE_ANALYTICS_MODE\s*=\s*"off"/);
  assert.match(section('env.staging.vars'), /INFLUENCER_INTELLIGENCE_ANALYTICS_MODE\s*=\s*"shadow"/);
  assert.doesNotMatch(config, /^INFLUENCER_INTELLIGENCE_ENABLED\s*=\s*"true"/m);
});
