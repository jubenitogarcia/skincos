import { requireCrmUser } from '../../_lib/crmAuth'
import { getShareBucket, getJson } from '../../_lib/r2'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

async function listAll(bucket: R2Bucket, opts: { prefix: string }) {
  const objects: R2Object[] = []
  let cursor: string | undefined = undefined
  for (;;) {
    const res = await bucket.list({ ...opts, cursor })
    objects.push(...(res.objects || []))
    if (!res.truncated) break
    cursor = res.cursor
    if (!cursor) break
  }
  return { objects }
}

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const url = new URL(context.request.url)
  const dateKey = String(url.searchParams.get('dateKey') || '').trim()
  const groupKey = String(url.searchParams.get('groupKey') || '').trim()
  if (!dateKey || !groupKey) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe dateKey e groupKey.' })

  const { objects } = await listAll(bucket, { prefix: `social/results/${dateKey}/${groupKey}/` })

  const results: Record<string, Record<string, any>> = {}
  for (const o of objects || []) {
    const key = String(o.key || '')
    const parts = key.split('/')
    if (parts.length < 6) continue
    const unitEnc = parts[4] || ''
    const platformRaw = String(parts[5] || '').replace(/\.json$/, '')
    if (!unitEnc || !platformRaw) continue
    const unitKey = decodeURIComponent(unitEnc)
    const platform = platformRaw
    const data = await getJson<any>(bucket, key).catch(() => null)
    if (!data) continue
    if (!results[unitKey]) results[unitKey] = {}
    results[unitKey][platform] = data
  }

  return json(200, { ok: true, dateKey, groupKey, results })
}
