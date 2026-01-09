import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Label } from "@/label"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { Switch } from "@/switch"
import { Separator } from "@/separator"
import {
  Plus,
  Trash,
  PencilSimple,
  DotsSixVertical,
  TextT,
  Hash,
  CalendarBlank,
  ToggleLeft,
  Star,
  FileText,
  Users,
  Link,
  Image,
  MapPin,
  Phone,
  Envelope,
  CurrencyDollar,
  Percent,
  ListBullets,
  RadioButton,
  Checks,
  Clock,
  Tag
} from "@phosphor-icons/react"

export interface CustomField {
  id: string
  name: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'currency' | 'percent' | 'date' | 'datetime' | 'boolean' | 'select' | 'multiselect' | 'email' | 'phone' | 'url' | 'file' | 'image' | 'location' | 'rating' | 'user' | 'relation'
  objectType: string
  description?: string
  placeholder?: string
  required: boolean
  defaultValue?: any
  options?: string[] // For select/multiselect
  validation?: {
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
    pattern?: string
    message?: string
  }
  displayOrder: number
  isActive: boolean
  isSystem: boolean
  metadata?: {
    width?: 'full' | 'half' | 'third'
    group?: string
    helpText?: string
    icon?: string
  }
  createdAt: string
  updatedAt: string
  createdBy: string
}

interface FieldsManagerProps {
  objectType: string
  objectName: string
}

