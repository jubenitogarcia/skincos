import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Label } from "@/label"
import { ScrollArea } from "@/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/avatar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { toast } from 'sonner'
import {
  ChatCircle,
  Heart,
  Repeat,
  Share,
  Eye,
  Users,
  TrendUp,
  CheckCircle,
  At,
  Plus,
  Robot,
  Hash
} from "@phosphor-icons/react"
import { Image as ImageIcon, Video } from "lucide-react"

interface ThreadsPost {
  id: string
  content: string
  mediaUrl?: string[]
  mediaType?: 'image' | 'video'
  timestamp: Date
  status: 'published' | 'scheduled' | 'draft'
  isRepost: boolean
  originalPostId?: string
  parentPostId?: string // For thread replies
  insights: {
    likes: number
    reposts: number
    quotes: number
    replies: number
    views: number
    profile_clicks: number
  }
  hashtags: string[]
  mentions: string[]
  threadDepth: number // How deep in a thread this post is
}

interface ThreadsThread {
  id: string
  rootPostId: string
  posts: ThreadsPost[]
  totalReplies: number
  totalLikes: number
  totalReposts: number
  isActive: boolean
  lastPulse: Date
  participants: string[]
}

interface ThreadsFollower {
  id: string
  username: string
  displayName: string
  avatar: string
  bio?: string
  isFollowing: boolean
  isFollowedBy: boolean
  joinedDate: Date
  postsCount: number
  followersCount: number
  followingCount: number
  isVerified: boolean
  lastActive: Date
}

interface ThreadsAnalytics {
  totalPosts: number
  totalFollowers: number
  totalFollowing: number
  totalLikes: number
  totalReposts: number
  engagementRate: number
  averageReachPerPost: number
  topHashtags: { hashtag: string, usage: number }[]
  followerGrowth: { date: Date, count: number }[]
  bestPostingTimes: { hour: number, engagement: number }[]
  audienceInsights: {
    topCountries: { country: string, percentage: number }[]
    ageGroups: { range: string, percentage: number }[]
    genderSplit: { male: number, female: number, other: number }
  }
}

interface ThreadsTrendingTopic {
  id: string
  hashtag: string
  postCount: number
  growth: number
  category: string
  location?: string
}

