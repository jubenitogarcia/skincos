function safe(v) {
    return String(v || '').trim()
}

export function buildGreeting(payload) {
    const attendant = safe(payload?.attendant) || 'Consultora'
    const instance = safe(payload?.instance) || 'Espaço Facial'
    return `Olá! 👋 Aqui é a *${attendant}*, sua consultora na _${instance}_!`
}

export function buildCta(payload) {
    const cta = safe(payload?.CTA) || 'hoje'
    const workingHours = safe(payload?.workingHours) || 'nosso horário comercial'
    return `Vamos agendar sua avaliação GRÁTIS com o doutor e garantir essa *super oferta*? 🤑 Temos alguns horários disponíveis pra ${cta} ainda! Nosso horário de atendimento é das ${workingHours}!\n\nUma chance perfeita para investir no seu _autocuidado_ com um ótimo *custo-benefício*! 💕`
}

export function buildQualificationQuestion() {
    return 'Pra eu te ajudar a agendar: você prefere qual dia/turno (manhã, tarde ou noite)?'
}

export function buildAfterHoursMessage(payload) {
    const workingHours = safe(payload?.workingHours) || 'nosso horário de atendimento'
    return `Oi! Recebemos sua mensagem. 😊 Nosso horário de atendimento é ${workingHours}.\n\nPra eu agilizar seu atendimento assim que abrirmos: você prefere *manhã*, *tarde* ou *noite*?`
}

export function buildAfterHoursFollowUp(payload) {
    const instance = safe(payload?.instance) || 'nossa equipe'
    return `Oi! Já estamos no horário de atendimento da ${instance}. Quer agendar sua avaliação? Prefere *manhã*, *tarde* ou *noite*?`
}

export function buildOptOutConfirmation() {
    return 'Combinado! ✅ A partir de agora, não enviaremos mais mensagens automáticas por aqui. Se você quiser voltar a falar com a gente, é só mandar uma mensagem. 😊'
}

export function buildHandoffCustomerMessage() {
    return 'Entendi. Vou chamar uma consultora humana para te atender e já retorno por aqui. 🙏'
}

export function buildInternalNotifyText({ payload, unitSlug, procedureCode, handoffReason }) {
    const attendant = safe(payload?.attendant) || 'Consultora'
    const name = safe(payload?.contact?.name) || 'Sem nome'
    const phone = safe(payload?.contact?.phone?.raw) || 'Sem telefone'
    const text = safe(payload?.message?.text) || safe(payload?.message_info?.text) || ''
    const tags = Array.isArray(payload?.campaign?.detectedTags) ? payload.campaign.detectedTags.join(', ') : ''
    const origin = payload?.origin?.leadSpeedClass ? `leadSpeed=${payload.origin.leadSpeedClass}` : ''

    const parts = [
        `*Harmonia* — novo atendimento`,
        `Unidade: _${unitSlug}_ | Consultora: *${attendant}*`,
        `Contato: *${name}* (${phone})`,
        procedureCode ? `Procedimento: *${procedureCode}*` : (tags ? `Tags: ${tags}` : null),
        origin || null,
        handoffReason ? `Motivo handoff: ${handoffReason}` : null,
        text ? `Mensagem: "${text}"` : null,
        'CRM: buscar pelo telefone e assumir atendimento.',
    ].filter(Boolean)

    return parts.join('\n')
}
