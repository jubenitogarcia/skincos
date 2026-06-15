import { isMetaAdsLocalMockEnabled } from '@/metaAdsLocalMock'

export type TrackingOverviewResponse = {
  ok: boolean
  partial?: boolean
  warnings?: string[]
  generatedAt?: number
  window?: { days: number; sinceIso: string }
  coverage?: {
    confirmedBookings: number
    whatsappClicks: number
    trackingContext: number
    metaEventId: number
    facebookIds: number
    marketingConsent: number
    analyticsConsent: number
    whatsappTracking: number
    scheduleDelivery: number
    contactDelivery: number
  }
  previousCoverage?: {
    trackingContext: number
    facebookIds: number
    marketingConsent: number
  }
  alerts?: Array<{
    severity: 'critical' | 'warning'
    code: string
    title: string
    message: string
  }>
  health?: {
    status: 'healthy' | 'degraded' | 'critical'
    label: string
    summary: string
  }
  siteBehavior?: {
    summary?: {
      events?: number
      sessions?: number
      pageViews?: number
      ctaClicks?: number
      customLinkClicks?: number
      externalLinkClicks?: number
      whatsappRedirectClicks?: number
      bookingStepViews?: number
      bookingStepCompleted?: number
      bookingSubmitAttempts?: number
      bookingConfirmed?: number
    }
    topPages?: Array<{ pagePath: string; count: number }>
    topEntryPages?: Array<{ pagePath: string; count: number }>
    topBookingLandingPages?: Array<{ pagePath: string; count: number }>
    byUnit?: Array<{ unitSlug: string; count: number }>
    byService?: Array<{ serviceId: string; count: number }>
  } | null
  customLinks?: {
    managedUrls?: Array<{
      id: string
      siteHost: string
      name: string
      slugPath: string
      publicUrl: string
      destinationUrl: string
      destinationHost: string | null
      destinationPath: string | null
      description: string | null
      source: string
      placement: string | null
      unitSlug: string | null
      serviceId: string | null
      utmSource: string | null
      utmMedium: string | null
      utmCampaign: string | null
      utmContent: string | null
      utmTerm: string | null
      active: boolean
      createdAtMs: number
      updatedAtMs: number
      clickCount: number
      lastClickAtMs: number | null
    }>
    cloudflareRedirects?: Array<{
      id: string
      siteHost: string
      name: string
      slugPath: string
      publicUrl: string
      destinationUrl: string
      source: 'cloudflare_worker'
      active: boolean
    }>
    topLinks?: Array<{ linkUrl: string; count: number }>
    topUtmContent?: Array<{ utmContent: string; count: number }>
    linksMissingUtm?: Array<{ linkUrl: string; count: number }>
    byPlacement?: Array<{ placement: string; count: number }>
    whatsappByUnit?: Array<{ unitSlug: string; count: number }>
    recentClicks?: Array<{
      id: string
      createdAtMs: number
      eventName: string
      linkUrl: string | null
      linkHost: string | null
      linkPath: string | null
      placement: string | null
      source: string | null
      unitSlug: string | null
      serviceId: string | null
      pagePath: string | null
      utmSource: string | null
      utmCampaign: string | null
      utmContent: string | null
    }>
  } | null
  siteConnections?: {
    selectedSiteHost?: string | null
    sites?: Array<{
      id: string
      siteHost: string
      host: string
      name: string
      statusLabel: string | null
      statusTone: 'success' | 'warning' | 'danger' | 'neutral'
      source: string
      active: boolean
      createdAtMs: number
      updatedAtMs: number
      eventCount: number
      lastEventAtMs: number | null
    }>
  } | null
  siteFunnel?: {
    sessions?: number
    pageViews?: number
    ctaClicks?: number
    bookingStarted?: number
    finalStepOpened?: number
    submitAttempts?: number
    confirmedBookings?: number
    visitToBookingRate?: number
    ctaToBookingRate?: number
  } | null
  behaviorQuality?: {
    eventsWithCampaign?: number
    eventsWithFacebookIds?: number
    analyticsConsentEvents?: number
    marketingConsentEvents?: number
    campaignCoverage?: number
    facebookIdCoverage?: number
    marketingConsentCoverage?: number
  } | null
  reconciliation?: {
    buckets?: Array<{
      bucket: 'sem_origem' | 'origem_first_party' | 'origem_meta_completa'
      label: string
      count: number
      percent: number
    }>
    incompleteBookings?: Array<{
      id: string
      createdAtMs: number
      unitSlug: string
      patient: string | null
      utmSource: string | null
      utmCampaign: string | null
      landingPage: string | null
      metaEventId: string | null
      hasFacebookIds: boolean
      coverageBucket: string
      incompleteCauses: string[]
      primaryCause: string
      scheduleStatus: string | null
    }>
    retryCandidates?: Array<{
      id: string
      createdAtMs: number
      eventName: string
      eventId: string
      bookingId: string | null
      waClickId: string | null
      httpStatus: number | null
      errorMessage: string | null
      normalizedReason: string
    }>
  }
  governance?: {
    campaignRule: string
    validExamples: string[]
    invalidExamples: string[]
    crossDomainAllowlist: Array<{
      host: string
      purpose: string
      allowedFromPublicSite: boolean
    }>
  }
  validationCadence?: {
    smoke: string
    functional: string
    coverageAudit: string
    recurringChecks: string[]
  }
  whatsappContract?: {
    status: string
    lifecycle: string[]
    description: string
  }
  website?: {
    available: boolean
    error?: string
    sourceUrl?: string
    data?: {
      source?: string
      summary?: Record<string, number>
      topSources?: Array<{ utmSource: string; count: number }>
      topCampaigns?: Array<{ utmCampaign: string; count: number }>
      byUnit?: Array<{ unitSlug: string; count: number }>
      recentBookings?: Array<{
        id: string
        createdAtMs: number
        unitSlug: string
        doctorSlug: string
        serviceId: string
        patient: string | null
        whatsapp: string | null
        metaEventId: string | null
        marketingConsent: boolean
        analyticsConsent: boolean
        utmSource: string | null
        utmCampaign: string | null
        utmMedium: string | null
        landingPage: string | null
        hasFacebookIds: boolean
      }>
      recentWhatsappClicks?: Array<{
        id: string
        createdAtMs: number
        eventId: string
        waClickId: string
        placement: string | null
        source: string | null
        unitSlug: string | null
        doctorName: string | null
        bookingId: string | null
        pagePath: string | null
        utmSource: string | null
        utmCampaign: string | null
      }>
      recentCapiIssues?: Array<{
        id: string
        createdAtMs: number
        eventName: string
        eventId: string
        bookingId: string | null
        waClickId: string | null
        httpStatus: number | null
        errorMessage: string | null
        normalizedReason?: string
        retryable?: boolean
      }>
    }
  }
  whatsapp?: {
    available: boolean
    error?: string
    data?: {
      summary?: Record<string, number>
      stages?: Array<{ funnelStatus: string; count: number }>
      topSources?: Array<{ utmSource: string; count: number }>
      topCampaigns?: Array<{ utmCampaign: string; count: number }>
      recentConversations?: Array<{
        id: string
        unitSlug: string
        waClickId: string
        funnelStatus: string
        needsHuman: boolean
        updatedAt: string
        lastMessageAt: string | null
        phone: string | null
        externalId: string | null
        utmSource: string | null
        utmCampaign: string | null
      }>
      recentAppointments?: Array<{
        id: string
        unitSlug: string | null
        waClickId: string
        status: string
        startAt: string | null
        createdAt: string
        phone: string | null
        externalId: string | null
        utmSource: string | null
        utmCampaign: string | null
      }>
    }
  }
}

