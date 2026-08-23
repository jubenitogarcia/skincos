const fs = require('fs');
const path = require('path');
const { sha256 } = require('../../content-studio-v2/lib/canonical');

function renderStill({ outputDir, deliverableId, width = 1080, height = 1920, overlays = [] }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const text = overlays.map((item, index) => `<text x="${Math.round(width * 0.08)}" y="${180 + index * 72}" fill="#ffffff" font-family="Arial" font-size="42">${String(item.text || '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#1c2230"/><rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="#d6b26e" stroke-width="4"/>${text}</svg>`;
  const file = path.join(outputDir, `${deliverableId}.svg`);
  fs.writeFileSync(file, svg);
  return { uri: `file://${file.replace(/\\/g, '/')}`, path: file, checksum: sha256(svg), mime_type: 'image/svg+xml', width, height, artifact_kind: 'deterministic_still' };
}

function renderVideoFixture({ outputDir, deliverableId, timeline }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = { artifact_kind: 'deterministic_video_fixture', deliverable_id: deliverableId, timeline, note: 'Dry-run fixture; use FFmpeg renderer in the runtime for media encoding.' };
  const file = path.join(outputDir, `${deliverableId}.video-fixture.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return { uri: `file://${file.replace(/\\/g, '/')}`, path: file, checksum: sha256(payload), mime_type: 'application/json', duration_seconds: Number(timeline?.duration_seconds || 6), artifact_kind: 'deterministic_video_fixture' };
}

module.exports = { renderStill, renderVideoFixture };
