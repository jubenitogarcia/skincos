import pg from 'pg'
import { replayAttendanceSignalDeadLetter } from '../server/events/attendanceOutbox.js'

const eventId = String(process.env.EVENT_ID || '').trim()
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')
if (!eventId) throw new Error('EVENT_ID_required')

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-attendance-event-replay' })
try {
    const replayed = await replayAttendanceSignalDeadLetter(pool, eventId)
    console.log(JSON.stringify({ operation: 'attendance_event_dead_letter_replay', eventId, replayed }))
    if (!replayed) process.exitCode = 2
} finally {
    await pool.end()
}
