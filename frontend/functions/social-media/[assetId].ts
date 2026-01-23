import { getShareBucket, getJson } from '../_lib/r2'
import type { SocialQueueAsset } from '../_lib/socialTypes'

export async function onRequestGet(context: any): Promise<Response> {
  const bucket = getShareBucket(context)
  if (!bucket) return new Response('Share storage not configured', { status: 404 })

  const assetId = String(context?.params?.assetId || '').trim()
  if (!assetId) return new Response('Not found', { status: 404 })

  const meta = await getJson<SocialQueueAsset>(bucket, `social/assets/${assetId}/meta.json`)
  if (!meta?.fileKey) return new Response('Not found', { status: 404 })

  const obj = await bucket.get(meta.fileKey)
  if (!obj) return new Response('Not found', { status: 404 })

  const url = new URL(context.request.url)
  const inline = url.searchParams.get('inline') === '1'

  const headers = new Headers()
  headers.set('Content-Type', meta.contentType || obj.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${meta.originalName || 'arquivo'}"`)
  headers.set('Cache-Control', 'no-store')
  return new Response(obj.body, { status: 200, headers })
}

