const { hash, stableId } = require('./canonical');

class MusicLedger {
  constructor() {
    this.productions = new Map();
    this.jobs = new Map();
    this.artifacts = new Map();
    this.dependencies = new Map();
    this.callbacks = new Map();
    this.providerEvents = new Map();
    this.costEvents = [];
  }

  begin(request) {
    const inputHash = hash(request);
    const existing = this.productions.get(request.production_id);
    if (existing && existing.input_hash === inputHash) return { ...existing, reused: true };
    if (existing) throw new Error(`IDEMPOTENCY_CONFLICT: production_id ${request.production_id} already has a different input_hash`);
    const now = new Date().toISOString();
    const row = { production_id: request.production_id, status: 'VALIDATING', input_hash: inputHash, revision: 1, created_at: now, updated_at: now };
    this.productions.set(request.production_id, row);
    return { ...row, reused: false };
  }

  jobKey(input) { return `${input.composition_id}:${input.module}:${input.component_id}:${input.revision}:${input.input_hash}`; }

  upsertJob(input) {
    const job_key = this.jobKey(input);
    const previous = this.jobs.get(job_key);
    if (previous && ['COMPLETED', 'VALIDATED', 'APPROVED'].includes(previous.status)) return { ...previous, reused: true };
    const now = new Date().toISOString();
    const job = { ...previous, ...input, job_key, status: input.status || 'QUEUED', attempt: previous ? previous.attempt : 0, created_at: previous?.created_at || now, updated_at: now };
    this.jobs.set(job_key, job);
    return { ...job, reused: false };
  }

  updateJobStatus(jobKey, status, patch = {}) {
    const job = this.jobs.get(jobKey);
    if (!job) throw new Error(`Unknown job: ${jobKey}`);
    const updated = { ...job, ...patch, status, updated_at: new Date().toISOString() };
    this.jobs.set(jobKey, updated);
    return updated;
  }

  completeJob(jobKey, output) {
    const job = this.jobs.get(jobKey);
    if (!job) throw new Error(`Unknown job: ${jobKey}`);
    const updated = { ...job, status: 'COMPLETED', output, output_hash: hash(output), updated_at: new Date().toISOString() };
    this.jobs.set(jobKey, updated);
    return updated;
  }

  recordArtifact(artifact) {
    const artifact_id = artifact.artifact_id || stableId('ART', { uri: artifact.uri, checksum: artifact.checksum });
    const previous = this.artifacts.get(artifact_id);
    if (previous) return { ...previous, reused: true };
    const row = { ...artifact, artifact_id, created_at: new Date().toISOString() };
    this.artifacts.set(artifact_id, row);
    return { ...row, reused: false };
  }

  addDependency(from, to) {
    if (!this.dependencies.has(from)) this.dependencies.set(from, new Set());
    this.dependencies.get(from).add(to);
    return { component_id: from, depends_on_component_id: to };
  }

  recordCallback(event) {
    const key = event.event_id || hash({ provider: event.provider, provider_request_id: event.provider_request_id });
    if (this.callbacks.has(key)) return { ...this.callbacks.get(key), duplicate: true };
    const row = { ...event, event_id: key, duplicate: false, received_at: new Date().toISOString() };
    this.callbacks.set(key, row);
    return row;
  }

  recordCost(event) {
    const row = { ...event, event_id: event.event_id || stableId('COST', event), created_at: new Date().toISOString() };
    if (!this.costEvents.some((item) => item.event_id === row.event_id)) this.costEvents.push(row);
    return row;
  }

  totalCost(currency = 'USD') {
    return Number(this.costEvents.filter((item) => (item.currency || 'USD') === currency).reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(4));
  }

  recordProviderEvent(event) {
    const event_id = event.event_id || stableId('PROVIDER-EVENT', event);
    if (this.providerEvents.has(event_id)) return { ...this.providerEvents.get(event_id), duplicate: true };
    const row = { ...event, event_id, duplicate: false, created_at: new Date().toISOString() };
    this.providerEvents.set(event_id, row);
    return row;
  }

  invalidateComponents(components, reason) {
    const targets = new Set(components.map((item) => String(item).toLowerCase()));
    const invalidated = [];
    for (const [jobKey, job] of this.jobs) {
      const identity = `${job.module || ''}:${job.component_id || ''}`.toLowerCase();
      if (![...targets].some((target) => identity.includes(target))) continue;
      const updated = { ...job, status: 'INVALIDATED', invalidation_reason: reason, updated_at: new Date().toISOString() };
      this.jobs.set(jobKey, updated);
      invalidated.push(jobKey);
    }
    return invalidated;
  }

  async transaction(operation) {
    const checkpoint = {
      productions: new Map(this.productions),
      jobs: new Map(this.jobs),
      artifacts: new Map(this.artifacts),
      dependencies: new Map([...this.dependencies].map(([key, value]) => [key, new Set(value)])),
      callbacks: new Map(this.callbacks),
      providerEvents: new Map(this.providerEvents),
      costEvents: this.costEvents.map((item) => ({ ...item })),
    };
    try {
      return await operation(this);
    } catch (error) {
      Object.assign(this, checkpoint);
      throw error;
    }
  }

  finish(productionId, status) {
    const production = this.productions.get(productionId);
    if (!production) throw new Error(`Unknown production: ${productionId}`);
    this.productions.set(productionId, { ...production, status, updated_at: new Date().toISOString() });
  }

  snapshot() {
    return {
      productions: [...this.productions.values()],
      jobs: [...this.jobs.values()],
      artifacts: [...this.artifacts.values()],
      dependencies: [...this.dependencies.entries()].map(([component_id, values]) => ({ component_id, depends_on: [...values] })),
      callbacks: [...this.callbacks.values()],
      provider_events: [...this.providerEvents.values()],
      costs: [...this.costEvents],
    };
  }
}

module.exports = { MusicLedger };
