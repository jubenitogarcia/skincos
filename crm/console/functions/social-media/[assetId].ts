import { getShareBucket, getJson } from '../_lib/r2'
import { safeContentDispositionFilename } from '../_lib/contentDisposition'
import type { SocialQueueAsset } from '../_lib/socialTypes'

const parseMaxAgeDays = (raw: any): number | null => {
  const n = Number(String(raw || '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

const isExpiredByDays = (iso: string, maxDays: number) => {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return false
  return Date.now() - ms > maxDays * 24 * 60 * 60 * 1000
}

export async function onRequestGet(context: any): Promise<Response> {
  const bucket = getShareBucket(context)
  if (!bucket) return new Response('Share storage not configured', { status: 404 })

  const assetId = String(context?.params?.assetId || '').trim()
  if (!assetId) return new Response('Not found', { status: 404 })

  const meta = await getJson<SocialQueueAsset>(bucket, `social/assets/${assetId}/meta.json`)
  if (!meta?.fileKey) return new Response('Not found', { status: 404 })

  const maxAgeDays = parseMaxAgeDays(context?.env?.SOCIAL_MEDIA_MAX_AGE_DAYS)
  if (maxAgeDays && isExpiredByDays(meta.createdAt, maxAgeDays)) return new Response('Not found', { status: 404 })

  const obj = await bucket.get(meta.fileKey)
  if (!obj) return new Response('Not found', { status: 404 })

  const url = new URL(context.request.url)
  const inline = url.searchParams.get('inline') === '1'

  const headers = new Headers()
  headers.set('Content-Type', meta.contentType || obj.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeContentDispositionFilename(meta.originalName || 'arquivo')}"`)
  headers.set('Cache-Control', 'no-store')
  return new Response(obj.body, { status: 200, headers })
}
