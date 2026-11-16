// SPBIM — API do site de prospecção (Cloudflare Workers + banco D1)
// Rotas:
//   GET    /api/opcoes            (público)  segmentos AEC, maturidade BIM e softwares
//   POST   /api/leads             (público)  captura de lead pelo formulário
//   POST   /api/login             (admin)    valida a senha
//   GET    /api/leads             (admin)    lista os leads
//   POST   /api/admin/leads       (admin)    cria lead manualmente
//   PATCH  /api/leads/:id         (admin)    atualiza etapa, valor, dados, notas
//   DELETE /api/leads/:id         (admin)    exclui (pedido LGPD)
//   GET    /api/leads.csv         (admin)    exporta CSV
//
// Bindings: D1 "DB" (wrangler.jsonc) e segredo ADMIN_PASSWORD (painel da Cloudflare).

const STAGES = ['novo', 'contatado', 'qualificado', 'proposta', 'ganho', 'perdido'];

// Público-alvo da SPBIM: empresas de Arquitetura, Engenharia e Construção (AEC)
const SEGMENTOS = {
  arquitetura: 'Escritório de arquitetura',
  engenharia: 'Escritório de engenharia / projetos complementares',
  construtora: 'Construtora',
  incorporadora: 'Incorporadora',
  gerenciadora: 'Gerenciadora / fiscalização de obras',
  infraestrutura: 'Infraestrutura / obras públicas',
};
const MATURIDADE_BIM = {
  'nao-usa': 'Ainda não usa BIM (quer começar)',
  iniciando: 'Em implantação',
  parcial: 'Usa BIM em parte dos projetos',
  consolidado: 'BIM consolidado na empresa',
};
const SOFTWARES = ['Revit', 'ArchiCAD', 'Navisworks', 'Tekla', 'Civil 3D', 'AutoCAD', 'SketchUp', 'Outro'];

