import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { CheckCirclebox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Plus,
  Trash,
  PencilSimple,
  Eye,
  Funnel,
  SortAscending,
  SortDescending,
  Table,
  SquaresFour,
  List,
  CalendarDots,
  Share,
  Star,
  DotsThree,
  Users,
  Globe,
  Lock,
  Copy,
  CheckCircle
} from "@phosphor-icons/react"

export interface ViewFunnel {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty' | 'in' | 'not_in'
  value: any
  condition?: 'and' | 'or'
}

export interface ViewSort {
  field: string
  direction: 'asc' | 'desc'
}

export interface ViewColumn {
  field: string
  label: string
  width?: number
  visible: boolean
  sortable: boolean
  filterable: boolean
  format?: 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean' | 'badge' | 'avatar' | 'link'
  position: number
}

export interface CustomView {
  id: string
  name: string
  description?: string
  objectType: string
  type: 'table' | 'kanban' | 'list' | 'calendar' | 'chart'
  isDefault: boolean
  isPublic: boolean
  isFavorite: boolean
  filters: ViewFunnel[]
  sorts: ViewSort[]
  columns: ViewColumn[]
  groupBy?: string
  limit?: number
  metadata?: {
    kanbanGroupField?: string
    calendarDateField?: string
    chartType?: 'bar' | 'line' | 'pie' | 'area'
    chartFields?: string[]
    color?: string
    icon?: string
  }
  permissions: {
    canEdit: boolean
    canDelete: boolean
    canShare: boolean
    sharedWith?: string[]
  }
  createdAt: string
  updatedAt: string
  createdBy: string
  lastUsedAt?: string
  useCount: number
}

interface ViewsManagerProps {
  objectType: string
  objectName: string
  availableFields: Array<{
    name: string
    label: string
    type: string
  }>
  onViewChange?: (view: CustomView) => void
}

