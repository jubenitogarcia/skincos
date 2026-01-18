import React, { Component, ErrorInfo, ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Warning } from "@phosphor-icons/react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo: errorInfo.componentStack })
  }

  render() {
    if (this.state.hasError) {
      const debugEnabled = (() => {
        try {
          if (import.meta.env.DEV) return true
          if (typeof window === 'undefined') return false
          return new URLSearchParams(window.location.search).get('debug') === '1'
        } catch {
          return false
        }
      })()

      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <Card className="m-4">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Warning className="h-5 w-5 text-destructive" />
              <CardTitle>Algo deu errado</CardTitle>
            </div>
            <CardDescription>
              Ocorreu um erro inesperado. Tente recarregar a página.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {this.state.error && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground font-mono">
                    {this.state.error.message}
                  </p>
                </div>
              )}
              {debugEnabled ? (
                <details className="rounded-lg border bg-muted/30 p-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Detalhes técnicos (debug)
                  </summary>
                  <div className="mt-3 space-y-2">
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-black/80 p-3 text-xs text-white/90">
                      {(this.state.error?.stack || '(stack indisponível)') + '\n' + (this.state.errorInfo || '')}
                    </pre>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          const payload =
                            `url: ${typeof window !== 'undefined' ? window.location.href : ''}\n` +
                            `ua: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}\n` +
                            `message: ${this.state.error?.message || ''}\n\n` +
                            `${this.state.error?.stack || ''}\n` +
                            `${this.state.errorInfo || ''}`
                          await navigator.clipboard.writeText(payload)
                        } catch (e) {
                          console.error('Failed to copy debug info', e)
                        }
                      }}
                    >
                      Copiar detalhes
                    </Button>
                  </div>
                </details>
              ) : null}
              <Button 
                onClick={() => window.location.reload()}
                variant="outline"
              >
                Recarregar Página
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    }

    return this.props.children
  }
}
