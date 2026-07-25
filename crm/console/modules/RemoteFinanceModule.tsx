import React from 'react'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'

type FinanceRemote = { mount: (element: HTMLElement) => void | (() => void) }

/** Loads an independently published Finance bundle without making it a shell dependency. */
export function RemoteFinanceModule() {
  const container = React.useRef<HTMLDivElement>(null)
  const [failed, setFailed] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  const remoteUrl = String(import.meta.env.VITE_FINANCE_MODULE_URL || '').trim()

  React.useEffect(() => {
    if (!remoteUrl || !container.current) return
    let disposed = false; let cleanup: void | (() => void)
    setFailed(false)
    import(/* @vite-ignore */ remoteUrl)
      .then((remote: FinanceRemote) => { if (!disposed) cleanup = remote.mount(container.current!) })
      .catch(() => { if (!disposed) setFailed(true) })
    return () => { disposed = true; cleanup?.() }
  }, [remoteUrl, retry])

  if (!remoteUrl || failed) return <Card className="border-amber-400/30 bg-slate-950/60 text-white" data-testid="finance-remote-unavailable"><CardHeader><CardTitle>Financeiro indisponível</CardTitle><CardDescription>{remoteUrl ? 'A versão independente do Financeiro não pôde ser carregada. A navegação e os demais módulos continuam disponíveis.' : 'O Financeiro ainda não foi associado a um artefato liberado neste ambiente.'}</CardDescription></CardHeader><CardContent>{remoteUrl && <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</Button>}</CardContent></Card>
  return <div ref={container} data-finance-remote="true" aria-busy="true" />
}
