// Local fallback for @github/spark/hooks
// Provides simple in-memory KV (non-persistent across reloads) to avoid runtime import errors
import { useState, useEffect } from 'react'

const store: Record<string, any> = {}

export function useKV<T = any>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
    const [value, setValue] = useState<T>(() => {
        return key in store ? store[key] : initial
    })

    useEffect(() => {
        store[key] = value
    }, [key, value])

    const update = (v: T | ((prev: T) => T)) => {
        setValue(prev => typeof v === 'function' ? (v as any)(prev) : v)
    }

    return [value, update]
}
