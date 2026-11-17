// SPBIM — Raio-X BIM para escritórios de arquitetura
//
// O visitante responde 10 perguntas. Este módulo:
//   1. valida as respostas;
//   2. calcula a maturidade BIM do escritório (0–100), mostrada ao visitante com nível e recomendações;
//   3. calcula a temperatura do lead para a SPBIM (perfil + urgência + necessidade), que o visitante NÃO vê;
//   4. indica o produto SPBIM mais adequado e lista as frentes em que o escritório pediu ajuda.
// Toda a regra fica aqui no servidor: a página só mostra o resultado.

export const PERGUNTAS = {
  equipe: { titulo: 'Pessoas que produzem projetos', opcoes: { '1-3': 'Até 3 pessoas', '4-10': '4 a 10 pessoas', '11-30': '11 a 30 pessoas', '30+': 'Mais de 30 pessoas' } },
  software: { titulo: 'Software principal', opcoes: { cad: 'AutoCAD / 2D', sketchup: 'SketchUp', 'revit-parcial': 'Revit em parte dos projetos', 'revit-total': 'Revit em todos os projetos', archicad: 'ArchiCAD' } },
  documentacao: { titulo: 'Pranchas e documentação', opcoes: { manual: 'Desenhadas à parte, em 2D', parcial: 'Parte sai do modelo, parte é desenhada', modelo: 'Tudo extraído do modelo' } },
  compatibilizacao: { titulo: 'Compatibilização com complementares', opcoes: { nao: 'Não fazemos de forma estruturada', '2d': 'Sobrepondo plantas em 2D', modelo: 'Em modelo federado (3D)' } },
  padroes: { titulo: 'Templates, bibliotecas e padrões', opcoes: { nao: 'Não temos', parcial: 'Temos alguns, sem padrão', sim: 'Sim, padronizados para a equipe' } },
  retrabalho: { titulo: 'Retrabalho a cada alteração', opcoes: { muito: 'Muito: refazemos vários desenhos', medio: 'Médio: algumas vistas e detalhes', pouco: 'Pouco: o modelo atualiza quase tudo' } },
  necessidades: { titulo: 'Frentes em que precisam de ajuda', multipla: true, opcoes: {
    treinamento: 'Treinamento da equipe (Revit, ArchiCAD, SketchUp)',
    implantacao: 'Implantação BIM: template, bibliotecas e padrões',
    modelagem: 'Modelagem BIM terceirizada (capacidade extra)',
    compatibilizacao: 'Compatibilização com complementares',
    detalhamento: 'Detalhamento executivo e documentação',
    levantamento: 'Levantamento e as-built de imóveis existentes',
    quantitativos: 'Quantitativos e apoio ao orçamento',
    automacao: 'Automação e plugins para ganhar produtividade',
  } },
  objetivo: { titulo: 'Principal objetivo agora', opcoes: { velocidade: 'Produzir projetos mais rápido', erros: 'Reduzir erros e retrabalho', exigencia: 'Atender clientes que exigem BIM', padronizar: 'Padronizar a equipe', quantitativos: 'Extrair quantitativos e custos' } },
  prazo: { titulo: 'Quando querem começar', opcoes: { agora: 'Agora', '3-meses': 'Nos próximos 3 meses', '6-meses': 'Nos próximos 6 meses', pesquisando: 'Só pesquisando por enquanto' } },
  papel: { titulo: 'Quem respondeu', opcoes: { socio: 'Sócio(a) ou titular', coordenador: 'Coordenador(a) de projetos', arquiteto: 'Arquiteto(a) da equipe', autonomo: 'Profissional autônomo(a)' } },
};

// Pontos de maturidade (soma máxima = 100)
const PONTOS = {
  software: { cad: 0, sketchup: 5, 'revit-parcial': 12, 'revit-total': 20, archicad: 20 },
  documentacao: { manual: 0, parcial: 10, modelo: 20 },
  compatibilizacao: { nao: 0, '2d': 6, modelo: 20 },
  padroes: { nao: 0, parcial: 10, sim: 20 },
  retrabalho: { muito: 0, medio: 10, pouco: 20 },
};

