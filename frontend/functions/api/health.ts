export async function onRequest(): Promise<Response> {
    return new Response(
        JSON.stringify({ ok: true, service: 'crm-pages', ts: new Date().toISOString() }),
        { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
    )
}

