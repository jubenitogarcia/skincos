import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

function App() {
    const [activeTab, setActiveTab] = useState('dashboard')

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto p-4">
                <header className="mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">
                        🚀 CRM Inteligente 2025
                    </h1>
                    <p className="text-gray-600">
                        Solução Completa de Gestão de Relacionamento com Cliente
                    </p>
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
                                    <div className="text-2xl font-bold">2,543</div>
                                    <Badge variant="secondary" className="mt-1">+12% este mês</Badge>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium">Vendas do Mês</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">R$ 156.8K</div>
                                    <Badge variant="default" className="mt-1">+8% este mês</Badge>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium">Oportunidades</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">127</div>
                                    <Badge variant="outline" className="mt-1">+3% esta semana</Badge>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">23.1%</div>
                                    <Badge variant="secondary" className="mt-1">+1.2% este mês</Badge>
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
    )
}

export default App
