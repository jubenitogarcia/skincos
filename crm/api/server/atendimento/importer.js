import { createSign } from 'node:crypto'
import { promises as fs } from 'fs'
import {
    buildImportRecords,
    GERENCIA_SOURCE_SHEET_ID,
    OPERATIONAL_TABS,
    parseCacheRows,
    parseGerenciaWorkbook,
    SOURCE_SHEET_ID,
} from './domain.js'

async function getSheetsClient(config = {}) {
    const serviceAccountFile = String(config.serviceAccountFile || process.env.ATENDIMENTO_GOOGLE_SA_FILE || process.env.HARMONIA_GOOGLE_SA_FILE || '').trim()
    if (!serviceAccountFile) {
        return null
    }
    const { google } = await import('googleapis')
    const raw = await fs.readFile(serviceAccountFile, 'utf8')
    const json = JSON.parse(raw)
    const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']
    const auth = new google.auth.JWT(json.client_email, null, json.private_key, scopes)
    await auth.authorize()
    return google.sheets({ version: 'v4', auth })
}

let googleAccessTokenCache = null

async function fetchWithRetry(url, options = {}, attempts = 3) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetch(url, options)
            if (response.ok || (response.status !== 429 && response.status < 500) || attempt === attempts) return response
        } catch (error) {
            lastError = error
            if (attempt === attempts) throw error
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
    throw lastError || new Error('GOOGLE_REQUEST_FAILED')
}

function base64Url(value) {
    return Buffer.from(value).toString('base64url')
}

