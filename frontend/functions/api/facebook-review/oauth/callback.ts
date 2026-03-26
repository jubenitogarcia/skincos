import { requireCrmUser } from '../../../_lib/crmAuth'
import { facebookReviewGraphGet } from '../../../_lib/facebookReviewGraph'
import {
  writeFacebookReviewConnection,
  writeFacebookReviewPending,
  type FacebookReviewPage,
} from '../../../_lib/facebookReviewStore'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired } from '../../../_lib/integrationsEncryption'
import { verifyState } from '../../../_lib/oauthState'
import { getShareBucket } from '../../../_lib/r2'

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
      ].join('; '),
    },
  })

const esc = (value: any) =>
  String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

async function fetchJson(url: string) {
  const res = await fetch(url)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message || data?.error_description || `HTTP ${res.status}`)
  return data
}

const normalizePages = (rows: any[]): FacebookReviewPage[] =>
  (rows || [])
    .map((row) => ({
      id: String(row?.id || '').trim(),
      name: row?.name ? String(row.name) : undefined,
      accessToken: row?.access_token ? String(row.access_token) : undefined,
      pictureUrl: row?.picture?.data?.url ? String(row.picture.data.url) : undefined,
      tasks: Array.isArray(row?.tasks) ? row.tasks.map((task: any) => String(task || '')).filter(Boolean) : undefined,
    }))
    .filter((page) => page.id && page.accessToken)

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
  const redirectUri = `${origin}/api/facebook-review/oauth/callback`

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
    const userAccessToken = String(longData?.access_token || '').trim() || shortToken

    const pagesRes = await facebookReviewGraphGet<{ data: any[] }>(
      'me/accounts',
      { fields: 'id,name,access_token,picture{url},tasks', limit: 50 },
      userAccessToken,
    )
    const pages = normalizePages(pagesRes.data || [])

    if (!pages.length) {
      return html('<p>Nenhuma página do Facebook com token de publicação foi encontrada.</p>')
    }

    if (pages.length === 1) {
      const page = pages[0]
      await writeFacebookReviewConnection(
        bucket,
        userOrRes.id,
        {
          userAccessToken,
          pageId: page.id,
          pageName: page.name,
          pageAccessToken: page.accessToken,
          tokenType: 'oauth',
          updatedAt: new Date().toISOString(),
        },
        encSecret,
      )
      return html(`
        <script>
          try { if (window.opener) window.opener.postMessage({ type: 'facebook-review:connected', ok: true }, window.location.origin); } catch {}
          window.close();
        </script>
        <p>Conectado. Você pode fechar esta janela.</p>
      `)
    }

    const pendingId = crypto.randomUUID()
    await writeFacebookReviewPending(
      bucket,
      userOrRes.id,
      pendingId,
      {
        userId: userOrRes.id,
        userAccessToken,
        pages,
        createdAt: new Date().toISOString(),
      },
      encSecret,
    )

    const pagesJson = JSON.stringify(
      pages.map((page) => ({
        id: page.id,
        name: page.name,
        pictureUrl: page.pictureUrl,
        tasks: page.tasks || [],
      })),
    )

    return html(`
      <h3>Escolha a página do Facebook para o review</h3>
      <div id="root"></div>
      <script>
        const getCookie = (name) => {
          try {
            const parts = String(document.cookie || '').split(';').map((s) => s.trim()).filter(Boolean);
            for (const part of parts) {
              const idx = part.indexOf('=');
              if (idx <= 0) continue;
              if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
            }
          } catch {}
          return null;
        };
        const pendingId = ${JSON.stringify(pendingId)};
        const pages = ${pagesJson};
        const root = document.getElementById('root');
        for (const page of pages) {
          const button = document.createElement('button');
          button.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;margin:10px 0;border:1px solid #ddd;border-radius:12px;background:#fff;cursor:pointer;text-align:left;';
          button.innerHTML = '<div style="flex:1"><div style="font-weight:600">' + (page.name || page.id) + '</div><div style="font-size:12px;color:#555">' + (page.tasks || []).join(', ') + '</div></div>';
          button.onclick = async () => {
            button.disabled = true;
            try {
              const csrf = getCookie('csrfToken');
              const res = await fetch('/api/facebook-review/oauth/complete', {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
                body: JSON.stringify({ pendingId, pageId: page.id }),
              });
              const data = await res.json().catch(() => null);
              if (!res.ok || !data?.ok) throw new Error(data?.error || 'Falha ao completar');
              if (window.opener) window.opener.postMessage({ type: 'facebook-review:connected', ok: true }, window.location.origin);
              window.close();
            } catch (error) {
              alert(error && error.message ? error.message : 'Falha ao completar');
              button.disabled = false;
            }
          };
          root.appendChild(button);
        }
      </script>
    `)
  } catch (error: any) {
    return html(`<p>Falha ao conectar: ${esc(error?.message || 'Erro')}</p>`)
  }
}
