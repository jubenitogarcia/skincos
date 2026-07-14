import { detectHandoffRisk, detectOptOut } from './detect.js'
import {
    buildAfterHoursMessage,
    buildAfterHoursFollowUp,
    buildCta,
    buildGreeting,
    buildHandoffCustomerMessage,
    buildInternalNotifyText,
    buildOptOutConfirmation,
    buildQualificationQuestion,
} from './templates.js'
import { isWithinWorkingHours } from '../util/workingHours.js'

function onlyDigits(s) {
    return String(s || '').replace(/\D+/g, '')
}

function pickFirstTag(detectedTags) {
    const tags = Array.isArray(detectedTags) ? detectedTags.map((t) => String(t || '').trim()).filter(Boolean) : []
    return tags[0] || null
}

function mapTagToProcedureCode(tag, tagMap) {
    const t = String(tag || '').trim()
    if (!t) return null
    if (tagMap && typeof tagMap === 'object') {
        const v = tagMap[t] || tagMap[t.toLowerCase()]
        if (v) return String(v).trim()
    }
    return t
}

function buildClassifierText(payload) {
    const adTitle = payload?.ad?.title ? String(payload.ad.title).trim() : ''
    const adBody = payload?.ad?.body ? String(payload.ad.body).trim() : ''
    const msgText = payload?.message?.text
        ? String(payload.message.text).trim()
        : (payload?.message_info?.text ? String(payload.message_info.text).trim() : '')
    const tags = Array.isArray(payload?.campaign?.detectedTags) ? payload.campaign.detectedTags.join(', ') : ''

    return [
        adTitle ? `Título anúncio: ${adTitle}` : null,
        adBody ? `Descrição anúncio: ${adBody}` : null,
        tags ? `Tags: ${tags}` : null,
        msgText ? `Mensagem: ${msgText}` : null,
    ].filter(Boolean).join('\n')
}

function mkSend(payload, text) {
    const instance = String(payload?.instance || '').trim()
    const to = String(payload?.contact?.phone?.raw || '').trim() || onlyDigits(payload?.contact?.waJid)
    return {
        type: 'send_message',
        channel: 'customer',
        instance,
        to,
        text,
    }
}

function mkWait(seconds) {
    return { type: 'wait', seconds }
}

function mkNotify(unitSlug, text) {
    return { type: 'notify_internal', unitSlug, text }
}

function randomWaitSeconds() {
    return Math.floor(Math.random() * (6 - 2 + 1)) + 2
}

