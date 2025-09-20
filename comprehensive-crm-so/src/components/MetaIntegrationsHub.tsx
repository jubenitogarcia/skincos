import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { toast } from 'sonner'
import {
  InstagramLogo,
  FacebookLogo,
  WhatsappLogo,
  ChatCircle,
  Lightning,
  Gear,
  Plus,
  PaperPlaneRight,
  Image as ImageIcon,
  Video,
  Microphone,
  PaperPlaneTilt,
  Eye,
  Heart,
  ChatCircleDots,
  Share,
  Play,
  Pause,
  CalendarBlank,
  Timer,
  Robot,
  Target,
  TrendUp,
  Users,
  Clock,
  CheckCircle,
  Warning,
  X,
  Link
} from "@phosphor-icons/react"
import { Label } from "@/components/ui/label"

interface MetaAccount {
  id: string
  platform: 'facebook' | 'instagram' | 'whatsapp' | 'threads'
  name: string
  username: string
  avatar: string
  isConnected: boolean
  accessToken?: string
  pageId?: string
  businessId?: string
  followers?: number
  verified?: boolean
}

interface MetaConversation {
  id: string
  platform: 'facebook' | 'instagram' | 'whatsapp' | 'threads'
  contactName: string
  contactAvatar: string
  contactUsername: string
  lastMessage: string
  lastMessageTime: Date
  unreadCount: number
  isActive: boolean
  tags: string[]
  assignedAgent?: string
}

interface MetaPost {
  id: string
  platform: 'facebook' | 'instagram' | 'threads'
  content: string
  mediaUrl?: string
  mediaType?: 'image' | 'video' | 'carousel'
  scheduledTime?: Date
  publishedTime?: Date
  status: 'draft' | 'scheduled' | 'published' | 'failed'
  engagement: {
    likes: number
    comments: number
    shares: number
    reach: number
  }
  campaignId?: string
}

interface MetaCampaign {
  id: string
  name: string
  platforms: ('facebook' | 'instagram' | 'whatsapp' | 'threads')[]
  objective: string
  budget: number
  startDate: Date
  endDate: Date
  status: 'active' | 'paused' | 'completed' | 'draft'
  performance: {
    reach: number
    impressions: number
    clicks: number
    conversions: number
    cost: number
  }
}

