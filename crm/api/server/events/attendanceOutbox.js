import { withPgTransaction } from '../harmonia/store/pg.js'

export const ATTENDANCE_COMMERCIAL_ACTION_CREATED_V1 = 'atendimento.commercial-action.created.v1'
export const HARMONIA_ATTENDANCE_SIGNAL_CONSUMER = 'harmonia.attendance-signal.v1'

export function eventKeyForCommercialAction(actionId) {
    if (!actionId) throw new Error('EVENT_AGGREGATE_ID_REQUIRED')
    return `${ATTENDANCE_COMMERCIAL_ACTION_CREATED_V1}:${actionId}`
}

export function nextDelivery({ attempts, maxAttempts = 3, now = new Date(), baseDelaySeconds = 30 }) {
    const count = Number(attempts || 0)
    if (count >= maxAttempts) return { status: 'dead_letter', availableAt: null }
    return { status: 'retrying', availableAt: new Date(now.getTime() + Math.min(900, Math.max(1, baseDelaySeconds) * (2 ** Math.max(0, count - 1))) * 1000).toISOString() }
}

export async function enqueueCommercialActionEvent(client, payload) {
    const actionId = String(payload?.actionId || '').trim()
    const eventKey = eventKeyForCommercialAction(actionId)
    const event = await client.query(`insert into crm_atendimento.event_outbox(event_key,event_type,event_version,aggregate_type,aggregate_id,payload) values($1,$2,1,'commercial_action',$3,$4::jsonb) on conflict(event_key) do update set event_key=excluded.event_key returning id`, [eventKey, ATTENDANCE_COMMERCIAL_ACTION_CREATED_V1, actionId, JSON.stringify(payload)])
    const eventId = event.rows[0]?.id
    await client.query(`insert into crm_atendimento.event_deliveries(event_id,consumer_name) values($1,$2) on conflict(event_id,consumer_name) do nothing`, [eventId, HARMONIA_ATTENDANCE_SIGNAL_CONSUMER])
    return { eventId, eventKey }
}

export async function claimAttendanceSignalDelivery(pool, { limit = 1 } = {}) {
    return withPgTransaction(pool, async (client) => (await client.query(`with candidate as (select d.id from crm_atendimento.event_deliveries d join crm_atendimento.event_outbox e on e.id=d.event_id where d.consumer_name=$1 and ((d.status in ('pending','retrying') and d.available_at <= now()) or (d.status='processing' and d.lease_until < now())) order by d.available_at,e.created_at limit $2 for update skip locked) update crm_atendimento.event_deliveries d set status='processing',attempts=d.attempts+1,locked_at=now(),lease_until=now()+interval '60 seconds',updated_at=now() from candidate c join crm_atendimento.event_outbox e on e.id=d.event_id where d.id=c.id returning d.id as delivery_id,d.event_id,d.attempts,e.event_type,e.event_version,e.payload`, [HARMONIA_ATTENDANCE_SIGNAL_CONSUMER, Math.max(1, Math.min(20, Number(limit) || 1))])).rows || [])
}

async function persistAttendanceSignal(client, delivery) {
    const p = delivery.payload || {}
    await client.query(`insert into harmonia.attendance_signals(source_event_id,action_id,identity_id,unit_id,action_type,segment_key,due_date) values($1,$2,$3,$4,$5,$6,$7) on conflict(source_event_id) do nothing`, [delivery.event_id, p.actionId, p.identityId, p.unitId || null, p.actionType, p.segmentKey, p.dueDate || null])
}

export async function deliverAttendanceSignal(pool, delivery, { handler = persistAttendanceSignal, maxAttempts = 3, now = new Date() } = {}) {
    try {
        await withPgTransaction(pool, async (client) => {
            const inbox = await client.query(`insert into harmonia.event_inbox(event_id,event_type,event_version) values($1,$2,$3) on conflict(event_id) do nothing returning event_id`, [delivery.event_id, delivery.event_type, delivery.event_version])
            if (inbox.rows[0]) await handler(client, delivery)
            await client.query(`update crm_atendimento.event_deliveries set status='delivered',delivered_at=now(),locked_at=null,lease_until=null,updated_at=now() where id=$1`, [delivery.delivery_id])
        })
        return { status: 'delivered' }
    } catch (error) {
        const next = nextDelivery({ attempts: delivery.attempts, maxAttempts, now })
        await pool.query(`update crm_atendimento.event_deliveries set status=$2,available_at=coalesce($3::timestamptz,available_at),locked_at=null,lease_until=null,last_error=$4,dead_lettered_at=case when $2='dead_letter' then now() else null end,updated_at=now() where id=$1`, [delivery.delivery_id, next.status, next.availableAt, String(error?.message || 'CONSUMER_FAILED').slice(0, 500)])
        return { status: next.status, error: 'CONSUMER_FAILED' }
    }
}

export async function replayAttendanceSignalDeadLetter(pool, eventId) {
    const r = await pool.query(`update crm_atendimento.event_deliveries set status='pending',attempts=0,available_at=now(),locked_at=null,lease_until=null,last_error=null,dead_lettered_at=null,updated_at=now() where event_id=$1 and consumer_name=$2 and status='dead_letter' returning id`, [eventId, HARMONIA_ATTENDANCE_SIGNAL_CONSUMER])
    return Boolean(r.rows[0])
}

export async function reconcileAttendanceSignals(pool) {
    const missing = await pool.query(`insert into crm_atendimento.event_deliveries(event_id,consumer_name) select e.id,$1 from crm_atendimento.event_outbox e left join crm_atendimento.event_deliveries d on d.event_id=e.id and d.consumer_name=$1 where e.event_type=$2 and d.id is null on conflict do nothing returning id`, [HARMONIA_ATTENDANCE_SIGNAL_CONSUMER, ATTENDANCE_COMMERCIAL_ACTION_CREATED_V1])
    const inconsistent = await pool.query(`update crm_atendimento.event_deliveries d set status='pending',attempts=0,available_at=now(),locked_at=null,lease_until=null,last_error='RECONCILIATION_MISSING_INBOX',delivered_at=null,updated_at=now() from crm_atendimento.event_outbox e left join harmonia.event_inbox i on i.event_id=e.id where d.event_id=e.id and d.consumer_name=$1 and e.event_type=$2 and d.status='delivered' and i.event_id is null returning d.id`, [HARMONIA_ATTENDANCE_SIGNAL_CONSUMER, ATTENDANCE_COMMERCIAL_ACTION_CREATED_V1])
    return { repairedDeliveries: (missing.rowCount || 0) + (inconsistent.rowCount || 0) }
}
