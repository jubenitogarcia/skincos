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
import { Switch } from "@/switch"
import {
  Users,
  Plus,
  CalendarBlank,
  Clock,
  CurrencyDollar,
  Trophy,
  FileText,
  MapPin,
  Phone,
  Envelope,
  Building,
  Star,
  TrendUp,
  Warning,
  CheckCircle,
  Eye
} from "@phosphor-icons/react"

interface Employee {
  id: string
  employeeId: string
  name: string
  email: string
  phone: string
  department: string
  designation: string
  joiningDate: string
  salary: number
  status: 'active' | 'inactive' | 'terminated'
  manager?: string
  address: string
  emergencyContact: string
  skills: string[]
  performance: number
  avatar?: string
}

interface Leave {
  id: string
  employeeId: string
  employeeName: string
  type: 'annual' | 'sick' | 'maternity' | 'emergency'
  startDate: string
  endDate: string
  days: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  approver?: string
  appliedOn: string
}

interface Attendance {
  id: string
  employeeId: string
  employeeName: string
  date: string
  checkIn: string
  checkOut?: string
  workingHours: number
  status: 'present' | 'absent' | 'late' | 'half-day'
  location: string
}

interface Payroll {
  id: string
  employeeId: string
  employeeName: string
  month: string
  basicSalary: number
  allowances: number
  deductions: number
  netSalary: number
  status: 'draft' | 'submitted' | 'paid'
  payDate?: string
}

