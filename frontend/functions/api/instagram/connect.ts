import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket } from '../../_lib/r2'
import { graphGet } from '../../_lib/instagramGraph'
import { writeConnection } from '../../_lib/instagramStore'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired } from '../../_lib/integrationsEncryption'
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

  const body = await context.request.json().catch(() => null)
  const accessToken = String(body?.accessToken || body?.token || '').trim()
  const igBusinessAccountId = String(body?.businessAccountId || body?.igBusinessAccountId || '').trim()
  if (!accessToken || !igBusinessAccountId) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe accessToken e businessAccountId.' })

  try {
    await graphGet(igBusinessAccountId, { fields: 'id,username' }, accessToken)
  } catch (e: any) {
    return json(400, { ok: false, error: 'TOKEN_INVALID', message: e?.message || 'Token inválido' })
  }

  const secret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !secret) {
    return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
  }
  await writeConnection(
    bucket,
    userOrRes.id,
    { accessToken, igBusinessAccountId, tokenType: 'manual', updatedAt: new Date().toISOString() },
    secret,
  )

  await writeAuditEvent(bucket, {
    scope: 'instagram',
    action: 'instagram.connect.manual',
    actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
    request: requestAuditMeta(context.request),
    target: { igBusinessAccountId },
    ok: true,
  }).catch(() => null)

  return json(200, { ok: true, connected: true, businessAccountId: igBusinessAccountId })
}
