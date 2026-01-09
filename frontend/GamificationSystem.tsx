import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Progress } from "@/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import {
  Trophy,
  Target,
  Star,
  Medal,
  Crown,
  Lightning,
  Fire,
  Sparkle,
  TrendUp,
  Users,
  CalendarBlank,
  Gift,
  Rocket,
  CheckCircle,
  Clock,

} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface Achievement {
  id: string
  title: string
  description: string
  icon: string
  category: 'sales' | 'activity' | 'learning' | 'collaboration' | 'streak'
  points: number
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  unlockedAt?: string
  progress: number
  maxProgress: number
  isUnlocked: boolean
}

interface Challenge {
  id: string
  title: string
  description: string
  type: 'daily' | 'weekly' | 'monthly' | 'special'
  category: 'calls' | 'conversions' | 'learning' | 'collaboration'
  targetValue: number
  currentValue: number
  points: number
  endDate: string
  isCompleted: boolean
  participants: number
}

interface Leaderboard {
  rank: number
  agentName: string
  avatar?: string
  totalPoints: number
  monthlyPoints: number
  level: number
  streak: number
  badges: string[]
}

interface Reward {
  id: string
  title: string
  description: string
  cost: number
  category: 'training' | 'perks' | 'recognition' | 'tools'
  availability: number
  isRedeemed: boolean
  icon: string
}

