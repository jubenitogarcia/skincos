import { requireSocialAdmin } from '../../_lib/socialAuth'
import { getShareBucket, getJson, putJson } from '../../_lib/r2'
import { socialQueueGroupKey } from '../../_lib/socialKeys'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { requestAuditMeta, writeAuditEvent } from '../../_lib/audit'
import type { SocialQueueGroup } from '../../_lib/socialTypes'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function onRequestPost(context: any): Promise<Response> {
  const adminOrRes = await requireSocialAdmin(context)
  if (adminOrRes instanceof Response) return adminOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const body = await context.request.json().catch(() => null)
  const dateKey = String(body?.dateKey || '').trim()
  const groupKey = String(body?.groupKey || '').trim()
  const force = !!body?.force
  if (!dateKey || !groupKey) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe dateKey e groupKey.' })

  const group = await getJson<SocialQueueGroup>(bucket, socialQueueGroupKey(dateKey, groupKey))
  if (!group) return json(404, { ok: false, error: 'GROUP_NOT_FOUND' })

  const jobId = crypto.randomUUID()
  const requestedAt = new Date().toISOString()
  const jobKey = `social/jobs/${dateKey}/${groupKey}/${jobId}.json`
  const jobIndexKey = `social/job-index/${jobId}.json`
  await putJson(bucket, jobKey, {
    jobId,
    dateKey,
    groupKey,
    force,
    requestedAt,
    requestedBy: { id: adminOrRes.id, email: adminOrRes.email, name: adminOrRes.name },
  })
  await putJson(bucket, jobIndexKey, { jobId, dateKey, groupKey, force, requestedAt })

  await writeAuditEvent(bucket, {
    scope: 'social',
    action: 'social.publish.enqueued',
    actor: { id: adminOrRes.id, email: adminOrRes.email, name: adminOrRes.name },
    request: requestAuditMeta(context.request),
    target: {
      dateKey,
      groupKey,
      force,
      jobId,
    },
    ok: true,
  }).catch(() => null)

  return json(202, { ok: true, dateKey, groupKey, jobId })
}
