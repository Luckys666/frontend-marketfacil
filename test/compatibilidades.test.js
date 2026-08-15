'use strict';
/*
 * Card "Veículos compatíveis" (autopeças) — 13/08/2026.
 *
 * Contexto: hoje o app mostra a tag `incomplete_compatibilities` como string crua em
 * inglês, cinza, no meio das tags neutras — enquanto dois anúncios da conta medida (um
 * com 419 vendas) estão fora do ar há quase dois meses por causa dela. Este card lê o
 * veredito pronto de `GET /api/compatibilidades` (Task 2/4/5 do proxy) e só desenha.
 *
 * O que estes testes protegem:
 *  - a tela NUNCA escreve jargão: nada de incomplete_compatibilities, waiting_for_patch,
 *    under_review, WITHOUT_COMPATS ou "compatibilities" na cara do vendedor.
 *  - o botão de universal só existe quando o proxy disse que pode (`remedios[].pode`).
 *    Quem decide é lá — o front nunca inventa quando pode ou não.
 *  - falha de leitura NUNCA vira "está tudo certo" (feedback_falha_nunca_vira_zero).
 *  - `situacao: em_risco` nunca diz "fora do ar" — são coisas diferentes.
 *  - gravar com sucesso NUNCA diz "resolvido"/"reativado": a ML reprocessa quando quiser.
 *  - `placar_conta` não existe no veredito hoje: sem o campo, sem placar inventado.
 *  - `afeta_familia.itens` vem `null` na Fase 1: sem aviso de família, e sem número vago
 *    tipo "1 anúncio" no lugar.
 *  - sem NENHUM remédio disponível (`pode: true`), o card mostra só o texto do próprio ML
 *    — nunca um botão morto nem um link chutado (o remédio `gerenciador_ml` ainda não
 *    existe no veredito).
 *  - erro de categoria (`categoria_nao_aceita`) tem frase própria e o botão não continua
 *    sugerindo "tentar de novo" depois dele — tentar de novo dá o mesmo erro sempre.
 *
 * Rodar: node test/compatibilidades.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

// Veredito medido em produção em 13/08/2026 (MLB3869799637, terminais rotulares) — a
// fonte da verdade real: universal disponível, copiar não (sem candidatos), família com
// tamanho ainda não medido (`itens: null`), sem placar (o campo nem existe ainda).
const VEREDITO_REAL = {
  exige: true, situacao: 'fora_do_ar', certeza: 'moderacao', desde: '2026-06-18',
  ja_preenchido: { total: 0, do_vendedor: 0, do_catalogo: 0 },
  sugestoes_ml: { tem: false, quantas: null },
  remedios: [
    { id: 'universal', pode: true, porque: null },
    { id: 'copiar', pode: false, candidatos: null, porque: 'sem_candidatos' },
  ],
  afeta_familia: { user_product_id: 'MLBU1993802314', itens: null },
  texto_ml: {
    motivo: 'Não indica os veículos compatíveis.',
    como_resolver: 'Como reativar o anúncio?Acesse o módulo de Compatibilidade, selecione os veículos compatíveis com seu produto e salve a seleção. Se você não encontrar veículos compatíveis, também pode indicar essa informação.',
  },
};

/** Monta um ambiente com currentAnalysisState pronto e o fetch sob controle. */
function ambiente({ resposta = null } = {}) {
  const ctx = carregar();
  const { sandbox } = ctx;
  ctx.chamadas = [];
  sandbox.fetch = async (url, opts = {}) => {
    ctx.chamadas.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const r = resposta || { ok: true, status: 200, dados: { ok: true } };
    return { ok: r.ok, status: r.status, json: async () => r.dados };
  };
  sandbox.currentAnalysisState = {
    detail: { id: 'MLB3869799637' }, accessToken: 'TOKEN', containerIdSuffix: '',
  };
  return ctx;
}

// Fixtures no molde do que foi medido em produção (114 marcas por popularidade, 54
// modelos da VW, 8 anos do T-Cross) — reduzidas, mas na MESMA ordem que a ML devolveu
// (Fiat, Chevrolet, Volkswagen primeiro). Ids numéricos de propósito: é como a ML manda,
// e o front precisa converter pra string antes de gravar.
const MARCAS = [
  { id: 25, nome: 'Fiat', popularidade: 1 },
  { id: 9, nome: 'Chevrolet', popularidade: 2 },
  { id: 45, nome: 'Volkswagen', popularidade: 3 },
];
const MODELOS_VW = [
  { id: 501, nome: 'Gol', popularidade: 1 },
  { id: 502, nome: 'T-Cross', popularidade: 2 },
];
const ANOS_TCROSS = [
  { id: 2023, nome: '2023' },
  { id: 2022, nome: '2022' },
];