// ---------- Utilidades ----------
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cleanList = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => SOFTWARES.includes(x));
const now = () => new Date().toISOString();

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(buf);
}
// A senha chega codificada (encodeURIComponent) para aceitar acentos e "ç".
function tokenFrom(request) {
  const raw = request.headers.get('x-admin-token') || '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}
async function isAdmin(request, env) {
  const esperado = (env.ADMIN_PASSWORD || '').trim();
  if (!esperado) return false;
  const [a, b] = await Promise.all([sha256(tokenFrom(request).trim()), sha256(esperado)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; // comparação em tempo constante
  return diff === 0;
}

// ---------- Banco (D1) ----------
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      email TEXT,
      criado_em TEXT NOT NULL,
      data TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS envios (ip TEXT NOT NULL, em INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS login_falhas (ip TEXT NOT NULL, em INTEGER NOT NULL)`),
  ]);
  schemaReady = true;
}
async function allLeads(db) {
  const { results } = await db.prepare('SELECT data FROM leads ORDER BY criado_em').all();
  return results.map((r) => JSON.parse(r.data));
}
async function getLead(db, id) {
  const row = await db.prepare('SELECT data FROM leads WHERE id = ?').bind(id).first();
  return row ? JSON.parse(row.data) : null;
}
const insertLead = (db, l) =>
  db.prepare('INSERT INTO leads (id, email, criado_em, data) VALUES (?, ?, ?, ?)').bind(l.id, l.email, l.criadoEm, JSON.stringify(l)).run();
const saveLead = (db, l) =>
  db.prepare('UPDATE leads SET email = ?, data = ? WHERE id = ?').bind(l.email, JSON.stringify(l), l.id).run();

// Limite de 5 envios por minuto por IP (anti-spam)
async function rateLimited(db, ip) {
  const t = Date.now();
  await db.prepare('DELETE FROM envios WHERE em < ?').bind(t - 60_000).run();
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM envios WHERE ip = ?').bind(ip).first();
  if (n >= 5) return true;
  await db.prepare('INSERT INTO envios (ip, em) VALUES (?, ?)').bind(ip, t).run();
  return false;
}

// Bloqueio contra tentativa de adivinhar a senha: 10 erros em 15 minutos por IP
const LOGIN_MAX_FALHAS = 10;
const LOGIN_JANELA_MS = 15 * 60_000;
async function loginBloqueado(db, ip) {
  const t = Date.now();
  await db.prepare('DELETE FROM login_falhas WHERE em < ?').bind(t - LOGIN_JANELA_MS).run();
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM login_falhas WHERE ip = ?').bind(ip).first();
  return n >= LOGIN_MAX_FALHAS;
}
const registrarFalhaLogin = (db, ip) => db.prepare('INSERT INTO login_falhas (ip, em) VALUES (?, ?)').bind(ip, Date.now()).run();
const limparFalhasLogin = (db, ip) => db.prepare('DELETE FROM login_falhas WHERE ip = ?').bind(ip).run();

async function getLeadByEmail(db, email) {
  const row = await db.prepare('SELECT data FROM leads WHERE email = ?').bind(email).first();
  return row ? JSON.parse(row.data) : null;
}

// ---------- Regras de negócio ----------
function scoreLead(l) {
  let score = 0;
  if (l.email && !/@(gmail|hotmail|outlook|yahoo|bol|uol|icloud)\./i.test(l.email)) score += 15; // e-mail corporativo
  if (l.telefone) score += 5;
  if (l.empresa) score += 5;
  if (l.cargo && /(diretor|gerente|ceo|s[óo]cio|propriet|head|coordenador|bim manager)/i.test(l.cargo)) score += 20;
  const seg = { construtora: 15, incorporadora: 15, infraestrutura: 15, gerenciadora: 10, engenharia: 10, arquitetura: 10 };
  score += seg[l.segmento] || 0;
  const mat = { iniciando: 15, parcial: 15, consolidado: 10, 'nao-usa': 5 };
  score += mat[l.maturidadeBim] || 0;
  const porte = { '1-10': 3, '11-50': 8, '51-200': 12, '200+': 15 };
  score += porte[l.porte] || 0;
  if (l.prazo === 'imediato') score += 10;
  else if (l.prazo === '3-meses') score += 5;
  return Math.min(score, 100);
}

function buildLead(b, origemPadrao) {
  return {
    id: crypto.randomUUID(),
    nome: clean(b.nome, 120),
    email: clean(b.email, 160).toLowerCase(),
    telefone: clean(b.telefone, 30),
    empresa: clean(b.empresa, 120),
    cargo: clean(b.cargo, 80),
    cidade: clean(b.cidade, 80),
    segmento: SEGMENTOS[b.segmento] ? b.segmento : '',
    maturidadeBim: MATURIDADE_BIM[b.maturidadeBim] ? b.maturidadeBim : '',
    softwares: cleanList(b.softwares),
    porte: clean(b.porte, 20),
    interesse: clean(b.interesse, 80),
    prazo: clean(b.prazo, 20),
    mensagem: clean(b.mensagem, 2000),
    origem: clean(b.origem, 120) || origemPadrao,
    consentimento: !!b.consentimento,
    etapa: 'novo',
    valor: 0,
    notas: [],
    criadoEm: now(),
    atualizadoEm: now(),
  };
}

// ---------- Handlers ----------
async function capturarLead(request, env) {
  const b = await request.json().catch(() => ({}));
  if (b.website) return json({ ok: true }); // honeypot anti-spam

  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (await rateLimited(env.DB, ip)) return json({ error: 'Muitas tentativas. Tente novamente em instantes.' }, 429);

  const lead = buildLead(b, 'site');
  if (!lead.nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return json({ error: 'Informe nome e um e-mail válido.' }, 400);
  if (!lead.consentimento) return json({ error: 'É necessário aceitar a política de privacidade (LGPD).' }, 400);
  if (!lead.empresa) return json({ error: 'Informe o nome da empresa.' }, 400);
  // Somente empresas de Arquitetura, Engenharia ou Construção que usam ou querem usar BIM
  if (!lead.segmento) return json({ error: 'Selecione o segmento da sua empresa (arquitetura, engenharia ou construção).' }, 400);
  if (!lead.maturidadeBim) return json({ error: 'Informe o nível de uso de BIM na sua empresa.' }, 400);

  lead.score = scoreLead(lead);

  // Mesmo e-mail já cadastrado: registra o novo contato no lead existente (não perde a mensagem)
  const existente = await getLeadByEmail(env.DB, lead.email);
  if (existente) {
    for (const f of ['telefone', 'empresa', 'cargo', 'cidade', 'segmento', 'maturidadeBim', 'porte', 'interesse', 'prazo']) {
      if (lead[f] && !existente[f]) existente[f] = lead[f];
    }
    if (lead.softwares.length) existente.softwares = [...new Set([...(existente.softwares || []), ...lead.softwares])];
    let texto = 'Novo envio pelo formulário do site';
    if (lead.interesse) texto += ` · interesse: ${lead.interesse}`;
    if (lead.mensagem) texto += ` · mensagem: “${lead.mensagem}”`;
    existente.notas.push({ texto, data: now(), sistema: true });
    if (existente.etapa === 'perdido') {
      existente.notas.push({ texto: 'Etapa: perdido → novo (cliente voltou a entrar em contato)', data: now(), sistema: true });
      existente.etapa = 'novo';
    }
    existente.score = scoreLead(existente);
    existente.atualizadoEm = now();
    await saveLead(env.DB, existente);
    return json({ ok: true });
  }

  await insertLead(env.DB, lead);
  return json({ ok: true }, 201);
}

async function criarLeadAdmin(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!clean(b.nome)) return json({ error: 'Nome é obrigatório.' }, 400);
  const lead = buildLead(b, 'manual');
  lead.consentimento = true;
  lead.etapa = STAGES.includes(b.etapa) ? b.etapa : 'novo';
  lead.valor = Number(b.valor) || 0;
  lead.score = scoreLead(lead);
  await insertLead(env.DB, lead);
  return json(lead, 201);
}

async function atualizarLead(request, env, id) {
  const lead = await getLead(env.DB, id);
  if (!lead) return json({ error: 'Lead não encontrado' }, 404);
  const b = await request.json().catch(() => ({}));

  if (b.etapa !== undefined) {
    if (!STAGES.includes(b.etapa)) return json({ error: 'Etapa inválida' }, 400);
    if (b.etapa !== lead.etapa) lead.notas.push({ texto: `Etapa: ${lead.etapa} → ${b.etapa}`, data: now(), sistema: true });
    lead.etapa = b.etapa;
  }
  if (b.valor !== undefined) lead.valor = Math.max(0, Number(b.valor) || 0);
  for (const f of ['nome', 'email', 'telefone', 'empresa', 'cargo', 'cidade', 'interesse', 'proximoContato']) {
    if (b[f] !== undefined) lead[f] = clean(b[f], 160);
  }
  if (b.segmento !== undefined && SEGMENTOS[b.segmento]) lead.segmento = b.segmento;
  if (b.maturidadeBim !== undefined && MATURIDADE_BIM[b.maturidadeBim]) lead.maturidadeBim = b.maturidadeBim;
  if (b.nota) lead.notas.push({ texto: clean(b.nota, 2000), data: now() });

  lead.score = scoreLead(lead);
  lead.atualizadoEm = now();
  await saveLead(env.DB, lead);
  return json(lead);
}

async function exportarCsv(env) {
  const cols = ['nome', 'email', 'telefone', 'empresa', 'cargo', 'cidade', 'segmento', 'maturidadeBim', 'softwares', 'porte', 'interesse', 'prazo', 'etapa', 'valor', 'score', 'origem', 'criadoEm'];
  // Prefixa ' em textos que começam com = + - @ para o Excel não executá-los como fórmula
  const esc = (v) => {
    let t = String(Array.isArray(v) ? v.join(', ') : v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const label = (c, v) => (c === 'segmento' ? SEGMENTOS[v] : c === 'maturidadeBim' ? MATURIDADE_BIM[v] : v);
  const rows = (await allLeads(env.DB)).map((l) => cols.map((c) => esc(label(c, l[c]))).join(';'));
  return new Response('﻿' + [cols.join(';'), ...rows].join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads-spbim.csv"' },
  });
}

// ---------- Roteador ----------
export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  if (!env.DB) return json({ error: 'Banco D1 não configurado (binding "DB").' }, 500);

  try {
    await ensureSchema(env.DB);

    if (path === '/api/opcoes' && m === 'GET') return json({ segmentos: SEGMENTOS, maturidadeBim: MATURIDADE_BIM, softwares: SOFTWARES });
    if (path === '/api/leads' && m === 'POST') return capturarLead(request, env);

    // Daqui para baixo, somente administrador
    if (!(env.ADMIN_PASSWORD || '').trim()) {
      return json({ error: 'A senha do painel (ADMIN_PASSWORD) não está configurada na Cloudflare.', codigo: 'SEM_SENHA' }, 503);
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (await loginBloqueado(env.DB, ip)) {
      return json({ error: 'Muitas tentativas de senha. Aguarde 15 minutos e tente novamente.', codigo: 'BLOQUEADO' }, 429);
    }
    if (!(await isAdmin(request, env))) {
      await registrarFalhaLogin(env.DB, ip);
      return json({ error: 'Senha incorreta.', codigo: 'SENHA_INCORRETA' }, 401);
    }
    if (path === '/api/login') await limparFalhasLogin(env.DB, ip);

    if (path === '/api/login' && m === 'POST') return json({ ok: true });
    if (path === '/api/leads' && m === 'GET') return json({ stages: STAGES, leads: await allLeads(env.DB) });
    if (path === '/api/leads.csv' && m === 'GET') return exportarCsv(env);
    if (path === '/api/admin/leads' && m === 'POST') return criarLeadAdmin(request, env);

    const idMatch = path.match(/^\/api\/leads\/([\w-]+)$/);
    if (idMatch && m === 'PATCH') return atualizarLead(request, env, idMatch[1]);
    if (idMatch && m === 'DELETE') {
      const r = await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(idMatch[1]).run();
      return r.meta.changes ? json({ ok: true }) : json({ error: 'Lead não encontrado' }, 404);
    }

    return json({ error: 'Rota não encontrada' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'Erro interno' }, 500);
  }
}
