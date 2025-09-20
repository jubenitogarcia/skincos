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
  const [userLevel, setUserLevel] = useKV("user-level", 3)
  const [userXP, setUserXP] = useKV("user-xp", 450)
  const [userBadges, setUserBadges] = useKV("user-badges", ['first-sale', 'speed-demon', 'deal-closer'])
  const [notifications, setNotifications] = useState([])
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [animationDelay, setAnimationDelay] = useState(0)

  // Animation timing for staggered effects
  useEffect(() => {
    const timer = setTimeout(() => setIsInitialLoad(false), 500)
    return () => clearTimeout(timer)
  }, [])

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

  // Gamification system
  const achievementSystem = {
    levels: [
      { level: 1, xpRequired: 0, title: "Iniciante", color: "bg-gray-500" },
      { level: 2, xpRequired: 100, title: "Vendedor", color: "bg-blue-500" },
      { level: 3, xpRequired: 300, title: "Especialista", color: "bg-purple-500" },
      { level: 4, xpRequired: 600, title: "Expert", color: "bg-orange-500" },
      { level: 5, xpRequired: 1000, title: "Master", color: "bg-red-500" },
      { level: 6, xpRequired: 1500, title: "Legend", color: "bg-yellow-500" }
    ],
    badges: [
      { id: 'first-sale', name: 'Primeira Venda', icon: '🎉', description: 'Complete sua primeira venda' },
      { id: 'speed-demon', name: 'Velocidade', icon: '⚡', description: 'Responda em menos de 1 min' },
      { id: 'deal-closer', name: 'Fechador', icon: '🏆', description: 'Feche 10 negócios' },
      { id: 'social-star', name: 'Estrela Social', icon: '⭐', description: 'Excelente engajamento social' }
    ]
  }

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
      <div className="flex h-screen bg-gray-50">
        {/* Sidebar - NEATLAB Style */}
        <div className="w-64 bg-gray-900 text-white flex flex-col">
          {/* Logo Area */}
          <div className="p-6 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-xl font-bold">EF</span>
              </div>
              <div>
                <h1 className="text-lg font-semibold">Espaço Facial</h1>
                <p className="text-xs text-gray-400">CRM Dashboard</p>
              </div>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="flex-1 p-4">
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  <span className="text-lg">📊</span>
                  <span>Analítica</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('customers')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'customers' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  <span className="text-lg">🛒</span>
                  <span>Clientes</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('leads')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'leads' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  <span className="text-lg">💎</span>
                  <span>Leads</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('products')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'products' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  <span className="text-lg">📦</span>
                  <span>Serviços</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('managers')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'managers' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  <span className="text-lg">👥</span>
                  <span>Especialistas</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('reports')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'reports' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  <span className="text-lg">⏰</span>
                  <span>Relatórios</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('communications')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'communications' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  <span className="text-lg">💬</span>
                  <span>Comunicações</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('finance')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'finance' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  <span className="text-lg">💳</span>
                  <span>Finanças</span>
                </button>
              </li>
            </ul>
          </nav>

          {/* Bottom Section */}
          <div className="p-4 border-t border-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-gray-600 rounded-full"></div>
              <div className="text-sm">
                <p className="font-medium">Admin</p>
                <p className="text-gray-400 text-xs">admin@espacofacial.com</p>
              </div>
            </div>
            <button className="w-full flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-gray-800 rounded-lg">
              <span>⚙️</span>
              <span>Configurações</span>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Header */}
          <header className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Analítica</h1>
                <p className="text-gray-600">Estatística por todos os usuários e por todos os clientes</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Input
                    placeholder="Buscar..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="w-80 pl-10"
                  />
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">🔍</span>
                </div>
                <Button variant="outline" className="relative">
                  🔔
                  <Badge className="absolute -top-2 -right-2 bg-red-500 text-white text-xs min-w-5 h-5 flex items-center justify-center rounded-full">
                    {metrics.helpDeskTickets}
                  </Badge>
                </Button>
              </div>
            </div>
          </header>

          {/* Main Dashboard Content */}
          <main className="flex-1 overflow-auto p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsContent value="dashboard" className="space-y-6">
                {/* Key Metrics Cards - NEATLAB Style */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <Card className="bg-white border border-gray-200 hover:shadow-lg transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-600">Faturamento</p>
                          <p className="text-2xl font-bold text-gray-900">R$ {(faturamento / 1000).toFixed(1)}k</p>
                          <p className="text-sm text-green-600">+12.5% este mês</p>
                        </div>
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                          <span className="text-2xl">💰</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border border-gray-200 hover:shadow-lg transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-600">Clientes Ativos</p>
                          <p className="text-2xl font-bold text-gray-900">{metrics.totalCustomers}</p>
                          <p className="text-sm text-green-600">+8.2% este mês</p>
                        </div>
                        <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                          <span className="text-2xl">👥</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border border-gray-200 hover:shadow-lg transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-600">Harmonizados</p>
                          <p className="text-2xl font-bold text-gray-900">{metrics.ordersCompleted}</p>
                          <p className="text-sm text-blue-600">+15.3% este mês</p>
                        </div>
                        <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                          <span className="text-2xl">💎</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border border-gray-200 hover:shadow-lg transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-600">Especialistas</p>
                          <p className="text-2xl font-bold text-gray-900">{metrics.totalAgents}</p>
                          <p className="text-sm text-orange-600">+3 novos</p>
                        </div>
                        <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                          <span className="text-2xl">👨‍⚕️</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Customer Activity Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Customer List */}
                  <Card className="lg:col-span-2 bg-white border border-gray-200">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg font-semibold text-gray-900">Clientes Recentes</CardTitle>
                        <Button variant="outline" size="sm">Ver Todos</Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {customers.slice(0, 5).map((customer, index) => (
                          <div key={index} className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                              {customer.name[0]}
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{customer.name}</p>
                              <p className="text-sm text-gray-500">{customer.email}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium text-gray-900">R$ {customer.totalValue.toLocaleString()}</p>
                              <p className="text-xs text-gray-500">{customer.lastActivity}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Finance Summary */}
                  <Card className="bg-white border border-gray-200">
                    <CardHeader>
                      <CardTitle className="text-lg font-semibold text-gray-900">Resumo Financeiro</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span className="text-sm font-medium">Receitas</span>
                          </div>
                          <span className="text-sm font-bold text-green-700">R$ {(faturamento * 0.7).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                            <span className="text-sm font-medium">Despesas</span>
                          </div>
                          <span className="text-sm font-bold text-red-700">R$ {(faturamento * 0.3).toLocaleString()}</span>
                        </div>
                        <div className="border-t pt-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-600">Lucro Líquido</span>
                            <span className="text-lg font-bold text-blue-600">R$ {(faturamento * 0.4).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Recent Activities */}
                <Card className="bg-white border border-gray-200">
                  <CardHeader>
                    <CardTitle className="text-lg font-semibold text-gray-900">Atividades Recentes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-sm">👤</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">Nova cliente cadastrada: Maria Silva</p>
                          <p className="text-xs text-gray-500">Há 5 minutos</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                        <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                          <span className="text-sm">💰</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">Pagamento recebido: R$ 1.200</p>
                          <p className="text-xs text-gray-500">Há 15 minutos</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                        <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                          <span className="text-sm">💎</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">Harmonização facial concluída</p>
                          <p className="text-xs text-gray-500">Há 30 minutos</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            {/* Premium Header with Glassmorphism - Espaço Facial */}
            <header className={`mb-10 transition-all duration-1000 ease-out transform ${isInitialLoad ? 'translate-y-[-100px] opacity-0' : 'translate-y-0 opacity-100'}`}>
              <div className="bg-white/10 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden relative">
                {/* Glassmorphism overlay */}
                <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-white/10 to-white/5"></div>

                <div className="relative z-10 bg-gradient-to-r from-zinc-700/90 via-slate-600/90 to-zinc-700/90 p-10 text-white backdrop-blur-sm">
                  {/* Dynamic Background Pattern - Espaço Facial Style */}
                  <div className="absolute inset-0 opacity-15">
                    <div className="absolute top-0 left-0 w-40 h-40 bg-rose-300 rounded-full animate-pulse blur-xl"></div>
                    <div className="absolute bottom-0 right-0 w-32 h-32 bg-amber-300 rounded-full animate-pulse blur-xl" style={{ animationDelay: '1s' }}></div>
                    <div className="absolute top-1/2 left-1/2 w-24 h-24 bg-slate-300 rounded-full animate-pulse blur-xl" style={{ animationDelay: '2s' }}></div>
                  </div>

                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                      <div className="group relative">
                        {/* Logo inspirado no Espaço Facial */}
                        <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center backdrop-blur-sm border border-white/30 transform transition-all duration-500 group-hover:scale-110 group-hover:rotate-6">
                          <div className="flex flex-col items-center">
                            <div className="text-2xl font-black text-rose-300">EF</div>
                            <div className="text-xs text-slate-300 font-medium">CRM</div>
                          </div>
                        </div>
                        <div className="absolute -inset-2 bg-gradient-to-r from-rose-400 to-amber-400 rounded-3xl opacity-0 group-hover:opacity-30 transition-opacity duration-500 blur-xl"></div>
                      </div>
                      <div className="space-y-2">
                        <h1 className="text-5xl font-black tracking-tight bg-gradient-to-r from-white via-rose-100 to-amber-100 bg-clip-text text-transparent drop-shadow-2xl">
                          Espaço Facial CRM
                        </h1>
                        <p className="text-xl text-slate-100 font-medium tracking-wide">
                          Sistema de Gestão • Harmonização Facial Premium
                        </p>
                        <div className="flex items-center gap-4 mt-4">
                          <Badge className="bg-rose-500/80 text-white px-4 py-2 text-sm font-bold backdrop-blur-sm">
                            🌹 Sistema Online
                          </Badge>
                          <Badge className="bg-amber-500/80 text-white px-4 py-2 text-sm font-bold backdrop-blur-sm">
                            ✨ Performance {metrics.teamPerformance}%
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {/* Enhanced Gamification Panel - Espaço Facial Style */}
                    <div className="flex items-center gap-8">
                      <div className="bg-white/15 backdrop-blur-xl rounded-3xl p-6 border border-white/30 shadow-2xl transform transition-all duration-500 hover:scale-105">
                        <div className="flex items-center gap-4 mb-4">
                          <div className="relative">
                            <div className="w-12 h-12 bg-gradient-to-br from-rose-400 to-amber-500 rounded-2xl flex items-center justify-center shadow-xl">
                              <span className="text-lg font-black text-white drop-shadow">{userLevel}</span>
                            </div>
                            <div className="absolute -top-1 -right-1 w-6 h-6 bg-rose-500 rounded-full flex items-center justify-center">
                              <span className="text-xs font-bold text-white">✨</span>
                            </div>
                          </div>
                          <div>
                            <div className="text-lg font-bold">Nível {userLevel} • {achievementSystem.levels[userLevel - 1]?.title}</div>
                            <div className="text-sm text-slate-200">XP: {userXP} / {achievementSystem.levels[userLevel]?.xpRequired || 'MAX'}</div>
                          </div>
                        </div>
                        <div className="w-40 h-3 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
                          <div
                            className="h-full bg-gradient-to-r from-rose-400 via-amber-400 to-yellow-400 transition-all duration-1000 ease-out rounded-full relative overflow-hidden"
                            style={{
                              width: `${userLevel < 6 ? (userXP / achievementSystem.levels[userLevel]?.xpRequired) * 100 : 100}%`
                            }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse"></div>
                          </div>
                        </div>
                      </div>

                      {/* Premium Badges Display - Espaço Facial */}
                      <div className="flex gap-3">
                        {userBadges.slice(0, 3).map((badge, index) => (
                          <div
                            key={badge}
                            className="group relative transform transition-all duration-500 hover:scale-125"
                            style={{ animationDelay: `${index * 200}ms` }}
                          >
                            <div className="w-16 h-16 bg-white/15 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-white/30 shadow-xl hover:shadow-2xl transition-all duration-300">
                              <span className="text-2xl filter drop-shadow-lg">{achievementSystem.badges.find(b => b.id === badge)?.icon}</span>
                            </div>
                            {/* Tooltip */}
                            <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-black/80 text-white px-3 py-1 rounded-lg text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap backdrop-blur-sm">
                              {achievementSystem.badges.find(b => b.id === badge)?.name}
                            </div>
                            <div className="absolute -inset-2 bg-gradient-to-r from-rose-400 to-amber-400 rounded-2xl opacity-0 group-hover:opacity-20 transition-opacity duration-500 blur-xl"></div>
                          </div>
                        ))}
                        {userBadges.length > 3 && (
                          <div className="w-16 h-16 bg-white/15 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-white/30 shadow-xl">
                            <span className="text-sm font-bold">+{userBadges.length - 3}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Advanced Search & Actions Row - Espaço Facial */}
                  <div className="relative z-10 flex items-center justify-between mt-10 space-y-0">
                    <div className="flex items-center gap-8">
                      {/* Premium Search */}
                      <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-rose-400 to-amber-400 rounded-3xl opacity-30 group-hover:opacity-50 transition-opacity duration-500 blur-sm"></div>
                        <Input
                          placeholder="🔍 Busca inteligente para harmonização facial..."
                          value={searchQuery}
                          onChange={(e) => handleSearch(e.target.value)}
                          className="relative w-[450px] bg-white/10 border-white/30 text-white placeholder-white/70 backdrop-blur-xl rounded-3xl h-16 text-lg px-8 font-medium shadow-2xl focus:bg-white/20 transition-all duration-300"
                        />
                        {isLoading && (
                          <div className="absolute right-6 top-1/2 transform -translate-y-1/2">
                            <div className="animate-spin w-6 h-6 border-3 border-white border-t-transparent rounded-full"></div>
                          </div>
                        )}
                        <div className="absolute left-6 top-1/2 transform -translate-y-1/2">
                          <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                            <span className="text-lg">🔍</span>
                          </div>
                        </div>
                      </div>

                      {/* Premium Notification Center */}
                      <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-rose-400 to-pink-400 rounded-2xl opacity-30 group-hover:opacity-50 transition-opacity duration-500 blur-sm"></div>
                        <Button
                          variant="outline"
                          size="lg"
                          className="relative bg-white/10 border-white/30 text-white hover:bg-white/20 backdrop-blur-xl rounded-2xl h-16 px-8 font-medium shadow-2xl transition-all duration-300 group-hover:scale-105"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">🔔</span>
                            <span className="text-lg">Central</span>
                          </div>
                          <Badge className="absolute -top-2 -right-2 bg-rose-500 text-white text-sm min-w-8 h-8 flex items-center justify-center rounded-full animate-pulse shadow-lg">
                            {metrics.helpDeskTickets}
                          </Badge>
                        </Button>
                      </div>
                    </div>

                    {/* Premium Quick Actions - Espaço Facial */}
                    <div className="flex gap-4">
                      <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-rose-400 to-pink-400 rounded-2xl opacity-30 group-hover:opacity-50 transition-opacity duration-500 blur-sm"></div>
                        <Button className="relative bg-rose-500/80 hover:bg-rose-600/80 text-white rounded-2xl h-16 px-8 shadow-2xl hover:shadow-3xl transition-all duration-300 transform group-hover:scale-105 backdrop-blur-sm font-medium">
                          <div className="flex items-center gap-3">
                            <span className="text-xl">✨</span>
                            <span className="text-lg">Novo Cliente</span>
                          </div>
                        </Button>
                      </div>

                      <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-amber-400 to-yellow-400 rounded-2xl opacity-30 group-hover:opacity-50 transition-opacity duration-500 blur-sm"></div>
                        <Button className="relative bg-amber-500/80 hover:bg-amber-600/80 text-white rounded-2xl h-16 px-8 shadow-2xl hover:shadow-3xl transition-all duration-300 transform group-hover:scale-105 backdrop-blur-sm font-medium">
                          <div className="flex items-center gap-3">
                            <span className="text-xl">📊</span>
                            <span className="text-lg">Relatório</span>
                          </div>
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Ultra-Premium Live Metrics - Espaço Facial */}
                  <div className="relative z-10 grid grid-cols-8 gap-6 mt-10">
                    {[
                      { value: `R$ ${(metrics.monthlySales / 1000000).toFixed(1)}M`, label: 'Faturamento', sublabel: `↗️ +${metrics.monthlyGrowth}%`, color: 'from-rose-400 to-pink-400', icon: '�' },
                      { value: metrics.totalClients.toLocaleString(), label: 'Clientes Ativos', sublabel: '✨ Harmonizados', color: 'from-amber-400 to-yellow-400', icon: '�' },
                      { value: metrics.activeLeads, label: 'Novos Leads', sublabel: '🌹 Interessados', color: 'from-rose-400 to-red-400', icon: '🎯' },
                      { value: `${metrics.conversionRate}%`, label: 'Taxa Conversão', sublabel: '📈 Crescendo', color: 'from-emerald-400 to-teal-400', icon: '📊' },
                      { value: `${metrics.aiScore}%`, label: 'AI Score', sublabel: '🤖 Excelente', color: 'from-slate-400 to-gray-400', icon: '🤖' },
                      { value: metrics.activeAgents, label: 'Especialistas', sublabel: '🟢 Online', color: 'from-emerald-400 to-green-400', icon: '👨‍⚕️' },
                      { value: `${metrics.responseTime}min`, label: 'Tempo Resposta', sublabel: '⚡ Rápido', color: 'from-amber-400 to-orange-400', icon: '⚡' },
                      { value: `+${metrics.monthlyGrowth}%`, label: 'Crescimento', sublabel: '🚀 Acelerando', color: 'from-rose-400 to-pink-400', icon: '🚀' }
                    ].map((metric, index) => (
                      <div
                        key={index}
                        className={`group text-center p-6 bg-white/10 rounded-2xl backdrop-blur-xl border border-white/20 hover:bg-white/15 transition-all duration-500 transform hover:scale-110 cursor-pointer shadow-xl hover:shadow-2xl ${isInitialLoad ? 'translate-y-10 opacity-0' : 'translate-y-0 opacity-100'}`}
                        style={{
                          transitionDelay: `${index * 100}ms`
                        }}
                      >
                        <div className="relative">
                          <div className="text-3xl mb-2 group-hover:scale-125 transition-transform duration-300">{metric.icon}</div>
                          <div className="text-2xl font-bold mb-1 text-white drop-shadow-lg">{metric.value}</div>
                          <div className="text-sm text-slate-100 mb-1 font-medium">{metric.label}</div>
                          <div className="text-xs text-slate-200 font-medium">{metric.sublabel}</div>

                          {/* Animated background on hover */}
                          <div className={`absolute inset-0 bg-gradient-to-br ${metric.color} opacity-0 group-hover:opacity-20 rounded-2xl transition-opacity duration-500 blur-xl`}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </header>          {/* Enhanced Navigation System with Modern Design */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              {/* Row 1: Core Business Functions */}
              <div className="mb-6">
                <TabsList className="grid w-full grid-cols-12 gap-2 bg-white/50 backdrop-blur-sm rounded-2xl p-2 shadow-lg border border-gray-200">
                  <TabsTrigger
                    value="dashboard"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-blue-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">📊</span>
                    <span className="text-xs font-medium">Dashboard</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="executive"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-purple-500 data-[state=active]:to-pink-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">👔</span>
                    <span className="text-xs font-medium">Executivo</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="notifications"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-red-500 data-[state=active]:to-orange-600 data-[state=active]:text-white data-[state=active]:shadow-lg relative"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">🔔</span>
                    <span className="text-xs font-medium">Notificações</span>
                    <Badge className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center animate-pulse">
                      {metrics.helpDeskTickets}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger
                    value="customers"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-green-500 data-[state=active]:to-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">👥</span>
                    <span className="text-xs font-medium">Clientes</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="leads"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-500 data-[state=active]:to-orange-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">🎯</span>
                    <span className="text-xs font-medium">Leads</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="lead-scoring"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-amber-500 data-[state=active]:to-yellow-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">🏆</span>
                    <span className="text-xs font-medium">Scoring</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="territories"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-teal-500 data-[state=active]:to-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">🗺️</span>
                    <span className="text-xs font-medium">Territórios</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="webhooks"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-indigo-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">🔗</span>
                    <span className="text-xs font-medium">Webhooks</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="quotes"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-emerald-500 data-[state=active]:to-green-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">💰</span>
                    <span className="text-xs font-medium">Cotações</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="web-forms"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-rose-500 data-[state=active]:to-pink-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">📝</span>
                    <span className="text-xs font-medium">Formulários</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="email-templates"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-violet-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">✉️</span>
                    <span className="text-xs font-medium">Templates</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="opportunities"
                    className="group flex flex-col items-center p-4 h-20 rounded-xl transition-all duration-300 hover:scale-105 data-[state=active]:bg-gradient-to-br data-[state=active]:from-cyan-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <span className="text-2xl mb-1 group-hover:animate-bounce">💼</span>
                    <span className="text-xs font-medium">Oportunidades</span>
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

              {/* ENHANCED DASHBOARD - Modern & Interactive */}
              <TabsContent value="dashboard">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
                  <Card className="group bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 shadow-lg hover:shadow-2xl transition-all duration-500 hover:scale-105 cursor-pointer overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-200 rounded-full opacity-20 -translate-y-16 translate-x-16 group-hover:scale-150 transition-transform duration-700"></div>
                    <CardHeader className="pb-3 relative z-10">
                      <CardTitle className="text-lg font-bold text-blue-700 flex items-center gap-2">
                        <span className="text-2xl">💰</span>
                        Revenue Total
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10">
                      <div className="text-4xl font-bold text-blue-800 mb-2">R$ {(metrics.monthlySales / 1000).toFixed(0)}K</div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-emerald-500 text-white">+{metrics.monthlyGrowth}%</Badge>
                        <span className="text-sm text-blue-600">vs mês anterior</span>
                      </div>
                      <div className="mt-4 w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full animate-pulse" style={{ width: '78%' }}></div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="group bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200 shadow-lg hover:shadow-2xl transition-all duration-500 hover:scale-105 cursor-pointer overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-200 rounded-full opacity-20 -translate-y-16 translate-x-16 group-hover:scale-150 transition-transform duration-700"></div>
                    <CardHeader className="pb-3 relative z-10">
                      <CardTitle className="text-lg font-bold text-emerald-700 flex items-center gap-2">
                        <span className="text-2xl">🎯</span>
                        Leads Qualificados
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10">
                      <div className="text-4xl font-bold text-emerald-800 mb-2">{metrics.activeLeads}</div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-amber-500 text-white">Score: {metrics.leadQuality}%</Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="text-center">
                          <div className="text-lg font-bold text-red-600">🔥 12</div>
                          <div className="text-xs text-emerald-600">Quentes</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-orange-600">🌟 8</div>
                          <div className="text-xs text-emerald-600">Mornos</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-600">❄️ 14</div>
                          <div className="text-xs text-emerald-600">Frios</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="group bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200 shadow-lg hover:shadow-2xl transition-all duration-500 hover:scale-105 cursor-pointer overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-200 rounded-full opacity-20 -translate-y-16 translate-x-16 group-hover:scale-150 transition-transform duration-700"></div>
                    <CardHeader className="pb-3 relative z-10">
                      <CardTitle className="text-lg font-bold text-purple-700 flex items-center gap-2">
                        <span className="text-2xl">🤖</span>
                        AI Performance
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10">
                      <div className="text-4xl font-bold text-purple-800 mb-2">{metrics.aiScore}%</div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-purple-500 text-white">Excelente</Badge>
                      </div>
                      <div className="mt-4">
                        <div className="text-sm text-purple-600 mb-2">Economia semanal:</div>
                        <div className="text-2xl font-bold text-purple-700">{metrics.automationSavings}h</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="group bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 shadow-lg hover:shadow-2xl transition-all duration-500 hover:scale-105 cursor-pointer overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-200 rounded-full opacity-20 -translate-y-16 translate-x-16 group-hover:scale-150 transition-transform duration-700"></div>
                    <CardHeader className="pb-3 relative z-10">
                      <CardTitle className="text-lg font-bold text-orange-700 flex items-center gap-2">
                        <span className="text-2xl">⚡</span>
                        Pipeline Value
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10">
                      <div className="text-4xl font-bold text-orange-800 mb-2">R$ {(metrics.pipelineValue / 1000).toFixed(0)}K</div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-orange-500 text-white">{metrics.conversionRate}%</Badge>
                        <span className="text-sm text-orange-600">conversão</span>
                      </div>
                      <div className="mt-4 flex justify-between text-sm">
                        <div>
                          <div className="font-bold text-orange-700">{metrics.opportunities}</div>
                          <div className="text-orange-600">Oportunidades</div>
                        </div>
                        <div>
                          <div className="font-bold text-orange-700">{metrics.closedDeals}</div>
                          <div className="text-orange-600">Fechadas</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Enhanced Activity Feed & Performance */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-gray-50 overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
                      <CardTitle className="flex items-center gap-3">
                        <span className="text-2xl">📊</span>
                        Performance Dashboard
                      </CardTitle>
                      <CardDescription className="text-blue-100">Métricas em tempo real do sistema</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="space-y-6">
                        <div className="flex justify-between items-center p-4 bg-gradient-to-r from-emerald-50 to-emerald-100 rounded-2xl border border-emerald-200">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
                              <span className="text-white text-xl">👨‍💼</span>
                            </div>
                            <div>
                              <span className="font-bold text-emerald-800">Agentes Online</span>
                              <div className="text-sm text-emerald-600">Performance: {metrics.teamPerformance}%</div>
                            </div>
                          </div>
                          <Badge className="bg-emerald-500 text-white text-lg px-4 py-2">{metrics.activeAgents} ativos</Badge>
                        </div>

                        <div className="flex justify-between items-center p-4 bg-gradient-to-r from-blue-50 to-blue-100 rounded-2xl border border-blue-200">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center">
                              <span className="text-white text-xl">⚡</span>
                            </div>
                            <div>
                              <span className="font-bold text-blue-800">Tempo Resposta</span>
                              <div className="text-sm text-blue-600">Meta: {"<"} 2 min</div>
                            </div>
                          </div>
                          <Badge className="bg-blue-500 text-white text-lg px-4 py-2">{metrics.responseTime} min</Badge>
                        </div>

                        <div className="flex justify-between items-center p-4 bg-gradient-to-r from-purple-50 to-purple-100 rounded-2xl border border-purple-200">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center">
                              <span className="text-white text-xl">📈</span>
                            </div>
                            <div>
                              <span className="font-bold text-purple-800">ROI Campanhas</span>
                              <div className="text-sm text-purple-600">Meta Social: {metrics.socialEngagement}%</div>
                            </div>
                          </div>
                          <Badge className="bg-purple-500 text-white text-lg px-4 py-2">{metrics.campaignROI}%</Badge>
                        </div>

                        <div className="flex justify-between items-center p-4 bg-gradient-to-r from-emerald-50 to-emerald-100 rounded-2xl border border-emerald-200">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
                              <span className="text-white text-xl">🟢</span>
                            </div>
                            <div>
                              <span className="font-bold text-emerald-800">Uptime Sistema</span>
                              <div className="text-sm text-emerald-600">Status: {metrics.backupStatus}</div>
                            </div>
                          </div>
                          <Badge className="bg-emerald-600 text-white text-lg px-4 py-2">{metrics.systemUptime}%</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-gray-50 overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white">
                      <CardTitle className="flex items-center gap-3">
                        <span className="text-2xl">🚀</span>
                        Atividades Recentes
                      </CardTitle>
                      <CardDescription className="text-emerald-100">Últimas ações do sistema</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="space-y-4">
                        {activities.slice(0, 4).map((activity) => (
                          <div key={activity.id} className="group flex items-center gap-4 p-4 bg-gradient-to-r from-gray-50 to-white rounded-2xl border border-gray-200 hover:shadow-lg transition-all duration-300 hover:scale-102">
                            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                              <span className="text-xl text-white">
                                {activity.type === 'meeting' ? '🤝' :
                                  activity.type === 'call' ? '📞' :
                                    activity.type === 'demo' ? '🖥️' :
                                      activity.type === 'presentation' ? '📊' :
                                        activity.type === 'negotiation' ? '�' : '�🔄'}
                              </span>
                            </div>
                            <div className="flex-1">
                              <div className="font-bold text-gray-800 mb-1">{activity.title}</div>
                              <div className="text-sm text-gray-600 mb-1">{activity.client} • {activity.agent}</div>
                              <div className="text-xs text-gray-500">{activity.date} às {activity.time}</div>
                            </div>
                            <Badge className={`text-white font-medium px-3 py-1 ${activity.status === 'urgent' ? 'bg-red-500' :
                              activity.status === 'critical' ? 'bg-red-600' :
                                activity.status === 'important' ? 'bg-orange-500' :
                                  activity.status === 'confirmed' ? 'bg-emerald-500' : 'bg-blue-500'
                              }`}>
                              {activity.status}
                            </Badge>
                          </div>
                        ))}
                      </div>

                      <div className="mt-6 pt-4 border-t border-gray-200">
                        <Button className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-2xl h-12 font-medium shadow-lg hover:shadow-xl transition-all duration-300">
                          Ver Todas as Atividades
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>            {/* EXECUTIVE DASHBOARD */}
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
          </main>
        </div>
      </div>
    </NotificationProvider>
  )
}

export default App
