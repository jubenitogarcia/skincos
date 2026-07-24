import pg from 'pg'
import { reconcileAttendanceSignals } from '../server/events/attendanceOutbox.js'

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-attendance-event-reconciliation' })
try {
    const result = await reconcileAttendanceSignals(pool)
    console.log(JSON.stringify({ operation: 'attendance_event_reconciliation', ...result }))
} finally {
    await pool.end()
}