export function isMetaTrackingLocalMockEnabled() {
  return isMetaAdsLocalMockEnabled()
}

export function getMetaTrackingLocalOverview(days = 30): TrackingOverviewResponse {
  const now = Date.now()
  return {
    ok: true,
    generatedAt: now,
    partial: false,
    warnings: ['tracking_local_preview'],
    window: {
      days,
      sinceIso: new Date(now - days * 24 * 60 * 60 * 1000).toISOString(),
    },
    coverage: {
      confirmedBookings: 28,
      whatsappClicks: 63,
      trackingContext: 96,
      metaEventId: 93,
      facebookIds: 89,
      marketingConsent: 98,
      analyticsConsent: 95,
      whatsappTracking: 100,
      scheduleDelivery: 94,
      contactDelivery: 97,
    },
    previousCoverage: {
      trackingContext: 88,
      facebookIds: 81,
      marketingConsent: 96,
    },
    alerts: [
      {
        severity: 'warning',
        code: 'LOCAL_PREVIEW_MODE',
        title: 'Modo local controlado',
        message: 'Este painel usa um cenário simulado para validar a experiência do módulo Meta Ads antes do deploy.',
      },
    ],
    health: {
      status: 'healthy',
      label: 'Tracking íntegro no preview local',
      summary: 'Atributos first-party, Schedule via CAPI e cliques WhatsApp estão consistentes neste cenário de teste.',
    },
    siteBehavior: {
      summary: {
        events: 420,
        sessions: 118,
        pageViews: 226,
        ctaClicks: 54,
        customLinkClicks: 18,
        externalLinkClicks: 9,
        whatsappRedirectClicks: 31,
        bookingStepViews: 37,
        bookingStepCompleted: 104,
        bookingSubmitAttempts: 29,
        bookingConfirmed: 28,
      },
      topPages: [
        { pagePath: '/agendamento?unit=novo-hamburgo&service=botox', count: 74 },
        { pagePath: '/', count: 52 },
        { pagePath: '/barrashoppingsul', count: 31 },
      ],
      topEntryPages: [
        { pagePath: '/agendamento?unit=novo-hamburgo&service=botox', count: 41 },
        { pagePath: '/', count: 29 },
      ],
      topBookingLandingPages: [
        { pagePath: '/agendamento?unit=novo-hamburgo&service=botox', count: 16 },
        { pagePath: '/', count: 8 },
      ],
      byUnit: [
        { unitSlug: 'novo-hamburgo', count: 67 },
        { unitSlug: 'barrashoppingsul', count: 44 },
      ],
      byService: [
        { serviceId: 'botox', count: 48 },
        { serviceId: 'preenchimento-labial', count: 19 },
      ],
    },
    customLinks: {
      managedUrls: [
        {
          id: 'url_preview_1',
          siteHost: 'espacofacial.com',
          name: 'Botox Novo Hamburgo Meta',
          slugPath: '/campanhas/botox-novo-hamburgo-meta',
          publicUrl: 'https://espacofacial.com/campanhas/botox-novo-hamburgo-meta',
          destinationUrl: 'https://espacofacial.com/agendamento?unit=novo-hamburgo&service=botox&utm_source=meta&utm_medium=paid_social&utm_campaign=botox_novo_hamburgo&utm_content=video_botox_nh_01',
          destinationHost: 'espacofacial.com',
          destinationPath: '/agendamento?unit=novo-hamburgo&service=botox&utm_source=meta&utm_medium=paid_social&utm_campaign=botox_novo_hamburgo&utm_content=video_botox_nh_01',
          description: 'URL principal para anúncios de botox em Novo Hamburgo.',
          source: 'manual',
          placement: 'meta_ads',
          unitSlug: 'novo-hamburgo',
          serviceId: 'botox',
          utmSource: 'meta',
          utmMedium: 'paid_social',
          utmCampaign: 'botox_novo_hamburgo',
          utmContent: 'video_botox_nh_01',
          utmTerm: null,
          active: true,
          createdAtMs: now - 12 * 24 * 60 * 60 * 1000,
          updatedAtMs: now - 60 * 60 * 1000,
          clickCount: 18,
          lastClickAtMs: now - 30 * 60 * 1000,
        },
      ],
      topLinks: [
        { linkUrl: 'https://espacofacial.com/agendamento?unit=novo-hamburgo&service=botox&utm_source=meta', count: 18 },
        { linkUrl: 'https://espacofacial.com/api/whatsapp/redirect?dest=...', count: 12 },
      ],
      topUtmContent: [
        { utmContent: 'video_botox_nh_01', count: 21 },
        { utmContent: 'story_bss_02', count: 9 },
      ],
      linksMissingUtm: [
        { linkUrl: 'https://espacofacial.com/agendamento', count: 4 },
      ],
      byPlacement: [
        { placement: 'header', count: 18 },
        { placement: 'booking_page', count: 14 },
      ],
      whatsappByUnit: [
        { unitSlug: 'novo-hamburgo', count: 18 },
        { unitSlug: 'barrashoppingsul', count: 13 },
      ],
      recentClicks: [
        {
          id: 'click_preview_1',
          createdAtMs: now - 30 * 60 * 1000,
          eventName: 'whatsapp_redirect_click',
          linkUrl: 'https://espacofacial.com/api/whatsapp/redirect?dest=...',
          linkHost: 'espacofacial.com',
          linkPath: '/api/whatsapp/redirect',
          placement: 'booking_page',
          source: 'whatsapp',
          unitSlug: 'novo-hamburgo',
          serviceId: 'botox',
          pagePath: '/agendamento',
          utmSource: 'meta',
          utmCampaign: 'botox_novo_hamburgo',
          utmContent: 'video_botox_nh_01',
        },
      ],
    },
    siteConnections: {
      selectedSiteHost: 'espacofacial.com',
      sites: [
        {
          id: 'espacofacial.com',
          siteHost: 'espacofacial.com',
          host: 'espacofacial.com',
          name: 'espacofacial.com',
          statusLabel: 'Domínio principal',
          statusTone: 'success',
          source: 'system',
          active: true,
          createdAtMs: now - 30 * 24 * 60 * 60 * 1000,
          updatedAtMs: now - 60 * 60 * 1000,
          eventCount: 420,
          lastEventAtMs: now - 10 * 60 * 1000,
        },
      ],
    },
    siteFunnel: {
      sessions: 118,
      pageViews: 226,
      ctaClicks: 103,
      bookingStarted: 104,
      finalStepOpened: 37,
      submitAttempts: 29,
      confirmedBookings: 28,
      visitToBookingRate: 24,
      ctaToBookingRate: 27,
    },
    behaviorQuality: {
      eventsWithCampaign: 338,
      eventsWithFacebookIds: 291,
      analyticsConsentEvents: 420,
      marketingConsentEvents: 392,
      campaignCoverage: 80,
      facebookIdCoverage: 69,
      marketingConsentCoverage: 93,
    },
    reconciliation: {
      buckets: [
        { bucket: 'origem_meta_completa', label: 'Origem Meta completa', count: 21, percent: 75 },
        { bucket: 'origem_first_party', label: 'Origem first-party', count: 5, percent: 18 },
        { bucket: 'sem_origem', label: 'Sem origem', count: 2, percent: 7 },
      ],
      incompleteBookings: [
        {
          id: 'bk_102',
          createdAtMs: now - 5 * 60 * 60 * 1000,
          unitSlug: 'barra-shopping-sul',
          patient: 'Paciente Preview',
          utmSource: 'instagram',
          utmCampaign: 'campanha-whatsapp-facial',
          landingPage: '/botox-barra',
          metaEventId: null,
          hasFacebookIds: true,
          coverageBucket: 'origem_first_party',
          incompleteCauses: ['meta_event_id_missing'],
          primaryCause: 'Meta Event ID ausente no booking confirmado',
          scheduleStatus: 'sent',
        },
      ],
      retryCandidates: [
        {
          id: 'retry_01',
          createdAtMs: now - 2 * 60 * 60 * 1000,
          eventName: 'Schedule',
          eventId: 'sched_preview_01',
          bookingId: 'bk_102',
          waClickId: 'wa_preview_01',
          httpStatus: 500,
          errorMessage: 'temporary upstream timeout',
          normalizedReason: 'retryable_timeout',
        },
      ],
    },
    governance: {
      campaignRule: 'utm_campaign deve espelhar o identificador operacional da campanha Meta',
      validExamples: ['meta-whatsapp-botox-barra', 'meta-leads-limpeza-centro'],
      invalidExamples: ['campanha nova', 'teste', 'ads maio'],
      crossDomainAllowlist: [
        { host: 'espacofacial.com', purpose: 'Site institucional', allowedFromPublicSite: true },
        { host: 'crm.skincos.com.br', purpose: 'CRM interno', allowedFromPublicSite: false },
      ],
    },
    validationCadence: {
      smoke: 'a cada ajuste de UX do módulo',
      functional: 'antes de publicar Meta Ads',
      coverageAudit: 'semanal',
      recurringChecks: ['tracking_context', 'Schedule CAPI', 'cliques WhatsApp', 'inventory Meta'],
    },
    whatsappContract: {
      status: 'ativo',
      lifecycle: ['click', 'redirect', 'conversation', 'appointment'],
      description: 'O fluxo first-party continua sendo a ponte entre clique, conversa e agendamento atribuído.',
    },
    website: {
      available: true,
      sourceUrl: 'https://espacofacial.com',
      data: {
        summary: {
          confirmedBookings: 28,
          whatsappClicks: 63,
          bookingsWithTrackingContext: 27,
          bookingsWithMetaEventId: 26,
          bookingsWithFacebookIds: 25,
          bookingsWithMarketingConsent: 28,
          bookingsWithAnalyticsConsent: 27,
          whatsappClicksWithTrackingContext: 63,
          capiScheduleOk: 17,
          capiScheduleFailed: 1,
          capiContactOk: 31,
          capiContactFailed: 1,
        },
        topSources: [
          { utmSource: 'instagram', count: 16 },
          { utmSource: 'facebook', count: 7 },
          { utmSource: 'google', count: 5 },
        ],
        topCampaigns: [
          { utmCampaign: 'meta-whatsapp-botox-barra', count: 11 },
          { utmCampaign: 'meta-leads-limpeza-centro', count: 8 },
          { utmCampaign: 'google-institucional-maio', count: 4 },
        ],
        byUnit: [
          { unitSlug: 'barra-shopping-sul', count: 14 },
          { unitSlug: 'centro', count: 9 },
          { unitSlug: 'nilo-peçanha', count: 5 },
        ],
      },
    },
    whatsapp: {
      available: true,
      data: {
        summary: {
          conversations_total: 19,
          appointments_total: 7,
        },
        stages: [
          { funnelStatus: 'new', count: 6 },
          { funnelStatus: 'qualified', count: 8 },
          { funnelStatus: 'appointment_booked', count: 5 },
        ],
        topSources: [
          { utmSource: 'instagram', count: 12 },
          { utmSource: 'facebook', count: 4 },
        ],
        topCampaigns: [
          { utmCampaign: 'meta-whatsapp-botox-barra', count: 10 },
          { utmCampaign: 'meta-leads-limpeza-centro', count: 4 },
        ],
      },
    },
  }
}
