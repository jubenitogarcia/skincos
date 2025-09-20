import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { fetchInstagramAccountMetrics } from '@/services/instagramIntegration'
import { logContextEvent } from '../debug/ContextDebugger'

interface InstagramIntegrationState {
    connected: boolean
    accessToken?: string
    businessAccountId?: string
    lastSync?: string
    metrics?: any
    error?: string
}

interface WhatsAppIntegrationState {
    connected: boolean
    baseUrl?: string // Endpoint base da API local/externa do WhatsApp gateway
    lastSync?: string
    error?: string
    stats?: any
}

interface IntegrationsContextValue {
    instagram: InstagramIntegrationState
    whatsapp: WhatsAppIntegrationState
    connectInstagram: (token: string, businessAccountId: string) => Promise<void>
    disconnectInstagram: () => void
    syncInstagram: () => Promise<void>
    connectWhatsApp: (baseUrl: string) => Promise<void>
    disconnectWhatsApp: () => void
    syncWhatsApp: () => Promise<void>
}

// HMR-stable singleton Context - survives hot reloads  
const IntegrationsContext = (import.meta.hot?.data.IntegrationsCtx) ?? createContext<IntegrationsContextValue | undefined>(undefined)
if (import.meta.hot) {
    import.meta.hot.dispose(d => { d.IntegrationsCtx = IntegrationsContext })
    import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

const LS_TOKEN_KEY = 'instagram-access-token'
const LS_BIZ_ID_KEY = 'instagram-business-account-id'

export function IntegrationsProvider({ children }: { children: ReactNode }) {
    console.log('[IntegrationsProvider] 🚀 Initializing IntegrationsProvider...')
    
    // Verificação de ambiente client-side
    if (typeof window !== 'undefined') {
        // Lightweight mount trace (single log)
        if (!(window as any).__INT_CTX_MOUNTED__) {
            console.log('[IntegrationsProvider] ✅ Client-side mount detected')
                ; (window as any).__INT_CTX_MOUNTED__ = true
        }
    }
    
    const [instagram, setInstagram] = useState<InstagramIntegrationState>({ connected: false })
    const [whatsapp, setWhatsApp] = useState<WhatsAppIntegrationState>({ connected: false })

    // bootstrap from localStorage / env
    useEffect(() => {
        const storedToken = localStorage.getItem(LS_TOKEN_KEY) || (import.meta as any).env.VITE_INSTAGRAM_ACCESS_TOKEN
        const storedBiz = localStorage.getItem(LS_BIZ_ID_KEY) || (import.meta as any).env.VITE_INSTAGRAM_BUSINESS_ACCOUNT_ID
        if (storedToken && storedBiz) {
            setInstagram(prev => ({ ...prev, connected: true, accessToken: storedToken, businessAccountId: storedBiz }))
        }
    }, [])

    const connectInstagram = async (token: string, businessAccountId: string) => {
        localStorage.setItem(LS_TOKEN_KEY, token)
        localStorage.setItem(LS_BIZ_ID_KEY, businessAccountId)
        setInstagram({ connected: true, accessToken: token, businessAccountId })
        await syncInstagram()
    }

    const disconnectInstagram = () => {
        localStorage.removeItem(LS_TOKEN_KEY)
        localStorage.removeItem(LS_BIZ_ID_KEY)
        setInstagram({ connected: false })
    }

    const syncInstagram = async () => {
        if (!instagram.accessToken || !instagram.businessAccountId) return
        try {
            const metrics = await fetchInstagramAccountMetrics(instagram.businessAccountId, instagram.accessToken)
            setInstagram(prev => ({ ...prev, metrics, lastSync: new Date().toISOString(), error: undefined }))
        } catch (e: any) {
            setInstagram(prev => ({ ...prev, error: e.message }))
        }
    }

    // --- WhatsApp simplistic integration (assumindo gateway REST) ---
    const LS_WA_BASE_KEY = 'whatsapp-base-url'
    useEffect(() => {
        const storedBase = localStorage.getItem(LS_WA_BASE_KEY)
        if (storedBase) setWhatsApp(prev => ({ ...prev, connected: true, baseUrl: storedBase }))
    }, [])

    const connectWhatsApp = async (baseUrl: string) => {
        // Normaliza e permite usar domínio alternativo (ex: wa.skincos.com.br)
        const normalized = baseUrl.replace(/\/$/, '')
        localStorage.setItem(LS_WA_BASE_KEY, normalized)
        setWhatsApp({ connected: true, baseUrl: normalized })
        await syncWhatsApp()
    }

    const disconnectWhatsApp = () => {
        localStorage.removeItem(LS_WA_BASE_KEY)
        setWhatsApp({ connected: false })
    }

    const syncWhatsApp = async () => {
        if (!whatsapp.baseUrl) return
        try {
            // Tentativa de fetch de estatísticas básicas (rota hipotética /stats)
            const res = await fetch(`${whatsapp.baseUrl.replace(/\/$/, '')}/stats`).catch(() => null)
            if (res && res.ok) {
                const stats = await res.json()
                setWhatsApp(prev => ({ ...prev, stats, lastSync: new Date().toISOString(), error: undefined }))
            } else {
                setWhatsApp(prev => ({ ...prev, lastSync: new Date().toISOString() }))
            }
        } catch (e: any) {
            setWhatsApp(prev => ({ ...prev, error: e.message }))
        }
    }

    const value: IntegrationsContextValue = {
        instagram: {
            ...instagram,
            // Derivação segura de Date para consumidores que precisam de objeto Date
            get lastSyncDate() {
                return instagram.lastSync ? new Date(instagram.lastSync) : undefined
            }
        } as any,
        whatsapp: {
            ...whatsapp,
            get lastSyncDate() {
                return whatsapp.lastSync ? new Date(whatsapp.lastSync) : undefined
            }
        } as any,
        connectInstagram,
        disconnectInstagram,
        syncInstagram,
        connectWhatsApp,
        disconnectWhatsApp,
        syncWhatsApp
    }

    return <IntegrationsContext.Provider value={value}>{children}</IntegrationsContext.Provider>
}

export function useIntegrations(): IntegrationsContextValue {
    const ctx = useContext(IntegrationsContext)
    if (!ctx) {
        // CAPTURE DETAILED ERROR INFORMATION
        const stackTrace = new Error().stack
        const contextInfo = {
            IntegrationsContext: !!IntegrationsContext,
            hasProvider: typeof window !== 'undefined' && !!(window as any).__INTEGRATIONS_PROVIDER_MOUNTED__,
            stackTrace
        }
        
        logContextEvent('useIntegrations', 'CONTEXT_NULL_ERROR', contextInfo, true)
        console.error('🚨 [useIntegrations] Context is null!', contextInfo)
        
        throw new Error(`useIntegrations must be used within IntegrationsProvider. Context: ${JSON.stringify(contextInfo)}`)
    }
    return ctx
}
