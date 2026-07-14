import { requireCrmUser } from '../../../_lib/crmAuth'
import { getShareBucket } from '../../../_lib/r2'
import { verifyState } from '../../../_lib/oauthState'
import { graphGet } from '../../../_lib/instagramGraph'
import { writeConnection, writePending } from '../../../_lib/instagramStore'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired } from '../../../_lib/integrationsEncryption'

type OAuthState = { userId: string; nonce: string; iat: number }

const html = (body: string) =>
  new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
      'content-security-policy': [
        "default-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "connect-src 'self'",
        "img-src 'self' data:",
      ].join('; '),
    },
  })

const esc = (s: any) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

async function fetchJson(url: string) {
  const res = await fetch(url)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message || data?.error_description || `HTTP ${res.status}`)
  return data
}

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return html('<p>Share storage not configured</p>')

  const appId = String(context?.env?.META_APP_ID || '').trim()
  const appSecret = String(context?.env?.META_APP_SECRET || '').trim()
  const stateSecret = String(context?.env?.META_OAUTH_STATE_SECRET || context?.env?.META_APP_SECRET || '').trim()
  const encSecret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !encSecret) {
    return html('<p>Integrações: INTEGRATIONS_ENCRYPTION_SECRET não configurado.</p>')
  }

  if (!appId || !appSecret || !stateSecret) {
    return html('<p>Meta OAuth not configured (META_APP_ID / META_APP_SECRET / META_OAUTH_STATE_SECRET).</p>')
  }

  const url = new URL(context.request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const err = url.searchParams.get('error') || url.searchParams.get('error_reason')
  const errDesc = url.searchParams.get('error_description')

  if (err) return html(`<p>Erro OAuth: ${esc(err)}<br/>${esc(errDesc)}</p>`)
  if (!code || !state) return html('<p>Callback inválido (code/state ausentes).</p>')

  const verified = await verifyState<OAuthState>(state, stateSecret)
  if (!verified || verified.userId !== userOrRes.id) return html('<p>State inválido. Tente novamente.</p>')

  const origin = new URL(context.request.url).origin
  const redirectUri = `${origin}/api/instagram/oauth/callback`

  try {
    const tokenData = await fetchJson(
      `https://graph.facebook.com/v20.0/oauth/access_token?` +
        new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }).toString(),
    )
    const shortToken = String(tokenData?.access_token || '').trim()
    if (!shortToken) throw new Error('Token ausente no exchange')

    const longData = await fetchJson(
      `https://graph.facebook.com/v20.0/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortToken,
        }).toString(),
    )
    const accessToken = String(longData?.access_token || '').trim() || shortToken

    const pages = await graphGet<{ data: any[] }>('me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: 50 }, accessToken)
    const candidates = (pages.data || []).filter((p: any) => p?.instagram_business_account?.id)

    if (!candidates.length) {
      return html(`<p>Nenhuma página com Instagram Business vinculada foi encontrada.</p>`)
    }

    if (candidates.length === 1) {
      const page = candidates[0]
      const igId = String(page.instagram_business_account.id)
      await writeConnection(
        bucket,
        userOrRes.id,
        { accessToken, igBusinessAccountId: igId, pageId: String(page.id), tokenType: 'oauth', updatedAt: new Date().toISOString() },
        encSecret,
      )
      return html(`
        <script>
          try { if (window.opener) window.opener.postMessage({ type: 'instagram:connected', ok: true }, window.location.origin); } catch {}
          window.close();
        </script>
        <p>Conectado. Você pode fechar esta janela.</p>
      `)
    }

    const pendingId = crypto.randomUUID()
    await writePending(
      bucket,
      userOrRes.id,
      pendingId,
      {
        userId: userOrRes.id,
        accessToken,
        pages: candidates.map((p: any) => ({
          id: String(p.id),
          name: p.name,
          instagram_business_account: { id: String(p.instagram_business_account.id), username: p.instagram_business_account.username },
        })),
        createdAt: new Date().toISOString(),
      },
      encSecret,
    )

    const pagesJson = JSON.stringify(
      candidates.map((p: any) => ({
        id: String(p.id),
        name: p.name,
        igId: String(p.instagram_business_account.id),
        igUsername: p.instagram_business_account.username,
      })),
    )

    return html(`
      <h3>Escolha qual conta Instagram conectar</h3>
      <div id="root"></div>
      <script>
        const getCookie = (name) => {
          try {
            const parts = String(document.cookie || '').split(';').map(s => s.trim()).filter(Boolean);
            for (const p of parts) {
              const idx = p.indexOf('=');
              if (idx <= 0) continue;
              const k = p.slice(0, idx).trim();
              const v = p.slice(idx + 1).trim();
              if (k === name) return v;
            }
          } catch {}
          return null;
        };
        const pendingId = ${JSON.stringify(pendingId)};
        const pages = ${pagesJson};
        const root = document.getElementById('root');
        const mk = (p) => {
          const btn = document.createElement('button');
          btn.textContent = (p.igUsername ? '@' + p.igUsername : p.igId) + ' — ' + (p.name || p.id);
          btn.style.cssText = 'display:block;width:100%;padding:10px;margin:8px 0;border:1px solid #ddd;border-radius:8px;cursor:pointer;';
          btn.onclick = async () => {
            btn.disabled = true;
            try {
              const csrf = getCookie('csrfToken');
              const res = await fetch('/api/instagram/oauth/complete', {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
                body: JSON.stringify({ pendingId, pageId: p.id })
              });
              const data = await res.json().catch(() => null);
              if (!res.ok || !data?.ok) throw new Error(data?.error || 'Falha ao completar');
              if (window.opener) window.opener.postMessage({ type: 'instagram:connected', ok: true }, window.location.origin);
              window.close();
            } catch (e) {
              alert((e && e.message) ? e.message : 'Falha ao completar');
              btn.disabled = false;
            }
          };
          return btn;
        };
        pages.forEach(p => root.appendChild(mk(p)));
      </script>
    `)
  } catch (e: any) {
    return html(`<p>Falha ao conectar: ${esc(e?.message || 'Erro')}</p>`)
  }
}
