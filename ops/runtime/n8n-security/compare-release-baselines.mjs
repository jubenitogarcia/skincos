#!/usr/bin/env node
import fs from 'node:fs';

const paths = process.argv.slice(2);
if (paths.length < 2) throw new Error('usage: compare-release-baselines.mjs <summary.json> <summary.json> [...]');
const reports = paths.map((path) => ({ path, report: JSON.parse(fs.readFileSync(path, 'utf8')) }));
const keyOf = (item) => `${item.package}|${item.via.map((via) => via.source ?? via.url ?? via.package ?? '').join(',')}`;
const keys = new Set(reports.flatMap(({ report }) => report.high_critical.map(keyOf)));
const result = {
  schema_version: 1,
  scope: 'Package presence and advisories only. Reachability and exploitability require separate evidence.',
  releases: reports.map(({ path, report }) => ({ path, n8n_version: report.n8n_version, component_count: report.components.length, high_critical_count: report.high_critical.length })),
  findings: [...keys].sort().map((key) => ({ key, releases: reports.map(({ report }) => ({ n8n_version: report.n8n_version, finding: report.high_critical.find((item) => keyOf(item) === key) ?? null })) }))
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
