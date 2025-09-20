import { useState } from 'react'
import { useKV } from '@/lib/spark-mock'
import { parseDate, toISODateString } from '@/lib/date-utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Plus,
  Code,
  Eye,
  Copy,
  Gear,
  ChartBar,
  Users,
  Globe,
  PencilSimple,
  Trash,
  ArrowSquareOut,
  Download,
  FileText,
  Palette,
  Layout,
  Share
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface WebForm {
  id: string
  name: string
  title: string
  description: string
  slug: string
  isActive: boolean
  backgroundColor: string
  textColor: string
  submitButtonColor: string
  submitButtonText: string
  successMessage: string
  redirectUrl?: string
  customCss?: string
  fields: FormField[]
  submissions: FormSubmission[]
  analytics: {
    views: number
    submissions: number
    conversionRate: number
    lastSubmission?: string
  }
  seoGear: {
    metaTitle?: string
    metaDescription?: string
    metaKeywords?: string
  }
  integrations: {
    autoEmail: boolean
    notificationEmails: string[]
    webhookUrl?: string
    leadSource: string
  }
  createdAt: string
  updatedAt: string
}

interface FormField {
  id: string
  name: string
  label: string
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number' | 'url'
  placeholder?: string
  required: boolean
  options?: string[]
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
  }
  order: number
}

interface FormSubmission {
  id: string
  formId: string
  data: Record<string, any>
  ipAddress: string
  userAgent: string
  referrer?: string
  utm: {
    source?: string
    medium?: string
    campaign?: string
    term?: string
    content?: string
  }
  leadId?: string
  submittedAt: string
}

const defaultFormField: Omit<FormField, 'id'> = {
  name: '',
  label: '',
  type: 'text',
  placeholder: '',
  required: false,
  order: 0
}

const fieldTypes = [
  { value: 'text', label: 'Texto' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'textarea', label: 'Área de Texto' },
  { value: 'select', label: 'Lista Suspensa' },
  { value: 'radio', label: 'Opção Única' },
  { value: 'checkbox', label: 'Caixa de Seleção' },
  { value: 'number', label: 'Número' },
  { value: 'url', label: 'URL' }
]

