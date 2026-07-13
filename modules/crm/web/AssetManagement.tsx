import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { parseDate } from '@/date-utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Input } from "@/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Progress } from "@/progress"
import {
  Package,
  Wrench,
  TrendDown,
  CalendarBlank,
  MapPin,
  User,
  Plus,
  Eye,
  Warning,
  CheckCircle,
  Clock,
  CurrencyDollar,
  ChartLineUp
} from "@phosphor-icons/react"

interface Asset {
  id: string
  name: string
  assetNumber: string
  category: string
  location: string
  purchaseDate: string
  purchaseValue: number
  currentValue: number
  depreciationMethod: 'straight_line' | 'declining_balance' | 'units_of_production'
  usefulLife: number // in years
  residualValue: number
  status: 'active' | 'maintenance' | 'disposed' | 'sold'
  assignedTo?: string
  warrantyExpiry?: string
  nextMaintenanceDate?: string
  description: string
}

interface MaintenanceRecord {
  id: string
  assetId: string
  type: 'preventive' | 'corrective' | 'inspection'
  description: string
  date: string
  cost: number
  performedBy: string
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  nextDueDate?: string
}

interface DepreciationEntry {
  id: string
  assetId: string
  period: string
  openingValue: number
  depreciationAmount: number
  closingValue: number
  method: string
}

