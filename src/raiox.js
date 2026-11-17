// SPBIM — Raio-X BIM (motor para vários públicos)
//
// Cada público (arquitetura, construtoras) tem sua própria "ferramenta": perguntas, pontuação,
// níveis, recomendações, frentes de ajuda e produtos. O motor:
//   1. valida as respostas;
//   2. calcula a maturidade BIM (0–100), mostrada ao visitante com nível e recomendações;
//   3. calcula a temperatura do lead para a SPBIM (perfil + urgência + necessidade), que o visitante NÃO vê;
//   4. indica o produto SPBIM mais adequado e lista as frentes em que o visitante pediu ajuda.
// Toda a regra fica aqui no servidor: as páginas só mostram o resultado.

const PRAZO = { agora: 'Agora', '3-meses': 'Nos próximos 3 meses', '6-meses': 'Nos próximos 6 meses', pesquisando: 'Só pesquisando por enquanto' };
const URGENCIA = { agora: 30, '3-meses': 20, '6-meses': 10, pesquisando: 0 };

// =====================================================================
// Escritórios de arquitetura
// =====================================================================
const ARQUITETURA = {
  segmento: 'arquitetura',
  perguntas: {
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
    prazo: { titulo: 'Quando querem começar', opcoes: PRAZO },
    papel: { titulo: 'Quem respondeu', opcoes: { socio: 'Sócio(a) ou titular', coordenador: 'Coordenador(a) de projetos', arquiteto: 'Arquiteto(a) da equipe', autonomo: 'Profissional autônomo(a)' } },
  },
  pontos: {
    software: { cad: 0, sketchup: 5, 'revit-parcial': 12, 'revit-total': 20, archicad: 20 },
    documentacao: { manual: 0, parcial: 10, modelo: 20 },
    compatibilizacao: { nao: 0, '2d': 6, modelo: 20 },
    padroes: { nao: 0, parcial: 10, sim: 20 },
    retrabalho: { muito: 0, medio: 10, pouco: 20 },
  },
  niveis: [
    { ate: 25, codigo: 'pre-bim', nome: 'Pré-BIM', resumo: 'O escritório ainda projeta essencialmente em 2D. Há um ganho grande de produtividade e de qualidade esperando por vocês.' },
    { ate: 50, codigo: 'inicial', nome: 'BIM inicial', resumo: 'O BIM já começou, mas o software ainda é usado como uma prancheta digital. O ganho de verdade ainda não apareceu.' },
    { ate: 75, codigo: 'consolidacao', nome: 'BIM em consolidação', resumo: 'O escritório já trabalha em BIM, mas sem padrões e processos que façam o resultado ser igual em todos os projetos.' },
    { ate: 100, codigo: 'maduro', nome: 'BIM maduro', resumo: 'A base está sólida. O próximo nível é coordenação multidisciplinar, automação e uso do modelo para custos e obra.' },
  ],
  insights: {
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
  },
  semFraquezas: 'Sua base está sólida. O próximo passo é levar o modelo para a coordenação com complementares, automatizar tarefas repetitivas com plugins e usar os quantitativos para orçamento.',
  frentes: {
    treinamento: 'Turmas fechadas para a equipe ou cursos individuais, com exercícios baseados nos projetos do escritório.',
    implantacao: 'Template do escritório, bibliotecas de famílias, padrões de nomenclatura e um projeto piloto acompanhado.',
    modelagem: 'Modelagem BIM sob demanda para os momentos de pico, entregue no padrão do seu escritório.',
    compatibilizacao: 'Modelo federado com os complementares, detecção de interferências e relatórios para os projetistas.',
    detalhamento: 'Pranchas, detalhes e documentação executiva extraídos do modelo, prontos para obra e aprovação.',
    levantamento: 'Modelagem do imóvel existente (as-built) para reformas, retrofit e ampliações.',
    quantitativos: 'Tabelas de quantitativos de materiais e serviços extraídas do modelo para apoiar o orçamento.',
    automacao: 'Plugins e rotinas que automatizam tarefas repetitivas de modelagem e documentação.',
  },
  produto(r, p) {
    if (r.papel === 'autonomo') return { codigo: 'cursos', nome: 'Cursos SPBIM', descricao: 'Capacitação individual em Revit, ArchiCAD ou SketchUp, do básico ao avançado, no seu ritmo.' };
    if (p <= 50) return { codigo: 'implantacao', nome: 'Implantação BIM com capacitação da equipe', descricao: 'Diagnóstico, template e bibliotecas do escritório, treinamento da equipe e um projeto piloto acompanhado.' };
    if (p <= 75) return { codigo: 'padronizacao', nome: 'Padronização e consolidação BIM', descricao: 'Template único, bibliotecas, padrões de documentação e treinamento avançado para a equipe produzir igual.' };
    return { codigo: 'consultoria', nome: 'Consultoria BIM avançada', descricao: 'Coordenação multidisciplinar, automação com plugins e uso do modelo para quantitativos e custos.' };
  },
  perfil: (r) => ({ '1-3': 5, '4-10': 15, '11-30': 25, '30+': 30 }[r.equipe] || 0) + ({ socio: 30, coordenador: 20, arquiteto: 8, autonomo: 5 }[r.papel] || 0),
  software: (r) => ({ cad: 'AutoCAD', sketchup: 'SketchUp', 'revit-parcial': 'Revit', 'revit-total': 'Revit', archicad: 'ArchiCAD' }[r.software]),
  destaques: ['equipe', 'software', 'prazo'], // resumo curto no aviso do Telegram
};

