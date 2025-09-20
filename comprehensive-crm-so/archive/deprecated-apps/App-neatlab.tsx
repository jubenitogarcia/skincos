import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Badge } from './components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'

// Mock hooks and contexts for standalone operation
const useKV = (key: string, defaultValue: any) => {
    const [value, setValue] = useState(defaultValue)
    return [value, setValue]
}

const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
    return <>{children}</>
}

// Mock components
const CustomerCard = () => (
    <div className="text-center py-8">
        <h3 className="text-lg font-semibold mb-2">Gerenciamento de Clientes</h3>
        <p className="text-gray-600">Em desenvolvimento...</p>
    </div>
)

const LeadsManager = () => (
    <div className="text-center py-8">
        <h3 className="text-lg font-semibold mb-2">Gerenciamento de Leads</h3>
        <p className="text-gray-600">Em desenvolvimento...</p>
    </div>
)

function App() {
    const [activeTab, setActiveTab] = useState('dashboard')
    const [searchQuery, setSearchQuery] = useState('')

    // Key metrics
    const [faturamento] = useKV('faturamento', 245000)

    const metrics = {
        totalCustomers: 1847,
        ordersCompleted: 524,
        totalAgents: 12,
        helpDeskTickets: 3,
        socialEngagement: 4.2,
        campaignROI: 287,
        metaAdsSpend: 12500,
        instagramFollowers: 15200,
        whatsappMessages: 128,
        responseTime: 2.3
    }

    const customers = [
        { name: 'Ana Silva', email: 'ana@email.com', totalValue: 2450, lastActivity: 'Hoje' },
        { name: 'João Santos', email: 'joao@email.com', totalValue: 1890, lastActivity: 'Ontem' },
        { name: 'Maria Costa', email: 'maria@email.com', totalValue: 3200, lastActivity: 'Há 2 dias' },
        { name: 'Pedro Lima', email: 'pedro@email.com', totalValue: 1650, lastActivity: 'Há 3 dias' },
        { name: 'Lucia Moura', email: 'lucia@email.com', totalValue: 2780, lastActivity: 'Há 5 dias' }
    ]

    const handleSearch = (query: string) => {
        setSearchQuery(query)
    }

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
                                    <span className="text-lg">👥</span>
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
                                    <span className="text-lg">👨‍⚕️</span>
                                    <span>Especialistas</span>
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={() => setActiveTab('reports')}
                                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === 'reports' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                                        }`}
                                >
                                    <span className="text-lg">📈</span>
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

                            <TabsContent value="customers">
                                <CustomerCard />
                            </TabsContent>

                            <TabsContent value="leads">
                                <LeadsManager />
                            </TabsContent>

                            <TabsContent value="products">
                                <div className="text-center py-8">
                                    <h3 className="text-lg font-semibold mb-2">Gerenciamento de Serviços</h3>
                                    <p className="text-gray-600">Em desenvolvimento...</p>
                                </div>
                            </TabsContent>

                            <TabsContent value="managers">
                                <div className="text-center py-8">
                                    <h3 className="text-lg font-semibold mb-2">Especialistas</h3>
                                    <p className="text-gray-600">Em desenvolvimento...</p>
                                </div>
                            </TabsContent>

                            <TabsContent value="reports">
                                <div className="text-center py-8">
                                    <h3 className="text-lg font-semibold mb-2">Relatórios</h3>
                                    <p className="text-gray-600">Em desenvolvimento...</p>
                                </div>
                            </TabsContent>

                            <TabsContent value="communications">
                                <div className="text-center py-8">
                                    <h3 className="text-lg font-semibold mb-2">Comunicações</h3>
                                    <p className="text-gray-600">Em desenvolvimento...</p>
                                </div>
                            </TabsContent>

                            <TabsContent value="finance">
                                <div className="text-center py-8">
                                    <h3 className="text-lg font-semibold mb-2">Finanças</h3>
                                    <p className="text-gray-600">Em desenvolvimento...</p>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </main>
                </div>
            </div>
        </NotificationProvider>
    )
}

export default App
