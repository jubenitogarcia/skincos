import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLocalWhatsAppUrl, whatsappOrchestrator } from '../whatsappOrchestrator.js'

test('whatsappOrchestrator maps channels to ports', () => {
    assert.equal(whatsappOrchestrator.channelToPort(1), 3001)
    assert.equal(whatsappOrchestrator.channelToPort(9), 3009)
})

test('whatsappOrchestrator returns all channels and ports arrays', () => {
    assert.equal(whatsappOrchestrator.getAllChannels().length, 9)
    assert.equal(whatsappOrchestrator.getAllPorts().length, 9)
})

test('whatsappOrchestrator only builds local allowlisted upstream URLs', () => {
    assert.equal(buildLocalWhatsAppUrl(3001, '/api/status'), 'http://localhost:3001/api/status')
    assert.equal(buildLocalWhatsAppUrl(3009, '/api/qr'), 'http://localhost:3009/api/qr')
    assert.throws(() => buildLocalWhatsAppUrl(22, '/api/status'), /INVALID_WHATSAPP_LOCAL_PORT/)
    assert.throws(() => buildLocalWhatsAppUrl(3001, '/api/status?next=https://attacker.invalid'), /INVALID_WHATSAPP_LOCAL_PATH/)
})
