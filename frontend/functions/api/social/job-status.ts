import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket, getJson } from '../../_lib/r2'

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

  const url = new URL(context.request.url)
  const jobId = String(url.searchParams.get('jobId') || '').trim()
  if (!jobId) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe jobId.' })

  const index = await getJson<any>(bucket, `social/job-index/${jobId}.json`).catch(() => null)
  if (!index?.dateKey || !index?.groupKey) {
    return json(404, { ok: false, error: 'JOB_NOT_FOUND' })
  }

  const result = await getJson<any>(bucket, `social/job-results/${jobId}.json`).catch(() => null)
  if (result) {
    return json(200, { ok: true, status: 'done', jobId, result })
  }

  const jobKey = `social/jobs/${index.dateKey}/${index.groupKey}/${jobId}.json`
  const jobHead = await bucket.head(jobKey).catch(() => null)
  if (jobHead) {
    return json(200, { ok: true, status: 'pending', jobId, dateKey: index.dateKey, groupKey: index.groupKey })
  }

  return json(200, { ok: true, status: 'unknown', jobId, dateKey: index.dateKey, groupKey: index.groupKey })
}
