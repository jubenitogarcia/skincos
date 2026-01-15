// Ensure React Refresh preamble is installed before any React module evaluates (prevents blank page on HMR edge cases)
import './preamble'
import { createRoot } from 'react-dom/client'
try {
  if (import.meta.env.DEV) console.log('GitHub Spark Mock: Initialized')
  ;(window as any).sparkComponents = (window as any).sparkComponents || {}
  ;(window as any).sparkEvents = {
    emit: (event: string, data?: any) => {
      if (import.meta.env.DEV) console.log('Spark Event:', event, data)
    },
    on: (event: string, callback: Function) => { },
    off: (event: string, callback: Function) => { }
  }
} catch { /* ignore */ }

import App from './App'
import { RootProviders } from '@/RootProviders'

import "./main.css"

// Global error handling - only in DEV
if (import.meta.env.DEV) {
  ; (function installRuntimeDebug() {
    if (typeof window === 'undefined') return
    if ((window as any).__RUNTIME_DEBUG_INSTALLED__) return
      ; (window as any).__RUNTIME_DEBUG_INSTALLED__ = true
    
    const createOverlay = (title: string, message: string) => {
      const id = 'runtime-error-overlay'
      let existing = document.getElementById(id)
      if (!existing) {
        existing = document.createElement('div')
        existing.id = id
        Object.assign(existing.style, {
          position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.75)', color: '#fff',
          padding: '24px', fontFamily: 'monospace', zIndex: '999999', overflow: 'auto'
        })
        document.body.appendChild(existing)
      }
      const time = new Date().toISOString()
      existing.innerHTML = `<h1 style="margin:0 0 12px;font-size:18px;font-family:system-ui">${title}</h1>` +
        `<div style="white-space:pre-wrap;font-size:12px;line-height:1.4">[${time}] ${message}</div>` +
        `<button id="close-overlay" style="margin-top:16px;background:#444;border:1px solid #666;color:#fff;padding:6px 12px;cursor:pointer">Fechar</button>`
      existing.querySelector('#close-overlay')?.addEventListener('click', () => existing?.remove())
    }
    
    window.addEventListener('error', (e) => {
      console.error('[GlobalError]', e.error || e.message, e)
      createOverlay('Erro em tempo de execução', (e.error?.stack || e.message || '').toString())
    })
    window.addEventListener('unhandledrejection', (e: any) => {
      console.error('[UnhandledRejection]', e.reason)
      createOverlay('Promise não tratada', (e.reason?.stack || e.reason || '').toString())
    })
    console.log('[RuntimeDebug] instalado em modo DEV')
  })()
}

// Boot application with robust provider architecture
const rootEl = document.getElementById('root')
if (!rootEl) {
  const warn = document.createElement('div')
  warn.textContent = 'Root element #root não encontrado.'
  warn.style.cssText = 'padding:12px;background:red;color:#fff;font-family:monospace;'
  document.body.appendChild(warn)
} else {
  // Remove boot loader if present
  try { document.getElementById('boot')?.remove() } catch { }
  
  if (import.meta.env.DEV) console.log('[main.tsx] 🚀 Starting React application with RootProviders architecture...')
  
  createRoot(rootEl).render(
    <RootProviders>
      <App />
    </RootProviders>
  )
  
  if (import.meta.env.DEV) console.log('[main.tsx] ✅ React root mounted with robust provider stack')
}
