// Lightweight, test-friendly KV store and React hook
import { useEffect, useRef, useState } from 'react'

type KVStore = Record<string, any>
const store: KVStore = {}

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
    const initial = (key in store ? (store[key] as T) : defaultValue)
    const [value, setValue] = useState<T>(initial)
    const keyRef = useRef(key)
    keyRef.current = key

    useEffect(() => {
        // Ensure a value exists for the key
        if (!(key in store)) {
            store[key] = defaultValue
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
    }, [key, defaultValue])

    const update = (next: T | ((prev: T) => T)) => {
        const prev = (key in store ? (store[key] as T) : defaultValue)
        const nextValue = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        store[key] = nextValue
        setValue(nextValue)
        notify(key, nextValue)
    }

    return [value, update]
}

export default spark
