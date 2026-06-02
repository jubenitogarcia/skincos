import { createPgPool } from '../server/harmonia/store/pg.js'

const DEFAULT_WEBSITE_BASE_URL = 'https://espacofacial.com'
const DEFAULT_CACHE_TTL_MS = 30_000

let pool = null
let cache = null

function getPool() {
    if (pool) return pool
    pool = createPgPool(process.env.DATABASE_URL)
    return pool
}

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.min(parsed, max)
}

function sanitizeBaseUrl(value) {
    const raw = String(value || DEFAULT_WEBSITE_BASE_URL).trim()
    if (!raw) return DEFAULT_WEBSITE_BASE_URL
    return raw.replace(/\/+$/, '')
}

function maskPhone(value) {
    const digits = String(value || '').replace(/\D/g, '')
    if (!digits) return null
    if (digits.length <= 4) return digits
    return `${digits.slice(0, Math.min(4, digits.length - 4))}...${digits.slice(-4)}`
}

function readJsonPathString(input, paths) {
    if (!input || typeof input !== 'object') return null
    for (const path of paths) {
        let current = input
        let ok = true
        for (const segment of path) {
            if (!current || typeof current !== 'object' || !(segment in current)) {
                ok = false
                break
            }
            current = current[segment]
        }
        if (ok && typeof current === 'string' && current.trim()) return current.trim()
    }
    return null
}