export function AssetManagement() {
  const [activeTab, setActiveTab] = useState("assets")

  // Persistent data
  const [assets, setAssets] = useKV<Asset[]>("assets", [
    {
      id: "1",
      name: "MacBook Pro 16\"",
      assetNumber: "IT-001",
      category: "Equipamentos de TI",
      location: "Escritório SP",
      purchaseDate: "2023-01-15",
      purchaseValue: 15000,
      currentValue: 12000,
      depreciationMethod: "straight_line",
      usefulLife: 5,
      residualValue: 2000,
      status: "active",
      assignedTo: "João Silva",
      warrantyExpiry: "2026-01-15",
      nextMaintenanceDate: "2024-06-15",
      description: "Notebook para desenvolvimento"
    },
    {
      id: "2",
      name: "Impressora Laser",
      assetNumber: "OF-001",
      category: "Equipamentos de Escritório",
      location: "Escritório SP",
      purchaseDate: "2022-06-10",
      purchaseValue: 3500,
      currentValue: 2100,
      depreciationMethod: "straight_line",
      usefulLife: 7,
      residualValue: 500,
      status: "maintenance",
      warrantyExpiry: "2024-06-10",
      nextMaintenanceDate: "2024-04-01",
      description: "Impressora multifuncional para escritório"
    }
  ])

  const [maintenanceRecords, setMaintenanceRecords] = useKV<MaintenanceRecord[]>("maintenance_records", [
    {
      id: "1",
      assetId: "2",
      type: "preventive",
      description: "Limpeza e substituição de toner",
      date: "2024-03-15",
      cost: 250,
      performedBy: "Tech Support",
      status: "completed",
      nextDueDate: "2024-06-15"
    }
  ])

  const [depreciationEntries, setDepreciationEntries] = useKV<DepreciationEntry[]>("depreciation_entries", [])

  // Form states
  const [newAsset, setNewAsset] = useState({
    name: "",
    assetNumber: "",
    category: "",
    location: "",
    purchaseDate: "",
    purchaseValue: "",
    usefulLife: "",
    residualValue: "",
    description: ""
  })

  const [newMaintenance, setNewMaintenance] = useState({
    assetId: "",
    type: "preventive" as MaintenanceRecord['type'],
    description: "",
    cost: "",
    performedBy: ""
  })

  const calculateDepreciation = (asset: Asset): number => {
    const currentDate = new Date()
    const purchaseDate = parseDate(asset.purchaseDate)
    const yearsElapsed = (currentDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24 * 365)

    if (asset.depreciationMethod === 'straight_line') {
      const annualDepreciation = (asset.purchaseValue - asset.residualValue) / asset.usefulLife
      return Math.min(annualDepreciation * yearsElapsed, asset.purchaseValue - asset.residualValue)
    }

    return 0
  }

  const getAssetStatusColor = (status: Asset['status']) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800'
      case 'maintenance': return 'bg-yellow-100 text-yellow-800'
      case 'disposed': return 'bg-gray-100 text-gray-800'
      case 'sold': return 'bg-blue-100 text-blue-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getMaintenanceStatusColor = (status: MaintenanceRecord['status']) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800'
      case 'in_progress': return 'bg-yellow-100 text-yellow-800'
      case 'completed': return 'bg-green-100 text-green-800'
      case 'cancelled': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const handleCreateAsset = () => {
    if (!newAsset.name || !newAsset.assetNumber || !newAsset.category || !newAsset.purchaseValue) {
      return
    }

    const asset: Asset = {
      id: Date.now().toString(),
      name: newAsset.name,
      assetNumber: newAsset.assetNumber,
      category: newAsset.category,
      location: newAsset.location || "Não informado",
      purchaseDate: newAsset.purchaseDate || new Date().toISOString().split('T')[0],
      purchaseValue: parseFloat(newAsset.purchaseValue),
      currentValue: parseFloat(newAsset.purchaseValue),
      depreciationMethod: "straight_line",
      usefulLife: parseInt(newAsset.usefulLife) || 5,
      residualValue: parseFloat(newAsset.residualValue) || 0,
      status: "active",
      description: newAsset.description
    }

    setAssets(prev => [...prev, asset])
    setNewAsset({
      name: "",
      assetNumber: "",
      category: "",
      location: "",
      purchaseDate: "",
      purchaseValue: "",
      usefulLife: "",
      residualValue: "",
      description: ""
    })
  }

  const handleCreateMaintenance = () => {
    if (!newMaintenance.assetId || !newMaintenance.description || !newMaintenance.performedBy) {
      return
    }

    const maintenance: MaintenanceRecord = {
      id: Date.now().toString(),
      assetId: newMaintenance.assetId,
      type: newMaintenance.type,
      description: newMaintenance.description,
      date: new Date().toISOString().split('T')[0],
      cost: parseFloat(newMaintenance.cost) || 0,
      performedBy: newMaintenance.performedBy,
      status: "completed"
    }

    setMaintenanceRecords(prev => [...prev, maintenance])
    setNewMaintenance({
      assetId: "",
      type: "preventive",
      description: "",
      cost: "",
      performedBy: ""
    })
  }

  const runDepreciation = () => {
    const currentPeriod = new Date().toISOString().slice(0, 7) // YYYY-MM format

    assets.forEach(asset => {
      const depreciation = calculateDepreciation(asset)
      const entry: DepreciationEntry = {
        id: `${asset.id}-${currentPeriod}`,
        assetId: asset.id,
        period: currentPeriod,
        openingValue: asset.currentValue,
        depreciationAmount: depreciation,
        closingValue: asset.purchaseValue - depreciation,
        method: asset.depreciationMethod
      }

      setDepreciationEntries(prev => {
        const existing = prev.find(e => e.id === entry.id)
        if (existing) return prev
        return [...prev, entry]
      })
    })
  }

  // Calculate summary metrics
  const totalAssetValue = assets.reduce((sum, asset) => sum + asset.currentValue, 0)
  const totalDepreciation = assets.reduce((sum, asset) => sum + calculateDepreciation(asset), 0)
  const activeAssets = assets.filter(a => a.status === 'active').length
  const assetsInMaintenance = assets.filter(a => a.status === 'maintenance').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Package className="h-6 w-6 text-primary" />
            <span>Gestão de Ativos</span>
          </h2>
          <p className="text-muted-foreground">
            Controle completo de ativos com depreciação e manutenção
          </p>
        </div>
        <Button onClick={runDepreciation}>
          <ChartLineUp className="h-4 w-4 mr-2" />
          Executar Depreciação
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Valor Total</p>
                <p className="text-2xl font-bold">
                  R$ {(totalAssetValue / 1000).toFixed(0)}K
                </p>
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
                <p className="text-sm font-medium text-muted-foreground">Ativos Ativos</p>
                <p className="text-2xl font-bold text-green-600">{activeAssets}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                <Wrench className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Em Manutenção</p>
                <p className="text-2xl font-bold text-yellow-600">{assetsInMaintenance}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
                <TrendDown className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Depreciação Acum.</p>
                <p className="text-2xl font-bold text-red-600">
                  R$ {(totalDepreciation / 1000).toFixed(0)}K
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="assets">Ativos</TabsTrigger>
          <TabsTrigger value="maintenance">Manutenção</TabsTrigger>
          <TabsTrigger value="depreciation">Depreciação</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="space-y-6">
          {/* New Asset Form */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Cadastrar Novo Ativo</CardTitle>
              <CardDescription>
                Registre um novo ativo para controle e depreciação
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Nome do Ativo</label>
                  <Input
                    placeholder="Ex: Notebook Dell"
                    value={newAsset.name}
                    onChange={(e) => setNewAsset(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Número do Ativo</label>
                  <Input
                    placeholder="Ex: IT-001"
                    value={newAsset.assetNumber}
                    onChange={(e) => setNewAsset(prev => ({ ...prev, assetNumber: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Categoria</label>
                  <Select value={newAsset.category} onValueChange={(value) =>
                    setNewAsset(prev => ({ ...prev, category: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Equipamentos de TI">Equipamentos de TI</SelectItem>
                      <SelectItem value="Móveis e Utensílios">Móveis e Utensílios</SelectItem>
                      <SelectItem value="Veículos">Veículos</SelectItem>
                      <SelectItem value="Equipamentos de Escritório">Equipamentos de Escritório</SelectItem>
                      <SelectItem value="Máquinas e Equipamentos">Máquinas e Equipamentos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Localização</label>
                  <Input
                    placeholder="Ex: Escritório SP"
                    value={newAsset.location}
                    onChange={(e) => setNewAsset(prev => ({ ...prev, location: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Data de Compra</label>
                  <Input
                    type="date"
                    value={newAsset.purchaseDate}
                    onChange={(e) => setNewAsset(prev => ({ ...prev, purchaseDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Valor de Compra</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={newAsset.purchaseValue}
                    onChange={(e) => setNewAsset(prev => ({ ...prev, purchaseValue: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Vida Útil (anos)</label>
                  <Input
                    type="number"
                    placeholder="5"
                    value={newAsset.usefulLife}
                    onChange={(e) => setNewAsset(prev => ({ ...prev, usefulLife: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Valor Residual</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={newAsset.residualValue}
                    onChange={(e) => setNewAsset(prev => ({ ...prev, residualValue: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Descrição</label>
                <Input
                  placeholder="Descrição detalhada do ativo"
                  value={newAsset.description}
                  onChange={(e) => setNewAsset(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <Button onClick={handleCreateAsset} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Cadastrar Ativo
              </Button>
            </CardContent>
          </Card>

          {/* Assets List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {assets.map(asset => {
              const depreciation = calculateDepreciation(asset)
              const depreciationPercentage = ((depreciation / (asset.purchaseValue - asset.residualValue)) * 100)

              return (
                <Card key={asset.id} className="glass-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Package className="h-5 w-5 text-primary" />
                        <div>
                          <CardTitle className="text-lg">{asset.name}</CardTitle>
                          <CardDescription>{asset.assetNumber}</CardDescription>
                        </div>
                      </div>
                      <Badge className={getAssetStatusColor(asset.status)}>
                        {asset.status === 'active' ? 'Ativo' :
                          asset.status === 'maintenance' ? 'Manutenção' :
                            asset.status === 'disposed' ? 'Descartado' : 'Vendido'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Valor Original</span>
                        <span className="font-medium">
                          R$ {asset.purchaseValue.toLocaleString('pt-BR')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Valor Atual</span>
                        <span className="font-medium text-green-600">
                          R$ {(asset.purchaseValue - depreciation).toLocaleString('pt-BR')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Depreciação</span>
                        <span className="font-medium text-red-600">
                          R$ {depreciation.toLocaleString('pt-BR')}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Depreciação</span>
                        <span className="font-medium">{depreciationPercentage.toFixed(1)}%</span>
                      </div>
                      <Progress value={Math.min(depreciationPercentage, 100)} className="h-2" />
                    </div>

                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center space-x-2 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span>{asset.location}</span>
                      </div>
                      {asset.assignedTo && (
                        <div className="flex items-center space-x-2 text-sm">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>{asset.assignedTo}</span>
                        </div>
                      )}
                      {asset.nextMaintenanceDate && (
                        <div className="flex items-center space-x-2 text-sm">
                          <CalendarBlank className="h-4 w-4 text-muted-foreground" />
                          <span>Manutenção: {parseDate(asset.nextMaintenanceDate).toLocaleDateString('pt-BR')}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                      <Button variant="outline" size="sm" className="flex-1">
                        <Eye className="h-4 w-4 mr-2" />
                        Detalhes
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1">
                        <Wrench className="h-4 w-4 mr-2" />
                        Manutenção
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="maintenance" className="space-y-6">
          {/* New Maintenance Form */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Registrar Manutenção</CardTitle>
              <CardDescription>
                Documente atividades de manutenção realizadas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Ativo</label>
                  <Select value={newMaintenance.assetId} onValueChange={(value) =>
                    setNewMaintenance(prev => ({ ...prev, assetId: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o ativo" />
                    </SelectTrigger>
                    <SelectContent>
                      {assets.map(asset => (
                        <SelectItem key={asset.id} value={asset.id}>
                          {asset.name} ({asset.assetNumber})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Tipo</label>
                  <Select value={newMaintenance.type} onValueChange={(value: MaintenanceRecord['type']) =>
                    setNewMaintenance(prev => ({ ...prev, type: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preventive">Preventiva</SelectItem>
                      <SelectItem value="corrective">Corretiva</SelectItem>
                      <SelectItem value="inspection">Inspeção</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Custo</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={newMaintenance.cost}
                    onChange={(e) => setNewMaintenance(prev => ({ ...prev, cost: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Descrição</label>
                  <Input
                    placeholder="Descreva a manutenção realizada"
                    value={newMaintenance.description}
                    onChange={(e) => setNewMaintenance(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Realizada por</label>
                  <Input
                    placeholder="Nome do responsável"
                    value={newMaintenance.performedBy}
                    onChange={(e) => setNewMaintenance(prev => ({ ...prev, performedBy: e.target.value }))}
                  />
                </div>
              </div>

              <Button onClick={handleCreateMaintenance} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Registrar Manutenção
              </Button>
            </CardContent>
          </Card>

          {/* Maintenance Records */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Histórico de Manutenções</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {maintenanceRecords.map(record => {
                  const asset = assets.find(a => a.id === record.assetId)
                  return (
                    <div key={record.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <Badge className={getMaintenanceStatusColor(record.status)}>
                            {record.status === 'completed' ? 'Concluída' :
                              record.status === 'scheduled' ? 'Agendada' :
                                record.status === 'in_progress' ? 'Em Andamento' : 'Cancelada'}
                          </Badge>
                          <span className="font-medium">{asset?.name}</span>
                          <span className="text-sm text-muted-foreground">
                            ({record.type === 'preventive' ? 'Preventiva' :
                              record.type === 'corrective' ? 'Corretiva' : 'Inspeção'})
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-1">{record.description}</p>
                        <div className="flex items-center space-x-4 text-sm">
                          <span className="flex items-center space-x-1">
                            <CalendarBlank className="h-4 w-4" />
                            <span>{parseDate(record.date).toLocaleDateString('pt-BR')}</span>
                          </span>
                          <span className="flex items-center space-x-1">
                            <CurrencyDollar className="h-4 w-4" />
                            <span>R$ {record.cost.toLocaleString('pt-BR')}</span>
                          </span>
                          <span className="flex items-center space-x-1">
                            <User className="h-4 w-4" />
                            <span>{record.performedBy}</span>
                          </span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}

                {maintenanceRecords.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Wrench className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhuma manutenção registrada ainda</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="depreciation" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Depreciação de Ativos</CardTitle>
              <CardDescription>
                Lançamentos automáticos de depreciação calculados pelo sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {depreciationEntries.slice(-10).reverse().map(entry => {
                  const asset = assets.find(a => a.id === entry.assetId)
                  return (
                    <div key={entry.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <span className="font-medium">{asset?.name}</span>
                          <Badge variant="outline">{entry.period}</Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Valor Inicial: </span>
                            <span className="font-medium">R$ {entry.openingValue.toLocaleString('pt-BR')}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Depreciação: </span>
                            <span className="font-medium text-red-600">R$ {entry.depreciationAmount.toLocaleString('pt-BR')}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Valor Final: </span>
                            <span className="font-medium">R$ {entry.closingValue.toLocaleString('pt-BR')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {depreciationEntries.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendDown className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhuma depreciação calculada ainda</p>
                    <Button onClick={runDepreciation} className="mt-4">
                      <ChartLineUp className="h-4 w-4 mr-2" />
                      Executar Cálculo de Depreciação
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <Package className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Registro de Ativos</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Lista completa com valores atuais
                </p>
                <Button className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <TrendDown className="h-12 w-12 text-red-600 mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Depreciação Acumulada</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Relatório de depreciação por período
                </p>
                <Button className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <Wrench className="h-12 w-12 text-yellow-600 mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Manutenções</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Histórico e custos de manutenção
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
