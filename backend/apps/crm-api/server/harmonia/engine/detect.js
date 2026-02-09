const OPT_OUT_RE = /\b(stop|sair|cancelar|remover)\b/i

const RISK_REASONS = [
    { re: /\b(dor\s+forte|sangramento|infec(c|ç)(a|ã)o|febre)\b/i, reason: 'medical_risk' },
    { re: /\b(gestante|gr(a|á)vida|amamentando)\b/i, reason: 'pregnancy_or_breastfeeding' },
    { re: /\b(urg(e|ê)ncia|emerg(e|ê)ncia)\b/i, reason: 'urgent' },
    { re: /\b(reclama(c|ç)(a|ã)o|processo|procon|advogado|den(u|ú)ncia)\b/i, reason: 'complaint_or_legal' },
    { re: /\b(p(e|é)ssimo|horr(i|í)vel|odiei|nunca\s+mais|golpe)\b/i, reason: 'negative_sentiment' },
]

export function detectOptOut(text) {
    const t = String(text || '').trim()
    if (!t) return false
    return OPT_OUT_RE.test(t)
}

export function detectHandoffRisk(text) {
    const t = String(text || '').trim()
    if (!t) return null
    for (const r of RISK_REASONS) {
        if (r.re.test(t)) return r.reason
    }
    return null
}

