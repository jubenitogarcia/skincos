import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Label } from "@/label"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { Switch } from "@/switch"
import { CheckCirclebox } from "@/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/table"
import { Separator } from "@/separator"
import { Slider } from "@/slider"
import { Progress } from "@/progress"
import { toast } from 'sonner'
import {
  Shield,
  Users,
  Gear,
  Key,
  Lock,
  Eye,
  EyeSlash,
  Plus,
  PencilSimple,
  Trash,
  Copy,
  CheckCircle,
  XCircle,
  Warning,
  Clock,
  Database,
  Globe,
  Envelope,
  Phone,
  CalendarBlank,
  FileText,
  ChartBar,
  Bug,
  Download,
  Upload,
  Crown,
  UserCircle,
  Building,
  Package,
  CurrencyDollar,
  Lightning,
  Cpu
} from "@phosphor-icons/react"

interface Permission {
  id: string
  name: string
  description: string
  module: string
  resource: string
  actions: PermissionAction[]
}

interface PermissionAction {
  action: 'read' | 'write' | 'create' | 'delete' | 'execute' | 'approve' | 'export' | 'import'
  name: string
  description: string
}

interface Role {
  id: string
  name: string
  description: string
  type: 'system' | 'custom'
  permissions: string[]
  inheritFrom?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface User {
  id: string
  name: string
  email: string
  roles: string[]
  isActive: boolean
  lastLogin?: string
  ipWhitelist: string[]
  sessionTimeout: number // in minutes
  mfaEnabled: boolean
  apiAccess: boolean
  department?: string
  manager?: string
  createdAt: string
}

interface SecurityPolicy {
  id: string
  name: string
  description: string
  rules: SecurityRule[]
  isActive: boolean
  appliedTo: 'all' | 'roles' | 'users'
  targets: string[]
}

interface SecurityRule {
  type: 'password' | 'session' | 'ip' | 'time' | 'api' | 'data'
  condition: string
  value: string | number | boolean
  action: 'allow' | 'deny' | 'require_approval' | 'log_only'
}

interface AuditLog {
  id: string
  userId: string
  userName: string
  action: string
  resource: string
  resourceId?: string
  timestamp: string
  ipAddress: string
  userAgent: string
  status: 'success' | 'failed' | 'blocked'
  details?: string
}

interface SystemSetting {
  id: string
  category: string
  key: string
  name: string
  description: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'json'
  value: any
  defaultValue: any
  options?: string[]
  validation?: {
    required?: boolean
    min?: number
    max?: number
    pattern?: string
  }
  isEditable: boolean
  requiresRestart: boolean
}

export function AdvancedPermissionsManager() {
  const [permissions, setPermissions] = useKV<Permission[]>("permissions", [])
  const [roles, setRoles] = useKV<Role[]>("roles", [])
  const [users, setUsers] = useKV<User[]>("permission-users", [])
  const [securityPolicies, setSecurityPolicies] = useKV<SecurityPolicy[]>("security-policies", [])
  const [auditLogs, setAuditLogs] = useKV<AuditLog[]>("audit-logs", [])
  const [systemGear, setSystemGear] = useKV<SystemSetting[]>("system-settings", [])
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [selectedPolicy, setSelectedPolicy] = useState<SecurityPolicy | null>(null)
  const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false)
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false)
  const [isCreatePolicyOpen, setIsCreatePolicyOpen] = useState(false)
  const [isEditRoleOpen, setIsEditRoleOpen] = useState(false)
  const [isEditUserOpen, setIsEditUserOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("permissions")

  // Initialize with sample data if empty
  useEffect(() => {
    if (permissions.length === 0) {
      const samplePermissions: Permission[] = [
        {
          id: "1",
          name: "Gerenciar Leads",
          description: "Permissões para gerenciar leads no sistema",
          module: "CRM",
          resource: "leads",
          actions: [
            { action: "read", name: "Visualizar", description: "Ver lista e detalhes de leads" },
            { action: "write", name: "Editar", description: "Editar informações de leads" },
            { action: "create", name: "Criar", description: "Criar novos leads" },
            { action: "delete", name: "Excluir", description: "Excluir leads do sistema" },
            { action: "export", name: "Exportar", description: "Exportar dados de leads" }
          ]
        },
        {
          id: "2",
          name: "Gerenciar Oportunidades",
          description: "Permissões para gerenciar pipeline de vendas",
          module: "CRM",
          resource: "opportunities",
          actions: [
            { action: "read", name: "Visualizar", description: "Ver pipeline e oportunidades" },
            { action: "write", name: "Editar", description: "Editar oportunidades" },
            { action: "create", name: "Criar", description: "Criar novas oportunidades" },
            { action: "approve", name: "Aprovar", description: "Aprovar fechamento de deals" }
          ]
        },
        {
          id: "3",
          name: "Configurações do Sistema",
          description: "Acesso às configurações gerais do sistema",
          module: "System",
          resource: "settings",
          actions: [
            { action: "read", name: "Visualizar", description: "Ver configurações" },
            { action: "write", name: "Editar", description: "Alterar configurações" }
          ]
        },
        {
          id: "4",
          name: "Gestão de Usuários",
          description: "Gerenciar usuários e permissões",
          module: "System",
          resource: "users",
          actions: [
            { action: "read", name: "Visualizar", description: "Ver lista de usuários" },
            { action: "write", name: "Editar", description: "Editar usuários" },
            { action: "create", name: "Criar", description: "Criar novos usuários" },
            { action: "delete", name: "Excluir", description: "Excluir usuários" }
          ]
        },
        {
          id: "5",
          name: "Relatórios Financeiros",
          description: "Acesso a relatórios financeiros e contábeis",
          module: "Finance",
          resource: "reports",
          actions: [
            { action: "read", name: "Visualizar", description: "Ver relatórios financeiros" },
            { action: "export", name: "Exportar", description: "Exportar relatórios" }
          ]
        }
      ]
      setPermissions(samplePermissions)
    }

    if (roles.length === 0) {
      const sampleRoles: Role[] = [
        {
          id: "1",
          name: "Administrador",
          description: "Acesso total ao sistema",
          type: "system",
          permissions: ["1", "2", "3", "4", "5"],
          isActive: true,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z"
        },
        {
          id: "2",
          name: "Gerente de Vendas",
          description: "Gerenciar equipe de vendas e pipeline",
          type: "custom",
          permissions: ["1", "2"],
          isActive: true,
          createdAt: "2024-01-15T10:00:00Z",
          updatedAt: "2024-03-10T14:30:00Z"
        },
        {
          id: "3",
          name: "Vendedor",
          description: "Acesso básico para vendedores",
          type: "custom",
          permissions: ["1"],
          inheritFrom: "2",
          isActive: true,
          createdAt: "2024-01-20T09:00:00Z",
          updatedAt: "2024-02-15T16:45:00Z"
        },
        {
          id: "4",
          name: "Financeiro",
          description: "Acesso a módulos financeiros",
          type: "custom",
          permissions: ["5"],
          isActive: true,
          createdAt: "2024-02-01T11:30:00Z",
          updatedAt: "2024-03-05T12:00:00Z"
        }
      ]
      setRoles(sampleRoles)
    }

    if (users.length === 0) {
      const sampleUsers: User[] = [
        {
          id: "1",
          name: "Ana Silva",
          email: "ana@empresa.com",
          roles: ["1"],
          isActive: true,
          lastLogin: "2024-03-15T09:30:00Z",
          ipWhitelist: ["192.168.1.100", "10.0.0.50"],
          sessionTimeout: 480,
          mfaEnabled: true,
          apiAccess: true,
          department: "TI",
          createdAt: "2024-01-01T00:00:00Z"
        },
        {
          id: "2",
          name: "João Santos",
          email: "joao@empresa.com",
          roles: ["2"],
          isActive: true,
          lastLogin: "2024-03-15T11:15:00Z",
          ipWhitelist: [],
          sessionTimeout: 240,
          mfaEnabled: false,
          apiAccess: false,
          department: "Vendas",
          manager: "1",
          createdAt: "2024-01-15T10:00:00Z"
        },
        {
          id: "3",
          name: "Maria Costa",
          email: "maria@empresa.com",
          roles: ["3"],
          isActive: true,
          lastLogin: "2024-03-14T16:20:00Z",
          ipWhitelist: [],
          sessionTimeout: 240,
          mfaEnabled: false,
          apiAccess: false,
          department: "Vendas",
          manager: "2",
          createdAt: "2024-02-01T09:00:00Z"
        }
      ]
      setUsers(sampleUsers)
    }

    if (securityPolicies.length === 0) {
      const samplePolicies: SecurityPolicy[] = [
        {
          id: "1",
          name: "Política de Senhas Seguras",
          description: "Exige senhas complexas com pelo menos 8 caracteres",
          rules: [
            {
              type: "password",
              condition: "min_length",
              value: 8,
              action: "deny"
            },
            {
              type: "password",
              condition: "require_uppercase",
              value: true,
              action: "deny"
            },
            {
              type: "password",
              condition: "require_numbers",
              value: true,
              action: "deny"
            }
          ],
          isActive: true,
          appliedTo: "all",
          targets: []
        },
        {
          id: "2",
          name: "Restrição de Horário Comercial",
          description: "Permite acesso apenas em horário comercial",
          rules: [
            {
              type: "time",
              condition: "allowed_hours",
              value: "08:00-18:00",
              action: "deny"
            }
          ],
          isActive: false,
          appliedTo: "roles",
          targets: ["3"]
        },
        {
          id: "3",
          name: "Limite de Tentativas de Login",
          description: "Bloqueia conta após 5 tentativas falhadas",
          rules: [
            {
              type: "session",
              condition: "max_failed_attempts",
              value: 5,
              action: "deny"
            }
          ],
          isActive: true,
          appliedTo: "all",
          targets: []
        }
      ]
      setSecurityPolicies(samplePolicies)
    }

    if (auditLogs.length === 0) {
      const sampleLogs: AuditLog[] = [
        {
          id: "1",
          userId: "1",
          userName: "Ana Silva",
          action: "login",
          resource: "system",
          timestamp: "2024-03-15T09:30:00Z",
          ipAddress: "192.168.1.100",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          status: "success"
        },
        {
          id: "2",
          userId: "2",
          userName: "João Santos",
          action: "create",
          resource: "lead",
          resourceId: "lead-123",
          timestamp: "2024-03-15T10:15:00Z",
          ipAddress: "192.168.1.101",
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          status: "success",
          details: "Criou lead para TechCorp Solutions"
        },
        {
          id: "3",
          userId: "3",
          userName: "Maria Costa",
          action: "access_denied",
          resource: "settings",
          timestamp: "2024-03-15T11:45:00Z",
          ipAddress: "192.168.1.102",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)",
          status: "blocked",
          details: "Tentativa de acesso a configurações sem permissão"
        }
      ]
      setAuditLogs(sampleLogs)
    }

    if (systemGear.length === 0) {
      const sampleGear: SystemSetting[] = [
        {
          id: "1",
          category: "Security",
          key: "session_timeout",
          name: "Timeout de Sessão",
          description: "Tempo limite para sessões inativas (em minutos)",
          type: "number",
          value: 240,
          defaultValue: 240,
          validation: { required: true, min: 15, max: 1440 },
          isEditable: true,
          requiresRestart: false
        },
        {
          id: "2",
          category: "Security",
          key: "password_policy",
          name: "Política de Senhas",
          description: "Configurações de política de senhas",
          type: "json",
          value: {
            minLength: 8,
            requireUppercase: true,
            requireNumbers: true,
            requireSpecialChars: false,
            expirationDays: 90
          },
          defaultValue: {
            minLength: 6,
            requireUppercase: false,
            requireNumbers: false,
            requireSpecialChars: false,
            expirationDays: 0
          },
          isEditable: true,
          requiresRestart: false
        },
        {
          id: "3",
          category: "System",
          key: "api_rate_limit",
          name: "Limite de Rate API",
          description: "Número máximo de requisições por minuto por usuário",
          type: "number",
          value: 100,
          defaultValue: 60,
          validation: { required: true, min: 10, max: 1000 },
          isEditable: true,
          requiresRestart: true
        },
        {
          id: "4",
          category: "Features",
          key: "enable_webhooks",
          name: "Habilitar Webhooks",
          description: "Permite configuração de webhooks",
          type: "boolean",
          value: true,
          defaultValue: false,
          isEditable: true,
          requiresRestart: false
        },
        {
          id: "5",
          category: "Notifications",
          key: "email_provider",
          name: "Provedor de E-mail",
          description: "Provedor para envio de e-mails",
          type: "select",
          value: "smtp",
          defaultValue: "smtp",
          options: ["smtp", "sendgrid", "mailgun", "ses"],
          isEditable: true,
          requiresRestart: true
        }
      ]
      setSystemGear(sampleGear)
    }
  }, [permissions.length, roles.length, users.length, securityPolicies.length, auditLogs.length, systemGear.length, setPermissions, setRoles, setUsers, setSecurityPolicies, setAuditLogs, setSystemGear])

  const handleCreateRole = (roleData: Partial<Role>) => {
    const newRole: Role = {
      id: Date.now().toString(),
      name: roleData.name || "",
      description: roleData.description || "",
      type: "custom",
      permissions: roleData.permissions || [],
      inheritFrom: roleData.inheritFrom,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setRoles(prev => [...prev, newRole])
    setIsCreateRoleOpen(false)
    toast.success("Papel criado com sucesso!")
  }

  const handleEditRole = (roleData: Partial<Role>) => {
    if (!selectedRole) return

    setRoles(prev => prev.map(role =>
      role.id === selectedRole.id
        ? { ...role, ...roleData, updatedAt: new Date().toISOString() }
        : role
    ))
    setIsEditRoleOpen(false)
    setSelectedRole(null)
    toast.success("Papel atualizado com sucesso!")
  }

  const handleDeleteRole = (roleId: string) => {
    setRoles(prev => prev.filter(role => role.id !== roleId))
    toast.success("Papel removido com sucesso!")
  }

  const handleCreateUser = (userData: Partial<User>) => {
    const newUser: User = {
      id: Date.now().toString(),
      name: userData.name || "",
      email: userData.email || "",
      roles: userData.roles || [],
      isActive: true,
      ipWhitelist: userData.ipWhitelist || [],
      sessionTimeout: userData.sessionTimeout || 240,
      mfaEnabled: userData.mfaEnabled || false,
      apiAccess: userData.apiAccess || false,
      department: userData.department,
      manager: userData.manager,
      createdAt: new Date().toISOString()
    }

    setUsers(prev => [...prev, newUser])
    setIsCreateUserOpen(false)
    toast.success("Usuário criado com sucesso!")
  }

  const handleToggleUserStatus = (userId: string) => {
    setUsers(prev => prev.map(user =>
      user.id === userId
        ? { ...user, isActive: !user.isActive }
        : user
    ))
    toast.success("Status do usuário alterado!")
  }

  const handleUpdateSystemSetting = (settingId: string, newValue: any) => {
    setSystemGear(prev => prev.map(setting =>
      setting.id === settingId
        ? { ...setting, value: newValue }
        : setting
    ))

    const setting = systemGear.find(s => s.id === settingId)
    if (setting?.requiresRestart) {
      toast.warning("Esta alteração requer reinicialização do sistema para ter efeito.")
    } else {
      toast.success("Configuração atualizada com sucesso!")
    }
  }

  const getPermissionIcon = (module: string) => {
    switch (module) {
      case 'CRM': return <Users className="h-4 w-4" />
      case 'System': return <Gear className="h-4 w-4" />
      case 'Finance': return <CurrencyDollar className="h-4 w-4" />
      default: return <Package className="h-4 w-4" />
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'failed': return <XCircle className="h-4 w-4 text-red-600" />
      case 'blocked': return <Shield className="h-4 w-4 text-yellow-600" />
      default: return <Clock className="h-4 w-4 text-gray-600" />
    }
  }

  const getRoleTypeIcon = (type: string) => {
    return type === 'system' ? <Crown className="h-4 w-4 text-yellow-600" /> : <UserCircle className="h-4 w-4 text-blue-600" />
  }

  // Calculate summary statistics
  const totalPermissions = permissions.length
  const totalRoles = roles.length
  const activeUsers = users.filter(u => u.isActive).length
  const mfaEnabledUsers = users.filter(u => u.mfaEnabled).length
  const recentAuditLogs = auditLogs.filter(log => {
    const logDate = new Date(log.timestamp)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return logDate >= yesterday
  }).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Gestão Avançada de Permissões</h2>
          <p className="text-muted-foreground">
            Configure permissões, papéis e políticas de segurança do sistema
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Dialog open={isCreateRoleOpen} onOpenChange={setIsCreateRoleOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Shield className="h-4 w-4 mr-2" />
                Novo Papel
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Novo Papel</DialogTitle>
              </DialogHeader>
              <RoleForm
                permissions={permissions}
                roles={roles}
                onSubmit={handleCreateRole}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo Usuário
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Novo Usuário</DialogTitle>
              </DialogHeader>
              <UserForm
                roles={roles}
                users={users}
                onSubmit={handleCreateUser}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Overview Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Key className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Permissões</p>
                <p className="text-2xl font-bold">{totalPermissions}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Shield className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Papéis</p>
                <p className="text-2xl font-bold">{totalRoles}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Usuários Ativos</p>
                <p className="text-2xl font-bold">{activeUsers}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Lock className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">MFA Habilitado</p>
                <p className="text-2xl font-bold">{mfaEnabledUsers}</p>
                <p className="text-xs text-green-600">
                  {activeUsers > 0 ? Math.round((mfaEnabledUsers / activeUsers) * 100) : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <FileText className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Logs 24h</p>
                <p className="text-2xl font-bold">{recentAuditLogs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="permissions">Permissões</TabsTrigger>
          <TabsTrigger value="roles">Papéis</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
          <TabsTrigger value="settings">Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="permissions" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {permissions.map((permission) => (
              <Card key={permission.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getPermissionIcon(permission.module)}
                      <CardTitle className="text-lg">{permission.name}</CardTitle>
                    </div>
                    <Badge variant="outline">{permission.module}</Badge>
                  </div>
                  <CardDescription>{permission.description}</CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      RECURSO: {permission.resource}
                    </Label>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-2 block">
                      AÇÕES DISPONÍVEIS
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {permission.actions.map((action) => (
                        <div key={action.action} className="flex items-center space-x-2">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          <span className="text-sm">{action.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="roles" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {roles.map((role) => (
              <Card key={role.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getRoleTypeIcon(role.type)}
                      <CardTitle className="text-lg">{role.name}</CardTitle>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={role.isActive ? "default" : "secondary"}>
                        {role.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedRole(role)
                          setIsEditRoleOpen(true)
                        }}
                      >
                        <PencilSimple className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>{role.description}</CardDescription>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline">
                      {role.type === 'system' ? 'Sistema' : 'Personalizado'}
                    </Badge>
                    {role.inheritFrom && (
                      <Badge variant="secondary">
                        Herda de: {roles.find(r => r.id === role.inheritFrom)?.name}
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      PERMISSÕES ({role.permissions.length})
                    </Label>
                    <div className="mt-2 space-y-1">
                      {role.permissions.slice(0, 3).map((permissionId) => {
                        const permission = permissions.find(p => p.id === permissionId)
                        return permission ? (
                          <div key={permissionId} className="flex items-center space-x-2">
                            {getPermissionIcon(permission.module)}
                            <span className="text-sm">{permission.name}</span>
                          </div>
                        ) : null
                      })}
                      {role.permissions.length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          +{role.permissions.length - 3} mais permissões
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex space-x-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setRoles(prev => prev.map(r =>
                          r.id === role.id ? { ...r, isActive: !r.isActive } : r
                        ))
                      }}
                    >
                      {role.isActive ? "Desativar" : "Ativar"}
                    </Button>
                    {role.type === 'custom' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteRole(role.id)}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Usuários do Sistema</CardTitle>
              <CardDescription>
                Gerencie usuários, papéis e configurações de segurança
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Papéis</TableHead>
                    <TableHead>Departamento</TableHead>
                    <TableHead>MFA</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Último Login</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.map((roleId) => {
                            const role = roles.find(r => r.id === roleId)
                            return role ? (
                              <Badge key={roleId} variant="secondary" className="text-xs">
                                {role.name}
                              </Badge>
                            ) : null
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.department || 'N/A'}</Badge>
                      </TableCell>
                      <TableCell>
                        {user.mfaEnabled ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.isActive ? "default" : "secondary"}>
                          {user.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.lastLogin ? (
                          <span className="text-sm">
                            {new Date(user.lastLogin).toLocaleDateString('pt-BR')}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Nunca</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(user)
                              setIsEditUserOpen(true)
                            }}
                          >
                            <PencilSimple className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleUserStatus(user.id)}
                          >
                            {user.isActive ? (
                              <EyeSlash className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {securityPolicies.map((policy) => (
              <Card key={policy.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{policy.name}</CardTitle>
                    <Badge variant={policy.isActive ? "default" : "secondary"}>
                      {policy.isActive ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <CardDescription>{policy.description}</CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      REGRAS ({policy.rules.length})
                    </Label>
                    <div className="mt-2 space-y-2">
                      {policy.rules.map((rule, index) => (
                        <div key={index} className="p-2 bg-muted rounded text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{rule.type}</span>
                            <Badge variant="outline" className="text-xs">
                              {rule.action}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground">
                            {rule.condition}: {rule.value?.toString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      APLICADO A
                    </Label>
                    <div className="mt-1">
                      <Badge variant="outline">
                        {policy.appliedTo === 'all' ? 'Todos os usuários' :
                          policy.appliedTo === 'roles' ? 'Papéis específicos' :
                            'Usuários específicos'}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex space-x-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSecurityPolicies(prev => prev.map(p =>
                          p.id === policy.id ? { ...p, isActive: !p.isActive } : p
                        ))
                      }}
                    >
                      {policy.isActive ? "Desativar" : "Ativar"}
                    </Button>
                    <Button variant="outline" size="sm">
                      <PencilSimple className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="audit" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Log de Auditoria</CardTitle>
              <CardDescription>
                Histórico de ações realizadas no sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Recurso</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.slice(0, 10).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{log.userName}</p>
                          <p className="text-xs text-muted-foreground">{log.userId}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.action}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{log.resource}</span>
                        {log.resourceId && (
                          <p className="text-xs text-muted-foreground">{log.resourceId}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(log.status)}
                          <span className="capitalize">{log.status}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{log.ipAddress}</code>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {new Date(log.timestamp).toLocaleString('pt-BR')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          {['Security', 'System', 'Features', 'Notifications'].map((category) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{category}</CardTitle>
                <CardDescription>
                  Configurações de {category.toLowerCase()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {systemGear
                    .filter(setting => setting.category === category)
                    .map((setting) => (
                      <div key={setting.id} className="flex items-center justify-between">
                        <div className="flex-1">
                          <Label className="font-medium">{setting.name}</Label>
                          <p className="text-sm text-muted-foreground">{setting.description}</p>
                          {setting.requiresRestart && (
                            <Badge variant="outline" className="mt-1">
                              <Warning className="h-3 w-3 mr-1" />
                              Requer reinicialização
                            </Badge>
                          )}
                        </div>
                        <div className="w-64">
                          {setting.type === 'boolean' && (
                            <Switch
                              checked={setting.value}
                              onCheckedChange={(checked) => handleUpdateSystemSetting(setting.id, checked)}
                              disabled={!setting.isEditable}
                            />
                          )}
                          {setting.type === 'number' && (
                            <Input
                              type="number"
                              value={setting.value}
                              onChange={(e) => handleUpdateSystemSetting(setting.id, parseInt(e.target.value))}
                              disabled={!setting.isEditable}
                              min={setting.validation?.min}
                              max={setting.validation?.max}
                            />
                          )}
                          {setting.type === 'string' && (
                            <Input
                              value={setting.value}
                              onChange={(e) => handleUpdateSystemSetting(setting.id, e.target.value)}
                              disabled={!setting.isEditable}
                            />
                          )}
                          {setting.type === 'select' && (
                            <Select
                              value={setting.value}
                              onValueChange={(value) => handleUpdateSystemSetting(setting.id, value)}
                              disabled={!setting.isEditable}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {setting.options?.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Edit Role Modal */}
      <Dialog open={isEditRoleOpen} onOpenChange={setIsEditRoleOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Papel</DialogTitle>
          </DialogHeader>
          {selectedRole && (
            <RoleForm
              role={selectedRole}
              permissions={permissions}
              roles={roles}
              onSubmit={handleEditRole}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit User Modal */}
      <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <UserForm
              user={selectedUser}
              roles={roles}
              users={users}
              onSubmit={(userData) => {
                setUsers(prev => prev.map(user =>
                  user.id === selectedUser.id
                    ? { ...user, ...userData }
                    : user
                ))
                setIsEditUserOpen(false)
                setSelectedUser(null)
                toast.success("Usuário atualizado com sucesso!")
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Role Form Component
function RoleForm({
  role,
  permissions,
  roles,
  onSubmit
}: {
  role?: Role
  permissions: Permission[]
  roles: Role[]
  onSubmit: (data: Partial<Role>) => void
}) {
  const [formData, setFormData] = useState({
    name: role?.name || "",
    description: role?.description || "",
    permissions: role?.permissions || [],
    inheritFrom: role?.inheritFrom || ""
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome do Papel</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: Gerente de Vendas"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="inheritFrom">Herdar de (opcional)</Label>
          <Select
            value={formData.inheritFrom}
            onValueChange={(value) => setFormData(prev => ({ ...prev, inheritFrom: value }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecionar papel base" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Nenhum</SelectItem>
              {roles.filter(r => r.id !== role?.id).map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descrição</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Descreva as responsabilidades deste papel..."
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label>Permissões</Label>
        <div className="grid grid-cols-1 gap-3 max-h-64 overflow-y-auto border rounded-lg p-4">
          {permissions.map((permission) => (
            <div key={permission.id} className="flex items-start space-x-3">
              <CheckCirclebox
                id={`permission-${permission.id}`}
                checked={formData.permissions.includes(permission.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setFormData(prev => ({
                      ...prev,
                      permissions: [...prev.permissions, permission.id]
                    }))
                  } else {
                    setFormData(prev => ({
                      ...prev,
                      permissions: prev.permissions.filter(id => id !== permission.id)
                    }))
                  }
                }}
              />
              <div className="flex-1">
                <Label htmlFor={`permission-${permission.id}`} className="font-medium">
                  {permission.name}
                </Label>
                <p className="text-sm text-muted-foreground">{permission.description}</p>
                <Badge variant="outline" className="mt-1">
                  {permission.module}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline">
          Cancelar
        </Button>
        <Button type="submit">
          {role ? "Atualizar" : "Criar"} Papel
        </Button>
      </div>
    </form>
  )
}

// User Form Component
function UserForm({
  user,
  roles,
  users,
  onSubmit
}: {
  user?: User
  roles: Role[]
  users: User[]
  onSubmit: (data: Partial<User>) => void
}) {
  const [formData, setFormData] = useState({
    name: user?.name || "",
    email: user?.email || "",
    roles: user?.roles || [],
    department: user?.department || "",
    manager: user?.manager || "",
    sessionTimeout: user?.sessionTimeout || 240,
    mfaEnabled: user?.mfaEnabled || false,
    apiAccess: user?.apiAccess || false,
    ipWhitelist: user?.ipWhitelist?.join(', ') || ""
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      ...formData,
      ipWhitelist: formData.ipWhitelist.split(',').map(ip => ip.trim()).filter(ip => ip)
    })
  }

  const availableManagers = users.filter(u => u.id !== user?.id)

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome Completo</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: João Silva"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
            placeholder="joao@empresa.com"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="department">Departamento</Label>
          <Input
            id="department"
            value={formData.department}
            onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
            placeholder="Ex: Vendas"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="manager">Gerente</Label>
          <Select
            value={formData.manager}
            onValueChange={(value) => setFormData(prev => ({ ...prev, manager: value }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecionar gerente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Nenhum</SelectItem>
              {availableManagers.map((manager) => (
                <SelectItem key={manager.id} value={manager.id}>
                  {manager.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Papéis</Label>
        <div className="grid grid-cols-2 gap-2">
          {roles.filter(r => r.isActive).map((role) => (
            <div key={role.id} className="flex items-center space-x-2">
              <CheckCirclebox
                id={`role-${role.id}`}
                checked={formData.roles.includes(role.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setFormData(prev => ({
                      ...prev,
                      roles: [...prev.roles, role.id]
                    }))
                  } else {
                    setFormData(prev => ({
                      ...prev,
                      roles: prev.roles.filter(id => id !== role.id)
                    }))
                  }
                }}
              />
              <Label htmlFor={`role-${role.id}`} className="text-sm">
                {role.name}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sessionTimeout">Timeout de Sessão (minutos)</Label>
          <Input
            id="sessionTimeout"
            type="number"
            min="15"
            max="1440"
            value={formData.sessionTimeout}
            onChange={(e) => setFormData(prev => ({ ...prev, sessionTimeout: parseInt(e.target.value) }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ipWhitelist">IPs Permitidos (separados por vírgula)</Label>
          <Input
            id="ipWhitelist"
            value={formData.ipWhitelist}
            onChange={(e) => setFormData(prev => ({ ...prev, ipWhitelist: e.target.value }))}
            placeholder="192.168.1.100, 10.0.0.50"
          />
        </div>

        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <CheckCirclebox
              id="mfaEnabled"
              checked={formData.mfaEnabled}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, mfaEnabled: !!checked }))}
            />
            <Label htmlFor="mfaEnabled">Habilitar MFA</Label>
          </div>

          <div className="flex items-center space-x-2">
            <CheckCirclebox
              id="apiAccess"
              checked={formData.apiAccess}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, apiAccess: !!checked }))}
            />
            <Label htmlFor="apiAccess">Acesso à API</Label>
          </div>
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline">
          Cancelar
        </Button>
        <Button type="submit">
          {user ? "Atualizar" : "Criar"} Usuário
        </Button>
      </div>
    </form>
  )
}
