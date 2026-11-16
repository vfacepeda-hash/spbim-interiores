// SPBIM — API do site de prospecção (Cloudflare Workers + banco D1)
//
// Públicas:
//   GET    /api/opcoes              segmentos AEC, maturidade BIM e softwares
//   POST   /api/leads               captura de lead pelo formulário
//   POST   /api/login               login (e-mail + senha, ou senha mestra ADMIN_PASSWORD)
// Equipe (sessão por cookie seguro):
//   POST   /api/logout              encerra a sessão
//   GET    /api/me                  usuário logado
//   POST   /api/minha-senha         troca a própria senha
//   GET    /api/leads               lista os leads
//   POST   /api/admin/leads         cria lead manualmente
//   PATCH  /api/leads/:id           atualiza etapa, valor, dados, notas
//   DELETE /api/leads/:id           exclui (pedido LGPD)
//   GET    /api/leads.csv           exporta CSV
// Somente administradores:
//   GET    /api/usuarios            lista a equipe
//   POST   /api/usuarios            cria usuário
//   PATCH  /api/usuarios/:id        altera nome, papel, ativo ou redefine senha
//
// Configuração na Cloudflare:
//   D1 "DB" (wrangler.jsonc)
//   Segredo ADMIN_PASSWORD     senha mestra (primeiro acesso e recuperação)
//   Segredos TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (opcionais) para avisar a cada lead novo

const STAGES = ['novo', 'contatado', 'qualificado', 'proposta', 'ganho', 'perdido'];
const NOMES_ETAPA = { novo: 'Novo', contatado: 'Contatado', qualificado: 'Qualificado', proposta: 'Proposta', ganho: 'Ganho', perdido: 'Perdido' };

// Público-alvo da SPBIM: empresas de Arquitetura, Engenharia e Construção (AEC)
// Manter em sincronia com as opções fixas em public/index.html
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
  'nao-usa': 'Ainda não usa BIM (quer começar)',
  iniciando: 'Em implantação',
  parcial: 'Usa BIM em parte dos projetos',
  consolidado: 'BIM consolidado na empresa',
};
const SOFTWARES = ['Revit', 'ArchiCAD', 'Navisworks', 'Tekla', 'Civil 3D', 'AutoCAD', 'SketchUp', 'Outro'];
const PAPEIS = ['admin', 'comercial'];

const SESSAO_COOKIE = 'spbim_sessao';
const SESSAO_DURACAO_S = 12 * 60 * 60; // 12 horas
const SENHA_MIN = 10;
const PBKDF2_ITERACOES = 100_000; // máximo suportado pelo Workers

// ---------- Utilidades ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cleanList = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => SOFTWARES.includes(x));
const now = () => new Date().toISOString();
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const ipDe = (request) => request.headers.get('CF-Connecting-IP') || 'local';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; // comparação em tempo constante
  return diff === 0;
}
async function hashSenha(senha, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERACOES }, key, 256);
  return hex(bits);
}
const hashIgual = (a, b) => iguais(new TextEncoder().encode(a), new TextEncoder().encode(b));
function lerCookie(request, nome) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + nome + '=([^;]+)'));
  return m ? m[1] : '';
}
function cookieSessao(request, valor, maxAge) {
  const seguro = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSAO_COOKIE}=${valor}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${seguro}`;
}

// ---------- Banco (D1) ----------
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, email TEXT, criado_em TEXT NOT NULL, data TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)'),
    db.prepare('CREATE TABLE IF NOT EXISTS envios (ip TEXT NOT NULL, em INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS login_falhas (ip TEXT NOT NULL, em INTEGER NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, papel TEXT NOT NULL,
      senha_hash TEXT NOT NULL, salt TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY, usuario_id TEXT NOT NULL, nome TEXT NOT NULL, papel TEXT NOT NULL, expira_em INTEGER NOT NULL)`),
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
async function getLeadByEmail(db, email) {
  const row = await db.prepare('SELECT data FROM leads WHERE email = ?').bind(email).first();
  return row ? JSON.parse(row.data) : null;
}
const insertLead = (db, l) =>
  db.prepare('INSERT INTO leads (id, email, criado_em, data) VALUES (?, ?, ?, ?)').bind(l.id, l.email, l.criadoEm, JSON.stringify(l)).run();
