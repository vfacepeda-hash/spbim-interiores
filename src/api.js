// SPBIM — API da landing page de interiores (Cloudflare Workers + banco D1)
//
//   POST /api/leads   recebe o formulário da landing page, grava no banco e avisa no Telegram
//
// Configuração na Cloudflare:
//   D1 "DB" (wrangler.jsonc)                       onde os leads ficam guardados
//   Segredos TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID  aviso de lead novo no grupo da equipe

const SEGMENTOS = {
  arquitetura: 'Escritório de arquitetura',
  interiores: 'Escritório de design de interiores',
  engenharia: 'Escritório de engenharia / projetos complementares',
  construtora: 'Construtora',
  incorporadora: 'Incorporadora',
  gerenciadora: 'Gerenciadora / fiscalização de obras',
  infraestrutura: 'Infraestrutura / obras públicas',
};
const MATURIDADE_BIM = {
  'nao-usa': 'Ainda não usa BIM',
  iniciando: 'Em implantação',
  parcial: 'Usa BIM em parte dos projetos',
  consolidado: 'BIM consolidado na empresa',
};
const SOFTWARES = ['Revit', 'ArchiCAD', 'Navisworks', 'Tekla', 'Civil 3D', 'AutoCAD', 'SketchUp', 'Outro'];

// ---------- Utilidades ----------
// CORS: permite que a landing page funcione também hospedada fora da Cloudflare
// (ex.: arquivo baixado e publicado em outro servidor), enviando o formulário para esta API.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cleanList = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => SOFTWARES.includes(x));
const now = () => new Date().toISOString();
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------- Banco (D1) ----------
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, email TEXT, criado_em TEXT NOT NULL, data TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)'),
    db.prepare('CREATE TABLE IF NOT EXISTS envios (ip TEXT NOT NULL, em INTEGER NOT NULL)'),
  ]);
  schemaReady = true;
}

// No máximo 5 envios por minuto por IP (anti-spam)
async function rateLimited(db, ip) {
  const t = Date.now();
  await db.prepare('DELETE FROM envios WHERE em < ?').bind(t - 60_000).run();
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM envios WHERE ip = ?').bind(ip).first();
  if (n >= 5) return true;
  await db.prepare('INSERT INTO envios (ip, em) VALUES (?, ?)').bind(ip, t).run();
  return false;
}

// ---------- Aviso de lead novo (Telegram) ----------
async function notificar(env, texto) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn('Lead recebido, mas o Telegram não está configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).');
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: texto, disable_web_page_preview: true }),
    });
    if (!r.ok) console.error('Telegram respondeu', r.status, await r.text());
  } catch (err) {
    console.error('Falha ao avisar no Telegram', err);
  }
}
function textoAviso(lead, retorno) {
  const fone = (lead.telefone || '').replace(/\D/g, '');
  const whats = fone ? `https://wa.me/${fone.length <= 11 ? '55' + fone : fone}` : '';
  const linhas = [
    retorno ? '🔁 Cliente voltou a pedir o diagnóstico — SPBIM' : '🔔 Novo pedido de diagnóstico — SPBIM',
    '',
    `👤 ${lead.nome}`,
    `🏢 ${lead.empresa || '—'}${lead.segmento ? ' (' + SEGMENTOS[lead.segmento] + ')' : ''}`,
    lead.mensagem ? `📋 ${lead.mensagem.slice(0, 500)}` : '',
    `📐 BIM: ${MATURIDADE_BIM[lead.maturidadeBim] || '—'}`,
    `📧 ${lead.email}`,
    lead.telefone ? `📱 ${lead.telefone}` : '',
    `📍 Origem: ${lead.origem}`,
    whats ? `\nResponder no WhatsApp: ${whats}` : '',
  ];
  return linhas.filter((l, i) => l !== '' || (i > 0 && linhas[i - 1] !== '')).join('\n');
}

// ---------- Lead ----------
function buildLead(b) {
  return {
    id: crypto.randomUUID(),
    nome: clean(b.nome, 120),
    email: clean(b.email, 160).toLowerCase(),
    telefone: clean(b.telefone, 30),
    empresa: clean(b.empresa, 120),
    segmento: SEGMENTOS[b.segmento] ? b.segmento : '',
    maturidadeBim: MATURIDADE_BIM[b.maturidadeBim] ? b.maturidadeBim : '',
    softwares: cleanList(b.softwares),
    interesse: clean(b.interesse, 80),
    prazo: clean(b.prazo, 20),
    mensagem: clean(b.mensagem, 2000),
    origem: clean(b.origem, 120) || 'site',
    consentimento: !!b.consentimento,
    historico: [],
    criadoEm: now(),
    atualizadoEm: now(),
  };
}

async function capturarLead(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  if (b.website) return json({ ok: true }); // honeypot anti-spam

  if (await rateLimited(env.DB, request.headers.get('CF-Connecting-IP') || 'local')) {
    return json({ error: 'Muitas tentativas. Tente novamente em instantes.' }, 429);
  }

  const lead = buildLead(b);
  if (!lead.nome || !emailValido(lead.email)) return json({ error: 'Informe nome e um e-mail válido.' }, 400);
  if (!lead.consentimento) return json({ error: 'É necessário aceitar o aviso de privacidade (LGPD).' }, 400);
  if (!lead.empresa) return json({ error: 'Informe o nome do escritório.' }, 400);
  if (!lead.segmento) return json({ error: 'Segmento inválido.' }, 400);
  if (!lead.maturidadeBim) return json({ error: 'Informe como o escritório desenvolve os projetos.' }, 400);

  // Mesmo e-mail já cadastrado: guarda o novo pedido no histórico do lead existente
  const row = await env.DB.prepare('SELECT data FROM leads WHERE email = ?').bind(lead.email).first();
  if (row) {
    const existente = JSON.parse(row.data);
    existente.historico = existente.historico || existente.notas || [];
    existente.historico.push({ data: now(), texto: `Novo pedido pelo site · ${lead.mensagem}`, origem: lead.origem });
    for (const f of ['telefone', 'empresa', 'segmento', 'maturidadeBim', 'interesse', 'prazo']) {
      if (lead[f]) existente[f] = lead[f];
    }
    existente.atualizadoEm = now();
    await env.DB.prepare('UPDATE leads SET data = ? WHERE id = ?').bind(JSON.stringify(existente), existente.id).run();
    ctx?.waitUntil(notificar(env, textoAviso({ ...existente, mensagem: lead.mensagem, origem: lead.origem }, true)));
    return json({ ok: true });
  }

  await env.DB.prepare('INSERT INTO leads (id, email, criado_em, data) VALUES (?, ?, ?, ?)')
    .bind(lead.id, lead.email, lead.criadoEm, JSON.stringify(lead)).run();
  ctx?.waitUntil(notificar(env, textoAviso(lead, false)));
  return json({ ok: true }, 201);
}

// ---------- Roteador ----------
export async function handleApi(request, env, ctx) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.DB) return json({ error: 'Banco D1 não configurado (binding "DB").' }, 500);
  try {
    await ensureSchema(env.DB);
    if (path === '/api/leads' && request.method === 'POST') return capturarLead(request, env, ctx);
    return json({ error: 'Rota não encontrada' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'Erro interno' }, 500);
  }
}
