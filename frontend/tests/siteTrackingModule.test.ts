import { describe, expect, it } from 'vitest'

import {
  normalizeSiteTrackingHeaderAction,
  normalizeSiteTrackingHeaderState,
} from '../siteTrackingHeaderBridge'
import {
  DEFAULT_SITE_METRIC_LAYOUT,
  displayEventName,
  displayIncompleteCause,
  formatSiteTrackingNumber,
  formatSiteTrackingPercent,
  funnelBarWidth,
  isInternalPreviewAlert,
  parseSiteMetricLayout,
  shortUrl,
} from '../siteTrackingPresentation'

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

  it('restores invalid metric layout payloads to the default layout', () => {
    expect(parseSiteMetricLayout('not-json')).toEqual(DEFAULT_SITE_METRIC_LAYOUT)
  })

  it('normalizes persisted metric layout and appends missing metrics', () => {
    const layout = parseSiteMetricLayout(JSON.stringify([
      { key: 'facebook', visible: false, width: 9999, height: 20, aspect: '2:1' },
      { key: 'facebook', visible: true, width: 100, height: 100, aspect: '1:1' },
      { key: 'unknown', visible: true },
    ]))

    expect(layout[0]).toMatchObject({
      key: 'facebook',
      visible: false,
      width: 680,
      height: 340,
      aspect: '2:1',
    })
    expect(layout).toHaveLength(DEFAULT_SITE_METRIC_LAYOUT.length)
    expect(layout.filter((item) => item.key === 'facebook')).toHaveLength(1)
  })

  it('keeps operational labels user-facing instead of leaking internal event names', () => {
    expect(displayEventName('whatsapp_redirect_click')).toBe('Clique no WhatsApp')
    expect(displayEventName('booking_confirmed')).toBe('Reserva confirmada')
    expect(displayIncompleteCause('meta_event_id_missing')).toBe('Reserva sem vínculo completo')
    expect(displayIncompleteCause('tracking_context_missing')).toBe('Origem não preservada')
  })

  it('hides local preview alerts from the operational surface', () => {
    expect(isInternalPreviewAlert({
      code: 'LOCAL_PREVIEW_MODE',
      title: 'Modo local controlado',
      message: 'Cenário simulado para validar o preview local.',
    })).toBe(true)
    expect(isInternalPreviewAlert({
      code: 'CAPI_DELIVERY_DROP',
      title: 'Queda no envio de conversões',
      message: 'Revise as últimas falhas.',
    })).toBe(false)
  })

  it('shortens tracked WhatsApp redirect URLs into a readable label', () => {
    expect(shortUrl('https://espacofacial.com/api/whatsapp/redirect?dest=abc&utm_source=meta')).toBe('WhatsApp pelo site')
    expect(shortUrl('https://espacofacial.com/agendamento?unit=novo-hamburgo&service=botox')).toBe('espacofacial.com/agendamento?...')
  })
})

describe('site tracking header bridge', () => {
  it('normalizes header state without accepting invalid sites or windows', () => {
    const state = normalizeSiteTrackingHeaderState({
      refreshing: true,
      selectedSiteId: 'espacofacial.com',
      windowDays: 999,
      sites: [
        { id: 'espacofacial.com', name: 'Espaço Facial', host: 'espacofacial.com', statusTone: 'success' },
        { id: '', name: 'invalid' },
      ],
    })

    expect(state).toMatchObject({
      refreshing: true,
      selectedSiteId: 'espacofacial.com',
      windowDays: 30,
      sites: [{ id: 'espacofacial.com', name: 'Espaço Facial', host: 'espacofacial.com', statusTone: 'success' }],
    })
  })

  it('normalizes valid header actions and rejects invalid payloads', () => {
    expect(normalizeSiteTrackingHeaderAction({ type: 'refresh' })).toEqual({ type: 'refresh' })
    expect(normalizeSiteTrackingHeaderAction({ type: 'connect' })).toEqual({ type: 'connect' })
    expect(normalizeSiteTrackingHeaderAction({ type: 'rename-site' })).toEqual({ type: 'rename-site' })
    expect(normalizeSiteTrackingHeaderAction({ type: 'rename-site', value: 'espacofacial.com' })).toEqual({ type: 'rename-site', value: 'espacofacial.com' })
    expect(normalizeSiteTrackingHeaderAction({ type: 'set-site', value: 'espacofacial.com' })).toEqual({ type: 'set-site', value: 'espacofacial.com' })
    expect(normalizeSiteTrackingHeaderAction({ type: 'set-window', value: 90 })).toEqual({ type: 'set-window', value: 90 })
    expect(normalizeSiteTrackingHeaderAction({ type: 'set-window', value: 15 })).toBeNull()
    expect(normalizeSiteTrackingHeaderAction({ type: 'set-site', value: '' })).toBeNull()
  })
})