export function HRModule() {
  const [activeTab, setActiveTab] = useState("employees")

  // Sample data
  const [employees, setEmployees] = useKV<Employee[]>("hr-employees", [
    {
      id: "emp-001",
      employeeId: "EMP001",
      name: "Ana Silva",
      email: "ana.silva@empresa.com",
      phone: "(11) 99999-0001",
      department: "Vendas",
      designation: "Gerente de Vendas",
      joiningDate: "2023-01-15",
      salary: 8500,
      status: "active",
      manager: "João Santos",
      address: "São Paulo, SP",
      emergencyContact: "(11) 88888-0001",
      skills: ["Vendas", "Negociação", "CRM", "Liderança"],
      performance: 95
    },
    {
      id: "emp-002",
      employeeId: "EMP002",
      name: "Carlos Santos",
      email: "carlos.santos@empresa.com",
      phone: "(11) 99999-0002",
      department: "Marketing",
      designation: "Analista de Marketing",
      joiningDate: "2023-03-20",
      salary: 5500,
      status: "active",
      manager: "Ana Silva",
      address: "Rio de Janeiro, RJ",
      emergencyContact: "(11) 88888-0002",
      skills: ["Marketing Digital", "Analytics", "SEO", "Content"],
      performance: 88
    }
  ])

  const [leaves, setLeaves] = useKV<Leave[]>("hr-leaves", [
    {
      id: "leave-001",
      employeeId: "emp-001",
      employeeName: "Ana Silva",
      type: "annual",
      startDate: "2024-04-15",
      endDate: "2024-04-19",
      days: 5,
      reason: "Férias planejadas",
      status: "approved",
      approver: "João Santos",
      appliedOn: "2024-03-20"
    }
  ])

  const [attendance, setAttendance] = useKV<Attendance[]>("hr-attendance", [
    {
      id: "att-001",
      employeeId: "emp-001",
      employeeName: "Ana Silva",
      date: "2024-03-20",
      checkIn: "08:30",
      checkOut: "17:45",
      workingHours: 8.25,
      status: "present",
      location: "Escritório Principal"
    }
  ])

  const [payroll, setPayroll] = useKV<Payroll[]>("hr-payroll", [
    {
      id: "pay-001",
      employeeId: "emp-001",
      employeeName: "Ana Silva",
      month: "2024-03",
      basicSalary: 8500,
      allowances: 1200,
      deductions: 850,
      netSalary: 8850,
      status: "paid",
      payDate: "2024-03-30"
    }
  ])

  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({
    status: 'active',
    skills: [],
    performance: 80
  })

  const addEmployee = () => {
    if (newEmployee.name && newEmployee.email && newEmployee.department) {
      const employee: Employee = {
        id: `emp-${Date.now()}`,
        employeeId: `EMP${String(employees.length + 1).padStart(3, '0')}`,
        name: newEmployee.name,
        email: newEmployee.email,
        phone: newEmployee.phone || '',
        department: newEmployee.department,
        designation: newEmployee.designation || '',
        joiningDate: newEmployee.joiningDate || new Date().toISOString().split('T')[0],
        salary: newEmployee.salary || 0,
        status: newEmployee.status as 'active' | 'inactive' | 'terminated',
        manager: newEmployee.manager,
        address: newEmployee.address || '',
        emergencyContact: newEmployee.emergencyContact || '',
        skills: newEmployee.skills || [],
        performance: newEmployee.performance || 80
      }

      setEmployees(current => [...current, employee])
      setNewEmployee({ status: 'active', skills: [], performance: 80 })
      setShowAddEmployee(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': case 'approved': case 'paid': case 'present':
        return 'bg-green-100 text-green-800'
      case 'pending': case 'draft':
        return 'bg-yellow-100 text-yellow-800'
      case 'inactive': case 'rejected': case 'absent':
        return 'bg-red-100 text-red-800'
      case 'late': case 'half-day':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getDepartmentStats = () => {
    const deptStats = employees.reduce((acc, emp) => {
      if (!acc[emp.department]) {
        acc[emp.department] = { count: 0, totalSalary: 0 }
      }
      acc[emp.department].count++
      acc[emp.department].totalSalary += emp.salary
      return acc
    }, {} as Record<string, { count: number; totalSalary: number }>)

    return Object.entries(deptStats).map(([dept, stats]) => ({
      department: dept,
      employees: stats.count,
      avgSalary: stats.totalSalary / stats.count
    }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Recursos Humanos</h2>
          <p className="text-muted-foreground">
            Gestão completa de funcionários, folha de pagamento e benefícios
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline">
            <FileText className="h-4 w-4 mr-2" />
            Relatórios
          </Button>
          <Button onClick={() => setShowAddEmployee(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Funcionário
          </Button>
        </div>
      </div>

      {/* HR Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Users className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Funcionários</p>
                <p className="text-2xl font-bold">{employees.filter(e => e.status === 'active').length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CalendarBlank className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Licenças Pendentes</p>
                <p className="text-2xl font-bold">{leaves.filter(l => l.status === 'pending').length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CurrencyDollar className="h-8 w-8 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Folha de Pagamento</p>
                <p className="text-2xl font-bold">
                  R$ {(employees.reduce((sum, emp) => sum + emp.salary, 0) / 1000).toFixed(0)}K
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-8 w-8 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Performance Média</p>
                <p className="text-2xl font-bold">
                  {(employees.reduce((sum, emp) => sum + emp.performance, 0) / employees.length).toFixed(0)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="employees">Funcionários</TabsTrigger>
          <TabsTrigger value="attendance">Presença</TabsTrigger>
          <TabsTrigger value="leaves">Licenças</TabsTrigger>
          <TabsTrigger value="payroll">Folha de Pagamento</TabsTrigger>
          <TabsTrigger value="departments">Departamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="space-y-4">
          {showAddEmployee && (
            <Card>
              <CardHeader>
                <CardTitle>Adicionar Novo Funcionário</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">Nome Completo</Label>
                    <Input
                      id="name"
                      value={newEmployee.name || ''}
                      onChange={(e) => setNewEmployee(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Nome do funcionário"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newEmployee.email || ''}
                      onChange={(e) => setNewEmployee(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="email@empresa.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="department">Departamento</Label>
                    <Select value={newEmployee.department || ''} onValueChange={(value) => setNewEmployee(prev => ({ ...prev, department: value }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar departamento" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Vendas">Vendas</SelectItem>
                        <SelectItem value="Marketing">Marketing</SelectItem>
                        <SelectItem value="TI">Tecnologia</SelectItem>
                        <SelectItem value="RH">Recursos Humanos</SelectItem>
                        <SelectItem value="Financeiro">Financeiro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="designation">Cargo</Label>
                    <Input
                      id="designation"
                      value={newEmployee.designation || ''}
                      onChange={(e) => setNewEmployee(prev => ({ ...prev, designation: e.target.value }))}
                      placeholder="Cargo do funcionário"
                    />
                  </div>
                  <div>
                    <Label htmlFor="salary">Salário</Label>
                    <Input
                      id="salary"
                      type="number"
                      value={newEmployee.salary || ''}
                      onChange={(e) => setNewEmployee(prev => ({ ...prev, salary: Number(e.target.value) }))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="joiningDate">Data de Admissão</Label>
                    <Input
                      id="joiningDate"
                      type="date"
                      value={newEmployee.joiningDate || ''}
                      onChange={(e) => setNewEmployee(prev => ({ ...prev, joiningDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button onClick={addEmployee}>Adicionar Funcionário</Button>
                  <Button variant="outline" onClick={() => setShowAddEmployee(false)}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {employees.map((employee) => (
              <Card key={employee.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{employee.name}</CardTitle>
                      <CardDescription>{employee.designation}</CardDescription>
                    </div>
                    <Badge className={getStatusColor(employee.status)}>
                      {employee.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm space-y-1">
                    <div className="flex items-center space-x-2">
                      <Building className="h-4 w-4 text-muted-foreground" />
                      <span>{employee.department}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Envelope className="h-4 w-4 text-muted-foreground" />
                      <span>{employee.email}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <CurrencyDollar className="h-4 w-4 text-muted-foreground" />
                      <span>R$ {employee.salary.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Star className="h-4 w-4 text-muted-foreground" />
                      <span>Performance: {employee.performance}%</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {employee.skills.slice(0, 3).map((skill) => (
                      <Badge key={skill} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                    {employee.skills.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{employee.skills.length - 3}
                      </Badge>
                    )}
                  </div>

                  <Button variant="outline" size="sm" className="w-full">
                    <Eye className="h-4 w-4 mr-2" />
                    Ver Detalhes
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Registro de Presença</CardTitle>
              <CardDescription>Controle de ponto e horas trabalhadas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {attendance.map((record) => (
                  <div key={record.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div>
                        <p className="font-medium">{record.employeeName}</p>
                        <p className="text-sm text-muted-foreground">{record.date}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="text-sm">
                        <div className="flex items-center space-x-2">
                          <Clock className="h-4 w-4 text-green-600" />
                          <span>{record.checkIn}</span>
                        </div>
                        {record.checkOut && (
                          <div className="flex items-center space-x-2">
                            <Clock className="h-4 w-4 text-red-600" />
                            <span>{record.checkOut}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{record.workingHours}h</p>
                        <Badge className={getStatusColor(record.status)}>
                          {record.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leaves" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Gestão de Licenças</CardTitle>
              <CardDescription>Solicitações e aprovações de licenças</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {leaves.map((leave) => (
                  <div key={leave.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">{leave.employeeName}</p>
                      <p className="text-sm text-muted-foreground">{leave.reason}</p>
                      <p className="text-sm">
                        {leave.startDate} - {leave.endDate} ({leave.days} dias)
                      </p>
                    </div>
                    <div className="text-right space-y-2">
                      <Badge className={getStatusColor(leave.status)}>
                        {leave.status}
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        Tipo: {leave.type}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Folha de Pagamento</CardTitle>
              <CardDescription>Gestão de salários e benefícios</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {payroll.map((pay) => (
                  <div key={pay.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">{pay.employeeName}</p>
                      <p className="text-sm text-muted-foreground">Mês: {pay.month}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg">R$ {pay.netSalary.toLocaleString()}</p>
                      <Badge className={getStatusColor(pay.status)}>
                        {pay.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {getDepartmentStats().map((dept) => (
              <Card key={dept.department}>
                <CardHeader>
                  <CardTitle>{dept.department}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Funcionários:</span>
                      <span className="font-medium">{dept.employees}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Salário Médio:</span>
                      <span className="font-medium">R$ {dept.avgSalary.toLocaleString()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
