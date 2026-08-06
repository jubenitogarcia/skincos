'use strict';

const {
  firstDefined,
  object,
  sha256,
  stableId,
  text,
} = require('../contracts');
const { DeterministicRendererAdapter } = require('./renderer');

function mockBaseSvg(job) {
  const width = Number(job.width) > 0 ? Number(job.width) : 1080;
  const height = Number(job.height) > 0 ? Number(job.height) : 1080;
  const seed = sha256({ job_id: job.job_id, revision: job.revision, capability: job.capability });
  const colorA = `#${seed.slice(0, 6)}`;
  const colorB = `#${seed.slice(6, 12)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colorA}"/><stop offset="1" stop-color="${colorB}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}

function mockPayload(job, dependencyArtifacts) {
  return JSON.stringify({
    mock: true,
    job_id: job.job_id,
    capability: job.capability,
    revision: job.revision,
    dependencies: dependencyArtifacts.map((artifact) => text(artifact.artifact_uri || artifact.uri)).filter(Boolean),
    source_uri: text(firstDefined(job.source_uri, job.asset_uri, job.input_artifact_uri)),
  });
}

function failureFor(job, attempt) {
  const sequence = Array.isArray(job.failure_sequence) ? job.failure_sequence : [];
  const configured = sequence[attempt - 1] || (attempt === 1 ? job.mock_error : null);
  if (!configured) return null;
  if (typeof configured === 'string') return { code: configured, message: configured };
  return configured;
}

class MockAdapter {
  constructor({ provider = 'mock', renderer = new DeterministicRendererAdapter() } = {}) {
    this.provider = provider;
    this.renderer = renderer;
  }

  supports() {
    return true;
  }

  async execute({ job, dependencyArtifacts = [], attempt = 1 }) {
    const failure = failureFor(job, attempt);
    if (failure) {
      const error = new Error(text(failure.message || failure.code || 'Mock adapter failure'));
      error.code = text(failure.code || 'MOCK_FAILURE');
      error.statusCode = Number(failure.statusCode || failure.status_code || (error.code === 'RATE_LIMIT' ? 429 : 0)) || undefined;
      error.retryable = failure.retryable === true || error.statusCode === 429;
      throw error;
    }
    if (this.renderer.supports(job.capability)) {
      const output = await this.renderer.execute({ job, dependencyArtifacts });
      return {
        ...output,
        provider_job_id: stableId('mock', { job_id: job.job_id, attempt, output: output.provider_job_id }),
        warnings: Array.from(new Set([...(output.warnings || []), 'MOCK_EXECUTION_NO_EXTERNAL_CALL'])),
        provenance: {
          ...(output.provenance || {}),
          adapter: 'mock',
          simulated: true,
        },
      };
    }
    const isImage = ['image_generation', 'image_sequence'].includes(job.capability);
    const bytes = Buffer.from(isImage ? mockBaseSvg(job) : mockPayload(job, dependencyArtifacts), 'utf8');
    return {
      provider_job_id: stableId('mock', { job_id: job.job_id, attempt, digest: sha256(bytes) }),
      outputs: [{
        artifact_key: text(job.expected_artifacts?.[0]?.artifact_key || 'primary'),
        bytes,
        metadata: {
          mime_type: isImage ? 'image/svg+xml' : 'application/json',
          width: isImage ? (Number(job.width) > 0 ? Number(job.width) : 1080) : null,
          height: isImage ? (Number(job.height) > 0 ? Number(job.height) : 1080) : null,
          duration_seconds: Number.isFinite(Number(job.duration_seconds)) ? Number(job.duration_seconds) : null,
        },
      }],
      cost: 0,
      currency: 'BRL',
      warnings: ['MOCK_EXECUTION_NO_EXTERNAL_CALL'],
      provenance: {
        adapter: 'mock',
        simulated: true,
        base_visual_only_before_overlay: isImage,
        commercial_overlays_applied: false,
      },
    };
  }
}

module.exports = {
  MockAdapter,
  mockBaseSvg,
};
