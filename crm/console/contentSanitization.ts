export function htmlToPlainText(value: unknown): string {
  const html = String(value || '')
  let text = ''
  let insideTag = false
  for (const char of html) {
    if (char === '<') {
      insideTag = true
      continue
    }
    if (char === '>') {
      insideTag = false
      continue
    }
    if (!insideTag) text += char
  }
  return text.replace(/\s+/g, ' ').trim()
}
