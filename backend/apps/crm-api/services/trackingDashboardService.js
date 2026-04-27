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

async function fetchWebsiteTrackingOverview({ days, limit }) {
    const baseUrl = sanitizeBaseUrl(process.env.TRACKING_WEBSITE_BASE_URL)
    const token = String(process.env.TRACKING_DASHBOARD_TOKEN || '').trim()
    const requestUrl = new URL('/api/tracking/dashboard', baseUrl)
    requestUrl.searchParams.set('days', String(days))
    requestUrl.searchParams.set('limit', String(limit))

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
    const [website, whatsapp] = await Promise.all([
        fetchWebsiteTrackingOverview({ days, limit }),
        fetchWhatsappAttributionOverview({ sinceIso, limit }),
    ])

    const warnings = []
    if (!website.available) warnings.push(`website:${website.error || 'unavailable'}`)
    if (!whatsapp.available) warnings.push(`whatsapp:${whatsapp.error || 'unavailable'}`)

    const websiteSummary = website.available ? website.data?.summary || {} : {}
    const whatsappSummary = whatsapp.available ? whatsapp.data?.summary || {} : {}

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
        whatsapp,
        funnel,
    }

    cache = {
        key: cacheKey,
        createdAt: Date.now(),
        value,
    }

    return value
}
