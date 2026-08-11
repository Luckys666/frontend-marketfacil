'use strict';
/*
 * Ordem "Mais vendidos" — o PADRÃO de exibição do Seletor (Lucas, 11/08/2026), pelo TOTAL
 * de vendas do anúncio.
 *
 * A ML não ordena por vendas: o `available_orders` de /users/{id}/items/search só tem
 * tempo, estoque e preço (doc oficial, conferida em 11/08). O ranking vem pronto do proxy,
 * que varre com `search_type=scan` e por isso passa do teto de 1.000 do offset — teto em
 * que a varredura do front para, e que esconderia os campeões numa conta de 5.000 anúncios.
 *
 * Boa parte destes testes nasceu da revisão de código de 11/08, que achou 10 defeitos nesta
 * feature. Cada bloco marcado com "achado" protege um deles.
 *
 * Rodar: node test/mais-vendidos.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

console.log('mais-vendidos.test.js');

let urlEscrita = '';
function mkSandbox(search, fetchImpl) {
  const mkEl = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, setAttribute() {}, getAttribute() { return null; },
    closest() { return null; }, focus() {}, click() {}, remove() {}
  });
  // Storage com as chaves como propriedades PRÓPRIAS: refreshCounts varre com
  // Object.keys(sessionStorage) pra apagar as `mf_sel_*`, e um stub que guarda tudo num
  // objeto interno faria esse varrimento não achar nada — o teste passaria sem exercitar
  // a limpeza de verdade.
  const mkStorage = () => {
    const s = {};
    Object.defineProperties(s, {
      getItem: { value(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; }, enumerable: false },
      setItem: { value(k, v) { this[k] = String(v); }, enumerable: false },
      removeItem: { value(k) { delete this[k]; }, enumerable: false },
    });
    return s;
  };
  const sandbox = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: mkStorage(),
    sessionStorage: mkStorage(),
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
    document: { readyState: 'complete', getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(), head: mkEl(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    history: { replaceState(_a, _b, url) { urlEscrita = url; } },
    scrollTo() {}, requestAnimationFrame(fn) { try { fn(); } catch (_) {} return 0; }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { href: 'https://app.marketfacil.com.br/seletor' + search, search, pathname: '/seletor' };
  sandbox.window.location = sandbox.location;
  return sandbox;
}

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ad-selector.js'), 'utf8');
function carregar(search = '', fetchImpl) {
  const patched = src.replace(/\nboot\(\);\n/, `
window.__internos = { state, CONFIG, writeStateToUrl, readStateFromUrl, isDefaultState,
  loadSalesRanking, ORDER_MAIS_VENDIDOS, ORDER_FALLBACK,
  buildListUrl, ordenarPorVendas, filtroForaDoRanking, refreshCounts };
`);
  const box = mkSandbox(search, fetchImpl);
  vm.createContext(box);
  vm.runInContext(patched, box, { filename: 'ad-selector.js' });
  return box.__internos;
}

const tokenOk = { ok: true, status: 200, json: async () => ({ response: { access_token: 'T' } }) };
const mockRanking = (corpo) => async (url) => {
  if (String(url).includes('getAccessToken2')) return tokenOk;
  return { ok: true, status: 200, json: async () => corpo };
};

(async () => {

const I0 = carregar();
check('internos expostos', !!(I0 && I0.state && I0.loadSalesRanking));

// ── o padrão ────────────────────────────────────────────────────────────
console.log('\n== mais vendidos é o padrão ==');
{
  const I = carregar();
  check('state.order abre em sold_desc', I.state.order === 'sold_desc', I.state.order);
  check('o fallback é a ordem antiga da ML', I.ORDER_FALLBACK === 'last_updated_desc');
  check('tela limpa conta como estado padrão', I.isDefaultState() === true);
}

// ── URL ─────────────────────────────────────────────────────────────────
console.log('\n== a URL não carrega o padrão ==');
{
  const I = carregar();
  urlEscrita = '';
  I.writeStateToUrl();
  check('ordem padrão NÃO vai pra URL', !/order=/.test(urlEscrita), urlEscrita);

  I.state.order = 'price_asc';
  urlEscrita = '';
  I.writeStateToUrl();
  check('ordem escolhida vai pra URL', /order=price_asc/.test(urlEscrita), urlEscrita);

  const I2 = carregar('?order=last_updated_desc');
  I2.readStateFromUrl();
  check('link antigo continua valendo', I2.state.order === 'last_updated_desc', I2.state.order);
}

// ── achado: a pseudo-ordem ia pra ML e quebrava toda busca ──────────────
console.log('\n== a pseudo-ordem nunca vai pra ML ==');
{
  // `sold_desc` é ordem NOSSA. Mandar em `orders=` fazia o proxy responder 400 (o
  // isValidOrder nem aceita o formato) e QUALQUER busca por texto derrubava a tela — no
  // estado padrão recém-instalado, porque a busca não passa pelo ramo do ranking.
  const I = carregar();
  I.state.sellerId = '1';
  const url = I.buildListUrl(0);
  check('não manda sold_desc pra ML', !/orders=sold_desc/.test(url), url);
  check('manda a ordem que a ML entende', /orders=last_updated_desc/.test(url), url);

  I.state.order = 'price_asc';
  check('ordem de verdade continua indo', /orders=price_asc/.test(I.buildListUrl(0)));
}

// ── o ranking vem do servidor ───────────────────────────────────────────
console.log('\n== o front pede o ranking, não calcula ==');
{
  let urlPedida = null;
  const I = carregar('', async (url) => {
    if (String(url).includes('getAccessToken2')) return tokenOk;
    urlPedida = String(url);
    return { ok: true, status: 200, json: async () => ({
      complete: true, items_scanned: 3, items_total: 3,
      // fora de ordem de propósito: se o front reordenasse, o teste não veria diferença
      ranking: [{ item_id: 'MLB_A', sold: 90 }, { item_id: 'MLB_B', sold: 4 }, { item_id: 'MLB_C', sold: 0 }],
    }) };
  });
  I.state.sellerId = '649733403';
  const ranking = await I.loadSalesRanking();
  check('chamou /api/sales-ranking', /\/api\/sales-ranking/.test(urlPedida || ''), String(urlPedida));
  check('mandou seller e status', /seller_id=649733403/.test(urlPedida) && /status=/.test(urlPedida), String(urlPedida));
  check('devolve a lista NA ORDEM DO SERVIDOR',
    ranking.map((r) => r.item_id).join(',') === 'MLB_A,MLB_B,MLB_C', JSON.stringify(ranking));
  check('guarda o que a tela precisa pra ser honesta',
    I.state.rankingInfo.complete === true && I.state.rankingInfo.items_total === 3,
    JSON.stringify(I.state.rankingInfo));
}

// ── achado: cache não escopado por conta ────────────────────────────────
console.log('\n== cache do ranking é por conta ==');
{
  const I = carregar('', mockRanking({ complete: true, ranking: [{ item_id: 'MLB_CONTA_A', sold: 5 }] }));
  I.state.sellerId = 'AAA';
  await I.loadSalesRanking();
  check('conta A carrega o ranking dela', I.state.ranking[0].item_id === 'MLB_CONTA_A');
  const chaveA = I.state.rankingChave;
  check('a chave leva o vendedor', /AAA/.test(String(chaveA)), String(chaveA));

  // Troca de conta na MESMA aba: sessionStorage sobrevive ao reload do Bubble. Antes, o
  // cache devolvia o ranking da conta anterior sem passar pelo proxy — o ownershipGate
  // nunca rodava e a lista da conta B saía com anúncios da conta A (o multiget da ML
  // aceita id de qualquer vendedor).
  I.state.sellerId = 'BBB';
  await I.loadSalesRanking();
  check('trocar de conta refaz o ranking', I.state.rankingChave !== chaveA, String(I.state.rankingChave));
  check('e a chave nova é da conta B', /BBB/.test(String(I.state.rankingChave)), String(I.state.rankingChave));
}

// ── achado: fallback prendia o vendedor na ordem antiga ─────────────────
console.log('\n== fallback não prende na ordem antiga ==');
{
  const I = carregar('', async (url) => {
    if (String(url).includes('getAccessToken2')) return tokenOk;
    return { ok: false, status: 404, json: async () => ({}) };
  });
  I.state.sellerId = '1';
  let erro = null;
  try { await I.loadSalesRanking(); } catch (e) { erro = e; }
  check('propaga erro com status 404', erro && erro.status === 404, String(erro && erro.status));
  // O ponto: state.order NÃO pode virar last_updated_desc. Se virasse, writeStateToUrl
  // gravaria `order=` na URL e todo F5 seguinte prenderia o vendedor nela — mesmo depois
  // de o proxy voltar. É a mesma armadilha que o statusRestore evita para o status.
  check('a ordem escolhida continua sendo a padrão', I.state.order === 'sold_desc', I.state.order);
  urlEscrita = '';
  I.writeStateToUrl();
  check('e a URL não ganha ordem que ele não escolheu', !/order=/.test(urlEscrita), urlEscrita);

  const I2 = carregar('', async (url) => {
    if (String(url).includes('getAccessToken2')) return tokenOk;
    return { ok: false, status: 500, json: async () => ({}) };
  });
  I2.state.sellerId = '1';
  let e2 = null;
  try { await I2.loadSalesRanking(); } catch (e) { e2 = e; }
  check('500 é erro identificável (mensagem diferente do 404)', e2 && e2.status === 500, String(e2 && e2.status));
}

// ── achado: "Atualizar" nunca refazia o ranking ─────────────────────────
console.log('\n== Atualizar refaz o ranking ==');
{
  let chamadas = 0;
  const I = carregar('', async (url) => {
    if (String(url).includes('getAccessToken2')) return tokenOk;
    // refreshCounts dispara outras chamadas (contagens, sinais): contar só o ranking
    if (String(url).includes('/api/sales-ranking')) chamadas++;
    return { ok: true, status: 200, json: async () => ({ complete: true, ranking: [{ item_id: 'MLB1', sold: 2 }] }) };
  });
  I.state.sellerId = '1';
  await I.loadSalesRanking();
  check('carregou', chamadas === 1, String(chamadas));
  await I.loadSalesRanking();
  check('não repete sem motivo', chamadas === 1, String(chamadas));

  // refreshCounts limpava o sessionStorage mas não state.ranking, e loadSalesRanking
  // devolve o que está em memória ANTES de olhar o cache: o botão nunca refazia a ordem.
  I.refreshCounts();
  check('refreshCounts zera o ranking em memória', I.state.ranking === null, JSON.stringify(I.state.ranking));
  await I.loadSalesRanking();
  check('e a próxima carga vai à rede de novo', chamadas === 2, String(chamadas));
}

// ── ordenação local (quando a lista vem da varredura) ───────────────────
console.log('\n== ordenar por vendas na varredura local ==');
{
  const I = carregar();
  const itens = [
    { id: 'MLB_B', sold_quantity: 3 },
    { id: 'MLB_A', sold_quantity: 30 },
    { id: 'MLB_C', sold_quantity: 3 },
    { id: 'MLB_D' },   // sem o campo: não pode virar NaN e embaralhar a lista
  ];
  const ord = I.ordenarPorVendas(itens).map((x) => x.id);
  check('maior total primeiro', ord[0] === 'MLB_A', JSON.stringify(ord));
  check('empate desempata por id (não dança no F5)', ord[1] === 'MLB_B' && ord[2] === 'MLB_C', JSON.stringify(ord));
  check('item sem sold_quantity vai pro fim, não quebra', ord[3] === 'MLB_D', JSON.stringify(ord));
  check('não altera o array original', itens[0].id === 'MLB_B');
}

// ── achado: filtros viravam no-op na visão padrão ───────────────────────
console.log('\n== filtros que o ranking não conhece ==');
{
  // O ranking do servidor só conhece o status. Com chip, tipo ou logística ligados, a
  // ordem tem que sair da varredura local — que aplica esses filtros. Sem isso, o
  // vendedor clicava em "Pausados" ou num chip e a lista não mudava.
  const I = carregar();
  check('sem filtro → usa o ranking do servidor', I.filtroForaDoRanking() === false);
  I.state.activeChip = 'sem_frete';
  check('chip tira do ranking', I.filtroForaDoRanking() === true);
  I.state.activeChip = null; I.state.listingType = 'gold_pro';
  check('tipo de anúncio idem', I.filtroForaDoRanking() === true);
  I.state.listingType = null; I.state.logisticType = 'fulfillment';
  check('logística idem', I.filtroForaDoRanking() === true);
  I.state.logisticType = null;
  check('e volta ao ranking quando limpa', I.filtroForaDoRanking() === false);
}

// ── status entra na chave (o ranking do servidor filtra por ele) ────────
console.log('\n== status faz parte da identidade do ranking ==');
{
  const I = carregar('', mockRanking({ complete: true, ranking: [{ item_id: 'MLB1', sold: 1 }] }));
  I.state.sellerId = '1';
  I.state.status = 'active';
  await I.loadSalesRanking();
  const chaveAtivos = I.state.rankingChave;
  I.state.status = 'paused';
  await I.loadSalesRanking();
  check('trocar de status refaz o ranking', I.state.rankingChave !== chaveAtivos,
    `${chaveAtivos} vs ${I.state.rankingChave}`);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);

})();
