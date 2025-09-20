import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Plus, Users, Phone, Envelope, Building, Target, TrendUp, Funnel, MagnifyingGlass, DotsThree, Eye, PencilSimple, Trash, Star, Clock, CurrencyDollar, User, MapPin } from "@phosphor-icons/react"
import { toast } from 'sonner'

interface Lead {
  id: string
  title: string
  firstName: string
  lastName: string
  company: string
  jobTitle: string
  email: string
  phone: string
  website?: string
  address: {
    street: string
    city: string
    state: string
    zipCode: string
    country: string
  }
  leadSource: 'website' | 'referral' | 'social-media' | 'email-campaign' | 'cold-call' | 'trade-show' | 'partner'
  leadStatus: 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'closed-won' | 'closed-lost'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  estimatedValue: number
  probability: number
  expectedCloseDate: string
  assignedTo: string
  tags: string[]
  notes: string
  customFields: Record<string, any>
  activities: Pulse[]
  score: number
  createdAt: string
  updatedAt: string
}

interface Pulse {
  id: string
  type: 'call' | 'email' | 'meeting' | 'task' | 'note'
  subject: string
  description: string
  date: string
  duration?: number
  outcome?: string
  followUp?: string
  userId: string
}

const defaultLead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'> = {
  title: 'Mr',
  firstName: '',
  lastName: '',
  company: '',
  jobTitle: '',
  email: '',
  phone: '',
  website: '',
  address: {
    street: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'Brasil'
  },
  leadSource: 'website',
  leadStatus: 'new',
  priority: 'medium',
  estimatedValue: 0,
  probability: 10,
  expectedCloseDate: '',
  assignedTo: 'user-1',
  tags: [],
  notes: '',
  customFields: {},
  activities: [],
  score: 0
}

const leadSources = [
  { value: 'website', label: 'Website', color: 'bg-blue-100 text-blue-800' },
  { value: 'referral', label: 'Indicação', color: 'bg-green-100 text-green-800' },
  { value: 'social-media', label: 'Redes Sociais', color: 'bg-purple-100 text-purple-800' },
  { value: 'email-campaign', label: 'E-mail Marketing', color: 'bg-orange-100 text-orange-800' },
  { value: 'cold-call', label: 'Cold Call', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'trade-show', label: 'Feira/Evento', color: 'bg-pink-100 text-pink-800' },
  { value: 'partner', label: 'Parceiro', color: 'bg-indigo-100 text-indigo-800' }
]

const leadStatuses = [
  { value: 'new', label: 'Novo', color: 'bg-gray-100 text-gray-800' },
  { value: 'contacted', label: 'Contatado', color: 'bg-blue-100 text-blue-800' },
  { value: 'qualified', label: 'Qualificado', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'proposal', label: 'Proposta', color: 'bg-purple-100 text-purple-800' },
  { value: 'negotiation', label: 'Negociação', color: 'bg-orange-100 text-orange-800' },
  { value: 'closed-won', label: 'Fechado-Ganho', color: 'bg-green-100 text-green-800' },
  { value: 'closed-lost', label: 'Fechado-Perdido', color: 'bg-red-100 text-red-800' }
]

const priorities = [
  { value: 'low', label: 'Baixa', color: 'bg-gray-100 text-gray-600' },
  { value: 'medium', label: 'Média', color: 'bg-blue-100 text-blue-600' },
  { value: 'high', label: 'Alta', color: 'bg-orange-100 text-orange-600' },
  { value: 'urgent', label: 'Urgente', color: 'bg-red-100 text-red-600' }
]

