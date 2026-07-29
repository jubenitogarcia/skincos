const crypto = require('crypto');
const fs = require('fs');
function inspectFile(filePath) { const stat = fs.statSync(filePath); const checksum = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); return { uri: `file://${filePath.replace(/\\/g, '/')}`, checksum, size_bytes: stat.size, mime_type: 'application/octet-stream', metadata: { source: 'media-prep', binary_in_control_plane: false } }; }
function prepareMaterial({ filePath, maxBytes = 25 * 1024 * 1024 }) { const item = inspectFile(filePath); if (item.size_bytes > maxBytes) throw new Error('material exceeds configured limit'); return item; }
module.exports = { inspectFile, prepareMaterial };
