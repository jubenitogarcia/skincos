import { describe, expect, it } from 'vitest'

import {
  formatSiteTrackingNumber,
  formatSiteTrackingPercent,
  funnelBarWidth,
  siteTrackingHealthTone,
} from '../SiteTrackingModule'

describe('SiteTrackingModule helpers', () => {
  it('formats numbers and percentages for pt-BR operators', () => {
    expect(formatSiteTrackingNumber(1234)).toBe('1.234')
    expect(formatSiteTrackingPercent(87)).toBe('87%')
    expect(formatSiteTrackingNumber('invalid')).toBe('0')
  })

  it('keeps funnel bars readable with bounded widths', () => {
    expect(funnelBarWidth(50, 100)).toBe('50%')
    expect(funnelBarWidth(0, 100)).toBe('4%')
    expect(funnelBarWidth(200, 100)).toBe('100%')
  })

  it('maps health states to the expected semantic tone classes', () => {
    expect(siteTrackingHealthTone('healthy')).toContain('emerald')
    expect(siteTrackingHealthTone('critical')).toContain('red')
    expect(siteTrackingHealthTone('degraded')).toContain('amber')
  })
})
