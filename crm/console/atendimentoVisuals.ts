export type AtendimentoVisualProfessional = {
  name: string
  alias?: string
  canonicalId?: string
  backgroundColor?: string
}

const FALLBACK_PERSON_PALETTE = [
  '#14b8a6', '#60a5fa', '#a78bfa', '#f59e0b', '#fb7185',
  '#22c55e', '#38bdf8', '#c084fc', '#f97316', '#ec4899',
]

function normalizedKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function hashToIndex(value: string, size: number) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = ((hash * 31) + value.charCodeAt(index)) >>> 0
  return size ? hash % size : 0
}

function safeHex(value?: string) {
  const color = String(value || '').trim()
  return /^#[0-9a-f]{6}$/i.test(color) ? color : ''
}

export function atendimentoEntityColor(label?: string) {
  const key = normalizedKey(String(label || ''))
  return FALLBACK_PERSON_PALETTE[hashToIndex(key || 'atendimento', FALLBACK_PERSON_PALETTE.length)]
}

export function atendimentoProfessionalColor(
  name: string,
  professionals: AtendimentoVisualProfessional[] = [],
) {
  const key = normalizedKey(name)
  const professional = professionals.find((item) => {
    const names = [item.name, item.alias]
      .flatMap((value) => String(value || '').split(/[;,/]/))
      .map(normalizedKey)
    return names.includes(key)
  })
  return safeHex(professional?.backgroundColor) || atendimentoEntityColor(professional?.canonicalId || professional?.name || name)
}

export function atendimentoColorWithAlpha(color: string, alpha: number) {
  const hex = safeHex(color)
  if (!hex) return `rgba(15, 23, 42, ${alpha})`
  const parsed = Number.parseInt(hex.slice(1), 16)
  const red = (parsed >> 16) & 255
  const green = (parsed >> 8) & 255
  const blue = parsed & 255
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`
}