// =====================================================================
// Construtoras
// =====================================================================
const CONSTRUTORAS = {
  segmento: 'construtora',
  perguntas: {
    obras: { titulo: 'Obras simultâneas', opcoes: { '1-2': '1 a 2 obras', '3-5': '3 a 5 obras', '6-15': '6 a 15 obras', '15+': 'Mais de 15 obras' } },
    tipologia: { titulo: 'Principal tipo de obra', opcoes: {
      vertical: 'Residencial vertical (edifícios)', horizontal: 'Residencial horizontal e condomínios', comercial: 'Comercial e corporativo',
      industrial: 'Industrial e galpões', publica: 'Obras públicas e infraestrutura' } },
    projetos: { titulo: 'Como recebem os projetos', opcoes: { '2d': 'Em 2D (PDF ou DWG)', misto: 'Parte em BIM, parte em 2D', bim: 'Modelos BIM de todas as disciplinas' } },
    compatibilizacao: { titulo: 'Onde os conflitos entre projetos aparecem', opcoes: { obra: 'Na obra, durante a execução', '2d': 'Antes da obra, sobrepondo plantas em 2D', modelo: 'Antes da obra, em modelo federado (3D)' } },
    quantitativos: { titulo: 'Levantamento de quantitativos', opcoes: { manual: 'Manual, em planilhas a partir do 2D', parcial: 'Parte extraída de modelos, parte manual', modelo: 'Extraídos do modelo BIM' } },
    planejamento: { titulo: 'Planejamento da obra', opcoes: { planilha: 'Cronograma em planilha', software: 'Software de planejamento, sem ligação com o modelo', '4d': 'Planejamento 4D ligado ao modelo' } },
    retrabalho: { titulo: 'Retrabalho e aditivos por erro de projeto', opcoes: { frequente: 'Frequentes, em quase toda obra', 'as-vezes': 'Acontecem às vezes', raro: 'Raros' } },
    necessidades: { titulo: 'Frentes em que precisam de ajuda', multipla: true, opcoes: {
      compatibilizacao: 'Compatibilização de projetos antes da obra',
      modelagem: 'Modelagem BIM dos projetos recebidos em 2D',
      quantitativos: 'Quantitativos e apoio ao orçamento (5D)',
      planejamento: 'Planejamento 4D e simulação da obra',
      asbuilt: 'As-built e documentação de entrega da obra',
      implantacao: 'Implantação BIM na construtora e padrões para projetistas',
      treinamento: 'Treinamento das equipes de engenharia',
      publicas: 'Adequação ao BIM em obras públicas e licitações',
    } },
    prazo: { titulo: 'Próxima obra que poderia usar BIM', opcoes: { agora: 'Já em andamento ou começando agora', '3-meses': 'Começa nos próximos 3 meses', '6-meses': 'Começa nos próximos 6 meses', pesquisando: 'Sem data definida' } },
    papel: { titulo: 'Quem respondeu', opcoes: { diretor: 'Diretor(a) ou sócio(a)', gerente: 'Gerente de engenharia ou de projetos', planejamento: 'Orçamento ou planejamento', obra: 'Engenheiro(a) de obra' } },
  },
  pontos: {
    projetos: { '2d': 0, misto: 10, bim: 20 },
    compatibilizacao: { obra: 0, '2d': 6, modelo: 20 },
    quantitativos: { manual: 0, parcial: 10, modelo: 20 },
    planejamento: { planilha: 0, software: 8, '4d': 20 },
    retrabalho: { frequente: 0, 'as-vezes': 10, raro: 20 },
  },
  niveis: [
    { ate: 25, codigo: 'obra-2d', nome: 'Obra no 2D', resumo: 'A construtora ainda executa a partir de projetos em 2D, e os problemas costumam ser descobertos no canteiro. É onde o BIM traz o maior retorno.' },
    { ate: 50, codigo: 'pontual', nome: 'BIM pontual', resumo: 'O BIM aparece em algumas obras ou disciplinas, mas ainda não chega ao orçamento, ao planejamento e ao canteiro.' },
    { ate: 75, codigo: 'expansao', nome: 'BIM em expansão', resumo: 'O modelo já ajuda a evitar conflitos, mas ainda não é a base do orçamento e do planejamento de todas as obras.' },
    { ate: 100, codigo: 'digital', nome: 'Construção digital', resumo: 'A base está sólida. O próximo nível é integrar 4D, 5D e as-built em todas as obras e padronizar a entrega dos projetistas.' },
  ],
  insights: {
    projetos: {
      '2d': 'Receber projetos só em 2D obriga a equipe a cruzar pranchas manualmente, e é nesse cruzamento que nascem as incompatibilidades.',
      misto: 'Com parte dos projetos em BIM e parte em 2D, o cruzamento entre disciplinas continua incompleto, e os conflitos escapam.',
    },
    compatibilizacao: {
      obra: 'Conflitos descobertos na obra viram retrabalho, desperdício de material e atraso de cronograma, os custos mais caros da construção.',
      '2d': 'Sobrepor plantas em 2D não revela conflitos de altura e de trajeto entre estrutura e instalações. Eles aparecem só no canteiro.',
    },
    quantitativos: {
      manual: 'Quantitativos levantados à mão a partir do 2D são lentos e sujeitos a erro, e erro no quantitativo vira erro no orçamento e nas compras.',
      parcial: 'Com parte dos quantitativos ainda manual, o orçamento mistura bases diferentes e fica difícil confiar no número final.',
    },
    planejamento: {
      planilha: 'Um cronograma em planilha, desligado do projeto, não mostra conflitos de sequência e de logística antes de eles acontecerem no canteiro.',
      software: 'O cronograma existe, mas sem ligação com o modelo fica difícil visualizar a sequência da obra e comunicar o planejamento às equipes.',
    },
    retrabalho: {
      frequente: 'Retrabalho e aditivos frequentes por erro de projeto são o sintoma mais caro de projetos que não foram compatibilizados antes da obra.',
      'as-vezes': 'Mesmo ocasionais, retrabalhos e aditivos por erro de projeto corroem a margem de cada obra.',
    },
  },
  semFraquezas: 'Sua base está sólida. O próximo passo é integrar 4D, 5D e as-built em todas as obras e definir padrões BIM de entrega para os projetistas contratados.',
  frentes: {
    compatibilizacao: 'Modelo federado de todas as disciplinas, detecção de interferências e relatórios para os projetistas, antes de a obra começar.',
    modelagem: 'Modelagem BIM dos projetos recebidos em 2D, para que a construtora tenha um modelo confiável mesmo quando o projetista não entrega em BIM.',
    quantitativos: 'Quantitativos de materiais e serviços extraídos do modelo para orçamento, compras e medição.',
    planejamento: 'Cronograma ligado ao modelo (4D) para simular a sequência construtiva, a logística do canteiro e comunicar o plano às equipes.',
    asbuilt: 'Modelo e documentação do que foi realmente construído, para entrega, manutenção e manual do proprietário.',
    implantacao: 'Plano de Execução BIM (BEP), padrões de entrega para os projetistas contratados e processos internos da construtora.',
    treinamento: 'Capacitação das equipes de engenharia, orçamento e planejamento para trabalhar a partir do modelo.',
    publicas: 'Preparação para as exigências BIM de obras públicas e licitações, conforme a Estratégia BIM BR e o Decreto nº 10.306/2020.',
  },
  produto(r, p) {
    if (r.tipologia === 'publica' && p <= 75) return { codigo: 'publicas', nome: 'Preparação BIM para obras públicas', descricao: 'Modelagem, compatibilização e quantitativos no padrão exigido em licitações, com plano de execução BIM e capacitação da equipe.' };
    if (p <= 40) return { codigo: 'obra-piloto', nome: 'BIM na próxima obra: compatibilização e quantitativos', descricao: 'Começar por uma obra: modelagem dos projetos, compatibilização antes da execução e quantitativos para orçamento e compras.' };
    if (p <= 70) return { codigo: 'coordenacao', nome: 'Coordenação BIM das obras', descricao: 'Compatibilização contínua, quantitativos (5D) e planejamento 4D aplicados a todas as obras da construtora.' };
    return { codigo: 'gestao', nome: 'BIM na gestão da construção', descricao: '4D, 5D e as-built integrados, com padrões de entrega para os projetistas e processos para toda a construtora.' };
  },
  perfil: (r) => ({ '1-2': 5, '3-5': 15, '6-15': 25, '15+': 30 }[r.obras] || 0) + ({ diretor: 30, gerente: 22, planejamento: 15, obra: 8 }[r.papel] || 0),
  software: () => '',
  destaques: ['obras', 'tipologia', 'prazo'],
};

