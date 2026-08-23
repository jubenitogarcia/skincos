import React from 'react'
import { toast } from 'sonner'
import { addEscalaProfessional, updateEscalaProfessional } from '@/escalaApi'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { getCsrfToken } from '@/csrf'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { buildCorporateEmail, suggestUsername, type UnifiedTeamConfig, type UnifiedTeamMember } from '@/teamApi'

type Me = { success?: boolean; user?: { username?: string; role?: string; allowedUnits?: string[] }; csrfToken?: string }
type Onboarding = { id: string; fullName: string; username?: string | null; corporateEmail: string; workforceEmployeeId?: string | null; profile: string; jobTitle: string; department: string; units: string[]; accountStatus: string; createdAt?: string; updatedAt?: string }
type ApiError = { error?: string; message?: string; code?: string }
type RequestOptions = { method?: string; body?: unknown; csrf?: string | null; headers?: Record<string, string> }

class RequestError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RequestError'
    this.code = code
  }
}

const unitLabels: Record<string, string> = { 'novo-hamburgo': 'Novo Hamburgo', 'barra-shopping-sul': 'Barra Shopping Sul' }
const titleOptions = ['Gestor', 'Gerente', 'Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor']
const creatableTitlesByRole: Record<string, string[]> = {
  ADMIN: titleOptions,
  GESTOR: ['Gerente', 'Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor'],
  GERENTE: ['Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor'],
}

const initialForm = {
  fullName: '',
  username: '',
  corporateEmailOverride: '',
  personalEmail: '',
  mobilePhone: '',
  department: '',
  jobTitle: 'Consultor',
  units: [] as string[],
  scheduleProfessionalId: '',
  scheduleStatus: 'Ativo',
  scheduleRole: 'Injetor',
  scheduleShift: '',
  scheduleNickname: '',
  scheduleInstagram: '',
  scheduleColor: '',
}

