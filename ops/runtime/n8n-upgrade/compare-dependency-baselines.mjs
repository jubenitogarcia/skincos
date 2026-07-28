#!/usr/bin/env node
import fs from 'node:fs';

const paths = process.argv.slice(2);
if (paths.length < 2) throw new Error('usage: compare-dependency-baselines.mjs <summary.json> <summary.json> [...]');
const inputs = paths.map((path) => ({ path, report: JSON.parse(fs.readFileSync(path, 'utf8')) }));
const advisoryKey = (item) => `${item.package}|${item.via.map((via) => via.source ?? via.url ?? via.package ?? '').join(',')}`;
const allKeys = new Set(inputs.flatMap(({ report }) => report.high_critical.map(advisoryKey)));
const comparison = {
  schema_version: 1,
  fixture_scope: 'synthetic dependency-only audit; reachability must be established separately from package presence',
  inputs: inputs.map(({ path, report }) => ({ path, n8n_version: report.n8n_version, inventory: report.inventory, counts: report.counts })),
  high_critical: [...allKeys].sort().map((key) => ({
    key,
    versions: inputs.map(({ report }) => {
      const item = report.high_critical.find((candidate) => advisoryKey(candidate) === key);
      return item ? { n8n_version: report.n8n_version, inventory: report.inventory, present: true, ...item } : { n8n_version: report.n8n_version, inventory: report.inventory, present: false };
    }),
  })),
};
process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
