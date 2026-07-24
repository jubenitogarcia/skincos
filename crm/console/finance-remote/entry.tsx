import React from 'react'
import { createRoot } from 'react-dom/client'
import '../main.css'
import { FinanceModule } from '../FinanceModule'

export function mount(element: HTMLElement) {
  const root = createRoot(element)
  root.render(<FinanceModule />)
  return () => root.unmount()
}
