import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Label } from "@/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Textarea } from "@/textarea"
import {
  ShoppingCart,
  Plus,
  Package,
  Truck,
  CurrencyDollar,
  CalendarBlank,
  FileText,
  Building,
  User,
  Star,
  TrendUp,
  Warning,
  CheckCircle,
  Eye,
  MapPin,
  Phone,
  Envelope
} from "@phosphor-icons/react"

interface Supplier {
  id: string
  name: string
  email: string
  phone: string
  address: string
  taxId: string
  paymentTerms: string
  rating: number
  totalOrders: number
  totalValue: number
  status: 'active' | 'inactive' | 'blacklisted'
  contactPerson: string
}

interface PurchaseOrder {
  id: string
  poNumber: string
  supplierId: string
  supplierName: string
  orderDate: string
  expectedDelivery: string
  items: PurchaseOrderItem[]
  totalAmount: number
  status: 'draft' | 'submitted' | 'approved' | 'delivered' | 'cancelled'
  approver?: string
  notes: string
}

interface PurchaseOrderItem {
  id: string
  itemCode: string
  itemName: string
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
  unit: string
}

interface PurchaseRequest {
  id: string
  requestNumber: string
  requestedBy: string
  department: string
  requestDate: string
  requiredDate: string
  items: RequestItem[]
  status: 'pending' | 'approved' | 'converted' | 'rejected'
  approver?: string
  reason: string
}

interface RequestItem {
  id: string
  itemName: string
  description: string
  quantity: number
  estimatedCost: number
  unit: string
  urgency: 'low' | 'medium' | 'high'
}

interface Invoice {
  id: string
  invoiceNumber: string
  supplierId: string
  supplierName: string
  poNumber: string
  invoiceDate: string
  dueDate: string
  amount: number
  status: 'pending' | 'approved' | 'paid' | 'overdue'
  paidDate?: string
}

