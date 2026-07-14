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
import { Progress } from "@/progress"
import {
  FolderOpen,
  Plus,
  CalendarBlank,
  Clock,
  CurrencyDollar,
  Users,
  Checks,
  FileText,
  Target,
  TrendUp,
  Warning,
  CheckCircle,
  Eye,
  Star,
  ChartBar,
  Kanban
} from "@phosphor-icons/react"

interface Project {
  id: string
  name: string
  description: string
  status: 'planning' | 'active' | 'on-hold' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'critical'
  startDate: string
  endDate: string
  budget: number
  spentAmount: number
  progress: number
  projectManager: string
  customer: string
  team: string[]
  tasks: Task[]
  milestones: Milestone[]
}

interface Task {
  id: string
  title: string
  description: string
  assignee: string
  status: 'not-started' | 'in-progress' | 'review' | 'completed' | 'blocked'
  priority: 'low' | 'medium' | 'high' | 'critical'
  startDate: string
  dueDate: string
  estimatedHours: number
  actualHours: number
  progress: number
  dependencies: string[]
  tags: string[]
}

interface Milestone {
  id: string
  title: string
  description: string
  dueDate: string
  status: 'pending' | 'completed' | 'overdue'
  tasks: string[]
}

interface TimeEntry {
  id: string
  projectId: string
  taskId: string
  user: string
  date: string
  hours: number
  description: string
  billable: boolean
  hourlyRate: number
}

