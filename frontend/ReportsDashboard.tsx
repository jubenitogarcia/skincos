import { useState, useEffect } from 'react'
import { useIntegrations } from '@/contexts'
import { useKV } from '@/spark-mock'
import { metaAdsApi } from '@/metaAdsApi'
import { MetaMetricsSchema, type MetaMetrics } from '@/metaMetrics'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { Label } from "@/label"
import { Textarea } from "@/textarea"
import { ScrollArea } from "@/scroll-area"
import {
  ChartLineUp,
  ChartPieSlice,
  ChartBar,
  CalendarBlank,
  Download,
  Share,
  Plus,
  Funnel,
  TrendUp,
  TrendDown,
  Users,
  Target,
  CurrencyDollar,
  Clock,
  Eye,
  PencilSimple,
  Trash,
  Play,
  Pause,
  Robot
} from "@phosphor-icons/react"

interface Report {
  id: string
  name: string
  description: string
  type: 'sales' | 'marketing' | 'customer' | 'activity' | 'custom'
  chartType: 'line' | 'bar' | 'pie' | 'area' | 'funnel' | 'table'
  dataSource: string
  filters: ReportFunnel[]
  groupBy: string[]
  metrics: ReportMetric[]
  dateRange: {
    start: string
    end: string
    period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  }
  isScheduled: boolean
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly'
    time: string
    recipients: string[]
  }
  isPublic: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface ReportFunnel {
  field: string
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'in' | 'between'
  value: any
  label: string
}

interface ReportMetric {
  field: string
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'count_distinct'
  label: string
}

interface ReportTemplate {
  id: string
  name: string
  description: string
  category: string
  config: Partial<Report>
  tags: string[]
  popularity: number
}