async function getGoogleReadOnlyAccessToken(config = {}) {
    const serviceAccountFile = String(config.serviceAccountFile || process.env.ATENDIMENTO_GOOGLE_SA_FILE || process.env.HARMONIA_GOOGLE_SA_FILE || '').trim()
    if (!serviceAccountFile) return null
    if (googleAccessTokenCache?.serviceAccountFile === serviceAccountFile && googleAccessTokenCache.expiresAt > Date.now() + 60_000) {
        return googleAccessTokenCache.token
    }

    const serviceAccount = JSON.parse(await fs.readFile(serviceAccountFile, 'utf8'))
    const now = Math.floor(Date.now() / 1000)
    const tokenUri = String(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token')
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = base64Url(JSON.stringify({
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
    }))
    const unsignedJwt = `${header}.${claims}`
    const signature = createSign('RSA-SHA256').update(unsignedJwt).end().sign(serviceAccount.private_key, 'base64url')
    const response = await fetchWithRetry(tokenUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${unsignedJwt}.${signature}`,
        }),
    })
    if (!response.ok) {
        const error = new Error(`GOOGLE_SERVICE_ACCOUNT_AUTH_FAILED_${response.status}`)
        error.statusCode = 502
        throw error
    }
    const payload = await response.json()
    const token = String(payload.access_token || '')
    if (!token) throw new Error('GOOGLE_SERVICE_ACCOUNT_TOKEN_MISSING')
    googleAccessTokenCache = {
        serviceAccountFile,
        token,
        expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000,
    }
    return token
}

function cellEffectiveValue(cell = {}) {
    const effective = cell.effectiveValue || cell.userEnteredValue || {}
    if (effective.numberValue !== undefined) return effective.numberValue
    if (effective.stringValue !== undefined) return effective.stringValue
    if (effective.boolValue !== undefined) return effective.boolValue
    if (effective.formulaValue !== undefined) return cell.formattedValue || effective.formulaValue
    if (cell.formattedValue !== undefined) return cell.formattedValue
    return ''
}

function componentToHex(value) {
    const num = Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 255)
    return num.toString(16).padStart(2, '0')
}

function googleColorToHex(color) {
    if (!color || typeof color !== 'object') return ''
    const red = color.red ?? 0
    const green = color.green ?? 0
    const blue = color.blue ?? 0
    return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`.toLowerCase()
}

function argbToHex(argb) {
    const raw = String(argb || '').trim().replace(/^#/, '')
    if (/^[0-9a-f]{8}$/i.test(raw)) return `#${raw.slice(2)}`.toLowerCase()
    if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase()
    return ''
}

function googleCellStyle(cell = {}) {
    const format = cell.userEnteredFormat || cell.effectiveFormat || {}
    const textFormat = format.textFormat || {}
    return {
        backgroundColor: googleColorToHex(format.backgroundColor || format.backgroundColorStyle?.rgbColor),
        fontColor: googleColorToHex(textFormat.foregroundColor || textFormat.foregroundColorStyle?.rgbColor),
        fontFamily: textFormat.fontFamily || '',
        fontSize: textFormat.fontSize || null,
        fontWeight: textFormat.bold ? 'bold' : 'normal',
        fontStyle: textFormat.italic ? 'italic' : 'normal',
        horizontalAlignment: format.horizontalAlignment || '',
        verticalAlignment: format.verticalAlignment || '',
        numberFormat: format.numberFormat?.pattern || '',
    }
}

function excelCellStyle(cell) {
    const fgColor = cell?.fill?.fgColor?.argb || cell?.fill?.fgColor?.rgb || ''
    const fontColor = cell?.font?.color?.argb || cell?.font?.color?.rgb || ''
    return {
        backgroundColor: argbToHex(fgColor),
        fontColor: argbToHex(fontColor),
        fontFamily: cell?.font?.name || '',
        fontSize: cell?.font?.size || null,
        fontWeight: cell?.font?.bold ? 'bold' : 'normal',
        fontStyle: cell?.font?.italic ? 'italic' : 'normal',
        horizontalAlignment: cell?.alignment?.horizontal || '',
        verticalAlignment: cell?.alignment?.vertical || '',
        numberFormat: typeof cell?.numFmt === 'string' ? cell.numFmt : '',
    }
}

function gridDataToTab(gridData = []) {
    const values = []
    const formulas = []
    const styles = []
    for (const block of gridData || []) {
        const startRow = Number(block.startRow || 0)
        const startCol = Number(block.startColumn || 0)
        for (let r = 0; r < (block.rowData || []).length; r += 1) {
            const rowIndex = startRow + r
            if (!values[rowIndex]) values[rowIndex] = []
            if (!formulas[rowIndex]) formulas[rowIndex] = []
            if (!styles[rowIndex]) styles[rowIndex] = []
            const cells = block.rowData[r]?.values || []
            for (let c = 0; c < cells.length; c += 1) {
                const colIndex = startCol + c
                const cell = cells[c] || {}
                values[rowIndex][colIndex] = cellEffectiveValue(cell)
                formulas[rowIndex][colIndex] = String(cell.userEnteredValue?.formulaValue || '').trim()
                styles[rowIndex][colIndex] = googleCellStyle(cell)
            }
        }
    }
    return { values, formulas, styles }
}

async function readGoogleApiWorkbook(sheets, spreadsheetId) {
    const metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(title,sheetId,gridProperties(rowCount,columnCount),hidden))',
    })
    const tabs = {}
    const sheetProps = metadata.data?.sheets || []
    for (const sheet of sheetProps) {
        const title = sheet.properties?.title
        if (!title) continue
        const response = await sheets.spreadsheets.get({
            spreadsheetId,
            ranges: [`'${title.replace(/'/g, "''")}'`],
            includeGridData: true,
            fields: 'sheets(data(startRow,startColumn,rowData(values(formattedValue,effectiveValue,userEnteredValue,dataValidation,userEnteredFormat(backgroundColor,backgroundColorStyle,textFormat(foregroundColor,foregroundColorStyle,fontFamily,fontSize,bold,italic),horizontalAlignment,verticalAlignment,numberFormat),effectiveFormat(backgroundColor,backgroundColorStyle,textFormat(foregroundColor,foregroundColorStyle,fontFamily,fontSize,bold,italic),horizontalAlignment,verticalAlignment,numberFormat))))),properties(title,sheetId,hidden,gridProperties(rowCount,columnCount)))',
        })
        const found = response.data?.sheets?.[0]
        tabs[title] = {
            ...gridDataToTab(found?.data || []),
            metadata: {
                sheetId: found?.properties?.sheetId,
                hidden: !!found?.properties?.hidden,
                rowCount: found?.properties?.gridProperties?.rowCount || 0,
                columnCount: found?.properties?.gridProperties?.columnCount || 0,
            },
        }
    }
    return tabs
}

