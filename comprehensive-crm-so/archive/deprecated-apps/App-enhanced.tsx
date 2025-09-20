import { useState, useEffect, useMemo, useCallback } from 'react'
import { useKV } from '@github/spark/hooks'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CustomerCard } from '@/components/CustomerCard'
import { OpportunityCard } from '@/components/OpportunityCard'
import { ActivityCard } from '@/components/ActivityCard'
import {
    Plus,
    Users,
    TrendUp,
    Target,
    MagnifyingGlass,
    ChartLineUp,
    CalendarCheck,
    Envelope
} from "@phosphor-icons/react"

function App() {
    const [activeTab, setActiveTab] = useState('dashboard')
    const [searchTerm, setSearchTerm] = useState('')
    const [isLoading, setIsLoading] = useState(false)

    // Mock data storage using useKV
    const [metrics] = useKV('crm-metrics', {
        totalClients: 2543,
        monthlySales: 156800,
        opportunities: 127,
        conversionRate: 23.1
    })

    const [customers] = useKV('customers', [
        { id: 1, name: 'Empresa ABC Ltda', status: 'active', value: 25000, lastContact: '2024-01-15' },
        { id: 2, name: 'Tech Solutions SA', status: 'prospect', value: 45000, lastContact: '2024-01-14' },
        { id: 3, name: 'Inovação Digital', status: 'active', value: 35000, lastContact: '2024-01-13' }
    ])

    const [opportunities] = useKV('opportunities', [
        { id: 1, title: 'Projeto ERP Corporativo', company: 'Empresa ABC', value: 125000, stage: 'proposal', probability: 75 },
        { id: 2, title: 'Sistema de Gestão', company: 'Tech Solutions', value: 85000, stage: 'negotiation', probability: 60 },
        { id: 3, title: 'Consultoria Digital', company: 'Inovação Digital', value: 55000, stage: 'qualified', probability: 45 }
    ])

    const [activities] = useKV('activities', [
        { id: 1, type: 'meeting', title: 'Reunião de Apresentação', company: 'Empresa ABC', date: '2024-01-16T14:30:00', status: 'scheduled' },
        { id: 2, type: 'call', title: 'Follow-up Comercial', company: 'Tech Solutions', date: '2024-01-16T10:00:00', status: 'completed' },
        { id: 3, type: 'email', title: 'Envio de Proposta', company: 'Inovação Digital', date: '2024-01-15T16:45:00', status: 'completed' }
    ])

    // Filtered data based on search
    const filteredCustomers = useMemo(() => {
        return customers.filter(customer =>
            customer.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
    }, [customers, searchTerm])

    const filteredOpportunities = useMemo(() => {
        return opportunities.filter(opp =>
            opp.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            opp.company.toLowerCase().includes(searchTerm.toLowerCase())
        )
    }, [opportunities, searchTerm])

    const handleSearch = useCallback((e) => {
        setSearchTerm(e.target.value)
    }, [])

    return (
        <NotificationProvider>
            <TooltipProvider>
                <div className="min-h-screen bg-gray-50">
                    <div className="container mx-auto p-4">
                        <header className="mb-8">
                            <h1 className="text-4xl font-bold text-gray-900 mb-2">
                                🚀 CRM Inteligente 2025
                            </h1>
                            <p className="text-gray-600 mb-4">
                                Solução Completa de Gestão de Relacionamento com Cliente
                            </p>
                            <div className="flex gap-4 items-center">
                                <Input
                                    placeholder="Pesquisar clientes, oportunidades..."
                                    className="max-w-md"
                                    value={searchTerm}
                                    onChange={handleSearch}
                                />
                                <Button disabled={isLoading}>
                                    <MagnifyingGlass className="w-4 h-4 mr-2" />
                                    {isLoading ? 'Pesquisando...' : 'Pesquisar'}
                                </Button>
                                <Button className="bg-green-600 hover:bg-green-700">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Novo Lead
                                </Button>
                            </div>
                        </header>

                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-6">
                                <TabsTrigger value="dashboard">
                                    <ChartLineUp className="w-4 h-4 mr-2" />
                                    Dashboard
                                </TabsTrigger>
                                <TabsTrigger value="customers">
                                    <Users className="w-4 h-4 mr-2" />
                                    Clientes
                                </TabsTrigger>
                                <TabsTrigger value="opportunities">
                                    <Target className="w-4 h-4 mr-2" />
                                    Oportunidades
                                </TabsTrigger>
                                <TabsTrigger value="activities">
                                    <CalendarCheck className="w-4 h-4 mr-2" />
                                    Atividades
                                </TabsTrigger>
                                <TabsTrigger value="analytics">
                                    <TrendUp className="w-4 h-4 mr-2" />
                                    Analytics
                                </TabsTrigger>
                                <TabsTrigger value="marketing">
                                    <Envelope className="w-4 h-4 mr-2" />
                                    Marketing
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="dashboard">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                                                <CardHeader className="pb-2">
                                                    <CardTitle className="text-sm font-medium flex items-center">
                                                        <Users className="w-4 h-4 mr-2 text-blue-500" />
                                                        Total de Clientes
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent>
                                                    <div className="text-2xl font-bold">{metrics.totalClients.toLocaleString()}</div>
                                                    <Badge variant="secondary" className="mt-1">+12% este mês</Badge>
                                                </CardContent>
                                            </Card>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Número total de clientes cadastrados no sistema</p>
                                        </TooltipContent>
                                    </Tooltip>

                                    <Card className="hover:shadow-lg transition-shadow">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium flex items-center">
                                                <TrendUp className="w-4 h-4 mr-2 text-green-500" />
                                                Vendas do Mês
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold">R$ {(metrics.monthlySales / 1000).toFixed(1)}K</div>
                                            <Badge variant="default" className="mt-1">+8% este mês</Badge>
                                        </CardContent>
                                    </Card>

                                    <Card className="hover:shadow-lg transition-shadow">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium flex items-center">
                                                <Target className="w-4 h-4 mr-2 text-orange-500" />
                                                Oportunidades
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold">{metrics.opportunities}</div>
                                            <Badge variant="outline" className="mt-1">+3% esta semana</Badge>
                                        </CardContent>
                                    </Card>

                                    <Card className="hover:shadow-lg transition-shadow">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium flex items-center">
                                                <ChartLineUp className="w-4 h-4 mr-2 text-purple-500" />
                                                Taxa de Conversão
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold">{metrics.conversionRate}%</div>
                                            <Badge variant="secondary" className="mt-1">+1.2% este mês</Badge>
                                        </CardContent>
                                    </Card>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Atividades Recentes</CardTitle>
                                            <CardDescription>Últimas interações com clientes</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-4">
                                                {activities.slice(0, 5).map(activity => (
                                                    <div key={activity.id} className="flex items-center gap-3">
                                                        <div className={`w-2 h-2 rounded-full ${activity.status === 'scheduled' ? 'bg-blue-500' :
                                                                activity.status === 'completed' ? 'bg-green-500' : 'bg-orange-500'
                                                            }`}></div>
                                                        <span className="text-sm">{activity.title} - {activity.company}</span>
                                                        <Badge variant={activity.status === 'completed' ? 'default' : 'secondary'} className="text-xs">
                                                            {activity.status}
                                                        </Badge>
                                                    </div>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Pipeline de Vendas</CardTitle>
                                            <CardDescription>Status das oportunidades</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-4">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm">Prospecção</span>
                                                    <Badge variant="outline">23 leads</Badge>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm">Qualificação</span>
                                                    <Badge variant="secondary">15 leads</Badge>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm">Proposta</span>
                                                    <Badge variant="default">8 leads</Badge>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm">Fechamento</span>
                                                    <Badge className="bg-green-500">5 leads</Badge>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </TabsContent>

                            <TabsContent value="customers">
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center">
                                        <h2 className="text-2xl font-bold">Gestão de Clientes</h2>
                                        <Button>
                                            <Plus className="w-4 h-4 mr-2" />
                                            Novo Cliente
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {filteredCustomers.map(customer => (
                                            <CustomerCard
                                                key={customer.id}
                                                customer={customer}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="opportunities">
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center">
                                        <h2 className="text-2xl font-bold">Oportunidades de Negócio</h2>
                                        <Button>
                                            <Plus className="w-4 h-4 mr-2" />
                                            Nova Oportunidade
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {filteredOpportunities.map(opportunity => (
                                            <OpportunityCard
                                                key={opportunity.id}
                                                opportunity={opportunity}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="activities">
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center">
                                        <h2 className="text-2xl font-bold">Atividades e Tarefas</h2>
                                        <Button>
                                            <Plus className="w-4 h-4 mr-2" />
                                            Nova Atividade
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {activities.map(activity => (
                                            <ActivityCard
                                                key={activity.id}
                                                activity={activity}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="analytics">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Analytics e Relatórios</CardTitle>
                                        <CardDescription>
                                            Insights detalhados sobre seu negócio
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-gray-600">
                                            Analytics avançados serão implementados aqui...
                                        </p>
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            <TabsContent value="marketing">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Marketing e Campanhas</CardTitle>
                                        <CardDescription>
                                            Gerencie suas campanhas de marketing digital
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-gray-600">
                                            Ferramentas de marketing serão implementadas aqui...
                                        </p>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            </TooltipProvider>
        </NotificationProvider>
    )
}

export default App
