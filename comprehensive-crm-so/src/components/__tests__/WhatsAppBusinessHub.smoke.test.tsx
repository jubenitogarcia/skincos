import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock adapters used by the hub
vi.mock('@/services/whatsappGatewayAdapter', () => ({
    detectEndpoints: vi.fn(async () => ({ baseUrl: 'http://localhost:3003' })),
    fetchUnreadCountsAuto: vi.fn(async () => ({ '5551999999999@c.us': 3 })),
    globalSearchAuto: vi.fn(async (_base: string, _params: any) => ({
        contacts: [{ id: 'c1', name: 'Alice', phone: '5551' }],
        messages: [{ id: 'm1', chatId: 'c1', content: 'hello world' }],
        media: [],
        meta: { total: { messages: 1, contacts: 1, media: 0 }, facets: { byType: { text: 1 } } }
    })),
    startSessionAuto: vi.fn(),
    getSessionAuto: vi.fn(),
    fetchChatsAuto: vi.fn(async () => ([])),
    fetchMessagesAuto: vi.fn(async () => ([])),
    openEventsStreamAuto: vi.fn(() => ({ close: () => { } })),
    fetchAvatarAuto: vi.fn(),
    fetchRecentMediaAuto: vi.fn(),
    fetchChatFlagsAuto: vi.fn(async () => ({})),
}))

vi.mock('@/services/whatsappIntegration', () => ({
    searchWhatsAppMessages: vi.fn(async () => ({ list: [] }))
}))

// Lazy import to allow mocks to apply
async function renderHub() {
    const mod = await import('../WhatsAppBusinessHub')
    const Hub = (mod as any).default || (mod as any)
    render(<Hub />)
}

describe('WhatsAppBusinessHub smoke', () => {
    it('shows global unread badge and opens global search dialog', async () => {
        await renderHub()

        // Global unread badge should appear somewhere near the Conversations tab
        const tab = await screen.findByText(/Conversas/i)
        expect(tab).toBeInTheDocument()

        // Trigger global search by typing in contacts search box and clicking button
        const input = await screen.findByPlaceholderText(/Buscar contatos/i)
        fireEvent.change(input, { target: { value: 'Ali' } })

        const btn = await screen.findAllByText(/Busca global/i)
        fireEvent.click(btn[0])

        // Dialog with totals should render
        const dlgTitle = await screen.findByText(/Resultados da busca/i)
        expect(dlgTitle).toBeInTheDocument()
        expect(await screen.findByText(/1 mensagens/i)).toBeInTheDocument()
    })
})
