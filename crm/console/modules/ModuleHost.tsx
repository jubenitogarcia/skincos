import React, { Component, Suspense, useMemo, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import type { CrmModuleManifest, ModuleAvailability } from './types'

type BoundaryProps = { moduleKey: string; children: ReactNode; onReturnToNavigation: () => void; onRetry: () => void }
type BoundaryState = { error: boolean }

class ModuleErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    console.error(JSON.stringify({ level: 'error', scope: 'crm-module', module: this.props.moduleKey, event: 'render_failed' }))
  }
  componentDidUpdate(previous: BoundaryProps) {
    if (previous.moduleKey !== this.props.moduleKey && this.state.error) this.setState({ error: false })
  }
  render() {
    if (!this.state.error) return this.props.children
    return <Card className="border-amber-400/30 bg-slate-950/60 text-white"><CardHeader><CardTitle>Este módulo está indisponível</CardTitle><CardDescription>A falha foi isolada. A navegação e os demais módulos continuam disponíveis.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-3"><Button onClick={() => { this.setState({ error: false }); this.props.onRetry() }}>Tentar novamente</Button><Button variant="outline" onClick={this.props.onReturnToNavigation}>Voltar aos módulos</Button></CardContent></Card>
  }
}

function ModuleUnavailable({ manifest, availability, onReturnToNavigation }: { manifest: CrmModuleManifest; availability: ModuleAvailability; onReturnToNavigation: () => void }) {
  return <Card className="border-white/15 bg-slate-950/60 text-white"><CardHeader><CardTitle>{manifest.fallback.unavailableLabel}</CardTitle><CardDescription>{availability.reason || 'O acesso a este módulo não está disponível neste ambiente.'}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={onReturnToNavigation}>Voltar aos módulos</Button></CardContent></Card>
}

export function ModuleHost({ manifest, availability, onReturnToNavigation }: { manifest: CrmModuleManifest; availability: ModuleAvailability; onReturnToNavigation: () => void }) {
  const [retry, setRetry] = useState(0)
  const EntryPoint = useMemo(() => React.lazy(() => retry > 0 ? Promise.resolve().then(manifest.loader) : manifest.loader()), [manifest.loader, retry])
  if (!availability.available) return <ModuleUnavailable manifest={manifest} availability={availability} onReturnToNavigation={onReturnToNavigation} />
  return <ModuleErrorBoundary moduleKey={manifest.key} onReturnToNavigation={onReturnToNavigation} onRetry={() => setRetry((value) => value + 1)}><Suspense fallback={<div className="glass-morphism rounded-2xl border border-white/20 p-8" role="status"><div className="text-white/90">{manifest.fallback.loadingLabel}</div><div className="mt-1 text-sm text-blue-300/60">Carregamento isolado do módulo {manifest.label}.</div></div>}><EntryPoint /></Suspense></ModuleErrorBoundary>
}
