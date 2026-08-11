'use strict';
/*
 * Pedidos do Lucas em 10/08/2026:
 *   - o card de visitas passa a mostrar VENDAS e CONVERSÃO
 *   - o gráfico de Ads passa a mostrar TACOS
 *
 * O que estes testes protegem, além de "apareceu na tela":
 *  - conversão nunca sai de períodos diferentes. As visitas são de 30 dias; o daily do Ads
 *    cobre o período escolhido no card (7/15/30/60/90). Somar o daily inteiro contra visitas
 *    de 30 dias daria conversão errada assim que o vendedor escolhesse 90d.
 *  - anúncio SEM Ads não tem série de vendas por dia. Mostrar "0 vendas" ali seria falso —
 *    é a regra do "falha nunca vira zero".
 *  - dia com custo e sem venda não é "ACOS 0%". A conta antiga desenhava barra no chão
 *    justamente no pior dia do período.
 *
 * Rodar: node test/visitas-e-tacos.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get, reg } = carregar();
const exibirTendenciaVisitas = get('exibirTendenciaVisitas');
const exibirAdsMetrics = get('exibirAdsMetrics');

console.log('visitas-e-tacos.test.js');

// Datas relativas a hoje, pra cair dentro das janelas que o card calcula por data real.
const diasAtras = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
};

// 10 dias com 10 visitas cada = 100 visitas na janela de 30 dias
const visitas = { results: Array.from({ length: 10 }, (_, i) => ({ date: diasAtras(i + 1), total: 10 })) };

// ── card de visitas: vendas e conversão ─────────────────────────────────
console.log('\n== card de visitas mostra vendas e conversão ==');
{
  const ads = {
    has_ads: true,
    daily: Array.from({ length: 10 }, (_, i) => ({
      date: diasAtras(i + 1), units_quantity: 1, organic_units_quantity: 1, cost: 5, total_amount: 100
    }))
  };
  exibirTendenciaVisitas(visitas, 'visitsTrend', ads);
  const html = reg['visitsTrend'].innerHTML;
  // O resumo virou tabela por período (11/08): a coluna de Vendas substitui o rodapé.
  check('a tabela tem a coluna Vendas', html.includes('>Vendas<'), html.slice(-400));
  check('mostra 20 vendas (10 dias × 2)', html.includes('>20<'), (html.match(/>\d+</g) || []).join(' '));
  check('mostra o rótulo Conversão', html.includes('Conversão'));
  check('conversão = 20/100 = 20,00%', html.includes('20,00%'), (html.match(/[\d,.]+%/g) || []).join(' '));
}

// ── a janela tem que ser a mesma dos dois lados ─────────────────────────
console.log('\n== vendas fora da janela de 30 dias não entram ==');
{
  // O vendedor escolheu 90d no card de Ads: o daily traz dias de 60 atrás. Se esses dias
  // entrarem na conta, a conversão estoura contra visitas que são só de 30 dias.
  const ads90 = {
    has_ads: true,
    daily: [
      ...Array.from({ length: 10 }, (_, i) => ({ date: diasAtras(i + 1), units_quantity: 1, organic_units_quantity: 1 })),
      ...Array.from({ length: 20 }, (_, i) => ({ date: diasAtras(i + 40), units_quantity: 5, organic_units_quantity: 5 }))
    ]
  };
  exibirTendenciaVisitas(visitas, 'visitsTrend90', ads90);
  const html = reg['visitsTrend90'].innerHTML;
  check('conta só os 30 dias (20 vendas, não 220)', html.includes('>20<'), (html.match(/>\d+</g) || []).join(' '));
  check('conversão continua 20,00%', html.includes('20,00%'), (html.match(/[\d,.]+%/g) || []).join(' '));
}

// ── sem Ads não inventa número ──────────────────────────────────────────
console.log('\n== sem Ads: nada de "0 vendas" ==');
{
  exibirTendenciaVisitas(visitas, 'visitsTrendSemAds', null);
  const html = reg['visitsTrendSemAds'].innerHTML;
  check('não afirma "0" vendas', !html.includes('>Vendas<'), html.slice(-300));
  check('explica por que não tem', html.includes('publicidade'), html.slice(-300));

  // has_ads false com daily presente também não vale
  exibirTendenciaVisitas(visitas, 'visitsTrendAdsOff', { has_ads: false, daily: [{ date: diasAtras(1), units_quantity: 3 }] });
  const html2 = reg['visitsTrendAdsOff'].innerHTML;
  check('has_ads=false não mostra vendas', !html2.includes('>Vendas<'));
}

// ── conversão sem visita não é 0% ───────────────────────────────────────
console.log('\n== sem visita a taxa não existe ==');
{
  const semVisita = { results: [] };
  const ads = { has_ads: true, daily: [{ date: diasAtras(1), units_quantity: 2, organic_units_quantity: 0 }] };
  exibirTendenciaVisitas(semVisita, 'visitsTrendZero', ads);
  const html = reg['visitsTrendZero'].innerHTML;
  check('conversão vira traço, não 0%', html.includes('>—<'), (html.match(/>[^<]{1,8}</g) || []).slice(-6).join(' '));
}

// ── gráfico: TACOS entrou ───────────────────────────────────────────────
console.log('\n== gráfico de Ads mostra ACOS e TACOS ==');
{
  const ads = {
    has_ads: true,
    ad_info: { status: 'active' },
    campaign: { name: 'Campanha', strategy: 'profitability' },
    daily: [
      { date: diasAtras(3), cost: 10, total_amount: 100, organic_units_amount: 100, clicks: 5, prints: 100, units_quantity: 1, organic_units_quantity: 1 },
      { date: diasAtras(2), cost: 20, total_amount: 50, organic_units_amount: 150, clicks: 8, prints: 200, units_quantity: 1, organic_units_quantity: 2 },
      { date: diasAtras(1), cost: 30, total_amount: 0, organic_units_amount: 0, clicks: 2, prints: 50, units_quantity: 0, organic_units_quantity: 0 }
    ]
  };
  exibirAdsMetrics(ads, 'adsMetrics', 30, visitas);
  const html = reg['adsMetrics'].innerHTML;
  check('o card mudou de nome pra "ACOS e TACOS por dia"',
    html.includes('ACOS e TACOS por dia'), (html.match(/chart-card-label">[^<]+/g) || []).join(' | '));
  check('explica a diferença entre barra e linha',
    html.includes('faturamento') && html.includes('orgânico'));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
