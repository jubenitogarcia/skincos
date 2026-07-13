import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Label } from "@/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/table"
import { Separator } from "@/separator"
import { CheckCirclebox } from "@/checkbox"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/alert-dialog"
import {
  Plus, FileText, CurrencyDollar, CalendarBlank, PaperPlaneRight, Download, Eye, PencilSimple, Trash,
  Calculator, Package, Percent, Warning, Copy, Clock, CheckCircle,
  XCircle, PaperPlaneTilt, Envelope, TrendUp, Users, Archive,
  MagnifyingGlass, Funnel, SortAscending, Share, FileArrowDown,
  Timer, Star, ArrowRight
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface QuoteItem {
  id: string
  productId?: string
  name: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  discountType: 'percentage' | 'fixed'
  taxRate: number
  total: number
  category?: string
  sku?: string
}

interface QuoteTemplate {
  id: string
  name: string
  description: string
  items: QuoteItem[]
  terms: string
  validityDays: number
  isDefault: boolean
  category: string
}

interface QuotePulse {
  id: string
  quoteId: string
  type: 'created' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired' | 'followed_up' | 'reminder_sent'
  description: string
  timestamp: string
  userId?: string
  userEmail?: string
  ipAddress?: string
  userAgent?: string
}

interface Quote {
  id: string
  quoteNumber: string
  leadId?: string
  contactName: string
  contactEmail: string
  contactPhone: string
  company: string
  title: string
  description: string
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  validUntil: string
  createdDate: string
  sentDate?: string
  viewedDate?: string
  respondedDate?: string
  items: QuoteItem[]
  subtotal: number
  totalDiscount: number
  taxRate: number
  taxAmount: number
  shippingAmount: number
  totalAmount: number
  terms: string
  notes: string
  tags: string[]
  templateId?: string
  currency: string
  exchangeRate: number
  probability: number
  expectedCloseDate?: string
  assignedTo?: string
  source: string
  activities: QuotePulse[]
  attachments: string[]
  customFields: Record<string, any>
  billingAddress: {
    street: string
    city: string
    state: string
    zipCode: string
    country: string
  }
  shippingAddress: {
    street: string
    city: string
    state: string
    zipCode: string
    country: string
  }
  paymentTerms: '15_days' | '30_days' | '45_days' | '60_days' | 'immediate'
  createdBy: string
  updatedAt: string
}

const defaultQuote: Omit<Quote, 'id' | 'quoteNumber' | 'createdDate' | 'updatedAt'> = {
  leadId: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  company: '',
  title: '',
  description: '',
  status: 'draft',
  priority: 'medium',
  validUntil: '',
  items: [],
  subtotal: 0,
  totalDiscount: 0,
  taxRate: 0,
  taxAmount: 0,
  shippingAmount: 0,
  totalAmount: 0,
  terms: 'Proposta válida conforme data de expiração. Pagamento conforme condições acordadas.',
  notes: '',
  tags: [],
  billingAddress: {
    street: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'Brasil'
  },
  shippingAddress: {
    street: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'Brasil'
  },
  paymentTerms: '30_days',
  currency: 'BRL',
  exchangeRate: 1,
  probability: 0,
  source: 'manual',
  activities: [],
  attachments: [],
  customFields: {},
  createdBy: 'user-1'
}

const quoteStatuses = [
  { value: 'draft', label: 'Rascunho', color: 'bg-gray-100 text-gray-800' },
  { value: 'sent', label: 'Enviada', color: 'bg-blue-100 text-blue-800' },
  { value: 'viewed', label: 'Visualizada', color: 'bg-purple-100 text-purple-800' },
  { value: 'accepted', label: 'Aceita', color: 'bg-green-100 text-green-800' },
  { value: 'rejected', label: 'Rejeitada', color: 'bg-red-100 text-red-800' },
  { value: 'expired', label: 'Expirada', color: 'bg-orange-100 text-orange-800' }
]

const paymentTermsOptions = [
  { value: 'immediate', label: 'À vista' },
  { value: '15_days', label: '15 dias' },
  { value: '30_days', label: '30 dias' },
  { value: '45_days', label: '45 dias' },
  { value: '60_days', label: '60 dias' }
]

export function QuotesManager() {
  const [quotes, setQuotes] = useKV<Quote[]>('krayin-quotes', [])
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null)
  const [editingQuote, setEditingQuote] = useState<Partial<Quote> | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [searchQuery, setMagnifyingGlassQuery] = useState('')
  const [statusFunnel, setStatusFunnel] = useState<string>('all')

  // Calculate metrics
  const totalQuotes = quotes.length
  const sentQuotes = quotes.filter(q => q.status === 'sent').length
  const acceptedQuotes = quotes.filter(q => q.status === 'accepted').length
  const acceptanceRate = sentQuotes > 0 ? (acceptedQuotes / sentQuotes * 100) : 0
  const totalValue = quotes.filter(q => q.status === 'accepted').reduce((sum, q) => sum + q.totalAmount, 0)
  const avgQuoteValue = quotes.length > 0 ? quotes.reduce((sum, q) => sum + q.totalAmount, 0) / quotes.length : 0

  // Funnel quotes
  const filteredQuotes = quotes.filter(quote => {
    const matchesMagnifyingGlass =
      quote.quoteNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.title.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = statusFunnel === 'all' || quote.status === statusFunnel

    return matchesMagnifyingGlass && matchesStatus
  })

  const generateQuoteNumber = (): string => {
    const year = new Date().getFullYear()
    const month = String(new Date().getMonth() + 1).padStart(2, '0')
    const count = quotes.length + 1
    return `QT-${year}${month}-${String(count).padStart(4, '0')}`
  }

  const calculateQuoteTotals = (items: QuoteItem[], taxRate: number, shippingAmount: number) => {
    const subtotal = items.reduce((sum, item) => sum + item.total, 0)
    const totalDiscount = items.reduce((sum, item) => {
      if (item.discountType === 'percentage') {
        return sum + (item.quantity * item.unitPrice * item.discount / 100)
      }
      return sum + item.discount
    }, 0)
    const taxAmount = (subtotal - totalDiscount) * (taxRate / 100)
    const totalAmount = subtotal - totalDiscount + taxAmount + shippingAmount

    return {
      subtotal,
      totalDiscount,
      taxAmount,
      totalAmount
    }
  }

  const createQuote = (quoteData: Omit<Quote, 'id' | 'quoteNumber' | 'createdDate' | 'updatedAt'>) => {
    const totals = calculateQuoteTotals(quoteData.items, quoteData.taxRate, quoteData.shippingAmount)

    const newQuote: Quote = {
      ...quoteData,
      ...totals,
      id: `quote-${Date.now()}`,
      quoteNumber: generateQuoteNumber(),
      createdDate: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setQuotes(currentQuotes => [...currentQuotes, newQuote])
    toast.success('Cotação criada com sucesso!')
    setIsCreateDialogOpen(false)
  }

  const updateQuote = (quoteId: string, updates: Partial<Quote>) => {
    setQuotes(currentQuotes =>
      currentQuotes.map(quote => {
        if (quote.id === quoteId) {
          const updatedQuote = { ...quote, ...updates }
          if (updates.items || updates.taxRate !== undefined || updates.shippingAmount !== undefined) {
            const totals = calculateQuoteTotals(
              updatedQuote.items,
              updatedQuote.taxRate,
              updatedQuote.shippingAmount
            )
            return {
              ...updatedQuote,
              ...totals,
              updatedAt: new Date().toISOString()
            }
          }
          return {
            ...updatedQuote,
            updatedAt: new Date().toISOString()
          }
        }
        return quote
      })
    )
    toast.success('Cotação atualizada com sucesso!')
    setIsEditDialogOpen(false)
    setEditingQuote(null)
  }

  const sendQuote = (quoteId: string) => {
    updateQuote(quoteId, {
      status: 'sent',
      sentDate: new Date().toISOString()
    })
    toast.success('Cotação enviada com sucesso!')
  }

  const deleteQuote = (quoteId: string) => {
    setQuotes(currentQuotes => currentQuotes.filter(quote => quote.id !== quoteId))
    toast.success('Cotação removida com sucesso!')
  }

  const getStatusInfo = (status: string) => {
    return quoteStatuses.find(s => s.value === status) || quoteStatuses[0]
  }

  const formatCurrency = (amount: number, currency: string = 'BRL') => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency
    }).format(amount)
  }

  const isExpired = (validUntil: string) => {
    return new Date(validUntil) < new Date()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Cotações e Propostas</h2>
          <p className="text-muted-foreground">
            Sistema completo de cotações baseado no Krayin CRM
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Cotação
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total de Cotações</p>
                <p className="text-2xl font-bold">{totalQuotes}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <PaperPlaneRight className="h-4 w-4 text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Enviadas</p>
                <p className="text-2xl font-bold">{sentQuotes}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Calculator className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Taxa Aceitação</p>
                <p className="text-2xl font-bold">{acceptanceRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CurrencyDollar className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Valor Aceito</p>
                <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Calculator className="h-4 w-4 text-purple-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Valor Médio</p>
                <p className="text-2xl font-bold">{formatCurrency(avgQuoteValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnels */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Buscar cotações..."
                value={searchQuery}
                onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
              />
            </div>

            <Select value={statusFunnel} onValueChange={setStatusFunnel}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Status</SelectItem>
                {quoteStatuses.map(status => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Quotes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Lista de Cotações</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredQuotes.map((quote) => {
                const statusInfo = getStatusInfo(quote.status)
                const expired = isExpired(quote.validUntil)

                return (
                  <TableRow key={quote.id}>
                    <TableCell className="font-medium">{quote.quoteNumber}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{quote.contactName}</p>
                        <p className="text-sm text-muted-foreground">{quote.company}</p>
                      </div>
                    </TableCell>
                    <TableCell>{quote.title}</TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline" className={statusInfo.color}>
                          {statusInfo.label}
                        </Badge>
                        {expired && quote.status !== 'expired' && (
                          <Badge variant="outline" className="bg-orange-100 text-orange-800">
                            <Warning className="h-3 w-3 mr-1" />
                            Expirada
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(quote.totalAmount, quote.currency)}
                    </TableCell>
                    <TableCell>
                      {new Date(quote.validUntil).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      {new Date(quote.createdDate).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedQuote(quote)
                            setIsViewDialogOpen(true)
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingQuote(quote)
                            setIsEditDialogOpen(true)
                          }}
                        >
                          <PencilSimple className="h-4 w-4" />
                        </Button>
                        {quote.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => sendQuote(quote.id)}
                          >
                            <PaperPlaneRight className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteQuote(quote.id)}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Quote Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar Nova Cotação</DialogTitle>
            <DialogDescription>
              Crie uma nova cotação para seu cliente
            </DialogDescription>
          </DialogHeader>

          <QuoteForm
            quote={defaultQuote}
            onSave={createQuote}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Quote Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Cotação</DialogTitle>
            <DialogDescription>
              Atualize as informações da cotação
            </DialogDescription>
          </DialogHeader>

          {editingQuote && (
            <QuoteForm
              quote={editingQuote}
              onSave={(quoteData) => updateQuote(editingQuote.id!, quoteData)}
              onCancel={() => {
                setEditingQuote(null)
                setIsEditDialogOpen(false)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* View Quote Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Visualizar Cotação</DialogTitle>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                PDF
              </Button>
              {selectedQuote?.status === 'draft' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedQuote && sendQuote(selectedQuote.id)}
                >
                  <PaperPlaneRight className="h-4 w-4 mr-2" />
                  Enviar
                </Button>
              )}
            </div>
          </DialogHeader>

          {selectedQuote && (
            <QuotePreview quote={selectedQuote} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface QuoteFormProps {
  quote: Partial<Quote>
  onSave: (quote: Omit<Quote, 'id' | 'quoteNumber' | 'createdDate' | 'updatedAt'>) => void
  onCancel: () => void
}

function QuoteForm({ quote, onSave, onCancel }: QuoteFormProps) {
  const [formData, setFormData] = useState<Partial<Quote>>(quote)
  const [items, setItems] = useState<QuoteItem[]>(quote.items || [])

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const addItem = () => {
    const newItem: QuoteItem = {
      id: `item-${Date.now()}`,
      name: '',
      description: '',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      discountType: 'percentage',
      taxRate: 0,
      total: 0
    }
    setItems(prev => [...prev, newItem])
  }

  const updateItem = (itemId: string, updates: Partial<QuoteItem>) => {
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const updatedItem = { ...item, ...updates }
        // Recalculate total
        const subtotal = updatedItem.quantity * updatedItem.unitPrice
        const discountAmount = updatedItem.discountType === 'percentage'
          ? subtotal * (updatedItem.discount / 100)
          : updatedItem.discount
        updatedItem.total = subtotal - discountAmount
        return updatedItem
      }
      return item
    }))
  }

  const removeItem = (itemId: string) => {
    setItems(prev => prev.filter(item => item.id !== itemId))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const quoteData = {
      ...formData,
      items
    } as Omit<Quote, 'id' | 'quoteNumber' | 'createdDate' | 'updatedAt'>
    onSave(quoteData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">Informações Básicas</TabsTrigger>
          <TabsTrigger value="items">Itens</TabsTrigger>
          <TabsTrigger value="billing">Faturamento</TabsTrigger>
          <TabsTrigger value="terms">Termos</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contactName">Nome do Contato *</Label>
              <Input
                id="contactName"
                value={formData.contactName || ''}
                onChange={(e) => updateField('contactName', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company">Empresa *</Label>
              <Input
                id="company"
                value={formData.company || ''}
                onChange={(e) => updateField('company', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contactEmail">E-mail *</Label>
              <Input
                id="contactEmail"
                type="email"
                value={formData.contactEmail || ''}
                onChange={(e) => updateField('contactEmail', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPhone">Telefone</Label>
              <Input
                id="contactPhone"
                value={formData.contactPhone || ''}
                onChange={(e) => updateField('contactPhone', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Título da Cotação *</Label>
            <Input
              id="title"
              value={formData.title || ''}
              onChange={(e) => updateField('title', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              rows={3}
              value={formData.description || ''}
              onChange={(e) => updateField('description', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="validUntil">Válida até *</Label>
              <Input
                id="validUntil"
                type="date"
                value={formData.validUntil || ''}
                onChange={(e) => updateField('validUntil', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentTerms">Condições de Pagamento</Label>
              <Select
                value={formData.paymentTerms}
                onValueChange={(value) => updateField('paymentTerms', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentTermsOptions.map(term => (
                    <SelectItem key={term.value} value={term.value}>
                      {term.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Moeda</Label>
              <Select
                value={formData.currency}
                onValueChange={(value) => updateField('currency', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">Real (R$)</SelectItem>
                  <SelectItem value="USD">Dólar ($)</SelectItem>
                  <SelectItem value="EUR">Euro (€)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="items" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Itens da Cotação</h3>
            <Button type="button" onClick={addItem}>
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Item
            </Button>
          </div>

          <div className="space-y-4">
            {items.map((item, index) => (
              <Card key={item.id}>
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                    <div className="md:col-span-2 space-y-2">
                      <Label>Nome do Item *</Label>
                      <Input
                        value={item.name}
                        onChange={(e) => updateItem(item.id, { name: e.target.value })}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Quantidade</Label>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                        min="1"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Preço Unitário</Label>
                      <Input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(item.id, { unitPrice: Number(e.target.value) })}
                        min="0"
                        step="0.01"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Desconto</Label>
                      <div className="flex space-x-2">
                        <Input
                          type="number"
                          value={item.discount}
                          onChange={(e) => updateItem(item.id, { discount: Number(e.target.value) })}
                          min="0"
                          step="0.01"
                        />
                        <Select
                          value={item.discountType}
                          onValueChange={(value) => updateItem(item.id, { discountType: value as 'percentage' | 'fixed' })}
                        >
                          <SelectTrigger className="w-16">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">%</SelectItem>
                            <SelectItem value="fixed">R$</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Total</p>
                        <p className="font-semibold">R$ {item.total.toFixed(2)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(item.id)}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label>Descrição</Label>
                    <Textarea
                      rows={2}
                      value={item.description}
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      placeholder="Descrição detalhada do item..."
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Endereço de Cobrança</h3>
              <div className="space-y-2">
                <Input
                  placeholder="Rua, número"
                  value={formData.billingAddress?.street || ''}
                  onChange={(e) => updateField('billingAddress', {
                    ...formData.billingAddress,
                    street: e.target.value
                  })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Cidade"
                  value={formData.billingAddress?.city || ''}
                  onChange={(e) => updateField('billingAddress', {
                    ...formData.billingAddress,
                    city: e.target.value
                  })}
                />
                <Input
                  placeholder="Estado"
                  value={formData.billingAddress?.state || ''}
                  onChange={(e) => updateField('billingAddress', {
                    ...formData.billingAddress,
                    state: e.target.value
                  })}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Configurações Financeiras</h3>
              <div className="space-y-2">
                <Label htmlFor="taxRate">Taxa de Imposto (%)</Label>
                <Input
                  id="taxRate"
                  type="number"
                  value={formData.taxRate || 0}
                  onChange={(e) => updateField('taxRate', Number(e.target.value))}
                  min="0"
                  max="100"
                  step="0.01"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shippingAmount">Valor do Frete</Label>
                <Input
                  id="shippingAmount"
                  type="number"
                  value={formData.shippingAmount || 0}
                  onChange={(e) => updateField('shippingAmount', Number(e.target.value))}
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="terms" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="terms">Termos e Condições</Label>
            <Textarea
              id="terms"
              rows={6}
              value={formData.terms || ''}
              onChange={(e) => updateField('terms', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              rows={4}
              value={formData.notes || ''}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Observações internas (não aparecem na cotação)"
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end space-x-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">
          Salvar Cotação
        </Button>
      </div>
    </form>
  )
}

interface QuotePreviewProps {
  quote: Quote
}

function QuotePreview({ quote }: QuotePreviewProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: quote.currency
    }).format(amount)
  }

  return (
    <div className="space-y-6 p-6 bg-white">
      {/* Header */}
      <div className="text-center border-b pb-6">
        <h1 className="text-3xl font-bold">COTAÇÃO</h1>
        <p className="text-lg font-semibold text-muted-foreground">{quote.quoteNumber}</p>
      </div>

      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold mb-2">Para:</h3>
          <p className="font-medium">{quote.contactName}</p>
          <p>{quote.company}</p>
          <p>{quote.contactEmail}</p>
          <p>{quote.contactPhone}</p>
        </div>
        <div className="text-right">
          <p><strong>Data:</strong> {new Date(quote.createdDate).toLocaleDateString('pt-BR')}</p>
          <p><strong>Válida até:</strong> {new Date(quote.validUntil).toLocaleDateString('pt-BR')}</p>
          <p><strong>Condições:</strong> {paymentTermsOptions.find(t => t.value === quote.paymentTerms)?.label}</p>
        </div>
      </div>

      {/* Title and Description */}
      <div>
        <h2 className="text-xl font-semibold mb-2">{quote.title}</h2>
        {quote.description && <p className="text-muted-foreground">{quote.description}</p>}
      </div>

      {/* Items Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-center">Qtd</TableHead>
            <TableHead className="text-right">Preço Unit.</TableHead>
            <TableHead className="text-right">Desconto</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {quote.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <div>
                  <p className="font-medium">{item.name}</p>
                  {item.description && (
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-center">{item.quantity}</TableCell>
              <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
              <TableCell className="text-right">
                {item.discountType === 'percentage'
                  ? `${item.discount}%`
                  : formatCurrency(item.discount)
                }
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatCurrency(item.total)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="w-80 space-y-2">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span>{formatCurrency(quote.subtotal)}</span>
          </div>
          {quote.totalDiscount > 0 && (
            <div className="flex justify-between text-red-600">
              <span>Desconto Total:</span>
              <span>-{formatCurrency(quote.totalDiscount)}</span>
            </div>
          )}
          {quote.taxAmount > 0 && (
            <div className="flex justify-between">
              <span>Impostos ({quote.taxRate}%):</span>
              <span>{formatCurrency(quote.taxAmount)}</span>
            </div>
          )}
          {quote.shippingAmount > 0 && (
            <div className="flex justify-between">
              <span>Frete:</span>
              <span>{formatCurrency(quote.shippingAmount)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between text-lg font-bold">
            <span>Total:</span>
            <span>{formatCurrency(quote.totalAmount)}</span>
          </div>
        </div>
      </div>

      {/* Terms */}
      {quote.terms && (
        <div className="border-t pt-6">
          <h3 className="font-semibold mb-2">Termos e Condições</h3>
          <p className="text-sm whitespace-pre-wrap">{quote.terms}</p>
        </div>
      )}
    </div>
  )
}
