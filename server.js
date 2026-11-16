// SPBIM — Servidor do site de prospecção de clientes (AEC / BIM)
// - Landing page pública com formulário de captura de leads
// - API REST para gestão dos leads (protegida por senha de administrador)
// - Armazenamento simples em arquivo JSON (data/leads.json)

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // TROQUE EM PRODUÇÃO
// Em produção, aponte DATA_DIR para um disco persistente (ex.: /var/data no Render)
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'leads.json');

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

// ---------- Persistência ----------
function loadLeads() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function saveLeads(leads) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(leads, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- Pontuação automática do lead (lead scoring) ----------
function scoreLead(l) {
  let score = 0;
  if (l.email && !/@(gmail|hotmail|outlook|yahoo|bol|uol|icloud)\./i.test(l.email)) score += 15; // e-mail corporativo
  if (l.telefone) score += 5;
  if (l.empresa) score += 5;
  if (l.cargo && /(diretor|gerente|ceo|s[óo]cio|propriet|head|coordenador|bim manager)/i.test(l.cargo)) score += 20;
  // Segmento AEC: construtoras/incorporadoras costumam ter maior ticket
  const seg = { construtora: 15, incorporadora: 15, infraestrutura: 15, gerenciadora: 10, engenharia: 10, arquitetura: 10 };
  score += seg[l.segmento] || 0;
  // Maturidade BIM: quem já está em movimento converte mais rápido
  const mat = { iniciando: 15, parcial: 15, consolidado: 10, 'nao-usa': 5 };
  score += mat[l.maturidadeBim] || 0;
  const porte = { '1-10': 3, '11-50': 8, '51-200': 12, '200+': 15 };
  score += porte[l.porte] || 0;
  if (l.prazo === 'imediato') score += 10;
  else if (l.prazo === '3-meses') score += 5;
  return Math.min(score, 100);
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1); // necessário atrás do proxy do provedor (IP real no rate limit)
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit simples para o formulário público (por IP)
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 5) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em instantes.' });
  arr.push(now);
  hits.set(req.ip, arr);
  next();
}

function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token') || '';
  const a = Buffer.from(token);
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}

const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cleanList = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => SOFTWARES.includes(x));

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
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
}

// Opções exibidas no formulário e no painel
app.get('/api/opcoes', (req, res) => res.json({ segmentos: SEGMENTOS, maturidadeBim: MATURIDADE_BIM, softwares: SOFTWARES }));

// Captura de lead (público)
app.post('/api/leads', rateLimit, (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot anti-spam

  const lead = buildLead(b, 'site');

  if (!lead.nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    return res.status(400).json({ error: 'Informe nome e um e-mail válido.' });
  }
  if (!lead.consentimento) {
    return res.status(400).json({ error: 'É necessário aceitar a política de privacidade (LGPD).' });
  }
  // Somente empresas de Arquitetura, Engenharia ou Construção que usam ou querem usar BIM
  if (!lead.empresa) {
    return res.status(400).json({ error: 'Informe o nome da empresa.' });
  }
  if (!lead.segmento) {
    return res.status(400).json({ error: 'Selecione o segmento da sua empresa (arquitetura, engenharia ou construção).' });
  }
  if (!lead.maturidadeBim) {
    return res.status(400).json({ error: 'Informe o nível de uso de BIM na sua empresa.' });
  }
  lead.score = scoreLead(lead);

  const leads = loadLeads();
  if (leads.some((l) => l.email === lead.email)) {
    return res.json({ ok: true, duplicado: true });
  }
  leads.push(lead);
  saveLeads(leads);
  res.status(201).json({ ok: true });
});

// Login do painel (só valida a senha)
app.post('/api/login', requireAdmin, (req, res) => res.json({ ok: true }));

// Listar leads
app.get('/api/leads', requireAdmin, (req, res) => {
  res.json({ stages: STAGES, leads: loadLeads() });
});

// Criar lead manualmente pelo painel
app.post('/api/admin/leads', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!clean(b.nome)) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const lead = buildLead(b, 'manual');
  lead.consentimento = true;
  lead.etapa = STAGES.includes(b.etapa) ? b.etapa : 'novo';
  lead.valor = Number(b.valor) || 0;
  lead.score = scoreLead(lead);
  const leads = loadLeads();
  leads.push(lead);
  saveLeads(leads);
  res.status(201).json(lead);
});

// Atualizar lead (etapa, valor, dados, adicionar nota)
app.patch('/api/leads/:id', requireAdmin, (req, res) => {
  const leads = loadLeads();
  const lead = leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  const b = req.body || {};

  if (b.etapa !== undefined) {
    if (!STAGES.includes(b.etapa)) return res.status(400).json({ error: 'Etapa inválida' });
    if (b.etapa !== lead.etapa) {
      lead.notas.push({ texto: `Etapa: ${lead.etapa} → ${b.etapa}`, data: new Date().toISOString(), sistema: true });
    }
    lead.etapa = b.etapa;
  }
  if (b.valor !== undefined) lead.valor = Math.max(0, Number(b.valor) || 0);
  for (const f of ['nome', 'email', 'telefone', 'empresa', 'cargo', 'cidade', 'interesse', 'proximoContato']) {
    if (b[f] !== undefined) lead[f] = clean(b[f], 160);
  }
  if (b.segmento !== undefined && SEGMENTOS[b.segmento]) lead.segmento = b.segmento;
  if (b.maturidadeBim !== undefined && MATURIDADE_BIM[b.maturidadeBim]) lead.maturidadeBim = b.maturidadeBim;
  if (b.nota) lead.notas.push({ texto: clean(b.nota, 2000), data: new Date().toISOString() });

  lead.score = scoreLead(lead);
  lead.atualizadoEm = new Date().toISOString();
  saveLeads(leads);
  res.json(lead);
});

// Excluir lead (atende pedido de exclusão – LGPD)
app.delete('/api/leads/:id', requireAdmin, (req, res) => {
  const leads = loadLeads();
  const idx = leads.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Lead não encontrado' });
  leads.splice(idx, 1);
  saveLeads(leads);
  res.json({ ok: true });
});

// Exportar CSV (abre direto no Excel)
app.get('/api/leads.csv', requireAdmin, (req, res) => {
  const cols = ['nome', 'email', 'telefone', 'empresa', 'cargo', 'cidade', 'segmento', 'maturidadeBim', 'softwares', 'porte', 'interesse', 'prazo', 'etapa', 'valor', 'score', 'origem', 'criadoEm'];
  const esc = (v) => `"${String(Array.isArray(v) ? v.join(', ') : v ?? '').replace(/"/g, '""')}"`;
  const label = (c, v) => (c === 'segmento' ? SEGMENTOS[v] : c === 'maturidadeBim' ? MATURIDADE_BIM[v] : v);
  const rows = loadLeads().map((l) => cols.map((c) => esc(label(c, l[c]))).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads-spbim.csv"');
  res.send('﻿' + [cols.join(';'), ...rows].join('\n'));
});

app.get('/healthz', (req, res) => res.send('ok'));

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10)) {
  console.error('ADMIN_PASSWORD obrigatória em produção (mínimo 10 caracteres).');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Site:   http://localhost:${PORT}`);
  console.log(`Painel: http://localhost:${PORT}/admin.html`);
  if (ADMIN_PASSWORD === 'admin123') console.warn('⚠  Defina ADMIN_PASSWORD antes de publicar!');
});
