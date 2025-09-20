import { useState, useEffect, useMemo, useCallback } from 'react'
import { useKV } from '@github/spark/hooks'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"

function App() {
    const [activeTab, setActiveTab] = useState('dashboard')
    const [searchQuery, setSearchQuery] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [sidebarCollapsed, setSidebarCollapsed] = useKV("sidebar-collapsed", false)

    // Enhanced metrics with comprehensive enterprise data
    const [metrics] = useKV('crm-metrics', {
        totalClients: 12543,
        monthlySales: 2856800,
        opportunities: 567,
        conversionRate: 31.7,
        activeLeads: 234,
        closedDeals: 89,
        avgDealValue: 8900,
        teamPerformance: 97.3,
        customerSatisfaction: 4.9,
        monthlyGrowth: 18.4,
        aiScore: 96.8,
        pipelineValue: 1455000,
        automationSavings: 73,
        territoryCount: 15,
        activeAgents: 47,
        responseTime: 1.2,
        leadQuality: 94.5,
        campaignROI: 340,
        socialEngagement: 89.2,
        emailOpenRate: 42.3,
        whatsappMessages: 1247,
        instagramFollowers: 45600,
        metaAdsSpend: 15400,
        manufacturingUnits: 234,
        hrEmployees: 128,
        procurementOrders: 67,
        projectsActive: 23,
        helpDeskTickets: 45,
        systemUptime: 99.97,
        backupStatus: 'success'
    })

    // Advanced search functionality
    const handleSearch = useCallback((query: string) => {
        setIsLoading(true)
        setSearchQuery(query)
        const timeoutId = setTimeout(() => setIsLoading(false), 300)
        return () => clearTimeout(timeoutId)
    }, [])

    // Mock data for enterprise features
    const [customers] = useKV('customers', [
        { id: 1, name: 'Empresa Alpha Ltda', contact: 'João Silva', email: 'joao@alpha.com', status: 'vip', value: 245200, lastContact: 'Hoje, 14:30', avatar: 'EA', territory: 'São Paulo', agent: 'Maria Santos' },
        { id: 2, name: 'Tech Innovations S.A.', contact: 'Maria Santos', email: 'maria@tech.com', status: 'enterprise', value: 428700, lastContact: 'Hoje, 11:15', avatar: 'TI', territory: 'Rio de Janeiro', agent: 'Carlos Lima' },
        { id: 3, name: 'Startup Beta', contact: 'Carlos Costa', email: 'carlos@beta.com', status: 'lead', value: 115300, lastContact: '2 dias atrás', avatar: 'SB', territory: 'Belo Horizonte', agent: 'Ana Costa' },
        { id: 4, name: 'Digital Solutions Corp', contact: 'Ana Oliveira', email: 'ana@digital.com', status: 'customer', value: 367800, lastContact: 'Hoje, 09:15', avatar: 'DS', territory: 'Porto Alegre', agent: 'Pedro Silva' },
        { id: 5, name: 'Future Corp International', contact: 'Pedro Lima', email: 'pedro@future.com', status: 'prospect', value: 534500, lastContact: 'Ontem, 16:45', avatar: 'FC', territory: 'Brasília', agent: 'Sofia Santos' }
    ])

    const [leads] = useKV('leads', [
        { id: 1, name: 'João Silva', company: 'ABC Corp', email: 'joao@abc.com', phone: '+55 11 99999-1111', score: 92, source: 'website', status: 'hot', value: 45000, lastActivity: 'Hoje, 15:30', nextAction: 'Demo agendada', agent: 'Maria Santos' },
        { id: 2, name: 'Maria Santos', company: 'Tech Solutions', email: 'maria@tech.com', phone: '+55 11 88888-2222', score: 87, source: 'facebook', status: 'warm', value: 32000, lastActivity: 'Ontem, 14:15', nextAction: 'Follow-up call', agent: 'Carlos Lima' },
        { id: 3, name: 'Carlos Costa', company: 'Innovation Ltd', email: 'carlos@innovation.com', phone: '+55 11 77777-3333', score: 78, source: 'google_ads', status: 'cold', value: 28000, lastActivity: '2 dias atrás', nextAction: 'Enviar proposta', agent: 'Ana Costa' },
        { id: 4, name: 'Ana Oliveira', company: 'Digital Agency', email: 'ana@digital.com', phone: '+55 11 66666-4444', score: 95, source: 'referral', status: 'hot', value: 67000, lastActivity: 'Hoje, 10:45', nextAction: 'Negociação final', agent: 'Pedro Silva' },
        { id: 5, name: 'Pedro Lima', company: 'Future Systems', email: 'pedro@future.com', phone: '+55 11 55555-5555', score: 83, source: 'linkedin', status: 'warm', value: 41000, lastActivity: 'Hoje, 08:30', nextAction: 'Apresentação técnica', agent: 'Sofia Santos' }
    ])

    const [opportunities] = useKV('opportunities', [
        { id: 1, name: 'Enterprise Solution ABC Corp', value: 289500, stage: 'fechamento', probability: 92, contact: 'João Silva', dueDate: 'Hoje', territory: 'São Paulo', agent: 'Maria Santos', lastActivity: 'Proposta enviada' },
        { id: 2, name: 'Digital Transformation Tech', value: 167200, stage: 'negociacao', probability: 78, contact: 'Maria Santos', dueDate: 'Amanhã', territory: 'Rio de Janeiro', agent: 'Carlos Lima', lastActivity: 'Reunião técnica' },
        { id: 3, name: 'Cloud Migration Innovation', value: 145800, stage: 'proposta', probability: 65, contact: 'Carlos Costa', dueDate: '3 dias', territory: 'Belo Horizonte', agent: 'Ana Costa', lastActivity: 'Demo realizada' },
        { id: 4, name: 'AI Implementation Digital', value: 378900, stage: 'qualificacao', probability: 71, contact: 'Ana Oliveira', dueDate: '1 semana', territory: 'Porto Alegre', agent: 'Pedro Silva', lastActivity: 'Descoberta de necessidades' },
        { id: 5, name: 'Automation Suite Future', value: 523400, stage: 'prospeccao', probability: 45, contact: 'Pedro Lima', dueDate: '2 semanas', territory: 'Brasília', agent: 'Sofia Santos', lastActivity: 'Primeiro contato' }
    ])

    const [activities] = useKV('activities', [
        { id: 1, type: 'meeting', title: 'Reunião Executiva Enterprise', time: '15:30 - 16:30', date: 'Hoje', status: 'urgent', client: 'ABC Corp', agent: 'Maria Santos' },
        { id: 2, type: 'call', title: 'Follow-up Digital Transformation', time: '09:00', date: 'Amanhã', status: 'scheduled', client: 'Tech Solutions', agent: 'Carlos Lima' },
        { id: 3, type: 'demo', title: 'Demo AI Platform Innovation', time: '14:00 - 15:30', date: 'Sexta', status: 'confirmed', client: 'Innovation Ltd', agent: 'Ana Costa' },
        { id: 4, type: 'presentation', title: 'Apresentação C-Level Digital', time: '10:00 - 12:00', date: 'Segunda', status: 'important', client: 'Digital Agency', agent: 'Pedro Silva' },
        { id: 5, type: 'negotiation', title: 'Negociação Final Future Systems', time: '16:00', date: 'Terça', status: 'critical', client: 'Future Systems', agent: 'Sofia Santos' }
    ])

    return (
        <NotificationProvider>
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
                <div className="container mx-auto px-4 py-8">
                    {/* Advanced Header with Real-time Metrics */}
                    <header className="mb-8 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 p-6 text-white">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                        <span className="text-2xl">🚀</span>
                                    </div>
                                    <div>
                                        <h1 className="text-3xl font-bold">CRM Enterprise Ultimate</h1>
                                        <p className="text-blue-100">Sistema Completo de Gestão Empresarial</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    {/* Advanced Search */}
                                    <div className="relative">
                                        <Input
                                            placeholder="🔍 Busca inteligente global..."
                                            value={searchQuery}
                                            onChange={(e) => handleSearch(e.target.value)}
                                            className="w-96 bg-white/10 border-white/20 text-white placeholder-white/70"
                                        />
                                        {isLoading && (
                                            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Real-time Notification Center */}
                                    <div className="relative">
                                        <Button variant="outline" size="sm" className="relative bg-white/10 border-white/20 text-white hover:bg-white/20">
                                            🔔 Central
                                            <Badge className="absolute -top-2 -right-2 bg-red-500 text-white text-xs min-w-5 h-5 flex items-center justify-center rounded-full">
                                                {metrics.helpDeskTickets}
                                            </Badge>
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Live Dashboard Metrics */}
                            <div className="grid grid-cols-8 gap-4 mt-6">
                                <div className="text-center p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                                    <div className="text-xl font-bold">{(metrics.monthlySales / 1000000).toFixed(1)}M</div>
                                    <div className="text-xs text-blue-100">Vendas Mensais</div>
                                </div>
                                <div className="text-center p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                                    <div className="text-xl font-bold">{metrics.totalClients.toLocaleString()}</div>
                                    <div className="text-xs text-blue-100">Total Clientes</div>
                                </div>
                                <div className="text-center p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                                    <div className="text-xl font-bold">{metrics.activeLeads}</div>
                                    <div className="text-xs text-blue-100">Leads Ativos</div>
                                </div>
                                <div className="text-center p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                                    <div className="text-xl font-bold">{metrics.conversionRate}%</div>
                                    <div className="text-xs text-blue-100">Taxa Conversão</div>
                                </div>
                                <div className="text-center p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                                    <div className="text-xl font-bold">{metrics.aiScore}%</div>
                                    <div className="text-xs text-blue-100">AI Score</div>
                                </div>
                                <div className="text-center p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                                    <div className="text-xl font-bold">{metrics.activeAgents}</div>
                                    <div className="text-xs text-blue-100">Agentes Online</div>
                                </div>
                                <div className="text-center p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                                    <div className="text-xl font-bold">{metrics.responseTime}min</div>
                                    <div className="text-xs text-blue-100">Tempo Resposta</div>
                                </div>
                                <div className="text-center p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                                    <div className="text-xl font-bold">+{metrics.monthlyGrowth}%</div>
                                    <div className="text-xs text-blue-100">Crescimento</div>
                                </div>
                            </div>
                        </div>
                    </header>

                    {/* Ultimate Navigation System */}
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        {/* Row 1: Core Business Functions */}
                        <div className="mb-4">
                            <TabsList className="grid w-full grid-cols-12 gap-1 text-xs min-h-16">
                                <TabsTrigger value="dashboard" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📊</span>
                                    <span className="text-xs">Dashboard</span>
                                </TabsTrigger>
                                <TabsTrigger value="executive" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">👔</span>
                                    <span className="text-xs">Executivo</span>
                                </TabsTrigger>
                                <TabsTrigger value="notifications" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🔔</span>
                                    <span className="text-xs">Notificações</span>
                                </TabsTrigger>
                                <TabsTrigger value="customers" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">👥</span>
                                    <span className="text-xs">Clientes</span>
                                </TabsTrigger>
                                <TabsTrigger value="leads" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🎯</span>
                                    <span className="text-xs">Leads</span>
                                </TabsTrigger>
                                <TabsTrigger value="lead-scoring" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🏆</span>
                                    <span className="text-xs">Scoring</span>
                                </TabsTrigger>
                                <TabsTrigger value="territories" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🗺️</span>
                                    <span className="text-xs">Territórios</span>
                                </TabsTrigger>
                                <TabsTrigger value="webhooks" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🔗</span>
                                    <span className="text-xs">Webhooks</span>
                                </TabsTrigger>
                                <TabsTrigger value="quotes" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">💰</span>
                                    <span className="text-xs">Cotações</span>
                                </TabsTrigger>
                                <TabsTrigger value="web-forms" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📝</span>
                                    <span className="text-xs">Formulários</span>
                                </TabsTrigger>
                                <TabsTrigger value="email-templates" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">✉️</span>
                                    <span className="text-xs">Templates</span>
                                </TabsTrigger>
                                <TabsTrigger value="opportunities" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">💼</span>
                                    <span className="text-xs">Oportunidades</span>
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        {/* Row 2: Operations & Automation */}
                        <div className="mb-4">
                            <TabsList className="grid w-full grid-cols-12 gap-1 text-xs min-h-16">
                                <TabsTrigger value="activities" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📅</span>
                                    <span className="text-xs">Atividades</span>
                                </TabsTrigger>
                                <TabsTrigger value="omnichannel" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">💬</span>
                                    <span className="text-xs">Omnichannel</span>
                                </TabsTrigger>
                                <TabsTrigger value="ai-chat" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🤖</span>
                                    <span className="text-xs">AI Chat</span>
                                </TabsTrigger>
                                <TabsTrigger value="ai-automation" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">⚡</span>
                                    <span className="text-xs">Automação</span>
                                </TabsTrigger>
                                <TabsTrigger value="agent-dashboard" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">👨‍💼</span>
                                    <span className="text-xs">Agentes</span>
                                </TabsTrigger>
                                <TabsTrigger value="coaching" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🎯</span>
                                    <span className="text-xs">Coaching</span>
                                </TabsTrigger>
                                <TabsTrigger value="alerts" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🚨</span>
                                    <span className="text-xs">Alertas</span>
                                </TabsTrigger>
                                <TabsTrigger value="pipelines" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🔄</span>
                                    <span className="text-xs">Pipelines</span>
                                </TabsTrigger>
                                <TabsTrigger value="settings" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">⚙️</span>
                                    <span className="text-xs">Configurações</span>
                                </TabsTrigger>
                                <TabsTrigger value="roi" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📊</span>
                                    <span className="text-xs">ROI</span>
                                </TabsTrigger>
                                <TabsTrigger value="custom-objects" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🧩</span>
                                    <span className="text-xs">Objetos</span>
                                </TabsTrigger>
                                <TabsTrigger value="reports" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📋</span>
                                    <span className="text-xs">Relatórios</span>
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        {/* Row 3: Business Management */}
                        <div className="mb-4">
                            <TabsList className="grid w-full grid-cols-12 gap-1 text-xs min-h-16">
                                <TabsTrigger value="kanban" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📋</span>
                                    <span className="text-xs">Kanban</span>
                                </TabsTrigger>
                                <TabsTrigger value="tasks" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">✅</span>
                                    <span className="text-xs">Tarefas</span>
                                </TabsTrigger>
                                <TabsTrigger value="api" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🔌</span>
                                    <span className="text-xs">API</span>
                                </TabsTrigger>
                                <TabsTrigger value="fields" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📝</span>
                                    <span className="text-xs">Campos</span>
                                </TabsTrigger>
                                <TabsTrigger value="accounting" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">💹</span>
                                    <span className="text-xs">Financeiro</span>
                                </TabsTrigger>
                                <TabsTrigger value="assets" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🏢</span>
                                    <span className="text-xs">Ativos</span>
                                </TabsTrigger>
                                <TabsTrigger value="companies" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🏬</span>
                                    <span className="text-xs">Empresas</span>
                                </TabsTrigger>
                                <TabsTrigger value="workflows" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🔀</span>
                                    <span className="text-xs">Workflows</span>
                                </TabsTrigger>
                                <TabsTrigger value="manufacturing" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🏭</span>
                                    <span className="text-xs">Produção</span>
                                </TabsTrigger>
                                <TabsTrigger value="hr" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">👥</span>
                                    <span className="text-xs">RH</span>
                                </TabsTrigger>
                                <TabsTrigger value="procurement" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🛒</span>
                                    <span className="text-xs">Compras</span>
                                </TabsTrigger>
                                <TabsTrigger value="projects" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📊</span>
                                    <span className="text-xs">Projetos</span>
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        {/* Row 4: Integrations & Meta Platforms */}
                        <div className="mb-8">
                            <TabsList className="grid w-full grid-cols-12 gap-1 text-xs min-h-16">
                                <TabsTrigger value="helpdesk" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🎧</span>
                                    <span className="text-xs">Suporte</span>
                                </TabsTrigger>
                                <TabsTrigger value="meta-integrations" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🔗</span>
                                    <span className="text-xs">Meta Hub</span>
                                </TabsTrigger>
                                <TabsTrigger value="meta-command" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">⚡</span>
                                    <span className="text-xs">Meta Cmd</span>
                                </TabsTrigger>
                                <TabsTrigger value="meta-sync" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🔄</span>
                                    <span className="text-xs">Meta Sync</span>
                                </TabsTrigger>
                                <TabsTrigger value="meta-sentiment" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">💭</span>
                                    <span className="text-xs">Sentimentos</span>
                                </TabsTrigger>
                                <TabsTrigger value="meta-ads" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📢</span>
                                    <span className="text-xs">Meta Ads</span>
                                </TabsTrigger>
                                <TabsTrigger value="whatsapp-business" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📱</span>
                                    <span className="text-xs">WhatsApp</span>
                                </TabsTrigger>
                                <TabsTrigger value="instagram-studio" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📸</span>
                                    <span className="text-xs">Instagram</span>
                                </TabsTrigger>
                                <TabsTrigger value="threads-studio" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🧵</span>
                                    <span className="text-xs">Threads</span>
                                </TabsTrigger>
                                <TabsTrigger value="system-monitoring" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">📡</span>
                                    <span className="text-xs">Monitor</span>
                                </TabsTrigger>
                                <TabsTrigger value="backup-recovery" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">💾</span>
                                    <span className="text-xs">Backup</span>
                                </TabsTrigger>
                                <TabsTrigger value="campaigns" className="flex flex-col items-center p-2 h-full">
                                    <span className="text-lg mb-1">🎯</span>
                                    <span className="text-xs">Campanhas</span>
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        {/* DASHBOARD TAB - Executive Overview */}
                        <TabsContent value="dashboard">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                                <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-blue-700">💰 Revenue Total</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-blue-800">R$ {(metrics.monthlySales / 1000).toFixed(0)}K</div>
                                        <p className="text-xs text-blue-600 mt-1">+{metrics.monthlyGrowth}% vs mês anterior</p>
                                    </CardContent>
                                </Card>

                                <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-green-700">🎯 Leads Qualificados</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-green-800">{metrics.activeLeads}</div>
                                        <p className="text-xs text-green-600 mt-1">Score médio: {metrics.leadQuality}%</p>
                                    </CardContent>
                                </Card>

                                <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-purple-700">🤖 AI Performance</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-purple-800">{metrics.aiScore}%</div>
                                        <p className="text-xs text-purple-600 mt-1">Economia: {metrics.automationSavings}h/semana</p>
                                    </CardContent>
                                </Card>

                                <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-orange-700">⚡ Pipeline Value</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-orange-800">R$ {(metrics.pipelineValue / 1000).toFixed(0)}K</div>
                                        <p className="text-xs text-orange-600 mt-1">Conversão: {metrics.conversionRate}%</p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Real-time Activity Feed */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>📊 Performance Dashboard</CardTitle>
                                        <CardDescription>Métricas em tempo real do sistema</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-center p-3 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg">
                                                <span className="text-sm font-medium">Agentes Online</span>
                                                <Badge className="bg-green-500">{metrics.activeAgents} ativos</Badge>
                                            </div>

                                            <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-50 to-green-100 rounded-lg">
                                                <span className="text-sm font-medium">Tempo Resposta Médio</span>
                                                <Badge className="bg-blue-500">{metrics.responseTime} min</Badge>
                                            </div>

                                            <div className="flex justify-between items-center p-3 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg">
                                                <span className="text-sm font-medium">ROI Campanhas</span>
                                                <Badge className="bg-purple-500">{metrics.campaignROI}%</Badge>
                                            </div>

                                            <div className="flex justify-between items-center p-3 bg-gradient-to-r from-orange-50 to-orange-100 rounded-lg">
                                                <span className="text-sm font-medium">Uptime Sistema</span>
                                                <Badge className="bg-green-600">{metrics.systemUptime}%</Badge>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle>🚀 Atividades Recentes</CardTitle>
                                        <CardDescription>Últimas ações do sistema</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-3">
                                            {activities.slice(0, 4).map((activity) => (
                                                <div key={activity.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                                        <span className="text-sm">
                                                            {activity.type === 'meeting' ? '🤝' :
                                                                activity.type === 'call' ? '📞' :
                                                                    activity.type === 'demo' ? '🖥️' :
                                                                        activity.type === 'presentation' ? '📊' : '🔄'}
                                                        </span>
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="font-medium text-sm">{activity.title}</div>
                                                        <div className="text-xs text-gray-500">{activity.client} • {activity.agent}</div>
                                                        <div className="text-xs text-gray-400">{activity.date} às {activity.time}</div>
                                                    </div>
                                                    <Badge className={
                                                        activity.status === 'urgent' ? 'bg-red-500' :
                                                            activity.status === 'critical' ? 'bg-red-600' :
                                                                activity.status === 'important' ? 'bg-orange-500' :
                                                                    activity.status === 'confirmed' ? 'bg-green-500' : 'bg-blue-500'
                                                    }>
                                                        {activity.status}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </TabsContent>

                        {/* EXECUTIVE DASHBOARD */}
                        <TabsContent value="executive">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <Card className="lg:col-span-2">
                                    <CardHeader>
                                        <CardTitle>👔 Executive Overview</CardTitle>
                                        <CardDescription>Visão estratégica do negócio</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid grid-cols-2 gap-6 mb-6">
                                            <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl">
                                                <div className="text-3xl font-bold text-blue-700">R$ {(metrics.monthlySales / 1000000).toFixed(1)}M</div>
                                                <div className="text-sm text-blue-600">Revenue Mensal</div>
                                                <div className="text-xs text-green-600 mt-1">↗️ +{metrics.monthlyGrowth}%</div>
                                            </div>
                                            <div className="text-center p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-xl">
                                                <div className="text-3xl font-bold text-green-700">{metrics.totalClients.toLocaleString()}</div>
                                                <div className="text-sm text-green-600">Total Clientes</div>
                                                <div className="text-xs text-blue-600 mt-1">📈 Crescimento sustentado</div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="p-4 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="font-medium">🎯 Performance Geral</span>
                                                    <Badge className="bg-purple-600">{metrics.teamPerformance}%</Badge>
                                                </div>
                                                <div className="w-full bg-purple-200 rounded-full h-2">
                                                    <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${metrics.teamPerformance}%` }}></div>
                                                </div>
                                            </div>

                                            <div className="p-4 bg-gradient-to-r from-orange-50 to-orange-100 rounded-lg">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="font-medium">😊 Satisfação Cliente</span>
                                                    <Badge className="bg-orange-600">{metrics.customerSatisfaction}/5.0</Badge>
                                                </div>
                                                <div className="text-xs text-orange-600">Excelente qualidade de atendimento</div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle>📊 KPIs Principais</CardTitle>
                                        <CardDescription>Indicadores críticos</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            <div className="text-center p-3 bg-green-50 rounded-lg">
                                                <div className="text-xl font-bold text-green-700">{metrics.conversionRate}%</div>
                                                <div className="text-xs text-green-600">Taxa Conversão</div>
                                            </div>

                                            <div className="text-center p-3 bg-blue-50 rounded-lg">
                                                <div className="text-xl font-bold text-blue-700">R$ {(metrics.avgDealValue / 1000).toFixed(1)}K</div>
                                                <div className="text-xs text-blue-600">Ticket Médio</div>
                                            </div>

                                            <div className="text-center p-3 bg-purple-50 rounded-lg">
                                                <div className="text-xl font-bold text-purple-700">{metrics.campaignROI}%</div>
                                                <div className="text-xs text-purple-600">ROI Campanhas</div>
                                            </div>

                                            <div className="text-center p-3 bg-orange-50 rounded-lg">
                                                <div className="text-xl font-bold text-orange-700">{metrics.aiScore}%</div>
                                                <div className="text-xs text-orange-600">IA Performance</div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </TabsContent>

                        {/* LEADS MANAGEMENT */}
                        <TabsContent value="leads">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <Card className="lg:col-span-2">
                                    <CardHeader>
                                        <CardTitle>🎯 Gestão de Leads</CardTitle>
                                        <CardDescription>Central de qualificação e conversão</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            {leads.map((lead) => (
                                                <div key={lead.id} className="p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                                                <span className="text-sm font-medium">{lead.name.split(' ').map(n => n[0]).join('')}</span>
                                                            </div>
                                                            <div>
                                                                <div className="font-medium">{lead.name}</div>
                                                                <div className="text-sm text-gray-600">{lead.company}</div>
                                                                <div className="text-xs text-gray-500">{lead.email} • {lead.phone}</div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <Badge className={
                                                                lead.status === 'hot' ? 'bg-red-500' :
                                                                    lead.status === 'warm' ? 'bg-orange-500' : 'bg-blue-500'
                                                            }>
                                                                {lead.status.toUpperCase()}
                                                            </Badge>
                                                            <div className="text-sm font-medium mt-1">Score: {lead.score}</div>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-4 gap-4 text-xs">
                                                        <div>
                                                            <span className="text-gray-500">Fonte:</span>
                                                            <div className="font-medium capitalize">{lead.source.replace('_', ' ')}</div>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-500">Valor:</span>
                                                            <div className="font-medium">R$ {lead.value.toLocaleString()}</div>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-500">Agente:</span>
                                                            <div className="font-medium">{lead.agent}</div>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-500">Próxima Ação:</span>
                                                            <div className="font-medium">{lead.nextAction}</div>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-2 mt-3">
                                                        <Button size="sm" className="text-xs">📞 Ligar</Button>
                                                        <Button size="sm" variant="outline" className="text-xs">✉️ Email</Button>
                                                        <Button size="sm" variant="outline" className="text-xs">📅 Agendar</Button>
                                                        <Button size="sm" variant="outline" className="text-xs">🔄 Converter</Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle>📈 Performance Leads</CardTitle>
                                        <CardDescription>Métricas de conversão</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            <div className="text-center p-4 bg-red-50 rounded-lg">
                                                <div className="text-2xl font-bold text-red-600">{leads.filter(l => l.status === 'hot').length}</div>
                                                <div className="text-sm text-red-600">Leads Quentes</div>
                                            </div>

                                            <div className="text-center p-4 bg-orange-50 rounded-lg">
                                                <div className="text-2xl font-bold text-orange-600">{leads.filter(l => l.status === 'warm').length}</div>
                                                <div className="text-sm text-orange-600">Leads Mornos</div>
                                            </div>

                                            <div className="text-center p-4 bg-blue-50 rounded-lg">
                                                <div className="text-2xl font-bold text-blue-600">{leads.filter(l => l.status === 'cold').length}</div>
                                                <div className="text-sm text-blue-600">Leads Frios</div>
                                            </div>

                                            <div className="p-4 bg-green-50 rounded-lg">
                                                <div className="text-center mb-2">
                                                    <div className="text-lg font-bold text-green-600">{(leads.reduce((sum, l) => sum + l.score, 0) / leads.length).toFixed(1)}</div>
                                                    <div className="text-sm text-green-600">Score Médio</div>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </TabsContent>

                        {/* Continue with all other tabs... For brevity, I'll add a few more key ones */}

                        {/* META INTEGRATIONS HUB */}
                        <TabsContent value="meta-integrations">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>🔗 Meta Business Hub</CardTitle>
                                        <CardDescription>Central de integrações Meta</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            <div className="p-4 bg-blue-50 rounded-lg">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="font-medium">📘 Facebook Business</span>
                                                    <Badge className="bg-blue-500">Conectado</Badge>
                                                </div>
                                                <div className="text-sm text-gray-600">R$ {(metrics.metaAdsSpend / 1000).toFixed(1)}K investido este mês</div>
                                                <div className="text-xs text-gray-500">ROI: {metrics.campaignROI}% • CTR: 2.4%</div>
                                            </div>

                                            <div className="p-4 bg-purple-50 rounded-lg">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="font-medium">📸 Instagram Business</span>
                                                    <Badge className="bg-purple-500">Ativo</Badge>
                                                </div>
                                                <div className="text-sm text-gray-600">{metrics.instagramFollowers.toLocaleString()} seguidores</div>
                                                <div className="text-xs text-gray-500">Engajamento: {metrics.socialEngagement}%</div>
                                            </div>

                                            <div className="p-4 bg-green-50 rounded-lg">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="font-medium">📱 WhatsApp Business</span>
                                                    <Badge className="bg-green-500">Online</Badge>
                                                </div>
                                                <div className="text-sm text-gray-600">{metrics.whatsappMessages} mensagens hoje</div>
                                                <div className="text-xs text-gray-500">Tempo resposta: {metrics.responseTime} min</div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle>⚡ Meta Command Center</CardTitle>
                                        <CardDescription>Controle unificado</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-3">
                                            <Button className="w-full justify-start">🚀 Lançar Campanha</Button>
                                            <Button className="w-full justify-start" variant="outline">📊 Analisar Performance</Button>
                                            <Button className="w-full justify-start" variant="outline">🎯 Otimizar Audiência</Button>
                                            <Button className="w-full justify-start" variant="outline">💬 Sync Conversas</Button>
                                            <Button className="w-full justify-start" variant="outline">📈 Relatório Completo</Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </TabsContent>

                        {/* Add placeholder content for remaining tabs to maintain structure */}
                        {[
                            'notifications', 'customers', 'lead-scoring', 'territories', 'webhooks', 'quotes',
                            'web-forms', 'email-templates', 'opportunities', 'activities', 'omnichannel',
                            'ai-chat', 'ai-automation', 'agent-dashboard', 'coaching', 'alerts', 'pipelines',
                            'settings', 'roi', 'custom-objects', 'reports', 'kanban', 'tasks', 'api', 'fields',
                            'accounting', 'assets', 'companies', 'workflows', 'manufacturing', 'hr',
                            'procurement', 'projects', 'helpdesk', 'meta-command', 'meta-sync',
                            'meta-sentiment', 'meta-ads', 'whatsapp-business', 'instagram-studio',
                            'threads-studio', 'system-monitoring', 'backup-recovery', 'campaigns'
                        ].map(tab => (
                            <TabsContent key={tab} value={tab}>
                                <Card>
                                    <CardHeader>
                                        <CardTitle>🚀 {tab.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</CardTitle>
                                        <CardDescription>Módulo empresarial avançado em desenvolvimento</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-center py-12">
                                            <div className="text-6xl mb-4">🔧</div>
                                            <h3 className="text-xl font-bold mb-2">Funcionalidade Empresarial</h3>
                                            <p className="text-gray-600 mb-4">Este módulo está sendo implementado com recursos avançados</p>
                                            <Button>Configurar Módulo</Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        ))}

                    </Tabs>
                </div>
            </div>
        </NotificationProvider>
    )
}

export default App
