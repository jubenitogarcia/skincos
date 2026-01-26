import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket } from '../../_lib/r2'
import { graphPost } from '../../_lib/instagramGraph'
import { readConnectionDecrypted } from '../../_lib/instagramStore'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired, isMissingIntegrationsEncryptionSecretError } from '../../_lib/integrationsEncryption'
import { requestAuditMeta, writeAuditEvent } from '../../_lib/audit'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function onRequestPost(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const secret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !secret) {
    return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
  }

  let conn: any = null
  try {
    conn = await readConnectionDecrypted(bucket, userOrRes.id, secret)
  } catch (e: any) {
    if (!secret && isMissingIntegrationsEncryptionSecretError(e)) {
      return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
    }
    return json(500, { ok: false, error: 'INTERNAL' })
  }
  if (!conn) return json(401, { ok: false, error: 'INSTAGRAM_NOT_CONNECTED' })

  const body = await context.request.json().catch(() => null)
  const commentId = String(body?.commentId || '').trim()
  const message = String(body?.message || '').trim()
  if (!commentId || !message) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe commentId e message.' })

  const out = await graphPost<{ id: string }>(`${commentId}/replies`, { message }, conn.accessToken)
  await writeAuditEvent(bucket, {
    scope: 'instagram',
    action: 'instagram.comment.reply',
    actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
    request: requestAuditMeta(context.request),
    target: { commentId },
    ok: true,
  }).catch(() => null)
  return json(200, { ok: true, id: out.id })
}