export function MetaIntegrationsHub() {
  const [activeTab, setActiveTab] = useState("accounts")
  const [accounts, setAccounts] = useKV<MetaAccount[]>("meta-accounts", [])
  const [conversations, setConversations] = useKV<MetaConversation[]>("meta-conversations", [])
  const [posts, setPosts] = useKV<MetaPost[]>("meta-posts", [])
  const [campaigns, setCampaigns] = useKV<MetaCampaign[]>("meta-campaigns", [])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messageInput, setMessageInput] = useState("")
  const [isConnecting, setIsConnecting] = useState(false)

  // Mock data initialization
  useEffect(() => {
    if (accounts.length === 0) {
      setAccounts([
        {
          id: "1",
          platform: "facebook",
          name: "Empresa CRM",
          username: "@empresacrm",
          avatar: "/api/placeholder/40/40",
          isConnected: true,
          followers: 12450,
          verified: true
        },
        {
          id: "2",
          platform: "instagram",
          name: "Empresa CRM",
          username: "@empresacrm",
          avatar: "/api/placeholder/40/40",
          isConnected: true,
          followers: 8920,
          verified: true
        },
        {
          id: "3",
          platform: "whatsapp",
          name: "Empresa CRM Business",
          username: "+55 11 99999-9999",
          avatar: "/api/placeholder/40/40",
          isConnected: true,
          verified: true
        },
        {
          id: "4",
          platform: "threads",
          name: "Empresa CRM",
          username: "@empresacrm",
          avatar: "/api/placeholder/40/40",
          isConnected: false,
          followers: 2340
        }
      ])
    }

    if (conversations.length === 0) {
      setConversations([
        {
          id: "1",
          platform: "whatsapp",
          contactName: "João Silva",
          contactAvatar: "/api/placeholder/32/32",
          contactUsername: "+55 11 99888-7777",
          lastMessage: "Gostaria de saber mais sobre o produto",
          lastMessageTime: new Date(Date.now() - 5 * 60000),
          unreadCount: 2,
          isActive: true,
          tags: ["lead", "produto"]
        },
        {
          id: "2",
          platform: "instagram",
          contactName: "Maria Santos",
          contactAvatar: "/api/placeholder/32/32",
          contactUsername: "@mariasantos",
          lastMessage: "Adorei o post sobre automação!",
          lastMessageTime: new Date(Date.now() - 15 * 60000),
          unreadCount: 1,
          isActive: true,
          tags: ["engajamento"]
        },
        {
          id: "3",
          platform: "facebook",
          contactName: "Pedro Costa",
          contactAvatar: "/api/placeholder/32/32",
          contactUsername: "Pedro Costa",
          lastMessage: "Quando vocês podem fazer uma demonstração?",
          lastMessageTime: new Date(Date.now() - 30 * 60000),
          unreadCount: 0,
          isActive: false,
          tags: ["demo", "oportunidade"]
        }
      ])
    }

    if (posts.length === 0) {
      setPosts([
        {
          id: "1",
          platform: "instagram",
          content: "Revolucione sua gestão de clientes com nossa plataforma de CRM inteligente! 🚀",
          mediaUrl: "/api/placeholder/400/400",
          mediaType: "image",
          publishedTime: new Date(Date.now() - 2 * 60 * 60000),
          status: "published",
          engagement: {
            likes: 342,
            comments: 28,
            shares: 15,
            reach: 2840
          }
        },
        {
          id: "2",
          platform: "facebook",
          content: "Descubra como a IA pode transformar seu processo de vendas",
          scheduledTime: new Date(Date.now() + 24 * 60 * 60000),
          status: "scheduled",
          engagement: {
            likes: 0,
            comments: 0,
            shares: 0,
            reach: 0
          }
        }
      ])
    }

    if (campaigns.length === 0) {
      setCampaigns([
        {
          id: "1",
          name: "Campanha CRM Q1 2025",
          platforms: ["facebook", "instagram"],
          objective: "Geração de Leads",
          budget: 5000,
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60000),
          status: "active",
          performance: {
            reach: 45000,
            impressions: 125000,
            clicks: 1250,
            conversions: 89,
            cost: 1750
          }
        }
      ])
    }
  }, [accounts.length, conversations.length, posts.length, campaigns.length, setAccounts, setConversations, setPosts, setCampaigns])

  const connectAccount = async (platform: string) => {
    setIsConnecting(true)

    // Simulate OAuth flow
    setTimeout(() => {
      setAccounts(current =>
        current.map(acc =>
          acc.platform === platform
            ? { ...acc, isConnected: true }
            : acc
        )
      )
      toast.success(`${platform} conectado com sucesso!`)
      setIsConnecting(false)
    }, 2000)
  }

  const disconnectAccount = (platform: string) => {
    setAccounts(current =>
      current.map(acc =>
        acc.platform === platform
          ? { ...acc, isConnected: false }
          : acc
      )
    )
    toast.success(`${platform} desconectado`)
  }

  const sendMessage = () => {
    if (!messageInput.trim() || !selectedConversation) return

    // Add message logic here
    setMessageInput("")
    toast.success("Mensagem enviada!")
  }

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'facebook': return FacebookLogo
      case 'instagram': return InstagramLogo
      case 'whatsapp': return WhatsappLogo
      case 'threads': return ChatCircle
      default: return ChatCircle
    }
  }

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'facebook': return 'text-blue-600'
      case 'instagram': return 'text-pink-600'
      case 'whatsapp': return 'text-green-600'
      case 'threads': return 'text-purple-600'
      default: return 'text-gray-600'
    }
  }

  const formatTime = (input: Date | string | number) => {
    const date = input instanceof Date ? input : new Date(input)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 60) return `${minutes}m`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
    return `${Math.floor(minutes / 1440)}d`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Integrações Meta</h2>
          <p className="text-muted-foreground">
            Gerencie todas as suas redes sociais Meta em um só lugar
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="accounts">Contas</TabsTrigger>
          <TabsTrigger value="conversations">Conversas</TabsTrigger>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
          <TabsTrigger value="automation">Automação</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {accounts.map((account) => {
              const IconComponent = getPlatformIcon(account.platform)
              const colorClass = getPlatformColor(account.platform)

              return (
                <Card key={account.id} className="glass-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <IconComponent className={`h-6 w-6 ${colorClass}`} />
                        <div className="capitalize font-medium">{account.platform}</div>
                      </div>
                      {account.verified && (
                        <CheckCircle className="h-4 w-4 text-blue-500" />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={account.avatar} />
                        <AvatarFallback>{account.name.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{account.name}</div>
                        <div className="text-sm text-muted-foreground">{account.username}</div>
                      </div>
                    </div>

                    {account.followers && (
                      <div className="text-sm">
                        <span className="font-medium">{account.followers.toLocaleString()}</span>
                        <span className="text-muted-foreground"> seguidores</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <Badge variant={account.isConnected ? "default" : "secondary"}>
                        {account.isConnected ? "Conectado" : "Desconectado"}
                      </Badge>

                      {account.isConnected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => disconnectAccount(account.platform)}
                        >
                          Desconectar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => connectAccount(account.platform)}
                          disabled={isConnecting}
                        >
                          {isConnecting ? "Conectando..." : "Conectar"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Account Analytics */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Analytics Unificado</CardTitle>
              <CardDescription>Métricas consolidadas de todas as plataformas Meta</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {accounts.reduce((sum, acc) => sum + (acc.followers || 0), 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">Total Seguidores</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">4.7K</div>
                  <div className="text-sm text-muted-foreground">Engajamento/Mês</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">89</div>
                  <div className="text-sm text-muted-foreground">Leads Gerados</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">96.2%</div>
                  <div className="text-sm text-muted-foreground">Taxa de Resposta</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
            {/* Conversations List */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Conversas
                  <Badge variant="secondary">{conversations.filter(c => c.unreadCount > 0).length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  {conversations.map((conversation) => {
                    const IconComponent = getPlatformIcon(conversation.platform)
                    const colorClass = getPlatformColor(conversation.platform)

                    return (
                      <div
                        key={conversation.id}
                        className={`p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors ${selectedConversation === conversation.id ? 'bg-muted' : ''
                          }`}
                        onClick={() => setSelectedConversation(conversation.id)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="relative">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={conversation.contactAvatar} />
                              <AvatarFallback>{conversation.contactName.slice(0, 2)}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1 -right-1">
                              <IconComponent className={`h-4 w-4 ${colorClass} bg-background rounded-full p-0.5`} />
                            </div>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <div className="font-medium truncate">{conversation.contactName}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatTime(conversation.lastMessageTime)}
                              </div>
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                              {conversation.lastMessage}
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <div className="flex gap-1">
                                {conversation.tags.map(tag => (
                                  <Badge key={tag} variant="outline" className="text-xs">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                              {conversation.unreadCount > 0 && (
                                <Badge variant="destructive" className="h-5 w-5 rounded-full p-0 text-xs">
                                  {conversation.unreadCount}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Chat Area */}
            <div className="lg:col-span-2">
              {selectedConversation ? (
                <Card className="glass-card h-full flex flex-col">
                  <CardHeader className="border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {(() => {
                          const conv = conversations.find(c => c.id === selectedConversation)
                          const IconComponent = getPlatformIcon(conv?.platform || 'whatsapp')
                          const colorClass = getPlatformColor(conv?.platform || 'whatsapp')

                          return (
                            <>
                              <Avatar className="h-10 w-10">
                                <AvatarImage src={conv?.contactAvatar} />
                                <AvatarFallback>{conv?.contactName.slice(0, 2)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="font-medium">{conv?.contactName}</div>
                                <div className="text-sm text-muted-foreground flex items-center">
                                  <IconComponent className={`h-3 w-3 mr-1 ${colorClass}`} />
                                  {conv?.contactUsername}
                                </div>
                              </div>
                            </>
                          )
                        })()}
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button variant="outline" size="sm">
                          <Robot className="h-4 w-4 mr-2" />
                          IA
                        </Button>
                        <Button variant="outline" size="sm">
                          <Link className="h-4 w-4 mr-2" />
                          CRM
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 p-4">
                    <ScrollArea className="h-[350px] mb-4">
                      {/* Mock messages */}
                      <div className="space-y-4">
                        <div className="flex">
                          <div className="bg-muted p-3 rounded-lg max-w-[70%]">
                            <p>Gostaria de saber mais sobre o produto</p>
                            <div className="text-xs text-muted-foreground mt-1">10:30</div>
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <div className="bg-primary text-primary-foreground p-3 rounded-lg max-w-[70%]">
                            <p>Olá! Ficamos felizes com seu interesse. Que tipo de informação você gostaria?</p>
                            <div className="text-xs opacity-70 mt-1">10:32</div>
                          </div>
                        </div>
                      </div>
                    </ScrollArea>

                    <div className="flex items-center space-x-2">
                      <Button variant="outline" size="sm">
                        <ImageIcon className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm">
                        <Video className="h-4 w-4" />
                      </Button>
                      <Input
                        placeholder="Digite sua mensagem..."
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                        className="flex-1"
                      />
                      <Button onClick={sendMessage} disabled={!messageInput.trim()}>
                        <PaperPlaneRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="glass-card h-full flex items-center justify-center">
                  <div className="text-center">
                    <ChatCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">Selecione uma conversa</h3>
                    <p className="text-muted-foreground">
                      Escolha uma conversa da lista para começar a responder
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="posts" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Gerenciamento de Posts</h3>
              <p className="text-muted-foreground">Crie, agende e analise posts em todas as plataformas</p>
            </div>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo Post
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {posts.map((post) => {
              const IconComponent = getPlatformIcon(post.platform)
              const colorClass = getPlatformColor(post.platform)

              return (
                <Card key={post.id} className="glass-card">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <IconComponent className={`h-5 w-5 ${colorClass}`} />
                        <div className="capitalize">{post.platform}</div>
                      </div>
                      <Badge
                        variant={
                          post.status === 'published' ? 'default' :
                            post.status === 'scheduled' ? 'secondary' :
                              post.status === 'failed' ? 'destructive' : 'outline'
                        }
                      >
                        {post.status === 'published' ? 'Publicado' :
                          post.status === 'scheduled' ? 'Agendado' :
                            post.status === 'failed' ? 'Falhou' : 'Rascunho'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {post.mediaUrl && (
                      <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}

                    <p className="text-sm line-clamp-3">{post.content}</p>

                    {post.publishedTime && (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex items-center space-x-1">
                          <Heart className="h-4 w-4" />
                          <span>{post.engagement.likes}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <ChatCircleDots className="h-4 w-4" />
                          <span>{post.engagement.comments}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Share className="h-4 w-4" />
                          <span>{post.engagement.shares}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Eye className="h-4 w-4" />
                          <span>{post.engagement.reach}</span>
                        </div>
                      </div>
                    )}

                    {post.scheduledTime && (
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>Agendado para {post.scheduledTime.toLocaleString()}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Campanhas Publicitárias</h3>
              <p className="text-muted-foreground">Gerencie campanhas pagas em Facebook e Instagram</p>
            </div>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova Campanha
            </Button>
          </div>

          <div className="space-y-6">
            {campaigns.map((campaign) => (
              <Card key={campaign.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{campaign.name}</CardTitle>
                      <CardDescription>{campaign.objective}</CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge
                        variant={
                          campaign.status === 'active' ? 'default' :
                            campaign.status === 'paused' ? 'secondary' :
                              campaign.status === 'completed' ? 'outline' : 'secondary'
                        }
                      >
                        {campaign.status === 'active' ? 'Ativa' :
                          campaign.status === 'paused' ? 'Pausada' :
                            campaign.status === 'completed' ? 'Concluída' : 'Rascunho'}
                      </Badge>
                      <div className="flex">
                        {campaign.platforms.map(platform => {
                          const IconComponent = getPlatformIcon(platform)
                          const colorClass = getPlatformColor(platform)
                          return (
                            <IconComponent key={platform} className={`h-4 w-4 ${colorClass}`} />
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {campaign.performance.reach.toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground">Alcance</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {campaign.performance.impressions.toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground">Impressões</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-600">
                        {campaign.performance.clicks.toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground">Cliques</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-600">
                        {campaign.performance.conversions}
                      </div>
                      <div className="text-sm text-muted-foreground">Conversões</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">
                        R$ {campaign.performance.cost.toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground">Investido</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      Orçamento: R$ {campaign.budget.toLocaleString()} |
                      Período: {campaign.startDate.toLocaleDateString()} - {campaign.endDate.toLocaleDateString()}
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm">
                        {campaign.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button variant="outline" size="sm">
                        <Gear className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="automation" className="space-y-6">
          {/* Cross-Platform Automation Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Lightning className="h-5 w-5 text-yellow-600" />
                  <div>
                    <div className="text-2xl font-bold">47</div>
                    <div className="text-sm text-muted-foreground">Automações Ativas</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Robot className="h-5 w-5 text-blue-600" />
                  <div>
                    <div className="text-2xl font-bold">2.4K</div>
                    <div className="text-sm text-muted-foreground">Mensagens Automáticas</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Target className="h-5 w-5 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold">89%</div>
                    <div className="text-sm text-muted-foreground">Taxa de Resposta</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Clock className="h-5 w-5 text-purple-600" />
                  <div>
                    <div className="text-2xl font-bold">32s</div>
                    <div className="text-sm text-muted-foreground">Tempo Médio</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Robot className="h-5 w-5" />
                <span>Automação Inteligente Multi-Plataforma</span>
              </CardTitle>
              <CardDescription>
                Configure automações avançadas com IA para todas as plataformas Meta
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Tabs defaultValue="responses" className="space-y-4">
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="responses">Respostas</TabsTrigger>
                  <TabsTrigger value="lead-scoring">Lead Scoring</TabsTrigger>
                  <TabsTrigger value="content">Conteúdo</TabsTrigger>
                  <TabsTrigger value="workflows">Workflows</TabsTrigger>
                </TabsList>

                <TabsContent value="responses" className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-medium flex items-center space-x-2">
                        <WhatsappLogo className="h-4 w-4 text-green-600" />
                        <span>WhatsApp Business</span>
                      </h4>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Resposta inicial automática</span>
                          <Switch defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Detecção de intenção</span>
                          <Switch defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Escalonamento inteligente</span>
                          <Switch defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Qualificação de leads</span>
                          <Switch defaultChecked />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-medium flex items-center space-x-2">
                        <InstagramLogo className="h-4 w-4 text-pink-600" />
                        <span>Instagram</span>
                      </h4>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Resposta a comentários</span>
                          <Switch defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">DM automático</span>
                          <Switch defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Moderação de conteúdo</span>
                          <Switch />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Story interactions</span>
                          <Switch />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-medium flex items-center space-x-2">
                        <FacebookLogo className="h-4 w-4 text-blue-600" />
                        <span>Facebook</span>
                      </h4>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Messenger automático</span>
                          <Switch defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Resposta em páginas</span>
                          <Switch />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Lead ads integration</span>
                          <Switch defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Event responses</span>
                          <Switch />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-medium flex items-center space-x-2">
                        <ChatCircle className="h-4 w-4 text-purple-600" />
                        <span>Threads</span>
                      </h4>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Resposta a menções</span>
                          <Switch defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Engajamento automático</span>
                          <Switch />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Thread monitoring</span>
                          <Switch />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Auto follow-back</span>
                          <Switch />
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="lead-scoring" className="space-y-6">
                  <div className="space-y-6">
                    <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
                      <CardHeader>
                        <CardTitle className="text-base">IA Lead Scoring Avançado</CardTitle>
                        <CardDescription>
                          Sistema inteligente que analisa interações em tempo real
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="text-center p-4 bg-white rounded-lg">
                            <div className="text-2xl font-bold text-blue-600">94%</div>
                            <div className="text-sm text-muted-foreground">Precisão IA</div>
                          </div>
                          <div className="text-center p-4 bg-white rounded-lg">
                            <div className="text-2xl font-bold text-green-600">127</div>
                            <div className="text-sm text-muted-foreground">Leads Qualificados</div>
                          </div>
                          <div className="text-center p-4 bg-white rounded-lg">
                            <div className="text-2xl font-bold text-orange-600">68%</div>
                            <div className="text-sm text-muted-foreground">Taxa Conversão</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Critérios de Pontuação</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Tempo de resposta</span>
                            <div className="flex items-center space-x-2">
                              <Input type="number" defaultValue="15" className="w-16 h-8" />
                              <span className="text-xs text-muted-foreground">pontos</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Palavras-chave comerciais</span>
                            <div className="flex items-center space-x-2">
                              <Input type="number" defaultValue="25" className="w-16 h-8" />
                              <span className="text-xs text-muted-foreground">pontos</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Perfil completo</span>
                            <div className="flex items-center space-x-2">
                              <Input type="number" defaultValue="10" className="w-16 h-8" />
                              <span className="text-xs text-muted-foreground">pontos</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Engajamento anterior</span>
                            <div className="flex items-center space-x-2">
                              <Input type="number" defaultValue="20" className="w-16 h-8" />
                              <span className="text-xs text-muted-foreground">pontos</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Ações Automáticas</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="p-3 border rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">Score Alto (80+)</span>
                              <Badge variant="default">Ativo</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              • Notificar gerente imediatamente<br />
                              • Escalar para vendedor senior<br />
                              • Agendar call em 24h
                            </div>
                          </div>
                          <div className="p-3 border rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">Score Médio (50-79)</span>
                              <Badge variant="secondary">Ativo</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              • Enviar material adicional<br />
                              • Agendar follow-up em 48h<br />
                              • Adicionar à campanha nurturing
                            </div>
                          </div>
                          <div className="p-3 border rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">Score Baixo ({"<"}50)</span>
                              <Badge variant="outline">Ativo</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              • Resposta automática<br />
                              • Adicionar à lista de interesse<br />
                              • Follow-up em 1 semana
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="content" className="space-y-6">
                  <div className="space-y-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Agendamento Inteligente</CardTitle>
                        <CardDescription>
                          IA otimiza horários baseado no engagement da audiência
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <Label className="text-sm font-medium">Frequência de Posts</Label>
                            <Select defaultValue="optimal">
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="daily">Diário</SelectItem>
                                <SelectItem value="optimal">Otimizado por IA</SelectItem>
                                <SelectItem value="weekly">Semanal</SelectItem>
                                <SelectItem value="custom">Personalizado</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Horário Preferencial</Label>
                            <Select defaultValue="ai-optimized">
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ai-optimized">IA Otimizada</SelectItem>
                                <SelectItem value="morning">Manhã (8-12h)</SelectItem>
                                <SelectItem value="afternoon">Tarde (12-18h)</SelectItem>
                                <SelectItem value="evening">Noite (18-22h)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Plataformas Alvo</Label>
                            <Select defaultValue="all-meta">
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all-meta">Todas Meta</SelectItem>
                                <SelectItem value="instagram-facebook">Instagram + Facebook</SelectItem>
                                <SelectItem value="whatsapp-only">WhatsApp apenas</SelectItem>
                                <SelectItem value="threads-only">Threads apenas</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                          <div className="flex items-center space-x-2 mb-2">
                            <Robot className="h-4 w-4 text-blue-600" />
                            <span className="font-medium text-blue-800">Recomendações IA</span>
                          </div>
                          <div className="text-sm text-blue-700 space-y-1">
                            <p>• Melhor horário: Terças e quintas às 14h30</p>
                            <p>• Hashtags em alta: #CRM, #Automação, #Vendas</p>
                            <p>• Tipo de conteúdo: Posts com vídeo têm 45% mais engajamento</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Cross-Platform Content Strategy</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <h4 className="font-medium">Adaptação Automática</h4>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Redimensionar imagens</span>
                                <Switch defaultChecked />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Adaptar legendas</span>
                                <Switch defaultChecked />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Hashtags por plataforma</span>
                                <Switch defaultChecked />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">CTAs específicos</span>
                                <Switch />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <h4 className="font-medium">Templates Inteligentes</h4>
                            <div className="space-y-2">
                              <div className="p-2 border rounded text-sm">
                                <strong>Instagram:</strong> Foco visual + Stories
                              </div>
                              <div className="p-2 border rounded text-sm">
                                <strong>Facebook:</strong> Conteúdo longo + Links
                              </div>
                              <div className="p-2 border rounded text-sm">
                                <strong>WhatsApp:</strong> Mensagens diretas + CTAs
                              </div>
                              <div className="p-2 border rounded text-sm">
                                <strong>Threads:</strong> Conversação + Trending topics
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="workflows" className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Workflows Avançados</CardTitle>
                      <CardDescription>
                        Automações complexas que conectam todas as plataformas Meta
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div className="p-4 border-2 border-dashed border-green-200 rounded-lg bg-green-50">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-medium text-green-800">Lead Nurturing Cross-Platform</h4>
                              <Badge variant="default" className="bg-green-600">Ativo</Badge>
                            </div>
                            <div className="text-sm text-green-700 space-y-2">
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                                <span>Lead comenta no Instagram</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                                <span>IA qualifica automaticamente</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                                <span>Envia DM personalizado</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                                <span>Migra para WhatsApp</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                                <span>Agenda reunião no CRM</span>
                              </div>
                            </div>
                          </div>

                          <div className="p-4 border-2 border-dashed border-blue-200 rounded-lg bg-blue-50">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-medium text-blue-800">Customer Support</h4>
                              <Badge variant="secondary">Em Config.</Badge>
                            </div>
                            <div className="text-sm text-blue-700 space-y-2">
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                                <span>Detecta problema no Messenger</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                                <span>Escalona para agente humano</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                                <span>Sincroniza com helpdesk</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                                <span>Follow-up em todas as plataformas</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="p-4 border-2 border-dashed border-purple-200 rounded-lg bg-purple-50">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-medium text-purple-800">Content Amplification</h4>
                              <Badge variant="default" className="bg-purple-600">Ativo</Badge>
                            </div>
                            <div className="text-sm text-purple-700 space-y-2">
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                                <span>Post inicial no Instagram</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                                <span>Adapta para Facebook Stories</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                                <span>Compartilha no Threads</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                                <span>Envia para lista WhatsApp</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                                <span>Analisa performance unificada</span>
                              </div>
                            </div>
                          </div>

                          <div className="p-4 border-2 border-dashed border-orange-200 rounded-lg bg-orange-50">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-medium text-orange-800">Crisis Management</h4>
                              <Badge variant="outline">Standby</Badge>
                            </div>
                            <div className="text-sm text-orange-700 space-y-2">
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                                <span>Monitora sentimento negativo</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                                <span>Alerta equipe imediatamente</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                                <span>Resposta coordenada</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                                <span>Escalação para CEO se necessário</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t">
                        <div className="text-sm text-muted-foreground">
                          4 workflows ativos • 12 execuções hoje • 98.7% taxa de sucesso
                        </div>
                        <Button>
                          <Plus className="h-4 w-4 mr-2" />
                          Criar Workflow
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
