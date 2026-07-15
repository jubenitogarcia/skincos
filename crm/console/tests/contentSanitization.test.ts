import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from '../contentSanitization'

describe('content sanitization', () => {
  it('turns HTML into inert text without leaving partial tags', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
    expect(htmlToPlainText('<script>alert(1)</script>safe')).toBe('alert(1)safe')
    expect(htmlToPlainText('before <img src=x onerror=alert(1) after')).toBe('before')
  })
})
