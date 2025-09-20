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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import {
  Plus,
  Trash,
  PencilSimple,
  Shield,
  Users,
  Crown,
  Key,
  Lock,
  Eye,
  EyeSlash,
  Warning,
  CheckCircle,
  X,
  Gear,
  Globe,
  Building,
  User
} from "@phosphor-icons/react"

export interface Permission {
  id: string
  resource: string
  action: 'create' | 'read' | 'update' | 'delete' | 'admin'
  granted: boolean
  conditions?: {
    field?: string
    operator?: 'equals' | 'not_equals' | 'in' | 'not_in'
    value?: any
  }[]
}

export interface Role {
  id: string
  name: string
  description: string
  isSystem: boolean
  isDefault: boolean
  permissions: Permission[]
  color: string
  icon: string
  hierarchy: number // 0 = lowest, 100 = highest
  createdAt: string
  updatedAt: string
  createdBy: string
}

export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  status: 'active' | 'inactive' | 'pending' | 'suspended'
  roles: string[]
  directPermissions: Permission[]
  lastLoginAt?: string
  createdAt: string
  metadata?: {
    department?: string
    title?: string
    manager?: string
  }
}

export interface Team {
  id: string
  name: string
  description: string
  members: string[]
  permissions: Permission[]
  lead: string
  createdAt: string
  isActive: boolean
}

interface PermissionsManagerProps {
  currentUserId?: string
}

