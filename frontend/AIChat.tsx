import { useState, useEffect, useRef } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Input } from "@/input"
import { Badge } from "@/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import {
  Robot,
  User,
  PaperPlaneTilt,
  Lightning,
  Brain,
  MagnifyingGlass,
  Phone,
  VideoCamera,
  Paperclip,
  Smiley,
  Circle,
  CheckCircle,
  Clock,
  Plus
} from "@phosphor-icons/react"

interface ChatMessage {
  id: string
  conversationId: string
  sender: 'user' | 'ai' | 'agent'
  content: string
  timestamp: Date
  type: 'text' | 'file' | 'image'
  metadata?: {
    aiConfidence?: number
    escalated?: boolean
    sentiment?: 'positive' | 'neutral' | 'negative'
    intent?: string
  }
}

interface Conversation {
  id: string
  customerId?: string
  customerName: string
  customerEmail?: string
  status: 'active' | 'resolved' | 'escalated' | 'pending'
  channel: 'chat' | 'whatsapp' | 'email' | 'phone'
  lastMessage: string
  lastPulse: Date
  assignedAgent?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  tags: string[]
  aiHandled: boolean
}

// DEPRECATED: This component has been superseded by features merged into WhatsAppBusinessHub.
// Keeping for reference during migration; not mounted in App.
export function AIChat() {
  const [conversations, setConversations] = useKV<Conversation[]>('chat-conversations', [])
  const [messages, setMessages] = useKV<ChatMessage[]>('chat-messages', [])
  const [activeConversation, setActiveConversation] = useState<string | null>(null)
  const [newMessage, setNewMessage] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [aiMode, setAiMode] = useState<'auto' | 'assist' | 'off'>('auto')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Mock initial conversations
  useEffect(() => {
    if (conversations.length === 0) {
      const mockConversations: Conversation[] = [
        {
          id: 'conv-1',
          customerId: '1',
          customerName: 'João Silva',
          customerEmail: 'joao@empresa.com',
          status: 'active',
          channel: 'chat',
          lastMessage: 'Preciso de ajuda com minha conta',
          lastPulse: new Date(),
          priority: 'medium',
          tags: ['suporte', 'conta'],
          aiHandled: true
        },
        {
          id: 'conv-2',
          customerName: 'Maria Santos',
          customerEmail: 'maria@startup.com',
          status: 'pending',
          channel: 'whatsapp',
          lastMessage: 'Quando posso agendar uma demo?',
          lastPulse: new Date(Date.now() - 1000 * 60 * 30),
          priority: 'high',
          tags: ['vendas', 'demo'],
          aiHandled: false
        }
      ]
      setConversations(mockConversations)
    }

    if (messages.length === 0) {
      const mockMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          sender: 'user',
          content: 'Olá, preciso de ajuda com minha conta',
          timestamp: new Date(Date.now() - 1000 * 60 * 10),
          type: 'text'
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          sender: 'ai',
          content: 'Olá! Sou o assistente inteligente do CRM. Posso ajudar você com sua conta. Qual específicamente é a dúvida?',
          timestamp: new Date(Date.now() - 1000 * 60 * 9),
          type: 'text',
          metadata: {
            aiConfidence: 0.95,
            sentiment: 'positive',
            intent: 'support_request'
          }
        }
      ]
      setMessages(mockMessages)
    }
  }, [conversations.length, messages.length, setConversations, setMessages])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const activeMessages = messages.filter(msg => msg.conversationId === activeConversation)

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !activeConversation) return

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      conversationId: activeConversation,
      sender: 'user',
      content: newMessage,
      timestamp: new Date(),
      type: 'text'
    }
  }

  const generateAIResponse = async (text: string) => {
    const lower = text.toLowerCase()
    const sentiment: 'positive' | 'neutral' | 'negative' =
      lower.includes('erro') || lower.includes('problema') || lower.includes('não') ? 'negative'
        : lower.includes('obrigado') || lower.includes('valeu') ? 'positive'
          : 'neutral'

    const intent = lower.includes('conta') || lower.includes('senha') ? 'account_support'
      : lower.includes('demo') || lower.includes('apresentação') ? 'sales_inquiry'
        : 'general_support'

    const canned = intent === 'account_support'
      ? 'Posso te ajudar com sua conta. Você poderia confirmar o e-mail cadastrado e descrever o que precisa alterar?'
      : intent === 'sales_inquiry'
        ? 'Ótimo! Podemos agendar uma demonstração. Quais dias/horários funcionam melhor para você esta semana?'
        : 'Entendi. Vou analisar sua solicitação e já retorno com os próximos passos. Se puder, compartilhe mais detalhes.'

    return {
      content: canned,
      confidence: 0.8 + Math.random() * 0.15,
      sentiment,
      intent
    }
  }

  const escalateToHuman = (conversationId: string) => {
    setConversations(current =>
      current.map(conv =>
        conv.id === conversationId
          ? { ...conv, status: 'escalated', assignedAgent: 'Agente Humano' }
          : conv
      )
    )

    const escalationMessage: ChatMessage = {
      id: `msg-${Date.now()}-escalation`,
      conversationId,
      sender: 'ai',
      content: '🤝 Transferindo para um agente humano. Você será atendido em breve por um especialista.',
      timestamp: new Date(),
      type: 'text',
      metadata: {
        escalated: true
      }
    }

    setMessages(current => [...current, escalationMessage])
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200'
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'medium': return 'bg-blue-100 text-blue-800 border-blue-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <Circle className="h-3 w-3 text-green-500 fill-current" />
      case 'resolved': return <CheckCircle className="h-3 w-3 text-blue-500" />
      case 'escalated': return <Clock className="h-3 w-3 text-orange-500" />
      default: return <Circle className="h-3 w-3 text-gray-400" />
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Chat Inteligente</h2>
          <p className="text-muted-foreground">
            Atendimento em tempo real com IA integrada
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="ai-processing">
            <Brain className="h-3 w-3 mr-1" />
            IA {aiMode === 'auto' ? 'Ativa' : aiMode === 'assist' ? 'Assistindo' : 'Desligada'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const modes: typeof aiMode[] = ['auto', 'assist', 'off']
              const currentIndex = modes.indexOf(aiMode)
              setAiMode(modes[(currentIndex + 1) % modes.length])
            }}
          >
            <Robot className="h-4 w-4 mr-2" />
            Alternar IA
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[600px]">
        {/* Conversations List */}
        <Card className="glass-card lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Conversas Ativas</CardTitle>
            <div className="relative">
              <MagnifyingGlass className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar conversas..." className="pl-8 text-xs" />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 overflow-y-auto">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`p-3 rounded-lg border cursor-pointer transition-all hover:bg-accent/5 ${activeConversation === conversation.id
                  ? 'bg-accent/10 border-accent'
                  : 'bg-background border-border'
                  }`}
                onClick={() => setActiveConversation(conversation.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {conversation.customerName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-sm truncate">
                      {conversation.customerName}
                    </span>
                  </div>
                  {getStatusIcon(conversation.status)}
                </div>

                <p className="text-xs text-muted-foreground truncate mb-2">
                  {conversation.lastMessage}
                </p>

                <div className="flex items-center justify-between">
                  <Badge className={`text-xs px-2 py-0 ${getPriorityColor(conversation.priority)}`}>
                    {conversation.priority}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(conversation.lastPulse).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>

                {conversation.aiHandled && (
                  <div className="flex items-center mt-2">
                    <Robot className="h-3 w-3 text-accent mr-1" />
                    <span className="text-xs text-accent">IA Ativa</span>
                  </div>
                )}
              </div>
            ))}

            {conversations.length === 0 && (
              <div className="text-center py-8">
                <Robot className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma conversa ativa
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chat Area */}
        <Card className="glass-card lg:col-span-3">
          {activeConversation ? (
            <div className="flex flex-col h-full">
              {/* Chat Header */}
              <CardHeader className="border-b pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>
                        {conversations.find(c => c.id === activeConversation)?.customerName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold">
                        {conversations.find(c => c.id === activeConversation)?.customerName}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {conversations.find(c => c.id === activeConversation)?.customerEmail}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm">
                      <Phone className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm">
                      <VideoCamera className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => escalateToHuman(activeConversation)}
                    >
                      <User className="h-4 w-4 mr-2" />
                      Transferir
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {/* Messages */}
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex message-in ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[70%] chat-message ${message.sender === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : message.sender === 'ai'
                        ? 'bg-accent/10 text-foreground border border-accent/20'
                        : 'bg-muted text-foreground'
                      } rounded-lg p-3`}>
                      {message.sender !== 'user' && (
                        <div className="flex items-center space-x-2 mb-2">
                          {message.sender === 'ai' ? (
                            <Robot className="h-4 w-4 text-accent" />
                          ) : (
                            <User className="h-4 w-4 text-primary" />
                          )}
                          <span className="text-xs font-medium">
                            {message.sender === 'ai' ? 'Assistente IA' : 'Agente'}
                          </span>
                          {message.metadata?.aiConfidence && (
                            <Badge
                              variant="outline"
                              className={`text-xs px-1 py-0 ${message.metadata.aiConfidence > 0.8 ? 'confidence-high' :
                                message.metadata.aiConfidence > 0.6 ? 'confidence-medium' :
                                  'confidence-low'
                                }`}
                            >
                              {Math.round(message.metadata.aiConfidence * 100)}%
                            </Badge>
                          )}
                        </div>
                      )}

                      <p className="text-sm">{message.content}</p>

                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs opacity-70">
                          {message.timestamp.toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>

                        {message.metadata?.sentiment && (
                          <Badge
                            variant="outline"
                            className={`text-xs px-1 py-0 ${message.metadata.sentiment === 'positive' ? 'text-green-600' :
                              message.metadata.sentiment === 'negative' ? 'text-red-600' :
                                'text-gray-600'
                              }`}
                          >
                            {message.metadata.sentiment}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {isTyping && (
                  <div className="flex justify-start message-in">
                    <div className="bg-muted rounded-lg p-3 max-w-[70%]">
                      <div className="flex items-center space-x-2">
                        <Robot className="h-4 w-4 text-accent ai-processing" />
                        <span className="text-sm">IA está digitando...</span>
                        <div className="flex space-x-1">
                          <div className="w-1 h-1 bg-accent rounded-full typing-dot"></div>
                          <div className="w-1 h-1 bg-accent rounded-full typing-dot"></div>
                          <div className="w-1 h-1 bg-accent rounded-full typing-dot"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </CardContent>

              {/* Message Input */}
              <div className="border-t p-4">
                <div className="flex items-center space-x-2">
                  <Button variant="outline" size="sm">
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    <Smiley className="h-4 w-4" />
                  </Button>
                  <Input
                    placeholder="Digite sua mensagem..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!newMessage.trim()}
                    className="px-6"
                  >
                    <PaperPlaneTilt className="h-4 w-4" />
                  </Button>
                </div>

                {aiMode === 'auto' && (
                  <div className="flex items-center mt-2 text-xs text-muted-foreground">
                    <Lightning className="h-3 w-3 mr-1 text-accent" />
                    IA responderá automaticamente
                  </div>
                )}
              </div>
            </div>
          ) : (
            <CardContent className="flex items-center justify-center h-full">
              <div className="text-center">
                <Robot className="h-12 w-12 text-muted-foreground mx-auto mb-4 ai-processing" />
                <h3 className="text-lg font-semibold mb-2">Chat Inteligente</h3>
                <p className="text-muted-foreground mb-4">
                  Selecione uma conversa para começar o atendimento
                </p>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Conversa
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {/* AI Insights Panel */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Brain className="h-5 w-5 text-accent ai-processing" />
            <span>Insights da IA</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="analytics" className="space-y-4">
            <TabsList>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
              <TabsTrigger value="sentiment">Sentimentos</TabsTrigger>
              <TabsTrigger value="suggestions">Sugestões</TabsTrigger>
            </TabsList>

            <TabsContent value="analytics" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="font-medium text-blue-800">Conversas Hoje</h4>
                  <p className="text-2xl font-bold text-blue-900">{conversations.length}</p>
                  <p className="text-sm text-blue-600">+12% vs ontem</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <h4 className="font-medium text-green-800">Resolvidas por IA</h4>
                  <p className="text-2xl font-bold text-green-900">
                    {Math.round((conversations.filter(c => c.aiHandled).length / conversations.length) * 100)}%
                  </p>
                  <p className="text-sm text-green-600">+8% vs ontem</p>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <h4 className="font-medium text-orange-800">Tempo Médio</h4>
                  <p className="text-2xl font-bold text-orange-900">2.3min</p>
                  <p className="text-sm text-orange-600">-15% vs ontem</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <h4 className="font-medium text-purple-800">Satisfação</h4>
                  <p className="text-2xl font-bold text-purple-900">94.2%</p>
                  <p className="text-sm text-purple-600">+3% vs ontem</p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="sentiment">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                  <span className="font-medium text-green-800">Sentimento Positivo</span>
                  <span className="text-2xl font-bold text-green-900">68%</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <span className="font-medium text-gray-800">Sentimento Neutro</span>
                  <span className="text-2xl font-bold text-gray-900">24%</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg">
                  <span className="font-medium text-red-800">Sentimento Negativo</span>
                  <span className="text-2xl font-bold text-red-900">8%</span>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="suggestions">
              <div className="space-y-3">
                <div className="p-4 bg-accent/5 rounded-lg border border-accent/20">
                  <h4 className="font-medium text-accent-foreground mb-2">Otimização Detectada</h4>
                  <p className="text-sm text-muted-foreground">
                    Adicionar FAQ sobre "reset de senha" pode reduzir 23% das consultas de suporte.
                  </p>
                </div>
                <div className="p-4 bg-accent/5 rounded-lg border border-accent/20">
                  <h4 className="font-medium text-accent-foreground mb-2">Padrão Identificado</h4>
                  <p className="text-sm text-muted-foreground">
                    Clientes perguntam sobre integração às quintas-feiras. Considere enviar newsletter semanal.
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
