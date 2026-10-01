import { createRoot } from 'react-dom/client'
import { PontoApp } from './PontoApp'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Ponto application root is missing')
}

createRoot(root).render(<PontoApp />)
