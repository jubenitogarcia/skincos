const { stableId, hash } = require('./canonical');

class MusicProvider {
  constructor({ name, model = 'unconfigured', mode = 'mock' } = {}) {
    this.name = name;
    this.model = model;
    this.mode = mode;
  }

  validate(job) {
    if (!job || !job.input_hash) throw new Error('provider job must include input_hash');
    return true;
  }

  async submit() { throw new Error('submit must be implemented'); }
  async status() { throw new Error('status must be implemented'); }
  async result() { throw new Error('result must be implemented'); }
  async cancel() { return { status: 'CANCELLED' }; }
  estimateCost() { return 0; }
}

class MockMusicProvider extends MusicProvider {
  constructor(options = {}) {
    super({
      name: options.name || 'mock-music',
      model: options.model || 'deterministic-fixture-v1',
      mode: 'mock',
    });
    this.records = new Map();
    this.submitCount = 0;
    this.cost = Number(options.cost || 0);
    this.processingPolls = Number(options.processingPolls || 0);
    this.rateLimit = Number(options.rateLimit || 100);
    this.maxRetries = Number(options.maxRetries || 0);
  }

  async submit(job) {
    this.validate(job);
    if (job.dry_run !== true || job.provider_policy?.mode !== 'mock') {
      throw new Error('mock provider requires explicit dry_run and mock policy');
    }
    const request_id = stableId('MOCK', {
      input_hash: job.input_hash,
      module: job.module,
      component_id: job.component_id,
      model: this.model,
    });
    const previous = this.records.get(request_id);
    if (previous) return { ...previous, reused: true };
    if (this.submitCount >= this.rateLimit) throw new Error('RATE_LIMIT: mock provider submission limit reached');
    this.submitCount += 1;
    const record = {
      request_id,
      provider: this.name,
      model: this.model,
      status: this.processingPolls ? 'PROCESSING' : 'COMPLETED',
      polls_remaining: this.processingPolls,
      cost: this.cost,
      result: { artifact_seed: hash(job).slice(0, 16) },
    };
    this.records.set(request_id, record);
    return record;
  }

  async status(requestId) {
    const record = this.records.get(requestId);
    if (!record) return { status: 'UNKNOWN' };
    if (record.polls_remaining > 0) {
      record.polls_remaining -= 1;
      if (record.polls_remaining === 0) record.status = 'COMPLETED';
    }
    return { ...record };
  }

  async result(requestId) {
    const value = this.records.get(requestId);
    if (!value) throw new Error('unknown mock request');
    return value.result;
  }

  async cancel(requestId) {
    const value = this.records.get(requestId);
    if (!value) return { request_id: requestId, status: 'CANCELLED' };
    const cancelled = { ...value, status: 'CANCELLED' };
    this.records.set(requestId, cancelled);
    return cancelled;
  }

  estimateCost() {
    return this.cost;
  }
}

class HttpMusicProvider extends MusicProvider {
  constructor({
    name,
    model,
    endpoint,
    fetchImpl = global.fetch,
    enabled = false,
    timeoutMs = 15_000,
    maxRetries = 2,
    headersProvider = async () => ({}),
    rateLimiter = async () => {},
    sleep = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    fallbackProvider = null,
  } = {}) {
    super({ name: name || 'http-music', model, mode: 'live' });
    this.endpoint = String(endpoint || '').replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
    this.enabled = enabled;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.headersProvider = headersProvider;
    this.rateLimiter = rateLimiter;
    this.sleep = sleep;
    this.fallbackProvider = fallbackProvider;
    this.requestContexts = new Map();
  }

  assertEnabled(job) {
    this.validate(job);
    if (!this.enabled || job.dry_run === true || job.provider_policy?.mode !== 'live') {
      throw new Error('real provider is disabled; configure an approved live adapter outside dry-run');
    }
    if (!this.endpoint || typeof this.fetchImpl !== 'function') {
      throw new Error('real provider endpoint is not configured');
    }
  }

