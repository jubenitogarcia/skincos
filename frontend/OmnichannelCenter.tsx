import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { Button } from "@/button"
import { Input } from "@/input"
import { ScrollArea } from "@/scroll-area"
import { Textarea } from "@/textarea"
import { getRelativeTime } from "@/utils"
import {
  Phone,
  Envelope,
  WhatsappLogo,
  InstagramLogo,
  FacebookLogo,
  ChatCircle,
  VideoCamera,
  CalendarBlank,
  User,
  Clock,
  CheckCircle,
  Warning,
  Sparkle
} from "@phosphor-icons/react"
import type { Activity } from "@/types"

interface OmnichannelCenterProps {
  activities: Activity[]
  onStartConversation?: (channel: string, customerId: string) => void
}

export function OmnichannelCenter({ activities, onStartConversation }: OmnichannelCenterProps) {
  const [provider, setProvider] = useState<string | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null)
  const [conversations, setConversations] = useState<any[]>([])
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messageInput, setMessageInput] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/wa-orchestrator/status')
      const data = await res.json()
      if (!res.ok || data?.success === false) return
      setProvider(data?.provider || null)
      if (data?.channels?.length) {
        const preferred = data.channels.find((c) => c.status === 'connected') || data.channels[0]
        if (preferred?.channel) setSelectedChannel(preferred.channel)
      }
    } catch {
      // ignore
    }
  }, [])

  const loadConversations = useCallback(async () => {
    if (!provider) return
    setLoadingConversations(true)
    try {
      if (provider === 'evolution') {
        if (!selectedChannel) return
        const res = await fetch(`/api/wa-orchestrator/channels/${selectedChannel}/conversations?limit=200`)
        const data = await res.json()
        if (res.ok && data?.success) {
          setConversations(data.items || [])
        }
      } else {
        const res = await fetch('/api/conversations')
        const data = await res.json()
        if (res.ok) {
          setConversations(data?.items || data || [])
        }
      }
    } finally {
      setLoadingConversations(false)
    }
  }, [provider, selectedChannel])

  const loadMessages = useCallback(async (conv: any) => {
    if (!provider || !conv) return
    setLoadingMessages(true)
    try {
      if (provider === 'evolution') {
        if (!selectedChannel) return
        const res = await fetch(`/api/wa-orchestrator/channels/${selectedChannel}/conversations/${encodeURIComponent(conv.conversationId)}/messages?limit=80`)
        const data = await res.json()
        if (res.ok && data?.success) {
          setMessages(data.items || [])
        }
      } else {
        const res = await fetch(`/api/conversations/${encodeURIComponent(conv.conversationId)}/messages?limit=80`)
        const data = await res.json()
        if (res.ok) {
          setMessages(data.items || [])
        }
      }
    } finally {
      setLoadingMessages(false)
    }
  }, [provider, selectedChannel])

  const sendMessage = useCallback(async () => {
    if (!selectedConversation || !messageInput.trim()) return
    setSendingMessage(true)
    try {
      if (provider === 'evolution') {
        if (!selectedChannel) return
        const res = await fetch(`/api/wa-orchestrator/channels/${selectedChannel}/conversations/${encodeURIComponent(selectedConversation.conversationId)}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: messageInput })
        })
        await res.json().catch(() => ({}))
      } else {
        const res = await fetch(`/api/conversations/${encodeURIComponent(selectedConversation.conversationId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction: 'outbound', type: 'text', text: messageInput })
        })
        await res.json().catch(() => ({}))
      }
      setMessageInput('')
      loadMessages(selectedConversation)
    } finally {
      setSendingMessage(false)
    }
  }, [loadMessages, messageInput, provider, selectedChannel, selectedConversation])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  const filteredConversations = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()
    if (!term) return conversations
    return conversations.filter((conv) => {
      const searchable = [
        conv.name,
        conv.phone,
        conv.profile,
        conv.platform || conv.channel || conv.type || (provider === 'evolution' ? 'whatsapp' : provider),
        conv.conversationId
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return searchable.includes(term)
    })
  }, [conversations, searchQuery, provider])

  const getPlatformIcon = (platform?: string) => {
    const normalized = String(platform || '').toLowerCase()
    if (normalized.includes('instagram')) return <InstagramLogo className="h-4 w-4 text-pink-300" />
    if (normalized.includes('facebook') || normalized.includes('messenger')) return <FacebookLogo className="h-4 w-4 text-blue-300" />
    return <WhatsappLogo className="h-4 w-4 text-emerald-300" />
  }

  const renderOmnichannelChat = () => (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-white">Omnichannel</CardTitle>
        <CardDescription className="text-blue-100/70">
          Central única com WhatsApp, Instagram e Facebook
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Input
            placeholder="Buscar por nome, telefone, perfil ou plataforma"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[600px]">
          <Card className="glass-card lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-white">Conversas</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {loadingConversations && (
                    <div className="text-sm text-blue-100/60 py-4 text-center">Carregando conversas...</div>
                  )}
                  {!loadingConversations && filteredConversations.length === 0 && (
                    <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-4 py-6 text-center">
                      <div className="text-sm text-blue-100/70">Nenhuma conversa ainda.</div>
                      <div className="text-xs text-blue-100/50 mt-2">
                        Conecte WhatsApp, Instagram ou Facebook para começar a receber mensagens aqui.
                      </div>
                    </div>
                  )}
                  {filteredConversations.map((conv) => (
                    <div
                      key={conv.conversationId}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-white/5 ${
                        selectedConversation?.conversationId === conv.conversationId ? 'border-blue-500/70 bg-blue-500/15' : 'border-white/10'
                      }`}
                      onClick={() => {
                        setSelectedConversation(conv)
                        loadMessages(conv)
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-1">{getPlatformIcon(conv.platform || conv.channel || conv.type)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-white truncate">
                            {conv.name || conv.conversationId}
                          </div>
                          <div className="text-xs text-blue-100/70 truncate mt-1">
                            {conv.lastMessage || 'Sem mensagens'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="glass-card lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-white">
                {selectedConversation ? selectedConversation.name || selectedConversation.conversationId : 'Selecione uma conversa'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedConversation ? (
                <div className="space-y-4">
                  <ScrollArea className="h-[400px] border border-white/10 rounded-lg p-4">
                    <div className="space-y-3">
                      {loadingMessages && (
                        <div className="text-sm text-blue-100/60 text-center py-4">Carregando mensagens...</div>
                      )}
                      {messages.map((msg) => {
                        const outbound = msg.direction === 'outbound' || msg.direction === 'human'
                        return (
                          <div key={msg.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[70%] p-3 rounded-lg ${outbound ? 'bg-blue-500/40 text-white' : 'bg-white/10 text-blue-100'}`}>
                              <div className="text-sm">
                                {msg.text || msg.caption || `[${msg.type}]`}
                              </div>
                              <div className={`text-xs mt-1 ${outbound ? 'text-blue-100/80' : 'text-blue-100/60'}`}>
                                {new Date(msg.createdAt).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </ScrollArea>

                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Digite sua mensagem..."
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          sendMessage()
                        }
                      }}
                    />
                    <Button onClick={sendMessage} disabled={!messageInput.trim() || sendingMessage}>
                      {sendingMessage ? '...' : 'Enviar'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[450px]">
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-6 py-6 text-center max-w-sm">
                    <div className="text-sm text-blue-100/70">Nenhuma conversa selecionada</div>
                    <div className="text-xs text-blue-100/50 mt-2">
                      As mensagens aparecerão aqui assim que as contas estiverem conectadas.
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )

  if (!activities || activities.length === 0) {
    return (
      <div className="space-y-6">
        {renderOmnichannelChat()}
      </div>
    )
  }

  const getChannelIcon = (type: Activity['type']) => {
    switch (type) {
      case 'call': return <Phone className="h-4 w-4" />
      case 'email': return <Envelope className="h-4 w-4" />
      case 'whatsapp': return <WhatsappLogo className="h-4 w-4" />
      case 'sms': return <ChatCircle className="h-4 w-4" />
      case 'meeting': return <VideoCamera className="h-4 w-4" />
      default: return <ChatCircle className="h-4 w-4" />
    }
  }

  const getChannelColor = (type: Activity['type']) => {
    switch (type) {
      case 'call': return 'text-blue-600 bg-blue-50'
      case 'email': return 'text-green-600 bg-green-50'
      case 'whatsapp': return 'text-green-700 bg-green-100'
      case 'sms': return 'text-purple-600 bg-purple-50'
      case 'meeting': return 'text-orange-600 bg-orange-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getOutcomeIcon = (outcome?: string) => {
    if (!outcome) return null
    if (outcome.toLowerCase().includes('positivo') || outcome.toLowerCase().includes('sucesso')) {
      return <CheckCircle className="h-4 w-4 text-green-600" />
    }
    if (outcome.toLowerCase().includes('atenção') || outcome.toLowerCase().includes('problema')) {
      return <Warning className="h-4 w-4 text-yellow-600" />
    }
    return <Clock className="h-4 w-4 text-blue-600" />
  }

  const recentActivities = activities
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)

  const channelStats = {
    call: activities.filter(a => a.type === 'call').length,
    email: activities.filter(a => a.type === 'email').length,
    whatsapp: activities.filter(a => a.type === 'whatsapp').length,
    sms: activities.filter(a => a.type === 'sms').length,
    meeting: activities.filter(a => a.type === 'meeting').length
  }

  return (
    <div className="space-y-6">
      {/* Channel Statistics */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Sparkle className="h-5 w-5 text-accent ai-processing" />
            <CardTitle>Central Omnichannel</CardTitle>
            <Badge variant="secondary">Tempo Real</Badge>
          </div>
          <CardDescription>
            Gestão unificada de todos os canais de comunicação
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4">
            <div className="text-center">
              <div className="p-3 rounded-lg bg-blue-50 text-blue-600 mx-auto w-fit mb-2">
                <Phone className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.call}</div>
              <div className="text-xs text-muted-foreground">Chamadas</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-green-50 text-green-600 mx-auto w-fit mb-2">
                <Envelope className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.email}</div>
              <div className="text-xs text-muted-foreground">E-mails</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-green-100 text-green-700 mx-auto w-fit mb-2">
                <WhatsappLogo className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.whatsapp}</div>
              <div className="text-xs text-muted-foreground">WhatsApp</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-purple-50 text-purple-600 mx-auto w-fit mb-2">
                <ChatCircle className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.sms}</div>
              <div className="text-xs text-muted-foreground">SMS</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-orange-50 text-orange-600 mx-auto w-fit mb-2">
                <VideoCamera className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.meeting}</div>
              <div className="text-xs text-muted-foreground">Reuniões</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {renderOmnichannelChat()}

      {/* Quick Actions */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Ações Rápidas</CardTitle>
          <CardDescription>
            Inicie conversas em qualquer canal com um clique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('call', '')}
            >
              <Phone className="h-5 w-5 text-blue-600" />
              <span className="text-xs">Nova Chamada</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('email', '')}
            >
              <Envelope className="h-5 w-5 text-green-600" />
              <span className="text-xs">Novo E-mail</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('whatsapp', '')}
            >
              <WhatsappLogo className="h-5 w-5 text-green-700" />
              <span className="text-xs">WhatsApp</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('sms', '')}
            >
              <ChatCircle className="h-5 w-5 text-purple-600" />
              <span className="text-xs">SMS</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('meeting', '')}
            >
              <CalendarBlank className="h-5 w-5 text-orange-600" />
              <span className="text-xs">Agendar</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Interactions */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Interações Recentes</CardTitle>
          <CardDescription>
            Timeline unificado de todas as comunicações
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActivities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className={`p-2 rounded-lg ${getChannelColor(activity.type)}`}>
                  {getChannelIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium text-sm truncate">{activity.title}</h4>
                    <div className="flex items-center space-x-2">
                      {getOutcomeIcon(activity.outcome)}
                      <span className="text-xs text-muted-foreground">
                        {getRelativeTime(activity.date)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {activity.description}
                  </p>
                  <div className="flex items-center space-x-4 text-xs">
                    <div className="flex items-center space-x-1">
                      <User className="h-3 w-3" />
                      <span>{activity.createdBy}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Badge variant="outline" className="text-xs px-2 py-0">
                        {activity.channel}
                      </Badge>
                    </div>
                    {activity.duration && (
                      <div className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>{activity.duration}min</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Insights */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Sparkle className="h-5 w-5 text-accent ai-processing" />
            <CardTitle>Insights de Comunicação</CardTitle>
            <Badge variant="secondary" className="ai-processing">IA</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center space-x-2 mb-1">
                <Phone className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-800 text-sm">Melhor Horário</span>
              </div>
              <p className="text-xs text-blue-700">
                Chamadas realizadas entre 14h-16h têm 40% mais taxa de atendimento
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center space-x-2 mb-1">
                <WhatsappLogo className="h-4 w-4 text-green-700" />
                <span className="font-medium text-green-800 text-sm">Canal Preferido</span>
              </div>
              <p className="text-xs text-green-700">
                67% dos clientes preferem WhatsApp para primeiros contatos
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
              <div className="flex items-center space-x-2 mb-1">
                <CalendarBlank className="h-4 w-4 text-orange-600" />
                <span className="font-medium text-orange-800 text-sm">Follow-up</span>
              </div>
              <p className="text-xs text-orange-700">
                5 clientes precisam de follow-up nos próximos 2 dias
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
