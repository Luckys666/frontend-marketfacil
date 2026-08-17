'use strict';
/*
 * Conversão por canal e composição do tráfego: os dois lados da conta têm que sair do
 * MESMO período.
 *
 * O bug (11/08/2026, commit f0ec1b7): `fetchVisits` passou a pedir 60 dias — o card de
 * visitas precisa disso para comparar "30 dias" com os 30 anteriores. Só que o card de Ads
 * soma `visitsData.results` INTEIRO e subtrai os cliques do período escolhido no card
 * (7/15/30/60/90). Com 60 dias de visitas contra 30 de cliques, o que sobra como "orgânico"
 * carrega 30 dias que o Ads nem cobriu: orgânico dobrado, conversão orgânica pela metade.
 * No sentido oposto (90d de Ads contra 60 de visitas) os cliques passam as visitas, o
 * `Math.max(0, …)` zera a linha e a tela mostra "0 visitas orgânicas, 0,00%".
 *
 * A régua daqui em diante: a janela é a INTERSEÇÃO real dos dois lados, e o rótulo diz o
 * período que a conta realmente cobriu — anunciar "90 dias" com 60 de visitas é a mesma
 * mentira, só que escrita.
 *
 * Rodar: node test/janela-canais.test.js
 */
const { carregar } = require('./harness-analyzer');

const { dataLocal } = require('./data-local');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const diasAtras = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dataLocal(Math.round((new Date().setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86400000));
};

/*
 * Lê a tabela de canal por ESTRUTURA, não por "o número aparece em algum lugar".
 * Procurar '20.00%' solto no HTML passa com a conversão de Ads e deixa a do orgânico
 * quebrada — foi assim que a primeira versão deste teste se enganou sozinha.
 * Devolve { Ads: {visitas, vendas, conversao}, Orgânico: {...}, Total: {...} }.
 */
function linhasCanal(html) {
  const out = {};
  const blocos = String(html).split('class="ana-channel-row"').slice(1);
  for (const b of blocos) {
    // O pedaço começa no MEIO da tag de abertura (` style="…">`): sem cortar até o `>`,
    // o atributo style sobrevive ao strip de tags e vira a primeira "célula".
    const corpo = b.slice(b.indexOf('>') + 1);
    const celulas = corpo.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
    if (celulas.length < 4) continue;
    const [canal, visitas, vendas, conversao] = celulas;
    if (canal === 'Canal') continue; // cabeçalho
    out[canal] = { visitas, vendas, conversao };
  }
  return out;
}

// Visitas: 60 dias × 10 = 600 no total, 300 dentro dos últimos 30.
const visitas60 = { results: Array.from({ length: 60 }, (_, i) => ({ date: diasAtras(i + 1), total: 10 })) };

// Ads: 30 dias × (5 cliques, 1 venda ads, 1 venda orgânica).
const adsDaily = (dias) => Array.from({ length: dias }, (_, i) => ({
  date: diasAtras(i + 1), clicks: 5, prints: 50, cost: 10, total_amount: 200,
  units_quantity: 1, organic_units_quantity: 1, organic_units_amount: 150,
}));

console.log('janela-canais.test.js');

// ── 30 dias de Ads contra 60 de visitas ─────────────────────────────────
console.log('\n== a conta usa só os dias que os dois lados cobrem ==');
{
  const { get, reg, sandbox } = carregar();
  sandbox.currentAnalysisState = { visitsData: visitas60 };
  get('exibirAdsMetrics')({ has_ads: true, daily: adsDaily(30), ad_info: {} }, 'ads30', 30, visitas60);
  const html = reg['ads30'].innerHTML;
  const texto = reg['ads30'].textContent;
  const linhas = linhasCanal(html);

  // 30 dias × 10 = 300 visitas; 150 cliques; 150 orgânicas.
  check('Total: 300 visitas (não 600)', linhas['Total'] && linhas['Total'].visitas === '300', JSON.stringify(linhas['Total']));
  check('Orgânico: 150 visitas (não 450)', linhas['Orgânico'] && linhas['Orgânico'].visitas === '150', JSON.stringify(linhas['Orgânico']));
  // 30 vendas orgânicas ÷ 150 visitas orgânicas = 20,00%. Com os 60 dias inteiros dava 6,67%.
  check('Orgânico: conversão 20,00%', linhas['Orgânico'] && linhas['Orgânico'].conversao === '20,00%', JSON.stringify(linhas['Orgânico']));
  check('Ads: 150 visitas, 30 vendas, 20,00%',
    linhas['Ads'] && linhas['Ads'].visitas === '150' && linhas['Ads'].vendas === '30' && linhas['Ads'].conversao === '20,00%',
    JSON.stringify(linhas['Ads']));
  check('Total: conversão 20,00% (60 vendas / 300 visitas)',
    linhas['Total'] && linhas['Total'].conversao === '20,00%', JSON.stringify(linhas['Total']));
  check('o rótulo anuncia 30 dias', /Convers[ãa]o por canal \(últimos 30 dias\)/.test(texto), texto.slice(0, 200));
}

