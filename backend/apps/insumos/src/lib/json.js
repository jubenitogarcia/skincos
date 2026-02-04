export function safeJson(value, maxLen = 45000) {
    try {
        const s = JSON.stringify(value ?? null);
        return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
    } catch {
        return '';
    }
}

export function safeJsonNoTruncate(value) {
    try {
        return JSON.stringify(value ?? null);
    } catch {
        return 'null';
    }
}
