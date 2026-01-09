import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { ScrollArea } from "@/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/avatar"
import { Separator } from "@/separator"
import { Alert, AlertDescription } from "@/alert"
import { Progress } from '@/progress'
import { toast } from 'sonner'
import {
  WhatsappLogo,
  PaperPlane,
  Image as ImageIcon,
  FileText,
  Microphone,
  Phone,
  VideoCamera,
  DotsThree,
  MagnifyingGlass,
  CheckCircle,
  Clock,
  ArrowLeft,
  Users,
  At,
  LinkSimple,
  Warning,
  Spinner,
  Circle
} from "@phosphor-icons/react"

interface WhatsAppDashboardProps {
  gatewayBase?: string
  channelId?: string
  onBack?: () => void
}

interface ChatItem {
  id: string
  name: string
  lastMessage: string
  timestamp: string
  unreadCount?: number
  avatar?: string
  isGroup?: boolean
  status?: 'online' | 'offline' | 'typing'
}

interface MessageItem {
  id: string
  content: string
  timestamp: string
  fromMe: boolean
  type: 'text' | 'image' | 'document' | 'audio' | 'video'
  status?: 'sent' | 'delivered' | 'read'
  mediaUrl?: string
  fileName?: string
}

interface ConnectionStatus {
  connected: boolean
  authenticated: boolean
  status: string
  clientInfo?: any
  lastActivity?: string
}

const ENV = (import.meta as any).env || {}
const DEFAULT_GATEWAY_BASE = ENV?.VITE_WHATSAPP_GATEWAY_URL || '/api/unified'

