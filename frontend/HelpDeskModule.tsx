import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Label } from "@/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Textarea } from "@/textarea"
import {
  Ticket,
  Plus,
  Clock,
  User,
  Star,
  ChatCircle,
  Warning,
  CheckCircle,
  Eye,
  Envelope,
  ChartBar
} from "@phosphor-icons/react"

interface SupportTicket {
  id: string
  ticketNumber: string
  subject: string
  description: string
  customer: string
  customerEmail: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'in-progress' | 'waiting-customer' | 'resolved' | 'closed'
  category: 'technical' | 'billing' | 'general' | 'feature-request' | 'bug'
  assignedTo?: string
  createdDate: string
  lastUpdate: string
  resolution?: string
  satisfactionRating?: number
  communicationHistory: TicketCommunication[]
  tags: string[]
}

interface TicketCommunication {
  id: string
  type: 'note' | 'email' | 'phone' | 'chat'
  author: string
  content: string
  timestamp: string
  isInternal: boolean
}


export function HelpDeskModule() {
  const [activeTab, setActiveTab] = useState("tickets")

  // Sample data
  const [tickets, setTickets] = useKV<SupportTicket[]>("support-tickets", [
    {
      id: "ticket-001",
      ticketNumber: "SUP-2024-001",
      subject: "Problema de login no sistema",
      description: "Não consigo acessar minha conta no CRM após a atualização",
      customer: "João Silva",
      customerEmail: "joao.silva@empresa.com",
      priority: "high",
      status: "in-progress",
      category: "technical",
      assignedTo: "Ana Costa",
      createdDate: "2024-03-15",
      lastUpdate: "2024-03-20",
      communicationHistory: [
        {
          id: "comm-001",
          type: "note",
          author: "Ana Costa",
          content: "Analisando os logs de acesso. Parece ser um problema de permissões.",
          timestamp: "2024-03-20 14:30",
          isInternal: true
        }
      ],
      tags: ["login", "urgente"]
    },
    {
      id: "ticket-002",
      ticketNumber: "SUP-2024-002",
      subject: "Solicitação de nova funcionalidade",
      description: "Gostaria de solicitar a implementação de relatórios customizados",
      customer: "Maria Santos",
      customerEmail: "maria.santos@cliente.com",
      priority: "medium",
      status: "open",
      category: "feature-request",
      createdDate: "2024-03-18",
      lastUpdate: "2024-03-18",
      communicationHistory: [],
      tags: ["relatórios", "customização"]
    }
  ])

  const [showNewTicket, setShowNewTicket] = useState(false)
  const [newTicket, setNewTicket] = useState<Partial<SupportTicket>>({
    priority: 'medium',
    status: 'open',
    category: 'general',
    communicationHistory: [],
    tags: []
  })

  const createTicket = () => {
    if (newTicket.subject && newTicket.customer && newTicket.customerEmail) {
      const ticket: SupportTicket = {
        id: `ticket-${Date.now()}`,
        ticketNumber: `SUP-2024-${String(tickets.length + 1).padStart(3, '0')}`,
        subject: newTicket.subject,
        description: newTicket.description || '',
        customer: newTicket.customer,
        customerEmail: newTicket.customerEmail,
        priority: newTicket.priority as SupportTicket['priority'],
        status: 'open',
        category: newTicket.category as SupportTicket['category'],
        createdDate: new Date().toISOString().split('T')[0],
        lastUpdate: new Date().toISOString().split('T')[0],
        communicationHistory: [],
        tags: newTicket.tags || []
      }

      setTickets(current => [...current, ticket])
      setNewTicket({
        priority: 'medium',
        status: 'open',
        category: 'general',
        communicationHistory: [],
        tags: []
      })
      setShowNewTicket(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800'
      case 'in-progress': return 'bg-yellow-100 text-yellow-800'
      case 'waiting-customer': return 'bg-orange-100 text-orange-800'
      case 'resolved': case 'available': return 'bg-green-100 text-green-800'
      case 'closed': case 'offline': return 'bg-gray-100 text-gray-800'
      case 'busy': return 'bg-red-100 text-red-800'
      case 'away': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800'
      case 'high': return 'bg-orange-100 text-orange-800'
      case 'medium': return 'bg-yellow-100 text-yellow-800'
      case 'low': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getHelpDeskStats = () => {
    return {
      totalTickets: tickets.length,
      openTickets: tickets.filter(t => ['open', 'in-progress', 'waiting-customer'].includes(t.status)).length,
      resolvedToday: tickets.filter(t => t.status === 'resolved' && t.lastUpdate === new Date().toISOString().split('T')[0]).length,
      avgSatisfaction: tickets.filter(t => t.satisfactionRating).reduce((sum, t) => sum + (t.satisfactionRating || 0), 0) / tickets.filter(t => t.satisfactionRating).length || 0
    }
  }

  const stats = getHelpDeskStats()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Central de Suporte</h2>
          <p className="text-muted-foreground">
            Gestão completa de tickets, base de conhecimento e atendimento
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline">
            <ChartBar className="h-4 w-4 mr-2" />
            Relatórios
          </Button>
          <Button onClick={() => setShowNewTicket(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Ticket
          </Button>
        </div>
      </div>

      {/* Help Desk Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Ticket className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Tickets</p>
                <p className="text-2xl font-bold">{stats.totalTickets}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Warning className="h-8 w-8 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Tickets Abertos</p>
                <p className="text-2xl font-bold">{stats.openTickets}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Resolvidos Hoje</p>
                <p className="text-2xl font-bold">{stats.resolvedToday}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Star className="h-8 w-8 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Satisfação Média</p>
                <p className="text-2xl font-bold">{stats.avgSatisfaction.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="space-y-4">
          {showNewTicket && (
            <Card>
              <CardHeader>
                <CardTitle>Novo Ticket de Suporte</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="customer">Cliente</Label>
                    <Input
                      id="customer"
                      value={newTicket.customer || ''}
                      onChange={(e) => setNewTicket(prev => ({ ...prev, customer: e.target.value }))}
                      placeholder="Nome do cliente"
                    />
                  </div>
                  <div>
                    <Label htmlFor="customerEmail">E-mail do Cliente</Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      value={newTicket.customerEmail || ''}
                      onChange={(e) => setNewTicket(prev => ({ ...prev, customerEmail: e.target.value }))}
                      placeholder="cliente@email.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="priority">Prioridade</Label>
                    <Select value={newTicket.priority} onValueChange={(value) => setNewTicket(prev => ({ ...prev, priority: value as SupportTicket['priority'] }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Baixa</SelectItem>
                        <SelectItem value="medium">Média</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="urgent">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="category">Categoria</Label>
                    <Select value={newTicket.category} onValueChange={(value) => setNewTicket(prev => ({ ...prev, category: value as SupportTicket['category'] }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="technical">Técnico</SelectItem>
                        <SelectItem value="billing">Cobrança</SelectItem>
                        <SelectItem value="general">Geral</SelectItem>
                        <SelectItem value="feature-request">Nova Funcionalidade</SelectItem>
                        <SelectItem value="bug">Bug</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="subject">Assunto</Label>
                  <Input
                    id="subject"
                    value={newTicket.subject || ''}
                    onChange={(e) => setNewTicket(prev => ({ ...prev, subject: e.target.value }))}
                    placeholder="Descreva brevemente o problema"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Descrição</Label>
                  <Textarea
                    id="description"
                    value={newTicket.description || ''}
                    onChange={(e) => setNewTicket(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Descreva detalhadamente o problema ou solicitação"
                  />
                </div>
                <div className="flex space-x-2">
                  <Button onClick={createTicket}>Criar Ticket</Button>
                  <Button variant="outline" onClick={() => setShowNewTicket(false)}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            {tickets.map((ticket) => (
              <Card key={ticket.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{ticket.ticketNumber}</CardTitle>
                      <CardDescription>{ticket.subject}</CardDescription>
                    </div>
                    <div className="flex space-x-2">
                      <Badge className={getStatusColor(ticket.status)}>
                        {ticket.status}
                      </Badge>
                      <Badge className={getPriorityColor(ticket.priority)}>
                        {ticket.priority}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{ticket.description}</p>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Cliente:</p>
                      <p className="font-medium">{ticket.customer}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Categoria:</p>
                      <p className="font-medium">{ticket.category}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Criado em:</p>
                      <p className="font-medium">{ticket.createdDate}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Atualizado em:</p>
                      <p className="font-medium">{ticket.lastUpdate}</p>
                    </div>
                  </div>

                  {ticket.assignedTo && (
                    <div className="flex items-center space-x-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Atribuído a: {ticket.assignedTo}</span>
                    </div>
                  )}

                  {ticket.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {ticket.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex space-x-2">
                    <Button variant="outline" size="sm">
                      <Eye className="h-4 w-4 mr-2" />
                      Ver Detalhes
                    </Button>
                    <Button variant="outline" size="sm">
                      <ChatCircle className="h-4 w-4 mr-2" />
                      Responder
                    </Button>
                    {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
                      <Button size="sm">
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Resolver
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Tickets por Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {['open', 'in-progress', 'waiting-customer', 'resolved', 'closed'].map((status) => {
                    const count = tickets.filter(t => t.status === status).length
                    const percentage = (count / tickets.length) * 100

                    return (
                      <div key={status} className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Badge className={getStatusColor(status)} variant="outline">
                            {status}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{count}</p>
                          <p className="text-sm text-muted-foreground">{percentage.toFixed(1)}%</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tickets por Categoria</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {['technical', 'billing', 'general', 'feature-request', 'bug'].map((category) => {
                    const count = tickets.filter(t => t.category === category).length
                    const percentage = (count / tickets.length) * 100

                    return (
                      <div key={category} className="flex items-center justify-between">
                        <span className="font-medium">{category}</span>
                        <div className="text-right">
                          <p className="font-medium">{count}</p>
                          <p className="text-sm text-muted-foreground">{percentage.toFixed(1)}%</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
