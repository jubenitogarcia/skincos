import React from 'react'
import { toast } from 'sonner'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { getCsrfToken } from '@/csrf'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'

type Me = { success?: boolean; user?: { username?: string; role?: string; allowedUnits?: string[] }; csrfToken?: string }
type Onboarding = { id: string; fullName: string; corporateEmail: string; profile: string; jobTitle: string; department: string; units: string[]; accountStatus: string; createdAt?: string }
type ApiError = { error?: string; message?: string; code?: string }

const unitLabels: Record<string, string> = { 'novo-hamburgo': 'Novo Hamburgo', 'barra-shopping-sul': 'Barra Shopping Sul' }
const titleOptions = ['Gestor', 'Gerente', 'Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor']
const creatableTitlesByRole: Record<string, string[]> = {
  ADMIN: titleOptions,
  GESTOR: ['Gerente', 'Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor'],
  GERENTE: ['Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor'],
  SUPERVISOR: ['Responsável Técnico', 'Injetor', 'Consultor'],
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; csrf?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const csrf = getCsrfToken() || opts.csrf
  if (csrf) headers['x-csrf-token'] = csrf
  const target = path.startsWith('/auth/') ? `/api/auth${path.slice('/auth'.length)}` : `/api/crm${path}`
  const res = await fetch(target, { method: opts.method || 'GET', headers, credentials: 'include', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  const payload = await res.json().catch(() => ({})) as T & ApiError
  if (!res.ok) throw new Error(payload.error || payload.message || `HTTP ${res.status}`)
  return payload
}

const initialForm = { fullName: '', corporateEmail: '', personalEmail: '', mobilePhone: '', department: '', jobTitle: 'Consultor', units: [] as string[] }

export function UsersModule() {
  const [me, setMe] = React.useState<Me | null>(null)
  const [rows, setRows] = React.useState<Onboarding[]>([])
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState(initialForm)

  const role = String(me?.user?.role || '').toUpperCase()
  const actorUnits = Array.isArray(me?.user?.allowedUnits) ? me!.user!.allowedUnits!.filter(Boolean) : []
  const canManage = ['ADMIN', 'GESTOR', 'GERENTE', 'SUPERVISOR'].includes(role) && (role === 'ADMIN' || actorUnits.length > 0)
  const selectableUnits = role === 'ADMIN' ? Object.keys(unitLabels) : actorUnits
  const selectableTitles = creatableTitlesByRole[role] || []

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const auth = await api<Me>('/auth/me').catch(() => null)
      setMe(auth)
      if (auth?.user?.username) {
        const result = await api<{ success?: boolean; data?: Onboarding[] }>('/admin/onboarding', { csrf: auth.csrfToken }).catch(() => null)
        setRows(Array.isArray(result?.data) ? result!.data! : [])
      }
    } finally { setLoading(false) }
  }, [])
  React.useEffect(() => { void load() }, [load])

  const toggleUnit = (unit: string) => setForm((current) => ({ ...current, units: current.units.includes(unit) ? current.units.filter((item) => item !== unit) : [...current.units, unit] }))
  const submit = async () => {
    if (!canManage) return
    if (!form.fullName || !form.corporateEmail || !form.personalEmail || !form.mobilePhone || !form.department || !form.units.length) {
      toast.error('Preencha todos os campos e selecione ao menos uma unidade.')
      return
    }
    setSaving(true)
    try {
      const result = await api<{ data?: Onboarding }>('/admin/onboarding', { method: 'POST', csrf: me?.csrfToken, body: form })
      const pending = result.data?.accountStatus === 'PENDING_ACCESS'
      toast.success(pending ? 'Funcionário salvo aguardando configuração de acesso.' : 'Cadastro criado e convite enviado ao e-mail pessoal.')
      setForm(initialForm); setOpen(false); await load()
    } catch (error: any) { toast.error(error?.message || 'Não foi possível concluir o cadastro.') } finally { setSaving(false) }
  }

  return <div className="p-6 space-y-6"><div className="max-w-6xl mx-auto space-y-4">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h1 className="text-lg font-semibold text-white">Usuários</h1><p className="text-sm text-blue-100/70">Cadastro hierárquico com escopos e módulos derivados no servidor.</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => void load()} disabled={loading}>Recarregar</Button><Button variant="outline" onClick={() => { setForm((current) => ({ ...current, jobTitle: creatableTitlesByRole[role]?.includes(current.jobTitle) ? current.jobTitle : (creatableTitlesByRole[role]?.[0] || ''), units: selectableUnits.length === 1 ? selectableUnits : [] })); setOpen(true) }} disabled={!canManage}>Cadastrar funcionário</Button></div></div>
    <Card className="bg-black/20 border border-white/10"><CardHeader><CardTitle className="text-white text-sm">Cadastros recentes</CardTitle></CardHeader><CardContent><div className="overflow-auto rounded-lg border border-white/10"><table className="min-w-full text-sm"><thead className="bg-black/30 text-blue-100/80"><tr><th className="p-2 text-left">Nome</th><th className="p-2 text-left">Cargo</th><th className="p-2 text-left">Departamento</th><th className="p-2 text-left">Unidades</th><th className="p-2 text-left">Conta</th></tr></thead><tbody className="divide-y divide-white/5 text-blue-50">{rows.map((row) => <tr key={row.id}><td className="p-2">{row.fullName}</td><td className="p-2">{row.jobTitle}</td><td className="p-2">{row.department}</td><td className="p-2">{row.units.map((unit) => unitLabels[unit] || unit).join(', ')}</td><td className="p-2">{row.accountStatus}</td></tr>)}{!rows.length && <tr><td className="p-3 text-blue-100/70" colSpan={5}>{loading ? 'Carregando…' : 'Nenhum cadastro recente.'}</td></tr>}</tbody></table></div></CardContent></Card>
  </div>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-2xl dark bg-corporate-900 border-white/10 text-white"><DialogHeader><DialogTitle>Cadastro de funcionário</DialogTitle><DialogDescription className="text-blue-100/70">O e-mail corporativo será o login. O e-mail pessoal receberá o convite e a recuperação de senha.</DialogDescription></DialogHeader><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Nome completo<Input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label><label className="text-sm">Celular<Input value={form.mobilePhone} onChange={(event) => setForm({ ...form, mobilePhone: event.target.value })} inputMode="tel" /></label><label className="text-sm">E-mail corporativo<Input type="email" value={form.corporateEmail} onChange={(event) => setForm({ ...form, corporateEmail: event.target.value })} /></label><label className="text-sm">E-mail pessoal<Input type="email" value={form.personalEmail} onChange={(event) => setForm({ ...form, personalEmail: event.target.value })} /></label><label className="text-sm">Departamento<Input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label><label className="text-sm">Cargo<Select value={form.jobTitle} onValueChange={(jobTitle) => setForm({ ...form, jobTitle })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{selectableTitles.map((title) => <SelectItem value={title} key={title}>{title}</SelectItem>)}</SelectContent></Select></label></div><div><div className="mb-2 text-sm">Unidades</div><div className="flex flex-wrap gap-2">{selectableUnits.map((unit) => <Button key={unit} type="button" variant={form.units.includes(unit) ? 'default' : 'outline'} onClick={() => toggleUnit(unit)}>{unitLabels[unit] || unit}</Button>)}</div></div><p className="text-xs text-blue-100/65">Coordenador e Injetor ficam pendentes de política de acesso; nenhum convite ou acesso é liberado automaticamente.</p><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar'}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
