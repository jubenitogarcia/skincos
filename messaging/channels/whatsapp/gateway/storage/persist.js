// Lightweight JSONL persistence with in-memory index hydration and cursor-based pagination
const fs = require('fs');
const path = require('path');
const { addMessage, getStores } = require('./inMemory');

let DATA_DIR = null;

function init(opts = {}) {
    DATA_DIR = opts.dir || path.join(__dirname, 'data');
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }
}

function fileFor(tenant, kind) {
    return path.join(DATA_DIR || path.join(__dirname, 'data'), `${tenant}.${kind}.jsonl`);
}

function appendJSONL(filePath, obj) {
    try {
        fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf8');
    } catch { /* best-effort */ }
}

function loadMessagesToMemory(tenant = 'default') {
    const fp = fileFor(tenant, 'messages');
    if (!fs.existsSync(fp)) return { loaded: 0 };
    try {
        const rs = fs.readFileSync(fp, 'utf8');
        const lines = rs.split(/\r?\n/).filter(Boolean);
        let loaded = 0;
        for (const line of lines) {
            try {
                const rec = JSON.parse(line);
                if (rec && rec.id) { addMessage(tenant, rec); loaded++; }
            } catch { /* skip bad line */ }
        }
        return { loaded };
    } catch { return { loaded: 0 }; }
}

function appendMessage(tenant = 'default', msg) {
    const fp = fileFor(tenant, 'messages');
    appendJSONL(fp, msg);
}

// Cursor encoding: base64 of "offset:<number>"
function encodeCursor(offset) {
    try { return Buffer.from(`offset:${offset}`).toString('base64'); } catch { return null; }
}
function decodeCursor(cur) {
    try {
        const s = Buffer.from(String(cur), 'base64').toString('utf8');
        const m = /^offset:(\d+)$/.exec(s);
        if (m) return parseInt(m[1], 10) || 0;
        return 0;
    } catch { return 0; }
}

function searchWithCursorInMemory(tenant = 'default', candidates, { limit = 50, cursor = null, sort = 'desc' }) {
    const stores = getStores(tenant);
    const arr = Array.from(candidates).map(id => stores.indexes.messageById.get(id)).filter(Boolean);
    const getTs = (m) => {
        const t = m && (m.createdAt || m.timestamp || 0);
        const n = typeof t === 'number' ? t : Date.parse(t);
        return isNaN(n) ? 0 : n;
    };
    if (String(sort).toLowerCase() === 'asc') {
        arr.sort((a, b) => getTs(a) - getTs(b) || String(a.id).localeCompare(String(b.id)));
    } else {
        arr.sort((a, b) => getTs(b) - getTs(a) || String(b.id).localeCompare(String(a.id)));
    }
    const start = cursor ? decodeCursor(cursor) : 0;
    const slice = arr.slice(start, start + limit);
    const nextCursor = (start + limit) < arr.length ? encodeCursor(start + limit) : null;
    return { items: slice, nextCursor, total: arr.length };
}

module.exports = {
    init,
    appendMessage,
    loadMessagesToMemory,
    searchWithCursorInMemory
};
