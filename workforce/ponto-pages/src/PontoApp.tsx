import { Toaster } from 'sonner'
import { AuthScreen } from './AuthScreen'
import { PontoAuthProvider, useAuth } from './PontoAuth'
import { PontoModule } from './PontoModule'

function PontoSurface() {
  const { user, initializing, signOut } = useAuth()
  if (initializing) return <main className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-300">Carregando acesso…</main>
  if (!user) return <AuthScreen />
  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b bg-white px-4 py-3 shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Espaço Facial</p><h1 className="text-lg font-semibold">Ponto</h1></div>
        <div className="flex items-center gap-3 text-right text-sm"><span className="hidden text-slate-600 sm:inline">{user.displayName || user.username}</span><button type="button" className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => void signOut()}>Sair</button></div>
      </div>
    </header>
    <div className="mx-auto max-w-7xl px-4 py-6"><PontoModule /></div>
  </main>
}

export function PontoApp() {
  return <PontoAuthProvider><PontoSurface /><Toaster richColors position="top-right" /></PontoAuthProvider>
}
