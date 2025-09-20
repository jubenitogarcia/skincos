import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Progress } from '@/components/ui/progress'
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from 'sonner'
import * as QRCode from 'qrcode'
import {
  WhatsappLogo,
  Play,
  Stop,
  ArrowClockwise,
  CheckCircle,
  XCircle,
  Clock,
  Warning,
  QrCode,
  Spinner,
  Plus,
  Eye,
  EyeSlash,
  Copy,
  Robot,
  Lightning
} from "@phosphor-icons/react"

// Channel-based interfaces
interface ChannelInstance {
  id: string
  port: number
  channel: number
  status: 'free' | 'starting' | 'qr_pending' | 'connected' | 'error' | 'stopping'
  name?: string
  createdAt: string
  updatedAt: string
  metadata?: {
    phoneNumber?: string
    errorCount?: number
    restartCount?: number
    lastActivity?: string
    errorMessage?: string
  }
}

interface OrchestratorStatus {
  totalInstances: number
  freeInstances: number
  connectedInstances: number
  errorInstances: number
  instances: ChannelInstance[]
  availableChannelsList: number[]
  freeChannelsList: number[]
}

interface QRData {
  qr: string
  dataUrl?: string
}

interface ConversationItem {
  conversationId: string
  lastMessage: string
  updatedAt: string
  unreadCount?: number
  archived?: boolean
  name?: string
}

interface MessageItem {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound'
  type: string
  text?: string
  caption?: string
  mediaType?: string
  createdAt: string
}

// Channel to port mapping (1-9 → 3001-3009)
const channelToPort = (channel: number) => 3000 + channel
const portToChannel = (port: number) => port - 3000

const STATUS_COLORS = {
  free: 'bg-green-500',
  starting: 'bg-yellow-500',
  qr_pending: 'bg-blue-500',
  connected: 'bg-green-600',
  error: 'bg-red-500',
  stopping: 'bg-orange-500'
}

const STATUS_LABELS = {
  free: 'Livre',
  starting: 'Iniciando',
  qr_pending: 'Aguardando QR',
  connected: 'Conectado',
  error: 'Erro',
  stopping: 'Parando'
}

const STATUS_ICONS = {
  free: CheckCircle,
  starting: Spinner,
  qr_pending: QrCode,
  connected: CheckCircle,
  error: XCircle,
  stopping: Clock
}