  async request(method, route, body, context) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        await this.rateLimiter({
          provider: this.name,
          method,
          route,
          attempt,
        });
        const privateHeaders = await this.headersProvider({
          provider: this.name,
          model: this.model,
        });
        const response = await this.fetchImpl(`${this.endpoint}${route}`, {
          method,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...privateHeaders,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};
        if (response.status === 429) throw new Error('RATE_LIMIT');
        if (!response.ok) {
          const error = new Error(
            response.status >= 500
              ? `PROVIDER_ERROR: HTTP ${response.status}`
              : `VALIDATION_ERROR: HTTP ${response.status}`,
          );
          error.retryable = response.status >= 500;
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error.name === 'AbortError' ? new Error('TIMEOUT') : error;
        const retryable = lastError.retryable
          || /TIMEOUT|RATE_LIMIT|PROVIDER_ERROR/.test(lastError.message);
        if (!retryable || attempt >= this.maxRetries) break;
        await this.sleep(Math.min(250 * (2 ** attempt), 2_000));
      } finally {
        clearTimeout(timeout);
      }
    }

    if (context?.provider_policy?.allow_fallback && this.fallbackProvider) {
      return this.fallbackProvider.submit(context);
    }
    throw lastError;
  }

  async submit(job) {
    this.assertEnabled(job);
    const payload = await this.request(
      'POST',
      '/jobs',
      {
        input_hash: job.input_hash,
        module: job.module,
        component_id: job.component_id,
        parameters: job.parameters || {},
        model: this.model,
        callback_url: job.callback_url,
      },
      job,
    );
    if (!payload.request_id || !payload.status) {
      throw new Error('SCHEMA_ERROR: provider submit response is incomplete');
    }
    this.requestContexts.set(payload.request_id, job);
    return {
      ...payload,
      provider: this.name,
      model: payload.model || this.model,
    };
  }

  contextFor(requestId) {
    const context = this.requestContexts.get(requestId);
    if (!context) throw new Error('PROVIDER_ERROR: unknown request context');
    this.assertEnabled(context);
    return context;
  }

  async status(requestId) {
    const context = this.contextFor(requestId);
    return this.request(
      'GET',
      `/jobs/${encodeURIComponent(requestId)}`,
      undefined,
      context,
    );
  }

  async result(requestId) {
    const context = this.contextFor(requestId);
    return this.request(
      'GET',
      `/jobs/${encodeURIComponent(requestId)}/result`,
      undefined,
      context,
    );
  }

  async cancel(requestId) {
    const context = this.contextFor(requestId);
    return this.request(
      'POST',
      `/jobs/${encodeURIComponent(requestId)}/cancel`,
      {},
      context,
    );
  }

  estimateCost(job) {
    return Number(job?.estimated_cost || 0);
  }
}

const PROVIDER_KINDS = [
  'composition_provider',
  'midi_provider',
  'music_generation_provider',
  'instrument_provider',
  'vocal_provider',
  'voice_provider',
  'sound_effect_provider',
  'audio_analysis_provider',
  'mix_provider',
  'mastering_provider',
  'storage_provider',
];

function providerCatalog() {
  return Object.fromEntries(
    PROVIDER_KINDS.map((kind) => [
      kind,
      { mock: MockMusicProvider, real: HttpMusicProvider },
    ]),
  );
}

function enforceBudget(job, estimate, committed = 0) {
  const limit = Number(
    job?.budget_limits?.max_cost
    ?? job?.provider_policy?.max_cost
    ?? 0,
  );
  if (Number(committed) + Number(estimate) > limit) throw new Error('BUDGET_EXCEEDED');
  return true;
}

