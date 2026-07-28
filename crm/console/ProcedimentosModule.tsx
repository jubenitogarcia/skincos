import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, RefreshCw, Search, Save } from 'lucide-react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import {
  fetchAtendimentoCommercialOffers,
  fetchAtendimentoManagementCatalog,
  saveAtendimentoCommercialOffer,
  type AtendimentoCommercialOffer,
  type AtendimentoManagementCatalog,
} from '@/atendimentoApi'
import { formatCurrencyBRL, formatNumberBR } from '@/atendimentoDomain'

const panelClass = 'border-slate-800/80 bg-slate-950/60 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl'
const emptyDraft = {
  unitSlug: '',
  offerKey: '',
  title: '',
  price: '',
  priceQualifier: 'exact' as 'exact' | 'from' | 'on_request',
  conditions: '',
  validityStart: '',
  validityEnd: '',
  procedureIds: [] as string[],
}

function priceLabel(offer: AtendimentoCommercialOffer) {
  if (offer.priceQualifier === 'on_request') return 'Sob consulta'
  if (offer.priceCents == null) return 'Preço não definido'
  return `${offer.priceQualifier === 'from' ? 'A partir de ' : ''}${formatCurrencyBRL(offer.priceCents / 100)}`
}

export function ProcedimentosModule() {
  const [catalog, setCatalog] = useState<AtendimentoManagementCatalog | null>(null)
  const [offers, setOffers] = useState<AtendimentoCommercialOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState(emptyDraft)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [catalogResult, offersResult] = await Promise.all([
      fetchAtendimentoManagementCatalog(),
      fetchAtendimentoCommercialOffers(),
    ])
    if (!catalogResult.ok) setError(catalogResult.error || 'Não foi possível carregar procedimentos.')
    else {
      setCatalog(catalogResult)
      setDraft((current) => current.unitSlug ? current : { ...current, unitSlug: catalogResult.units[0]?.slug || '' })
    }
    if (!offersResult.ok) setError(offersResult.error || 'Não foi possível carregar o catálogo comercial.')
    else setOffers(offersResult.offers || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const procedures = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (catalog?.procedures || []).filter((procedure) => {
      if (!term) return true
      return procedure.name.toLowerCase().includes(term)
        || (procedure.aliases || []).some((alias) => alias.toLowerCase().includes(term))
        || procedure.codes.some((code) => code.toLowerCase().includes(term))
    })
  }, [catalog?.procedures, search])

  const totalCodes = useMemo(
    () => (catalog?.procedures || []).reduce((acc, procedure) => acc + procedure.codes.length, 0),
    [catalog?.procedures],
  )

  const editOffer = (offer: AtendimentoCommercialOffer) => {
    setDraft({
      unitSlug: offer.unitSlug,
      offerKey: offer.offerKey,
      title: offer.title,
      price: offer.priceCents == null ? '' : String((offer.priceCents / 100).toFixed(2)),
      priceQualifier: offer.priceQualifier === 'on_request' ? 'on_request' : offer.priceQualifier === 'from' ? 'from' : 'exact',
      conditions: offer.conditions,
      validityStart: offer.validityStart || '',
      validityEnd: offer.validityEnd || '',
      procedureIds: offer.procedures.map((procedure) => procedure.id),
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    const numericPrice = draft.price.trim() === '' ? null : Math.round(Number(draft.price.replace(',', '.')) * 100)
    setSaving(true)
    setError('')
    const result = await saveAtendimentoCommercialOffer({
      unitSlug: draft.unitSlug,
      offerKey: draft.offerKey || undefined,
      title: draft.title,
      status: 'active',
      priceCents: numericPrice,
      priceQualifier: draft.priceQualifier,
      conditions: draft.conditions,
      validityStart: draft.validityStart || null,
      validityEnd: draft.validityEnd || null,
      procedures: draft.procedureIds.map((procedureId) => ({ procedureId })),
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error || 'Não foi possível salvar a oferta.')
      return
    }
    setDraft((current) => ({ ...emptyDraft, unitSlug: current.unitSlug }))
    await load()
  }

  return (
    <div className="min-h-full bg-slate-950/10 p-3 text-white sm:p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <Card className={`${panelClass} overflow-hidden`}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <ClipboardList className="h-5 w-5 text-sky-300" />
                Procedimentos e ofertas comerciais
              </CardTitle>
              <div className="mt-1 text-sm text-slate-400">Fonte aprovada para Meta Ads: oferta por unidade, preço, condições, vigência e revisão auditável.</div>
            </div>
            <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-white hover:bg-slate-800/80" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_12rem_12rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar procedimento, sinônimo ou código" className="border-slate-700 bg-slate-950/70 pl-9 text-white placeholder:text-slate-500" />
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3"><div className="text-xs text-slate-400">Procedimentos</div><div className="mt-1 text-xl font-semibold text-white">{formatNumberBR(catalog?.procedures?.length || 0)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3"><div className="text-xs text-slate-400">Códigos</div><div className="mt-1 text-xl font-semibold text-white">{formatNumberBR(totalCodes)}</div></div>
          </CardContent>
        </Card>

        {error ? <div className="rounded-2xl border border-amber-400/30 bg-amber-500/12 p-3 text-sm text-amber-100">{error}</div> : null}

        <Card className={panelClass}>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4 text-sky-300" />Cadastrar ou revisar oferta</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <select value={draft.unitSlug} onChange={(event) => setDraft((current) => ({ ...current, unitSlug: event.target.value }))} className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white">
              <option value="">Selecione a unidade</option>
              {(catalog?.units || []).map((unit) => <option key={unit.slug} value={unit.slug}>{unit.name}</option>)}
            </select>
            <Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Título comercial da oferta" className="border-slate-700 bg-slate-950 text-white" />
            <Input value={draft.offerKey} onChange={(event) => setDraft((current) => ({ ...current, offerKey: event.target.value }))} placeholder="Chave estável (opcional; gerada pelo título)" className="border-slate-700 bg-slate-950 text-white" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" min="0" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Preço R$" className="border-slate-700 bg-slate-950 text-white" />
              <select value={draft.priceQualifier} onChange={(event) => setDraft((current) => ({ ...current, priceQualifier: event.target.value as typeof draft.priceQualifier }))} className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white">
                <option value="exact">Preço exato</option><option value="from">A partir de</option><option value="on_request">Sob consulta</option>
              </select>
            </div>
            <Input type="date" value={draft.validityStart} onChange={(event) => setDraft((current) => ({ ...current, validityStart: event.target.value }))} className="border-slate-700 bg-slate-950 text-white" />
            <Input type="date" value={draft.validityEnd} onChange={(event) => setDraft((current) => ({ ...current, validityEnd: event.target.value }))} className="border-slate-700 bg-slate-950 text-white" />
            <textarea value={draft.conditions} onChange={(event) => setDraft((current) => ({ ...current, conditions: event.target.value }))} placeholder="Condições materiais, parcelamento, brinde ou restrições" className="min-h-20 rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-white placeholder:text-slate-500 md:col-span-2" />
            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 md:col-span-2">
              <div className="mb-2 text-sm font-medium text-slate-200">Procedimentos incluídos (ao menos um)</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(catalog?.procedures || []).map((procedure) => {
                  const checked = draft.procedureIds.includes(procedure.id)
                  return <label key={procedure.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={checked} onChange={() => setDraft((current) => ({ ...current, procedureIds: checked ? current.procedureIds.filter((id) => id !== procedure.id) : [...current.procedureIds, procedure.id] }))} />{procedure.name}</label>
                })}
              </div>
            </div>
            <div className="flex justify-end md:col-span-2"><Button onClick={save} disabled={saving || !draft.unitSlug || !draft.title || !draft.procedureIds.length}><Save className="h-4 w-4" />{saving ? 'Salvando…' : 'Salvar e ativar oferta'}</Button></div>
          </CardContent>
        </Card>

        <Card className={`${panelClass} overflow-hidden`}>
          <CardHeader><CardTitle className="text-base">Ofertas ativas e revisáveis</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[45vh] overflow-auto">
              <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-sm">
                <thead><tr><th className="sticky left-0 top-0 z-20 border-b border-slate-800 bg-slate-950 px-4 py-3 text-left text-slate-300">Oferta</th><th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-4 py-3 text-left text-slate-300">Unidade</th><th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-4 py-3 text-left text-slate-300">Preço e condições</th><th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-4 py-3 text-left text-slate-300">Procedimentos</th><th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-4 py-3 text-right text-slate-300">Revisão</th></tr></thead>
                <tbody>
                  {offers.map((offer) => <tr key={offer.offerId} onClick={() => editOffer(offer)} className="cursor-pointer transition hover:bg-slate-900/65">
                    <td className="sticky left-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-3 font-medium text-white"><div>{offer.title}</div><div className="mt-1 text-xs text-slate-500">{offer.offerKey} · {offer.status}</div></td>
                    <td className="border-b border-slate-800 px-4 py-3 text-slate-300">{offer.unitSlug}</td>
                    <td className="border-b border-slate-800 px-4 py-3"><div className="font-medium text-white">{priceLabel(offer)}</div><div className="max-w-64 truncate text-xs text-slate-400">{offer.conditions || 'Sem condição adicional'}</div></td>
                    <td className="border-b border-slate-800 px-4 py-3"><div className="flex flex-wrap gap-1.5">{offer.procedures.map((procedure) => <Badge key={procedure.id} className="border border-sky-400/25 bg-sky-400/10 text-sky-100">{procedure.name}</Badge>)}</div></td>
                    <td className="border-b border-slate-800 px-4 py-3 text-right text-slate-300">v{offer.revision}<div className="text-xs text-slate-500">{offer.contextHash}</div></td>
                  </tr>)}
                  {!offers.length ? <tr><td colSpan={5} className="py-10 text-center text-slate-400">Nenhuma oferta comercial cadastrada. A publicação Meta continuará bloqueada até haver uma oferta ativa e válida.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className={`${panelClass} overflow-hidden`}>
          <CardContent className="p-0"><div className="max-h-[35vh] overflow-auto"><table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm"><thead><tr><th className="sticky left-0 top-0 z-20 border-b border-slate-800 bg-slate-950 px-4 py-3 text-left text-slate-300">Procedimento</th><th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-4 py-3 text-left text-slate-300">Códigos permitidos</th><th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-4 py-3 text-right text-slate-300">Total</th></tr></thead><tbody>
            {procedures.map((procedure) => <tr key={procedure.id || procedure.name} className="transition hover:bg-slate-900/65"><td className="sticky left-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-3 font-medium text-white"><div>{procedure.name}</div>{procedure.aliases?.length ? <div className="mt-1 text-xs text-slate-500">{procedure.aliases.join(', ')}</div> : null}</td><td className="border-b border-slate-800 px-4 py-3"><div className="flex flex-wrap gap-1.5">{procedure.codes.map((code) => <Badge key={code} className="border border-sky-400/25 bg-sky-400/10 text-sky-100">{code}</Badge>)}</div></td><td className="border-b border-slate-800 px-4 py-3 text-right font-semibold text-slate-100">{formatNumberBR(procedure.codes.length)}</td></tr>)}
            {!procedures.length ? <tr><td colSpan={3} className="py-10 text-center text-slate-400">Nenhum procedimento encontrado.</td></tr> : null}
          </tbody></table></div></CardContent>
        </Card>
      </div>
    </div>
  )
}
