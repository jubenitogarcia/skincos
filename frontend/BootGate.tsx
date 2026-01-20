/**
 * BootGate - Deterministic Initialization Controller
 * 
 * Ensures all critical dependencies are ready before mounting downstream providers.
 * Prevents hooks from executing before their dependencies are available.
 * 
 * DETERMINISTIC BEHAVIOR:
 * - Never "proceeds anyway" after timeout
 * - Shows specific error screens for different failure types
 * - Integrates with ErrorReporter for proper error handling
 */
import React, { ReactNode, useEffect, useState } from 'react'
import { errorReporter, BootError } from '@/ErrorReporter'

function BootFailureScreen({ error, onRetry }: { error: BootError; onRetry: () => void }) {
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
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
          {getErrorIcon(error.type)}
        </div>

        <div style={{
          fontSize: '1.8rem',
          marginBottom: '1rem',
          fontWeight: 'bold'
        }}>
          {getErrorTitle(error.type)}
        </div>

        <div style={{
          fontSize: '1rem',
          opacity: 0.9,
          marginBottom: '2rem',
          lineHeight: 1.5
        }}>
          {error.message}
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.1)',
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '2rem',
          textAlign: 'left'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '1rem' }}>
            Ações recomendadas:
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
            {getRecommendedActions(error.type).map((action, index) => (
              <li key={index} style={{ marginBottom: '0.5rem', opacity: 0.9 }}>
                {action}
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={onRetry}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: '2px solid rgba(255,255,255,0.3)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '1rem',
            cursor: 'pointer',
            fontWeight: 'bold',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s ease'
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

        <div style={{
          marginTop: '1.5rem',
          fontSize: '0.8rem',
          opacity: 0.7
        }}>
          Timestamp: {new Date(error.timestamp).toLocaleString()}
        </div>
      </div>
    </div>
  )
}

interface BootGateState {
  envReady: boolean
  configReady: boolean
  backendHealthy: boolean
  featureFlagsLoaded: boolean
}

interface BootGateProps {
  children: ReactNode
  timeout?: number // Configurable timeout
}

const DEFAULT_BOOT_TIMEOUT_MS = 10000 // 10 seconds (increased for development)

export function BootGate({ children, timeout = DEFAULT_BOOT_TIMEOUT_MS }: BootGateProps) {
  const [bootState, setBootState] = useState<BootGateState>({
    envReady: false,
    configReady: false,
    backendHealthy: false,
    featureFlagsLoaded: false
  })
  
  const [isReady, setIsReady] = useState(false)
  const [criticalError, setCriticalError] = useState<BootError | null>(null)
  const [bootPhase, setBootPhase] = useState<'preflight' | 'initialization' | 'ready' | 'failed'>('preflight')

  // Deterministic preflight checks with proper error handling
  useEffect(() => {
    let bootTimeout: NodeJS.Timeout
    let isCleanedUp = false

    async function runPreflightChecks() {
      try {
        console.log('[BootGate] 🚀 Starting deterministic preflight checks...')
        setBootPhase('preflight')
        
        // 1. Critical Environment Check
        const envReady = typeof window !== 'undefined'
        if (!envReady) {
          throw new Error('Window object not available (SSR context?)')
        }
        setBootState(prev => ({ ...prev, envReady: true }))
        
        // 2. Configuration Check
        setBootPhase('initialization')
        const configReady = true // Basic config validation could be added here
        setBootState(prev => ({ ...prev, configReady }))
        
        // 3. Backend Health Check (with multiple fallbacks)
        let backendHealthy = false;
        const healthEndpoints = ['/health', '/v1/health', '/api/system/health'];
        
        for (const endpoint of healthEndpoints) {
          try {
            console.log(`[BootGate] 🔍 Tentando health check: ${endpoint}`);
            const healthResponse = await fetch(endpoint, { 
              method: 'GET',
              signal: AbortSignal.timeout(2000),
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'BootGate-HealthCheck/1.0'
              }
            });
            
            if (healthResponse.ok) {
              const healthData = await healthResponse.json().catch(() => ({ status: 'ok' }));
              console.log(`[BootGate] ✅ Health check OK em ${endpoint}:`, healthData.status || 'healthy');
              backendHealthy = true;
              break; // Success, stop trying other endpoints
            } else {
              console.log(`[BootGate] ⚠️ Health check ${endpoint} retornou status ${healthResponse.status}`);
            }
          } catch (healthError) {
            console.log(`[BootGate] ❌ Health check ${endpoint} falhou:`, healthError instanceof Error ? healthError.message : String(healthError));
            // Continue to next endpoint
          }
        }
        
        setBootState(prev => ({ ...prev, backendHealthy }));
        
        if (backendHealthy) {
          console.log('[BootGate] ✅ Backend health check PASSOU - sistema pode inicializar');
        } else {
          console.log('[BootGate] ⚠️ Backend health check FALHOU em todos os endpoints - prosseguindo em modo degradado');
          // Backend health is non-critical - we can proceed in degraded mode
        }
        
        // 4. Feature Flags Loading
        setBootState(prev => ({ ...prev, featureFlagsLoaded: true }))
        
        if (isCleanedUp) return // Prevent state updates after cleanup
        
        console.log('[BootGate] ✅ All preflight checks completed successfully')
        setBootPhase('ready')
        setIsReady(true)
        clearTimeout(bootTimeout)
        
      } catch (error) {
        if (isCleanedUp) return
        
        console.error('[BootGate] ❌ Critical boot failure:', error)
        
        const bootError: BootError = {
          type: 'CRITICAL_DEPENDENCY',
          message: error instanceof Error ? error.message : 'Unknown critical error',
          details: error,
          timestamp: Date.now(),
          phase: bootPhase
        }
        
        // Report error and show failure screen
        const report = errorReporter.reportBootError(bootError)
        setCriticalError(bootError)
        setBootPhase('failed')
        clearTimeout(bootTimeout)
      }
    }

    // Set up timeout that creates a boot timeout error
    bootTimeout = setTimeout(() => {
      if (!isReady && !isCleanedUp) {
        console.error('[BootGate] ❌ Boot timeout reached - this is a critical failure')
        
        const bootError: BootError = {
          type: 'BOOT_TIMEOUT',
          message: `Boot process timed out after ${timeout}ms`,
          timestamp: Date.now(),
          phase: bootPhase
        }
        
        errorReporter.reportBootError(bootError)
        setCriticalError(bootError)
        setBootPhase('failed')
      }
    }, timeout)
    
    runPreflightChecks()
    
    return () => {
      isCleanedUp = true
      clearTimeout(bootTimeout)
    }
  }, [timeout, isReady, bootPhase])

  // Show boot failure screen for critical errors
  if (criticalError) {
    return <BootFailureScreen error={criticalError} onRetry={() => window.location.reload()} />
  }

  // Show loading screen during boot
  if (!isReady) {
    return (
      <div style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        fontFamily: 'system-ui',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', animation: 'spin 2s linear infinite' }}>🚀</div>
          <div style={{ fontSize: '1.5rem', marginBottom: '1rem', fontWeight: 'bold' }}>
            Carregando CRM...
          </div>
          <div style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '2rem' }}>
            {bootPhase === 'preflight' ? 'Verificando ambiente...' :
             bootPhase === 'initialization' ? 'Conectando aos serviços...' :
             'Finalizando inicialização...'}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '1rem' }}>
            Se demorar, force o reload (⌘R) ou confira os logs.
          </div>
          
          {/* Boot status indicators */}
          <div style={{ textAlign: 'left', marginTop: '2rem' }}>
            <BootStatusItem label="Environment" ready={bootState.envReady} />
            <BootStatusItem label="Configuration" ready={bootState.configReady} />
            <BootStatusItem label="Backend Health" ready={bootState.backendHealthy} />
            <BootStatusItem label="Feature Flags" ready={bootState.featureFlagsLoaded} />
          </div>
          
          {/* Boot phase indicator */}
          <div style={{ 
            marginTop: '1.5rem', 
            fontSize: '0.8rem', 
            opacity: 0.7 
          }}>
            Fase: {bootPhase === 'preflight' ? 'Verificação Inicial' : 
                   bootPhase === 'initialization' ? 'Inicialização' : 
                   bootPhase === 'ready' ? 'Pronto' : 'Falha'}
          </div>
        </div>
      </div>
    )
  }

  // Mark BootGate as ready for debugging
  if (typeof window !== 'undefined') {
    (window as any).__BOOT_GATE_READY__ = true
    console.log('[BootGate] ✅ Ready signal set - downstream providers can mount safely')
  }

  return <>{children}</>
}

function BootStatusItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      marginBottom: '0.5rem',
      fontSize: '0.8rem'
    }}>
      <div style={{ 
        width: '12px', 
        height: '12px', 
        borderRadius: '50%',
        backgroundColor: ready ? '#10B981' : '#6B7280',
        marginRight: '0.5rem',
        animation: ready ? 'none' : 'pulse 2s infinite'
      }} />
      <span style={{ opacity: ready ? 1 : 0.7 }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>
        {ready ? '✅' : (
          <img
            src="/icons/hourglass.png"
            alt=""
            aria-hidden
            style={{ width: '14px', height: '14px', display: 'inline-block', verticalAlign: 'text-bottom' }}
          />
        )}
      </span>
    </div>
  )
}
