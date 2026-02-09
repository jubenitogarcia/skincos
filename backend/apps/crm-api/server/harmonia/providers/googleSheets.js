import { promises as fs } from 'fs'
import { google } from 'googleapis'

function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase()
}

function parseMensagemNumber(header) {
    const raw = String(header || '').trim()
    const m = raw.match(/mensagem\\s*(\\d+)/i)
    if (!m) return null
    return Number.parseInt(m[1], 10)
}

export function createGoogleSheetsProcedureProvider(config) {
    const docId = config?.google?.docId
    const gid = config?.google?.gid
    const tabName = config?.google?.tabName
    const saFile = config?.google?.serviceAccountFile

    const cache = {
        ts: 0,
        map: new Map(),
        tabTitle: null,
    }

    async function getAuth() {
        if (!saFile) throw new Error('HARMONIA_GOOGLE_SA_FILE not configured')
        const raw = await fs.readFile(saFile, 'utf-8')
        const json = JSON.parse(raw)
        const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']
        const auth = new google.auth.JWT(json.client_email, null, json.private_key, scopes)
        await auth.authorize()
        return auth
    }

    async function resolveTabTitle(sheets) {
        if (cache.tabTitle) return cache.tabTitle
        if (tabName) {
            cache.tabTitle = tabName
            return tabName
        }
        if (!gid || !Number.isFinite(gid)) throw new Error('HARMONIA_GOOGLE_SHEETS_GID not configured (or set TAB_NAME)')

        const meta = await sheets.spreadsheets.get({
            spreadsheetId: docId,
            fields: 'sheets(properties(sheetId,title))',
        })
        const found = (meta?.data?.sheets || []).find((s) => Number(s?.properties?.sheetId) === Number(gid))
        const title = found?.properties?.title
        if (!title) throw new Error(`Sheet gid not found: ${gid}`)
        cache.tabTitle = title
        return title
    }

    async function refreshIfNeeded() {
        const now = Date.now()
        if (now - cache.ts < 5 * 60_000 && cache.map.size) return

        if (!docId) throw new Error('HARMONIA_GOOGLE_SHEETS_DOC_ID not configured')
        const auth = await getAuth()
        const sheets = google.sheets({ version: 'v4', auth })
        const title = await resolveTabTitle(sheets)

        const r = await sheets.spreadsheets.values.get({
            spreadsheetId: docId,
            range: `${title}!A:ZZ`,
        })

        const values = Array.isArray(r?.data?.values) ? r.data.values : []
        const header = values[0] || []
        if (!header.length) throw new Error('Sheet header is empty')

        const codeIdx = header.findIndex((h) => normalizeHeader(h) === 'código' || normalizeHeader(h) === 'codigo')
        if (codeIdx < 0) throw new Error('Column "CÓDIGO" not found')

        const msgCols = []
        for (let i = 0; i < header.length; i++) {
            const n = parseMensagemNumber(header[i])
            if (n != null && Number.isFinite(n)) msgCols.push({ idx: i, n })
        }
        msgCols.sort((a, b) => a.n - b.n)

        const map = new Map()
        for (let row = 1; row < values.length; row++) {
            const line = values[row] || []
            const code = String(line[codeIdx] || '').trim()
            if (!code) continue

            const messages = msgCols
                .map((c) => String(line[c.idx] || '').trim())
                .filter((t) => Boolean(t))

            map.set(code, messages)
        }

        cache.map = map
        cache.ts = now
    }

    async function safeRefresh() {
        try {
            await refreshIfNeeded()
            return true
        } catch {
            return false
        }
    }

    return {
        async getMessagesByProcedureCode(procedureCode) {
            const code = String(procedureCode || '').trim()
            if (!code) return null
            const ok = await safeRefresh()
            if (!ok) return null
            const messages = cache.map.get(code)
            if (!messages) return null
            return { procedureCode: code, messages }
        },

        async hasProcedureCode(procedureCode) {
            const code = String(procedureCode || '').trim()
            if (!code) return false
            const ok = await safeRefresh()
            if (!ok) return false
            return cache.map.has(code)
        },
    }
}

