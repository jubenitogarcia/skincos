import React, { useEffect, useState, useRef, useCallback } from 'react'
import { detectWhatsAppMediaType, sendWhatsAppMessage, sendWhatsAppAttachments, LocalAttachment } from '../services/whatsappIntegration'
import { performAction } from '../lib/actionsRegistry'
import { QRModal } from './QRModal'
import WhatsAppDashboard from './WhatsAppDashboard'

interface GatewayStatus {
    ready?: boolean
    status?: string
    message?: string
    qrRequired?: boolean
    agentZeroDirect?: boolean
}

interface QrResponse { success?: boolean; qr?: string }

const ENV = (import.meta as any).env || {}
const PORT_LIST = (ENV.VITE_WHATSAPP_GATEWAY_PORTS as string | undefined)?.split(',').map(p => p.trim()).filter(Boolean) || []
// 🚀 CORRIGIDO: Usar porta 3001 do WhatsApp Unified System como padrão
const SINGLE_BASE = ENV?.VITE_WHATSAPP_GATEWAY_URL || '3001'
const GATEWAY_PORTS = PORT_LIST.length > 0 ? PORT_LIST : [SINGLE_BASE.includes('://') ? SINGLE_BASE : SINGLE_BASE.replace(/\/$/, '')]
function buildBase(portOrUrl: string) {
    if (/^https?:\/\//.test(portOrUrl)) return portOrUrl.replace(/\/$/, '')
    // 🚀 CORRIGIDO: Se é um número de porta, construir URL completa para WhatsApp System
    if (/^\d+$/.test(portOrUrl)) {
        return `${window.location.protocol}//${window.location.hostname}:${portOrUrl}`
    }
    // Para outros casos, assumir que é uma URL ou path
    return portOrUrl.startsWith('/') ? portOrUrl : `${window.location.protocol}//${window.location.hostname}:${portOrUrl}`
}

export const WhatsAppPanel: React.FC = () => {
    const [status, setStatus] = useState<GatewayStatus | null>(null)
    const [qr, setQr] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [connected, setConnected] = useState(false)
    const [showQRModal, setShowQRModal] = useState(false)
    const [showDashboard, setShowDashboard] = useState(false)
    const firstLoad = useRef(true)
    const [toNumber, setToNumber] = useState('')
    const [message, setMessage] = useState('')
    const [sending, setSending] = useState(false)
    const [attachments, setAttachments] = useState<LocalAttachment[]>([])
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const [aiSuppressed, setAiSuppressed] = useState<{ active: boolean, resumeAt?: string }>({ active: false })
    const [metrics, setMetrics] = useState<{ totalSuppressions?: number, totalResumes?: number, activeSuppressions?: number }>({})
    const [eventsLog, setEventsLog] = useState<{ ts: number, type: string, conversationId?: string }[]>([])
    const [conversationList, setConversationList] = useState<any[]>([])
    const [conversationSearch, setConversationSearch] = useState('')
    const [showArchived, setShowArchived] = useState(false)
    const [messages, setMessages] = useState<any[]>([])
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [messagesHasMore, setMessagesHasMore] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const earliestMessageTsRef = useRef<string | null>(null)
    const [uploadProgress, setUploadProgress] = useState<Record<string, { progress: number, error?: string }>>({})
    const [isTyping, setIsTyping] = useState(false)
    const typingTimer = useRef<any>(null)
    const [activeInstance, setActiveInstance] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('wa_active_instance')
            if (saved) return saved
        }
        return GATEWAY_PORTS[0]
    })
    // Agent Zero Direct toggle state
    const [agzDirect, setAgzDirect] = useState<boolean | null>(null)
    const [agzEnvEnabled, setAgzEnvEnabled] = useState<boolean | null>(null)
    const [agzToggling, setAgzToggling] = useState(false)

    const GATEWAY_BASE = buildBase(activeInstance)

    const onboarded = typeof window !== 'undefined' ? localStorage.getItem('whatsapp_onboarded') === '1' : false

    async function triggerHumanIntervention() {
        if (!toNumber) { alert('Informe um número destino (conversa) antes.'); return }
        try {
            const convId = toNumber // usando número como id simplificado
            const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}/human-intervention`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            if (!res.ok) throw new Error('Falha na intervenção')
            const data = await res.json()
            setAiSuppressed({ active: true, resumeAt: data.suppressedUntil })
            alert('IA silenciada por 24h para esta conversa.')
        } catch (e: any) { alert(e.message) }
    }

    // Poll suppression status every 60s when we have a conversation target
    useEffect(() => {
        let iv: any
        async function poll() {
            if (!toNumber) return
            try {
                const res = await fetch(`/api/conversations/${encodeURIComponent(toNumber)}/ai-status`)
                if (res.ok) {
                    const data = await res.json()
                    setAiSuppressed({ active: data.suppressed, resumeAt: data.resumeAt })
                }
            } catch { /* ignore */ }
        }
        poll()
        iv = setInterval(poll, 60000)
        return () => iv && clearInterval(iv)
    }, [toNumber])

    // Fetch metrics periodically
    useEffect(() => {
        let iv: any
        async function load() {
            try { const r = await fetch('/api/ai-suppression/metrics'); if (r.ok) { setMetrics(await r.json()) } } catch { }
        }
        load(); iv = setInterval(load, 30000); return () => iv && clearInterval(iv)
    }, [])

    // SSE subscription for suppression events
    useEffect(() => {
        const es = new EventSource('/api/ai-suppression/events')
        es.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data)
                if (data.type === 'suppress' || data.type === 'resume') {
                    setEventsLog(l => [{ ts: Date.now(), type: data.type, conversationId: data.conversationId }, ...l].slice(0, 50))
                    if (data.type === 'resume' && data.conversationId === toNumber) setAiSuppressed({ active: false })
                    if (data.type === 'suppress' && data.conversationId === toNumber) setAiSuppressed({ active: true, resumeAt: data.resumeAt })
                }
            } catch {/* ignore */ }
        }
        return () => es.close()
    }, [toNumber])

    async function resumeAI() {
        if (!toNumber) return
        try {
            const res = await fetch(`/api/conversations/${encodeURIComponent(toNumber)}/human-intervention`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Falha ao retomar')
            setAiSuppressed({ active: false })
        } catch (e: any) { alert(e.message) }
    }
    // SSE connection for real-time status updates
    const statusEventSourceRef = useRef<EventSource | null>(null)
    const statusPollingRef = useRef<NodeJS.Timeout | null>(null)

    async function fetchStatus() {
        try {
            const res = await fetch(`${GATEWAY_BASE}/whatsapp/1/status`)
            const data: GatewayStatus = await res.json()
            setStatus(data)
            const isConnected = data.ready || data.status === 'ready' || data.status === 'connected' || data.status === 'READY' || data.status === 'CONNECTED'
            setConnected(!!isConnected)
            
            // Close QR modal if connected
            if (isConnected && showQRModal) {
                setShowQRModal(false)
            }
            
            if (data.qrRequired === true || (!isConnected && (data.status === 'connecting' || data.status === 'QR' || data.status === 'qr'))) {
                await fetchQr()
            } else {
                setQr(null)
            }
            setError(null)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    async function fetchQr() {
        try {
            const res = await fetch(`${GATEWAY_BASE}/whatsapp/1/qr`)
            const data: QrResponse = await res.json()
            if (data.qr) setQr(data.qr)
        } catch {/* ignore */ }
    }

    // Set up SSE for real-time updates (fallback to polling)
    const setupStatusUpdates = useCallback(() => {
        // Clean up existing connections
        if (statusEventSourceRef.current) {
            statusEventSourceRef.current.close()
            statusEventSourceRef.current = null
        }
        if (statusPollingRef.current) {
            clearInterval(statusPollingRef.current)
            statusPollingRef.current = null
        }

        // Try SSE first for real-time updates
        try {
            const sseUrl = `${GATEWAY_BASE}/whatsapp/1/qr/stream`
            console.log('🔌 Connecting to WhatsApp SSE stream:', sseUrl)
            
            const eventSource = new EventSource(sseUrl)
            statusEventSourceRef.current = eventSource

            eventSource.onopen = () => {
                console.log('📡 WhatsApp status SSE connected')
                setError(null)
                setLoading(false)
            }

            // Listen for QR updates
            eventSource.addEventListener('qr', (event) => {
                try {
                    const data = JSON.parse(event.data)
                    if (data.qr) {
                        setQr(data.qr)
                        console.log('📱 QR updated via SSE')
                    }
                } catch (err) {
                    console.error('Failed to parse SSE QR data:', err)
                }
            })

            // 🚀 MELHORADO: Listen for state changes (legacy support)
            eventSource.addEventListener('state', (event) => {
                try {
                    const data = JSON.parse(event.data)
                    const newStatus = data.state
                    const isConnected = newStatus === 'ready' || newStatus === 'connected' || newStatus === 'READY' || newStatus === 'CONNECTED'
                    
                    setStatus(prev => ({ ...prev, status: newStatus, ready: isConnected }))
                    setConnected(isConnected)
                    
                    // Close QR modal if connected
                    if (isConnected && showQRModal) {
                        setShowQRModal(false)
                        console.log(`🎉 Modal QR fechado automaticamente - WhatsApp conectado!`)
                    }
                    
                    console.log(`📊 Status updated via SSE: ${newStatus}`)
                } catch (err) {
                    console.error('Failed to parse SSE state data:', err)
                }
            })

            // 🚀 NOVO: Listen for enhanced status changes from improved backend
            eventSource.addEventListener('status', (event) => {
                try {
                    const data = JSON.parse(event.data)
                    console.log(`🔥 Enhanced status change received:`, data)
                    
                    const { status: newStatus, connected: isConnected, authenticated, type } = data
                    
                    // Update status state
                    setStatus(prev => ({ 
                        ...prev, 
                        status: newStatus, 
                        ready: isConnected,
                        message: `Status: ${newStatus}${authenticated ? ' (Authenticated)' : ''}` 
                    }))
                    
                    setConnected(!!isConnected)
                    
                    // 🚀 AUTOMÁTICO: Fechar modal QR quando conectado
                    if (isConnected && showQRModal) {
                        setShowQRModal(false)
                        console.log(`🎉 Modal QR fechado automaticamente - WhatsApp conectado via enhanced SSE!`)
                    }
                    
                    // 🚀 REDIRECIONAMENTO AUTOMÁTICO: Mostrar dashboard quando conectado
                    if (isConnected && authenticated && type === 'status_change' && newStatus === 'connected') {
                        console.log(`🚀 WhatsApp totalmente conectado! Redirecionando para dashboard...`)
                        
                        // Delay pequeno para permitir que o modal feche suavemente
                        setTimeout(() => {
                            setShowDashboard(true)
                            console.log(`📱 Dashboard do WhatsApp carregado!`)
                        }, 1000)
                    }
                    
                    console.log(`🔥 Enhanced status update: ${newStatus} (Connected: ${isConnected}, Auth: ${authenticated})`)
                } catch (err) {
                    console.error('Failed to parse enhanced SSE status data:', err)
                }
            })

            // 🚀 NOVO: Listen for initial state data
            eventSource.addEventListener('initial', (event) => {
                try {
                    const data = JSON.parse(event.data)
                    console.log(`🎯 Initial state received:`, data)
                    
                    const { status: currentStatus, connected: isConnected, authenticated, qr } = data
                    
                    // Update all states with initial data
                    setStatus(prev => ({ 
                        ...prev, 
                        status: currentStatus, 
                        ready: isConnected,
                        message: `Status: ${currentStatus}${authenticated ? ' (Authenticated)' : ''}` 
                    }))
                    
                    setConnected(!!isConnected)
                    
                    if (qr) {
                        setQr(qr)
                    }
                    
                    // Se já conectado no estado inicial, mostrar dashboard diretamente
                    if (isConnected && authenticated) {
                        setShowQRModal(false)
                        setShowDashboard(true)
                        console.log(`✅ WhatsApp já conectado no estado inicial - mostrando dashboard`)
                    }
                    
                    console.log(`🎯 Initial state processed: ${currentStatus} (Connected: ${isConnected})`)
                } catch (err) {
                    console.error('Failed to parse initial state data:', err)
                }
            })

            // Listen for heartbeat pings
            eventSource.addEventListener('ping', (event) => {
                // Keep connection alive
            })

            eventSource.onerror = (err) => {
                console.warn('❌ WhatsApp status SSE error, falling back to polling:', err)
                eventSource.close()
                setupPolling()
            }

        } catch (err) {
            console.warn('❌ Failed to setup SSE, using polling:', err)
            setupPolling()
        }
    }, [GATEWAY_BASE, showQRModal])

    // Fallback polling setup
    const setupPolling = useCallback(() => {
        console.log('🔄 Setting up polling fallback for WhatsApp status')
        fetchStatus()
        statusPollingRef.current = setInterval(fetchStatus, 5000)
    }, [])

    useEffect(() => {
        setupStatusUpdates()
        
        return () => {
            if (statusEventSourceRef.current) {
                statusEventSourceRef.current.close()
            }
            if (statusPollingRef.current) {
                clearInterval(statusPollingRef.current)
            }
        }
    }, [setupStatusUpdates])

    // Fetch Agent Zero direct integration state when instance changes
    useEffect(() => {
        let aborted = false
        async function load() {
            try {
                const r = await fetch(GATEWAY_BASE + '/agent-zero/direct')
                if (!r.ok) return
                const data = await r.json()
                if (aborted) return
                setAgzDirect(!!data.enabled)
                setAgzEnvEnabled(!!data.envEnabled)
            } catch { /* ignore */ }
        }
        load()
        return () => { aborted = true }
    }, [GATEWAY_BASE])

    async function toggleAgentZeroDirect() {
        if (agzEnvEnabled === false) return
        if (agzDirect == null) return
        setAgzToggling(true)
        try {
            const r = await fetch(GATEWAY_BASE + '/agent-zero/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !agzDirect }) })
            if (r.ok) {
                const data = await r.json()
                setAgzDirect(!!data.enabled)
            } else {
                alert('Falha ao alternar Agent Zero Direct')
            }
        } catch (e: any) {
            alert('Erro toggle: ' + e.message)
        } finally { setAgzToggling(false) }
    }

    // Real-time conversations / messages via SSE (supports multiple event naming variants)
    useEffect(() => {
        const es = new EventSource('/api/conversations/events')
        es.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data)
                switch (data.type) {
                    case 'snapshot':
                        setConversationList(data.conversations || [])
                        break
                    case 'conversation-update':
                    case 'conversation-updated':
                        setConversationList(prev => {
                            const idx = prev.findIndex(c => c.conversationId === data.conversation.conversationId)
                            if (idx === -1) return [...prev, data.conversation]
                            const next = [...prev]; next[idx] = data.conversation; return next
                        })
                        break
                    case 'message':
                    case 'new-message': {
                        const m = data.message
                        if (m.conversationId === toNumber) {
                            setMessages(prev => [...prev, m])
                        }
                        // update lastMessage preview
                        setConversationList(prev => {
                            const idx = prev.findIndex(c => c.conversationId === m.conversationId)
                            if (idx === -1) return prev
                            const clone = [...prev]
                            clone[idx] = { ...clone[idx], lastMessage: m.text || m.caption || m.content, updatedAt: m.createdAt || m.timestamp || new Date().toISOString() }
                            return clone
                        })
                        break
                    }
                }
            } catch { }
        }
        return () => es.close()
    }, [toNumber])

    // Load messages (paged) when selecting a conversation
    useEffect(() => {
        if (!toNumber) { setMessages([]); return }
        let aborted = false
        async function load() {
            setLoadingMessages(true)
            try {
                const r = await fetch(`/api/conversations/${encodeURIComponent(toNumber)}/messages?limit=50`)
                if (r.ok) {
                    const data = await r.json()
                    if (!aborted) {
                        setMessages(data.items)
                        setMessagesHasMore(data.hasMore)
                        earliestMessageTsRef.current = data.items.length ? data.items[0].createdAt : null
                    }
                }
            } catch { } finally { if (!aborted) setLoadingMessages(false) }
        }
        load()
        return () => { aborted = true }
    }, [toNumber])

    function selectConversation(id: string) {
        setToNumber(id)
    }

    async function loadMoreMessages() {
        if (!toNumber || !messagesHasMore || loadingMore) return
        setLoadingMore(true)
        try {
            const before = earliestMessageTsRef.current
            const r = await fetch(`/api/conversations/${encodeURIComponent(toNumber)}/messages?limit=50&before=${encodeURIComponent(before || '')}`)
            if (r.ok) {
                const data = await r.json()
                setMessages(prev => [...data.items, ...prev])
                setMessagesHasMore(data.hasMore)
                earliestMessageTsRef.current = data.items.length ? data.items[0].createdAt : earliestMessageTsRef.current
            }
        } catch { } finally { setLoadingMore(false) }
    }

    const filteredConversations = conversationList
        .filter(c => (showArchived ? true : !c.archived))
        .filter(c => !conversationSearch || c.conversationId.toLowerCase().includes(conversationSearch.toLowerCase()) || (c.lastMessage || '').toLowerCase().includes(conversationSearch.toLowerCase()))
        .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())

    async function triggerAction(action: string, payload: any = {}) {
        if (!toNumber) { alert('Selecione uma conversa primeiro'); return }
        try {
            const res = await fetch(`/api/actions/${encodeURIComponent(action)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: toNumber, payload }) })
            if (!res.ok) throw new Error('Falha ação ' + action)
            // Refresh conversation list quickly after stateful actions
            const r = await fetch('/api/conversations?includeArchived=1'); if (r.ok) setConversationList(await r.json())
            // Reload first page
            const m = await fetch(`/api/conversations/${encodeURIComponent(toNumber)}/messages?limit=50`)
            if (m.ok) { const data = await m.json(); setMessages(data.items); setMessagesHasMore(data.hasMore); earliestMessageTsRef.current = data.items.length ? data.items[0].createdAt : null }
        } catch (e: any) { alert(e.message) }
    }

    useEffect(() => {
        if (connected && firstLoad.current) {
            firstLoad.current = false
            try { localStorage.setItem('whatsapp_onboarded', '1') } catch { /* ignore */ }
        }
    }, [connected])

    // Typing indicator (human)
    useEffect(() => {
        if (!toNumber) return
        if (!isTyping) return
        fetch(`/api/conversations/${encodeURIComponent(toNumber)}/typing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'human', typing: true }) }).catch(() => { })
        const timeout = setTimeout(() => {
            fetch(`/api/conversations/${encodeURIComponent(toNumber)}/typing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'human', typing: false }) }).catch(() => { })
            setIsTyping(false)
        }, 2500)
        return () => clearTimeout(timeout)
    }, [isTyping, toNumber])

    function handleMessageChange(v: string) {
        setMessage(v)
        if (!isTyping) setIsTyping(true)
        if (typingTimer.current) clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setIsTyping(false), 1800)
    }

    // Global delegated handler (only once)
    useEffect(() => {
        function handler(e: any) {
            const target = (e.target as HTMLElement)?.closest('[data-action]') as HTMLElement | null
            if (target) {
                const action = target.getAttribute('data-action')!
                performAction(action, target)
            }
        }
        document.addEventListener('click', handler)
        return () => document.removeEventListener('click', handler)
    }, [])

    const openQRModal = () => {
        setShowQRModal(true)
    }

    if (loading) return <div className="p-6">Carregando status do WhatsApp...</div>
    if (error) return <div className="p-6 text-red-600">Erro ao conectar ao gateway ({GATEWAY_BASE}): {error}</div>

    // 🚀 REDIRECIONAMENTO: Mostrar dashboard completo quando conectado
    if (showDashboard && connected) {
        return (
            <WhatsAppDashboard
                gatewayBase={GATEWAY_BASE}
                channelId="1"
                onBack={() => {
                    setShowDashboard(false)
                    console.log('🔙 Voltando do dashboard para o painel principal')
                }}
            />
        )
    }

    return (
        <div className="p-6 space-y-6">
            <div>
                <h2 className="text-2xl font-semibold flex items-center gap-2">WhatsApp
                    {connected && <span className="text-sm px-2 py-0.5 rounded bg-green-100 text-green-700">Conectado</span>}
                    {!connected && <span className="text-sm px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">Aguardando Conexão</span>}
                </h2>
                <p className="text-gray-600 flex items-center gap-2 flex-wrap">Integração local via gateway ({GATEWAY_BASE}).
                    {GATEWAY_PORTS.length > 1 && (
                        <span className="flex items-center gap-1 text-xs">Instância:
                            <select className="border rounded px-1 py-0.5 text-xs" value={activeInstance} onChange={e => {
                                const v = e.target.value
                                setActiveInstance(v)
                                try { localStorage.setItem('wa_active_instance', v) } catch { }
                                setStatus(null); setQr(null); setLoading(true); setError(null)
                            }}>
                                {GATEWAY_PORTS.map(p => <option key={p} value={p}>{/^[0-9]+$/.test(p) ? `Porta ${p}` : p}</option>)}
                            </select>
                        </span>
                    )}
                    <span className="flex items-center gap-1 text-xs">
                        <button type="button" disabled={agzEnvEnabled === false || agzToggling || agzDirect == null} onClick={toggleAgentZeroDirect} className={`px-2 py-0.5 rounded border text-[10px] ${agzEnvEnabled === false ? 'opacity-40 cursor-not-allowed' : agzDirect ? 'bg-green-600 text-white border-green-600' : 'bg-gray-200 text-gray-700 border-gray-300'}`}>
                            {agzEnvEnabled === false ? 'Agent Zero indisponível (env)' : (agzToggling ? '...' : (agzDirect ? 'Agent Zero: ON' : 'Agent Zero: OFF'))}
                        </button>
                    </span>
                </p>
            </div>

            {!connected && (
                <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                    <h3 className="text-lg font-medium mb-2">Conectar Conta WhatsApp</h3>
                    <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1 mb-4">
                        <li>Certifique-se que a instância selecionada está rodando em <code className="px-1 bg-gray-100 rounded">{GATEWAY_BASE}</code></li>
                        <li>Clique no botão "Mostrar QR Code" abaixo</li>
                        <li>Abrir menu do WhatsApp no celular &gt; Dispositivos Conectados</li>
                        <li>Tocar em "Conectar dispositivo" e escanear o QR</li>
                        <li>Aguardar alguns segundos até o status mudar para Conectado</li>
                    </ol>
                    
                    <div className="flex flex-col items-center gap-4">
                        <button
                            onClick={openQRModal}
                            className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                        >
                            📱 Mostrar QR Code
                        </button>
                        
                        <div className="text-center">
                            <div className="text-xs text-gray-500">
                                Status: {status?.status} {status?.message && `- ${status.message}`}
                            </div>
                            {qr && (
                                <div className="text-xs text-green-600 mt-1">
                                    ✅ QR Code pronto - clique no botão acima
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {connected && (
                <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                    <h3 className="text-lg font-medium mb-3">Visão Geral</h3>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="p-4 rounded border bg-gradient-to-br from-green-50 to-green-100">
                            <p className="text-xs font-medium text-green-700">Status</p>
                            <p className="text-lg font-semibold text-green-900">Conectado</p>
                        </div>
                        <div className="p-4 rounded border bg-gradient-to-br from-blue-50 to-blue-100">
                            <p className="text-xs font-medium text-blue-700">Mensagens (demo)</p>
                            <p className="text-lg font-semibold text-blue-900">—</p>
                        </div>
                        <div className="p-4 rounded border bg-gradient-to-br from-purple-50 to-purple-100">
                            <p className="text-xs font-medium text-purple-700">Sessão</p>
                            <p className="text-lg font-semibold text-purple-900">Ativa</p>
                        </div>
                    </div>
                    <div className="mt-4 text-sm text-gray-600">Em breve: lista de conversas, envio manual, anotações e funil.</div>
                    <div className="mt-4 text-sm text-gray-600">Gerencie conversas, intervenções e mensagens.</div>

                    <div className="mt-8 grid gap-6 lg:grid-cols-3">
                        <div className="lg:col-span-1 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="font-semibold">Conversas</h4>
                                <span className="text-[10px] text-gray-500">{filteredConversations.length} itens</span>
                            </div>
                            <div className="flex gap-2 mb-2">
                                <input value={conversationSearch} onChange={e => setConversationSearch(e.target.value)} placeholder="Buscar..." className="flex-1 border rounded px-2 py-1 text-xs" />
                                <label className="flex items-center gap-1 text-[10px] text-gray-600 select-none"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Arquivadas</label>
                            </div>
                            <div className="border rounded divide-y max-h-96 overflow-auto">
                                {filteredConversations.map(c => {
                                    const suppressed = aiSuppressed.active && toNumber === c.conversationId
                                    const statusBadge = c.status === 'critical' ? 'bg-red-100 text-red-600' : c.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                                    return (
                                        <button key={c.conversationId} onClick={() => selectConversation(c.conversationId)} className={`w-full text-left p-3 hover:bg-blue-50 focus:bg-blue-100 flex flex-col gap-1 ${toNumber === c.conversationId ? 'bg-blue-100' : ''}`}>
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-medium text-sm truncate">{c.conversationId}</span>
                                                <div className="flex gap-1">
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusBadge}`}>{c.status || '—'}</span>
                                                    {c.archived && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">Arq.</span>}
                                                    {suppressed && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">Silenciada</span>}
                                                </div>
                                            </div>
                                            <span className="text-xs text-gray-600 truncate">{c.lastMessage}</span>
                                            {(c.humanTyping || c.aiTyping) && <span className="text-[10px] text-blue-600">{c.humanTyping && 'Digitando humano...'} {c.aiTyping && ' IA...'}</span>}
                                            <span className="text-[10px] text-gray-400">{new Date(c.updatedAt).toLocaleTimeString()}</span>
                                        </button>
                                    )
                                })}
                                {filteredConversations.length === 0 && <div className="p-4 text-xs text-gray-500">Nenhuma conversa</div>}
                            </div>
                        </div>
                        <div className="lg:col-span-2 space-y-6">
                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-2 mb-2">
                                    <button onClick={() => triggerAction('take-control')} disabled={!toNumber} className="px-2 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50">Assumir</button>
                                    <button onClick={() => triggerAction('release-control')} disabled={!toNumber} className="px-2 py-1 rounded bg-gray-600 text-white text-xs disabled:opacity-50">Liberar</button>
                                    <button onClick={() => { const correction = prompt('Correção da IA:'); if (correction) triggerAction('correct-ai', { correction }) }} disabled={!toNumber} className="px-2 py-1 rounded bg-yellow-500 text-white text-xs disabled:opacity-50">Corrigir IA</button>
                                    <button onClick={() => { const note = prompt('Nota:'); if (note) triggerAction('add-note', { note }) }} disabled={!toNumber} className="px-2 py-1 rounded bg-gray-700 text-white text-xs disabled:opacity-50">Nota</button>
                                    <button onClick={() => triggerAction('mark-critical')} disabled={!toNumber} className="px-2 py-1 rounded bg-red-600 text-white text-xs disabled:opacity-50">Crítica</button>
                                    <button onClick={() => { const spec = prompt('Especialista (nome/tipo):', 'especialista'); triggerAction('forward-specialist', { specialist: spec || 'especialista' }) }} disabled={!toNumber} className="px-2 py-1 rounded bg-purple-600 text-white text-xs disabled:opacity-50">Especialista</button>
                                    <button onClick={() => triggerAction('validate-ai')} disabled={!toNumber} className="px-2 py-1 rounded bg-green-600 text-white text-xs disabled:opacity-50">Validar IA</button>
                                    <button onClick={async () => {
                                        const convId = prompt('ID / Número nova conversa (ex: 55119...)')
                                        if (!convId) return
                                        const initial = prompt('Mensagem inicial (opcional)')
                                        try {
                                            const r = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: convId, initialMessage: initial }) })
                                            if (r.ok) {
                                                const data = await r.json(); setToNumber(data.conversation.conversationId)
                                            } else alert('Falha ao criar conversa')
                                        } catch (e: any) { alert(e.message) }
                                    }} className="px-2 py-1 rounded bg-indigo-600 text-white text-xs">Nova</button>
                                </div>
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold">Histórico</h4>
                                    {loadingMessages && <span className="text-[10px] text-gray-500 animate-pulse">Atualizando...</span>}
                                </div>
                                <div className="border rounded max-h-72 overflow-auto bg-gray-50 divide-y relative">
                                    {messagesHasMore && <button onClick={loadMoreMessages} disabled={loadingMore} className="w-full bg-white sticky top-0 text-[10px] py-1 border-b hover:bg-gray-100">{loadingMore ? 'Carregando...' : 'Carregar mais'}</button>}
                                    {messages.length === 0 && !loadingMessages && <div className="p-3 text-xs text-gray-500">Nenhuma mensagem</div>}
                                    {messages.map(m => {
                                        const sys = m.direction === 'system'
                                        return (
                                            <div key={m.id} className={`p-2 text-xs flex gap-2 ${sys ? 'bg-yellow-50' : ''}`}>
                                                <span className={`px-1.5 py-0.5 rounded h-fit ${m.direction === 'human' ? 'bg-green-200 text-green-800' : m.direction === 'ai' ? 'bg-blue-200 text-blue-800' : 'bg-gray-300 text-gray-700'}`}>{m.direction}</span>
                                                <div className="flex-1">
                                                    <div className="flex justify-between">
                                                        <span className="font-medium">{m.type}</span>
                                                        <span className="text-[10px] text-gray-500">{new Date(m.createdAt).toLocaleTimeString()}</span>
                                                    </div>
                                                    <div className="whitespace-pre-wrap break-words">{m.text || m.caption || '(sem texto)'}</div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 border-t pt-6">
                        <h4 className="font-semibold mb-3">Enviar Mensagem / Anexo</h4>
                        <div className="space-y-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-medium text-gray-600">Número destino (com DDI ex: 55...)</label>
                                <input value={toNumber} onChange={e => setToNumber(e.target.value)} placeholder="5511999999999" className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-medium text-gray-600">Mensagem / Legenda</label>
                                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="Digite a mensagem" className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <input ref={fileInputRef} multiple type="file" hidden onChange={(e) => {
                                        const files = Array.from(e.target.files || [])
                                        const readers = files.map(file => new Promise<LocalAttachment>((resolve) => {
                                            const r = new FileReader()
                                            r.onload = () => {
                                                resolve({
                                                    id: file.name + '_' + file.lastModified,
                                                    name: file.name,
                                                    size: file.size,
                                                    mime: file.type || 'application/octet-stream',
                                                    dataUrl: r.result as string,
                                                    waType: detectWhatsAppMediaType(file.type || 'application/octet-stream')
                                                })
                                            }
                                            r.readAsDataURL(file)
                                        }))
                                        Promise.all(readers).then(list => setAttachments(prev => [...prev, ...list]))
                                    }} />
                                    <button type="button" onClick={() => fileInputRef.current?.click()} className="px-3 py-1 rounded bg-gray-700 text-white text-sm hover:bg-gray-800">Anexar Arquivos</button>
                                    {attachments.length > 0 && <span className="text-xs text-gray-600">{attachments.length} arquivo(s) selecionado(s)</span>}
                                </div>
                                {attachments.length > 0 && (
                                    <div className="grid md:grid-cols-3 gap-3">
                                        {attachments.map(a => (
                                            <div key={a.id} className="border rounded p-2 bg-gray-50 flex flex-col gap-1">
                                                <div className="text-xs font-medium truncate" title={a.name}>{a.name}</div>
                                                <div className="text-[10px] text-gray-500">{a.waType} • {(a.size / 1024).toFixed(1)} KB</div>
                                                {a.waType === 'image' && <img src={a.dataUrl} className="h-20 w-full object-cover rounded" />}
                                                <button className="mt-auto text-[10px] text-red-600 hover:underline" onClick={() => setAttachments(att => att.filter(x => x.id !== a.id))}>remover</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2 flex-wrap items-center">
                                <button disabled={sending || !toNumber || (!message && attachments.length === 0)} onClick={async () => {
                                    if (!toNumber) return
                                    setSending(true)
                                    try {
                                        if (attachments.length > 0) {
                                            await sendWhatsAppAttachments(GATEWAY_BASE, toNumber, attachments, message || undefined)
                                        } else {
                                            await sendWhatsAppMessage(GATEWAY_BASE, { to: toNumber, text: message, type: 'text' })
                                        }
                                        setMessage('')
                                        setAttachments([])
                                    } catch (e: any) {
                                        alert('Falha ao enviar: ' + e.message)
                                    } finally { setSending(false) }
                                }} className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">{sending ? 'Enviando...' : 'Enviar'}</button>
                                <button disabled={sending || (attachments.length === 0 && !message)} onClick={() => { setMessage(''); setAttachments([]) }} className="px-4 py-1.5 rounded bg-gray-300 text-gray-800 text-sm hover:bg-gray-400 disabled:opacity-50">Limpar</button>
                                <button type="button" onClick={triggerHumanIntervention} disabled={!toNumber || aiSuppressed.active} className="px-4 py-1.5 rounded bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-50">Intervenção Humana</button>
                                {aiSuppressed.active && <>
                                    <span className="text-xs text-red-700 bg-red-100 px-2 py-1 rounded">IA silenciada até {new Date(aiSuppressed.resumeAt || '').toLocaleString()}</span>
                                    <button type="button" onClick={resumeAI} className="px-2 py-1 rounded bg-green-600 text-white text-xs hover:bg-green-700">Retomar IA</button>
                                </>}
                            </div>
                            <div className="mt-6 border-t pt-4 grid md:grid-cols-3 gap-4 text-xs">
                                <div className="space-y-1">
                                    <p className="font-semibold text-gray-700">Métricas</p>
                                    <p>Supressões: {metrics.totalSuppressions ?? '—'}</p>
                                    <p>Retomadas: {metrics.totalResumes ?? '—'}</p>
                                    <p>Ativas: {metrics.activeSuppressions ?? '—'}</p>
                                </div>
                                <div className="md:col-span-2 space-y-1">
                                    <p className="font-semibold text-gray-700">Eventos Recentes</p>
                                    <div className="max-h-32 overflow-auto border rounded bg-gray-50 divide-y">
                                        {eventsLog.length === 0 && <div className="p-2 text-gray-500">Nenhum evento</div>}
                                        {eventsLog.map(ev => (
                                            <div key={ev.ts + '' + ev.type} className="p-2 flex justify-between"><span className="font-medium">{ev.type}</span><span className="text-gray-500">{ev.conversationId}</span><span className="text-gray-400">{new Date(ev.ts).toLocaleTimeString()}</span></div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* QR Modal */}
            <QRModal
                isOpen={showQRModal}
                onClose={() => setShowQRModal(false)}
                gatewayBase={GATEWAY_BASE}
                channelId="1"
            />
        </div>
    )
}

export default WhatsAppPanel
