type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | Record<string, boolean>
  | ClassValue[]

function flattenClassValue(input: ClassValue, out: string[]) {
  if (!input) return
  if (Array.isArray(input)) {
    input.forEach((item) => flattenClassValue(item, out))
    return
  }
  if (typeof input === 'string' || typeof input === 'number') {
    out.push(String(input))
    return
  }
  if (typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (value) out.push(key)
    }
  }
}

export function cn(...classes: ClassValue[]) {
  const out: string[] = []
  classes.forEach((item) => flattenClassValue(item, out))
  return out.join(' ')
}

export function getInitials(name: string): string {
    if (!name) return ''
    const parts = name.trim().split(/\s+/)
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
}

export function getRelativeTime(date: Date | string | number): string {
    const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    const diff = Date.now() - d.getTime()
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m`
    const hrs = Math.floor(min / 60)
    if (hrs < 24) return `${hrs}h`
    const days = Math.floor(hrs / 24)
    return `${days}d`
}

export function formatNumber(value: number | string, options: Intl.NumberFormatOptions = {}): string {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  if (!Number.isFinite(n)) return value == null ? '' : String(value)
  return new Intl.NumberFormat('pt-BR', options).format(n)
}

export function formatCurrency(value: number | string, currency = 'BRL'): string {
  return formatNumber(value, { style: 'currency', currency, maximumFractionDigits: 2 })
}

export function formatDateTime(value: Date | string | number): string {
  const d = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return value == null ? '' : String(value)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function getStatusColor(status?: string | null): string {
  const s = String(status || '').trim().toLowerCase()
  if (['active', 'ativo', 'ok', 'success', 'successful', 'completed', 'done', 'online', 'connected', 'enabled', 'aprovado', 'paid'].includes(s)) {
    return 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30'
  }
  if (['pending', 'waiting', 'in_progress', 'processing', 'paused', 'warning', 'warn', 'atencao', 'attention', 'low', 'medium'].includes(s)) {
    return 'bg-amber-500/10 text-amber-200 border border-amber-500/30'
  }
  if (['error', 'failed', 'inactive', 'disabled', 'cancelled', 'canceled', 'critical', 'overdue'].includes(s)) {
    return 'bg-rose-500/10 text-rose-200 border border-rose-500/30'
  }
  return 'bg-white/10 text-blue-100/80 border border-white/10'
}
