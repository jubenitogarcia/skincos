import { useCallback, useEffect, useMemo, useState } from 'react'
import { LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/button'
import {
  confirmCommercialAssistedWhatsapp,
  fetchCommercialAssistedOffers,
  fetchCommercialAssistedReadiness,
  fetchCommercialAssistedTemplates,
  previewCommercialAssistedWhatsapp,
  type CommercialAction,
  type CommercialAssistedConfirmation,
  type CommercialAssistedOffer,
  type CommercialAssistedPreview,
  type CommercialAssistedReadiness,
  type CommercialAssistedTemplate,
} from '@/atendimentoApi'

const COMMERCIAL_ASSISTED_MUTATIONS_ENABLED = false
const HUMAN_CONFIRMATION = 'CONFIRMAR_CONTATO_ASSISTIDO'
const preparableStatuses = new Set<CommercialAction['status']>(['open', 'contacted', 'responded', 'scheduled'])

function displayMoney(value: number | null, code: string) {
  if (value == null || !Number.isFinite(value)) return 'Condições aprovadas'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code || 'BRL' }).format(value / 100)
}

function displayDate(value: string | null | undefined) {
  if (!value) return 'Vigência não informada'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Vigência não informada' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(parsed)
}

function nextIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `assisted-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function CommercialAssistedWhatsappPanel({ actions, onUpdated }: { actions: CommercialAction[]; onUpdated: () => Promise<void> | void }) {
  const [actionId, setActionId] = useState('')
  const [offerId, setOfferId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [readiness, setReadiness] = useState<CommercialAssistedReadiness | null>(null)
  const [offers, setOffers] = useState<CommercialAssistedOffer[]>([])
  const [templates, setTemplates] = useState<CommercialAssistedTemplate[]>([])
  const [preview, setPreview] = useState<CommercialAssistedPreview | null>(null)
  const [confirmed, setConfirmed] = useState<CommercialAssistedConfirmation | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const preparableActions = useMemo(() => actions.filter((action) => action.contactChannel === 'whatsapp' && preparableStatuses.has(action.status)), [actions])
  const selectedAction = useMemo(() => preparableActions.find((action) => action.id === actionId) || null, [actionId, preparableActions])
  const selectedActionId = selectedAction?.id || ''
  const selectedUnit = selectedAction?.unitSlug || ''
  const preparationBlocked = !COMMERCIAL_ASSISTED_MUTATIONS_ENABLED || readiness?.safety?.commercialContactWritesEnabled !== true

  const clearPreparedState = () => {
    setPreview(null)
    setConfirmed(null)
    setConfirmation('')
    setIdempotencyKey('')
  }

  useEffect(() => {
    if (!preparableActions.length) {
      if (actionId) setActionId('')
      return
    }
    if (!preparableActions.some((action) => action.id === actionId)) setActionId(preparableActions[0].id)
  }, [actionId, preparableActions])

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    setReadiness(null)
    setOffers([])
    setTemplates([])
    setPreview(null)
    setConfirmed(null)
    setConfirmation('')
    setIdempotencyKey('')
    if (!selectedActionId || !selectedUnit) {
      setBusy(false)
      return
    }
    const readinessResponse = await fetchCommercialAssistedReadiness()
    if (!readinessResponse.ok || !readinessResponse.ready) {
      setError(readinessResponse.error || 'A operação assistida não está pronta neste ambiente.')
      setBusy(false)
      return
    }
    setReadiness(readinessResponse)
    const [offersResponse, templatesResponse] = await Promise.all([
      fetchCommercialAssistedOffers(selectedActionId),
      fetchCommercialAssistedTemplates(selectedUnit),
    ])
    if (!offersResponse.ok || !templatesResponse.ok) {
      setError(offersResponse.error || templatesResponse.error || 'Não foi possível carregar o contexto aprovado.')
      setBusy(false)
      return
    }
    setOffers(offersResponse.offers)
    setTemplates(templatesResponse.templates)
    setOfferId(offersResponse.offers[0]?.offerId || '')
    setTemplateId(templatesResponse.templates[0]?.templateId || '')
    setBusy(false)
  }, [selectedActionId, selectedUnit])

  useEffect(() => { void load() }, [load])

  const previewMessage = async () => {
    if (preparationBlocked || !selectedActionId || !offerId || !templateId) return
    setBusy(true)
    setError('')
    const response = await previewCommercialAssistedWhatsapp({ actionId: selectedActionId, offerId, templateId })
    if (!response.ok || !response.eligible) {
      setError(response.error || response.blockReason || 'O contexto não passou pela revalidação.')
      setBusy(false)
      return
    }
    setPreview(response)
    setConfirmed(null)
    setConfirmation('')
    setIdempotencyKey(nextIdempotencyKey())
    setBusy(false)
  }

  const confirmPreparation = async () => {
    if (preparationBlocked || !preview?.previewContextHash || !idempotencyKey || !selectedActionId || !offerId || !templateId) return
    if (confirmation !== HUMAN_CONFIRMATION) {
      setError('Digite a confirmação literal para registrar o preparo humano.')
      return
    }
    setBusy(true)
    setError('')
    const response = await confirmCommercialAssistedWhatsapp({
      actionId: selectedActionId,
      offerId,
      templateId,
      previewContextHash: preview.previewContextHash,
      confirmation: HUMAN_CONFIRMATION,
      idempotencyKey,
    })
    if (!response.ok) {
      setError(response.error || 'Não foi possível confirmar o preparo.')
      setBusy(false)
      return
    }
    setConfirmed(response)
    await Promise.resolve(onUpdated())
    setBusy(false)
  }

  return <section aria-labelledby="commercial-assisted-heading" aria-label="Comunicação assistida por WhatsApp" className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-200" /><h2 id="commercial-assisted-heading" className="text-lg font-semibold text-white">Comunicação assistida</h2></div>
        <p className="mt-1 text-sm text-slate-500">Ofertas e modelos aprovados para a ação selecionada, sem exposição de dados de contato.</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button>
    </div>

    <div className="mt-3 flex gap-2 rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3 text-xs text-emerald-100"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Transporte externo bloqueado:</b> preparo, confirmação, mensagens, contato e alterações comerciais permanecem desativados pelas flags compiladas e pelo runtime somente leitura.</span></div>
    {error ? <div role="alert" className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 p-3 text-sm text-amber-100">{error}</div> : null}
    {preparableActions.length === 0 ? <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/45 p-4 text-sm text-slate-500">Não há ação elegível para preparar neste perfil.</div> : <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/45 p-4">
        <label className="block text-xs font-medium text-slate-300" htmlFor="assisted-action">Ação da carteira</label>
        <select id="assisted-action" aria-label="Ação da carteira para comunicação assistida" value={actionId} onChange={(event) => { setActionId(event.target.value); clearPreparedState() }} className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100">
          {preparableActions.map((action) => <option key={action.id} value={action.id}>{action.unitName} · {action.segmentKey} · {action.status}</option>)}
        </select>
        <label className="block text-xs font-medium text-slate-300" htmlFor="assisted-offer">Oferta aprovada</label>
        <select id="assisted-offer" aria-label="Oferta aprovada" value={offerId} onChange={(event) => { setOfferId(event.target.value); clearPreparedState() }} disabled={busy || !offers.length} className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-60">
          <option value="">Selecione uma oferta</option>{offers.map((offer) => <option key={offer.offerId} value={offer.offerId}>{offer.title} · r{offer.revision}</option>)}
        </select>
        <label className="block text-xs font-medium text-slate-300" htmlFor="assisted-template">Modelo aprovado</label>
        <select id="assisted-template" aria-label="Modelo aprovado" value={templateId} onChange={(event) => { setTemplateId(event.target.value); clearPreparedState() }} disabled={busy || !templates.length} className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-60">
          <option value="">Selecione um modelo</option>{templates.map((template) => <option key={template.templateId} value={template.templateId}>{template.templateKey} · r{template.revision}</option>)}
        </select>
      </div>
      <div className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-4">
        <h3 className="font-medium text-slate-100">Contexto aprovado</h3>
        {offers.find((offer) => offer.offerId === offerId) ? <div className="mt-3 space-y-1 text-sm text-slate-300">{(() => { const offer = offers.find((item) => item.offerId === offerId)!; return <><div className="font-medium text-slate-100">{offer.title} · r{offer.revision}</div><div>{displayMoney(offer.priceCents, offer.currency)}</div><div className="text-xs text-slate-500">{offer.conditions || 'Condições aprovadas'} · {displayDate(offer.validityStart)} até {displayDate(offer.validityEnd)}</div></> })()}</div> : <p className="mt-3 text-sm text-slate-500">Aguardando oferta aprovada.</p>}
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400">Destinatário: mascarado até uma revalidação autorizada. Nenhuma informação de contato é exibida nesta tela.</div>
      </div>
    </div>}

    <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/45 p-4">
      <h3 className="font-medium text-slate-100">Preview e confirmação humana</h3>
      <p className="mt-1 text-xs text-slate-500">As etapas abaixo ficam bloqueadas enquanto a política e o runtime estiverem em modo somente leitura.</p>
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || preparationBlocked || !selectedActionId || !offerId || !templateId} onClick={() => void previewMessage()}>Gerar preview mascarado</Button><Button size="sm" disabled={busy || preparationBlocked || !preview?.previewContextHash || confirmation !== HUMAN_CONFIRMATION} onClick={() => void confirmPreparation()}>Confirmar preparo humano</Button></div>
      {preview ? <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-200"><div className="font-medium">Destinatário: {preview.recipientMasked || 'Mascarado'}</div><p className="mt-2 whitespace-pre-wrap text-slate-300">{preview.messagePreview || 'Preview indisponível.'}</p><label className="mt-3 block text-xs text-slate-400" htmlFor="assisted-confirmation">Digite {HUMAN_CONFIRMATION}</label><input id="assisted-confirmation" aria-label="Confirmação humana literal" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={preparationBlocked} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-60" /></div> : null}
      {confirmed ? <div role="status" className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">Preparo registrado como {confirmed.status}. Resultado: {confirmed.dispatchResult}. Nenhuma mensagem foi enviada.</div> : null}
    </div>
    <p aria-live="polite" className="sr-only">{busy ? 'Carregando contexto assistido' : error || (readiness?.ready ? 'Contexto assistido disponível em modo bloqueado' : 'Contexto assistido não disponível')}</p>
  </section>
}