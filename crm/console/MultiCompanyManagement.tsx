import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Input } from "@/input"
import { Label } from "@/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Textarea } from "@/textarea"
import { Switch } from "@/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/table"
import { Separator } from "@/separator"
import { Progress } from "@/progress"
import { toast } from 'sonner'
import {
  Buildings,
  Users,
  Globe,
  MapPin,
  Phone,
  Envelope,
  Plus,
  Eye,
  Gear,
  ChartBar,
  Factory,
  Bank,
  CurrencyDollar,
  PencilSimple,
  Trash,
  Shield,
  Key,
  Database,
  CloudArrowUp,
  Download,
  Copy,
  CheckCircle,
  XCircle,
  Clock,
  Warning,
  TrendUp,
  CalendarBlank,
  Package,
  FileText
} from "@phosphor-icons/react"

interface Company {
  id: string
  name: string
  shortName: string
  domain?: string
  industry: string
  taxId: string
  address: {
    street: string
    city: string
    state: string
    zipCode: string
    country: string
  }
  contact: {
    phone: string
    email: string
    website?: string
  }
  settings: {
    baseCurrency: string
    fiscalYearStart: string
    timezone: string
    dateFormat: string
    numberFormat: string
    language: string
    logoUrl?: string
  }
  branding?: {
    primaryColor: string
    secondaryColor: string
  }
  subscription: {
    plan: 'basic' | 'professional' | 'enterprise'
    status: 'active' | 'suspended' | 'cancelled'
    startDate: string
    endDate?: string
    maxUsers: number
    usedUsers: number
    maxStorage: number // in GB
    usedStorage: number // in GB
    features: string[]
  }
  billing: {
    monthlyRevenue: number
    totalRevenue: number
    lastPayment?: string
    nextBilling?: string
    paymentMethod?: string
  }
  usage: {
    apiCalls: number
    storageUsed: number
    activeUsers: number
    lastPulse: string
  }
  compliance: {
    dataRetention: number // in days
    encryptionEnabled: boolean
    backupFrequency: 'daily' | 'weekly' | 'monthly'
    auditLogEnabled: boolean
    gdprCompliant: boolean
  }
  status: 'active' | 'inactive' | 'suspended'
  parentCompanyId?: string
  subsidiaries: string[]
  createdAt: string
  updatedAt: string
  isDefault?: boolean
}

interface TenantUsage {
  tenantId: string
  date: string
  apiCalls: number
  storageUsed: number
  activeUsers: number
  revenue: number
}

interface SystemGear {
  maxTenantsPerInstance: number
  defaultStorageLimit: number
  defaultUserLimit: number
  allowSubdomains: boolean
  enableWhiteLabeling: boolean
  centralizedBilling: boolean
  sharedDatabase: boolean
  branding: {
    logo?: string
    primaryColor: string
    secondaryColor: string
  }
  status: 'active' | 'inactive'
  createdAt: string
  isDefault: boolean
}

interface CompanyGear {
  id: string
  companyId: string
  module: string
  settings: Record<string, any>
}

interface UserCompanyAccess {
  id: string
  userId: string
  companyId: string
  role: 'admin' | 'manager' | 'user' | 'viewer'
  permissions: string[]
  isActive: boolean
}

