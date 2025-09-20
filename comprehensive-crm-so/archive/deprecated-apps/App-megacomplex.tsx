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
            <TabsList className="grid w-full grid-cols-10 gap-1 text-xs">
              <TabsTrigger value="dashboard" className="flex flex-col items-center">
                📊 Dashboard
              </TabsTrigger>
              <TabsTrigger value="customers" className="flex flex-col items-center">
                👥 Clientes
              </TabsTrigger>
              <TabsTrigger value="sales" className="flex flex-col items-center">
                💰 Vendas
              </TabsTrigger>
              <TabsTrigger value="analytics" className="flex flex-col items-center">
                📈 Analytics
              </TabsTrigger>
              <TabsTrigger value="activities" className="flex flex-col items-center">
                📅 Atividades
              </TabsTrigger>
              <TabsTrigger value="marketing" className="flex flex-col items-center">
                📢 Marketing
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex flex-col items-center">
                🤖 IA & Auto
              </TabsTrigger>
              <TabsTrigger value="social" className="flex flex-col items-center">
                📱 Social
              </TabsTrigger>
              <TabsTrigger value="reports" className="flex flex-col items-center">
                📋 Relatórios
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex flex-col items-center">
                ⚙️ Config
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
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

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">ROI Marketing</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">4.2x</div>
                    <Badge className="bg-green-500 mt-1">Excelente</Badge>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Pipeline de Vendas - Tempo Real</CardTitle>
                    <CardDescription>Visão detalhada do funil de conversão</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-5 gap-4">
                        <div className="text-center">
                          <div className="w-full h-16 bg-blue-100 rounded-lg flex items-center justify-center mb-2">
                            <div className="text-lg font-bold text-blue-600">23</div>
                          </div>
                          <div className="text-xs text-gray-600">Prospecção</div>
                          <div className="text-xs font-medium">R$ 98K</div>
                        </div>
                        <div className="text-center">
                          <div className="w-full h-16 bg-yellow-100 rounded-lg flex items-center justify-center mb-2">
                            <div className="text-lg font-bold text-yellow-600">15</div>
                          </div>
                          <div className="text-xs text-gray-600">Qualificação</div>
                          <div className="text-xs font-medium">R$ 156K</div>
                        </div>
                        <div className="text-center">
                          <div className="w-full h-16 bg-orange-100 rounded-lg flex items-center justify-center mb-2">
                            <div className="text-lg font-bold text-orange-600">8</div>
                          </div>
                          <div className="text-xs text-gray-600">Proposta</div>
                          <div className="text-xs font-medium">R$ 89K</div>
                        </div>
                        <div className="text-center">
                          <div className="w-full h-16 bg-purple-100 rounded-lg flex items-center justify-center mb-2">
                            <div className="text-lg font-bold text-purple-600">5</div>
                          </div>
                          <div className="text-xs text-gray-600">Negociação</div>
                          <div className="text-xs font-medium">R$ 67K</div>
                        </div>
                        <div className="text-center">
                          <div className="w-full h-16 bg-green-100 rounded-lg flex items-center justify-center mb-2">
                            <div className="text-lg font-bold text-green-600">3</div>
                          </div>
                          <div className="text-xs text-gray-600">Fechamento</div>
                          <div className="text-xs font-medium">R$ 45K</div>
                        </div>
                      </div>
                      <div className="pt-4 border-t">
                        <div className="flex justify-between text-sm">
                          <span>Total do Pipeline:</span>
                          <span className="font-bold">R$ 455K</span>
                        </div>
                        <div className="flex justify-between text-sm mt-1">
                          <span>Taxa de Conversão Média:</span>
                          <span className="font-bold text-green-600">23.1%</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Atividades de Hoje</CardTitle>
                    <CardDescription>Sua agenda em tempo real</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <div className="flex-1">
                          <div className="text-sm font-medium">Reunião Cliente VIP</div>
                          <div className="text-xs text-gray-500">15:30 - 16:30</div>
                        </div>
                        <Badge variant="destructive" className="text-xs">Urgente</Badge>
                      </div>
                      <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <div className="flex-1">
                          <div className="text-sm font-medium">Demo Produto ABC</div>
                          <div className="text-xs text-gray-500">17:00 - 18:00</div>
                        </div>
                        <Badge variant="default" className="text-xs">Confirmado</Badge>
                      </div>
                      <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                        <div className="flex-1">
                          <div className="text-sm font-medium">Follow-up Proposta</div>
                          <div className="text-xs text-gray-500">19:00</div>
                        </div>
                        <Badge variant="secondary" className="text-xs">Pendente</Badge>
                      </div>
                    </div>
                    <Button className="w-full mt-4 text-xs">Ver Todas as Atividades</Button>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Performance da Equipe</CardTitle>
                    <CardDescription>Ranking dos melhores vendedores</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                            <span className="text-sm font-bold text-yellow-600">1</span>
                          </div>
                          <div>
                            <div className="text-sm font-medium">Ana Silva</div>
                            <div className="text-xs text-gray-500">R$ 89K este mês</div>
                          </div>
                        </div>
                        <Badge className="bg-yellow-500">🏆 #1</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                            <span className="text-sm font-bold text-gray-600">2</span>
                          </div>
                          <div>
                            <div className="text-sm font-medium">Carlos Santos</div>
                            <div className="text-xs text-gray-500">R$ 67K este mês</div>
                          </div>
                        </div>
                        <Badge variant="secondary">🥈 #2</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                            <span className="text-sm font-bold text-orange-600">3</span>
                          </div>
                          <div>
                            <div className="text-sm font-medium">Maria Costa</div>
                            <div className="text-xs text-gray-500">R$ 54K este mês</div>
                          </div>
                        </div>
                        <Badge variant="outline">🥉 #3</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Alertas e Notificações</CardTitle>
                    <CardDescription>Itens que precisam de atenção</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-red-800">3 Propostas vencem hoje</div>
                          <div className="text-xs text-red-600">Valor total: R$ 127K</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-yellow-800">12 Follow-ups pendentes</div>
                          <div className="text-xs text-yellow-600">Desde ontem</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-blue-800">5 Novos leads qualificados</div>
                          <div className="text-xs text-blue-600">Últimas 2 horas</div>
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" className="w-full mt-4 text-xs">Ver Todos os Alertas</Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>            <TabsContent value="customers">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Gestão Avançada de Clientes</CardTitle>
                    <CardDescription>Base completa de relacionamento com cliente</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex gap-4 mb-4">
                        <Input placeholder="Buscar por nome, empresa, email..." className="flex-1" />
                        <Button>Buscar</Button>
                        <Button variant="outline">+ Novo Cliente</Button>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-sm font-bold text-blue-600">EA</span>
                            </div>
                            <div>
                              <div className="font-medium">Empresa Alpha Ltda</div>
                              <div className="text-sm text-gray-500">João Silva • joao@alpha.com</div>
                              <div className="text-xs text-gray-400">Último contato: Hoje, 14:30</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge className="bg-green-500 mb-1">Cliente VIP</Badge>
                            <div className="text-sm font-medium">R$ 45.2K</div>
                            <div className="text-xs text-gray-500">Valor total</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                              <span className="text-sm font-bold text-purple-600">TI</span>
                            </div>
                            <div>
                              <div className="font-medium">Tech Innovations S.A.</div>
                              <div className="text-sm text-gray-500">Maria Santos • maria@tech.com</div>
                              <div className="text-xs text-gray-400">Último contato: Ontem, 16:45</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant="default" className="mb-1">Prospect</Badge>
                            <div className="text-sm font-medium">R$ 28.7K</div>
                            <div className="text-xs text-gray-500">Potencial</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                              <span className="text-sm font-bold text-green-600">SB</span>
                            </div>
                            <div>
                              <div className="font-medium">Startup Beta</div>
                              <div className="text-sm text-gray-500">Carlos Costa • carlos@beta.com</div>
                              <div className="text-xs text-gray-400">Último contato: 2 dias atrás</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant="secondary" className="mb-1">Lead</Badge>
                            <div className="text-sm font-medium">R$ 15.3K</div>
                            <div className="text-xs text-gray-500">Estimativa</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Segmentação de Clientes</CardTitle>
                    <CardDescription>Análise por categorias</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Clientes VIP</span>
                        <div className="text-right">
                          <div className="font-bold text-green-600">23</div>
                          <div className="text-xs text-gray-500">R$ 892K total</div>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Prospects Ativos</span>
                        <div className="text-right">
                          <div className="font-bold text-blue-600">45</div>
                          <div className="text-xs text-gray-500">R$ 567K potencial</div>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Leads Quentes</span>
                        <div className="text-right">
                          <div className="font-bold text-orange-600">67</div>
                          <div className="text-xs text-gray-500">R$ 234K estimado</div>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Clientes Inativos</span>
                        <div className="text-right">
                          <div className="font-bold text-gray-600">12</div>
                          <div className="text-xs text-gray-500">Reativação</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 pt-4 border-t">
                      <div className="text-sm font-medium mb-2">Ações Rápidas</div>
                      <div className="space-y-2">
                        <Button variant="outline" className="w-full text-xs">Importar Contatos</Button>
                        <Button variant="outline" className="w-full text-xs">Exportar Base</Button>
                        <Button variant="outline" className="w-full text-xs">Campanha Email</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="sales">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Pipeline Avançado de Vendas</CardTitle>
                    <CardDescription>Gestão completa do funil de conversão</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="text-center p-3 bg-blue-50 rounded-lg">
                          <div className="text-xl font-bold text-blue-600">R$ 455K</div>
                          <div className="text-xs text-gray-600">Pipeline Total</div>
                        </div>
                        <div className="text-center p-3 bg-green-50 rounded-lg">
                          <div className="text-xl font-bold text-green-600">23.1%</div>
                          <div className="text-xs text-gray-600">Conv. Média</div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="p-3 border rounded-lg">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium">Proposta ABC Corp</span>
                            <Badge className="bg-green-500">Fechamento</Badge>
                          </div>
                          <div className="text-sm text-gray-600 mb-2">Valor: R$ 89.5K • Prob: 85%</div>
                          <div className="text-xs text-gray-500">Contato: Ana Silva • Vence: Hoje</div>
                        </div>

                        <div className="p-3 border rounded-lg">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium">Upgrade Tech Solutions</span>
                            <Badge variant="default">Negociação</Badge>
                          </div>
                          <div className="text-sm text-gray-600 mb-2">Valor: R$ 67.2K • Prob: 70%</div>
                          <div className="text-xs text-gray-500">Contato: Carlos Santos • Vence: Amanhã</div>
                        </div>

                        <div className="p-3 border rounded-lg">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium">Startup Innovation</span>
                            <Badge variant="secondary">Proposta</Badge>
                          </div>
                          <div className="text-sm text-gray-600 mb-2">Valor: R$ 45.8K • Prob: 50%</div>
                          <div className="text-xs text-gray-500">Contato: Maria Costa • Vence: 3 dias</div>
                        </div>
                      </div>

                      <Button className="w-full">+ Nova Oportunidade</Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Produtos e Preços</CardTitle>
                    <CardDescription>Catálogo e configurações</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="p-3 border rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">CRM Premium</span>
                          <Badge className="bg-blue-500">Mais Vendido</Badge>
                        </div>
                        <div className="text-sm text-gray-600 mb-1">R$ 497/mês por usuário</div>
                        <div className="text-xs text-gray-500">127 vendas este mês</div>
                      </div>

                      <div className="p-3 border rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">CRM Enterprise</span>
                          <Badge variant="default">Alto Valor</Badge>
                        </div>
                        <div className="text-sm text-gray-600 mb-1">R$ 997/mês por usuário</div>
                        <div className="text-xs text-gray-500">34 vendas este mês</div>
                      </div>

                      <div className="p-3 border rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">CRM Starter</span>
                          <Badge variant="outline">Entry Level</Badge>
                        </div>
                        <div className="text-sm text-gray-600 mb-1">R$ 197/mês por usuário</div>
                        <div className="text-xs text-gray-500">89 vendas este mês</div>
                      </div>

                      <div className="pt-4 border-t">
                        <div className="grid grid-cols-2 gap-2">
                          <Button variant="outline" className="text-xs">Configurar Preços</Button>
                          <Button variant="outline" className="text-xs">Novo Produto</Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="analytics">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Receita Mensal</CardTitle>
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

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">LTV/CAC</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">6.8x</div>
                    <div className="text-xs text-gray-500">Excelente performance</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Análise de Conversão</CardTitle>
                    <CardDescription>Funil detalhado de conversão</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Visitantes → Leads</span>
                        <span className="font-bold text-blue-600">12.3%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Leads → Qualificados</span>
                        <span className="font-bold text-green-600">34.7%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Qualificados → Oportunidades</span>
                        <span className="font-bold text-orange-600">45.2%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Oportunidades → Clientes</span>
                        <span className="font-bold text-purple-600">23.1%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Previsões IA</CardTitle>
                    <CardDescription>Insights preditivos</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <div className="text-sm font-medium text-blue-800">Receita Próximo Mês</div>
                        <div className="text-xl font-bold text-blue-600">R$ 678K</div>
                        <div className="text-xs text-blue-600">Confiança: 92%</div>
                      </div>
                      <div className="p-3 bg-green-50 rounded-lg">
                        <div className="text-sm font-medium text-green-800">Novos Clientes</div>
                        <div className="text-xl font-bold text-green-600">34</div>
                        <div className="text-xs text-green-600">Confiança: 87%</div>
                      </div>
                      <div className="p-3 bg-purple-50 rounded-lg">
                        <div className="text-sm font-medium text-purple-800">Churn Risk</div>
                        <div className="text-xl font-bold text-purple-600">2.1%</div>
                        <div className="text-xs text-purple-600">Baixo risco</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="activities">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Central de Atividades</CardTitle>
                    <CardDescription>Gerencie todas as suas atividades e compromissos</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex gap-4 mb-4">
                        <Input placeholder="Buscar atividades..." className="flex-1" />
                        <Button>+ Nova Atividade</Button>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                            <div>
                              <div className="font-medium">Reunião com Cliente VIP</div>
                              <div className="text-sm text-gray-500">Hoje, 15:30 - 16:30</div>
                              <div className="text-xs text-gray-400">Local: Sala de Reuniões</div>
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
                              <div className="text-xs text-gray-400">Tipo: Ligação</div>
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
                              <div className="text-xs text-gray-400">Tipo: Video call</div>
                            </div>
                          </div>
                          <Badge variant="default">Confirmado</Badge>
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                            <div>
                              <div className="font-medium">Apresentação Executiva</div>
                              <div className="text-sm text-gray-500">Segunda, 10:00 - 11:30</div>
                              <div className="text-xs text-gray-400">Local: Escritório cliente</div>
                            </div>
                          </div>
                          <Badge className="bg-blue-500">Importante</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Resumo da Agenda</CardTitle>
                    <CardDescription>Visão geral semanal</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Reuniões Hoje</span>
                        <span className="font-bold text-red-600">4</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Esta Semana</span>
                        <span className="font-bold text-blue-600">17</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Follow-ups Pendentes</span>
                        <span className="font-bold text-yellow-600">12</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Demos Agendadas</span>
                        <span className="font-bold text-green-600">8</span>
                      </div>
                    </div>

                    <div className="mt-6 pt-4 border-t">
                      <div className="text-sm font-medium mb-2">Ações Rápidas</div>
                      <div className="space-y-2">
                        <Button variant="outline" className="w-full text-xs">Agendar Reunião</Button>
                        <Button variant="outline" className="w-full text-xs">Follow-up Automático</Button>
                        <Button variant="outline" className="w-full text-xs">Relatório Semanal</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="marketing">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Campanhas Ativas</CardTitle>
                    <CardDescription>Gerenciamento de campanhas de marketing</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">Newsletter Janeiro 2025</div>
                          <div className="text-sm text-gray-500">Email Marketing</div>
                          <div className="text-xs text-gray-400">2,543 destinatários</div>
                        </div>
                        <Badge className="bg-green-500">Ativa</Badge>
                      </div>
                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">Retargeting Facebook</div>
                          <div className="text-sm text-gray-500">Anúncios Pagos</div>
                          <div className="text-xs text-gray-400">R$ 5.2K investido</div>
                        </div>
                        <Badge className="bg-blue-500">Executando</Badge>
                      </div>
                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">Webinar "CRM 2025"</div>
                          <div className="text-sm text-gray-500">Evento Online</div>
                          <div className="text-xs text-gray-400">234 inscritos</div>
                        </div>
                        <Badge variant="secondary">Programado</Badge>
                      </div>
                    </div>
                    <Button className="w-full mt-4">+ Nova Campanha</Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Performance de Marketing</CardTitle>
                    <CardDescription>Métricas e resultados</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="text-center p-3 bg-blue-50 rounded-lg">
                        <div className="text-lg font-bold text-blue-600">24.5%</div>
                        <div className="text-xs text-gray-600">Taxa Abertura</div>
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-lg font-bold text-green-600">3.8%</div>
                        <div className="text-xs text-gray-600">Taxa Clique</div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm">Leads Gerados</span>
                        <span className="font-bold text-green-600">127</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Custo por Lead</span>
                        <span className="font-bold text-blue-600">R$ 34</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">ROI Campanhas</span>
                        <span className="font-bold text-purple-600">4.2x</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Conversões</span>
                        <span className="font-bold text-orange-600">23</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="ai">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      🧠 Lead Scoring Inteligente
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600 mb-2">92%</div>
                    <p className="text-sm text-gray-600 mb-3">Precisão do modelo atual</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Leads Avaliados</span>
                        <span className="font-medium">2,543</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>Score Médio</span>
                        <span className="font-medium">74.2</span>
                      </div>
                    </div>
                    <Badge className="bg-green-500 mt-3">Otimizado</Badge>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      💬 Chatbot IA
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600 mb-2">856</div>
                    <p className="text-sm text-gray-600 mb-3">Conversas este mês</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Taxa Resolução</span>
                        <span className="font-medium">87%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>Tempo Médio</span>
                        <span className="font-medium">2.3 min</span>
                      </div>
                    </div>
                    <Badge className="bg-blue-500 mt-3">Online</Badge>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      📊 Previsões de Vendas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-purple-600 mb-2">R$ 678K</div>
                    <p className="text-sm text-gray-600 mb-3">Receita prevista próximo mês</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Confiança</span>
                        <span className="font-medium">94%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>Variação</span>
                        <span className="font-medium">±8%</span>
                      </div>
                    </div>
                    <Badge className="bg-purple-500 mt-3">Alta Confiança</Badge>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      🎯 Automação de Follow-up
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600 mb-2">234</div>
                    <p className="text-sm text-gray-600 mb-3">Follow-ups automáticos enviados</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Taxa Resposta</span>
                        <span className="font-medium">23%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>Conversões</span>
                        <span className="font-medium">12</span>
                      </div>
                    </div>
                    <Badge className="bg-orange-500 mt-3">Ativo</Badge>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      🔍 Análise de Sentimento
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600 mb-2">85%</div>
                    <p className="text-sm text-gray-600 mb-3">Sentimento positivo médio</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Emails Analisados</span>
                        <span className="font-medium">1,234</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>Alertas Gerados</span>
                        <span className="font-medium">7</span>
                      </div>
                    </div>
                    <Badge className="bg-green-500 mt-3">Monitorando</Badge>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      ⚡ Automações Ativas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-indigo-600 mb-2">15</div>
                    <p className="text-sm text-gray-600 mb-3">Fluxos de trabalho em execução</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Ações Executadas</span>
                        <span className="font-medium">2,847</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>Tempo Economizado</span>
                        <span className="font-medium">47h</span>
                      </div>
                    </div>
                    <Badge className="bg-indigo-500 mt-3">Funcionando</Badge>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="social">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>📱 WhatsApp Business</CardTitle>
                    <CardDescription>Central de mensagens e atendimento</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-lg font-bold text-green-600">234</div>
                        <div className="text-xs text-gray-600">Msgs Hoje</div>
                      </div>
                      <div className="text-center p-3 bg-blue-50 rounded-lg">
                        <div className="text-lg font-bold text-blue-600">12</div>
                        <div className="text-xs text-gray-600">Conversas Ativas</div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="p-3 border rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-medium text-sm">João Silva - Empresa ABC</span>
                          <Badge className="bg-green-500 text-xs">Online</Badge>
                        </div>
                        <div className="text-xs text-gray-500">Última msg: Preciso de uma proposta urgente...</div>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-medium text-sm">Maria Santos - Tech Co</span>
                          <Badge variant="secondary" className="text-xs">5 min</Badge>
                        </div>
                        <div className="text-xs text-gray-500">Última msg: Quando podemos agendar a demo?</div>
                      </div>
                    </div>
                    <Button className="w-full mt-4">Abrir WhatsApp Web</Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>📘 Facebook & Instagram</CardTitle>
                    <CardDescription>Gestão de redes sociais</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">Facebook Ads</span>
                          <Badge className="bg-blue-500">Ativo</Badge>
                        </div>
                        <div className="text-sm text-gray-600">R$ 1.2K investido • 45 leads</div>
                        <div className="text-xs text-gray-500">CPL: R$ 26,7 • CTR: 2.1%</div>
                      </div>

                      <div className="p-3 bg-purple-50 rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">Instagram Stories</span>
                          <Badge className="bg-purple-500">Publicado</Badge>
                        </div>
                        <div className="text-sm text-gray-600">2.3K visualizações • 89 cliques</div>
                        <div className="text-xs text-gray-500">Engajamento: 4.2% • Alcance: 1.8K</div>
                      </div>

                      <div className="p-3 bg-green-50 rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">Mensagens Direct</span>
                          <Badge className="bg-green-500">12 Novas</Badge>
                        </div>
                        <div className="text-sm text-gray-600">Tempo médio resposta: 2.3h</div>
                        <div className="text-xs text-gray-500">Taxa conversão: 8.5%</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="reports">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>📋 Relatórios Executivos</CardTitle>
                    <CardDescription>Dashboards e análises avançadas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="p-3 border rounded-lg hover:bg-gray-50">
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-medium">Relatório de Vendas</div>
                            <div className="text-sm text-gray-500">Performance mensal completa</div>
                          </div>
                          <Button variant="outline" className="text-xs">Gerar PDF</Button>
                        </div>
                      </div>

                      <div className="p-3 border rounded-lg hover:bg-gray-50">
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-medium">ROI Marketing</div>
                            <div className="text-sm text-gray-500">Análise de campanhas e conversões</div>
                          </div>
                          <Button variant="outline" className="text-xs">Visualizar</Button>
                        </div>
                      </div>

                      <div className="p-3 border rounded-lg hover:bg-gray-50">
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-medium">Performance de Equipe</div>
                            <div className="text-sm text-gray-500">Rankings e metas individuais</div>
                          </div>
                          <Button variant="outline" className="text-xs">Exportar</Button>
                        </div>
                      </div>

                      <div className="p-3 border rounded-lg hover:bg-gray-50">
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-medium">Previsões IA</div>
                            <div className="text-sm text-gray-500">Projeções e tendências futuras</div>
                          </div>
                          <Button variant="outline" className="text-xs">Ver Insights</Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>📊 Analytics em Tempo Real</CardTitle>
                    <CardDescription>Métricas atualizadas automaticamente</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="text-center p-3 bg-blue-50 rounded-lg">
                        <div className="text-lg font-bold text-blue-600">R$ 45.2K</div>
                        <div className="text-xs text-gray-600">Vendas Hoje</div>
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-lg font-bold text-green-600">23</div>
                        <div className="text-xs text-gray-600">Novos Leads</div>
                      </div>
                      <div className="text-center p-3 bg-purple-50 rounded-lg">
                        <div className="text-lg font-bold text-purple-600">87%</div>
                        <div className="text-xs text-gray-600">Taxa Satisfação</div>
                      </div>
                      <div className="text-center p-3 bg-orange-50 rounded-lg">
                        <div className="text-lg font-bold text-orange-600">12</div>
                        <div className="text-xs text-gray-600">Demos Hoje</div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Meta Mensal</span>
                        <span className="font-medium">78% (R$ 420K / R$ 540K)</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-blue-600 h-2 rounded-full" style={{ width: '78%' }}></div>
                      </div>
                    </div>

                    <Button className="w-full mt-4">Dashboard Executivo</Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="settings">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>🔗 Integrações</CardTitle>
                    <CardDescription>Conecte suas ferramentas favoritas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-green-100 rounded flex items-center justify-center">
                            <span className="text-xs">📱</span>
                          </div>
                          <div>
                            <div className="font-medium text-sm">WhatsApp Business</div>
                            <div className="text-xs text-gray-500">API Oficial conectada</div>
                          </div>
                        </div>
                        <Badge className="bg-green-500">Conectado</Badge>
                      </div>

                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center">
                            <span className="text-xs">📘</span>
                          </div>
                          <div>
                            <div className="font-medium text-sm">Meta Business Suite</div>
                            <div className="text-xs text-gray-500">Facebook + Instagram</div>
                          </div>
                        </div>
                        <Badge className="bg-blue-500">Conectado</Badge>
                      </div>

                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-red-100 rounded flex items-center justify-center">
                            <span className="text-xs">📊</span>
                          </div>
                          <div>
                            <div className="font-medium text-sm">Google Analytics</div>
                            <div className="text-xs text-gray-500">Tracking e conversões</div>
                          </div>
                        </div>
                        <Badge variant="outline">Desconectado</Badge>
                      </div>

                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-purple-100 rounded flex items-center justify-center">
                            <span className="text-xs">⚡</span>
                          </div>
                          <div>
                            <div className="font-medium text-sm">Zapier</div>
                            <div className="text-xs text-gray-500">Automações avançadas</div>
                          </div>
                        </div>
                        <Badge className="bg-purple-500">Conectado</Badge>
                      </div>
                    </div>
                    <Button className="w-full mt-4">+ Nova Integração</Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>⚙️ Configurações Gerais</CardTitle>
                    <CardDescription>Personalize seu CRM</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium block mb-1">Fuso Horário</label>
                        <div className="text-sm text-gray-600 p-2 bg-gray-50 rounded">América/São_Paulo (UTC-3)</div>
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-1">Moeda Padrão</label>
                        <div className="text-sm text-gray-600 p-2 bg-gray-50 rounded">Real Brasileiro (BRL)</div>
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-1">Idioma</label>
                        <div className="text-sm text-gray-600 p-2 bg-gray-50 rounded">Português (Brasil)</div>
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-1">Formato de Data</label>
                        <div className="text-sm text-gray-600 p-2 bg-gray-50 rounded">DD/MM/AAAA</div>
                      </div>

                      <div className="pt-4 border-t">
                        <div className="text-sm font-medium mb-3">Notificações</div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Email de Novos Leads</span>
                            <Badge className="bg-green-500">Ativo</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Push Notifications</span>
                            <Badge className="bg-green-500">Ativo</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Relatório Semanal</span>
                            <Badge variant="outline">Inativo</Badge>
                          </div>
                        </div>
                      </div>

                      <Button className="w-full mt-4">Salvar Configurações</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </NotificationProvider>
  )
}

export default App
