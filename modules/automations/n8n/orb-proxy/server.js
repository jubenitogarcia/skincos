const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const httpProxy = require('http-proxy');

const LISTEN_ADDRESS = process.env.ORB_PROXY_LISTEN_ADDRESS || '127.0.0.1';
const PORT = Number(process.env.ORB_PROXY_PORT || 8788);
const TARGET = process.env.ORB_PROXY_TARGET || 'http://127.0.0.1:5678';
const BASE_PATH = '/meta-review';
const LOGIN_PATH = `${BASE_PATH}/login`;
const HEALTH_PATH = `${BASE_PATH}/healthz`;
const INSTAGRAM_BASE_PATH = '/instagram-review';
const INSTAGRAM_LOGIN_PATH = `${INSTAGRAM_BASE_PATH}/login`;
const INSTAGRAM_HEALTH_PATH = `${INSTAGRAM_BASE_PATH}/healthz`;
const STORE_PATH = resolveStorePath();
const SESSION_COOKIE = 'orb_review_session';
const SESSION_TTL_SECONDS = Number(process.env.ORB_REVIEW_SESSION_TTL_SECONDS || 60 * 60 * 12);
const SESSION_SECRET = String(process.env.ORB_PROXY_SESSION_SECRET || process.env.META_OAUTH_STATE_SECRET || '').trim();
const OAUTH_STATE_SECRET = String(process.env.META_OAUTH_STATE_SECRET || process.env.META_APP_SECRET || '').trim();
const TOKEN_SECRET = String(process.env.INTEGRATIONS_ENCRYPTION_SECRET || '').trim();
const REVIEW_EMAIL = String(process.env.ORB_REVIEW_TEST_EMAIL || 'test@orb.skincos.com.br').trim().toLowerCase();
const REVIEW_PASSWORD = String(process.env.ORB_REVIEW_TEST_PASSWORD || '').trim();
const REVIEW_NAME = String(process.env.ORB_REVIEW_TEST_NAME || 'Meta Review').trim();
const META_APP_ID = String(process.env.META_APP_ID || '').trim();
const META_APP_SECRET = String(process.env.META_APP_SECRET || '').trim();
const META_SCOPES =
  String(process.env.META_PAGES_REVIEW_SCOPES || '').trim() ||
  ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'public_profile'].join(',');
const META_INSTAGRAM_SCOPES =
  String(process.env.META_INSTAGRAM_REVIEW_SCOPES || '').trim() ||
  ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'public_profile'].join(',');
const INSTAGRAM_DEMO_IMAGE_URL =
  String(process.env.INSTAGRAM_DEMO_IMAGE_URL || '').trim() ||
  'https://crm.skincos.com.br/icons/insumos-icon-512.png';

function resolveStorePath() {
  const configuredPath = String(process.env.META_REVIEW_STORE_PATH || '').trim();
  if (configuredPath) return configuredPath;

  const runtimeTmpDir = String(process.env.N8N_TMP_DIR || '').trim();
  if (runtimeTmpDir) return path.join(runtimeTmpDir, 'meta-review-store.json');

  const runtimeHome = String(process.env.N8N_RUNTIME_HOME || '').trim();
  if (runtimeHome) return path.join(runtimeHome, 'tmp', 'meta-review-store.json');

  return path.join(process.cwd(), 'tmp', 'meta-review-store.json');
}

if (!TOKEN_SECRET) {
  throw new Error('INTEGRATIONS_ENCRYPTION_SECRET é obrigatório para iniciar o orb-proxy.');
}

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';
const proxy = httpProxy.createProxyServer({
  target: TARGET,
  ws: true,
  xfwd: true,
  changeOrigin: false,
  secure: false,
  proxyTimeout: 300000,
  timeout: 300000,
});

proxy.on('error', (error, req, res) => {
  const isHttp = res && typeof res.writeHead === 'function';
  if (isHttp && !res.headersSent) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
  }
  if (isHttp) res.end(`Orb proxy upstream error: ${error.message}`);
});

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function readStore() {
  ensureStoreDir();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { connections: {} };
  }
}

function writeStore(next) {
  ensureStoreDir();
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_PATH);
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest();
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function encryptToken(token) {
  if (!token) return '';
  if (!TOKEN_SECRET) return token;
  const iv = crypto.randomBytes(12);
  const key = sha256(TOKEN_SECRET);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptToken(token) {
  if (!token) return '';
  if (!token.startsWith('enc:v1:')) return token;
  if (!TOKEN_SECRET) throw new Error('INTEGRATIONS_ENCRYPTION_SECRET não configurado');
  const payload = token.slice('enc:v1:'.length);
  const [ivPart, tagPart, dataPart] = payload.split('.');
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const data = Buffer.from(dataPart, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', sha256(TOKEN_SECRET), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function getConnection(email) {
  return getScopedConnection('connections', email);
}

function saveConnection(email, connection) {
  saveScopedConnection('connections', email, connection);
}

function deleteConnection(email) {
  deleteScopedConnection('connections', email);
}

function getInstagramConnection(email) {
  return getScopedConnection('instagramConnections', email);
}

function saveInstagramConnection(email, connection) {
  saveScopedConnection('instagramConnections', email, connection);
}

function deleteInstagramConnection(email) {
  deleteScopedConnection('instagramConnections', email);
}

function getScopedConnection(namespace, email) {
  const store = readStore();
  const raw = store[namespace]?.[email];
  if (!raw) return null;
  return {
    ...raw,
    userAccessToken: decryptToken(raw.userAccessToken),
    pageAccessToken: raw.pageAccessToken ? decryptToken(raw.pageAccessToken) : '',
  };
}

function saveScopedConnection(namespace, email, connection) {
  const store = readStore();
  store[namespace] = store[namespace] || {};
  store[namespace][email] = {
    ...connection,
    userAccessToken: encryptToken(connection.userAccessToken),
    pageAccessToken: connection.pageAccessToken ? encryptToken(connection.pageAccessToken) : '',
  };
  writeStore(store);
}

function deleteScopedConnection(namespace, email) {
  const store = readStore();
  if (store[namespace] && store[namespace][email]) {
    delete store[namespace][email];
    writeStore(store);
  }
}

function migratePlaintextStoreTokens() {
  const store = readStore();
  let changed = false;

  for (const namespace of ['connections', 'instagramConnections']) {
    const records = store[namespace];
    if (!records || typeof records !== 'object') continue;

    for (const connection of Object.values(records)) {
      if (!connection || typeof connection !== 'object') continue;

      if (connection.userAccessToken && !String(connection.userAccessToken).startsWith('enc:v1:')) {
        connection.userAccessToken = encryptToken(connection.userAccessToken);
        changed = true;
      }

      if (connection.pageAccessToken && !String(connection.pageAccessToken).startsWith('enc:v1:')) {
        connection.pageAccessToken = encryptToken(connection.pageAccessToken);
        changed = true;
      }
    }
  }

  if (changed) writeStore(store);
}

migratePlaintextStoreTokens();

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const out = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    out[trimmed.slice(0, index)] = decodeURIComponent(trimmed.slice(index + 1));
  }
  return out;
}

function getPublicOrigin(req) {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const hostHeader =
    String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() ||
    String(req.headers.host || '').trim() ||
    `127.0.0.1:${PORT}`;
  const proto = protoHeader || 'http';
  return `${proto}://${hostHeader}`;
}

function isSecureRequest(req) {
  return getPublicOrigin(req).startsWith('https://');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!raw) {
        resolve({});
        return;
      }
      if (type === 'application/json') {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (type === 'application/x-www-form-urlencoded' || type === 'text/plain' || !type) {
        const params = new URLSearchParams(raw);
        const out = {};
        for (const [key, value] of params.entries()) out[key] = value;
        resolve(out);
        return;
      }
      resolve({ raw });
    });
    req.on('error', reject);
  });
}

