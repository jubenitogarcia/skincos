const { sha256 } = require('./canonical');

class MemoryLedger {
  constructor() { this.productions = new Map(); this.jobs = new Map(); this.artifacts = new Map(); this.events = []; }
  beginProduction(request) { const existing = this.productions.get(request.production_id); if (existing) return existing; const row = { production_id: request.production_id, status: 'RECEIVED', input_hash: sha256(request), created_at: new Date().toISOString() }; this.productions.set(row.production_id, row); return row; }
  upsertJob(job) { const key = `${job.production_id}:${job.module}:${job.component_id}:${job.revision}`; const existing = this.jobs.get(key); if (existing && existing.status === 'DONE' && existing.input_hash === job.input_hash) return { ...existing, reused: true }; const row = { ...job, job_key: key, status: job.status || 'PENDING', attempt: job.attempt || 0 }; this.jobs.set(key, row); return row; }
  findReusable(inputHash) { return [...this.jobs.values()].find((job) => job.status === 'DONE' && job.input_hash === inputHash && job.artifact_checksum); }
  recordArtifact(artifact) { const row = { ...artifact, checksum: artifact.checksum || sha256(artifact.uri) }; this.artifacts.set(row.artifact_id, row); return row; }
  event(event) { this.events.push({ ...event, at: new Date().toISOString() }); }
  finishProduction(productionId, status, outputHash) { const row = this.productions.get(productionId); if (!row) throw new Error(`Unknown production ${productionId}`); row.status = status; row.output_hash = outputHash; row.updated_at = new Date().toISOString(); return row; }
  snapshot() { return { productions: [...this.productions.values()], jobs: [...this.jobs.values()], artifacts: [...this.artifacts.values()], events: this.events }; }
}

module.exports = { MemoryLedger };
