import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"

function App() {
    const [activeTab, setActiveTab] = useState('dashboard')
    const [metrics] = useKV('crm-metrics', {
        totalClients: 2543,
        monthlySales: 156800,
        opportunities: 127,
        conversionRate: 23.1
    })

    return (
        <NotificationProvider>
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
                            />
                            <Button>Pesquisar</Button>
                        </div>
                    </header>

                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-4">
                            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                            <TabsTrigger value="customers">Clientes</TabsTrigger>
                            <TabsTrigger value="sales">Vendas</TabsTrigger>
                            <TabsTrigger value="analytics">Analytics</TabsTrigger>
                        </TabsList>

                        <TabsContent value="dashboard">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium">Total de Clientes</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">{metrics.totalClients.toLocaleString()}</div>
                                        <Badge variant="secondary" className="mt-1">+12% este mês</Badge>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium">Vendas do Mês</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">R$ {(metrics.monthlySales / 1000).toFixed(1)}K</div>
                                        <Badge variant="default" className="mt-1">+8% este mês</Badge>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium">Oportunidades</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">{metrics.opportunities}</div>
                                        <Badge variant="outline" className="mt-1">+3% esta semana</Badge>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
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
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                                <span className="text-sm">Reunião com Cliente ABC - 14:30</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                                <span className="text-sm">Email enviado para Lead XYZ - 13:15</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                                <span className="text-sm">Proposta finalizada - 12:00</span>
                                            </div>
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
                            <Card>
                                <CardHeader>
                                    <CardTitle>Gestão de Clientes</CardTitle>
                                    <CardDescription>
                                        Gerencie todos os seus clientes em um só lugar
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-gray-600">
                                        Funcionalidade de clientes será implementada aqui...
                                    </p>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="sales">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Pipeline de Vendas</CardTitle>
                                    <CardDescription>
                                        Acompanhe suas oportunidades e fechamentos
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-gray-600">
                                        Pipeline de vendas será implementado aqui...
                                    </p>
                                </CardContent>
                            </Card>
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
                                        Analytics serão implementados aqui...
                                    </p>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </NotificationProvider>
    )
}

export default App
