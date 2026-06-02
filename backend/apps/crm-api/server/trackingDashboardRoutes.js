import { Router } from 'express'
import {
    createTrackingCustomUrl,
    getTrackingCustomUrls,
    getTrackingDashboardOverview,
    updateTrackingCustomUrl,
} from '../services/trackingDashboardService.js'

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return parsed
}

export function createTrackingDashboardRouter() {
    const router = Router()

    router.get('/overview', async (req, res) => {
        const days = Math.min(parsePositiveInt(req.query.days, 30), 90)
        const limit = Math.min(parsePositiveInt(req.query.limit, 12), 50)

        try {
            const data = await getTrackingDashboardOverview({ days, limit })
            res.setHeader('cache-control', 'no-store')
            return res.status(200).json(data)
        } catch (error) {
            console.error('[tracking-dashboard] failed to build overview', error)
            return res.status(500).json({
                ok: false,
                error: 'tracking_dashboard_failed',
                message: error instanceof Error ? error.message : 'unknown_error',
            })
        }
    })

    router.get('/custom-urls', async (req, res) => {
        const limit = Math.min(parsePositiveInt(req.query.limit, 100), 200)

        try {
            const data = await getTrackingCustomUrls({ limit })
            res.setHeader('cache-control', 'no-store')
            return res.status(data.ok ? 200 : data.status || 502).json(data)
        } catch (error) {
            console.error('[tracking-dashboard] failed to list custom urls', error)
            return res.status(500).json({
                ok: false,
                error: 'tracking_custom_urls_failed',
                message: error instanceof Error ? error.message : 'unknown_error',
            })
        }
    })

    router.post('/custom-urls', async (req, res) => {
        try {
            const data = await createTrackingCustomUrl(req.body || {})
            res.setHeader('cache-control', 'no-store')
            return res.status(data.ok ? 201 : data.status || 502).json(data)
        } catch (error) {
            console.error('[tracking-dashboard] failed to create custom url', error)
            return res.status(500).json({
                ok: false,
                error: 'tracking_custom_url_create_failed',
                message: error instanceof Error ? error.message : 'unknown_error',
            })
        }
    })

    router.patch('/custom-urls', async (req, res) => {
        try {
            const data = await updateTrackingCustomUrl(req.body || {})
            res.setHeader('cache-control', 'no-store')
            return res.status(data.ok ? 200 : data.status || 502).json(data)
        } catch (error) {
            console.error('[tracking-dashboard] failed to update custom url', error)
            return res.status(500).json({
                ok: false,
                error: 'tracking_custom_url_update_failed',
                message: error instanceof Error ? error.message : 'unknown_error',
            })
        }
    })

    return router
}