export async function decideHarmoniaActions({
    envelope,
    payload,
    unit,
    contact,
    conversation,
    outboundCount,
    providers,
    config,
    now,
}) {
    const unitSlug = String(payload?.unitSlug || '').trim() || String(unit?.slug || '').trim()
    const shouldProcess = Boolean(payload?.processing?.should_process)
    if (!shouldProcess) {
        return {
            decision: { shouldProcess: false, reason: 'should_process=false', handoff: { needed: false, why: null } },
            conversationPatch: { last_inbound_at: new Date().toISOString() },
            actions: [],
            tasks: [],
        }
    }

    const inboundText = String(payload?.message?.text || payload?.message_info?.text || '').trim()

    if (contact?.opted_out_at) {
        return {
            decision: { shouldProcess: true, reason: 'opted_out', handoff: { needed: false, why: null } },
            conversationPatch: { last_inbound_at: new Date().toISOString() },
            actions: [],
            tasks: [],
        }
    }

    if (detectOptOut(inboundText)) {
        const actions = [mkSend(payload, buildOptOutConfirmation())]
        return {
            decision: { shouldProcess: true, reason: 'opt_out_detected', handoff: { needed: false, why: null } },
            optOut: true,
            conversationPatch: {
                stage: 'closed',
                last_inbound_at: new Date().toISOString(),
                last_outbound_at: new Date().toISOString(),
            },
            actions,
            tasks: [],
        }
    }

    // Risk-based handoff should override after-hours and rate limits.
    const risk = detectHandoffRisk(inboundText)
    if (risk) {
        const actions = [
            mkSend(payload, buildHandoffCustomerMessage()),
            mkNotify(unitSlug, buildInternalNotifyText({
                payload,
                unitSlug,
                procedureCode: conversation?.procedure_code || null,
                handoffReason: risk,
            })),
        ]
        return {
            decision: { shouldProcess: true, reason: null, handoff: { needed: true, why: risk } },
            conversationPatch: {
                stage: 'handoff_pending',
                last_inbound_at: new Date().toISOString(),
                last_outbound_at: new Date().toISOString(),
            },
            actions,
            tasks: [],
        }
    }

    const rateLimitSeconds = Number(config?.rateLimitSeconds || 0)
    const lastOutboundAt = conversation?.last_outbound_at ? Date.parse(String(conversation.last_outbound_at)) : null
    const nowMs = (() => {
        if (now) {
            const parsed = Date.parse(String(now))
            if (Number.isFinite(parsed)) return parsed
        }
        return Date.now()
    })()
    if (rateLimitSeconds > 0 && Number.isFinite(lastOutboundAt)) {
        const elapsed = nowMs - lastOutboundAt
        if (elapsed >= 0 && elapsed < rateLimitSeconds * 1000) {
            return {
                decision: { shouldProcess: true, reason: 'rate_limited', handoff: { needed: false, why: null } },
                conversationPatch: { last_inbound_at: new Date().toISOString() },
                actions: [],
                tasks: [],
            }
        }
    }

    const wh = isWithinWorkingHours({
        workingHours: unit?.working_hours,
        timezone: unit?.timezone || 'America/Sao_Paulo',
        now: now || (envelope?.receivedAt ? envelope.receivedAt : undefined),
    })

    if (!wh.open) {
        const actions = [mkSend(payload, buildAfterHoursMessage(payload))]
        const tasks = wh.nextOpenAt
            ? [{
                type: 'FOLLOW_UP',
                runAt: wh.nextOpenAt,
                payload: {
                    unitSlug,
                    phoneRaw: String(payload?.contact?.phone?.raw || ''),
                    text: buildAfterHoursFollowUp(payload),
                    lastInboundText: inboundText || null,
                },
            }]
            : []

        return {
            decision: { shouldProcess: true, reason: 'after_hours', handoff: { needed: false, why: null } },
            conversationPatch: {
                stage: 'after_hours_wait',
                last_inbound_at: new Date().toISOString(),
                last_outbound_at: new Date().toISOString(),
            },
            actions,
            tasks,
        }
    }

    const tag = pickFirstTag(payload?.campaign?.detectedTags)
    let procedureCode = conversation?.procedure_code ? String(conversation.procedure_code).trim() : null
    let confidence = conversation?.procedure_confidence != null ? Number(conversation.procedure_confidence) : 0

    if (!procedureCode && tag) {
        procedureCode = mapTagToProcedureCode(tag, config?.tagMap)
        confidence = 0.9
    }

    if (!procedureCode) {
        const classifierText = buildClassifierText(payload)
        const classified = await providers?.openai?.classify({ text: classifierText })
        if (classified?.procedureCode) {
            procedureCode = String(classified.procedureCode).trim()
            confidence = Number.isFinite(classified.confidence) ? classified.confidence : 0
        }
    }

    const confident = procedureCode && confidence >= 0.6
    const hasInSheet = procedureCode ? await providers?.sheets?.hasProcedureCode(procedureCode) : false

    if (!confident || !procedureCode || !hasInSheet) {
        const ask = 'Qual procedimento você tem interesse? Ex.: Botox, Lavieen, Sculptra…'
        return {
            decision: { shouldProcess: true, reason: 'procedure_uncertain', handoff: { needed: false, why: null } },
            conversationPatch: {
                stage: 'awaiting_reply',
                last_inbound_at: new Date().toISOString(),
                last_outbound_at: new Date().toISOString(),
            },
            actions: [mkSend(payload, ask)],
            tasks: [],
        }
    }

    const sheet = await providers?.sheets?.getMessagesByProcedureCode(procedureCode)
    const messages = Array.isArray(sheet?.messages) ? sheet.messages : []
    if (!messages.length) {
        const ask = 'Qual procedimento você tem interesse? Ex.: Botox, Lavieen, Sculptra…'
        return {
            decision: { shouldProcess: true, reason: 'procedure_no_messages', handoff: { needed: false, why: null } },
            conversationPatch: {
                stage: 'awaiting_reply',
                last_inbound_at: new Date().toISOString(),
                last_outbound_at: new Date().toISOString(),
            },
            actions: [mkSend(payload, ask)],
            tasks: [],
        }
    }

    const hadProcedure = Boolean(conversation?.procedure_code)
    const sendGreeting = Number(outboundCount || 0) === 0
    const shouldSendScriptNow = !hadProcedure

    const actions = []
    if (shouldSendScriptNow) {
        if (sendGreeting) actions.push(mkSend(payload, buildGreeting(payload)))
        for (let i = 0; i < messages.length; i++) {
            actions.push(mkSend(payload, messages[i]))
            if (i < messages.length - 1) actions.push(mkWait(randomWaitSeconds()))
        }
        actions.push(mkSend(payload, buildCta(payload)))
        actions.push(mkSend(payload, buildQualificationQuestion()))
    } else {
        actions.push(mkSend(payload, buildCta(payload)))
        actions.push(mkSend(payload, buildQualificationQuestion()))
    }

    return {
        decision: { shouldProcess: true, reason: null, handoff: { needed: false, why: null } },
        conversationPatch: {
            stage: 'awaiting_reply',
            last_inbound_at: new Date().toISOString(),
            last_outbound_at: new Date().toISOString(),
            procedure_code: procedureCode,
            procedure_confidence: confidence,
            lead_speed_class: conversation?.lead_speed_class || payload?.origin?.leadSpeedClass || null,
        },
        actions,
        tasks: [],
    }
}