function setSessionCookie(req, res, email) {
  if (!SESSION_SECRET) throw new Error('ORB_PROXY_SESSION_SECRET não configurado');
  const payload = base64url(JSON.stringify({ email, exp: Date.now() + SESSION_TTL_SECONDS * 1000 }));
  const signature = sign(payload, SESSION_SECRET);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(`${payload}.${signature}`)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'Path=/',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getSession(req) {
  if (!SESSION_SECRET) return null;
  const cookie = parseCookies(req)[SESSION_COOKIE];
  if (!cookie) return null;
  const index = cookie.lastIndexOf('.');
  if (index <= 0) return null;
  const payload = cookie.slice(0, index);
  const signature = cookie.slice(index + 1);
  if (sign(payload, SESSION_SECRET) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.email || !data?.exp || Number(data.exp) < Date.now()) return null;
    return { email: String(data.email).toLowerCase() };
  } catch {
    return null;
  }
}

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, title, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'content-security-policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self' https://www.facebook.com",
      "img-src 'self' https: data:",
      "script-src 'unsafe-inline' 'self'",
      "style-src 'unsafe-inline' 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  res.end(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root{
      --bg:#08111f;
      --panel:#0f1b32;
      --panel-soft:#142440;
      --line:rgba(168,190,255,.16);
      --text:#eff5ff;
      --muted:#a7b6d3;
      --accent:#69d2ff;
      --accent-2:#2de2b4;
      --danger:#ff7b8b;
      --warning:#ffcf70;
      --shadow:0 22px 70px rgba(2,8,23,.4);
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      color:var(--text);
      font:16px/1.5 "Avenir Next","Segoe UI",sans-serif;
      background:
        radial-gradient(circle at top left, rgba(44,164,255,.18), transparent 30%),
        radial-gradient(circle at top right, rgba(45,226,180,.12), transparent 24%),
        linear-gradient(180deg, #08111f, #07101d 48%, #0b1324);
      min-height:100vh;
    }
    a{color:var(--accent)}
    .shell{max-width:1180px;margin:0 auto;padding:32px 20px 56px}
    .hero{
      display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;
      padding:28px;border:1px solid var(--line);border-radius:28px;background:linear-gradient(180deg, rgba(15,27,50,.95), rgba(9,16,31,.9));box-shadow:var(--shadow)
    }
    .hero h1{margin:0 0 8px;font-size:clamp(28px,4vw,42px);line-height:1.04;letter-spacing:-.03em}
    .hero p{margin:0;color:var(--muted);max-width:780px}
    .badges{display:flex;gap:10px;flex-wrap:wrap}
    .badge{padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);font-size:13px}
    .grid{display:grid;gap:18px}
    .grid-2{grid-template-columns:1.1fr .9fr}
    .steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px}
    .step,.panel{
      border:1px solid var(--line);background:linear-gradient(180deg, rgba(20,36,64,.88), rgba(10,18,34,.9));border-radius:22px;box-shadow:var(--shadow)
    }
    .step{padding:16px 18px;font-size:14px}
    .panel{padding:22px}
    .panel h2{margin:0 0 8px;font-size:22px;letter-spacing:-.02em}
    .panel p{margin:0;color:var(--muted)}
    .stack{display:grid;gap:14px}
    .inline{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
    .notice,.error,.tip{
      padding:14px 16px;border-radius:18px;border:1px solid transparent
    }
    .notice{background:rgba(45,226,180,.12);border-color:rgba(45,226,180,.25)}
    .error{background:rgba(255,123,139,.11);border-color:rgba(255,123,139,.28)}
    .tip{background:rgba(105,210,255,.11);border-color:rgba(105,210,255,.28)}
    label{display:block;font-size:14px;color:var(--muted);margin:0 0 6px}
    input,select,textarea{
      width:100%;padding:14px 15px;border-radius:16px;border:1px solid rgba(168,190,255,.18);
      background:rgba(255,255,255,.04);color:var(--text);font:inherit;outline:none
    }
    textarea{min-height:150px;resize:vertical}
    input:focus,select:focus,textarea:focus{border-color:rgba(105,210,255,.65);box-shadow:0 0 0 3px rgba(105,210,255,.12)}
    .button,button{
      appearance:none;border:0;border-radius:16px;padding:13px 18px;font:600 15px/1 "Avenir Next","Segoe UI",sans-serif;
      color:#04111d;background:linear-gradient(135deg, var(--accent), #9bf2ff);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px
    }
    .button.secondary,button.secondary{background:rgba(255,255,255,.06);color:var(--text);border:1px solid var(--line)}
    .button.danger,button.danger{background:linear-gradient(135deg, #ff8f9d, #ffb07f);color:#1d0810}
    .button.ghost,button.ghost{background:transparent;color:var(--accent);border:1px solid rgba(105,210,255,.28)}
    .button:disabled,button:disabled{opacity:.45;cursor:not-allowed}
    .field-grid{display:grid;gap:14px}
    .field-grid.two{grid-template-columns:1fr 1fr}
    .meta{font-size:13px;color:var(--muted)}
    .posts{display:grid;gap:14px}
    .post{
      border:1px solid var(--line);border-radius:20px;padding:16px;background:rgba(255,255,255,.03)
    }
    .post.highlight{border-color:rgba(45,226,180,.45);box-shadow:0 0 0 3px rgba(45,226,180,.08)}
    .post img{display:block;width:100%;max-height:320px;object-fit:cover;border-radius:16px;margin-top:12px;border:1px solid rgba(168,190,255,.16)}
    .row-between{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
    .small{font-size:12px;color:var(--muted)}
    .login-card{max-width:460px;margin:8vh auto 0}
    .footer{margin-top:18px;color:var(--muted);font-size:13px}
    @media (max-width:960px){
      .grid-2,.field-grid.two,.steps{grid-template-columns:1fr}
      .shell{padding:22px 16px 42px}
      .hero,.panel{padding:20px}
    }
  </style>
</head>
<body>
${body}
<script>
  for (const button of document.querySelectorAll('[data-confirm]')) {
    button.addEventListener('click', (event) => {
      const question = button.getAttribute('data-confirm') || 'Confirmar?';
      if (!window.confirm(question)) event.preventDefault();
    });
  }
</script>
</body>
</html>`);
}

function renderLoginPage(res, params = {}) {
  const error = params.error ? `<div class="error">${esc(params.error)}</div>` : '';
  sendHtml(
    res,
    200,
    'Orb Meta Review Login',
    `<main class="shell">
      <section class="hero">
        <div>
          <h1>Orb Meta Pages Review</h1>
          <p>Ambiente dedicado para demonstrar o fluxo exigido pela Meta em <code>pages_manage_posts</code>, no domínio real <strong>orb.skincos.com.br</strong>.</p>
        </div>
        <div class="badges">
          <div class="badge">Login dedicado</div>
          <div class="badge">OAuth da Meta</div>
          <div class="badge">Publicar, editar e excluir</div>
        </div>
      </section>
      <section class="panel login-card">
        <div class="stack">
          <div>
            <h2>Entrar no Orb</h2>
            <p>Use a conta de review fornecida para acessar a superfície que será gravada no screencast.</p>
          </div>
          ${error}
          <form method="post" action="${LOGIN_PATH}">
            <div class="field-grid">
              <div>
                <label for="email">E-mail</label>
                <input id="email" name="email" type="email" autocomplete="username" required />
              </div>
              <div>
                <label for="password">Senha</label>
                <input id="password" name="password" type="password" autocomplete="current-password" required />
              </div>
              <button type="submit">Entrar no Orb</button>
            </div>
          </form>
          <div class="footer">Este login fica isolado do CRM e roda no próprio stack do Orb.</div>
        </div>
      </section>
    </main>`,
  );
}

function renderInstagramLoginPage(res, params = {}) {
  const error = params.error ? `<div class="error">${esc(params.error)}</div>` : '';
  sendHtml(
    res,
    200,
    'Orb Instagram Review Login',
    `<main class="shell">
      <section class="hero">
        <div>
          <h1>Orb Instagram Business Review</h1>
          <p>Ambiente dedicado para demonstrar o fluxo exigido pela Meta em <code>instagram_business_basic</code>, no domínio real <strong>orb.skincos.com.br</strong>.</p>
        </div>
        <div class="badges">
          <div class="badge">Login dedicado</div>
          <div class="badge">OAuth da Meta</div>
          <div class="badge">Perfil profissional do Instagram</div>
        </div>
      </section>
      <section class="panel login-card">
        <div class="stack">
          <div>
            <h2>Entrar no Orb</h2>
            <p>Use a conta de review fornecida para acessar a superfície onde o reviewer verá a conexão do Instagram profissional e os dados básicos do perfil.</p>
          </div>
          ${error}
          <form method="post" action="${INSTAGRAM_LOGIN_PATH}">
            <div class="field-grid">
              <div>
                <label for="email">E-mail</label>
                <input id="email" name="email" type="email" autocomplete="username" required />
              </div>
              <div>
                <label for="password">Senha</label>
                <input id="password" name="password" type="password" autocomplete="current-password" required />
              </div>
              <button type="submit">Entrar no Orb</button>
            </div>
          </form>
          <div class="footer">Este login fica isolado do CRM e roda no próprio stack do Orb.</div>
        </div>
      </section>
    </main>`,
  );
}

function renderDashboard(res, model) {
  const notice = model.notice ? `<div class="notice">${esc(model.notice)}</div>` : '';
  const error = model.error ? `<div class="error">${esc(model.error)}</div>` : '';
  const connectedBadge = model.connected ? 'Conta Meta conectada' : 'Conta Meta ainda não conectada';
  const selectedPageLabel = model.selectedPage ? esc(model.selectedPage.name || model.selectedPage.id) : 'Nenhuma Página selecionada';
  const options = (model.pages || [])
    .map((page) => {
      const selected = model.selectedPage && model.selectedPage.id === page.id ? ' selected' : '';
      return `<option value="${esc(page.id)}"${selected}>${esc(page.name || page.id)}</option>`;
    })
    .join('');
  const selectedTasks =
    model.selectedPage && model.selectedPage.tasks?.length
      ? esc(model.selectedPage.tasks.join(', '))
      : 'A Meta não retornou a lista de tasks desta Página.';
  const editMode = Boolean(model.editPost);
  const composerAction = editMode ? `${BASE_PATH}/update` : `${BASE_PATH}/publish`;
  const composerLabel = editMode ? 'Salvar edição' : 'Publicar';
  const composerTitle = editMode ? 'Editar post' : 'Criar post';
  const composerMessage = model.editPost?.message || 'Post de validação Meta via Orb';
  const composerImage = editMode ? '' : model.prefillImageUrl || '';
  const publishDisabled = !model.connected || !model.selectedPage;
  const postsHtml = (model.posts || []).length
    ? model.posts
        .map((post) => {
          const highlight = model.focusPostId && model.focusPostId === post.id ? ' highlight' : '';
          return `<article class="post${highlight}">
            <div class="row-between">
              <div>
                <div style="font-weight:700;font-size:17px">${esc(post.message || 'Sem mensagem textual')}</div>
                <div class="small">${esc(post.createdTime || 'Horário não informado')}</div>
              </div>
              <div class="inline">
                <a class="button secondary" href="${BASE_PATH}?edit=${encodeURIComponent(post.id)}">Editar</a>
                <form method="post" action="${BASE_PATH}/delete">
                  <input type="hidden" name="postId" value="${esc(post.id)}" />
                  <button class="secondary" type="submit" data-confirm="Excluir este post da Página?">Excluir</button>
                </form>
                ${post.permalinkUrl ? `<a class="button ghost" href="${esc(post.permalinkUrl)}" target="_blank" rel="noopener noreferrer">Abrir no Facebook</a>` : ''}
              </div>
            </div>
            ${post.fullPicture ? `<img src="${esc(post.fullPicture)}" alt="" />` : ''}
            <div class="small" style="margin-top:10px">ID do post: ${esc(post.id)}</div>
          </article>`;
        })
        .join('')
    : `<div class="tip">Nenhum post carregado ainda. Conecte a Meta, selecione a Página e publique um post para gerar a prova visual do review.</div>`;

  sendHtml(
    res,
    200,
    'Orb Meta Review',
    `<main class="shell">
      <section class="hero">
        <div>
          <h1>Orb Meta Pages Review</h1>
          <p>Fluxo completo para o screencast da Meta: login, OAuth, seleção de Página, criação de post, publicação e prova operacional no próprio app.</p>
        </div>
        <div class="badges">
          <div class="badge">${esc(connectedBadge)}</div>
          <div class="badge">Página atual: ${selectedPageLabel}</div>
          <div class="badge">Usuário: ${esc(model.userName || REVIEW_NAME)}</div>
        </div>
      </section>

      <section class="steps">
        <div class="step">1. Login no app</div>
        <div class="step">2. Conectar conta Meta via OAuth</div>
        <div class="step">3. Selecionar Página e publicar</div>
        <div class="step">4. Mostrar a lista de posts atualizada</div>
      </section>

      <div style="margin-top:18px" class="stack">
        ${notice}
        ${error}
      </div>

      <section class="grid grid-2" style="margin-top:18px">
        <div class="panel">
          <div class="stack">
            <div class="row-between">
              <div>
                <h2>Conectar conta Meta</h2>
                <p>Esta é a etapa crítica para o vídeo. O reviewer precisa ver o redirecionamento para a Meta e o retorno ao Orb.</p>
              </div>
              <form method="post" action="${BASE_PATH}/logout">
                <button class="secondary" type="submit">Sair</button>
              </form>
            </div>
            <div class="inline">
              <a class="button" href="${BASE_PATH}/oauth/start">Conectar conta Meta</a>
              <form method="post" action="${BASE_PATH}/disconnect">
                <button class="secondary" type="submit" ${!model.connected ? 'disabled' : ''}>Desconectar</button>
              </form>
            </div>
            <div class="tip">Para o screencast, deixe a tela da Meta visível até aparecer a etapa de autorização e o retorno ao Orb.</div>
            <form method="post" action="${BASE_PATH}/select-page" class="field-grid">
              <div>
                <label for="pageId">Página conectada</label>
                <select id="pageId" name="pageId" ${!(model.pages || []).length ? 'disabled' : ''}>
                  <option value="">Escolha a Página do review</option>
                  ${options}
                </select>
              </div>
              <div class="inline">
                <button type="submit" ${!(model.pages || []).length ? 'disabled' : ''}>Selecionar Página</button>
              </div>
            </form>
            <div class="meta">
              Página ativa: <strong>${selectedPageLabel}</strong><br/>
              Permissões retornadas: ${esc(selectedTasks)}
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="stack">
            <div>
              <h2>Fechamento do vídeo</h2>
              <p>Depois de publicar, fique nesta lista ou abra o permalink do post. Isso reduz bastante a chance de reprovação.</p>
            </div>
            <div class="notice">
              Sugestão de gravação: login no Orb, clique em <strong>Conectar conta Meta</strong>, autorize, selecione a Página, publique o post e então mostre a lista abaixo já atualizada.
            </div>
            <div class="meta">
              A conta de review permanece separada do CRM e roda no stack publicado em <strong>orb.skincos.com.br</strong>.
            </div>
          </div>
        </div>
      </section>

      <section class="grid grid-2" style="margin-top:18px">
        <div class="panel">
          <div class="stack">
            <div>
              <h2>${composerTitle}</h2>
              <p>Este formulário demonstra uso direto de <code>pages_manage_posts</code> pela interface do Orb.</p>
            </div>
            <form method="post" action="${composerAction}">
              ${editMode ? `<input type="hidden" name="postId" value="${esc(model.editPost.id)}" />` : ''}
              <div class="field-grid">
                <div>
                  <label for="message">Texto do post</label>
                  <textarea id="message" name="message" required>${esc(composerMessage)}</textarea>
                </div>
                <div>
                  <label for="imageUrl">Imagem opcional por URL HTTPS</label>
                  <input id="imageUrl" name="imageUrl" type="url" placeholder="https://..." value="${esc(composerImage)}" ${editMode ? 'disabled' : ''} />
                </div>
                <div class="inline">
                  <button type="submit" ${publishDisabled ? 'disabled' : ''}>${composerLabel}</button>
                  ${
                    editMode
                      ? `<a class="button secondary" href="${BASE_PATH}">Cancelar edição</a>`
                      : `<span class="meta">Se quiser um fluxo mais previsível para a Meta, grave primeiro um post textual simples.</span>`
                  }
                </div>
              </div>
            </form>
          </div>
        </div>

        <div class="panel">
          <div class="stack">
            <div>
              <h2>Posts recentes da Página</h2>
              <p>Esta é a prova operacional dentro do app. O reviewer consegue ver a lista sendo atualizada sem sair do Orb.</p>
            </div>
            <div class="posts">${postsHtml}</div>
          </div>
        </div>
      </section>
    </main>`,
  );
}

function renderInstagramDashboard(res, model) {
  const notice = model.notice ? `<div class="notice">${esc(model.notice)}</div>` : '';
  const error = model.error ? `<div class="error">${esc(model.error)}</div>` : '';
  const connectedBadge = model.connected ? 'Conta Meta conectada' : 'Conta Meta ainda não conectada';
  const selectedPageLabel = model.selectedPage ? esc(model.selectedPage.name || model.selectedPage.id) : 'Nenhuma Página selecionada';
  const options = (model.pages || [])
    .map((page) => {
      const selected = model.selectedPage && model.selectedPage.id === page.id ? ' selected' : '';
      return `<option value="${esc(page.id)}"${selected}>${esc(page.name || page.id)}</option>`;
    })
    .join('');
  const profile = model.instagramProfile;
  const profileCard = profile
    ? `<div class="panel">
        <div class="stack">
          <div>
            <h2>Perfil profissional do Instagram</h2>
            <p>Esta é a prova exigida para <code>instagram_business_basic</code>: o Orb exibe o perfil profissional conectado dentro do próprio app.</p>
          </div>
          <div class="row-between">
            <div class="inline">
              ${profile.profilePictureUrl ? `<img src="${esc(profile.profilePictureUrl)}" alt="" style="width:84px;height:84px;border-radius:999px;border:1px solid rgba(168,190,255,.18);object-fit:cover" />` : ''}
              <div>
                <div style="font-size:24px;font-weight:700">@${esc(profile.username || '')}</div>
                <div class="meta">${esc(profile.name || 'Perfil profissional do Instagram')}</div>
              </div>
            </div>
            <div class="badge">ID: ${esc(profile.id || '')}</div>
          </div>
          <div class="field-grid two">
            <div class="post">
              <div class="small">Username</div>
              <div style="font-weight:700">@${esc(profile.username || '')}</div>
            </div>
            <div class="post">
              <div class="small">Nome do perfil</div>
              <div style="font-weight:700">${esc(profile.name || 'Não informado')}</div>
            </div>
            <div class="post">
              <div class="small">Biografia</div>
              <div>${esc(profile.biography || 'Não informada')}</div>
            </div>
            <div class="post">
              <div class="small">Website</div>
              <div>${profile.website ? `<a href="${esc(profile.website)}" target="_blank" rel="noopener noreferrer">${esc(profile.website)}</a>` : 'Não informado'}</div>
            </div>
            <div class="post">
              <div class="small">Seguidores</div>
              <div style="font-weight:700">${esc(profile.followersCount ?? '') || 'Não informado'}</div>
            </div>
            <div class="post">
              <div class="small">Seguindo</div>
              <div style="font-weight:700">${esc(profile.followsCount ?? '') || 'Não informado'}</div>
            </div>
            <div class="post">
              <div class="small">Mídias</div>
              <div style="font-weight:700">${esc(profile.mediaCount ?? '') || 'Não informado'}</div>
            </div>
          </div>
        </div>
      </div>`
    : `<div class="panel"><div class="stack"><div><h2>Perfil profissional do Instagram</h2><p>Conecte a Meta e selecione a Página vinculada a um Instagram profissional para exibir username, foto de perfil e dados básicos dentro do Orb.</p></div></div></div>`;
  const recentMediaHtml = (model.recentMedia || [])
    .map((item) => {
      const previewUrl = item.mediaUrl || item.thumbnailUrl || '';
      const caption = item.caption ? esc(item.caption) : 'Sem legenda';
      const badge = model.lastPublished?.id === item.id ? '<div class="badge">Publicado agora</div>' : '';
      return `<article class="post">
        <div class="stack">
          <div class="row-between">
            <div class="small">${esc(item.mediaType || 'IMAGE')}</div>
            ${badge}
          </div>
          ${previewUrl ? `<img src="${esc(previewUrl)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:16px;border:1px solid rgba(168,190,255,.14)" />` : ''}
          <div>${caption}</div>
          <div class="small">ID: ${esc(item.id || '')}</div>
          <div class="small">${item.timestamp ? esc(new Date(item.timestamp).toLocaleString('pt-BR')) : ''}</div>
          <div>${item.permalink ? `<a href="${esc(item.permalink)}" target="_blank" rel="noopener noreferrer">Abrir no Instagram</a>` : '<span class="small">Permalink ainda não disponível</span>'}</div>
        </div>
      </article>`;
    })
    .join('');
  const publishPanel = profile
    ? `<section class="grid grid-2" style="margin-top:18px">
        <div class="panel">
          <div class="stack">
            <div>
              <h2>Criar conteúdo para Instagram</h2>
              <p>Este formulário demonstra uso direto de <code>instagram_business_content_publish</code> pela interface do Orb.</p>
            </div>
            <form method="post" action="${INSTAGRAM_BASE_PATH}/publish">
              <input type="hidden" name="mediaUrl" value="${esc(model.demoImageUrl || INSTAGRAM_DEMO_IMAGE_URL)}" />
              <div class="field-grid">
                <div>
                  <label>Conta conectada</label>
                  <div class="post">
                    <div style="font-weight:700">@${esc(profile.username || '')}</div>
                    <div class="small">${esc(model.selectedPage?.name || '')}</div>
                  </div>
                </div>
                <div>
                  <label>Imagem demo selecionada</label>
                  <div class="post">
                    <img src="${esc(model.demoImageUrl || INSTAGRAM_DEMO_IMAGE_URL)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:16px;border:1px solid rgba(168,190,255,.14)" />
                  </div>
                </div>
                <div>
                  <label for="caption">Legenda</label>
                  <textarea id="caption" name="caption" required>${esc(model.draftCaption || '')}</textarea>
                </div>
                <div class="inline">
                  <button type="submit">Publicar no Instagram</button>
                  <span class="meta">Para o review, publique esta imagem demo com a legenda preenchida.</span>
                </div>
              </div>
            </form>
          </div>
        </div>
        <div class="panel">
          <div class="stack">
            <div>
              <h2>Posts recentes do Instagram</h2>
              <p>Esta é a prova operacional dentro do app. Depois da publicação, o reviewer vê o conteúdo novo nesta lista e pode abrir o permalink.</p>
            </div>
            <div class="posts">${recentMediaHtml || '<div class="post"><div class="small">Nenhum post carregado ainda.</div></div>'}</div>
          </div>
        </div>
      </section>`
    : '';

  sendHtml(
    res,
    200,
    'Orb Instagram Review',
    `<main class="shell">
      <section class="hero">
        <div>
          <h1>Orb Instagram Business Review</h1>
          <p>Fluxo completo para o screencast da Meta: login, OAuth, seleção da Página vinculada ao Instagram profissional e exibição dos dados básicos do perfil dentro do Orb.</p>
        </div>
        <div class="badges">
          <div class="badge">${esc(connectedBadge)}</div>
          <div class="badge">Página atual: ${selectedPageLabel}</div>
          <div class="badge">Usuário: ${esc(model.userName || REVIEW_NAME)}</div>
        </div>
      </section>

      <section class="steps">
        <div class="step">1. Login no app</div>
        <div class="step">2. Conectar Instagram profissional via Meta OAuth</div>
        <div class="step">3. Selecionar a Página vinculada</div>
        <div class="step">4. Criar conteúdo com mídia e legenda</div>
        <div class="step">5. Publicar e provar no próprio Orb</div>
      </section>

      <div style="margin-top:18px" class="stack">
        ${notice}
        ${error}
      </div>

      <section class="grid grid-2" style="margin-top:18px">
        <div class="panel">
          <div class="stack">
            <div class="row-between">
              <div>
                <h2>Conectar conta Meta</h2>
                <p>O reviewer precisa ver o redirecionamento para a Meta, o retorno ao Orb e, em seguida, os dados básicos do perfil profissional do Instagram dentro desta interface.</p>
              </div>
              <form method="post" action="${INSTAGRAM_BASE_PATH}/logout">
                <button class="secondary" type="submit">Sair</button>
              </form>
            </div>
            <div class="inline">
              <a class="button" href="${INSTAGRAM_BASE_PATH}/oauth/start">Conectar conta Meta</a>
              <form method="post" action="${INSTAGRAM_BASE_PATH}/disconnect">
                <button class="secondary" type="submit" ${!model.connected ? 'disabled' : ''}>Desconectar</button>
              </form>
            </div>
            <div class="tip">Para o screencast, deixe a tela da Meta visível até aparecer a autorização e o retorno ao Orb.</div>
            <form method="post" action="${INSTAGRAM_BASE_PATH}/select-page" class="field-grid">
              <div>
                <label for="pageId">Página vinculada ao Instagram</label>
                <select id="pageId" name="pageId" ${!(model.pages || []).length ? 'disabled' : ''}>
                  <option value="">Escolha a Página do review</option>
                  ${options}
                </select>
              </div>
              <div class="inline">
                <button type="submit" ${!(model.pages || []).length ? 'disabled' : ''}>Selecionar Página</button>
              </div>
            </form>
            <div class="meta">
              Página ativa: <strong>${selectedPageLabel}</strong><br/>
              Perfil vinculado: <strong>${esc(profile?.username || 'Nenhum perfil profissional carregado')}</strong>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="stack">
            <div>
              <h2>Onde o reviewer testa</h2>
              <p>Depois do OAuth, o reviewer escolhe a Página vinculada ao Instagram profissional, cria uma publicação com imagem e legenda e então vê o conteúdo publicado dentro do próprio Orb.</p>
            </div>
            <div class="notice">
              Sugestão de gravação: login no Orb, clique em <strong>Conectar conta Meta</strong>, autorize, selecione a Página vinculada ao Instagram, publique a imagem demo com legenda e então mostre a lista de posts recentes.
            </div>
            <div class="meta">
              A conta de review permanece separada do CRM e roda no stack publicado em <strong>orb.skincos.com.br</strong>.
            </div>
          </div>
        </div>
      </section>

      <section style="margin-top:18px">${profileCard}</section>
      ${publishPanel}
    </main>`,
  );
}

function renderMessagePage(res, title, message, actionHref = BASE_PATH) {
  sendHtml(
    res,
    200,
    title,
    `<main class="shell">
      <section class="panel login-card">
        <div class="stack">
          <div>
            <h2>${esc(title)}</h2>
            <p>${esc(message)}</p>
          </div>
          <div><a class="button" href="${esc(actionHref)}">Voltar ao Orb</a></div>
        </div>
      </section>
    </main>`,
  );
}

function makeSignedState(payload) {
  if (!OAUTH_STATE_SECRET) throw new Error('META_OAUTH_STATE_SECRET não configurado');
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, OAUTH_STATE_SECRET)}`;
}

function verifySignedState(value) {
  if (!value || !OAUTH_STATE_SECRET) return null;
  const index = value.lastIndexOf('.');
  if (index <= 0) return null;
  const body = value.slice(0, index);
  const signature = value.slice(index + 1);
  if (sign(body, OAUTH_STATE_SECRET) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!parsed?.email || !parsed?.iat) return null;
    if (Date.now() - Number(parsed.iat) > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphGet(pathname, params, accessToken) {
  const url = buildUrl(`${GRAPH_BASE}/${pathname}`, { ...params, access_token: accessToken });
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `Graph API error (${res.status})`);
  return json;
}

async function graphPost(pathname, params, accessToken) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, String(value));
  }
  body.set('access_token', accessToken);
  const res = await fetch(`${GRAPH_BASE}/${pathname}`, { method: 'POST', body });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `Graph API error (${res.status})`);
  return json;
}

