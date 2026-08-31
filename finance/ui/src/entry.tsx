import React from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import financeStyles from './styles.css?inline'
import { FinanceModule } from './FinanceModule'

const styleId = 'skincos-finance-ui-styles'

function ensureStyles() {
  if (document.getElementById(styleId)) return
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = financeStyles
  document.head.appendChild(style)
}

export function mount(element: HTMLElement) {
  ensureStyles()
  const root = createRoot(element)
  root.render(<><FinanceModule /><Toaster closeButton richColors /></>)
  return () => root.unmount()
}
