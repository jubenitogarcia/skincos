// Service helpers to integrate with a local WhatsApp automation project.
// Expected local server endpoints:
//  - GET /init        -> { qr: string } (base64 data:image/... or textual fallback)
//  - GET /status      -> { state: 'QR' | 'CONNECTED' | 'STARTING' | 'ERROR', qr?: string, message?: string }
//  - POST /shutdown   -> { ok: true }
// Adapt these to match your local WhatsApp project contract.

export interface WhatsAppGatewayStatus {
    state: 'QR' | 'CONNECTED' | 'STARTING' | 'ERROR'
    qr?: string
    message?: string
}

async function safeJson(res: Response): Promise<any> {
    try { return await res.json() } catch { return null }
}

export async function initiateLocalWhatsApp(baseUrl: string): Promise<{ qr?: string }> {
    const url = baseUrl.replace(/\/$/, '') + '/init'
    try {
        const res = await fetch(url)
        if (!res.ok) throw new Error('Falha ao iniciar gateway (' + res.status + ')')
        const data = await safeJson(res) || {}
        return { qr: data.qr }
    } catch (e) {
        // Fallback mock QR (SVG) for demonstration
        const mock = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><rect width='240' height='240' fill='white'/><text x='50%' y='50%' font-size='14' font-family='monospace' fill='black' dominant-baseline='middle' text-anchor='middle'>QR MOCK\nInicie servidor</text></svg>`)
        return { qr: `data:image/svg+xml,${mock}` }
    }
}

export async function getLocalWhatsAppStatus(baseUrl: string): Promise<WhatsAppGatewayStatus> {
    const url = baseUrl.replace(/\/$/, '') + '/status'
    try {
        const res = await fetch(url)
        if (!res.ok) return { state: 'ERROR', message: 'HTTP ' + res.status }
        const data = await safeJson(res) || {}
        return {
            state: data.state || (data.qr ? 'QR' : 'STARTING'),
            qr: data.qr,
            message: data.message
        }
    } catch (e: any) {
        return { state: 'ERROR', message: e.message }
    }
}

export async function shutdownLocalWhatsApp(baseUrl: string): Promise<boolean> {
    const url = baseUrl.replace(/\/$/, '') + '/shutdown'
    try {
        const res = await fetch(url, { method: 'POST' })
        return res.ok
    } catch {
        return false
    }
}