async function graphDelete(pathname, accessToken) {
  const url = buildUrl(`${GRAPH_BASE}/${pathname}`, { access_token: accessToken });
  const res = await fetch(url, { method: 'DELETE' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `Graph API error (${res.status})`);
  return json;
}

async function exchangeCodeForUserToken(req, code, basePath = BASE_PATH) {
  const redirectUri = `${getPublicOrigin(req)}${basePath}/oauth/callback`;
  const short = await graphGet('oauth/access_token', {
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  const shortToken = String(short?.access_token || '').trim();
  if (!shortToken) throw new Error('A Meta não retornou access token');
  const long = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  return String(long?.access_token || shortToken).trim();
}

async function fetchPages(userAccessToken) {
  const response = await graphGet('me/accounts', { fields: 'id,name,access_token,picture{url},tasks', limit: 50 }, userAccessToken);
  return (response?.data || [])
    .map((row) => ({
      id: String(row?.id || '').trim(),
      name: row?.name ? String(row.name) : '',
      accessToken: row?.access_token ? String(row.access_token) : '',
      pictureUrl: row?.picture?.data?.url ? String(row.picture.data.url) : '',
      tasks: Array.isArray(row?.tasks) ? row.tasks.map((task) => String(task || '')).filter(Boolean) : [],
    }))
    .filter((page) => page.id && page.accessToken);
}

async function fetchPosts(pageId, pageAccessToken) {
  const response = await graphGet(
    `${pageId}/published_posts`,
    { fields: 'id,message,created_time,permalink_url,full_picture,status_type', limit: 10 },
    pageAccessToken,
  );
  return (response?.data || []).map((row) => ({
    id: String(row?.id || '').trim(),
    message: row?.message ? String(row.message) : '',
    createdTime: row?.created_time ? String(row.created_time) : '',
    permalinkUrl: row?.permalink_url ? String(row.permalink_url) : '',
    fullPicture: row?.full_picture ? String(row.full_picture) : '',
    statusType: row?.status_type ? String(row.status_type) : '',
  }));
}

async function fetchInstagramProfile(pageId, pageAccessToken) {
  const page = await graphGet(
    pageId,
    {
      fields:
        'instagram_business_account{id,username,profile_picture_url,name,biography,website,followers_count,follows_count,media_count}',
    },
    pageAccessToken,
  );
  const ig = page?.instagram_business_account;
  if (!ig?.id) return null;
  const profile = await graphGet(
    String(ig.id),
    { fields: 'id,username,profile_picture_url,name,biography,website,followers_count,follows_count,media_count' },
    pageAccessToken,
  );
  return {
    id: String(profile?.id || ig.id || '').trim(),
    username: String(profile?.username || ig.username || '').trim(),
    profilePictureUrl: String(profile?.profile_picture_url || ig.profile_picture_url || '').trim(),
    name: String(profile?.name || ig.name || '').trim(),
    biography: String(profile?.biography || ig.biography || '').trim(),
    website: String(profile?.website || ig.website || '').trim(),
    followersCount: profile?.followers_count ?? ig.followers_count ?? '',
    followsCount: profile?.follows_count ?? ig.follows_count ?? '',
    mediaCount: profile?.media_count ?? ig.media_count ?? '',
  };
}

function mapInstagramMedia(row) {
  return {
    id: String(row?.id || '').trim(),
    caption: row?.caption ? String(row.caption) : '',
    mediaType: row?.media_type ? String(row.media_type) : '',
    mediaUrl: row?.media_url ? String(row.media_url) : '',
    thumbnailUrl: row?.thumbnail_url ? String(row.thumbnail_url) : '',
    permalink: row?.permalink ? String(row.permalink) : '',
    timestamp: row?.timestamp ? String(row.timestamp) : '',
  };
}

async function fetchInstagramMediaById(mediaId, accessToken) {
  const media = await graphGet(
    mediaId,
    { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp' },
    accessToken,
  );
  return mapInstagramMedia(media);
}

async function fetchInstagramRecentMedia(igBusinessAccountId, accessToken, limit = 6) {
  const response = await graphGet(
    `${igBusinessAccountId}/media`,
    { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp', limit },
    accessToken,
  );
  return (response?.data || []).map(mapInstagramMedia);
}

async function fetchInstagramCreationStatus(creationId, accessToken) {
  return graphGet(
    creationId,
    { fields: 'id,status_code,status' },
    accessToken,
  );
}

async function waitForInstagramCreation(creationId, accessToken, attempts = 15, delayMs = 1500) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const creation = await fetchInstagramCreationStatus(creationId, accessToken);
      const statusCode = String(creation?.status_code || creation?.status || '').trim().toUpperCase();
      if (!statusCode || statusCode === 'FINISHED' || statusCode === 'PUBLISHED') return creation;
      if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
        throw new Error(`Falha ao preparar a mídia do Instagram (${statusCode}).`);
      }
    } catch (error) {
      if (index === attempts - 1) throw error;
    }
    await sleep(delayMs);
  }
  throw new Error('A mídia do Instagram não ficou pronta para publicação a tempo.');
}

async function publishInstagramImage(igBusinessAccountId, accessToken, imageUrl, caption) {
  const container = await graphPost(`${igBusinessAccountId}/media`, { image_url: imageUrl, caption }, accessToken);
  const creationId = String(container?.id || '').trim();
  if (!creationId) throw new Error('Falha ao criar o container da mídia no Instagram.');
  await waitForInstagramCreation(creationId, accessToken);
  let published = null;
  for (let index = 0; index < 6; index += 1) {
    try {
      published = await graphPost(`${igBusinessAccountId}/media_publish`, { creation_id: creationId }, accessToken);
      break;
    } catch (error) {
      const message = String(error?.message || '');
      const shouldRetry = message.includes('Media ID is not available') || message.includes('mídia não está pronta');
      if (!shouldRetry || index === 5) throw error;
      await sleep(1800);
    }
  }
  return {
    creationId,
    publishedId: String(published?.id || '').trim(),
  };
}

async function waitForInstagramMedia(mediaId, accessToken, attempts = 5, delayMs = 1800) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const media = await fetchInstagramMediaById(mediaId, accessToken);
      if (media?.id) return media;
    } catch {}
    await sleep(delayMs);
  }
  return null;
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    redirect(res, LOGIN_PATH);
    return null;
  }
  return session;
}

