import React, { useEffect, useRef, useState } from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Input } from '@/input'
import { ArrowClockwise, ArrowSquareOut, Warning } from '@phosphor-icons/react'

interface GoogleHomeWebViewProps {
  onLoad: () => void
  onLoginStatusChange: (loggedIn: boolean) => void
  onVideoPlayerChange: (visible: boolean) => void
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR' | 'STATUS', message: string) => void
}

export function GoogleHomeWebView({ 
  onLoad, 
  onLoginStatusChange, 
  onVideoPlayerChange, 
  onLog 
}: GoogleHomeWebViewProps) {
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'development'
  const webviewRef = useRef<HTMLWebViewElement>(null)
  const [url, setUrl] = useState('https://home.google.com/')
  const [isLoading, setIsLoading] = useState(true)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleLoadStart = () => {
      setIsLoading(true)
      onLog('INFO', 'Loading Google Home interface...')
    }

    const handleLoadStop = () => {
      setIsLoading(false)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
      onLoad()
      onLog('INFO', 'Google Home interface loaded successfully')
      
      // Start monitoring for login status and video players
      startMonitoring()
    }

    const handleLoadError = (event: any) => {
      setIsLoading(false)
      onLog('ERROR', `Failed to load Google Home: ${event.errorDescription || 'Unknown error'}`)
    }

    webview.addEventListener('did-start-loading', handleLoadStart)
    webview.addEventListener('did-stop-loading', handleLoadStop)
    webview.addEventListener('did-fail-load', handleLoadError)

    return () => {
      webview.removeEventListener('did-start-loading', handleLoadStart)
      webview.removeEventListener('did-stop-loading', handleLoadStop)
      webview.removeEventListener('did-fail-load', handleLoadError)
      
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
      }
    }
  }, [onLoad, onLog])

  const startMonitoring = () => {
    // Clear any existing interval
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current)
    }

    // Check every 2 seconds for login status and video players
    checkIntervalRef.current = setInterval(() => {
      const webview = webviewRef.current
      if (!webview) return

      try {
        // Execute script to check login status and video players
        webview.executeJavaScript(`
          (() => {
            // Check login status
            const loginIndicators = [
              '[data-testid="home-card"]',
              '.home-card',
              '[aria-label*="Home control"]',
              '.device-card',
              '.google-home-app'
            ];
            
            const isLoggedIn = loginIndicators.some(selector => 
              document.querySelector(selector) !== null
            );

            // Check for video players
            const videoSelectors = [
              'video',
              '[data-testid="video-player"]',
              '.video-player',
              'iframe[src*="video"]'
            ];
            
            const videoVisible = videoSelectors.some(selector => {
              const element = document.querySelector(selector);
              return element && element.offsetWidth > 0 && element.offsetHeight > 0;
            });

            return { isLoggedIn, videoVisible };
          })()
        `).then((result: { isLoggedIn: boolean, videoVisible: boolean }) => {
          onLoginStatusChange(result.isLoggedIn)
          onVideoPlayerChange(result.videoVisible)
        }).catch((error) => {
          onLog('WARNING', `Failed to check Google Home status: ${error.message}`)
        })
      } catch (error) {
        onLog('WARNING', `Monitoring error: ${error}`)
      }
    }, 2000)
  }

  const handleRefresh = () => {
    const webview = webviewRef.current
    if (webview) {
      webview.reload()
      onLog('INFO', 'Refreshing Google Home interface')
    }
  }

  const handleGoBack = () => {
    const webview = webviewRef.current
    if (webview && webview.canGoBack()) {
      webview.goBack()
    }
  }

  const handleGoForward = () => {
    const webview = webviewRef.current
    if (webview && webview.canGoForward()) {
      webview.goForward()
    }
  }

  const handleNavigate = (newUrl: string) => {
    const webview = webviewRef.current
    if (webview) {
      webview.loadURL(newUrl)
      setUrl(newUrl)
      onLog('INFO', `Navigating to: ${newUrl}`)
    }
  }

  const handleUrlChange = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const target = e.target as HTMLInputElement
      handleNavigate(target.value)
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Navigation Bar */}
      <div className="border-b border-border bg-card px-4 py-2 flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleGoBack}
            disabled={!canGoBack}
            className="h-8 w-8 p-0"
          >
            ←
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleGoForward}
            disabled={!canGoForward}
            className="h-8 w-8 p-0"
          >
            →
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleRefresh}
            disabled={isLoading}
            className="h-8 w-8 p-0"
          >
            <ArrowClockwise className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex-1">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={handleUrlChange}
            className="h-8 text-sm"
            placeholder="Enter URL..."
          />
        </div>

        <div className="flex items-center gap-2">
          {isLoading && <Badge variant="outline">Loading...</Badge>}
          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => window.open(url, '_blank')}
            className="h-8 w-8 p-0"
          >
            <ArrowSquareOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* WebView Container */}
      <div className="flex-1 relative">
        {!isElectron ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 border-2 border-dashed border-muted">
            <Warning className="w-12 h-12 text-yellow-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">{isDev ? 'Development Mode' : 'Electron Required'}</h3>
            <p className="text-muted-foreground text-center max-w-md">
              O WebView nativo (Google Home) só funciona em modo Electron.
              A URL atual seria: <strong>{url}</strong>
            </p>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              <p>• Automação Google Home depende do WebView</p>
              <p>• Detecção de vídeo acontece dentro do WebView</p>
              <p>• Gravação ainda funciona capturando a janela/aba</p>
            </div>
          </div>
        ) : (
          <webview
            ref={webviewRef}
            src={url}
            className="w-full h-full"
            nodeintegration={false}
            webpreferences="contextIsolation=yes"
            allowpopups={false}
            useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          />
        )}
      </div>
    </div>
  )
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: any
    }
  }
}

interface HTMLWebViewElement extends HTMLElement {
  loadURL(url: string): void
  reload(): void
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  executeJavaScript(code: string): Promise<any>
}
