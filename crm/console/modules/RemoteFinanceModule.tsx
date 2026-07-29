import React from 'react'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'

type FinanceRemote = { mount: (element: HTMLElement) => void | (() => void) }

// Keep a small, non-sensitive failure class in the DOM for the staging smoke.
// Do not expose error messages, URLs or stack traces to CRM users.
const remoteFailureKind = (cause: unknown) => {
  const name = cause instanceof Error ? cause.name : ''
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'RemoteLoadError'
}

/** Loads an independently published Finance bundle without making it a shell dependency. */
export function RemoteFinanceModule() {
  const container = React.useRef<HTMLDivElement>(null)
  const [failed, setFailed] = React.useState(false)
  const [failureKind, setFailureKind] = React.useState('')
  const [retry, setRetry] = React.useState(0)
  const remoteUrl = String(import.meta.env.VITE_FINANCE_MODULE_URL || '').trim()

  React.useEffect(() => {
    if (!remoteUrl || !container.current) return
    let disposed = false; let cleanup: void | (() => void)
    setFailed(false)
    setFailureKind('')
    import(/* @vite-ignore */ remoteUrl)
      .then((remote: FinanceRemote) => { if (!disposed) cleanup = remote.mount(container.current!) })
      .catch((cause) => { if (!disposed) { setFailureKind(remoteFailureKind(cause)); setFailed(true) } })
    return () => { disposed = true; cleanup?.() }
  }, [remoteUrl, retry])

  if (!remoteUrl || failed) return <Card className="border-amber-400/30 bg-slate-950/60 text-white" data-testid="finance-remote-unavailable" data-finance-remote-error={failed ? failureKind || 'RemoteLoadError' : undefined}><CardHeader><CardTitle>Financeiro indisponível</CardTitle><CardDescription>{remoteUrl ? 'A versão independente do Financeiro não pôde ser carregada. A navegação e os demais módulos continuam disponíveis.' : 'O Financeiro ainda não foi associado a um artefato liberado neste ambiente.'}</CardDescription></CardHeader><CardContent>{remoteUrl && <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</Button>}</CardContent></Card>
  return <div ref={container} data-finance-remote="true" aria-busy="true" />
}