export function WhatsAppUnifiedHub() {
  // Main state
  const [activeTab, setActiveTab] = useState("channels")
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null)
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Channel operations state
  const [startingChannels, setStartingChannels] = useState<Set<number>>(new Set())
  const [stoppingChannels, setStoppingChannels] = useState<Set<number>>(new Set())
  const [channelErrors, setChannelErrors] = useState<Map<number, string>>(new Map())
  const [channelQR, setChannelQR] = useState<Map<number, QRData>>(new Map())
  const [qrDialogChannel, setQrDialogChannel] = useState<number | null>(null)
  
  // Chat functionality state
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [messageInput, setMessageInput] = useState("")
  const [sendingMessage, setSendingMessage] = useState(false)
  
  // Polling and real-time updates
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Fetch orchestrator status
  const fetchOrchestratorStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/wa-orchestrator/channels')
      if (!response.ok) throw new Error('Failed to fetch channels status')
      
      const channelsData = await response.json()
      
      // Transform channels response to match expected OrchestratorStatus interface
      // Support both response formats:
      // - {success: true, channels: [...]} (structured response)
      // - [...] (raw array response)
      let instances: any[] = []
      
      if (Array.isArray(channelsData)) {
        // Backend returned a raw array directly
        instances = channelsData
      } else if (channelsData && typeof channelsData === 'object') {
        // Backend returned a structured response
        if (channelsData.success && Array.isArray(channelsData.channels)) {
          instances = channelsData.channels
        } else if (Array.isArray(channelsData.data)) {
          // Alternative structure: {data: [...]}
          instances = channelsData.data
        }
      }
      const totalInstances = instances.length
      const connectedInstances = instances.filter((ch: any) => ch.status === 'connected').length
      const freeInstances = instances.filter((ch: any) => ch.status === 'free').length
      const errorInstances = instances.filter((ch: any) => ch.status === 'error').length
      
      const transformedData: OrchestratorStatus = {
        totalInstances,
        freeInstances,
        connectedInstances,
        errorInstances,
        instances: instances.map((ch: any) => ({
          id: ch.id || `channel-${ch.channel}`,
          port: ch.port,
          channel: ch.channel,
          status: ch.status,
          name: ch.name,
          createdAt: ch.createdAt || new Date().toISOString(),
          updatedAt: ch.updatedAt || new Date().toISOString(),
          metadata: ch.metadata || {}
        })),
        availableChannelsList: Array.from({ length: 9 }, (_, i) => i + 1),
        freeChannelsList: instances.filter((ch: any) => ch.status === 'free').map((ch: any) => ch.channel)
      }
      
      setOrchestratorStatus(transformedData)
      setError(null)
    } catch (err: any) {
      setError(`Failed to load channels status: ${err.message}`)
      console.error('Channels status error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Start a specific channel
  const startChannel = useCallback(async (channel: number, instanceName?: string) => {
    setStartingChannels(prev => new Set(prev.add(channel)))
    setChannelErrors(prev => {
      const newMap = new Map(prev)
      newMap.delete(channel)
      return newMap
    })
    
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: instanceName })
      })
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to start channel')
      }
      
      toast.success(`Canal ${channel} iniciado com sucesso`)
      
      // Poll for QR code if needed
      setTimeout(() => pollChannelQR(channel), 1000)
      
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      setChannelErrors(prev => new Map(prev.set(channel, errorMsg)))
      toast.error(`Erro ao iniciar Canal ${channel}: ${errorMsg}`)
    } finally {
      setStartingChannels(prev => {
        const newSet = new Set(prev)
        newSet.delete(channel)
        return newSet
      })
    }
  }, [])

  // Stop a specific channel
  const stopChannel = useCallback(async (channel: number) => {
    setStoppingChannels(prev => new Set(prev.add(channel)))
    
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/stop`, {
        method: 'POST'
      })
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to stop channel')
      }
      
      toast.success(`Canal ${channel} parado com sucesso`)
      
      // Clear QR code for this channel
      setChannelQR(prev => {
        const newMap = new Map(prev)
        newMap.delete(channel)
        return newMap
      })
      
    } catch (err: any) {
      toast.error(`Erro ao parar Canal ${channel}: ${err.message}`)
    } finally {
      setStoppingChannels(prev => {
        const newSet = new Set(prev)
        newSet.delete(channel)
        return newSet
      })
    }
  }, [])

  // Restart a specific channel
  const restartChannel = useCallback(async (channel: number) => {
    await stopChannel(channel)
    setTimeout(() => startChannel(channel), 2000)
  }, [startChannel, stopChannel])

  // Get channel instance by channel number
  const getChannelInstance = useCallback((channel: number): ChannelInstance | null => {
    if (!orchestratorStatus) return null
    return orchestratorStatus.instances.find(inst => inst.channel === channel) || null
  }, [orchestratorStatus])

  // QR polling state and refs for abort control
  const qrPollingRefs = useRef<Map<number, { controller: AbortController; timeout: NodeJS.Timeout }>>(new Map())
  const qrRetryCount = useRef<Map<number, number>>(new Map())

  // Poll for QR code on a specific channel with proper error handling and abort control
  const pollChannelQR = useCallback(async (channel: number, retryCount = 0) => {
    // Stop any existing polling for this channel
    const existing = qrPollingRefs.current.get(channel)
    if (existing) {
      existing.controller.abort()
      clearTimeout(existing.timeout)
      qrPollingRefs.current.delete(channel)
    }

    const controller = new AbortController()
    
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/qr`, {
        signal: controller.signal
      })
      
      if (!response.ok) {
        if (response.status === 404) {
          // QR not ready yet, retry with backoff
          const backoffDelay = Math.min(1000 * Math.pow(1.5, retryCount), 5000)
          const timeout = setTimeout(() => pollChannelQR(channel, retryCount + 1), backoffDelay)
          qrPollingRefs.current.set(channel, { controller, timeout })
          return
        }
        throw new Error(`HTTP ${response.status}`)
      }
      
      const result = await response.json()
      if (result.success && (result.qr || result.dataUrl)) {
        let qrDataUrl: string
        
        if (result.dataUrl) {
          // Use provided data URL directly
          qrDataUrl = result.dataUrl
        } else if (result.qr) {
          // Check if it's already a data URL
          if (result.qr.startsWith('data:')) {
            qrDataUrl = result.qr
          } else {
            // Convert QR string to visual QR code image using qrcode library
            try {
              qrDataUrl = await QRCode.toDataURL(result.qr, {
                width: 300,
                margin: 2,
                color: {
                  dark: '#000000',
                  light: '#FFFFFF'
                }
              })
            } catch (qrError) {
              console.error('Failed to generate QR code image:', qrError)
              return
            }
          }
        } else {
          return
        }
        
        setChannelQR(prev => new Map(prev.set(channel, { 
          qr: result.qr || qrDataUrl, 
          dataUrl: qrDataUrl 
        })))
        
        // Reset retry count on success
        qrRetryCount.current.delete(channel)
        
        // Auto-show QR dialog if not already open
        if (!qrDialogChannel) {
          setQrDialogChannel(channel)
        }
        
        // Continue polling until connected (QR may refresh)
        const instance = getChannelInstance(channel)
        if (instance?.status === 'qr_pending') {
          const timeout = setTimeout(() => pollChannelQR(channel, 0), 3000)
          qrPollingRefs.current.set(channel, { controller, timeout })
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return // Expected when aborting
      
      console.warn(`Failed to fetch QR for channel ${channel} (attempt ${retryCount + 1}):`, err)
      
      // Implement exponential backoff for retries
      if (retryCount < 5) {
        const backoffDelay = Math.min(2000 * Math.pow(1.5, retryCount), 10000)
        const timeout = setTimeout(() => pollChannelQR(channel, retryCount + 1), backoffDelay)
        qrPollingRefs.current.set(channel, { controller, timeout })
      } else {
        setChannelErrors(prev => new Map(prev.set(channel, `QR fetch failed after ${retryCount + 1} attempts`)))
      }
    }
  }, [getChannelInstance, qrDialogChannel])

  // Send message to selected conversation
  const sendMessage = useCallback(async () => {
    if (!messageInput.trim() || !selectedConversation || !selectedChannel) return
    
    setSendingMessage(true)
    try {
      const port = channelToPort(selectedChannel)
      const response = await fetch(`/api/conversations/${selectedConversation}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: messageInput,
          port: port
        })
      })
      
      if (!response.ok) throw new Error('Failed to send message')
      
      setMessageInput("")
      toast.success("Mensagem enviada")
      
    } catch (err: any) {
      toast.error(`Erro ao enviar mensagem: ${err.message}`)
    } finally {
      setSendingMessage(false)
    }
  }, [messageInput, selectedConversation, selectedChannel])

  // Cleanup QR polling on unmount
  useEffect(() => {
    return () => {
      // Clean up all QR polling on unmount
      qrPollingRefs.current.forEach(({ controller, timeout }) => {
        controller.abort()
        clearTimeout(timeout)
      })
      qrPollingRefs.current.clear()
    }
  }, [])

  // Monitor status changes and automatically start QR polling for qr_pending channels
  useEffect(() => {
    if (!orchestratorStatus) return
    
    orchestratorStatus.instances.forEach(instance => {
      if (instance.status === 'qr_pending' && !qrPollingRefs.current.has(instance.channel)) {
        // Auto-start QR polling for channels waiting for QR
        setTimeout(() => pollChannelQR(instance.channel), 500)
      } else if (instance.status !== 'qr_pending' && qrPollingRefs.current.has(instance.channel)) {
        // Stop QR polling for channels that are no longer waiting for QR
        const existing = qrPollingRefs.current.get(instance.channel)
        if (existing) {
          existing.controller.abort()
          clearTimeout(existing.timeout)
          qrPollingRefs.current.delete(instance.channel)
        }
      }
    })
  }, [orchestratorStatus, pollChannelQR])

  // Setup polling for status updates
  useEffect(() => {
    fetchOrchestratorStatus()
    
    pollIntervalRef.current = setInterval(fetchOrchestratorStatus, 5000)
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [fetchOrchestratorStatus])

  // Setup real-time conversation updates
  useEffect(() => {
    eventSourceRef.current = new EventSource('/api/conversations/events')
    
    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        switch (data.type) {
          case 'snapshot':
            setConversations(data.conversations || [])
            break
            
          case 'conversation-update':
          case 'conversation-updated':
            setConversations(prev => {
              const idx = prev.findIndex(c => c.conversationId === data.conversation.conversationId)
              if (idx === -1) return [...prev, data.conversation]
              const next = [...prev]
              next[idx] = data.conversation
              return next
            })
            break
            
          case 'message':
          case 'new-message':
            const message = data.message
            if (message.conversationId === selectedConversation) {
              setMessages(prev => [...prev, message])
            }
            break
        }
      } catch (err) {
        console.warn('Failed to parse SSE event:', err)
      }
    }
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [selectedConversation])

  // Load messages for selected conversation
  useEffect(() => {
    if (!selectedConversation) {
      setMessages([])
      return
    }
    
    const loadMessages = async () => {
      try {
        const response = await fetch(`/api/conversations/${selectedConversation}/messages?limit=50`)
        if (response.ok) {
          const data = await response.json()
          setMessages(data.items || [])
        }
      } catch (err) {
        console.warn('Failed to load messages:', err)
      }
    }
    
    loadMessages()
  }, [selectedConversation])

  // Render channel status indicator
  const renderChannelStatus = (channel: number) => {
    const instance = getChannelInstance(channel)
    const isStarting = startingChannels.has(channel)
    const isStopping = stoppingChannels.has(channel)
    const hasError = channelErrors.has(channel)
    const hasQR = channelQR.has(channel)
    
    let status = instance?.status || 'free'
    let label = STATUS_LABELS[status] || 'Desconhecido'
    let color = STATUS_COLORS[status] || 'bg-gray-500'
    let Icon = STATUS_ICONS[status] || CheckCircle
    
    if (isStarting) {
      status = 'starting'
      label = 'Iniciando...'
      color = 'bg-yellow-500'
      Icon = Spinner
    } else if (isStopping) {
      status = 'stopping'
      label = 'Parando...'
      color = 'bg-orange-500'
      Icon = Clock
    } else if (hasError) {
      status = 'error'
      label = 'Erro'
      color = 'bg-red-500'
      Icon = XCircle
    }
    
    return (
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{label}</span>
        {hasQR && (
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => setQrDialogChannel(channel)}
            className="animate-pulse"
          >
            <QrCode className="w-4 h-4 mr-1" />
            Ver QR
          </Button>
        )}
        {instance?.status === 'qr_pending' && !hasQR && (
          <div className="text-xs text-blue-600 flex items-center gap-1">
            <Spinner className="w-3 h-3 animate-spin" />
            Carregando QR...
          </div>
        )}
      </div>
    )
  }

  // Render channel controls
  const renderChannelControls = (channel: number) => {
    const instance = getChannelInstance(channel)
    const isStarting = startingChannels.has(channel)
    const isStopping = stoppingChannels.has(channel)
    const hasError = channelErrors.has(channel)
    const isConnected = instance?.status === 'connected'
    const isActive = instance?.status && instance.status !== 'free'
    
    return (
      <div className="flex items-center gap-2">
        {!isActive && !isStarting && (
          <Button
            size="sm"
            onClick={() => startChannel(channel)}
            disabled={isStarting}
          >
            <Play className="w-4 h-4 mr-1" />
            Iniciar
          </Button>
        )}
        
        {isActive && !isStopping && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => stopChannel(channel)}
            disabled={isStopping}
          >
            <Stop className="w-4 h-4 mr-1" />
            Parar
          </Button>
        )}
        
        {(isActive || hasError) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => restartChannel(channel)}
            disabled={isStarting || isStopping}
          >
            <ArrowClockwise className="w-4 h-4 mr-1" />
            Reiniciar
          </Button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8 animate-spin" />
        <span className="ml-2">Carregando WhatsApp Hub...</span>
      </div>
    )
  }

  if (error) {
    return (
      <Alert className="mx-4">
        <Warning className="h-4 w-4" />
        <AlertDescription>
          {error}
          <Button 
            size="sm" 
            variant="outline" 
            className="ml-2"
            onClick={fetchOrchestratorStatus}
          >
            Tentar Novamente
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  // Get current selected channel instance
  const getCurrentChannelInstance = () => {
    return selectedChannel ? getChannelInstance(selectedChannel) : null
  }

  // Navigate to channel dashboard using proxy route
  const navigateToChannelDashboard = (channel: number) => {
    // Use proxy route with dashboard path
    const channelRoute = `/canal${channel}/dashboard`
    
    // Validate that channel is actually connected before redirecting
    const instance = getCurrentChannelInstance()
    if (!instance || instance.status !== 'connected') {
      toast.error(`Canal ${channel} não está conectado. Inicie o canal primeiro.`)
      return
    }
    
    // Open dashboard in new tab using the proxy route - this loads the full WhatsApp Business dashboard
    window.open(channelRoute, '_blank')
  }

  return (
    <div className="space-y-6">
      {/* Header with Channel Selection */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <WhatsappLogo className="w-8 h-8 text-green-600" />
          <div>
            <h1 className="text-2xl font-bold">WhatsApp Business Hub</h1>
            <p className="text-gray-600">Gestão unificada de canais WhatsApp</p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          {/* Channel Selector - Fixed at top */}
          <div className="flex items-center gap-2">
            <Label className="whitespace-nowrap">Canal Ativo:</Label>
            <Select value={selectedChannel?.toString() || ""} onValueChange={(value) => setSelectedChannel(parseInt(value))}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Selecione um canal">
                  {selectedChannel && (
                    <span>Canal {selectedChannel} → Porta {channelToPort(selectedChannel)}</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 9 }, (_, i) => i + 1).map(channel => {
                  const port = channelToPort(channel)
                  const instance = getChannelInstance(channel)
                  const statusLabel = instance ? STATUS_LABELS[instance.status] : 'Livre'
                  
                  return (
                    <SelectItem key={channel} value={channel.toString()}>
                      Canal {channel} → Porta {port} ({statusLabel})
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {orchestratorStatus && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline">
                {orchestratorStatus.connectedInstances} conectados
              </Badge>
              <Badge variant="outline">
                {orchestratorStatus.freeInstances} livres
              </Badge>
              {orchestratorStatus.errorInstances > 0 && (
                <Badge variant="destructive">
                  {orchestratorStatus.errorInstances} com erro
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="channels">Canais</TabsTrigger>
          <TabsTrigger value="conversations">Conversas</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Channels Tab - Contextual Panel */}
        <TabsContent value="channels" className="space-y-4">
          {!selectedChannel ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center space-y-4">
                  <WhatsappLogo className="w-16 h-16 text-green-600 mx-auto" />
                  <h3 className="text-lg font-semibold">Selecione um Canal</h3>
                  <p className="text-gray-600 max-w-md mx-auto">
                    Escolha um canal no dropdown acima para ver suas informações e controles de gerenciamento.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Channel Info Panel */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="flex items-center gap-3">
                      <WhatsappLogo className="w-8 h-8 text-green-600" />
                      <div>
                        <CardTitle className="text-xl">Canal {selectedChannel}</CardTitle>
                        <CardDescription>Porta {channelToPort(selectedChannel)}</CardDescription>
                      </div>
                    </div>
                    {renderChannelStatus(selectedChannel)}
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-6">
                  {/* Channel Error Display */}
                  {channelErrors.has(selectedChannel) && (
                    <Alert className="border-red-200 bg-red-50">
                      <Warning className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-700">
                        {channelErrors.get(selectedChannel)}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Channel Metadata */}
                  {(() => {
                    const instance = getCurrentChannelInstance()
                    if (instance?.metadata) {
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
                          {instance.metadata.phoneNumber && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-gray-700">Telefone</div>
                              <div className="text-sm text-gray-900">{instance.metadata.phoneNumber}</div>
                            </div>
                          )}
                          {instance.metadata.errorCount !== undefined && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-gray-700">Erros</div>
                              <div className="text-sm text-gray-900">{instance.metadata.errorCount}</div>
                            </div>
                          )}
                          {instance.metadata.restartCount !== undefined && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-gray-700">Reinicializações</div>
                              <div className="text-sm text-gray-900">{instance.metadata.restartCount}</div>
                            </div>
                          )}
                          {instance.metadata.lastActivity && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-gray-700">Última Atividade</div>
                              <div className="text-sm text-gray-900">
                                {new Date(instance.metadata.lastActivity).toLocaleString()}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    }
                    return null
                  })()}

                  {/* QR Code Preview */}
                  {channelQR.has(selectedChannel) && (
                    <div className="flex flex-col items-center space-y-4 p-6 bg-blue-50 rounded-lg border">
                      <div className="text-center space-y-2">
                        <QrCode className="w-8 h-8 text-blue-600 mx-auto" />
                        <h4 className="font-semibold text-blue-900">QR Code Disponível</h4>
                        <p className="text-sm text-blue-700">
                          QR code gerado e pronto para escaneamento
                        </p>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setQrDialogChannel(selectedChannel)}
                        className="border-blue-200 text-blue-700 hover:bg-blue-100"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Visualizar QR Code
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Control Panel */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Controles</CardTitle>
                  <CardDescription>Ações do canal selecionado</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(() => {
                    const instance = getCurrentChannelInstance()
                    const isStarting = startingChannels.has(selectedChannel)
                    const isStopping = stoppingChannels.has(selectedChannel)
                    const hasError = channelErrors.has(selectedChannel)
                    const isConnected = instance?.status === 'connected'
                    const isActive = instance?.status && instance.status !== 'free'
                    const hasQR = channelQR.has(selectedChannel)

                    return (
                      <>
                        {/* Primary Action Button */}
                        {!isActive && !isStarting && (
                          <Button
                            className="w-full"
                            size="lg"
                            onClick={() => startChannel(selectedChannel)}
                            disabled={isStarting}
                          >
                            <Play className="w-5 h-5 mr-2" />
                            Iniciar Canal
                          </Button>
                        )}

                        {isStarting && (
                          <Button
                            className="w-full"
                            size="lg"
                            disabled
                          >
                            <Spinner className="w-5 h-5 mr-2 animate-spin" />
                            Iniciando...
                          </Button>
                        )}

                        {isConnected && (
                          <Button
                            className="w-full bg-green-600 hover:bg-green-700"
                            size="lg"
                            onClick={() => navigateToChannelDashboard(selectedChannel)}
                          >
                            <Eye className="w-5 h-5 mr-2" />
                            Acessar Canal
                          </Button>
                        )}

                        {/* Secondary Actions */}
                        {isActive && (
                          <div className="space-y-2">
                            {instance?.status === 'qr_pending' && hasQR && (
                              <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => setQrDialogChannel(selectedChannel)}
                              >
                                <QrCode className="w-4 h-4 mr-2" />
                                Ver QR Code
                              </Button>
                            )}

                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() => restartChannel(selectedChannel)}
                              disabled={isStarting || isStopping}
                            >
                              <ArrowClockwise className="w-4 h-4 mr-2" />
                              Reiniciar
                            </Button>

                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() => stopChannel(selectedChannel)}
                              disabled={isStopping}
                            >
                              {isStopping ? (
                                <Spinner className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Stop className="w-4 h-4 mr-2" />
                              )}
                              {isStopping ? 'Parando...' : 'Parar Canal'}
                            </Button>
                          </div>
                        )}

                        {hasError && (
                          <Button
                            variant="outline"
                            className="w-full text-orange-600 border-orange-200 hover:bg-orange-50"
                            onClick={() => {
                              setChannelErrors(prev => {
                                const newMap = new Map(prev)
                                newMap.delete(selectedChannel)
                                return newMap
                              })
                              // Optionally restart the channel
                              restartChannel(selectedChannel)
                            }}
                          >
                            <ArrowClockwise className="w-4 h-4 mr-2" />
                            Resolver Erro
                          </Button>
                        )}
                      </>
                    )
                  })()}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Conversations Tab */}
        <TabsContent value="conversations" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[600px]">
            {/* Conversations List */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Conversas</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {conversations.map((conv) => (
                      <div
                        key={conv.conversationId}
                        className={`p-3 rounded-lg border cursor-pointer hover:bg-gray-50 ${
                          selectedConversation === conv.conversationId ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        }`}
                        onClick={() => setSelectedConversation(conv.conversationId)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {conv.name || conv.conversationId}
                            </div>
                            <div className="text-xs text-gray-500 truncate mt-1">
                              {conv.lastMessage}
                            </div>
                          </div>
                          {conv.unreadCount && conv.unreadCount > 0 && (
                            <Badge className="text-xs">
                              {conv.unreadCount}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Chat Area */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">
                  {selectedConversation ? `Chat: ${selectedConversation}` : 'Selecione uma conversa'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedConversation ? (
                  <div className="space-y-4">
                    {/* Messages Area */}
                    <ScrollArea className="h-[400px] border rounded-lg p-4">
                      <div className="space-y-3">
                        {messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[70%] p-3 rounded-lg ${
                                msg.direction === 'outbound'
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-gray-100 text-gray-900'
                              }`}
                            >
                              <div className="text-sm">
                                {msg.text || msg.caption || `[${msg.type}]`}
                              </div>
                              <div className={`text-xs mt-1 ${
                                msg.direction === 'outbound' ? 'text-blue-100' : 'text-gray-500'
                              }`}>
                                {new Date(msg.createdAt).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Message Input */}
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Digite sua mensagem..."
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        className="flex-1"
                        rows={2}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            sendMessage()
                          }
                        }}
                      />
                      <Button
                        onClick={sendMessage}
                        disabled={!messageInput.trim() || sendingMessage || !selectedChannel}
                      >
                        {sendingMessage ? <Spinner className="w-4 h-4" /> : 'Enviar'}
                      </Button>
                    </div>
                    
                    {!selectedChannel && (
                      <Alert>
                        <Warning className="h-4 w-4" />
                        <AlertDescription>
                          Selecione um canal ativo para enviar mensagens.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[450px] text-gray-500">
                    Selecione uma conversa para começar
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Analytics e Métricas</CardTitle>
              <CardDescription>
                Visão geral do desempenho dos canais WhatsApp
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-green-600">
                      {orchestratorStatus?.connectedInstances || 0}
                    </div>
                    <div className="text-sm text-gray-600">Canais Conectados</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-blue-600">
                      {conversations.length}
                    </div>
                    <div className="text-sm text-gray-600">Conversas Ativas</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-purple-600">
                      {messages.length}
                    </div>
                    <div className="text-sm text-gray-600">Mensagens Hoje</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-orange-600">
                      {orchestratorStatus?.errorInstances || 0}
                    </div>
                    <div className="text-sm text-gray-600">Canais com Erro</div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* QR Code Dialog */}
      <Dialog open={qrDialogChannel !== null} onOpenChange={() => setQrDialogChannel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QR Code - Canal {qrDialogChannel}</DialogTitle>
            <DialogDescription>
              Escaneie o QR code abaixo com seu WhatsApp para conectar o canal
            </DialogDescription>
          </DialogHeader>
          
          {qrDialogChannel && channelQR.has(qrDialogChannel) && (
            <div className="flex flex-col items-center space-y-4">
              <div className="p-4 bg-white rounded-lg border">
                <img 
                  src={channelQR.get(qrDialogChannel)?.dataUrl} 
                  alt="QR Code" 
                  className="w-64 h-64"
                />
              </div>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (qrDialogChannel) {
                      const qrText = channelQR.get(qrDialogChannel)?.qr
                      if (qrText) {
                        navigator.clipboard.writeText(qrText)
                        toast.success("QR code copiado para a área de transferência")
                      }
                    }
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Copiar
                </Button>
                
                <Button
                  variant="outline"
                  onClick={() => qrDialogChannel && pollChannelQR(qrDialogChannel)}
                >
                  <ArrowClockwise className="w-4 h-4 mr-1" />
                  Atualizar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}