export const FERRAMENTAS = { arquitetura: ARQUITETURA, construtoras: CONSTRUTORAS };

// =====================================================================
// Motor
// =====================================================================
const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const getFerramenta = (id) => FERRAMENTAS[id] || null;

export function validarRespostas(f, r) {
  if (!r || typeof r !== 'object') return null;
  const ok = {};
  for (const [id, p] of Object.entries(f.perguntas)) {
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

export function calcularRaioX(f, r) {
  const pontuacao = Object.entries(f.pontos).reduce((s, [id, tabela]) => s + (tabela[r[id]] || 0), 0);
  const nivel = f.niveis.find((n) => pontuacao <= n.ate);

  // Até 3 recomendações, começando pelos pontos mais fracos
  const fracos = Object.keys(f.insights)
    .filter((id) => f.insights[id][r[id]])
    .sort((a, b) => (f.pontos[a][r[a]] || 0) - (f.pontos[b][r[b]] || 0));
  const insights = fracos.slice(0, 3).map((id) => f.insights[id][r[id]]);
  if (!insights.length) insights.push(f.semFraquezas);

  // Temperatura do lead (uso interno da SPBIM)
  const scoreLead = Math.min(100, f.perfil(r) + (URGENCIA[r.prazo] || 0) + Math.round((100 - pontuacao) / 10));
  const temperatura = scoreLead >= 65 ? 'quente' : scoreLead >= 40 ? 'morno' : 'frio';

  return {
    pontuacao,
    nivel: { codigo: nivel.codigo, nome: nivel.nome, resumo: nivel.resumo },
    insights,
    produto: f.produto(r, pontuacao),
    frentes: r.necessidades.map((id) => ({ codigo: id, nome: f.perguntas.necessidades.opcoes[id], como: f.frentes[id] })),
    interno: { scoreLead, temperatura },
    // Campos compatíveis com o cadastro de leads
    maturidadeBim: pontuacao <= 25 ? 'nao-usa' : pontuacao <= 50 ? 'iniciando' : pontuacao <= 75 ? 'parcial' : 'consolidado',
    software: f.software(r),
    prazo: r.prazo === 'agora' ? 'imediato' : r.prazo,
  };
}

// Texto legível das respostas (para o lead e o aviso no Telegram)
export function resumoRespostas(f, r) {
  return Object.entries(f.perguntas).map(([id, p]) =>
    `${p.titulo}: ${p.multipla ? r[id].map((v) => p.opcoes[v]).join('; ') : p.opcoes[r[id]]}`);
}
export const opcao = (f, r, id) => f.perguntas[id]?.opcoes[r[id]] || '';
