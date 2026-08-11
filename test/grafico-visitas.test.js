'use strict';
/*
 * Gráfico do card de visitas — visitas, vendas e conversão dia a dia
 * (Lucas, 11/08/2026: "eu preciso do gráfico… em linha e não mais em barra… quando
 * passarmos o mouse precisa ter os dados do que foi feito naquele dia… também colocar a
 * opção de remover uma das métricas").
 *
 * TRÊS PAINÉIS empilhados e não um gráfico sobreposto: visitas ficam na casa das centenas,
 * vendas na das unidades, conversão em %. Sobrepor exigiria dois eixos Y — o erro clássico
 * de gráfico, em que a inclinação de uma série depende da escala escolhida pra outra e a
 * comparação vira ilusão de ótica. Empilhado, o eixo X é compartilhado e a leitura "as
 * visitas subiram e as vendas não" continua direta.
 *
 * O que estes testes protegem:
 *  - dia sem fonte de vendas é BURACO na linha, nunca zero (falha não vira número)
 *  - conversão não existe sem visita no dia (divisão por zero não vira 0%)
 *  - o path quebra no buraco em vez de ligar os pontos por cima dele
 *  - anúncio sem Ads não ganha painéis vazios de vendas/conversão
 *
 * Rodar: node test/grafico-visitas.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get, reg } = carregar();
const MF_seriesDiarias = get('MF_seriesDiarias');
const MF_caminhoSerie = get('MF_caminhoSerie');
const MF_SERIES_VISITAS = get('MF_SERIES_VISITAS');
const exibirTendenciaVisitas = get('exibirTendenciaVisitas');

console.log('grafico-visitas.test.js');

const dia = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// ── montagem das séries ─────────────────────────────────────────────────
console.log('\n== séries diárias ==');
{
  const visitas = [{ date: dia(3), total: 100 }, { date: dia(2), total: 50 }, { date: dia(1), total: 0 }];
  const ads = [{ date: dia(3), units_quantity: 1, organic_units_quantity: 1 }, { date: dia(2), units_quantity: 5, organic_units_quantity: 0 }];
  const p = MF_seriesDiarias(visitas, ads);
  check('um ponto por dia, em ordem', p.length === 3 && p[0].dia < p[1].dia, JSON.stringify(p.map(x=>x.dia)));
  check('soma vendas de Ads + orgânicas', p[0].vendas === 2 && p[1].vendas === 5, JSON.stringify(p.map(x=>x.vendas)));
  check('conversão = vendas/visitas em %', Math.abs(p[0].conversao - 2) < 0.001 && Math.abs(p[1].conversao - 10) < 0.001,
    JSON.stringify(p.map(x=>x.conversao)));
}

console.log('\n== o que não se sabe não vira zero ==');
{
  const visitas = [{ date: dia(3), total: 10 }, { date: dia(2), total: 20 }];
  // Ads só tem dado do primeiro dia: o segundo NÃO vendeu zero — não dá pra saber.
  const p = MF_seriesDiarias(visitas, [{ date: dia(3), units_quantity: 1, organic_units_quantity: 0 }]);
  check('dia com dado de Ads tem venda', p[0].vendas === 1, String(p[0].vendas));
  check('dia SEM dado de Ads fica null, não 0', p[1].vendas === null, String(p[1].vendas));
  check('e a conversão dele também', p[1].conversao === null, String(p[1].conversao));

  // Sem Ads nenhum: nenhuma série de vendas existe.
  const semAds = MF_seriesDiarias(visitas, null);
  check('sem Ads, nenhum dia inventa venda', semAds.every(x => x.vendas === null));
}

console.log('\n== conversão sem visita não existe ==');
{
  const p = MF_seriesDiarias([{ date: dia(1), total: 0 }], [{ date: dia(1), units_quantity: 3, organic_units_quantity: 0 }]);
  check('vendeu 3 com 0 visita: vendas continuam 3', p[0].vendas === 3, String(p[0].vendas));
  // 3/0 seria Infinity; 0 seria mentira. O honesto é não afirmar.
  check('conversão vira null (não 0%, não infinito)', p[0].conversao === null, String(p[0].conversao));
}

// ── o path quebra no buraco ─────────────────────────────────────────────
console.log('\n== a linha não atravessa o buraco ==');
{
  const pontos = [
    { dia: '2026-08-01', visitas: 10 },
    { dia: '2026-08-02', visitas: null },
    { dia: '2026-08-03', visitas: 30 },
  ];
  const d = MF_caminhoSerie(pontos, 'visitas', 4, 292, 0, 46);
  const moves = (d.match(/M/g) || []).length;
  check('o path recomeça depois do buraco (2 "M")', moves === 2, d);
  check('e não tem L ligando por cima do vazio', (d.match(/L/g) || []).length === 0, d);

  const cheio = MF_caminhoSerie([{ dia: 'a', visitas: 1 }, { dia: 'b', visitas: 2 }], 'visitas', 4, 292, 0, 46);
  check('série sem buraco vira um traço só', (cheio.match(/M/g)||[]).length === 1 && (cheio.match(/L/g)||[]).length === 1, cheio);

  check('série toda vazia não gera path', MF_caminhoSerie([{ dia: 'a', visitas: null }], 'visitas', 4, 292, 0, 46) === '');
}

// ── na tela ─────────────────────────────────────────────────────────────
console.log('\n== o card desenha os painéis certos ==');
{
  const visitas = { results: Array.from({ length: 8 }, (_, i) => ({ date: dia(i + 1), total: 10 + i })) };
  const ads = { has_ads: true, daily: Array.from({ length: 8 }, (_, i) => ({ date: dia(i + 1), units_quantity: 1, organic_units_quantity: 0 })) };
  exibirTendenciaVisitas(visitas, 'visitsTrend', ads);
  const html = reg['visitsTrend'].innerHTML;
  check('é linha, não barra', html.includes('<path') && !html.includes('visit-bar-rect'), '');
  check('tem os três painéis', ['visitas','vendas','conversao'].every(k => html.includes(`data-serie="${k}"`)), '');
  check('tem crosshair', html.includes('mf-vis-cross'));
  check('tem área de tooltip', html.includes('mf-vis-tip'));
  check('tem um botão por métrica', (html.match(/mf-vis-toggle/g)||[]).length === 3, String((html.match(/mf-vis-toggle/g)||[]).length));
  check('os dados do dia viajam no HTML pro hover', html.includes('data-pontos'));
  check('usa as cores validadas', html.includes('#0066ff') && html.includes('#00875a') && html.includes('#c2410c'));
}

console.log('\n== sem Ads não desenha painel vazio ==');
{
  const visitas = { results: Array.from({ length: 5 }, (_, i) => ({ date: dia(i + 1), total: 7 })) };
  exibirTendenciaVisitas(visitas, 'visitsTrendSemAds', null);
  const html = reg['visitsTrendSemAds'].innerHTML;
  check('painel de visitas existe', html.includes('data-serie="visitas"'));
  check('painel de vendas NÃO existe', !html.includes('data-serie="vendas"'), '');
  check('painel de conversão NÃO existe', !html.includes('data-serie="conversao"'), '');
  check('e só um botão de métrica', (html.match(/mf-vis-toggle/g)||[]).length === 1, String((html.match(/mf-vis-toggle/g)||[]).length));
}

console.log('\n== sem visita nenhuma, sem gráfico ==');
{
  exibirTendenciaVisitas({ results: [] }, 'visitsVazio', null);
  const html = reg['visitsVazio'].innerHTML;
  check('não desenha gráfico vazio', !html.includes('mf-vis-chart'), '');
  check('mas o card continua de pé', html.includes('Visitas'));
}

// ── resumo por período segue as métricas ativas ─────────────────────────
console.log('\n== o resumo 7/15/30 acompanha as métricas ==');
{
  // Lucas, 11/08: "conseguir trocar os dados de 7, 15 e 30d" → os blocos deixam de ser só
  // visitas e passam a ter uma coluna por métrica ativa. Um controle só manda no card
  // inteiro: desligar Vendas tira a coluna daqui também, senão o gráfico e o resumo
  // discordariam sobre o que está ligado.
  const visitas = { results: Array.from({ length: 20 }, (_, i) => ({ date: dia(i + 1), total: 10 })) };
  const ads = { has_ads: true, daily: Array.from({ length: 20 }, (_, i) => ({ date: dia(i + 1), units_quantity: 2, organic_units_quantity: 0 })) };
  exibirTendenciaVisitas(visitas, 'resumo', ads);
  const html = reg['resumo'].innerHTML;
  const txt = reg['resumo'].textContent;

  check('o card se chama "Desempenho do Anúncio"', txt.includes('Desempenho do Anúncio'), txt.slice(0, 60));
  check('não se chama mais "Visitas Recentes"', !txt.includes('Visitas Recentes'));
  check('tem as três janelas', ['7 dias','15 dias','30 dias'].every(j => txt.includes(j)), txt.slice(0, 200));
  check('uma coluna por métrica', html.includes('>Visitas<') && html.includes('>Vendas<') && html.includes('>Conversão<'));
  // 7 dias: 7 pontos × 10 visitas e × 2 vendas → 20%
  check('conversão da janela = vendas ÷ visitas da janela', txt.includes('20,00%'),
    (txt.match(/[\d,]+%/g)||[]).join(' '));
}

console.log('\n== a conversão da janela não é média das diárias ==');
{
  // Um dia de 2 visitas com 1 venda (50%) e um de 200 visitas com 1 venda (0,5%): a média
  // simples daria ~25%, a conta certa dá 2/202 = 0,99%. Média trataria os dois dias como
  // se pesassem igual.
  const visitas = { results: [ { date: dia(1), total: 2 }, { date: dia(2), total: 200 } ] };
  const ads = { has_ads: true, daily: [ { date: dia(1), units_quantity: 1, organic_units_quantity: 0 }, { date: dia(2), units_quantity: 1, organic_units_quantity: 0 } ] };
  exibirTendenciaVisitas(visitas, 'resumoPeso', ads);
  const txt = reg['resumoPeso'].textContent;
  check('usa o total da janela (0,99%), não a média (25%)', txt.includes('0,99%'),
    (txt.match(/[\d,]+%/g)||[]).join(' '));
}

console.log('\n== sem Ads o resumo tem só visitas ==');
{
  const visitas = { results: Array.from({ length: 10 }, (_, i) => ({ date: dia(i + 1), total: 5 })) };
  exibirTendenciaVisitas(visitas, 'resumoSemAds', null);
  const html = reg['resumoSemAds'].innerHTML;
  check('coluna Visitas existe', html.includes('>Visitas<'));
  check('coluna Vendas não', !html.includes('>Vendas<'));
  check('e o card explica por quê', reg['resumoSemAds'].textContent.includes('publicidade'));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
