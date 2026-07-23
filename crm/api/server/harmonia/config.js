import path from 'path'

export function loadHarmoniaConfig({ varDir }) {
    const debugToken = String(process.env.HARMONIA_DEBUG_TOKEN || '').trim() || null
    const execToken = String(process.env.HARMONIA_EXEC_TOKEN || '').trim() || null
    const ingestToken = String(process.env.HARMONIA_INGEST_TOKEN || '').trim() || null
    const googleSheetsDocId = String(process.env.HARMONIA_GOOGLE_SHEETS_DOC_ID || '').trim() || null
    const googleSheetsGidRaw = String(process.env.HARMONIA_GOOGLE_SHEETS_GID || '').trim()
    const googleSheetsGid = googleSheetsGidRaw ? Number.parseInt(googleSheetsGidRaw, 10) : null
    const googleSheetsTabName = String(process.env.HARMONIA_GOOGLE_SHEETS_TAB_NAME || '').trim() || null

    const googleSaFile =
        String(process.env.HARMONIA_GOOGLE_SA_FILE || '').trim() ||
        path.join(varDir, 'secrets', 'google-sa.json')

    const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim() || null
    const openAiModel = String(process.env.HARMONIA_OPENAI_MODEL || '').trim() || 'gpt-5-nano'

    const storeRaw = ['1', 'true', 'yes'].includes(String(process.env.HARMONIA_STORE_RAW || '').toLowerCase())
    const rateLimitSecondsRaw = String(process.env.HARMONIA_RATE_LIMIT_SECONDS || '').trim()
    const rateLimitSeconds = rateLimitSecondsRaw ? Number.parseInt(rateLimitSecondsRaw, 10) : 20
    const tasksClaimLimitRaw = String(process.env.HARMONIA_TASKS_CLAIM_LIMIT || '').trim()
    const tasksClaimLimit = tasksClaimLimitRaw ? Number.parseInt(tasksClaimLimitRaw, 10) : 20
    const tasksStaleMinutesRaw = String(process.env.HARMONIA_TASKS_STALE_MINUTES || '').trim()
    const tasksStaleMinutes = tasksStaleMinutesRaw ? Number.parseInt(tasksStaleMinutesRaw, 10) : 30
    const autoExecute = ['1', 'true', 'yes'].includes(String(process.env.HARMONIA_AUTO_EXECUTE || '').toLowerCase())
    const workerEnabled = ['1', 'true', 'yes'].includes(String(process.env.HARMONIA_WORKER || '').toLowerCase())
    const tasksMaxAttemptsRaw = String(process.env.HARMONIA_TASKS_MAX_ATTEMPTS || '').trim()
    const tasksMaxAttempts = tasksMaxAttemptsRaw ? Number.parseInt(tasksMaxAttemptsRaw, 10) : 5
    const tasksBackoffSecondsRaw = String(process.env.HARMONIA_TASKS_BACKOFF_SECONDS || '').trim()
    const tasksBackoffSeconds = tasksBackoffSecondsRaw ? Number.parseInt(tasksBackoffSecondsRaw, 10) : 30
    const tasksBackoffMaxSecondsRaw = String(process.env.HARMONIA_TASKS_BACKOFF_MAX_SECONDS || '').trim()
    const tasksBackoffMaxSeconds = tasksBackoffMaxSecondsRaw ? Number.parseInt(tasksBackoffMaxSecondsRaw, 10) : 900
    const tasksAlertNotify = ['1', 'true', 'yes'].includes(String(process.env.HARMONIA_TASKS_ALERT_NOTIFY || '').toLowerCase())

    const waProvider = String(process.env.HARMONIA_WA_PROVIDER || 'official').trim().toLowerCase()
    const waBaseUrl = String(process.env.HARMONIA_WA_BASE_URL || 'http://localhost:3001').trim()
    const waChannelDefaultRaw = String(process.env.HARMONIA_WA_CHANNEL_DEFAULT || '1').trim()
    const waChannelDefault = Number.parseInt(waChannelDefaultRaw, 10)
    const defaultUnitSlug = String(process.env.HARMONIA_DEFAULT_UNIT_SLUG || 'novo_hamburgo').trim()
    const officialInstanceName = String(process.env.HARMONIA_OFFICIAL_INSTANCE_NAME || 'WhatsApp Official').trim()
    const ctaDefault = String(process.env.HARMONIA_CTA_DEFAULT || 'hoje').trim()
    const webhookSecret = String(process.env.HARMONIA_WEBHOOK_SECRET || '').trim() || null

    const tagMapEnv = String(process.env.HARMONIA_TAG_MAP || '').trim()
    let tagMap = null
    if (tagMapEnv) {
        try { tagMap = JSON.parse(tagMapEnv) } catch { tagMap = null }
    }

    const notifyMapEnv = String(process.env.HARMONIA_NOTIFY_MAP || '').trim()
    let notifyMap = null
    if (notifyMapEnv) {
        try { notifyMap = JSON.parse(notifyMapEnv) } catch { notifyMap = null }
    }

    const channelMapEnv = String(process.env.HARMONIA_CHANNEL_MAP || '').trim()
    let channelMap = null
    if (channelMapEnv) {
        try { channelMap = JSON.parse(channelMapEnv) } catch { channelMap = null }
    }

    const attendantsEnv = String(process.env.HARMONIA_ATTENDANTS || '').trim()
    let attendants = null
    if (attendantsEnv) {
        try { attendants = JSON.parse(attendantsEnv) } catch { attendants = null }
    }

    return {
        databaseUrl: String(process.env.DATABASE_URL || '').trim() || null,
        debugToken,
        execToken,
        ingestToken,
        autoMigrate: false,
        storeRaw,
        rateLimitSeconds: Number.isFinite(rateLimitSeconds) ? Math.max(0, rateLimitSeconds) : 0,
        tasksClaimLimit: Number.isFinite(tasksClaimLimit) ? Math.max(1, tasksClaimLimit) : 20,
        tasksStaleMinutes: Number.isFinite(tasksStaleMinutes) ? Math.max(1, tasksStaleMinutes) : 30,
        tasksMaxAttempts: Number.isFinite(tasksMaxAttempts) ? Math.max(1, tasksMaxAttempts) : 5,
        tasksBackoffSeconds: Number.isFinite(tasksBackoffSeconds) ? Math.max(1, tasksBackoffSeconds) : 30,
        tasksBackoffMaxSeconds: Number.isFinite(tasksBackoffMaxSeconds) ? Math.max(5, tasksBackoffMaxSeconds) : 900,
        tasksAlertNotify,
        autoExecute,
        workerEnabled,
        webhook: {
            secret: webhookSecret,
        },
        wa: {
            provider: waProvider || 'official',
            baseUrl: waBaseUrl,
            channelDefault: Number.isFinite(waChannelDefault) ? waChannelDefault : 1,
            channelNh: Number.parseInt(String(process.env.HARMONIA_WA_CHANNEL_NH || '').trim(), 10),
            channelBss: Number.parseInt(String(process.env.HARMONIA_WA_CHANNEL_BSS || '').trim(), 10),
        },
        defaults: {
            unitSlug: defaultUnitSlug || 'novo_hamburgo',
            instanceName: officialInstanceName,
            cta: ctaDefault || 'hoje',
        },
        google: {
            docId: googleSheetsDocId,
            gid: Number.isFinite(googleSheetsGid) ? googleSheetsGid : null,
            tabName: googleSheetsTabName,
            serviceAccountFile: googleSaFile,
        },
        openai: {
            apiKey: openAiApiKey,
            model: openAiModel,
        },
        tagMap: tagMap && typeof tagMap === 'object' ? tagMap : null,
        notifyMap: notifyMap && typeof notifyMap === 'object' ? notifyMap : null,
        channelMap: channelMap && typeof channelMap === 'object' ? channelMap : null,
        attendants: attendants && typeof attendants === 'object' ? attendants : null,
    }
}