// ── 90 dias de Ads contra 60 de visitas: a interseção é 60 ──────────────
console.log('\n== período maior que o das visitas não zera o orgânico ==');
{
  const { get, reg, sandbox } = carregar();
  sandbox.currentAnalysisState = { visitsData: visitas60 };
  get('exibirAdsMetrics')({ has_ads: true, daily: adsDaily(90), ad_info: {} }, 'ads90', 90, visitas60);
  const html = reg['ads90'].innerHTML;
  const texto = reg['ads90'].textContent;
  const linhas = linhasCanal(html);

  // 60 dias × 10 = 600 visitas; 300 cliques; 300 orgânicas; 60 vendas orgânicas = 20%.
  check('Orgânico não virou zero', linhas['Orgânico'] && linhas['Orgânico'].visitas === '300', JSON.stringify(linhas['Orgânico']));
  check('Orgânico: conversão 20,00%', linhas['Orgânico'] && linhas['Orgânico'].conversao === '20,00%', JSON.stringify(linhas['Orgânico']));
  check('Total: 600 visitas (os 60 dias que existem dos dois lados)',
    linhas['Total'] && linhas['Total'].visitas === '600', JSON.stringify(linhas['Total']));
  check('o rótulo diz 60 dias, que é o que a conta cobriu', /\(últimos 60 dias\)/.test(texto), texto.slice(0, 200));
  check('não anuncia 90 dias', !/\(últimos 90 dias\)/.test(texto), texto.slice(0, 200));
}

// ── composição do tráfego sai da mesma conta ────────────────────────────
console.log('\n== a barra de composição concorda com a tabela ==');
{
  const { get, reg, sandbox } = carregar();
  sandbox.currentAnalysisState = { visitsData: visitas60 };
  get('exibirAdsMetrics')({ has_ads: true, daily: adsDaily(30), ad_info: {} }, 'adsComp', 30, visitas60);
  const html = reg['adsComp'].innerHTML;
  const resumo = (html.match(/[\d.]+ ads \/ [\d.]+ total/g) || []).join(' ');
  // 150 cliques em 300 visitas = 50% Ads / 50% orgânico.
  check('Ads 50,0% na barra', html.includes('Ads 50,0%'), (html.match(/Ads [\d.,]+%/g) || []).join(' '));
  check('Orgânico 50,0% na barra', html.includes('Orgânico 50,0%'), (html.match(/Orgânico [\d.,]+%/g) || []).join(' '));
  check('a barra soma 300, não os 600 dos 60 dias', resumo.includes('150 ads / 300 total'), resumo);
}

// ── sem interseção: não inventa número ──────────────────────────────────
console.log('\n== visitas e Ads sem dia em comum: some, não mente ==');
{
  const { get, reg, sandbox } = carregar();
  // Visitas só dos últimos 5 dias; Ads só de 40 a 50 dias atrás.
  const visitasCurtas = { results: Array.from({ length: 5 }, (_, i) => ({ date: diasAtras(i + 1), total: 10 })) };
  const adsAntigo = Array.from({ length: 10 }, (_, i) => ({
    date: diasAtras(i + 40), clicks: 5, prints: 50, cost: 10, total_amount: 200,
    units_quantity: 1, organic_units_quantity: 1,
  }));
  sandbox.currentAnalysisState = { visitsData: visitasCurtas };
  get('exibirAdsMetrics')({ has_ads: true, daily: adsAntigo, ad_info: {} }, 'adsVazio', 90, visitasCurtas);
  const texto = reg['adsVazio'].textContent;
  check('a tabela de canal não aparece', !texto.includes('Conversão por canal'), texto.slice(0, 200));
}

// ── oportunidades: "em 30d" tem que ser 30 dias ─────────────────────────
console.log('\n== card de oportunidades não conta 60 dias como 30 ==');
{
  const { get } = carregar();
  const opps = get('MF_buildOpportunities')(
    { id: 'MLB1', price: 100, sold_quantity: 40, available_quantity: 50, tags: [] },
    visitas60,                                            // 600 visitas em 60d, 300 em 30d
    { has_ads: true, daily: adsDaily(30), ad_info: {} },   // 30 ads + 30 orgânicas
    {}
  );
  const cvr = opps.find((o) => o.kind === 'cvr_upside');
  check('o card de conversão existe', !!cvr, opps.map((o) => o.kind).join(', '));
  if (cvr) {
    // 300 visitas × 0,1% × R$ 100 = R$ 30/mês. Com os 60 dias dava R$ 60 — dinheiro
    // prometido em dobro, que é o pior tipo de número errado.
    check('promete R$ 30,00/mês (não R$ 60,00)', /30,00/.test(cvr.title) && !/60,00/.test(cvr.title), cvr.title);
    check('o valor é 30', Math.round(cvr.value) === 30, String(cvr.value));
    check('diz "300 visitas em 30d"', cvr.detail.includes('300 visitas em 30d'), cvr.detail);
    // 60 vendas ÷ 300 visitas = 20%. Contra os 60 dias caía pra 10% e o card subia de
    // prioridade como se a conversão fosse ruim.
    check('conversão 20,00% (não 10,00%)', cvr.detail.includes('20,00%'), cvr.detail);
    check('prioridade não inflada por conversão falsa', cvr.priority === 3, String(cvr.priority));
  }

  const runway = opps.find((o) => o.kind === 'stock_runway');
  check('o card de estoque existe', !!runway, opps.map((o) => o.kind).join(', '));
  if (runway) {
    // O texto promete 15 × 15; a série de visitas tem que ser recortada em 30 dias pra
    // que a metade dela seja mesmo 15 dias, e não 30.
    check('compara 15d contra 15d, como o texto diz', runway.detail.includes('(últimos 15d vs 15 anteriores)'), runway.detail);
    check('vendas em 30d = 60', runway.detail.includes('60 unidades vendidas em 30d'), runway.detail);
  }
}

