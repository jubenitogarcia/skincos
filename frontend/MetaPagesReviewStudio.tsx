import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/alert'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { csrfHeader } from '@/csrf'
import { Input } from '@/input'
import { Label } from '@/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Separator } from '@/separator'
import { Textarea } from '@/textarea'

type ReviewStatus = {
  ok?: boolean
  configured?: boolean
  missing?: string[]
  connected?: boolean
  selectedPage?: { id?: string | null; name?: string | null; updatedAt?: string | null } | null
}

type ReviewPage = {
  id: string
  name: string | null
  pictureUrl: string | null
  tasks: string[]
}

type ReviewPost = {
  id: string
  message: string
  createdTime: string | null
  permalinkUrl: string | null
  fullPicture: string | null
  statusType: string | null
}

type PublishResponse = {
  ok?: boolean
  postId?: string
  message?: string
  imageUrl?: string | null
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { credentials: 'include', ...(init || {}) })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || data?.hint || `HTTP ${res.status}`)
  return data as T
}

export function MetaPagesReviewStudio() {
  const [status, setStatus] = useState<ReviewStatus | null>(null)
  const [pages, setPages] = useState<ReviewPage[]>([])
  const [posts, setPosts] = useState<ReviewPost[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [message, setMessage] = useState('Post de validação Meta via Orb')
  const [imageUrl, setImageUrl] = useState('')
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [lastAction, setLastAction] = useState<PublishResponse | null>(null)

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) || null,
    [pages, selectedPageId],
  )

  const refreshStatus = async () => {
    const next = await readJson<ReviewStatus>('/api/facebook-review/status')
    setStatus(next)
    if (next?.selectedPage?.id) setSelectedPageId(String(next.selectedPage.id))
    return next
  }

  const refreshPages = async () => {
    const data = await readJson<{ ok?: boolean; pages?: ReviewPage[]; selectedPageId?: string | null }>('/api/facebook-review/pages')
    const nextPages = Array.isArray(data?.pages) ? data.pages : []
    setPages(nextPages)
    if (data?.selectedPageId) {
      setSelectedPageId(String(data.selectedPageId))
    } else if (nextPages.length && !selectedPageId) {
      setSelectedPageId(nextPages[0].id)
    }
    return nextPages
  }

  const refreshPosts = async () => {
    const data = await readJson<{ ok?: boolean; posts?: ReviewPost[] }>('/api/facebook-review/posts')
    setPosts(Array.isArray(data?.posts) ? data.posts : [])
  }

  const refreshAll = async () => {
    setLoading(true)
    try {
      const nextStatus = await refreshStatus()
      if (nextStatus?.connected) {
        await refreshPages()
        await refreshPosts()
      } else {
        setPages([])
        setPosts([])
      }
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao carregar módulo de review')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshAll()
  }, [])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'facebook-review:connected' || !event.data?.ok) return
      toast.success('Conta Meta conectada com sucesso')
      void refreshAll()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const openOAuthPopup = () => {
    const width = 720
    const height = 820
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
    const popup = window.open(
      '/api/facebook-review/oauth/start',
      'facebook_review_oauth',
      `width=${width},height=${height},left=${left},top=${top}`,
    )
    if (!popup) toast.error('Habilite popups para iniciar o OAuth da Meta')
  }

  const mutate = async <T,>(action: () => Promise<T>, successMessage: string) => {
    setMutating(true)
    try {
      const result = await action()
      toast.success(successMessage)
      return result
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao executar ação')
      throw error
    } finally {
      setMutating(false)
    }
  }

  const selectPage = async (pageId: string) => {
    setSelectedPageId(pageId)
    await mutate(
      async () =>
        readJson('/api/facebook-review/select-page', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...csrfHeader() },
          body: JSON.stringify({ pageId }),
        }),
      'Página selecionada',
    )
    await refreshStatus()
    await refreshPosts()
  }

  const publishOrUpdate = async () => {
    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      toast.error('Escreva a mensagem do post')
      return
    }

    if (editingPostId) {
      await mutate(
        async () =>
          readJson('/api/facebook-review/update', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...csrfHeader() },
            body: JSON.stringify({ postId: editingPostId, message: trimmedMessage }),
          }),
        'Post atualizado',
      )
      setEditingPostId(null)
    } else {
      const result = await mutate(
        async () =>
          readJson<PublishResponse>('/api/facebook-review/publish', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...csrfHeader() },
            body: JSON.stringify({ message: trimmedMessage, imageUrl: imageUrl.trim() || undefined }),
          }),
        'Post publicado',
      )
      setLastAction(result)
    }

    setMessage('Post de validação Meta via Orb')
    setImageUrl('')
    await refreshPosts()
  }

  const startEditing = (post: ReviewPost) => {
    setEditingPostId(post.id)
    setMessage(post.message || '')
    setImageUrl('')
  }

  const removePost = async (postId: string) => {
    await mutate(
      async () =>
        readJson('/api/facebook-review/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...csrfHeader() },
          body: JSON.stringify({ postId }),
        }),
      'Post excluído',
    )
    if (editingPostId === postId) {
      setEditingPostId(null)
      setMessage('Post de validação Meta via Orb')
    }
    await refreshPosts()
  }

  const disconnect = async () => {
    await mutate(
      async () =>
        readJson('/api/facebook-review/disconnect', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...csrfHeader() },
        }),
      'Conexão removida',
    )
    setPages([])
    setPosts([])
    setSelectedPageId('')
    setEditingPostId(null)
    setLastAction(null)
    await refreshStatus()
  }

  const missing = status?.missing || []

  return (
    <div className="space-y-6 text-white">
      <Card className="border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(62,100,255,0.22),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.86))]">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">Meta Pages Review</CardTitle>
              <CardDescription className="text-slate-300">
                Superfície de review para gravar o fluxo exigido pela Meta: OAuth, seleção de página, publicação e prova do post gerenciado.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status?.connected ? 'default' : 'secondary'}>{status?.connected ? 'Conectado' : 'Desconectado'}</Badge>
              <Badge variant={status?.configured ? 'default' : 'destructive'}>
                {status?.configured ? 'Configuração pronta' : 'Configuração pendente'}
              </Badge>
            </div>
          </div>
          <div className="grid gap-2 text-sm text-slate-200 md:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">1. Login no Orb</div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">2. Conectar conta Meta via OAuth</div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">3. Escolher Página e publicar</div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">4. Mostrar a lista de posts atualizada</div>
          </div>
        </CardHeader>
      </Card>

      {!status?.configured && (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-50">
          <AlertTitle>Ambiente incompleto para review</AlertTitle>
          <AlertDescription>
            Variáveis ausentes: {missing.length ? missing.join(', ') : 'nenhuma identificada'}. Sem isso o OAuth ou o storage das credenciais não fecha de ponta a ponta.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-white/10 bg-slate-950/80">
          <CardHeader>
            <CardTitle>Conectar e selecionar Página</CardTitle>
            <CardDescription className="text-slate-400">
              O reviewer deve ver o redirecionamento para a Meta, aprovar as permissões e retornar ao Orb já com uma Página selecionável.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <Button onClick={openOAuthPopup} disabled={!status?.configured || mutating}>
                Conectar conta Meta
              </Button>
              <Button variant="outline" onClick={() => void refreshAll()} disabled={loading || mutating}>
                Atualizar
              </Button>
              <Button variant="outline" onClick={() => void disconnect()} disabled={!status?.connected || mutating}>
                Desconectar
              </Button>
            </div>

            <Separator className="bg-white/10" />

            <div className="space-y-2">
              <Label>Página conectada</Label>
              <Select value={selectedPageId || undefined} onValueChange={(value) => void selectPage(value)} disabled={!pages.length || mutating}>
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue placeholder="Escolha a Página do review" />
                </SelectTrigger>
                <SelectContent>
                  {pages.map((page) => (
                    <SelectItem key={page.id} value={page.id}>
                      {page.name || page.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPage && (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <div className="font-medium text-white">{selectedPage.name || selectedPage.id}</div>
                  <div>Permissões da página: {selectedPage.tasks.length ? selectedPage.tasks.join(', ') : 'não retornadas pela Graph API'}</div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-dashed border-cyan-400/30 bg-cyan-500/5 p-4 text-sm text-cyan-50">
              Para o vídeo: grave o clique em <strong>Conectar conta Meta</strong>, deixe a popup da Meta visível, autorize e volte ao Orb com esta tela já preenchida.
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950/80">
          <CardHeader>
            <CardTitle>Resultado esperado no vídeo</CardTitle>
            <CardDescription className="text-slate-400">
              Use esta área para fechar o roteiro com uma prova concreta do post gerenciado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-300">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="font-medium text-white">Página atual</div>
              <div>{status?.selectedPage?.name || status?.selectedPage?.id || 'Nenhuma selecionada'}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="font-medium text-white">Última ação</div>
              <div>{lastAction?.postId ? `Post ${lastAction.postId}` : 'Nenhuma publicação nesta sessão ainda'}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="font-medium text-white">Fechamento sugerido</div>
              <div>Mostrar a lista abaixo já atualizada ou abrir o permalink do post em uma nova aba para provar a publicação.</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-white/10 bg-slate-950/80">
          <CardHeader>
            <CardTitle>{editingPostId ? 'Editar post' : 'Criar post'}</CardTitle>
            <CardDescription className="text-slate-400">
              O fluxo mínimo para `pages_manage_posts` fica completo com criar, atualizar e excluir um post diretamente pela interface do Orb.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="meta-review-message">Texto do post</Label>
              <Textarea
                id="meta-review-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                className="border-white/10 bg-white/5 text-white"
                placeholder="Escreva a mensagem que será enviada para a Página"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-review-image">Imagem opcional (URL https)</Label>
              <Input
                id="meta-review-image"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                className="border-white/10 bg-white/5 text-white"
                placeholder="https://..."
                disabled={!!editingPostId}
              />
              <p className="text-xs text-slate-500">
                Para o review eu sugiro gravar primeiro com post textual, porque a edição e a exclusão ficam mais previsíveis.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void publishOrUpdate()} disabled={!status?.connected || !selectedPageId || mutating || loading}>
                {editingPostId ? 'Salvar edição' : 'Publicar'}
              </Button>
              {editingPostId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingPostId(null)
                    setMessage('Post de validação Meta via Orb')
                    setImageUrl('')
                  }}
                  disabled={mutating}
                >
                  Cancelar edição
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950/80">
          <CardHeader>
            <CardTitle>Posts recentes da Página</CardTitle>
            <CardDescription className="text-slate-400">
              Esta lista é a prova operacional dentro do app. Se quiser reforçar o vídeo, abra o permalink do item mais recente depois de publicar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">Carregando estado do review...</div>
            ) : posts.length ? (
              posts.map((post) => (
                <div key={post.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-white">{post.message || 'Sem mensagem textual'}</div>
                      <div className="text-xs text-slate-400">{post.createdTime || 'Data não informada'}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => startEditing(post)} disabled={mutating}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void removePost(post.id)} disabled={mutating}>
                        Excluir
                      </Button>
                      {post.permalinkUrl && (
                        <Button variant="outline" size="sm" onClick={() => window.open(post.permalinkUrl || '', '_blank', 'noopener,noreferrer')}>
                          Abrir no Facebook
                        </Button>
                      )}
                    </div>
                  </div>
                  {post.fullPicture && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                      <img src={post.fullPicture} alt="" className="max-h-72 w-full object-cover" />
                    </div>
                  )}
                  <div className="mt-3 text-xs text-slate-500">ID do post: {post.id}</div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-slate-400">
                Nenhum post carregado ainda. Conecte a Meta, selecione a Página e publique um post para gerar a prova visual.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