function buildRedirect(base, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `${base}?${suffix}` : base;
}

async function renderDashboardRoute(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  const url = new URL(req.url, 'http://orb.local');
  const notice = url.searchParams.get('notice') || '';
  const focusPostId = url.searchParams.get('focus') || '';
  const editPostId = url.searchParams.get('edit') || '';
  const connection = getConnection(session.email);

  const model = {
    connected: Boolean(connection?.userAccessToken),
    userName: REVIEW_NAME,
    pages: [],
    posts: [],
    selectedPage: null,
    notice,
    error: '',
    focusPostId,
    editPost: null,
    prefillImageUrl: '',
  };

  if (connection?.userAccessToken) {
    try {
      model.pages = await fetchPages(connection.userAccessToken);
      if (connection.pageId) {
        const selectedPage = model.pages.find((page) => page.id === connection.pageId) || null;
        if (selectedPage) {
          if (selectedPage.accessToken !== connection.pageAccessToken || selectedPage.name !== connection.pageName) {
            saveConnection(session.email, {
              ...connection,
              pageName: selectedPage.name,
              pageAccessToken: selectedPage.accessToken,
              updatedAt: new Date().toISOString(),
            });
          }
          model.selectedPage = selectedPage;
          model.posts = await fetchPosts(selectedPage.id, selectedPage.accessToken);
          if (editPostId) model.editPost = model.posts.find((post) => post.id === editPostId) || null;
        }
      }
      if (!model.selectedPage && model.pages.length === 1) {
        model.selectedPage = model.pages[0];
      }
    } catch (error) {
      model.error = error.message || 'Falha ao consultar a Meta';
    }
  }

  renderDashboard(res, model);
}

