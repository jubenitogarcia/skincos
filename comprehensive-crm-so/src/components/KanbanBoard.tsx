import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult
} from '@hello-pangea/dnd'
import {
  Plus,
  DotsThree,
  CalendarBlank,
  User,
  Flag,
  Clock,
  ChatCircle,
  Paperclip,
  Eye,
  PencilSimple,
  Trash,
  Checks,
  Target,
  Funnel,
  SquaresFour,
  List,
  CalendarDots,

} from "@phosphor-icons/react"
import type { Task, TaskColumn, TaskBoard } from '@/lib/tasks'
import type { Opportunity } from '@/lib/types'

interface KanbanBoardProps {
  type: 'tasks' | 'opportunities' | 'custom'
  objectId?: string
  title: string
  description: string
}

export function KanbanBoard({ type, objectId, title, description }: KanbanBoardProps) {
  const [selectedView, setSelectedView] = useState<'kanban' | 'list' | 'calendar'>('kanban')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<Task | Opportunity | null>(null)
  const [filterText, setFunnelText] = useState('')

  // Sample task data - in real app this would come from props or API
  const [tasks, setTasks] = useKV<Task[]>('kanban-tasks', [
    {
      id: '1',
      title: 'Implementar autenticação SSO',
      description: 'Configurar Single Sign-On para melhorar segurança',
      status: 'todo',
      priority: 'high',
      assignedTo: 'john-doe',
      assignedBy: 'admin',
      dueDate: '2024-12-25',
      estimatedHours: 8,
      actualHours: 0,
      dependencies: [],
      blockedBy: [],
      attachments: [],
      comments: [],
      subtasks: [],
      tags: ['security', 'authentication'],
      labels: ['backend'],
      progress: 0,
      aiGenerated: false,
      aiSuggestions: ['Considerar usar Auth0 ou Firebase Auth'],
      createdAt: '2024-12-20T10:00:00Z',
      updatedAt: '2024-12-20T10:00:00Z',
      createdBy: 'admin',
      updatedBy: 'admin'
    },
    {
      id: '2',
      title: 'Otimizar performance do dashboard',
      description: 'Melhorar tempo de carregamento dos gráficos analytics',
      status: 'in_progress',
      priority: 'medium',
      assignedTo: 'jane-smith',
      assignedBy: 'admin',
      dueDate: '2024-12-22',
      estimatedHours: 6,
      actualHours: 3,
      dependencies: [],
      blockedBy: [],
      attachments: [],
      comments: [
        {
          id: 'c1',
          taskId: '2',
          content: 'Já implementei lazy loading nos componentes principais',
          author: 'jane-smith',
          authorName: 'Jane Smith',
          createdAt: '2024-12-20T14:30:00Z',
          updatedAt: '2024-12-20T14:30:00Z',
          mentions: [],
          isInternal: true
        }
      ],
      subtasks: [],
      tags: ['performance', 'frontend'],
      labels: ['optimization'],
      progress: 50,
      aiGenerated: false,
      aiSuggestions: ['Usar React.memo para componentes pesados', 'Implementar virtualização para listas longas'],
      createdAt: '2024-12-19T09:00:00Z',
      updatedAt: '2024-12-20T14:30:00Z',
      createdBy: 'admin',
      updatedBy: 'jane-smith'
    },
    {
      id: '3',
      title: 'Revisar documentação da API',
      description: 'Atualizar documentação após mudanças recentes',
      status: 'review',
      priority: 'low',
      assignedTo: 'bob-wilson',
      assignedBy: 'admin',
      dueDate: '2024-12-28',
      estimatedHours: 4,
      actualHours: 4,
      dependencies: [],
      blockedBy: [],
      attachments: [],
      comments: [],
      subtasks: [],
      tags: ['documentation', 'api'],
      labels: ['docs'],
      progress: 100,
      aiGenerated: false,
      aiSuggestions: [],
      createdAt: '2024-12-18T16:00:00Z',
      updatedAt: '2024-12-20T16:00:00Z',
      createdBy: 'admin',
      updatedBy: 'bob-wilson'
    },
    {
      id: '4',
      title: 'Deploy versão v2.1',
      description: 'Fazer deploy da nova versão em produção',
      status: 'done',
      priority: 'high',
      assignedTo: 'john-doe',
      assignedBy: 'admin',
      dueDate: '2024-12-15',
      completedAt: '2024-12-15T18:00:00Z',
      estimatedHours: 2,
      actualHours: 1.5,
      dependencies: [],
      blockedBy: [],
      attachments: [],
      comments: [],
      subtasks: [],
      tags: ['deployment', 'release'],
      labels: ['devops'],
      progress: 100,
      aiGenerated: false,
      aiSuggestions: [],
      createdAt: '2024-12-15T08:00:00Z',
      updatedAt: '2024-12-15T18:00:00Z',
      createdBy: 'admin',
      updatedBy: 'john-doe'
    }
  ])

  const [columns, setColumns] = useKV<TaskColumn[]>('kanban-columns', [
    { id: 'todo', name: 'Para Fazer', status: 'todo', color: 'gray', position: 0, isCollapsed: false, taskLimit: 10 },
    { id: 'in_progress', name: 'Em Progresso', status: 'in_progress', color: 'blue', position: 1, isCollapsed: false, taskLimit: 5 },
    { id: 'review', name: 'Em Revisão', status: 'review', color: 'yellow', position: 2, isCollapsed: false, taskLimit: 3 },
    { id: 'done', name: 'Concluído', status: 'done', color: 'green', position: 3, isCollapsed: false }
  ])

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return

    const { source, destination, draggableId } = result

    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return
    }

    // Update task status based on destination column
    const newStatus = destination.droppableId as Task['status']
    setTasks(currentTasks =>
      currentTasks.map(task =>
        task.id === draggableId
          ? {
            ...task,
            status: newStatus,
            updatedAt: new Date().toISOString(),
            ...(newStatus === 'done' ? { completedAt: new Date().toISOString(), progress: 100 } : {})
          }
          : task
      )
    )
  }

  const getTasksByStatus = (status: Task['status']) => {
    return tasks
      .filter(task => task.status === status)
      .filter(task =>
        filterText === '' ||
        task.title.toLowerCase().includes(filterText.toLowerCase()) ||
        task.tags.some(tag => tag.toLowerCase().includes(filterText.toLowerCase()))
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'urgent': return 'text-red-600 bg-red-50 border-red-200'
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'low': return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getPriorityIcon = (priority: Task['priority']) => {
    switch (priority) {
      case 'urgent': return <Flag className="h-3 w-3" weight="fill" />
      case 'high': return <Flag className="h-3 w-3" weight="bold" />
      case 'medium': return <Flag className="h-3 w-3" />
      case 'low': return <Flag className="h-3 w-3" weight="light" />
    }
  }

  const formatDueDate = (dueDate: string) => {
    const date = new Date(dueDate)
    const now = new Date()
    const diffTime = date.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 0) return { text: `${Math.abs(diffDays)}d atrasado`, color: 'text-red-600' }
    if (diffDays === 0) return { text: 'Hoje', color: 'text-orange-600' }
    if (diffDays === 1) return { text: 'Amanhã', color: 'text-yellow-600' }
    if (diffDays <= 7) return { text: `${diffDays}d`, color: 'text-blue-600' }
    return { text: date.toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' }), color: 'text-gray-600' }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center space-x-2">
          {/* View Toggle */}
          <div className="flex items-center bg-card border rounded-lg p-1">
            <Button
              variant={selectedView === 'kanban' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSelectedView('kanban')}
              className="h-8"
            >
              <SquaresFour className="h-4 w-4" />
            </Button>
            <Button
              variant={selectedView === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSelectedView('list')}
              className="h-8"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={selectedView === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSelectedView('calendar')}
              className="h-8"
            >
              <CalendarDots className="h-4 w-4" />
            </Button>
          </div>

          {/* Funnel */}
          <div className="relative">
            <Funnel className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar tarefas..."
              value={filterText}
              onChange={(e) => setFunnelText(e.target.value)}
              className="pl-10 w-64"
            />
          </div>

          {/* Add Task */}
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Nova Tarefa
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Nova Tarefa</DialogTitle>
                <DialogDescription>
                  Adicione uma nova tarefa ao seu board Kanban
                </DialogDescription>
              </DialogHeader>
              <CreateTaskForm onSave={() => setIsCreateDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Kanban Board */}
      {selectedView === 'kanban' && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {columns.map((column) => (
              <div key={column.id} className="flex flex-col">
                {/* Column Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full bg-${column.color}-500`} />
                    <h3 className="font-semibold">{column.name}</h3>
                    <Badge variant="secondary" className="text-xs">
                      {getTasksByStatus(column.status).length}
                    </Badge>
                    {column.taskLimit && getTasksByStatus(column.status).length >= column.taskLimit && (
                      <Badge variant="destructive" className="text-xs">
                        WIP Limit
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm">
                    <DotsThree className="h-4 w-4" />
                  </Button>
                </div>

                {/* Tasks */}
                <Droppable droppableId={column.status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 space-y-3 min-h-[200px] p-2 rounded-lg transition-colors ${snapshot.isDraggingOver ? 'bg-accent/20' : ''
                        }`}
                    >
                      {getTasksByStatus(column.status).map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <Card
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`cursor-pointer hover:shadow-md transition-shadow ${snapshot.isDragging ? 'rotate-2 shadow-lg' : ''
                                }`}
                              onClick={() => setSelectedItem(task)}
                            >
                              <CardContent className="p-4">
                                {/* Priority & Tags */}
                                <div className="flex items-center justify-between mb-2">
                                  <Badge className={`text-xs ${getPriorityColor(task.priority)}`}>
                                    {getPriorityIcon(task.priority)}
                                    <span className="ml-1 capitalize">{task.priority}</span>
                                  </Badge>
                                  {task.aiGenerated && (
                                    <Badge variant="outline" className="text-xs">
                                      <Checks className="h-3 w-3 mr-1" />
                                      IA
                                    </Badge>
                                  )}
                                </div>

                                {/* Title */}
                                <h4 className="font-medium mb-2 line-clamp-2">{task.title}</h4>

                                {/* Description */}
                                {task.description && (
                                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                                    {task.description}
                                  </p>
                                )}

                                {/* Progress */}
                                {task.progress > 0 && (
                                  <div className="mb-3">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs text-muted-foreground">Progresso</span>
                                      <span className="text-xs font-medium">{task.progress}%</span>
                                    </div>
                                    <Progress value={task.progress} className="h-1" />
                                  </div>
                                )}

                                {/* Tags */}
                                {task.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mb-3">
                                    {task.tags.slice(0, 2).map((tag) => (
                                      <Badge key={tag} variant="outline" className="text-xs">
                                        {tag}
                                      </Badge>
                                    ))}
                                    {task.tags.length > 2 && (
                                      <Badge variant="outline" className="text-xs">
                                        +{task.tags.length - 2}
                                      </Badge>
                                    )}
                                  </div>
                                )}

                                {/* Footer */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2">
                                    {/* Assignee */}
                                    {task.assignedTo && (
                                      <Avatar className="h-6 w-6">
                                        <AvatarFallback className="text-xs">
                                          {task.assignedTo.split('-').map(n => n[0]).join('').toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                    )}

                                    {/* Comments */}
                                    {task.comments.length > 0 && (
                                      <div className="flex items-center space-x-1">
                                        <ChatCircle className="h-3 w-3 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground">
                                          {task.comments.length}
                                        </span>
                                      </div>
                                    )}

                                    {/* Attachments */}
                                    {task.attachments.length > 0 && (
                                      <div className="flex items-center space-x-1">
                                        <Paperclip className="h-3 w-3 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground">
                                          {task.attachments.length}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Due Date */}
                                  {task.dueDate && (
                                    <div className={`flex items-center space-x-1 ${formatDueDate(task.dueDate).color}`}>
                                      <CalendarBlank className="h-3 w-3" />
                                      <span className="text-xs">
                                        {formatDueDate(task.dueDate).text}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}

                      {/* Add Task Button */}
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground border-2 border-dashed border-muted"
                        onClick={() => setIsCreateDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Adicionar tarefa
                      </Button>
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      )}

      {/* Task Detail Modal */}
      {selectedItem && (
        <TaskDetailModal
          task={selectedItem as Task}
          isOpen={!!selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdate={(updatedTask) => {
            setTasks(currentTasks =>
              currentTasks.map(task =>
                task.id === updatedTask.id ? updatedTask : task
              )
            )
            setSelectedItem(updatedTask)
          }}
        />
      )}
    </div>
  )
}

// Create Task Form Component
function CreateTaskForm({ onSave }: { onSave: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [dueDate, setDueDate] = useState('')

  const handleSave = () => {
    // Here you would create the new task
    console.log('Creating task:', { title, description, priority, dueDate })
    onSave()
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="title">Título</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Digite o título da tarefa"
        />
      </div>

      <div>
        <Label htmlFor="description">Descrição</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descreva a tarefa..."
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="priority">Prioridade</Label>
          <Select value={priority} onValueChange={(value: Task['priority']) => setPriority(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Baixa</SelectItem>
              <SelectItem value="medium">Média</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="dueDate">Data de Vencimento</Label>
          <Input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onSave}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={!title.trim()}>
          Criar Tarefa
        </Button>
      </div>
    </div>
  )
}

// Task Detail Modal Component
function TaskDetailModal({
  task,
  isOpen,
  onClose,
  onUpdate
}: {
  task: Task
  isOpen: boolean
  onClose: () => void
  onUpdate: (task: Task) => void
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl">{task.title}</DialogTitle>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                <PencilSimple className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm">
                <Trash className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="col-span-2 space-y-6">
            {/* Description */}
            <div>
              <h3 className="font-semibold mb-2">Descrição</h3>
              <p className="text-muted-foreground">{task.description}</p>
            </div>

            {/* Progress */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Progresso</h3>
                <span className="text-sm font-medium">{task.progress}%</span>
              </div>
              <Progress value={task.progress} className="h-2" />
            </div>

            {/* Comments */}
            <div>
              <h3 className="font-semibold mb-2">Comentários ({task.comments.length})</h3>
              <div className="space-y-3">
                {task.comments.map((comment) => (
                  <div key={comment.id} className="p-3 bg-muted rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{comment.authorName}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(comment.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <p className="text-sm">{comment.content}</p>
                  </div>
                ))}
                <div className="flex space-x-2">
                  <Input placeholder="Adicionar comentário..." className="flex-1" />
                  <Button size="sm">Enviar</Button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Status */}
            <div>
              <Label className="text-sm font-semibold">Status</Label>
              <Badge className="mt-1 capitalize">{task.status.replace('_', ' ')}</Badge>
            </div>

            {/* Priority */}
            <div>
              <Label className="text-sm font-semibold">Prioridade</Label>
              <Badge className={`mt-1 ${getPriorityColor(task.priority)}`}>
                {getPriorityIcon(task.priority)}
                <span className="ml-1 capitalize">{task.priority}</span>
              </Badge>
            </div>

            {/* Assignee */}
            <div>
              <Label className="text-sm font-semibold">Responsável</Label>
              <div className="flex items-center space-x-2 mt-1">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs">
                    {task.assignedTo?.split('-').map(n => n[0]).join('').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm capitalize">{task.assignedTo?.replace('-', ' ')}</span>
              </div>
            </div>

            {/* Due Date */}
            {task.dueDate && (
              <div>
                <Label className="text-sm font-semibold">Vencimento</Label>
                <div className="flex items-center space-x-2 mt-1">
                  <CalendarBlank className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {new Date(task.dueDate).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </div>
            )}

            {/* Time Tracking */}
            <div>
              <Label className="text-sm font-semibold">Tempo</Label>
              <div className="space-y-1 mt-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Estimado:</span>
                  <span>{task.estimatedHours}h</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Gasto:</span>
                  <span>{task.actualHours}h</span>
                </div>
              </div>
            </div>

            {/* Tags */}
            <div>
              <Label className="text-sm font-semibold">Tags</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {task.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>

            {/* AI Suggestions */}
            {task.aiSuggestions.length > 0 && (
              <div>
                <Label className="text-sm font-semibold">Sugestões da IA</Label>
                <div className="space-y-2 mt-1">
                  {task.aiSuggestions.map((suggestion, index) => (
                    <div key={index} className="p-2 bg-accent/10 rounded text-xs">
                      {suggestion}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function getPriorityColor(priority: Task['priority']) {
  switch (priority) {
    case 'urgent': return 'text-red-600 bg-red-50 border-red-200'
    case 'high': return 'text-orange-600 bg-orange-50 border-orange-200'
    case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    case 'low': return 'text-gray-600 bg-gray-50 border-gray-200'
  }
}

function getPriorityIcon(priority: Task['priority']) {
  switch (priority) {
    case 'urgent': return <Flag className="h-3 w-3" weight="fill" />
    case 'high': return <Flag className="h-3 w-3" weight="bold" />
    case 'medium': return <Flag className="h-3 w-3" />
    case 'low': return <Flag className="h-3 w-3" weight="light" />
  }
}
