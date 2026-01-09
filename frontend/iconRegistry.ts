import * as Phosphor from '@phosphor-icons/react'

const aliases: Record<string, keyof typeof Phosphor> = {
    revenue: 'CurrencyDollar',
    currency: 'CurrencyDollar',
    funnel: 'FunnelSimple'
}

export function getIcon(name: string): any {
    const key = aliases[name] || (name as keyof typeof Phosphor)
    return (Phosphor as any)[key] || (Phosphor as any).Question
}

export function validateIconName(name: string): boolean {
    if (aliases[name]) return true
    return Boolean((Phosphor as any)[name])
}

export function listRegisteredIcons(): string[] {
    return Object.keys(aliases)
}
