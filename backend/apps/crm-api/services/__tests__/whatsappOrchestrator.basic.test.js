import test from 'node:test'
import assert from 'node:assert/strict'
import { whatsappOrchestrator } from '../whatsappOrchestrator.js'

test('whatsappOrchestrator maps channels to ports', () => {
    assert.equal(whatsappOrchestrator.channelToPort(1), 3001)
    assert.equal(whatsappOrchestrator.channelToPort(9), 3009)
})

test('whatsappOrchestrator returns all channels and ports arrays', () => {
    assert.equal(whatsappOrchestrator.getAllChannels().length, 9)
    assert.equal(whatsappOrchestrator.getAllPorts().length, 9)
})
