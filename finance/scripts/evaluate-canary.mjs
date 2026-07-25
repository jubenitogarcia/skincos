#!/usr/bin/env node
// Evaluates a sanitized synthetic-canary report.  A failed threshold is data,
// not an exception: the caller can always execute its kill-switch cleanup.
import { readFile, writeFile } from 'node:fs/promises';

const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};
const policyFile = value('--policy');
const reportFile = value('--report');
const outputFile = value('--output');
if (!policyFile || !reportFile || !outputFile) throw new Error('usage: evaluate-canary.mjs --policy POLICY --report REPORT --output OUTPUT');

const policy = JSON.parse(await readFile(policyFile, 'utf8'));
let report;
try { report = JSON.parse(await readFile(reportFile, 'utf8')); } catch { report = { ok: false, samples: [], errors: 1, journeyFailures: 1, reason: 'report_missing' }; }
const limits = policy.limits || {};
const samples = Array.isArray(report.samples) ? report.samples : [];
// Authentication is measured and reported separately. Its cold-start/network
// cost must not be mistaken for Finance Worker latency or cause an unrelated
// Identity/gateway delay to trigger a Finance artifact rollback.
const financeSamples = samples.filter((item) => item?.name !== 'login');
const timings = financeSamples.map((item) => Number(item.durationMs)).filter(Number.isFinite).sort((a, b) => a - b);
const loginDuration = samples.find((item) => item?.name === 'login')?.durationMs;
const p95 = timings.length ? timings[Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1)] : Infinity;
const measured = {
  samples: samples.length,
  financeSamples: financeSamples.length,
  p95LatencyMs: p95,
  authenticationLatencyMs: Number.isFinite(Number(loginDuration)) ? Number(loginDuration) : null,
  errors: Number(report.errors || 0) + (report.ok === false ? 1 : 0),
  authenticationFailures: Number(report.authenticationFailures || 0),
  journeyFailures: Number(report.journeyFailures || 0),
  dataDivergences: Number(report.dataDivergences || 0),
  auditFailures: Number(report.auditFailures || 0),
  dependencyFailures: Number(report.dependencyFailures || 0),
};
const breaches = [];
if (measured.samples < Number(limits.minimumSamples || 1)) breaches.push('minimum_samples');
for (const key of ['errors', 'p95LatencyMs', 'authenticationFailures', 'journeyFailures', 'dataDivergences', 'auditFailures', 'dependencyFailures']) {
  if (measured[key] > Number(limits[key] ?? 0)) breaches.push(key);
}
const decision = { ok: breaches.length === 0, module: policy.module, environment: policy.environment, measured, limits, breaches, evaluatedAt: new Date().toISOString() };
await writeFile(outputFile, `${JSON.stringify(decision, null, 2)}\n`);
console.log(JSON.stringify({ ok: decision.ok, breaches: decision.breaches, measured: decision.measured }));
