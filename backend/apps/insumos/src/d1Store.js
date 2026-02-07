// @ts-nocheck

function toInt(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

// D1/SQLite can reject statements with many bound variables.
// Keep this deliberately conservative to avoid `too many SQL variables`.
function normalizeTipo(tipo) {
  return String(tipo || '').toUpperCase().replace('Í', 'I');
}

function calcularStatusValidade(dataValidade) {
  if (!dataValidade) return { status: 'OK', dias: null };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const validade = new Date(dataValidade);
  if (Number.isNaN(validade.getTime())) return { status: 'OK', dias: null };
  validade.setHours(0, 0, 0, 0);
  const diff = (validade - hoje) / (1000 * 60 * 60 * 24);
  if (diff < 0) return { status: 'EXPIRADO', dias: diff };
  if (diff <= 30) return { status: 'VENCENDO', dias: diff };
  return { status: 'OK', dias: diff };
}

function slugifyCategory(value) {
  const s0 = String(value || '').trim().toLowerCase();
  if (!s0) return '';
  return s0
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getCategoryPolicy(env, categoria) {
  const slug = slugifyCategory(categoria);
  if (!env?.DB || !slug) return { slug, requiresLot: false, requiresExpiry: false, fefo: false };
  try {
    const row = await env.DB.prepare(
      `SELECT slug, requires_lot, requires_expiry, fefo
       FROM insumos_categories
       WHERE slug = ? LIMIT 1`
    )
      .bind(slug)
      .first();
    if (!row?.slug) return { slug, requiresLot: false, requiresExpiry: false, fefo: false };
    return {
      slug,
      requiresLot: Number(row.requires_lot || 0) ? true : false,
      requiresExpiry: Number(row.requires_expiry || 0) ? true : false,
      fefo: Number(row.fefo || 0) ? true : false,
    };
  } catch {
    return { slug, requiresLot: false, requiresExpiry: false, fefo: false };
  }
}

function enforceLotExpiryPolicyOrError({ policy, lote, dataValidade }) {
  if (policy?.requiresLot && !String(lote || '').trim()) {
    return { ok: false, status: 400, code: 'POLICY_REQUIRES_LOT', error: 'Este item exige Lote pela política da categoria.' };
  }
  if (policy?.requiresExpiry && !String(dataValidade || '').trim()) {
    return { ok: false, status: 400, code: 'POLICY_REQUIRES_EXPIRY', error: 'Este item exige Data de validade pela política da categoria.' };
  }
  return { ok: true };
}

async function listRegistrosByCodigo(env, codigo) {
  const rows = await env.DB.prepare(
    `SELECT registro, lote, data_validade
     FROM insumos_items
     WHERE codigo_barras = ?
     ORDER BY (CASE WHEN data_validade IS NULL OR data_validade = '' THEN 1 ELSE 0 END),
              data_validade ASC,
              registro ASC`
  )
    .bind(String(codigo || '').trim())
    .all();
  return rows?.results || [];
}

async function listPickCandidates(env, { codigo, unidade }) {
  const normCodigo = String(codigo || '').trim();
  if (!normCodigo) return [];
  const unit = String(unidade || '').trim();

  const rows = await env.DB.prepare(
    `SELECT i.registro, i.lote, i.data_validade, i.categoria,
            COALESCE(s.quantidade, 0) AS quantidade
     FROM insumos_items i
     LEFT JOIN insumos_stocks s
       ON s.registro = i.registro AND s.unidade = ?
     WHERE i.codigo_barras = ?
     ORDER BY (CASE WHEN i.data_validade IS NULL OR i.data_validade = '' THEN 1 ELSE 0 END),
              i.data_validade ASC,
              i.registro ASC`
  )
    .bind(unit, normCodigo)
    .all();

  return (rows?.results || [])
    .map((r) => ({
      registro: String(r.registro || '').trim(),
      lote: String(r.lote || '').trim(),
      dataValidade: r.data_validade ? String(r.data_validade) : null,
      categoria: String(r.categoria || '').trim(),
      estoque: toInt(r.quantidade, 0),
    }))
    .filter((r) => r.registro);
}

async function pickRegistroOrAmbiguous(env, { codigo, registro, unidade, allowFefo = true }) {
  const normCodigo = String(codigo || '').trim();
  const normRegistro = String(registro || '').trim();
  if (!normCodigo) return { ok: false, code: 'BAD_REQUEST', error: 'Código inválido' };

  if (normRegistro) {
    const row = await env.DB.prepare(
      `SELECT registro
       FROM insumos_items
       WHERE registro = ?`
    )
      .bind(normRegistro)
      .first();
    if (!row?.registro) return { ok: false, code: 'NOT_FOUND', error: 'Registro não encontrado' };

    const match = await env.DB.prepare(
      `SELECT registro, codigo_barras
       FROM insumos_items
       WHERE registro = ?`
    )
      .bind(normRegistro)
      .first();
    if (match?.codigo_barras && String(match.codigo_barras).trim() !== normCodigo) {
      return { ok: false, code: 'MISMATCH', error: 'Registro não corresponde ao código informado' };
    }
    return { ok: true, registro: normRegistro };
  }

  const candidates = await listPickCandidates(env, { codigo: normCodigo, unidade });
  if (!candidates.length) return { ok: false, code: 'NOT_FOUND', error: 'Insumo não encontrado' };
  if (candidates.length > 1) {
    const categoria = String(candidates.find((c) => c.categoria)?.categoria || '').trim();
    const policy = categoria
      ? await getCategoryPolicy(env, categoria)
      : { slug: '', requiresLot: false, requiresExpiry: false, fefo: false };

    if (allowFefo && policy?.fefo) {
      const pool = candidates.filter((c) => toInt(c?.estoque, 0) > 0);
      const source = pool.length ? pool : candidates;
      const picked = source
        .slice()
        .sort((a, b) => {
          const da = a?.dataValidade ? new Date(a.dataValidade).getTime() : Number.POSITIVE_INFINITY;
          const db = b?.dataValidade ? new Date(b.dataValidade).getTime() : Number.POSITIVE_INFINITY;
          if (da !== db) return da - db;
          return String(a.registro).localeCompare(String(b.registro));
        })[0];
      if (picked?.registro) return { ok: true, registro: picked.registro, pickedBy: 'FEFO', policy };
    }

    return {
      ok: false,
      code: 'AMBIGUOUS',
      error: 'Código possui múltiplos registros (lotes). Selecione o lote/registro.',
      registros: candidates.map((r) => String(r.registro || '').trim()).filter(Boolean),
      candidates
    };
  }
  return { ok: true, registro: String(candidates[0].registro).trim() };
}

async function nextRegistro(env) {
  const row = await env.DB.prepare(
    `SELECT MAX(CAST(registro AS INTEGER)) AS mx
     FROM insumos_items
     WHERE registro GLOB '[0-9]*'`
  ).first();
  const next = (toInt(row?.mx, 0) || 0) + 1;
  return String(next).padStart(3, '0');
}

export async function d1HasInsumos(env) {
  if (!env?.DB) return false;
  try {
    const row = await env.DB.prepare('SELECT COUNT(1) AS n FROM insumos_items').first();
    return (toInt(row?.n, 0) || 0) > 0;
  } catch {
    return false;
  }
}

export async function d1HasUsers(env) {
  if (!env?.DB) return false;
  try {
    const { usersTable } = await resolveCrmTables(env);
    const row = await env.DB.prepare(`SELECT COUNT(1) AS n FROM ${usersTable}`).first();
    return (toInt(row?.n, 0) || 0) > 0;
  } catch {
    return false;
  }
}

async function sqliteObjectType(env, name) {
  if (!env?.DB || !name) return null;
  try {
    const row = await env.DB.prepare(`SELECT type FROM sqlite_master WHERE name = ? LIMIT 1`).bind(String(name)).first();
    return row?.type ? String(row.type) : null;
  } catch {
    return null;
  }
}

export async function resolveCrmTables(env) {
  // Prefer crm_* tables (post-migration). Fall back to legacy insumos_* tables.
  const usersType = await sqliteObjectType(env, 'crm_users');
  const invitesType = await sqliteObjectType(env, 'crm_invites');
  const resetsType = await sqliteObjectType(env, 'crm_password_resets');
  const prefsType = await sqliteObjectType(env, 'crm_user_prefs');

  return {
    usersTable: usersType === 'table' ? 'crm_users' : 'insumos_users',
    invitesTable: invitesType === 'table' ? 'crm_invites' : 'insumos_invites',
    passwordResetsTable: resetsType === 'table' ? 'crm_password_resets' : 'insumos_password_resets',
    userPrefsTable: prefsType === 'table' ? 'crm_user_prefs' : 'insumos_user_prefs',
  };
}

async function tableHasColumn(env, tableName, columnName) {
  if (!env?.DB || !tableName || !columnName) return false;
  // PRAGMA does not support binding identifiers; tableName is from a fixed allowlist.
  const t = String(tableName);
  if (!['crm_users', 'insumos_users'].includes(t)) return false;
  try {
    const res = await env.DB.prepare(`PRAGMA table_info(${t})`).all();
    const cols = (res?.results || []).map((r) => String(r?.name || '').toLowerCase());
    return cols.includes(String(columnName).toLowerCase());
  } catch {
    return false;
  }
}

// D1-only: legacy Sheets storage mode is removed.

export async function d1ListInsumos({ env, unidades, unidade }) {
  const itemsRes = await env.DB.prepare(
    `SELECT
        registro,
        codigo_barras,
        produto,
        categoria,
        marca,
        especificacao,
        concentracao,
        volume,
        calibre,
        tipo_unidade,
        fonte,
        preco_custo,
        estoque_minimo,
        lote,
        data_validade,
        data_cadastro,
        data_atualizacao
     FROM insumos_items
     ORDER BY produto COLLATE NOCASE ASC, codigo_barras ASC, registro ASC`
  ).all();
  const items = itemsRes?.results || [];

  const stocksRes = await env.DB.prepare(
    `SELECT registro, unidade, quantidade
     FROM insumos_stocks`
  ).all();
  const stocks = stocksRes?.results || [];

  const byRegistro = new Map();
  for (const s of stocks) {
    const reg = String(s.registro || '').trim();
    if (!reg) continue;
    const map = byRegistro.get(reg) || {};
    map[String(s.unidade || '').trim()] = toInt(s.quantidade, 0);
    byRegistro.set(reg, map);
  }

  return items.map((it) => {
    const registro = String(it.registro || '').trim();
    const estoques = byRegistro.get(registro) || {};
    const estoqueAtual = toInt(estoques?.[unidade], 0);
    const dataValidade = it.data_validade ? String(it.data_validade) : null;
    return {
      registro,
      codigoBarras: String(it.codigo_barras || ''),
      categoria: String(it.categoria || ''),
      marca: String(it.marca || ''),
      produto: String(it.produto || ''),
      especificacao: String(it.especificacao || ''),
      concentracao: String(it.concentracao || ''),
      volume: String(it.volume || ''),
      calibre: String(it.calibre || ''),
      tipoUnidade: String(it.tipo_unidade || ''),
      fonte: String(it.fonte || ''),
      lote: String(it.lote || ''),
      precoCusto: toNumber(it.preco_custo, 0),
      estoqueAtual,
      estoqueMinimo: toInt(it.estoque_minimo, 0),
      dataValidade: dataValidade || null,
      statusValidade: calcularStatusValidade(dataValidade),
      estoques: Object.fromEntries((unidades || []).map((u) => [u, toInt(estoques?.[u], 0)])),
    };
  });
}

export async function d1ListInsumosPaged({ env, unidades, unidade, q, pagina, limite }) {
  const page = Math.max(1, toInt(pagina, 1) || 1);
  const lim = Math.max(1, Math.min(1000, toInt(limite, 200) || 200));
  const offset = (page - 1) * lim;

  const query = String(q || '').trim();
  const where = [];
  const binds = [];
  if (query) {
    const like = `%${query}%`;
    where.push(`(
      produto LIKE ? COLLATE NOCASE OR
      codigo_barras LIKE ? COLLATE NOCASE OR
      categoria LIKE ? COLLATE NOCASE OR
      marca LIKE ? COLLATE NOCASE OR
      lote LIKE ? COLLATE NOCASE
    )`);
    binds.push(like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = await env.DB.prepare(`SELECT COUNT(1) AS n FROM insumos_items ${whereSql}`)
    .bind(...binds)
    .first();
  const total = toInt(countRow?.n, 0);

  const itemsRes = await env.DB.prepare(
    `SELECT
        registro,
        codigo_barras,
        produto,
        categoria,
        marca,
        especificacao,
        concentracao,
        volume,
        calibre,
        tipo_unidade,
        fonte,
        preco_custo,
        estoque_minimo,
        lote,
        data_validade,
        data_cadastro,
        data_atualizacao
     FROM insumos_items
     ${whereSql}
     ORDER BY produto COLLATE NOCASE ASC, codigo_barras ASC, registro ASC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, lim, offset)
    .all();
  const items = itemsRes?.results || [];

  const byRegistro = new Map();
  if (items.length) {
    const stocksRes = await env.DB.prepare(
      `SELECT s.registro, s.unidade, s.quantidade
       FROM insumos_stocks s
       WHERE s.registro IN (
         SELECT registro
         FROM insumos_items
         ${whereSql}
         ORDER BY produto COLLATE NOCASE ASC, codigo_barras ASC, registro ASC
         LIMIT ? OFFSET ?
       )`
    )
      .bind(...binds, lim, offset)
      .all();
    const stocks = stocksRes?.results || [];
    for (const s of stocks) {
      const reg = String(s.registro || '').trim();
      if (!reg) continue;
      const map = byRegistro.get(reg) || {};
      map[String(s.unidade || '').trim()] = toInt(s.quantidade, 0);
      byRegistro.set(reg, map);
    }
  }

  const mapped = items.map((it) => {
    const registro = String(it.registro || '').trim();
    const estoques = byRegistro.get(registro) || {};
    const estoqueAtual = toInt(estoques?.[unidade], 0);
    const dataValidade = it.data_validade ? String(it.data_validade) : null;
    return {
      registro,
      codigoBarras: String(it.codigo_barras || ''),
      categoria: String(it.categoria || ''),
      marca: String(it.marca || ''),
      produto: String(it.produto || ''),
      especificacao: String(it.especificacao || ''),
      concentracao: String(it.concentracao || ''),
      volume: String(it.volume || ''),
      calibre: String(it.calibre || ''),
      tipoUnidade: String(it.tipo_unidade || ''),
      fonte: String(it.fonte || ''),
      lote: String(it.lote || ''),
      precoCusto: toNumber(it.preco_custo, 0),
      estoqueAtual,
      estoqueMinimo: toInt(it.estoque_minimo, 0),
      dataValidade: dataValidade || null,
      statusValidade: calcularStatusValidade(dataValidade),
      estoques: Object.fromEntries((unidades || []).map((u) => [u, toInt(estoques?.[u], 0)])),
    };
  });

  return {
    items: mapped,
    resumo: { total, pagina: page, limite: lim, q: query || null }
  };
}

export async function d1GetInsumoByRegistro(env, registro) {
  const row = await env.DB.prepare(
    `SELECT
        registro,
        codigo_barras,
        produto,
        categoria,
        marca,
        especificacao,
        concentracao,
        volume,
        calibre,
        tipo_unidade,
        fonte,
        preco_custo,
        estoque_minimo,
        lote,
        data_validade,
        data_cadastro,
        data_atualizacao
     FROM insumos_items
     WHERE registro = ?`
  ).bind(String(registro || '').trim()).first();
  return row || null;
}

export async function d1CreateInsumo({ env, unidades, unidade, body }) {
  const codigoBarras = String(body?.codigoBarras || '').trim();
  const produto = String(body?.produto || '').trim();
  if (!codigoBarras) return { ok: false, status: 400, error: 'Código de barras é obrigatório' };
  if (!produto) return { ok: false, status: 400, error: 'Produto é obrigatório' };

  const allowDuplicateLot = body?.allowDuplicateLot === true || body?.novoLote === true;
  const lote = String(body?.lote || '').trim();

  if (allowDuplicateLot && !lote) return { ok: false, status: 400, error: 'Lote é obrigatório para cadastrar novo lote' };

  if (!allowDuplicateLot) {
    const exists = await env.DB.prepare('SELECT 1 FROM insumos_items WHERE codigo_barras = ? LIMIT 1').bind(codigoBarras).first();
    if (exists) return { ok: false, status: 409, error: 'Código de barras já cadastrado' };
  } else {
    const existsSame = await env.DB.prepare(
      'SELECT 1 FROM insumos_items WHERE codigo_barras = ? AND lote = ? LIMIT 1'
    ).bind(codigoBarras, lote).first();
    if (existsSame) return { ok: false, status: 409, error: 'Lote já cadastrado para este código de barras' };
  }

  const registro = await nextRegistro(env);
  const ts = nowIso();
  const dataValidade = body?.dataValidade ? String(body.dataValidade).trim() : '';
  const estoqueMinimo = toInt(body?.estoqueMinimo, 0);
  const precoCusto = toNumber(body?.precoCusto, 0);
  const estoqueInicial = toInt(body?.estoqueInicial, 0);

  const categoria = String(body?.categoria || '').trim();
  const policy = await getCategoryPolicy(env, categoria);
  const policyCheck = enforceLotExpiryPolicyOrError({ policy, lote, dataValidade });
  if (!policyCheck.ok) return policyCheck;

  const statements = [];
  statements.push(
    env.DB.prepare(
      `INSERT INTO insumos_items (
          registro, codigo_barras, produto, categoria, marca, especificacao, concentracao, volume, calibre, tipo_unidade,
          fonte, preco_custo, estoque_minimo, lote, data_validade, data_cadastro, data_atualizacao
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      registro,
      codigoBarras,
      produto,
      categoria,
      String(body?.marca || '').trim(),
      String(body?.especificacao || '').trim(),
      String(body?.concentracao || '').trim(),
      String(body?.volume || '').trim(),
      String(body?.calibre || '').trim(),
      String(body?.tipoUnidade || body?.unidade || '').trim(),
      String(body?.fonte || '').trim(),
      precoCusto,
      estoqueMinimo,
      lote,
      dataValidade,
      ts,
      ts
    )
  );

  // Stock only for selected unidade (others implied 0)
  statements.push(
    env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       VALUES (?, ?, ?, ?)`
    ).bind(registro, String(unidade || '').trim(), estoqueInicial, ts)
  );

  await env.DB.batch(statements);
  return { ok: true, registro };
}

export async function d1UpdateInsumo({ env, registro, body }) {
  const reg = String(registro || '').trim();
  if (!reg) return { ok: false, status: 400, error: 'Registro inválido' };

  const existing = await env.DB.prepare(
    'SELECT registro, categoria, lote, data_validade FROM insumos_items WHERE registro = ?'
  )
    .bind(reg)
    .first();
  if (!existing) return { ok: false, status: 404, error: 'Registro não encontrado' };

  const nextCategoria = body?.categoria !== undefined ? String(body?.categoria || '').trim() : String(existing?.categoria || '').trim();
  const nextLote = body?.lote !== undefined ? String(body?.lote || '').trim() : String(existing?.lote || '').trim();
  const nextValidade = body?.dataValidade !== undefined ? String(body?.dataValidade || '').trim() : String(existing?.data_validade || '').trim();
  const policy = await getCategoryPolicy(env, nextCategoria);
  const policyCheck = enforceLotExpiryPolicyOrError({ policy, lote: nextLote, dataValidade: nextValidade });
  if (!policyCheck.ok) return policyCheck;

  const fields = [];
  const vals = [];
  const set = (col, v) => {
    fields.push(`${col} = ?`);
    vals.push(v);
  };

  if (body?.codigoBarras !== undefined) set('codigo_barras', String(body.codigoBarras || '').trim());
  if (body?.produto !== undefined) set('produto', String(body.produto || '').trim());
  if (body?.categoria !== undefined) set('categoria', String(body.categoria || '').trim());
  if (body?.marca !== undefined) set('marca', String(body.marca || '').trim());
  if (body?.especificacao !== undefined) set('especificacao', String(body.especificacao || '').trim());
  if (body?.concentracao !== undefined) set('concentracao', String(body.concentracao || '').trim());
  if (body?.volume !== undefined) set('volume', String(body.volume || '').trim());
  if (body?.calibre !== undefined) set('calibre', String(body.calibre || '').trim());
  if (body?.tipoUnidade !== undefined) set('tipo_unidade', String(body.tipoUnidade || '').trim());
  if (body?.fonte !== undefined) set('fonte', String(body.fonte || '').trim());
  if (body?.precoCusto !== undefined) set('preco_custo', toNumber(body.precoCusto, 0));
  if (body?.estoqueMinimo !== undefined) set('estoque_minimo', toInt(body.estoqueMinimo, 0));
  if (body?.lote !== undefined) set('lote', String(body.lote || '').trim());
  if (body?.dataValidade !== undefined) set('data_validade', String(body.dataValidade || '').trim());

  set('data_atualizacao', nowIso());

  const sql = `UPDATE insumos_items SET ${fields.join(', ')} WHERE registro = ?`;
  vals.push(reg);
  await env.DB.prepare(sql).bind(...vals).run();
  return { ok: true };
}

export async function d1DeleteInsumo({ env, registro }) {
  const reg = String(registro || '').trim();
  if (!reg) return { ok: false, status: 400, error: 'Registro inválido' };
  const exists = await env.DB.prepare('SELECT 1 FROM insumos_items WHERE registro = ?').bind(reg).first();
  if (!exists) return { ok: false, status: 404, error: 'Registro não encontrado' };
  await env.DB.prepare('DELETE FROM insumos_items WHERE registro = ?').bind(reg).run();
  return { ok: true };
}

export async function d1EntradaBaixa({ env, unidade, body, kind }) {
  const codigo = String(body?.codigoBarras || '').trim();
  const registro = String(body?.registro || '').trim();
  const quantidade = Math.max(1, toInt(body?.quantidade, 0));
  const usuario = String(body?.usuario || '').trim();
  const observacoes = String(body?.observacoes || '').trim();
  if (!codigo || !quantidade) return { ok: false, status: 400, error: 'Código e quantidade são obrigatórios' };

  const unit = String(unidade || '').trim();
  const pick = await pickRegistroOrAmbiguous(env, { codigo, registro, unidade: unit, allowFefo: kind === 'BAIXA' });
  if (!pick.ok) {
    const status = pick.code === 'NOT_FOUND' ? 404 : pick.code === 'AMBIGUOUS' ? 409 : 400;
    return { ok: false, status, error: pick.error, code: pick.code, registros: pick.registros || [], candidates: pick.candidates || [] };
  }
  const reg = pick.registro;

  const item = await env.DB.prepare(
    `SELECT registro, codigo_barras, produto, categoria, lote, data_validade, estoque_minimo
     FROM insumos_items WHERE registro = ?`
  ).bind(reg).first();
  if (!item) return { ok: false, status: 404, error: 'Insumo não encontrado' };

  const policy = await getCategoryPolicy(env, item?.categoria || '');
  const policyCheck = enforceLotExpiryPolicyOrError({
    policy,
    lote: String(item?.lote || ''),
    dataValidade: String(item?.data_validade || '')
  });
  if (!policyCheck.ok) return policyCheck;

  const beforeRow = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(reg, unit).first();
  const estoqueAnterior = toInt(beforeRow?.quantidade, 0);

  const novoEstoque = kind === 'ENTRADA' ? estoqueAnterior + quantidade : estoqueAnterior - quantidade;
  const quebraEstoque = kind === 'BAIXA' && novoEstoque < 0;
  const deficit = quebraEstoque ? Math.abs(novoEstoque) : 0;
  const ts = nowIso();
  const movId = crypto.randomUUID();

  const stmts = [];
  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(registro, unidade) DO UPDATE SET quantidade=excluded.quantidade, updated_at=excluded.updated_at`
    ).bind(reg, unit, novoEstoque, ts)
  );

  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
        produto, quantidade, estoque_anterior, estoque_novo, unidade, usuario, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      movId,
      ts,
      kind === 'ENTRADA' ? 'ENTRADA' : 'SAÍDA',
      codigo,
      reg,
      String(item.lote || ''),
      String(item.data_validade || ''),
      String(item.produto || ''),
      quantidade,
      estoqueAnterior,
      novoEstoque,
      unit,
      usuario,
      observacoes
    )
  );

  await env.DB.batch(stmts);
  return { ok: true, estoqueAnterior, novoEstoque, registro: reg, quebraEstoque, deficit };
}

export async function d1Ajuste({ env, unidade, body }) {
  const codigo = String(body?.codigoBarras || '').trim();
  const registro = String(body?.registro || '').trim();
  const motivo = String(body?.motivo || '').trim();
  const usuario = String(body?.usuario || '').trim();
  const observacoes = String(body?.observacoes || '').trim();
  const novoEstoque = toInt(body?.novoEstoque, NaN);
  if (!codigo) return { ok: false, status: 400, error: 'Código é obrigatório' };
  if (!motivo) return { ok: false, status: 400, error: 'Motivo é obrigatório para ajuste' };
  if (!Number.isFinite(novoEstoque) || novoEstoque < 0) return { ok: false, status: 400, error: 'novoEstoque inválido' };

  const unit = String(unidade || '').trim();
  const pick = await pickRegistroOrAmbiguous(env, { codigo, registro, unidade: unit, allowFefo: false });
  if (!pick.ok) {
    const status = pick.code === 'NOT_FOUND' ? 404 : pick.code === 'AMBIGUOUS' ? 409 : 400;
    return { ok: false, status, error: pick.error, code: pick.code, registros: pick.registros || [], candidates: pick.candidates || [] };
  }
  const reg = pick.registro;

  const item = await env.DB.prepare(
    `SELECT registro, codigo_barras, produto, categoria, lote, data_validade
     FROM insumos_items WHERE registro = ?`
  ).bind(reg).first();
  if (!item) return { ok: false, status: 404, error: 'Insumo não encontrado' };

  const policy = await getCategoryPolicy(env, item?.categoria || '');
  const policyCheck = enforceLotExpiryPolicyOrError({
    policy,
    lote: String(item?.lote || ''),
    dataValidade: String(item?.data_validade || '')
  });
  if (!policyCheck.ok) return policyCheck;

  const beforeRow = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(reg, unit).first();
  const estoqueAnterior = toInt(beforeRow?.quantidade, 0);
  const diff = Math.abs((Number(novoEstoque) || 0) - (Number(estoqueAnterior) || 0));

  const ts = nowIso();
  const movId = crypto.randomUUID();

  const stmts = [];
  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(registro, unidade) DO UPDATE SET quantidade=excluded.quantidade, updated_at=excluded.updated_at`
    ).bind(reg, unit, novoEstoque, ts)
  );
  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
        produto, quantidade, estoque_anterior, estoque_novo, unidade, usuario, motivo, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      movId,
      ts,
      'AJUSTE',
      codigo,
      reg,
      String(item.lote || ''),
      String(item.data_validade || ''),
      String(item.produto || ''),
      diff,
      estoqueAnterior,
      novoEstoque,
      unit,
      usuario,
      motivo,
      observacoes
    )
  );
  await env.DB.batch(stmts);
  return { ok: true, estoqueAnterior, novoEstoque, registro: reg };
}

export async function d1Transfer({ env, body }) {
  const codigo = String(body?.codigoBarras || '').trim();
  const registro = String(body?.registro || '').trim();
  const quantidade = Math.max(1, toInt(body?.quantidade, 0));
  const fromUnidade = String(body?.fromUnidade || body?.unidadeOrigem || body?.from || '').trim();
  const toUnidade = String(body?.toUnidade || body?.unidadeDestino || body?.to || '').trim();
  const usuario = String(body?.usuario || '').trim();
  const observacoes = String(body?.observacoes || '').trim();

  if (!codigo || !quantidade) return { ok: false, status: 400, error: 'Código e quantidade são obrigatórios' };
  if (!fromUnidade || !toUnidade) return { ok: false, status: 400, error: 'Unidade origem e destino são obrigatórias' };
  if (fromUnidade === toUnidade) return { ok: false, status: 400, error: 'Origem e destino devem ser diferentes' };

  const pick = await pickRegistroOrAmbiguous(env, { codigo, registro, unidade: fromUnidade, allowFefo: true });
  if (!pick.ok) {
    const status = pick.code === 'NOT_FOUND' ? 404 : pick.code === 'AMBIGUOUS' ? 409 : 400;
    return { ok: false, status, error: pick.error, code: pick.code, registros: pick.registros || [], candidates: pick.candidates || [] };
  }
  const reg = pick.registro;

  const item = await env.DB.prepare(
    `SELECT registro, codigo_barras, produto, categoria, lote, data_validade
     FROM insumos_items WHERE registro = ?`
  ).bind(reg).first();
  if (!item) return { ok: false, status: 404, error: 'Insumo não encontrado' };

  const policy = await getCategoryPolicy(env, item?.categoria || '');
  const policyCheck = enforceLotExpiryPolicyOrError({
    policy,
    lote: String(item?.lote || ''),
    dataValidade: String(item?.data_validade || '')
  });
  if (!policyCheck.ok) return policyCheck;

  const beforeOrig = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(reg, fromUnidade).first();
  const beforeDest = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(reg, toUnidade).first();
  const estoqueAnteriorOrigem = toInt(beforeOrig?.quantidade, 0);
  const estoqueAnteriorDestino = toInt(beforeDest?.quantidade, 0);
  if (quantidade > estoqueAnteriorOrigem) return { ok: false, status: 400, error: 'Estoque insuficiente' };

  const estoqueNovoOrigem = estoqueAnteriorOrigem - quantidade;
  const estoqueNovoDestino = estoqueAnteriorDestino + quantidade;

  const ts = nowIso();
  const transferId = crypto.randomUUID();

  const obsSaida = `Transferência para ${toUnidade}${observacoes ? ` | ${observacoes}` : ''}`;
  const obsEntrada = `Transferência de ${fromUnidade}${observacoes ? ` | ${observacoes}` : ''}`;

  const stmts = [];
  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(registro, unidade) DO UPDATE SET quantidade=excluded.quantidade, updated_at=excluded.updated_at`
    ).bind(reg, fromUnidade, estoqueNovoOrigem, ts)
  );
  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(registro, unidade) DO UPDATE SET quantidade=excluded.quantidade, updated_at=excluded.updated_at`
    ).bind(reg, toUnidade, estoqueNovoDestino, ts)
  );

  const produto = String(item.produto || '');
  const lote = String(item.lote || '');
  const dataValidade = String(item.data_validade || '');

  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade, produto,
        quantidade, estoque_anterior, estoque_novo, unidade, unidade_origem, unidade_destino, id_transferencia, usuario, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      ts,
      'SAÍDA',
      codigo,
      reg,
      lote,
      dataValidade,
      produto,
      quantidade,
      estoqueAnteriorOrigem,
      estoqueNovoOrigem,
      fromUnidade,
      fromUnidade,
      toUnidade,
      transferId,
      usuario,
      obsSaida
    )
  );
  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade, produto,
        quantidade, estoque_anterior, estoque_novo, unidade, unidade_origem, unidade_destino, id_transferencia, usuario, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      ts,
      'ENTRADA',
      codigo,
      reg,
      lote,
      dataValidade,
      produto,
      quantidade,
      estoqueAnteriorDestino,
      estoqueNovoDestino,
      toUnidade,
      fromUnidade,
      toUnidade,
      transferId,
      usuario,
      obsEntrada
    )
  );

  await env.DB.batch(stmts);
  return {
    ok: true,
    transferId,
    estoqueAnteriorOrigem,
    estoqueNovoOrigem,
    estoqueAnteriorDestino,
    estoqueNovoDestino,
    registro: reg
  };
}

export async function d1ListMovimentacoes({ env, unidade, tipo, de, ate, pagina, limite, codigoBarras }) {
  const where = [];
  const binds = [];
  if (unidade) {
    where.push('unidade = ?');
    binds.push(String(unidade));
  }
  if (tipo && String(tipo).toUpperCase() !== 'TODOS') {
    where.push('UPPER(tipo) = ?');
    binds.push(String(tipo).toUpperCase());
  }
  if (codigoBarras) {
    where.push('codigo_barras = ?');
    binds.push(String(codigoBarras).trim());
  }

  const start = de ? String(de).trim() : '';
  const end = ate ? String(ate).trim() : '';
  if (start) {
    where.push('data_hora >= ?');
    binds.push(`${start}T00:00:00.000Z`);
  }
  if (end) {
    where.push('data_hora <= ?');
    binds.push(`${end}T23:59:59.999Z`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.max(1, Math.min(200, toInt(limite, 50)));
  const pag = Math.max(1, toInt(pagina, 1));
  const offset = (pag - 1) * lim;

  const totalRow = await env.DB.prepare(`SELECT COUNT(1) AS n FROM insumos_movements ${whereSql}`).bind(...binds).first();
  const totalMovimentacoes = toInt(totalRow?.n, 0);

  const rows = await env.DB.prepare(
    `SELECT
        m.data_hora AS dataHora,
        m.tipo AS tipo,
        m.codigo_barras AS codigoBarras,
        m.produto AS produto,
        m.quantidade AS quantidade,
        m.estoque_anterior AS estoqueAnterior,
        m.estoque_novo AS estoqueNovo,
        m.unidade AS unidade,
        m.unidade_origem AS unidadeOrigem,
        m.unidade_destino AS unidadeDestino,
        m.id_transferencia AS transferId,
        m.usuario AS usuario,
        m.motivo AS motivo,
        m.observacoes AS observacoes,
        m.registro_insumo AS registroInsumo,
        m.lote AS lote,
        m.data_validade AS dataValidade,
        i.preco_custo AS preco
     FROM insumos_movements m
     LEFT JOIN insumos_items i
       ON i.registro = m.registro_insumo
     ${whereSql}
     ORDER BY m.data_hora DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, lim, offset)
    .all();

  return {
    movimentos: (rows?.results || []).map((r) => ({
      ...r,
      preco: toNumber(r.preco, 0),
    })),
    resumo: { totalMovimentacoes, pagina: pag, limite: lim }
  };
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeAllowedUnits(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    const parsed = safeJsonParse(value, null);
    if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    return value
      .split(/[,;|]/g)
      .map((s) => String(s || '').trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeAllowedModules(value) {
  // Sem campo/vazio => "ALL" (represented by empty array)
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    const parsed = safeJsonParse(value, null);
    if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    return value
      .split(/[,;|]/g)
      .map((s) => String(s || '').trim())
      .filter(Boolean);
  }
  return [];
}

export function d1UserRowToUser(row) {
  if (!row) return null;
  return {
    name: row.display_name || row.username,
    displayName: row.display_name || row.username,
    username: row.username,
    email: row.email || '',
    role: row.role || 'CONSULTOR',
    photoUrl: row.photo_url || '',
    allowedUnits: normalizeAllowedUnits(row.allowed_units_json),
    allowedModules: normalizeAllowedModules(row.allowed_modules_json),
    ativo: toInt(row.ativo, 1) ? true : false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    passwordHash: row.password_hash || '',
  };
}

export async function d1GetUserByUsername(env, username) {
  if (!env?.DB) return null;
  const u = String(username || '').trim();
  if (!u) return null;
  const { usersTable } = await resolveCrmTables(env);
  const hasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
  const extra = hasModules ? ', allowed_modules_json' : '';
  const row = await env.DB.prepare(
    `SELECT username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at${extra}
     FROM ${usersTable}
     WHERE LOWER(username) = LOWER(?)
     LIMIT 1`
  )
    .bind(u)
    .first();
  return d1UserRowToUser(row);
}

export async function d1GetUserByIdentifier(env, identifier) {
  if (!env?.DB) return null;
  const id = String(identifier || '').trim();
  if (!id) return null;
  const { usersTable } = await resolveCrmTables(env);
  const hasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
  const extra = hasModules ? ', allowed_modules_json' : '';
  const row = await env.DB.prepare(
    `SELECT username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at${extra}
     FROM ${usersTable}
     WHERE LOWER(username) = LOWER(?) OR (email IS NOT NULL AND email != '' AND LOWER(email) = LOWER(?))
     LIMIT 1`
  )
    .bind(id, id)
    .first();
  return d1UserRowToUser(row);
}

export async function d1UpdateUserProfile(env, username, updates) {
  if (!env?.DB) return { ok: false, status: 500, error: 'DB_NOT_CONFIGURED' };
  const u = String(username || '').trim();
  if (!u) return { ok: false, status: 400, error: 'USERNAME_REQUIRED' };

  const { usersTable } = await resolveCrmTables(env);
  const hasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
  const extra = hasModules ? ', allowed_modules_json' : '';
  const existing = await env.DB.prepare(
    `SELECT username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at${extra}
     FROM ${usersTable}
     WHERE LOWER(username) = LOWER(?)
     LIMIT 1`
  )
    .bind(u)
    .first();
  if (!existing) return { ok: false, status: 404, error: 'USER_NOT_FOUND' };

  const nextUsername = updates?.newUsername ? String(updates.newUsername).trim() : null;
  const nextDisplayName = updates?.displayName !== undefined ? String(updates.displayName || '').trim() : null;
  const nextEmail = updates?.email !== undefined ? String(updates.email || '').trim() : null;
  const nextPhotoUrl = updates?.photoUrl !== undefined ? String(updates.photoUrl || '') : null;
  const nextPasswordHash = updates?.passwordHash ? String(updates.passwordHash) : null;
  const now = nowIso();

  if (nextUsername && nextUsername.toLowerCase() !== String(existing.username).toLowerCase()) {
    const taken = await env.DB.prepare(
      `SELECT 1 FROM ${usersTable} WHERE LOWER(username) = LOWER(?) LIMIT 1`
    )
      .bind(nextUsername)
      .first();
    if (taken) return { ok: false, status: 409, error: 'USERNAME_TAKEN' };

    // Move user PK (best-effort) and keep references consistent.
    if (hasModules) {
      await env.DB.prepare(
        `INSERT INTO ${usersTable} (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          nextUsername,
          nextEmail ?? existing.email ?? '',
          nextDisplayName ?? existing.display_name ?? '',
          nextPasswordHash ?? existing.password_hash ?? '',
          existing.role ?? 'CONSULTOR',
          nextPhotoUrl ?? existing.photo_url ?? '',
          existing.allowed_units_json ?? null,
          existing.allowed_modules_json ?? null,
          toInt(existing.ativo, 1),
          existing.created_at || now,
          now
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO ${usersTable} (username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          nextUsername,
          nextEmail ?? existing.email ?? '',
          nextDisplayName ?? existing.display_name ?? '',
          nextPasswordHash ?? existing.password_hash ?? '',
          existing.role ?? 'CONSULTOR',
          nextPhotoUrl ?? existing.photo_url ?? '',
          existing.allowed_units_json ?? null,
          toInt(existing.ativo, 1),
          existing.created_at || now,
          now
        )
        .run();
    }

    await env.DB.prepare(`DELETE FROM ${usersTable} WHERE LOWER(username) = LOWER(?)`).bind(u).run();
    // Best-effort propagate to other tables where we store username as text.
    try { await env.DB.prepare(`UPDATE insumos_movements SET usuario=? WHERE usuario=?`).bind(nextUsername, existing.username).run(); } catch { }
    try { await env.DB.prepare(`UPDATE share_history SET user=? WHERE user=?`).bind(nextUsername, existing.username).run(); } catch { }
    try { await env.DB.prepare(`UPDATE audit_log SET actor=? WHERE actor=?`).bind(nextUsername, existing.username).run(); } catch { }

    const out = await d1GetUserByUsername(env, nextUsername);
    return { ok: true, user: out, username: nextUsername };
  }

  await env.DB.prepare(
    `UPDATE ${usersTable}
     SET email=COALESCE(?, email),
         display_name=COALESCE(?, display_name),
         photo_url=COALESCE(?, photo_url),
         password_hash=COALESCE(?, password_hash),
         updated_at=?
     WHERE LOWER(username) = LOWER(?)`
  )
    .bind(
      nextEmail,
      nextDisplayName,
      nextPhotoUrl,
      nextPasswordHash,
      now,
      u
    )
    .run();

  const out = await d1GetUserByUsername(env, u);
  return { ok: true, user: out, username: u };
}
