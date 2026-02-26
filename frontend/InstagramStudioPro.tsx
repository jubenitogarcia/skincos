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
import { csrfHeader } from '@/csrf'
import { LoadingPercentText } from '@/LoadingPattern'
import {
  InstagramLogo,
  Heart,
  ChatCircle,
  Share,
  Bookmark,
  Eye,
  Users,
  TrendUp,
  CalendarBlank,
  Clock,
  Plus,
  Image as ImageIcon,
  Video,
  Camera,
  Play,
  Pause,
  Star,
  Lightning,
  Robot,
  ChartPie,
  Target,
  Fire,
  Crown,
  Timer,
  PaperPlaneTilt,
  ChatsCircle,
  UserPlus
} from "@phosphor-icons/react"
import {
  fetchInstagramMedia,
  fetchInstagramMediaComments,
  fetchInstagramStories,
  fetchRecentCommentLeads,
  fetchRecentDMConversations,
  mapInstagramProfileToLead,
  publishInstagramContent,
  replyToInstagramComment,
  sendDirectMessage,
  type InstagramGraphMedia,
} from '@/instagramIntegration'
import {
  instagramModuleAddAccount,
  instagramModuleDownloadContent,
  instagramModuleGetAnalytics,
  instagramModuleHealth,
  instagramModuleListAccounts,
  instagramModuleOsintInvestigate,
  instagramModuleRunAutomation,
} from '@/instagramModuleClient'
import { useIntegrations } from '@/contexts'
import { LeadsManager } from '@/LeadsManager'

interface InstagramPost {
  id: string
  type: 'image' | 'video' | 'carousel'
  caption: string
  mediaUrl: string[]
  timestamp: Date
  status: 'published' | 'scheduled' | 'draft'
  insights: {
    likes: number
    comments: number
    shares: number
    saves: number
    reach: number
    impressions: number
    profile_visits: number
  }
  hashtags: string[]
  location?: string
  mentions: string[]
}

interface InstagramStory {
  id: string
  type: 'image' | 'video'
  mediaUrl: string
  text?: string
  stickers?: Array<{
    type: 'poll' | 'question' | 'quiz' | 'location' | 'mention'
    data: any
  }>
  timestamp: Date
  expiresAt: Date
  insights: {
    views: number
    replies: number
    exits: number
    taps_forward: number
    taps_back: number
  }
}

interface InstagramComment {
  id: string
  postId: string
  username: string
  userAvatar: string
  text: string
  timestamp: Date
  likes: number
  replies: InstagramComment[]
  isRepliedTo: boolean
}

interface InstagramFollower {
  id: string
  username: string
  fullName: string
  avatar: string
  followsBack: boolean
  isVerified: boolean
  followerCount?: number
  engagementRate?: number
  lastInteraction?: Date
  interests: string[]
}

interface InstagramInsight {
  period: 'day' | 'week' | 'month'
  data: {
    followers_count: number
    followers_gained: number
    followers_lost: number
    profile_visits: number
    website_clicks: number
    reach: number
    impressions: number
    account_discovery: {
      hashtags: number
      explore: number
      profile_visits: number
      other: number
    }
  }
}