async function parseXlsxWorkbook(buffer) {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const tabs = {}
    for (const ws of workbook.worksheets || []) {
        const tabName = ws.name
        const values = []
        const formulas = []
        const styles = []
        const maxRow = ws.rowCount || ws.actualRowCount || 0
        const maxCol = ws.columnCount || ws.actualColumnCount || 0
        for (let r = 1; r <= maxRow; r += 1) {
            values[r - 1] = []
            formulas[r - 1] = []
            styles[r - 1] = []
            const row = ws.getRow(r)
            for (let c = 1; c <= maxCol; c += 1) {
                const cell = row.getCell(c)
                const raw = cell.value
                if (raw && typeof raw === 'object' && 'formula' in raw) {
                    values[r - 1][c - 1] = raw.result ?? cell.text ?? ''
                    formulas[r - 1][c - 1] = raw.formula ? `=${raw.formula}` : ''
                } else if (raw && typeof raw === 'object' && 'richText' in raw) {
                    values[r - 1][c - 1] = raw.richText.map((part) => part.text || '').join('')
                    formulas[r - 1][c - 1] = ''
                } else if (raw instanceof Date) {
                    values[r - 1][c - 1] = raw
                    formulas[r - 1][c - 1] = ''
                } else {
                    values[r - 1][c - 1] = raw ?? ''
                    formulas[r - 1][c - 1] = ''
                }
                styles[r - 1][c - 1] = excelCellStyle(cell)
            }
        }
        tabs[tabName] = {
            values,
            formulas,
            styles,
            metadata: {
                hidden: false,
                rowCount: maxRow,
                columnCount: maxCol,
            },
        }
    }
    return tabs
}

async function readLocalXlsxWorkbook(filePath) {
    const buffer = await fs.readFile(filePath)
    return parseXlsxWorkbook(buffer)
}

async function readPublicXlsxWorkbook(spreadsheetId) {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=xlsx`
    const response = await fetch(url)
    if (!response.ok) {
        const err = new Error(`GOOGLE_SHEET_XLSX_EXPORT_FAILED_${response.status}`)
        err.statusCode = 502
        throw err
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    return parseXlsxWorkbook(buffer)
}

async function readAuthenticatedXlsxWorkbook(spreadsheetId, config = {}) {
    const accessToken = await getGoogleReadOnlyAccessToken(config)
    if (!accessToken) return null
    const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/export?mimeType=${encodeURIComponent(mimeType)}`
    const response = await fetchWithRetry(url, { headers: { authorization: `Bearer ${accessToken}` } })
    if (!response.ok) {
        const error = new Error(`GOOGLE_DRIVE_XLSX_EXPORT_FAILED_${response.status}`)
        error.statusCode = response.status === 403 || response.status === 404 ? 424 : 502
        throw error
    }
    return parseXlsxWorkbook(Buffer.from(await response.arrayBuffer()))
}

function tabRange(tabName) {
    return tabName === '_CACHE_GERENCIA' ? 'A:AZ' : 'A:L'
}

