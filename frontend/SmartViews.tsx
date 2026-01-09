import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { TableView } from '@/TableView'
import { KanbanBoard } from '@/KanbanBoard'
import {
  SquaresFour,
  List,
  CalendarDots,
  Database,
  Funnel,
  SortAscending,
  Plus,
  Gear
} from "@phosphor-icons/react"

interface ViewConfig {
  id: string
  name: string
  type: 'table' | 'kanban' | 'calendar' | 'list'
  objectId: string
  filters: any[]
  sorting: any[]
  groupBy?: string
  visibleFields: string[]
  isDefault: boolean
  isPublic: boolean
}

interface SmartViewsProps {
  objectId: string
  objectName: string
  data: any[]
  columns: any[]
  onDataChange?: (data: any[]) => void
}

export function SmartViews({
  objectId,
  objectName,
  data,
  columns,
  onDataChange
}: SmartViewsProps) {
  const [views, setViews] = useKV<ViewConfig[]>(`views-${objectId}`, [
    {
      id: 'default-table',
      name: 'Tabela',
      type: 'table',
      objectId,
      filters: [],
      sorting: [],
      visibleFields: columns.map(col => col.id),
      isDefault: true,
      isPublic: false
    },
    {
      id: 'default-kanban',
      name: 'Kanban',
      type: 'kanban',
      objectId,
      filters: [],
      sorting: [],
      visibleFields: columns.map(col => col.id),
      isDefault: false,
      isPublic: false
    },
    {
      id: 'default-calendar',
      name: 'Calendário',
      type: 'calendar',
      objectId,
      filters: [],
      sorting: [],
      visibleFields: columns.map(col => col.id),
      isDefault: false,
      isPublic: false
    }
  ])

  const [activeView, setActiveView] = useState<string>(
    views.find(v => v.isDefault)?.id || views[0]?.id || 'default-table'
  )

  const currentView = views.find(v => v.id === activeView)

  const handleCreateView = () => {
    const newView: ViewConfig = {
      id: `view-${Date.now()}`,
      name: `Nova View ${views.length + 1}`,
      type: 'table',
      objectId,
      filters: [],
      sorting: [],
      visibleFields: columns.map(col => col.id),
      isDefault: false,
      isPublic: false
    }

    setViews(prev => [...prev, newView])
    setActiveView(newView.id)
  }

  const handleRowClick = (row: any) => {
    console.log('Row clicked:', row)
    // Here you would open a detail modal or navigate to detail page
  }

  const handleRowSelect = (selectedRows: any[]) => {
    console.log('Rows selected:', selectedRows)
    // Handle bulk actions
  }

  const getViewIcon = (type: ViewConfig['type']) => {
    switch (type) {
      case 'table':
      case 'list':
        return <List className="h-4 w-4" />
      case 'kanban':
        return <SquaresFour className="h-4 w-4" />
      case 'calendar':
        return <CalendarDots className="h-4 w-4" />
      default:
        return <Database className="h-4 w-4" />
    }
  }

  const actions = {
    create: () => {
      console.log('Create new record')
      // Handle creating new record
    },
    export: () => {
      console.log('Export data')
      // Handle data export
    },
    import: () => {
      console.log('Import data')
      // Handle data import
    },
    delete: (rows: any[]) => {
      console.log('Delete rows:', rows)
      // Handle bulk delete
      if (onDataChange) {
        const updatedData = data.filter(item => !rows.some(row => row.id === item.id))
        onDataChange(updatedData)
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h1 className="text-3xl font-bold">{objectName}</h1>
          <Badge variant="secondary">{data.length} registros</Badge>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={handleCreateView}>
            <Plus className="h-4 w-4 mr-2" />
            Nova View
          </Button>
          <Button variant="outline" size="sm">
            <Gear className="h-4 w-4 mr-2" />
            Configurar
          </Button>
        </div>
      </div>

      {/* View Selector */}
      <Tabs value={activeView} onValueChange={setActiveView} className="w-full">
        <TabsList className="h-10">
          {views.map(view => (
            <TabsTrigger
              key={view.id}
              value={view.id}
              className="flex items-center space-x-2"
            >
              {getViewIcon(view.type)}
              <span>{view.name}</span>
              {view.isDefault && (
                <Badge variant="outline" className="text-xs">
                  Padrão
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* View Content */}
        {views.map(view => (
          <TabsContent key={view.id} value={view.id} className="mt-6">
            {view.type === 'table' && (
              <TableView
                data={data}
                columns={columns}
                title={`${objectName} - ${view.name}`}
                description={`Visualização em tabela dos dados de ${objectName.toLowerCase()}`}
                onRowClick={handleRowClick}
                onRowSelect={handleRowSelect}
                actions={actions}
              />
            )}

            {view.type === 'kanban' && (
              <KanbanBoard
                type="custom"
                objectId={objectId}
                title={`${objectName} - ${view.name}`}
                description={`Visualização Kanban dos dados de ${objectName.toLowerCase()}`}
              />
            )}

            {view.type === 'calendar' && (
              <CalendarView
                data={data}
                title={`${objectName} - ${view.name}`}
                description={`Visualização em calendário dos dados de ${objectName.toLowerCase()}`}
                onEventClick={handleRowClick}
              />
            )}

            {view.type === 'list' && (
              <ListView
                data={data}
                columns={columns}
                title={`${objectName} - ${view.name}`}
                description={`Visualização em lista dos dados de ${objectName.toLowerCase()}`}
                onItemClick={handleRowClick}
                actions={actions}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* View Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-lg border">
          <div className="flex items-center space-x-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total</span>
          </div>
          <p className="text-2xl font-bold">{data.length}</p>
        </div>

        <div className="bg-card p-4 rounded-lg border">
          <div className="flex items-center space-x-2">
            <Funnel className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filtrado</span>
          </div>
          <p className="text-2xl font-bold">{data.length}</p>
        </div>

        <div className="bg-card p-4 rounded-lg border">
          <div className="flex items-center space-x-2">
            <SortAscending className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Views</span>
          </div>
          <p className="text-2xl font-bold">{views.length}</p>
        </div>

        <div className="bg-card p-4 rounded-lg border">
          <div className="flex items-center space-x-2">
            <SquaresFour className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Colunas</span>
          </div>
          <p className="text-2xl font-bold">{columns.length}</p>
        </div>
      </div>
    </div>
  )
}

// Calendar View Component (simplified)
function CalendarView({
  data,
  title,
  description,
  onEventClick
}: {
  data: any[]
  title: string
  description: string
  onEventClick?: (event: any) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>

      <div className="bg-card p-8 rounded-lg border text-center">
        <CalendarDots className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">Visualização de Calendário</h3>
        <p className="text-muted-foreground mb-4">
          A visualização em calendário está em desenvolvimento.
        </p>
        <p className="text-sm text-muted-foreground">
          {data.length} evento(s) para exibir
        </p>
      </div>
    </div>
  )
}

// List View Component (simplified)
function ListView({
  data,
  columns,
  title,
  description,
  onItemClick,
  actions
}: {
  data: any[]
  columns: any[]
  title: string
  description: string
  onItemClick?: (item: any) => void
  actions: any
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center space-x-2">
          <Button onClick={actions.create}>
            <Plus className="h-4 w-4 mr-2" />
            Novo
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {data.map(item => (
          <div
            key={item.id}
            className="bg-card p-4 rounded-lg border hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => onItemClick?.(item)}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{item.name || item.title || item.id}</h3>
                <p className="text-sm text-muted-foreground">
                  {item.description || item.company || 'Sem descrição'}
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {item.status && (
                  <Badge variant="secondary">{item.status}</Badge>
                )}
                {item.value && (
                  <span className="text-sm font-medium">
                    R$ {Number(item.value).toLocaleString('pt-BR')}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        {data.length === 0 && (
          <div className="text-center py-12">
            <List className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum item encontrado</h3>
            <p className="text-muted-foreground">
              Comece criando seu primeiro registro.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