/** Ambiente pra escada de veículos: fetch roteado por `nivel=` na querystring. */
function ambienteVeiculos({ marcas = [], modelos = [], anos = [], erroEm = null, respostaGravar = null, alcance = undefined, alcanceTrava = false } = {}) {
  const ctx = carregar();
  const { sandbox } = ctx;
  ctx.chamadas = [];
  sandbox.fetch = async (url, opts = {}) => {
    const u = String(url);
    ctx.chamadas.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const semQuery = u.split('?')[0];
    if (opts.method === 'POST' && /\/compatibilidades\/veiculos$/.test(semQuery)) {
      const r = respostaGravar || { ok: true, status: 200, dados: { ok: true } };
      return { ok: r.ok, status: r.status, json: async () => r.dados };
    }
    // Escopo da escrita (quais anúncios o user-product atinge). `alcanceTrava` deixa a
    // promessa pendurada de propósito, pra testar o estado "ainda conferindo".
    if (/\/compatibilidades\/alcance$/.test(semQuery)) {
      if (alcanceTrava) return new Promise(() => {});
      const r = alcance || { ok: true, status: 200, dados: { itens: [{ id: 'MLB3869799637', title: 'Terminal Rotular' }], total: 1 } };
      return { ok: r.ok, status: r.status, json: async () => r.dados };
    }
    const qs = u.split('?')[1] || '';
    const params = {};
    qs.split('&').filter(Boolean).forEach((p) => { const [k, v] = p.split('='); params[k] = decodeURIComponent(v || ''); });
    if (erroEm && erroEm === params.nivel) {
      return { ok: false, status: 400, json: async () => ({ code: 'nao_deu_pra_consultar' }) };
    }
    const porNivel = { marca: marcas, modelo: modelos, ano: anos };
    return { ok: true, status: 200, json: async () => ({ nivel: params.nivel, opcoes: porNivel[params.nivel] || [], de_cache: false }) };
  };
  sandbox.currentAnalysisState = { detail: { id: 'MLB3869799637' }, accessToken: 'TOKEN', containerIdSuffix: '' };
  return ctx;
}

