import { requireInsumosUser } from '../../../_lib/insumosAuth'
import { signState } from '../../../_lib/oauthState'

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const appId = String(context?.env?.META_APP_ID || '').trim()
  const secret = String(context?.env?.META_OAUTH_STATE_SECRET || context?.env?.META_APP_SECRET || '').trim()
  if (!appId) return new Response('META_APP_ID not configured', { status: 503, headers: { 'cache-control': 'no-store' } })
  if (!secret) return new Response('META_OAUTH_STATE_SECRET not configured', { status: 503, headers: { 'cache-control': 'no-store' } })

  const origin = new URL(context.request.url).origin
  const redirectUri = `${origin}/api/instagram/oauth/callback`

  const state = await signState({ userId: userOrRes.id, nonce: crypto.randomUUID(), iat: Date.now() }, secret)

  const scopes =
    String(context?.env?.META_OAUTH_SCOPES || '').trim() ||
    [
      'instagram_basic',
      'instagram_manage_comments',
      'instagram_manage_insights',
      'instagram_content_publish',
      'pages_show_list',
    ].join(',')

  const qs = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: scopes,
    response_type: 'code',
  })

  return Response.redirect(`https://www.facebook.com/v20.0/dialog/oauth?${qs.toString()}`, 302)
}