export function PermissionsManager({ currentUserId = 'current-user' }: PermissionsManagerProps) {
  const [activeTab, setActiveTab] = useState('users')
  const [users, setUsers] = useKV<User[]>('system-users', [])
  const [roles, setRoles] = useKV<Role[]>('system-roles', [])
  const [teams, setTeams] = useKV<Team[]>('system-teams', [])
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [isCreateUserDialogOpen, setIsCreateUserDialogOpen] = useState(false)
  const [isCreateRoleDialogOpen, setIsCreateRoleDialogOpen] = useState(false)

  // Available resources and actions
  const resources = [
    { id: 'contacts', name: 'Contatos', description: 'Gerenciar base de contatos' },
    { id: 'opportunities', name: 'Oportunidades', description: 'Pipeline de vendas' },
    { id: 'activities', name: 'Atividades', description: 'Histórico de interações' },
    { id: 'campaigns', name: 'Campanhas', description: 'Marketing automation' },
    { id: 'reports', name: 'Relatórios', description: 'Analytics e dashboards' },
    { id: 'settings', name: 'Configurações', description: 'Configurações do sistema' },
    { id: 'users', name: 'Usuários', description: 'Gerenciar usuários' },
    { id: 'integrations', name: 'Integrações', description: 'APIs e webhooks' }
  ]

  const actions = [
    { id: 'read', name: 'Visualizar', description: 'Visualizar dados', icon: Eye },
    { id: 'create', name: 'Criar', description: 'Criar novos registros', icon: Plus },
    { id: 'update', name: 'Editar', description: 'Modificar registros existentes', icon: PencilSimple },
    { id: 'delete', name: 'Excluir', description: 'Remover registros', icon: Trash },
    { id: 'admin', name: 'Administrar', description: 'Controle total', icon: Crown }
  ]

  // Initialize default data
  useEffect(() => {
    if (roles.length === 0) {
      const defaultRoles: Role[] = [
        {
          id: 'admin',
          name: 'Administrador',
          description: 'Acesso total ao sistema',
          isSystem: true,
          isDefault: false,
          permissions: resources.flatMap(resource =>
            actions.map(action => ({
              id: `${resource.id}-${action.id}`,
              resource: resource.id,
              action: action.id as any,
              granted: true
            }))
          ),
          color: 'red',
          icon: 'crown',
          hierarchy: 100,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'system'
        },
        {
          id: 'manager',
          name: 'Gerente',
          description: 'Acesso de gerenciamento com algumas restrições',
          isSystem: true,
          isDefault: false,
          permissions: resources.flatMap(resource =>
            actions.filter(a => a.id !== 'admin').map(action => ({
              id: `${resource.id}-${action.id}`,
              resource: resource.id,
              action: action.id as any,
              granted: resource.id !== 'users' || action.id === 'read'
            }))
          ),
          color: 'blue',
          icon: 'user-check',
          hierarchy: 70,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'system'
        },
        {
          id: 'sales',
          name: 'Vendas',
          description: 'Acesso focado em vendas e relacionamento',
          isSystem: true,
          isDefault: true,
          permissions: resources.flatMap(resource =>
            actions.map(action => ({
              id: `${resource.id}-${action.id}`,
              resource: resource.id,
              action: action.id as any,
              granted: ['contacts', 'opportunities', 'activities', 'campaigns'].includes(resource.id) &&
                ['read', 'create', 'update'].includes(action.id)
            }))
          ),
          color: 'green',
          icon: 'target',
          hierarchy: 50,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'system'
        },
        {
          id: 'viewer',
          name: 'Visualizador',
          description: 'Acesso somente leitura',
          isSystem: true,
          isDefault: false,
          permissions: resources.map(resource => ({
            id: `${resource.id}-read`,
            resource: resource.id,
            action: 'read' as any,
            granted: true
          })),
          color: 'gray',
          icon: 'eye',
          hierarchy: 10,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'system'
        }
      ]
      setRoles(defaultRoles)
    }

    if (users.length === 0) {
      const defaultUsers: User[] = [
        {
          id: currentUserId,
          name: 'Você',
          email: 'admin@example.com',
          status: 'active',
          roles: ['admin'],
          directPermissions: [],
          createdAt: new Date().toISOString(),
          metadata: {
            department: 'TI',
            title: 'Administrador do Sistema'
          }
        },
        {
          id: 'user-2',
          name: 'João Silva',
          email: 'joao@example.com',
          status: 'active',
          roles: ['sales'],
          directPermissions: [],
          lastLoginAt: new Date(Date.now() - 3600000).toISOString(),
          createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
          metadata: {
            department: 'Vendas',
            title: 'Consultor de Vendas'
          }
        },
        {
          id: 'user-3',
          name: 'Maria Santos',
          email: 'maria@example.com',
          status: 'active',
          roles: ['manager'],
          directPermissions: [],
          lastLoginAt: new Date(Date.now() - 7200000).toISOString(),
          createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
          metadata: {
            department: 'Vendas',
            title: 'Gerente de Vendas'
          }
        }
      ]
      setUsers(defaultUsers)
    }
  }, [roles.length, users.length, currentUserId, setRoles, setUsers])

  const getUserPermissions = (user: User): Permission[] => {
    const rolePermissions = user.roles.flatMap(roleId => {
      const role = roles.find(r => r.id === roleId)
      return role?.permissions || []
    })

    // Merge with direct permissions, direct permissions override role permissions
    const allPermissions = [...rolePermissions, ...user.directPermissions]
    const uniquePermissions = allPermissions.reduce((acc, perm) => {
      const key = `${perm.resource}-${perm.action}`
      acc[key] = perm
      return acc
    }, {} as Record<string, Permission>)

    return Object.values(uniquePermissions)
  }

  const hasPermission = (user: User, resource: string, action: string): boolean => {
    const permissions = getUserPermissions(user)
    return permissions.some(p =>
      p.resource === resource &&
      p.action === action &&
      p.granted
    )
  }

  const getRoleColor = (roleId: string) => {
    const role = roles.find(r => r.id === roleId)
    return role?.color || 'gray'
  }

  const getRoleName = (roleId: string) => {
    const role = roles.find(r => r.id === roleId)
    return role?.name || roleId
  }

  const getStatusColor = (status: User['status']) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-50 border-green-200'
      case 'inactive': return 'text-gray-600 bg-gray-50 border-gray-200'
      case 'pending': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'suspended': return 'text-red-600 bg-red-50 border-red-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getPermissionCoverage = (user: User): number => {
    const allPossiblePermissions = resources.length * actions.length
    const grantedPermissions = getUserPermissions(user).filter(p => p.granted).length
    return Math.round((grantedPermissions / allPossiblePermissions) * 100)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Gerenciamento de Permissões</h2>
          <p className="text-muted-foreground">
            Controle de acesso de usuários, roles e equipes
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="flex items-center space-x-1">
            <Shield className="h-3 w-3" />
            <span>{users.filter(u => u.status === 'active').length} usuários ativos</span>
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="teams">Equipes</TabsTrigger>
          <TabsTrigger value="permissions">Permissões</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Usuários do Sistema</h3>
            <Dialog open={isCreateUserDialogOpen} onOpenChange={setIsCreateUserDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Usuário
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adicionar Usuário</DialogTitle>
                  <DialogDescription>
                    Crie um novo usuário e defina suas permissões
                  </DialogDescription>
                </DialogHeader>
                <UserForm
                  roles={roles}
                  onSave={(userData) => {
                    const newUser: User = {
                      id: Date.now().toString(),
                      name: userData.name || 'Usuário',
                      email: userData.email || 'user@example.com',
                      avatar: userData.avatar,
                      roles: userData.roles || [],
                      directPermissions: [],
                      status: 'pending',
                      lastLoginAt: undefined,
                      createdAt: new Date().toISOString()
                    }
                    setUsers(prev => [...prev, newUser])
                    setIsCreateUserDialogOpen(false)
                  }}
                  onCancel={() => setIsCreateUserDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {users.map((user) => (
              <Card key={user.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start space-x-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatar} />
                      <AvatarFallback>
                        {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium truncate">{user.name}</h4>
                        <Badge className={getStatusColor(user.status)} variant="outline">
                          {user.status}
                        </Badge>
                      </div>

                      <p className="text-sm text-muted-foreground truncate">{user.email}</p>

                      {user.metadata?.title && (
                        <p className="text-xs text-muted-foreground">{user.metadata.title}</p>
                      )}

                      <div className="flex items-center space-x-1 mt-2">
                        {user.roles.slice(0, 2).map((roleId) => (
                          <Badge
                            key={roleId}
                            variant="secondary"
                            className="text-xs"
                          >
                            {getRoleName(roleId)}
                          </Badge>
                        ))}
                        {user.roles.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{user.roles.length - 2}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Cobertura de Permissões</span>
                          <span className="font-medium">{getPermissionCoverage(user)}%</span>
                        </div>
                        <Progress value={getPermissionCoverage(user)} className="h-1" />
                      </div>

                      {user.lastLoginAt && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Último acesso: {new Date(user.lastLoginAt).toLocaleString('pt-BR')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedUser(user)}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Detalhes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={user.id === currentUserId}
                    >
                      <PencilSimple className="h-3 w-3 mr-1" />
                      Editar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="roles" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Roles do Sistema</h3>
            <Dialog open={isCreateRoleDialogOpen} onOpenChange={setIsCreateRoleDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Role
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Criar Nova Role</DialogTitle>
                  <DialogDescription>
                    Defina uma nova role com permissões específicas
                  </DialogDescription>
                </DialogHeader>
                <RoleForm
                  resources={resources}
                  actions={actions}
                  onSave={(roleData) => {
                    const newRole: Role = {
                      id: Date.now().toString(),
                      name: roleData.name || 'Nova Role',
                      description: roleData.description || '',
                      permissions: roleData.permissions || [],
                      color: roleData.color || '#666666',
                      icon: roleData.icon || 'Shield',
                      hierarchy: roleData.hierarchy ?? 0,
                      isSystem: false,
                      isDefault: false,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      createdBy: currentUserId
                    }
                    setRoles(prev => [...prev, newRole])
                    setIsCreateRoleDialogOpen(false)
                  }}
                  onCancel={() => setIsCreateRoleDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {roles.map((role) => (
              <Card key={role.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
                      <h4 className="font-medium">{role.name}</h4>
                      {role.isSystem && (
                        <Badge variant="outline" className="text-xs">
                          <Shield className="h-3 w-3 mr-1" />
                          Sistema
                        </Badge>
                      )}
                      {role.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          Padrão
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Nível {role.hierarchy}
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mb-3">{role.description}</p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Permissões Concedidas</span>
                      <span className="font-medium">
                        {role.permissions.filter(p => p.granted).length} / {role.permissions.length}
                      </span>
                    </div>
                    <Progress
                      value={(role.permissions.filter(p => p.granted).length / role.permissions.length) * 100}
                      className="h-1"
                    />
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="text-xs text-muted-foreground">
                      {users.filter(u => u.roles.includes(role.id)).length} usuário(s)
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedRole(role)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Ver
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={role.isSystem}
                      >
                        <PencilSimple className="h-3 w-3 mr-1" />
                        Editar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="teams" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Equipes</h3>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova Equipe
            </Button>
          </div>

          <Card>
            <CardContent className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Funcionalidade em Desenvolvimento</h3>
              <p className="text-muted-foreground">
                O gerenciamento de equipes estará disponível em breve
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions" className="space-y-6">
          <h3 className="text-lg font-semibold">Matriz de Permissões</h3>

          <Card>
            <CardContent className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4">Recurso</th>
                      {actions.map((action) => (
                        <th key={action.id} className="text-center py-2 px-2 min-w-[80px]">
                          <div className="flex flex-col items-center space-y-1">
                            <action.icon className="h-4 w-4" />
                            <span className="text-xs">{action.name}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resources.map((resource) => (
                      <tr key={resource.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4">
                          <div>
                            <div className="font-medium">{resource.name}</div>
                            <div className="text-xs text-muted-foreground">{resource.description}</div>
                          </div>
                        </td>
                        {actions.map((action) => {
                          const rolesWithPermission = roles.filter(role =>
                            role.permissions.some(p =>
                              p.resource === resource.id &&
                              p.action === action.id &&
                              p.granted
                            )
                          )

                          return (
                            <td key={action.id} className="text-center py-3 px-2">
                              <div className="flex flex-col items-center space-y-1">
                                {rolesWithPermission.length > 0 ? (
                                  <>
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                    <div className="text-xs text-muted-foreground">
                                      {rolesWithPermission.length} role(s)
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <X className="h-4 w-4 text-red-400" />
                                    <div className="text-xs text-muted-foreground">Nenhuma</div>
                                  </>
                                )}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* User Details Modal */}
      {selectedUser && (
        <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Detalhes do Usuário</DialogTitle>
            </DialogHeader>
            <UserDetailsModal user={selectedUser} roles={roles} resources={resources} actions={actions} />
          </DialogContent>
        </Dialog>
      )}

      {/* Role Details Modal */}
      {selectedRole && (
        <Dialog open={!!selectedRole} onOpenChange={() => setSelectedRole(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Detalhes da Role</DialogTitle>
            </DialogHeader>
            <RoleDetailsModal role={selectedRole} resources={resources} actions={actions} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// User Form Component
function UserForm({
  roles,
  onSave,
  onCancel
}: {
  roles: Role[]
  onSave: (user: Partial<User>) => void
  onCancel: () => void
}) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    roles: [] as string[],
    metadata: {
      department: '',
      title: ''
    }
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Nome</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          />
        </div>
        <div>
          <Label>E-mail</Label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Departamento</Label>
          <Input
            value={formData.metadata.department}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              metadata: { ...prev.metadata, department: e.target.value }
            }))}
          />
        </div>
        <div>
          <Label>Cargo</Label>
          <Input
            value={formData.metadata.title}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              metadata: { ...prev.metadata, title: e.target.value }
            }))}
          />
        </div>
      </div>

      <div>
        <Label>Roles</Label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {roles.map((role) => (
            <div key={role.id} className="flex items-center space-x-2">
              <CheckCirclebox
                checked={formData.roles.includes(role.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setFormData(prev => ({ ...prev, roles: [...prev.roles, role.id] }))
                  } else {
                    setFormData(prev => ({ ...prev, roles: prev.roles.filter(r => r !== role.id) }))
                  }
                }}
              />
              <Label className="text-sm">{role.name}</Label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave(formData)} disabled={!formData.name || !formData.email}>
          Criar Usuário
        </Button>
      </div>
    </div>
  )
}

// Role Form Component
function RoleForm({
  resources,
  actions,
  onSave,
  onCancel
}: {
  resources: Array<{ id: string; name: string; description: string }>
  actions: Array<{ id: string; name: string; description: string; icon: any }>
  onSave: (role: Partial<Role>) => void
  onCancel: () => void
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: 'blue',
    hierarchy: 50,
    permissions: [] as Permission[]
  })

  useEffect(() => {
    // Initialize permissions
    const initialPermissions = resources.flatMap(resource =>
      actions.map(action => ({
        id: `${resource.id}-${action.id}`,
        resource: resource.id,
        action: action.id as any,
        granted: false
      }))
    )
    setFormData(prev => ({ ...prev, permissions: initialPermissions }))
  }, [resources, actions])

  const togglePermission = (resourceId: string, actionId: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.map(p =>
        p.resource === resourceId && p.action === actionId
          ? { ...p, granted: !p.granted }
          : p
      )
    }))
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Nome da Role</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          />
        </div>
        <div>
          <Label>Nível Hierárquico</Label>
          <Input
            type="number"
            min="0"
            max="100"
            value={formData.hierarchy}
            onChange={(e) => setFormData(prev => ({ ...prev, hierarchy: parseInt(e.target.value) }))}
          />
        </div>
      </div>

      <div>
        <Label>Descrição</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
        />
      </div>

      <div>
        <Label>Permissões</Label>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border">
            <thead>
              <tr className="bg-muted">
                <th className="text-left p-2">Recurso</th>
                {actions.map((action) => (
                  <th key={action.id} className="text-center p-2">
                    <action.icon className="h-4 w-4 mx-auto mb-1" />
                    <div className="text-xs">{action.name}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource.id} className="border-t">
                  <td className="p-2 font-medium">{resource.name}</td>
                  {actions.map((action) => {
                    const permission = formData.permissions.find(p =>
                      p.resource === resource.id && p.action === action.id
                    )
                    return (
                      <td key={action.id} className="text-center p-2">
                        <CheckCirclebox
                          checked={permission?.granted || false}
                          onCheckedChange={() => togglePermission(resource.id, action.id)}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave(formData)} disabled={!formData.name}>
          Criar Role
        </Button>
      </div>
    </div>
  )
}

// User Details Modal Component
function UserDetailsModal({
  user,
  roles,
  resources,
  actions
}: {
  user: User
  roles: Role[]
  resources: Array<{ id: string; name: string; description: string }>
  actions: Array<{ id: string; name: string; description: string; icon: any }>
}) {
  const getUserPermissions = (user: User): Permission[] => {
    const rolePermissions = user.roles.flatMap(roleId => {
      const role = roles.find(r => r.id === roleId)
      return role?.permissions || []
    })

    return [...rolePermissions, ...user.directPermissions]
  }

  const userPermissions = getUserPermissions(user)

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg">
            {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <h3 className="text-xl font-semibold">{user.name}</h3>
          <p className="text-muted-foreground">{user.email}</p>
          {user.metadata?.title && (
            <p className="text-sm text-muted-foreground">{user.metadata.title}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold mb-3">Roles Atribuídas</h4>
          <div className="space-y-2">
            {user.roles.map((roleId) => {
              const role = roles.find(r => r.id === roleId)
              return role ? (
                <div key={roleId} className="flex items-center space-x-2 p-2 border rounded">
                  <div className={`w-3 h-3 rounded-full bg-${role.color}-500`} />
                  <span className="font-medium">{role.name}</span>
                  <Badge variant="outline" className="text-xs ml-auto">
                    Nível {role.hierarchy}
                  </Badge>
                </div>
              ) : null
            })}
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-3">Estatísticas</h4>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Badge variant="outline" className={getStatusColor(user.status)}>
                {user.status}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Membro desde:</span>
              <span className="text-sm">{new Date(user.createdAt).toLocaleDateString('pt-BR')}</span>
            </div>
            {user.lastLoginAt && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Último acesso:</span>
                <span className="text-sm">{new Date(user.lastLoginAt).toLocaleDateString('pt-BR')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <h4 className="font-semibold mb-3">Matriz de Permissões</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Recurso</th>
                {actions.map((action) => (
                  <th key={action.id} className="text-center py-2 px-2">
                    <action.icon className="h-3 w-3 mx-auto" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource.id} className="border-b">
                  <td className="py-2 font-medium">{resource.name}</td>
                  {actions.map((action) => {
                    const hasPermission = userPermissions.some(p =>
                      p.resource === resource.id && p.action === action.id && p.granted
                    )
                    return (
                      <td key={action.id} className="text-center py-2">
                        {hasPermission ? (
                          <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-red-400 mx-auto" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Role Details Modal Component
function RoleDetailsModal({
  role,
  resources,
  actions
}: {
  role: Role
  resources: Array<{ id: string; name: string; description: string }>
  actions: Array<{ id: string; name: string; description: string; icon: any }>
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center space-x-3 mb-2">
          <div className={`w-4 h-4 rounded-full bg-${role.color}-500`} />
          <h3 className="text-xl font-semibold">{role.name}</h3>
          {role.isSystem && (
            <Badge variant="outline">
              <Shield className="h-3 w-3 mr-1" />
              Sistema
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground">{role.description}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-4 border rounded-lg">
          <div className="text-2xl font-bold">{role.hierarchy}</div>
          <div className="text-sm text-muted-foreground">Nível Hierárquico</div>
        </div>
        <div className="text-center p-4 border rounded-lg">
          <div className="text-2xl font-bold">
            {role.permissions.filter(p => p.granted).length}
          </div>
          <div className="text-sm text-muted-foreground">Permissões</div>
        </div>
        <div className="text-center p-4 border rounded-lg">
          <div className="text-2xl font-bold">-</div>
          <div className="text-sm text-muted-foreground">Usuários</div>
        </div>
      </div>

      <div>
        <h4 className="font-semibold mb-3">Permissões Detalhadas</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Recurso</th>
                {actions.map((action) => (
                  <th key={action.id} className="text-center py-2 px-2">
                    <div className="flex flex-col items-center">
                      <action.icon className="h-3 w-3 mb-1" />
                      <span className="text-xs">{action.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource.id} className="border-b">
                  <td className="py-2">
                    <div>
                      <div className="font-medium">{resource.name}</div>
                      <div className="text-xs text-muted-foreground">{resource.description}</div>
                    </div>
                  </td>
                  {actions.map((action) => {
                    const permission = role.permissions.find(p =>
                      p.resource === resource.id && p.action === action.id
                    )
                    return (
                      <td key={action.id} className="text-center py-2">
                        {permission?.granted ? (
                          <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-red-400 mx-auto" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function getStatusColor(status: User['status']) {
  switch (status) {
    case 'active': return 'text-green-600 bg-green-50 border-green-200'
    case 'inactive': return 'text-gray-600 bg-gray-50 border-gray-200'
    case 'pending': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    case 'suspended': return 'text-red-600 bg-red-50 border-red-200'
    default: return 'text-gray-600 bg-gray-50 border-gray-200'
  }
}
