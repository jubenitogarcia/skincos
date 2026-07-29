const fs = require('fs');
const os = require('os');
const path = require('path');
const { hash, stableId } = require('../lib/canonical');

const SAFE_KIND = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeKind(kind) {
  if (typeof kind !== 'string' || !SAFE_KIND.test(kind)) {
    throw new Error('Audio artifact kind must contain only letters, numbers, underscores or hyphens');
  }
  return kind;
}

function safeOutputFile(outputDir, filename) {
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir) || outputDir.includes('\0')) {
    throw new Error('Audio fixture output directory must be an absolute path');
  }
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if (!isInside(temporaryRoot, outputDir)) {
    throw new Error('Audio fixtures must stay inside the operating-system temporary directory');
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const realOutputDir = fs.realpathSync(outputDir);
  if (!isInside(temporaryRoot, realOutputDir)) {
    throw new Error('Audio fixture output directory resolves outside the temporary artifact root');
  }
  if (path.basename(filename) !== filename || !/^[A-Za-z0-9_-]+\.(?:json|wav)$/.test(filename)) {
    throw new Error('Unsafe audio artifact filename');
  }
  return path.format({ dir: realOutputDir, base: filename });
}

function wavBuffer({ seconds = 1, sampleRate = 8000, frequency = 220, gain = 0.12 } = {}) {
  const samples = Math.max(1, Math.floor(seconds * sampleRate));
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 32767 * gain), 44 + index * 2);
  return buffer;
}
function renderFixture({ outputDir, kind, compositionId, seconds, frequency = 220 }) {
  const normalizedKind = safeKind(kind);
  const id = stableId(normalizedKind.toUpperCase(), { compositionId, seconds, frequency });
  const file = safeOutputFile(outputDir, `${id}.wav`);
  const requestedSeconds = Math.max(Number(seconds), 0.25);
  // Keep physical fixtures small for CI; the manifest retains logical length.
  const renderedSeconds = Math.min(requestedSeconds, 2);
  const content = wavBuffer({ seconds: renderedSeconds, frequency });
  fs.writeFileSync(file, content);
  const checksum = hash(content);
  return { artifact_id: id, kind, uri: `file://${file.replace(/\\/g, '/')}`, path: file, checksum, mime_type: 'audio/wav', duration_seconds: requestedSeconds, rendered_duration_seconds: renderedSeconds, sample_rate: 8000, bit_depth: 16, channels: 1, byte_length: content.length, binary_in_control_plane: false };
}
function analyzeArtifact(artifact) {
  const content = fs.readFileSync(artifact.path);
  const riff = content.subarray(0, 4).toString();
  const wave = content.subarray(8, 12).toString();
  const sampleRate = content.readUInt32LE(24);
  const channels = content.readUInt16LE(22);
  const bitDepth = content.readUInt16LE(34);
  const dataBytes = content.readUInt32LE(40);
  const duration = dataBytes / (sampleRate * channels * (bitDepth / 8));
  let peak = 0;
  for (let offset = 44; offset + 1 < content.length; offset += 2) peak = Math.max(peak, Math.abs(content.readInt16LE(offset)) / 32767);
  return {
    duration_seconds: Number(duration.toFixed(3)),
    loudness_lufs: -14,
    true_peak_db: peak > 0 ? Number((20 * Math.log10(peak)).toFixed(2)) : -Infinity,
    sample_rate: sampleRate,
    bit_depth: bitDepth,
    channels,
    clipping: peak >= 1,
    phase_warning: false,
    silence_warning: peak === 0,
    integrity: riff === 'RIFF' && wave === 'WAVE' && content.length === 44 + dataBytes && hash(content) === artifact.checksum ? 'VALID' : 'INVALID',
    byte_length: content.length,
  };
}
function renderManifest({ outputDir, kind, value }) {
  const normalizedKind = safeKind(kind);
  const file = safeOutputFile(outputDir, `${stableId(normalizedKind, value)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return {
    uri: `file://${file.replace(/\\/g, '/')}`,
    path: file,
    checksum: hash(value),
    mime_type: 'application/json',
    binary_in_control_plane: false,
  };
}
module.exports = { renderFixture, analyzeArtifact, renderManifest };
