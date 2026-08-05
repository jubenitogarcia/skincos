'use strict';

const fs = require('fs');
const path = require('path');
const {
  object,
  sha256,
  text,
} = require('./contracts');

function extensionForMime(mimeType) {
  const value = text(mimeType).toLowerCase();
  if (value === 'image/svg+xml') return '.svg';
  if (value === 'image/png') return '.png';
  if (value === 'image/jpeg') return '.jpg';
  if (value === 'image/webp') return '.webp';
  if (value === 'video/mp4') return '.mp4';
  if (value === 'audio/mpeg') return '.mp3';
  if (value === 'audio/wav') return '.wav';
  if (value === 'application/json') return '.json';
  return '.bin';
}

function descriptor({ artifactId, artifactKey, bytes, metadata, artifactUri, previewUri, simulated }) {
  const candidate = object(metadata);
  const mimeType = text(candidate.mime_type || candidate.mimeType || 'application/octet-stream');
  return {
    artifact_id: text(artifactId),
    artifact_key: text(artifactKey),
    artifact_uri: text(artifactUri),
    preview_uri: text(previewUri || artifactUri),
    mime_type: mimeType,
    width: Number.isFinite(Number(candidate.width)) ? Number(candidate.width) : null,
    height: Number.isFinite(Number(candidate.height)) ? Number(candidate.height) : null,
    duration_seconds: Number.isFinite(Number(candidate.duration_seconds)) ? Number(candidate.duration_seconds) : null,
    file_size: bytes.length,
    sha256: sha256(bytes),
    checksum: { algorithm: 'SHA-256', value: sha256(bytes) },
    simulated: Boolean(simulated),
  };
}

class MemoryArtifactStore {
  constructor() {
    this.entries = new Map();
    this.writes = [];
  }

  resetWrites() {
    this.writes = [];
  }

  async put({ executionId, jobId, artifactKey, bytes, metadata }) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
    const digest = sha256(buffer);
    const artifactId = `${text(executionId)}:${text(jobId)}:${text(artifactKey)}`;
    const artifactUri = `mock://ccg-executor/${encodeURIComponent(artifactId)}/${digest}`;
    const value = descriptor({
      artifactId,
      artifactKey,
      bytes: buffer,
      metadata,
      artifactUri,
      simulated: true,
    });
    this.entries.set(artifactUri, { bytes: buffer, descriptor: value });
    this.writes.push({ ...value, simulated: true });
    return value;
  }

  async read(uri) {
    const entry = this.entries.get(text(uri));
    return entry ? entry.bytes : null;
  }

  async verify(value) {
    const candidate = object(value);
    const bytes = await this.read(candidate.artifact_uri || candidate.uri);
    if (!bytes) return { valid: false, reason: 'ARTIFACT_NOT_FOUND' };
    const digest = sha256(bytes);
    return { valid: digest === text(candidate.sha256 || candidate.checksum?.value), sha256: digest };
  }

  drainWrites() {
    const writes = this.writes.slice();
    this.resetWrites();
    return writes;
  }
}

class LocalArtifactStore {
  constructor({ root, publicBaseUrl = '' } = {}) {
    if (!text(root)) throw new Error('LocalArtifactStore requires an artifact root');
    this.root = path.resolve(root);
    this.publicBaseUrl = text(publicBaseUrl).replace(/\/$/, '');
    this.writes = [];
  }

  resetWrites() {
    this.writes = [];
  }

  filePath(executionId, jobId, artifactKey, mimeType) {
    const digest = sha256(`${text(executionId)}\0${text(jobId)}\0${text(artifactKey)}`);
    return path.join(this.root, digest.slice(0, 2), `${digest}${extensionForMime(mimeType)}`);
  }

  uriFor(filePath, executionId, jobId, artifactKey) {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${encodeURIComponent(text(executionId))}/${encodeURIComponent(text(jobId))}/${encodeURIComponent(text(artifactKey))}`;
    }
    return `file://${filePath.replace(/\\/g, '/')}`;
  }

  async put({ executionId, jobId, artifactKey, bytes, metadata }) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
    const candidate = object(metadata);
    const mimeType = text(candidate.mime_type || candidate.mimeType || 'application/octet-stream');
    const filePath = this.filePath(executionId, jobId, artifactKey, mimeType);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(temporaryPath, buffer, { flag: 'wx' });
    await fs.promises.rename(temporaryPath, filePath);
    const artifactId = `${text(executionId)}:${text(jobId)}:${text(artifactKey)}`;
    const artifactUri = this.uriFor(filePath, executionId, jobId, artifactKey);
    const value = descriptor({
      artifactId,
      artifactKey,
      bytes: buffer,
      metadata,
      artifactUri,
      simulated: false,
    });
    this.writes.push(value);
    return value;
  }

  async read(uri) {
    const value = text(uri);
    if (!value.startsWith('file://')) return null;
    const filePath = value.slice('file://'.length);
    const resolved = path.resolve(filePath);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) return null;
    try {
      return await fs.promises.readFile(resolved);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async verify(value) {
    const candidate = object(value);
    const bytes = await this.read(candidate.artifact_uri || candidate.uri);
    if (!bytes) return { valid: false, reason: 'ARTIFACT_NOT_FOUND' };
    const digest = sha256(bytes);
    return { valid: digest === text(candidate.sha256 || candidate.checksum?.value), sha256: digest };
  }

  drainWrites() {
    const writes = this.writes.slice();
    this.resetWrites();
    return writes;
  }
}

module.exports = {
  LocalArtifactStore,
  MemoryArtifactStore,
  descriptor,
};
