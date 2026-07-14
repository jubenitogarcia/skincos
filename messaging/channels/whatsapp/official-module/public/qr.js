/* global fetch, document */

const els = {
  statusLine: document.getElementById('statusLine'),
  statusDetails: document.getElementById('statusDetails'),
  qrBox: document.getElementById('qrBox'),
  qrMeta: document.getElementById('qrMeta'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnStart: document.getElementById('btnStart')
};

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function setHtml(el, html) {
  if (!el) return;
  el.innerHTML = html;
}

function makeQrImgSrc(qr) {
  const data = encodeURIComponent(qr);
  return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${data}`;
}

async function apiGet(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function refreshAll() {
  try {
    const [st, qr] = await Promise.all([apiGet('/status'), apiGet('/qr')]);

    const status = st.json || {};
    const ready = !!status.ready;
    const qrRequired = !!status.qrRequired;
    const user = status.user || (status.clientInfo && status.clientInfo.pushname) || null;

    if (ready) {
      setText(els.statusLine, `✅ Conectado${user ? `: ${user}` : ''}`);
      setText(els.statusDetails, 'Cliente WhatsApp está pronto.');
    } else if (qrRequired) {
      setText(els.statusLine, '📱 QR Code necessário');
      setText(els.statusDetails, 'Escaneie o QR abaixo com o celular.');
    } else {
      setText(els.statusLine, '⏳ Conectando…');
      setText(els.statusDetails, status.message || 'Aguardando QR ou inicialização.');
    }

    const qrPayload = qr.json || {};
    if (qrPayload && qrPayload.qr) {
      const src = makeQrImgSrc(qrPayload.qr);
      setHtml(els.qrBox, `<img alt="QR Code WhatsApp" src="${src}" />`);
      setText(els.qrMeta, qrPayload.status ? `Status: ${qrPayload.status}` : '');
    } else if (ready) {
      setHtml(els.qrBox, `<div style="text-align:center"><div style="font-size:42px">✅</div><div>Já conectado</div></div>`);
      setText(els.qrMeta, '');
    } else {
      setHtml(els.qrBox, `<div style="text-align:center">QR não disponível ainda. Clique em “Iniciar cliente” se necessário.</div>`);
      setText(els.qrMeta, '');
    }
  } catch (err) {
    setText(els.statusLine, '❌ Erro de conexão');
    setText(els.statusDetails, err && err.message ? err.message : 'Falha ao consultar /status e /qr');
    setHtml(els.qrBox, `<div>Não foi possível carregar o QR.</div>`);
    setText(els.qrMeta, '');
  }
}

async function startClient() {
  try {
    const res = await fetch('/start-client', { method: 'POST', headers: { Accept: 'application/json' } });
    await res.json().catch(() => null);
  } catch {
    // ignore
  } finally {
    await refreshAll();
  }
}

els.btnRefresh && els.btnRefresh.addEventListener('click', () => refreshAll());
els.btnStart && els.btnStart.addEventListener('click', () => startClient());

refreshAll();
setInterval(refreshAll, 3000);

