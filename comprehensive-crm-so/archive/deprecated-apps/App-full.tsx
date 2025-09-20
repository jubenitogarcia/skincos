import { useState, useEffect, useMemo, useCallback } from 'react'
import { useKV } from '@github/spark/hooks'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { MetricCard } from '@/components/MetricCard'
import { CustomerCard } from '@/components/CustomerCard'
import { OpportunityCard } from '@/components/OpportunityCard'
import { ActivityCard } from '@/components/ActivityCard'
import { CampaignCard } from '@/components/CampaignCard'
import { AnalyticsCard, PipelineAnalytics, RevenueChart } from '@/components/AnalyticsCard'
import { OmnichannelCenter } from '@/components/OmnichannelCenter'
import { AIAutomationHub } from '@/components/AIAutomationHub'
import { AIChat } from '@/components/AIChat'
import { AgentDashboard } from '@/components/AgentDashboard'
import { PerformanceCoaching } from '@/components/PerformanceCoaching'
import { ExecutiveDashboard } from '@/components/ExecutiveDashboard'
import { AlertsCenter } from '@/components/AlertsCenter'
import { SystemGear } from '@/components/SystemGear'
import { PerformanceAlerts } from '@/components/PerformanceAlerts'
import { ROIDashboard } from '@/components/ROIDashboard'
import { CustomObjectsManager } from '@/components/CustomObjectsManager'
import { RichTaskManager } from '@/components/RichTaskManager'
import { KanbanBoard } from '@/components/KanbanBoard'
import { ReportsDashboard } from '@/components/ReportsDashboard'
import { APIExplorer } from '@/components/APIExplorer'
import { FieldsManager } from '@/components/FieldsManager'
import { ViewsManager } from '@/components/ViewsManager'
import { AccountingModule } from '@/components/AccountingModule'
import { AssetManagement } from '@/components/AssetManagement'
import { MultiCompanyManagement } from '@/components/MultiCompanyManagement'
import { WorkflowEngine } from '@/components/WorkflowEngine'
import { ManufacturingModule } from '@/components/ManufacturingModule'
import { HRModule } from '@/components/HRModule'
import { ProcurementModule } from '@/components/ProcurementModule'
import { ProjectManagement } from '@/components/ProjectManagement'
import { HelpDeskModule } from '@/components/HelpDeskModule'
import { NotificationCenter } from '@/components/NotificationCenter'
import { NotificationTester } from '@/components/NotificationTester'
import { LeadsManager } from '@/components/LeadsManager'
import { QuotesManager } from '@/components/QuotesManager'
import { ProductCatalog } from '@/components/ProductCatalog'
import { WebFormsManager } from '@/components/WebFormsManager'
import { EmailTemplatesManager } from '@/components/EmailTemplatesManager'
import { AdvancedGear } from '@/components/AdvancedGear'
import { PipelineManager } from '@/components/PipelineManager'
import { AdvancedActivitiesManager } from '@/components/AdvancedActivitiesManager'
import { TerritoriesManager } from '@/components/TerritoriesManager'
import { LeadScoringSystem } from '@/components/LeadScoringSystem'
import { WebhooksIntegrationsHub } from '@/components/WebhooksIntegrationsHub'
import { MetaIntegrationsHub } from '@/components/MetaIntegrationsHub'
import { MetaCommandCenter } from '@/components/MetaCommandCenter'
import { MetaSyncMonitor } from '@/components/MetaSyncMonitor'
import { MetaSentimentMonitor } from '@/components/MetaSentimentMonitor'
import { MetaAdsManager } from '@/components/MetaAdsManager'
import { WhatsAppBusinessHub } from '@/components/WhatsAppBusinessHub'
import { InstagramStudioPro } from '@/components/InstagramStudioPro'
import { ThreadsStudio } from '@/components/ThreadsStudio'
import { SystemMonitoring } from '@/components/SystemMonitoring'
import { BackupRecoveryCenter } from '@/components/BackupRecoveryCenter'
import { SystemConfiguration } from '@/components/SystemConfiguration'
import { GlobalGear } from '@/components/GlobalSettings'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useNotifications } from '@/contexts/NotificationContext'
import {
  Plus,
  MagnifyingGlass,
  Users,
  TrendUp,
  Target,
  Sparkle,
  Bell,
  ChartLineUp,
  ChartPie,
  Funnel,
  Envelope,
  WhatsappLogo,
  InstagramLogo,
  CalendarCheck,
  ChatCircle,
  Robot,
  Lightning,
  Headset,
  GraduationCap,
  Gear,
  Calculator,
  Database,
  CheckCircle,
  SquaresFour,
  Code,
  Toolbox,
  Package,
  Buildings,
  Bank,
  ArrowsClockwise,
  Factory,
  Users as UsersFour,
  ShoppingCart,
  FolderOpen,
  List,
  X,
  Globe,
  FileText,
  Star,
  Pulse as PulseIcon,
  CloudArrowUp
} from "@phosphor-icons/react"
import type { Customer, Opportunity, Activity, DashboardMetric, Campaign } from '@/lib/types'
import { mockCustomers, mockOpportunities, mockActivities, mockCampaigns } from '@/lib/mockData'

