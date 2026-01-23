import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Input } from '@/input'
import { Textarea } from '@/textarea'
import { Label } from '@/label'
import { Badge } from '@/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { toast } from 'sonner'
import { InstagramStudioPro } from '@/InstagramStudioPro'
import { ThreadsStudio } from '@/ThreadsStudio'

type SocialPlatform = 'instagram' | 'facebook' | 'threads'

type QueueGroup = {
  group: {
    dateKey: string
    groupKey: string
    scheduledAt: string
    unitKeys: string[]
    platforms: SocialPlatform[]
    captions?: Partial<Record<SocialPlatform, string>>
  }
  assetsCount: number
  published: Record<string, Record<SocialPlatform, boolean>>
}

const PLATFORM_ORDER: SocialPlatform[] = ['instagram', 'facebook', 'threads']

export function SocialNetworksStudio() {
  const [tab, setTab] = useState<'planner' | 'instagram' | 'facebook' | 'threads'>('planner')

  const [unitKey, setUnitKey] = useState('BSS')
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['instagram', 'facebook', 'threads'])
  const [scheduledAtLocal, setScheduledAtLocal] = useState<string>('')
  const [files, setFiles] = useState<File[]>([])
  const [captionInstagram, setCaptionInstagram] = useState('')
  const [captionFacebook, setCaptionFacebook] = useState('')
  const [captionThreads, setCaptionThreads] = useState('')
  const [uploading, setUploading] = useState(false)

  const [dateKey, setDateKey] = useState(() => {
    const d = new Date()
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(-2)
    return `${dd}${mm}${yy}`
  })
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueGroups, setQueueGroups] = useState<QueueGroup[]>([])

  const [adminToken, setAdminToken] = useState<string>(() => {
    try {
      return localStorage.getItem('social.adminToken') || ''
    } catch {
      return ''
    }
  })
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accounts, setAccounts] = useState<Array<{ unitKey: string; platform: SocialPlatform; accountId: string; apiVersion?: string }>>([])

  const [accountUnit, setAccountUnit] = useState('BSS')
  const [accountPlatform, setAccountPlatform] = useState<SocialPlatform>('instagram')
  const [accountId, setAccountId] = useState('')
  const [accountToken, setAccountToken] = useState('')
  const [accountApiVersion, setAccountApiVersion] = useState('v20.0')

  const unitOptions = useMemo(() => ['BSS', 'NH'], [])

  const refreshQueue = async (dk = dateKey) => {
    setQueueLoading(true)
    try {
      const res = await fetch(`/api/social/queue/list?dateKey=${encodeURIComponent(dk)}`, { credentials: 'include' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setQueueGroups((data?.groups || []) as QueueGroup[])
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao carregar fila')
      setQueueGroups([])
    } finally {
      setQueueLoading(false)
    }
  }

  const refreshAccounts = async () => {
    if (!adminToken.trim()) return
    setAccountsLoading(true)
    try {
      const res = await fetch('/api/social/admin/accounts', {
        credentials: 'include',
        headers: { 'x-social-admin-token': adminToken.trim() },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setAccounts((data?.accounts || []) as any)
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao carregar contas')
      setAccounts([])
    } finally {
      setAccountsLoading(false)
    }
  }

  useEffect(() => {
    if (tab !== 'planner') return
    void refreshQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const togglePlatform = (p: SocialPlatform) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  const uploadToQueue = async () => {
    if (!files.length) return toast.error('Selecione pelo menos 1 arquivo.')
    if (!platforms.length) return toast.error('Selecione pelo menos 1 rede.')

    setUploading(true)
    try {
      const fd = new FormData()
      fd.set('unitKey', unitKey)
      fd.set('platforms', platforms.join(','))
      if (scheduledAtLocal) fd.set('scheduledAt', new Date(scheduledAtLocal).toISOString())
      if (captionInstagram.trim()) fd.set('captionInstagram', captionInstagram.trim())
      if (captionFacebook.trim()) fd.set('captionFacebook', captionFacebook.trim())
      if (captionThreads.trim()) fd.set('captionThreads', captionThreads.trim())
      for (const f of files) fd.append('files', f)

      const res = await fetch('/api/social/queue/upload', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      toast.success(`Enfileirado: ${data.groupKey}`)
      setFiles([])
      await refreshQueue(data.dateKey || dateKey)
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao enfileirar')
    } finally {
      setUploading(false)
    }
  }

  const saveAdminToken = (v: string) => {
    setAdminToken(v)
    try {
      localStorage.setItem('social.adminToken', v)
    } catch {}
  }

  const saveAccount = async () => {
    if (!adminToken.trim()) return toast.error('Informe o token admin.')
    if (!accountUnit.trim() || !accountPlatform || !accountId.trim() || !accountToken.trim()) {
      return toast.error('Preencha unit/platform/accountId/accessToken.')
    }
    try {
      const res = await fetch('/api/social/admin/accounts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-social-admin-token': adminToken.trim() },
        body: JSON.stringify({
          unitKey: accountUnit.trim(),
          platform: accountPlatform,
          accountId: accountId.trim(),
          accessToken: accountToken.trim(),
          apiVersion: accountApiVersion.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      toast.success('Conta salva')
      setAccountId('')
      setAccountToken('')
      await refreshAccounts()
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao salvar conta')
    }
  }

  const publishNow = async (g: QueueGroup) => {
    if (!adminToken.trim()) return toast.error('Informe o token admin para publicar.')
    try {
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-social-admin-token': adminToken.trim() },
        body: JSON.stringify({ dateKey: g.group.dateKey, groupKey: g.group.groupKey }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      toast.success('Publish executado')
      await refreshQueue(g.group.dateKey)
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao publicar')
    }
  }

  const platformsLabel = (ps: SocialPlatform[]) => PLATFORM_ORDER.filter((p) => ps.includes(p)).join(', ')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-white">Redes Sociais</h2>
        <p className="text-blue-300/80 text-sm">Instagram · Facebook · Threads — fila em R2 + publicação (Cloudflare)</p>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)} className="space-y-6">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <TabsTrigger value="planner">Planner</TabsTrigger>
          <TabsTrigger value="instagram">Instagram</TabsTrigger>
          <TabsTrigger value="facebook">Facebook</TabsTrigger>
          <TabsTrigger value="threads">Threads</TabsTrigger>
        </TabsList>

        <TabsContent value="planner" className="space-y-6">
          <Card className="glass-morphism border-white/20">
            <CardHeader>
              <CardTitle className="text-white">Admin</CardTitle>
              <CardDescription className="text-blue-200/70">
                Token admin (header <span className="font-mono">x-social-admin-token</span>) para configurar contas e publicar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2">
                <Label className="text-blue-200">SOCIAL_ADMIN_TOKEN</Label>
                <Input
                  value={adminToken}
                  onChange={(e) => saveAdminToken(e.target.value)}
                  placeholder="Cole aqui"
                  className="bg-white/[0.06] border-white/20 text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => refreshAccounts()} disabled={accountsLoading || !adminToken.trim()} className="bg-white/[0.06] border-white/20 text-white">
                  {accountsLoading ? 'Carregando…' : 'Carregar contas'}
                </Button>
                <Badge variant="outline" className="border-white/20 text-white">
                  {accounts.length} conta(s)
                </Badge>
              </div>

              <div className="grid md:grid-cols-5 gap-3">
                <div className="space-y-2">
                  <Label className="text-blue-200">Unidade</Label>
                  <Select value={accountUnit} onValueChange={(v) => setAccountUnit(v)}>
                    <SelectTrigger className="bg-white/[0.06] border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {unitOptions.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-blue-200">Plataforma</Label>
                  <Select value={accountPlatform} onValueChange={(v: any) => setAccountPlatform(v)}>
                    <SelectTrigger className="bg-white/[0.06] border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORM_ORDER.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-blue-200">Account ID</Label>
                  <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-blue-200">API Version</Label>
                  <Input
                    value={accountApiVersion}
                    onChange={(e) => setAccountApiVersion(e.target.value)}
                    placeholder="v20.0 / v1.0"
                    className="bg-white/[0.06] border-white/20 text-white"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-blue-200">Access Token</Label>
                <Input value={accountToken} onChange={(e) => setAccountToken(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => saveAccount()} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                  Salvar conta
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-morphism border-white/20">
            <CardHeader>
              <CardTitle className="text-white">Enfileirar mídia (R2)</CardTitle>
              <CardDescription className="text-blue-200/70">Arquivos viram URLs públicas em /social-media para o Graph puxar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-blue-200">Unidade</Label>
                  <Select value={unitKey} onValueChange={(v) => setUnitKey(v)}>
                    <SelectTrigger className="bg-white/[0.06] border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {unitOptions.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-blue-200">Agendar (opcional)</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAtLocal}
                    onChange={(e) => setScheduledAtLocal(e.target.value)}
                    className="bg-white/[0.06] border-white/20 text-white"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                {PLATFORM_ORDER.map((p) => (
                  <Button
                    key={p}
                    variant={platforms.includes(p) ? 'default' : 'outline'}
                    onClick={() => togglePlatform(p)}
                    className={platforms.includes(p) ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-white/[0.06] border-white/20 text-white'}
                  >
                    {p}
                  </Button>
                ))}
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-blue-200">Legenda Instagram</Label>
                  <Textarea value={captionInstagram} onChange={(e) => setCaptionInstagram(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-blue-200">Legenda Facebook</Label>
                  <Textarea value={captionFacebook} onChange={(e) => setCaptionFacebook(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-blue-200">Legenda Threads</Label>
                  <Textarea value={captionThreads} onChange={(e) => setCaptionThreads(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-blue-200">Arquivos</Label>
                <Input
                  type="file"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  className="bg-white/[0.06] border-white/20 text-white"
                />
                <div className="text-xs text-blue-200/70">{files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Nenhum arquivo selecionado'}</div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={() => uploadToQueue()} disabled={uploading} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                  {uploading ? 'Enfileirando…' : 'Enfileirar'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-morphism border-white/20">
            <CardHeader>
              <CardTitle className="text-white">Fila</CardTitle>
              <CardDescription className="text-blue-200/70">Lista grupos por dia (ddMMyy). Publicação manual aqui ou automática via Worker cron.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-2">
                  <Label className="text-blue-200">dateKey</Label>
                  <Input value={dateKey} onChange={(e) => setDateKey(e.target.value)} placeholder="ddMMyy" className="bg-white/[0.06] border-white/20 text-white w-40" />
                </div>
                <Button variant="outline" onClick={() => refreshQueue()} disabled={queueLoading} className="bg-white/[0.06] border-white/20 text-white">
                  {queueLoading ? 'Carregando…' : 'Carregar'}
                </Button>
                <Badge variant="outline" className="border-white/20 text-white">
                  {queueGroups.length} grupo(s)
                </Badge>
              </div>

              <div className="space-y-2">
                {queueGroups.map((g) => (
                  <div key={`${g.group.dateKey}:${g.group.groupKey}`} className="rounded-lg border border-white/10 bg-white/[0.04] p-3 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-white">
                        <span className="font-mono">{g.group.groupKey}</span> · {g.assetsCount} mídia(s) ·{' '}
                        <span className="text-blue-200/80">{platformsLabel(g.group.platforms || [])}</span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => publishNow(g)}
                        disabled={!adminToken.trim()}
                        className="bg-blue-600 hover:bg-blue-500 text-white"
                      >
                        Publicar agora
                      </Button>
                    </div>
                    <div className="text-xs text-blue-200/70">scheduledAt: {g.group.scheduledAt}</div>
                    <div className="flex flex-wrap gap-2">
                      {(g.group.unitKeys || []).map((u) => (
                        <Badge key={u} variant="outline" className="border-white/20 text-white">
                          {u}:{' '}
                          {PLATFORM_ORDER.filter((p) => (g.group.platforms || []).includes(p))
                            .map((p) => `${p}${g.published?.[u]?.[p] ? '✅' : '⏳'}`)
                            .join(' · ')}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
                {!queueGroups.length ? <div className="text-sm text-blue-200/70">Nenhum grupo encontrado.</div> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="instagram" className="space-y-6">
          <InstagramStudioPro />
        </TabsContent>

        <TabsContent value="facebook" className="space-y-6">
          <Card className="glass-morphism border-white/20">
            <CardHeader>
              <CardTitle className="text-white">Facebook</CardTitle>
              <CardDescription className="text-blue-200/70">
                Publicação via Planner. (UI de insights/engajamento pode ser adicionada depois.)
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-blue-200/70">Use o Planner para enfileirar e publicar.</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="threads" className="space-y-6">
          <ThreadsStudio />
        </TabsContent>
      </Tabs>
    </div>
  )
}

