// Lightweight, test-friendly KV store and React hook
import { useCallback, useEffect, useRef, useState } from 'react'

type KVStore = Record<string, any>
const store: KVStore = {}

export const ZERO_DEMO_MODE = true

const DEMO_DEFAULT_OVERRIDES = new Map<string, any>([
  ['user-points', 0],
  ['user-level', 1],
  ['user-streak', 0],
])

const DEMO_KEYS = new Set<string>([
  'achievements',
  'alert-configurations',
  'alert-notifications',
  'api-integrations',
  'assets',
  'audience-insights',
  'audit-logs',
  'backup-history',
  'backup-jobs',
  'bill_of_materials',
  'chart_of_accounts',
  'challenges',
  'chat-conversations',
  'chat-messages',
  'coaching-insights',
  'coaching-recommendations',
  'companies',
  'company_settings',
  'conversation-analyses',
  'crisis-alerts',
  'custom-objects',
  'custom-records',
  'depreciation_entries',
  'financial_reports',
  'hr-attendance',
  'hr-employees',
  'hr-leaves',
  'hr-payroll',
  'instagram-comments',
  'instagram-followers',
  'instagram-insights',
  'instagram-posts',
  'instagram-stories',
  'journal_entries',
  'kanban-columns',
  'kanban-tasks',
  'knowledge-base',
  'krayin-activities',
  'krayin-email-campaigns',
  'krayin-email-segments',
  'krayin-email-templates',
  'krayin-leads',
  'krayin-pipelines',
  'krayin-products',
  'krayin-quotes',
  'krayin-web-forms',
  'lead-scores',
  'leaderboard',
  'learning-paths',
  'maintenance_records',
  'meta-accounts',
  'meta-alerts-realtime',
  'meta-campaigns',
  'meta-campaigns-unified',
  'meta-conversations',
  'meta-mentions',
  'meta-posts',
  'meta-sync-operations',
  'meta-sync-platforms',
  'metric-thresholds',
  'notifications',
  'performance-alerts',
  'performance-alerts-system',
  'performance-insights',
  'performance-metrics',
  'permission-users',
  'permissions',
  'predictive-insights',
  'procurement-invoices',
  'procurement-orders',
  'procurement-requests',
  'procurement-suppliers',
  'production_plans',
  'projects',
  'recordings-list',
  'reports',
  'restore-points',
  'rewards',
  'rich-tasks',
  'roi-metrics',
  'roles',
  'routing-logs',
  'scoring-rules',
  'scoring-templates',
  'security-policies',
  'sentiment-trends',
  'skill-metrics',
  'smart-notifications',
  'support-agents',
  'support-tickets',
  'system-alerts',
  'system-roles',
  'system-settings',
  'system-teams',
  'system-users',
  'territories',
  'threads-followers',
  'threads-posts',
  'threads-threads',
  'threads-trending',
  'time-entries',
  'user_company_access',
  'webhook-endpoints',
  'webhook-events',
  'webhook-logs',
  'whatsapp-broadcasts',
  'whatsapp-contacts',
  'whatsapp-messages',
  'whatsapp-templates',
  'work_orders',
  'workflow_history',
  'workflow_instances',
  'workflows',
  'workstations',
  'chat-agents',
  'agent-metrics',
])

function sanitizeDefaultValue<T = any>(key: string, defaultValue: T): T {
  if (!ZERO_DEMO_MODE) return defaultValue
  if (DEMO_DEFAULT_OVERRIDES.has(key)) return DEMO_DEFAULT_OVERRIDES.get(key)
  if (!DEMO_KEYS.has(key)) return defaultValue
  if (Array.isArray(defaultValue)) return [] as unknown as T
  return defaultValue
}

export function isDemoEnabled(): boolean {
  return !ZERO_DEMO_MODE
}

// Simple pub/sub per key so multiple components stay in sync
const listeners = new Map<string, Set<(v: any) => void>>()
function notify(key: string, value: any) {
    const set = listeners.get(key)
    if (!set) return
    for (const cb of set) {
        try { cb(value) } catch { /* ignore */ }
    }
}

export const spark = {
    kv: {
        async get<T = any>(key: string): Promise<T | undefined> {
            return store[key]
        },
        async set<T = any>(key: string, value: T): Promise<void> {
            store[key] = value
            notify(key, value)
        },
        async del(key: string): Promise<void> {
            delete store[key]
            notify(key, undefined)
        }
    }
}

// React hook that mirrors a basic useState persisted by key
export function useKV<T = any>(key: string, defaultValue: T): [T, (next: T | ((prev: T) => T)) => void] {
    // Initialize from store or default (without writing to store yet)
    const safeDefault = sanitizeDefaultValue(key, defaultValue)
    const initial = (key in store ? (store[key] as T) : safeDefault)
    const [value, setValue] = useState<T>(initial)
    const keyRef = useRef(key)
    keyRef.current = key
    const defaultRef = useRef(safeDefault)
    defaultRef.current = safeDefault

    useEffect(() => {
        // Ensure a value exists for the key
        if (!(key in store)) {
            store[key] = safeDefault
        }

        // Subscribe to changes for this key
        let setForKey = listeners.get(key)
        if (!setForKey) {
            setForKey = new Set()
            listeners.set(key, setForKey)
        }
        const cb = (v: any) => setValue(v as T)
        setForKey.add(cb)

        // Sync with current store value in case it changed before subscription
        if (key in store) {
            setValue(store[key] as T)
        }

        return () => {
            const current = listeners.get(key)
            if (current) {
                current.delete(cb)
                if (current.size === 0) listeners.delete(key)
            }
        }
    }, [key, safeDefault])

    // Stable setter: many components put this function into `useEffect` deps.
    // If its identity changes on every render, it can create request storms.
    const update = useCallback((next: T | ((prev: T) => T)) => {
        const currentKey = keyRef.current
        const currentDefault = defaultRef.current
        const prev = (currentKey in store ? (store[currentKey] as T) : currentDefault)
        const nextValue = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        store[currentKey] = nextValue
        setValue(nextValue)
        notify(currentKey, nextValue)
    }, [])

    return [value, update]
}

export default spark