export function MultiCompanyManagement() {
  const [activeTab, setActiveTab] = useState("companies")
  const [selectedCompany, setSelectedCompany] = useState<string>("")

  // Persistent data
  const [companies, setCompanies] = useKV<Company[]>("companies", [
    {
      id: "1",
      name: "Tech Solutions Brasil Ltda",
      shortName: "Tech Solutions",
      industry: "Technology",
      taxId: "12.345.678/0001-90",
      address: {
        street: "Av. Paulista, 1000",
        city: "São Paulo",
        state: "SP",
        zipCode: "01310-100",
        country: "Brasil"
      },
      contact: {
        phone: "+55 11 3000-0000",
        email: "contato@techsolutions.com.br",
        website: "www.techsolutions.com.br"
      },
      settings: {
        baseCurrency: "BRL",
        fiscalYearStart: "2024-01-01",
        timezone: "America/Sao_Paulo",
        dateFormat: "DD/MM/YYYY",
        numberFormat: "#,##0.00",
        language: "pt-BR"
      },
      branding: {
        primaryColor: "#2563eb",
        secondaryColor: "#f59e0b"
      },
      status: "active",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      usage: { apiCalls: 0, storageUsed: 0, activeUsers: 0, lastPulse: new Date().toISOString() },
      billing: { monthlyRevenue: 0, totalRevenue: 0 },
      subscription: { plan: "basic", status: "active", startDate: "2024-01-01", maxUsers: 10, usedUsers: 2, maxStorage: 50, usedStorage: 5, features: [] },
      compliance: { dataRetention: 365, encryptionEnabled: true, backupFrequency: 'daily', auditLogEnabled: true, gdprCompliant: true },
      parentCompanyId: undefined,
      subsidiaries: [],
      isDefault: true
    },
    {
      id: "2",
      name: "Consultoria Empresarial S.A.",
      shortName: "ConsultEmp",
      industry: "Consulting",
      taxId: "98.765.432/0001-10",
      address: {
        street: "Rua das Flores, 500",
        city: "Rio de Janeiro",
        state: "RJ",
        zipCode: "22000-000",
        country: "Brasil"
      },
      contact: {
        phone: "+55 21 2000-0000",
        email: "contato@consultemp.com.br"
      },
      settings: {
        baseCurrency: "BRL",
        fiscalYearStart: "2024-01-01",
        timezone: "America/Sao_Paulo",
        dateFormat: "DD/MM/YYYY",
        numberFormat: "#,##0.00",
        language: "pt-BR"
      },
      branding: {
        primaryColor: "#059669",
        secondaryColor: "#dc2626"
      },
      status: "active",
      createdAt: "2024-02-15",
      updatedAt: "2024-02-15",
      usage: { apiCalls: 0, storageUsed: 0, activeUsers: 0, lastPulse: new Date().toISOString() },
      billing: { monthlyRevenue: 0, totalRevenue: 0 },
      subscription: { plan: "basic", status: "active", startDate: "2024-02-15", maxUsers: 5, usedUsers: 1, maxStorage: 20, usedStorage: 2, features: [] },
      compliance: { dataRetention: 365, encryptionEnabled: true, backupFrequency: 'daily', auditLogEnabled: true, gdprCompliant: true },
      parentCompanyId: undefined,
      subsidiaries: [],
      isDefault: false
    }
  ])

  const [companyGear, setCompanyGear] = useKV<CompanyGear[]>("company_settings", [])
  const [userAccess, setUserAccess] = useKV<UserCompanyAccess[]>("user_company_access", [])
  const [currentCompany, setCurrentCompany] = useKV<string>("current_company", "1")

  // Form states
  const [newCompany, setNewCompany] = useState({
    name: "",
    shortName: "",
    industry: "",
    taxId: "",
    street: "",
    city: "",
    state: "",
    zipCode: "",
    country: "Brasil",
    phone: "",
    email: "",
    website: "",
    baseCurrency: "BRL",
    fiscalYearStart: "",
    timezone: "America/Sao_Paulo",
    primaryColor: "#2563eb",
    secondaryColor: "#f59e0b"
  })

  const handleCreateCompany = () => {
    if (!newCompany.name || !newCompany.shortName || !newCompany.taxId) {
      return
    }

    const company: Company = {
      id: Date.now().toString(),
      name: newCompany.name,
      shortName: newCompany.shortName,
      industry: newCompany.industry,
      taxId: newCompany.taxId,
      address: {
        street: newCompany.street,
        city: newCompany.city,
        state: newCompany.state,
        zipCode: newCompany.zipCode,
        country: newCompany.country
      },
      contact: {
        phone: newCompany.phone,
        email: newCompany.email,
        website: newCompany.website
      },
      settings: {
        baseCurrency: newCompany.baseCurrency,
        fiscalYearStart: newCompany.fiscalYearStart || new Date().getFullYear() + "-01-01",
        timezone: newCompany.timezone,
        dateFormat: "DD/MM/YYYY",
        numberFormat: "#,##0.00",
        language: "pt-BR"
      },
      branding: {
        primaryColor: newCompany.primaryColor,
        secondaryColor: newCompany.secondaryColor
      },
      status: "active",
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
      isDefault: false,
      subscription: {
        plan: 'basic',
        status: 'active',
        startDate: new Date().toISOString().split('T')[0],
        maxUsers: 10,
        usedUsers: 0,
        maxStorage: 50,
        usedStorage: 0,
        features: []
      },
      billing: {
        monthlyRevenue: 0,
        totalRevenue: 0
      },
      usage: {
        apiCalls: 0,
        storageUsed: 0,
        activeUsers: 0,
        lastPulse: new Date().toISOString()
      },
      compliance: {
        dataRetention: 365,
        encryptionEnabled: true,
        backupFrequency: 'daily',
        auditLogEnabled: true,
        gdprCompliant: true
      },
      subsidiaries: []
    }

    setCompanies(prev => [...prev, company])

    // Reset form
    setNewCompany({
      name: "",
      shortName: "",
      industry: "",
      taxId: "",
      street: "",
      city: "",
      state: "",
      zipCode: "",
      country: "Brasil",
      phone: "",
      email: "",
      website: "",
      baseCurrency: "BRL",
      fiscalYearStart: "",
      timezone: "America/Sao_Paulo",
      primaryColor: "#2563eb",
      secondaryColor: "#f59e0b"
    })
  }

  const switchCompany = (companyId: string) => {
    setCurrentCompany(companyId)
  }

  const setDefaultCompany = (companyId: string) => {
    setCompanies(prev =>
      prev.map(company => ({
        ...company,
        isDefault: company.id === companyId
      }))
    )
  }

  const getCompanyStatusColor = (status: Company['status']) => {
    return status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
  }

  const getIndustryIcon = (industry: string) => {
    switch (industry.toLowerCase()) {
      case 'technology': return <Globe className="h-5 w-5" />
      case 'consulting': return <Users className="h-5 w-5" />
      case 'manufacturing': return <Factory className="h-5 w-5" />
      case 'finance': return <Bank className="h-5 w-5" />
      default: return <Buildings className="h-5 w-5" />
    }
  }

  const activeCompany = companies.find(c => c.id === currentCompany)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Buildings className="h-6 w-6 text-primary" />
            <span>Gestão Multi-Empresa</span>
          </h2>
          <p className="text-muted-foreground">
            Controle empresas independentes com configurações isoladas
          </p>
        </div>

        {/* Current Company Selector */}
        <div className="flex items-center space-x-4">
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Empresa Atual</p>
            <p className="font-medium">{activeCompany?.shortName}</p>
          </div>
          <Select value={currentCompany} onValueChange={switchCompany}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {companies.filter(c => c.status === 'active').map(company => (
                <SelectItem key={company.id} value={company.id}>
                  <div className="flex items-center space-x-2">
                    {getIndustryIcon(company.industry)}
                    <span>{company.shortName}</span>
                    {company.isDefault && (
                      <Badge variant="secondary" className="text-xs">Padrão</Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Buildings className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Empresas</p>
                <p className="text-2xl font-bold">{companies.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Factory className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Empresas Ativas</p>
                <p className="text-2xl font-bold text-green-600">
                  {companies.filter(c => c.status === 'active').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Globe className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Países</p>
                <p className="text-2xl font-bold text-purple-600">
                  {new Set(companies.map(c => c.address.country)).size}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <CurrencyDollar className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Moedas</p>
                <p className="text-2xl font-bold text-orange-600">
                  {new Set(companies.map(c => c.settings.baseCurrency)).size}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="companies">Empresas</TabsTrigger>
          <TabsTrigger value="settings">Configurações</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
        </TabsList>

        <TabsContent value="companies" className="space-y-6">
          {/* New Company Form */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Cadastrar Nova Empresa</CardTitle>
              <CardDescription>
                Adicione uma nova empresa ao sistema multi-tenant
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Nome da Empresa</label>
                  <Input
                    placeholder="Ex: Tech Solutions Ltda"
                    value={newCompany.name}
                    onChange={(e) => setNewCompany(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Nome Abreviado</label>
                  <Input
                    placeholder="Ex: TechSol"
                    value={newCompany.shortName}
                    onChange={(e) => setNewCompany(prev => ({ ...prev, shortName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">CNPJ</label>
                  <Input
                    placeholder="00.000.000/0000-00"
                    value={newCompany.taxId}
                    onChange={(e) => setNewCompany(prev => ({ ...prev, taxId: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Setor</label>
                  <Select value={newCompany.industry} onValueChange={(value) =>
                    setNewCompany(prev => ({ ...prev, industry: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o setor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Technology">Tecnologia</SelectItem>
                      <SelectItem value="Consulting">Consultoria</SelectItem>
                      <SelectItem value="Manufacturing">Manufatura</SelectItem>
                      <SelectItem value="Finance">Financeiro</SelectItem>
                      <SelectItem value="Healthcare">Saúde</SelectItem>
                      <SelectItem value="Education">Educação</SelectItem>
                      <SelectItem value="Retail">Varejo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Moeda Base</label>
                  <Select value={newCompany.baseCurrency} onValueChange={(value) =>
                    setNewCompany(prev => ({ ...prev, baseCurrency: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BRL">Real Brasileiro (BRL)</SelectItem>
                      <SelectItem value="USD">Dólar Americano (USD)</SelectItem>
                      <SelectItem value="EUR">Euro (EUR)</SelectItem>
                      <SelectItem value="GBP">Libra Esterlina (GBP)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium">Endereço</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Logradouro</label>
                    <Input
                      placeholder="Rua, Av., etc."
                      value={newCompany.street}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, street: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Cidade</label>
                    <Input
                      placeholder="Nome da cidade"
                      value={newCompany.city}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, city: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium">Estado</label>
                    <Input
                      placeholder="SP"
                      value={newCompany.state}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, state: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">CEP</label>
                    <Input
                      placeholder="00000-000"
                      value={newCompany.zipCode}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, zipCode: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">País</label>
                    <Input
                      value={newCompany.country}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, country: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium">Contato</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium">Telefone</label>
                    <Input
                      placeholder="+55 11 0000-0000"
                      value={newCompany.phone}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, phone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">E-mail</label>
                    <Input
                      type="email"
                      placeholder="contato@empresa.com"
                      value={newCompany.email}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Website</label>
                    <Input
                      placeholder="www.empresa.com"
                      value={newCompany.website}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, website: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <Button onClick={handleCreateCompany} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Cadastrar Empresa
              </Button>
            </CardContent>
          </Card>

          {/* Companies List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {companies.map(company => (
              <Card key={company.id} className="glass-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        {getIndustryIcon(company.industry)}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{company.shortName}</CardTitle>
                        <CardDescription>{company.industry}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {company.isDefault && (
                        <Badge variant="default" className="text-xs">Padrão</Badge>
                      )}
                      <Badge className={getCompanyStatusColor(company.status)}>
                        {company.status === 'active' ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">{company.name}</h4>
                    <p className="text-sm text-muted-foreground">CNPJ: {company.taxId}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{company.address.city}, {company.address.state}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{company.contact.phone}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm">
                      <Envelope className="h-4 w-4 text-muted-foreground" />
                      <span>{company.contact.email}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm">
                      <CurrencyDollar className="h-4 w-4 text-muted-foreground" />
                      <span>Moeda: {company.settings.baseCurrency}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => switchCompany(company.id)}
                      disabled={company.id === currentCompany}
                    >
                      {company.id === currentCompany ? (
                        <>
                          <Eye className="h-4 w-4 mr-2" />
                          Atual
                        </>
                      ) : (
                        'Acessar'
                      )}
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Gear className="h-4 w-4 mr-2" />
                      Config
                    </Button>
                    {!company.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDefaultCompany(company.id)}
                      >
                        Def. Padrão
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          {activeCompany && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Configurações - {activeCompany.shortName}</CardTitle>
                <CardDescription>
                  Configurações específicas da empresa selecionada
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-medium">Configurações Regionais</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium">Fuso Horário</label>
                        <Select value={activeCompany.settings.timezone}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                            <SelectItem value="America/New_York">America/New_York</SelectItem>
                            <SelectItem value="Europe/London">Europe/London</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Formato de Data</label>
                        <Select value={activeCompany.settings.dateFormat}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                            <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                            <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Moeda Base</label>
                        <Select value={activeCompany.settings.baseCurrency}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="BRL">Real Brasileiro (BRL)</SelectItem>
                            <SelectItem value="USD">Dólar Americano (USD)</SelectItem>
                            <SelectItem value="EUR">Euro (EUR)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-medium">Configurações de Sistema</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-medium">Aprovação de Vendas</label>
                          <p className="text-xs text-muted-foreground">Exigir aprovação para vendas</p>
                        </div>
                        <Switch />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-medium">Controle de Estoque</label>
                          <p className="text-xs text-muted-foreground">Ativar gestão de estoque</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-medium">Multi-Moeda</label>
                          <p className="text-xs text-muted-foreground">Permitir transações em outras moedas</p>
                        </div>
                        <Switch />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Personalização Visual</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Cor Primária</label>
                      <div className="flex items-center space-x-2">
                        <div
                          className="w-8 h-8 rounded border"
                          style={{ backgroundColor: activeCompany.branding?.primaryColor || '#000000' }}
                        ></div>
                        <Input value={activeCompany.branding?.primaryColor || ''} readOnly />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Cor Secundária</label>
                      <div className="flex items-center space-x-2">
                        <div
                          className="w-8 h-8 rounded border"
                          style={{ backgroundColor: activeCompany.branding?.secondaryColor || '#000000' }}
                        ></div>
                        <Input value={activeCompany.branding?.secondaryColor || ''} readOnly />
                      </div>
                    </div>
                  </div>
                </div>

                <Button className="w-full">
                  Salvar Configurações
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Gestão de Usuários Multi-Empresa</CardTitle>
              <CardDescription>
                Controle acesso de usuários por empresa e permissões
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Funcionalidade de gestão de usuários em desenvolvimento</p>
                <Button className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar Usuário
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
                <h3 className="font-semibold mb-2">Relatório Consolidado</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Dados agregados de todas as empresas
                </p>
                <Button className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <Buildings className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Por Empresa</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Relatórios individuais por empresa
                </p>
                <Button className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <Globe className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Comparativo</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Análise comparativa entre empresas
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
