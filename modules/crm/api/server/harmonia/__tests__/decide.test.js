import test from 'node:test'
import assert from 'node:assert/strict'
import { decideHarmoniaActions } from '../engine/decide.js'

function mkBasePayload(overrides = {}) {
    return {
        instance: 'Espaço Facial - Novo Hamburgo',
        unitSlug: 'novo_hamburgo',
        attendant: 'Evelin',
        CTA: 'hoje',
        workingHours: '08:30 às 20:30 (seg-sex) e 09:00 às 20:00 (sáb)',
        processing: { should_process: true },
        contact: { name: 'Ana', phone: { raw: '5551999999999' }, waJid: '5551999999999@s.whatsapp.net' },
        message: { id: 'm1', text: 'Olá' },
        message_info: { message_id: 'm1' },
        origin: { leadSpeedClass: 'hot' },
        campaign: { detectedTags: [] },
        ad: { title: 'Promo', body: 'Botox' },
        ...overrides,
    }
}

const unitOpen = {
    slug: 'novo_hamburgo',
    timezone: 'America/Sao_Paulo',
    working_hours: {
        mon: [{ start: '00:00', end: '23:59' }],
        tue: [{ start: '00:00', end: '23:59' }],
        wed: [{ start: '00:00', end: '23:59' }],
        thu: [{ start: '00:00', end: '23:59' }],
        fri: [{ start: '00:00', end: '23:59' }],
        sat: [{ start: '00:00', end: '23:59' }],
        sun: [{ start: '00:00', end: '23:59' }],
    },
}

test('decide: should_process=false returns no actions', async () => {
    const payload = mkBasePayload({ processing: { should_process: false } })
    const out = await decideHarmoniaActions({
        envelope: {},
        payload,
        unit: unitOpen,
        contact: {},
        conversation: { stage: 'new' },
        outboundCount: 0,
        providers: {},
        config: {},
    })
    assert.equal(out.actions.length, 0)
    assert.equal(out.decision.shouldProcess, false)
})

test('decide: opt-out triggers confirmation and closes', async () => {
    const payload = mkBasePayload({ message: { id: 'm1', text: 'STOP' } })
    const out = await decideHarmoniaActions({
        envelope: {},
        payload,
        unit: unitOpen,
        contact: {},
        conversation: { stage: 'new' },
        outboundCount: 0,
        providers: {},
        config: {},
    })
    assert.equal(out.optOut, true)
    assert.equal(out.conversationPatch.stage, 'closed')
    assert.equal(out.actions[0].type, 'send_message')
})

test('decide: risk handoff triggers notify_internal even if unit closed', async () => {
    const payload = mkBasePayload({ message: { id: 'm1', text: 'Estou com dor forte' } })
    const unitClosed = { ...unitOpen, working_hours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } }
    const out = await decideHarmoniaActions({
        envelope: {},
        payload,
        unit: unitClosed,
        contact: {},
        conversation: { stage: 'new' },
        outboundCount: 0,
        providers: { sheets: { async hasProcedureCode() { return false } }, openai: { async classify() { return null } } },
        config: {},
    })
    assert.equal(out.conversationPatch.stage, 'handoff_pending')
    assert.ok(out.actions.some((a) => a.type === 'notify_internal'))
})

test('decide: tag->procedure uses sheets and sends script when no previous procedure', async () => {
    const payload = mkBasePayload({ campaign: { detectedTags: ['Botox'] }, message: { id: 'm1', text: 'quero saber' } })
    const providers = {
        sheets: {
            async hasProcedureCode(code) { return code === 'Botox' },
            async getMessagesByProcedureCode(code) {
                if (code !== 'Botox') return null
                return { procedureCode: 'Botox', messages: ['Msg 1', 'Msg 2'] }
            },
        },
        openai: { async classify() { return null } },
    }
    const out = await decideHarmoniaActions({
        envelope: {},
        payload,
        unit: unitOpen,
        contact: {},
        conversation: { stage: 'awaiting_reply', procedure_code: null },
        outboundCount: 1,
        providers,
        config: {},
    })
    assert.ok(out.actions.find((a) => a.type === 'send_message' && String(a.text).includes('Msg 1')))
    assert.ok(out.actions.find((a) => a.type === 'send_message' && String(a.text).includes('Vamos agendar')))
})

test('decide: rate limit suppresses messages (except opt-out/handoff)', async () => {
    const payload = mkBasePayload({ message: { id: 'm1', text: 'Oi' } })
    const now = new Date().toISOString()
    const out = await decideHarmoniaActions({
        envelope: { receivedAt: now },
        payload,
        unit: unitOpen,
        contact: {},
        conversation: { stage: 'awaiting_reply', last_outbound_at: new Date().toISOString() },
        outboundCount: 1,
        providers: { sheets: { async hasProcedureCode() { return false } }, openai: { async classify() { return null } } },
        config: { rateLimitSeconds: 60 },
    })
    assert.equal(out.actions.length, 0)
    assert.equal(out.decision.reason, 'rate_limited')
})
