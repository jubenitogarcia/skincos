import { promises as fs } from 'node:fs'
import { google } from 'googleapis'
import { CAIXA_SOURCE_SHEET_ID, CAIXA_TABS, buildCaixaRecords } from './domain.js'

async function sheetsClient() {
    const serviceAccountFile = String(process.env.ATENDIMENTO_GOOGLE_SA_FILE || process.env.HARMONIA_GOOGLE_SA_FILE || '').trim()
    if (!serviceAccountFile) {
        const error = new Error('GOOGLE_SHEETS_ACCESS_NOT_CONFIGURED'); error.statusCode = 424; throw error
    }
    const serviceAccount = JSON.parse(await fs.readFile(serviceAccountFile, 'utf8'))
    const auth = new google.auth.JWT(serviceAccount.client_email, null, serviceAccount.private_key, ['https://www.googleapis.com/auth/spreadsheets.readonly'])
    await auth.authorize()
    return google.sheets({ version: 'v4', auth })
}

export async function readCaixaGoogleSheet({ spreadsheetId = CAIXA_SOURCE_SHEET_ID } = {}) {
    const sheets = await sheetsClient(); const tabs = {}
    for (const tabName of CAIXA_TABS) {
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tabName}'!A:F`, valueRenderOption: 'FORMATTED_VALUE' })
        tabs[tabName] = Array.isArray(response.data?.values) ? response.data.values : []
    }
    return { spreadsheetId, tabs: CAIXA_TABS, records: buildCaixaRecords(tabs, spreadsheetId) }
}
