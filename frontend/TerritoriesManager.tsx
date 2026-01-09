import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Label } from "@/label"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { toast } from 'sonner'
import {
  MapPin,
  Users,
  Target,
  Gear,
  Plus,
  PencilSimple,
  Trash,
  ChartBar,
  Globe,
  Warning,
  CheckCircle,
  Clock,
  TrendUp
} from "@phosphor-icons/react"

interface Territory {
  id: string
  name: string
  description: string
  type: 'geographic' | 'industry' | 'company_size' | 'custom'
  assignedUsers: string[]
  rules: TerritoryRule[]
  metrics: {
    totalLeads: number
    convertedLeads: number
    revenue: number
    conversionRate: number
  }
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface TerritoryRule {
  id: string
  field: string
  operator: 'equals' | 'contains' | 'starts_with' | 'in_range' | 'greater_than' | 'less_than'
  value: string | string[]
  priority: number
}

interface LeadRoutingLog {
  id: string
  leadId: string
  leadName: string
  territoryId: string
  territoryName: string
  assignedUserId: string
  assignedUserName: string
  routingReason: string
  routedAt: string
  status: 'success' | 'conflict' | 'failed'
}

export function TerritoriesManager() {
  const [territories, setTerritories] = useKV<Territory[]>("territories", [])
  const [routingLogs, setRoutingLogs] = useKV<LeadRoutingLog[]>("routing-logs", [])
  const [selectedTerritory, setSelectedTerritory] = useState<Territory | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("territories")

  // Mock users data
  const availableUsers = [
    { id: "1", name: "Ana Silva", email: "ana@empresa.com" },
    { id: "2", name: "João Santos", email: "joao@empresa.com" },
    { id: "3", name: "Maria Costa", email: "maria@empresa.com" },
    { id: "4", name: "Pedro Lima", email: "pedro@empresa.com" }
  ]

  // Initialize with sample data if empty
  if (territories.length === 0) {
    const sampleTerritories: Territory[] = [
      {
        id: "1",
        name: "Sudeste - Grandes Empresas",
        description: "Território para empresas com mais de 500 funcionários na região Sudeste",
        type: "geographic",
        assignedUsers: ["1", "2"],
        rules: [
          {
            id: "1",
            field: "region",
            operator: "equals",
            value: "Sudeste",
            priority: 1
          },
          {
            id: "2",
            field: "company_size",
            operator: "greater_than",
            value: "500",
            priority: 2
          }
        ],
        metrics: {
          totalLeads: 145,
          convertedLeads: 32,
          revenue: 2800000,
          conversionRate: 22.1
        },
        isActive: true,
        createdAt: "2024-01-15T10:00:00Z",
        updatedAt: "2024-03-10T14:30:00Z"
      },
      {
        id: "2",
        name: "Sul - Tecnologia",
        description: "Empresas de tecnologia na região Sul",
        type: "industry",
        assignedUsers: ["3"],
        rules: [
          {
            id: "3",
            field: "region",
            operator: "equals",
            value: "Sul",
            priority: 1
          },
          {
            id: "4",
            field: "industry",
            operator: "contains",
            value: "Tecnologia",
            priority: 1
          }
        ],
        metrics: {
          totalLeads: 89,
          convertedLeads: 28,
          revenue: 1650000,
          conversionRate: 31.5
        },
        isActive: true,
        createdAt: "2024-02-01T09:00:00Z",
        updatedAt: "2024-03-08T16:45:00Z"
      },
      {
        id: "3",
        name: "Nacional - PME",
        description: "Pequenas e médias empresas em todo o Brasil",
        type: "company_size",
        assignedUsers: ["4"],
        rules: [
          {
            id: "5",
            field: "company_size",
            operator: "in_range",
            value: ["10", "500"],
            priority: 1
          }
        ],
        metrics: {
          totalLeads: 312,
          convertedLeads: 45,
          revenue: 890000,
          conversionRate: 14.4
        },
        isActive: true,
        createdAt: "2024-01-20T11:30:00Z",
        updatedAt: "2024-03-12T09:15:00Z"
      }
    ]
    setTerritories(sampleTerritories)
  }

  // Initialize routing logs if empty
  if (routingLogs.length === 0) {
    const sampleLogs: LeadRoutingLog[] = [
      {
        id: "1",
        leadId: "lead-1",
        leadName: "TechCorp Solutions",
        territoryId: "1",
        territoryName: "Sudeste - Grandes Empresas",
        assignedUserId: "1",
        assignedUserName: "Ana Silva",
        routingReason: "Empresa com 800+ funcionários em São Paulo",
        routedAt: "2024-03-15T10:30:00Z",
        status: "success"
      },
      {
        id: "2",
        leadId: "lead-2",
        leadName: "StartupTech",
        territoryId: "2",
        territoryName: "Sul - Tecnologia",
        assignedUserId: "3",
        assignedUserName: "Maria Costa",
        routingReason: "Empresa de tecnologia em Porto Alegre",
        routedAt: "2024-03-15T09:15:00Z",
        status: "success"
      },
      {
        id: "3",
        leadId: "lead-3",
        leadName: "Conflito Corp",
        territoryId: "",
        territoryName: "Múltiplos territórios",
        assignedUserId: "",
        assignedUserName: "Não atribuído",
        routingReason: "Lead corresponde a múltiplas regras de território",
        routedAt: "2024-03-15T11:45:00Z",
        status: "conflict"
      }
    ]
    setRoutingLogs(sampleLogs)
  }

  const handleCreateTerritory = (territoryData: Partial<Territory>) => {
    const newTerritory: Territory = {
      id: Date.now().toString(),
      name: territoryData.name || "",
      description: territoryData.description || "",
      type: territoryData.type || "custom",
      assignedUsers: territoryData.assignedUsers || [],
      rules: territoryData.rules || [],
      metrics: {
        totalLeads: 0,
        convertedLeads: 0,
        revenue: 0,
        conversionRate: 0
      },
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setTerritories(prev => [...prev, newTerritory])
    setIsCreateModalOpen(false)
    toast.success("Território criado com sucesso!")
  }

  const handleEditTerritory = (territoryData: Partial<Territory>) => {
    if (!selectedTerritory) return

    setTerritories(prev => prev.map(territory =>
      territory.id === selectedTerritory.id
        ? { ...territory, ...territoryData, updatedAt: new Date().toISOString() }
        : territory
    ))
    setIsEditModalOpen(false)
    setSelectedTerritory(null)
    toast.success("Território atualizado com sucesso!")
  }

  const handleDeleteTerritory = (territoryId: string) => {
    setTerritories(prev => prev.filter(territory => territory.id !== territoryId))
    toast.success("Território removido com sucesso!")
  }

  const handleToggleTerritoryStatus = (territoryId: string) => {
    setTerritories(prev => prev.map(territory =>
      territory.id === territoryId
        ? { ...territory, isActive: !territory.isActive, updatedAt: new Date().toISOString() }
        : territory
    ))
    toast.success("Status do território alterado!")
  }

  const getTerritoryTypeIcon = (type: string) => {
    switch (type) {
      case 'geographic': return <MapPin className="h-4 w-4" />
      case 'industry': return <Target className="h-4 w-4" />
      case 'company_size': return <Users className="h-4 w-4" />
      default: return <Gear className="h-4 w-4" />
    }
  }

  const getTerritoryTypeName = (type: string) => {
    switch (type) {
      case 'geographic': return 'Geográfico'
      case 'industry': return 'Indústria'
      case 'company_size': return 'Tamanho da Empresa'
      default: return 'Personalizado'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-600'
      case 'conflict': return 'text-yellow-600'
      case 'failed': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4" />
      case 'conflict': return <Warning className="h-4 w-4" />
      case 'failed': return <Trash className="h-4 w-4" />
      default: return <Clock className="h-4 w-4" />
    }
  }

  // Calculate total metrics
  const totalMetrics = territories.reduce((acc, territory) => ({
    totalLeads: acc.totalLeads + territory.metrics.totalLeads,
    convertedLeads: acc.convertedLeads + territory.metrics.convertedLeads,
    revenue: acc.revenue + territory.metrics.revenue,
    conversionRate: 0 // Will calculate below
  }), { totalLeads: 0, convertedLeads: 0, revenue: 0, conversionRate: 0 })

  totalMetrics.conversionRate = totalMetrics.totalLeads > 0
    ? (totalMetrics.convertedLeads / totalMetrics.totalLeads) * 100
    : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Gestão de Territórios</h2>
          <p className="text-muted-foreground">
            Configure territórios de vendas e automatize o roteamento de leads
          </p>
        </div>
        <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo Território
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Criar Novo Território</DialogTitle>
            </DialogHeader>
            <TerritoryForm
              onSubmit={handleCreateTerritory}
              availableUsers={availableUsers}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Overview Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Globe className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Territórios Ativos</p>
                <p className="text-2xl font-bold">{territories.filter(t => t.isActive).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total de Leads</p>
                <p className="text-2xl font-bold">{totalMetrics.totalLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Taxa de Conversão</p>
                <p className="text-2xl font-bold">{totalMetrics.conversionRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <ChartBar className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Receita Total</p>
                <p className="text-2xl font-bold">R$ {(totalMetrics.revenue / 1000000).toFixed(1)}M</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="territories">Territórios</TabsTrigger>
          <TabsTrigger value="routing">Roteamento</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="territories" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {territories.map((territory) => (
              <Card key={territory.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getTerritoryTypeIcon(territory.type)}
                      <CardTitle className="text-lg">{territory.name}</CardTitle>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={territory.isActive ? "default" : "secondary"}>
                        {territory.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedTerritory(territory)
                          setIsEditModalOpen(true)
                        }}
                      >
                        <PencilSimple className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="text-sm">
                    {territory.description}
                  </CardDescription>
                  <Badge variant="outline" className="w-fit">
                    {getTerritoryTypeName(territory.type)}
                  </Badge>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Assigned Users */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      USUÁRIOS ATRIBUÍDOS
                    </Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {territory.assignedUsers.map((userId) => {
                        const user = availableUsers.find(u => u.id === userId)
                        return user ? (
                          <Badge key={userId} variant="secondary" className="text-xs">
                            {user.name}
                          </Badge>
                        ) : null
                      })}
                    </div>
                  </div>

                  {/* Territory Rules */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      REGRAS ({territory.rules.length})
                    </Label>
                    <div className="mt-1 space-y-1">
                      {territory.rules.slice(0, 2).map((rule) => (
                        <div key={rule.id} className="text-xs text-muted-foreground">
                          {rule.field} {rule.operator} {Array.isArray(rule.value) ? rule.value.join(', ') : rule.value}
                        </div>
                      ))}
                      {territory.rules.length > 2 && (
                        <div className="text-xs text-muted-foreground">
                          +{territory.rules.length - 2} mais regras
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                    <div>
                      <p className="text-xs text-muted-foreground">Leads</p>
                      <p className="font-semibold">{territory.metrics.totalLeads}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Conversão</p>
                      <p className="font-semibold">{territory.metrics.conversionRate.toFixed(1)}%</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex space-x-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleToggleTerritoryStatus(territory.id)}
                    >
                      {territory.isActive ? "Desativar" : "Ativar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteTerritory(territory.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="routing" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Log de Roteamento</CardTitle>
              <CardDescription>
                Histórico de atribuição automática de leads aos territórios
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {routingLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div className={`flex items-center space-x-2 ${getStatusColor(log.status)}`}>
                        {getStatusIcon(log.status)}
                        <span className="font-medium capitalize">{log.status}</span>
                      </div>
                      <div>
                        <p className="font-medium">{log.leadName}</p>
                        <p className="text-sm text-muted-foreground">{log.routingReason}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{log.territoryName || "Não atribuído"}</p>
                      <p className="text-sm text-muted-foreground">{log.assignedUserName || "Nenhum"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.routedAt).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Performance por Território</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {territories.map((territory) => (
                    <div key={territory.id} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{territory.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {territory.metrics.conversionRate.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(territory.metrics.conversionRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Distribuição de Leads</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {territories.map((territory) => (
                    <div key={territory.id} className="flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        {getTerritoryTypeIcon(territory.type)}
                        <span className="font-medium">{territory.name}</span>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{territory.metrics.totalLeads}</p>
                        <p className="text-sm text-muted-foreground">
                          {territory.metrics.convertedLeads} convertidos
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Territory Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Território</DialogTitle>
          </DialogHeader>
          {selectedTerritory && (
            <TerritoryForm
              territory={selectedTerritory}
              onSubmit={handleEditTerritory}
              availableUsers={availableUsers}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Territory Form Component
function TerritoryForm({
  territory,
  onSubmit,
  availableUsers
}: {
  territory?: Territory
  onSubmit: (data: Partial<Territory>) => void
  availableUsers: Array<{ id: string; name: string; email: string }>
}) {
  const [formData, setFormData] = useState({
    name: territory?.name || "",
    description: territory?.description || "",
    type: territory?.type || "custom",
    assignedUsers: territory?.assignedUsers || []
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome do Território</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: Sudeste - Grandes Empresas"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="type">Tipo de Território</Label>
          <Select
            value={formData.type}
            onValueChange={(value) => setFormData(prev => ({ ...prev, type: value as any }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="geographic">Geográfico</SelectItem>
              <SelectItem value="industry">Indústria</SelectItem>
              <SelectItem value="company_size">Tamanho da Empresa</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descrição</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Descreva as características deste território..."
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label>Usuários Atribuídos</Label>
        <div className="grid grid-cols-2 gap-2">
          {availableUsers.map((user) => (
            <div key={user.id} className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={`user-${user.id}`}
                checked={formData.assignedUsers.includes(user.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setFormData(prev => ({
                      ...prev,
                      assignedUsers: [...prev.assignedUsers, user.id]
                    }))
                  } else {
                    setFormData(prev => ({
                      ...prev,
                      assignedUsers: prev.assignedUsers.filter(id => id !== user.id)
                    }))
                  }
                }}
                className="rounded border-gray-300"
              />
              <Label htmlFor={`user-${user.id}`} className="text-sm">
                {user.name}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline">
          Cancelar
        </Button>
        <Button type="submit">
          {territory ? "Atualizar" : "Criar"} Território
        </Button>
      </div>
    </form>
  )
}
