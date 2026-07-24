import React from 'react'
import { FinanceModule } from '@/FinanceModule'

type FinanceRemote = { mount: (element: HTMLElement) => void | (() => void) }

/** Loads an independently published Finance bundle without making it a shell dependency. */
export function RemoteFinanceModule() {
  const container = React.useRef<HTMLDivElement>(null)
  const [failed, setFailed] = React.useState(false)
  const remoteUrl = String(import.meta.env.VITE_FINANCE_MODULE_URL || '').trim()

  React.useEffect(() => {
    if (!remoteUrl || !container.current) return
    let disposed = false; let cleanup: void | (() => void)
    const cssUrl = remoteUrl.replace(/\.js(?:\?.*)?$/, '.css')
    const stylesheet = document.querySelector<HTMLLinkElement>(`link[data-finance-remote-css="${cssUrl}"]`) || (() => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = cssUrl; link.dataset.financeRemoteCss = cssUrl
      document.head.append(link)
      return link
    })()
    import(/* @vite-ignore */ remoteUrl)
      .then((remote: FinanceRemote) => { if (!disposed) cleanup = remote.mount(container.current!) })
      .catch(() => { if (!disposed) setFailed(true) })
    return () => { disposed = true; cleanup?.(); if (!document.querySelector('[data-finance-remote="true"]')) stylesheet.remove() }
  }, [remoteUrl])

  if (!remoteUrl || failed) return <FinanceModule />
  return <div ref={container} data-finance-remote="true" aria-busy="true" />
}