async function main() {
  console.log('compatibilidades.test.js');

  console.log('\n== veredito real de produção (fora do ar, certeza de moderação) ==');
  {
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(VEREDITO_REAL, 'compat');
    const html = reg['compat'].innerHTML;
    check('diz que está fora do ar, em português', /fora do ar/i.test(html), html.slice(0, 200));
    check('mostra o motivo com as palavras da ML', html.includes('Não indica os veículos compatíveis.'), html.slice(0, 300));
    check('mostra o "como resolver" da ML', html.includes('Acesse o módulo de Compatibilidade'), html.slice(0, 600));
    check('sem jargão na tela',
      !/incomplete_compatibilities|waiting_for_patch|under_review|WITHOUT_COMPATS|compatibilities/i.test(html), html.slice(0, 300));
    check('oferece o botão de universal (proxy disse que pode)', /mfCompatUniversal/.test(html), html.slice(0, 400));
    check('NÃO oferece copiar (proxy disse que não pode)', !/mfCompatAbrirCandidatos/.test(html), html.slice(0, 400));
    check('sem placar_conta no veredito → sem placar desenhado',
      !/resolvidos|Nenhum anúncio parado/i.test(html), html.slice(0, 300));
    check('itens: null → sem aviso de família', !/deste grupo|vale para/i.test(html), html.slice(0, 500));
    check('e sem número vago tipo "1 anúncio" no lugar', !/\b1 an[úu]ncio\b/i.test(html), html.slice(0, 500));
  }

  console.log('\n== família com tamanho medido (itens > 1) ==');
  {
    const comFamilia = JSON.parse(JSON.stringify(VEREDITO_REAL));
    comFamilia.remedios[1] = { id: 'copiar', pode: true, candidatos: 12 };
    comFamilia.afeta_familia = { user_product_id: 'MLBU1993802314', itens: 3 };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(comFamilia, 'compat');
    const html = reg['compat'].innerHTML;
    check('avisa que vale pra família inteira', /3 an[úu]ncios/i.test(html), html.slice(0, 500));
    check('e também oferece copiar, agora que o proxy disse que pode', /mfCompatAbrirCandidatos/.test(html), html.slice(0, 500));
  }

  console.log('\n== já tem lista própria: universal some, mostra o que já foi preenchido ==');
  {
    const semUniversal = JSON.parse(JSON.stringify(VEREDITO_REAL));
    semUniversal.remedios[0] = { id: 'universal', pode: false, porque: 'ja_tem_lista' };
    semUniversal.ja_preenchido = { total: 40, do_vendedor: 40, do_catalogo: 0 };
    semUniversal.situacao = 'ok';
    semUniversal.certeza = 'tag';
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(semUniversal, 'compat');
    const html = reg['compat'].innerHTML;
    check('proxy disse que não pode → botão de universal não existe', !/mfCompatUniversal/.test(html), html.slice(0, 300));
    check('e mostra quantos veículos já tem', /40/.test(html), html.slice(0, 300));
  }

  console.log('\n== nenhum remédio automático disponível: sobra a escada manual, nada de link chutado ==');
  {
    // 14/08: antes deste veredito o card ficava só com o texto do ML e nenhuma ação. Agora
    // "Escolher os veículos" fecha esse buraco — é o remédio manual, sempre disponível.
    const semRemedio = JSON.parse(JSON.stringify(VEREDITO_REAL));
    semRemedio.remedios = [
      { id: 'universal', pode: false, porque: 'ja_tem_lista' },
      { id: 'copiar', pode: false, porque: 'sem_candidatos' },
    ];
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(semRemedio, 'compat');
    const html = reg['compat'].innerHTML;
    check('sem botão de universal', !/mfCompatUniversal/.test(html), html.slice(0, 400));
    check('sem botão de copiar', !/mfCompatAbrirCandidatos/.test(html), html.slice(0, 400));
    check('sem nenhum link (gerenciador_ml não existe no veredito ainda)', !/<a\s/i.test(html), html.slice(0, 400));
    check('mas oferece "Escolher os veículos"', /mfCompatAbrirEscada/.test(html), html.slice(0, 600));
    check('e o texto do próprio ML continua lá também',
      html.includes('Acesse o módulo de Compatibilidade'), html.slice(0, 600));
  }

  console.log('\n== veredito null: falha de leitura não vira "tudo certo" ==');
  {
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(null, 'compat');
    const html = reg['compat'].innerHTML;
    check('não afirma que está tudo certo', !/tudo certo|nenhum|sem problema/i.test(html), html.slice(0, 200));
    check('e oferece tentar de novo', /tentar de novo/i.test(html), html.slice(0, 200));
  }

  console.log('\n== não exige compatibilidade: card nem aparece ==');
  {
    const { get, reg } = carregar();
    get('exibirCompatibilidades')({ exige: false }, 'compat');
    const html = reg['compat'].innerHTML;
    check('card vazio quando não exige', html === '', html);
  }

  console.log('\n== em risco não é fora do ar ==');
  {
    const emRisco = { ...VEREDITO_REAL, situacao: 'em_risco', certeza: 'tag', desde: null,
      texto_ml: { motivo: null, como_resolver: null } };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(emRisco, 'compat');
    const html = reg['compat'].innerHTML;
    check('em risco não diz que está fora do ar', !/fora do ar/i.test(html), html.slice(0, 200));
    check('e diz que pode sair do ar (é risco, não fato consumado)', /pode sair do ar/i.test(html), html.slice(0, 300));
  }

  console.log('\n== estado "ok": veredito diz quantos veículos, sem inventar frase de alerta ==');
  {
    const ok = { ...VEREDITO_REAL, situacao: 'ok', certeza: 'tag', desde: null,
      ja_preenchido: { total: 55, do_vendedor: 55, do_catalogo: 0 },
      remedios: [{ id: 'universal', pode: false, porque: 'ja_tem_lista' }, { id: 'copiar', pode: false, porque: 'sem_candidatos' }] };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(ok, 'compat');
    const html = reg['compat'].innerHTML;
    check('mostra quantos veículos foram indicados', /55 ve[íi]culos indicados/i.test(html), html.slice(0, 300));
  }

  // Medido na conta real em 15/08/2026: MLB3869799637 já tem 2 veículos gravados
  // (`ja_preenchido.do_vendedor: 2`, lido pelo próprio /items/{id}/compatibilities) e a
  // moderação da ML SEGUE de pé. A tela mandava "indicar em quais veículos a peça serve",
  // como se nada tivesse sido feito — pede de novo o que o vendedor já fez e esconde a
  // única informação que muda a decisão dele: quem está devendo agora é a ML.
  console.log('\n== fora do ar, mas com veículos já indicados ==');
  {
    const parcial = JSON.parse(JSON.stringify(VEREDITO_REAL));
    parcial.ja_preenchido = { total: 2, do_vendedor: 2, do_catalogo: 0 };
    parcial.remedios[0] = { id: 'universal', pode: false, porque: 'ja_tem_lista' };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(parcial, 'compat');
    const html = reg['compat'].innerHTML;
    check('diz quantos veículos já foram indicados', /2 ve[íi]culos/i.test(html), html.slice(0, 400));
    check('não manda indicar o que já foi indicado', !/at[ée] você indicar em quais ve[íi]culos/i.test(html), html.slice(0, 400));
    check('continua dizendo que o anúncio está fora do ar', /FORA DO AR/i.test(html), html.slice(0, 400));
    check('o botão convida a somar, não a começar do zero', /Adicionar mais ve[íi]culos/i.test(html), html.slice(0, 400));
  }

  // Medido em 15/08/2026, e a doc de moderações confirma ("pode ser reativada realizando
  // alterações NELA"): gravar a compatibilidade no user-product NÃO reativa. O anúncio
  // ficou 20h parado com a lista pronta; voltou no segundo em que o item mudou (+1 no
  // estoque). Sem essa frase o vendedor grava, não acontece nada e acha que quebrou.
  console.log('\n== fora do ar com lista pronta: diz que falta mexer no anúncio ==');
  {
    const parcial = JSON.parse(JSON.stringify(VEREDITO_REAL));
    parcial.ja_preenchido = { total: 2, do_vendedor: 2, do_catalogo: 0 };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(parcial, 'compat');
    const html = reg['compat'].innerHTML;
    check('conta o segundo passo', /altera[çc][ãa]o no an[úu]ncio/i.test(html), html.slice(0, 500));
    check('dá um exemplo concreto de alteração', /estoque/i.test(html), html.slice(0, 500));
  }

  // Contagem no singular: "1 veículos" é o tipo de detalhe que faz a tela parecer robô.
  console.log('\n== fora do ar com 1 veículo só ==');
  {
    const um = JSON.parse(JSON.stringify(VEREDITO_REAL));
    um.ja_preenchido = { total: 1, do_vendedor: 1, do_catalogo: 0 };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(um, 'compat');
    const html = reg['compat'].innerHTML;
    check('escreve no singular', /1 ve[íi]culo[^s]/i.test(html), html.slice(0, 400));
  }

  // Lista vazia continua com a frase original — a correção acima não pode apagar o caso
  // que o card foi criado para resolver.
  console.log('\n== fora do ar sem nenhum veículo: frase original intacta ==');
  {
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(VEREDITO_REAL, 'compat');
    const html = reg['compat'].innerHTML;
    check('sem lista, o app ainda pede os veículos', /indicar em quais ve[íi]culos/i.test(html), html.slice(0, 400));
    check('e o botão é o de começar', /Escolher os ve[íi]culos/i.test(html), html.slice(0, 400));
  }

  console.log('\n== clicar em "Serve em qualquer veículo" ==');
  {
    const ctx = ambiente({ resposta: { ok: true, status: 200, dados: { ok: true, criadas: 1, afetou_familia: 1 } } });
    await ctx.get('mfCompatUniversal')();
    const c = ctx.chamadas[0];
    check('chama a rota de universal', c && /\/api\/compatibilidades\/universal$/.test(c.url), JSON.stringify(c && c.url));
    check('com POST', c && c.method === 'POST', JSON.stringify(c && c.method));
    check('mandando o item_id, corpo mínimo (o front não monta payload da ML)',
      c && c.body && c.body.item_id === 'MLB3869799637' && Object.keys(c.body).length === 1, JSON.stringify(c && c.body));

    const aviso = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('avisa que foi ENVIADO, não que o anúncio foi reativado',
      /enviado/i.test(aviso.textContent) && !/reativado|resolvido/i.test(aviso.textContent), aviso.textContent);
    // 15/08/2026: "leva um tempo" era falso — o ML não reprocessa sozinho. Ele espera o
    // anúncio mudar. A mensagem tem que mandar o vendedor para o segundo passo.
    check('manda o vendedor mexer no anúncio', /altera[çc][ãa]o no an[úu]ncio/i.test(aviso.textContent), aviso.textContent);
    check('com exemplo concreto', /estoque/i.test(aviso.textContent), aviso.textContent);
    check('usa a caixa de aviso (info), não a de erro (vermelha)', /mf-conteudo-info/.test(aviso.className), aviso.className);
    check('recarrega o veredito depois de gravar', ctx.chamadas.some((x) => /\/api\/compatibilidades\?item_id=/.test(x.url)), JSON.stringify(ctx.chamadas.map((x) => x.url)));
  }

  console.log('\n== erro comum (ja_tem_lista): mensagem certa, botão continua oferecendo tentar de novo ==');
  {
    const ctx = ambiente({ resposta: { ok: false, status: 400, dados: { code: 'ja_tem_lista' } } });
    await ctx.get('mfCompatUniversal')();
    const erro = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('mostra a frase certa pro código', /já tem veículos indicados/i.test(erro.textContent), erro.textContent);
    const btn = ctx.sandbox.document.getElementById('mf-compat-universal');
    check('erro comum: botão não é escondido — vale tentar de novo', btn.style.display !== 'none' && btn.disabled === false, `display=${btn.style.display} disabled=${btn.disabled}`);
  }

  console.log('\n== erro de categoria (categoria_nao_aceita): frase própria, sem sugerir nova tentativa ==');
  {
    const ctx = ambiente({ resposta: { ok: false, status: 400, dados: { code: 'categoria_nao_aceita' } } });
    await ctx.get('mfCompatUniversal')();
    const erro = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('diz que o ML não aceita "serve em qualquer veículo" nesta categoria',
      /não aceita.*serve em qualquer ve[íi]culo.*nesta categoria/i.test(erro.textContent), erro.textContent);
    check('sem jargão (WITHOUT_COMPATS, universal:true, etc.)',
      !/WITHOUT_COMPATS|universal:\s*true|categoria_nao_aceita/i.test(erro.textContent), erro.textContent);
    const btn = ctx.sandbox.document.getElementById('mf-compat-universal');
    check('o botão some — tentar de novo dá o mesmo erro sempre', btn.style.display === 'none', `display=${btn.style.display}`);
  }

  console.log('\n== falha de rede ao gravar não vira sucesso ==');
  {
    const ctx = ambiente();
    ctx.sandbox.fetch = async () => { throw new Error('offline'); };
    await ctx.get('mfCompatUniversal')();
    const erro = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('mostra erro de rede, não fica em silêncio', /n[ãa]o deu para enviar/i.test(erro.textContent), erro.textContent);
  }

  /* =========================================================================
     Escolher os veículos manualmente — escada marca → modelo → ano (14/08/2026)

     Fecha o fluxo: até aqui o card só diagnosticava. Cobre: carregando por nível, erro por
     nível (com Tentar de novo, nunca lista vazia silenciosa), lista vazia de verdade (sem
     confundir com erro), "modelo inteiro" sem escolher ano, remover item, botão de gravar
     desabilitado com a lista vazia, ids como STRING no POST, aviso de limite de 200 ANTES
     de tentar gravar, e sucesso que nunca diz "resolvido".
     ========================================================================= */
  console.log('\n== escada: abrir carrega as marcas, na ordem que a ML mandou ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    const abrir = ctx.get('mfCompatAbrirEscada')();
    // Antes da resposta chegar: MF_compatCarregarNivel já desenhou "carregando" — é
    // síncrono até o primeiro await do fetch mockado.
    const duranteCarregamento = ctx.sandbox.document.getElementById('mf-compat-escada').textContent;
    check('mostra "carregando" antes da resposta chegar', /carregando as marcas/i.test(duranteCarregamento), duranteCarregamento);
    await abrir;
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('painel abriu (display não é mais none)', ctx.sandbox.document.getElementById('mf-compat-escada').style.display === 'block');
    check('mostra as 3 marcas, na MESMA ordem que vieram (popularidade)',
      html.indexOf('Fiat') >= 0 && html.indexOf('Fiat') < html.indexOf('Chevrolet') && html.indexOf('Chevrolet') < html.indexOf('Volkswagen'),
      html);
    check('sem jargão técnico (brand_id, nivel=, etc.)', !/brand_id|model_id|nivel=/i.test(html), html);

    const chamouMarca = ctx.chamadas.filter((c) => /nivel=marca/.test(c.url)).length;
    ctx.get('mfCompatAbrirEscada')(); // fecha
    check('clicar de novo fecha o painel', ctx.sandbox.document.getElementById('mf-compat-escada').style.display === 'none');
  }

  // Guarda §7.4 do COMPAT-SPEC. Medido na conta real em 15/08/2026: o user-product
  // `MLBU1115911717` (Regulador de Pressão) sustenta DOIS anúncios — MLB3126128636 e
  // MLB3370980603. Gravar num deles mexe nos dois. Sem esta tela, o vendedor grava achando
  // que mexeu em um só. Não desvincula nada, mas é surpresa em anúncio que vende.
  console.log('\n== escada: mostra QUAIS anúncios a gravação vai atingir ==');
  {
    const ctx = ambienteVeiculos({
      marcas: MARCAS,
      alcance: { ok: true, status: 200, dados: { total: 2, itens: [
        { id: 'MLB3126128636', title: 'Regulador Pressão Compressor 1/4' },
        { id: 'MLB3370980603', title: 'Regulador Pressão Compressor Manômetro' },
      ] } },
    });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await new Promise((r) => setTimeout(r, 0));
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('perguntou o escopo ao proxy', ctx.chamadas.some((c) => /\/compatibilidades\/alcance\?/.test(c.url)), JSON.stringify(ctx.chamadas.map((c) => c.url)));
    check('avisa que são 2 anúncios', /2 an[úu]ncios/i.test(html), html.slice(0, 900));
    check('mostra o título de cada um', /Regulador Pressão Compressor 1\/4/.test(html) && /Manômetro/.test(html), html.slice(0, 900));
    check('sem jargão de user-product na tela', !/user.?product|MLBU/i.test(html), html.slice(0, 900));
  }

  console.log('\n== escada: um anúncio só não vira alarme falso ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await new Promise((r) => setTimeout(r, 0));
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('não inventa aviso de vários anúncios', !/an[úu]ncios/i.test(html), html.slice(0, 700));
  }

  // Enquanto o escopo não chegou, o vendedor não pode gravar às cegas — é a guarda inteira.
  console.log('\n== escada: gravar espera o escopo chegar ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS, alcanceTrava: true });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await ctx.get('mfCompatEscolherOpcao')('45');   // Volkswagen
    await ctx.get('mfCompatEscolherOpcao')('502');  // T-Cross
    ctx.get('mfCompatEscolherModeloInteiro')();     // agora existe seleção de verdade
    const box = ctx.sandbox.document.getElementById('mf-compat-escada');
    check('a seleção existe (senão o teste do botão seria vazio)', /Vai gravar \(1\)/.test(box.textContent), box.textContent.slice(0, 300));
    check('diz que está conferindo', /conferindo/i.test(box.textContent), box.textContent.slice(0, 400));
    check('gravar fica desabilitado enquanto confere',
      /id="mf-compat-gravar-veiculos"[^>]*disabled/.test(box.innerHTML), box.innerHTML.slice(-600));
  }

  // Falha de leitura NÃO trava o vendedor: ele consegue fazer o mesmo pelo Gerenciador da
  // ML. Vira double check, igual ao alerta de renomear variação — avisar > travar.
  console.log('\n== escada: se não deu para conferir o escopo, vira double check ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS, alcance: { ok: false, status: 500, dados: {} } });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await new Promise((r) => setTimeout(r, 0));
    await ctx.get('mfCompatEscolherOpcao')('45');
    await ctx.get('mfCompatEscolherOpcao')('502');
    ctx.get('mfCompatEscolherModeloInteiro')();
    const box = ctx.sandbox.document.getElementById('mf-compat-escada');
    check('conta que não deu para conferir', /n[ãa]o deu para conferir/i.test(box.textContent), box.textContent.slice(0, 500));
    check('não trava o vendedor',
      !/id="mf-compat-gravar-veiculos"[^>]*disabled/.test(box.innerHTML), box.innerHTML.slice(-600));
    check('mas o botão avisa que é sem conferir', /Gravar mesmo assim/.test(box.innerHTML), box.innerHTML.slice(-600));
  }

  console.log('\n== escada: título de anúncio não escapa HTML ==');
  {
    const ctx = ambienteVeiculos({
      marcas: MARCAS,
      alcance: { ok: true, status: 200, dados: { total: 2, itens: [
        { id: 'MLB1', title: '<img src=x onerror=alert(1)>' },
        { id: 'MLB2', title: 'Normal' },
      ] } },
    });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await new Promise((r) => setTimeout(r, 0));
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('escapa o título', !/<img src=x/i.test(html) && /&lt;img/i.test(html), html.slice(0, 700));
  }

  console.log('\n== escada: marca → modelo → ano, cada nível busca só quando chega nele ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    check('só buscou marca até aqui', !ctx.chamadas.some((c) => /nivel=modelo|nivel=ano/.test(c.url)), JSON.stringify(ctx.chamadas.map((c) => c.url)));

    await ctx.get('mfCompatEscolherOpcao')('45'); // Volkswagen
    let html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('pediu os modelos da Volkswagen (brand_id=45)', ctx.chamadas.some((c) => /nivel=modelo/.test(c.url) && /brand_id=45/.test(c.url)), JSON.stringify(ctx.chamadas.map((c) => c.url)));
    check('mostra a marca escolhida na trilha', /Volkswagen/.test(html), html.slice(0, 400));
    check('lista os modelos', /Gol/.test(html) && /T-Cross/.test(html), html.slice(0, 600));

    await ctx.get('mfCompatEscolherOpcao')('502'); // T-Cross
    html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('pediu os anos do T-Cross (brand_id=45&model_id=502)',
      ctx.chamadas.some((c) => /nivel=ano/.test(c.url) && /brand_id=45/.test(c.url) && /model_id=502/.test(c.url)),
      JSON.stringify(ctx.chamadas.map((c) => c.url)));
    check('trilha mostra marca e modelo', /Volkswagen/.test(html) && /T-Cross/.test(html), html.slice(0, 400));
    check('oferece "modelo inteiro" em destaque', /mfCompatEscolherModeloInteiro/.test(html), html.slice(0, 800));
    check('e explica que é o caminho mais rápido e comum', /mais rápido/i.test(html) && /mais comum/i.test(html), html.slice(0, 800));
    check('lista os anos também (opcional)', /2023/.test(html) && /2022/.test(html), html.slice(0, 800));
  }

  console.log('\n== escada: "modelo inteiro" entra na lista sem ano, e reinicia pra próxima família ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await ctx.get('mfCompatEscolherOpcao')('45');
    await ctx.get('mfCompatEscolherOpcao')('502');
    ctx.get('mfCompatEscolherModeloInteiro')();
    await new Promise((r) => setTimeout(r, 0));
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('entrou na lista como "todos os anos"', /Volkswagen T-Cross \(todos os anos\)/.test(html), html.slice(0, 600));
    check('reiniciou a escada (trilha vazia, marca de novo)', !/trocar/.test(html.slice(0, html.indexOf('Vai gravar'))) , html.slice(0, 400));
    check('não pediu marcas de novo — reaproveitou o cache', ctx.chamadas.filter((c) => /nivel=marca/.test(c.url)).length === 1, JSON.stringify(ctx.chamadas.map((c) => c.url)));
    check('o botão de gravar já habilitou', !/id="mf-compat-gravar-veiculos"[^>]*disabled/.test(html), html.slice(0, 900));
  }

  console.log('\n== escada: escolher um ano específico entra na lista com esse ano ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await ctx.get('mfCompatEscolherOpcao')('45');
    await ctx.get('mfCompatEscolherOpcao')('502');
    await ctx.get('mfCompatEscolherOpcao')('2023');
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('entrou na lista com o ano', /Volkswagen T-Cross 2023/.test(html), html.slice(0, 600));
    check('não ficou marcado como "todos os anos"', !/T-Cross 2023 \(todos os anos\)/.test(html), html.slice(0, 600));
  }

  console.log('\n== escada: remover item da lista ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await ctx.get('mfCompatEscolherOpcao')('45');
    await ctx.get('mfCompatEscolherOpcao')('502');
    ctx.get('mfCompatEscolherModeloInteiro')();
    await new Promise((r) => setTimeout(r, 0));
    ctx.get('mfCompatRemoverSelecao')(0);
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('a lista fica vazia de novo', /Nada escolhido ainda/.test(html), html.slice(0, 600));
    check('e o botão de gravar volta a ficar desabilitado', /id="mf-compat-gravar-veiculos"[^>]*disabled/.test(html), html.slice(0, 900));
  }

  console.log('\n== escada: erro num nível mostra a mensagem certa + Tentar de novo, nunca lista vazia silenciosa ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: MODELOS_VW, erroEm: 'modelo' });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await ctx.get('mfCompatEscolherOpcao')('45'); // dispara nivel=modelo, que falha
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('mostra a mensagem traduzida do código de erro', /n[ãa]o deu para consultar agora/i.test(html), html.slice(0, 600));
    check('não vira "nenhuma opção encontrada" (isso seria mentir sobre a causa)', !/nenhuma op[çc][ãa]o encontrada/i.test(html), html.slice(0, 600));
    check('oferece tentar de novo', /mfCompatTentarNivelDeNovo/.test(html), html.slice(0, 600));

    // Corrige o mock e tenta de novo — mesmo nível, mesmos parâmetros (brand_id=45).
    ctx.sandbox.fetch = async (url, opts = {}) => {
      ctx.chamadas.push({ url: String(url), method: opts.method || 'GET' });
      return { ok: true, status: 200, json: async () => ({ nivel: 'modelo', opcoes: MODELOS_VW, de_cache: false }) };
    };
    await ctx.get('mfCompatTentarNivelDeNovo')();
    const html2 = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('tentar de novo busca o MESMO nível (modelo) de novo', ctx.chamadas.some((c) => /nivel=modelo/.test(c.url) && /brand_id=45/.test(c.url)));
    check('e agora mostra os modelos', /Gol/.test(html2) && /T-Cross/.test(html2), html2.slice(0, 600));
  }

  console.log('\n== escada: lista vazia de verdade é diferente de erro ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: [] }); // marca sem nenhum modelo catalogado
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await ctx.get('mfCompatEscolherOpcao')('45');
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('diz que não tem opção, não que falhou', /nenhuma op[çc][ãa]o encontrada/i.test(html), html.slice(0, 400));
    check('não oferece "tentar de novo" pra uma lista vazia de verdade', !/mfCompatTentarNivelDeNovo/.test(html), html.slice(0, 400));
  }

  console.log('\n== escada: mais de 200 famílias avisa ANTES de tentar gravar ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    ctx.sandbox.currentAnalysisState.escadaCompat.marca = { id: 45, nome: 'Volkswagen' };
    ctx.sandbox.currentAnalysisState.escadaCompat.modelo = { id: 502, nome: 'T-Cross' };
    for (let i = 0; i < 201; i++) {
      ctx.sandbox.currentAnalysisState.escadaCompat.selecoes.push({ brand_id: 45, brand_nome: 'Volkswagen', model_id: 502, model_nome: 'T-Cross', year_id: 2000 + i, year_nome: String(2000 + i) });
    }
    ctx.get('MF_renderEscadaCompat')(ctx.sandbox.currentAnalysisState);
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('avisa do limite antes de qualquer tentativa de gravar', /m[áa]ximo por vez é 200/i.test(html), html.slice(-500));
    check('o botão de gravar fica desabilitado', /id="mf-compat-gravar-veiculos"[^>]*disabled/.test(html), html.slice(-500));

    const chamadasAntes = ctx.chamadas.length;
    await ctx.get('mfCompatGravarVeiculos')();
    check('chamar gravar mesmo assim não manda nada (defensivo)', ctx.chamadas.length === chamadasAntes, JSON.stringify(ctx.chamadas.slice(chamadasAntes)));
  }

  console.log('\n== escada: lista vazia não deixa gravar ==');
  {
    const ctx = ambienteVeiculos({ marcas: MARCAS });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    const html = ctx.sandbox.document.getElementById('mf-compat-escada').innerHTML;
    check('botão de gravar nasce desabilitado, lista vazia', /id="mf-compat-gravar-veiculos"[^>]*disabled/.test(html), html.slice(-500));
    const chamadasAntes = ctx.chamadas.length;
    await ctx.get('mfCompatGravarVeiculos')();
    check('chamar gravar com lista vazia não manda nada', ctx.chamadas.length === chamadasAntes, JSON.stringify(ctx.chamadas.slice(chamadasAntes)));
  }

  console.log('\n== escada: gravar manda os ids como STRING, nunca resolvido ==');
  {
    const ctx = ambienteVeiculos({
      marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS,
      respostaGravar: { ok: true, status: 200, dados: { ok: true, criadas: 2, afetou_familia: 1 } },
    });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await ctx.get('mfCompatEscolherOpcao')('45');
    await ctx.get('mfCompatEscolherOpcao')('502');
    ctx.get('mfCompatEscolherModeloInteiro')(); // família 1: Volkswagen T-Cross, todos os anos
    await new Promise((r) => setTimeout(r, 0));
    await ctx.get('mfCompatEscolherOpcao')('9'); // Chevrolet
    await ctx.get('mfCompatEscolherOpcao')('501'); // Gol (reaproveitando os modelos da VW no mock — só testando o ano)
    await ctx.get('mfCompatEscolherOpcao')('2022'); // família 2: com ano

    await ctx.get('mfCompatGravarVeiculos')();
    const grava = ctx.chamadas.find((c) => c.method === 'POST' && /\/compatibilidades\/veiculos$/.test(c.url));
    check('chama a rota de escrita', !!grava, JSON.stringify(ctx.chamadas.map((c) => c.url)));
    check('manda o item_id', grava && grava.body.item_id === 'MLB3869799637', JSON.stringify(grava && grava.body));
    check('manda as duas famílias', grava && Array.isArray(grava.body.familias) && grava.body.familias.length === 2, JSON.stringify(grava && grava.body));
    const f1 = grava && grava.body.familias[0];
    const f2 = grava && grava.body.familias[1];
    check('ids como STRING, não número', f1 && typeof f1.brand_id === 'string' && typeof f1.model_id === 'string', JSON.stringify(f1));
    check('família sem ano não manda year_id', f1 && !('year_id' in f1), JSON.stringify(f1));
    check('família com ano manda year_id como STRING também', f2 && typeof f2.year_id === 'string', JSON.stringify(f2));

    const aviso = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('avisa que foi ENVIADO, nunca "resolvido"', /enviado/i.test(aviso.textContent) && !/resolvido|reativado/i.test(aviso.textContent), aviso.textContent);
    check('recarrega o veredito depois', ctx.chamadas.some((c) => /\/api\/compatibilidades\?item_id=/.test(c.url)), JSON.stringify(ctx.chamadas.map((c) => c.url)));
  }

  console.log('\n== escada: erro ao gravar não vira sucesso, e a lista não se perde ==');
  {
    const ctx = ambienteVeiculos({
      marcas: MARCAS, modelos: MODELOS_VW, anos: ANOS_TCROSS,
      respostaGravar: { ok: false, status: 400, dados: { code: 'limite_de_familias' } },
    });
    ctx.get('exibirCompatibilidades')(VEREDITO_REAL, 'compatibilidades');
    await ctx.get('mfCompatAbrirEscada')();
    await ctx.get('mfCompatEscolherOpcao')('45');
    await ctx.get('mfCompatEscolherOpcao')('502');
    ctx.get('mfCompatEscolherModeloInteiro')();
    await new Promise((r) => setTimeout(r, 0));

    await ctx.get('mfCompatGravarVeiculos')();
    const erro = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('mostra a mensagem do código de erro', /m[áa]ximo por envio é 200/i.test(erro.textContent), erro.textContent);
    check('a seleção continua na lista — não se perde num erro', ctx.sandbox.currentAnalysisState.escadaCompat.selecoes.length === 1,
      JSON.stringify(ctx.sandbox.currentAnalysisState.escadaCompat.selecoes));
  }

  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