const NIVEIS = [
  { ate: 25, codigo: 'pre-bim', nome: 'Pré-BIM', resumo: 'O escritório ainda projeta essencialmente em 2D. Há um ganho grande de produtividade e de qualidade esperando por vocês.' },
  { ate: 50, codigo: 'inicial', nome: 'BIM inicial', resumo: 'O BIM já começou, mas o software ainda é usado como uma prancheta digital. O ganho de verdade ainda não apareceu.' },
  { ate: 75, codigo: 'consolidacao', nome: 'BIM em consolidação', resumo: 'O escritório já trabalha em BIM, mas sem padrões e processos que façam o resultado ser igual em todos os projetos.' },
  { ate: 100, codigo: 'maduro', nome: 'BIM maduro', resumo: 'A base está sólida. O próximo nível é coordenação multidisciplinar, automação e uso do modelo para custos e obra.' },
];

const INSIGHTS = {
  software: {
    cad: 'Projetar em 2D obriga a redesenhar plantas, cortes e fachadas a cada alteração. No BIM, todas essas vistas saem do mesmo modelo.',
    sketchup: 'O SketchUp é ótimo para estudar volumes, mas a documentação continua sendo desenhada à parte, e cada alteração vira retrabalho.',
    'revit-parcial': 'Usar o Revit em só parte dos projetos mantém dois fluxos de trabalho em paralelo, e o ganho de produtividade se dilui.',
  },
  documentacao: {
    manual: 'Pranchas montadas à parte do modelo são onde mais se perde tempo nas revisões. Extrair a documentação do modelo é o primeiro grande salto.',
    parcial: 'Parte da documentação ainda é desenhada fora do modelo, e é justamente ali que surgem as incoerências entre pranchas.',
  },
  compatibilizacao: {
    nao: 'Sem compatibilização estruturada, os conflitos com estrutura e instalações só aparecem na obra, quando corrigir custa mais caro.',
    '2d': 'Sobrepor plantas em 2D deixa passar conflitos de altura e de trajeto, que só um modelo federado em 3D revela.',
  },
  padroes: {
    nao: 'Sem templates e bibliotecas, cada arquiteto trabalha de um jeito, e a qualidade do projeto depende de quem desenhou.',
    parcial: 'Padrões parciais ajudam, mas sem um template único a equipe ainda gasta tempo configurando e corrigindo cada projeto.',
  },
  retrabalho: {
    muito: 'Retrabalho alto a cada alteração é o sintoma mais claro de um fluxo de projeto que ainda não está integrado.',
    medio: 'Ainda há retrabalho em vistas e detalhes, sinal de que nem tudo está conectado ao modelo.',
  },
};

const PRODUTOS = {
  cursos: { codigo: 'cursos', nome: 'Cursos SPBIM', descricao: 'Capacitação individual em Revit, ArchiCAD ou SketchUp, do básico ao avançado, no seu ritmo.' },
  implantacao: { codigo: 'implantacao', nome: 'Implantação BIM com capacitação da equipe', descricao: 'Diagnóstico, template e bibliotecas do escritório, treinamento da equipe e um projeto piloto acompanhado.' },
  padronizacao: { codigo: 'padronizacao', nome: 'Padronização e consolidação BIM', descricao: 'Template único, bibliotecas, padrões de documentação e treinamento avançado para a equipe produzir igual.' },
  consultoria: { codigo: 'consultoria', nome: 'Consultoria BIM avançada', descricao: 'Coordenação multidisciplinar, automação com plugins e uso do modelo para quantitativos e custos.' },
};

// Como a SPBIM atua em cada frente (mostrado no resultado do Raio-X)
const FRENTES = {
  treinamento: 'Turmas fechadas para a equipe ou cursos individuais, com exercícios baseados nos projetos do escritório.',
  implantacao: 'Template do escritório, bibliotecas de famílias, padrões de nomenclatura e um projeto piloto acompanhado.',
  modelagem: 'Modelagem BIM sob demanda para os momentos de pico, entregue no padrão do seu escritório.',
  compatibilizacao: 'Modelo federado com os complementares, detecção de interferências e relatórios para os projetistas.',
  detalhamento: 'Pranchas, detalhes e documentação executiva extraídos do modelo, prontos para obra e aprovação.',
  levantamento: 'Modelagem do imóvel existente (as-built) para reformas, retrofit e ampliações.',
  quantitativos: 'Tabelas de quantitativos de materiais e serviços extraídas do modelo para apoiar o orçamento.',
  automacao: 'Plugins e rotinas que automatizam tarefas repetitivas de modelagem e documentação.',
};

