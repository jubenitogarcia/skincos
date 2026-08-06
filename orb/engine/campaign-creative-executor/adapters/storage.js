'use strict';

const {
  sha256,
  stableId,
  text,
} = require('../contracts');

class StorageReferenceAdapter {
  constructor({ provider = 'local-storage' } = {}) {
    this.provider = provider;
  }

  supports(capability) {
    return capability === 'artifact_storage';
  }

  async execute({ job, dependencyArtifacts = [] }) {
    const payload = JSON.stringify({
      storage_reference: true,
      job_id: job.job_id,
      dependencies: dependencyArtifacts.map((artifact) => ({
        artifact_uri: text(artifact.artifact_uri || artifact.uri),
        sha256: text(artifact.sha256 || artifact.checksum?.value),
      })),
    });
    return {
      provider_job_id: stableId('storage', { job_id: job.job_id, digest: sha256(payload) }),
      outputs: [{
        artifact_key: text(job.expected_artifacts?.[0]?.artifact_key || 'primary'),
        bytes: Buffer.from(payload, 'utf8'),
        metadata: { mime_type: 'application/json' },
      }],
      cost: 0,
      currency: 'BRL',
      warnings: [],
      provenance: { adapter: 'storage-reference', dependency_count: dependencyArtifacts.length },
    };
  }
}

module.exports = {
  StorageReferenceAdapter,
};
