import { Router } from 'express'
import { getTrackingDashboardOverview } from '../services/trackingDashboardService.js'

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

    return router
}
