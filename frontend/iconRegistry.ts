import type { ComponentType } from 'react'
import {
    CalendarDots,
    CheckCircle,
    CurrencyDollar,
    FolderOpen,
    FunnelSimple,
    House,
    Package,
    Question,
} from '@phosphor-icons/react'

type IconComponent = ComponentType<{ className?: string }>

const REGISTRY: Record<string, IconComponent> = {
    CalendarDots,
    CheckCircle,
    CurrencyDollar,
    FolderOpen,
    FunnelSimple,
    House,
    Package,
    Question,
}

const aliases: Record<string, keyof typeof REGISTRY> = {
    revenue: 'CurrencyDollar',
    currency: 'CurrencyDollar',
    funnel: 'FunnelSimple',
    success: 'CheckCircle',
}

export function getIcon(name?: string | null): IconComponent {
    const raw = String(name || '').trim()
    const key = (aliases[raw] || raw) as keyof typeof REGISTRY
    return REGISTRY[key] || Question
}

export function validateIconName(name?: string | null): boolean {
    const raw = String(name || '').trim()
    if (!raw) return false
    if (aliases[raw]) return true
    return Boolean(REGISTRY[raw])
}

export function listRegisteredIcons(): string[] {
    const keys = new Set<string>([...Object.keys(REGISTRY), ...Object.keys(aliases)])
    keys.delete('Question')
    return Array.from(keys).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
}
