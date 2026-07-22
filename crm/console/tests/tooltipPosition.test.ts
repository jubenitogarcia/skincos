import { describe, expect, it } from 'vitest'
import { calculateFollowCursorPosition } from '@/tooltip'

describe('follow-cursor tooltip positioning', () => {
  it('anchors beside the cursor while there is viewport space', () => {
    expect(calculateFollowCursorPosition(
      { x: 250, y: 229 },
      { width: 280, height: 150 },
      { width: 1186, height: 698 },
    )).toEqual({ left: 264, top: 243 })
  })

  it('flips before the cursor close to the lower-right viewport edge', () => {
    expect(calculateFollowCursorPosition(
      { x: 1170, y: 680 },
      { width: 280, height: 150 },
      { width: 1186, height: 698 },
    )).toEqual({ left: 876, top: 516 })
  })

  it('keeps oversized content within the viewport padding', () => {
    expect(calculateFollowCursorPosition(
      { x: 8, y: 8 },
      { width: 400, height: 300 },
      { width: 390, height: 844 },
    )).toEqual({ left: 12, top: 22 })
  })
})
