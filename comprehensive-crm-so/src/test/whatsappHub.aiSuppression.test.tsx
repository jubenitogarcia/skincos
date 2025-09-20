import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { WhatsAppBusinessHub } from '@/components/WhatsAppBusinessHub'

// Minimal IntegrationsContext mock provider
vi.mock('@/contexts/IntegrationsContext', () => {
    return {
        useIntegrations: () => ({
            whatsapp: { connected: true, baseUrl: 'http://localhost:3100/wa/3001' },
            connectWhatsApp: vi.fn(),
            disconnectWhatsApp: vi.fn(),
            syncWhatsApp: vi.fn()
        })
    }
})

// Mock adapter to avoid network
vi.mock('@/services/whatsappGatewayAdapter', () => ({
    startSessionAuto: vi.fn(async () => ({ state: 'CONNECTED' })),
    getSessionAuto: vi.fn(async () => ({ state: 'CONNECTED' })),
    detectEndpoints: vi.fn(async () => ({})),
    fetchChatsAuto: vi.fn(async () => []),
    fetchMessagesAuto: vi.fn(async () => []),
    openEventsStreamAuto: vi.fn(() => ({ close: vi.fn() }))
}))

// Mock WA integration calls
vi.mock('@/services/whatsappIntegration', () => ({
    sendWhatsAppMessage: vi.fn(async () => ({})),
    mapWhatsAppMessageToLead: vi.fn(() => ({})),
    sendWhatsAppAttachments: vi.fn(async () => ({})),
    detectWhatsAppMediaType: vi.fn(() => 'document'),
    sendWhatsAppContact: vi.fn(async () => ({})),
    sendWhatsAppPoll: vi.fn(async () => ({})),
    forwardWhatsAppMessage: vi.fn(async () => ({})),
    pinWhatsAppMessage: vi.fn(async () => ({})),
    unpinWhatsAppMessage: vi.fn(async () => ({})),
    deleteWhatsAppMessage: vi.fn(async () => ({})),
    bulkForwardWhatsAppMessages: vi.fn(async () => ({})),
    bulkDeleteWhatsAppMessages: vi.fn(async () => ({})),
    archiveWhatsAppChat: vi.fn(async () => ({})),
    unarchiveWhatsAppChat: vi.fn(async () => ({})),
    muteWhatsAppChat: vi.fn(async () => ({})),
    unmuteWhatsAppChat: vi.fn(async () => ({})),
    pinWhatsAppChat: vi.fn(async () => ({})),
    unpinWhatsAppChat: vi.fn(async () => ({})),
    markChatSeen: vi.fn(async () => ({})),
    searchWhatsAppMessages: vi.fn(async () => ({ messages: [] }))
}))

// Mock fetch for suppression endpoints and status
const fetchMock = vi.fn()

describe('WhatsAppBusinessHub - AI suppression live updates', () => {
    const realFetch = globalThis.fetch as any
    const realEventSource = window.EventSource as any

    class ESStub {
        onmessage: ((this: EventSource, ev: MessageEvent) => any) | null = null
        constructor(url: string) {
            const arr = (window as any).__esInstances || []
            arr.push(this)
                ; (window as any).__esInstances = arr
        }
        emit(data: any) { (this.onmessage as any)?.call(this as any, { data: JSON.stringify(data) } as any) }
        close() { }
    }

    beforeEach(() => {
        ; (window as any).__esInstances = []
        Object.defineProperty(window, 'EventSource', { value: ESStub, configurable: true })
        fetchMock.mockImplementation(async (url: string) => {
            if (url.includes('/ai-status')) {
                return { ok: true, json: async () => ({ suppressed: false }) } as any
            }
            if (url.includes('/human-intervention') && url.endsWith('POST')) {
                return { ok: true, json: async () => ({ suppressedUntil: new Date(Date.now() + 3600_000).toISOString() }) } as any
            }
            return { ok: true, json: async () => ({}) } as any
        })
        // @ts-ignore
        global.fetch = fetchMock
    })

    afterEach(() => {
        // @ts-ignore
        global.fetch = realFetch
        Object.defineProperty(window, 'EventSource', { value: realEventSource, configurable: true })
        fetchMock.mockReset()
    })

    it('shows AI badge and updates suppression from SSE snapshot', async () => {
        render(<WhatsAppBusinessHub />)

        // select first contact
        const contato = await screen.findByText('João Silva')
        fireEvent.click(contato)

        // badge initially should show IA badge (by title)
        const badge = await screen.findByTitle('Modo da IA')
        expect(badge.textContent).toMatch(/IA/i)

        // emit snapshot from SSE on the latest instance (after selection triggers re-subscribe)
        await waitFor(() => {
            const len = ((window as any).__esInstances || []).length
            // initial subscribe + re-subscribe after selecting a contact
            expect(len).toBeGreaterThanOrEqual(2)
        })
        const arr = (window as any).__esInstances
        const es = arr[arr.length - 1]
        es.emit({ type: 'snapshot', suppressions: { contact_1: new Date(Date.now() + 3600_000).toISOString() } })

        await waitFor(() => {
            const paused = screen.getByText(/IA\s+Pausada/i)
            expect(paused).toBeTruthy()
        })
    })
})
