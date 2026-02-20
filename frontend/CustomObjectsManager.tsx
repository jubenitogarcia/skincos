import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { graphqlClient, useGraphQLQuery, useGraphQLMutation } from '@/graphql'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Label } from "@/label"
import { Switch } from "@/switch"
import { Separator } from "@/separator"
import { ScrollArea } from "@/scroll-area"
import { SmartViews } from '@/SmartViews'
import {
  Plus,
  PencilSimple,
  Trash,
  DotsThree,
  Gear,
  Eye,
  Users,
  Target,
  House,
  CalendarDots,
  FolderOpen,
  Package,
  Database,
  SquaresFour,
  ListBullets,
  CalendarBlank,
  Funnel,
  Sparkle,
  Lightning
} from "@phosphor-icons/react"
import type {
  CustomObject,
  CustomField,
  ObjectView,
  CustomRecord,
  OBJECT_TEMPLATES
} from '@/customObjects'
import { KanbanBoard } from '@/KanbanBoard'

export function CustomObjectsManager() {
  const [selectedTab, setSelectedTab] = useState('objects')
  const [selectedObject, setSelectedObject] = useState<string | null>(null)
  const [isCreateObjectOpen, setIsCreateObjectOpen] = useState(false)
  const [isCreateFieldOpen, setIsCreateFieldOpen] = useState(false)
  const [isCreateRecordOpen, setIsCreateRecordOpen] = useState(false)
  const [isLoadingObjects, setIsLoadingObjects] = useState(false)
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)

  // GraphQL hooks for data fetching
  const objectsQuery = useGraphQLQuery(`
    query GetObjects {
      objects {
        id
        name
        label
        labelSingular
        description
        icon
        color
        fields {
          id
          name
          label
          type
          required
          options
          position
          isSystem
        }
        isSystem
        permissions {
          create
          read
          update
          delete
        }
        views {
          id
          name
          type
          isDefault
          visibleFields
        }
        recordCount
        createdAt
        updatedAt
      }
    }
  `)

  const createObjectMutation = useGraphQLMutation(`
    mutation CreateObject($input: CreateObjectInput!) {
      createObject(input: $input) {
        id
        name
        label
        labelSingular
        description
        icon
        color
        isSystem
        recordCount
        createdAt
      }
    }
  `)

  const createRecordMutation = useGraphQLMutation(`
    mutation CreateRecord($objectId: ID!, $input: CreateRecordInput!) {
      createRecord(objectId: $objectId, input: $input) {
        id
        objectId
        data
        createdAt
        updatedAt
        createdBy
      }
    }
  `)

  // Local state for UI performance (with GraphQL sync)
  const [customObjects, setCustomObjects] = useKV<CustomObject[]>('custom-objects', [
    // Sample Property object
    {
      id: 'property-001',
      name: 'property',
      label: 'Propriedades',
      labelSingular: 'Propriedade',
      description: 'Gestão de propriedades imobiliárias',
      icon: 'House',
      color: 'emerald',
      fields: [
        {
          id: 'f1',
          name: 'address',
          label: 'Endereço',
          type: 'textarea',
          required: true,
          position: 0,
          isSystem: false,
          createdAt: '2024-12-20T10:00:00Z',
          updatedAt: '2024-12-20T10:00:00Z'
        },
        {
          id: 'f2',
          name: 'price',
          label: 'Preço',
          type: 'currency',
          required: true,
          position: 1,
          isSystem: false,
          createdAt: '2024-12-20T10:00:00Z',
          updatedAt: '2024-12-20T10:00:00Z'
        },
        {
          id: 'f3',
          name: 'bedrooms',
          label: 'Quartos',
          type: 'number',
          required: false,
          position: 2,
          isSystem: false,
          createdAt: '2024-12-20T10:00:00Z',
          updatedAt: '2024-12-20T10:00:00Z'
        },
        {
          id: 'f4',
          name: 'status',
          label: 'Status',
          type: 'select',
          required: true,
          options: ['Disponível', 'Reservado', 'Vendido', 'Indisponível'],
          position: 3,
          isSystem: false,
          createdAt: '2024-12-20T10:00:00Z',
          updatedAt: '2024-12-20T10:00:00Z'
        }
      ],
      isSystem: false,
      permissions: { create: true, read: true, update: true, delete: true },
      views: [
        {
          id: 'v1',
          name: 'Todas as Propriedades',
          type: 'table',
          objectId: 'property-001',
          filters: [],
          sorting: [{ fieldId: 'f1', direction: 'asc', position: 0 }],
          visibleFields: ['f1', 'f2', 'f3', 'f4'],
          isDefault: true,
          isPublic: true,
          createdBy: 'admin',
          createdAt: '2024-12-20T10:00:00Z'
        },
        {
          id: 'v2',
          name: 'Pipeline de Vendas',
          type: 'kanban',
          objectId: 'property-001',
          filters: [],
          sorting: [],
          groupBy: 'f4', // Status field
          visibleFields: ['f1', 'f2', 'f3'],
          isDefault: false,
          isPublic: true,
          createdBy: 'admin',
          createdAt: '2024-12-20T10:00:00Z'
        }
      ],
      createdAt: '2024-12-20T10:00:00Z',
      updatedAt: '2024-12-20T10:00:00Z'
    }
  ])

  // Custom records storage with GraphQL integration
  const [customRecords, setCustomRecords] = useKV<CustomRecord[]>('custom-records', [
    {
      id: 'r1',
      objectId: 'property-001',
      data: {
        f1: 'Rua das Flores, 123 - Jardins, São Paulo/SP',
        f2: 750000,
        f3: 3,
        f4: 'Disponível'
      },
      createdAt: '2024-12-20T11:00:00Z',
      updatedAt: '2024-12-20T11:00:00Z',
      createdBy: 'admin',
      updatedBy: 'admin'
    },
    {
      id: 'r2',
      objectId: 'property-001',
      data: {
        f1: 'Av. Paulista, 1000 - Bela Vista, São Paulo/SP',
        f2: 1200000,
        f3: 4,
        f4: 'Reservado'
      },
      createdAt: '2024-12-20T12:00:00Z',
      updatedAt: '2024-12-20T12:00:00Z',
      createdBy: 'admin',
      updatedBy: 'admin'
    },
    {
      id: 'r3',
      objectId: 'property-001',
      data: {
        f1: 'Rua Oscar Freire, 500 - Jardins, São Paulo/SP',
        f2: 950000,
        f3: 2,
        f4: 'Vendido'
      },
      createdAt: '2024-12-20T13:00:00Z',
      updatedAt: '2024-12-20T13:00:00Z',
      createdBy: 'admin',
      updatedBy: 'admin'
    }
  ])

  // Load objects from GraphQL on mount
  useEffect(() => {
    const loadObjects = async () => {
      try {
        setIsLoadingObjects(true)
        const data = await objectsQuery.execute()
        if (data && data.length > 0) {
          setCustomObjects(data)
        }
      } catch (error) {
        console.error('Failed to load objects:', error)
      } finally {
        setIsLoadingObjects(false)
      }
    }

    loadObjects()
  }, [])

  // Load records for selected object
  useEffect(() => {
    const loadRecords = async () => {
      if (!selectedObject) return

      try {
        setIsLoadingRecords(true)
        const data = await graphqlClient.query(`
          query GetObjectRecords($objectId: ID!) {
            objectRecords(objectId: $objectId, limit: 100) {
              edges {
                node {
                  id
                  objectId
                  data
                  createdAt
                  updatedAt
                  createdBy
                  updatedBy
                }
              }
              totalCount
            }
          }
        `, { objectId: selectedObject })

        if (data?.objectRecords?.edges) {
          const records = data.objectRecords.edges.map((edge: any) => edge.node)
          setCustomRecords(records)
        }
      } catch (error) {
        console.error('Failed to load records:', error)
      } finally {
        setIsLoadingRecords(false)
      }
    }

    loadRecords()
  }, [selectedObject])

  const handleCreateObject = async (objectData: any) => {
    try {
      const result = await createObjectMutation.execute({
        input: {
          name: objectData.name,
          label: objectData.label,
          labelSingular: objectData.labelSingular || objectData.label,
          description: objectData.description,
          icon: objectData.icon,
          color: objectData.color,
          fields: objectData.fields || []
        }
      })

      if (result) {
        // Refresh objects list
        const updatedObjects = await objectsQuery.execute()
        setCustomObjects(updatedObjects)
        setIsCreateObjectOpen(false)
      }
    } catch (error) {
      console.error('Failed to create object:', error)
    }
  }

  const handleCreateRecord = async (recordData: any) => {
    if (!selectedObject) return

    try {
      const result = await createRecordMutation.execute({
        objectId: selectedObject,
        input: { data: recordData }
      })

      if (result) {
        // Refresh records list
        const updatedRecords = [...customRecords, result]
        setCustomRecords(updatedRecords)
        setIsCreateRecordOpen(false)
      }
    } catch (error) {
      console.error('Failed to create record:', error)
    }
  }

  const generateAITemplate = async (templateType: string) => {
    const presets: Record<string, any> = {
      property: {
        name: 'property',
        label: 'Propriedades',
        labelSingular: 'Propriedade',
        description: 'Gestão de propriedades e imóveis',
        icon: 'House',
        color: 'emerald',
        fields: [
          { name: 'address', label: 'Endereço', type: 'TEXT', required: true },
          { name: 'price', label: 'Preço', type: 'CURRENCY', required: true },
          { name: 'bedrooms', label: 'Quartos', type: 'NUMBER', required: false },
          { name: 'status', label: 'Status', type: 'SELECT', required: true, options: ['Disponível', 'Reservado', 'Vendido'] }
        ]
      },
      event: {
        name: 'event',
        label: 'Eventos',
        labelSingular: 'Evento',
        description: 'Eventos e conferências',
        icon: 'CalendarDots',
        color: 'violet',
        fields: [
          { name: 'title', label: 'Título', type: 'TEXT', required: true },
          { name: 'date', label: 'Data', type: 'DATE', required: true },
          { name: 'location', label: 'Local', type: 'TEXT', required: false }
        ]
      },
      project: {
        name: 'project',
        label: 'Projetos',
        labelSingular: 'Projeto',
        description: 'Gestão de projetos',
        icon: 'FolderOpen',
        color: 'cyan',
        fields: [
          { name: 'name', label: 'Nome', type: 'TEXT', required: true },
          { name: 'owner', label: 'Responsável', type: 'TEXT', required: true },
          { name: 'status', label: 'Status', type: 'SELECT', required: true, options: ['Ativo', 'Concluído', 'Pausado'] }
        ]
      },
      product: {
        name: 'product',
        label: 'Produtos',
        labelSingular: 'Produto',
        description: 'Catálogo de produtos',
        icon: 'Package',
        color: 'amber',
        fields: [
          { name: 'sku', label: 'SKU', type: 'TEXT', required: true },
          { name: 'price', label: 'Preço', type: 'CURRENCY', required: true },
          { name: 'stock', label: 'Estoque', type: 'NUMBER', required: false }
        ]
      }
    }

    const template = presets[templateType] || presets.property
    await handleCreateObject(template)
  }

  const getIcon = (iconName: string) => {
    const icons: Record<string, React.ComponentType<{ className?: string }>> = {
      House,
      CalendarDots,
      FolderOpen,
      Package,
      Users,
      Target,
      Database
    }
    return icons[iconName] || Database
  }

  const selectedObjectData = selectedObject
    ? customObjects.find(obj => obj.id === selectedObject)
    : null

  const selectedObjectRecords = selectedObject
    ? customRecords.filter(record => record.objectId === selectedObject)
    : []

  const renderFieldValue = (field: CustomField, value: any) => {
    if (!value && value !== 0 && value !== false) return '-'

    switch (field.type) {
      case 'currency':
        return `R$ ${value.toLocaleString('pt-BR')}`
      case 'boolean':
        return value ? 'Sim' : 'Não'
      case 'date':
        return new Date(value).toLocaleDateString('pt-BR')
      case 'select':
      case 'multiselect':
        return Array.isArray(value) ? value.join(', ') : value
      default:
        return value.toString()
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Database className="h-6 w-6" />
            <span>Objetos Customizados</span>
          </h2>
          <p className="text-muted-foreground">
            Sistema flexível de dados inspirado no Twenty CRM - adapte o CRM para qualquer negócio
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Dialog open={isCreateObjectOpen} onOpenChange={setIsCreateObjectOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo Objeto
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Objeto Customizado</DialogTitle>
                <DialogDescription>
                  Defina uma nova entidade de dados para seu CRM
                </DialogDescription>
              </DialogHeader>
              <CreateObjectForm onSave={(data) => handleCreateObject(data)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="objects">Objetos</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          {selectedObject && <TabsTrigger value="data">Dados</TabsTrigger>}
          {selectedObject && <TabsTrigger value="views">Visualizações</TabsTrigger>}
        </TabsList>

        {/* Objects List */}
        <TabsContent value="objects" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customObjects.map((object) => (
              <Card
                key={object.id}
                className={`cursor-pointer hover:shadow-md transition-shadow ${selectedObject === object.id ? 'ring-2 ring-primary' : ''
                  }`}
                onClick={() => setSelectedObject(object.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className={`p-2 rounded-lg bg-${object.color}-100`}>
                        {(() => {
                          const Icon = getIcon(object.icon)
                          return <Icon className="h-6 w-6" />
                        })()}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{object.label}</CardTitle>
                        <Badge variant="outline" className="text-xs">
                          {object.fields.length} campos
                        </Badge>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm">
                      <DotsThree className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="mb-3">
                    {object.description}
                  </CardDescription>

                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {customRecords.filter(r => r.objectId === object.id).length} registros
                    </span>
                    <span>
                      {object.views.length} visualizações
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates" className="space-y-4">
          <div className="text-center py-8">
            <Sparkle className="h-12 w-12 text-accent mx-auto mb-4 ai-processing" />
            <h3 className="text-lg font-semibold mb-2">Templates Prontos</h3>
            <p className="text-muted-foreground mb-6">
              Crie objetos rapidamente usando nossos templates pré-configurados
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              {[
                { name: 'Propriedades', icon: House, color: 'emerald', description: 'Imóveis e propriedades', type: 'property' },
                { name: 'Eventos', icon: CalendarDots, color: 'violet', description: 'Conferências e reuniões', type: 'event' },
                { name: 'Projetos', icon: FolderOpen, color: 'cyan', description: 'Gestão de projetos', type: 'project' },
                { name: 'Produtos', icon: Package, color: 'amber', description: 'Catálogo de produtos', type: 'product' }
              ].map((template) => (
                <Card key={template.name} className="text-center hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-6">
                    <div className={`p-3 rounded-lg bg-${template.color}-100 inline-block mb-3`}>
                      <template.icon className="h-8 w-8" />
                    </div>
                    <h4 className="font-semibold mb-2">{template.name}</h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      {template.description}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => generateAITemplate(template.type)}
                    >
                      <Lightning className="h-4 w-4 mr-2" />
                      Usar Template
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Data View */}
        {selectedObject && selectedObjectData && (
          <TabsContent value="data" className="space-y-4">
            <SmartViews
              objectId={selectedObject}
              objectName={selectedObjectData.label}
              data={selectedObjectRecords}
              columns={selectedObjectData.fields.map(field => ({
                id: field.id,
                name: field.id,
                label: field.label,
                type: field.type === 'currency' ? 'number' :
                  field.type === 'multiselect' ? 'text' : field.type,
                width: field.type === 'boolean' ? 100 : undefined,
                visible: true,
                sortable: true,
                filterable: true,
                position: field.position
              }))}
              onDataChange={(newData) => {
                setCustomRecords(currentRecords =>
                  currentRecords.filter(r => r.objectId !== selectedObject).concat(newData)
                )
              }}
            />
          </TabsContent>
        )}

        {/* Views */}
        {selectedObject && selectedObjectData && (
          <TabsContent value="views" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                Visualizações: {selectedObjectData.label}
              </h3>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nova Visualização
              </Button>
            </div>

            {/* Kanban View if available */}
            {selectedObjectData.views.find(v => v.type === 'kanban') && (
              <div>
                <h4 className="font-medium mb-4 flex items-center space-x-2">
                  <SquaresFour className="h-5 w-5" />
                  <span>Visualização Kanban</span>
                </h4>
                <KanbanBoard
                  type="custom"
                  objectId={selectedObject}
                  title={`${selectedObjectData.label} - Pipeline`}
                  description="Visualização em Kanban dos seus dados customizados"
                />
              </div>
            )}

            {/* Views List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {selectedObjectData.views.map((view) => (
                <Card key={view.id} className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {view.type === 'table' && <ListBullets className="h-5 w-5" />}
                        {view.type === 'kanban' && <SquaresFour className="h-5 w-5" />}
                        {view.type === 'calendar' && <CalendarBlank className="h-5 w-5" />}
                        <CardTitle className="text-base">{view.name}</CardTitle>
                      </div>
                      <Badge variant="outline" className="text-xs capitalize">
                        {view.type}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div>Campos: {view.visibleFields.length}</div>
                      <div>Filtros: {view.filters.length}</div>
                      {view.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          Padrão
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

// Create Object Form
function CreateObjectForm({ onSave }: { onSave: (data: any) => void }) {
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [labelSingular, setLabelSingular] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('Database')
  const [color, setColor] = useState('blue')

  const handleSubmit = () => {
    if (!name || !label) return

    onSave({
      name: name.toLowerCase().replace(/\s+/g, '_'),
      label,
      labelSingular: labelSingular || label.slice(0, -1), // Remove 's' from plural
      description,
      icon,
      color
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Nome Interno</Label>
          <Input
            value={name}
            onChange={(e) => {
              const value = e.target.value
              setName(value)
              if (!labelSingular) {
                setLabelSingular(value.charAt(0).toUpperCase() + value.slice(1))
              }
            }}
            placeholder="ex: property"
          />
        </div>
        <div>
          <Label>Nome de Exibição (Plural)</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ex: Propriedades"
          />
        </div>
      </div>

      <div>
        <Label>Nome Singular</Label>
        <Input
          value={labelSingular}
          onChange={(e) => setLabelSingular(e.target.value)}
          placeholder="ex: Propriedade"
        />
      </div>

      <div>
        <Label>Descrição</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descreva o propósito deste objeto..."
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Ícone</Label>
          <Select value={icon} onValueChange={setIcon}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="House">🏠 House</SelectItem>
              <SelectItem value="CalendarDots">📅 Calendar</SelectItem>
              <SelectItem value="FolderOpen">📁 Folder</SelectItem>
              <SelectItem value="Package">📦 Package</SelectItem>
              <SelectItem value="Users">👥 Users</SelectItem>
              <SelectItem value="Database">🗄️ Database</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Cor</Label>
          <Select value={color} onValueChange={setColor}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blue">Azul</SelectItem>
              <SelectItem value="emerald">Verde</SelectItem>
              <SelectItem value="violet">Roxo</SelectItem>
              <SelectItem value="amber">Âmbar</SelectItem>
              <SelectItem value="cyan">Ciano</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={() => onSave({})}>Cancelar</Button>
        <Button onClick={handleSubmit} disabled={!name || !label}>
          <Lightning className="h-4 w-4 mr-2" />
          Criar Objeto
        </Button>
      </div>
    </div>
  )
}

// Create Record Form
function CreateRecordForm({ object, onSave }: { object: CustomObject, onSave: (data: any) => void }) {
  const [data, setData] = useState<Record<string, any>>({})

  const updateField = (fieldId: string, value: any) => {
    setData(prev => ({ ...prev, [fieldId]: value }))
  }

  const handleSubmit = () => {
    // Validate required fields
    const missingRequired = object.fields
      .filter(field => field.required && !data[field.id])
      .map(field => field.label)

    if (missingRequired.length > 0) {
      alert(`Campos obrigatórios não preenchidos: ${missingRequired.join(', ')}`)
      return
    }

    onSave(data)
  }

  const renderFieldInput = (field: CustomField) => {
    const value = data[field.id] || ''

    switch (field.type) {
      case 'text':
      case 'email':
      case 'phone':
      case 'url':
        return (
          <Input
            type={field.type}
            value={value}
            onChange={(e) => updateField(field.id, e.target.value)}
            required={field.required}
          />
        )
      case 'textarea':
        return (
          <Textarea
            value={value}
            onChange={(e) => updateField(field.id, e.target.value)}
            required={field.required}
          />
        )
      case 'number':
      case 'currency':
        return (
          <Input
            type="number"
            value={value}
            onChange={(e) => updateField(field.id, parseFloat(e.target.value) || 0)}
            required={field.required}
          />
        )
      case 'date':
        return (
          <Input
            type="date"
            value={value}
            onChange={(e) => updateField(field.id, e.target.value)}
            required={field.required}
          />
        )
      case 'boolean':
        return (
          <Switch
            checked={value}
            onCheckedChange={(checked) => updateField(field.id, checked)}
          />
        )
      case 'select':
        return (
          <Select value={value} onValueChange={(val) => updateField(field.id, val)}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      default:
        return (
          <Input
            value={value}
            onChange={(e) => updateField(field.id, e.target.value)}
            required={field.required}
          />
        )
    }
  }

  return (
    <ScrollArea className="max-h-96">
      <div className="space-y-4 pr-4">
        {object.fields.map((field) => (
          <div key={field.id}>
            <Label>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {renderFieldInput(field)}
          </div>
        ))}

        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" onClick={() => onSave({})}>Cancelar</Button>
          <Button onClick={handleSubmit}>
            <Plus className="h-4 w-4 mr-2" />
            Criar {object.labelSingular}
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}
