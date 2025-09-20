import { useState } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Plus, Package, CurrencyDollar, Eye, PencilSimple, Trash, MagnifyingGlass, Funnel, Tag, ChartBar, TrendUp, Warehouse, Star, ShoppingCart, Image, Archive } from "@phosphor-icons/react"
import { toast } from 'sonner'

interface ProductVariant {
  id: string
  name: string
  sku: string
  price: number
  comparePrice?: number
  cost: number
  quantity: number
  weight?: number
  attributes: Record<string, string> // e.g., { "Color": "Red", "Size": "M" }
}

interface Product {
  id: string
  name: string
  sku: string
  description: string
  shortDescription: string
  category: string
  subcategory?: string
  type: 'simple' | 'configurable' | 'bundle' | 'virtual' | 'downloadable'
  status: 'active' | 'inactive' | 'draft'
  visibility: 'catalog-search' | 'catalog' | 'search' | 'not-visible'

  // Pricing
  price: number
  comparePrice?: number
  cost: number
  taxClass?: string

  // Inventory
  manageStock: boolean
  quantity: number
  stockStatus: 'in-stock' | 'out-of-stock' | 'backorder'
  lowStockThreshold: number

  // Physical attributes
  weight?: number
  dimensions?: {
    length: number
    width: number
    height: number
    unit: 'cm' | 'in'
  }

  // Images and media
  images: string[]
  featuredImage?: string

  // SEO
  metaTitle?: string
  metaDescription?: string
  urlKey?: string

  // Organization
  tags: string[]
  brand?: string
  model?: string

  // Variants (for configurable products)
  variants: ProductVariant[]

  // Additional fields
  customFields: Record<string, any>

  // Timestamps
  createdAt: string
  updatedAt: string
  createdBy: string
}

interface ProductCategory {
  id: string
  name: string
  slug: string
  description: string
  parentId?: string
  isActive: boolean
  sortOrder: number
  productsCount: number
}

const defaultProduct: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  sku: '',
  description: '',
  shortDescription: '',
  category: '',
  subcategory: '',
  type: 'simple',
  status: 'active',
  visibility: 'catalog-search',
  price: 0,
  comparePrice: 0,
  cost: 0,
  taxClass: 'standard',
  manageStock: true,
  quantity: 0,
  stockStatus: 'out-of-stock',
  lowStockThreshold: 5,
  weight: 0,
  dimensions: {
    length: 0,
    width: 0,
    height: 0,
    unit: 'cm'
  },
  images: [],
  featuredImage: '',
  metaTitle: '',
  metaDescription: '',
  urlKey: '',
  tags: [],
  brand: '',
  model: '',
  variants: [],
  customFields: {},
  createdBy: 'user-1'
}

const productCategories: ProductCategory[] = [
  { id: '1', name: 'Eletrônicos', slug: 'eletronicos', description: 'Produtos eletrônicos em geral', isActive: true, sortOrder: 1, productsCount: 0 },
  { id: '2', name: 'Roupas', slug: 'roupas', description: 'Vestuário e acessórios', isActive: true, sortOrder: 2, productsCount: 0 },
  { id: '3', name: 'Casa e Jardim', slug: 'casa-jardim', description: 'Produtos para casa e jardim', isActive: true, sortOrder: 3, productsCount: 0 },
  { id: '4', name: 'Esportes', slug: 'esportes', description: 'Artigos esportivos', isActive: true, sortOrder: 4, productsCount: 0 },
  { id: '5', name: 'Livros', slug: 'livros', description: 'Livros e materiais educativos', isActive: true, sortOrder: 5, productsCount: 0 }
]

const productTypes = [
  { value: 'simple', label: 'Produto Simples', description: 'Produto único sem variações' },
  { value: 'configurable', label: 'Produto Configurável', description: 'Produto com variações (tamanho, cor, etc.)' },
  { value: 'bundle', label: 'Pacote', description: 'Conjunto de produtos vendidos juntos' },
  { value: 'virtual', label: 'Virtual', description: 'Produto sem envio físico' },
  { value: 'downloadable', label: 'Download', description: 'Produto digital para download' }
]