export function WebFormsManager() {
  const [forms, setForms] = useKV<WebForm[]>('krayin-web-forms', [])
  const [selectedForm, setSelectedForm] = useState<WebForm | null>(null)
  const [editingForm, setEditingForm] = useState<Partial<WebForm> | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  // Calculate total metrics
  const totalViews = forms.reduce((sum, form) => sum + form.analytics.views, 0)
  const totalSubmissions = forms.reduce((sum, form) => sum + form.analytics.submissions, 0)
  const avgConversionRate = forms.length > 0
    ? forms.reduce((sum, form) => sum + form.analytics.conversionRate, 0) / forms.length
    : 0

  const createForm = (formData: Omit<WebForm, 'id' | 'createdAt' | 'updatedAt' | 'submissions' | 'analytics'>) => {
    const newForm: WebForm = {
      ...formData,
      id: `form-${Date.now()}`,
      submissions: [],
      analytics: {
        views: 0,
        submissions: 0,
        conversionRate: 0
      },
      createdAt: toISODateString(new Date()),
      updatedAt: toISODateString(new Date())
    }
    setForms(currentForms => [...currentForms, newForm])
    toast.success('Formulário criado com sucesso!')
    setIsCreateDialogOpen(false)
  }

  const updateForm = (formId: string, updates: Partial<WebForm>) => {
    setForms(currentForms =>
      currentForms.map(form =>
        form.id === formId
          ? { ...form, ...updates, updatedAt: toISODateString(new Date()) }
          : form
      )
    )
    toast.success('Formulário atualizado com sucesso!')
    setIsEditDialogOpen(false)
    setEditingForm(null)
  }

  const deleteForm = (formId: string) => {
    setForms(currentForms => currentForms.filter(form => form.id !== formId))
    toast.success('Formulário removido com sucesso!')
  }

  const generateEmbedCode = (form: WebForm) => {
    const embedUrl = `${window.location.origin}/form/${form.slug}`
    return `<iframe src="${embedUrl}" width="100%" height="600" frameborder="0"></iframe>`
  }

  const copyEmbedCode = (form: WebForm) => {
    const code = generateEmbedCode(form)
    navigator.clipboard.writeText(code)
    toast.success('Código copiado para a área de transferência!')
  }

  const duplicateForm = (form: WebForm) => {
    const duplicatedForm: WebForm = {
      ...form,
      id: `form-${Date.now()}`,
      name: `${form.name} (Cópia)`,
      slug: `${form.slug}-copy-${Date.now()}`,
      submissions: [],
      analytics: {
        views: 0,
        submissions: 0,
        conversionRate: 0
      },
      createdAt: toISODateString(new Date()),
      updatedAt: toISODateString(new Date())
    }
    setForms(currentForms => [...currentForms, duplicatedForm])
    toast.success('Formulário duplicado com sucesso!')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Web Forms</h2>
          <p className="text-muted-foreground">
            Capture leads através de formulários incorporáveis estilo Krayin
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Formulário
        </Button>
      </div>

      {/* Analytics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total Forms</p>
                <p className="text-2xl font-bold">{forms.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Eye className="h-4 w-4 text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total Views</p>
                <p className="text-2xl font-bold">{totalViews.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Submissions</p>
                <p className="text-2xl font-bold">{totalSubmissions.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <ChartBar className="h-4 w-4 text-orange-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Avg. Conversion</p>
                <p className="text-2xl font-bold">{avgConversionRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Forms Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {forms.map((form) => (
          <Card key={form.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg">{form.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {form.description}
                  </CardDescription>
                </div>
                <div className="flex items-center space-x-1">
                  <Badge variant={form.isActive ? "default" : "secondary"}>
                    {form.isActive ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-sm text-muted-foreground">Views</p>
                  <p className="font-bold">{form.analytics.views}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Submissions</p>
                  <p className="font-bold">{form.analytics.submissions}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Taxa</p>
                  <p className="font-bold">{form.analytics.conversionRate.toFixed(1)}%</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Campos: {form.fields.length}</span>
                  <span className="text-muted-foreground">
                    Atualizado {parseDate(form.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setSelectedForm(form)
                    setActiveTab('preview')
                  }}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyEmbedCode(form)}
                >
                  <Code className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingForm(form)
                    setIsEditDialogOpen(true)
                  }}
                >
                  <PencilSimple className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {forms.length === 0 && (
        <Card className="text-center py-12">
          <CardContent>
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum formulário criado</h3>
            <p className="text-muted-foreground mb-4">
              Crie seu primeiro formulário web para capturar leads
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Formulário
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Form Detail Modal */}
      {selectedForm && (
        <Dialog open={!!selectedForm} onOpenChange={() => setSelectedForm(null)}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedForm.name}</DialogTitle>
              <DialogDescription>
                Detalhes e configurações do formulário
              </DialogDescription>
            </DialogHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="submissions">Submissions</TabsTrigger>
                <TabsTrigger value="embed">Embed Code</TabsTrigger>
                <TabsTrigger value="settings">Gear</TabsTrigger>
              </TabsList>

              <TabsContent value="preview" className="space-y-4">
                <div className="border rounded-lg p-6" style={{
                  backgroundColor: selectedForm.backgroundColor,
                  color: selectedForm.textColor
                }}>
                  <h3 className="text-xl font-bold mb-2">{selectedForm.title}</h3>
                  <p className="mb-6">{selectedForm.description}</p>

                  <div className="space-y-4">
                    {selectedForm.fields
                      .sort((a, b) => a.order - b.order)
                      .map((field) => (
                        <div key={field.id}>
                          <Label className="text-sm font-medium">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                          </Label>
                          {field.type === 'textarea' ? (
                            <Textarea
                              placeholder={field.placeholder}
                              className="mt-1"
                              disabled
                            />
                          ) : field.type === 'select' ? (
                            <Select disabled>
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder={field.placeholder} />
                              </SelectTrigger>
                            </Select>
                          ) : (
                            <Input
                              type={field.type}
                              placeholder={field.placeholder}
                              className="mt-1"
                              disabled
                            />
                          )}
                        </div>
                      ))}

                    <Button
                      className="w-full mt-6"
                      style={{
                        backgroundColor: selectedForm.submitButtonColor,
                        color: '#ffffff'
                      }}
                      disabled
                    >
                      {selectedForm.submitButtonText}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="analytics" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-blue-600">
                          {selectedForm.analytics.views}
                        </p>
                        <p className="text-sm text-muted-foreground">Views</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">
                          {selectedForm.analytics.submissions}
                        </p>
                        <p className="text-sm text-muted-foreground">Submissions</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-orange-600">
                          {selectedForm.analytics.conversionRate.toFixed(1)}%
                        </p>
                        <p className="text-sm text-muted-foreground">Conversion Rate</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="submissions" className="space-y-4">
                <div className="space-y-4">
                  {selectedForm.submissions.length > 0 ? (
                    selectedForm.submissions.map((submission) => (
                      <Card key={submission.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-medium">
                              Submission #{submission.id.slice(-8)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {parseDate(submission.submittedAt).toLocaleString()}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {Object.entries(submission.data).map(([key, value]) => (
                              <div key={key} className="text-sm">
                                <span className="font-medium">{key}:</span> {value}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">Nenhuma submissão ainda</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="embed" className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Código de Incorporação</Label>
                  <div className="mt-2 relative">
                    <Textarea
                      value={generateEmbedCode(selectedForm)}
                      readOnly
                      className="font-mono text-sm"
                      rows={3}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => copyEmbedCode(selectedForm)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">URL Direto</Label>
                  <div className="mt-2 flex items-center space-x-2">
                    <Input
                      value={`${window.location.origin}/form/${selectedForm.slug}`}
                      readOnly
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm">
                      <ArrowSquareOut className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Configurações Gerais</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Formulário Ativo</span>
                        <Switch checked={selectedForm.isActive} disabled />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Auto-resposta por E-mail</span>
                        <Switch checked={selectedForm.integrations.autoEmail} disabled />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-2">Integrações</h4>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="font-medium">Origem do Lead:</span> {selectedForm.integrations.leadSource}
                      </div>
                      <div>
                        <span className="font-medium">E-mails de Notificação:</span> {selectedForm.integrations.notificationEmails.join(', ') || 'Nenhum'}
                      </div>
                      {selectedForm.integrations.webhookUrl && (
                        <div>
                          <span className="font-medium">Webhook URL:</span> {selectedForm.integrations.webhookUrl}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}

      {/* Create/Edit Form Dialogs would go here */}
    </div>
  )
}