export function LeadsManager() {
  const [leads, setLeads] = useKV<Lead[]>('krayin-leads', [])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [editingLead, setEditingLead] = useState<Partial<Lead> | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [searchQuery, setMagnifyingGlassQuery] = useState('')
  const [statusFunnel, setStatusFunnel] = useState<string>('all')
  const [sourceFunnel, setSourceFunnel] = useState<string>('all')
  const [priorityFunnel, setPriorityFunnel] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activityDrawerLead, setActivityDrawerLead] = useState<Lead | null>(null)
  const [lastDmPoll, setLastDmPoll] = useState<string | null>(null)
  const DM_POLL_INTERVAL = 15000

  // Ingest leads vindos do Instagram (localStorage + evento)
  useEffect(() => {
    const key = 'new-instagram-leads'
    // Consumir backlog ao montar
    try {
      const backlog = JSON.parse(localStorage.getItem(key) || '[]')
      if (backlog.length) {
        backlog.forEach((l: any) => createLead(l))
        localStorage.removeItem(key)
      }
    } catch { /* noop */ }

    const handler = (e: any) => {
      const data = e.detail
      if (data) createLead(data)
    }
    window.addEventListener('lead:new', handler as any)
    // Listener para novas mensagens DM convertidas em atividades
    const dmHandler = (e: any) => {
      const { userId, text } = e.detail || {}
      if (!userId || !text) return
      setLeads(prev => prev.map(l => l.website?.includes(userId) || l.tags.includes('instagram') ? ({
        ...l,
        activities: [
          ...l.activities,
          {
            id: 'act-' + Date.now(),
            type: 'note',
            subject: 'DM Instagram',
            description: text,
            date: new Date().toISOString(),
            userId: 'system'
          }
        ]
      }) : l))
    }
    window.addEventListener('instagram:dm', dmHandler as any)
    // Listener para mensagens WhatsApp
    const waHandler = (e: any) => {
      const { phone, text, timestamp } = e.detail || {}
      if (!phone || !text) return
      setLeads(prev => prev.map(l => l.phone === phone || l.tags.includes('whatsapp') ? ({
        ...l,
        activities: [
          ...l.activities,
          {
            id: 'act-' + Date.now(),
            type: 'note',
            subject: 'Mensagem WhatsApp',
            description: text,
            date: timestamp || new Date().toISOString(),
            userId: 'contact'
          }
        ]
      }) : l))
    }
    window.addEventListener('whatsapp:message', waHandler as any)
    return () => {
      window.removeEventListener('lead:new', handler as any)
      window.removeEventListener('instagram:dm', dmHandler as any)
      window.removeEventListener('whatsapp:message', waHandler as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll periódico do endpoint /api/dm (mock) para reconciliação de mensagens => atividades
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch('http://localhost:7070/api/dm')
        if (!res.ok) return
        const data = await res.json()
        const msgs: any[] = data.messages || []
        // Filtrar somente mensagens novas após lastDmPoll
        const newMsgs = msgs.filter(m => !lastDmPoll || new Date(m.timestamp || m.created_time || Date.now()).toISOString() > lastDmPoll)
        if (newMsgs.length) {
          // Reconciliation: evita duplicar se atividade já existe (match hash simples)
          setLeads(prev => prev.map(lead => {
            if (!lead.tags.includes('instagram')) return lead
            const existingHashes = new Set(lead.activities.map(a => a.description + a.date))
            const addActs = newMsgs
              .filter(m => m.from && (lead.website?.includes(m.from) || lead.tags.includes('instagram')))
              .filter(m => !existingHashes.has((m.text || m.message) + (m.timestamp || m.created_time)))
              .map(m => ({
                id: 'act-' + (m.id || Date.now() + Math.random()),
                type: 'note' as const,
                subject: 'DM Instagram',
                description: m.text || m.message || '',
                date: new Date(m.timestamp || m.created_time || Date.now()).toISOString(),
                userId: m.from === 'me' ? 'user-1' : 'contact'
              }))
            if (!addActs.length) return lead
            return { ...lead, activities: [...lead.activities, ...addActs] }
          }))
          const latestTs = newMsgs.map(m => new Date(m.timestamp || m.created_time || Date.now()).toISOString()).sort().slice(-1)[0]
          setLastDmPoll(latestTs)
        }
      } catch { }
      if (!cancelled) setTimeout(poll, DM_POLL_INTERVAL)
    }
    poll()
    return () => { cancelled = true }
  }, [DM_POLL_INTERVAL, lastDmPoll, setLeads])

  // Calculate lead metrics
  const totalLeads = leads.length
  const qualifiedLeads = leads.filter(lead => ['qualified', 'proposal', 'negotiation'].includes(lead.leadStatus)).length
  const closedWonLeads = leads.filter(lead => lead.leadStatus === 'closed-won').length
  const conversionRate = totalLeads > 0 ? (closedWonLeads / totalLeads * 100) : 0
  const totalValue = leads.filter(lead => lead.leadStatus === 'closed-won').reduce((sum, lead) => sum + lead.estimatedValue, 0)
  const avgLeadScore = leads.length > 0 ? leads.reduce((sum, lead) => sum + lead.score, 0) / leads.length : 0

  // Funnel leads
  const filteredLeads = leads.filter(lead => {
    const matchesMagnifyingGlass =
      lead.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.email.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = statusFunnel === 'all' || lead.leadStatus === statusFunnel
    const matchesSource = sourceFunnel === 'all' || lead.leadSource === sourceFunnel
    const matchesPriority = priorityFunnel === 'all' || lead.priority === priorityFunnel

    return matchesMagnifyingGlass && matchesStatus && matchesSource && matchesPriority
  })

  const createLead = (leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newLead: Lead = {
      ...leadData,
      id: `lead-${Date.now()}`,
      score: calculateLeadScore(leadData),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    setLeads(currentLeads => [...currentLeads, newLead])
    if (!(leadData as any).__silent) {
      toast.success('Lead criado com sucesso!')
      setIsCreateDialogOpen(false)
    }
  }

  const updateLead = (leadId: string, updates: Partial<Lead>) => {
    setLeads(currentLeads =>
      currentLeads.map(lead =>
        lead.id === leadId
          ? {
            ...lead,
            ...updates,
            score: calculateLeadScore({ ...lead, ...updates }),
            updatedAt: new Date().toISOString()
          }
          : lead
      )
    )
    toast.success('Lead atualizado com sucesso!')
    setIsEditDialogOpen(false)
    setEditingLead(null)
  }

  const deleteLead = (leadId: string) => {
    setLeads(currentLeads => currentLeads.filter(lead => lead.id !== leadId))
    toast.success('Lead removido com sucesso!')
  }

  // Calculate lead score based on Krayin-style scoring
  const calculateLeadScore = (lead: Partial<Lead>): number => {
    let score = 0

    // Basic information completeness
    if (lead.firstName) score += 10
    if (lead.lastName) score += 10
    if (lead.email) score += 15
    if (lead.phone) score += 15
    if (lead.company) score += 20
    if (lead.jobTitle) score += 10

    // Lead quality indicators
    if (lead.estimatedValue && lead.estimatedValue > 0) score += 20
    if (lead.leadSource === 'referral') score += 15
    if (lead.leadSource === 'website') score += 10

    // Engagement indicators
    if (lead.activities && lead.activities.length > 0) score += 10
    if (lead.activities && lead.activities.length > 3) score += 10

    // Priority weighting
    if (lead.priority === 'high') score += 10
    if (lead.priority === 'urgent') score += 15

    return Math.min(score, 100)
  }

  const getSourceInfo = (source: string) => {
    return leadSources.find(s => s.value === source) || leadSources[0]
  }

  const getStatusInfo = (status: string) => {
    return leadStatuses.find(s => s.value === status) || leadStatuses[0]
  }

  const getPriorityInfo = (priority: string) => {
    return priorities.find(p => p.value === priority) || priorities[0]
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gestão de Leads</h2>
          <p className="text-muted-foreground">
            Sistema avançado de leads baseado no Krayin CRM
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Lead
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total de Leads</p>
                <p className="text-2xl font-bold">{totalLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Target className="h-4 w-4 text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Qualificados</p>
                <p className="text-2xl font-bold">{qualifiedLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Taxa Conversão</p>
                <p className="text-2xl font-bold">{conversionRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CurrencyDollar className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Valor Total</p>
                <p className="text-2xl font-bold">R$ {(totalValue / 1000).toFixed(0)}K</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Star className="h-4 w-4 text-orange-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Score Médio</p>
                <p className="text-2xl font-bold">{avgLeadScore.toFixed(0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnels */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar leads..."
                  value={searchQuery}
                  onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <Select value={statusFunnel} onValueChange={setStatusFunnel}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Status</SelectItem>
                {leadStatuses.map(status => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sourceFunnel} onValueChange={setSourceFunnel}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Origem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Origens</SelectItem>
                {leadSources.map(source => (
                  <SelectItem key={source.value} value={source.value}>
                    {source.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={priorityFunnel} onValueChange={setPriorityFunnel}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {priorities.map(priority => (
                  <SelectItem key={priority.value} value={priority.value}>
                    {priority.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm">
              <Funnel className="h-4 w-4 mr-2" />
              Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Leads Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredLeads.map((lead) => {
          const sourceInfo = getSourceInfo(lead.leadSource)
          const statusInfo = getStatusInfo(lead.leadStatus)
          const priorityInfo = getPriorityInfo(lead.priority)

          return (
            <Card key={lead.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">
                      {lead.firstName} {lead.lastName}
                    </CardTitle>
                    <CardDescription>
                      {lead.jobTitle} at {lead.company}
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Badge variant="outline" className={priorityInfo.color}>
                      {priorityInfo.label}
                    </Badge>
                    <Button variant="ghost" size="sm">
                      <DotsThree className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setActivityDrawerLead(lead)}>Atividades</Button>
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-2">
                  <Badge variant="outline" className={sourceInfo.color}>
                    {sourceInfo.label}
                  </Badge>
                  <Badge variant="outline" className={statusInfo.color}>
                    {statusInfo.label}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center space-x-2 text-sm">
                    <Envelope className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{lead.email}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{lead.phone}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{lead.company}</span>
                  </div>
                  {lead.estimatedValue > 0 && (
                    <div className="flex items-center space-x-2 text-sm">
                      <CurrencyDollar className="h-4 w-4 text-green-600" />
                      <span>R$ {lead.estimatedValue.toLocaleString()}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Lead Score</span>
                    <span className="font-medium">{lead.score}/100</span>
                  </div>
                  <Progress value={lead.score} className="h-2" />
                </div>

                {/* Timeline compacta de atividades (últimas 3) */}
                {lead.activities && lead.activities.length > 0 && (
                  <div className="space-y-1 text-xs mt-2">
                    <p className="font-medium text-muted-foreground">Atividades recentes</p>
                    <div className="space-y-1 max-h-20 overflow-auto pr-1">
                      {lead.activities.slice(-3).reverse().map(a => (
                        <div key={a.id} className="flex items-start gap-2">
                          <span className="mt-0.5 text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 capitalize">{a.type}</span>
                          <div className="flex-1 leading-tight">
                            <span className="block truncate">{a.subject || a.description?.slice(0, 40)}</span>
                            <span className="text-[10px] text-muted-foreground">{new Date(a.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setSelectedLead(lead)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Ver
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setEditingLead(lead)
                      setIsEditDialogOpen(true)
                    }}
                  >
                    <PencilSimple className="h-4 w-4 mr-2" />
                    Editar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Create Lead Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar Novo Lead</DialogTitle>
            <DialogDescription>
              Adicione um novo lead ao seu pipeline de vendas
            </DialogDescription>
          </DialogHeader>

          <LeadForm
            lead={defaultLead}
            onSave={createLead}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Lead Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Lead</DialogTitle>
            <DialogDescription>
              Atualize as informações do lead
            </DialogDescription>
          </DialogHeader>

          {editingLead && (
            <LeadForm
              lead={editingLead}
              onSave={(leadData) => updateLead(editingLead.id!, leadData)}
              onCancel={() => {
                setEditingLead(null)
                setIsEditDialogOpen(false)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Drawer de Atividades completas */}
      <Drawer open={!!activityDrawerLead} onOpenChange={(o) => { if (!o) setActivityDrawerLead(null) }}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>Atividades - {activityDrawerLead?.firstName} {activityDrawerLead?.lastName}</DrawerTitle>
            <DrawerDescription>Linha do tempo completa de interações e DMs reconciliadas</DrawerDescription>
          </DrawerHeader>
          <div className="p-4 space-y-4 overflow-auto">
            {activityDrawerLead?.activities.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(act => (
              <div key={act.id} className="border-l-2 pl-3 relative">
                <span className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-blue-600" />
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{act.subject}</p>
                  <span className="text-xs text-muted-foreground">{new Date(act.date).toLocaleString('pt-BR')}</span>
                </div>
                <p className="text-xs mt-1 whitespace-pre-wrap">{act.description}</p>
              </div>
            ))}
            {(!activityDrawerLead || activityDrawerLead.activities.length === 0) && (
              <p className="text-sm text-muted-foreground">Sem atividades.</p>
            )}
          </div>
          <div className="p-4 border-t flex justify-end">
            <Button variant="outline" onClick={() => setActivityDrawerLead(null)}>Fechar</Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

interface LeadFormProps {
  lead: Partial<Lead>
  onSave: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => void
  onCancel: () => void
}

function LeadForm({ lead, onSave, onCancel }: LeadFormProps) {
  const [formData, setFormData] = useState<Partial<Lead>>(lead)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData as Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>)
  }

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const updateAddressField = (field: string, value: string) => {
    setFormData(prev => {
      const base = prev.address || { street: '', city: '', state: '', zipCode: '', country: 'Brasil' }
      return { ...prev, address: { ...base, [field]: value } }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">Informações Básicas</TabsTrigger>
          <TabsTrigger value="contact">Contato</TabsTrigger>
          <TabsTrigger value="sales">Vendas</TabsTrigger>
          <TabsTrigger value="additional">Adicional</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Título</Label>
              <Select value={formData.title} onValueChange={(value) => updateField('title', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mr">Sr.</SelectItem>
                  <SelectItem value="Mrs">Sra.</SelectItem>
                  <SelectItem value="Ms">Srta.</SelectItem>
                  <SelectItem value="Dr">Dr.</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="firstName">Nome *</Label>
              <Input
                id="firstName"
                value={formData.firstName || ''}
                onChange={(e) => updateField('firstName', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Sobrenome *</Label>
              <Input
                id="lastName"
                value={formData.lastName || ''}
                onChange={(e) => updateField('lastName', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company">Empresa *</Label>
              <Input
                id="company"
                value={formData.company || ''}
                onChange={(e) => updateField('company', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jobTitle">Cargo</Label>
              <Input
                id="jobTitle"
                value={formData.jobTitle || ''}
                onChange={(e) => updateField('jobTitle', e.target.value)}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="contact" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email || ''}
                onChange={(e) => updateField('email', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                value={formData.phone || ''}
                onChange={(e) => updateField('phone', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={formData.website || ''}
              onChange={(e) => updateField('website', e.target.value)}
            />
          </div>

          <div className="space-y-4">
            <Label>Endereço</Label>
            <div className="grid grid-cols-1 gap-4">
              <Input
                placeholder="Rua, número"
                value={formData.address?.street || ''}
                onChange={(e) => updateAddressField('street', e.target.value)}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  placeholder="Cidade"
                  value={formData.address?.city || ''}
                  onChange={(e) => updateAddressField('city', e.target.value)}
                />
                <Input
                  placeholder="Estado"
                  value={formData.address?.state || ''}
                  onChange={(e) => updateAddressField('state', e.target.value)}
                />
                <Input
                  placeholder="CEP"
                  value={formData.address?.zipCode || ''}
                  onChange={(e) => updateAddressField('zipCode', e.target.value)}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sales" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="leadSource">Origem do Lead</Label>
              <Select value={formData.leadSource} onValueChange={(value) => updateField('leadSource', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leadSources.map(source => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="leadStatus">Status</Label>
              <Select value={formData.leadStatus} onValueChange={(value) => updateField('leadStatus', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leadStatuses.map(status => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority">Prioridade</Label>
              <Select value={formData.priority} onValueChange={(value) => updateField('priority', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorities.map(priority => (
                    <SelectItem key={priority.value} value={priority.value}>
                      {priority.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimatedValue">Valor Estimado (R$)</Label>
              <Input
                id="estimatedValue"
                type="number"
                value={formData.estimatedValue || 0}
                onChange={(e) => updateField('estimatedValue', Number(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="probability">Probabilidade (%)</Label>
              <Input
                id="probability"
                type="number"
                min="0"
                max="100"
                value={formData.probability || 10}
                onChange={(e) => updateField('probability', Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expectedCloseDate">Data Esperada de Fechamento</Label>
            <Input
              id="expectedCloseDate"
              type="date"
              value={formData.expectedCloseDate || ''}
              onChange={(e) => updateField('expectedCloseDate', e.target.value)}
            />
          </div>
        </TabsContent>

        <TabsContent value="additional" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              rows={4}
              value={formData.notes || ''}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Adicione observações sobre este lead..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (separadas por vírgula)</Label>
            <Input
              id="tags"
              value={formData.tags?.join(', ') || ''}
              onChange={(e) => updateField('tags', e.target.value.split(',').map(tag => tag.trim()).filter(Boolean))}
              placeholder="cliente-vip, quente, follow-up"
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end space-x-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">
          Salvar Lead
        </Button>
      </div>
    </form>
  )
}