const statusOptions = [
  { value: 'active', label: 'Ativo', color: 'bg-green-100 text-green-800' },
  { value: 'inactive', label: 'Inativo', color: 'bg-gray-100 text-gray-800' },
  { value: 'draft', label: 'Rascunho', color: 'bg-yellow-100 text-yellow-800' }
]

const stockStatusOptions = [
  { value: 'in-stock', label: 'Em Estoque', color: 'bg-green-100 text-green-800' },
  { value: 'out-of-stock', label: 'Sem Estoque', color: 'bg-red-100 text-red-800' },
  { value: 'backorder', label: 'Pré-venda', color: 'bg-blue-100 text-blue-800' }
]

export function ProductCatalog() {
  const [products, setProducts] = useKV<Product[]>('krayin-products', [])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [searchQuery, setMagnifyingGlassQuery] = useState('')
  const [categoryFunnel, setCategoryFunnel] = useState<string>('all')
  const [statusFunnel, setStatusFunnel] = useState<string>('all')
  const [typeFunnel, setTypeFunnel] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  // Calculate metrics
  const totalProducts = products.length
  const activeProducts = products.filter(p => p.status === 'active').length
  const outOfStockProducts = products.filter(p => p.stockStatus === 'out-of-stock').length
  const lowStockProducts = products.filter(p => p.manageStock && p.quantity <= p.lowStockThreshold).length
  const totalValue = products.reduce((sum, p) => sum + (p.price * p.quantity), 0)
  const avgPrice = products.length > 0 ? products.reduce((sum, p) => sum + p.price, 0) / products.length : 0

  // Funnel products
  const filteredProducts = products.filter(product => {
    const matchesMagnifyingGlass =
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))

    const matchesCategory = categoryFunnel === 'all' || product.category === categoryFunnel
    const matchesStatus = statusFunnel === 'all' || product.status === statusFunnel
    const matchesType = typeFunnel === 'all' || product.type === typeFunnel

    return matchesMagnifyingGlass && matchesCategory && matchesStatus && matchesType
  })

  const generateSKU = (productName: string): string => {
    const prefix = productName.substring(0, 3).toUpperCase()
    const timestamp = Date.now().toString().slice(-6)
    return `${prefix}-${timestamp}`
  }

  const createProduct = (productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newProduct: Product = {
      ...productData,
      id: `product-${Date.now()}`,
      sku: productData.sku || generateSKU(productData.name),
      urlKey: productData.urlKey || productData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      stockStatus: productData.manageStock
        ? (productData.quantity > 0 ? 'in-stock' : 'out-of-stock')
        : 'in-stock',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setProducts(currentProducts => [...currentProducts, newProduct])
    toast.success('Produto criado com sucesso!')
    setIsCreateDialogOpen(false)
  }

  const updateProduct = (productId: string, updates: Partial<Product>) => {
    setProducts(currentProducts =>
      currentProducts.map(product => {
        if (product.id === productId) {
          const updatedProduct = { ...product, ...updates }
          // Update stock status if quantity changed
          if (updates.quantity !== undefined && updatedProduct.manageStock) {
            updatedProduct.stockStatus = updatedProduct.quantity > 0 ? 'in-stock' : 'out-of-stock'
          }
          return {
            ...updatedProduct,
            updatedAt: new Date().toISOString()
          }
        }
        return product
      })
    )
    toast.success('Produto atualizado com sucesso!')
    setIsEditDialogOpen(false)
    setEditingProduct(null)
  }

  const deleteProduct = (productId: string) => {
    setProducts(currentProducts => currentProducts.filter(product => product.id !== productId))
    toast.success('Produto removido com sucesso!')
  }

  const duplicateProduct = (product: Product) => {
    const duplicatedProduct = {
      ...product,
      name: `${product.name} (Cópia)`,
      sku: generateSKU(`${product.name} Copy`)
    }
    delete (duplicatedProduct as any).id
    delete (duplicatedProduct as any).createdAt
    delete (duplicatedProduct as any).updatedAt
    createProduct(duplicatedProduct)
  }

  const getStatusInfo = (status: string) => {
    return statusOptions.find(s => s.value === status) || statusOptions[0]
  }

  const getStockStatusInfo = (stockStatus: string) => {
    return stockStatusOptions.find(s => s.value === stockStatus) || stockStatusOptions[0]
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(amount)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Catálogo de Produtos</h2>
          <p className="text-muted-foreground">
            Gestão completa de produtos baseada no Krayin CRM
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
            {viewMode === 'grid' ? <ChartBar className="h-4 w-4" /> : <Package className="h-4 w-4" />}
          </Button>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Produto
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total Produtos</p>
                <p className="text-2xl font-bold">{totalProducts}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Star className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Ativos</p>
                <p className="text-2xl font-bold">{activeProducts}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Archive className="h-4 w-4 text-red-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Sem Estoque</p>
                <p className="text-2xl font-bold">{outOfStockProducts}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Warehouse className="h-4 w-4 text-orange-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Estoque Baixo</p>
                <p className="text-2xl font-bold">{lowStockProducts}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CurrencyDollar className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Valor Total</p>
                <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-4 w-4 text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Preço Médio</p>
                <p className="text-2xl font-bold">{formatCurrency(avgPrice)}</p>
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
              <div className="relative">
                <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar produtos..."
                  value={searchQuery}
                  onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <Select value={categoryFunnel} onValueChange={setCategoryFunnel}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Categorias</SelectItem>
                {productCategories.map(category => (
                  <SelectItem key={category.id} value={category.name}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFunnel} onValueChange={setStatusFunnel}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Status</SelectItem>
                {statusOptions.map(status => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFunnel} onValueChange={setTypeFunnel}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Tipos</SelectItem>
                {productTypes.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm">
              <Funnel className="h-4 w-4 mr-2" />
              Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Products Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProducts.map((product) => {
            const statusInfo = getStatusInfo(product.status)
            const stockInfo = getStockStatusInfo(product.stockStatus)
            const isLowStock = product.manageStock && product.quantity <= product.lowStockThreshold

            return (
              <Card key={product.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  {/* Product Image */}
                  <div className="aspect-square bg-muted rounded-lg mb-3 flex items-center justify-center">
                    {product.featuredImage ? (
                      <img
                        src={product.featuredImage}
                        alt={product.name}
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <Image className="h-12 w-12 text-muted-foreground" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <CardTitle className="text-lg line-clamp-2">{product.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {product.shortDescription || product.description}
                    </CardDescription>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Badge variant="outline" className={statusInfo.color}>
                      {statusInfo.label}
                    </Badge>
                    <Badge variant="outline" className={stockInfo.color}>
                      {stockInfo.label}
                    </Badge>
                    {isLowStock && (
                      <Badge variant="outline" className="bg-orange-100 text-orange-800">
                        Baixo
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>SKU:</span>
                      <span className="font-mono">{product.sku}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Preço:</span>
                      <span className="font-semibold text-lg">{formatCurrency(product.price)}</span>
                    </div>
                    {product.manageStock && (
                      <div className="flex items-center justify-between text-sm">
                        <span>Estoque:</span>
                        <span className={`font-medium ${isLowStock ? 'text-orange-600' : ''}`}>
                          {product.quantity} un.
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span>Categoria:</span>
                      <span>{product.category}</span>
                    </div>
                  </div>

                  {product.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {product.tags.slice(0, 3).map((tag, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {product.tags.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{product.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSelectedProduct(product)
                        setIsViewDialogOpen(true)
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Ver
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setEditingProduct(product)
                        setIsEditDialogOpen(true)
                      }}
                    >
                      <PencilSimple className="h-4 w-4 mr-2" />
                      Editar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-4 font-medium">Produto</th>
                    <th className="p-4 font-medium">SKU</th>
                    <th className="p-4 font-medium">Categoria</th>
                    <th className="p-4 font-medium">Preço</th>
                    <th className="p-4 font-medium">Estoque</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const statusInfo = getStatusInfo(product.status)
                    const stockInfo = getStockStatusInfo(product.stockStatus)
                    const isLowStock = product.manageStock && product.quantity <= product.lowStockThreshold

                    return (
                      <tr key={product.id} className="border-b hover:bg-muted/50">
                        <td className="p-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                              {product.featuredImage ? (
                                <img
                                  src={product.featuredImage}
                                  alt={product.name}
                                  className="w-full h-full object-cover rounded"
                                />
                              ) : (
                                <Package className="h-6 w-6 text-muted-foreground" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-sm text-muted-foreground line-clamp-1">
                                {product.shortDescription}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 font-mono text-sm">{product.sku}</td>
                        <td className="p-4">{product.category}</td>
                        <td className="p-4 font-semibold">{formatCurrency(product.price)}</td>
                        <td className="p-4">
                          {product.manageStock ? (
                            <span className={isLowStock ? 'text-orange-600 font-medium' : ''}>
                              {product.quantity} un.
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Não gerenciado</span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center space-x-1">
                            <Badge variant="outline" className={statusInfo.color}>
                              {statusInfo.label}
                            </Badge>
                            <Badge variant="outline" className={stockInfo.color}>
                              {stockInfo.label}
                            </Badge>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center space-x-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedProduct(product)
                                setIsViewDialogOpen(true)
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingProduct(product)
                                setIsEditDialogOpen(true)
                              }}
                            >
                              <PencilSimple className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => duplicateProduct(product)}
                            >
                              <ShoppingCart className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteProduct(product.id)}
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Product Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar Novo Produto</DialogTitle>
            <DialogDescription>
              Adicione um novo produto ao seu catálogo
            </DialogDescription>
          </DialogHeader>

          <ProductForm
            product={defaultProduct}
            onSave={createProduct}
            onCancel={() => setIsCreateDialogOpen(false)}
            categories={productCategories}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Produto</DialogTitle>
            <DialogDescription>
              Atualize as informações do produto
            </DialogDescription>
          </DialogHeader>

          {editingProduct && (
            <ProductForm
              product={editingProduct}
              onSave={(productData) => updateProduct(editingProduct.id!, productData)}
              onCancel={() => {
                setEditingProduct(null)
                setIsEditDialogOpen(false)
              }}
              categories={productCategories}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* View Product Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Produto</DialogTitle>
          </DialogHeader>

          {selectedProduct && (
            <ProductDetails product={selectedProduct} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface ProductFormProps {
  product: Partial<Product>
  onSave: (product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void
  onCancel: () => void
  categories: ProductCategory[]
}

function ProductForm({ product, onSave, onCancel, categories }: ProductFormProps) {
  const [formData, setFormData] = useState<Partial<Product>>(product)

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData as Omit<Product, 'id' | 'createdAt' | 'updatedAt'>)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="pricing">Preços</TabsTrigger>
          <TabsTrigger value="inventory">Estoque</TabsTrigger>
          <TabsTrigger value="attributes">Atributos</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome do Produto *</Label>
              <Input
                id="name"
                value={formData.name || ''}
                onChange={(e) => updateField('name', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sku">SKU</Label>
              <Input
                id="sku"
                value={formData.sku || ''}
                onChange={(e) => updateField('sku', e.target.value)}
                placeholder="Será gerado automaticamente se vazio"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortDescription">Descrição Resumida</Label>
            <Textarea
              id="shortDescription"
              rows={2}
              value={formData.shortDescription || ''}
              onChange={(e) => updateField('shortDescription', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição Completa</Label>
            <Textarea
              id="description"
              rows={4}
              value={formData.description || ''}
              onChange={(e) => updateField('description', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category">Categoria *</Label>
              <Select value={formData.category} onValueChange={(value) => updateField('category', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(category => (
                    <SelectItem key={category.id} value={category.name}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Tipo do Produto</Label>
              <Select value={formData.type} onValueChange={(value) => updateField('type', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {productTypes.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => updateField('status', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map(status => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">Marca</Label>
              <Input
                id="brand"
                value={formData.brand || ''}
                onChange={(e) => updateField('brand', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Modelo</Label>
              <Input
                id="model"
                value={formData.model || ''}
                onChange={(e) => updateField('model', e.target.value)}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price">Preço de Venda *</Label>
              <Input
                id="price"
                type="number"
                value={formData.price || 0}
                onChange={(e) => updateField('price', Number(e.target.value))}
                min="0"
                step="0.01"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="comparePrice">Preço Comparativo</Label>
              <Input
                id="comparePrice"
                type="number"
                value={formData.comparePrice || 0}
                onChange={(e) => updateField('comparePrice', Number(e.target.value))}
                min="0"
                step="0.01"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cost">Custo</Label>
              <Input
                id="cost"
                type="number"
                value={formData.cost || 0}
                onChange={(e) => updateField('cost', Number(e.target.value))}
                min="0"
                step="0.01"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="taxClass">Classe de Imposto</Label>
            <Select value={formData.taxClass} onValueChange={(value) => updateField('taxClass', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Padrão</SelectItem>
                <SelectItem value="reduced">Reduzido</SelectItem>
                <SelectItem value="zero">Zero</SelectItem>
                <SelectItem value="exempt">Isento</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="manageStock"
              checked={formData.manageStock || false}
              onCheckedChange={(checked) => updateField('manageStock', checked)}
            />
            <Label htmlFor="manageStock">Gerenciar estoque</Label>
          </div>

          {formData.manageStock && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quantity">Quantidade em Estoque</Label>
                <Input
                  id="quantity"
                  type="number"
                  value={formData.quantity || 0}
                  onChange={(e) => updateField('quantity', Number(e.target.value))}
                  min="0"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lowStockThreshold">Limite de Estoque Baixo</Label>
                <Input
                  id="lowStockThreshold"
                  type="number"
                  value={formData.lowStockThreshold || 5}
                  onChange={(e) => updateField('lowStockThreshold', Number(e.target.value))}
                  min="0"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="weight">Peso (kg)</Label>
            <Input
              id="weight"
              type="number"
              value={formData.weight || 0}
              onChange={(e) => updateField('weight', Number(e.target.value))}
              min="0"
              step="0.001"
            />
          </div>

          <div className="space-y-2">
            <Label>Dimensões (cm)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="Comprimento"
                type="number"
                value={formData.dimensions?.length || 0}
                onChange={(e) => updateField('dimensions', {
                  ...formData.dimensions,
                  length: Number(e.target.value)
                })}
                min="0"
                step="0.1"
              />
              <Input
                placeholder="Largura"
                type="number"
                value={formData.dimensions?.width || 0}
                onChange={(e) => updateField('dimensions', {
                  ...formData.dimensions,
                  width: Number(e.target.value)
                })}
                min="0"
                step="0.1"
              />
              <Input
                placeholder="Altura"
                type="number"
                value={formData.dimensions?.height || 0}
                onChange={(e) => updateField('dimensions', {
                  ...formData.dimensions,
                  height: Number(e.target.value)
                })}
                min="0"
                step="0.1"
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="attributes" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (separadas por vírgula)</Label>
            <Input
              id="tags"
              value={formData.tags?.join(', ') || ''}
              onChange={(e) => updateField('tags', e.target.value.split(',').map(tag => tag.trim()).filter(Boolean))}
              placeholder="produto-novo, promocao, destaque"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="featuredImage">URL da Imagem Principal</Label>
            <Input
              id="featuredImage"
              value={formData.featuredImage || ''}
              onChange={(e) => updateField('featuredImage', e.target.value)}
              placeholder="https://exemplo.com/imagem.jpg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="images">URLs das Imagens (uma por linha)</Label>
            <Textarea
              id="images"
              rows={4}
              value={formData.images?.join('\n') || ''}
              onChange={(e) => updateField('images', e.target.value.split('\n').filter(Boolean))}
              placeholder="https://exemplo.com/imagem1.jpg&#10;https://exemplo.com/imagem2.jpg"
            />
          </div>
        </TabsContent>

        <TabsContent value="seo" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="metaTitle">Título Meta</Label>
            <Input
              id="metaTitle"
              value={formData.metaTitle || ''}
              onChange={(e) => updateField('metaTitle', e.target.value)}
              maxLength={60}
            />
            <p className="text-xs text-muted-foreground">
              Recomendado: até 60 caracteres
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="metaDescription">Descrição Meta</Label>
            <Textarea
              id="metaDescription"
              rows={3}
              value={formData.metaDescription || ''}
              onChange={(e) => updateField('metaDescription', e.target.value)}
              maxLength={160}
            />
            <p className="text-xs text-muted-foreground">
              Recomendado: até 160 caracteres
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="urlKey">URL Key</Label>
            <Input
              id="urlKey"
              value={formData.urlKey || ''}
              onChange={(e) => updateField('urlKey', e.target.value)}
              placeholder="produto-exemplo"
            />
            <p className="text-xs text-muted-foreground">
              URL amigável para o produto (apenas letras, números e hífens)
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end space-x-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">
          Salvar Produto
        </Button>
      </div>
    </form>
  )
}

interface ProductDetailsProps {
  product: Product
}

function ProductDetails({ product }: ProductDetailsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(amount)
  }

  const statusInfo = statusOptions.find(s => s.value === product.status)
  const stockInfo = stockStatusOptions.find(s => s.value === product.stockStatus)
  const isLowStock = product.manageStock && product.quantity <= product.lowStockThreshold

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start space-x-4">
        <div className="w-24 h-24 bg-muted rounded-lg flex items-center justify-center">
          {product.featuredImage ? (
            <img
              src={product.featuredImage}
              alt={product.name}
              className="w-full h-full object-cover rounded-lg"
            />
          ) : (
            <Package className="h-12 w-12 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1">
          <h3 className="text-2xl font-bold">{product.name}</h3>
          <p className="text-muted-foreground">{product.shortDescription}</p>
          <div className="flex items-center space-x-2 mt-2">
            <Badge variant="outline" className={statusInfo?.color}>
              {statusInfo?.label}
            </Badge>
            <Badge variant="outline" className={stockInfo?.color}>
              {stockInfo?.label}
            </Badge>
            {isLowStock && (
              <Badge variant="outline" className="bg-orange-100 text-orange-800">
                Estoque Baixo
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Basic Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Informações Básicas</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>SKU:</span>
                <span className="font-mono">{product.sku}</span>
              </div>
              <div className="flex justify-between">
                <span>Categoria:</span>
                <span>{product.category}</span>
              </div>
              <div className="flex justify-between">
                <span>Tipo:</span>
                <span>{productTypes.find(t => t.value === product.type)?.label}</span>
              </div>
              {product.brand && (
                <div className="flex justify-between">
                  <span>Marca:</span>
                  <span>{product.brand}</span>
                </div>
              )}
              {product.model && (
                <div className="flex justify-between">
                  <span>Modelo:</span>
                  <span>{product.model}</span>
                </div>
              )}
            </div>
          </div>

          {product.manageStock && (
            <div>
              <h4 className="font-semibold mb-2">Estoque</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Quantidade:</span>
                  <span className={isLowStock ? 'text-orange-600 font-medium' : ''}>
                    {product.quantity} un.
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Limite Baixo:</span>
                  <span>{product.lowStockThreshold} un.</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Preços</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Preço de Venda:</span>
                <span className="font-semibold text-lg">{formatCurrency(product.price)}</span>
              </div>
              {product.comparePrice && product.comparePrice > 0 && (
                <div className="flex justify-between">
                  <span>Preço Comparativo:</span>
                  <span className="line-through text-muted-foreground">
                    {formatCurrency(product.comparePrice)}
                  </span>
                </div>
              )}
              {product.cost > 0 && (
                <div className="flex justify-between">
                  <span>Custo:</span>
                  <span>{formatCurrency(product.cost)}</span>
                </div>
              )}
              {product.cost > 0 && (
                <div className="flex justify-between">
                  <span>Margem:</span>
                  <span className="text-green-600">
                    {((product.price - product.cost) / product.price * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {(product.weight || product.dimensions) && (
            <div>
              <h4 className="font-semibold mb-2">Dimensões</h4>
              <div className="space-y-2 text-sm">
                {product.weight && (
                  <div className="flex justify-between">
                    <span>Peso:</span>
                    <span>{product.weight} kg</span>
                  </div>
                )}
                {product.dimensions && (
                  <div className="flex justify-between">
                    <span>Dimensões (C×L×A):</span>
                    <span>
                      {product.dimensions.length}×{product.dimensions.width}×{product.dimensions.height} cm
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {product.description && (
        <div>
          <h4 className="font-semibold mb-2">Descrição</h4>
          <p className="text-sm whitespace-pre-wrap">{product.description}</p>
        </div>
      )}

      {/* Tags */}
      {product.tags.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Tags</h4>
          <div className="flex flex-wrap gap-2">
            {product.tags.map((tag, index) => (
              <Badge key={index} variant="secondary">
                <Tag className="h-3 w-3 mr-1" />
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="pt-4 border-t text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Criado em: {new Date(product.createdAt).toLocaleString('pt-BR')}</span>
          <span>Atualizado em: {new Date(product.updatedAt).toLocaleString('pt-BR')}</span>
        </div>
      </div>
    </div>
  )
}