const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function validarRespostas(r) {
  if (!r || typeof r !== 'object') return null;
  const ok = {};
  for (const [id, p] of Object.entries(PERGUNTAS)) {
    if (p.multipla) {
      const lista = [...new Set((Array.isArray(r[id]) ? r[id] : []).map((v) => clean(v, 30)))].filter((v) => p.opcoes[v]);
      if (!lista.length) return null;
      ok[id] = lista;
      continue;
    }
    const v = clean(r[id], 30);
    if (!p.opcoes[v]) return null;
    ok[id] = v;
  }
  return ok;
}

export function calcularRaioX(r) {
  const pontuacao = Object.entries(PONTOS).reduce((s, [id, tabela]) => s + (tabela[r[id]] || 0), 0);
  const nivel = NIVEIS.find((n) => pontuacao <= n.ate);

  // Até 3 recomendações, começando pelos pontos mais fracos
  const fracos = Object.keys(INSIGHTS)
    .filter((id) => INSIGHTS[id][r[id]])
    .sort((a, b) => (PONTOS[a][r[a]] || 0) - (PONTOS[b][r[b]] || 0));
  const insights = fracos.slice(0, 3).map((id) => INSIGHTS[id][r[id]]);
  if (!insights.length) insights.push('Sua base está sólida. O próximo passo é levar o modelo para a coordenação com complementares, automatizar tarefas repetitivas com plugins e usar os quantitativos para orçamento.');

  const produto = r.papel === 'autonomo' ? PRODUTOS.cursos
    : pontuacao <= 50 ? PRODUTOS.implantacao
    : pontuacao <= 75 ? PRODUTOS.padronizacao
    : PRODUTOS.consultoria;

  // Temperatura do lead (uso interno da SPBIM)
  const perfil = ({ '1-3': 5, '4-10': 15, '11-30': 25, '30+': 30 }[r.equipe] || 0)
    + ({ socio: 30, coordenador: 20, arquiteto: 8, autonomo: 5 }[r.papel] || 0);
  const urgencia = { agora: 30, '3-meses': 20, '6-meses': 10, pesquisando: 0 }[r.prazo] || 0;
  const necessidade = Math.round((100 - pontuacao) / 10);
  const scoreLead = Math.min(100, perfil + urgencia + necessidade);
  const temperatura = scoreLead >= 65 ? 'quente' : scoreLead >= 40 ? 'morno' : 'frio';

  const frentes = r.necessidades.map((id) => ({ codigo: id, nome: PERGUNTAS.necessidades.opcoes[id], como: FRENTES[id] }));

  return {
    pontuacao,
    frentes,
    nivel: { codigo: nivel.codigo, nome: nivel.nome, resumo: nivel.resumo },
    insights,
    produto,
    interno: { scoreLead, temperatura },
    // Campos compatíveis com o cadastro de leads
    maturidadeBim: pontuacao <= 25 ? 'nao-usa' : pontuacao <= 50 ? 'iniciando' : pontuacao <= 75 ? 'parcial' : 'consolidado',
    software: { cad: 'AutoCAD', sketchup: 'SketchUp', 'revit-parcial': 'Revit', 'revit-total': 'Revit', archicad: 'ArchiCAD' }[r.software],
    prazo: r.prazo === 'agora' ? 'imediato' : r.prazo,
  };
}

// Texto legível das respostas (para o lead e o aviso no Telegram)
export function resumoRespostas(r) {
  return Object.entries(PERGUNTAS).map(([id, p]) =>
    `${p.titulo}: ${p.multipla ? r[id].map((v) => p.opcoes[v]).join('; ') : p.opcoes[r[id]]}`);
}
