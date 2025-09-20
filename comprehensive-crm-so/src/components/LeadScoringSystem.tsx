import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { toast } from 'sonner'
import {
  TrendUp,
  Target,
  Star,
  Brain,
  Lightning,
  Users,
  ChartBar,
  Gear,
  Plus,
  PencilSimple,
  Trash,
  Eye,
  CalendarBlank,
  Envelope,
  Phone,
  Globe,
  Building,
  CheckCircle,
  XCircle,
  Clock,
  Fire,
  Trophy,
  TrendDown
} from "@phosphor-icons/react"

interface ScoringRule {
  id: string
  name: string
  description: string
  category: 'demographic' | 'behavioral' | 'engagement' | 'company' | 'custom'
  field: string
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'in_range' | 'exists' | 'not_exists'
  value: string | number | string[]
  score: number
  weight: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface LeadScore {
  leadId: string
  leadName: string
  company: string
  email: string
  phone: string
  totalScore: number
  maxPossibleScore: number
  scorePercentage: number
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F'
  priority: 'hot' | 'warm' | 'cold' | 'unqualified'
  breakdown: ScoringBreakdown[]
  lastCalculated: string
  trend: 'up' | 'down' | 'stable'
  previousScore?: number
}

interface ScoringBreakdown {
  ruleId: string
  ruleName: string
  category: string
  earnedScore: number
  maxScore: number
  matched: boolean
  matchedValue?: string
}

interface ScoringTemplate {
  id: string
  name: string
  description: string
  rules: ScoringRule[]
  thresholds: {
    hot: number
    warm: number
    cold: number
  }
  isDefault: boolean
  isActive: boolean
  createdAt: string
}

export function LeadScoringSystem() {
  const [scoringRules, setScoringRules] = useKV<ScoringRule[]>("scoring-rules", [])
  const [leadScores, setLeadScores] = useKV<LeadScore[]>("lead-scores", [])
  const [templates, setTemplates] = useKV<ScoringTemplate[]>("scoring-templates", [])
  const [selectedRule, setSelectedRule] = useState<ScoringRule | null>(null)
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)
  const [isEditRuleOpen, setIsEditRuleOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")
  const [filterCategory, setFunnelCategory] = useState<string>("all")
  const [filterPriority, setFunnelPriority] = useState<string>("all")

  // Initialize with sample data if empty
  useEffect(() => {
    if (scoringRules.length === 0) {
      const sampleRules: ScoringRule[] = [
        {
          id: "1",
          name: "CEO/Founder Title",
          description: "Lead has CEO or Founder title",
          category: "demographic",
          field: "job_title",
          operator: "contains",
          value: ["CEO", "Founder", "President"],
          score: 25,
          weight: 1.5,
          isActive: true,
          createdAt: "2024-01-15T10:00:00Z",
          updatedAt: "2024-03-10T14:30:00Z"
        },
        {
          id: "2",
          name: "Large Company Size",
          description: "Company has more than 500 employees",
          category: "company",
          field: "company_size",
          operator: "greater_than",
          value: 500,
          score: 20,
          weight: 1.2,
          isActive: true,
          createdAt: "2024-01-16T09:00:00Z",
          updatedAt: "2024-03-08T16:45:00Z"
        },
        {
          id: "3",
          name: "Email Opened",
          description: "Lead opened marketing email",
          category: "engagement",
          field: "email_opened",
          operator: "exists",
          value: "true",
          score: 15,
          weight: 1.0,
          isActive: true,
          createdAt: "2024-01-17T11:30:00Z",
          updatedAt: "2024-03-12T09:15:00Z"
        },
        {
          id: "4",
          name: "Website Visit",
          description: "Lead visited pricing page",
          category: "behavioral",
          field: "visited_pricing",
          operator: "equals",
          value: "true",
          score: 30,
          weight: 1.8,
          isActive: true,
          createdAt: "2024-01-18T14:20:00Z",
          updatedAt: "2024-03-11T12:00:00Z"
        },
        {
          id: "5",
          name: "Technology Industry",
          description: "Lead is from technology industry",
          category: "company",
          field: "industry",
          operator: "equals",
          value: "Technology",
          score: 18,
          weight: 1.3,
          isActive: true,
          createdAt: "2024-01-19T08:45:00Z",
          updatedAt: "2024-03-09T15:30:00Z"
        }
      ]
      setScoringRules(sampleRules)
    }

    if (leadScores.length === 0) {
      const sampleScores: LeadScore[] = [
        {
          leadId: "lead-1",
          leadName: "Ana Silva",
          company: "TechCorp Solutions",
          email: "ana@techcorp.com",
          phone: "+55 11 99999-1234",
          totalScore: 88,
          maxPossibleScore: 108,
          scorePercentage: 81.5,
          grade: "A",
          priority: "hot",
          breakdown: [
            {
              ruleId: "1",
              ruleName: "CEO/Founder Title",
              category: "demographic",
              earnedScore: 25,
              maxScore: 25,
              matched: true,
              matchedValue: "CEO"
            },
            {
              ruleId: "2",
              ruleName: "Large Company Size",
              category: "company",
              earnedScore: 20,
              maxScore: 20,
              matched: true,
              matchedValue: "800"
            },
            {
              ruleId: "3",
              ruleName: "Email Opened",
              category: "engagement",
              earnedScore: 15,
              maxScore: 15,
              matched: true
            },
            {
              ruleId: "4",
              ruleName: "Website Visit",
              category: "behavioral",
              earnedScore: 30,
              maxScore: 30,
              matched: true
            },
            {
              ruleId: "5",
              ruleName: "Technology Industry",
              category: "company",
              earnedScore: 18,
              maxScore: 18,
              matched: true,
              matchedValue: "Technology"
            }
          ],
          lastCalculated: "2024-03-15T10:30:00Z",
          trend: "up",
          previousScore: 75
        },
        {
          leadId: "lead-2",
          leadName: "Carlos Santos",
          company: "Manufacturing Plus",
          email: "carlos@manplus.com",
          phone: "+55 11 88888-5678",
          totalScore: 45,
          maxPossibleScore: 108,
          scorePercentage: 41.7,
          grade: "C",
          priority: "warm",
          breakdown: [
            {
              ruleId: "1",
              ruleName: "CEO/Founder Title",
              category: "demographic",
              earnedScore: 0,
              maxScore: 25,
              matched: false
            },
            {
              ruleId: "2",
              ruleName: "Large Company Size",
              category: "company",
              earnedScore: 20,
              maxScore: 20,
              matched: true,
              matchedValue: "650"
            },
            {
              ruleId: "3",
              ruleName: "Email Opened",
              category: "engagement",
              earnedScore: 15,
              maxScore: 15,
              matched: true
            },
            {
              ruleId: "4",
              ruleName: "Website Visit",
              category: "behavioral",
              earnedScore: 0,
              maxScore: 30,
              matched: false
            },
            {
              ruleId: "5",
              ruleName: "Technology Industry",
              category: "company",
              earnedScore: 0,
              maxScore: 18,
              matched: false,
              matchedValue: "Manufacturing"
            }
          ],
          lastCalculated: "2024-03-15T09:15:00Z",
          trend: "stable",
          previousScore: 45
        },
        {
          leadId: "lead-3",
          leadName: "Maria Costa",
          company: "StartupTech",
          email: "maria@startuptech.com",
          phone: "+55 11 77777-9012",
          totalScore: 63,
          maxPossibleScore: 108,
          scorePercentage: 58.3,
          grade: "B",
          priority: "warm",
          breakdown: [
            {
              ruleId: "1",
              ruleName: "CEO/Founder Title",
              category: "demographic",
              earnedScore: 25,
              maxScore: 25,
              matched: true,
              matchedValue: "Founder"
            },
            {
              ruleId: "2",
              ruleName: "Large Company Size",
              category: "company",
              earnedScore: 0,
              maxScore: 20,
              matched: false,
              matchedValue: "50"
            },
            {
              ruleId: "3",
              ruleName: "Email Opened",
              category: "engagement",
              earnedScore: 0,
              maxScore: 15,
              matched: false
            },
            {
              ruleId: "4",
              ruleName: "Website Visit",
              category: "behavioral",
              earnedScore: 30,
              maxScore: 30,
              matched: true
            },
            {
              ruleId: "5",
              ruleName: "Technology Industry",
              category: "company",
              earnedScore: 18,
              maxScore: 18,
              matched: true,
              matchedValue: "Technology"
            }
          ],
          lastCalculated: "2024-03-15T11:45:00Z",
          trend: "down",
          previousScore: 78
        }
      ]
      setLeadScores(sampleScores)
    }
  }, [scoringRules.length, leadScores.length, setScoringRules, setLeadScores])

  const handleCreateRule = (ruleData: Partial<ScoringRule>) => {
    const newRule: ScoringRule = {
      id: Date.now().toString(),
      name: ruleData.name || "",
      description: ruleData.description || "",
      category: ruleData.category || "custom",
      field: ruleData.field || "",
      operator: ruleData.operator || "equals",
      value: ruleData.value || "",
      score: ruleData.score || 0,
      weight: ruleData.weight || 1.0,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setScoringRules(prev => [...prev, newRule])
    setIsCreateRuleOpen(false)
    toast.success("Regra de pontuação criada com sucesso!")
  }

  const handleEditRule = (ruleData: Partial<ScoringRule>) => {
    if (!selectedRule) return

    setScoringRules(prev => prev.map(rule =>
      rule.id === selectedRule.id
        ? { ...rule, ...ruleData, updatedAt: new Date().toISOString() }
        : rule
    ))
    setIsEditRuleOpen(false)
    setSelectedRule(null)
    toast.success("Regra atualizada com sucesso!")
  }

  const handleDeleteRule = (ruleId: string) => {
    setScoringRules(prev => prev.filter(rule => rule.id !== ruleId))
    toast.success("Regra removida com sucesso!")
  }

  const handleToggleRuleStatus = (ruleId: string) => {
    setScoringRules(prev => prev.map(rule =>
      rule.id === ruleId
        ? { ...rule, isActive: !rule.isActive, updatedAt: new Date().toISOString() }
        : rule
    ))
    toast.success("Status da regra alterado!")
  }

  const recalculateScores = () => {
    // In a real implementation, this would recalculate scores for all leads
    toast.success("Pontuações recalculadas com sucesso!")
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'demographic': return <Users className="h-4 w-4" />
      case 'behavioral': return <TrendUp className="h-4 w-4" />
      case 'engagement': return <Envelope className="h-4 w-4" />
      case 'company': return <Building className="h-4 w-4" />
      default: return <Gear className="h-4 w-4" />
    }
  }

  const getCategoryName = (category: string) => {
    switch (category) {
      case 'demographic': return 'Demográfico'
      case 'behavioral': return 'Comportamental'
      case 'engagement': return 'Engajamento'
      case 'company': return 'Empresa'
      default: return 'Personalizado'
    }
  }

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'hot': return <Fire className="h-4 w-4 text-red-500" />
      case 'warm': return <TrendUp className="h-4 w-4 text-orange-500" />
      case 'cold': return <Clock className="h-4 w-4 text-blue-500" />
      default: return <XCircle className="h-4 w-4 text-gray-500" />
    }
  }

  const getPriorityName = (priority: string) => {
    switch (priority) {
      case 'hot': return 'Quente'
      case 'warm': return 'Morno'
      case 'cold': return 'Frio'
      default: return 'Não Qualificado'
    }
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendUp className="h-4 w-4 text-green-500" />
      case 'down': return <TrendDown className="h-4 w-4 text-red-500" />
      default: return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A': return 'text-green-600 bg-green-100'
      case 'B+':
      case 'B': return 'text-blue-600 bg-blue-100'
      case 'C+':
      case 'C': return 'text-yellow-600 bg-yellow-100'
      case 'D': return 'text-orange-600 bg-orange-100'
      case 'F': return 'text-red-600 bg-red-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  // Funnel leads based on category and priority
  const filteredScores = leadScores.filter(score => {
    const categoryMatch = filterCategory === "all" ||
      score.breakdown.some(b => b.category === filterCategory && b.matched)
    const priorityMatch = filterPriority === "all" || score.priority === filterPriority
    return categoryMatch && priorityMatch
  })

  // Calculate summary statistics
  const totalLeads = leadScores.length
  const hotLeads = leadScores.filter(s => s.priority === 'hot').length
  const warmLeads = leadScores.filter(s => s.priority === 'warm').length
  const coldLeads = leadScores.filter(s => s.priority === 'cold').length
  const averageScore = totalLeads > 0
    ? leadScores.reduce((sum, s) => sum + s.scorePercentage, 0) / totalLeads
    : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Sistema de Lead Scoring</h2>
          <p className="text-muted-foreground">
            Configure regras inteligentes para pontuar e priorizar leads automaticamente
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={recalculateScores}>
            <Brain className="h-4 w-4 mr-2" />
            Recalcular
          </Button>
          <Dialog open={isCreateRuleOpen} onOpenChange={setIsCreateRuleOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Nova Regra
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Nova Regra de Pontuação</DialogTitle>
              </DialogHeader>
              <ScoringRuleForm onSubmit={handleCreateRule} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Overview Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total de Leads</p>
                <p className="text-2xl font-bold">{totalLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Fire className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Leads Quentes</p>
                <p className="text-2xl font-bold text-red-600">{hotLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Leads Mornos</p>
                <p className="text-2xl font-bold text-orange-600">{warmLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Clock className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Leads Frios</p>
                <p className="text-2xl font-bold text-blue-600">{coldLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <ChartBar className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Score Médio</p>
                <p className="text-2xl font-bold text-purple-600">{averageScore.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="rules">Regras</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Top Performing Rules */}
          <Card>
            <CardHeader>
              <CardTitle>Regras Mais Efetivas</CardTitle>
              <CardDescription>
                Regras que mais contribuem para identificar leads de alta qualidade
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {scoringRules
                  .filter(rule => rule.isActive)
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 5)
                  .map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        {getCategoryIcon(rule.category)}
                        <div>
                          <p className="font-medium">{rule.name}</p>
                          <p className="text-sm text-muted-foreground">{rule.description}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-lg">{rule.score} pts</p>
                        <Badge variant="outline">
                          {getCategoryName(rule.category)}
                        </Badge>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Score Changes */}
          <Card>
            <CardHeader>
              <CardTitle>Mudanças Recentes de Score</CardTitle>
              <CardDescription>
                Leads com alterações significativas de pontuação
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {leadScores
                  .filter(score => score.trend !== 'stable')
                  .slice(0, 5)
                  .map((score) => (
                    <div key={score.leadId} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        {getTrendIcon(score.trend)}
                        <div>
                          <p className="font-medium">{score.leadName}</p>
                          <p className="text-sm text-muted-foreground">{score.company}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center space-x-2">
                          <Badge className={getGradeColor(score.grade)}>
                            {score.grade}
                          </Badge>
                          <span className="text-lg font-semibold">{score.totalScore}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {score.previousScore && (
                            <>
                              {score.previousScore} → {score.totalScore}
                              {score.trend === 'up' && (
                                <span className="text-green-600 ml-1">
                                  (+{score.totalScore - score.previousScore})
                                </span>
                              )}
                              {score.trend === 'down' && (
                                <span className="text-red-600 ml-1">
                                  ({score.totalScore - score.previousScore})
                                </span>
                              )}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {scoringRules.map((rule) => (
              <Card key={rule.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getCategoryIcon(rule.category)}
                      <CardTitle className="text-lg">{rule.name}</CardTitle>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={rule.isActive ? "default" : "secondary"}>
                        {rule.isActive ? "Ativa" : "Inativa"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedRule(rule)
                          setIsEditRuleOpen(true)
                        }}
                      >
                        <PencilSimple className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>{rule.description}</CardDescription>
                  <Badge variant="outline" className="w-fit">
                    {getCategoryName(rule.category)}
                  </Badge>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Rule Configuration */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      CONFIGURAÇÃO
                    </Label>
                    <div className="mt-1 text-sm">
                      <p><strong>Campo:</strong> {rule.field}</p>
                      <p><strong>Operador:</strong> {rule.operator}</p>
                      <p><strong>Valor:</strong> {Array.isArray(rule.value) ? rule.value.join(', ') : rule.value}</p>
                    </div>
                  </div>

                  {/* Scoring Details */}
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                    <div>
                      <p className="text-xs text-muted-foreground">Pontos</p>
                      <p className="font-semibold text-lg">{rule.score}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Peso</p>
                      <p className="font-semibold text-lg">{rule.weight}x</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex space-x-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleToggleRuleStatus(rule.id)}
                    >
                      {rule.isActive ? "Desativar" : "Ativar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteRule(rule.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leads" className="space-y-6">
          {/* Funnels */}
          <div className="flex items-center space-x-4">
            <Select value={filterCategory} onValueChange={setFunnelCategory}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filtrar por categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                <SelectItem value="demographic">Demográfico</SelectItem>
                <SelectItem value="behavioral">Comportamental</SelectItem>
                <SelectItem value="engagement">Engajamento</SelectItem>
                <SelectItem value="company">Empresa</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterPriority} onValueChange={setFunnelPriority}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filtrar por prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as prioridades</SelectItem>
                <SelectItem value="hot">Quente</SelectItem>
                <SelectItem value="warm">Morno</SelectItem>
                <SelectItem value="cold">Frio</SelectItem>
                <SelectItem value="unqualified">Não Qualificado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Leads Scoring List */}
          <div className="space-y-4">
            {filteredScores.map((score) => (
              <Card key={score.leadId} className="relative">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {getPriorityIcon(score.priority)}
                      <div>
                        <h3 className="font-semibold text-lg">{score.leadName}</h3>
                        <p className="text-muted-foreground">{score.company}</p>
                        <p className="text-sm text-muted-foreground">{score.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-6">
                      {/* Score Progress */}
                      <div className="text-center">
                        <div className="flex items-center space-x-2 mb-2">
                          <Badge className={getGradeColor(score.grade)}>
                            {score.grade}
                          </Badge>
                          {getTrendIcon(score.trend)}
                        </div>
                        <Progress
                          value={score.scorePercentage}
                          className="w-24 h-2"
                        />
                        <p className="text-sm font-medium mt-1">
                          {score.scorePercentage.toFixed(1)}%
                        </p>
                      </div>

                      {/* Score Details */}
                      <div className="text-right">
                        <p className="text-2xl font-bold">{score.totalScore}</p>
                        <p className="text-sm text-muted-foreground">
                          de {score.maxPossibleScore} pontos
                        </p>
                        <Badge variant="outline">
                          {getPriorityName(score.priority)}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Score Breakdown */}
                  <div className="mt-4 pt-4 border-t">
                    <Label className="text-xs font-medium text-muted-foreground mb-2 block">
                      BREAKDOWN DE PONTUAÇÃO
                    </Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {score.breakdown.map((breakdown) => (
                        <div
                          key={breakdown.ruleId}
                          className={`p-3 rounded-lg border ${breakdown.matched
                            ? 'bg-green-50 border-green-200'
                            : 'bg-gray-50 border-gray-200'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              {breakdown.matched ? (
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              ) : (
                                <XCircle className="h-4 w-4 text-gray-400" />
                              )}
                              <span className="text-sm font-medium">
                                {breakdown.ruleName}
                              </span>
                            </div>
                            <span className="font-semibold">
                              {breakdown.earnedScore}/{breakdown.maxScore}
                            </span>
                          </div>
                          {breakdown.matchedValue && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Valor: {breakdown.matchedValue}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Distribuição de Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'].map((grade) => {
                    const count = leadScores.filter(s => s.grade === grade).length
                    const percentage = totalLeads > 0 ? (count / totalLeads) * 100 : 0

                    return (
                      <div key={grade} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Grade {grade}</span>
                          <span className="text-sm text-muted-foreground">
                            {count} leads ({percentage.toFixed(1)}%)
                          </span>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance por Categoria</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {['demographic', 'behavioral', 'engagement', 'company', 'custom'].map((category) => {
                    const categoryRules = scoringRules.filter(r => r.category === category && r.isActive)
                    const avgMatches = leadScores.length > 0
                      ? leadScores.reduce((sum, score) => {
                        const categoryMatches = score.breakdown.filter(b => b.category === category && b.matched).length
                        return sum + categoryMatches
                      }, 0) / leadScores.length
                      : 0

                    return (
                      <div key={category} className="flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                          {getCategoryIcon(category)}
                          <span className="font-medium">{getCategoryName(category)}</span>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{avgMatches.toFixed(1)}</p>
                          <p className="text-sm text-muted-foreground">
                            matches médios
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Rule Modal */}
      <Dialog open={isEditRuleOpen} onOpenChange={setIsEditRuleOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Regra de Pontuação</DialogTitle>
          </DialogHeader>
          {selectedRule && (
            <ScoringRuleForm
              rule={selectedRule}
              onSubmit={handleEditRule}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Scoring Rule Form Component
function ScoringRuleForm({
  rule,
  onSubmit
}: {
  rule?: ScoringRule
  onSubmit: (data: Partial<ScoringRule>) => void
}) {
  const [formData, setFormData] = useState({
    name: rule?.name || "",
    description: rule?.description || "",
    category: rule?.category || "custom",
    field: rule?.field || "",
    operator: rule?.operator || "equals",
    value: rule?.value || "",
    score: rule?.score || 0,
    weight: rule?.weight || 1.0
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome da Regra</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: CEO/Founder Title"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Categoria</Label>
          <Select
            value={formData.category}
            onValueChange={(value) => setFormData(prev => ({ ...prev, category: value as any }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione a categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="demographic">Demográfico</SelectItem>
              <SelectItem value="behavioral">Comportamental</SelectItem>
              <SelectItem value="engagement">Engajamento</SelectItem>
              <SelectItem value="company">Empresa</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
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
          placeholder="Descreva quando esta regra deve ser aplicada..."
          rows={3}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="field">Campo</Label>
          <Input
            id="field"
            value={formData.field}
            onChange={(e) => setFormData(prev => ({ ...prev, field: e.target.value }))}
            placeholder="Ex: job_title"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="operator">Operador</Label>
          <Select
            value={formData.operator}
            onValueChange={(value) => setFormData(prev => ({ ...prev, operator: value as any }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Operador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="equals">Igual a</SelectItem>
              <SelectItem value="contains">Contém</SelectItem>
              <SelectItem value="greater_than">Maior que</SelectItem>
              <SelectItem value="less_than">Menor que</SelectItem>
              <SelectItem value="in_range">No intervalo</SelectItem>
              <SelectItem value="exists">Existe</SelectItem>
              <SelectItem value="not_exists">Não existe</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="value">Valor</Label>
          <Input
            id="value"
            value={formData.value}
            onChange={(e) => setFormData(prev => ({ ...prev, value: e.target.value }))}
            placeholder="Ex: CEO, Founder"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="score">Pontuação ({formData.score} pontos)</Label>
          <Slider
            value={[formData.score]}
            onValueChange={(value) => setFormData(prev => ({ ...prev, score: value[0] }))}
            max={100}
            step={5}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="weight">Peso ({formData.weight}x)</Label>
          <Slider
            value={[formData.weight]}
            onValueChange={(value) => setFormData(prev => ({ ...prev, weight: value[0] }))}
            min={0.1}
            max={3.0}
            step={0.1}
            className="w-full"
          />
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline">
          Cancelar
        </Button>
        <Button type="submit">
          {rule ? "Atualizar" : "Criar"} Regra
        </Button>
      </div>
    </form>
  )
}
