import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { fetchAtendimentoManagementCatalog, type AtendimentoManagementCatalog } from '@/atendimentoClinicaApi'
import { formatNumberBR } from '@/atendimentoClinicaDomain'

const panelClass = 'border-slate-800/80 bg-slate-950/60 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl'

export function ProcedimentosModule() {
  const [catalog, setCatalog] = useState<AtendimentoManagementCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await fetchAtendimentoManagementCatalog()
    if (!result.ok) {
      setError(result.error || 'Não foi possível carregar procedimentos.')
    } else {
      setCatalog(result)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const procedures = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (catalog?.procedures || []).filter((procedure) => {
      if (!term) return true
      return procedure.name.toLowerCase().includes(term) || procedure.codes.some((code) => code.toLowerCase().includes(term))
    })
  }, [catalog?.procedures, search])

  const totalCodes = useMemo(
    () => (catalog?.procedures || []).reduce((acc, procedure) => acc + procedure.codes.length, 0),
    [catalog?.procedures],
  )

  return (
    <div className="min-h-full bg-slate-950/10 p-3 text-white sm:p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <Card className={`${panelClass} overflow-hidden`}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <ClipboardList className="h-5 w-5 text-sky-300" />
                Procedimentos
              </CardTitle>
              <div className="mt-1 text-sm text-slate-400">Matriz oficial de procedimentos e códigos migrada da Gerência.</div>
            </div>
            <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-white hover:bg-slate-800/80" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_12rem_12rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar procedimento ou código"
                className="border-slate-700 bg-slate-950/70 pl-9 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="text-xs text-slate-400">Procedimentos</div>
              <div className="mt-1 text-xl font-semibold text-white">{formatNumberBR(catalog?.procedures?.length || 0)}</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="text-xs text-slate-400">Códigos</div>
              <div className="mt-1 text-xl font-semibold text-white">{formatNumberBR(totalCodes)}</div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/12 p-3 text-sm text-amber-100">{error}</div>
        ) : null}

        <Card className={`${panelClass} overflow-hidden`}>
          <CardContent className="p-0">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 border-b border-slate-800 bg-slate-950 px-4 py-3 text-left font-medium text-slate-300">Procedimento</th>
                    <th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-4 py-3 text-left font-medium text-slate-300">Códigos permitidos</th>
                    <th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-4 py-3 text-right font-medium text-slate-300">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {procedures.map((procedure) => (
                    <tr key={procedure.id || procedure.name} className="transition hover:bg-slate-900/65">
                      <td className="sticky left-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-3 font-medium text-white">{procedure.name}</td>
                      <td className="border-b border-slate-800 px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {procedure.codes.map((code) => (
                            <Badge key={code} className="border border-sky-400/25 bg-sky-400/10 text-sky-100">{code}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="border-b border-slate-800 px-4 py-3 text-right font-semibold text-slate-100">{formatNumberBR(procedure.codes.length)}</td>
                    </tr>
                  ))}
                  {!procedures.length ? (
                    <tr>
                      <td colSpan={3} className="py-10 text-center text-slate-400">Nenhum procedimento encontrado.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
