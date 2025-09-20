import { useState, useEffect, useCallback } from 'react'
import { useKV } from '@/lib/spark-mock'
import { toast } from 'sonner'

interface MetaPlatform {
  id: string
  name: string
  status: 'connected' | 'disconnected' | 'syncing' | 'error'
  lastSync: Date
  syncProgress: number
  features: {
    messages: boolean
    posts: boolean
    stories: boolean
    ads: boolean
    insights: boolean
  }
  credentials: {
    accessToken?: string
    businessId?: string
    pageId?: string
    accountId?: string
  }
  rateLimits: {
    requests: number
    remaining: number
    resetTime: Date
  }
  errors: string[]
}

interface SyncOperation {
  id: string
  platform: string
  type: 'full' | 'incremental' | 'realtime'
  status: 'pending' | 'running' | 'completed' | 'failed'
  startTime: Date
  endTime?: Date
  progress: number
  itemsProcessed: number
  totalItems: number
  errors: string[]
}

interface MetaData {
  conversations: any[]
  posts: any[]
  stories: any[]
  ads: any[]
  insights: any[]
  followers: any[]
  lastUpdated: Date
}

export function useMetaSync() {
  const [platforms, setPlatforms] = useKV<MetaPlatform[]>('meta-sync-platforms', [])
  const [operations, setOperations] = useKV<SyncOperation[]>('meta-sync-operations', [])
  const [unifiedData, setUnifiedData] = useKV<MetaData>('meta-unified-data', {
    conversations: [],
    posts: [],
    stories: [],
    ads: [],
    insights: [],
    followers: [],
    lastUpdated: new Date()
  })
  const [isGlobalSync, setIsGlobalSync] = useState(false)
  const [syncQueue, setSyncQueue] = useState<string[]>([])

  // Initialize platforms data
  useEffect(() => {
    if (platforms.length === 0) {
      setPlatforms([
        {
          id: 'facebook',
          name: 'Facebook',
          status: 'connected',
          lastSync: new Date(Date.now() - 15 * 60000),
          syncProgress: 100,
          features: {
            messages: true,
            posts: true,
            stories: true,
            ads: true,
            insights: true
          },
          credentials: {
            accessToken: 'fb_token_***',
            businessId: 'fb_business_123',
            pageId: 'fb_page_456'
          },
          rateLimits: {
            requests: 200,
            remaining: 156,
            resetTime: new Date(Date.now() + 60 * 60000)
          },
          errors: []
        },
        {
          id: 'instagram',
          name: 'Instagram',
          status: 'connected',
          lastSync: new Date(Date.now() - 8 * 60000),
          syncProgress: 100,
          features: {
            messages: true,
            posts: true,
            stories: true,
            ads: true,
            insights: true
          },
          credentials: {
            accessToken: 'ig_token_***',
            businessId: 'ig_business_789',
            accountId: 'ig_account_012'
          },
          rateLimits: {
            requests: 200,
            remaining: 184,
            resetTime: new Date(Date.now() + 45 * 60000)
          },
          errors: []
        },
        {
          id: 'whatsapp',
          name: 'WhatsApp Business',
          status: 'syncing',
          lastSync: new Date(Date.now() - 2 * 60000),
          syncProgress: 73,
          features: {
            messages: true,
            posts: false,
            stories: false,
            ads: false,
            insights: true
          },
          credentials: {
            accessToken: 'wa_token_***',
            businessId: 'wa_business_345'
          },
          rateLimits: {
            requests: 1000,
            remaining: 856,
            resetTime: new Date(Date.now() + 30 * 60000)
          },
          errors: []
        },
        {
          id: 'threads',
          name: 'Threads',
          status: 'error',
          lastSync: new Date(Date.now() - 120 * 60000),
          syncProgress: 0,
          features: {
            messages: false,
            posts: true,
            stories: false,
            ads: false,
            insights: true
          },
          credentials: {},
          rateLimits: {
            requests: 100,
            remaining: 0,
            resetTime: new Date(Date.now() + 90 * 60000)
          },
          errors: ['API access token expired', 'Rate limit exceeded']
        }
      ])
    }
  }, [platforms.length, setPlatforms])

  // Simulate sync operations
  const startSync = useCallback(async (platformId: string, type: 'full' | 'incremental' | 'realtime' = 'incremental') => {
    const operation: SyncOperation = {
      id: `sync_${Date.now()}`,
      platform: platformId,
      type,
      status: 'pending',
      startTime: new Date(),
      progress: 0,
      itemsProcessed: 0,
      totalItems: type === 'full' ? 1000 : 100,
      errors: []
    }

    setOperations(current => [operation, ...current.slice(0, 9)]) // Keep last 10

    // Update platform status
    setPlatforms(current =>
      current.map(platform =>
        platform.id === platformId
          ? { ...platform, status: 'syncing', syncProgress: 0 }
          : platform
      )
    )

    // Simulate sync progress
    const progressInterval = setInterval(() => {
      setOperations(current =>
        current.map(op => {
          if (op.id === operation.id && op.status === 'running') {
            const newProgress = Math.min(op.progress + Math.random() * 15, 100)
            const itemsProcessed = Math.floor((newProgress / 100) * op.totalItems)

            return {
              ...op,
              progress: newProgress,
              itemsProcessed
            }
          }
          return op
        })
      )

      setPlatforms(current =>
        current.map(platform =>
          platform.id === platformId
            ? { ...platform, syncProgress: Math.min(platform.syncProgress + Math.random() * 15, 100) }
            : platform
        )
      )
    }, 500)

    // Complete sync after random time
    setTimeout(() => {
      clearInterval(progressInterval)

      const success = Math.random() > 0.1 // 90% success rate

      setOperations(current =>
        current.map(op =>
          op.id === operation.id
            ? {
              ...op,
              status: success ? 'completed' : 'failed',
              endTime: new Date(),
              progress: success ? 100 : op.progress,
              errors: success ? [] : ['Network timeout', 'API rate limit exceeded']
            }
            : op
        )
      )

      setPlatforms(current =>
        current.map(platform =>
          platform.id === platformId
            ? {
              ...platform,
              status: success ? 'connected' : 'error',
              lastSync: success ? new Date() : platform.lastSync,
              syncProgress: success ? 100 : platform.syncProgress,
              errors: success ? [] : ['Sync failed - please retry']
            }
            : platform
        )
      )

      if (success) {
        toast.success(`${platformId} sincronizado com sucesso!`)
        // Update unified data
        setUnifiedData(current => ({
          ...current,
          lastUpdated: new Date()
        }))
      } else {
        toast.error(`Falha na sincronização do ${platformId}`)
      }
    }, Math.random() * 5000 + 2000) // 2-7 seconds

    // Start the operation
    setTimeout(() => {
      setOperations(current =>
        current.map(op =>
          op.id === operation.id ? { ...op, status: 'running' } : op
        )
      )
    }, 100)

  }, [setOperations, setPlatforms, setUnifiedData])

  const startGlobalSync = useCallback(async () => {
    setIsGlobalSync(true)
    toast.info('Iniciando sincronização global...')

    const connectedPlatforms = platforms.filter(p => p.status === 'connected' || p.status === 'error')

    for (const platform of connectedPlatforms) {
      await new Promise(resolve => setTimeout(resolve, 1000)) // Stagger syncs
      await startSync(platform.id, 'incremental')
    }

    setTimeout(() => {
      setIsGlobalSync(false)
      toast.success('Sincronização global concluída!')
    }, 8000)
  }, [platforms, startSync])

  const connectPlatform = useCallback(async (platformId: string) => {
    setPlatforms(current =>
      current.map(platform =>
        platform.id === platformId
          ? { ...platform, status: 'syncing' }
          : platform
      )
    )

    // Simulate OAuth flow
    setTimeout(() => {
      const success = Math.random() > 0.2 // 80% success rate

      setPlatforms(current =>
        current.map(platform =>
          platform.id === platformId
            ? {
              ...platform,
              status: success ? 'connected' : 'error',
              credentials: success ? { accessToken: `${platformId}_token_***` } : platform.credentials,
              errors: success ? [] : ['Authentication failed']
            }
            : platform
        )
      )

      if (success) {
        toast.success(`${platformId} conectado com sucesso!`)
        startSync(platformId, 'full')
      } else {
        toast.error(`Falha ao conectar ${platformId}`)
      }
    }, 2000)
  }, [setPlatforms, startSync])

  const disconnectPlatform = useCallback((platformId: string) => {
    setPlatforms(current =>
      current.map(platform =>
        platform.id === platformId
          ? {
            ...platform,
            status: 'disconnected',
            credentials: {},
            errors: []
          }
          : platform
      )
    )
    toast.success(`${platformId} desconectado`)
  }, [setPlatforms])

  const retryFailedSync = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (operation) {
      startSync(operation.platform, operation.type)
    }
  }, [operations, startSync])

  const clearErrors = useCallback((platformId: string) => {
    setPlatforms(current =>
      current.map(platform =>
        platform.id === platformId
          ? { ...platform, errors: [] }
          : platform
      )
    )
  }, [setPlatforms])

  // Auto-sync every 10 minutes for connected platforms
  useEffect(() => {
    const interval = setInterval(() => {
      // Ensure lastSync is Date objects (hydrate if serialized inadvertently)
      const platformsHydrated = platforms.map(p => ({
        ...p,
        lastSync: p.lastSync instanceof Date ? p.lastSync : new Date(p.lastSync as any)
      }))
      const connectedPlatforms = platformsHydrated.filter(p =>
        p.status === 'connected' &&
        Date.now() - p.lastSync.getTime() > 10 * 60 * 1000 // 10 minutes
      )

      connectedPlatforms.forEach(platform => {
        if (Math.random() > 0.7) { // 30% chance for each platform
          startSync(platform.id, 'realtime')
        }
      })
    }, 60000) // Check every minute

    return () => clearInterval(interval)
  }, [platforms, startSync])

  // Calculate overall sync health
  const lastSyncTimes = platforms.map(p => (p.lastSync instanceof Date ? p.lastSync : new Date(p.lastSync as any)).getTime())
  const syncHealth = {
    connected: platforms.filter(p => p.status === 'connected').length,
    total: platforms.length,
    lastGlobalSync: lastSyncTimes.length ? Math.min(...lastSyncTimes) : Date.now(),
    hasErrors: platforms.some(p => p.errors.length > 0),
    activeOperations: operations.filter(op => op.status === 'running').length
  }

  return {
    platforms,
    operations,
    unifiedData,
    isGlobalSync,
    syncHealth,
    startSync,
    startGlobalSync,
    connectPlatform,
    disconnectPlatform,
    retryFailedSync,
    clearErrors
  }
}
