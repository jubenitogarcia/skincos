import { Component, useState, type ErrorInfo, type ReactNode } from 'react'

type BoundaryProps = { sectionKey: string; onRetry: () => void; children: ReactNode }
type BoundaryState = { failed: boolean }

class ClientesWorkspaceSectionBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Deliberately do not log the thrown value. A presentation failure can
    // contain data fetched by a child and Clientes must not emit PII to logs.
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.sectionKey !== this.props.sectionKey && this.state.failed) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <section role="alert" aria-live="polite" data-testid={`clientes-section-error-${this.props.sectionKey}`} className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      <p>Esta seção está temporariamente indisponível. As demais áreas de Clientes continuam acessíveis.</p>
      <button type="button" onClick={this.props.onRetry} className="mt-3 rounded-md border border-amber-200/40 px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200">Tentar novamente</button>
    </section>
  }
}

export function ClientesWorkspaceSection({ sectionKey, children }: { sectionKey: string; children: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  return <ClientesWorkspaceSectionBoundary sectionKey={`${sectionKey}:${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>{children}</ClientesWorkspaceSectionBoundary>
}
