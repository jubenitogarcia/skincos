import { describe, expect, it } from 'vitest'

import {
  buildMetaAdsCreativeVariationGroups,
  cycleMetaAdsMetricDimensions,
  formatMetaAdsEnumLabel,
  parseMetaAdsOverviewMetricLayout,
} from '../metaAdsPresentation'
import type { MetaAdCreativeRef } from '../metaAdsTypes'

describe('Meta Ads presentation helpers', () => {
  it('normalizes legacy overview metric layouts without losing defaults', () => {
    const layout = parseMetaAdsOverviewMetricLayout(JSON.stringify([
      { key: 'spend', visible: true, width: 300, height: 400, aspect: '3:4' },
      { key: 'spend', visible: false, width: 200, height: 200, aspect: '1:1' },
      { key: 'unknown', visible: true, width: 200, height: 200 },
      { key: 'trend', visible: false, size: 'compact', width: 320, aspect: '2:1' },
    ]))

    const spend = layout.find((item) => item.key === 'spend')
    const trend = layout.find((item) => item.key === 'trend')

    expect(layout.filter((item) => item.key === 'spend')).toHaveLength(1)
    expect(layout).toHaveLength(14)
    expect(spend).toMatchObject({ key: 'spend', visible: true, aspect: '4:3' })
    expect(trend).toMatchObject({ key: 'trend', visible: false, aspect: '2:1' })
  })

  it('cycles metric badges through the supported formats', () => {
    const wide = cycleMetaAdsMetricDimensions(224, 168, '4:3')
    const square = cycleMetaAdsMetricDimensions(wide.width, wide.height, wide.aspect)
    const landscape = cycleMetaAdsMetricDimensions(square.width, square.height, square.aspect)

    expect(wide.aspect).toBe('2:1')
    expect(square.aspect).toBe('1:1')
    expect(landscape.aspect).toBe('4:3')
    expect(wide.width / wide.height).toBeCloseTo(2, 0)
    expect(square.width / square.height).toBeCloseTo(1, 0)
    expect(landscape.width / landscape.height).toBeCloseTo(4 / 3, 0)
  })

  it('separates creative text, CTA, URL and media variations for the ad modal', () => {
    const creative: MetaAdCreativeRef = {
      id: 'cr_1',
      body: 'Texto principal',
      call_to_action_type: 'MESSAGE_PAGE',
      object_url: 'https://example.com',
      asset_feed_spec: {
        bodies: [{ text: 'Texto principal' }, { text: 'Texto alternativo' }],
        titles: [{ text: 'Titulo A' }, { text: 'Titulo B' }],
        descriptions: [{ text: 'Descricao A' }],
        call_to_action_types: ['MESSAGE_PAGE'],
        link_urls: [{ website_url: 'https://example.com' }],
        images: [
          { hash: 'hash_3x4', url: '/media/vertical.jpg', width: 900, height: 1200 },
          { hash: 'hash_2x1', url: '/media/wide.jpg', width: 1200, height: 600 },
        ],
      },
    }

    const groups = buildMetaAdsCreativeVariationGroups(creative, '/fallback.jpg')
    const media = groups.find((group) => group.kind === 'media')
    const texts = groups.find((group) => group.label === 'Textos')
    const ctas = groups.find((group) => group.label === 'CTAs')

    expect(formatMetaAdsEnumLabel('LEAD_GENERATION')).toBe('Geração de Lead')
    expect(texts?.values.map((item) => item.value)).toEqual(['Texto principal', 'Texto alternativo'])
    expect(ctas?.values).toEqual([{ value: 'Enviar mensagem' }])
    expect(media?.values).toEqual([
      expect.objectContaining({ value: '/media/vertical.jpg', previewUrl: '/media/vertical.jpg', aspectLabel: '3x4', mediaKind: 'image' }),
      expect.objectContaining({ value: '/media/wide.jpg', previewUrl: '/media/wide.jpg', aspectLabel: '2x1', mediaKind: 'image' }),
    ])
  })
})