export function FieldsManager({ objectType, objectName }: FieldsManagerProps) {
  const [fields, setFields] = useKV<CustomField[]>(`custom-fields-${objectType}`, [])
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<CustomField | null>(null)
  const [previewMode, setPreviewMode] = useState(false)

  const fieldTypeIcons = {
    text: TextT,
    textarea: FileText,
    number: Hash,
    currency: CurrencyDollar,
    percent: Percent,
    date: CalendarBlank,
    datetime: Clock,
    boolean: ToggleLeft,
    select: ListBullets,
    multiselect: Checks,
    email: Envelope,
    phone: Phone,
    url: Link,
    file: FileText,
    image: Image,
    location: MapPin,
    rating: Star,
    user: Users,
    relation: Link
  }

  const fieldTypes = [
    { value: 'text', label: 'Texto', description: 'Campo de texto simples' },
    { value: 'textarea', label: 'Texto Longo', description: 'Campo de texto com múltiplas linhas' },
    { value: 'number', label: 'Número', description: 'Campo numérico' },
    { value: 'currency', label: 'Moeda', description: 'Campo monetário formatado' },
    { value: 'percent', label: 'Porcentagem', description: 'Campo de porcentagem' },
    { value: 'date', label: 'Data', description: 'Seletor de data' },
    { value: 'datetime', label: 'Data e Hora', description: 'Seletor de data e hora' },
    { value: 'boolean', label: 'Sim/Não', description: 'Campo booleano' },
    { value: 'select', label: 'Seleção Única', description: 'Lista suspensa com uma opção' },
    { value: 'multiselect', label: 'Seleção Múltipla', description: 'Lista com múltiplas opções' },
    { value: 'email', label: 'E-mail', description: 'Campo de e-mail validado' },
    { value: 'phone', label: 'Telefone', description: 'Campo de telefone formatado' },
    { value: 'url', label: 'URL', description: 'Campo de link/URL' },
    { value: 'rating', label: 'Avaliação', description: 'Campo de classificação por estrelas' },
    { value: 'location', label: 'Localização', description: 'Campo de endereço/localização' }
  ]

  const handleCreateField = (fieldData: Partial<CustomField>) => {
    const newField: CustomField = {
      id: Date.now().toString(),
      name: fieldData.name || '',
      label: fieldData.label || '',
      type: fieldData.type || 'text',
      objectType,
      required: fieldData.required || false,
      displayOrder: fields.length,
      isActive: true,
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'current-user',
      ...fieldData
    }

    setFields(currentFields => [...currentFields, newField])
    setIsCreateDialogOpen(false)
  }

  const handleUpdateField = (fieldId: string, updates: Partial<CustomField>) => {
    setFields(currentFields =>
      currentFields.map(field =>
        field.id === fieldId
          ? { ...field, ...updates, updatedAt: new Date().toISOString() }
          : field
      )
    )
    setEditingField(null)
  }

  const handleDeleteField = (fieldId: string) => {
    setFields(currentFields => currentFields.filter(field => field.id !== fieldId))
  }

  const handleReorderFields = (draggedId: string, targetId: string) => {
    const draggedIndex = fields.findIndex(f => f.id === draggedId)
    const targetIndex = fields.findIndex(f => f.id === targetId)

    if (draggedIndex === -1 || targetIndex === -1) return

    const newFields = [...fields]
    const draggedField = newFields.splice(draggedIndex, 1)[0]
    newFields.splice(targetIndex, 0, draggedField)

    // Update display order
    const updatedFields = newFields.map((field, index) => ({
      ...field,
      displayOrder: index
    }))

    setFields(updatedFields)
  }

  const renderFieldIcon = (type: CustomField['type']) => {
    const IconComponent = fieldTypeIcons[type] || TextT
    return <IconComponent className="h-4 w-4" />
  }

  const renderFieldPreview = (field: CustomField) => {
    const commonProps = {
      id: field.id,
      placeholder: field.placeholder,
      disabled: previewMode
    }

    switch (field.type) {
      case 'text':
        return <Input {...commonProps} />
      case 'textarea':
        return <Textarea {...commonProps} rows={3} />
      case 'number':
        return <Input {...commonProps} type="number" />
      case 'currency':
        return (
          <div className="relative">
            <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">R$</span>
            <Input {...commonProps} type="number" className="pl-8" />
          </div>
        )
      case 'percent':
        return (
          <div className="relative">
            <Input {...commonProps} type="number" className="pr-8" />
            <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">%</span>
          </div>
        )
      case 'date':
        return <Input {...commonProps} type="date" />
      case 'datetime':
        return <Input {...commonProps} type="datetime-local" />
      case 'boolean':
        return (
          <div className="flex items-center space-x-2">
            <Switch disabled={previewMode} />
            <Label>{field.label}</Label>
          </div>
        )
      case 'select':
        return (
          <Select disabled={previewMode}>
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      case 'email':
        return <Input {...commonProps} type="email" />
      case 'phone':
        return <Input {...commonProps} type="tel" />
      case 'url':
        return <Input {...commonProps} type="url" />
      case 'rating':
        return (
          <div className="flex space-x-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star key={star} className="h-4 w-4 text-muted-foreground hover:text-yellow-500 cursor-pointer" />
            ))}
          </div>
        )
      default:
        return <Input {...commonProps} />
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Campos Customizados</h2>
          <p className="text-muted-foreground">
            Gerencie campos personalizados para {objectName}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            onClick={() => setPreviewMode(!previewMode)}
          >
            {previewMode ? 'Sair da Visualização' : 'Visualizar'}
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo Campo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Campo Customizado</DialogTitle>
                <DialogDescription>
                  Adicione um novo campo ao objeto {objectName}
                </DialogDescription>
              </DialogHeader>
              <FieldForm
                objectType={objectType}
                onSave={handleCreateField}
                onCancel={() => setIsCreateDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Fields List */}
      {previewMode ? (
        <Card>
          <CardHeader>
            <CardTitle>Visualização do Formulário</CardTitle>
            <CardDescription>
              Como os campos aparecerão no formulário real
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {fields
                .filter(field => field.isActive)
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((field) => (
                  <div
                    key={field.id}
                    className={field.metadata?.width === 'full' ? 'md:col-span-2' : ''}
                  >
                    <Label className="text-sm font-medium">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    {field.description && (
                      <p className="text-xs text-muted-foreground mb-2">{field.description}</p>
                    )}
                    {renderFieldPreview(field)}
                    {field.metadata?.helpText && (
                      <p className="text-xs text-muted-foreground mt-1">{field.metadata.helpText}</p>
                    )}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {fields.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <TextT className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Nenhum campo customizado</h3>
                <p className="text-muted-foreground mb-4">
                  Crie campos personalizados para capturar informações específicas
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Primeiro Campo
                </Button>
              </CardContent>
            </Card>
          ) : (
            fields
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((field) => (
                <Card key={field.id} className={!field.isActive ? 'opacity-50' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="cursor-move">
                          <DotsSixVertical className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex items-center space-x-2">
                          {renderFieldIcon(field.type)}
                          <div>
                            <h4 className="font-medium">{field.label}</h4>
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <Badge variant="outline" className="text-xs">
                                {fieldTypes.find(t => t.value === field.type)?.label}
                              </Badge>
                              <span>•</span>
                              <code className="text-xs bg-muted px-1 rounded">{field.name}</code>
                              {field.required && (
                                <>
                                  <span>•</span>
                                  <Badge variant="secondary" className="text-xs">Obrigatório</Badge>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={field.isActive}
                          onCheckedChange={(checked) =>
                            handleUpdateField(field.id, { isActive: checked })
                          }
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingField(field)}
                        >
                          <PencilSimple className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteField(field.id)}
                          disabled={field.isSystem}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {field.description && (
                      <p className="text-sm text-muted-foreground mt-2 ml-7">
                        {field.description}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))
          )}
        </div>
      )}

      {/* Edit Field Dialog */}
      {editingField && (
        <Dialog open={!!editingField} onOpenChange={() => setEditingField(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Editar Campo</DialogTitle>
              <DialogDescription>
                Modifique as configurações do campo customizado
              </DialogDescription>
            </DialogHeader>
            <FieldForm
              objectType={objectType}
              field={editingField}
              onSave={(updates) => handleUpdateField(editingField.id, updates)}
              onCancel={() => setEditingField(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Field Form Component
function FieldForm({
  objectType,
  field,
  onSave,
  onCancel
}: {
  objectType: string
  field?: CustomField
  onSave: (field: Partial<CustomField>) => void
  onCancel: () => void
}) {
  const [formData, setFormData] = useState<Partial<CustomField>>({
    name: field?.name || '',
    label: field?.label || '',
    type: field?.type || 'text',
    description: field?.description || '',
    placeholder: field?.placeholder || '',
    required: field?.required || false,
    options: field?.options || [],
    metadata: {
      width: field?.metadata?.width || 'half',
      helpText: field?.metadata?.helpText || '',
      ...field?.metadata
    }
  })

  const [newOption, setNewOption] = useState('')

  const fieldTypes = [
    { value: 'text', label: 'Texto', description: 'Campo de texto simples' },
    { value: 'textarea', label: 'Texto Longo', description: 'Campo de texto com múltiplas linhas' },
    { value: 'number', label: 'Número', description: 'Campo numérico' },
    { value: 'currency', label: 'Moeda', description: 'Campo monetário formatado' },
    { value: 'percent', label: 'Porcentagem', description: 'Campo de porcentagem' },
    { value: 'date', label: 'Data', description: 'Seletor de data' },
    { value: 'datetime', label: 'Data e Hora', description: 'Seletor de data e hora' },
    { value: 'boolean', label: 'Sim/Não', description: 'Campo booleano' },
    { value: 'select', label: 'Seleção Única', description: 'Lista suspensa com uma opção' },
    { value: 'multiselect', label: 'Seleção Múltipla', description: 'Lista com múltiplas opções' },
    { value: 'email', label: 'E-mail', description: 'Campo de e-mail validado' },
    { value: 'phone', label: 'Telefone', description: 'Campo de telefone formatado' },
    { value: 'url', label: 'URL', description: 'Campo de link/URL' },
    { value: 'rating', label: 'Avaliação', description: 'Campo de classificação por estrelas' }
  ]

  const generateFieldName = (label: string) => {
    return label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
  }

  const handleLabelChange = (label: string) => {
    setFormData(prev => ({
      ...prev,
      label,
      name: prev.name || generateFieldName(label)
    }))
  }

  const handleAddOption = () => {
    if (newOption.trim()) {
      setFormData(prev => ({
        ...prev,
        options: [...(prev.options || []), newOption.trim()]
      }))
      setNewOption('')
    }
  }

  const handleRemoveOption = (index: number) => {
    setFormData(prev => ({
      ...prev,
      options: prev.options?.filter((_, i) => i !== index) || []
    }))
  }

  const handleSave = () => {
    onSave(formData)
  }

  const showOptionsConfig = formData.type === 'select' || formData.type === 'multiselect'

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="label">Rótulo do Campo</Label>
          <Input
            id="label"
            value={formData.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Nome visível do campo"
          />
        </div>
        <div>
          <Label htmlFor="name">Nome Técnico</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="nome_do_campo"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="type">Tipo do Campo</Label>
        <Select
          value={formData.type}
          onValueChange={(value: CustomField['type']) =>
            setFormData(prev => ({ ...prev, type: value }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fieldTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                <div>
                  <div className="font-medium">{type.label}</div>
                  <div className="text-xs text-muted-foreground">{type.description}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="description">Descrição (Opcional)</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Descrição do campo para ajudar usuários"
          rows={2}
        />
      </div>

      <div>
        <Label htmlFor="placeholder">Placeholder (Opcional)</Label>
        <Input
          id="placeholder"
          value={formData.placeholder}
          onChange={(e) => setFormData(prev => ({ ...prev, placeholder: e.target.value }))}
          placeholder="Texto de exemplo no campo"
        />
      </div>

      {/* Options for select/multiselect */}
      {showOptionsConfig && (
        <div>
          <Label>Opções</Label>
          <div className="space-y-2">
            {formData.options?.map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <Input value={option} readOnly className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRemoveOption(index)}
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center space-x-2">
              <Input
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                placeholder="Nova opção"
                onKeyPress={(e) => e.key === 'Enter' && handleAddOption()}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddOption}
                disabled={!newOption.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <Separator />

      {/* Advanced Options */}
      <div className="space-y-4">
        <h4 className="font-medium">Configurações Avançadas</h4>

        <div className="flex items-center justify-between">
          <div>
            <Label>Campo Obrigatório</Label>
            <p className="text-sm text-muted-foreground">
              Este campo deve ser preenchido
            </p>
          </div>
          <Switch
            checked={formData.required}
            onCheckedChange={(checked) =>
              setFormData(prev => ({ ...prev, required: checked }))
            }
          />
        </div>

        <div>
          <Label htmlFor="width">Largura do Campo</Label>
          <Select
            value={formData.metadata?.width || 'half'}
            onValueChange={(value: 'full' | 'half' | 'third') =>
              setFormData(prev => ({
                ...prev,
                metadata: { ...prev.metadata, width: value }
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="third">1/3 da largura</SelectItem>
              <SelectItem value="half">1/2 da largura</SelectItem>
              <SelectItem value="full">Largura completa</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="helpText">Texto de Ajuda (Opcional)</Label>
          <Input
            id="helpText"
            value={formData.metadata?.helpText || ''}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              metadata: { ...prev.metadata, helpText: e.target.value }
            }))}
            placeholder="Texto explicativo que aparece abaixo do campo"
          />
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          disabled={!formData.label?.trim() || !formData.name?.trim()}
        >
          {field ? 'Salvar Alterações' : 'Criar Campo'}
        </Button>
      </div>
    </div>
  )
}