export function GamificationSystem() {
  const [currentPoints, setCurrentPoints] = useKV<number>('user-points', 2450)
  const [currentLevel, setCurrentLevel] = useKV<number>('user-level', 7)
  const [currentStreak, setCurrentStreak] = useKV<number>('user-streak', 12)
  const [selectedTab, setSelectedTab] = useState('overview')

  const [achievements, setAchievements] = useKV<Achievement[]>('achievements', [
    {
      id: '1',
      title: 'Primeiro Fechamento',
      description: 'Feche sua primeira venda no sistema',
      icon: 'trophy',
      category: 'sales',
      points: 100,
      rarity: 'common',
      unlockedAt: '2024-01-10T10:30:00Z',
      progress: 1,
      maxProgress: 1,
      isUnlocked: true
    },
    {
      id: '2',
      title: 'Sequência de Ouro',
      description: 'Realize 5 vendas consecutivas',
      icon: 'crown',
      category: 'sales',
      points: 500,
      rarity: 'epic',
      unlockedAt: '2024-01-14T16:45:00Z',
      progress: 5,
      maxProgress: 5,
      isUnlocked: true
    },
    {
      id: '3',
      title: 'Maratonista',
      description: 'Mantenha uma streak de 10 dias',
      icon: 'fire',
      category: 'streak',
      points: 300,
      rarity: 'rare',
      unlockedAt: '2024-01-15T09:00:00Z',
      progress: 12,
      maxProgress: 10,
      isUnlocked: true
    },
    {
      id: '4',
      title: 'Máquina de Calls',
      description: 'Realize 100 calls em um mês',
      icon: 'lightning',
      category: 'activity',
      points: 250,
      rarity: 'rare',
      progress: 87,
      maxProgress: 100,
      isUnlocked: false
    },
    {
      id: '5',
      title: 'Mentor',
      description: 'Ajude 3 colegas com treinamento',
      icon: 'users',
      category: 'collaboration',
      points: 400,
      rarity: 'epic',
      progress: 2,
      maxProgress: 3,
      isUnlocked: false
    }
  ])

  const [challenges, setChallenges] = useKV<Challenge[]>('challenges', [
    {
      id: '1',
      title: 'Desafio de Conversão',
      description: 'Alcance 25% de taxa de conversão esta semana',
      type: 'weekly',
      category: 'conversions',
      targetValue: 25,
      currentValue: 23.5,
      points: 300,
      endDate: '2024-01-21T23:59:59Z',
      isCompleted: false,
      participants: 15
    },
    {
      id: '2',
      title: 'Maratona de Calls',
      description: 'Realize 50 calls hoje',
      type: 'daily',
      category: 'calls',
      targetValue: 50,
      currentValue: 42,
      points: 150,
      endDate: '2024-01-16T23:59:59Z',
      isCompleted: false,
      participants: 8
    },
    {
      id: '3',
      title: 'Mestre do Aprendizado',
      description: 'Complete 5 módulos de treinamento este mês',
      type: 'monthly',
      category: 'learning',
      targetValue: 5,
      currentValue: 3,
      points: 500,
      endDate: '2024-01-31T23:59:59Z',
      isCompleted: false,
      participants: 22
    }
  ])

  const [leaderboard, setLeaderboard] = useKV<Leaderboard[]>('leaderboard', [
    {
      rank: 1,
      agentName: 'Ana Costa',
      totalPoints: 3250,
      monthlyPoints: 1200,
      level: 9,
      streak: 18,
      badges: ['crown', 'fire', 'star']
    },
    {
      rank: 2,
      agentName: 'João Santos',
      totalPoints: 2450,
      monthlyPoints: 890,
      level: 7,
      streak: 12,
      badges: ['trophy', 'lightning']
    },
    {
      rank: 3,
      agentName: 'Maria Silva',
      totalPoints: 2180,
      monthlyPoints: 650,
      level: 6,
      streak: 8,
      badges: ['medal', 'target']
    },
    {
      rank: 4,
      agentName: 'Carlos Lima',
      totalPoints: 1890,
      monthlyPoints: 520,
      level: 5,
      streak: 5,
      badges: ['star']
    }
  ])

  const [rewards, setRewards] = useKV<Reward[]>('rewards', [
    {
      id: '1',
      title: 'Curso Avançado de Vendas',
      description: 'Acesso ao curso premium de técnicas avançadas',
      cost: 1000,
      category: 'training',
      availability: 5,
      isRedeemed: false,
      icon: 'book'
    },
    {
      id: '2',
      title: 'Day Off Extra',
      description: 'Um dia de folga adicional no mês',
      cost: 1500,
      category: 'perks',
      availability: 2,
      isRedeemed: false,
      icon: 'calendar'
    },
    {
      id: '3',
      title: 'Reconhecimento Público',
      description: 'Destaque no newsletter da empresa',
      cost: 800,
      category: 'recognition',
      availability: 3,
      isRedeemed: false,
      icon: 'star'
    },
    {
      id: '4',
      title: 'Headset Premium',
      description: 'Headset profissional para calls',
      cost: 2000,
      category: 'tools',
      availability: 1,
      isRedeemed: false,
      icon: 'headset'
    }
  ])

  const completeChallenge = (challengeId: string) => {
    setChallenges(current =>
      current.map(challenge =>
        challenge.id === challengeId
          ? { ...challenge, isCompleted: true, currentValue: challenge.targetValue }
          : challenge
      )
    )

    const challenge = challenges.find(c => c.id === challengeId)
    if (challenge) {
      setCurrentPoints(current => current + challenge.points)
      toast.success(`Desafio concluído! +${challenge.points} pontos`)
    }
  }

  const redeemReward = (rewardId: string) => {
    const reward = rewards.find(r => r.id === rewardId)
    if (!reward || reward.cost > currentPoints) {
      toast.error('Pontos insuficientes!')
      return
    }

    setRewards(current =>
      current.map(r =>
        r.id === rewardId ? { ...r, isRedeemed: true, availability: r.availability - 1 } : r
      )
    )
    setCurrentPoints(current => current - reward.cost)
    toast.success(`Recompensa resgatada: ${reward.title}`)
  }

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'legendary': return 'bg-gradient-to-r from-yellow-400 to-orange-500 text-white'
      case 'epic': return 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
      case 'rare': return 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getChallengeTypeColor = (type: string) => {
    switch (type) {
      case 'daily': return 'bg-green-100 text-green-800 border-green-200'
      case 'weekly': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'monthly': return 'bg-purple-100 text-purple-800 border-purple-200'
      case 'special': return 'bg-orange-100 text-orange-800 border-orange-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getAchievementIcon = (icon: string) => {
    switch (icon) {
      case 'trophy': return <Trophy className="h-6 w-6" />
      case 'crown': return <Crown className="h-6 w-6" />
      case 'fire': return <Fire className="h-6 w-6" />
      case 'lightning': return <Lightning className="h-6 w-6" />
      case 'users': return <Users className="h-6 w-6" />
      case 'star': return <Star className="h-6 w-6" />
      case 'medal': return <Medal className="h-6 w-6" />
      default: return <Trophy className="h-6 w-6" />
    }
  }

  const currentLevelProgress = ((currentPoints % 500) / 500) * 100
  const nextLevelPoints = ((currentLevel + 1) * 500) - currentPoints

  return (
    <div className="space-y-6">
      {/* Header with User Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="p-3 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full">
                <Trophy className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Level</p>
                <p className="text-2xl font-bold">{currentLevel}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="p-3 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full">
                <Star className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pontos</p>
                <p className="text-2xl font-bold">{currentPoints.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="p-3 bg-gradient-to-r from-orange-500 to-red-500 rounded-full">
                <Fire className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Streak</p>
                <p className="text-2xl font-bold">{currentStreak} dias</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">Próximo Level</p>
                <p className="text-sm text-muted-foreground">{nextLevelPoints} pts</p>
              </div>
              <Progress value={currentLevelProgress} className="h-2" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="achievements">Conquistas</TabsTrigger>
          <TabsTrigger value="challenges">Desafios</TabsTrigger>
          <TabsTrigger value="leaderboard">Ranking</TabsTrigger>
          <TabsTrigger value="rewards">Recompensas</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Active Challenges */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Target className="h-5 w-5 text-accent" />
                <span>Desafios Ativos</span>
              </CardTitle>
              <CardDescription>Complete desafios para ganhar pontos e recompensas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {challenges.filter(c => !c.isCompleted).slice(0, 3).map((challenge) => (
                <div key={challenge.id} className="p-4 border rounded-lg bg-card/50">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-semibold">{challenge.title}</h4>
                      <p className="text-sm text-muted-foreground">{challenge.description}</p>
                    </div>
                    <Badge className={getChallengeTypeColor(challenge.type)}>
                      {challenge.type === 'daily' ? 'Diário' :
                        challenge.type === 'weekly' ? 'Semanal' :
                          challenge.type === 'monthly' ? 'Mensal' : 'Especial'}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Progresso</span>
                      <span>{challenge.currentValue}/{challenge.targetValue}</span>
                    </div>
                    <Progress value={(challenge.currentValue / challenge.targetValue) * 100} className="h-2" />
                  </div>

                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm font-medium text-accent">+{challenge.points} pontos</span>
                    {challenge.currentValue >= challenge.targetValue && (
                      <Button size="sm" onClick={() => completeChallenge(challenge.id)}>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Concluir
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recent Achievements */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                <span>Conquistas Recentes</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {achievements.filter(a => a.isUnlocked).slice(0, 3).map((achievement) => (
                  <div key={achievement.id} className="p-4 border rounded-lg bg-gradient-to-br from-yellow-50 to-orange-50">
                    <div className="flex items-center space-x-3 mb-2">
                      <div className={`p-2 rounded-full ${getRarityColor(achievement.rarity)}`}>
                        {getAchievementIcon(achievement.icon)}
                      </div>
                      <div>
                        <h4 className="font-semibold">{achievement.title}</h4>
                        <p className="text-xs text-muted-foreground">+{achievement.points} pontos</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{achievement.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="achievements" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {achievements.map((achievement) => (
              <Card key={achievement.id} className={`glass-card ${!achievement.isUnlocked ? 'opacity-60' : ''}`}>
                <CardHeader>
                  <div className="flex items-center space-x-3">
                    <div className={`p-3 rounded-full ${getRarityColor(achievement.rarity)}`}>
                      {getAchievementIcon(achievement.icon)}
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-base">{achievement.title}</CardTitle>
                      <div className="flex items-center space-x-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {achievement.rarity === 'legendary' ? 'Lendário' :
                            achievement.rarity === 'epic' ? 'Épico' :
                              achievement.rarity === 'rare' ? 'Raro' : 'Comum'}
                        </Badge>
                        <span className="text-sm font-medium text-accent">+{achievement.points}</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{achievement.description}</p>

                  {!achievement.isUnlocked && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Progresso</span>
                        <span>{achievement.progress}/{achievement.maxProgress}</span>
                      </div>
                      <Progress value={(achievement.progress / achievement.maxProgress) * 100} className="h-2" />
                    </div>
                  )}

                  {achievement.isUnlocked && achievement.unlockedAt && (
                    <p className="text-xs text-muted-foreground">
                      Desbloqueado em {new Date(achievement.unlockedAt).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="challenges" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {challenges.map((challenge) => (
              <Card key={challenge.id} className={`glass-card ${challenge.isCompleted ? 'opacity-75' : ''}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center space-x-2">
                        <Target className="h-5 w-5 text-accent" />
                        <span>{challenge.title}</span>
                      </CardTitle>
                      <CardDescription>{challenge.description}</CardDescription>
                    </div>
                    <Badge className={getChallengeTypeColor(challenge.type)}>
                      {challenge.type === 'daily' ? 'Diário' :
                        challenge.type === 'weekly' ? 'Semanal' :
                          challenge.type === 'monthly' ? 'Mensal' : 'Especial'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Progresso</span>
                      <span className="text-sm">{challenge.currentValue}/{challenge.targetValue}</span>
                    </div>
                    <Progress value={(challenge.currentValue / challenge.targetValue) * 100} className="h-3" />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center space-x-1">
                      <Clock className="h-3 w-3" />
                      <span>Termina em {new Date(challenge.endDate).toLocaleDateString('pt-BR')}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Users className="h-3 w-3" />
                      <span>{challenge.participants} participantes</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="font-medium text-accent">+{challenge.points} pontos</span>
                    {challenge.isCompleted ? (
                      <Badge className="bg-green-100 text-green-800">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Concluído
                      </Badge>
                    ) : challenge.currentValue >= challenge.targetValue ? (
                      <Button size="sm" onClick={() => completeChallenge(challenge.id)}>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Concluir
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline">
                        <Lightning className="h-4 w-4 mr-2" />
                        Participar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leaderboard" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                <span>Ranking Mensal</span>
              </CardTitle>
              <CardDescription>Classificação baseada nos pontos do mês</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {leaderboard.map((agent) => (
                  <div key={agent.rank} className={`p-4 rounded-lg border ${agent.agentName === 'João Santos' ? 'bg-accent/10 border-accent' : 'bg-card/50'
                    }`}>
                    <div className="flex items-center space-x-4">
                      <div className={`flex items-center justify-center w-10 h-10 rounded-full font-bold ${agent.rank === 1 ? 'bg-yellow-500 text-white' :
                        agent.rank === 2 ? 'bg-gray-400 text-white' :
                          agent.rank === 3 ? 'bg-orange-500 text-white' :
                            'bg-muted text-muted-foreground'
                        }`}>
                        {agent.rank}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="font-semibold">{agent.agentName}</h4>
                          {agent.agentName === 'João Santos' && (
                            <Badge variant="outline">Você</Badge>
                          )}
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                          <span>Level {agent.level}</span>
                          <span className="flex items-center space-x-1">
                            <Fire className="h-3 w-3" />
                            <span>{agent.streak} dias</span>
                          </span>
                          <div className="flex items-center space-x-1">
                            {agent.badges.map((badge, index) => (
                              <div key={index} className="w-4 h-4 bg-accent rounded-full" />
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-bold">{agent.monthlyPoints.toLocaleString()}</p>
                        <p className="text-sm text-muted-foreground">pts este mês</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rewards" className="space-y-6">
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Loja de Recompensas</h3>
              <div className="flex items-center space-x-2">
                <Star className="h-5 w-5 text-accent" />
                <span className="font-bold">{currentPoints.toLocaleString()} pontos</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rewards.map((reward) => (
              <Card key={reward.id} className={`glass-card ${reward.isRedeemed ? 'opacity-60' : ''}`}>
                <CardHeader>
                  <div className="flex items-start space-x-3">
                    <div className="p-3 bg-accent/10 rounded-full">
                      <Gift className="h-6 w-6 text-accent" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-base">{reward.title}</CardTitle>
                      <Badge variant="outline" className="mt-1">
                        {reward.category === 'training' ? 'Treinamento' :
                          reward.category === 'perks' ? 'Benefícios' :
                            reward.category === 'recognition' ? 'Reconhecimento' : 'Ferramentas'}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{reward.description}</p>

                  <div className="flex items-center justify-between">
                    <span className="font-bold text-accent">{reward.cost.toLocaleString()} pontos</span>
                    <span className="text-sm text-muted-foreground">
                      {reward.availability} disponíveis
                    </span>
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => redeemReward(reward.id)}
                    disabled={reward.isRedeemed || currentPoints < reward.cost || reward.availability === 0}
                  >
                    {reward.isRedeemed ? 'Resgatado' :
                      currentPoints < reward.cost ? 'Pontos Insuficientes' :
                        reward.availability === 0 ? 'Indisponível' : 'Resgatar'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