export function InstagramStudioPro() {
  const { instagram, connectInstagram, disconnectInstagram, syncInstagram, refreshInstagram } = useIntegrations()
  const [activeTab, setActiveTab] = useState("feed")
  const [posts, setPosts] = useKV<InstagramPost[]>("instagram-posts", [])
  const [stories, setStories] = useKV<InstagramStory[]>("instagram-stories", [])
  const [comments, setComments] = useKV<InstagramComment[]>("instagram-comments", [])
  const [followers, setFollowers] = useKV<InstagramFollower[]>("instagram-followers", [])
  const [insights, setInsights] = useKV<InstagramInsight[]>("instagram-insights", [])
  const [isCreatingPost, setIsCreatingPost] = useState(false)
  const [isCreatingStory, setIsCreatingStory] = useState(false)
  const [loadingIntegration, setLoadingIntegration] = useState(false)
  const [prospectProfiles, setProspectProfiles] = useState<any[]>([])
  const [dmConversations, setDmConversations] = useState<Record<string, any[]>>({})
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState('')

  const graphEnabled = Boolean(instagram.connected)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [selectedMediaForComments, setSelectedMediaForComments] = useState<string>('')
  const [replyDraftByComment, setReplyDraftByComment] = useState<Record<string, string>>({})

  const [createPostType, setCreatePostType] = useState<'image' | 'video' | 'carousel'>('image')
  const [createPostCaption, setCreatePostCaption] = useState('')
  const [createPostHashtags, setCreatePostHashtags] = useState('')
  const [createPostLocation, setCreatePostLocation] = useState('')
  const [createPostFiles, setCreatePostFiles] = useState<File[]>([])
  const [publishing, setPublishing] = useState(false)

  const [createStoryFiles, setCreateStoryFiles] = useState<File[]>([])
  const [createStoryText, setCreateStoryText] = useState('')
  const [publishingStory, setPublishingStory] = useState(false)

  const [moduleLoading, setModuleLoading] = useState(false)
  const [moduleError, setModuleError] = useState<string | null>(null)
  const [moduleHealthState, setModuleHealthState] = useState<any | null>(null)
  const [moduleAccounts, setModuleAccounts] = useState<any[]>([])
  const [moduleSelectedAccountId, setModuleSelectedAccountId] = useState<string>('')
  const [moduleAnalytics, setModuleAnalytics] = useState<any | null>(null)
  const [moduleAuthToken, setModuleAuthToken] = useState<string>(() => {
    try {
      return localStorage.getItem('instagram-module-auth-token') || ''
    } catch {
      return ''
    }
  })
  const [moduleAddUsername, setModuleAddUsername] = useState('')
  const [moduleAddPassword, setModuleAddPassword] = useState('')
  const [moduleAddAccountId, setModuleAddAccountId] = useState('')

  const [osintUsername, setOsintUsername] = useState('')
  const [osintDeep, setOsintDeep] = useState(true)
  const [osintLoading, setOsintLoading] = useState(false)
  const [osintResult, setOsintResult] = useState<any | null>(null)

  const [downloadUsername, setDownloadUsername] = useState('')
  const [downloadTypes, setDownloadTypes] = useState<string[]>(['posts'])
  const [downloadMaxItems, setDownloadMaxItems] = useState<number>(50)
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [downloadResult, setDownloadResult] = useState<any | null>(null)

  const [automationHashtags, setAutomationHashtags] = useState('photography')
  const [automationMaxLikes, setAutomationMaxLikes] = useState<number>(10)
  const [automationMaxFollows, setAutomationMaxFollows] = useState<number>(5)
  const [automationLoading, setAutomationLoading] = useState(false)
  const [automationResult, setAutomationResult] = useState<any | null>(null)

  // Mock data initialization
  useEffect(() => {
    if (posts.length === 0) {
      setPosts([
        {
          id: "post_1",
          type: "image",
          caption: "Revolucione sua gestão de clientes com nossa plataforma de CRM inteligente! 🚀 #CRM #TechBrasil #Vendas #Automacao",
          mediaUrl: ["/api/placeholder/400/400"],
          timestamp: new Date(Date.now() - 2 * 60 * 60000),
          status: "published",
          insights: {
            likes: 342,
            comments: 28,
            shares: 15,
            saves: 67,
            reach: 2840,
            impressions: 4120,
            profile_visits: 89
          },
          hashtags: ["#CRM", "#TechBrasil", "#Vendas", "#Automacao"],
          location: "São Paulo, Brasil",
          mentions: ["@clientesatisfeito"]
        },
        {
          id: "post_2",
          type: "carousel",
          caption: "Descubra as 5 funcionalidades que vão transformar suas vendas:\n\n1️⃣ IA Preditiva\n2️⃣ Automação de Follow-up\n3️⃣ Relatórios em Tempo Real\n4️⃣ Integração Omnichannel\n5️⃣ Lead Scoring Inteligente\n\n#CRMInnovation #SalesTech",
          mediaUrl: ["/api/placeholder/400/400", "/api/placeholder/400/400", "/api/placeholder/400/400"],
          timestamp: new Date(Date.now() - 24 * 60 * 60000),
          status: "published",
          insights: {
            likes: 156,
            comments: 42,
            shares: 23,
            saves: 89,
            reach: 1890,
            impressions: 3245,
            profile_visits: 34
          },
          hashtags: ["#CRMInnovation", "#SalesTech"],
          mentions: []
        },
        {
          id: "post_3",
          type: "video",
          caption: "Em breve: nova funcionalidade de IA que vai prever qual lead tem 90% de chance de conversão! 🎯",
          mediaUrl: ["/api/placeholder/400/400"],
          timestamp: new Date(Date.now() + 24 * 60 * 60000),
          status: "scheduled",
          insights: {
            likes: 0,
            comments: 0,
            shares: 0,
            saves: 0,
            reach: 0,
            impressions: 0,
            profile_visits: 0
          },
          hashtags: ["#ComingSoon", "#AI", "#CRM"],
          mentions: []
        }
      ])
    }

    if (stories.length === 0) {
      setStories([
        {
          id: "story_1",
          type: "image",
          mediaUrl: "/api/placeholder/300/500",
          text: "Novo cliente conquistado! 🎉",
          stickers: [
            {
              type: "poll",
              data: { question: "Qual funcionalidade você mais usa?", options: ["Relatórios", "Automação"] }
            }
          ],
          timestamp: new Date(Date.now() - 3 * 60 * 60000),
          expiresAt: new Date(Date.now() + 21 * 60 * 60000),
          insights: {
            views: 1234,
            replies: 45,
            exits: 23,
            taps_forward: 156,
            taps_back: 12
          }
        },
        {
          id: "story_2",
          type: "video",
          mediaUrl: "/api/placeholder/300/500",
          text: "Demonstração ao vivo em 1 hora!",
          stickers: [
            {
              type: "question",
              data: { question: "Que funcionalidade vocês querem ver?" }
            }
          ],
          timestamp: new Date(Date.now() - 60 * 60000),
          expiresAt: new Date(Date.now() + 23 * 60 * 60000),
          insights: {
            views: 892,
            replies: 67,
            exits: 12,
            taps_forward: 89,
            taps_back: 8
          }
        }
      ])
    }

    if (comments.length === 0) {
      setComments([
        {
          id: "comment_1",
          postId: "post_1",
          username: "empresario_digital",
          userAvatar: "/api/placeholder/32/32",
          text: "Excelente! Quando vocês vão ter uma versão mobile?",
          timestamp: new Date(Date.now() - 30 * 60000),
          likes: 5,
          replies: [],
          isRepliedTo: false
        },
        {
          id: "comment_2",
          postId: "post_1",
          username: "startup_growth",
          userAvatar: "/api/placeholder/32/32",
          text: "Preciso disso na minha empresa! Como faço para testar?",
          timestamp: new Date(Date.now() - 45 * 60000),
          likes: 8,
          replies: [
            {
              id: "reply_1",
              postId: "post_1",
              username: "empresacrm",
              userAvatar: "/api/placeholder/32/32",
              text: "Oi! Acesse nosso site e agende uma demo gratuita 😊",
              timestamp: new Date(Date.now() - 20 * 60000),
              likes: 3,
              replies: [],
              isRepliedTo: false
            }
          ],
          isRepliedTo: true
        }
      ])
    }

    if (followers.length === 0) {
      setFollowers([
        {
          id: "follower_1",
          username: "ceo_inovador",
          fullName: "João Inovador",
          avatar: "/api/placeholder/40/40",
          followsBack: true,
          isVerified: false,
          followerCount: 5600,
          engagementRate: 8.4,
          lastInteraction: new Date(Date.now() - 2 * 60 * 60000),
          interests: ["business", "technology", "startup"]
        },
        {
          id: "follower_2",
          username: "marketing_expert",
          fullName: "Maria Especialista",
          avatar: "/api/placeholder/40/40",
          followsBack: false,
          isVerified: true,
          followerCount: 25000,
          engagementRate: 12.1,
          lastInteraction: new Date(Date.now() - 24 * 60 * 60000),
          interests: ["marketing", "sales", "digital"]
        }
      ])
    }

    if (insights.length === 0) {
      setInsights([
        {
          period: "week",
          data: {
            followers_count: 8920,
            followers_gained: 127,
            followers_lost: 23,
            profile_visits: 1456,
            website_clicks: 234,
            reach: 12450,
            impressions: 18760,
            account_discovery: {
              hashtags: 45,
              explore: 32,
              profile_visits: 15,
              other: 8
            }
          }
        }
      ])
    }
  }, [posts.length, stories.length, comments.length, followers.length, insights.length, setPosts, setStories, setComments, setFollowers, setInsights])

  // Carregar potenciais leads e conversas quando aba for aberta
  useEffect(() => {
    if (activeTab === 'leads-conversas' && prospectProfiles.length === 0 && !loadingIntegration) {
      setLoadingIntegration(true)
      Promise.all([
        fetchRecentCommentLeads(instagram.businessAccountId, instagram.accessToken),
        fetchRecentDMConversations(instagram.businessAccountId, instagram.accessToken)
      ]).then(([profiles, dms]) => {
        setProspectProfiles(profiles)
        setDmConversations(dms)
      }).finally(() => setLoadingIntegration(false))
    }
  }, [activeTab, prospectProfiles.length, loadingIntegration, instagram.businessAccountId, instagram.accessToken])

  const uploadShareFiles = async (files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    const res = await fetch('/api/share/upload', { method: 'POST', body: fd, headers: csrfHeader(), credentials: 'include' })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    if (!data?.success) throw new Error(data?.error || 'Upload falhou')
    return (data.files || []) as Array<{ url: string; name: string }>
  }

  const buildCaption = () => {
    const caption = createPostCaption.trim()
    const hashtags = createPostHashtags
      .split(/[,\s]+/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('#') ? s : `#${s}`))
      .join(' ')
    const loc = createPostLocation.trim()
    return [caption, loc ? `📍 ${loc}` : '', hashtags].filter(Boolean).join('\n\n').trim()
  }

  const publishPost = async () => {
    if (!graphEnabled) {
      toast.error('Conecte o Instagram (Graph API) para publicar.')
      return
    }
    if (!createPostFiles.length) {
      toast.error('Selecione pelo menos 1 arquivo.')
      return
    }
    if (createPostType === 'video') {
      toast.error('Publicação de vídeo ainda não está habilitada neste fluxo.')
      return
    }

    setPublishing(true)
    try {
      const uploaded = await uploadShareFiles(createPostFiles)
      const caption = buildCaption()

      if (createPostType === 'image' || uploaded.length === 1) {
        await publishInstagramContent({ type: 'image', urls: [uploaded[0].url], caption })
      } else {
        await publishInstagramContent({ type: 'carousel', urls: uploaded.map((u) => u.url).slice(0, 10), caption })
      }

      toast.success('Post enviado para publicação!')
      setIsCreatingPost(false)
      setCreatePostFiles([])
      setCreatePostCaption('')
      setCreatePostHashtags('')
      setCreatePostLocation('')
      void syncInstagram()
      if (activeTab === 'feed') void loadGraphFeed()
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao publicar')
    } finally {
      setPublishing(false)
    }
  }

  const publishStory = async () => {
    if (!graphEnabled) {
      toast.error('Conecte o Instagram (Graph API) para publicar.')
      return
    }
    if (!createStoryFiles.length) {
      toast.error('Selecione 1 arquivo.')
      return
    }
    setPublishingStory(true)
    try {
      const uploaded = await uploadShareFiles([createStoryFiles[0]])
      await publishInstagramContent({
        type: 'story',
        urls: [uploaded[0].url],
        caption: createStoryText.trim() || undefined,
      })
      toast.success('Story enviado para publicação!')
      setIsCreatingStory(false)
      setCreateStoryFiles([])
      setCreateStoryText('')
      if (activeTab === 'stories') void loadGraphStories()
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao publicar story')
    } finally {
      setPublishingStory(false)
    }
  }

  const mapGraphMediaToPosts = (media: InstagramGraphMedia[]): InstagramPost[] => {
    return media.map((m) => {
      const mediaUrls: string[] = []
      if (m.media_type === 'CAROUSEL_ALBUM' && m.children?.data?.length) {
        for (const c of m.children.data) {
          if (c.media_url) mediaUrls.push(c.media_url)
          else if (c.thumbnail_url) mediaUrls.push(c.thumbnail_url)
        }
      } else if (m.media_url) {
        mediaUrls.push(m.media_url)
      } else if (m.thumbnail_url) {
        mediaUrls.push(m.thumbnail_url)
      }

      const ts = m.timestamp ? new Date(m.timestamp) : new Date()
      return {
        id: m.id,
        type: m.media_type === 'VIDEO' || m.media_type === 'REELS' ? 'video' : (m.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : 'image'),
        caption: m.caption || '',
        mediaUrl: mediaUrls.length ? mediaUrls : ['/api/placeholder/400/400'],
        timestamp: ts,
        status: 'published',
        insights: {
          likes: m.like_count || 0,
          comments: m.comments_count || 0,
          shares: 0,
          saves: 0,
          reach: 0,
          impressions: 0,
          profile_visits: 0
        },
        hashtags: (m.caption || '').split(/\s+/g).filter((t) => t.startsWith('#')).slice(0, 12),
        mentions: (m.caption || '').split(/\s+/g).filter((t) => t.startsWith('@')).slice(0, 12)
      }
    })
  }

  const loadGraphFeed = async () => {
    if (!graphEnabled) return
    setGraphLoading(true)
    setGraphError(null)
    try {
      const media = await fetchInstagramMedia(undefined, undefined, 25)
      const mapped = mapGraphMediaToPosts(media)
      setPosts(mapped)
      if (!selectedMediaForComments && mapped[0]?.id) setSelectedMediaForComments(mapped[0].id)
    } catch (e: any) {
      setGraphError(e?.message || 'Falha ao carregar Feed')
    } finally {
      setGraphLoading(false)
    }
  }

  const loadGraphStories = async () => {
    if (!graphEnabled) return
    setGraphLoading(true)
    setGraphError(null)
    try {
      const items = await fetchInstagramStories(undefined, undefined, 25)
      const mapped: InstagramStory[] = items.map((s: any) => ({
        id: s.id,
        type: (s.media_type === 'VIDEO' ? 'video' : 'image'),
        mediaUrl: s.media_url || s.thumbnail_url || '/api/placeholder/300/500',
        text: s.caption || undefined,
        stickers: [],
        timestamp: s.timestamp ? new Date(s.timestamp) : new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60000),
        insights: { views: 0, replies: 0, exits: 0, taps_forward: 0, taps_back: 0 }
      }))
      setStories(mapped)
    } catch (e: any) {
      setGraphError(e?.message || 'Falha ao carregar Stories')
    } finally {
      setGraphLoading(false)
    }
  }

  const loadGraphComments = async (mediaId: string) => {
    if (!graphEnabled || !mediaId) return
    setGraphLoading(true)
    setGraphError(null)
    try {
      const data = await fetchInstagramMediaComments(mediaId, undefined, 50)
      const mapped: InstagramComment[] = data.map((c: any) => ({
        id: c.id,
        postId: mediaId,
        username: c.username || 'instagram',
        userAvatar: '/api/placeholder/40/40',
        text: c.text || '',
        timestamp: c.timestamp ? new Date(c.timestamp) : new Date(),
        likes: c.like_count || 0,
        replies: (c.replies?.data || []).map((r: any) => ({
          id: r.id,
          postId: mediaId,
          username: r.username || 'instagram',
          userAvatar: '/api/placeholder/40/40',
          text: r.text || '',
          timestamp: r.timestamp ? new Date(r.timestamp) : new Date(),
          likes: r.like_count || 0,
          replies: [],
          isRepliedTo: true
        })),
        isRepliedTo: (c.replies?.data || []).length > 0
      }))
      setComments(mapped)
    } catch (e: any) {
      setGraphError(e?.message || 'Falha ao carregar comentários')
    } finally {
      setGraphLoading(false)
    }
  }

  useEffect(() => {
    if (!graphEnabled) return
    if (activeTab === 'feed') void loadGraphFeed()
    if (activeTab === 'stories') void loadGraphStories()
    if (activeTab === 'comments' && selectedMediaForComments) void loadGraphComments(selectedMediaForComments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, graphEnabled])

  useEffect(() => {
    if (activeTab !== 'comments') return
    if (!graphEnabled) return
    if (!selectedMediaForComments) return
    void loadGraphComments(selectedMediaForComments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMediaForComments])

  const refreshInstagramModule = async () => {
    setModuleLoading(true)
    setModuleError(null)
    try {
      const [health, accounts] = await Promise.all([instagramModuleHealth(), instagramModuleListAccounts()])
      setModuleHealthState(health)
      setModuleAccounts(accounts)
      const selected =
        moduleSelectedAccountId && accounts.some(a => a.account_id === moduleSelectedAccountId)
          ? moduleSelectedAccountId
          : (accounts[0]?.account_id || '')
      setModuleSelectedAccountId(selected)
      if (selected) {
        const analytics = await instagramModuleGetAnalytics(selected)
        setModuleAnalytics(analytics)
      } else {
        setModuleAnalytics(null)
      }
    } catch (e: any) {
      setModuleError(e?.message || 'Falha ao carregar Instagram Module.')
      setModuleHealthState(null)
      setModuleAccounts([])
      setModuleAnalytics(null)
    } finally {
      setModuleLoading(false)
    }
  }

  const saveInstagramModuleAuthToken = () => {
    const v = moduleAuthToken.trim()
    try {
      if (v) localStorage.setItem('instagram-module-auth-token', v)
      else localStorage.removeItem('instagram-module-auth-token')
    } catch { /* ignore */ }
    toast.success(v ? 'Token salvo' : 'Token removido')
    void refreshInstagramModule()
  }

  useEffect(() => {
    if (activeTab !== 'module') return
    if (moduleLoading) return
    if (moduleHealthState || moduleError) return
    void refreshInstagramModule()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'module') return
    if (!moduleSelectedAccountId) return
    if (moduleLoading) return
    void (async () => {
      try {
        const analytics = await instagramModuleGetAnalytics(moduleSelectedAccountId)
        setModuleAnalytics(analytics)
      } catch {
        setModuleAnalytics(null)
      }
    })()
  }, [activeTab, moduleSelectedAccountId])

  const handleAddInstagramModuleAccount = async () => {
    const username = moduleAddUsername.trim()
    const password = moduleAddPassword
    const account_id = moduleAddAccountId.trim() || undefined
    if (!username || !password) return
    setModuleLoading(true)
    try {
      await instagramModuleAddAccount({ username, password, account_id })
      setModuleAddUsername('')
      setModuleAddPassword('')
      setModuleAddAccountId('')
      toast.success('Conta adicionada no Instagram Module')
      await refreshInstagramModule()
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao adicionar conta')
    } finally {
      setModuleLoading(false)
    }
  }

  const handleOsintInvestigate = async () => {
    const username = osintUsername.trim().replace(/^@/, '')
    if (!username) return
    setOsintLoading(true)
    setOsintResult(null)
    try {
      const out = await instagramModuleOsintInvestigate({ username, deep_analysis: osintDeep })
      setOsintResult(out)
      toast.success(osintDeep ? 'OSINT (deep) iniciado' : 'OSINT concluído')
    } catch (e: any) {
      toast.error(e?.message || 'Falha no OSINT')
      setOsintResult({ error: e?.message || 'Falha no OSINT' })
    } finally {
      setOsintLoading(false)
    }
  }

  const toggleDownloadType = (t: string) => {
    setDownloadTypes(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
  }

  const handleDownloadContent = async () => {
    const username = downloadUsername.trim().replace(/^@/, '')
    if (!username) return
    setDownloadLoading(true)
    setDownloadResult(null)
    try {
      const out = await instagramModuleDownloadContent({
        username,
        content_types: downloadTypes.length ? downloadTypes : ['posts'],
        max_items: Math.max(1, Math.min(500, Number(downloadMaxItems) || 50)),
      })
      setDownloadResult(out)
      toast.success('Download iniciado')
    } catch (e: any) {
      toast.error(e?.message || 'Falha no download')
      setDownloadResult({ error: e?.message || 'Falha no download' })
    } finally {
      setDownloadLoading(false)
    }
  }

  const handleRunAutomation = async () => {
    const account_id = moduleSelectedAccountId
    if (!account_id) return
    setAutomationLoading(true)
    setAutomationResult(null)
    try {
      const hashtags = automationHashtags
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.replace(/^#/, ''))
      const out = await instagramModuleRunAutomation({
        account_id,
        target_hashtags: hashtags.length ? hashtags : undefined,
        max_likes: Math.max(0, Number(automationMaxLikes) || 0),
        max_follows: Math.max(0, Number(automationMaxFollows) || 0),
      })
      setAutomationResult(out)
      toast.success('Automação executada')
    } catch (e: any) {
      toast.error(e?.message || 'Falha na automação')
      setAutomationResult({ error: e?.message || 'Falha na automação' })
    } finally {
      setAutomationLoading(false)
    }
  }

  const handleSendDM = async () => {
    if (!selectedConversation || !messageDraft.trim()) return
    const msg = await sendDirectMessage(selectedConversation, messageDraft.trim())
    setDmConversations(prev => ({
      ...prev,
      [selectedConversation]: [...(prev[selectedConversation] || []), msg]
    }))
    setMessageDraft('')
    window.dispatchEvent(new CustomEvent('instagram:dm', { detail: { userId: selectedConversation, text: msg.text } }))
  }

  const convertProfileToLead = (profile: any) => {
    // Dispara evento para LeadsManager via localStorage (simplificado)
    const leadData = mapInstagramProfileToLead(profile)
    const key = 'new-instagram-leads'
    const existing = JSON.parse(localStorage.getItem(key) || '[]')
    existing.push(leadData)
    localStorage.setItem(key, JSON.stringify(existing))
    // Dispara evento global para ingestion imediata
    window.dispatchEvent(new CustomEvent('lead:new', { detail: leadData }))
    toast.success(`Perfil @${profile.username} convertido em Lead`)
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const formatTime = (input: Date | string | number) => {
    const date = input instanceof Date ? input : new Date(input)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (60 * 60 * 1000))

    if (hours < 1) return `${Math.floor(diff / (60 * 1000))}m`
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  }

  const currentInsight = insights[0]
  const isConnected = instagram.connected

  const header = (
    <div className="flex items-center justify-between">
      <div className="text-center md:text-left">
        <h2 className="text-3xl font-bold text-white flex items-center justify-center md:justify-start gap-3 mb-3">
          <div className="relative">
            <InstagramLogo className="h-8 w-8 text-pink-400" />
            <div className="absolute -inset-1 bg-pink-400/20 rounded-full blur opacity-75 animate-pulse"></div>
          </div>
          Instagram Studio Pro
        </h2>
        <p className="text-blue-300/80 text-base leading-relaxed">
          Gerencie posts, stories e engajamento no Instagram
        </p>
      </div>
      <div className="flex space-x-4 items-center">
        {isConnected && instagram.metrics && (
          <div className="glass-morphism rounded-xl p-4 border border-white/10">
            <div className="text-sm text-blue-200 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-pink-400 animate-pulse"></div>
                <span className="font-medium text-pink-300">Seguidores: {instagram.metrics.followers_count}</span>
              </div>
              <div className="text-blue-300/70">Mídias: {instagram.metrics.media_count}</div>
              {instagram.lastSync && (
                <div className="text-xs text-blue-300/60">
                  Sync: {new Date(instagram.lastSync).toLocaleTimeString('pt-BR')}
                </div>
              )}
            </div>
          </div>
        )}
        {!isConnected && (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="glass-morphism border-pink-500/30 text-pink-300 hover:text-white hover:bg-pink-500/10 transition-all duration-300 hover:scale-105"
              >
                Conectar Conta
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Conectar Instagram Business</DialogTitle>
                <DialogDescription>Informe Access Token e Business Account ID obtidos no Facebook Developers</DialogDescription>
              </DialogHeader>
              <ConnectInstagramForm onConnect={connectInstagram} onRefresh={refreshInstagram} />
            </DialogContent>
          </Dialog>
        )}
        {isConnected && (
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className="glass-morphism border-green-500/30 text-green-300 bg-green-500/10 text-xs font-medium"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                Conectado
              </div>
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncInstagram()}
              className="glass-morphism border-blue-500/30 text-blue-300 hover:text-white hover:bg-blue-500/10 transition-all duration-300"
            >
              Sync
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={disconnectInstagram}
              className="glass-morphism border-red-500/30 text-red-300 hover:text-white hover:bg-red-500/10 transition-all duration-300"
            >
              Desconectar
            </Button>
          </div>
        )}
        {isConnected && (
          <Dialog open={isCreatingStory} onOpenChange={setIsCreatingStory}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Camera className="h-4 w-4 mr-2" />
                Story
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Story</DialogTitle>
                <DialogDescription>Publique um story no Instagram</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Mídia</Label>
                  <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center space-y-3">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setCreateStoryFiles(e.target.files ? Array.from(e.target.files).slice(0, 1) : [])}
                    />
                    <p className="text-xs text-muted-foreground">Publicação via Graph API requer URL pública; faremos upload em /share.</p>
                  </div>
                </div>
                <div>
                  <Label>Texto (opcional)</Label>
                  <Input placeholder="Adicione um texto ao story..." value={createStoryText} onChange={(e) => setCreateStoryText(e.target.value)} />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setIsCreatingStory(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={publishStory} disabled={publishingStory}>
                    {publishingStory ? 'Publicando…' : 'Publicar'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {isConnected && (
          <Dialog open={isCreatingPost} onOpenChange={setIsCreatingPost}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo Post
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Post</DialogTitle>
                <DialogDescription>Crie um novo post para o Instagram</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Tipo de Post</Label>
                  <Select value={createPostType} onValueChange={(v: any) => setCreatePostType(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">Imagem</SelectItem>
                      <SelectItem value="video">Vídeo</SelectItem>
                      <SelectItem value="carousel">Carrossel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Mídia</Label>
                  <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center space-y-3">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <Input
                      type="file"
                      accept={createPostType === 'video' ? 'video/*' : 'image/*'}
                      multiple={createPostType === 'carousel'}
                      onChange={(e) =>
                        setCreatePostFiles(
                          e.target.files ? Array.from(e.target.files).slice(0, createPostType === 'carousel' ? 10 : 1) : []
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">Publicação via Graph API requer URL pública; faremos upload em /share.</p>
                  </div>
                </div>

                <div>
                  <Label>Legenda</Label>
                  <Textarea
                    placeholder="Escreva uma legenda envolvente..."
                    rows={4}
                    value={createPostCaption}
                    onChange={(e) => setCreatePostCaption(e.target.value)}
                  />
                </div>

                <div>
                  <Label>Hashtags</Label>
                  <Input placeholder="#crm #vendas #tecnologia" value={createPostHashtags} onChange={(e) => setCreatePostHashtags(e.target.value)} />
                </div>

                <div>
                  <Label>Localização (opcional)</Label>
                  <Input placeholder="São Paulo, Brasil" value={createPostLocation} onChange={(e) => setCreatePostLocation(e.target.value)} />
                </div>

                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setIsCreatingPost(false)}>
                    Salvar Rascunho
                  </Button>
                  <Button variant="outline">
                    Agendar
                  </Button>
                  <Button onClick={publishPost} disabled={publishing}>
                    {publishing ? 'Publicando…' : 'Publicar'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>
    )

  return (
    <div className="space-y-8 animate-fade-in">
      {header}
      {!isConnected ? (
        <div className="glass-morphism rounded-2xl p-5 border border-white/10 bg-white/5">
          <div className="text-sm text-blue-100/70">
            Conecte sua conta para carregar feed, stories, comentários e insights.
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {['Feed', 'Stories', 'Insights'].map((label) => (
              <div
                key={label}
                className="h-24 rounded-xl border border-dashed border-white/10 bg-white/5 flex items-center justify-center text-xs text-blue-100/50"
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
        <TabsList className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 w-full max-w-6xl glass-morphism p-2 border-white/20 shadow-premium">
          <TabsTrigger 
            value="feed" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Feed
          </TabsTrigger>
          <TabsTrigger 
            value="stories" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Stories
          </TabsTrigger>
          <TabsTrigger 
            value="comments" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Comentários
          </TabsTrigger>
          <TabsTrigger 
            value="followers" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Seguidores
          </TabsTrigger>
          <TabsTrigger 
            value="insights" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Insights
          </TabsTrigger>
          <TabsTrigger 
            value="leads-conversas" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Leads & Conversas
          </TabsTrigger>
          <TabsTrigger
            value="module"
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Módulo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="module" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Instagram Module (local)</CardTitle>
                  <CardDescription>Conecta no serviço em `:3103` via proxy `/api/instagram-module`</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {moduleLoading ? (
                    <Badge variant="secondary">
                      <LoadingPercentText label="Carregando" className="text-xs text-white/80" showPercent={false} />
                    </Badge>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={() => refreshInstagramModule()}>
                    Atualizar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {moduleError ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {moduleError}
                  <div className="text-xs text-red-200/70 mt-1">
                    Verifique se o serviço está rodando: `./backend/scripts/dev.sh instagram-module start`
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="md:col-span-2">
                  <Label>Bearer token (opcional)</Label>
                  <Input
                    value={moduleAuthToken}
                    onChange={(e) => setModuleAuthToken(e.target.value)}
                    placeholder="Bearer … (necessário se development_mode=false)"
                  />
                </div>
                <Button variant="outline" onClick={saveInstagramModuleAuthToken} disabled={moduleLoading}>
                  Salvar token
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="glass-card lg:col-span-1">
                  <CardHeader>
                    <CardTitle className="text-base">Status</CardTitle>
                    <CardDescription>Saúde do serviço</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge variant={moduleHealthState?.status === 'healthy' ? 'secondary' : 'destructive'}>
                        {moduleHealthState?.status || 'desconhecido'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Modo</span>
                      <span className="text-sm">{moduleHealthState?.mode || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Contas</span>
                      <span className="text-sm">{moduleHealthState?.accounts_configured ?? '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Último check</span>
                      <span className="text-sm">
                        {moduleHealthState?.timestamp ? new Date(moduleHealthState.timestamp).toLocaleString('pt-BR') : '-'}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="glass-card lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Contas</CardTitle>
                    <CardDescription>Gerencie contas do Instagram Module</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-1">
                        <Label>Conta ativa</Label>
                        <Select value={moduleSelectedAccountId} onValueChange={setModuleSelectedAccountId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione…" />
                          </SelectTrigger>
                          <SelectContent>
                            {moduleAccounts.length ? moduleAccounts.map(a => (
                              <SelectItem key={a.account_id} value={a.account_id}>
                                {a.username} ({a.account_id})
                              </SelectItem>
                            )) : (
                              <SelectItem value="__none__" disabled>Nenhuma conta</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <Label>Usuário</Label>
                          <Input value={moduleAddUsername} onChange={e => setModuleAddUsername(e.target.value)} placeholder="username" />
                        </div>
                        <div>
                          <Label>Senha</Label>
                          <Input value={moduleAddPassword} onChange={e => setModuleAddPassword(e.target.value)} placeholder="••••••••" type="password" />
                        </div>
                        <div>
                          <Label>Account ID (opcional)</Label>
                          <Input value={moduleAddAccountId} onChange={e => setModuleAddAccountId(e.target.value)} placeholder="id (default=username)" />
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        onClick={handleAddInstagramModuleAccount}
                        disabled={moduleLoading || !moduleAddUsername.trim() || !moduleAddPassword}
                      >
                        Adicionar conta
                      </Button>
                    </div>

                    {moduleAnalytics ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Card className="glass-card">
                          <CardContent className="pt-4">
                            <div className="text-xs text-muted-foreground">Seguidores</div>
                            <div className="text-xl font-bold">{moduleAnalytics.followers_count ?? '-'}</div>
                          </CardContent>
                        </Card>
                        <Card className="glass-card">
                          <CardContent className="pt-4">
                            <div className="text-xs text-muted-foreground">Seguindo</div>
                            <div className="text-xl font-bold">{moduleAnalytics.following_count ?? '-'}</div>
                          </CardContent>
                        </Card>
                        <Card className="glass-card">
                          <CardContent className="pt-4">
                            <div className="text-xs text-muted-foreground">Posts</div>
                            <div className="text-xl font-bold">{moduleAnalytics.posts_count ?? '-'}</div>
                          </CardContent>
                        </Card>
                        <Card className="glass-card">
                          <CardContent className="pt-4">
                            <div className="text-xs text-muted-foreground">Engajamento (10 posts)</div>
                            <div className="text-xs text-muted-foreground">
                              ❤️ {moduleAnalytics?.recent_posts?.total_likes ?? '-'} • 💬 {moduleAnalytics?.recent_posts?.total_comments ?? '-'}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Selecione uma conta para ver analytics.</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle className="text-base">OSINT</CardTitle>
                    <CardDescription>Investigar perfil (simulado quando necessário)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Input value={osintUsername} onChange={e => setOsintUsername(e.target.value)} placeholder="@usuario" />
                      <Button onClick={handleOsintInvestigate} disabled={osintLoading || !osintUsername.trim()}>
                        {osintLoading ? 'Rodando…' : 'Investigar'}
                      </Button>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="checkbox" checked={osintDeep} onChange={(e) => setOsintDeep(e.target.checked)} />
                      Deep analysis (background)
                    </label>
                    {osintResult ? (
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <pre className="text-xs overflow-auto max-h-64">{JSON.stringify(osintResult, null, 2)}</pre>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle className="text-base">Automação</CardTitle>
                    <CardDescription>Curte/segue por hashtags (simulação)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-3">
                        <Label>Hashtags (separadas por vírgula)</Label>
                        <Input value={automationHashtags} onChange={e => setAutomationHashtags(e.target.value)} placeholder="photography, marketing" />
                      </div>
                      <div>
                        <Label>Max likes</Label>
                        <Input
                          type="number"
                          value={String(automationMaxLikes)}
                          onChange={e => setAutomationMaxLikes(Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <Label>Max follows</Label>
                        <Input
                          type="number"
                          value={String(automationMaxFollows)}
                          onChange={e => setAutomationMaxFollows(Number(e.target.value))}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button onClick={handleRunAutomation} disabled={automationLoading || !moduleSelectedAccountId}>
                          {automationLoading ? 'Executando…' : 'Executar'}
                        </Button>
                      </div>
                    </div>
                    {automationResult ? (
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <pre className="text-xs overflow-auto max-h-64">{JSON.stringify(automationResult, null, 2)}</pre>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="glass-card lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Download</CardTitle>
                    <CardDescription>Baixar posts/stories/highlights (simulação)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <Label>Username</Label>
                        <Input value={downloadUsername} onChange={e => setDownloadUsername(e.target.value)} placeholder="@usuario" />
                      </div>
                      <div>
                        <Label>Max itens</Label>
                        <Input type="number" value={String(downloadMaxItems)} onChange={e => setDownloadMaxItems(Number(e.target.value))} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={downloadTypes.includes('posts')} onChange={() => toggleDownloadType('posts')} />
                        posts
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={downloadTypes.includes('stories')} onChange={() => toggleDownloadType('stories')} />
                        stories
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={downloadTypes.includes('highlights')} onChange={() => toggleDownloadType('highlights')} />
                        highlights
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <Button onClick={handleDownloadContent} disabled={downloadLoading || !downloadUsername.trim()}>
                        {downloadLoading ? 'Baixando…' : 'Baixar'}
                      </Button>
                    </div>
                    {downloadResult ? (
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <pre className="text-xs overflow-auto max-h-64">{JSON.stringify(downloadResult, null, 2)}</pre>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leads-conversas" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChatsCircle className="h-5 w-5 text-pink-600" />
                  <CardTitle>Leads & Conversas</CardTitle>
                </div>
                {loadingIntegration && <Badge variant="secondary">Sincronizando...</Badge>}
              </div>
              <CardDescription>Converta interações do Instagram em leads e gerencie DMs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Perfis Potenciais */}
                <div className="lg:col-span-1 space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Potenciais Leads</h3>
                  <div className="space-y-3">
                    {prospectProfiles.map(p => (
                      <div key={p.id} className="p-3 border rounded-lg flex items-center justify-between hover:bg-muted/50 transition-colors">
                        <div>
                          <p className="font-medium">@{p.username}</p>
                          <p className="text-xs text-muted-foreground">{p.name || 'Sem nome'}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => convertProfileToLead(p)}>
                          <UserPlus className="h-4 w-4 mr-1" /> Lead
                        </Button>
                      </div>
                    ))}
                    {prospectProfiles.length === 0 && !loadingIntegration && (
                      <p className="text-xs text-muted-foreground">Nenhum perfil novo identificado.</p>
                    )}
                  </div>
                </div>

                {/* Conversas */}
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1 space-y-2">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Conversas</h3>
                    <div className="border rounded-lg divide-y max-h-80 overflow-auto">
                      {Object.keys(dmConversations).map(cid => (
                        <button
                          key={cid}
                          onClick={() => setSelectedConversation(cid)}
                          className={`w-full text-left p-3 text-sm hover:bg-muted/60 ${selectedConversation === cid ? 'bg-muted' : ''}`}
                        >
                          @{prospectProfiles.find(p => p.id === cid)?.username || cid}
                        </button>
                      ))}
                      {Object.keys(dmConversations).length === 0 && (
                        <p className="p-3 text-xs text-muted-foreground">Sem conversas recentes.</p>
                      )}
                    </div>
                  </div>
                  <div className="md:col-span-2 flex flex-col h-80 border rounded-lg">
                    <div className="flex-1 overflow-auto p-3 space-y-3">
                      {(selectedConversation && dmConversations[selectedConversation]) ? (
                        dmConversations[selectedConversation].map(msg => (
                          <div key={msg.id} className={`max-w-xs p-2 rounded-md text-sm ${msg.direction === 'in' ? 'bg-muted' : 'bg-pink-600 text-white ml-auto'}`}>
                            {msg.text}
                            <div className="text-[10px] opacity-60 mt-1">{new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">Selecione uma conversa.</p>
                      )}
                    </div>
                    <div className="border-t p-2 flex gap-2">
                      <Input
                        placeholder="Escrever mensagem..."
                        value={messageDraft}
                        onChange={(e) => setMessageDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendDM() } }}
                      />
                      <Button size="sm" onClick={handleSendDM} disabled={!messageDraft.trim() || !selectedConversation}>
                        <PaperPlaneTilt className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <p className="text-xs text-muted-foreground">Novos leads convertidos serão enviados para o módulo Leads automaticamente.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feed" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {posts.map((post) => (
              <Card key={post.id} className="glass-card">
                <CardContent className="p-0">
                  <div className="relative">
                    <div className="aspect-square bg-muted rounded-t-lg overflow-hidden">
                      {post.type === 'carousel' && (
                        <Badge className="absolute top-2 right-2 z-10">
                          <ImageIcon className="h-3 w-3 mr-1" />
                          {post.mediaUrl.length}
                        </Badge>
                      )}
                      {post.type === 'video' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Play className="h-12 w-12 text-white drop-shadow-lg" />
                        </div>
                      )}
                      <img
                        src={post.mediaUrl[0]}
                        alt={post.caption}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="absolute top-2 left-2">
                      <Badge
                        variant={
                          post.status === 'published' ? 'default' :
                            post.status === 'scheduled' ? 'secondary' : 'outline'
                        }
                      >
                        {post.status === 'published' ? 'Publicado' :
                          post.status === 'scheduled' ? 'Agendado' : 'Rascunho'}
                      </Badge>
                    </div>
                  </div>

                  <div className="p-4">
                    <p className="text-sm line-clamp-3 mb-3">{post.caption}</p>

                    <div className="flex flex-wrap gap-1 mb-3">
                      {post.hashtags.slice(0, 3).map(tag => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {post.hashtags.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{post.hashtags.length - 3}
                        </Badge>
                      )}
                    </div>

                    {post.status === 'published' && (
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center space-x-1">
                          <Heart className="h-4 w-4 text-red-500" />
                          <span>{formatNumber(post.insights.likes)}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <ChatCircle className="h-4 w-4" />
                          <span>{formatNumber(post.insights.comments)}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Eye className="h-4 w-4" />
                          <span>{formatNumber(post.insights.reach)}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Bookmark className="h-4 w-4" />
                          <span>{formatNumber(post.insights.saves)}</span>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                      {post.status === 'published'
                        ? `Publicado ${formatTime(post.timestamp)} atrás`
                        : post.status === 'scheduled'
                          ? `Agendado para ${new Date(post.timestamp as any).toLocaleString('pt-BR')}`
                          : 'Rascunho'
                      }
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="stories" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {stories.map((story) => (
              <Card key={story.id} className="glass-card">
                <CardContent className="p-0">
                  <div className="relative">
                    <div className="aspect-[9/16] bg-muted rounded-lg overflow-hidden">
                      {story.type === 'video' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Play className="h-8 w-8 text-white drop-shadow-lg" />
                        </div>
                      )}
                      <img
                        src={story.mediaUrl}
                        alt="Story"
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="absolute top-2 left-2 right-2">
                      <div className="flex justify-between items-start">
                        <Badge variant="secondary" className="text-xs">
                          {story.type === 'video' ? 'Vídeo' : 'Foto'}
                        </Badge>
                        <div className="text-xs text-white bg-black/50 px-2 py-1 rounded">
                          {Math.ceil((new Date(story.expiresAt as any).getTime() - Date.now()) / (60 * 60 * 1000))}h
                        </div>
                      </div>
                    </div>

                    {story.text && (
                      <div className="absolute bottom-2 left-2 right-2">
                        <p className="text-white text-sm bg-black/50 p-2 rounded">
                          {story.text}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center space-x-1">
                        <Eye className="h-3 w-3" />
                        <span>{formatNumber(story.insights.views)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <ChatCircle className="h-3 w-3" />
                        <span>{story.insights.replies}</span>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-muted-foreground">
                      {formatTime(story.timestamp)} atrás
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="comments" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Gerenciar Comentários</CardTitle>
              <CardDescription>Responda e gerencie comentários dos seus posts</CardDescription>
            </CardHeader>
            <CardContent>
              {graphEnabled ? (
                <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                  <div>
                    <Label>Post</Label>
                    <Select value={selectedMediaForComments} onValueChange={setSelectedMediaForComments}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione…" />
                      </SelectTrigger>
                      <SelectContent>
                        {posts.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.caption ? p.caption.slice(0, 36) + (p.caption.length > 36 ? '…' : '') : p.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {graphLoading ? (
                      <Badge variant="secondary">
                        <LoadingPercentText label="Carregando" className="text-xs text-white/80" showPercent={false} />
                      </Badge>
                    ) : null}
                    {graphError ? <Badge variant="destructive">{graphError}</Badge> : null}
                    <Button variant="outline" onClick={() => selectedMediaForComments && loadGraphComments(selectedMediaForComments)}>
                      Atualizar
                    </Button>
                  </div>
                </div>
              ) : null}
              <ScrollArea className="h-[500px]">
                <div className="space-y-4">
                  {comments.map((comment) => (
                    <div key={comment.id} className="border-b pb-4">
                      <div className="flex items-start space-x-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={comment.userAvatar} />
                          <AvatarFallback>{comment.username.slice(0, 2)}</AvatarFallback>
                        </Avatar>

                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="font-medium text-sm">{comment.username}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatTime(comment.timestamp)} atrás
                            </span>
                          </div>

                          <p className="text-sm mb-2">{comment.text}</p>

                          <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-1">
                              <Heart className="h-3 w-3" />
                              <span className="text-xs">{comment.likes}</span>
                            </div>

                            {graphEnabled ? (
                              <div className="flex-1 flex items-center gap-2">
                                <Input
                                  value={replyDraftByComment[comment.id] || ''}
                                  onChange={(e) => setReplyDraftByComment((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                                  placeholder="Responder…"
                                  className="h-8"
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8"
                                  disabled={!replyDraftByComment[comment.id]?.trim()}
                                  onClick={async () => {
                                    const message = (replyDraftByComment[comment.id] || '').trim()
                                    if (!message) return
                                    try {
                                      await replyToInstagramComment(comment.id, message)
                                      setReplyDraftByComment((prev) => ({ ...prev, [comment.id]: '' }))
                                      toast.success('Resposta enviada')
                                      if (selectedMediaForComments) await loadGraphComments(selectedMediaForComments)
                                    } catch (e: any) {
                                      toast.error(e?.message || 'Falha ao responder')
                                    }
                                  }}
                                >
                                  Enviar
                                </Button>
                              </div>
                            ) : (
                              <Button variant="ghost" size="sm" className="text-xs h-6">
                                Responder
                              </Button>
                            )}

                            {!comment.isRepliedTo && (
                              <Badge variant="destructive" className="text-xs">
                                Não respondido
                              </Badge>
                            )}
                          </div>

                          {comment.replies.length > 0 && (
                            <div className="mt-3 ml-4 space-y-2">
                              {comment.replies.map((reply) => (
                                <div key={reply.id} className="flex items-start space-x-2">
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage src={reply.userAvatar} />
                                    <AvatarFallback>{reply.username.slice(0, 2)}</AvatarFallback>
                                  </Avatar>
                                  <div>
                                    <div className="flex items-center space-x-2">
                                      <span className="font-medium text-xs">{reply.username}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {formatTime(reply.timestamp)} atrás
                                      </span>
                                    </div>
                                    <p className="text-xs">{reply.text}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="followers" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {followers.map((follower) => (
              <Card key={follower.id} className="glass-card">
                <CardContent className="pt-6">
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={follower.avatar} />
                        <AvatarFallback>{follower.username.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                      {follower.isVerified && (
                        <div className="absolute -bottom-1 -right-1">
                          <Crown className="h-4 w-4 text-blue-500 bg-white rounded-full p-0.5" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{follower.fullName}</span>
                        {follower.followsBack && (
                          <Badge variant="secondary" className="text-xs">Segue você</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">@{follower.username}</p>

                      {follower.followerCount && (
                        <div className="flex items-center space-x-4 mt-2 text-xs text-muted-foreground">
                          <span>{formatNumber(follower.followerCount)} seguidores</span>
                          {follower.engagementRate && (
                            <span>{follower.engagementRate}% engajamento</span>
                          )}
                        </div>
                      )}

                      {follower.lastInteraction && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Última interação: {formatTime(follower.lastInteraction)} atrás
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col space-y-2">
                      <Button variant="outline" size="sm">
                        <PaperPlaneTilt className="h-3 w-3 mr-1" />
                        DM
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {follower.interests.map(interest => (
                      <Badge key={interest} variant="outline" className="text-xs">
                        {interest}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          {currentInsight && (
            <>
              {/* Overview Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <Card className="glass-card">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Seguidores</p>
                        <p className="text-2xl font-bold">{formatNumber(currentInsight.data.followers_count)}</p>
                        <p className="text-xs text-green-600">
                          +{currentInsight.data.followers_gained} esta semana
                        </p>
                      </div>
                      <Users className="h-8 w-8 text-pink-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="glass-card">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Alcance</p>
                        <p className="text-2xl font-bold">{formatNumber(currentInsight.data.reach)}</p>
                        <p className="text-xs text-blue-600">
                          Últimos 7 dias
                        </p>
                      </div>
                      <Eye className="h-8 w-8 text-blue-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="glass-card">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Impressões</p>
                        <p className="text-2xl font-bold">{formatNumber(currentInsight.data.impressions)}</p>
                        <p className="text-xs text-purple-600">
                          {((currentInsight.data.impressions / currentInsight.data.reach) * 100).toFixed(1)}% frequência
                        </p>
                      </div>
                      <TrendUp className="h-8 w-8 text-purple-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="glass-card">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Perfil</p>
                        <p className="text-2xl font-bold">{formatNumber(currentInsight.data.profile_visits)}</p>
                        <p className="text-xs text-orange-600">
                          {currentInsight.data.website_clicks} cliques no site
                        </p>
                      </div>
                      <Target className="h-8 w-8 text-orange-600" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Account Discovery */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Descoberta da Conta</CardTitle>
                  <CardDescription>Como as pessoas encontram seu perfil</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-pink-600">
                        {currentInsight.data.account_discovery.hashtags}%
                      </div>
                      <div className="text-sm text-muted-foreground">Hashtags</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {currentInsight.data.account_discovery.explore}%
                      </div>
                      <div className="text-sm text-muted-foreground">Explorar</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {currentInsight.data.account_discovery.profile_visits}%
                      </div>
                      <div className="text-sm text-muted-foreground">Perfil</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-600">
                        {currentInsight.data.account_discovery.other}%
                      </div>
                      <div className="text-sm text-muted-foreground">Outros</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Engagement Rate by Post Type */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Performance por Tipo de Conteúdo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <ImageIcon className="h-4 w-4" />
                        <span>Posts com Imagem</span>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">4.2% engajamento</div>
                        <div className="text-sm text-muted-foreground">892 posts</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Video className="h-4 w-4" />
                        <span>Vídeos</span>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">6.8% engajamento</div>
                        <div className="text-sm text-muted-foreground">234 posts</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <ImageIcon className="h-4 w-4" />
                        <span>Carrossel</span>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">5.1% engajamento</div>
                        <div className="text-sm text-muted-foreground">156 posts</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// Form component local para conectar instagram
function ConnectInstagramForm({ onConnect, onRefresh }: { onConnect: (token: string, bizId: string) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [token, setToken] = useState('')
  const [bizId, setBizId] = useState('')
  const [loading, setLoading] = useState(false)

  const startOAuth = () => {
    const w = 520
    const h = 720
    const left = Math.max(0, Math.floor((window.screen.width - w) / 2))
    const top = Math.max(0, Math.floor((window.screen.height - h) / 2))
    const popup = window.open('/api/instagram/oauth/start', 'instagram_oauth', `width=${w},height=${h},left=${left},top=${top}`)
    if (!popup) {
      toast.error('Pop-up bloqueado. Permita pop-ups e tente novamente.')
      return
    }

    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return
      if (ev.data?.type === 'instagram:connected' && ev.data?.ok) {
        toast.success('Conta conectada!')
        void onRefresh()
        window.removeEventListener('message', onMsg)
      }
    }
    window.addEventListener('message', onMsg)

    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer)
        window.removeEventListener('message', onMsg)
      }
    }, 500)
  }
  const handle = async () => {
    if (!token || !bizId) return
    setLoading(true)
    try {
      await onConnect(token, bizId)
      toast.success('Conta conectada!')
    } catch (e: any) {
      toast.error(e.message || 'Erro ao conectar')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Button variant="secondary" className="w-full" onClick={startOAuth}>
          Conectar com Facebook (OAuth)
        </Button>
        <p className="text-xs text-muted-foreground">
          Recomendado. Conecta via Meta e salva o token no servidor.
        </p>
      </div>
      <div className="border-t pt-4" />
      <div>
        <Label>Access Token</Label>
        <Textarea rows={3} placeholder="EAABsbCS1iHgBA..." value={token} onChange={e => setToken(e.target.value)} />
      </div>
      <div>
        <Label>Business Account ID</Label>
        <Input placeholder="1784140..." value={bizId} onChange={e => setBizId(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button disabled={loading || !token || !bizId} onClick={handle}>{loading ? 'Conectando...' : 'Conectar'}</Button>
      </div>
    </div>
  )
}