export function ViewsManager({ objectType, objectName, availableFields, onViewChange }: ViewsManagerProps) {
  const [views, setViews] = useKV<CustomView[]>(`views-${objectType}`, [])
  const [selectedView, setSelectedView] = useState<CustomView | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingView, setEditingView] = useState<CustomView | null>(null)
  const [copiedViewId, setCopiedViewId] = useState<string | null>(null)

  // Create default view if none exists
  useEffect(() => {
    if (views.length === 0) {
      const defaultView: CustomView = {
        id: 'default',
        name: 'Todas as Registros',
        description: 'Visualização padrão com todos os registros',
        objectType,
        type: 'table',
        isDefault: true,
        isPublic: true,
        isFavorite: false,
        filters: [],
        sorts: [{ field: 'createdAt', direction: 'desc' }],
        columns: availableFields.slice(0, 6).map((field, index) => ({
          field: field.name,
          label: field.label,
          visible: true,
          sortable: true,
          filterable: true,
          format: field.type as any,
          position: index
        })),
        permissions: {
          canEdit: true,
          canDelete: false,
          canShare: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'system',
        useCount: 0
      }
      setViews([defaultView])
      setSelectedView(defaultView)
    } else if (!selectedView) {
      const defaultView = views.find(v => v.isDefault) || views[0]
      setSelectedView(defaultView)
    }
  }, [views.length, selectedView, objectType, availableFields, setViews])

  const handleCreateView = (viewData: Partial<CustomView>) => {
    const newView: CustomView = {
      id: Date.now().toString(),
      name: viewData.name || 'Nova Visualização',
      objectType,
      type: viewData.type || 'table',
      isDefault: false,
      isPublic: viewData.isPublic || false,
      isFavorite: false,
      filters: viewData.filters || [],
      sorts: viewData.sorts || [{ field: 'createdAt', direction: 'desc' }],
      columns: viewData.columns || availableFields.slice(0, 6).map((field, index) => ({
        field: field.name,
        label: field.label,
        visible: true,
        sortable: true,
        filterable: true,
        format: field.type as any,
        position: index
      })),
      permissions: {
        canEdit: true,
        canDelete: true,
        canShare: true
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'current-user',
      useCount: 0,
      ...viewData
    }

    setViews(currentViews => [...currentViews, newView])
    setSelectedView(newView)
    setIsCreateDialogOpen(false)
    onViewChange?.(newView)
  }

  const handleUpdateView = (viewId: string, updates: Partial<CustomView>) => {
    setViews(currentViews =>
      currentViews.map(view =>
        view.id === viewId
          ? { ...view, ...updates, updatedAt: new Date().toISOString() }
          : view
      )
    )

    if (selectedView?.id === viewId) {
      const updatedView = { ...selectedView, ...updates }
      setSelectedView(updatedView)
      onViewChange?.(updatedView)
    }
    setEditingView(null)
  }

  const handleDeleteView = (viewId: string) => {
    setViews(currentViews => currentViews.filter(view => view.id !== viewId))

    if (selectedView?.id === viewId) {
      const remainingViews = views.filter(view => view.id !== viewId)
      const newSelected = remainingViews.find(v => v.isDefault) || remainingViews[0]
      setSelectedView(newSelected)
      onViewChange?.(newSelected)
    }
  }

  const handleSelectView = (view: CustomView) => {
    // Update usage statistics
    handleUpdateView(view.id, {
      lastUsedAt: new Date().toISOString(),
      useCount: view.useCount + 1
    })

    setSelectedView(view)
    onViewChange?.(view)
  }

  const handleDuplicateView = (view: CustomView) => {
    const duplicatedView: CustomView = {
      ...view,
      id: Date.now().toString(),
      name: `${view.name} (Cópia)`,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'current-user',
      useCount: 0
    }

    setViews(currentViews => [...currentViews, duplicatedView])
    setCopiedViewId(duplicatedView.id)
    setTimeout(() => setCopiedViewId(null), 2000)
  }

  const toggleFavorite = (viewId: string) => {
    const view = views.find(v => v.id === viewId)
    if (view) {
      handleUpdateView(viewId, { isFavorite: !view.isFavorite })
    }
  }

  const getViewIcon = (type: CustomView['type']) => {
    switch (type) {
      case 'table': return Table
      case 'kanban': return SquaresFour
      case 'list': return List
      case 'calendar': return CalendarDots
      case 'chart': return Table // Using Table as fallback
      default: return Table
    }
  }

  const operatorLabels = {
    'equals': 'Igual a',
    'not_equals': 'Diferente de',
    'contains': 'Contém',
    'not_contains': 'Não contém',
    'starts_with': 'Começa com',
    'ends_with': 'Termina com',
    'greater_than': 'Maior que',
    'less_than': 'Menor que',
    'is_empty': 'Está vazio',
    'is_not_empty': 'Não está vazio',
    'in': 'Em',
    'not_in': 'Não em'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Views de {objectName}</h2>
          <p className="text-muted-foreground">
            Gerencie visualizações personalizadas para seus dados
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova View
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Criar Nova Visualização</DialogTitle>
              <DialogDescription>
                Configure uma nova forma de visualizar os dados de {objectName}
              </DialogDescription>
            </DialogHeader>
            <ViewForm
              objectType={objectType}
              availableFields={availableFields}
              onSave={handleCreateView}
              onCancel={() => setIsCreateDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Current View Info */}
      {selectedView && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {getViewIcon(selectedView.type)({ className: "h-5 w-5" })}
                <div>
                  <CardTitle className="flex items-center space-x-2">
                    <span>{selectedView.name}</span>
                    {selectedView.isFavorite && (
                      <Star className="h-4 w-4 text-yellow-500" weight="fill" />
                    )}
                    {selectedView.isDefault && (
                      <Badge variant="secondary" className="text-xs">Padrão</Badge>
                    )}
                    {selectedView.isPublic && (
                      <Badge variant="outline" className="text-xs">
                        <Globe className="h-3 w-3 mr-1" />
                        Pública
                      </Badge>
                    )}
                  </CardTitle>
                  {selectedView.description && (
                    <CardDescription>{selectedView.description}</CardDescription>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFavorite(selectedView.id)}
                >
                  <Star
                    className="h-4 w-4"
                    weight={selectedView.isFavorite ? "fill" : "regular"}
                  />
                </Button>

                {selectedView.permissions.canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingView(selectedView)}
                  >
                    <PencilSimple className="h-4 w-4 mr-2" />
                    Editar
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <DotsThree className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleDuplicateView(selectedView)}>
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicar
                    </DropdownMenuItem>
                    {selectedView.permissions.canShare && (
                      <DropdownMenuItem>
                        <Share className="h-4 w-4 mr-2" />
                        Compartilhar
                      </DropdownMenuItem>
                    )}
                    {selectedView.permissions.canDelete && (
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={() => handleDeleteView(selectedView.id)}
                      >
                        <Trash className="h-4 w-4 mr-2" />
                        Excluir
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Funnels */}
              <div>
                <h4 className="font-semibold mb-2 flex items-center space-x-2">
                  <Funnel className="h-4 w-4" />
                  <span>Filtros ({selectedView.filters.length})</span>
                </h4>
                {selectedView.filters.length > 0 ? (
                  <div className="space-y-2">
                    {selectedView.filters.map((filter, index) => (
                      <div key={index} className="text-sm p-2 bg-muted rounded">
                        <code>{filter.field}</code> {operatorLabels[filter.operator]} {filter.value}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum filtro aplicado</p>
                )}
              </div>

              {/* Sorting */}
              <div>
                <h4 className="font-semibold mb-2 flex items-center space-x-2">
                  <SortAscending className="h-4 w-4" />
                  <span>Ordenação ({selectedView.sorts.length})</span>
                </h4>
                {selectedView.sorts.length > 0 ? (
                  <div className="space-y-2">
                    {selectedView.sorts.map((sort, index) => (
                      <div key={index} className="text-sm flex items-center space-x-2">
                        {sort.direction === 'asc' ? (
                          <SortAscending className="h-3 w-3" />
                        ) : (
                          <SortDescending className="h-3 w-3" />
                        )}
                        <code>{sort.field}</code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Ordenação padrão</p>
                )}
              </div>

              {/* Columns */}
              <div>
                <h4 className="font-semibold mb-2 flex items-center space-x-2">
                  <Table className="h-4 w-4" />
                  <span>Colunas ({selectedView.columns.filter(c => c.visible).length})</span>
                </h4>
                <div className="space-y-1">
                  {selectedView.columns
                    .filter(col => col.visible)
                    .sort((a, b) => a.position - b.position)
                    .slice(0, 5)
                    .map((column) => (
                      <div key={column.field} className="text-sm">
                        {column.label}
                      </div>
                    ))}
                  {selectedView.columns.filter(c => c.visible).length > 5 && (
                    <div className="text-sm text-muted-foreground">
                      +{selectedView.columns.filter(c => c.visible).length - 5} mais...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Views List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {views.map((view) => (
          <Card
            key={view.id}
            className={`cursor-pointer transition-colors hover:bg-muted/50 ${selectedView?.id === view.id ? 'ring-2 ring-primary' : ''
              } ${copiedViewId === view.id ? 'ring-2 ring-green-500' : ''}`}
            onClick={() => handleSelectView(view)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center space-x-2">
                  {getViewIcon(view.type)({ className: "h-4 w-4" })}
                  <h4 className="font-medium">{view.name}</h4>
                  {view.isFavorite && (
                    <Star className="h-3 w-3 text-yellow-500" weight="fill" />
                  )}
                </div>

                <div className="flex items-center space-x-1">
                  {view.isDefault && (
                    <Badge variant="secondary" className="text-xs">Padrão</Badge>
                  )}
                  {view.isPublic ? (
                    <Globe className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
              </div>

              {view.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {view.description}
                </p>
              )}

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center space-x-3">
                  <span>{view.filters.length} filtros</span>
                  <span>{view.columns.filter(c => c.visible).length} colunas</span>
                </div>
                {view.useCount > 0 && (
                  <span>Usado {view.useCount}x</span>
                )}
              </div>

              {copiedViewId === view.id && (
                <div className="mt-2 flex items-center space-x-1 text-green-600 text-xs">
                  <CheckCircle className="h-3 w-3" />
                  <span>Duplicado!</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Add New View Card */}
        <Card
          className="cursor-pointer border-2 border-dashed border-muted hover:border-primary transition-colors"
          onClick={() => setIsCreateDialogOpen(true)}
        >
          <CardContent className="p-4 flex flex-col items-center justify-center h-full min-h-[120px]">
            <Plus className="h-8 w-8 text-muted-foreground mb-2" />
            <span className="text-sm font-medium">Nova View</span>
            <span className="text-xs text-muted-foreground">Criar visualização</span>
          </CardContent>
        </Card>
      </div>

      {/* Edit View Dialog */}
      {editingView && (
        <Dialog open={!!editingView} onOpenChange={() => setEditingView(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Editar Visualização</DialogTitle>
              <DialogDescription>
                Modifique as configurações da visualização
              </DialogDescription>
            </DialogHeader>
            <ViewForm
              objectType={objectType}
              availableFields={availableFields}
              view={editingView}
              onSave={(updates) => handleUpdateView(editingView.id, updates)}
              onCancel={() => setEditingView(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// View Form Component
function ViewForm({
  objectType,
  availableFields,
  view,
  onSave,
  onCancel
}: {
  objectType: string
  availableFields: Array<{ name: string; label: string; type: string }>
  view?: CustomView
  onSave: (view: Partial<CustomView>) => void
  onCancel: () => void
}) {
  const [formData, setFormData] = useState<Partial<CustomView>>({
    name: view?.name || '',
    description: view?.description || '',
    type: view?.type || 'table',
    isPublic: view?.isPublic || false,
    filters: view?.filters || [],
    sorts: view?.sorts || [],
    columns: view?.columns || availableFields.slice(0, 6).map((field, index) => ({
      field: field.name,
      label: field.label,
      visible: true,
      sortable: true,
      filterable: true,
      format: field.type as any,
      position: index
    }))
  })

  const handleSave = () => {
    onSave(formData)
  }

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Nome da View</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Nome da visualização"
          />
        </div>
        <div>
          <Label htmlFor="type">Tipo de Visualização</Label>
          <Select
            value={formData.type}
            onValueChange={(value: CustomView['type']) =>
              setFormData(prev => ({ ...prev, type: value }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="table">Tabela</SelectItem>
              <SelectItem value="kanban">Kanban</SelectItem>
              <SelectItem value="list">Lista</SelectItem>
              <SelectItem value="calendar">Calendário</SelectItem>
              <SelectItem value="chart">Gráfico</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="description">Descrição (Opcional)</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Descrição da visualização"
          rows={2}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label>Visualização Pública</Label>
          <p className="text-sm text-muted-foreground">
            Permitir que outros usuários vejam esta visualização
          </p>
        </div>
        <Switch
          checked={formData.isPublic}
          onCheckedChange={(checked) =>
            setFormData(prev => ({ ...prev, isPublic: checked }))
          }
        />
      </div>

      <Separator />

      {/* Columns Configuration */}
      <div>
        <h4 className="font-semibold mb-3">Configuração de Colunas</h4>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {availableFields.map((field) => {
            const column = formData.columns?.find(c => c.field === field.name)
            const isVisible = column?.visible || false

            return (
              <div key={field.name} className="flex items-center space-x-3 p-2 border rounded">
                <CheckCirclebox
                  checked={isVisible}
                  onCheckedChange={(checked) => {
                    setFormData(prev => ({
                      ...prev,
                      columns: prev.columns?.map(col =>
                        col.field === field.name
                          ? { ...col, visible: !!checked }
                          : col
                      ) || []
                    }))
                  }}
                />
                <div className="flex-1">
                  <span className="text-sm font-medium">{field.label}</span>
                  <div className="text-xs text-muted-foreground">
                    {field.name} • {field.type}
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">
                  {field.type}
                </Badge>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          disabled={!formData.name?.trim()}
        >
          {view ? 'Salvar Alterações' : 'Criar View'}
        </Button>
      </div>
    </div>
  )
}