export function ThreadsStudio() {
  const [activeTab, setActiveTab] = useState("feed")
  const [posts, setPosts] = useKV<ThreadsPost[]>("threads-posts", [])
  const [threads, setThreads] = useKV<ThreadsThread[]>("threads-threads", [])
  const [followers, setFollowers] = useKV<ThreadsFollower[]>("threads-followers", [])
  const [trending, setTrending] = useKV<ThreadsTrendingTopic[]>("threads-trending", [])
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  const [postContent, setPostContent] = useState("")
  const [isCreatingPost, setIsCreatingPost] = useState(false)
  const [replyToPost, setReplyToPost] = useState<string | null>(null)

  // Mock data initialization
  useEffect(() => {
    if (posts.length === 0) {
      setPosts([
        {
          id: "post_1",
          content: "Excited to announce our new CRM features! AI-powered insights are game-changing 🚀 #CRM #AI #Innovation",
          timestamp: new Date(Date.now() - 2 * 60 * 60000),
          status: "published",
          isRepost: false,
          insights: {
            likes: 234,
            reposts: 45,
            quotes: 12,
            replies: 18,
            views: 2840,
            profile_clicks: 67
          },
          hashtags: ["CRM", "AI", "Innovation"],
          mentions: [],
          threadDepth: 0
        },
        {
          id: "post_2",
          content: "Building in public: Our customer onboarding process improvements reduced time-to-value by 60%",
          timestamp: new Date(Date.now() - 5 * 60 * 60000),
          status: "published",
          isRepost: false,
          insights: {
            likes: 156,
            reposts: 28,
            quotes: 8,
            replies: 24,
            views: 1950,
            profile_clicks: 42
          },
          hashtags: ["BuildInPublic", "CustomerSuccess"],
          mentions: [],
          threadDepth: 0
        },
        {
          id: "post_3",
          content: "This is the follow-up to our CRM announcement. The beta testing results exceeded our expectations!",
          parentPostId: "post_1",
          timestamp: new Date(Date.now() - 90 * 60000),
          status: "published",
          isRepost: false,
          insights: {
            likes: 89,
            reposts: 15,
            quotes: 4,
            replies: 12,
            views: 1240,
            profile_clicks: 23
          },
          hashtags: ["Beta", "Results"],
          mentions: [],
          threadDepth: 1
        }
      ])
    }

    if (threads.length === 0) {
      setThreads([
        {
          id: "thread_1",
          rootPostId: "post_1",
          posts: ["post_1", "post_3"].map(id => posts.find(p => p.id === id)!).filter(Boolean),
          totalReplies: 30,
          totalLikes: 323,
          totalReposts: 60,
          isActive: true,
          lastPulse: new Date(Date.now() - 90 * 60000),
          participants: ["@user1", "@user2", "@user3"]
        }
      ])
    }

    if (followers.length === 0) {
      setFollowers([
        {
          id: "follower_1",
          username: "@techstartup",
          displayName: "Tech Startup",
          avatar: "/api/placeholder/40/40",
          bio: "Building the future of work 🚀",
          isFollowing: true,
          isFollowedBy: true,
          joinedDate: new Date(Date.now() - 180 * 24 * 60 * 60000),
          postsCount: 342,
          followersCount: 15600,
          followingCount: 892,
          isVerified: true,
          lastActive: new Date(Date.now() - 30 * 60000)
        },
        {
          id: "follower_2",
          username: "@designpro",
          displayName: "Design Pro",
          avatar: "/api/placeholder/40/40",
          bio: "UX/UI Designer | Creating beautiful experiences",
          isFollowing: false,
          isFollowedBy: true,
          joinedDate: new Date(Date.now() - 90 * 24 * 60 * 60000),
          postsCount: 156,
          followersCount: 3400,
          followingCount: 1200,
          isVerified: false,
          lastActive: new Date(Date.now() - 2 * 60 * 60000)
        }
      ])
    }

    if (trending.length === 0) {
      setTrending([
        {
          id: "trend_1",
          hashtag: "#AI",
          postCount: 45600,
          growth: 234,
          category: "Technology"
        },
        {
          id: "trend_2",
          hashtag: "#CRM",
          postCount: 12400,
          growth: 89,
          category: "Business"
        },
        {
          id: "trend_3",
          hashtag: "#Startup",
          postCount: 34200,
          growth: 156,
          category: "Business"
        }
      ])
    }
  }, [posts.length, threads.length, followers.length, trending.length, setPosts, setThreads, setFollowers, setTrending])

  const createPost = () => {
    if (!postContent.trim()) return

    const newPost: ThreadsPost = {
      id: `post_${Date.now()}`,
      content: postContent,
      timestamp: new Date(),
      status: "published",
      isRepost: false,
      parentPostId: replyToPost || undefined,
      insights: {
        likes: 0,
        reposts: 0,
        quotes: 0,
        replies: 0,
        views: 0,
        profile_clicks: 0
      },
      hashtags: postContent.match(/#\w+/g)?.map(tag => tag.slice(1)) || [],
      mentions: postContent.match(/@\w+/g)?.map(mention => mention.slice(1)) || [],
      threadDepth: replyToPost ? 1 : 0
    }

    setPosts(current => [newPost, ...current])
    setPostContent("")
    setReplyToPost(null)
    setIsCreatingPost(false)
    toast.success("Post publicado com sucesso!")
  }

  const likePost = (postId: string) => {
    setPosts(current =>
      current.map(post =>
        post.id === postId
          ? { ...post, insights: { ...post.insights, likes: post.insights.likes + 1 } }
          : post
      )
    )
  }

  const repostPost = (postId: string) => {
    const originalPost = posts.find(p => p.id === postId)
    if (!originalPost) return

    const repost: ThreadsPost = {
      ...originalPost,
      id: `repost_${Date.now()}`,
      timestamp: new Date(),
      isRepost: true,
      originalPostId: postId,
      insights: {
        likes: 0,
        reposts: 0,
        quotes: 0,
        replies: 0,
        views: 0,
        profile_clicks: 0
      }
    }

    setPosts(current => [repost, ...current])

    // Update original post repost count
    setPosts(current =>
      current.map(post =>
        post.id === postId
          ? { ...post, insights: { ...post.insights, reposts: post.insights.reposts + 1 } }
          : post
      )
    )

    toast.success("Post compartilhado!")
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const formatTime = (date: Date | string | number) => {
    const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 60) return `${minutes}m`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
    return `${Math.floor(minutes / 1440)}d`
  }

  // Calculate analytics
  const analytics: ThreadsAnalytics = {
    totalPosts: posts.length,
    totalFollowers: followers.length * 100, // Mock multiplier
    totalFollowing: 892,
    totalLikes: posts.reduce((sum, post) => sum + post.insights.likes, 0),
    totalReposts: posts.reduce((sum, post) => sum + post.insights.reposts, 0),
    engagementRate: 4.7,
    averageReachPerPost: 1850,
    topHashtags: [
      { hashtag: "#AI", usage: 15 },
      { hashtag: "#CRM", usage: 12 },
      { hashtag: "#Innovation", usage: 8 }
    ],
    followerGrowth: [
      { date: new Date(Date.now() - 7 * 24 * 60 * 60000), count: 2340 },
      { date: new Date(Date.now() - 6 * 24 * 60 * 60000), count: 2356 },
      { date: new Date(Date.now() - 5 * 24 * 60 * 60000), count: 2371 }
    ],
    bestPostingTimes: [
      { hour: 9, engagement: 5.2 },
      { hour: 14, engagement: 6.1 },
      { hour: 18, engagement: 4.8 }
    ],
    audienceInsights: {
      topCountries: [
        { country: "Brasil", percentage: 45 },
        { country: "Estados Unidos", percentage: 28 },
        { country: "Reino Unido", percentage: 12 }
      ],
      ageGroups: [
        { range: "25-34", percentage: 35 },
        { range: "18-24", percentage: 28 },
        { range: "35-44", percentage: 22 }
      ],
      genderSplit: { male: 52, female: 46, other: 2 }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <ChatCircle className="h-7 w-7 text-purple-600" />
            <span>Threads Studio</span>
          </h2>
          <p className="text-muted-foreground">
            Gerencie sua presença no Threads com ferramentas avançadas
          </p>
        </div>
        <Button onClick={() => setIsCreatingPost(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Post
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-6 w-full max-w-3xl">
          <TabsTrigger value="feed">Feed</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="threads">Threads</TabsTrigger>
          <TabsTrigger value="followers">Seguidores</TabsTrigger>
          <TabsTrigger value="trending">Trending</TabsTrigger>
          <TabsTrigger value="automation">Automação</TabsTrigger>
        </TabsList>

        <TabsContent value="feed" className="space-y-6">
          {/* Account Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  <div>
                    <div className="text-2xl font-bold">{formatNumber(analytics.totalFollowers)}</div>
                    <div className="text-sm text-muted-foreground">Seguidores</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Heart className="h-5 w-5 text-red-600" />
                  <div>
                    <div className="text-2xl font-bold">{formatNumber(analytics.totalLikes)}</div>
                    <div className="text-sm text-muted-foreground">Curtidas</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Repeat className="h-5 w-5 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold">{formatNumber(analytics.totalReposts)}</div>
                    <div className="text-sm text-muted-foreground">Reposts</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <TrendUp className="h-5 w-5 text-purple-600" />
                  <div>
                    <div className="text-2xl font-bold">{analytics.engagementRate}%</div>
                    <div className="text-sm text-muted-foreground">Engajamento</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Posts Feed */}
          <div className="space-y-4">
            {posts.map((post) => (
              <Card key={post.id} className="glass-card">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src="/api/placeholder/40/40" />
                        <AvatarFallback>CRM</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-semibold">@empresacrm</div>
                        <div className="text-sm text-muted-foreground">
                          {formatTime(post.timestamp)}
                          {post.threadDepth > 0 && (
                            <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                              Thread {post.threadDepth + 1}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {post.isRepost && (
                      <Badge variant="secondary" className="text-xs">
                        <Repeat className="h-3 w-3 mr-1" />
                        Repostado
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-relaxed">{post.content}</p>

                  {post.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {post.hashtags.map(tag => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          <Hash className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-muted-foreground">
                    <div className="flex items-center space-x-6">
                      <button
                        onClick={() => likePost(post.id)}
                        className="flex items-center space-x-2 hover:text-red-600 transition-colors"
                      >
                        <Heart className="h-4 w-4" />
                        <span className="text-sm">{formatNumber(post.insights.likes)}</span>
                      </button>
                      <button
                        onClick={() => setReplyToPost(post.id)}
                        className="flex items-center space-x-2 hover:text-blue-600 transition-colors"
                      >
                        <ChatCircle className="h-4 w-4" />
                        <span className="text-sm">{formatNumber(post.insights.replies)}</span>
                      </button>
                      <button
                        onClick={() => repostPost(post.id)}
                        className="flex items-center space-x-2 hover:text-green-600 transition-colors"
                      >
                        <Repeat className="h-4 w-4" />
                        <span className="text-sm">{formatNumber(post.insights.reposts)}</span>
                      </button>
                      <button className="flex items-center space-x-2 hover:text-purple-600 transition-colors">
                        <Share className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center space-x-2 text-xs">
                      <Eye className="h-3 w-3" />
                      <span>{formatNumber(post.insights.views)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Performance Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{analytics.totalPosts}</div>
                    <div className="text-sm text-muted-foreground">Posts Publicados</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{formatNumber(analytics.averageReachPerPost)}</div>
                    <div className="text-sm text-muted-foreground">Alcance Médio</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Top Hashtags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analytics.topHashtags.map((item, index) => (
                    <div key={item.hashtag} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </div>
                        <span className="font-medium">#{item.hashtag}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{item.usage} usos</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Insights da Audiência</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <h4 className="font-medium mb-3">Top Países</h4>
                  <div className="space-y-2">
                    {analytics.audienceInsights.topCountries.map(country => (
                      <div key={country.country} className="flex justify-between">
                        <span className="text-sm">{country.country}</span>
                        <span className="text-sm font-medium">{country.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-3">Faixa Etária</h4>
                  <div className="space-y-2">
                    {analytics.audienceInsights.ageGroups.map(group => (
                      <div key={group.range} className="flex justify-between">
                        <span className="text-sm">{group.range}</span>
                        <span className="text-sm font-medium">{group.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-3">Melhores Horários</h4>
                  <div className="space-y-2">
                    {analytics.bestPostingTimes.map(time => (
                      <div key={time.hour} className="flex justify-between">
                        <span className="text-sm">{time.hour}:00</span>
                        <span className="text-sm font-medium">{time.engagement}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="threads" className="space-y-6">
          <div className="space-y-4">
            {threads.map(thread => (
              <Card key={thread.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Thread Ativo</CardTitle>
                    <Badge variant={thread.isActive ? "default" : "secondary"}>
                      {thread.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <CardDescription>
                    {thread.posts.length} posts • {thread.totalReplies} respostas • {thread.participants.length} participantes
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-lg font-bold text-red-600">{thread.totalLikes}</div>
                      <div className="text-xs text-muted-foreground">Curtidas</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-green-600">{thread.totalReposts}</div>
                      <div className="text-xs text-muted-foreground">Reposts</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-blue-600">{thread.totalReplies}</div>
                      <div className="text-xs text-muted-foreground">Respostas</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      Última atividade: {formatTime(thread.lastPulse)}
                    </div>
                    <Button variant="outline" size="sm">
                      Ver Thread Completa
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="followers" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {followers.map(follower => (
              <Card key={follower.id} className="glass-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={follower.avatar} />
                        <AvatarFallback>{follower.displayName.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-semibold flex items-center space-x-1">
                          <span>{follower.displayName}</span>
                          {follower.isVerified && <CheckCircle className="h-4 w-4 text-blue-500" />}
                        </div>
                        <div className="text-sm text-muted-foreground">{follower.username}</div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {follower.bio && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{follower.bio}</p>
                  )}

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="font-semibold text-sm">{formatNumber(follower.postsCount)}</div>
                      <div className="text-xs text-muted-foreground">Posts</div>
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{formatNumber(follower.followersCount)}</div>
                      <div className="text-xs text-muted-foreground">Seguidores</div>
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{formatNumber(follower.followingCount)}</div>
                      <div className="text-xs text-muted-foreground">Seguindo</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      Ativo {formatTime(follower.lastActive)}
                    </div>
                    <Button variant={follower.isFollowing ? "outline" : "default"} size="sm">
                      {follower.isFollowing ? "Seguindo" : "Seguir"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="trending" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Trending Topics</CardTitle>
              <CardDescription>Hashtags em alta no momento</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {trending.map((topic, index) => (
                  <div key={topic.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-semibold">{topic.hashtag}</div>
                        <div className="text-sm text-muted-foreground">
                          {formatNumber(topic.postCount)} posts • {topic.category}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center space-x-1 text-green-600">
                        <TrendUp className="h-4 w-4" />
                        <span className="text-sm font-medium">+{topic.growth}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Robot className="h-5 w-5" />
                <span>Automação Threads</span>
              </CardTitle>
              <CardDescription>
                Configure automações inteligentes para o Threads
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-medium">Agendamento de Posts</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Auto-agendar posts</span>
                      <input type="checkbox" className="rounded" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Otimizar horários</span>
                      <input type="checkbox" className="rounded" defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Repost automático</span>
                      <input type="checkbox" className="rounded" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Engajamento Automático</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Resposta a menções</span>
                      <input type="checkbox" className="rounded" defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Like em threads relevantes</span>
                      <input type="checkbox" className="rounded" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Seguir de volta</span>
                      <input type="checkbox" className="rounded" />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Post Dialog */}
      <Dialog open={isCreatingPost} onOpenChange={setIsCreatingPost}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {replyToPost ? "Responder Thread" : "Criar Novo Post"}
            </DialogTitle>
            <DialogDescription>
              {replyToPost ? "Adicione sua resposta ao thread" : "Compartilhe suas ideias no Threads"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder={replyToPost ? "Adicione sua resposta..." : "O que você está pensando?"}
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              className="min-h-[120px]"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Button variant="outline" size="sm">
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Imagem
                </Button>
                <Button variant="outline" size="sm">
                  <Video className="h-4 w-4 mr-2" />
                  Vídeo
                </Button>
                <Button variant="outline" size="sm">
                  <At className="h-4 w-4 mr-2" />
                  Mencionar
                </Button>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-muted-foreground">
                  {500 - postContent.length} caracteres
                </span>
                <Button onClick={createPost} disabled={!postContent.trim()}>
                  {replyToPost ? "Responder" : "Publicar"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
