import React from 'react'
import { toast } from 'sonner'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { getCsrfToken } from '@/csrf'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { LoadingPercentText } from '@/LoadingPattern'

type Invite = {
  id: string
  tokenHint?: string
  role?: string
  allowedUnits?: string[]
  allowedModules?: string[]
  maxUses?: number
  usesCount?: number
  expiresAt?: string | null
  revoked?: boolean
  note?: string
  createdBy?: string
  createdAt?: string
}

type InsumosMeResponse = {
  success?: boolean
  user?: { username?: string; displayName?: string; email?: string; role?: string; allowedUnits?: string[]; allowedModules?: string[] }
  csrfToken?: string
}

type InsumosHealth = {
  ok?: boolean
  unidades?: string[]
}

type ApiError = { error?: string; message?: string; code?: string }

const INSUMOS_UNIT_KEY = 'skincos.insumos.unidade.v1'

function fmtDate(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return v
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d)
  } catch {
    return d.toISOString()
  }
}

async function insumosApiJson<T>(
  path: string,
  opts: {
    method?: string
    body?: unknown
    csrfToken?: string | null
    retryOnCsrf?: () => Promise<string | null>
  } = {}
): Promise<T> {
  const method = (opts.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const effectiveCsrfToken = getCsrfToken() || opts.csrfToken || null
  if (effectiveCsrfToken) headers['x-csrf-token'] = effectiveCsrfToken

  let url = ''
  if (path.startsWith('/api/')) {
    url = path
  } else if (path === '/health' || path.startsWith('/health/')) {
    url = `/api/insumos${path.startsWith('/') ? '' : '/'}${path}`
  } else if (path === '/auth' || path.startsWith('/auth/')) {
    const rest = path.slice('/auth'.length) || '/'
    url = `/api/auth${rest.startsWith('/') ? '' : '/'}${rest}`
  } else {
    url = `/api/crm${path.startsWith('/') ? '' : '/'}${path}`
  }
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (res.ok) return json as T

  const err = (json || {}) as ApiError
  const code = String(err.code || err.error || '')
  if (res.status === 403 && code.toUpperCase() === 'CSRF_INVALID' && opts.retryOnCsrf) {
    const next = await opts.retryOnCsrf()
    if (next) return insumosApiJson<T>(path, { ...opts, csrfToken: next, retryOnCsrf: undefined })
  }

  throw new Error(err.error || err.message || `HTTP ${res.status}`)
}

export function UsersModule() {
  const [health, setHealth] = React.useState<InsumosHealth | null>(null)
  const [me, setMe] = React.useState<InsumosMeResponse | null>(null)
  const [csrfToken, setCsrfToken] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  const [unidade, setUnidade] = React.useState<string>(() => {
    try {
      return window.localStorage.getItem(INSUMOS_UNIT_KEY) || 'novo-hamburgo'
    } catch {
      return 'novo-hamburgo'
    }
  })

  const isAuthed = !!me?.user?.username
  const role = String(me?.user?.role || '').trim().toUpperCase()
  const canManageInvites = role === 'GESTOR'
  const inviteRoleOptions = role === 'GESTOR'
    ? ['INJETOR', 'GERENTE', 'GESTOR']
    : ['INJETOR', 'GERENTE']

  const allowedUnits = Array.isArray(me?.user?.allowedUnits) ? me!.user!.allowedUnits!.filter(Boolean) : []

  const unidadeOptions = React.useMemo(() => {
    const fromHealth = Array.isArray(health?.unidades) ? health!.unidades!.filter(Boolean) : []
    const base = fromHealth.length ? fromHealth : ['novo-hamburgo', 'barra-shopping-sul']
    const filtered = allowedUnits.length ? base.filter((u) => allowedUnits.includes(u)) : base
    return filtered.length ? filtered : base
  }, [allowedUnits.join('|'), Array.isArray(health?.unidades) ? health!.unidades!.join('|') : ''])

  React.useEffect(() => {
    if (!unidadeOptions.length) return
    if (unidadeOptions.includes(unidade)) return
    const next = unidadeOptions[0]
    setUnidade(next)
    try { window.localStorage.setItem(INSUMOS_UNIT_KEY, next) } catch { /* ignore */ }
  }, [unidade, unidadeOptions.join('|')])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [h, m] = await Promise.all([
        insumosApiJson<InsumosHealth>('/health').catch(() => null),
        insumosApiJson<InsumosMeResponse>('/auth/me').catch(() => null)
      ])
      setHealth(h)
      setMe(m)
      setCsrfToken(m?.csrfToken || null)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const refreshCsrf = React.useCallback(async () => {
    try {
      const out = await insumosApiJson<InsumosMeResponse>('/auth/refresh', { method: 'POST', csrfToken })
      setMe(out || null)
      setCsrfToken(out?.csrfToken || null)
      return out?.csrfToken || null
    } catch {
      setCsrfToken(null)
      return null
    }
  }, [csrfToken])

  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [invitesLoading, setInvitesLoading] = React.useState(false)
  const [invites, setInvites] = React.useState<Invite[]>([])
  const [inviteRole, setInviteRole] = React.useState<string>('INJETOR')
  const [inviteMaxUses, setInviteMaxUses] = React.useState<string>('1')
  const [inviteExpiresInDays, setInviteExpiresInDays] = React.useState<string>('30')
  const [inviteAllowedUnits, setInviteAllowedUnits] = React.useState<string>('')
  const [inviteAllowedModules, setInviteAllowedModules] = React.useState<string>('')
  const [inviteNote, setInviteNote] = React.useState<string>('')
  const [inviteCreateLoading, setInviteCreateLoading] = React.useState(false)
  const [inviteTokenOnce, setInviteTokenOnce] = React.useState<string | null>(null)
  const [inviteTokenHint, setInviteTokenHint] = React.useState<string | null>(null)

  const parseUnitsInput = React.useCallback((raw: string) => {
    const s = String(raw || '').trim()
    if (!s) return []
    return s
      .split(/[,;|]/g)
      .map((x) => String(x || '').trim())
      .filter(Boolean)
  }, [])

  const loadInvites = React.useCallback(async () => {
    if (!isAuthed || !canManageInvites) return
    setInvitesLoading(true)
    try {
      const out = await insumosApiJson<{ success?: boolean; data?: Invite[] }>(
        `/admin/invites?${new URLSearchParams({ unidade, limit: '50' }).toString()}`
      )
      setInvites(Array.isArray(out?.data) ? out!.data! : [])
    } catch {
      setInvites([])
    } finally {
      setInvitesLoading(false)
    }
  }, [canManageInvites, isAuthed, unidade])

  React.useEffect(() => {
    if (!inviteOpen) return
    setInviteTokenOnce(null)
    setInviteTokenHint(null)
    setInviteNote('')
    setInviteRole((cur) => (inviteRoleOptions.includes(cur) ? cur : 'INJETOR'))
    setInviteAllowedUnits((cur) => {
      if (cur.trim()) return cur
      return allowedUnits.length ? allowedUnits.join(',') : ''
    })
    setInviteAllowedModules((cur) => (cur.trim() ? cur : ''))
    void loadInvites()
  }, [allowedUnits.join('|'), inviteOpen, inviteRoleOptions.join('|'), loadInvites])

  const createInvite = React.useCallback(async () => {
    if (!isAuthed || !canManageInvites) return
    setInviteCreateLoading(true)
    setInviteTokenOnce(null)
    setInviteTokenHint(null)
    try {
      const maxUses = Math.max(1, Math.min(50, parseInt(inviteMaxUses, 10) || 1))
      const expiresInDays = Math.max(1, Math.min(365, parseInt(inviteExpiresInDays, 10) || 30))
      const allowed = parseUnitsInput(inviteAllowedUnits)
      const allowedModules = parseUnitsInput(inviteAllowedModules)
      const out = await insumosApiJson<{ success?: boolean; data?: Invite; token?: string }>(
        `/admin/invites?${new URLSearchParams({ unidade }).toString()}`,
        {
          method: 'POST',
          csrfToken,
          retryOnCsrf: refreshCsrf,
          body: { role: inviteRole, maxUses, expiresInDays, allowedUnits: allowed, allowedModules, note: inviteNote }
        }
      )
      const token = out?.token ? String(out.token) : null
      const hint = (out as any)?.data?.tokenHint ? String((out as any).data.tokenHint) : null
      if (token) {
        setInviteTokenOnce(token)
        setInviteTokenHint(hint)
        toast.success('Token gerado')
        void loadInvites()
      } else {
        toast.error('Não foi possível gerar o token.')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao gerar token.')
    } finally {
      setInviteCreateLoading(false)
    }
  }, [
    canManageInvites,
    csrfToken,
    inviteAllowedModules,
    inviteAllowedUnits,
    inviteExpiresInDays,
    inviteMaxUses,
    inviteNote,
    inviteRole,
    isAuthed,
    loadInvites,
    parseUnitsInput,
    refreshCsrf,
    unidade
  ])

  const revokeInvite = React.useCallback(async (id: string) => {
    if (!isAuthed || !canManageInvites) return
    if (!window.confirm('Revogar este token?')) return
    try {
      await insumosApiJson(
        `/admin/invites/${encodeURIComponent(id)}/revoke?${new URLSearchParams({ unidade }).toString()}`,
        { method: 'POST', csrfToken, retryOnCsrf: refreshCsrf }
      )
      toast.success('Token revogado')
      void loadInvites()
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao revogar token.')
    }
  }, [canManageInvites, csrfToken, isAuthed, loadInvites, refreshCsrf, unidade])

  return (
    <div className="p-6 space-y-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-white text-lg font-semibold">Usuários</div>
            <div className="text-sm text-blue-100/70">Gestão de acessos, convites e permissões.</div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={unidade} onValueChange={(v) => {
              setUnidade(v)
              try { window.localStorage.setItem(INSUMOS_UNIT_KEY, v) } catch { /* ignore */ }
            }}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {unidadeOptions.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? (
                <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
              ) : (
                'Recarregar'
              )}
            </Button>
            <Button variant="outline" onClick={() => setInviteOpen(true)} disabled={!isAuthed || !canManageInvites}>
              Convidar usuário
            </Button>
          </div>
        </div>

        <Card className="bg-black/20 border border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-sm">Convites</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-blue-100/70">
            Esta aba está em evolução. Por enquanto, ela concentra a geração de tokens de acesso para criação de conta.
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open)
          if (!open) {
            setInviteTokenOnce(null)
            setInviteTokenHint(null)
          }
        }}
      >
        <DialogContent className="max-w-xl dark bg-corporate-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Convites de acesso</DialogTitle>
            <DialogDescription className="text-blue-100/70">
              Gere um token para criação de conta (por segurança, o token é mostrado apenas uma vez).
            </DialogDescription>
          </DialogHeader>

          {!canManageInvites ? (
            <div className="text-sm text-blue-100/80">Sem permissão para gerar tokens.</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Hierarquia</div>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {inviteRoleOptions.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Usos</div>
                  <Input value={inviteMaxUses} onChange={(e) => setInviteMaxUses(e.target.value)} type="number" min={1} max={50} />
                </div>
              </div>

	              <div className="grid grid-cols-2 gap-2">
	                <div>
	                  <div className="text-xs text-blue-200/70 mb-1">Expira em (dias)</div>
	                  <Input value={inviteExpiresInDays} onChange={(e) => setInviteExpiresInDays(e.target.value)} type="number" min={1} max={365} />
	                </div>
	                <div>
	                  <div className="text-xs text-blue-200/70 mb-1">Unidades (opcional)</div>
	                  <Input
	                    value={inviteAllowedUnits}
	                    onChange={(e) => setInviteAllowedUnits(e.target.value)}
	                    placeholder="ex: novo-hamburgo, barra-shopping-sul"
	                  />
	                </div>
	              </div>

	              <div>
	                <div className="text-xs text-blue-200/70 mb-1">Módulos (opcional)</div>
	                <Input
	                  value={inviteAllowedModules}
	                  onChange={(e) => setInviteAllowedModules(e.target.value)}
	                  placeholder="vazio = todos • ex: insumos, status, users"
	                />
	              </div>

	              <div>
	                <div className="text-xs text-blue-200/70 mb-1">Observação (opcional)</div>
	                <Input value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} placeholder="ex: Equipe recepção" />
	              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  className="!bg-blue-600 hover:!bg-blue-700 !text-white"
                  onClick={() => void createInvite()}
                  disabled={!isAuthed || inviteCreateLoading}
                >
                  {inviteCreateLoading ? 'Gerando…' : 'Gerar token'}
                </Button>
                <Button variant="secondary" onClick={() => void loadInvites()} disabled={!isAuthed || invitesLoading}>
                  {invitesLoading ? 'Atualizando…' : 'Atualizar'}
                </Button>
              </div>

              {inviteTokenOnce ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                  <div className="text-sm text-blue-50 font-semibold">
                    Token gerado {inviteTokenHint ? <span className="text-blue-200/70 font-normal">({inviteTokenHint})</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input value={inviteTokenOnce} readOnly className="font-mono" />
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(inviteTokenOnce)
                          toast.success('Copiado.')
                        } catch (e: any) {
                          toast.error(e?.message || 'Não foi possível copiar.')
                        }
                      }}
                    >
                      Copiar
                    </Button>
                  </div>
                  <div className="text-xs text-blue-200/60">
                    Envie este token ao usuário. Ele deve usar na tela “Criar Conta”.
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-blue-50 font-semibold">Tokens recentes</div>
                  <div className="text-xs text-blue-200/60">{invites.length} itens</div>
                </div>
                <div className="mt-2 overflow-auto max-h-[40vh] rounded-lg border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="bg-black/30 text-blue-100/80">
                      <tr>
                        <th className="text-left p-2">Token</th>
                        <th className="text-left p-2">Role</th>
                        <th className="text-left p-2">Usos</th>
                        <th className="text-left p-2">Expira</th>
                        <th className="text-right p-2">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {invites.map((it) => (
                        <tr key={it.id} className="hover:bg-white/5">
                          <td className="p-2 font-mono text-blue-50">{it.tokenHint || it.id.slice(0, 8)}</td>
                          <td className="p-2 text-blue-100/80">{String(it.role || '')}</td>
                          <td className="p-2 text-blue-100/70">
                            {(Number(it.usesCount) || 0)}/{(Number(it.maxUses) || 1)}
                          </td>
                          <td className="p-2 text-blue-100/70">{it.expiresAt ? fmtDate(it.expiresAt) : '-'}</td>
                          <td className="p-2 text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void revokeInvite(it.id)}
                              disabled={!!it.revoked}
                            >
                              Revogar
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {!invites.length ? (
                        <tr>
                          <td className="p-2 text-blue-100/70" colSpan={5}>
                            {invitesLoading ? (
                              <LoadingPercentText label="Carregando" showPercent={false} />
                            ) : (
                              'Sem tokens.'
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