async function renderInstagramDashboardRoute(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  const url = new URL(req.url, 'http://orb.local');
  const notice = url.searchParams.get('notice') || '';
  const publishedId = url.searchParams.get('publishedId') || '';
  const connection = getInstagramConnection(session.email);

  const model = {
    connected: Boolean(connection?.userAccessToken),
    userName: REVIEW_NAME,
    pages: [],
    selectedPage: null,
    instagramProfile: null,
    recentMedia: [],
    lastPublished: null,
    demoImageUrl: INSTAGRAM_DEMO_IMAGE_URL,
    draftCaption:
      'Publicação de validação Meta via Orb em ' +
      new Date().toLocaleString('pt-BR') +
      '. Fluxo de OAuth, seleção da conta e publicação concluídos dentro do app.',
    notice,
    error: '',
  };

  if (connection?.userAccessToken) {
    try {
      model.pages = await fetchPages(connection.userAccessToken);
      if (connection.pageId) {
        const selectedPage = model.pages.find((page) => page.id === connection.pageId) || null;
        if (selectedPage) {
          if (selectedPage.accessToken !== connection.pageAccessToken || selectedPage.name !== connection.pageName) {
            saveInstagramConnection(session.email, {
              ...connection,
              pageId: selectedPage.id,
              pageName: selectedPage.name,
              pageAccessToken: selectedPage.accessToken,
              updatedAt: new Date().toISOString(),
            });
          }
          model.selectedPage = selectedPage;
          model.instagramProfile = await fetchInstagramProfile(selectedPage.id, selectedPage.accessToken);
          if (model.instagramProfile?.id) {
            model.recentMedia = await fetchInstagramRecentMedia(model.instagramProfile.id, connection.userAccessToken, 6);
            if (publishedId) {
              model.lastPublished =
                model.recentMedia.find((item) => item.id === publishedId) ||
                (await fetchInstagramMediaById(publishedId, connection.userAccessToken).catch(() => null));
            }
          }
        }
      }
      if (!model.selectedPage && model.pages.length === 1) {
        model.selectedPage = model.pages[0];
      }
    } catch (error) {
      model.error = error.message || 'Falha ao consultar a Meta';
    }
  }

  renderInstagramDashboard(res, model);
}