function AppContent() {
  const [activeTab, setActiveTab] = useState("dashboard")
  const [searchQuery, setMagnifyingGlassQuery] = useState("")
  const [sidebarCollapsed, setSidebarCollapsed] = useKV("sidebar-collapsed", false)

  // Get notifications from context
  const {
    unreadCount: notificationUnreadCount,
    isConnected,
    isConnecting,
    lastError,
    latency,
    connectionStatus
  } = useNotifications()

  // Initialize data with mock data
  const [customers, setCustomers] = useKV<Customer[]>("customers", mockCustomers)
  const [opportunities, setOpportunities] = useKV<Opportunity[]>("opportunities", mockOpportunities)
  const [activities, setActivities] = useKV<Activity[]>("activities", mockActivities)
  const [campaigns, setCampaigns] = useKV<Campaign[]>("campaigns", mockCampaigns)

  // Ensure data is populated
  useEffect(() => {
    if (customers.length === 0) setCustomers(mockCustomers)
    if (opportunities.length === 0) setOpportunities(mockOpportunities)
    if (activities.length === 0) setActivities(mockActivities)
    if (campaigns.length === 0) setCampaigns(mockCampaigns)
  }, [customers.length, opportunities.length, activities.length, campaigns.length, setCustomers, setOpportunities, setActivities, setCampaigns])

  // Dashboard metrics with real calculations - memoized for performance
  const metrics = useMemo(() => {
    const totalRevenue = opportunities
      .filter(opp => opp.stage === 'closed-won')
      .reduce((sum, opp) => sum + opp.value, 0)

    const totalOpportunities = opportunities.length
    const wonOpportunities = opportunities.filter(opp => opp.stage === 'closed-won').length
    const conversionRate = totalOpportunities > 0 ? (wonOpportunities / totalOpportunities * 100) : 0

    return [
      {
        id: "1",
        title: "Receita Total",
        value: `R$ ${(totalRevenue / 1000).toFixed(1)}K`,
        change: 12.5,
        trend: "up",
        icon: "chart",
        color: "text-green-600"
      },
      {
        id: "2",
        title: "Conversão Pipeline",
        value: `${conversionRate.toFixed(1)}%`,
        change: 4.1,
        trend: "up",
        icon: "funnel",
        color: "text-blue-600"
      },
      {
        id: "3",
        title: "Novos Leads",
        value: customers.filter(c => c.status === 'lead').length.toString(),
        change: -2.3,
        trend: "down",
        icon: "users",
        color: "text-orange-600"
      },
      {
        id: "4",
        title: "Ticket Médio",
        value: `R$ ${wonOpportunities > 0 ? (totalRevenue / wonOpportunities / 1000).toFixed(1) : '0'}K`,
        change: 8.7,
        trend: "up",
        icon: "target",
        color: "text-purple-600"
      }
    ]
  }, [opportunities, customers])

  // Pipeline analytics data - memoized
  const pipelineData = useMemo(() => [
    {
      stage: "Qualificação",
      count: opportunities.filter(o => o.stage === 'qualification').length,
      value: opportunities.filter(o => o.stage === 'qualification').reduce((sum, o) => sum + o.value, 0),
      conversionRate: 78.5
    },
    {
      stage: "Proposta",
      count: opportunities.filter(o => o.stage === 'proposal').length,
      value: opportunities.filter(o => o.stage === 'proposal').reduce((sum, o) => sum + o.value, 0),
      conversionRate: 65.2
    },
    {
      stage: "Negociação",
      count: opportunities.filter(o => o.stage === 'negotiation').length,
      value: opportunities.filter(o => o.stage === 'negotiation').reduce((sum, o) => sum + o.value, 0),
      conversionRate: 45.8
    },
    {
      stage: "Fechado-Ganho",
      count: opportunities.filter(o => o.stage === 'closed-won').length,
      value: opportunities.filter(o => o.stage === 'closed-won').reduce((sum, o) => sum + o.value, 0),
      conversionRate: 32.1
    }
  ], [opportunities])

  // Revenue chart data - memoized
  const revenueData = useMemo(() => {
    const totalRevenue = opportunities
      .filter(opp => opp.stage === 'closed-won')
      .reduce((sum, opp) => sum + opp.value, 0)

    return [
      { period: "Jan", revenue: 180000, forecast: 220000 },
      { period: "Fev", revenue: 195000, forecast: 235000 },
      { period: "Mar", revenue: totalRevenue, forecast: totalRevenue * 1.15 }
    ]
  }, [opportunities])

  // Calculate notification counts for each section (memoized for performance)
  const notificationCounts = useMemo(() => ({
    // Dashboard alerts (high priority opportunities, overdue tasks)
    dashboard: opportunities.filter(o => o.aiScore > 90).length +
      activities.filter(a => new Date(a.date) < new Date(Date.now() - 24 * 60 * 60 * 1000)).length,

    // New components
    leads: customers.filter(c => c.status === 'lead').length + 3, // Mock additional leads
    'lead-scoring': 5, // Mock scoring alerts
    territories: 2, // Mock territory alerts
    webhooks: 1, // Mock webhook alerts
    opportunities: opportunities.filter(o => o.stage === 'qualification' && o.aiScore > 80).length,
    quotes: 2, // Mock pending quotes

    // Pending activities and overdue tasks
    activities: activities.filter(a => a.type === 'task' && new Date(a.date) < new Date()).length,

    // Active campaigns needing attention
    campaigns: campaigns.filter(c => c.status === 'active' && c.metrics.openRate < 20).length,

    // Omnichannel - unread messages
    omnichannel: Math.floor(Math.random() * 5) + 2, // Mock unread messages

    // AI suggestions and automation alerts
    aiAutomation: 3, // Mock AI suggestions

    // Web forms and marketing
    'web-forms': 1, // Mock form requiring attention
    'email-templates': 0,
    'meta-integrations': 8, // Mock Meta notifications (messages, comments, etc.)
    'meta-command': 15, // Mock Meta Command Center alerts
    'meta-sync': 4, // Mock Meta Sync alerts
    'meta-sentiment': 12, // Mock Meta Sentiment alerts (negative mentions, etc.)
    'meta-ads': 3, // Mock Meta Ads alerts (budget, performance, etc.)
    'whatsapp-business': 12, // Mock WhatsApp Business notifications (new messages, etc.)
    'instagram-studio': 8, // Mock Instagram notifications (comments, DMs, etc.)
    'threads-studio': 6, // Mock Threads notifications (mentions, replies, etc.)

    // Agent performance alerts
    agentDashboard: 1, // Mock performance alert

    // Coaching recommendations
    coaching: 2, // Mock coaching items

    // System alerts (now includes real-time notifications)
    alerts: opportunities.filter(o => o.aiScore < 30).length +
      customers.filter(c => c.status === 'inactive').length,

    // Notification center (real-time notifications)
    notifications: notificationUnreadCount,

    // Configuration updates needed
    pipelines: 0,
    settings: 0,

    // API rate limits or errors
    api: 0,

    // System monitoring alerts
    'system-monitoring': 2, // Mock system alerts
    'backup-recovery': 1, // Mock backup alert

    // ERP module alerts
    accounting: 1, // Mock pending invoices
    assets: 0,
    companies: 0,
    hr: 1, // Mock HR alert
    procurement: 0,
    projects: 3, // Mock project deadlines
    helpdesk: 4 // Mock open tickets
  }), [opportunities, activities, customers, campaigns, notificationUnreadCount])

  // Funnel data based on search - memoized for performance
  const filteredCustomers = useMemo(() =>
    customers.filter(customer =>
      customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.company.toLowerCase().includes(searchQuery.toLowerCase())
    ), [customers, searchQuery]
  )

  const filteredOpportunities = useMemo(() =>
    opportunities.filter(opportunity =>
      opportunity.title.toLowerCase().includes(searchQuery.toLowerCase())
    ), [opportunities, searchQuery]
  )

  const filteredCampaigns = useMemo(() =>
    campaigns.filter(campaign =>
      campaign.name.toLowerCase().includes(searchQuery.toLowerCase())
    ), [campaigns, searchQuery]
  )

  const recentActivities = useMemo(() =>
    activities
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10), [activities]
  )

  // Navigation items organization
  const navigationSections = [
    {
      title: "Dashboard",
      items: [
        { id: "dashboard", label: "Principal", icon: ChartLineUp },
        { id: "executive", label: "Executivo", icon: ChartPie },
        { id: "roi", label: "ROI", icon: Calculator },
        { id: "notifications", label: "Notificações", icon: Bell },
      ]
    },
    {
      title: "Vendas & CRM",
      items: [
        { id: "customers", label: "Clientes", icon: Users },
        { id: "leads", label: "Leads", icon: Target },
        { id: "lead-scoring", label: "Lead Scoring", icon: Star },
        { id: "opportunities", label: "Pipeline", icon: Target },
        { id: "activities", label: "Atividades", icon: CalendarCheck },
        { id: "campaigns", label: "Campanhas", icon: Envelope },
        { id: "quotes", label: "Cotações", icon: FileText },
      ]
    },
    {
      title: "Comunicação",
      items: [
        { id: "omnichannel", label: "Canais", icon: ChatCircle },
        { id: "ai-chat", label: "Chat IA", icon: Robot },
        { id: "agent-dashboard", label: "Agentes", icon: Headset },
      ]
    },
    {
      title: "Marketing & Automação",
      items: [
        { id: "web-forms", label: "Web Forms", icon: Globe },
        { id: "email-templates", label: "E-mail Templates", icon: Envelope },
        { id: "ai-automation", label: "IA", icon: Lightning },
        { id: "coaching", label: "Coaching", icon: GraduationCap },
        { id: "workflows", label: "Workflows", icon: ArrowsClockwise },
      ]
    },
    {
      title: "Análise & Relatórios",
      items: [
        { id: "kanban", label: "Kanban", icon: SquaresFour },
        { id: "reports", label: "Relatórios", icon: ChartPie },
        { id: "alerts", label: "Alertas", icon: Bell },
      ]
    },
    {
      title: "Configuração",
      items: [
        { id: "pipelines", label: "Pipelines", icon: Funnel },
        { id: "territories", label: "Territórios", icon: Globe },
        { id: "webhooks", label: "Webhooks", icon: Lightning },
        { id: "meta-integrations", label: "Meta Apps", icon: ChatCircle },
        { id: "meta-command", label: "Meta Command", icon: Lightning },
        { id: "meta-sync", label: "Meta Sync", icon: Database },
        { id: "meta-sentiment", label: "Meta Sentiment", icon: ChartLineUp },
        { id: "meta-ads", label: "Meta Ads", icon: Target },
        { id: "whatsapp-business", label: "WhatsApp", icon: WhatsappLogo },
        { id: "instagram-studio", label: "Instagram", icon: InstagramLogo },
        { id: "threads-studio", label: "Threads", icon: ChatCircle },
        { id: "custom-objects", label: "Objetos", icon: Database },
        { id: "fields", label: "Campos", icon: Toolbox },
        { id: "api", label: "API", icon: Code },
        { id: "system-monitoring", label: "Monitoramento", icon: PulseIcon },
        { id: "backup-recovery", label: "Backup", icon: CloudArrowUp },
        { id: "settings", label: "Config.", icon: Gear },
      ]
    },
    {
      title: "ERP Módulos",
      items: [
        { id: "accounting", label: "Contábil", icon: Bank },
        { id: "assets", label: "Ativos", icon: Package },
        { id: "companies", label: "Empresas", icon: Buildings },
        { id: "manufacturing", label: "Manufatura", icon: Factory },
        { id: "hr", label: "RH", icon: UsersFour },
        { id: "procurement", label: "Compras", icon: ShoppingCart },
        { id: "projects", label: "Projetos", icon: FolderOpen },
        { id: "helpdesk", label: "Suporte", icon: Headset },
      ]
    }
  ]

  return (
    <TooltipProvider>
      <div className="h-screen flex bg-background">
        {/* Sidebar */}
        <aside className={`${sidebarCollapsed ? 'w-16' : 'w-64'} bg-card border-r border-border flex flex-col sidebar-transition`}>
          {/* Sidebar Header */}
          <div className="h-16 border-b border-border flex items-center justify-between px-4">
            {!sidebarCollapsed && (
              <div className="flex items-center space-x-2">
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                  <Sparkle className="h-5 w-5 text-primary-foreground" />
                </div>
                <h1 className="text-lg font-bold">CRM Inteligente</h1>
              </div>
            )}
            {sidebarCollapsed && (
              <div className="flex items-center justify-center w-full">
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                  <Sparkle className="h-5 w-5 text-primary-foreground" />
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="h-8 w-8 p-0"
            >
              {sidebarCollapsed ? <List className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-2 overflow-y-auto sidebar-scroll">
            {navigationSections.map((section) => (
              <div key={section.title} className="mb-4">
                {!sidebarCollapsed && (
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
                    {section.title}
                  </h3>
                )}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = activeTab === item.id
                    const IconComponent = item.icon

                    const buttonContent = (
                      <div className="relative">
                        <Button
                          variant={isActive ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setActiveTab(item.id)}
                          className={`${sidebarCollapsed ? 'w-10 h-10 p-0 mx-auto' : 'w-full justify-start h-9'} ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                            } transition-all duration-200`}
                        >
                          <IconComponent className="h-4 w-4" />
                          {!sidebarCollapsed && <span className="ml-2 sidebar-item-enter">{item.label}</span>}
                        </Button>

                        {/* Notification Badge */}
                        {notificationCounts[item.id] > 0 && (
                          <div className={`absolute ${sidebarCollapsed ? '-top-1 -right-1' : 'top-1 right-2'}
                              flex items-center justify-center min-w-5 h-5 text-xs font-medium
                              bg-destructive text-destructive-foreground rounded-full px-1
                              animate-pulse border-2 border-background z-10
                              notification-badge`}
                          >
                            {notificationCounts[item.id] > 99 ? '99+' : notificationCounts[item.id]}
                          </div>
                        )}
                      </div>
                    )

                    if (sidebarCollapsed) {
                      return (
                        <div key={item.id} className="flex justify-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {buttonContent}
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <p>{item.label}</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )
                    }

                    return <div key={item.id}>{buttonContent}</div>
                  })}
                </div>
                {!sidebarCollapsed && section.title !== "ERP Módulos" && (
                  <div className="mt-3 border-b border-border/50"></div>
                )}
              </div>
            ))}
          </nav>

          {/* Sidebar Footer */}
          <div className="border-t border-border p-2">
            {!sidebarCollapsed ? (
              <div className="space-y-2">
                <div className={`flex items-center space-x-2 px-2 py-1 text-sm transition-colors duration-300 ${connectionStatus === 'connected'
                  ? 'text-green-600'
                  : connectionStatus === 'connecting'
                    ? 'text-yellow-600'
                    : 'text-red-600'
                  }`}>
                  <div className={`w-2 h-2 rounded-full transition-all duration-300 ${connectionStatus === 'connected'
                    ? 'bg-green-500'
                    : connectionStatus === 'connecting'
                      ? 'bg-yellow-500 animate-pulse'
                      : 'bg-red-500'
                    }`}></div>
                  <span className="text-xs">
                    {connectionStatus === 'connected' && 'Conectado'}
                    {connectionStatus === 'connecting' && 'Conectando...'}
                    {connectionStatus === 'error' && 'Erro de conexão'}
                    {connectionStatus === 'disconnected' && 'Desconectado'}
                  </span>
                  {connectionStatus === 'connected' && latency > 0 && (
                    <span className="text-xs opacity-60">({latency}ms)</span>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="w-full justify-start">
                  <Gear className="h-4 w-4 mr-2" />
                  Preferências
                </Button>
              </div>
            ) : (
              <div className="flex justify-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-10 h-10 p-0">
                      <div className={`w-2 h-2 rounded-full transition-all duration-300 ${connectionStatus === 'connected'
                        ? 'bg-green-500'
                        : connectionStatus === 'connecting'
                          ? 'bg-yellow-500 animate-pulse'
                          : 'bg-red-500'
                        }`}></div>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <div className="text-center">
                      <p>
                        {connectionStatus === 'connected' && 'Conectado'}
                        {connectionStatus === 'connecting' && 'Conectando...'}
                        {connectionStatus === 'error' && 'Erro de conexão'}
                        {connectionStatus === 'disconnected' && 'Desconectado'}
                      </p>
                      {connectionStatus === 'connected' && latency > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">Latência: {latency}ms</p>
                      )}
                      {lastError && (
                        <p className="text-xs text-red-400 mt-1">{lastError}</p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
            <div className="px-4 h-16 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar clientes, oportunidades..."
                    value={searchQuery}
                    onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
                    className="pl-10 w-80"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  {/* Real-time WebSocket connection status indicator */}
                  <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ${connectionStatus === 'connected'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : connectionStatus === 'connecting'
                      ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                      : connectionStatus === 'error'
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-gray-50 text-gray-700 border border-gray-200'
                    }`}>
                    {/* Connection status dot with animation */}
                    <div className={`w-2 h-2 rounded-full transition-all duration-300 ${connectionStatus === 'connected'
                      ? 'bg-green-500'
                      : connectionStatus === 'connecting'
                        ? 'bg-yellow-500 animate-pulse'
                        : connectionStatus === 'error'
                          ? 'bg-red-500 animate-pulse'
                          : 'bg-gray-400'
                      }`}></div>

                    {/* Status text and details */}
                    <div className="flex flex-col">
                      <span className="leading-none">
                        {connectionStatus === 'connected' && 'Online'}
                        {connectionStatus === 'connecting' && 'Conectando...'}
                        {connectionStatus === 'error' && 'Erro'}
                        {connectionStatus === 'disconnected' && 'Offline'}
                      </span>

                      {/* Show latency when connected */}
                      {connectionStatus === 'connected' && latency > 0 && (
                        <span className="text-xs opacity-70 leading-none mt-0.5">
                          {latency}ms
                        </span>
                      )}

                      {/* Show error details */}
                      {connectionStatus === 'error' && lastError && (
                        <span className="text-xs opacity-70 leading-none mt-0.5 max-w-24 truncate" title={lastError}>
                          {lastError}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick notification indicators with enhanced tooltips */}

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="relative p-2"
                        onClick={() => setActiveTab('notifications')}
                      >
                        <Bell className="h-4 w-4" />
                        {notificationCounts.notifications > 0 && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-destructive rounded-full border border-background"></div>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-center">
                        <p>{notificationCounts.notifications > 0 ? `${notificationCounts.notifications} notificações não lidas` : 'Central de notificações'}</p>
                        {connectionStatus === 'connected' && (
                          <p className="text-xs text-muted-foreground mt-1">
                            WebSocket: {latency > 0 ? `${latency}ms` : 'Conectado'}
                          </p>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="relative p-2"
                        onClick={() => setActiveTab('omnichannel')}
                      >
                        <ChatCircle className="h-4 w-4" />
                        {notificationCounts.omnichannel > 0 && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border border-background"></div>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-center">
                        <p>{notificationCounts.omnichannel > 0 ? `${notificationCounts.omnichannel} mensagens não lidas` : 'Chat omnichannel'}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Status: {connectionStatus === 'connected' ? 'Online' : 'Offline'}
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="relative p-2"
                        onClick={() => setActiveTab('ai-automation')}
                      >
                        <Robot className="h-4 w-4" />
                        {notificationCounts.aiAutomation > 0 && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full border border-background"></div>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{notificationCounts.aiAutomation > 0 ? `${notificationCounts.aiAutomation} sugestões da IA` : 'Automação IA'}</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="relative p-2"
                        onClick={() => setActiveTab('alerts')}
                      >
                        <Bell className="h-4 w-4" />
                        {notificationCounts.alerts > 0 && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-destructive rounded-full border border-background"></div>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{notificationCounts.alerts > 0 ? `${notificationCounts.alerts} alertas ativos` : 'Central de alertas'}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                <Button variant="outline" size="sm">
                  <Bell className="h-4 w-4 mr-2" />
                  Notificações
                </Button>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo
                </Button>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-6 overflow-y-auto">
            <div className="space-y-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsContent value="dashboard" className="space-y-6">
                  {/* Metrics Overview */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {metrics.map((metric) => (
                      <MetricCard key={metric.id} metric={metric} />
                    ))}
                  </div>

                  {/* Advanced Analytics */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <PipelineAnalytics data={pipelineData} />
                    <RevenueChart data={revenueData} />
                  </div>

                  {/* AI Insights */}
                  <Card className="glass-card">
                    <CardHeader>
                      <div className="flex items-center space-x-2">
                        <Robot className="h-5 w-5 text-accent ai-processing" />
                        <CardTitle>Central de Inteligência Artificial</CardTitle>
                        <Badge variant="secondary" className="ai-processing">
                          <Lightning className="h-3 w-3 mr-1" />
                          Processando
                        </Badge>
                      </div>
                      <CardDescription>
                        Insights e recomendações gerados por IA em tempo real
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                          <div className="flex items-center space-x-2 mb-2">
                            <TrendUp className="h-4 w-4 text-green-600" />
                            <span className="font-medium text-green-800">Oportunidade Detectada</span>
                          </div>
                          <p className="text-sm text-green-700">
                            {opportunities.filter(o => o.aiScore > 80).length} oportunidades com alta probabilidade de fechamento.
                            Potencial: R$ {(opportunities.filter(o => o.aiScore > 80).reduce((sum, o) => sum + o.value, 0) / 1000).toFixed(0)}K
                          </p>
                        </div>
                        <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                          <div className="flex items-center space-x-2 mb-2">
                            <Users className="h-4 w-4 text-orange-600" />
                            <span className="font-medium text-orange-800">Retenção</span>
                          </div>
                          <p className="text-sm text-orange-700">
                            {customers.filter(c => c.status === 'inactive').length} clientes em risco de churn.
                            Campanha de reativação recomendada.
                          </p>
                        </div>
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                          <div className="flex items-center space-x-2 mb-2">
                            <Target className="h-4 w-4 text-blue-600" />
                            <span className="font-medium text-blue-800">Automação</span>
                          </div>
                          <p className="text-sm text-blue-700">
                            {activities.filter(a => a.type === 'email' || a.type === 'whatsapp').length} interações
                            podem ser automatizadas, economizando 15h/semana.
                          </p>
                        </div>
                      </div>

                      <div className="pt-4 border-t">
                        <h4 className="font-medium mb-3 flex items-center space-x-2">
                          <Sparkle className="h-4 w-4 text-accent ai-processing" />
                          <span>Recomendações Personalizadas</span>
                        </h4>
                        <div className="space-y-2">
                          <div className="flex items-start space-x-3 p-3 bg-accent/5 rounded-lg">
                            <div className="w-2 h-2 bg-accent rounded-full mt-2"></div>
                            <div>
                              <p className="font-medium text-sm">Otimizar Sequência de Follow-up</p>
                              <p className="text-xs text-muted-foreground">
                                IA detectou que follow-ups enviados às 14h têm 34% mais taxa de resposta
                              </p>
                            </div>
                          </div>
                          <div className="flex items-start space-x-3 p-3 bg-accent/5 rounded-lg">
                            <div className="w-2 h-2 bg-accent rounded-full mt-2"></div>
                            <div>
                              <p className="font-medium text-sm">Segmentação Inteligente</p>
                              <p className="text-xs text-muted-foreground">
                                Criar segmento "Tech Enterprises" pode aumentar conversão em 23%
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Recent Activities */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle>Atividades Recentes</CardTitle>
                      <CardDescription>
                        Últimas interações omnichannel com clientes
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {recentActivities.slice(0, 5).map((activity) => (
                        <ActivityCard key={activity.id} activity={activity} compact />
                      ))}
                      {recentActivities.length > 5 && (
                        <div className="pt-4 text-center">
                          <Button variant="outline" size="sm">
                            Ver Todas as Atividades
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="executive">
                  <ExecutiveDashboard />
                </TabsContent>

                <TabsContent value="notifications">
                  <NotificationTester />
                  <NotificationCenter />
                </TabsContent>

                <TabsContent value="customers" className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold">Gestão de Clientes</h2>
                      <p className="text-muted-foreground">
                        Visão 360° dos relacionamentos com clientes
                      </p>
                    </div>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Novo Cliente
                    </Button>
                  </div>

                  {filteredCustomers.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {filteredCustomers.map((customer) => (
                        <CustomerCard key={customer.id} customer={customer} />
                      ))}
                    </div>
                  ) : (
                    <Card className="glass-card">
                      <CardContent className="text-center py-12">
                        <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">
                          {searchQuery ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
                        </h3>
                        <p className="text-muted-foreground mb-4">
                          {searchQuery
                            ? `Nenhum resultado para "${searchQuery}". Tente outro termo.`
                            : "Comece adicionando seus primeiros clientes ao sistema."
                          }
                        </p>
                        {!searchQuery && (
                          <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Adicionar Cliente
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="leads">
                  <LeadsManager />
                </TabsContent>

                <TabsContent value="lead-scoring">
                  <LeadScoringSystem />
                </TabsContent>

                <TabsContent value="territories">
                  <TerritoriesManager />
                </TabsContent>

                <TabsContent value="webhooks">
                  <WebhooksIntegrationsHub />
                </TabsContent>

                <TabsContent value="quotes">
                  <QuotesManager />
                </TabsContent>

                <TabsContent value="web-forms">
                  <WebFormsManager />
                </TabsContent>

                <TabsContent value="email-templates">
                  <EmailTemplatesManager />
                </TabsContent>

                <TabsContent value="opportunities" className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold">Pipeline de Vendas</h2>
                      <p className="text-muted-foreground">
                        Gestão inteligente de oportunidades com IA preditiva
                      </p>
                    </div>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Nova Oportunidade
                    </Button>
                  </div>

                  {filteredOpportunities.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {filteredOpportunities.map((opportunity) => (
                        <OpportunityCard key={opportunity.id} opportunity={opportunity} />
                      ))}
                    </div>
                  ) : (
                    <Card className="glass-card">
                      <CardContent className="text-center py-12">
                        <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">
                          {searchQuery ? "Nenhuma oportunidade encontrada" : "Pipeline vazio"}
                        </h3>
                        <p className="text-muted-foreground mb-4">
                          {searchQuery
                            ? `Nenhum resultado para "${searchQuery}". Tente outro termo.`
                            : "Crie sua primeira oportunidade de venda."
                          }
                        </p>
                        {!searchQuery && (
                          <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Criar Oportunidade
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="activities" className="space-y-6">
                  <AdvancedActivitiesManager />
                </TabsContent>

                <TabsContent value="omnichannel" className="space-y-6">
                  <OmnichannelCenter
                    activities={activities}
                    onStartConversation={(channel, customerId) => {
                      console.log(`Starting ${channel} conversation with ${customerId || 'new contact'}`)
                      // Handle conversation start here
                    }}
                  />
                </TabsContent>

                <TabsContent value="ai-chat">
                  <AIChat />
                </TabsContent>

                <TabsContent value="ai-automation">
                  <AIAutomationHub />
                </TabsContent>

                <TabsContent value="agent-dashboard">
                  <AgentDashboard />
                </TabsContent>

                <TabsContent value="coaching">
                  <PerformanceCoaching />
                </TabsContent>

                <TabsContent value="alerts">
                  <PerformanceAlerts />
                </TabsContent>

                <TabsContent value="pipelines">
                  <PipelineManager />
                </TabsContent>

                <TabsContent value="settings">
                  <GlobalGear />
                </TabsContent>
                <TabsContent value="roi">
                  <ROIDashboard />
                </TabsContent>

                <TabsContent value="custom-objects">
                  <CustomObjectsManager />
                </TabsContent>

                <TabsContent value="reports">
                  <ReportsDashboard />
                </TabsContent>

                <TabsContent value="kanban">
                  <KanbanBoard
                    type="opportunities"
                    title="Pipeline de Vendas"
                    description="Visualização Kanban do seu pipeline de oportunidades"
                  />
                </TabsContent>

                <TabsContent value="tasks">
                  <RichTaskManager />
                </TabsContent>

                <TabsContent value="api">
                  <APIExplorer />
                </TabsContent>

                <TabsContent value="fields">
                  <div className="space-y-8">
                    <FieldsManager
                      objectType="contacts"
                      objectName="Contatos"
                    />

                    <ViewsManager
                      objectType="contacts"
                      objectName="Contatos"
                      availableFields={[
                        { name: 'name', label: 'Nome', type: 'text' },
                        { name: 'email', label: 'E-mail', type: 'email' },
                        { name: 'phone', label: 'Telefone', type: 'phone' },
                        { name: 'company', label: 'Empresa', type: 'text' },
                        { name: 'status', label: 'Status', type: 'select' },
                        { name: 'created_at', label: 'Criado em', type: 'datetime' },
                        { name: 'updated_at', label: 'Atualizado em', type: 'datetime' },
                        { name: 'tags', label: 'Tags', type: 'multiselect' },
                        { name: 'notes', label: 'Notas', type: 'textarea' },
                        { name: 'last_contact', label: 'Último Contato', type: 'date' }
                      ]}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="accounting">
                  <AccountingModule />
                </TabsContent>

                <TabsContent value="assets">
                  <AssetManagement />
                </TabsContent>

                <TabsContent value="companies">
                  <MultiCompanyManagement />
                </TabsContent>

                <TabsContent value="workflows">
                  <WorkflowEngine />
                </TabsContent>

                <TabsContent value="manufacturing">
                  <ManufacturingModule />
                </TabsContent>

                <TabsContent value="hr">
                  <HRModule />
                </TabsContent>

                <TabsContent value="procurement">
                  <ProcurementModule />
                </TabsContent>

                <TabsContent value="projects">
                  <ProjectManagement />
                </TabsContent>

                <TabsContent value="helpdesk">
                  <HelpDeskModule />
                </TabsContent>

                <TabsContent value="meta-integrations">
                  <MetaIntegrationsHub />
                </TabsContent>

                <TabsContent value="meta-command">
                  <MetaCommandCenter />
                </TabsContent>

                <TabsContent value="meta-sync">
                  <MetaSyncMonitor />
                </TabsContent>

                <TabsContent value="meta-sentiment">
                  <MetaSentimentMonitor />
                </TabsContent>

                <TabsContent value="meta-ads">
                  <MetaAdsManager />
                </TabsContent>

                <TabsContent value="whatsapp-business">
                  <WhatsAppBusinessHub />
                </TabsContent>

                <TabsContent value="instagram-studio">
                  <InstagramStudioPro />
                </TabsContent>

                <TabsContent value="threads-studio">
                  <ThreadsStudio />
                </TabsContent>

                <TabsContent value="system-monitoring">
                  <SystemMonitoring />
                </TabsContent>

                <TabsContent value="backup-recovery">
                  <BackupRecoveryCenter />
                </TabsContent>

                <TabsContent value="campaigns" className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold">Campanhas Inteligentes</h2>
                      <p className="text-muted-foreground">
                        Marketing automation com segmentação dinâmica e otimização por IA
                      </p>
                    </div>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Nova Campanha
                    </Button>
                  </div>

                  {/* Campaign Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <AnalyticsCard
                      title="Campanhas Ativas"
                      value={campaigns.filter(c => c.status === 'active').length}
                      change={15.2}
                      trend="up"
                      type="activities"
                      period="Este mês"
                    />
                    <AnalyticsCard
                      title="Taxa de Abertura Média"
                      value="68.4%"
                      change={8.1}
                      trend="up"
                      type="conversion"
                      period="30 dias"
                    />
                    <AnalyticsCard
                      title="Conversões Totais"
                      value={campaigns.reduce((sum, c) => sum + c.metrics.converted, 0)}
                      change={22.3}
                      trend="up"
                      type="leads"
                      period="Este mês"
                    />
                    <AnalyticsCard
                      title="ROI Médio"
                      value="320%"
                      change={12.7}
                      trend="up"
                      type="revenue"
                      period="3 meses"
                    />
                  </div>

                  {/* Campaigns Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredCampaigns.map((campaign) => (
                      <CampaignCard
                        key={campaign.id}
                        campaign={campaign}
                        onAction={(action) => {
                          console.log(`Campaign ${campaign.id}: ${action}`)
                          // Handle campaign actions here
                        }}
                      />
                    ))}
                  </div>

                  {filteredCampaigns.length === 0 && (
                    <Card className="glass-card">
                      <CardContent className="text-center py-12">
                        <Sparkle className="h-12 w-12 text-accent mx-auto mb-4 ai-processing" />
                        <h3 className="text-lg font-semibold mb-2">
                          Nenhuma campanha encontrada
                        </h3>
                        <p className="text-muted-foreground mb-4">
                          {searchQuery ? "Tente outro termo de busca" : "Crie sua primeira campanha inteligente"}
                        </p>
                        <Button>
                          <Plus className="h-4 w-4 mr-2" />
                          Criar Campanha
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}

function App() {
  return (
    <NotificationProvider>
      <AppContent />
    </NotificationProvider>
  )
}

export default App
