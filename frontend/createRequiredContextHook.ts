/**
 * createRequiredContextHook - Standardized Context Hook Factory
 * 
 * Creates type-safe context hooks with consistent error handling
 * and actionable error messages for developers.
 */
import { useContext, Context } from 'react'

interface ContextHookOptions {
  hookName: string
  providerName: string
  contextName: string
}

export function createRequiredContextHook<T>(
  context: Context<T | undefined>,
  options: ContextHookOptions
) {
  return function useRequiredContext(): T {
    const value = useContext(context)
    
    if (value === undefined) {
      // Capture detailed debugging information
      const stackTrace = new Error().stack
      const debugInfo = {
        hookName: options.hookName,
        providerName: options.providerName,
        contextName: options.contextName,
        hasContext: !!context,
        hasProvider: typeof window !== 'undefined' && 
          !!(window as any)[`__${options.providerName.toUpperCase()}_MOUNTED__`],
        bootGateReady: typeof window !== 'undefined' && 
          !!(window as any).__BOOT_GATE_READY__,
        stackTrace: stackTrace?.split('\n').slice(0, 5).join('\n')
      }
      
      console.error(`🚨 [${options.hookName}] Context not available!`, debugInfo)
      
      const actionableMessage = [
        `${options.hookName} must be used within ${options.providerName}.`,
        '',
        'Common causes:',
        `• ${options.providerName} not mounted in component tree`,
        '• Hook called outside of provider scope',
        '• Provider initialization order issue',
        '• BootGate not ready (check loading screen)',
        '',
        'Debug info:',
        `• Has Provider: ${debugInfo.hasProvider}`,
        `• BootGate Ready: ${debugInfo.bootGateReady}`,
        '',
        'Solution: Ensure RootProviders wraps your app and includes all providers.'
      ].join('\n')
      
      throw new Error(actionableMessage)
    }
    
    return value
  }
}

// Pre-built hook factories for common contexts
export const createAuthHook = (context: Context<any>) => 
  createRequiredContextHook(context, {
    hookName: 'useAuth',
    providerName: 'AuthProvider', 
    contextName: 'AuthContext'
  })

export const createIntegrationsHook = (context: Context<any>) =>
  createRequiredContextHook(context, {
    hookName: 'useIntegrations',
    providerName: 'IntegrationsProvider',
    contextName: 'IntegrationsContext'  
  })

export const createNotificationsHook = (context: Context<any>) =>
  createRequiredContextHook(context, {
    hookName: 'useNotifications', 
    providerName: 'NotificationProvider',
    contextName: 'NotificationContext'
  })