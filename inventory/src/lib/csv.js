function csvEscape(v) {
    const s = `${v ?? ''}`;
    const needsQuotes = s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r');
    const escaped = s.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
}

export function toCsv(headers, rows) {
    const bom = '\ufeff';
    const head = headers.map(csvEscape).join(';');
    const body = rows.map((r) => r.map(csvEscape).join(';')).join('\n');
    return `${bom}${head}\n${body}\n`;
}
