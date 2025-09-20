import { useState } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import {
  Factory,
  Package,
  Gear,
  PlayCircle,
  PauseCircle,
  CheckCircle,
  XCircle,
  Clock,
  Plus,
  Eye,
  Wrench,
  ChartBar,
  CalendarBlank,
  User,
  MapPin,
  Timer
} from "@phosphor-icons/react"

interface BillOfMaterials {
  id: string
  itemCode: string
  itemName: string
  quantity: number
  rawMaterials: RawMaterial[]
  operations: Operation[]
  totalCost: number
  leadTime: number // in days
  isActive: boolean
  version: number
}

interface RawMaterial {
  id: string
  itemCode: string
  itemName: string
  quantity: number
  unit: string
  rate: number
  amount: number
}

interface Operation {
  id: string
  operationName: string
  workstation: string
  timeInMins: number
  operatingCost: number
  description: string
}

interface WorkOrder {
  id: string
  itemCode: string
  itemName: string
  bomId: string
  plannedQty: number
  producedQty: number
  status: 'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled'
  plannedStartDate: string
  plannedEndDate: string
  actualStartDate?: string
  actualEndDate?: string
  assignedTo?: string
  workstation?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
}

interface ProductionPlan {
  id: string
  name: string
  fromDate: string
  toDate: string
  workOrders: string[]
  status: 'draft' | 'submitted' | 'in_progress' | 'completed'
  totalQty: number
  completedQty: number
}

interface Workstation {
  id: string
  name: string
  description: string
  hourRate: number
  capacity: number
  workingHours: {
    start: string
    end: string
  }
  isActive: boolean
  currentLoad: number
}

