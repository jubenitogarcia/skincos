import { requireCsrfForMutations } from '../../_lib/csrf'
import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket } from '../../_lib/r2'
import { requestAuditMeta, writeAuditEvent } from '../../_lib/audit'

type UploadFileOut = {
  name: string
  key: string
  size?: number
  contentType?: string
  url: string
}

const MAX_FILES = 6
const MAX_TOTAL_BYTES = 25 * 1024 * 1024
const MAX_FILE_BYTES = 10 * 1024 * 1024

const sanitizeName = (name: string) => {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'arquivo'
}

export async function onRequestPost(context: { request: Request; env?: Record<string, unknown> }): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) {
    return new Response(JSON.stringify({ success: false, error: 'Share storage not configured' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  try {
    const form = await context.request.formData()
    const files = form.getAll('files')
    const fileObjs = files.filter((f): f is File => typeof File !== 'undefined' && f instanceof File).slice(0, MAX_FILES)
    if (!fileObjs.length) {
      return new Response(JSON.stringify({ success: false, error: 'No files provided (field=files)' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }

    let total = 0
    const shareId = crypto.randomUUID()
    const storedFiles: UploadFileOut[] = []
    const origin = new URL(context.request.url).origin

    for (let idx = 0; idx < fileObjs.length; idx += 1) {
      const file = fileObjs[idx]
      if (!file || !file.name) continue
      if (file.size > MAX_FILE_BYTES) continue
      total += file.size || 0
      if (total > MAX_TOTAL_BYTES) break

      const safeName = sanitizeName(file.name)
      const key = `shares/${shareId}/files/${idx + 1}-${safeName}`
      await bucket.put(key, file, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      })

      const url = `${origin}/share/${shareId}?file=${encodeURIComponent(file.name)}&inline=1`
      storedFiles.push({ name: file.name, key, size: file.size, contentType: file.type || undefined, url })
    }

    const metaKey = `shares/${shareId}/payload.json`
    await bucket.put(
      metaKey,
      JSON.stringify({ files: storedFiles.map((f) => ({ name: f.name, key: f.key, size: f.size, contentType: f.contentType })), createdAt: new Date().toISOString() }),
      { httpMetadata: { contentType: 'application/json' } },
    )

    await writeAuditEvent(bucket, {
      scope: 'share',
      action: 'share.upload',
      actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
      request: requestAuditMeta(context.request),
      target: { shareId, fileCount: storedFiles.length, totalBytes: total },
      ok: true,
    }).catch(() => null)

    return new Response(JSON.stringify({ success: true, shareId, files: storedFiles }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || 'Upload failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
