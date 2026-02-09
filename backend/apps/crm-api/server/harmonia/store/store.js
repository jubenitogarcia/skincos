import { createHash } from 'crypto'
import { createPgPool, withPgTransaction } from './pg.js'
import { harmoniaMigrationStatements, defaultUnitsSeedRows } from './migrate.js'
import { defaultWorkingHoursForUnitSlug } from '../util/workingHours.js'

function onlyDigits(s) {
    return String(s || '').replace(/\\D+/g, '')
}

export function createHarmoniaStore({ databaseUrl }) {
    const pool = createPgPool(databaseUrl)

    async function migrate() {
        if (!pool) throw new Error('DATABASE_URL not configured')
        return withPgTransaction(pool, async (tx) => {
            for (const stmt of harmoniaMigrationStatements()) {
                await tx.query(stmt)
            }
            for (const u of defaultUnitsSeedRows()) {
                await tx.query(
                    `insert into harmonia.units (slug, name, timezone, working_hours)
                     values ($1, $2, $3, $4::jsonb)
                     on conflict (slug) do update set
                        name = excluded.name,
                        timezone = excluded.timezone,
                        working_hours = excluded.working_hours,
                        updated_at = now()
                    `,
                    [u.slug, u.name, u.timezone, JSON.stringify(u.working_hours)]
                )
            }
        })
    }

    async function lockForKey(tx, key) {
        const k = String(key || '').trim()
        if (!k) return
        try {
            await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [k])
        } catch {
            await tx.query('select pg_advisory_xact_lock(hashtext($1)::bigint)', [k])
        }
    }

    async function getOrCreateUnit(tx, unitSlug, instanceName) {
        const slug = String(unitSlug || '').trim()
        if (!slug) throw new Error('unitSlug is required')

        const found = await tx.query('select * from harmonia.units where slug=$1 limit 1', [slug])
        if (found.rows?.[0]) return found.rows[0]

        const name = String(instanceName || '').trim() || slug
        const workingHours = defaultWorkingHoursForUnitSlug(slug)
        const inserted = await tx.query(
            `insert into harmonia.units (slug, name, timezone, working_hours)
             values ($1, $2, $3, $4::jsonb)
             returning *`,
            [slug, name, 'America/Sao_Paulo', JSON.stringify(workingHours)]
        )
        return inserted.rows[0]
    }

    async function upsertContact(tx, { phoneRaw, waJid, displayName }) {
        const phone = onlyDigits(phoneRaw)
        if (!phone) throw new Error('contact.phone_raw is required')

        const wa = waJid ? String(waJid).trim() : null
        const name = displayName ? String(displayName).trim() : null

        const r = await tx.query(
            `insert into harmonia.contacts (phone_raw, wa_jid, display_name, created_at, updated_at)
             values ($1, $2, $3, now(), now())
             on conflict (phone_raw) do update set
                wa_jid = coalesce(excluded.wa_jid, harmonia.contacts.wa_jid),
                display_name = coalesce(excluded.display_name, harmonia.contacts.display_name),
                updated_at = now()
             returning *`,
            [phone, wa, name]
        )
        return r.rows[0]
    }

    async function getOrCreateConversation(tx, { unitId, contactId, leadSpeedClass }) {
        const found = await tx.query(
            'select * from harmonia.conversations where unit_id=$1 and contact_id=$2 limit 1',
            [unitId, contactId]
        )
        if (found.rows?.[0]) return found.rows[0]

        const r = await tx.query(
            `insert into harmonia.conversations (unit_id, contact_id, stage, lead_speed_class, created_at, updated_at)
             values ($1, $2, 'new', $3, now(), now())
             returning *`,
            [unitId, contactId, leadSpeedClass || null]
        )
        return r.rows[0]
    }

    async function updateConversation(tx, conversationId, patch) {
        const id = String(conversationId || '').trim()
        if (!id) throw new Error('conversationId required')

        const fields = []
        const values = []
        let idx = 1

        const allowed = [
            'stage',
            'last_inbound_at',
            'last_outbound_at',
            'procedure_code',
            'procedure_confidence',
            'lead_speed_class',
        ]
        for (const k of allowed) {
            if (typeof patch?.[k] === 'undefined') continue
            fields.push(`${k}=$${idx++}`)
            values.push(patch[k])
        }

        fields.push('updated_at=now()')

        const q = `update harmonia.conversations set ${fields.join(', ')} where id=$${idx} returning *`
        values.push(id)
        const r = await tx.query(q, values)
        return r.rows?.[0] || null
    }

    async function insertMessage(tx, { conversationId, direction, providerMessageId, text, raw }) {
        const r = await tx.query(
            `insert into harmonia.messages (conversation_id, direction, provider_message_id, text, raw, created_at)
             values ($1, $2, $3, $4, $5::jsonb, now())
             on conflict (conversation_id, provider_message_id) do nothing
             returning id`,
            [conversationId, direction, providerMessageId, text || null, raw ? JSON.stringify(raw) : null]
        )
        return Boolean(r.rows?.[0]?.id)
    }

    async function countOutbound(tx, conversationId) {
        const r = await tx.query(
            `select count(*)::int as n from harmonia.messages where conversation_id=$1 and direction='outbound'`,
            [conversationId]
        )
        return Number(r.rows?.[0]?.n || 0)
    }

    async function markOptOut(tx, contactId) {
        const r = await tx.query(
            `update harmonia.contacts set opted_out_at=coalesce(opted_out_at, now()), updated_at=now()
             where id=$1 returning *`,
            [contactId]
        )
        return r.rows?.[0] || null
    }

    async function createTask(tx, { conversationId, type, runAt, payload }) {
        const r = await tx.query(
            `insert into harmonia.tasks (type, run_at, conversation_id, payload, status, attempts, created_at, updated_at)
             values ($1, $2, $3, $4::jsonb, 'pending', 0, now(), now())
             returning *`,
            [type, runAt, conversationId, payload ? JSON.stringify(payload) : null]
        )
        return r.rows?.[0] || null
    }

    async function listUnits(tx) {
        const r = await tx.query('select * from harmonia.units order by slug asc')
        return r.rows || []
    }

    async function getUnitBySlug(tx, slug) {
        const r = await tx.query('select * from harmonia.units where slug=$1 limit 1', [slug])
        return r.rows?.[0] || null
    }

    async function findConversationByUnitPhone(tx, { unitSlug, phoneRaw }) {
        const unit = await getUnitBySlug(tx, unitSlug)
        if (!unit) return null
        const phone = onlyDigits(phoneRaw)
        if (!phone) return null
        const contact = await tx.query('select * from harmonia.contacts where phone_raw=$1 limit 1', [phone])
        const contactRow = contact.rows?.[0]
        if (!contactRow) return null
        const convo = await tx.query(
            'select * from harmonia.conversations where unit_id=$1 and contact_id=$2 limit 1',
            [unit.id, contactRow.id]
        )
        return convo.rows?.[0] || null
    }

    async function getConversationWithContactByUnitPhone(tx, { unitSlug, phoneRaw }) {
        const slug = String(unitSlug || '').trim()
        const phone = onlyDigits(phoneRaw)
        if (!slug || !phone) return null
        const r = await tx.query(
            `select c.*, ct.phone_raw as contact_phone_raw, ct.display_name as contact_display_name, ct.opted_out_at
             from harmonia.conversations c
             join harmonia.units u on u.id=c.unit_id
             join harmonia.contacts ct on ct.id=c.contact_id
             where u.slug=$1 and ct.phone_raw=$2
             limit 1`,
            [slug, phone]
        )
        return r.rows?.[0] || null
    }

    async function getConversationWithContact(tx, conversationId) {
        const id = String(conversationId || '').trim()
        if (!id) return null
        const r = await tx.query(
            `select c.*, ct.phone_raw as contact_phone_raw, ct.display_name as contact_display_name, ct.opted_out_at
             from harmonia.conversations c
             join harmonia.contacts ct on ct.id=c.contact_id
             where c.id=$1
             limit 1`,
            [id]
        )
        return r.rows?.[0] || null
    }

    async function insertDeliveryEvent(tx, { conversationId, providerMessageId, status, error, raw }) {
        const r = await tx.query(
            `insert into harmonia.delivery_events (conversation_id, provider_message_id, status, error, raw, created_at)
             values ($1, $2, $3, $4, $5::jsonb, now())
             on conflict (conversation_id, provider_message_id) do nothing
             returning id`,
            [conversationId, providerMessageId, status, error || null, raw ? JSON.stringify(raw) : null]
        )
        return Boolean(r.rows?.[0]?.id)
    }

    async function listMessagesByConversation(tx, { conversationId, limit }) {
        const id = String(conversationId || '').trim()
        if (!id) return []
        const lim = Math.max(1, Math.min(200, Number(limit || 50)))
        const r = await tx.query(
            `select id, direction, provider_message_id, text, created_at
             from harmonia.messages
             where conversation_id=$1
             order by created_at desc
             limit $2`,
            [id, lim]
        )
        return r.rows || []
    }

    async function listConversationsByUnit(tx, { unitSlug, limit, cursorTs, cursorId }) {
        const slug = String(unitSlug || '').trim()
        if (!slug) throw new Error('unitSlug is required')
        const lim = Math.max(1, Math.min(200, Number(limit || 30)))

        const cursorTime = cursorTs ? new Date(String(cursorTs)) : null
        const cursorOk = cursorTime && !Number.isNaN(cursorTime.getTime())
        const cursorIdStr = cursorId ? String(cursorId).trim() : null

        const whereCursor = cursorOk
            ? `
                and (
                    c.updated_at < $2
                    or (
                        c.updated_at = $2
                        and c.id < $3
                    )
                )
            `
            : ''

        const params = cursorOk
            ? [slug, cursorTime.toISOString(), cursorIdStr || 'ffffffff-ffff-ffff-ffff-ffffffffffff', lim]
            : [slug, lim]

        const q = cursorOk
            ? `
                select
                    c.id,
                    c.stage,
                    c.last_inbound_at,
                    c.last_outbound_at,
                    c.procedure_code,
                    c.procedure_confidence,
                    c.lead_speed_class,
                    c.created_at,
                    c.updated_at,
                    u.slug as unit_slug,
                    u.name as unit_name,
                    ct.phone_raw as contact_phone_raw,
                    ct.display_name as contact_display_name,
                    ct.opted_out_at as contact_opted_out_at,
                    lm.direction as last_message_direction,
                    lm.text as last_message_text,
                    lm.created_at as last_message_at,
                    c.updated_at as last_activity_at
                from harmonia.conversations c
                join harmonia.units u on u.id=c.unit_id
                join harmonia.contacts ct on ct.id=c.contact_id
                left join lateral (
                    select m.direction, m.text, m.created_at
                    from harmonia.messages m
                    where m.conversation_id=c.id
                    order by m.created_at desc
                    limit 1
                ) lm on true
                where u.slug=$1
                ${whereCursor}
                order by c.updated_at desc, c.id desc
                limit $4
            `
            : `
                select
                    c.id,
                    c.stage,
                    c.last_inbound_at,
                    c.last_outbound_at,
                    c.procedure_code,
                    c.procedure_confidence,
                    c.lead_speed_class,
                    c.created_at,
                    c.updated_at,
                    u.slug as unit_slug,
                    u.name as unit_name,
                    ct.phone_raw as contact_phone_raw,
                    ct.display_name as contact_display_name,
                    ct.opted_out_at as contact_opted_out_at,
                    lm.direction as last_message_direction,
                    lm.text as last_message_text,
                    lm.created_at as last_message_at,
                    c.updated_at as last_activity_at
                from harmonia.conversations c
                join harmonia.units u on u.id=c.unit_id
                join harmonia.contacts ct on ct.id=c.contact_id
                left join lateral (
                    select m.direction, m.text, m.created_at
                    from harmonia.messages m
                    where m.conversation_id=c.id
                    order by m.created_at desc
                    limit 1
                ) lm on true
                where u.slug=$1
                order by c.updated_at desc, c.id desc
                limit $2
            `

        const r = await tx.query(q, params)
        return r.rows || []
    }

    async function getTaskStats(tx) {
        const byStatusRows = await tx.query(
            `select status, count(*)::int as count from harmonia.tasks group by status`
        )
        const byTypeRows = await tx.query(
            `select type, count(*)::int as count from harmonia.tasks group by type`
        )
        const oldestPending = await tx.query(
            `select min(run_at) as oldest from harmonia.tasks where status='pending'`
        )
        const oldestProcessing = await tx.query(
            `select min(run_at) as oldest from harmonia.tasks where status='processing'`
        )

        const byStatus = {}
        for (const r of byStatusRows.rows || []) {
            byStatus[String(r.status || '')] = Number(r.count || 0)
        }
        const byType = {}
        for (const r of byTypeRows.rows || []) {
            byType[String(r.type || '')] = Number(r.count || 0)
        }

        return {
            byStatus,
            byType,
            oldestPendingAt: oldestPending.rows?.[0]?.oldest || null,
            oldestProcessingAt: oldestProcessing.rows?.[0]?.oldest || null,
        }
    }

    async function cleanupOldData(tx, { tasksDays, deliveryDays, messagesDays }) {
        const clampDays = (v, def) => {
            const n = Number(v)
            if (!Number.isFinite(n)) return def
            return Math.max(1, Math.min(3650, Math.floor(n)))
        }

        const tasksKeepDays = clampDays(tasksDays, 30)
        const deliveryKeepDays = clampDays(deliveryDays, 90)
        const messagesKeepDays = messagesDays == null ? null : clampDays(messagesDays, 180)

        const tasksRes = await tx.query(
            `delete from harmonia.tasks
             where status in ('done','failed')
             and updated_at < (now() - ($1::text || ' days')::interval)`,
            [String(tasksKeepDays)]
        )

        const deliveryRes = await tx.query(
            `delete from harmonia.delivery_events
             where created_at < (now() - ($1::text || ' days')::interval)`,
            [String(deliveryKeepDays)]
        )

        let messagesDeleted = null
        if (messagesKeepDays != null) {
            const messagesRes = await tx.query(
                `delete from harmonia.messages
                 where created_at < (now() - ($1::text || ' days')::interval)`,
                [String(messagesKeepDays)]
            )
            messagesDeleted = Number(messagesRes.rowCount || 0)
        }

        return {
            tasksDeleted: Number(tasksRes.rowCount || 0),
            deliveryDeleted: Number(deliveryRes.rowCount || 0),
            messagesDeleted,
            tasksKeepDays,
            deliveryKeepDays,
            messagesKeepDays,
        }
    }

    async function resetStaleTasks(tx, staleMinutes) {
        const minutes = Number(staleMinutes || 30)
        if (!Number.isFinite(minutes) || minutes <= 0) return 0
        const r = await tx.query(
            `update harmonia.tasks
             set status='pending', locked_at=null, updated_at=now()
             where status='processing' and locked_at < (now() - ($1::text || ' minutes')::interval)`,
            [String(minutes)]
        )
        return Number(r.rowCount || 0)
    }

    async function claimTasks(tx, { limit, staleMinutes }) {
        const lim = Number.isFinite(limit) ? Math.max(1, limit) : 20
        await resetStaleTasks(tx, staleMinutes)
        const r = await tx.query(
            `with due as (
                select id from harmonia.tasks
                where status='pending' and run_at <= now()
                order by run_at asc
                limit $1
                for update skip locked
            )
            update harmonia.tasks
            set status='processing', locked_at=now(), attempts=attempts+1, updated_at=now()
            where id in (select id from due)
            returning *`,
            [lim]
        )
        return r.rows || []
    }

    async function completeTask(tx, { taskId, status, error }) {
        const allowed = new Set(['done', 'failed', 'pending'])
        const s = allowed.has(status) ? status : 'done'
        const r = await tx.query(
            `update harmonia.tasks
             set status=$2, last_error=$3, updated_at=now()
             where id=$1
             returning *`,
            [taskId, s, error || null]
        )
        return r.rows?.[0] || null
    }

    async function rescheduleTask(tx, { taskId, runAt, error }) {
        const r = await tx.query(
            `update harmonia.tasks
             set status='pending', run_at=$2, last_error=$3, locked_at=null, updated_at=now()
             where id=$1
             returning *`,
            [taskId, runAt, error || null]
        )
        return r.rows?.[0] || null
    }

    function stablePlannedMessageId(inboundProviderMessageId, idx, text) {
        const base = `${inboundProviderMessageId || 'inbound'}:${idx}:${text || ''}`
        const h = createHash('sha256').update(base).digest('hex').slice(0, 24)
        return `planned:${h}`
    }

    return {
        pool,
        migrate,
        withTransaction: (fn) => {
            if (!pool) throw new Error('DATABASE_URL not configured')
            return withPgTransaction(pool, fn)
        },
        lockForKey,
        getOrCreateUnit,
        upsertContact,
        getOrCreateConversation,
        updateConversation,
        insertMessage,
        countOutbound,
        markOptOut,
        createTask,
        claimTasks,
        completeTask,
        rescheduleTask,
        findConversationByUnitPhone,
        getConversationWithContactByUnitPhone,
        getConversationWithContact,
        insertDeliveryEvent,
        resetStaleTasks,
        listMessagesByConversation,
        listConversationsByUnit,
        getTaskStats,
        cleanupOldData,
        listUnits,
        getUnitBySlug,
        stablePlannedMessageId,
    }
}
