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
            <TabsList className="grid w-full grid-cols-8 gap-1">
              <TabsTrigger value="dashboard">📊 Dashboard</TabsTrigger>
              <TabsTrigger value="customers">👥 Clientes</TabsTrigger>
              <TabsTrigger value="sales">💰 Vendas</TabsTrigger>
              <TabsTrigger value="analytics">📈 Analytics</TabsTrigger>
              <TabsTrigger value="activities">📅 Atividades</TabsTrigger>
              <TabsTrigger value="marketing">📢 Marketing</TabsTrigger>
              <TabsTrigger value="ai">🤖 IA</TabsTrigger>
              <TabsTrigger value="settings">⚙️ Config</TabsTrigger>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Receita por Mês</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-green-600">R$ 543K</div>
                        <div className="text-xs text-gray-500">+15% vs mês anterior</div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Ticket Médio</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-blue-600">R$ 2.8K</div>
                        <div className="text-xs text-gray-500">+8% vs mês anterior</div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">ROI Marketing</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-purple-600">4.2x</div>
                        <div className="text-xs text-gray-500">+12% vs mês anterior</div>
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activities">
              <Card>
                <CardHeader>
                  <CardTitle>Central de Atividades</CardTitle>
                  <CardDescription>
                    Gerencie todas as suas atividades e compromissos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <div>
                          <div className="font-medium">Reunião com Cliente VIP</div>
                          <div className="text-sm text-gray-500">Hoje, 15:30 - 16:30</div>
                        </div>
                      </div>
                      <Badge variant="destructive">Urgente</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                        <div>
                          <div className="font-medium">Follow-up Proposta ABC</div>
                          <div className="text-sm text-gray-500">Amanhã, 09:00</div>
                        </div>
                      </div>
                      <Badge variant="secondary">Programado</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                        <div>
                          <div className="font-medium">Demo Produto XYZ</div>
                          <div className="text-sm text-gray-500">Sexta, 14:00 - 15:00</div>
                        </div>
                      </div>
                      <Badge variant="default">Confirmado</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="marketing">
              <Card>
                <CardHeader>
                  <CardTitle>Centro de Marketing</CardTitle>
                  <CardDescription>
                    Campanhas, automação e engajamento de clientes
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Campanhas Ativas</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Newsletter Janeiro</span>
                            <Badge className="bg-green-500">Ativa</Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Promoção Ano Novo</span>
                            <Badge variant="secondary">Pausada</Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Retargeting Facebook</span>
                            <Badge className="bg-blue-500">Executando</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Performance</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex justify-between">
                            <span className="text-sm">Taxa de Abertura</span>
                            <span className="font-bold text-green-600">24.5%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm">Taxa de Clique</span>
                            <span className="font-bold text-blue-600">3.8%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm">Conversões</span>
                            <span className="font-bold text-purple-600">127</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ai">
              <Card>
                <CardHeader>
                  <CardTitle>Centro de Inteligência Artificial</CardTitle>
                  <CardDescription>
                    Automação inteligente e insights preditivos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          🧠 Lead Scoring
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-green-600 mb-2">92%</div>
                        <p className="text-sm text-gray-600">Precisão do modelo atual</p>
                        <div className="mt-3">
                          <Badge className="bg-green-500">Otimizado</Badge>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          💬 Chatbot
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-blue-600 mb-2">856</div>
                        <p className="text-sm text-gray-600">Conversas este mês</p>
                        <div className="mt-3">
                          <Badge className="bg-blue-500">Online</Badge>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          📊 Previsões
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-purple-600 mb-2">R$ 678K</div>
                        <p className="text-sm text-gray-600">Receita prevista próximo mês</p>
                        <div className="mt-3">
                          <Badge className="bg-purple-500">Alta Confiança</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="settings">
              <Card>
                <CardHeader>
                  <CardTitle>Configurações do Sistema</CardTitle>
                  <CardDescription>
                    Personalize e configure seu CRM
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Integrações</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-sm">WhatsApp Business</span>
                            <Badge className="bg-green-500">Conectado</Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Facebook Ads</span>
                            <Badge className="bg-blue-500">Conectado</Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Google Analytics</span>
                            <Badge variant="outline">Desconectado</Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Zapier</span>
                            <Badge className="bg-orange-500">Conectado</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Configurações Gerais</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div>
                            <label className="text-sm font-medium">Fuso Horário</label>
                            <div className="text-sm text-gray-600">América/São_Paulo (UTC-3)</div>
                          </div>
                          <div>
                            <label className="text-sm font-medium">Moeda Padrão</label>
                            <div className="text-sm text-gray-600">Real Brasileiro (BRL)</div>
                          </div>
                          <div>
                            <label className="text-sm font-medium">Idioma</label>
                            <div className="text-sm text-gray-600">Português (Brasil)</div>
                          </div>
                          <Button className="w-full mt-4">Salvar Configurações</Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
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