export function ProjectManagement() {
  const [activeTab, setActiveTab] = useState("projects")

  // Sample data
  const [projects, setProjects] = useKV<Project[]>("projects", [
    {
      id: "proj-001",
      name: "Sistema CRM 2.0",
      description: "Desenvolvimento de nova versão do sistema CRM com IA",
      status: "active",
      priority: "high",
      startDate: "2024-01-15",
      endDate: "2024-06-30",
      budget: 250000,
      spentAmount: 125000,
      progress: 65,
      projectManager: "Ana Silva",
      customer: "TechCorp Inc",
      team: ["João Santos", "Maria Costa", "Pedro Lima", "Laura Oliveira"],
      tasks: [
        {
          id: "task-001",
          title: "Análise de Requisitos",
          description: "Levantar e documentar todos os requisitos do sistema",
          assignee: "João Santos",
          status: "completed",
          priority: "high",
          startDate: "2024-01-15",
          dueDate: "2024-02-15",
          estimatedHours: 80,
          actualHours: 85,
          progress: 100,
          dependencies: [],
          tags: ["análise", "documentação"]
        },
        {
          id: "task-002",
          title: "Desenvolvimento Backend",
          description: "Implementar APIs e lógica de negócio",
          assignee: "Maria Costa",
          status: "in-progress",
          priority: "high",
          startDate: "2024-02-16",
          dueDate: "2024-05-15",
          estimatedHours: 200,
          actualHours: 120,
          progress: 60,
          dependencies: ["task-001"],
          tags: ["backend", "api"]
        }
      ],
      milestones: [
        {
          id: "milestone-001",
          title: "MVP Entregue",
          description: "Primeira versão funcional do sistema",
          dueDate: "2024-04-30",
          status: "pending",
          tasks: ["task-001", "task-002"]
        }
      ]
    },
    {
      id: "proj-002",
      name: "App Mobile Vendas",
      description: "Aplicativo móvel para equipe de vendas",
      status: "planning",
      priority: "medium",
      startDate: "2024-04-01",
      endDate: "2024-08-31",
      budget: 150000,
      spentAmount: 15000,
      progress: 10,
      projectManager: "Carlos Santos",
      customer: "SalesForce Brasil",
      team: ["Ana Paula", "Roberto Silva"],
      tasks: [],
      milestones: []
    }
  ])

  const [timeEntries, setTimeEntries] = useKV<TimeEntry[]>("time-entries", [
    {
      id: "time-001",
      projectId: "proj-001",
      taskId: "task-002",
      user: "Maria Costa",
      date: "2024-03-20",
      hours: 8,
      description: "Desenvolvimento de APIs de autenticação",
      billable: true,
      hourlyRate: 120
    }
  ])

  const [showAddProject, setShowAddProject] = useState(false)
  const [newProject, setNewProject] = useState<Partial<Project>>({
    status: 'planning',
    priority: 'medium',
    progress: 0,
    spentAmount: 0,
    team: [],
    tasks: [],
    milestones: []
  })

  const addProject = () => {
    if (newProject.name && newProject.projectManager) {
      const project: Project = {
        id: `proj-${Date.now()}`,
        name: newProject.name,
        description: newProject.description || '',
        status: newProject.status as Project['status'],
        priority: newProject.priority as Project['priority'],
        startDate: newProject.startDate || new Date().toISOString().split('T')[0],
        endDate: newProject.endDate || '',
        budget: newProject.budget || 0,
        spentAmount: 0,
        progress: 0,
        projectManager: newProject.projectManager,
        customer: newProject.customer || '',
        team: [],
        tasks: [],
        milestones: []
      }

      setProjects(current => [...current, project])
      setNewProject({
        status: 'planning',
        priority: 'medium',
        progress: 0,
        spentAmount: 0,
        team: [],
        tasks: [],
        milestones: []
      })
      setShowAddProject(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': case 'completed': case 'in-progress':
        return 'bg-green-100 text-green-800'
      case 'planning': case 'not-started': case 'pending':
        return 'bg-blue-100 text-blue-800'
      case 'on-hold': case 'review': case 'blocked':
        return 'bg-yellow-100 text-yellow-800'
      case 'cancelled': case 'overdue':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800'
      case 'high': return 'bg-orange-100 text-orange-800'
      case 'medium': return 'bg-yellow-100 text-yellow-800'
      case 'low': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getProjectStats = () => {
    return {
      totalProjects: projects.length,
      activeProjects: projects.filter(p => p.status === 'active').length,
      totalBudget: projects.reduce((sum, p) => sum + p.budget, 0),
      totalSpent: projects.reduce((sum, p) => sum + p.spentAmount, 0),
      avgProgress: projects.reduce((sum, p) => sum + p.progress, 0) / projects.length
    }
  }

  const getAllTasks = () => {
    return projects.flatMap(project =>
      project.tasks.map(task => ({
        ...task,
        projectName: project.name,
        projectId: project.id
      }))
    )
  }

  const stats = getProjectStats()
  const allTasks = getAllTasks()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Gestão de Projetos</h2>
          <p className="text-muted-foreground">
            Planejamento, execução e monitoramento de projetos empresariais
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline">
            <ChartBar className="h-4 w-4 mr-2" />
            Relatórios
          </Button>
          <Button onClick={() => setShowAddProject(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Projeto
          </Button>
        </div>
      </div>

      {/* Project Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <FolderOpen className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Projetos</p>
                <p className="text-2xl font-bold">{stats.totalProjects}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Target className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Projetos Ativos</p>
                <p className="text-2xl font-bold">{stats.activeProjects}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CurrencyDollar className="h-8 w-8 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Orçamento Total</p>
                <p className="text-2xl font-bold">R$ {(stats.totalBudget / 1000).toFixed(0)}K</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-8 w-8 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Gasto</p>
                <p className="text-2xl font-bold">R$ {(stats.totalSpent / 1000).toFixed(0)}K</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-8 w-8 text-indigo-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Progresso Médio</p>
                <p className="text-2xl font-bold">{stats.avgProgress.toFixed(0)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="projects">Projetos</TabsTrigger>
          <TabsTrigger value="tasks">Tarefas</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="resources">Recursos</TabsTrigger>
          <TabsTrigger value="timesheet">Timesheet</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-4">
          {showAddProject && (
            <Card>
              <CardHeader>
                <CardTitle>Novo Projeto</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="projectName">Nome do Projeto</Label>
                    <Input
                      id="projectName"
                      value={newProject.name || ''}
                      onChange={(e) => setNewProject(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Nome do projeto"
                    />
                  </div>
                  <div>
                    <Label htmlFor="projectManager">Gerente do Projeto</Label>
                    <Input
                      id="projectManager"
                      value={newProject.projectManager || ''}
                      onChange={(e) => setNewProject(prev => ({ ...prev, projectManager: e.target.value }))}
                      placeholder="Nome do gerente"
                    />
                  </div>
                  <div>
                    <Label htmlFor="customer">Cliente</Label>
                    <Input
                      id="customer"
                      value={newProject.customer || ''}
                      onChange={(e) => setNewProject(prev => ({ ...prev, customer: e.target.value }))}
                      placeholder="Nome do cliente"
                    />
                  </div>
                  <div>
                    <Label htmlFor="budget">Orçamento</Label>
                    <Input
                      id="budget"
                      type="number"
                      value={newProject.budget || ''}
                      onChange={(e) => setNewProject(prev => ({ ...prev, budget: Number(e.target.value) }))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="startDate">Data de Início</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={newProject.startDate || ''}
                      onChange={(e) => setNewProject(prev => ({ ...prev, startDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="endDate">Data de Término</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={newProject.endDate || ''}
                      onChange={(e) => setNewProject(prev => ({ ...prev, endDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="description">Descrição</Label>
                  <Textarea
                    id="description"
                    value={newProject.description || ''}
                    onChange={(e) => setNewProject(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Descrição do projeto"
                  />
                </div>
                <div className="flex space-x-2">
                  <Button onClick={addProject}>Criar Projeto</Button>
                  <Button variant="outline" onClick={() => setShowAddProject(false)}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {projects.map((project) => (
              <Card key={project.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{project.name}</CardTitle>
                      <CardDescription>{project.customer}</CardDescription>
                    </div>
                    <div className="flex space-x-2">
                      <Badge className={getStatusColor(project.status)}>
                        {project.status}
                      </Badge>
                      <Badge className={getPriorityColor(project.priority)}>
                        {project.priority}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{project.description}</p>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Gerente:</p>
                      <p className="font-medium">{project.projectManager}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Equipe:</p>
                      <p className="font-medium">{project.team.length} membros</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Orçamento:</p>
                      <p className="font-medium">R$ {project.budget.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Gasto:</p>
                      <p className="font-medium">R$ {project.spentAmount.toLocaleString()}</p>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Progresso</span>
                      <span className="text-sm text-muted-foreground">{project.progress}%</span>
                    </div>
                    <Progress value={project.progress} className="h-2" />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-1">
                        <Checks className="h-4 w-4 text-muted-foreground" />
                        <span>{project.tasks.length} tarefas</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        <span>{project.milestones.length} marcos</span>
                      </div>
                    </div>
                    <div className="text-muted-foreground">
                      {project.startDate} - {project.endDate}
                    </div>
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

        <TabsContent value="tasks" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allTasks.map((task) => (
              <Card key={task.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{task.title}</CardTitle>
                      <CardDescription>{task.projectName}</CardDescription>
                    </div>
                    <div className="flex space-x-1">
                      <Badge className={getStatusColor(task.status)} variant="outline">
                        {task.status}
                      </Badge>
                      <Badge className={getPriorityColor(task.priority)} variant="outline">
                        {task.priority}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{task.description}</p>

                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Responsável:</span>
                      <span className="font-medium">{task.assignee}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Prazo:</span>
                      <span className="font-medium">{task.dueDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Estimado:</span>
                      <span className="font-medium">{task.estimatedHours}h</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Realizado:</span>
                      <span className="font-medium">{task.actualHours}h</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Progresso</span>
                      <span className="text-sm text-muted-foreground">{task.progress}%</span>
                    </div>
                    <Progress value={task.progress} className="h-2" />
                  </div>

                  {task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {task.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Timeline de Projetos</CardTitle>
              <CardDescription>Visualização cronológica dos projetos e marcos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {projects.map((project) => (
                  <div key={project.id} className="relative">
                    <div className="flex items-center space-x-4">
                      <div className="w-3 h-3 bg-primary rounded-full"></div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium">{project.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              {project.startDate} - {project.endDate}
                            </p>
                          </div>
                          <Badge className={getStatusColor(project.status)}>
                            {project.status}
                          </Badge>
                        </div>
                        <Progress value={project.progress} className="mt-2 h-2" />
                      </div>
                    </div>
                    {project.milestones.map((milestone) => (
                      <div key={milestone.id} className="ml-6 mt-2">
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-accent rounded-full"></div>
                          <span className="text-sm">{milestone.title}</span>
                          <Badge className={getStatusColor(milestone.status)} variant="outline">
                            {milestone.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Alocação de Recursos</CardTitle>
              <CardDescription>Gestão de equipes e recursos dos projetos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {projects.map((project) => (
                  <div key={project.id} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium">{project.name}</h4>
                      <Badge className={getStatusColor(project.status)}>
                        {project.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Gerente:</p>
                        <p className="font-medium">{project.projectManager}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Equipe:</p>
                        <p className="font-medium">{project.team.length} membros</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Utilização do Orçamento:</p>
                        <p className="font-medium">
                          {((project.spentAmount / project.budget) * 100).toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    {project.team.length > 0 && (
                      <div className="mt-3">
                        <p className="text-sm text-muted-foreground mb-2">Membros da Equipe:</p>
                        <div className="flex flex-wrap gap-2">
                          {project.team.map((member) => (
                            <Badge key={member} variant="secondary">
                              {member}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timesheet" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Controle de Horas</CardTitle>
              <CardDescription>Registro de tempo gasto em projetos e tarefas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {timeEntries.map((entry) => {
                  const project = projects.find(p => p.id === entry.projectId)
                  const task = project?.tasks.find(t => t.id === entry.taskId)

                  return (
                    <div key={entry.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <p className="font-medium">{project?.name}</p>
                        <p className="text-sm text-muted-foreground">{task?.title}</p>
                        <p className="text-sm text-muted-foreground">{entry.description}</p>
                        <p className="text-sm">Por: {entry.user} em {entry.date}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">{entry.hours}h</p>
                        {entry.billable && (
                          <p className="text-sm text-green-600">
                            R$ {(entry.hours * entry.hourlyRate).toFixed(2)}
                          </p>
                        )}
                        <Badge variant={entry.billable ? "default" : "secondary"}>
                          {entry.billable ? "Faturável" : "Interno"}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
