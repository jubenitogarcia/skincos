import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Label } from "@/label"
import { Switch } from "@/switch"
import { Separator } from "@/separator"
import { ScrollArea } from "@/scroll-area"
import {
  Plus,
  Envelope,
  Eye,
  Copy,
  PencilSimple,
  Trash,
  PaperPlaneRight,
  Code,
  Palette,
  FileText,
  Star,
  Clock,
  Users,
  ChartBar,
  Gear,
  Sparkle,
  Image,
  Link as LinkIcon,
  TextT,
  Layout
} from "@phosphor-icons/react"
import { toast } from 'sonner'
import { LoadingPercentText } from '@/LoadingPattern'
import { htmlToPlainText } from '@/contentSanitization'

interface EmailTemplate {
  id: string
  name: string
  subject: string
  category: 'lead-nurturing' | 'welcome' | 'follow-up' | 'promotional' | 'transactional' | 'newsletter' | 'automation'
  type: 'html' | 'text' | 'mixed'
  content: {
    html: string
    text: string
  }
  variables: TemplateVariable[]
  settings: {
    fromName: string
    fromEmail: string
    replyTo?: string
    trackOpens: boolean
    trackClicks: boolean
    enableUnsubscribe: boolean
  }
  design: {
    backgroundColor: string
    textColor: string
    linkColor: string
    buttonColor: string
    fontFamily: string
    headerImage?: string
    footerText: string
  }
  analytics: {
    sent: number
    opened: number
    clicked: number
    unsubscribed: number
    bounced: number
    openRate: number
    clickRate: number
  }
  isActive: boolean
  isDefault: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
  lastUsed?: string
}

interface TemplateVariable {
  name: string
  label: string
  type: 'text' | 'number' | 'date' | 'url' | 'email'
  defaultValue?: string
  required: boolean
  description?: string
}

const defaultTemplate: Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  subject: '',
  category: 'lead-nurturing',
  type: 'html',
  content: {
    html: '',
    text: ''
  },
  variables: [],
  settings: {
    fromName: 'CRM Inteligente',
    fromEmail: 'noreply@empresa.com',
    trackOpens: true,
    trackClicks: true,
    enableUnsubscribe: true
  },
  design: {
    backgroundColor: '#ffffff',
    textColor: '#333333',
    linkColor: '#2563eb',
    buttonColor: '#2563eb',
    fontFamily: 'Inter, sans-serif',
    footerText: 'Enviado por CRM Inteligente'
  },
  analytics: {
    sent: 0,
    opened: 0,
    clicked: 0,
    unsubscribed: 0,
    bounced: 0,
    openRate: 0,
    clickRate: 0
  },
  isActive: true,
  isDefault: false,
  tags: []
}

const templateCategories = [
  { value: 'lead-nurturing', label: 'Nutrição de Leads', color: 'bg-blue-100 text-blue-800' },
  { value: 'welcome', label: 'Boas-vindas', color: 'bg-green-100 text-green-800' },
  { value: 'follow-up', label: 'Follow-up', color: 'bg-orange-100 text-orange-800' },
  { value: 'promotional', label: 'Promocional', color: 'bg-purple-100 text-purple-800' },
  { value: 'transactional', label: 'Transacional', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'newsletter', label: 'Newsletter', color: 'bg-indigo-100 text-indigo-800' },
  { value: 'automation', label: 'Automação', color: 'bg-pink-100 text-pink-800' }
]

const commonVariables = [
  { name: 'first_name', label: 'Nome', type: 'text', description: 'Nome do destinatário' },
  { name: 'last_name', label: 'Sobrenome', type: 'text', description: 'Sobrenome do destinatário' },
  { name: 'company', label: 'Empresa', type: 'text', description: 'Nome da empresa' },
  { name: 'email', label: 'E-mail', type: 'email', description: 'E-mail do destinatário' },
  { name: 'phone', label: 'Telefone', type: 'text', description: 'Telefone do destinatário' },
  { name: 'opportunity_value', label: 'Valor da Oportunidade', type: 'number', description: 'Valor da oportunidade em reais' },
  { name: 'due_date', label: 'Data de Vencimento', type: 'date', description: 'Data de vencimento ou prazo' },
  { name: 'unsubscribe_url', label: 'URL de Descadastro', type: 'url', description: 'Link para descadastro' }
]

