import { requireSocialAdmin } from '../../../_lib/socialAuth'
import { isLocalDevAuthBypassEnabled } from '../../../_lib/crmAuth'
import { getShareBucket } from '../../../_lib/r2'
import { deleteSocialAccount, listSocialAccounts, upsertSocialAccount } from '../../../_lib/socialAccounts'
import { requireCsrfForMutations } from '../../../_lib/csrf'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired } from '../../../_lib/integrationsEncryption'
import { requestAuditMeta, writeAuditEvent } from '../../../_lib/audit'
import type { SocialPlatform } from '../../../_lib/socialTypes'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const isPlatform = (v: string): v is SocialPlatform => ['instagram', 'facebook', 'threads'].includes(v)

export async function onRequestGet(context: any): Promise<Response> {
  const adminOrRes = await requireSocialAdmin(context)
  if (adminOrRes instanceof Response) return adminOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) {
    if (isLocalDevAuthBypassEnabled(context)) {
      return json(200, { ok: true, accounts: [], localStub: true, reason: 'SHARE_BUCKET_NOT_CONFIGURED' })
    }
    return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })
  }

  const accounts = await listSocialAccounts(bucket)
  return json(200, { ok: true, accounts })
}

export async function onRequestPost(context: any): Promise<Response> {
  const adminOrRes = await requireSocialAdmin(context)
  if (adminOrRes instanceof Response) return adminOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const secret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !secret) {
    return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
  }

  const body = await context.request.json().catch(() => null)
  const unitKey = String(body?.unitKey || '').trim()
  const platform = String(body?.platform || '').trim().toLowerCase()
  const accountId = String(body?.accountId || '').trim()
  const accessToken = String(body?.accessToken || '').trim()
  const apiVersion = body?.apiVersion ? String(body.apiVersion).trim() : undefined
  const apiBase = body?.apiBase ? String(body.apiBase).trim() : undefined

  if (!unitKey || !isPlatform(platform) || !accountId || !accessToken) {
    return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe unitKey, platform, accountId, accessToken.' })
  }

  await upsertSocialAccount(bucket, { unitKey, platform, accountId, accessToken, apiVersion, apiBase }, secret)
  await writeAuditEvent(bucket, {
    scope: 'social',
    action: 'social.account.upsert',
    actor: { id: adminOrRes.id, email: adminOrRes.email, name: adminOrRes.name },
    request: requestAuditMeta(context.request),
    target: { unitKey, platform, accountId, apiVersion, apiBase },
    ok: true,
  }).catch(() => null)
  return json(200, { ok: true })
}

export async function onRequestDelete(context: any): Promise<Response> {
  const adminOrRes = await requireSocialAdmin(context)
  if (adminOrRes instanceof Response) return adminOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const url = new URL(context.request.url)
  const unitKey = String(url.searchParams.get('unitKey') || '').trim()
  const platform = String(url.searchParams.get('platform') || '').trim().toLowerCase()
  if (!unitKey || !isPlatform(platform)) return json(400, { ok: false, error: 'INVALID_INPUT' })

  await deleteSocialAccount(bucket, unitKey, platform)
  await writeAuditEvent(bucket, {
    scope: 'social',
    action: 'social.account.delete',
    actor: { id: adminOrRes.id, email: adminOrRes.email, name: adminOrRes.name },
    request: requestAuditMeta(context.request),
    target: { unitKey, platform },
    ok: true,
  }).catch(() => null)
  return json(200, { ok: true })
}
