import type { MouseEvent } from 'react'
import { clientesWorkspaceUrl, clientesWorkspaceViews, type ClientesWalletUrlState, type ClientesWorkspaceView } from '@/clientesRoutes'

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function ClientesWorkspaceNavigation({
  active,
  filters,
  onNavigate,
}: {
  active: ClientesWorkspaceView
  filters: ClientesWalletUrlState
  onNavigate: (view: ClientesWorkspaceView) => void
}) {
  return <nav aria-label="Áreas do workspace Clientes" role="tablist" data-testid="clientes-workspace-nav" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/45 p-1">
    {clientesWorkspaceViews.map((view) => {
      const selected = active === view.key
      return <a
        key={view.key}
        href={clientesWorkspaceUrl({ view: view.key }, filters)}
        role="tab"
        aria-selected={selected}
        aria-current={selected ? 'page' : undefined}
        title={view.description}
        onClick={(event) => {
          if (!isPlainLeftClick(event)) return
          event.preventDefault()
          onNavigate(view.key)
        }}
        className={`shrink-0 rounded-lg px-3 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${selected ? 'bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/30' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`}
      >
        <span className="block font-medium">{view.label}</span><span className="mt-0.5 hidden text-[10px] text-slate-500 sm:block">{view.description}</span>
      </a>
    })}
  </nav>
}
