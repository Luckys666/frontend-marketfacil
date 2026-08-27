'use strict';
/*
 * Relato do Lucas em 26/08/2026: "a visão geral do período não está fazendo
 * sentido os números do meu ponto de vista".
 *
 * Estava. O card mostrava TRÊS populações de venda diferentes nas três colunas:
 *   - Conversão total: PEDIDOS do /orders/search, cancelados inclusive
 *   - Conversão orgânica: PEDIDOS totais − UNIDADES de Ads (grandezas diferentes)
 *   - Conversão Ads: avg_cvr do ML, que a reconciliação não recalculava
 * Nenhum desses numeradores aparecia na tela. Medido no dashboard em produção,
 * com 3.473 unidades / 2.492 pedidos / 23.348 visitas / 14.000 cliques:
 *   Total mostrava 10,67% (a conta com os números do card dá 14,87%)
 *   Orgânico mostrava 17,03% (a conta dá 27,52%) — e ficava MAIOR que o total.
 *
 * O que estes testes protegem:
 *  - as três conversões saem da MESMA base (unidades) e a média ponderada fecha
 *  - todo numerador exibido está na tela, ao lado, na linha "Vendas"
 *  - a régua por pedido do Seller Central continua disponível, mas separada
 *  - receita truncada (conta com muito volume) NUNCA vira número fechado
 *  - delta não compara janelas nem réguas diferentes
 *  - sem venda / sem dado é "—", nunca "0,00%" (falha não vira zero)
 *
 * Rodar: node test/visao-geral-do-periodo.test.js
 */
