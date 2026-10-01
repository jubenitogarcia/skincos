import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const root = path.resolve(import.meta.dirname, '../..');
const workflowDirectory = path.join(root, '.github/workflows');

for (const name of fs.readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/i.test(entry)).sort()) {
  test(`GitHub workflow YAML parses: ${name}`, () => {
    const source = fs.readFileSync(path.join(workflowDirectory, name), 'utf8');
    const document = yaml.load(source, { json: false });
    assert.ok(document && typeof document === 'object', `${name} must contain a YAML mapping`);
  });
}
