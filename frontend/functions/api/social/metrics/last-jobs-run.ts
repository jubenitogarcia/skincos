import { requireInsumosUser } from '../../../_lib/insumosAuth'
import { getShareBucket, getJson } from '../../../_lib/r2'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const metrics = await getJson<any>(bucket, 'social/metrics/last_jobs_run.json').catch(() => null)
  if (!metrics) {
    return json(404, {
      ok: false,
      error: 'METRICS_NOT_FOUND',
      hint: 'Worker social-publisher ainda não rodou ou jobs/metrics estão desabilitados.',
    })
  }

  return json(200, { ok: true, metrics })
}

