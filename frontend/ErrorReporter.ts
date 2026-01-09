/**
 * ErrorReporter - Centralized Error Handling Service
 * 
 * Handles boot failures, provider errors, and runtime exceptions
 * with proper logging and user feedback.
 */

export interface BootError {
  type: 'BOOT_TIMEOUT' | 'CRITICAL_DEPENDENCY' | 'BACKEND_UNREACHABLE' | 'CONFIG_INVALID'
  message: string
  details?: any
  timestamp: number
  phase: 'preflight' | 'initialization' | 'ready' | 'failed'
}

export interface ErrorReport {
  id: string
  error: BootError
  context: {
    userAgent: string
    timestamp: number
    environment: string
    url: string
  }
  actions: string[]
}

class ErrorReporterService {
  private errors: ErrorReport[] = []
  private callbacks: Set<(report: ErrorReport) => void> = new Set()

  /**
   * Report a boot error with context
   */
  reportBootError(error: BootError): ErrorReport {
    const report: ErrorReport = {
      id: `boot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      error,
      context: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        timestamp: Date.now(),
        environment: import.meta.env.MODE || 'unknown',
        url: typeof window !== 'undefined' ? window.location.href : 'unknown'
      },
      actions: this.getRecommendedActions(error)
    }

    this.errors.push(report)
    this.notifyCallbacks(report)
    
    // Log for debugging
    console.error('[ErrorReporter] Boot Error:', {
      type: error.type,
      message: error.message,
      phase: error.phase,
      reportId: report.id
    })

    return report
  }

  /**
   * Subscribe to error reports
   */
  onError(callback: (report: ErrorReport) => void): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  /**
   * Get all error reports
   */
  getErrors(): ErrorReport[] {
    return [...this.errors]
  }

  /**
   * Get latest boot error if any
   */
  getLatestBootError(): ErrorReport | null {
    const bootErrors = this.errors.filter(r => r.error.phase === 'preflight' || r.error.phase === 'initialization')
    return bootErrors[bootErrors.length - 1] || null
  }

  /**
   * Clear all errors (for testing)
   */
  clear(): void {
    this.errors = []
  }

  private getRecommendedActions(error: BootError): string[] {
    switch (error.type) {
      case 'BOOT_TIMEOUT':
        return [
          'Verifique sua conexão com a internet',
          'Recarregue a página',
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
          'Entre em contato com o suporte',
          'Recarregue a página'
        ]
      
      default:
        return [
          'Recarregue a página',
          'Se o problema persistir, entre em contato com o suporte'
        ]
    }
  }

  private notifyCallbacks(report: ErrorReport): void {
    this.callbacks.forEach(callback => {
      try {
        callback(report)
      } catch (e) {
        console.error('[ErrorReporter] Callback error:', e)
      }
    })
  }
}

// Singleton instance
export const errorReporter = new ErrorReporterService()

// Debug utilities
if (import.meta.env.DEV) {
  ;(window as any).__ERROR_REPORTER__ = errorReporter
  console.log('[ErrorReporter] Service available at window.__ERROR_REPORTER__')
}