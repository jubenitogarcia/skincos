// Error Boundary específico para erros de contexto/providers
import React, { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: any
}

export class ContextErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    console.error('[ContextErrorBoundary] 🚨 Context error caught:', error)
    return {
      hasError: true,
      error
    }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('[ContextErrorBoundary] 📊 Error details:', error, errorInfo)
    
    // Check if it's a useContext related error
    if (error.message.includes('useContext') || error.message.includes('Cannot read properties of null')) {
      console.error('[ContextErrorBoundary] 🎯 Detected useContext timing error!')
      console.error('[ContextErrorBoundary] 💡 This usually indicates a provider initialization order issue')
    }
    
    this.setState({
      error,
      errorInfo
    })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
          color: 'white',
          fontFamily: 'system-ui',
          padding: '2rem'
        }}>
          <div style={{ textAlign: 'center', maxWidth: '600px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚨</div>
            <h1 style={{ margin: '0 0 1rem 0', fontSize: '1.5rem' }}>
              Erro na Inicialização dos Contextos
            </h1>
            <p style={{ margin: '0 0 1rem 0', opacity: 0.9 }}>
              Detectamos um problema na inicialização dos providers do React.
              Isso geralmente indica um problema de timing na configuração dos contextos.
            </p>
            <details style={{ textAlign: 'left', marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
                Detalhes técnicos
              </summary>
              <pre style={{ 
                background: 'rgba(0,0,0,0.3)', 
                padding: '1rem', 
                borderRadius: '0.5rem',
                fontSize: '0.8rem',
                overflow: 'auto'
              }}>
                {this.state.error?.message}
                {'\n\n'}
                {this.state.error?.stack}
              </pre>
            </details>
            <button 
              onClick={() => window.location.reload()}
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1.5rem',
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
                color: 'white',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              Recarregar Aplicação
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}