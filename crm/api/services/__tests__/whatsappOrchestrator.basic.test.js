import assert from 'node:assert/strict'
import test from 'node:test'
import { whatsappOrchestrator } from '../whatsappOrchestrator.js'

test('WhatsApp compatibility adapter maps channels to native engine ports', () => {
  assert.equal(whatsappOrchestrator.channelToPort(1), 3001)
  assert.equal(whatsappOrchestrator.channelToPort(9), 3009)
  assert.equal(whatsappOrchestrator.getAllChannels().length, 9)
  assert.equal(whatsappOrchestrator.getAllPorts().length, 9)
})

test('WhatsApp compatibility adapter rejects channels outside the engine range', () => {
  assert.throws(() => whatsappOrchestrator.channelToPort(0), /INVALID_WHATSAPP_CHANNEL/)
  assert.throws(() => whatsappOrchestrator.channelToPort(3010), /INVALID_WHATSAPP_CHANNEL/)
})