export function ManufacturingModule() {
  const [activeTab, setActiveTab] = useState("production")

  // Persistent data
  const [workOrders, setWorkOrders] = useKV<WorkOrder[]>("work_orders", [
    {
      id: "WO-001",
      itemCode: "PROD-001",
      itemName: "Produto Acabado A",
      bomId: "BOM-001",
      plannedQty: 100,
      producedQty: 75,
      status: "in_progress",
      plannedStartDate: "2024-03-20",
      plannedEndDate: "2024-03-25",
      actualStartDate: "2024-03-20",
      assignedTo: "Operador 1",
      workstation: "WS-001",
      priority: "high"
    },
    {
      id: "WO-002",
      itemCode: "PROD-002",
      itemName: "Produto Acabado B",
      bomId: "BOM-002",
      plannedQty: 50,
      producedQty: 0,
      status: "planned",
      plannedStartDate: "2024-03-25",
      plannedEndDate: "2024-03-28",
      workstation: "WS-002",
      priority: "medium"
    }
  ])

  const [boms, setBoms] = useKV<BillOfMaterials[]>("bill_of_materials", [
    {
      id: "BOM-001",
      itemCode: "PROD-001",
      itemName: "Produto Acabado A",
      quantity: 1,
      rawMaterials: [
        {
          id: "RM-001",
          itemCode: "MAT-001",
          itemName: "Matéria Prima A",
          quantity: 2,
          unit: "kg",
          rate: 15.50,
          amount: 31.00
        },
        {
          id: "RM-002",
          itemCode: "MAT-002",
          itemName: "Matéria Prima B",
          quantity: 1,
          unit: "m",
          rate: 25.00,
          amount: 25.00
        }
      ],
      operations: [
        {
          id: "OP-001",
          operationName: "Corte",
          workstation: "WS-001",
          timeInMins: 30,
          operatingCost: 12.50,
          description: "Corte das matérias primas"
        },
        {
          id: "OP-002",
          operationName: "Montagem",
          workstation: "WS-002",
          timeInMins: 45,
          operatingCost: 18.75,
          description: "Montagem do produto final"
        }
      ],
      totalCost: 87.25,
      leadTime: 3,
      isActive: true,
      version: 1
    }
  ])

  const [workstations, setWorkstations] = useKV<Workstation[]>("workstations", [
    {
      id: "WS-001",
      name: "Estação de Corte",
      description: "Estação para corte de materiais",
      hourRate: 25.00,
      capacity: 8,
      workingHours: {
        start: "08:00",
        end: "17:00"
      },
      isActive: true,
      currentLoad: 75
    },
    {
      id: "WS-002",
      name: "Estação de Montagem",
      description: "Estação para montagem de produtos",
      hourRate: 30.00,
      capacity: 6,
      workingHours: {
        start: "08:00",
        end: "17:00"
      },
      isActive: true,
      currentLoad: 50
    }
  ])

  const [productionPlans, setProductionPlans] = useKV<ProductionPlan[]>("production_plans", [])

  // Form states
  const [newWorkOrder, setNewWorkOrder] = useState({
    itemCode: "",
    itemName: "",
    bomId: "",
    plannedQty: "",
    plannedStartDate: "",
    plannedEndDate: "",
    workstation: "",
    priority: "medium" as WorkOrder['priority']
  })

  const [newBom, setNewBom] = useState({
    itemCode: "",
    itemName: "",
    quantity: "1",
    rawMaterials: [] as RawMaterial[],
    operations: [] as Operation[]
  })

  const getStatusColor = (status: WorkOrder['status']) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800'
      case 'planned': return 'bg-blue-100 text-blue-800'
      case 'in_progress': return 'bg-yellow-100 text-yellow-800'
      case 'completed': return 'bg-green-100 text-green-800'
      case 'cancelled': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityColor = (priority: WorkOrder['priority']) => {
    switch (priority) {
      case 'low': return 'bg-gray-100 text-gray-800'
      case 'medium': return 'bg-blue-100 text-blue-800'
      case 'high': return 'bg-orange-100 text-orange-800'
      case 'urgent': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const handleCreateWorkOrder = () => {
    if (!newWorkOrder.itemCode || !newWorkOrder.plannedQty || !newWorkOrder.bomId) {
      return
    }

    const workOrder: WorkOrder = {
      id: `WO-${String(workOrders.length + 1).padStart(3, '0')}`,
      itemCode: newWorkOrder.itemCode,
      itemName: newWorkOrder.itemName,
      bomId: newWorkOrder.bomId,
      plannedQty: parseInt(newWorkOrder.plannedQty),
      producedQty: 0,
      status: 'draft',
      plannedStartDate: newWorkOrder.plannedStartDate,
      plannedEndDate: newWorkOrder.plannedEndDate,
      workstation: newWorkOrder.workstation,
      priority: newWorkOrder.priority
    }

    setWorkOrders(prev => [...prev, workOrder])

    // Reset form
    setNewWorkOrder({
      itemCode: "",
      itemName: "",
      bomId: "",
      plannedQty: "",
      plannedStartDate: "",
      plannedEndDate: "",
      workstation: "",
      priority: "medium"
    })
  }

  const updateWorkOrderStatus = (workOrderId: string, newStatus: WorkOrder['status']) => {
    setWorkOrders(prev =>
      prev.map(wo => {
        if (wo.id !== workOrderId) return wo

        const updates: Partial<WorkOrder> = { status: newStatus }

        if (newStatus === 'in_progress' && !wo.actualStartDate) {
          updates.actualStartDate = new Date().toISOString().split('T')[0]
        } else if (newStatus === 'completed') {
          updates.actualEndDate = new Date().toISOString().split('T')[0]
          updates.producedQty = wo.plannedQty
        }

        return { ...wo, ...updates }
      })
    )
  }

  const updateProducedQuantity = (workOrderId: string, quantity: number) => {
    setWorkOrders(prev =>
      prev.map(wo =>
        wo.id === workOrderId
          ? { ...wo, producedQty: Math.min(quantity, wo.plannedQty) }
          : wo
      )
    )
  }

  // Calculate summary metrics
  const totalWorkOrders = workOrders.length
  const inProgressOrders = workOrders.filter(wo => wo.status === 'in_progress').length
  const completedOrders = workOrders.filter(wo => wo.status === 'completed').length
  const totalPlannedQty = workOrders.reduce((sum, wo) => sum + wo.plannedQty, 0)
  const totalProducedQty = workOrders.reduce((sum, wo) => sum + wo.producedQty, 0)
  const overallProgress = totalPlannedQty > 0 ? (totalProducedQty / totalPlannedQty) * 100 : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Factory className="h-6 w-6 text-primary" />
            <span>Módulo de Manufatura</span>
          </h2>
          <p className="text-muted-foreground">
            Gestão completa de produção com BOM, ordens de trabalho e planejamento
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Nova Ordem de Produção
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Ordens</p>
                <p className="text-2xl font-bold">{totalWorkOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                <PlayCircle className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Em Progresso</p>
                <p className="text-2xl font-bold text-yellow-600">{inProgressOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Concluídas</p>
                <p className="text-2xl font-bold text-green-600">{completedOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <ChartBar className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Produzido</p>
                <p className="text-2xl font-bold text-purple-600">{totalProducedQty}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">Progresso Geral</p>
                <p className="text-sm font-bold">{overallProgress.toFixed(1)}%</p>
              </div>
              <Progress value={overallProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {totalProducedQty} de {totalPlannedQty} unidades
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="production">Produção</TabsTrigger>
          <TabsTrigger value="bom">Lista de Materiais</TabsTrigger>
          <TabsTrigger value="workstations">Estações</TabsTrigger>
          <TabsTrigger value="planning">Planejamento</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
        </TabsList>

        <TabsContent value="production" className="space-y-6">
          {/* New Work Order Form */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Nova Ordem de Produção</CardTitle>
              <CardDescription>
                Crie uma nova ordem de trabalho para produção
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Código do Item</label>
                  <Input
                    placeholder="PROD-001"
                    value={newWorkOrder.itemCode}
                    onChange={(e) => setNewWorkOrder(prev => ({ ...prev, itemCode: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Nome do Item</label>
                  <Input
                    placeholder="Nome do produto"
                    value={newWorkOrder.itemName}
                    onChange={(e) => setNewWorkOrder(prev => ({ ...prev, itemName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Lista de Materiais</label>
                  <Select value={newWorkOrder.bomId} onValueChange={(value) =>
                    setNewWorkOrder(prev => ({ ...prev, bomId: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione BOM" />
                    </SelectTrigger>
                    <SelectContent>
                      {boms.filter(bom => bom.isActive).map(bom => (
                        <SelectItem key={bom.id} value={bom.id}>
                          {bom.itemCode} - {bom.itemName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium">Quantidade Planejada</label>
                  <Input
                    type="number"
                    placeholder="100"
                    value={newWorkOrder.plannedQty}
                    onChange={(e) => setNewWorkOrder(prev => ({ ...prev, plannedQty: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Data Início</label>
                  <Input
                    type="date"
                    value={newWorkOrder.plannedStartDate}
                    onChange={(e) => setNewWorkOrder(prev => ({ ...prev, plannedStartDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Data Fim</label>
                  <Input
                    type="date"
                    value={newWorkOrder.plannedEndDate}
                    onChange={(e) => setNewWorkOrder(prev => ({ ...prev, plannedEndDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Prioridade</label>
                  <Select value={newWorkOrder.priority} onValueChange={(value: WorkOrder['priority']) =>
                    setNewWorkOrder(prev => ({ ...prev, priority: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="urgent">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button onClick={handleCreateWorkOrder} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Criar Ordem de Produção
              </Button>
            </CardContent>
          </Card>

          {/* Work Orders List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {workOrders.map(workOrder => {
              const progress = workOrder.plannedQty > 0 ? (workOrder.producedQty / workOrder.plannedQty) * 100 : 0

              return (
                <Card key={workOrder.id} className="glass-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">{workOrder.itemName}</CardTitle>
                        <CardDescription>{workOrder.id}</CardDescription>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge className={getPriorityColor(workOrder.priority)}>
                          {workOrder.priority === 'low' ? 'Baixa' :
                            workOrder.priority === 'medium' ? 'Média' :
                              workOrder.priority === 'high' ? 'Alta' : 'Urgente'}
                        </Badge>
                        <Badge className={getStatusColor(workOrder.status)}>
                          {workOrder.status === 'draft' ? 'Rascunho' :
                            workOrder.status === 'planned' ? 'Planejada' :
                              workOrder.status === 'in_progress' ? 'Em Progresso' :
                                workOrder.status === 'completed' ? 'Concluída' : 'Cancelada'}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progresso</span>
                        <span className="font-medium">{progress.toFixed(1)}%</span>
                      </div>
                      <Progress value={progress} className="h-2" />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {workOrder.producedQty} de {workOrder.plannedQty} unidades
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Data Planejada</span>
                        <span className="font-medium">
                          {new Date(workOrder.plannedStartDate).toLocaleDateString('pt-BR')} - {' '}
                          {new Date(workOrder.plannedEndDate).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      {workOrder.workstation && (
                        <div className="flex items-center space-x-2 text-sm">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span>{workstations.find(ws => ws.id === workOrder.workstation)?.name}</span>
                        </div>
                      )}
                      {workOrder.assignedTo && (
                        <div className="flex items-center space-x-2 text-sm">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>{workOrder.assignedTo}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 pt-4 border-t">
                      {workOrder.status === 'draft' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateWorkOrderStatus(workOrder.id, 'planned')}
                        >
                          <CalendarBlank className="h-4 w-4 mr-2" />
                          Planejar
                        </Button>
                      )}
                      {workOrder.status === 'planned' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateWorkOrderStatus(workOrder.id, 'in_progress')}
                        >
                          <PlayCircle className="h-4 w-4 mr-2" />
                          Iniciar
                        </Button>
                      )}
                      {workOrder.status === 'in_progress' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateWorkOrderStatus(workOrder.id, 'completed')}
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Concluir
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateWorkOrderStatus(workOrder.id, 'cancelled')}
                          >
                            <XCircle className="h-4 w-4 mr-2" />
                            Cancelar
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" className="ml-auto">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="bom" className="space-y-6">
          {/* BOM List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {boms.map(bom => (
              <Card key={bom.id} className="glass-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{bom.itemName}</CardTitle>
                      <CardDescription>{bom.itemCode} - v{bom.version}</CardDescription>
                    </div>
                    <Badge variant={bom.isActive ? 'default' : 'secondary'}>
                      {bom.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Custo Total</span>
                      <span className="font-medium">R$ {bom.totalCost.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Lead Time</span>
                      <span className="font-medium">{bom.leadTime} dias</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Matérias Primas</span>
                      <span className="font-medium">{bom.rawMaterials.length} itens</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Operações</span>
                      <span className="font-medium">{bom.operations.length} etapas</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Matérias Primas</h4>
                    <div className="space-y-1">
                      {bom.rawMaterials.slice(0, 3).map(material => (
                        <div key={material.id} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{material.itemName}</span>
                          <span>{material.quantity} {material.unit}</span>
                        </div>
                      ))}
                      {bom.rawMaterials.length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          +{bom.rawMaterials.length - 3} itens...
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-4 border-t">
                    <Button variant="outline" size="sm" className="flex-1">
                      <Eye className="h-4 w-4 mr-2" />
                      Visualizar
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Gear className="h-4 w-4 mr-2" />
                      Editar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="workstations" className="space-y-6">
          {/* Workstations List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workstations.map(workstation => (
              <Card key={workstation.id} className="glass-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{workstation.name}</CardTitle>
                      <CardDescription>{workstation.description}</CardDescription>
                    </div>
                    <Badge variant={workstation.isActive ? 'default' : 'secondary'}>
                      {workstation.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Taxa/Hora</span>
                      <span className="font-medium">R$ {workstation.hourRate.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Capacidade</span>
                      <span className="font-medium">{workstation.capacity}h/dia</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Horário</span>
                      <span className="font-medium">
                        {workstation.workingHours.start} - {workstation.workingHours.end}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Carga Atual</span>
                      <span className="font-medium">{workstation.currentLoad}%</span>
                    </div>
                    <Progress value={workstation.currentLoad} className="h-2" />
                  </div>

                  <div className="flex items-center space-x-2 pt-4 border-t">
                    <Button variant="outline" size="sm" className="flex-1">
                      <Eye className="h-4 w-4 mr-2" />
                      Detalhes
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Gear className="h-4 w-4 mr-2" />
                      Config
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="planning" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Planejamento de Produção</CardTitle>
              <CardDescription>
                Crie e gerencie planos de produção para otimizar recursos
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <CalendarBlank className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Funcionalidade de planejamento em desenvolvimento</p>
                <Button className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Plano de Produção
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <ChartBar className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Produtividade</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Relatório de produtividade por estação
                </p>
                <Button className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <Factory className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Utilização</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Taxa de utilização das estações
                </p>
                <Button className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <Clock className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Lead Time</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Análise de tempos de produção
                </p>
                <Button className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