async function readGoogleApiTab(sheets, spreadsheetId, tabName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabName.replace(/'/g, "''")}'!${tabRange(tabName)}`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
    })
    return Array.isArray(response?.data?.values) ? response.data.values : []
}

function parseGvizResponse(text) {
    const raw = String(text || '').trim()
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end < start) throw new Error('GOOGLE_SHEET_GVIZ_PARSE_ERROR')
    return JSON.parse(raw.slice(start, end + 1))
}

function parseFormattedDayMonth(value) {
    const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/)
    if (!match) return null
    return {
        day: Number(match[1]),
        month: Number(match[2]),
    }
}

function parseGvizDateValue(value) {
    const match = String(value || '').trim().match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/)
    if (!match) return null
    return {
        year: Number(match[1]),
        month: Number(match[2]) + 1,
        day: Number(match[3]),
    }
}

export function gvizTableRowsToValues(rows = [], cols = []) {
    let yearContext = null
    let lastMonth = null
    const width = Math.max(12, Array.isArray(cols) ? cols.length : 0)
    const values = rows.map((row) => {
        const cells = row?.c || []
        const values = Array.from({ length: width }, (_, index) => {
            const cell = cells[index]
            if (!cell || cell.v === null || cell.v === undefined) return ''
            return cell.v
        })
        const dateCell = cells[0]
        const date = parseGvizDateValue(dateCell?.v)
        const formatted = parseFormattedDayMonth(dateCell?.f)
        if (date && formatted) {
            let year = date.year
            const month = formatted.month
            const day = formatted.day
            if (yearContext && lastMonth && month > lastMonth && year >= yearContext) {
                year = yearContext - 1
            } else if (year < 2000 && yearContext) {
                year = month > lastMonth ? yearContext - 1 : yearContext
            }
            yearContext = year
            lastMonth = month
            values[0] = `Date(${year},${month - 1},${day})`
        } else if (date) {
            yearContext = date.year
            lastMonth = date.month
        }
        return values
    })
    const header = Array.isArray(cols) ? cols.map((col) => String(col?.label ?? '').trim()) : []
    return header.some(Boolean) ? [header, ...values] : values
}

async function readPublicGvizTab(spreadsheetId, tabName) {
    const params = new URLSearchParams({
        tqx: 'out:json',
        sheet: tabName,
        range: tabRange(tabName),
    })
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?${params.toString()}`
    const response = await fetch(url)
    const text = await response.text()
    if (!response.ok) {
        const err = new Error(`GOOGLE_SHEET_PUBLIC_EXPORT_FAILED_${response.status}`)
        err.statusCode = 502
        throw err
    }
    const json = parseGvizResponse(text)
    if (json.status && json.status !== 'ok') {
        const err = new Error(`GOOGLE_SHEET_PUBLIC_EXPORT_${json.status}`)
        err.statusCode = 502
        throw err
    }
    return gvizTableRowsToValues(json.table?.rows || [], json.table?.cols || [])
}

async function readTab(sheets, spreadsheetId, tabName) {
    if (sheets) return readGoogleApiTab(sheets, spreadsheetId, tabName)
    return readPublicGvizTab(spreadsheetId, tabName)
}

export async function readAtendimentoSheet(config = {}) {
    const spreadsheetId = String(config.spreadsheetId || process.env.ATENDIMENTO_GOOGLE_SHEET_ID || SOURCE_SHEET_ID).trim()
    const workbookFile = String(config.workbookFile || process.env.ATENDIMENTO_GOOGLE_XLSX_FILE || '').trim()
    if (workbookFile) {
        const workbook = await readLocalXlsxWorkbook(workbookFile)
        const tabs = {}
        for (const tab of [...OPERATIONAL_TABS, '_CACHE_GERENCIA']) {
            tabs[tab] = workbook[tab]?.values || []
        }
        const records = buildImportRecords(tabs, config.now || new Date())
        const cache = parseCacheRows(tabs._CACHE_GERENCIA)
        return {
            spreadsheetId,
            tabs: OPERATIONAL_TABS,
            records,
            cache,
        }
    }
    const authenticatedWorkbook = await readAuthenticatedXlsxWorkbook(spreadsheetId, config)
    if (authenticatedWorkbook) {
        const tabs = {}
        for (const tab of [...OPERATIONAL_TABS, '_CACHE_GERENCIA']) {
            tabs[tab] = authenticatedWorkbook[tab]?.values || []
        }
        return {
            spreadsheetId,
            tabs: OPERATIONAL_TABS,
            records: buildImportRecords(tabs, config.now || new Date()),
            cache: parseCacheRows(tabs._CACHE_GERENCIA),
        }
    }
    const sheets = await getSheetsClient(config)
    const tabs = {}
    for (const tab of [...OPERATIONAL_TABS, '_CACHE_GERENCIA']) {
        tabs[tab] = await readTab(sheets, spreadsheetId, tab)
    }
    const records = buildImportRecords(tabs, config.now || new Date())
    const cache = parseCacheRows(tabs._CACHE_GERENCIA)
    return {
        spreadsheetId,
        tabs: OPERATIONAL_TABS,
        records,
        cache,
    }
}

export async function readGerenciaSheet(config = {}) {
    const spreadsheetId = String(config.spreadsheetId || process.env.GERENCIA_GOOGLE_SHEET_ID || GERENCIA_SOURCE_SHEET_ID).trim()
    const workbookFile = String(config.workbookFile || process.env.GERENCIA_GOOGLE_XLSX_FILE || '').trim()
    if (workbookFile) {
        const tabs = await readLocalXlsxWorkbook(workbookFile)
        return parseGerenciaWorkbook(tabs, { spreadsheetId, now: config.now || new Date() })
    }
    const authenticatedWorkbook = await readAuthenticatedXlsxWorkbook(spreadsheetId, config)
    const sheets = authenticatedWorkbook ? null : await getSheetsClient(config)
    const tabs = authenticatedWorkbook || (sheets
        ? await readGoogleApiWorkbook(sheets, spreadsheetId)
        : await readPublicXlsxWorkbook(spreadsheetId))
    return parseGerenciaWorkbook(tabs, { spreadsheetId, now: config.now || new Date() })
}

export async function readGerenciaChartIds(config = {}) {
    const spreadsheetId = String(config.spreadsheetId || process.env.GERENCIA_GOOGLE_SHEET_ID || GERENCIA_SOURCE_SHEET_ID).trim()
    const sheets = await getSheetsClient(config)
    if (!sheets) {
        return {
            spreadsheetId,
            configured: false,
            charts: [],
            hint: 'Configure ATENDIMENTO_GOOGLE_SA_FILE ou HARMONIA_GOOGLE_SA_FILE para ler IDs de gráficos pela Google Sheets API.',
        }
    }
    const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(title,sheetId),charts(chartId,spec(title)))',
    })
    const tabFilter = String(config.tab || '').trim()
    const charts = []
    for (const sheet of response.data?.sheets || []) {
        const title = sheet.properties?.title || ''
        if (tabFilter && title !== tabFilter) continue
        for (const chart of sheet.charts || []) {
            charts.push({
                tabName: title,
                sheetId: sheet.properties?.sheetId,
                chartId: chart.chartId,
                title: chart.spec?.title || '',
            })
        }
    }
    return { spreadsheetId, configured: true, charts }
}

export async function importAtendimentoFromGoogleSheet(store, { actor, dryRun = false, config = {} } = {}) {
    const sheet = await readAtendimentoSheet(config)
    const result = await store.importRecords({
        records: sheet.records,
        cache: sheet.cache,
        actor,
        dryRun,
    })
    return {
        ...result,
        spreadsheetId: sheet.spreadsheetId,
        tabs: sheet.tabs,
    }
}

export async function importGerenciaFromGoogleSheet(store, { actor, dryRun = false, config = {} } = {}) {
    const workbook = await readGerenciaSheet(config)
    const result = await store.importGerenciaWorkbook({
        workbook,
        actor,
        dryRun,
    })
    return {
        ...result,
        spreadsheetId: workbook.spreadsheetId,
        tabCount: workbook.tabs.length,
        tabs: workbook.tabs.map((tab) => tab.tabName),
        tabSummaries: workbook.tabs,
    }
}
