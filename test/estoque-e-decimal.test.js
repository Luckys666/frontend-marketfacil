'use strict';
/*
 * Dois defeitos vistos na tela em 16/08/2026, na conta real (GIARTH COMERCIAL).
 *
 * 1) "Estoque acaba em ~24788 dias" (Lucas: "conta certa, número inútil").
 *    A conta ESTÁ certa: 9.993 unidades ÷ 0,4 por dia = 68 anos. O problema é prometer uma
 *    data a partir de 15 dias de vendas — a projeção some no ruído muito antes disso, e o
 *    card de oportunidade existe pra avisar de RUPTURA. Sem ruptura no horizonte em que dá
 *    pra agir, não há oportunidade nenhuma: é ruído ocupando o lugar do que importa.
 *    A régua não é nova — `js/ad-selector.js:stockDaysHtml` já suprime acima de 365 dias
 *    ("acima de 1 ano a estimativa não é acionável"). A Análise é que ficou fora dela.
 *
 * 2) Ponto e vírgula decimais na MESMA tela: medido no DOM da version-test, "máx 0.0%" e
 *    "0.00%" (8 ocorrências) convivendo com "0,00%" (3). Em pt-BR o separador é vírgula;
 *    "250.0%" lido por um vendedor brasileiro é ambíguo com separador de milhar.
 *    O formatador tem de sair do LOCALE do site (MLB, MCO, MLA…), não de `toFixed`, senão
 *    o i18n nasce quebrado ([[project_ml_i18n]]).
 *
 * Rodar: node test/estoque-e-decimal.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get, sandbox } = carregar();

// --- helpers de fixture -----------------------------------------------------------------
function dia(atras) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - atras);
  return d.toISOString().substring(0, 10);
}
// Série diária do Ads com `unidades` vendas espalhadas nos últimos 30 dias.
function adsComVendas(unidades) {
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    daily.push({ date: dia(i), units_quantity: 0, organic_units_quantity: 0 });
  }
  for (let n = 0; n < unidades; n++) {
    daily[daily.length - 1 - (n % 30)].organic_units_quantity += 1;
  }
  return { has_ads: true, daily };
}
function visitas(qtd) {
  const results = [];
  for (let i = 29; i >= 0; i--) results.push({ date: dia(i), total: qtd });
  return { results };
}
function acharRunway(opps) {
  return (opps || []).find((o) => o.kind === 'stock_runway') || null;
}

// =========================================================================================
console.log('\n# 1. Projeção de estoque longa demais não vira número');
{
  const MF_buildOpportunities = get('MF_buildOpportunities');

  // O caso do Lucas: MLB6227552214-like — estoque enorme, venda quase parada.
  // 12 vendas em 30d contra 9.993 unidades = mais de 20 anos de estoque.
  const longo = MF_buildOpportunities(
    { id: 'MLB6227552214', price: 25.6, available_quantity: 9993, sold_quantity: 12, tags: [] },
    visitas(3), adsComVendas(12), {}
  );
  const cardLongo = acharRunway(longo);
  check('estoque para mais de 1 ano NÃO gera card de ruptura', cardLongo === null,
    cardLongo ? cardLongo.title : '(sem card)');

  // Contraprova: o card não pode simplesmente sumir pra todo mundo — quem tem ruptura
  // perto continua precisando do aviso. 30 unidades e 60 vendas em 30d = ~15 dias.
  const curto = MF_buildOpportunities(
    { id: 'MLB1', price: 25.6, available_quantity: 30, sold_quantity: 60, tags: [] },
    visitas(50), adsComVendas(60), {}
  );
  const cardCurto = acharRunway(curto);
  check('estoque que acaba logo CONTINUA avisando', cardCurto !== null,
    cardCurto ? cardCurto.title : '(sumiu — regressão)');
  check('e o aviso curto ainda diz quantos dias', !!cardCurto && /\d+\s*dias?/.test(cardCurto.title),
    cardCurto ? cardCurto.title : '');
  check('aviso curto é prioridade alta', !!cardCurto && cardCurto.priority <= 2,
    cardCurto ? String(cardCurto.priority) : '');

  // A borda exata: 365 dias ainda mostra, 366 já não. Sem isso o teste passaria com
  // qualquer teto (10 dias, 10.000 dias) e não estaria medindo a régua acordada.
  // 365 unidades ÷ 1 por dia = 365 dias.
  const naBorda = acharRunway(MF_buildOpportunities(
    { id: 'MLB2', price: 10, available_quantity: 365, sold_quantity: 30, tags: [] },
    visitas(20), adsComVendas(30), {}
  ));
  const passouBorda = acharRunway(MF_buildOpportunities(
    { id: 'MLB3', price: 10, available_quantity: 2000, sold_quantity: 30, tags: [] },
    visitas(20), adsComVendas(30), {}
  ));
  check('~1 ano de estoque ainda aparece', naBorda !== null, naBorda ? naBorda.title : '(sem card)');
  check('bem mais de 1 ano não aparece', passouBorda === null,
    passouBorda ? passouBorda.title : '(sem card)');
}

// =========================================================================================
console.log('\n# 2. Percentual em pt-BR usa vírgula, e vem do locale do site');
{
  const fmt = sandbox.window.MF_formatPercent;
  check('MF_formatPercent existe', typeof fmt === 'function', typeof fmt);

  if (typeof fmt === 'function') {
    check('0 com 1 casa vira "0,0%"', fmt(0, 1) === '0,0%', fmt(0, 1));
    check('0 com 2 casas vira "0,00%"', fmt(0, 2) === '0,00%', fmt(0, 2));
    check('o "máx 250.0%" da tela vira "250,0%"', fmt(250, 1) === '250,0%', fmt(250, 1));
    check('20.934 com 2 casas arredonda pra "20,93%"', fmt(20.934, 2) === '20,93%', fmt(20.934, 2));
    // Milhar junto com decimal é onde o ponto realmente engana.
    check('milhar não vira ambiguidade', fmt(1234.5, 1) === '1.234,5%', fmt(1234.5, 1));
    // Nada de "NaN%" na cara do vendedor: valor que não é número não desenha percentual.
    check('valor inválido não vira "NaN%"', fmt(null, 1) === '—' && fmt(undefined, 2) === '—',
      `${fmt(null, 1)} / ${fmt(undefined, 2)}`);
    check('Infinity também não vira número', fmt(Infinity, 1) === '—', fmt(Infinity, 1));
  }
}

// =========================================================================================
console.log('\n# 3. A tela do gráfico não mistura os dois separadores');
{
  const MF_seriesDiarias = get('MF_seriesDiarias');
  const MF_renderCardVisitas = get('MF_renderCardVisitas') || get('MF_montaCardVisitas');

  if (typeof MF_renderCardVisitas !== 'function') {
    // Sem o renderizador exposto, mede-se o rótulo do eixo — que é onde o "máx 250.0%"
    // aparece — pela função que o monta.
    const MF_rotuloMaximo = get('MF_rotuloMaximo');
    check('MF_rotuloMaximo existe pra ser medido', typeof MF_rotuloMaximo === 'function',
      typeof MF_rotuloMaximo);
    if (typeof MF_rotuloMaximo === 'function') {
      check('rótulo de conversão usa vírgula', MF_rotuloMaximo(250, 'conversao') === 'máx 250,0%',
        MF_rotuloMaximo(250, 'conversao'));
      check('rótulo de conversão zerada usa vírgula', MF_rotuloMaximo(0, 'conversao') === 'máx 0,0%',
        MF_rotuloMaximo(0, 'conversao'));
      // Visitas são contagem: 437 visitas não vira "437,0".
      check('contagem continua inteira, sem casa decimal', MF_rotuloMaximo(437, 'visitas') === 'máx 437',
        MF_rotuloMaximo(437, 'visitas'));
    }
    void MF_seriesDiarias;
  }
}

// =========================================================================================
console.log('\n# 4. A tabela de canais e a composição de tráfego também');
{
  const diasAtras = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().substring(0, 10);
  };
  const visitas60 = { results: Array.from({ length: 60 }, (_, i) => ({ date: diasAtras(i + 1), total: 10 })) };
  const adsDaily = Array.from({ length: 30 }, (_, i) => ({
    date: diasAtras(i + 1), clicks: 5, prints: 50, cost: 10, total_amount: 200,
    units_quantity: 1, organic_units_quantity: 1, organic_units_amount: 150,
  }));

  const h = carregar();
  h.sandbox.currentAnalysisState = { visitsData: visitas60 };
  h.get('exibirAdsMetrics')({ has_ads: true, daily: adsDaily, ad_info: {} }, 'canais', 30, visitas60);
  const html = h.reg['canais'].innerHTML;
  const texto = h.reg['canais'].textContent;

  // O TEXTO que o vendedor lê não pode ter ponto decimal antes de "%".
  const pontoNoTexto = texto.match(/\d+\.\d+\s*%/g) || [];
  check('nenhum "20.00%" no texto da tela', pontoNoTexto.length === 0, pontoNoTexto.join(' | '));
  check('a conversão aparece com vírgula', /\d+,\d+\s*%/.test(texto),
    (texto.match(/\d+,\d+\s*%/g) || []).slice(0, 3).join(' | '));

  // ⚠️ E o CSS continua com PONTO: `width:20,00%` é declaração inválida e a barra some.
  // Sem esta asserção, "trocar tudo por vírgula" passaria no teste e quebraria o layout.
  const largurasComVirgula = html.match(/(?:width|left)\s*:\s*\d+,\d+%/g) || [];
  check('nenhuma largura de CSS levou vírgula junto', largurasComVirgula.length === 0,
    largurasComVirgula.join(' | '));
  const temLarguraValida = /(?:width|left)\s*:\s*[\d.]+%/.test(html);
  check('as barras continuam com largura em CSS válido', temLarguraValida,
    (html.match(/width\s*:\s*[^;"']+/g) || []).slice(0, 2).join(' | '));
}

// =========================================================================================
console.log('\n# 5. A janela de 30 dias não pode depender da HORA em que o vendedor abre');
{
  // Achado ao rodar a suíte em 16/08/2026: `janela-canais.test.js` falhava em 7 checks à
  // tarde e passava de manhã — com o MESMO código e os MESMOS dados. A causa não é o teste:
  // `MF_visitasDosUltimos` compara `Date.now()` (instante, ao milissegundo) com a data do
  // registro ancorada em T12:00. O dia mais antigo da janela entra antes do meio-dia e sai
  // depois dele, então o card "30 dias" conta 300 visitas de manhã e 290 à tarde.
  // Visita da ML é dado DIÁRIO: a janela tem de ser contada em dias civis.
  const MF_visitasDosUltimos = get('MF_visitasDosUltimos');

  const serie = [];
  for (let i = 1; i <= 60; i++) {
    const d = new Date('2026-08-16T00:00:00');
    d.setDate(d.getDate() - i);
    serie.push({ date: d.toISOString().substring(0, 10), total: 10 });
  }

  const manha = new Date('2026-08-16T08:00:00').getTime();
  const tarde = new Date('2026-08-16T22:00:00').getTime();
  const totalEm = (agora) => MF_visitasDosUltimos(serie, 30, agora).reduce((s, v) => s + v.total, 0);

  // Aridade não serve de medida aqui: `Function.length` para no primeiro parâmetro com
  // default, então a função conta 1 mesmo aceitando três. Mede-se o COMPORTAMENTO.
  check('mesma contagem de manhã e à noite', totalEm(manha) === totalEm(tarde),
    `${totalEm(manha)} de manhã × ${totalEm(tarde)} à noite`);
  // Meia-noite em ponto é onde a comparação por instante mais escorrega.
  const meiaNoite = new Date('2026-08-16T00:00:01').getTime();
  const quaseMeiaNoite = new Date('2026-08-16T23:59:59').getTime();
  check('e vale da meia-noite ao último minuto do dia',
    totalEm(meiaNoite) === totalEm(tarde) && totalEm(quaseMeiaNoite) === totalEm(tarde),
    `${totalEm(meiaNoite)} / ${totalEm(tarde)} / ${totalEm(quaseMeiaNoite)}`);
  // E continua sendo uma janela de 30 dias — não virou "tudo" nem "nada".
  check('a janela ainda recorta 30 dias, não os 60', totalEm(tarde) < 600 && totalEm(tarde) >= 290,
    String(totalEm(tarde)));
  // ⚠️ Os dois checks acima passariam com a função ANTIGA, que ignorava o 3º parâmetro e
  // lia `Date.now()` nas duas pontas — dois valores iguais e igualmente errados. Este aqui
  // é o que reprova a versão antiga: um mês depois, a mesma série tem de sair da janela.
  const mesQueVem = new Date('2026-09-16T10:00:00').getTime();
  check('a janela anda com o calendário (reprova a versão que ignorava "agora")',
    totalEm(mesQueVem) === 0 && totalEm(tarde) > 0,
    `${totalEm(mesQueVem)} um mês depois × ${totalEm(tarde)} hoje`);

  // Sem o "agora" injetado o comportamento é o mesmo — o parâmetro é só pro teste.
  const semAgora = MF_visitasDosUltimos(serie, 30).reduce((s, v) => s + v.total, 0);
  check('sem "agora" a função continua funcionando', typeof semAgora === 'number', String(semAgora));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