export function ProcurementModule() {
  const [activeTab, setActiveTab] = useState("orders")

  // Sample data
  const [suppliers, setSuppliers] = useKV<Supplier[]>("procurement-suppliers", [
    {
      id: "sup-001",
      name: "TechCorp Suprimentos",
      email: "vendas@techcorp.com",
      phone: "(11) 99999-1001",
      address: "São Paulo, SP",
      taxId: "12.345.678/0001-90",
      paymentTerms: "30 dias",
      rating: 4.8,
      totalOrders: 45,
      totalValue: 320000,
      status: "active",
      contactPerson: "Maria Santos"
    },
    {
      id: "sup-002",
      name: "Office Solutions",
      email: "contato@officesol.com",
      phone: "(11) 99999-1002",
      address: "Rio de Janeiro, RJ",
      taxId: "98.765.432/0001-10",
      paymentTerms: "15 dias",
      rating: 4.2,
      totalOrders: 28,
      totalValue: 185000,
      status: "active",
      contactPerson: "João Silva"
    }
  ])

  const [purchaseOrders, setPurchaseOrders] = useKV<PurchaseOrder[]>("procurement-orders", [
    {
      id: "po-001",
      poNumber: "PO-2024-001",
      supplierId: "sup-001",
      supplierName: "TechCorp Suprimentos",
      orderDate: "2024-03-15",
      expectedDelivery: "2024-03-25",
      items: [
        {
          id: "item-001",
          itemCode: "LAP001",
          itemName: "Laptop Dell Inspiron",
          description: "Laptop para equipe de vendas",
          quantity: 5,
          unitPrice: 3500,
          totalPrice: 17500,
          unit: "unidade"
        }
      ],
      totalAmount: 17500,
      status: "approved",
      approver: "João Manager",
      notes: "Entrega urgente para nova equipe"
    }
  ])

  const [purchaseRequests, setPurchaseRequests] = useKV<PurchaseRequest[]>("procurement-requests", [
    {
      id: "pr-001",
      requestNumber: "PR-2024-001",
      requestedBy: "Ana Silva",
      department: "Vendas",
      requestDate: "2024-03-10",
      requiredDate: "2024-03-20",
      items: [
        {
          id: "req-item-001",
          itemName: "Impressora Multifuncional",
          description: "Para novo escritório",
          quantity: 2,
          estimatedCost: 2500,
          unit: "unidade",
          urgency: "medium"
        }
      ],
      status: "pending",
      reason: "Expansão do escritório"
    }
  ])

  const [invoices, setInvoices] = useKV<Invoice[]>("procurement-invoices", [
    {
      id: "inv-001",
      invoiceNumber: "INV-2024-001",
      supplierId: "sup-001",
      supplierName: "TechCorp Suprimentos",
      poNumber: "PO-2024-001",
      invoiceDate: "2024-03-25",
      dueDate: "2024-04-24",
      amount: 17500,
      status: "pending"
    }
  ])

  const [showAddSupplier, setShowAddSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState<Partial<Supplier>>({
    status: 'active',
    rating: 5,
    totalOrders: 0,
    totalValue: 0
  })

  const addSupplier = () => {
    if (newSupplier.name && newSupplier.email) {
      const supplier: Supplier = {
        id: `sup-${Date.now()}`,
        name: newSupplier.name,
        email: newSupplier.email,
        phone: newSupplier.phone || '',
        address: newSupplier.address || '',
        taxId: newSupplier.taxId || '',
        paymentTerms: newSupplier.paymentTerms || '30 dias',
        rating: newSupplier.rating || 5,
        totalOrders: 0,
        totalValue: 0,
        status: newSupplier.status as 'active' | 'inactive' | 'blacklisted',
        contactPerson: newSupplier.contactPerson || ''
      }

      setSuppliers(current => [...current, supplier])
      setNewSupplier({ status: 'active', rating: 5, totalOrders: 0, totalValue: 0 })
      setShowAddSupplier(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': case 'approved': case 'delivered': case 'paid':
        return 'bg-green-100 text-green-800'
      case 'pending': case 'draft': case 'submitted':
        return 'bg-yellow-100 text-yellow-800'
      case 'inactive': case 'rejected': case 'cancelled': case 'overdue':
        return 'bg-red-100 text-red-800'
      case 'blacklisted':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-blue-100 text-blue-800'
    }
  }

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high': return 'bg-red-100 text-red-800'
      case 'medium': return 'bg-yellow-100 text-yellow-800'
      case 'low': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getProcurementStats = () => {
    return {
      totalOrders: purchaseOrders.length,
      totalValue: purchaseOrders.reduce((sum, order) => sum + order.totalAmount, 0),
      pendingRequests: purchaseRequests.filter(req => req.status === 'pending').length,
      overdueInvoices: invoices.filter(inv => inv.status === 'overdue').length
    }
  }

  const stats = getProcurementStats()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Gestão de Compras</h2>
          <p className="text-muted-foreground">
            Sistema completo de procurement e gestão de fornecedores
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline">
            <FileText className="h-4 w-4 mr-2" />
            Relatórios
          </Button>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nova Solicitação
          </Button>
        </div>
      </div>

      {/* Procurement Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <ShoppingCart className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pedidos Totais</p>
                <p className="text-2xl font-bold">{stats.totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CurrencyDollar className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Valor Total</p>
                <p className="text-2xl font-bold">R$ {(stats.totalValue / 1000).toFixed(0)}K</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CalendarBlank className="h-8 w-8 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Solicitações Pendentes</p>
                <p className="text-2xl font-bold">{stats.pendingRequests}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Warning className="h-8 w-8 text-red-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Faturas Vencidas</p>
                <p className="text-2xl font-bold">{stats.overdueInvoices}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="orders">Pedidos de Compra</TabsTrigger>
          <TabsTrigger value="requests">Solicitações</TabsTrigger>
          <TabsTrigger value="suppliers">Fornecedores</TabsTrigger>
          <TabsTrigger value="invoices">Faturas</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pedidos de Compra</CardTitle>
              <CardDescription>Gestão completa de pedidos aos fornecedores</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {purchaseOrders.map((order) => (
                  <div key={order.id} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium">{order.poNumber}</p>
                        <p className="text-sm text-muted-foreground">{order.supplierName}</p>
                      </div>
                      <Badge className={getStatusColor(order.status)}>
                        {order.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Data do Pedido:</p>
                        <p>{order.orderDate}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Entrega Prevista:</p>
                        <p>{order.expectedDelivery}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Valor Total:</p>
                        <p className="font-medium">R$ {order.totalAmount.toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t">
                      <p className="text-sm font-medium mb-2">Itens:</p>
                      <div className="space-y-1">
                        {order.items.map((item) => (
                          <div key={item.id} className="flex justify-between text-sm">
                            <span>{item.itemName} ({item.quantity} {item.unit})</span>
                            <span>R$ {item.totalPrice.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex space-x-2 mt-4">
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4 mr-2" />
                        Ver Detalhes
                      </Button>
                      {order.status === 'approved' && (
                        <Button size="sm">
                          <Truck className="h-4 w-4 mr-2" />
                          Confirmar Entrega
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Solicitações de Compra</CardTitle>
              <CardDescription>Requisições internas para aprovação</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {purchaseRequests.map((request) => (
                  <div key={request.id} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium">{request.requestNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {request.requestedBy} - {request.department}
                        </p>
                      </div>
                      <Badge className={getStatusColor(request.status)}>
                        {request.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-3">
                      <div>
                        <p className="text-muted-foreground">Data da Solicitação:</p>
                        <p>{request.requestDate}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Data Necessária:</p>
                        <p>{request.requiredDate}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Motivo:</p>
                        <p>{request.reason}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {request.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between p-3 bg-muted rounded">
                          <div>
                            <p className="font-medium">{item.itemName}</p>
                            <p className="text-sm text-muted-foreground">{item.description}</p>
                            <div className="flex items-center space-x-2 mt-1">
                              <span className="text-sm">Qtd: {item.quantity} {item.unit}</span>
                              <Badge className={getUrgencyColor(item.urgency)} variant="outline">
                                {item.urgency}
                              </Badge>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">R$ {item.estimatedCost.toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {request.status === 'pending' && (
                      <div className="flex space-x-2 mt-4">
                        <Button size="sm">
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Aprovar
                        </Button>
                        <Button variant="outline" size="sm">
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          {showAddSupplier && (
            <Card>
              <CardHeader>
                <CardTitle>Adicionar Novo Fornecedor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="supplierName">Nome da Empresa</Label>
                    <Input
                      id="supplierName"
                      value={newSupplier.name || ''}
                      onChange={(e) => setNewSupplier(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Nome do fornecedor"
                    />
                  </div>
                  <div>
                    <Label htmlFor="supplierEmail">E-mail</Label>
                    <Input
                      id="supplierEmail"
                      type="email"
                      value={newSupplier.email || ''}
                      onChange={(e) => setNewSupplier(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="contato@fornecedor.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="supplierPhone">Telefone</Label>
                    <Input
                      id="supplierPhone"
                      value={newSupplier.phone || ''}
                      onChange={(e) => setNewSupplier(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                  <div>
                    <Label htmlFor="supplierTaxId">CNPJ</Label>
                    <Input
                      id="supplierTaxId"
                      value={newSupplier.taxId || ''}
                      onChange={(e) => setNewSupplier(prev => ({ ...prev, taxId: e.target.value }))}
                      placeholder="00.000.000/0000-00"
                    />
                  </div>
                  <div>
                    <Label htmlFor="supplierAddress">Endereço</Label>
                    <Input
                      id="supplierAddress"
                      value={newSupplier.address || ''}
                      onChange={(e) => setNewSupplier(prev => ({ ...prev, address: e.target.value }))}
                      placeholder="Cidade, Estado"
                    />
                  </div>
                  <div>
                    <Label htmlFor="supplierContact">Pessoa de Contato</Label>
                    <Input
                      id="supplierContact"
                      value={newSupplier.contactPerson || ''}
                      onChange={(e) => setNewSupplier(prev => ({ ...prev, contactPerson: e.target.value }))}
                      placeholder="Nome do contato"
                    />
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button onClick={addSupplier}>Adicionar Fornecedor</Button>
                  <Button variant="outline" onClick={() => setShowAddSupplier(false)}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button onClick={() => setShowAddSupplier(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Fornecedor
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {suppliers.map((supplier) => (
              <Card key={supplier.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{supplier.name}</CardTitle>
                      <CardDescription>{supplier.contactPerson}</CardDescription>
                    </div>
                    <Badge className={getStatusColor(supplier.status)}>
                      {supplier.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm space-y-1">
                    <div className="flex items-center space-x-2">
                      <Envelope className="h-4 w-4 text-muted-foreground" />
                      <span>{supplier.email}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{supplier.phone}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{supplier.address}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Star className="h-4 w-4 text-yellow-500 fill-current" />
                    <span className="font-medium">{supplier.rating}</span>
                    <span className="text-sm text-muted-foreground">
                      ({supplier.totalOrders} pedidos)
                    </span>
                  </div>

                  <div className="text-sm">
                    <p className="font-medium">Volume Total: R$ {supplier.totalValue.toLocaleString()}</p>
                    <p className="text-muted-foreground">Prazo: {supplier.paymentTerms}</p>
                  </div>

                  <Button variant="outline" size="sm" className="w-full">
                    <Eye className="h-4 w-4 mr-2" />
                    Ver Histórico
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Faturas a Pagar</CardTitle>
              <CardDescription>Controle de pagamentos aos fornecedores</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {invoices.map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">{invoice.invoiceNumber}</p>
                      <p className="text-sm text-muted-foreground">{invoice.supplierName}</p>
                      <p className="text-sm">PO: {invoice.poNumber}</p>
                      <p className="text-sm">Vencimento: {invoice.dueDate}</p>
                    </div>
                    <div className="text-right space-y-2">
                      <p className="font-bold text-lg">R$ {invoice.amount.toLocaleString()}</p>
                      <Badge className={getStatusColor(invoice.status)}>
                        {invoice.status}
                      </Badge>
                      {invoice.status === 'pending' && (
                        <div>
                          <Button size="sm">
                            <CurrencyDollar className="h-4 w-4 mr-2" />
                            Pagar
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Fornecedores</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {suppliers
                    .sort((a, b) => b.totalValue - a.totalValue)
                    .slice(0, 5)
                    .map((supplier) => (
                      <div key={supplier.id} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{supplier.name}</p>
                          <p className="text-sm text-muted-foreground">{supplier.totalOrders} pedidos</p>
                        </div>
                        <p className="font-medium">R$ {supplier.totalValue.toLocaleString()}</p>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance de Entrega</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span>No Prazo:</span>
                    <span className="font-medium text-green-600">85%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Atrasados:</span>
                    <span className="font-medium text-orange-600">12%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cancelados:</span>
                    <span className="font-medium text-red-600">3%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