const { carregar, cenario, lerColuna } = require('./harness-dashboard');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}
// Lê o número COMO ELE APARECE na tela, inclusive o compacto ("2,6k" = 2600):
// o teste tem que enxergar o mesmo que o vendedor enxerga.
function num(txt) {
  const s = String(txt);
  const n = Number(s.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  if (/M\b/.test(s)) return n * 1e6;
  if (/k\b/.test(s)) return n * 1e3;
  return n;
}

// ── Cenário do relato: conta com volume, reconciliada pelos pedidos ──
const VISITAS = 23348;
const CLIQUES = 14000;
const UN_ADS = 900;
const UN_ORG = 2573;      // 3.473 unidades no total
const PEDIDOS_VALIDOS = 2400;
const PEDIDOS_BRUTOS = 2492;   // inclui 92 cancelados

const AGG_BASE = {
  total_cost: 2800, total_revenue: 28000, organic_revenue: 72000,
  total_clicks: CLIQUES, total_impressions: 1400000,
  total_orders: UN_ADS, organic_orders: UN_ORG,
  avg_ctr: 1, avg_cvr: 6.43, avg_tacos: 2.8, overall_roas: 10,
  organic_from_orders: true, revenue_complete: true
};
const VISITS_OK = { total_visits: VISITAS, accountWide: true, capped: false, incomplete: false };
const ORDERS_OK = {
  total_orders: PEDIDOS_BRUTOS,
  revenue: { amount: 100000, units: 3473, orders: PEDIDOS_VALIDOS, orders_cancelled: 92, complete: true }
};

console.log('\n— as três conversões fecham entre si —');
{
  const { T, STATE } = carregar();
  cenario(STATE, { agg: AGG_BASE, visits: VISITS_OK, orders: ORDERS_OK });
  const html = T.renderOrganicVsAds(STATE.data.aggregated);
  const total = lerColuna(html, 'mfd-vs-total');
  const org = lerColuna(html, 'mfd-vs-organic');
  const ads = lerColuna(html, 'mfd-vs-ads');

  const esperadoTotal = (UN_ADS + UN_ORG) / VISITAS * 100;      // 14,87%
  const esperadoOrg = UN_ORG / (VISITAS - CLIQUES) * 100;        // 27,52%
  const esperadoAds = UN_ADS / CLIQUES * 100;                    // 6,43%

  check('conversão total = vendas totais ÷ visitas totais',
    Math.abs(num(total['Conversão']) - esperadoTotal) < 0.01,
    `tela ${total['Conversão']} vs conta ${esperadoTotal.toFixed(2)}%`);
  check('conversão orgânica = vendas orgânicas ÷ visitas orgânicas',
    Math.abs(num(org['Conversão']) - esperadoOrg) < 0.01,
    `tela ${org['Conversão']} vs conta ${esperadoOrg.toFixed(2)}%`);
  check('conversão Ads = vendas Ads ÷ cliques (não o avg_cvr do ML)',
    Math.abs(num(ads['Conversão']) - esperadoAds) < 0.01,
    `tela ${ads['Conversão']} vs conta ${esperadoAds.toFixed(2)}%`);

  // O teste que o vendedor faz de cabeça: a média ponderada tem que fechar
  const ponderada = (num(org['Conversão']) * (VISITAS - CLIQUES) + num(ads['Conversão']) * CLIQUES) / VISITAS;
  check('média ponderada de orgânico e Ads bate com o total',
    Math.abs(ponderada - num(total['Conversão'])) < 0.02,
    `ponderada ${ponderada.toFixed(2)}% vs total ${total['Conversão']}`);

  check('total fica ENTRE a conversão de Ads e a orgânica (a parte nunca é maior que o todo do lado errado)',
    num(ads['Conversão']) <= num(total['Conversão']) && num(total['Conversão']) <= num(org['Conversão']),
    `ads ${ads['Conversão']} / total ${total['Conversão']} / org ${org['Conversão']}`);

  // Tolerância = o arredondamento do formato compacto (2.573 vira "2,6k")
  check('as vendas mostradas somam: orgânico + Ads = total',
    Math.abs(num(org['Vendas']) + num(ads['Vendas']) - num(total['Vendas'])) <= 100,
    `${org['Vendas']} + ${ads['Vendas']} vs ${total['Vendas']}`);
}

console.log('\n— a régua do Mercado Livre continua na tela, separada —');
{
  const { T, STATE } = carregar();
  cenario(STATE, { agg: AGG_BASE, visits: VISITS_OK, orders: ORDERS_OK });
  const html = T.renderOrganicVsAds(STATE.data.aggregated);
  const porPedido = (PEDIDOS_VALIDOS / VISITAS * 100).toFixed(2).replace('.', ',');
  check('mostra a conversão por pedido como sub-informação',
    html.includes(porPedido + '% por pedido'), porPedido);
  check('usa os pedidos SEM cancelados (revenue.orders), não o paging.total',
    !html.includes((PEDIDOS_BRUTOS / VISITAS * 100).toFixed(2).replace('.', ',') + '% por pedido'));

  // Proxy antigo (só total_orders): aceita como aproximação e AVISA no hint
  const { T: T2, STATE: S2 } = carregar();
  cenario(S2, { agg: AGG_BASE, visits: VISITS_OK, orders: { total_orders: PEDIDOS_BRUTOS } });
  const html2 = T2.renderOrganicVsAds(S2.data.aggregated);
  check('com proxy antigo, avisa que os cancelados estão dentro',
    html2.includes('contando pedidos cancelados junto'));
}

console.log('\n— receita truncada nunca vira número fechado —');
{
  const { T, STATE } = carregar();
  const aggParcial = Object.assign({}, AGG_BASE, { revenue_complete: false });
  cenario(STATE, { agg: aggParcial, visits: VISITS_OK, orders: ORDERS_OK });
  const html = T.renderOrganicVsAds(aggParcial);
  const total = lerColuna(html, 'mfd-vs-total');
  const org = lerColuna(html, 'mfd-vs-organic');
  check('card avisa que receita e vendas são um piso', html.includes('PISO'));
  check('receita do total sai com "+"', /\+$/.test(total['Receita']), total['Receita']);
  check('vendas do total saem com "+"', /\+$/.test(total['Vendas']), total['Vendas']);
  check('receita do orgânico sai com "+"', /\+$/.test(org['Receita']), org['Receita']);

  const { T: T2, STATE: S2 } = carregar();
  cenario(S2, { agg: AGG_BASE, visits: VISITS_OK, orders: ORDERS_OK });
  const htmlOk = T2.renderOrganicVsAds(AGG_BASE);
  check('sem truncamento, nada de "+" nem aviso',
    !htmlOk.includes('PISO') && !/\+$/.test(lerColuna(htmlOk, 'mfd-vs-total')['Receita']));
}

console.log('\n— o card diz sozinho a que período se refere —');
{
  for (const p of [7, 30, 60, 90]) {
    const { T, STATE } = carregar();
    cenario(STATE, { agg: AGG_BASE, visits: VISITS_OK, orders: ORDERS_OK, period: p });
    const html = T.renderOrganicVsAds(STATE.data.aggregated);
    check(`título nomeia a janela de ${p} dias`, html.includes(`últimos ${p} dias`));
  }
}

console.log('\n— falha e ausência de dado não viram zero —');
{
  // Conta sem nenhuma venda: o card já diz "sem vendas"; repetir 0,00% parece defeito
  const { T, STATE } = carregar();
  const vazio = { total_cost: 0, total_revenue: 0, organic_revenue: 0, total_clicks: 0,
    total_impressions: 0, total_orders: 0, organic_orders: 0, organic_only: true, revenue_complete: true };
  cenario(STATE, { agg: vazio, visits: { total_visits: 31, accountWide: true, capped: false, incomplete: false },
    orders: { total_orders: 0, revenue: { amount: 0, units: 0, orders: 0, complete: true } } });
  const html = T.renderOrganicVsAds(vazio);
  check('sem venda nenhuma, conversão é "—" e não "0,00%"',
    !html.includes('0,00%'), (html.match(/0,00%/g) || []).length + ' ocorrências');

  // Conta COM campanha mas sem gasto/clique no período: parede de zeros some
  const { T: T2, STATE: S2 } = carregar();
  const semGasto = { total_cost: 0, total_revenue: 0, organic_revenue: 5000, total_clicks: 0,
    total_impressions: 0, total_orders: 0, organic_orders: 40, revenue_complete: true };
  cenario(S2, { agg: semGasto, visits: VISITS_OK, orders: ORDERS_OK });
  const html2 = T2.renderOrganicVsAds(semGasto);
  check('campanha sem gasto no período não imprime ROAS 0,00x / TACOS 0,00%',
    html2.includes('não tiveram gasto nem clique') && !html2.includes('0,00x'));

  // Visitas parciais: conversão indisponível, não inflada
  const { T: T3, STATE: S3 } = carregar();
  cenario(S3, { agg: AGG_BASE, orders: ORDERS_OK,
    visits: { total_visits: 500, sampled_items: 1000, total_items_account: 5000, capped: true, incomplete: false } });
  const html3 = T3.renderOrganicVsAds(AGG_BASE);
  check('visitas amostradas → conversão indisponível, sem número inventado',
    html3.includes('conversão indisponível') && lerColuna(html3, 'mfd-vs-total')['Conversão'] === '—');

  // Visitas menores que os cliques (conta muito de catálogo)
  const { T: T4, STATE: S4 } = carregar();
  cenario(S4, { agg: AGG_BASE, orders: ORDERS_OK,
    visits: { total_visits: 5000, accountWide: true, capped: false, incomplete: false } });
  const html4 = T4.renderOrganicVsAds(AGG_BASE);
  check('visitas abaixo dos cliques de Ads → não calcula conversão',
    lerColuna(html4, 'mfd-vs-total')['Conversão'] === '—');
}

console.log('\n— computeConversions: as guardas —');
{
  const { T } = carregar();
  const c = T.computeConversions;
  const base = { totalVisits: 1000, adsClicks: 200, totalUnits: 50, orgUnits: 30, adsUnits: 20, pedidos: 40 };

  const ok = c(base);
  check('caso normal devolve as três + a régua por pedido',
    ok.total === 5 && ok.organic === 3.75 && ok.ads === 10 && ok.byOrder === 4,
    JSON.stringify(ok));
  check('sem visitas devolve null, não zero',
    c(Object.assign({}, base, { totalVisits: 0 })).total === null);
  check('visitas iguais aos cliques devolve null (denominador orgânico zero)',
    c(Object.assign({}, base, { adsClicks: 1000 })).total === null);
  check('conversão impossível (>100%) devolve null',
    c(Object.assign({}, base, { totalUnits: 5000 })).total === null);
  check('sem cliques de Ads, conversão de Ads é null e as outras seguem',
    (() => { const r = c(Object.assign({}, base, { adsClicks: 0, adsUnits: 0 })); return r.ads === null && r.total === 5; })());
  check('pedidos ausentes não derrubam as outras conversões',
    (() => { const r = c(Object.assign({}, base, { pedidos: null })); return r.byOrder === null && r.total === 5; })());
  check('zero venda com visitas é 0% de verdade (não null) — quem decide mostrar é o card',
    c(Object.assign({}, base, { totalUnits: 0, orgUnits: 0, adsUnits: 0 })).total === 0);
}

console.log('\n— deltaBadge: sair do zero é notícia, não "sem dado" —');
{
  const { T } = carregar();
  check('de 0 pra 10 mil mostra "do zero", não "—"',
    T.deltaBadge(10000, 0).includes('do zero'));
  check('de 0 pra 0 continua "—"', T.deltaBadge(0, 0).includes('—'));
  check('métrica invertida saindo do zero é ruim (custo)',
    T.deltaBadge(500, 0, { inverted: true }).includes('neg'));
  check('sem base anterior segue "—"', T.deltaBadge(10, null).includes('—'));
  check('queda normal segue calculando %', T.deltaBadge(50, 100).includes('50,0%'));
}

console.log('\n— as duas pontas do delta passam pela mesma fórmula —');
{
  // Período atual e anterior com os MESMOS números de entrada têm que produzir
  // o mesmo agregado — se produzirem, todo delta dá zero. Antes o atual ficava
  // na régua do Mercado Ads e o anterior na dos pedidos truncados, e o card
  // imprimia "Receita ▲ +75,3%" com receita idêntica dos dois lados.
  //
  // ⚠️ Um carregar() só: T e STATE precisam ser do MESMO sandbox, senão
  // consolidarSnapshot lê o STATE errado (vazio) e o teste mente.

  // Coleta truncada: o piso não pode derrubar o que o Ads reportou
  const aggAds = { total_cost: 2800, total_revenue: 28000, organic_revenue: 60000,
    total_clicks: 14000, total_impressions: 1400000, total_orders: 900, organic_orders: 2100,
    avg_ctr: 1, avg_tacos: 2800 / 88000 * 100, overall_roas: 10 };
  const revTruncada = { amount: 50200, units: 1743, orders: 1240, complete: false };

  const { T, STATE } = carregar();
  cenario(STATE, { agg: Object.assign({}, aggAds, { revenue_complete: false }),
    visits: VISITS_OK, orders: { total_orders: 2492, revenue: revTruncada } });
  const snapAtual = {};
  T.consolidarSnapshot(snapAtual, '999', 30);

  // O período anterior é o snapshot consolidado pela MESMA função — que é o que
  // o dashboard passa a fazer desde 26/08. Se a fórmula for a mesma dos dois
  // lados, todo delta tem que dar zero.
  const prevIgual = Object.assign({}, snapAtual);
  const { T: T2, STATE: S2 } = carregar();
  cenario(S2, { agg: Object.assign({}, aggAds, { revenue_complete: false }),
    visits: VISITS_OK, orders: { total_orders: 2492, revenue: revTruncada }, prev: prevIgual });
  const html = T2.renderOrganicVsAds(S2.data.aggregated);
  const deltas = [];
  const re = /class="mfd-delta [a-z]+"[^>]*>([^<]*)</g;
  let m;
  while ((m = re.exec(html)) !== null) deltas.push(m[1].trim());
  const naoZerados = deltas.filter(d => d && d !== '—' && !/^[•▲▼]\s*[+-]?0,0+\s*(%|pp|x)?$/.test(d));
  check('período igual ao anterior não inventa variação',
    naoZerados.length === 0, 'deltas suspeitos: ' + JSON.stringify(naoZerados));
}

console.log('\n— snapshot guarda a régua que usou —');
{
  const { T, STATE, storage } = carregar();
  cenario(STATE, { agg: AGG_BASE, visits: VISITS_OK, orders: ORDERS_OK });
  const snap = {};
  T.consolidarSnapshot(snap, '999', 30);
  check('carimba src=orders quando ancorou nos pedidos', snap.src === 'orders', snap.src);
  check('vendas do snapshot = unidades Ads + orgânicas', snap.sales === UN_ADS + UN_ORG, String(snap.sales));
  check('cvr do snapshot é calculada, não o avg_cvr do ML',
    Math.abs(snap.cvr - (UN_ADS / CLIQUES * 100)) < 0.001, String(snap.cvr));
  check('conversão orgânica do snapshot usa a mesma base do card',
    Math.abs(snap.organic_conversion - (UN_ORG / (VISITAS - CLIQUES) * 100)) < 0.001,
    String(snap.organic_conversion));
  check('grava no localStorage do seller', !!storage.getItem('mf_dash_history_999'));

  const { T: T2, STATE: S2 } = carregar();
  const soAds = Object.assign({}, AGG_BASE, { organic_from_orders: false, organic_only: false });
  cenario(S2, { agg: soAds, visits: VISITS_OK, orders: null });
  const snap2 = {};
  T2.consolidarSnapshot(snap2, '999', 30);
  check('carimba src=ads quando só o Mercado Ads respondeu', snap2.src === 'ads', snap2.src);

  const { T: T3, STATE: S3 } = carregar();
  const parcial = Object.assign({}, AGG_BASE, { revenue_complete: false });
  cenario(S3, { agg: parcial, visits: VISITS_OK, orders: ORDERS_OK });
  const snap3 = {};
  T3.consolidarSnapshot(snap3, '999', 30);
  check('marca partial quando a coleta de pedidos truncou', snap3.partial === true);
}

console.log('\n— conquistas: marco batido não se perde ao trocar de período —');
{
  const { T, STATE } = carregar();
  const rico = Object.assign({}, AGG_BASE, { total_revenue: 40000, organic_revenue: 80000 });
  cenario(STATE, { agg: rico, visits: VISITS_OK, orders: ORDERS_OK, period: 90 });
  const em90 = T.buildAchievements(rico, STATE.data.totals, [], { current: 1, best: 1 }, {});
  check('R$ 100.000 desbloqueia em 90d', em90.find(a => a.id === 'r100k').hit);

  // mesmo STATE/seller, agora 7 dias com receita pequena
  const pobre = Object.assign({}, AGG_BASE, { total_revenue: 900, organic_revenue: 500 });
  STATE.period = 7;
  STATE.data.aggregated = pobre;
  const em7 = T.buildAchievements(pobre, STATE.data.totals, [], { current: 1, best: 1 }, {});
  check('R$ 100.000 CONTINUA desbloqueado em 7d', em7.find(a => a.id === 'r100k').hit);
  check('reputação (estado, não marco) segue o presente',
    em7.find(a => a.id === 'rep_green').hit === false);
}

console.log('\n— insight do dia não troca no meio do carregamento —');
{
  const { T, STATE } = carregar();
  cenario(STATE, { agg: AGG_BASE, visits: VISITS_OK, orders: ORDERS_OK });
  const ctx = { agg: AGG_BASE, totals: STATE.data.totals, prevSnap: null,
    streak: { current: 1, best: 1 }, weekday: 3, hasOpps: true };
  const a = T.pickInsight(ctx, '999');
  const b = T.pickInsight(ctx, '999');
  const c = T.pickInsight(ctx, '999');
  check('três renders seguidos devolvem o MESMO insight',
    a && b && c && a.id === b.id && b.id === c.id, `${a && a.id} / ${b && b.id} / ${c && c.id}`);
}

console.log('\n— padrão da semana aguenta data em ISO completo —');
{
  const { T } = carregar();
  const ymd = T.buildWeekdayPattern([
    { date: '2026-08-20', total_amount: 100, organic_units_amount: 50, units_quantity: 1, organic_units_quantity: 2 }
  ]);
  const iso = T.buildWeekdayPattern([
    { date: '2026-08-20T00:00:00.000Z', total_amount: 100, organic_units_amount: 50, units_quantity: 1, organic_units_quantity: 2 }
  ]);
  const somaY = ymd.reduce((s, b) => s + b.revenue, 0);
  const somaI = iso.reduce((s, b) => s + b.revenue, 0);
  check('ISO completo produz a mesma receita que YYYY-MM-DD', somaY === 150 && somaI === 150,
    `ymd ${somaY} / iso ${somaI}`);
}

console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