export function ReportsDashboard({ mode = 'full' }: { mode?: 'full' | 'meta-ads' }) {
  const { instagram, syncInstagram } = useIntegrations()
  const [reports, setReports] = useKV<Report[]>('reports', [])
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('my-reports')
  const [metaMetrics, setMetaMetrics] = useState<MetaMetrics | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [metaLoading, setMetaLoading] = useState(false)

  useEffect(() => {
    if (mode !== 'meta-ads') return
    const { since, until } = (() => {
      const end = new Date()
      const start = new Date(end)
      start.setDate(end.getDate() - 6)
      const toYmd = (d: Date) => d.toISOString().slice(0, 10)
      return { since: toYmd(start), until: toYmd(end) }
    })()
    setMetaLoading(true)
    setMetaError(null)
    Promise.all([metaAdsApi.summary({ since, until }), metaAdsApi.trend({ since, until })])
      .then(([sum, tr]: any[]) => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        const parsed = MetaMetricsSchema.parse({
          platform: 'meta-ads',
          currency: 'USD',
          period: { since, until, timezone: tz },
          summary: sum,
          trend: tr,
        })
        setMetaMetrics(parsed)
      })
      .catch((e) => setMetaError(e?.message || 'Falha ao carregar métricas Meta Ads'))
      .finally(() => setMetaLoading(false))
  }, [mode])

  if (mode === 'meta-ads') {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Performance Meta Ads</CardTitle>
            <CardDescription>Métricas consolidadas do período selecionado.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">Spend</div>
              <div className="text-2xl font-semibold">{metaMetrics?.summary.spend ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Impressões</div>
              <div className="text-2xl font-semibold">{metaMetrics?.summary.impressions ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Clicks</div>
              <div className="text-2xl font-semibold">{metaMetrics?.summary.clicks ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">ROAS</div>
              <div className="text-2xl font-semibold">{metaMetrics?.summary.roas ?? 0}</div>
            </div>
          </CardContent>
        </Card>
        {metaError ? (
          <Card className="border-red-500/30 bg-red-500/10">
            <CardContent className="pt-4 text-sm text-red-200">{metaError}</CardContent>
          </Card>
        ) : null}
        {!metaError && (
          <Card>
            <CardHeader>
              <CardTitle>Tendência (7 dias)</CardTitle>
              <CardDescription>Spend diário.</CardDescription>
            </CardHeader>
            <CardContent>
              {metaLoading ? (
                <div className="text-sm text-muted-foreground">Carregando...</div>
              ) : (
                <div className="space-y-2 text-sm">
                  {(metaMetrics?.trend || []).map((row) => (
                    <div key={row.day} className="flex items-center justify-between">
                      <span>{row.day}</span>
                      <span>{row.spend}</span>
                    </div>
                  ))}
                  {!metaMetrics?.trend?.length && (
                    <div className="text-xs text-muted-foreground">Sem dados no período.</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // Report Templates
  const reportTemplates: ReportTemplate[] = [
    {
      id: 'sales-funnel',
      name: 'Funil de Vendas',
      description: 'Análise completa do pipeline de vendas com conversões por etapa',
      category: 'Vendas',
      config: {
        type: 'sales',
        chartType: 'funnel',
        dataSource: 'opportunities',
        metrics: [
          { field: 'value', aggregation: 'sum', label: 'Valor Total' },
          { field: 'id', aggregation: 'count', label: 'Quantidade' }
        ],
        groupBy: ['stage']
      },
      tags: ['vendas', 'pipeline', 'conversão'],
      popularity: 95
    },
    {
      id: 'revenue-trend',
      name: 'Tendência de Receita',
      description: 'Evolução da receita ao longo do tempo com previsões',
      category: 'Vendas',
      config: {
        type: 'sales',
        chartType: 'line',
        dataSource: 'opportunities',
        metrics: [
          { field: 'value', aggregation: 'sum', label: 'Receita' }
        ],
        groupBy: ['month']
      },
      tags: ['receita', 'tendência', 'previsão'],
      popularity: 88
    },
    {
      id: 'customer-segmentation',
      name: 'Segmentação de Clientes',
      description: 'Análise de clientes por valor, segmento e comportamento',
      category: 'Clientes',
      config: {
        type: 'customer',
        chartType: 'pie',
        dataSource: 'customers',
        metrics: [
          { field: 'id', aggregation: 'count', label: 'Total de Clientes' },
          { field: 'value', aggregation: 'avg', label: 'Valor Médio' }
        ],
        groupBy: ['status', 'source']
      },
      tags: ['clientes', 'segmentação', 'valor'],
      popularity: 82
    },
    {
      id: 'activity-heatmap',
      name: 'Mapa de Calor de Atividades',
      description: 'Distribuição temporal das atividades de vendas e marketing',
      category: 'Atividades',
      config: {
        type: 'activity',
        chartType: 'area',
        dataSource: 'activities',
        metrics: [
          { field: 'id', aggregation: 'count', label: 'Total de Atividades' }
        ],
        groupBy: ['type', 'hour', 'day_of_week']
      },
      tags: ['atividades', 'tempo', 'produtividade'],
      popularity: 76
    },
    {
      id: 'campaign-performance',
      name: 'Performance de Campanhas',
      description: 'ROI e métricas de performance das campanhas de marketing',
      category: 'Marketing',
      config: {
        type: 'marketing',
        chartType: 'bar',
        dataSource: 'campaigns',
        metrics: [
          { field: 'metrics.sent', aggregation: 'sum', label: 'Enviados' },
          { field: 'metrics.opened', aggregation: 'sum', label: 'Abertos' },
          { field: 'metrics.converted', aggregation: 'sum', label: 'Convertidos' }
        ],
        groupBy: ['type', 'channel']
      },
      tags: ['campanhas', 'marketing', 'roi'],
      popularity: 71
    }
  ]

  // Sample reports
  useEffect(() => {
    if (reports.length === 0) {
      const sampleReports: Report[] = [
        {
          id: 'report-1',
          name: 'Pipeline de Vendas - Mensal',
          description: 'Análise mensal do pipeline com projeções de fechamento',
          type: 'sales',
          chartType: 'funnel',
          dataSource: 'opportunities',
          filters: [],
          groupBy: ['stage'],
          metrics: [
            { field: 'value', aggregation: 'sum', label: 'Valor Total' },
            { field: 'id', aggregation: 'count', label: 'Quantidade' }
          ],
          dateRange: {
            start: '2024-12-01',
            end: '2024-12-31',
            period: 'monthly'
          },
          isScheduled: true,
          schedule: {
            frequency: 'monthly',
            time: '09:00',
            recipients: ['admin@empresa.com']
          },
          isPublic: false,
          createdBy: 'admin',
          createdAt: '2024-12-20T10:00:00Z',
          updatedAt: '2024-12-20T10:00:00Z'
        },
        {
          id: 'report-2',
          name: 'Performance de Agentes',
          description: 'Ranking de performance individual dos agentes de vendas',
          type: 'sales',
          chartType: 'bar',
          dataSource: 'opportunities',
          filters: [
            { field: 'stage', operator: 'equals', value: 'closed-won', label: 'Apenas vendas fechadas' }
          ],
          groupBy: ['assignedTo'],
          metrics: [
            { field: 'value', aggregation: 'sum', label: 'Receita' },
            { field: 'id', aggregation: 'count', label: 'Vendas' }
          ],
          dateRange: {
            start: '2024-11-01',
            end: '2024-12-31',
            period: 'weekly'
          },
          isScheduled: false,
          isPublic: true,
          createdBy: 'admin',
          createdAt: '2024-12-15T14:30:00Z',
          updatedAt: '2024-12-20T09:15:00Z'
        }
      ]
      setReports(sampleReports)
    }
  }, [reports.length, setReports])

  const handleCreateReport = (templateId?: string) => {
    const template = templateId ? reportTemplates.find(t => t.id === templateId) : null

    const newReport: Report = {
      id: `report-${Date.now()}`,
      name: template ? `${template.name} - Personalizado` : 'Novo Relatório',
      description: template?.description || '',
      type: template?.config.type || 'custom',
      chartType: template?.config.chartType || 'table',
      dataSource: template?.config.dataSource || 'customers',
      filters: template?.config.filters || [],
      groupBy: template?.config.groupBy || [],
      metrics: template?.config.metrics || [],
      dateRange: {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
        period: 'daily'
      },
      isScheduled: false,
      isPublic: false,
      createdBy: 'current-user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setReports(prev => [...prev, newReport])
    setSelectedReport(newReport.id)
    setIsCreateDialogOpen(false)
  }

  const getReportIcon = (type: Report['type']) => {
    switch (type) {
      case 'sales': return <TrendUp className="h-5 w-5" />
      case 'marketing': return <Target className="h-5 w-5" />
      case 'customer': return <Users className="h-5 w-5" />
      case 'activity': return <Clock className="h-5 w-5" />
      default: return <ChartLineUp className="h-5 w-5" />
    }
  }

  const getChartIcon = (chartType: Report['chartType']) => {
    switch (chartType) {
      case 'line': return <ChartLineUp className="h-4 w-4" />
      case 'bar': return <ChartBar className="h-4 w-4" />
      case 'pie': return <ChartPieSlice className="h-4 w-4" />
      case 'funnel': return <Funnel className="h-4 w-4" />
      default: return <ChartLineUp className="h-4 w-4" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <ChartLineUp className="h-6 w-6" />
            <span>Relatórios e Analytics</span>
          </h2>
          <p className="text-muted-foreground">
            Dashboards inteligentes com insights automáticos e relatórios personalizáveis
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo Relatório
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>Criar Novo Relatório</DialogTitle>
                <DialogDescription>
                  Comece com um template ou crie do zero
                </DialogDescription>
              </DialogHeader>
              <ReportCreationWizard
                templates={reportTemplates}
                onCreate={handleCreateReport}
                onCancel={() => setIsCreateDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {instagram.connected && instagram.metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="glass-card">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Seguidores</p>
                  <p className="text-xl font-bold">{instagram.metrics.followers_count}</p>
                  <Button variant="link" className="px-0 text-xs" onClick={() => syncInstagram()}>Atualizar</Button>
                </div>
                <Users className="h-6 w-6 text-pink-600" />
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Posts</p>
                  <p className="text-xl font-bold">{instagram.metrics.media_count}</p>
                </div>
                <Target className="h-6 w-6 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="my-reports">Meus Relatórios</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="scheduled">Agendados</TabsTrigger>
          <TabsTrigger value="ai-insights">IA Insights</TabsTrigger>
        </TabsList>

        {/* My Reports */}
        <TabsContent value="my-reports" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reports.map(report => (
              <Card
                key={report.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setSelectedReport(report.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getReportIcon(report.type)}
                      <CardTitle className="text-base">{report.name}</CardTitle>
                    </div>
                    <div className="flex items-center space-x-1">
                      {getChartIcon(report.chartType)}
                      {report.isScheduled && (
                        <Badge variant="secondary" className="text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          Auto
                        </Badge>
                      )}
                      {report.isPublic && (
                        <Badge variant="outline" className="text-xs">
                          <Share className="h-3 w-3 mr-1" />
                          Público
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {report.description}
                  </p>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="text-xs capitalize">
                        {report.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {report.metrics.length} métrica(s)
                      </span>
                    </div>

                    <div className="flex items-center space-x-1">
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <PencilSimple className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reportTemplates.map(template => (
              <Card
                key={template.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleCreateReport(template.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    <div className="flex items-center space-x-1">
                      <Badge variant="secondary" className="text-xs">
                        {template.popularity}% uso
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    {template.description}
                  </p>

                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {template.category}
                    </Badge>

                    <div className="flex flex-wrap gap-1">
                      {template.tags.slice(0, 2).map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Scheduled Reports */}
        <TabsContent value="scheduled" className="space-y-4">
          <div className="space-y-4">
            {reports.filter(r => r.isScheduled).map(report => (
              <Card key={report.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        {getReportIcon(report.type)}
                        <div>
                          <h3 className="font-semibold">{report.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {report.schedule?.frequency} às {report.schedule?.time}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Badge variant="secondary">
                        <Clock className="h-3 w-3 mr-1" />
                        Ativo
                      </Badge>
                      <Button variant="ghost" size="sm">
                        <Pause className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <PencilSimple className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* AI Insights */}
        <TabsContent value="ai-insights" className="space-y-4">
          <Card>
            <CardContent className="p-6 text-center">
              <Robot className="h-12 w-12 text-accent mx-auto mb-4 ai-processing" />
              <h3 className="text-lg font-semibold mb-2">Insights Automáticos da IA</h3>
              <p className="text-muted-foreground mb-4">
                A IA está analisando seus dados para gerar insights automáticos e recomendações de relatórios
              </p>
              <Button>
                <Robot className="h-4 w-4 mr-2" />
                Gerar Insights
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Report Creation Wizard Component
function ReportCreationWizard({
  templates,
  onCreate,
  onCancel
}: {
  templates: ReportTemplate[]
  onCreate: (templateId?: string) => void
  onCancel: () => void
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Create from Scratch */}
        <Card
          className={`cursor-pointer border-2 transition-colors ${selectedTemplate === null ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
          onClick={() => setSelectedTemplate(null)}
        >
          <CardContent className="p-6 text-center">
            <Plus className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <h3 className="font-semibold mb-2">Criar do Zero</h3>
            <p className="text-sm text-muted-foreground">
              Configure seu relatório personalizado com total flexibilidade
            </p>
          </CardContent>
        </Card>

        {/* Templates */}
        {templates.slice(0, 5).map(template => (
          <Card
            key={template.id}
            className={`cursor-pointer border-2 transition-colors ${selectedTemplate === template.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
            onClick={() => setSelectedTemplate(template.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">{template.name}</h3>
                <Badge variant="secondary" className="text-xs">
                  {template.popularity}%
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {template.description}
              </p>
              <div className="flex flex-wrap gap-1">
                {template.tags.slice(0, 3).map(tag => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={() => onCreate(selectedTemplate || undefined)}>
          {selectedTemplate ? 'Usar Template' : 'Criar Relatório'}
        </Button>
      </div>
    </div>
  )
}
