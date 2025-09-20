/**
 * BootFailureScreen - Graceful Boot Failure Handling
 * 
 * Shows user-friendly error screens when critical boot failures occur.
 * Provides actionable recovery options instead of blank screens.
 */
import React from 'react'
import { BootError } from '@/services/ErrorReporter'

interface BootFailureScreenProps {
  error: BootError
  onRetry: () => void
}

export function BootFailureScreen({ error, onRetry }: BootFailureScreenProps) {
  const getErrorIcon = (type: BootError['type']) => {
    switch (type) {
      case 'BOOT_TIMEOUT': return '⏱️'
      case 'CRITICAL_DEPENDENCY': return '🔧'
      case 'BACKEND_UNREACHABLE': return '📡'
      case 'CONFIG_INVALID': return '⚙️'
      default: return '❌'
    }
  }

  const getErrorTitle = (type: BootError['type']) => {
    switch (type) {
      case 'BOOT_TIMEOUT': return 'Tempo Limite Excedido'
      case 'CRITICAL_DEPENDENCY': return 'Dependência Crítica Indisponível'
      case 'BACKEND_UNREACHABLE': return 'Servidor Indisponível'
      case 'CONFIG_INVALID': return 'Configuração Inválida'
      default: return 'Erro de Inicialização'
    }
  }

  const getRecommendedActions = (type: BootError['type']) => {
    switch (type) {
      case 'BOOT_TIMEOUT':
        return [
          'Verifique sua conexão com a internet',
          'Recarregue a página (F5 ou Cmd+R)',
          'Limpe o cache do navegador'
        ]
      
      case 'CRITICAL_DEPENDENCY':
        return [
          'Recarregue a página',
          'Verifique se JavaScript está habilitado',
          'Tente usar outro navegador'
        ]
      
      case 'BACKEND_UNREACHABLE':
        return [
          'Verifique sua conexão com a internet',
          'O servidor pode estar temporariamente indisponível',
          'Tente novamente em alguns minutos'
        ]
      
      case 'CONFIG_INVALID':
        return [
          'Configuração inválida detectada',
          'Entre em contato com o suporte técnico',
          'Tente recarregar a página'
        ]
      
      default:
        return [
          'Recarregue a página',
          'Se o problema persistir, entre em contato com o suporte'
        ]
    }
  }

  return (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)',
      color: 'white',
      fontFamily: 'system-ui',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    }}>
      <div style={{ 
        textAlign: 'center', 
        maxWidth: '500px', 
        padding: '2rem',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: '12px',
        backdropFilter: 'blur(10px)'
      }}>
        {/* Error Icon */}
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
          {getErrorIcon(error.type)}
        </div>

        {/* Error Title */}
        <div style={{ 
          fontSize: '1.8rem', 
          marginBottom: '1rem', 
          fontWeight: 'bold' 
        }}>
          {getErrorTitle(error.type)}
        </div>

        {/* Error Message */}
        <div style={{ 
          fontSize: '1rem', 
          opacity: 0.9, 
          marginBottom: '2rem',
          lineHeight: 1.5
        }}>
          {error.message}
        </div>

        {/* Recommended Actions */}
        <div style={{ 
          textAlign: 'left', 
          background: 'rgba(0,0,0,0.3)', 
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '2rem'
        }}>
          <div style={{ 
            fontSize: '1rem', 
            fontWeight: 'bold', 
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            💡 Como resolver:
          </div>
          <ul style={{ 
            margin: 0, 
            paddingLeft: '1.5rem',
            fontSize: '0.9rem',
            lineHeight: 1.6
          }}>
            {getRecommendedActions(error.type).map((action, index) => (
              <li key={index} style={{ marginBottom: '0.5rem' }}>
                {action}
              </li>
            ))}
          </ul>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button
            onClick={onRetry}
            style={{
              padding: '12px 24px',
              fontSize: '1rem',
              fontWeight: 'bold',
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(5px)'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
            }}
          >
            🔄 Tentar Novamente
          </button>

          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '12px 24px',
              fontSize: '1rem',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
            }}
          >
            🏠 Página Inicial
          </button>
        </div>

        {/* Error Details for Debug */}
        {import.meta.env.DEV && (
          <details style={{ 
            marginTop: '2rem', 
            textAlign: 'left',
            fontSize: '0.8rem',
            opacity: 0.7
          }}>
            <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
              🔍 Detalhes Técnicos (Dev)
            </summary>
            <pre style={{ 
              background: 'rgba(0,0,0,0.5)', 
              padding: '1rem',
              borderRadius: '4px',
              overflow: 'auto',
              fontSize: '0.7rem'
            }}>
              {JSON.stringify(error, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}