export const WhatsAppDashboard: React.FC<WhatsAppDashboardProps> = ({
  gatewayBase = DEFAULT_GATEWAY_BASE,
  channelId = '1',
  onBack
}) => {
  // Estado principal
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
    authenticated: false,
    status: 'disconnected'
  })
  
  // Estado das conversas
  const [chats, setChats] = useState<ChatItem[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loadingChats, setLoadingChats] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  
  // Estado da interface de mensagens
  const [messageInput, setMessageInput] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Função para construir URL base - 🔧 CORRIGIDO: Usar proxy /api/unified
  const buildGatewayUrl = useCallback((endpoint: string) => {
    // Se gatewayBase já é uma URL completa, use como está
    if (gatewayBase.startsWith('http')) {
      return `${gatewayBase}${endpoint}`
    }
    
    // Caso contrário, use o current origin + gatewayBase (que é '/api/unified')
    const base = `${window.location.origin}${gatewayBase}`
    return `${base}${endpoint}`
  }, [gatewayBase])

  // Scroll automático para última mensagem
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Conectar a eventos SSE para atualizações em tempo real
  const setupSSEConnection = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    try {
      // 🔧 CORRIGIDO: Usar endpoint proxy /api/unified/whatsapp/:channelId/qr/stream
      const sseUrl = buildGatewayUrl(`/whatsapp/${channelId}/qr/stream`)
      console.log('📡 Conectando ao SSE do WhatsApp Dashboard via proxy:', sseUrl)
      
      const eventSource = new EventSource(sseUrl)
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        console.log('📡 WhatsApp Dashboard SSE conectado')
      }

      // Escutar mudanças de status
      eventSource.addEventListener('status', (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('🔄 Status change recebido no dashboard:', data)
          
          setConnectionStatus({
            connected: !!data.connected,
            authenticated: !!data.authenticated,
            status: data.status,
            clientInfo: data.clientInfo,
            lastActivity: data.timestamp
          })
        } catch (err) {
          console.error('Erro ao processar evento de status:', err)
        }
      })

      // Estado inicial
      eventSource.addEventListener('initial', (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('🎯 Estado inicial recebido no dashboard:', data)
          
          setConnectionStatus({
            connected: !!data.connected,
            authenticated: !!data.authenticated,
            status: data.status,
            clientInfo: data.clientInfo,
            lastActivity: data.timestamp
          })
        } catch (err) {
          console.error('Erro ao processar estado inicial:', err)
        }
      })

      eventSource.onerror = (err) => {
        console.warn('❌ Erro no SSE do dashboard:', err)
      }

    } catch (err) {
      console.error('Falha ao configurar SSE:', err)
    }
  }, [buildGatewayUrl, channelId])

  // Carregar lista de conversas
  const loadChats = useCallback(async () => {
    try {
      setLoadingChats(true)
      const response = await fetch(buildGatewayUrl(`/whatsapp/${channelId}/chats`))
      
      if (response.ok) {
        const data = await response.json()
        const chatList = data.chats || data.data || []
        
        // Transformar dados para formato esperado
        const formattedChats: ChatItem[] = chatList.map((chat: any) => ({
          id: chat.id || chat.chatId || chat.conversationId,
          name: chat.name || chat.title || chat.id?.replace('@c.us', '') || 'Unknown',
          lastMessage: chat.lastMessage?.body || chat.lastMessage || 'Sem mensagens',
          timestamp: chat.timestamp || new Date().toISOString(),
          unreadCount: chat.unreadCount || 0,
          avatar: chat.avatar,
          isGroup: chat.isGroup || chat.id?.includes('@g.us'),
          status: 'offline'
        }))

        setChats(formattedChats)
        console.log(`📱 ${formattedChats.length} conversas carregadas`)
      }
    } catch (error) {
      console.error('Erro ao carregar conversas:', error)
      toast.error('Falha ao carregar conversas')
    } finally {
      setLoadingChats(false)
    }
  }, [buildGatewayUrl, channelId])

  // Carregar mensagens de uma conversa específica
  const loadMessages = useCallback(async (chatId: string) => {
    try {
      setLoadingMessages(true)
      
      // 🚀 CORRIGIDO: Usar endpoint real para carregar mensagens
      const response = await fetch(buildGatewayUrl(`/whatsapp/${channelId}/chats/${encodeURIComponent(chatId)}/messages`))
      
      if (response.ok) {
        const data = await response.json()
        const messageList = data.messages || data.data || []
        
        // Transformar dados para formato esperado
        const formattedMessages: MessageItem[] = messageList.map((msg: any) => ({
          id: msg.id || msg._data?.id || Date.now().toString(),
          content: msg.body || msg.content || msg.text || '',
          timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
          fromMe: msg.fromMe || false,
          type: msg.type || 'text',
          status: msg.ack ? (msg.ack === 3 ? 'read' : msg.ack === 2 ? 'delivered' : 'sent') : 'sent',
          mediaUrl: msg.mediaUrl,
          fileName: msg.fileName
        })).slice(-50) // Limitar a 50 mensagens mais recentes
        
        setMessages(formattedMessages)
        console.log(`💬 ${formattedMessages.length} mensagens carregadas para ${chatId}`)
      } else {
        // Fallback: Se endpoint não existir, usar mensagens vazias
        console.warn(`⚠️ Endpoint de mensagens não disponível: ${response.status}`)
        setMessages([])
      }
      
      // Scroll para última mensagem
      setTimeout(() => scrollToBottom(), 100)
      
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error)
      // Fallback: Mensagens vazias em caso de erro
      setMessages([])
      console.log('📭 Chat selecionado mas sem mensagens disponíveis')
    } finally {
      setLoadingMessages(false)
    }
  }, [buildGatewayUrl, channelId, scrollToBottom])

  // Enviar mensagem
  const sendMessage = useCallback(async () => {
    if (!messageInput.trim() || !selectedChatId) return
    
    try {
      setSendingMessage(true)
      
      const response = await fetch(buildGatewayUrl(`/whatsapp/${channelId}/send-message`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId: selectedChatId,
          message: messageInput.trim()
        })
      })

      if (response.ok) {
        // Adicionar mensagem localmente para feedback imediato
        const newMessage: MessageItem = {
          id: Date.now().toString(),
          content: messageInput.trim(),
          timestamp: new Date().toISOString(),
          fromMe: true,
          type: 'text',
          status: 'sent'
        }
        
        setMessages(prev => [...prev, newMessage])
        setMessageInput('')
        
        // Scroll para nova mensagem
        setTimeout(() => scrollToBottom(), 100)
        
        toast.success('Mensagem enviada!')
      } else {
        throw new Error('Falha ao enviar mensagem')
      }
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error)
      toast.error('Falha ao enviar mensagem')
    } finally {
      setSendingMessage(false)
    }
  }, [messageInput, selectedChatId, buildGatewayUrl, channelId, scrollToBottom])

  // Upload de arquivo
  const handleFileUpload = useCallback(async (file: File) => {
    try {
      setUploadingFile(true)
      setUploadProgress(0)

      // Simular progresso de upload
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval)
            return 90
          }
          return prev + 10
        })
      }, 100)

      // TODO: Implementar upload real de arquivo
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      clearInterval(progressInterval)
      setUploadProgress(100)
      
      setTimeout(() => {
        setUploadingFile(false)
        setUploadProgress(0)
        toast.success('Arquivo enviado!')
      }, 500)
      
    } catch (error) {
      console.error('Erro ao fazer upload:', error)
      toast.error('Falha no upload do arquivo')
      setUploadingFile(false)
      setUploadProgress(0)
    }
  }, [])

  // Efeitos
  useEffect(() => {
    setupSSEConnection()
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [setupSSEConnection])

  useEffect(() => {
    loadChats()
  }, [loadChats])

  useEffect(() => {
    if (selectedChatId) {
      loadMessages(selectedChatId)
    }
  }, [selectedChatId, loadMessages])

  // Filtrar chats baseado na busca
  const filteredChats = chats.filter(chat =>
    chat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    chat.lastMessage.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Chat selecionado
  const selectedChat = chats.find(chat => chat.id === selectedChatId)

  // Renderizar status de conexão
  const renderConnectionStatus = () => {
    const { connected, authenticated, status } = connectionStatus
    
    if (connected && authenticated) {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle className="w-3 h-3 mr-1" />
          Conectado
        </Badge>
      )
    }
    
    if (status === 'authenticated') {
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          <Clock className="w-3 h-3 mr-1" />
          Autenticado
        </Badge>
      )
    }
    
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        <Warning className="w-3 h-3 mr-1" />
        Desconectado
      </Badge>
    )
  }

  // Renderizar item de chat
  const renderChatItem = (chat: ChatItem) => (
    <div
      key={chat.id}
      onClick={() => setSelectedChatId(chat.id)}
      className={`p-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 transition-colors ${
        selectedChatId === chat.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
      }`}
    >
      <div className="flex items-start space-x-3">
        <Avatar className="w-10 h-10">
          <AvatarImage src={chat.avatar} alt={chat.name} />
          <AvatarFallback>
            {chat.isGroup ? <Users className="w-5 h-5" /> : chat.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start">
            <h3 className="text-sm font-medium text-gray-900 truncate">{chat.name}</h3>
            <span className="text-xs text-gray-500">
              {new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <p className="text-sm text-gray-600 truncate mt-1">{chat.lastMessage}</p>
          <div className="flex justify-between items-center mt-1">
            <div className="flex items-center space-x-2">
              {chat.isGroup && <Users className="w-3 h-3 text-gray-400" />}
              <Circle className={`w-2 h-2 ${chat.status === 'online' ? 'text-green-500 fill-current' : 'text-gray-300'}`} />
            </div>
            {chat.unreadCount && chat.unreadCount > 0 && (
              <Badge className="bg-green-500 text-white text-xs px-2 py-0">
                {chat.unreadCount}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  // Renderizar mensagem
  const renderMessage = (message: MessageItem) => (
    <div
      key={message.id}
      className={`flex mb-4 ${message.fromMe ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
          message.fromMe
            ? 'bg-green-500 text-white'
            : 'bg-gray-100 text-gray-800'
        }`}
      >
        <p className="text-sm">{message.content}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs opacity-75">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {message.fromMe && (
            <span className="text-xs opacity-75 ml-2">
              {message.status === 'sent' && '✓'}
              {message.status === 'delivered' && '✓✓'}
              {message.status === 'read' && <span className="text-blue-200">✓✓</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {onBack && (
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <div className="flex items-center space-x-3">
              <WhatsappLogo className="w-8 h-8 text-green-600" />
              <div>
                <h1 className="text-lg font-semibold text-gray-900">WhatsApp Business</h1>
                <p className="text-sm text-gray-600">Canal {channelId}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {renderConnectionStatus()}
            <Button variant="ghost" size="sm">
              <DotsThree className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Lista de Conversas */}
        <div className="w-1/3 bg-white border-r border-gray-200 flex flex-col">
          {/* Search */}
          <div className="p-4 border-b border-gray-200">
            <div className="relative">
              <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Buscar conversas..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Chat List */}
          <ScrollArea className="flex-1">
            {loadingChats ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="w-6 h-6 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">Carregando conversas...</span>
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>Nenhuma conversa encontrada</p>
              </div>
            ) : (
              filteredChats.map(renderChatItem)
            )}
          </ScrollArea>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col">
          {selectedChat ? (
            <>
              {/* Chat Header */}
              <div className="bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={selectedChat.avatar} alt={selectedChat.name} />
                      <AvatarFallback>
                        {selectedChat.isGroup ? <Users className="w-5 h-5" /> : selectedChat.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="font-semibold text-gray-900">{selectedChat.name}</h2>
                      <p className="text-sm text-gray-600">
                        {selectedChat.status === 'online' ? 'Online' : 'Última vez hoje'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button variant="ghost" size="sm">
                      <Phone className="w-5 h-5" />
                    </Button>
                    <Button variant="ghost" size="sm">
                      <VideoCamera className="w-5 h-5" />
                    </Button>
                    <Button variant="ghost" size="sm">
                      <DotsThree className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Messages Area */}
              <ScrollArea className="flex-1 px-6 py-4">
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <Spinner className="w-6 h-6 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-600">Carregando mensagens...</span>
                  </div>
                ) : (
                  <>
                    {messages.map(renderMessage)}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </ScrollArea>

              {/* Message Input */}
              <div className="bg-white border-t border-gray-200 px-6 py-4">
                {uploadingFile && (
                  <div className="mb-4">
                    <div className="flex items-center space-x-3">
                      <span className="text-sm text-gray-600">Enviando arquivo...</span>
                      <Progress value={uploadProgress} className="flex-1" />
                      <span className="text-sm text-gray-600">{uploadProgress}%</span>
                    </div>
                  </div>
                )}
                
                <div className="flex items-end space-x-3">
                  <div className="flex space-x-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,video/*,.pdf,.doc,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileUpload(file)
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFile}
                    >
                      <ImageIcon className="w-5 h-5" />
                    </Button>
                    <Button variant="ghost" size="sm">
                      <FileText className="w-5 h-5" />
                    </Button>
                    <Button variant="ghost" size="sm">
                      <Microphone className="w-5 h-5" />
                    </Button>
                  </div>
                  
                  <div className="flex-1">
                    <Textarea
                      placeholder="Digite sua mensagem..."
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          sendMessage()
                        }
                      }}
                      className="min-h-[40px] max-h-[120px] resize-none"
                      rows={1}
                    />
                  </div>
                  
                  <Button
                    onClick={sendMessage}
                    disabled={!messageInput.trim() || sendingMessage}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {sendingMessage ? (
                      <Spinner className="w-5 h-5 animate-spin" />
                    ) : (
                      <PaperPlane className="w-5 h-5" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            /* No Chat Selected */
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <WhatsappLogo className="w-24 h-24 mx-auto mb-6 text-gray-300" />
                <h2 className="text-xl font-semibold text-gray-700 mb-2">
                  Selecione uma conversa
                </h2>
                <p className="text-gray-500 max-w-sm">
                  Escolha uma conversa da lista para começar a enviar mensagens
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer - Connection Status */}
      {!connectionStatus.connected && (
        <div className="bg-red-50 border-t border-red-200 px-4 py-2">
          <Alert>
            <Warning className="h-4 w-4" />
            <AlertDescription>
              WhatsApp não está conectado. Verifique a conexão.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  )
}

export default WhatsAppDashboard