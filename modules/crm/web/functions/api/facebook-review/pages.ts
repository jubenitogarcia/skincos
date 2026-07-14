import { requireCrmUser } from '../../_lib/crmAuth'
import { facebookReviewGraphGet } from '../../_lib/facebookReviewGraph'
import { readFacebookReviewConnectionDecrypted, writeFacebookReviewConnection } from '../../_lib/facebookReviewStore'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired, isMissingIntegrationsEncryptionSecretError } from '../../_lib/integrationsEncryption'
import { getShareBucket } from '../../_lib/r2'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const mapPages = (rows: any[]) =>
  (rows || [])
    .map((row) => ({
      id: String(row?.id || '').trim(),
      name: row?.name ? String(row.name) : null,
      pictureUrl: row?.picture?.data?.url ? String(row.picture.data.url) : null,
      tasks: Array.isArray(row?.tasks) ? row.tasks.map((task: any) => String(task || '')).filter(Boolean) : [],
      accessToken: row?.access_token ? String(row.access_token) : '',
    }))
    .filter((page) => page.id && page.accessToken)

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET_NOT_CONFIGURED' })

  const secret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !secret) {
    return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
  }

  let connection: any = null
  try {
    connection = await readFacebookReviewConnectionDecrypted(bucket, userOrRes.id, secret)
  } catch (error: any) {
    if (!secret && isMissingIntegrationsEncryptionSecretError(error)) {
      return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
    }
    return json(500, { ok: false, error: 'INTERNAL' })
  }
  if (!connection?.userAccessToken) return json(401, { ok: false, error: 'META_NOT_CONNECTED' })

  const pagesRes = await facebookReviewGraphGet<{ data: any[] }>(
    'me/accounts',
    { fields: 'id,name,access_token,picture{url},tasks', limit: 50 },
    connection.userAccessToken,
  )
  const pages = mapPages(pagesRes.data || [])

  const selected = pages.find((page) => page.id === connection.pageId)
  if (selected && selected.accessToken !== connection.pageAccessToken) {
    await writeFacebookReviewConnection(
      bucket,
      userOrRes.id,
      {
        ...connection,
        pageId: selected.id,
        pageName: selected.name || undefined,
        pageAccessToken: selected.accessToken,
        updatedAt: new Date().toISOString(),
      },
      secret,
    )
  }

  return json(200, {
    ok: true,
    selectedPageId: connection.pageId || null,
    pages: pages.map(({ accessToken, ...page }) => page),
  })
}
