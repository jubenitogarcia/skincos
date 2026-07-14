import { DateTime } from 'luxon'

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function parseHm(hm) {
    const m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const hour = Number.parseInt(m[1], 10)
    const minute = Number.parseInt(m[2], 10)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return { hour, minute }
}

function dayKeyFromDateTime(dt) {
    // Luxon DateTime.weekday: 1=Mon..7=Sun
    const idx = Math.max(1, Math.min(7, Number(dt.weekday || 1))) - 1
    return DAY_KEYS[idx]
}

function normalizeWorkingHours(workingHours) {
    const wh = workingHours && typeof workingHours === 'object' ? workingHours : {}
    const out = {}
    for (const k of DAY_KEYS) {
        const windows = Array.isArray(wh[k]) ? wh[k] : []
        out[k] = windows
            .map((w) => {
                const start = parseHm(w?.start)
                const end = parseHm(w?.end)
                if (!start || !end) return null
                return { start, end }
            })
            .filter(Boolean)
            .sort((a, b) => (a.start.hour * 60 + a.start.minute) - (b.start.hour * 60 + b.start.minute))
    }
    return out
}

function minutesOf(dt) {
    return Number(dt.hour) * 60 + Number(dt.minute)
}

function minutesOfHm(hm) {
    return hm.hour * 60 + hm.minute
}

export function isWithinWorkingHours({ workingHours, timezone, now }) {
    const tz = String(timezone || '').trim() || 'America/Sao_Paulo'
    const base = (() => {
        if (!now) return DateTime.now().setZone(tz)
        if (typeof now === 'string') {
            const parsed = DateTime.fromISO(now, { setZone: true })
            return parsed.isValid ? parsed.setZone(tz) : DateTime.now().setZone(tz)
        }
        if (now instanceof Date) return DateTime.fromJSDate(now, { zone: tz })
        return DateTime.now().setZone(tz)
    })()

    const dt = base
    const wh = normalizeWorkingHours(workingHours)

    const key = dayKeyFromDateTime(dt)
    const todayWindows = wh[key] || []
    const nowMin = minutesOf(dt)

    const isOpen = todayWindows.some((w) => {
        const startMin = minutesOfHm(w.start)
        const endMin = minutesOfHm(w.end)
        return nowMin >= startMin && nowMin < endMin
    })

    if (isOpen) {
        return { open: true, nextOpenAt: null, timezone: tz }
    }

    for (let offset = 0; offset <= 7; offset++) {
        const day = dt.plus({ days: offset })
        const dayKey = dayKeyFromDateTime(day)
        const windows = wh[dayKey] || []
        if (!windows.length) continue

        for (const w of windows) {
            const startMin = minutesOfHm(w.start)
            if (offset === 0 && startMin <= nowMin) continue
            const candidate = day.set({ hour: w.start.hour, minute: w.start.minute, second: 0, millisecond: 0 })
            return { open: false, nextOpenAt: candidate.toUTC().toISO(), timezone: tz }
        }
    }

    return { open: false, nextOpenAt: null, timezone: tz }
}

export function defaultWorkingHoursForUnitSlug(unitSlug) {
    const slug = String(unitSlug || '').trim().toLowerCase()

    // Defaults aligned to the text used in the n8n "Format" node.
    if (slug === 'novo_hamburgo') {
        return {
            mon: [{ start: '08:30', end: '20:30' }],
            tue: [{ start: '08:30', end: '20:30' }],
            wed: [{ start: '08:30', end: '20:30' }],
            thu: [{ start: '08:30', end: '20:30' }],
            fri: [{ start: '08:30', end: '20:30' }],
            sat: [{ start: '09:00', end: '20:00' }],
            sun: [],
        }
    }

    if (slug === 'barra_shopping') {
        return {
            mon: [{ start: '10:00', end: '22:00' }],
            tue: [{ start: '10:00', end: '22:00' }],
            wed: [{ start: '10:00', end: '22:00' }],
            thu: [{ start: '10:00', end: '22:00' }],
            fri: [{ start: '10:00', end: '22:00' }],
            sat: [{ start: '10:00', end: '22:00' }],
            sun: [{ start: '11:15', end: '20:45' }],
        }
    }

    return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
}