async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const csrf = getCsrfToken() || opts.csrf
  if (csrf) headers['x-csrf-token'] = csrf
  const target = path.startsWith('/auth/') ? `/api/auth${path.slice('/auth'.length)}` : `/api/crm${path}`
  const res = await fetch(target, {
    method: opts.method || 'GET',
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const payload = await res.json().catch(() => ({})) as T & ApiError
  if (!res.ok) throw new RequestError(payload.error || payload.message || `HTTP ${res.status}`, payload.code)
  return payload
}

function emptyTeamForm(row?: UnifiedTeamMember) {
  return {
    ...initialForm,
    fullName: row?.fullName || '',
    username: row?.username || '',
    corporateEmailOverride: row?.corporateEmail && row.corporateEmail !== buildCorporateEmail(row.fullName) ? row.corporateEmail : '',
    personalEmail: '',
    department: row?.department || '',
    jobTitle: row?.jobTitle || 'Consultor',
    units: row?.units || [],
    scheduleProfessionalId: row?.schedule?.professionalId || '',
    scheduleStatus: row?.schedule?.status || 'Ativo',
    scheduleRole: row?.schedule?.role || 'Injetor',
    scheduleShift: row?.schedule?.shift || '',
    scheduleNickname: row?.schedule?.nickname || '',
    scheduleInstagram: row?.schedule?.instagram || '',
    scheduleColor: row?.schedule?.color || '',
  }
}

function statusLabel(status: string) {
  return ({ INVITED: 'Convite enviado', ACTIVE: 'Ativo', SUSPENDED: 'Suspenso', TERMINATED: 'Desativado', PENDING_ACCESS: 'Aguardando acesso' } as Record<string, string>)[status] || status
}

export function UsersModule() {
  const [me, setMe] = React.useState<Me | null>(null)
  const [rows, setRows] = React.useState<Onboarding[]>([])
  const [teamRows, setTeamRows] = React.useState<UnifiedTeamMember[]>([])
  const [teamConfig, setTeamConfig] = React.useState<UnifiedTeamConfig>({ enabled: false, legacyEscalaEditor: true })
  const [section, setSection] = React.useState<'users' | 'team'>('users')
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingOriginalName, setEditingOriginalName] = React.useState('')
  const [collisionRequired, setCollisionRequired] = React.useState(false)
  const [form, setForm] = React.useState(initialForm)
  const usernameWasEdited = React.useRef(false)

  const role = String(me?.user?.role || '').toUpperCase()
  const actorUnits = Array.isArray(me?.user?.allowedUnits) ? me!.user!.allowedUnits!.filter(Boolean) : []
  const canManage = ['ADMIN', 'GESTOR', 'GERENTE'].includes(role) && (role === 'ADMIN' || actorUnits.length > 0)
  const selectableUnits = role === 'ADMIN' ? Object.keys(unitLabels) : actorUnits
  const selectableTitles = creatableTitlesByRole[role] || []
  const generatedEmail = buildCorporateEmail(form.fullName)
  const effectiveEmail = form.corporateEmailOverride.trim().toLowerCase() || generatedEmail

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const auth = await api<Me>('/auth/me').catch(() => null)
      setMe(auth)
      if (!auth?.user?.username) return
      const configResult = await api<{ success?: boolean; data?: UnifiedTeamConfig }>('/admin/team?mode=config', { csrf: auth.csrfToken }).catch(() => null)
      const config = configResult?.data || { enabled: false, legacyEscalaEditor: true }
      setTeamConfig(config)
      if (config.enabled) {
        const result = await api<{ success?: boolean; data?: UnifiedTeamMember[] }>('/admin/team', { csrf: auth.csrfToken }).catch(() => null)
        const members = Array.isArray(result?.data) ? result!.data! : []
        setTeamRows(members)
        setRows(members)
      } else {
        const result = await api<{ success?: boolean; data?: Onboarding[] }>('/admin/onboarding', { csrf: auth.csrfToken }).catch(() => null)
        setRows(Array.isArray(result?.data) ? result!.data! : [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])
  React.useEffect(() => {
    if (teamConfig.enabled) setSection('team')
  }, [teamConfig.enabled])

  const updateField = (field: keyof typeof initialForm, value: string | string[]) => setForm((current) => ({ ...current, [field]: value }))
  const toggleUnit = (unit: string) => setForm((current) => ({ ...current, units: current.units.includes(unit) ? current.units.filter((item) => item !== unit) : [...current.units, unit] }))

  const openCreate = () => {
    const defaultTitle = selectableTitles[selectableTitles.length - 1] || 'Consultor'
    const defaultUnits = selectableUnits.length === 1 ? selectableUnits : []
    setEditingId(null)
    setEditingOriginalName('')
    setCollisionRequired(false)
    usernameWasEdited.current = false
    setForm({ ...initialForm, jobTitle: defaultTitle, units: defaultUnits })
    setOpen(true)
  }

  const openEdit = (row: UnifiedTeamMember) => {
    setEditingId(row.id)
    setEditingOriginalName(row.fullName)
    setCollisionRequired(false)
    usernameWasEdited.current = true
    setForm(emptyTeamForm(row))
    setOpen(true)
  }

  const linkEscalaMember = async (member: UnifiedTeamMember, schedule: { professionalId?: string; workforceEmployeeId?: string | null }) => {
    const professionalId = String(schedule.professionalId || '').trim()
    if (!professionalId || !member.workforceEmployeeId) return true
    try {
      await api(`/admin/team/${encodeURIComponent(member.id)}/links`, {
        method: 'POST',
        csrf: me?.csrfToken,
        body: { source: 'ESCALA', sourceId: professionalId, matchMethod: 'EXPLICIT_WORKFORCE_ID', confidence: 'HIGH', reviewStatus: 'CONFIRMED' },
      })
      return true
    } catch (error: any) {
      toast.warning(`Cadastro salvo, mas o vínculo com a Escala ficou pendente: ${error?.message || 'tente novamente'}.`)
      return false
    }
  }

  const syncEscala = async (member: UnifiedTeamMember, created: boolean) => {
    if (!teamConfig.enabled || !member.workforceEmployeeId) return
    const schedulePayload = {
      name: form.fullName,
      status: form.scheduleStatus,
      units: form.units,
      role: form.scheduleRole,
      shift: form.scheduleShift,
      nickname: form.scheduleNickname,
      phone: form.mobilePhone,
      email: effectiveEmail,
      instagram: form.scheduleInstagram,
      color: form.scheduleColor,
      workforceEmployeeId: member.workforceEmployeeId,
    }
    const hasScheduleLink = Boolean(member.schedule?.professionalId)
    const result = created || !hasScheduleLink
      ? await addEscalaProfessional(schedulePayload)
      : await updateEscalaProfessional({ currentName: editingOriginalName, ...schedulePayload })
    if (!result.ok) {
      toast.warning(`Cadastro salvo, mas a Escala ficou pendente: ${result.error || 'tente novamente'}.`)
      return
    }
    const professionalId = result.data?.professionalId
    if (professionalId) await linkEscalaMember(member, { professionalId })
  }

  const submit = async () => {
    if (!canManage) return
    const username = form.username.trim() || suggestUsername(form.fullName, effectiveEmail)
    if (!form.fullName.trim() || !username || !effectiveEmail || (!editingId && (!form.personalEmail.trim() || !form.mobilePhone.trim())) || !form.department.trim() || !form.units.length) {
      toast.error('Preencha nome, usuário, e-mails, telefone, departamento e ao menos uma unidade.')
      return
    }
    setSaving(true)
    try {
      const body = {
        fullName: form.fullName,
        username,
        corporateEmail: effectiveEmail,
        ...(form.personalEmail.trim() ? { personalEmail: form.personalEmail } : {}),
        ...(form.mobilePhone.trim() ? { mobilePhone: form.mobilePhone } : {}),
        department: form.department,
        jobTitle: form.jobTitle,
        units: form.units,
        team: {
          professionalId: form.scheduleProfessionalId,
          status: form.scheduleStatus,
          role: form.scheduleRole,
          shift: form.scheduleShift,
          nickname: form.scheduleNickname,
          instagram: form.scheduleInstagram,
          color: form.scheduleColor,
          units: form.units,
        },
      }
      const endpoint = teamConfig.enabled && editingId ? `/admin/team/${encodeURIComponent(editingId)}` : teamConfig.enabled ? '/admin/team' : '/admin/onboarding'
      const result = await api<{ data?: Onboarding & UnifiedTeamMember; replayed?: boolean }>(endpoint, {
        method: editingId ? 'PUT' : 'POST',
        csrf: me?.csrfToken,
        headers: editingId ? {} : { 'idempotency-key': `crm-team-${Date.now()}-${Math.random().toString(16).slice(2)}` },
        body,
      })
      if (result.data && teamConfig.enabled && !result.replayed) {
        await syncEscala(result.data as UnifiedTeamMember, !editingId)
      }
      setCollisionRequired(false)
      setForm(initialForm)
      setEditingId(null)
      setOpen(false)
      toast.success(editingId ? 'Membro atualizado.' : 'Cadastro criado; convite enviado para o e-mail pessoal.')
      await load()
    } catch (error: any) {
      if (error instanceof RequestError && (error.code === 'EMAIL_TAKEN' || error.code === 'CORPORATE_EMAIL_OVERRIDE_REQUIRES_COLLISION')) {
        setCollisionRequired(true)
        toast.error('O e-mail calculado já está em uso. Informe um ajuste explícito, como um sufixo numérico.')
      } else if (error instanceof RequestError && error.code === 'USERNAME_TAKEN') {
        toast.error('Esse nome de usuário já está reservado. Escolha outro.')
      } else {
        toast.error(error?.message || 'Não foi possível concluir o cadastro.')
      }
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async (row: UnifiedTeamMember) => {
    if (!teamConfig.enabled || !window.confirm(`Desativar ${row.fullName}? O histórico e a agenda serão preservados.`)) return
    try {
      await api(`/admin/team/${encodeURIComponent(row.id)}/status`, { method: 'POST', csrf: me?.csrfToken, body: { accountStatus: 'SUSPENDED' } })
      toast.success('Membro suspenso; histórico preservado.')
      await load()
    } catch (error: any) {
      toast.error(error?.message || 'Não foi possível desativar o membro.')
    }
  }

  return <div className="p-6 space-y-6"><div className="max-w-7xl mx-auto space-y-4">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div><h1 className="text-lg font-semibold text-white">Usuários</h1><p className="text-sm text-blue-100/70">Identidade, equipe e convites sob o mesmo cadastro; senhas são criadas pelo próprio funcionário.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void load()} disabled={loading}>Recarregar</Button><Button variant="outline" onClick={openCreate} disabled={!canManage}>Cadastrar funcionário</Button></div>
    </div>
    <div className="flex gap-2 border-b border-white/10" role="tablist" aria-label="Gestão de usuários e equipe">
      <Button variant={section === 'users' ? 'default' : 'ghost'} role="tab" aria-selected={section === 'users'} onClick={() => setSection('users')}>Usuários</Button>
      <Button variant={section === 'team' ? 'default' : 'ghost'} role="tab" aria-selected={section === 'team'} onClick={() => setSection('team')}>Equipe</Button>
    </div>

    {section === 'team' ? <>
      {!teamConfig.enabled && <Card className="border-amber-300/20 bg-amber-500/10"><CardContent className="p-4 text-sm text-amber-50/90">A centralização da equipe está preparada, mas a flag de liberação ainda está desligada. A Escala continua com o editor antigo como contingência controlada.</CardContent></Card>}
      <Card className="bg-black/20 border border-white/10"><CardHeader><CardTitle className="text-white text-sm">Equipe ativa</CardTitle></CardHeader><CardContent><div className="overflow-auto rounded-lg border border-white/10"><table className="min-w-full text-sm"><thead className="bg-black/30 text-blue-100/80"><tr><th className="p-2 text-left">Nome</th><th className="p-2 text-left">Usuário</th><th className="p-2 text-left">Cargo</th><th className="p-2 text-left">Unidades</th><th className="p-2 text-left">Conta</th><th className="p-2 text-left">Escala</th><th className="p-2 text-right">Ações</th></tr></thead><tbody className="divide-y divide-white/5 text-blue-50">{teamRows.map((row) => <tr key={row.id}><td className="p-2">{row.fullName}</td><td className="p-2">{row.username || '—'}</td><td className="p-2">{row.jobTitle}</td><td className="p-2">{row.units.map((unit) => unitLabels[unit] || unit).join(', ')}</td><td className="p-2">{statusLabel(row.accountStatus)}</td><td className="p-2">{row.schedule?.professionalId ? 'Vinculada' : 'Pendente'}</td><td className="p-2 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(row)}>Editar</Button><Button size="sm" variant="outline" onClick={() => void deactivate(row)}>Desativar</Button></div></td></tr>)}{!teamRows.length && <tr><td className="p-3 text-blue-100/70" colSpan={7}>{loading ? 'Carregando…' : teamConfig.enabled ? 'Nenhum integrante ativo.' : 'A lista aparecerá após a liberação da centralização.'}</td></tr>}</tbody></table></div></CardContent></Card>
    </> : <Card className="bg-black/20 border border-white/10"><CardHeader><CardTitle className="text-white text-sm">Cadastros recentes</CardTitle></CardHeader><CardContent><div className="overflow-auto rounded-lg border border-white/10"><table className="min-w-full text-sm"><thead className="bg-black/30 text-blue-100/80"><tr><th className="p-2 text-left">Nome</th><th className="p-2 text-left">Usuário</th><th className="p-2 text-left">Cargo</th><th className="p-2 text-left">Departamento</th><th className="p-2 text-left">Unidades</th><th className="p-2 text-left">Conta</th></tr></thead><tbody className="divide-y divide-white/5 text-blue-50">{rows.map((row) => <tr key={row.id}><td className="p-2">{row.fullName}</td><td className="p-2">{row.username || '—'}</td><td className="p-2">{row.jobTitle}</td><td className="p-2">{row.department}</td><td className="p-2">{row.units.map((unit) => unitLabels[unit] || unit).join(', ')}</td><td className="p-2">{statusLabel(row.accountStatus)}</td></tr>)}{!rows.length && <tr><td className="p-3 text-blue-100/70" colSpan={6}>{loading ? 'Carregando…' : 'Nenhum cadastro recente.'}</td></tr>}</tbody></table></div></CardContent></Card>}
  </div>

  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-4xl dark bg-corporate-900 border-white/10 text-white"><DialogHeader><DialogTitle>{editingId ? 'Editar membro da equipe' : 'Cadastro unificado de equipe'}</DialogTitle><DialogDescription className="text-blue-100/70">O sistema calcula o e-mail corporativo. O convite é enviado ao e-mail pessoal; nenhum gestor define ou visualiza a senha.</DialogDescription></DialogHeader>
    <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Nome completo<Input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value, username: usernameWasEdited.current ? current.username : suggestUsername(event.target.value, buildCorporateEmail(event.target.value)) }))} /></label><label className="text-sm">Nome de usuário<Input value={form.username} onChange={(event) => { usernameWasEdited.current = true; updateField('username', event.target.value) }} placeholder="primeironomeultimosobrenome" disabled={!!editingId} /></label><label className="text-sm">E-mail corporativo calculado<Input value={generatedEmail} readOnly aria-readonly="true" /></label><label className="text-sm">E-mail pessoal<Input type="email" value={form.personalEmail} onChange={(event) => updateField('personalEmail', event.target.value)} /></label><label className="text-sm">Celular<Input value={form.mobilePhone} onChange={(event) => updateField('mobilePhone', event.target.value)} inputMode="tel" /></label><label className="text-sm">Departamento<Input value={form.department} onChange={(event) => updateField('department', event.target.value)} /></label><label className="text-sm">Cargo<Select value={form.jobTitle} onValueChange={(jobTitle) => updateField('jobTitle', jobTitle)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{selectableTitles.map((title) => <SelectItem value={title} key={title}>{title}</SelectItem>)}</SelectContent></Select></label></div>
    {(collisionRequired || form.corporateEmailOverride) && <label className="block text-sm">Ajuste do e-mail em caso de colisão<Input type="email" value={form.corporateEmailOverride} onChange={(event) => updateField('corporateEmailOverride', event.target.value)} placeholder="primeironomeultimosobrenome2@espacofacial.com" /><span className="mt-1 block text-xs text-amber-100/70">Use somente após o sistema informar colisão; o ajuste também deve manter o domínio corporativo.</span></label>}
    <div><div className="mb-2 text-sm">Unidades autorizadas</div><div className="flex flex-wrap gap-2">{selectableUnits.map((unit) => <Button key={unit} type="button" variant={form.units.includes(unit) ? 'default' : 'outline'} onClick={() => toggleUnit(unit)}>{unitLabels[unit] || unit}</Button>)}</div></div>
    {teamConfig.enabled && <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="mb-3 text-sm font-medium">Dados operacionais da Escala</div><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Status<Input value={form.scheduleStatus} onChange={(event) => updateField('scheduleStatus', event.target.value)} /></label><label className="text-sm">Função na Escala<Input value={form.scheduleRole} onChange={(event) => updateField('scheduleRole', event.target.value)} /></label><label className="text-sm">Turno<Input value={form.scheduleShift} onChange={(event) => updateField('scheduleShift', event.target.value)} /></label><label className="text-sm">Apelido<Input value={form.scheduleNickname} onChange={(event) => updateField('scheduleNickname', event.target.value)} /></label><label className="text-sm">Instagram<Input value={form.scheduleInstagram} onChange={(event) => updateField('scheduleInstagram', event.target.value)} /></label><label className="text-sm">Cor<Input value={form.scheduleColor} onChange={(event) => updateField('scheduleColor', event.target.value)} placeholder="#6d9eeb" /></label></div></div>}
    {!editingId && <p className="text-xs text-blue-100/65">O convite é obrigatório para integrantes ativos. A pessoa define a própria senha pelo link recebido.</p>}
    <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving || !canManage}>{saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Cadastrar e convidar'}</Button></DialogFooter>
  </DialogContent></Dialog>
  </div>
}
