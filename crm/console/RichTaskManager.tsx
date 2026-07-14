import { useState } from 'react'
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
import { Switch } from "@/switch"
import { Separator } from "@/separator"
import { Progress } from "@/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/avatar"
import {
  Plus,
  PencilSimple,
  Trash,
  DotsThree,
  Checks,
  Clock,
  CalendarBlank,
  Flag,
  User,
  ChatCircle,
  Paperclip,
  Tag,
  Link as LinkIcon,
  Code,
  Image as ImageIcon,
  ListBullets,
  ListNumbers,
  Quotes,
  TextHOne,
  TextHTwo,
  TextB,
  TextItalic,
  TextUnderline,
  Play,
  Pause,
  Target,
  Lightbulb,
  Robot,
  Lightning
} from "@phosphor-icons/react"
import type { Task, TaskTemplate, TaskComment, RichTextBlock } from '@/tasks'
import { KanbanBoard } from '@/KanbanBoard'

export function RichTaskManager() {
  const [selectedTab, setSelectedTab] = useState('tasks')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false)
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false)

  const [tasks, setTasks] = useKV<Task[]>('rich-tasks', [
    {
      id: 't1',
      title: 'Implementar Dashboard Analytics',
      description: '# Dashboard Analytics\n\nCriar dashboard interativo com métricas em tempo real.\n\n## Requisitos\n- [ ] Gráficos responsivos\n- [ ] Filtros dinâmicos\n- [ ] Export de dados\n- [x] Design aprovado\n\n**Observações importantes:**\n> Este dashboard será usado pelos executivos para tomada de decisão.\n\n```javascript\n// Exemplo de estrutura\nconst metrics = {\n  revenue: 150000,\n  conversion: 0.23\n}\n```',
      status: 'in_progress',
      priority: 'high',
      assignedTo: 'john-doe',
      assignedBy: 'admin',
      dueDate: '2024-12-25',
      estimatedHours: 24,
      actualHours: 8,
      relatedTo: {
        type: 'project',
        id: 'proj-1',
        name: 'CRM 2025'
      },
      dependencies: [],
      blockedBy: [],
      attachments: [],
      comments: [
        {
          id: 'c1',
          taskId: 't1',
          content: 'Protótipo do design está pronto para revisão. **Link:** [Figma](https://figma.com/prototype)',
          author: 'jane-designer',
          authorName: 'Jane Designer',
          createdAt: '2024-12-20T10:30:00Z',
          updatedAt: '2024-12-20T10:30:00Z',
          mentions: ['john-doe'],
          isInternal: true
        }
      ],
      subtasks: ['t1-1', 't1-2'],
      tags: ['frontend', 'analytics', 'dashboard'],
      labels: ['high-priority', 'sprint-3'],
      progress: 35,
      aiGenerated: false,
      aiSuggestions: [
        'Considere usar React Query para cache de dados',
        'Implemente lazy loading para componentes pesados',
        'Use Chart.js ou D3.js para visualizações'
      ],
      createdAt: '2024-12-18T09:00:00Z',
      updatedAt: '2024-12-20T10:30:00Z',
      createdBy: 'admin',
      updatedBy: 'jane-designer'
    },
    {
      id: 't2',
      title: 'Configurar CI/CD Pipeline',
      description: '# Pipeline DevOps\n\nConfiguração completa de integração e deploy contínuo.\n\n## Etapas\n1. **Setup GitHub Actions**\n   - Testes automatizados\n   - Build da aplicação\n   - Deploy para staging\n\n2. **Configuração Docker**\n   ```dockerfile\n   FROM node:18-alpine\n   WORKDIR /app\n   COPY package*.json ./\n   RUN npm ci\n   ```\n\n3. **Deploy Production**\n   - Configurar AWS/Vercel\n   - Monitoramento de performance\n   - Rollback automático\n\n> ![Atenção](/icons/warning.png) **Atenção:** Testar pipeline em ambiente de staging primeiro.',
      status: 'todo',
      priority: 'medium',
      assignedTo: 'bob-devops',
      assignedBy: 'admin',
      dueDate: '2024-12-30',
      estimatedHours: 16,
      actualHours: 0,
      dependencies: [],
      blockedBy: [],
      attachments: [],
      comments: [],
      subtasks: [],
      tags: ['devops', 'ci-cd', 'infrastructure'],
      labels: ['backend'],
      progress: 0,
      aiGenerated: true,
      aiSuggestions: [
        'Use GitHub Actions para CI/CD',
        'Configure Docker multi-stage builds',
        'Implemente health checks'
      ],
      createdAt: '2024-12-19T14:00:00Z',
      updatedAt: '2024-12-19T14:00:00Z',
      createdBy: 'admin',
      updatedBy: 'admin'
    }
  ])

  const [timeTracking, setTimeTracking] = useState<Record<string, { isRunning: boolean, startTime?: Date, totalTime: number }>>({})

  const toggleTimeTracking = (taskId: string) => {
    setTimeTracking(prev => {
      const current = prev[taskId] || { isRunning: false, totalTime: 0 }

      if (current.isRunning) {
        // Stop tracking
        const elapsed = current.startTime ? Date.now() - current.startTime.getTime() : 0
        return {
          ...prev,
          [taskId]: {
            isRunning: false,
            totalTime: current.totalTime + elapsed
          }
        }
      } else {
        // Start tracking
        return {
          ...prev,
          [taskId]: {
            isRunning: true,
            startTime: new Date(),
            totalTime: current.totalTime
          }
        }
      }
    })
  }

  const formatTime = (milliseconds: number) => {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60))
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'urgent': return 'text-red-600 bg-red-50 border-red-200'
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'low': return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const renderMarkdown = (content: string) => {
    // Simple markdown rendering for demo
    return content
      .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mb-4">$1</h1>')
      .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mb-3">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-muted pl-4 italic text-muted-foreground">$1</blockquote>')
      .replace(/- \[x\] (.+)$/gm, '<div class="flex items-center space-x-2 mb-1"><input type="checkbox" checked disabled class="rounded"><span class="line-through text-muted-foreground">$1</span></div>')
      .replace(/- \[ \] (.+)$/gm, '<div class="flex items-center space-x-2 mb-1"><input type="checkbox" disabled class="rounded"><span>$1</span></div>')
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-muted p-4 rounded-lg overflow-x-auto"><code class="text-sm font-mono">$2</code></pre>')
      .replace(/^\d+\. (.+)$/gm, '<li class="ml-4">$1</li>')
      .replace(/^- (.+)$/gm, '<li class="ml-4">• $1</li>')
      .split('\n').map(line => line.includes('<h') || line.includes('<li') || line.includes('<div') || line.includes('<blockquote') || line.includes('<pre') ? line : line ? `<p class="mb-2">${line}</p>` : '').join('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Checks className="h-6 w-6" />
            <span>Gestão Avançada de Tarefas</span>
          </h2>
          <p className="text-muted-foreground">
            Sistema rico de tarefas com editor markdown, time tracking e automação IA
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Lightbulb className="h-4 w-4 mr-2" />
                Templates
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Templates de Tarefas</DialogTitle>
                <DialogDescription>
                  Use templates pré-configurados para workflows comuns
                </DialogDescription>
              </DialogHeader>
              <TaskTemplates onUse={() => setIsTemplateDialogOpen(false)} />
            </DialogContent>
          </Dialog>

          <Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Nova Tarefa
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Criar Nova Tarefa</DialogTitle>
                <DialogDescription>
                  Use o editor rich text para criar tarefas detalhadas
                </DialogDescription>
              </DialogHeader>
              <RichTaskEditor onSave={() => setIsCreateTaskOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="tasks">Todas as Tarefas</TabsTrigger>
          <TabsTrigger value="kanban">Kanban Board</TabsTrigger>
          <TabsTrigger value="calendar">Calendário</TabsTrigger>
          <TabsTrigger value="time-tracking">Time Tracking</TabsTrigger>
        </TabsList>

        {/* Tasks List */}
        <TabsContent value="tasks" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {tasks.map((task) => (
              <Card key={task.id} className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <Badge className={`text-xs ${getPriorityColor(task.priority)}`}>
                          <Flag className="h-3 w-3 mr-1" />
                          {task.priority}
                        </Badge>
                        {task.aiGenerated && (
                          <Badge variant="outline" className="text-xs">
                            <Robot className="h-3 w-3 mr-1" />
                            IA
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs capitalize">
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <CardTitle
                        className="text-lg cursor-pointer hover:text-primary"
                        onClick={() => setSelectedTask(task)}
                      >
                        {task.title}
                      </CardTitle>
                    </div>
                    <Button variant="ghost" size="sm">
                      <DotsThree className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Rich Description Preview */}
                  <div className="text-sm text-muted-foreground line-clamp-3">
                    <div dangerouslySetInnerHTML={{
                      __html: renderMarkdown(task.description.split('\n').slice(0, 3).join('\n'))
                    }} />
                  </div>

                  {/* Progress */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Progresso</span>
                      <span className="text-xs font-medium">{task.progress}%</span>
                    </div>
                    <Progress value={task.progress} className="h-1" />
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1">
                    {task.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        <Tag className="h-3 w-3 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                    {task.tags.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{task.tags.length - 3}
                      </Badge>
                    )}
                  </div>

                  {/* Footer Info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {/* Assignee */}
                      <div className="flex items-center space-x-1">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-xs">
                            {task.assignedTo?.split('-').map(n => n[0]).join('').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>

                      {/* Comments */}
                      <div className="flex items-center space-x-1 text-muted-foreground">
                        <ChatCircle className="h-3 w-3" />
                        <span className="text-xs">{task.comments.length}</span>
                      </div>

                      {/* Attachments */}
                      <div className="flex items-center space-x-1 text-muted-foreground">
                        <Paperclip className="h-3 w-3" />
                        <span className="text-xs">{task.attachments.length}</span>
                      </div>

                      {/* Time Tracking */}
                      <div className="flex items-center space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleTimeTracking(task.id)}
                          className="h-6 w-6 p-0"
                        >
                          {timeTracking[task.id]?.isRunning ? (
                            <Pause className="h-3 w-3 text-red-500" />
                          ) : (
                            <Play className="h-3 w-3 text-green-500" />
                          )}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(timeTracking[task.id]?.totalTime || 0)}
                        </span>
                      </div>
                    </div>

                    {/* Due Date */}
                    {task.dueDate && (
                      <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                        <CalendarBlank className="h-3 w-3" />
                        <span>{new Date(task.dueDate).toLocaleDateString('pt-BR')}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Kanban Board */}
        <TabsContent value="kanban">
          <KanbanBoard
            type="tasks"
            title="Board de Tarefas"
            description="Gerencie suas tarefas visualmente com drag & drop"
          />
        </TabsContent>

        {/* Calendar View */}
        <TabsContent value="calendar">
          <div className="text-center py-12">
            <CalendarBlank className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Visualização em Calendário</h3>
            <p className="text-muted-foreground">
              Em breve: visualize suas tarefas organizadas por data de vencimento
            </p>
          </div>
        </TabsContent>

        {/* Time Tracking */}
        <TabsContent value="time-tracking" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Clock className="h-5 w-5" />
                <span>Relatório de Tempo</span>
              </CardTitle>
              <CardDescription>
                Acompanhe o tempo gasto em cada tarefa
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {tasks.map((task) => {
                  const tracking = timeTracking[task.id]
                  const totalMs = tracking?.totalTime || 0
                  const isRunning = tracking?.isRunning || false

                  return (
                    <div key={task.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <h4 className="font-medium">{task.title}</h4>
                        <div className="flex items-center space-x-4 mt-1 text-sm text-muted-foreground">
                          <span>Estimado: {task.estimatedHours}h</span>
                          <span>Atual: {task.actualHours}h</span>
                          <span>Sessão: {formatTime(totalMs)}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {isRunning && (
                          <Badge variant="secondary" className="animate-pulse">
                            <Clock className="h-3 w-3 mr-1" />
                            Ativo
                          </Badge>
                        )}
                        <Button
                          variant={isRunning ? "destructive" : "default"}
                          size="sm"
                          onClick={() => toggleTimeTracking(task.id)}
                        >
                          {isRunning ? (
                            <>
                              <Pause className="h-4 w-4 mr-2" />
                              Pausar
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-2" />
                              Iniciar
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updatedTask) => {
            setTasks(currentTasks =>
              currentTasks.map(task =>
                task.id === updatedTask.id ? updatedTask : task
              )
            )
            setSelectedTask(updatedTask)
          }}
        />
      )}
    </div>
  )
}

// Rich Task Editor Component
function RichTaskEditor({ task, onSave }: { task?: Task, onSave: () => void }) {
  const [title, setTitle] = useState(task?.title || '')
  const [description, setDescription] = useState(task?.description || '')
  const [priority, setPriority] = useState<Task['priority']>(task?.priority || 'medium')
  const [dueDate, setDueDate] = useState(task?.dueDate || '')
  const [estimatedHours, setEstimatedHours] = useState(task?.estimatedHours || 0)
  const [tags, setTags] = useState(task?.tags.join(', ') || '')
  const [isPreview, setIsPreview] = useState(false)

  const insertMarkdown = (markdown: string) => {
    setDescription(prev => prev + markdown)
  }

  const renderMarkdown = (content: string) => {
    return content
      .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mb-4">$1</h1>')
      .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mb-3">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-muted pl-4 italic text-muted-foreground mb-2">$1</blockquote>')
      .replace(/- \[x\] (.+)$/gm, '<div class="flex items-center space-x-2 mb-1"><input type="checkbox" checked disabled class="rounded"><span class="line-through text-muted-foreground">$1</span></div>')
      .replace(/- \[ \] (.+)$/gm, '<div class="flex items-center space-x-2 mb-1"><input type="checkbox" disabled class="rounded"><span>$1</span></div>')
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-muted p-4 rounded-lg overflow-x-auto mb-4"><code class="text-sm font-mono">$2</code></pre>')
      .split('\n').map(line => {
        if (line.includes('<h') || line.includes('<div') || line.includes('<blockquote') || line.includes('<pre')) return line
        return line ? `<p class="mb-2">${line}</p>` : ''
      }).join('')
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <Label htmlFor="title">Título da Tarefa</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Digite o título da tarefa..."
          className="text-lg"
        />
      </div>

      {/* Toolbar */}
      <div className="border rounded-lg p-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-1">
            <Button variant="ghost" size="sm" onClick={() => insertMarkdown('**texto em negrito**')}>
              <TextB className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => insertMarkdown('*texto em itálico*')}>
              <TextItalic className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => insertMarkdown('# Título Principal\n')}>
              <TextHOne className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => insertMarkdown('## Subtítulo\n')}>
              <TextHTwo className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <Button variant="ghost" size="sm" onClick={() => insertMarkdown('\n- [ ] Nova tarefa\n')}>
              <Checks className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => insertMarkdown('\n- Item da lista\n')}>
              <ListBullets className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => insertMarkdown('\n> Citação importante\n')}>
              <Quotes className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => insertMarkdown('\n```javascript\n// Seu código aqui\n```\n')}>
              <Code className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={() => setIsPreview(!isPreview)}>
              {isPreview ? 'Editar' : 'Preview'}
            </Button>
          </div>
        </div>

        {/* Editor */}
        {isPreview ? (
          <div className="min-h-[300px] p-4 border rounded bg-background">
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }} />
          </div>
        ) : (
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descreva a tarefa usando Markdown...

# Exemplo de Formatação
Use **negrito** e *itálico* para ênfase.

## Lista de Tarefas
- [ ] Tarefa pendente
- [x] Tarefa concluída

## Código
```javascript
const exemplo = 'código aqui'
```

> Use citações para destacar informações importantes"
            className="min-h-[300px] font-mono text-sm"
          />
        )}
      </div>

      {/* Task Details */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

        <div>
          <Label htmlFor="estimatedHours">Horas Estimadas</Label>
          <Input
            id="estimatedHours"
            type="number"
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(parseInt(e.target.value) || 0)}
            min="0"
            step="0.5"
          />
        </div>

        <div>
          <Label htmlFor="tags">Tags (separadas por vírgula)</Label>
          <Input
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="frontend, urgent, sprint-1"
          />
        </div>
      </div>

      {/* AI Suggestions */}
      <Card className="bg-accent/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center space-x-2">
            <Robot className="h-4 w-4" />
            <span>Sugestões da IA</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="p-2 bg-background rounded text-xs">
            💡 Use listas de verificação para dividir tarefas complexas
          </div>
          <div className="p-2 bg-background rounded text-xs">
            ⚡ Adicione códigos de exemplo para tarefas técnicas
          </div>
          <div className="p-2 bg-background rounded text-xs">
            📝 Documente requisitos e critérios de aceitação claramente
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onSave}>
          Cancelar
        </Button>
        <Button onClick={onSave} disabled={!title.trim()}>
          {task ? 'Atualizar' : 'Criar'} Tarefa
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
  const [isEditing, setIsEditing] = useState(false)

  const renderMarkdown = (content: string) => {
    return content
      .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mb-4">$1</h1>')
      .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mb-3">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-muted pl-4 italic text-muted-foreground mb-2">$1</blockquote>')
      .replace(/- \[x\] (.+)$/gm, '<div class="flex items-center space-x-2 mb-1"><input type="checkbox" checked disabled class="rounded"><span class="line-through text-muted-foreground">$1</span></div>')
      .replace(/- \[ \] (.+)$/gm, '<div class="flex items-center space-x-2 mb-1"><input type="checkbox" disabled class="rounded"><span>$1</span></div>')
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-muted p-4 rounded-lg overflow-x-auto mb-4"><code class="text-sm font-mono">$2</code></pre>')
      .split('\n').map(line => {
        if (line.includes('<h') || line.includes('<div') || line.includes('<blockquote') || line.includes('<pre')) return line
        return line ? `<p class="mb-2">${line}</p>` : ''
      }).join('')
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl">{task.title}</DialogTitle>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
              >
                <PencilSimple className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm">
                <Trash className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {isEditing ? (
          <RichTaskEditor
            task={task}
            onSave={() => {
              setIsEditing(false)
              // Update task logic here
            }}
          />
        ) : (
          <div className="grid grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="col-span-2 space-y-6">
              {/* Rich Description */}
              <div>
                <h3 className="font-semibold mb-4">Descrição</h3>
                <div
                  className="prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(task.description) }}
                />
              </div>

              {/* Progress */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Progresso</h3>
                  <span className="text-sm font-medium">{task.progress}%</span>
                </div>
                <Progress value={task.progress} className="h-2" />
              </div>

              {/* AI Suggestions */}
              {task.aiSuggestions.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2 flex items-center space-x-2">
                    <Lightning className="h-4 w-4 text-accent" />
                    <span>Sugestões da IA</span>
                  </h3>
                  <div className="space-y-2">
                    {task.aiSuggestions.map((suggestion, index) => (
                      <div key={index} className="p-3 bg-accent/10 rounded-lg text-sm">
                        {suggestion}
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                      <div
                        className="text-sm"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.content) }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Status & Priority */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-semibold">Status</Label>
                  <Badge className="mt-1 capitalize block w-fit">
                    {task.status.replace('_', ' ')}
                  </Badge>
                </div>

                <div>
                  <Label className="text-sm font-semibold">Prioridade</Label>
                  <Badge className={`mt-1 ${getPriorityColor(task.priority)} block w-fit`}>
                    <Flag className="h-3 w-3 mr-1" />
                    {task.priority}
                  </Badge>
                </div>
              </div>

              {/* Time Tracking */}
              <div>
                <Label className="text-sm font-semibold">Tempo</Label>
                <div className="space-y-1 mt-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estimado:</span>
                    <span>{(task.estimatedHours ?? 0)}h</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gasto:</span>
                    <span>{(task.actualHours ?? 0)}h</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Restante:</span>
                    <span>{Math.max(0, (task.estimatedHours ?? 0) - (task.actualHours ?? 0))}h</span>
                  </div>
                </div>
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
                  <span className="text-sm capitalize">
                    {task.assignedTo?.replace('-', ' ')}
                  </span>
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

              {/* Related Object */}
              {task.relatedTo && (
                <div>
                  <Label className="text-sm font-semibold">Relacionado</Label>
                  <div className="flex items-center space-x-2 mt-1">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{task.relatedTo.name}</span>
                  </div>
                </div>
              )}

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
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Task Templates Component
function TaskTemplates({ onUse }: { onUse: () => void }) {
  const templates = [
    {
      name: 'Customer Onboarding',
      description: 'Processo completo de onboarding de clientes',
      tasks: 7,
      estimatedTime: '16h',
      category: 'Sales'
    },
    {
      name: 'Lead Qualification',
      description: 'Workflow de qualificação de leads',
      tasks: 7,
      estimatedTime: '6h',
      category: 'Sales'
    },
    {
      name: 'Bug Report Investigation',
      description: 'Processo de investigação e correção de bugs',
      tasks: 5,
      estimatedTime: '8h',
      category: 'Development'
    },
    {
      name: 'Feature Development',
      description: 'Ciclo completo de desenvolvimento de funcionalidade',
      tasks: 8,
      estimatedTime: '40h',
      category: 'Development'
    }
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {templates.map((template) => (
        <Card key={template.name} className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="p-6">
            <div className="space-y-3">
              <div>
                <h4 className="font-semibold">{template.name}</h4>
                <Badge variant="outline" className="text-xs mt-1">
                  {template.category}
                </Badge>
              </div>

              <p className="text-sm text-muted-foreground">
                {template.description}
              </p>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{template.tasks} tarefas</span>
                <span>{template.estimatedTime}</span>
              </div>

              <Button variant="outline" size="sm" className="w-full" onClick={onUse}>
                <Lightbulb className="h-4 w-4 mr-2" />
                Usar Template
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
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
