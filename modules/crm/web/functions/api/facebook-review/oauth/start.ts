import { requireCrmUser } from '../../../_lib/crmAuth'
import { signState } from '../../../_lib/oauthState'

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const appId = String(context?.env?.META_APP_ID || '').trim()
  const secret = String(context?.env?.META_OAUTH_STATE_SECRET || context?.env?.META_APP_SECRET || '').trim()
  if (!appId) return new Response('META_APP_ID not configured', { status: 503, headers: { 'cache-control': 'no-store' } })
  if (!secret) return new Response('META_OAUTH_STATE_SECRET not configured', { status: 503, headers: { 'cache-control': 'no-store' } })

  const origin = new URL(context.request.url).origin
  const redirectUri = `${origin}/api/facebook-review/oauth/callback`
  const state = await signState({ userId: userOrRes.id, nonce: crypto.randomUUID(), iat: Date.now() }, secret)

  const scopes =
    String(context?.env?.META_PAGES_REVIEW_SCOPES || '').trim() ||
    ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'public_profile'].join(',')

  const qs = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: scopes,
    response_type: 'code',
  })

  return Response.redirect(`https://www.facebook.com/v20.0/dialog/oauth?${qs.toString()}`, 302)
}
