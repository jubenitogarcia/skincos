import { describe, it, expect } from 'vitest'
import { whatsappOrchestrator } from '../whatsappOrchestrator.js'

describe('whatsappOrchestrator basic', () => {
    it('maps channels to ports', () => {
        expect(whatsappOrchestrator.channelToPort(1)).toBe(3001)
        expect(whatsappOrchestrator.channelToPort(9)).toBe(3009)
    })

    it('returns all channels/ports arrays', () => {
        expect(whatsappOrchestrator.getAllChannels()).toHaveLength(9)
        expect(whatsappOrchestrator.getAllPorts()).toHaveLength(9)
    })
})
