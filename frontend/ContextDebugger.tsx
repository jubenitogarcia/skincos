import React, { useEffect, useState } from 'react'

interface DebugLog {
  timestamp: string
  provider: string
  event: string
  details: any
  error?: boolean
}

// Global debug store
const debugLogs: DebugLog[] = []
const maxLogs = 100

export function logContextEvent(provider: string, event: string, details: any, error = false) {
  const log: DebugLog = {
    timestamp: new Date().toISOString(),
    provider,
    event,
    details,
    error
  }
  
  debugLogs.unshift(log)
  if (debugLogs.length > maxLogs) {
    debugLogs.splice(maxLogs)
  }
  
  // Log to console with color coding
  const style = error ? 'color: red; font-weight: bold' : 'color: blue'
  console.log(`%c[${provider}] ${event}`, style, details)
  
  // Store in window for debugging
  if (typeof window !== 'undefined') {
    (window as any).__CONTEXT_DEBUG_LOGS__ = debugLogs
  }
}

export function ContextDebugger() {
  const [logs, setLogs] = useState<DebugLog[]>([])
  const [isVisible, setIsVisible] = useState(false)
  
  useEffect(() => {
    const interval = setInterval(() => {
      setLogs([...debugLogs])
    }, 1000)
    
    return () => clearInterval(interval)
  }, [])
  
  useEffect(() => {
    // Listen for keyboard shortcut to toggle debug panel
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        setIsVisible(!isVisible)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible])
  
  if (!isVisible) {
    return (
      <div 
        style={{
          position: 'fixed',
          top: 10,
          right: 10,
          zIndex: 999999,
          background: '#333',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          cursor: 'pointer'
        }}
        onClick={() => setIsVisible(true)}
      >
        🐛 Context Debug (Ctrl+Shift+D)
      </div>
    )
  }
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      width: '400px',
      height: '100vh',
      background: 'rgba(0,0,0,0.9)',
      color: 'white',
      zIndex: 999999,
      padding: '20px',
      overflow: 'auto',
      fontFamily: 'monospace',
      fontSize: '12px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>🐛 Context Debug Panel</h3>
        <button 
          onClick={() => setIsVisible(false)}
          style={{ background: 'red', color: 'white', border: 'none', padding: '4px 8px' }}
        >
          ✕
        </button>
      </div>
      
      <div style={{ marginBottom: '10px' }}>
        <strong>Total Logs: {logs.length}</strong>
        <button 
          onClick={() => { debugLogs.length = 0; setLogs([]) }}
          style={{ marginLeft: '10px', background: '#666', color: 'white', border: 'none', padding: '2px 6px' }}
        >
          Clear
        </button>
      </div>
      
      <div>
        {logs.map((log, idx) => (
          <div 
            key={idx} 
            style={{ 
              marginBottom: '8px', 
              padding: '8px', 
              background: log.error ? '#441' : '#114',
              borderLeft: `3px solid ${log.error ? 'red' : 'blue'}`,
              borderRadius: '2px'
            }}
          >
            <div style={{ fontWeight: 'bold', color: log.error ? '#ff6666' : '#66ccff' }}>
              [{log.provider}] {log.event}
            </div>
            <div style={{ fontSize: '10px', opacity: 0.7 }}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </div>
            <div style={{ marginTop: '4px', wordBreak: 'break-word' }}>
              {typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : log.details}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}