function enforceProviderPolicy(policy, provider, jobCount = 0) {
  const allowed = policy.allowed_providers.includes(provider.name)
    || (provider.mode === 'mock' && policy.allowed_providers.includes('mock'));
  if (!allowed) throw new Error(`AUTHORIZATION_ERROR: provider ${provider.name} is not allowed`);
  if (jobCount >= Number(policy.max_jobs)) throw new Error('BUDGET_EXCEEDED: max_jobs reached');
  return true;
}

async function pollControlled({
  provider,
  request_id,
  maxAttempts = 5,
  sleep = async () => {},
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const status = await provider.status(request_id);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status.status)) {
      return { ...status, attempt };
    }
    await sleep(Math.min(1_000 * attempt, 5_000));
  }
  await provider.cancel(request_id);
  throw new Error('TIMEOUT: provider polling exhausted');
}

async function executeProviderJob({
  ledger,
  provider,
  fallbackProvider = null,
  request,
  job,
  maxAttempts = 3,
  sleep = async () => {},
}) {
  const stored = ledger.upsertJob(job);
  if (stored.reused) {
    return {
      job: stored,
      output: stored.output,
      reused: true,
      provider: stored.provider,
      model: stored.model,
      request_id: stored.provider_request_id,
      cost: Number(stored.cost || 0),
      attempts: 0,
    };
  }
  enforceProviderPolicy(request.provider_policy, provider, ledger.snapshot().jobs.length - 1);
  enforceBudget(request, provider.estimateCost(job), ledger.totalCost());
  const providers = [provider, fallbackProvider].filter(Boolean);
  let lastError;

  for (const [providerIndex, activeProvider] of providers.entries()) {
    const retryLimit = Math.min(Number(activeProvider.maxRetries || 0) + 1, maxAttempts);
    for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
      try {
        ledger.updateJobStatus(stored.job_key, attempt === 1 ? 'SUBMITTED' : 'RETRYING', {
          attempt,
          provider: activeProvider.name,
          model: activeProvider.model,
          fallback: providerIndex > 0,
        });
        const submitted = await activeProvider.submit({ ...job, dry_run: request.dry_run, provider_policy: request.provider_policy });
        ledger.recordProviderEvent({ production_id: request.production_id, job_key: stored.job_key, provider: activeProvider.name, provider_request_id: submitted.request_id, status: 'SUBMITTED', attempt });
        const terminal = await pollControlled({ provider: activeProvider, request_id: submitted.request_id, maxAttempts, sleep });
        if (terminal.status !== 'COMPLETED') throw new Error(`PROVIDER_ERROR: terminal status ${terminal.status}`);
        const output = terminal.result || await activeProvider.result(submitted.request_id);
        const cost = Number(submitted.cost ?? activeProvider.estimateCost(job) ?? 0);
        ledger.recordCost({ production_id: request.production_id, provider: activeProvider.name, model: activeProvider.model, amount: cost, currency: 'USD', job_key: stored.job_key });
        ledger.completeJob(stored.job_key, output);
        const completed = ledger.updateJobStatus(stored.job_key, 'COMPLETED', { provider: activeProvider.name, model: activeProvider.model, provider_request_id: submitted.request_id, cost, fallback: providerIndex > 0 });
        return { job: completed, output, reused: false, provider: activeProvider.name, model: activeProvider.model, request_id: submitted.request_id, cost, fallback: providerIndex > 0, attempts: attempt };
      } catch (error) {
        lastError = error;
        ledger.updateJobStatus(stored.job_key, attempt < retryLimit ? 'FAILED_RETRYABLE' : 'FAILED_BLOCKING', { error_code: String(error.message).split(':')[0], error_message: error.message });
        if (attempt < retryLimit) await sleep(Math.min(250 * (2 ** (attempt - 1)), 5000));
      }
    }
  }
  throw lastError;
}

module.exports = {
  MusicProvider,
  MockMusicProvider,
  HttpMusicProvider,
  PROVIDER_KINDS,
  providerCatalog,
  enforceBudget,
  enforceProviderPolicy,
  pollControlled,
  executeProviderJob,
};
