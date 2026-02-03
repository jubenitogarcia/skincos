const pad2 = (n: number) => String(n).padStart(2, '0')

export function shareIndexDayKeyUtc(nowMs = Date.now()): string {
  const d = new Date(nowMs)
  const yyyy = d.getUTCFullYear()
  const mm = pad2(d.getUTCMonth() + 1)
  const dd = pad2(d.getUTCDate())
  return `${yyyy}-${mm}-${dd}`
}

export function shareIndexPrefix(dayKey: string) {
  return `internal/share/index/${dayKey}/`
}

export function shareIndexKey(dayKey: string, shareId: string) {
  return `${shareIndexPrefix(dayKey)}${shareId}.json`
}