const prebuiltTemplates = [
  {
    name: 'Welcome Email',
    subject: 'Bem-vindo(a) à {{company}}!',
    category: 'welcome',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Inter, sans-serif;">
        <h1 style="color: #2563eb;">Olá {{first_name}}!</h1>
        <p>Bem-vindo(a) à nossa plataforma. Estamos muito felizes em tê-lo(a) conosco.</p>
        <p>Para começar, aqui estão alguns recursos que podem interessar:</p>
        <ul>
          <li>Dashboard personalizado</li>
          <li>Relatórios em tempo real</li>
          <li>Suporte 24/7</li>
        </ul>
        <a href="#" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Começar Agora
        </a>
      </div>
    `
  },
  {
    name: 'Follow-up Lead',
    subject: 'Continuando nossa conversa, {{first_name}}',
    category: 'follow-up',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Inter, sans-serif;">
        <h2 style="color: #2563eb;">Olá {{first_name}},</h2>
        <p>Espero que esteja bem! Queria dar continuidade à nossa conversa sobre {{opportunity_value}}.</p>
        <p>Baseado no que conversamos, acredito que nossa solução pode trazer os seguintes benefícios para {{company}}:</p>
        <ul>
          <li>Aumento de 30% na produtividade</li>
          <li>Redução de custos operacionais</li>
          <li>Melhor experiência do cliente</li>
        </ul>
        <p>Que tal agendarmos uma demonstração? Tenho disponibilidade para {{due_date}}.</p>
        <a href="#" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Agendar Demonstração
        </a>
      </div>
    `
  },
  {
    name: 'Newsletter Mensal',
    subject: 'Newsletter {{company}} - Novidades do Mês',
    category: 'newsletter',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Inter, sans-serif;">
        <h1 style="color: #2563eb; text-align: center;">Newsletter {{company}}</h1>
        <h2>Novidades deste Mês</h2>
        <p>Olá {{first_name}}, confira as principais novidades:</p>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>🚀 Nova Funcionalidade</h3>
          <p>Lançamos o dashboard de IA com insights preditivos.</p>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 className="flex items-center gap-2">
            <img src="/icons/chart.png" alt="" aria-hidden className="h-5 w-5" />
            Relatório de Performance
          </h3>
          <p>Seus resultados melhoraram 25% no último mês!</p>
        </div>

        <p style="text-align: center;">
          <a href="{{unsubscribe_url}}" style="color: #6b7280; font-size: 12px;">Descadastrar</a>
        </p>
      </div>
    `
  }
]

export function EmailTemplatesManager() {
  // Local state (persisted via backend REST endpoints instead de useKV mock)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<Partial<EmailTemplate> | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [searchQuery, setMagnifyingGlassQuery] = useState('')
  const [categoryFunnel, setCategoryFunnel] = useState<string>('all')

  // Funnel templates
  const filteredTemplates = templates.filter(template => {
    const matchesMagnifyingGlass = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.subject.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = categoryFunnel === 'all' || template.category === categoryFunnel
    return matchesMagnifyingGlass && matchesCategory
  })

  // Calculate metrics
  const totalTemplates = templates.length
  const activeTemplates = templates.filter(t => t.isActive).length
  const totalSent = templates.reduce((sum, t) => sum + t.analytics.sent, 0)
  const avgOpenRate = templates.length > 0
    ? templates.reduce((sum, t) => sum + t.analytics.openRate, 0) / templates.length
    : 0

  // Backend helpers
  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/email/templates')
      if (!res.ok) throw new Error('Falha ao carregar templates')
      const data = await res.json()
      setTemplates(data)
    } catch (e: any) {
      setError(e.message)
      toast.error(e.message)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  const createTemplate = async (templateData: Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const res = await fetch('/api/email/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(templateData) })
      if (!res.ok) throw new Error('Falha ao criar template')
      const data = await res.json()
      setTemplates(prev => [...prev, data.template])
      toast.success('Template criado com sucesso!')
      setIsCreateDialogOpen(false)
    } catch (e: any) { toast.error(e.message) }
  }

  const updateTemplate = async (templateId: string, updates: Partial<EmailTemplate>) => {
    try {
      const res = await fetch(`/api/email/templates/${templateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
      if (!res.ok) throw new Error('Falha ao atualizar template')
      const data = await res.json()
      setTemplates(prev => prev.map(t => t.id === templateId ? data.template : t))
      toast.success('Template atualizado com sucesso!')
      setIsEditDialogOpen(false)
      setEditingTemplate(null)
    } catch (e: any) { toast.error(e.message) }
  }

  const deleteTemplate = async (templateId: string) => {
    if (!confirm('Remover template?')) return
    try {
      const res = await fetch(`/api/email/templates/${templateId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Falha ao remover template')
      setTemplates(prev => prev.filter(t => t.id !== templateId))
      toast.success('Template removido com sucesso!')
    } catch (e: any) { toast.error(e.message) }
  }

  const duplicateTemplate = async (template: EmailTemplate) => {
    try {
      const res = await fetch(`/api/email/templates/${template.id}/duplicate`, { method: 'POST' })
      if (!res.ok) throw new Error('Falha ao duplicar template')
      const data = await res.json()
      setTemplates(prev => [...prev, data.template])
      toast.success('Template duplicado com sucesso!')
    } catch (e: any) { toast.error(e.message) }
  }

  const sendTest = async (templateId: string) => {
    try {
      const res = await fetch(`/api/email/templates/${templateId}/send-test`, { method: 'POST' })
      if (!res.ok) throw new Error('Falha ao enviar teste')
      const data = await res.json()
      setTemplates(prev => prev.map(t => t.id === templateId ? data.template : t))
      toast.success('Teste enviado (simulado)')
    } catch (e: any) { toast.error(e.message) }
  }

  const addPrebuiltTemplate = async (prebuilt: any) => {
    const templateData = {
      ...defaultTemplate,
      name: prebuilt.name,
      subject: prebuilt.subject,
      category: prebuilt.category,
      content: { html: prebuilt.html, text: htmlToPlainText(prebuilt.html) },
      variables: commonVariables.filter(v => prebuilt.html.includes(`{{${v.name}}}`) || prebuilt.subject.includes(`{{${v.name}}}`))
    }
    await createTemplate(templateData as any)
    toast.success('Template pré-construído adicionado!')
  }

  const getCategoryInfo = (category: string) => {
    return templateCategories.find(c => c.value === category) || templateCategories[0]
  }

  const getPreviewContent = (template: EmailTemplate) => {
    let content = template.content.html
    template.variables.forEach(variable => {
      const placeholder = `{{${variable.name}}}`
      const value = variable.defaultValue || `[${variable.label}]`
      content = content.replace(new RegExp(placeholder, 'g'), value)
    })
    return content
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">E-mail Templates</h2>
          <p className="text-muted-foreground">
            Gerencie templates de e-mail para automação e campanhas
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={() => setIsCreateDialogOpen(true)}>
            <FileText className="h-4 w-4 mr-2" />
            Templates Prontos
          </Button>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Template
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Envelope className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total Templates</p>
                <p className="text-2xl font-bold">{totalTemplates}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Star className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Ativos</p>
                <p className="text-2xl font-bold">{activeTemplates}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <PaperPlaneRight className="h-4 w-4 text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">E-mails Enviados</p>
                <p className="text-2xl font-bold">{totalSent.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <ChartBar className="h-4 w-4 text-orange-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Taxa Abertura Média</p>
                <p className="text-2xl font-bold">{avgOpenRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnels */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <Input
                placeholder="Buscar templates..."
                value={searchQuery}
                onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
              />
            </div>
            <Select value={categoryFunnel} onValueChange={setCategoryFunnel}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Categorias</SelectItem>
                {templateCategories.map(category => (
                  <SelectItem key={category.value} value={category.value}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Prebuilt Templates Section */}
      {templates.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Sparkle className="h-5 w-5 text-accent" />
              <span>Templates Pré-construídos</span>
            </CardTitle>
            <CardDescription>
              Comece rapidamente com nossos templates prontos para uso
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {prebuiltTemplates.map((template, index) => {
                const categoryInfo = getCategoryInfo(template.category)
                return (
                  <Card key={index} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium">{template.name}</h4>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {template.subject}
                          </p>
                        </div>
                        <Badge variant="outline" className={categoryInfo.color}>
                          {categoryInfo.label}
                        </Badge>
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => addPrebuiltTemplate(template)}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Usar Template
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status / Erros */}
      {loading && (
        <p className="text-sm text-muted-foreground">
          <LoadingPercentText label="Carregando templates" showPercent={false} />
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map((template) => {
          const categoryInfo = getCategoryInfo(template.category)

          return (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {template.subject}
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Badge variant={template.isActive ? "default" : "secondary"}>
                      {template.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                    {template.isDefault && (
                      <Badge variant="outline">
                        <Star className="h-3 w-3 mr-1" />
                        Padrão
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-2">
                  <Badge variant="outline" className={categoryInfo.color}>
                    {categoryInfo.label}
                  </Badge>
                  <Badge variant="outline">
                    {template.type.toUpperCase()}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-center text-sm">
                  <div>
                    <p className="text-muted-foreground">Enviados</p>
                    <p className="font-bold">{template.analytics.sent}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Taxa Abertura</p>
                    <p className="font-bold">{template.analytics.openRate.toFixed(1)}%</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Variáveis: {template.variables.length}</span>
                    <span className="text-muted-foreground">
                      {template.lastUsed
                        ? `Usado ${new Date(template.lastUsed).toLocaleDateString()}`
                        : 'Nunca usado'
                      }
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setSelectedTemplate(template)
                      setActiveTab('preview')
                    }}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Preview
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingTemplate(template)
                      setIsEditDialogOpen(true)
                    }}
                  >
                    <PencilSimple className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => duplicateTemplate(template)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => sendTest(template.id)}
                  >
                    <PaperPlaneRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteTemplate(template.id)}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredTemplates.length === 0 && templates.length > 0 && (
        <Card className="text-center py-12">
          <CardContent>
            <Envelope className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum template encontrado</h3>
            <p className="text-muted-foreground">
              Tente ajustar os filtros ou criar um novo template
            </p>
          </CardContent>
        </Card>
      )}

      {/* Template Detail Modal */}
      {selectedTemplate && (
        <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedTemplate.name}</DialogTitle>
              <DialogDescription>
                Visualização e configurações do template
              </DialogDescription>
            </DialogHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="variables">Variáveis</TabsTrigger>
                <TabsTrigger value="settings">Configurações</TabsTrigger>
              </TabsList>

              <TabsContent value="preview" className="space-y-4">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Assunto</Label>
                    <p className="text-sm bg-muted p-2 rounded mt-1">{selectedTemplate.subject}</p>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Conteúdo HTML</Label>
                    <pre className="border rounded-lg p-4 mt-1 bg-white max-h-96 overflow-auto whitespace-pre-wrap text-sm">
                      {getPreviewContent(selectedTemplate)}
                    </pre>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="analytics" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-blue-600">{selectedTemplate.analytics.sent}</p>
                      <p className="text-sm text-muted-foreground">Enviados</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-green-600">{selectedTemplate.analytics.opened}</p>
                      <p className="text-sm text-muted-foreground">Abertos</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-orange-600">{selectedTemplate.analytics.clicked}</p>
                      <p className="text-sm text-muted-foreground">Cliques</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-red-600">{selectedTemplate.analytics.unsubscribed}</p>
                      <p className="text-sm text-muted-foreground">Descadastros</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-xl font-bold">{selectedTemplate.analytics.openRate.toFixed(1)}%</p>
                      <p className="text-sm text-muted-foreground">Taxa de Abertura</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-xl font-bold">{selectedTemplate.analytics.clickRate.toFixed(1)}%</p>
                      <p className="text-sm text-muted-foreground">Taxa de Clique</p>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="variables" className="space-y-4">
                <div className="space-y-4">
                  {selectedTemplate.variables.length > 0 ? (
                    selectedTemplate.variables.map((variable) => (
                      <Card key={variable.name}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                <code className="text-sm bg-muted px-2 py-1 rounded">
                                  {`{{${variable.name}}}`}
                                </code>
                                <span className="font-medium">{variable.label}</span>
                                {variable.required && (
                                  <Badge variant="destructive" className="text-xs">Obrigatório</Badge>
                                )}
                              </div>
                              {variable.description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {variable.description}
                                </p>
                              )}
                              {variable.defaultValue && (
                                <p className="text-sm text-muted-foreground">
                                  Valor padrão: <code>{variable.defaultValue}</code>
                                </p>
                              )}
                            </div>
                            <Badge variant="outline">{variable.type}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <TextT className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">Nenhuma variável definida</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <div className="space-y-6">
                  <div>
                    <h4 className="font-medium mb-3">Configurações de Envio</h4>
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm">Nome do Remetente</Label>
                          <p className="text-sm text-muted-foreground">{selectedTemplate.settings.fromName}</p>
                        </div>
                        <div>
                          <Label className="text-sm">E-mail do Remetente</Label>
                          <p className="text-sm text-muted-foreground">{selectedTemplate.settings.fromEmail}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Rastrear Aberturas</span>
                          <Switch checked={selectedTemplate.settings.trackOpens} disabled />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Rastrear Cliques</span>
                          <Switch checked={selectedTemplate.settings.trackClicks} disabled />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Habilitar Descadastro</span>
                          <Switch checked={selectedTemplate.settings.enableUnsubscribe} disabled />
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-3">Design</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-sm">Cor de Fundo</Label>
                        <div className="flex items-center space-x-2 mt-1">
                          <div
                            className="w-4 h-4 rounded border"
                            style={{ backgroundColor: selectedTemplate.design.backgroundColor }}
                          />
                          <span className="text-muted-foreground">{selectedTemplate.design.backgroundColor}</span>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm">Cor do Texto</Label>
                        <div className="flex items-center space-x-2 mt-1">
                          <div
                            className="w-4 h-4 rounded border"
                            style={{ backgroundColor: selectedTemplate.design.textColor }}
                          />
                          <span className="text-muted-foreground">{selectedTemplate.design.textColor}</span>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm">Cor dos Links</Label>
                        <div className="flex items-center space-x-2 mt-1">
                          <div
                            className="w-4 h-4 rounded border"
                            style={{ backgroundColor: selectedTemplate.design.linkColor }}
                          />
                          <span className="text-muted-foreground">{selectedTemplate.design.linkColor}</span>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm">Fonte</Label>
                        <p className="text-muted-foreground mt-1">{selectedTemplate.design.fontFamily}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