function validateConfiguration() {
  const missing = [];
  if (!SESSION_SECRET) missing.push('ORB_PROXY_SESSION_SECRET');
  if (!META_APP_ID) missing.push('META_APP_ID');
  if (!META_APP_SECRET) missing.push('META_APP_SECRET');
  if (!OAUTH_STATE_SECRET) missing.push('META_OAUTH_STATE_SECRET');
  if (!TOKEN_SECRET) missing.push('INTEGRATIONS_ENCRYPTION_SECRET');
  if (!REVIEW_PASSWORD) missing.push('ORB_REVIEW_TEST_PASSWORD');
  return missing;
}

async function handleMetaReview(req, res) {
  const url = new URL(req.url, 'http://orb.local');

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === HEALTH_PATH) {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    sendJson(res, 200, {
      ok: true,
      configured: validateConfiguration().length === 0,
      target: TARGET,
      port: PORT,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === LOGIN_PATH) {
    renderLoginPage(res, { error: url.searchParams.get('error') || '' });
    return;
  }

  if (req.method === 'POST' && url.pathname === LOGIN_PATH) {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (email !== REVIEW_EMAIL || password !== REVIEW_PASSWORD) {
      renderLoginPage(res, { error: 'Credenciais inválidas.' });
      return;
    }
    setSessionCookie(req, res, email);
    redirect(res, BASE_PATH);
    return;
  }

  if (req.method === 'POST' && url.pathname === `${BASE_PATH}/logout`) {
    clearSessionCookie(req, res);
    redirect(res, LOGIN_PATH);
    return;
  }

  if (req.method === 'GET' && url.pathname === `${BASE_PATH}/oauth/start`) {
    const session = requireSession(req, res);
    if (!session) return;
    const missing = validateConfiguration();
    if (missing.length) {
      redirect(res, buildRedirect(BASE_PATH, { notice: `Configuração ausente: ${missing.join(', ')}` }));
      return;
    }
    const state = makeSignedState({ email: session.email, nonce: crypto.randomUUID(), iat: Date.now() });
    const redirectUri = `${getPublicOrigin(req)}${BASE_PATH}/oauth/callback`;
    const oauthUrl = buildUrl('https://www.facebook.com/v20.0/dialog/oauth', {
      client_id: META_APP_ID,
      redirect_uri: redirectUri,
      state,
      scope: META_SCOPES,
      response_type: 'code',
    });
    redirect(res, oauthUrl);
    return;
  }

  if (req.method === 'GET' && url.pathname === `${BASE_PATH}/oauth/callback`) {
    const errorReason = url.searchParams.get('error') || url.searchParams.get('error_reason');
    if (errorReason) {
      renderMessagePage(res, 'OAuth da Meta cancelado', url.searchParams.get('error_description') || errorReason);
      return;
    }
    const code = String(url.searchParams.get('code') || '').trim();
    const state = String(url.searchParams.get('state') || '').trim();
    const verified = verifySignedState(state);
    if (!code || !verified?.email) {
      renderMessagePage(res, 'Callback inválido', 'O callback da Meta voltou sem code/state válidos.');
      return;
    }
    try {
      const userAccessToken = await exchangeCodeForUserToken(req, code);
      const pages = await fetchPages(userAccessToken);
      if (!pages.length) {
        renderMessagePage(res, 'Nenhuma Página encontrada', 'A conta autorizada não trouxe nenhuma Página publicável para este app.');
        return;
      }
      const selectedPage = pages.length === 1 ? pages[0] : null;
      saveConnection(verified.email, {
        userAccessToken,
        pageId: selectedPage?.id || '',
        pageName: selectedPage?.name || '',
        pageAccessToken: selectedPage?.accessToken || '',
        updatedAt: new Date().toISOString(),
      });
      const notice =
        pages.length === 1
          ? 'Conta Meta conectada com sucesso. A Página única já ficou selecionada.'
          : 'Conta Meta conectada. Agora selecione a Página para o review.';
      redirect(res, buildRedirect(BASE_PATH, { notice }));
    } catch (error) {
      renderMessagePage(res, 'Falha ao conectar', error.message || 'Erro no OAuth da Meta.');
    }
    return;
  }

  if (req.method === 'GET' && (url.pathname === BASE_PATH || url.pathname === `${BASE_PATH}/`)) {
    await renderDashboardRoute(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === `${BASE_PATH}/disconnect`) {
    const session = requireSession(req, res);
    if (!session) return;
    deleteConnection(session.email);
    redirect(res, buildRedirect(BASE_PATH, { notice: 'Conexão Meta removida do Orb.' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === `${BASE_PATH}/select-page`) {
    const session = requireSession(req, res);
    if (!session) return;
    const body = await readBody(req);
    const pageId = String(body.pageId || '').trim();
    const connection = getConnection(session.email);
    if (!connection?.userAccessToken) {
      redirect(res, buildRedirect(BASE_PATH, { notice: 'Conecte a Meta antes de escolher a Página.' }));
      return;
    }
    try {
      const pages = await fetchPages(connection.userAccessToken);
      const page = pages.find((entry) => entry.id === pageId);
      if (!page) {
        redirect(res, buildRedirect(BASE_PATH, { notice: 'Página não encontrada para esta conexão.' }));
        return;
      }
      saveConnection(session.email, {
        ...connection,
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.accessToken,
        updatedAt: new Date().toISOString(),
      });
      redirect(res, buildRedirect(BASE_PATH, { notice: `Página ${page.name || page.id} selecionada.` }));
    } catch (error) {
      redirect(res, buildRedirect(BASE_PATH, { notice: error.message || 'Falha ao selecionar a Página.' }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === `${BASE_PATH}/publish`) {
    const session = requireSession(req, res);
    if (!session) return;
    const body = await readBody(req);
    const message = String(body.message || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();
    const connection = getConnection(session.email);
    if (!connection?.pageId || !connection?.pageAccessToken) {
      redirect(res, buildRedirect(BASE_PATH, { notice: 'Selecione a Página antes de publicar.' }));
      return;
    }
    if (!message) {
      redirect(res, buildRedirect(BASE_PATH, { notice: 'Escreva a mensagem do post antes de publicar.' }));
      return;
    }
    try {
      const response = imageUrl
        ? await graphPost(`${connection.pageId}/photos`, { url: imageUrl, caption: message, published: 'true' }, connection.pageAccessToken)
        : await graphPost(`${connection.pageId}/feed`, { message }, connection.pageAccessToken);
      const postId = String(response?.post_id || response?.id || '').trim();
      redirect(res, buildRedirect(BASE_PATH, { notice: 'Post publicado com sucesso.', focus: postId }));
    } catch (error) {
      redirect(res, buildRedirect(BASE_PATH, { notice: error.message || 'Falha ao publicar o post.' }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === `${BASE_PATH}/update`) {
    const session = requireSession(req, res);
    if (!session) return;
    const body = await readBody(req);
    const postId = String(body.postId || '').trim();
    const message = String(body.message || '').trim();
    const connection = getConnection(session.email);
    if (!postId || !message || !connection?.pageAccessToken) {
      redirect(res, buildRedirect(BASE_PATH, { notice: 'Selecione um post válido para editar.' }));
      return;
    }
    try {
      await graphPost(postId, { message }, connection.pageAccessToken);
      redirect(res, buildRedirect(BASE_PATH, { notice: 'Post atualizado com sucesso.', focus: postId }));
    } catch (error) {
      redirect(res, buildRedirect(BASE_PATH, { notice: error.message || 'Falha ao atualizar o post.' }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === `${BASE_PATH}/delete`) {
    const session = requireSession(req, res);
    if (!session) return;
    const body = await readBody(req);
    const postId = String(body.postId || '').trim();
    const connection = getConnection(session.email);
    if (!postId || !connection?.pageAccessToken) {
      redirect(res, buildRedirect(BASE_PATH, { notice: 'Selecione um post válido para excluir.' }));
      return;
    }
    try {
      await graphDelete(postId, connection.pageAccessToken);
      redirect(res, buildRedirect(BASE_PATH, { notice: 'Post excluído com sucesso.' }));
    } catch (error) {
      redirect(res, buildRedirect(BASE_PATH, { notice: error.message || 'Falha ao excluir o post.' }));
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
}

async function handleInstagramReview(req, res) {
  const url = new URL(req.url, 'http://orb.local');

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === INSTAGRAM_HEALTH_PATH) {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    sendJson(res, 200, {
      ok: true,
      configured: validateConfiguration().length === 0,
      target: TARGET,
      port: PORT,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === INSTAGRAM_LOGIN_PATH) {
    renderInstagramLoginPage(res, { error: url.searchParams.get('error') || '' });
    return;
  }

  if (req.method === 'POST' && url.pathname === INSTAGRAM_LOGIN_PATH) {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (email !== REVIEW_EMAIL || password !== REVIEW_PASSWORD) {
      renderInstagramLoginPage(res, { error: 'Credenciais inválidas.' });
      return;
    }
    setSessionCookie(req, res, email);
    redirect(res, INSTAGRAM_BASE_PATH);
    return;
  }

  if (req.method === 'POST' && url.pathname === `${INSTAGRAM_BASE_PATH}/logout`) {
    clearSessionCookie(req, res);
    redirect(res, INSTAGRAM_LOGIN_PATH);
    return;
  }

  if (req.method === 'GET' && url.pathname === `${INSTAGRAM_BASE_PATH}/oauth/start`) {
    const session = requireSession(req, res);
    if (!session) return;
    const missing = validateConfiguration();
    if (missing.length) {
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: `Configuração ausente: ${missing.join(', ')}` }));
      return;
    }
    const state = makeSignedState({ email: session.email, nonce: crypto.randomUUID(), iat: Date.now(), review: 'instagram' });
    const redirectUri = `${getPublicOrigin(req)}${INSTAGRAM_BASE_PATH}/oauth/callback`;
    const oauthUrl = buildUrl('https://www.facebook.com/v20.0/dialog/oauth', {
      client_id: META_APP_ID,
      redirect_uri: redirectUri,
      state,
      scope: META_INSTAGRAM_SCOPES,
      response_type: 'code',
    });
    redirect(res, oauthUrl);
    return;
  }

  if (req.method === 'GET' && url.pathname === `${INSTAGRAM_BASE_PATH}/oauth/callback`) {
    const errorReason = url.searchParams.get('error') || url.searchParams.get('error_reason');
    if (errorReason) {
      renderMessagePage(res, 'OAuth da Meta cancelado', url.searchParams.get('error_description') || errorReason, INSTAGRAM_BASE_PATH);
      return;
    }
    const code = String(url.searchParams.get('code') || '').trim();
    const state = String(url.searchParams.get('state') || '').trim();
    const verified = verifySignedState(state);
    if (!code || !verified?.email) {
      renderMessagePage(res, 'Callback inválido', 'O callback da Meta voltou sem code/state válidos.', INSTAGRAM_BASE_PATH);
      return;
    }
    try {
      const userAccessToken = await exchangeCodeForUserToken(req, code, INSTAGRAM_BASE_PATH);
      const pages = await fetchPages(userAccessToken);
      if (!pages.length) {
        renderMessagePage(res, 'Nenhuma Página encontrada', 'A conta autorizada não trouxe nenhuma Página utilizável para este review.', INSTAGRAM_BASE_PATH);
        return;
      }
      const selectedPage = pages.length === 1 ? pages[0] : null;
      saveInstagramConnection(verified.email, {
        userAccessToken,
        pageId: selectedPage?.id || '',
        pageName: selectedPage?.name || '',
        pageAccessToken: selectedPage?.accessToken || '',
        updatedAt: new Date().toISOString(),
      });
      const notice =
        pages.length === 1
          ? 'Conta Meta conectada com sucesso. A Página única já ficou selecionada.'
          : 'Conta Meta conectada. Agora selecione a Página vinculada ao Instagram.';
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice }));
    } catch (error) {
      renderMessagePage(res, 'Falha ao conectar', error.message || 'Erro no OAuth da Meta.', INSTAGRAM_BASE_PATH);
    }
    return;
  }

  if (req.method === 'GET' && (url.pathname === INSTAGRAM_BASE_PATH || url.pathname === `${INSTAGRAM_BASE_PATH}/`)) {
    await renderInstagramDashboardRoute(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === `${INSTAGRAM_BASE_PATH}/publish`) {
    const session = requireSession(req, res);
    if (!session) return;
    const connection = getInstagramConnection(session.email);
    if (!connection?.userAccessToken || !connection?.pageId || !connection?.pageAccessToken) {
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: 'Conecte a Meta e selecione a Página antes de publicar.' }));
      return;
    }
    const body = await readBody(req);
    const caption = String(body.caption || '').trim();
    const mediaUrl = String(body.mediaUrl || INSTAGRAM_DEMO_IMAGE_URL).trim();
    if (!caption) {
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: 'Preencha a legenda antes de publicar.' }));
      return;
    }
    if (!mediaUrl.startsWith('https://')) {
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: 'A mídia precisa estar em uma URL HTTPS pública.' }));
      return;
    }
    try {
      const profile = await fetchInstagramProfile(connection.pageId, connection.pageAccessToken);
      if (!profile?.id) {
        redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: 'A Página selecionada não retornou um Instagram profissional válido.' }));
        return;
      }
      const mediaSource = new URL(mediaUrl);
      mediaSource.searchParams.set('orb_review_ts', String(Date.now()));
      const published = await publishInstagramImage(profile.id, connection.userAccessToken, mediaSource.toString(), caption);
      const media = await waitForInstagramMedia(published.publishedId, connection.userAccessToken);
      const notice = media?.permalink
        ? 'Conteúdo publicado com sucesso no Instagram e refletido no Orb.'
        : 'Conteúdo publicado com sucesso no Instagram.';
      redirect(
        res,
        buildRedirect(INSTAGRAM_BASE_PATH, {
          notice,
          publishedId: published.publishedId,
        }),
      );
    } catch (error) {
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: error.message || 'Falha ao publicar no Instagram.' }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === `${INSTAGRAM_BASE_PATH}/disconnect`) {
    const session = requireSession(req, res);
    if (!session) return;
    deleteInstagramConnection(session.email);
    redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: 'Conexão Meta removida do Orb.' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === `${INSTAGRAM_BASE_PATH}/select-page`) {
    const session = requireSession(req, res);
    if (!session) return;
    const body = await readBody(req);
    const pageId = String(body.pageId || '').trim();
    const connection = getInstagramConnection(session.email);
    if (!connection?.userAccessToken) {
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: 'Conecte a Meta antes de escolher a Página.' }));
      return;
    }
    try {
      const pages = await fetchPages(connection.userAccessToken);
      const page = pages.find((entry) => entry.id === pageId);
      if (!page) {
        redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: 'Página não encontrada para esta conexão.' }));
        return;
      }
      const profile = await fetchInstagramProfile(page.id, page.accessToken);
      if (!profile?.id) {
        redirect(
          res,
          buildRedirect(INSTAGRAM_BASE_PATH, {
            notice: 'A Página selecionada não retornou um Instagram profissional vinculado para este review.',
          }),
        );
        return;
      }
      saveInstagramConnection(session.email, {
        ...connection,
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.accessToken,
        updatedAt: new Date().toISOString(),
      });
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: `Página ${page.name || page.id} selecionada.` }));
    } catch (error) {
      redirect(res, buildRedirect(INSTAGRAM_BASE_PATH, { notice: error.message || 'Falha ao selecionar a Página.' }));
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (String(req.url || '').startsWith(BASE_PATH)) {
      await handleMetaReview(req, res);
      return;
    }
    if (String(req.url || '').startsWith(INSTAGRAM_BASE_PATH)) {
      await handleInstagramReview(req, res);
      return;
    }
    proxy.web(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'internal_error' });
  }
});

server.on('upgrade', (req, socket, head) => {
  if (String(req.url || '').startsWith(BASE_PATH) || String(req.url || '').startsWith(INSTAGRAM_BASE_PATH)) {
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head);
});

server.listen(PORT, LISTEN_ADDRESS, () => {
  console.log(`[orb-proxy] listening on http://${LISTEN_ADDRESS}:${PORT} -> ${TARGET}`);
});