async function fetchWebsiteTrackingOverview({ days, limit, offsetDays = 0 }) {
    const baseUrl = sanitizeBaseUrl(process.env.TRACKING_WEBSITE_BASE_URL)
    const token = String(process.env.TRACKING_DASHBOARD_TOKEN || '').trim()
    const requestUrl = new URL('/api/tracking/dashboard', baseUrl)
    requestUrl.searchParams.set('days', String(days))
    requestUrl.searchParams.set('limit', String(limit))
    requestUrl.searchParams.set('offsetDays', String(offsetDays))

    const headers = { accept: 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`

    try {
        const response = await fetch(requestUrl, { headers })
        const text = await response.text()
        let data = null
        try {
            data = text ? JSON.parse(text) : null
        } catch {
            data = null
        }
        if (!response.ok) {
            return {
                available: false,
                status: response.status,
                sourceUrl: requestUrl.toString(),
                error: data?.error || `HTTP ${response.status}`,
            }
        }
        return {
            available: true,
            status: response.status,
            sourceUrl: requestUrl.toString(),
            data,
        }
    } catch (error) {
        return {
            available: false,
            status: 0,
            sourceUrl: requestUrl.toString(),
            error: error instanceof Error ? error.message : 'website_fetch_failed',
        }
    }
}

function toNumber(value) {
    const parsed = Number(value || 0)
    return Number.isFinite(parsed) ? parsed : 0
}

function percent(numerator, denominator) {
    if (!denominator) return 0
    return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)))
}

function normalizeCapiIssueReason(reason) {
    return String(reason || '').trim() || 'delivery_failed'
}

function buildCoverage(summary = {}) {
    const confirmedBookings = toNumber(summary.confirmedBookings)
    const whatsappClicks = toNumber(summary.whatsappClicks)
    const scheduleOk = toNumber(summary.capiScheduleOk)
    const scheduleFailed = toNumber(summary.capiScheduleFailed)
    const contactOk = toNumber(summary.capiContactOk)
    const contactFailed = toNumber(summary.capiContactFailed)

    return {
        confirmedBookings,
        whatsappClicks,
        trackingContext: percent(toNumber(summary.bookingsWithTrackingContext), confirmedBookings),
        metaEventId: percent(toNumber(summary.bookingsWithMetaEventId), confirmedBookings),
        facebookIds: percent(toNumber(summary.bookingsWithFacebookIds), confirmedBookings),
        marketingConsent: percent(toNumber(summary.bookingsWithMarketingConsent), confirmedBookings),
        analyticsConsent: percent(toNumber(summary.bookingsWithAnalyticsConsent), confirmedBookings),
        whatsappTracking: percent(toNumber(summary.whatsappClicksWithTrackingContext), whatsappClicks),
        scheduleDelivery: percent(scheduleOk, scheduleOk + scheduleFailed),
        contactDelivery: percent(contactOk, contactOk + contactFailed),
    }
}

function buildDelta(currentValue, previousValue) {
    return Math.round((currentValue - previousValue) * 10) / 10
}

function pushAlert(alerts, alert) {
    alerts.push({
        severity: alert.severity,
        code: alert.code,
        title: alert.title,
        message: alert.message,
    })
}

function buildOperationalAlerts({
    website,
    previousWebsite,
    coverage,
    previousCoverage,
    summary,
    recentRetryCandidates,
}) {
    const alerts = []

    if (!website.available) {
        pushAlert(alerts, {
            severity: 'critical',
            code: 'website_unavailable',
            title: 'Site indisponível para observabilidade',
            message: `O CRM não conseguiu ler o dashboard do website: ${website.error || 'unavailable'}.`,
        })
        return alerts
    }

    const config = website.data?.config || {}
    if (!config.metaPixelConfigured || !config.metaCapiConfigured) {
        pushAlert(alerts, {
            severity: 'critical',
            code: 'meta_runtime_not_configured',
            title: 'Meta Pixel ou CAPI sem configuração válida',
            message: 'O runtime do site ainda não está com Pixel e CAPI completos para produção.',
        })
    }

    if (coverage.confirmedBookings > 0 && coverage.trackingContext < 80) {
        pushAlert(alerts, {
            severity: coverage.trackingContext < 50 ? 'critical' : 'warning',
            code: 'low_tracking_context_coverage',
            title: 'Cobertura baixa de tracking_context',
            message: `${coverage.trackingContext}% dos bookings confirmados chegaram com tracking_context no período atual.`,
        })
    }

    if (coverage.confirmedBookings > 0 && coverage.facebookIds < 70) {
        pushAlert(alerts, {
            severity: coverage.facebookIds < 30 ? 'critical' : 'warning',
            code: 'low_facebook_ids_coverage',
            title: 'Cobertura baixa de identificadores Facebook',
            message: `${coverage.facebookIds}% dos bookings confirmados chegaram com fbp/fbc/fbclid no período atual.`,
        })
    }

    if (coverage.confirmedBookings > 0 && coverage.marketingConsent < 60) {
        pushAlert(alerts, {
            severity: coverage.marketingConsent < 30 ? 'critical' : 'warning',
            code: 'low_marketing_consent',
            title: 'Consentimento de marketing abaixo do esperado',
            message: `${coverage.marketingConsent}% dos bookings confirmados tinham consentimento de marketing no período atual.`,
        })
    }

    if (toNumber(summary.capiScheduleFailed) > 0) {
        pushAlert(alerts, {
            severity: coverage.scheduleDelivery < 70 ? 'critical' : 'warning',
            code: 'schedule_capi_failures',
            title: 'Falhas no evento Schedule via CAPI',
            message: `${toNumber(summary.capiScheduleFailed)} envios de Schedule falharam no período atual.`,
        })
    }

    if (toNumber(summary.capiContactFailed) > 0) {
        pushAlert(alerts, {
            severity: coverage.contactDelivery < 70 ? 'critical' : 'warning',
            code: 'contact_capi_failures',
            title: 'Falhas no evento Contact via CAPI',
            message: `${toNumber(summary.capiContactFailed)} envios de Contact falharam no período atual.`,
        })
    }

    if (recentRetryCandidates.length > 0) {
        pushAlert(alerts, {
            severity: 'warning',
            code: 'meta_retry_candidates',
            title: 'Falhas retryable aguardando reprocessamento',
            message: `${recentRetryCandidates.length} falhas recentes parecem transitórias e podem ser reprocessadas com segurança.`,
        })
    }

    if (previousWebsite?.available && previousCoverage.confirmedBookings > 0 && coverage.confirmedBookings > 0) {
        const trackingDrop = buildDelta(coverage.trackingContext, previousCoverage.trackingContext)
        const facebookDrop = buildDelta(coverage.facebookIds, previousCoverage.facebookIds)
        const marketingDrop = buildDelta(coverage.marketingConsent, previousCoverage.marketingConsent)

        if (trackingDrop <= -20) {
            pushAlert(alerts, {
                severity: 'warning',
                code: 'tracking_context_drop',
                title: 'Queda brusca na cobertura de tracking_context',
                message: `A cobertura caiu ${Math.abs(trackingDrop)} pontos percentuais contra a janela anterior equivalente.`,
            })
        }

        if (facebookDrop <= -20) {
            pushAlert(alerts, {
                severity: 'warning',
                code: 'facebook_ids_drop',
                title: 'Queda brusca na cobertura de fbp/fbc/fbclid',
                message: `A cobertura de identificadores Facebook caiu ${Math.abs(facebookDrop)} pontos percentuais contra a janela anterior.`,
            })
        }

        if (marketingDrop <= -20) {
            pushAlert(alerts, {
                severity: 'warning',
                code: 'marketing_consent_drop',
                title: 'Queda brusca no consentimento de marketing',
                message: `A taxa de consentimento caiu ${Math.abs(marketingDrop)} pontos percentuais contra a janela anterior.`,
            })
        }
    }

    return alerts
}

function buildHealthStatus(alerts) {
    if (alerts.some((alert) => alert.severity === 'critical')) {
        return {
            status: 'critical',
            label: 'crítico',
            summary: 'A instrumentação existe, mas há bloqueios sérios de cobertura ou entrega que pedem ação imediata.',
        }
    }
    if (alerts.some((alert) => alert.severity === 'warning')) {
        return {
            status: 'degraded',
            label: 'degradado',
            summary: 'O tracking está operacional, mas a cobertura e a qualidade ainda precisam de correção ou vigilância.',
        }
    }
    return {
        status: 'healthy',
        label: 'saudável',
        summary: 'A camada de tracking do site está sem alertas críticos no período consultado.',
    }
}

function buildReconciliation(websiteData = {}) {
    const buckets = Array.isArray(websiteData.coverageBuckets) ? websiteData.coverageBuckets : []
    const total = buckets.reduce((acc, item) => acc + toNumber(item.count), 0)
    return {
        buckets: buckets.map((item) => ({
            bucket: item.bucket,
            label: item.label,
            count: toNumber(item.count),
            percent: percent(toNumber(item.count), total),
        })),
        incompleteBookings: Array.isArray(websiteData.recentIncompleteBookings) ? websiteData.recentIncompleteBookings : [],
        retryCandidates: Array.isArray(websiteData.recentRetryCandidates) ? websiteData.recentRetryCandidates : [],
    }
}

function buildGovernance() {
    return {
        campaignRule: 'Toda campanha paga com objetivo de booking deve apontar para https://espacofacial.com, sempre com utm_source, utm_medium, utm_campaign e utm_content.',
        validExamples: [
            'https://espacofacial.com/agendamento?utm_source=meta&utm_medium=paid_social&utm_campaign=bss_botox&utm_content=video_a',
            'https://espacofacial.com/novohamburgo?utm_source=meta&utm_medium=paid_social&utm_campaign=nh_avaliacao&utm_content=carrossel_1',
        ],
        invalidExamples: [
            'https://espacofacial.com.br/agendamento?utm_source=meta',
            'https://wa.me/message/MT7UGL6U6KYWA1',
            'https://espacofacial.com/agendamento',
        ],
        crossDomainAllowlist: [
            { host: 'espacofacial.com.br', purpose: 'franquia oficial', allowedFromPublicSite: true },
            { host: 'app.espacofacial.com.br', purpose: 'aplicação oficial externa da franquia', allowedFromPublicSite: true },
            { host: 'crm.skincos.com.br', purpose: 'CRM interno e observabilidade', allowedFromPublicSite: false },
            { host: 'orb.skincos.com.br', purpose: 'orquestração/n8n', allowedFromPublicSite: false },
            { host: 'wa.skincos.com.br', purpose: 'stack técnica de WhatsApp', allowedFromPublicSite: false },
        ],
    }
}

function buildValidationCadence() {
    return {
        smoke: 'a cada deploy',
        functional: 'semanal',
        coverageAudit: 'quinzenal',
        recurringChecks: [
            'entrada com utm_source, utm_medium, utm_campaign e utm_content',
            'entrada com fbclid',
            'consentimento aceito e recusado',
            'booking completo até confirmação',
            'clique de WhatsApp via /api/whatsapp/redirect',
            'deduplicação browser/server do Schedule',
        ],
    }
}

function buildWhatsappContract() {
    return {
        status: 'pending_n8n_phase',
        lifecycle: [
            'conversation_started',
            'appointment_created',
            'appointment_confirmed',
            'sale_closed',
        ],
        description: 'Quando a frente n8n voltar a ser prioridade, o CRM deve exibir claramente clique no site, conversa aberta e desfecho final por atendimento.',
    }
}

async function fetchWhatsappAttributionOverview({ sinceIso, limit }) {
    const pgPool = getPool()
    if (!pgPool) {
        return {
            available: false,
            error: 'DATABASE_URL_not_configured',
        }
    }

    const client = await pgPool.connect()
    try {
        const summaryRes = await client.query(
            `
            select
                count(*) filter (where c.created_at >= $1::timestamptz) as conversations_total,
                count(*) filter (where c.created_at >= $1::timestamptz and c.wa_click_id is not null and c.wa_click_id <> '') as conversations_attributed,
                count(*) filter (where c.created_at >= $1::timestamptz and c.funnel_status = 'qualificado') as conversations_qualified,
                count(*) filter (where c.created_at >= $1::timestamptz and c.funnel_status = 'agendado') as conversations_scheduled,
                count(*) filter (where c.created_at >= $1::timestamptz and c.needs_human = true) as conversations_need_human,
                (select count(*) from wa_n8n.appointments a where a.created_at >= $1::timestamptz) as appointments_total,
                (select count(*) from wa_n8n.appointments a where a.created_at >= $1::timestamptz and a.wa_click_id is not null and a.wa_click_id <> '') as appointments_attributed,
                (select count(*) from wa_n8n.appointments a where a.created_at >= $1::timestamptz and a.status in ('agendado', 'confirmado')) as appointments_scheduled,
                (select count(*) from wa_n8n.appointments a where a.created_at >= $1::timestamptz and a.status = 'confirmado') as appointments_confirmed
            from wa_n8n.conversations c
            `,
            [sinceIso],
        )

        const stagesRes = await client.query(
            `
            select c.funnel_status, count(*)::int as count
            from wa_n8n.conversations c
            where c.created_at >= $1::timestamptz
            group by c.funnel_status
            order by count desc, c.funnel_status asc
            `,
            [sinceIso],
        )

        const conversationsRes = await client.query(
            `
            select
                c.id,
                c.unit_slug,
                c.wa_click_id,
                c.funnel_status,
                c.needs_human,
                c.updated_at,
                c.last_message_at,
                c.source_tracking,
                contact.phone_e164,
                contact.external_id
            from wa_n8n.conversations c
            left join wa_n8n.contacts contact on contact.id = c.contact_id
            where c.updated_at >= $1::timestamptz
              and c.wa_click_id is not null
              and c.wa_click_id <> ''
            order by c.updated_at desc
            limit $2
            `,
            [sinceIso, limit],
        )

        const appointmentsRes = await client.query(
            `
            select
                a.id,
                a.unit_slug,
                a.wa_click_id,
                a.status,
                a.start_at,
                a.created_at,
                a.source_tracking,
                contact.phone_e164,
                contact.external_id
            from wa_n8n.appointments a
            left join wa_n8n.contacts contact on contact.id = a.contact_id
            where a.created_at >= $1::timestamptz
              and a.wa_click_id is not null
              and a.wa_click_id <> ''
            order by a.created_at desc
            limit $2
            `,
            [sinceIso, limit],
        )

        const topSourcesRes = await client.query(
            `
            select
                coalesce(
                    c.source_tracking->'params'->>'utm_source',
                    c.source_tracking->'lastTouch'->'params'->>'utm_source',
                    c.source_tracking->'firstTouch'->'params'->>'utm_source',
                    'direto'
                ) as utm_source,
                count(*)::int as count
            from wa_n8n.conversations c
            where c.created_at >= $1::timestamptz
              and c.wa_click_id is not null
              and c.wa_click_id <> ''
            group by 1
            order by count desc, utm_source asc
            limit 6
            `,
            [sinceIso],
        )

        const topCampaignsRes = await client.query(
            `
            select
                coalesce(
                    c.source_tracking->'params'->>'utm_campaign',
                    c.source_tracking->'lastTouch'->'params'->>'utm_campaign',
                    c.source_tracking->'firstTouch'->'params'->>'utm_campaign',
                    'sem_campanha'
                ) as utm_campaign,
                count(*)::int as count
            from wa_n8n.conversations c
            where c.created_at >= $1::timestamptz
              and c.wa_click_id is not null
              and c.wa_click_id <> ''
            group by 1
            order by count desc, utm_campaign asc
            limit 6
            `,
            [sinceIso],
        )

        const summarizeTracking = (input) => {
            return {
                utmSource: readJsonPathString(input, [
                ['params', 'utm_source'],
                ['lastTouch', 'params', 'utm_source'],
                ['firstTouch', 'params', 'utm_source'],
                ]),
                utmCampaign: readJsonPathString(input, [
                ['params', 'utm_campaign'],
                ['lastTouch', 'params', 'utm_campaign'],
                ['firstTouch', 'params', 'utm_campaign'],
                ]),
            }
        }

        const recentConversations = conversationsRes.rows.map((row) => {
            const sourceTracking = row.source_tracking && typeof row.source_tracking === 'object' ? row.source_tracking : {}
            const normalized = summarizeTracking(sourceTracking)
            return {
                id: row.id,
                unitSlug: row.unit_slug,
                waClickId: row.wa_click_id,
                funnelStatus: row.funnel_status,
                needsHuman: row.needs_human === true,
                updatedAt: row.updated_at,
                lastMessageAt: row.last_message_at,
                phone: maskPhone(row.phone_e164),
                externalId: row.external_id || null,
                ...normalized,
            }
        })

        const recentAppointments = appointmentsRes.rows.map((row) => {
            const sourceTracking = row.source_tracking && typeof row.source_tracking === 'object' ? row.source_tracking : {}
            const normalized = summarizeTracking(sourceTracking)
            return {
                id: row.id,
                unitSlug: row.unit_slug,
                waClickId: row.wa_click_id,
                status: row.status,
                startAt: row.start_at,
                createdAt: row.created_at,
                phone: maskPhone(row.phone_e164),
                externalId: row.external_id || null,
                ...normalized,
            }
        })

        return {
            available: true,
            data: {
                summary: summaryRes.rows[0] || {},
                stages: stagesRes.rows.map((row) => ({
                    funnelStatus: row.funnel_status,
                    count: Number(row.count || 0),
                })),
                topSources: topSourcesRes.rows.map((row) => ({
                    utmSource: row.utm_source,
                    count: Number(row.count || 0),
                })),
                topCampaigns: topCampaignsRes.rows.map((row) => ({
                    utmCampaign: row.utm_campaign,
                    count: Number(row.count || 0),
                })),
                recentConversations,
                recentAppointments,
            },
        }
    } finally {
        client.release()
    }
}

export async function getTrackingDashboardOverview(params = {}) {
    const days = parsePositiveInt(params.days, 30, 90)
    const limit = parsePositiveInt(params.limit, 12, 50)
    const cacheTtlMs = parsePositiveInt(process.env.TRACKING_DASHBOARD_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS, 300_000)
    const cacheKey = `${days}:${limit}`

    if (cache && cache.key === cacheKey && Date.now() - cache.createdAt < cacheTtlMs) {
        return cache.value
    }

    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const [website, previousWebsite, whatsapp] = await Promise.all([
        fetchWebsiteTrackingOverview({ days, limit, offsetDays: 0 }),
        fetchWebsiteTrackingOverview({ days, limit: Math.min(limit, 5), offsetDays: days }),
        fetchWhatsappAttributionOverview({ sinceIso, limit }),
    ])

    const warnings = []
    if (!website.available) warnings.push(`website:${website.error || 'unavailable'}`)
    if (!previousWebsite.available) warnings.push(`website_previous:${previousWebsite.error || 'unavailable'}`)
    if (!whatsapp.available) warnings.push(`whatsapp:${whatsapp.error || 'unavailable'}`)

    const websiteSummary = website.available ? website.data?.summary || {} : {}
    const whatsappSummary = whatsapp.available ? whatsapp.data?.summary || {} : {}
    const previousWebsiteSummary = previousWebsite.available ? previousWebsite.data?.summary || {} : {}
    const coverage = buildCoverage(websiteSummary)
    const previousCoverage = buildCoverage(previousWebsiteSummary)
    const reconciliation = buildReconciliation(website.data || {})
    const alerts = buildOperationalAlerts({
        website,
        previousWebsite,
        coverage,
        previousCoverage,
        summary: websiteSummary,
        recentRetryCandidates: reconciliation.retryCandidates,
    })
    const health = buildHealthStatus(alerts)

    const funnel = {
        siteConfirmedBookings: Number(websiteSummary.confirmedBookings || 0),
        siteWhatsappClicks: Number(websiteSummary.whatsappClicks || 0),
        crmAttributedConversations: Number(whatsappSummary.conversations_attributed || 0),
        crmAttributedAppointments: Number(whatsappSummary.appointments_attributed || 0),
    }

    const value = {
        ok: true,
        generatedAt: Date.now(),
        window: { days, sinceIso },
        partial: warnings.length > 0,
        warnings,
        website,
        previousWebsite,
        whatsapp,
        funnel,
        coverage,
        previousCoverage,
        alerts,
        health,
        reconciliation,
        siteBehavior: website.available ? website.data?.siteBehavior || null : null,
        customLinks: website.available ? website.data?.customLinks || null : null,
        siteFunnel: website.available ? website.data?.siteFunnel || null : null,
        behaviorQuality: website.available ? website.data?.behaviorQuality || null : null,
        governance: buildGovernance(),
        validationCadence: buildValidationCadence(),
        whatsappContract: buildWhatsappContract(),
    }

    cache = {
        key: cacheKey,
        createdAt: Date.now(),
        value,
    }

    return value
}
