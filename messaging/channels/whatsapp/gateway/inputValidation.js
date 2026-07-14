function normalizeWhatsappContactId(value) {
    if (typeof value !== 'string') return null;

    const raw = value.trim();
    if (!raw) return null;
    if (/^\d+@c\.us$/i.test(raw)) return raw;

    const digits = raw.replace(/\D/g, '');
    return digits ? `${digits}@c.us` : null;
}

module.exports = { normalizeWhatsappContactId };
