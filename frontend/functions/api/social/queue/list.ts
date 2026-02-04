import { requireCrmUser } from '../../../_lib/crmAuth'
import { getShareBucket, getJson } from '../../../_lib/r2'
import { isPublished } from '../../../_lib/socialQueue'
import { socialQueueGroupKey } from '../../../_lib/socialKeys'
import type { SocialPlatform, SocialQueueGroup } from '../../../_lib/socialTypes'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

async function listAll(bucket: R2Bucket, opts: { prefix: string; delimiter?: string }) {
  const objects: R2Object[] = []
  const delimitedPrefixes: string[] = []
  let cursor: string | undefined = undefined
  for (;;) {
    const res = await bucket.list({ ...opts, cursor })
    objects.push(...(res.objects || []))
    delimitedPrefixes.push(...(res.delimitedPrefixes || []))
    if (!res.truncated) break
    cursor = res.cursor
    if (!cursor) break
  }
  return { objects, delimitedPrefixes }
}

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const url = new URL(context.request.url)
  const dateKey = String(url.searchParams.get('dateKey') || '').trim()
  if (!dateKey.match(/^\d{6}$/)) return json(400, { ok: false, error: 'INVALID_DATEKEY', hint: 'Formato esperado: ddMMyy' })

  const prefixes = await listAll(bucket, { prefix: `social/queue/${dateKey}/`, delimiter: '/' })

  const groups: Array<{
    group: SocialQueueGroup
    assetsCount: number
    published: Record<string, Record<SocialPlatform, boolean>>
  }> = []

  for (const pref of prefixes.delimitedPrefixes) {
    const groupKey = pref.replace(`social/queue/${dateKey}/`, '').replace(/\/$/, '')
    if (!groupKey) continue
    const group = await getJson<SocialQueueGroup>(bucket, socialQueueGroupKey(dateKey, groupKey)).catch(() => null)
    if (!group) continue

    const assetsList = await listAll(bucket, { prefix: `social/queue/${dateKey}/${groupKey}/assets/` })
    const assetsCount = (assetsList.objects || []).length

    const published: Record<string, Record<SocialPlatform, boolean>> = {}
    for (const unitKey of group.unitKeys || []) {
      published[unitKey] = {} as any
      for (const platform of group.platforms || []) {
        published[unitKey][platform] = await isPublished(bucket, dateKey, groupKey, unitKey, platform).catch(() => false)
      }
    }

    groups.push({ group, assetsCount, published })
  }

  groups.sort((a, b) => String(a.group.scheduledAt).localeCompare(String(b.group.scheduledAt)))
  return json(200, { ok: true, dateKey, groups })
}
