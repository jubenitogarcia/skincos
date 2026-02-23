import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { LoadingPercentText } from '@/LoadingPattern'

interface QRModalProps {
    isOpen: boolean
    onClose: () => void
    gatewayBase: string
    channelId: string
}

interface QRData {
    type: 'qr_update' | 'status_update'
    channelId: string
    qr: string | null
    status: string
    timestamp: string
    expiresAt: string | null
    connected: boolean
}

export const QRModal: React.FC<QRModalProps> = ({
    isOpen,
    onClose,
    gatewayBase,
    channelId = '1'
}) => {
    const [qrData, setQrData] = useState<QRData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
    
    // SSE and polling refs
    const eventSourceRef = useRef<EventSource | null>(null)
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const refreshTimeoutRef = useRef<NodeJS.Timeout>()
    const lastRefreshRef = useRef<number>(0)
    
    // Accessibility refs
    const modalRef = useRef<HTMLDivElement>(null)
    const previousActiveElementRef = useRef<HTMLElement | null>(null)
    const firstFocusableRef = useRef<HTMLButtonElement>(null)
    const lastFocusableRef = useRef<HTMLButtonElement>(null)

    // Debounced refresh function
    const debouncedRefresh = useCallback(() => {
        const now = Date.now()
        if (now - lastRefreshRef.current < 1000) return // 1s debounce
        
        lastRefreshRef.current = now
        setIsRefreshing(true)
        
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current)
        }
        
        refreshTimeoutRef.current = setTimeout(async () => {
            try {
                const response = await fetch(`${gatewayBase}/whatsapp/${channelId}/start`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }
                
                const result = await response.json()
                if (!result.success) {
                    throw new Error(result.error || 'Failed to refresh QR')
                }
            } catch (err: any) {
                console.warn('Failed to refresh QR:', err.message)
                setError(err.message)
            } finally {
                setIsRefreshing(false)
            }
        }, 500)
    }, [gatewayBase, channelId])

    // Calculate time remaining until QR expires
    const updateTimeRemaining = useCallback(() => {
        if (!qrData?.expiresAt) {
            setTimeRemaining(null)
            return
        }
        
        const expiresAt = new Date(qrData.expiresAt).getTime()
        const now = Date.now()
        const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000))
        
        setTimeRemaining(remaining)
        
        // If expired, try to refresh
        if (remaining === 0 && qrData.qr && !isRefreshing) {
            debouncedRefresh()
        }
    }, [qrData, isRefreshing, debouncedRefresh])

    // Set up SSE connection
    const setupSSE = useCallback(() => {
        if (!isOpen || !gatewayBase) return

        try {
            const eventSource = new EventSource(`${gatewayBase}/whatsapp/${channelId}/qr/stream`)
            eventSourceRef.current = eventSource

            eventSource.onopen = () => {
                console.log('🔌 QR SSE connection opened')
                setError(null)
                setLoading(false)
            }

            // Handle QR events
            eventSource.addEventListener('qr', (event) => {
                try {
                    const data: QRData = JSON.parse(event.data)
                    setQrData(data)
                    
                    // Auto-close modal if connected
                    if (data.connected) {
                        setTimeout(onClose, 1000) // Small delay to show success state
                    }
                } catch (err) {
                    console.error('Failed to parse QR SSE data:', err)
                }
            })

            // Handle state events
            eventSource.addEventListener('state', (event) => {
                try {
                    const data: QRData = JSON.parse(event.data)
                    setQrData(data)
                    
                    // Auto-close modal if connected
                    if (data.connected) {
                        setTimeout(onClose, 1000) // Small delay to show success state
                    }
                } catch (err) {
                    console.error('Failed to parse State SSE data:', err)
                }
            })

            eventSource.onerror = (err) => {
                console.error('❌ QR SSE error:', err)
                setError('Conexão SSE perdida, usando polling como fallback')
                eventSource.close()
                // Fall back to polling
                setupPolling()
            }

        } catch (err: any) {
            console.error('❌ Failed to setup SSE:', err.message)
            setError('SSE indisponível, usando polling')
            setupPolling()
        }
    }, [isOpen, gatewayBase, channelId, onClose])

    // Fallback polling mechanism
    const setupPolling = useCallback(() => {
        if (!isOpen || !gatewayBase) return

        const poll = async () => {
            try {
                const response = await fetch(`${gatewayBase}/whatsapp/${channelId}/qr`)
                if (response.ok) {
                    const data = await response.json()
                    if (data.success) {
                        const qrUpdate: QRData = {
                            type: 'qr_update',
                            channelId,
                            qr: data.qr,
                            status: data.status,
                            timestamp: data.timestamp || new Date().toISOString(),
                            expiresAt: data.expiresAt,
                            connected: data.status === 'ready' || data.status === 'connected'
                        }
                        setQrData(qrUpdate)
                        
                        if (qrUpdate.connected) {
                            setTimeout(onClose, 1000)
                        }
                    }
                }
                setLoading(false)
                setError(null)
            } catch (err: any) {
                console.error('Polling error:', err.message)
                setError(err.message)
                setLoading(false)
            }
        }

        // Initial poll
        poll()
        
        // Set up interval (3s as per requirements)
        pollingIntervalRef.current = setInterval(poll, 3000)
    }, [isOpen, gatewayBase, channelId, onClose])

    // Clean up connections
    const cleanupConnections = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close()
            eventSourceRef.current = null
        }
        
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
        }
        
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current)
        }
    }, [])

    // Focus management
    const trapFocus = useCallback((event: KeyboardEvent) => {
        if (!modalRef.current) return

        const focusableElements = modalRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )

        const firstElement = focusableElements[0] as HTMLElement
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

        if (event.key === 'Tab') {
            if (event.shiftKey) {
                if (document.activeElement === firstElement) {
                    event.preventDefault()
                    lastElement.focus()
                }
            } else {
                if (document.activeElement === lastElement) {
                    event.preventDefault()
                    firstElement.focus()
                }
            }
        }
    }, [])

    // Handle ESC key
    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            onClose()
        } else {
            trapFocus(event)
        }
    }, [onClose, trapFocus])

    // Effects
    useEffect(() => {
        if (isOpen) {
            // Store previous focus
            previousActiveElementRef.current = document.activeElement as HTMLElement
            
            // Lock body scroll
            document.body.style.overflow = 'hidden'
            
            // Set up keyboard listeners
            document.addEventListener('keydown', handleKeyDown)
            
            // Try SSE first, fallback to polling
            setupSSE()
            
            // Focus first focusable element
            setTimeout(() => {
                if (firstFocusableRef.current) {
                    firstFocusableRef.current.focus()
                }
            }, 100)
            
        } else {
            // Cleanup
            cleanupConnections()
            document.body.style.overflow = 'unset'
            document.removeEventListener('keydown', handleKeyDown)
            
            // Restore previous focus
            if (previousActiveElementRef.current) {
                previousActiveElementRef.current.focus()
            }
            
            // Reset state
            setQrData(null)
            setLoading(true)
            setError(null)
            setTimeRemaining(null)
        }

        return () => {
            cleanupConnections()
            document.body.style.overflow = 'unset'
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen, setupSSE, cleanupConnections, handleKeyDown])

    // Timer for countdown
    useEffect(() => {
        let timer: NodeJS.Timeout
        if (qrData?.expiresAt) {
            updateTimeRemaining()
            timer = setInterval(updateTimeRemaining, 1000)
        }
        return () => timer && clearInterval(timer)
    }, [qrData, updateTimeRemaining])

    // Render QR code
    const renderQR = () => {
        if (loading) {
            return (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-gray-600">
                        <LoadingPercentText label="Carregando QR" showPercent={false} />
                    </span>
                </div>
            )
        }

        if (error) {
            return (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                    <div className="text-red-600 font-medium">Erro ao carregar QR</div>
                    <div className="text-red-500 text-sm mt-1">{error}</div>
                    <button
                        onClick={debouncedRefresh}
                        disabled={isRefreshing}
                        className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                        {isRefreshing ? 'Tentando...' : 'Tentar Novamente'}
                    </button>
                </div>
            )
        }

        if (!qrData?.qr) {
            return (
                <div className="flex items-center justify-center h-64 text-gray-500">
                    <div className="text-center">
                        <div className="text-lg font-medium">Nenhum QR disponível</div>
                        <div className="text-sm mt-1">Status: {qrData?.status || 'desconhecido'}</div>
                    </div>
                </div>
            )
        }

        const isDataUrl = qrData.qr.startsWith('data:image')

        return (
            <div className="flex flex-col items-center gap-4">
                {/* QR Code Display */}
                <div className="bg-white p-4 rounded-lg shadow-md">
                    {isDataUrl ? (
                        <img
                            src={qrData.qr}
                            alt="Código QR do WhatsApp"
                            className="w-64 h-64 object-contain"
                        />
                    ) : (
                        <pre className="bg-black text-green-400 p-3 text-xs font-mono leading-tight rounded overflow-auto max-h-64 max-w-64">
                            {qrData.qr}
                        </pre>
                    )}
                </div>

                {/* Status and Timer */}
                <div className="text-center space-y-2">
                    <div className="flex items-center justify-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${
                            qrData.connected ? 'bg-green-500' : 
                            qrData.status === 'qr_received' ? 'bg-yellow-500' : 'bg-gray-400'
                        }`}></div>
                        <span className="text-sm font-medium text-gray-700">
                            {qrData.connected ? 'Conectado' : 
                             qrData.status === 'qr_received' ? 'Aguardando scan' : 
                             'Conectando...'}
                        </span>
                    </div>
                    
                    {timeRemaining !== null && timeRemaining > 0 && (
                        <div className="text-sm text-orange-600 font-medium">
                            QR expira em {timeRemaining}s
                        </div>
                    )}
                    
                    {timeRemaining === 0 && (
                        <div className="text-sm text-red-600 font-medium">
                            QR expirado - gerando novo...
                        </div>
                    )}
                </div>

                {/* Instructions */}
                <div className="text-center text-sm text-gray-600 max-w-md">
                    <p className="font-medium mb-2">Como conectar:</p>
                    <ol className="text-left list-decimal list-inside space-y-1">
                        <li>Abra o WhatsApp no seu celular</li>
                        <li>Vá em Configurações &gt; Dispositivos Conectados</li>
                        <li>Toque em "Conectar dispositivo"</li>
                        <li>Escaneie este código QR</li>
                    </ol>
                </div>
            </div>
        )
    }

    if (!isOpen) return null

    return createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
                onClick={onClose}
                style={{ zIndex: 1000 }}
            />
            
            {/* Modal */}
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="qr-modal-title"
                className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
                style={{ 
                    zIndex: 1001,
                    pointerEvents: 'auto'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 id="qr-modal-title" className="text-xl font-semibold text-gray-900">
                        Conectar WhatsApp
                    </h2>
                    <button
                        ref={lastFocusableRef}
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label="Fechar modal"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {renderQR()}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
                    <button
                        ref={firstFocusableRef}
                        onClick={debouncedRefresh}
                        disabled={isRefreshing || loading}
                        className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {isRefreshing ? (
                            <span className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                                Atualizando...
                            </span>
                        ) : (
                            'Atualizar QR'
                        )}
                    </button>
                    
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}