const saveLead = (db, l) =>
  db.prepare('UPDATE leads SET email = ?, data = ? WHERE id = ?').bind(l.email, JSON.stringify(l), l.id).run();

// Formulário: no máximo 5 envios por minuto por IP (anti-spam)
async function rateLimited(db, ip) {
  const t = Date.now();
  await db.prepare('DELETE FROM envios WHERE em < ?').bind(t - 60_000).run();
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM envios WHERE ip = ?').bind(ip).first();
  if (n >= 5) return true;
  await db.prepare('INSERT INTO envios (ip, em) VALUES (?, ?)').bind(ip, t).run();
  return false;
}

// Login: bloqueio após 10 senhas erradas em 15 minutos por IP (força bruta)
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

// ---------- Sessões ----------
async function criarSessao(db, usuario) {
  const token = randomHex(32);
  await db.prepare('DELETE FROM sessoes WHERE expira_em < ?').bind(Date.now()).run();
  await db.prepare('INSERT INTO sessoes (token_hash, usuario_id, nome, papel, expira_em) VALUES (?, ?, ?, ?, ?)')
    .bind(hex(await sha256(token)), usuario.id, usuario.nome, usuario.papel, Date.now() + SESSAO_DURACAO_S * 1000).run();
  return token;
}
async function usuarioDaSessao(request, db) {
  const token = lerCookie(request, SESSAO_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = hex(await sha256(token));
  const s = await db.prepare('SELECT usuario_id, nome, papel, expira_em FROM sessoes WHERE token_hash = ?').bind(tokenHash).first();
  if (!s || s.expira_em < Date.now()) return null;
  return { id: s.usuario_id, nome: s.nome, papel: s.papel, tokenHash };
}

// ---------- Aviso de lead novo (Telegram) ----------
async function notificar(env, texto) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
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
function textoAviso(lead, request, retorno) {
  const painel = new URL('/admin', request.url).href;
  const linhas = [
    retorno ? '🔁 Cliente voltou a entrar em contato — SPBIM' : '🔔 Novo lead no site SPBIM',
    '',
    `👤 ${lead.nome}${lead.cargo ? ' — ' + lead.cargo : ''}`,
    `🏢 ${lead.empresa || '—'}${lead.segmento ? ' (' + SEGMENTOS[lead.segmento] + ')' : ''}`,
    `📐 BIM: ${MATURIDADE_BIM[lead.maturidadeBim] || '—'}`,
    lead.interesse ? `🎯 Interesse: ${lead.interesse}` : '',
    lead.prazo ? `⏱️ Prazo: ${lead.prazo}` : '',
    `⭐ Score: ${lead.score}`,
    `📧 ${lead.email}`,
    lead.telefone ? `📱 ${lead.telefone}` : '',
    lead.mensagem ? `💬 “${lead.mensagem.slice(0, 500)}”` : '',
    `📍 Origem: ${lead.origem}`,
    '',
    `Abrir painel: ${painel}`,
  ];
  return linhas.filter((l, i) => l !== '' || (i > 0 && linhas[i - 1] !== '')).join('\n');
}

// ---------- Regras de negócio ----------
function scoreLead(l) {
  let score = 0;
  if (l.email && !/@(gmail|hotmail|outlook|yahoo|bol|uol|icloud)\./i.test(l.email)) score += 15; // e-mail corporativo
  if (l.telefone) score += 5;
  if (l.empresa) score += 5;
  if (l.cargo && /(diretor|gerente|ceo|s[óo]cio|propriet|head|coordenador|bim manager)/i.test(l.cargo)) score += 20;
  const seg = { construtora: 15, incorporadora: 15, infraestrutura: 15, gerenciadora: 10, engenharia: 10, arquitetura: 10, interiores: 10 };
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
const nota = (texto, autor, sistema = false) => ({ texto, data: now(), autor: autor || 'Site', ...(sistema ? { sistema: true } : {}) });

// ---------- Handlers: leads ----------
async function capturarLead(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  if (b.website) return json({ ok: true }); // honeypot anti-spam

  if (await rateLimited(env.DB, ipDe(request))) return json({ error: 'Muitas tentativas. Tente novamente em instantes.' }, 429);

  const lead = buildLead(b, 'site');
  if (!lead.nome || !emailValido(lead.email)) return json({ error: 'Informe nome e um e-mail válido.' }, 400);
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
    existente.notas.push(nota(texto, 'Site', true));
    if (existente.etapa === 'perdido') {
      existente.notas.push(nota('Etapa: Perdido → Novo (cliente voltou a entrar em contato)', 'Site', true));
      existente.etapa = 'novo';
    }
    existente.score = scoreLead(existente);
    existente.atualizadoEm = now();
    await saveLead(env.DB, existente);
    ctx?.waitUntil(notificar(env, textoAviso({ ...existente, mensagem: lead.mensagem, origem: lead.origem }, request, true)));
    return json({ ok: true });
  }

  await insertLead(env.DB, lead);
  ctx?.waitUntil(notificar(env, textoAviso(lead, request, false)));
  return json({ ok: true }, 201);
}

async function criarLeadAdmin(request, env, usuario) {
  const b = await request.json().catch(() => ({}));
  if (!clean(b.nome)) return json({ error: 'Nome é obrigatório.' }, 400);
  const lead = buildLead(b, 'manual');
  lead.consentimento = true;
  lead.etapa = STAGES.includes(b.etapa) ? b.etapa : 'novo';
  lead.valor = Math.max(0, Number(b.valor) || 0);
  lead.proximoContato = clean(b.proximoContato, 10);
  lead.notas.push(nota(`Lead cadastrado manualmente por ${usuario.nome}`, usuario.nome, true));
  if (clean(b.nota)) lead.notas.push(nota(clean(b.nota, 2000), usuario.nome));
  lead.score = scoreLead(lead);
  await insertLead(env.DB, lead);
  return json(lead, 201);
}

async function atualizarLead(request, env, id, usuario) {
  const lead = await getLead(env.DB, id);
  if (!lead) return json({ error: 'Lead não encontrado' }, 404);
  const b = await request.json().catch(() => ({}));

  if (b.etapa !== undefined) {
    if (!STAGES.includes(b.etapa)) return json({ error: 'Etapa inválida' }, 400);
    if (b.etapa !== lead.etapa) {
      lead.notas.push(nota(`Etapa: ${NOMES_ETAPA[lead.etapa]} → ${NOMES_ETAPA[b.etapa]}`, usuario.nome, true));
    }
    lead.etapa = b.etapa;
  }
  if (b.valor !== undefined) lead.valor = Math.max(0, Number(b.valor) || 0);
  if (b.email !== undefined && clean(b.email) && !emailValido(clean(b.email))) return json({ error: 'E-mail inválido.' }, 400);
  for (const f of ['nome', 'email', 'telefone', 'empresa', 'cargo', 'cidade', 'interesse', 'proximoContato']) {
    if (b[f] !== undefined) lead[f] = f === 'email' ? clean(b[f], 160).toLowerCase() : clean(b[f], 160);
  }
  if (b.segmento !== undefined && SEGMENTOS[b.segmento]) lead.segmento = b.segmento;
  if (b.maturidadeBim !== undefined && MATURIDADE_BIM[b.maturidadeBim]) lead.maturidadeBim = b.maturidadeBim;
  if (clean(b.nota)) lead.notas.push(nota(clean(b.nota, 2000), usuario.nome));

  lead.score = scoreLead(lead);
  lead.atualizadoEm = now();
  lead.atualizadoPor = usuario.nome;
  await saveLead(env.DB, lead);
  return json(lead);
}

async function exportarCsv(env) {
  const cols = ['nome', 'email', 'telefone', 'empresa', 'cargo', 'cidade', 'segmento', 'maturidadeBim', 'softwares', 'porte', 'interesse', 'prazo', 'etapa', 'valor', 'score', 'origem', 'criadoEm', 'atualizadoPor'];
  // Prefixa ' em textos que começam com = + - @ para o Excel não executá-los como fórmula
  const esc = (v) => {
    let t = String(Array.isArray(v) ? v.join(', ') : v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const label = (c, v) => (c === 'segmento' ? SEGMENTOS[v] : c === 'maturidadeBim' ? MATURIDADE_BIM[v] : c === 'etapa' ? NOMES_ETAPA[v] : v);
  const rows = (await allLeads(env.DB)).map((l) => cols.map((c) => esc(label(c, l[c]))).join(';'));
  return new Response('﻿' + [cols.join(';'), ...rows].join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads-spbim.csv"' },
  });
}

// ---------- Handlers: login e equipe ----------
async function login(request, env) {
  const db = env.DB;
  const ip = ipDe(request);
  if (await loginBloqueado(db, ip)) {
    return json({ error: 'Muitas tentativas de senha. Aguarde 15 minutos e tente novamente.', codigo: 'BLOQUEADO' }, 429);
  }
  const b = await request.json().catch(() => ({}));
  const email = clean(b.email, 160).toLowerCase();
  const senha = typeof b.senha === 'string' ? b.senha.trim() : '';
  let usuario = null;

  if (!email) {
    // Senha mestra (segredo ADMIN_PASSWORD): primeiro acesso e recuperação
    const mestra = (env.ADMIN_PASSWORD || '').trim();
    if (!mestra) {
      return json({ error: 'Informe seu e-mail. (A senha mestra ADMIN_PASSWORD não está configurada na Cloudflare.)', codigo: 'SEM_SENHA' }, 400);
    }
    if (iguais(await sha256(senha), await sha256(mestra))) usuario = { id: 'mestre', nome: 'Administrador', papel: 'admin' };
  } else {
    const u = await db.prepare('SELECT id, nome, papel, senha_hash, salt, ativo FROM usuarios WHERE email = ?').bind(email).first();
    if (u && u.ativo) {
      if (hashIgual(await hashSenha(senha, u.salt), u.senha_hash)) usuario = { id: u.id, nome: u.nome, papel: u.papel };
    } else {
      await hashSenha(senha, 'x'); // mesmo custo para não revelar se o e-mail existe
    }
  }

  if (!usuario) {
    await registrarFalhaLogin(db, ip);
    return json({ error: email ? 'E-mail ou senha incorretos.' : 'Senha mestra incorreta.', codigo: 'SENHA_INCORRETA' }, 401);
  }
  await limparFalhasLogin(db, ip);
  const token = await criarSessao(db, usuario);
  return json({ ok: true, usuario: { nome: usuario.nome, papel: usuario.papel, mestre: usuario.id === 'mestre' } }, 200,
    { 'Set-Cookie': cookieSessao(request, token, SESSAO_DURACAO_S) });
}

async function listarUsuarios(db) {
  const { results } = await db.prepare('SELECT id, nome, email, papel, ativo, criado_em FROM usuarios ORDER BY nome').all();
  return json({ usuarios: results.map((u) => ({ ...u, ativo: !!u.ativo })) });
}

async function criarUsuario(request, db) {
  const b = await request.json().catch(() => ({}));
  const nome = clean(b.nome, 80), email = clean(b.email, 160).toLowerCase(), senha = typeof b.senha === 'string' ? b.senha.trim() : '';
  const papel = PAPEIS.includes(b.papel) ? b.papel : 'comercial';
  if (!nome || !emailValido(email)) return json({ error: 'Informe nome e um e-mail válido.' }, 400);
  if (senha.length < SENHA_MIN) return json({ error: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.` }, 400);
  if (await db.prepare('SELECT 1 FROM usuarios WHERE email = ?').bind(email).first()) return json({ error: 'Já existe um usuário com esse e-mail.' }, 409);
  const salt = randomHex(16);
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO usuarios (id, nome, email, papel, senha_hash, salt, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .bind(id, nome, email, papel, await hashSenha(senha, salt), salt, now()).run();
  return json({ ok: true, id }, 201);
}

async function alterarUsuario(request, db, id, quem) {
  const u = await db.prepare('SELECT id, nome, papel, ativo FROM usuarios WHERE id = ?').bind(id).first();
  if (!u) return json({ error: 'Usuário não encontrado.' }, 404);
  const b = await request.json().catch(() => ({}));
  if (id === quem.id && (b.ativo === false || (b.papel && b.papel !== 'admin'))) {
    return json({ error: 'Você não pode desativar nem tirar o acesso de administrador de si mesmo.' }, 400);
  }
  const novaSenha = typeof b.senha === 'string' ? b.senha.trim() : '';
  if (novaSenha && novaSenha.length < SENHA_MIN) return json({ error: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.` }, 400);

  const nome = b.nome !== undefined ? clean(b.nome, 80) || u.nome : u.nome;
  const papel = PAPEIS.includes(b.papel) ? b.papel : u.papel;
  const ativo = b.ativo === undefined ? u.ativo : b.ativo ? 1 : 0;
  await db.prepare('UPDATE usuarios SET nome = ?, papel = ?, ativo = ? WHERE id = ?').bind(nome, papel, ativo, id).run();
  if (novaSenha) {
    const salt = randomHex(16);
    await db.prepare('UPDATE usuarios SET senha_hash = ?, salt = ? WHERE id = ?').bind(await hashSenha(novaSenha, salt), salt, id).run();
  }
  // Qualquer alteração encerra as sessões abertas desse usuário (desativado sai na hora)
  await db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(id).run();
  return json({ ok: true });
}

async function trocarMinhaSenha(request, db, usuario) {
  if (usuario.id === 'mestre') return json({ error: 'A senha mestra é trocada na Cloudflare (segredo ADMIN_PASSWORD).' }, 400);
  const b = await request.json().catch(() => ({}));
  const atual = typeof b.atual === 'string' ? b.atual.trim() : '', nova = typeof b.nova === 'string' ? b.nova.trim() : '';
  const u = await db.prepare('SELECT senha_hash, salt FROM usuarios WHERE id = ?').bind(usuario.id).first();
  if (!u || !hashIgual(await hashSenha(atual, u.salt), u.senha_hash)) return json({ error: 'Senha atual incorreta.' }, 400);
  if (nova.length < SENHA_MIN) return json({ error: `A nova senha precisa ter pelo menos ${SENHA_MIN} caracteres.` }, 400);
  const salt = randomHex(16);
  await db.prepare('UPDATE usuarios SET senha_hash = ?, salt = ? WHERE id = ?').bind(await hashSenha(nova, salt), salt, usuario.id).run();
  await db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash != ?').bind(usuario.id, usuario.tokenHash).run();
  return json({ ok: true });
}

// ---------- Roteador ----------
export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  if (!env.DB) return json({ error: 'Banco D1 não configurado (binding "DB").' }, 500);

  try {
    await ensureSchema(env.DB);

    // Públicas
    if (path === '/api/opcoes' && m === 'GET') return json({ segmentos: SEGMENTOS, maturidadeBim: MATURIDADE_BIM, softwares: SOFTWARES });
    if (path === '/api/leads' && m === 'POST') return capturarLead(request, env, ctx);
    if (path === '/api/login' && m === 'POST') return login(request, env);

    // Daqui para baixo, somente equipe logada
    const usuario = await usuarioDaSessao(request, env.DB);
    if (!usuario) return json({ error: 'Sessão expirada. Entre novamente.', codigo: 'SEM_SESSAO' }, 401);

    if (path === '/api/logout' && m === 'POST') {
      await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(usuario.tokenHash).run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookieSessao(request, '', 0) });
    }
    if (path === '/api/me' && m === 'GET') return json({ usuario: { nome: usuario.nome, papel: usuario.papel, mestre: usuario.id === 'mestre' } });
    if (path === '/api/minha-senha' && m === 'POST') return trocarMinhaSenha(request, env.DB, usuario);
    if (path === '/api/leads' && m === 'GET') return json({ stages: STAGES, leads: await allLeads(env.DB) });
    if (path === '/api/leads.csv' && m === 'GET') return exportarCsv(env);
    if (path === '/api/admin/leads' && m === 'POST') return criarLeadAdmin(request, env, usuario);

    const idMatch = path.match(/^\/api\/leads\/([\w-]+)$/);
    if (idMatch && m === 'PATCH') return atualizarLead(request, env, idMatch[1], usuario);
    if (idMatch && m === 'DELETE') {
      const r = await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(idMatch[1]).run();
      if (r.meta.changes) console.log(`Lead ${idMatch[1]} excluído por ${usuario.nome}`);
      return r.meta.changes ? json({ ok: true }) : json({ error: 'Lead não encontrado' }, 404);
    }

    // Somente administradores
    if (path.startsWith('/api/usuarios')) {
      if (usuario.papel !== 'admin') return json({ error: 'Apenas administradores podem gerenciar a equipe.' }, 403);
      if (path === '/api/usuarios' && m === 'GET') return listarUsuarios(env.DB);
      if (path === '/api/usuarios' && m === 'POST') return criarUsuario(request, env.DB);
      const um = path.match(/^\/api\/usuarios\/([\w-]+)$/);
      if (um && m === 'PATCH') return alterarUsuario(request, env.DB, um[1], usuario);
    }

    return json({ error: 'Rota não encontrada' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'Erro interno' }, 500);
  }
}