// ── o split de visitas do runway mede 15 × 15, não 30 × 30 ──────────────
console.log('\n== projeção de estoque compara as metades certas ==');
{
  const { get } = carregar();
  // Visitas em queda: 20/dia nos últimos 15 dias, 10/dia nos 45 anteriores.
  //   recorte de 30d → 300 recentes contra 150 antigos = ×2   → boost +50%
  //   série de 60d   → 450 recentes contra 300 antigos = ×1,5 → boost +25%
  const visitasEmAlta = {
    results: Array.from({ length: 60 }, (_, i) => ({ date: diasAtras(i + 1), total: i < 15 ? 20 : 10 })),
  };
  const opps = get('MF_buildOpportunities')(
    { id: 'MLB1', price: 100, sold_quantity: 40, available_quantity: 50, tags: [] },
    visitasEmAlta,
    { has_ads: true, daily: adsDaily(30), ad_info: {} },
    {}
  );
  const runway = opps.find((o) => o.kind === 'stock_runway');
  check('o card de estoque existe', !!runway, opps.map((o) => o.kind).join(', '));
  if (runway) {
    check('boost de +50% (15 × 15), não +25% (30 × 30)',
      runway.detail.includes('+50%') && !runway.detail.includes('+25%'), runway.detail);
  }
}

// ── checklist rápido: "em 30 dias" também tem que ser 30 ────────────────
console.log('\n== checklist do score conta 30 dias ==');
{
  const { get, reg } = carregar();
  const detail = { id: 'MLB1', title: 'Produto de teste com título grande o bastante', price: 100,
    sold_quantity: 40, available_quantity: 50, tags: [], attributes: [], pictures: [{ id: '1' }] };
  // Ads ativo e ZERO vendas: dispara a linha "N visitas / 0 vendas em 30 dias".
  const semVendas = { has_ads: true, ad_info: {}, daily: Array.from({ length: 30 }, (_, i) => ({
    date: diasAtras(i + 1), clicks: 5, prints: 50, cost: 10, total_amount: 0,
    units_quantity: 0, organic_units_quantity: 0 })) };
  get('exibirPontuacao')(70, false, 'sc1', { detail, visitsData: visitas60, adsData: semVendas }, 'chk1', null);
  const texto = reg['chk1'].textContent;
  check('diz 300 visitas, não 600', texto.includes('300 visitas / 0 vendas em 30 dias'), texto.slice(0, 300));
}
{
  const { get, reg } = carregar();
  const detail = { id: 'MLB2', title: 'Produto de teste com título grande o bastante', price: 100,
    sold_quantity: 40, available_quantity: 50, tags: [], attributes: [], pictures: [{ id: '1' }] };
  // Visitas só entre 31 e 60 dias atrás: nos últimos 30 não houve nenhuma.
  const visitasVelhas = { results: Array.from({ length: 30 }, (_, i) => ({ date: diasAtras(i + 31), total: 10 })) };
  get('exibirPontuacao')(70, false, 'sc2', { detail, visitsData: visitasVelhas, adsData: null }, 'chk2', null);
  const texto = reg['chk2'].textContent;
  check('acusa "Sem visitas nos últimos 30 dias"', texto.includes('Sem visitas nos últimos 30 dias'), texto.slice(0, 300));
}

// ── snapshot entre análises ─────────────────────────────────────────────
console.log('\n== o snapshot guarda 30 dias, não 60 ==');
{
  const { get } = carregar();
  const snap = get('MF_buildSnap')(
    { id: 'MLB1', tags: [], sold_quantity: 10, available_quantity: 5, price: 100 },
    visitas60,
    { has_ads: true, daily: adsDaily(30), ad_info: {} },
    80
  );
  check('visits30 = 300', snap.visits30 === 300, String(snap.visits30));
  check('sales30 = 60', snap.sales30 === 60, String(snap.sales30));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
