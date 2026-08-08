import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
    COMMERCIAL_ASSISTED_CONFIRMATION,
    COMMERCIAL_ASSISTED_REVEAL_CONFIRMATION,
    COMMERCIAL_ASSISTED_SAFETY_FLAGS,
    actorReference,
    assertNoDirectPii,
    confirmationRequired,
    maskPhone,
    normalizeTemplatePayload,
    offerContext,
    renderMaskedPreview,
    revealConfirmationRequired,
    stableAssistedFingerprint,
    templateContext,
    verifyRawWebhookSignature,
} from '../commercialAssistedCommunication.js'

const secret = () => randomBytes(32).toString('base64url')
const offerId = '11111111-1111-4111-8111-111111111111'
const templateId = '22222222-2222-4222-8222-222222222222'
const attemptId = '33333333-3333-4333-8333-333333333333'

test('canonical offer and template evidence is stable, revision-bound and PII-free', () => {
    const first = offerContext({
        id: offerId, offer_key: 'toxina-fixture', revision: '4', unit_slug: 'centro', title: 'Oferta sint?tica',
        description: 'Condi??es aprovadas', price_cents: 12500, currency: 'BRL', price_qualifier: 'a partir de',
        conditions: 'Somente contexto comercial aprovado', validity_start: '2026-08-01', validity_end: '2026-08-31',
        procedures: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Procedimento sint?tico', quantity: 1, quantity_unit: 'sess?o' }],
    })
    const second = offerContext({
        title: 'Oferta sint?tica', conditions: 'Somente contexto comercial aprovado', validity_end: '2026-08-31',
        validity_start: '2026-08-01', price_qualifier: 'a partir de', currency: 'BRL', price_cents: 12500,
        description: 'Condi??es aprovadas', unit_slug: 'centro', revision: 4, offer_key: 'toxina-fixture', id: offerId,
        procedures: [{ quantity_unit: 'sess?o', quantity: 1, name: 'Procedimento sint?tico', id: '44444444-4444-4444-8444-444444444444' }],
    })
    const template = templateContext({ id: templateId, template_key: 'oferta-fixture', revision: '3', unit_slug: 'centro', body_template: 'Ol?, {{cliente}}. {{oferta}}: {{preco}}.', valid_from: '2026-08-01', valid_until: '2026-08-31' })

    assert.equal(first.contextHash, second.contextHash)
    assert.match(first.contextHash, /^[a-f0-9]{64}$/)
    assert.equal(first.context.revision, 4)
    assert.equal(template.context.revision, 3)
    assert.match(template.contextHash, /^[a-f0-9]{64}$/)
    assert.equal(stableAssistedFingerprint({ b: ['safe', 2], a: { z: false, y: null } }), stableAssistedFingerprint({ a: { y: null, z: false }, b: ['safe', 2] }))
})

test('nested PII and legacy actor fields are rejected before hashes or ledgers are produced', () => {
    const key = secret()
    assert.throws(() => assertNoDirectPii({ safe: { nested: { email: 'fixture@example.invalid' } } }), /COMMERCIAL_ASSISTED_PII_REJECTED/)
    assert.throws(() => normalizeTemplatePayload({ templateKey: 'fixture-template', bodyTemplate: 'Texto aprovado', unit: 'centro', reason: 'Contato 000000000000' }), /COMMERCIAL_ASSISTED_TEMPLATE_PII_REJECTED/)
    assert.throws(() => actorReference(key, { subject: 'legacy-subject', id: 'ignored' }), /ACTOR_IDENTITY_REQUIRED/)
    assert.match(actorReference(key, { actorSubject: 'crm:gestor-fixture', id: 'ignored' }), /^actor:[a-f0-9]{64}$/)
})

test('preview presentation stays masked and confirmation tokens remain literal', () => {
    const phone = '000000000000'
    const masked = maskPhone(phone)
    assert.equal(masked.includes(phone), false)
    assert.match(masked, /0000$/)
    assert.equal(confirmationRequired(COMMERCIAL_ASSISTED_CONFIRMATION), true)
    assert.equal(revealConfirmationRequired(COMMERCIAL_ASSISTED_REVEAL_CONFIRMATION), true)
    assert.throws(() => confirmationRequired('confirmar'), /COMMERCIAL_ASSISTED_HUMAN_CONFIRMATION_REQUIRED/)
    assert.throws(() => revealConfirmationRequired('revelar'), /COMMERCIAL_ASSISTED_REVEAL_CONFIRMATION_REQUIRED/)
    assert.equal(renderMaskedPreview({ bodyTemplate: '{{cliente}} {{oferta}} {{preco}} {{condicoes}}' }, { title: 'Oferta sint?tica', priceCents: 1000, currency: 'BRL', conditions: 'Aprovada' }).includes(phone), false)
})

test('raw webhook HMAC binds the exact body and timestamp and rejects replay substitution', () => {
    const key = secret()
    const timestamp = String(Date.now())
    const raw = Buffer.from(JSON.stringify({ eventId: 'fixture-event-0001', attemptId, eventType: 'stop', occurredAt: '2026-08-07T12:00:00.000Z' }), 'utf8')
    const signature = createHmac('sha256', key).update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), raw])).digest('base64url')
    assert.equal(verifyRawWebhookSignature({ rawBody: raw, timestamp, signature, secret: key }), true)
    assert.equal(verifyRawWebhookSignature({ rawBody: Buffer.from(raw.toString('utf8').replace('stop', 'read')), timestamp, signature, secret: key }), false)
    assert.equal(verifyRawWebhookSignature({ rawBody: raw, timestamp: String(Number(timestamp) - 600_001), signature, secret: key, now: Number(timestamp) }), false)
})

test('the inaccessible domain contains no provider SDK, click URI or activation flag', async () => {
    const file = await readFile(fileURLToPath(new URL('../commercialAssistedCommunication.js', import.meta.url)), 'utf8')
    assert.deepEqual(COMMERCIAL_ASSISTED_SAFETY_FLAGS, {
        providerSend: false,
        automationEnabled: false,
        bulkDispatchEnabled: false,
        commercialContactWritesEnabled: false,
        externalDispatch: false,
    })
    assert.doesNotMatch(file, /wa[.]me|providerSend:\s*true|automationEnabled:\s*true|bulkDispatchEnabled:\s*true|externalDispatch:\s*true|\bfetch\s*\(/i)
})
