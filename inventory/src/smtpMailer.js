const encoder = new TextEncoder();
const decoder = new TextDecoder();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

function cleanHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function base64(value) {
  const bytes = encoder.encode(String(value || ''));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readResponse(reader, state) {
  while (true) {
    const next = await reader.read();
    if (next.done) throw new Error('SMTP_CONNECTION_CLOSED');
    state.buffer += decoder.decode(next.value, { stream: true });
    const lines = state.buffer.split('\r\n');
    state.buffer = lines.pop() || '';
    for (const line of lines) {
      state.lines.push(line);
      if (/^\d{3} /.test(line)) {
        const out = state.lines;
        state.lines = [];
        return out;
      }
    }
  }
}

function responseCode(lines) {
  return Number.parseInt(String(lines?.[lines.length - 1] || '').slice(0, 3), 10) || 0;
}

async function expect(reader, state, accepted) {
  const lines = await readResponse(reader, state);
  const code = responseCode(lines);
  if (!accepted.includes(code)) throw new Error(`SMTP_RESPONSE_${code || 'INVALID'}`);
  return lines;
}

async function command(writer, reader, state, text, accepted) {
  await writer.write(encoder.encode(`${text}\r\n`));
  return expect(reader, state, accepted);
}

export function hasPasswordResetMailerConfig(env) {
  return Boolean(
    String(env?.AUTH_RESET_SMTP_HOST || '').trim() &&
    String(env?.AUTH_RESET_SMTP_USERNAME || '').trim() &&
    String(env?.AUTH_RESET_SMTP_PASSWORD || '').trim() &&
    cleanEmail(env?.AUTH_RESET_EMAIL_FROM)
  );
}

export async function sendPasswordResetEmail({ env, to, code, expiresAt }) {
  if (!hasPasswordResetMailerConfig(env)) throw new Error('AUTH_RESET_EMAIL_NOT_CONFIGURED');

  const recipient = cleanEmail(to);
  const from = cleanEmail(env.AUTH_RESET_EMAIL_FROM);
  if (!recipient || !from) throw new Error('AUTH_RESET_EMAIL_INVALID');

  const hostname = String(env.AUTH_RESET_SMTP_HOST).trim();
  const port = Math.max(1, Number.parseInt(String(env.AUTH_RESET_SMTP_PORT || '465'), 10) || 465);
  const username = String(env.AUTH_RESET_SMTP_USERNAME).trim();
  const password = String(env.AUTH_RESET_SMTP_PASSWORD);
  const { connect } = await import('cloudflare:sockets');
  let socket = connect(
    { hostname, port },
    { secureTransport: port === 465 ? 'on' : 'starttls' }
  );
  let writer = socket.writable.getWriter();
  let reader = socket.readable.getReader();
  let state = { buffer: '', lines: [] };

  try {
    await expect(reader, state, [220]);
    await command(writer, reader, state, 'EHLO crm.skincos.com.br', [250]);
    if (port !== 465) {
      await command(writer, reader, state, 'STARTTLS', [220]);
      if (typeof socket.startTls !== 'function') throw new Error('SMTP_STARTTLS_UNAVAILABLE');
      writer.releaseLock();
      reader.releaseLock();
      const secured = await Promise.resolve(socket.startTls());
      if (!secured?.writable || !secured?.readable) throw new Error('SMTP_STARTTLS_FAILED');
      socket = secured;
      writer = secured.writable.getWriter();
      reader = secured.readable.getReader();
      state = { buffer: '', lines: [] };
      await command(writer, reader, state, 'EHLO crm.skincos.com.br', [250]);
    }
    await command(writer, reader, state, 'AUTH LOGIN', [334]);
    await command(writer, reader, state, base64(username), [334]);
    await command(writer, reader, state, base64(password), [235]);
    await command(writer, reader, state, `MAIL FROM:<${from}>`, [250]);
    await command(writer, reader, state, `RCPT TO:<${recipient}>`, [250, 251]);
    await command(writer, reader, state, 'DATA', [354]);

    const expiry = new Date(expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const subject = 'Código para redefinir sua senha — Espaço Facial CRM';
    const text = `Seu código de recuperação é: ${code}\n\nEle expira às ${expiry}. Se você não solicitou esta alteração, ignore esta mensagem.`;
    const html = `<p>Seu código de recuperação é:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Ele expira às ${expiry}. Se você não solicitou esta alteração, ignore esta mensagem.</p>`;
    const message = [
      `From: Espaço Facial CRM <${from}>`,
      `To: <${recipient}>`,
      `Subject: ${cleanHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="crm-reset-boundary"',
      '',
      '--crm-reset-boundary',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      text,
      '--crm-reset-boundary',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
      '--crm-reset-boundary--',
      '',
      '.'
    ].join('\r\n');
    await writer.write(encoder.encode(`${message}\r\n`));
    await expect(reader, state, [250]);
    await command(writer, reader, state, 'QUIT', [221]);
  } finally {
    try { writer.releaseLock(); } catch {}
    try { reader.releaseLock(); } catch {}
    try { socket.close(); } catch {}
  }
}
