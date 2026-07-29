const fs = require('fs');
const path = require('path');
const { hash, stableId } = require('../lib/canonical');

function wavBuffer({ seconds = 1, sampleRate = 8000, frequency = 220, gain = 0.12 } = {}) {
  const samples = Math.max(1, Math.floor(seconds * sampleRate));
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 32767 * gain), 44 + index * 2);
  return buffer;
}
function renderFixture({ outputDir, kind, compositionId, seconds, frequency = 220 }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const id = stableId(kind.toUpperCase(), { compositionId, seconds, frequency });
  const file = path.join(outputDir, `${id}.wav`);
  const content = wavBuffer({ seconds: Math.min(Math.max(seconds, 0.25), 8), frequency });
  fs.writeFileSync(file, content);
  const checksum = hash(content.toString('base64'));
  return { artifact_id: id, kind, uri: `file://${file.replace(/\\/g, '/')}`, path: file, checksum, mime_type: 'audio/wav', duration_seconds: seconds, sample_rate: 8000, bit_depth: 16, channels: 1, binary_in_control_plane: false };
}
function analyzeArtifact(artifact) { return { duration_seconds: artifact.duration_seconds, loudness_lufs: -14, true_peak_db: -1, sample_rate: artifact.sample_rate, bit_depth: artifact.bit_depth, channels: artifact.channels, clipping: false, phase_warning: false, silence_warning: false }; }
function renderManifest({ outputDir, kind, value }) { fs.mkdirSync(outputDir, { recursive: true }); const file = path.join(outputDir, `${stableId(kind, value)}.json`); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); return { uri: `file://${file.replace(/\\/g, '/')}`, path: file, checksum: hash(value), mime_type: 'application/json', binary_in_control_plane: false }; }
module.exports = { renderFixture, analyzeArtifact, renderManifest };
