'use strict';
/*
 * Ordem "Mais vendidos (30 dias)" — o PADRÃO de exibição do Seletor (Lucas, 11/08/2026).
 *
 * A ML não ordena por vendas: o `available_orders` de /users/{id}/items/search só tem
 * tempo, estoque e preço (doc oficial, conferida em 11/08). Então o ranking vem pronto do
 * proxy (/api/sales-ranking), montado a partir dos PEDIDOS — que só trazem quem vendeu, o
 * que faz o custo ser proporcional às vendas e não ao tamanho da conta.
 *
 * O front NÃO calcula ordem aqui: ele pede, pagina e desenha (regra de 11/08 — a
 * inteligência fica no servidor). Estes testes protegem justamente as bordas:
 *  - o padrão novo não pode poluir a URL nem contar como "filtro ativo"
 *  - rota ausente (front injetado antes do deploy do proxy) NÃO pode virar tela vazia
 *    nem silêncio: cai pra ordem da ML avisando (a lição invertida de 10/08)
 *  - contagem incompleta não vira badge de venda
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
  const store = {};
  const sandbox = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
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
  computeBadges, loadSalesRanking, sales30Of, ORDER_MAIS_VENDIDOS, ORDER_FALLBACK };
`);
  const box = mkSandbox(search, fetchImpl);
  vm.createContext(box);
  vm.runInContext(patched, box, { filename: 'ad-selector.js' });
  return box.__internos;
}

// IIFE async: o arquivo é CommonJS (require) e há await nos blocos de ranking.
(async () => {

const I0 = carregar();
check('internos expostos', !!(I0 && I0.state && I0.loadSalesRanking));

// ── o padrão mudou ──────────────────────────────────────────────────────
console.log('\n== mais vendidos é o padrão ==');
{
  const I = carregar();
  check('state.order abre em sales30_desc', I.state.order === 'sales30_desc', I.state.order);
  check('a constante bate', I.ORDER_MAIS_VENDIDOS === 'sales30_desc');
  check('o fallback é a ordem antiga da ML', I.ORDER_FALLBACK === 'last_updated_desc');
  check('tela limpa conta como estado padrão', I.isDefaultState() === true);
}

// ── a URL só guarda o que fugiu do padrão ───────────────────────────────
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

  // F5 com a ordem antiga na URL tem que continuar valendo — link velho não pode quebrar
  const I2 = carregar('?order=last_updated_desc');
  I2.readStateFromUrl();
  check('URL antiga com last_updated_desc é respeitada', I2.state.order === 'last_updated_desc', I2.state.order);

  const I3 = carregar('?order=sales30_desc');
  I3.readStateFromUrl();
  check('URL com a ordem nova também', I3.state.order === 'sales30_desc', I3.state.order);
}

// ── o ranking vem do servidor, o front não ordena ───────────────────────
console.log('\n== o front pede o ranking, não calcula ==');
{
  let urlPedida = null;
  const fetchMock = async (url) => {
    if (String(url).includes('getAccessToken2')) {
      return { ok: true, status: 200, json: async () => ({ response: { access_token: 'T' } }) };
    }
    urlPedida = String(url);
    return { ok: true, status: 200, json: async () => ({
      window_days: 30, complete: true, orders_scanned: 12, orders_total: 12, items_with_sales: 3,
      // de propósito FORA de ordem: se o front reordenasse, o teste não pegaria a diferença
      ranking: [{ item_id: 'MLB_A', units: 9 }, { item_id: 'MLB_B', units: 4 }, { item_id: 'MLB_C', units: 1 }],
    }) };
  };
  const I = carregar('', fetchMock);
  I.state.sellerId = '649733403';
  const ranking = await I.loadSalesRanking();
  check('chamou /api/sales-ranking', /\/api\/sales-ranking/.test(urlPedida || ''), String(urlPedida));
  check('mandou o seller e a janela', /seller_id=649733403/.test(urlPedida) && /days=30/.test(urlPedida), String(urlPedida));
  check('devolve a lista do servidor, na ordem dele',
    ranking.map(r => r.item_id).join(',') === 'MLB_A,MLB_B,MLB_C', JSON.stringify(ranking.map(r => r.item_id)));
  check('guarda o que a tela precisa pra ser honesta',
    I.state.rankingInfo.complete === true && I.state.rankingInfo.orders_total === 12,
    JSON.stringify(I.state.rankingInfo));
  // A mesma fonte alimenta o badge da linha: duas contagens de "vendas" na mesma tela
  // seria o bug das três contagens de campos outra vez.
  check('alimenta o badge pela MESMA fonte da ordem', I.sales30Of('MLB_A') === 9, String(I.sales30Of('MLB_A')));
}

// ── varredura incompleta não vira badge ─────────────────────────────────
console.log('\n== contagem parcial não vira número na linha ==');
{
  const fetchMock = async (url) => {
    if (String(url).includes('getAccessToken2')) return { ok: true, status: 200, json: async () => ({ response: { access_token: 'T' } }) };
    return { ok: true, status: 200, json: async () => ({
      complete: false, orders_scanned: 2000, orders_total: 9000, items_with_sales: 1,
      ranking: [{ item_id: 'MLB_A', units: 9 }],
    }) };
  };
  const I = carregar('', fetchMock);
  I.state.sellerId = '1';
  await I.loadSalesRanking();
  check('marca incompleto', I.state.sales30Incomplete === true);
  // O ranking ainda serve pra ORDENAR (é o melhor que temos), mas o número por linha não
  // pode ser afirmado — a tela avisa de quantos pedidos a ordem saiu.
  check('sales30Of devolve null quando incompleto', I.sales30Of('MLB_A') === null, String(I.sales30Of('MLB_A')));
  const badges = I.computeBadges({ id: 'MLB_A', tags: [], sold_quantity: 5 });
  check('nenhum badge de venda com contagem parcial',
    !badges.some(b => /venda/i.test(b.text) && /\dd$/.test(b.text)), JSON.stringify(badges.map(b => b.text)));
}

// ── badge de vendas quando a contagem é confiável ───────────────────────
console.log('\n== badge explica por que a linha está no topo ==');
{
  const fetchMock = async (url) => {
    if (String(url).includes('getAccessToken2')) return { ok: true, status: 200, json: async () => ({ response: { access_token: 'T' } }) };
    return { ok: true, status: 200, json: async () => ({ complete: true, ranking: [{ item_id: 'MLB_A', units: 9 }, { item_id: 'MLB_U', units: 1 }] }) };
  };
  const I = carregar('', fetchMock);
  I.state.sellerId = '1';
  await I.loadSalesRanking();
  // Item sem nenhum problema real (tem garantia): é aqui que dá pra ver se o badge de
  // venda apaga o "Sem problemas" — foi o erro que cometi na primeira versão, colocando
  // o badge no array de `problems`.
  const limpo = { id: 'MLB_A', tags: [], sold_quantity: 20, warranty: 'Garantia do vendedor: 90 dias' };
  const badges = I.computeBadges(limpo);
  const venda = badges.find(b => /9 vendas/.test(b.text));
  check('mostra "9 vendas em 30d"', !!venda, JSON.stringify(badges.map(b => b.text)));
  check('é badge verde (não é problema)', venda && venda.cls === 'green', venda && venda.cls);
  check('não apaga o "Sem problemas" da linha',
    badges.some(b => b.text === 'Sem problemas'), JSON.stringify(badges.map(b => b.text)));

  const um = I.computeBadges({ id: 'MLB_U', tags: [], sold_quantity: 3 });
  check('singular em 1 venda', um.some(b => b.text === '1 venda em 30d'), JSON.stringify(um.map(b => b.text)));

  const zero = I.computeBadges({ id: 'MLB_ZERO', tags: [], sold_quantity: 0 });
  check('quem não vendeu no período não ganha badge de venda',
    !zero.some(b => /em 30d/.test(b.text)), JSON.stringify(zero.map(b => b.text)));
}

// ── rota ausente: o erro precisa chegar identificável ───────────────────
console.log('\n== front novo com proxy antigo ==');
{
  // Cenário real: o bundle vai pra version-test antes do deploy do proxy. Em 10/08 o
  // inverso (servidor novo, cliente antigo) deixou o Lucas clicando em loop. O erro tem
  // que chegar com o status pra loadPage escolher a mensagem certa e cair na ordem da ML.
  const fetch404 = async (url) => {
    if (String(url).includes('getAccessToken2')) return { ok: true, status: 200, json: async () => ({ response: { access_token: 'T' } }) };
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };
  const I = carregar('', fetch404);
  I.state.sellerId = '1';
  let erro = null;
  try { await I.loadSalesRanking(); } catch (e) { erro = e; }
  check('propaga erro com status 404', erro && erro.status === 404, String(erro && erro.status));
  check('não deixa ranking pela metade no estado', !I.state.ranking, JSON.stringify(I.state.ranking));
  // E o mais importante: não pode ter "inventado" um mapa de vendas vazio, senão a tela
  // passaria a dizer "0 vendas" pra conta inteira.
  check('não inventa mapa de vendas vazio', I.state.sales30Map === null, JSON.stringify(I.state.sales30Map));

  const fetch500 = async (url) => {
    if (String(url).includes('getAccessToken2')) return { ok: true, status: 200, json: async () => ({ response: { access_token: 'T' } }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const I2 = carregar('', fetch500);
  I2.state.sellerId = '1';
  let erro2 = null;
  try { await I2.loadSalesRanking(); } catch (e) { erro2 = e; }
  check('500 também é erro identificável (mensagem diferente do 404)',
    erro2 && erro2.status === 500, String(erro2 && erro2.status));
}

// ── cache de sessão ─────────────────────────────────────────────────────
console.log('\n== não repete a varredura na mesma sessão ==');
{
  let chamadas = 0;
  const fetchMock = async (url) => {
    if (String(url).includes('getAccessToken2')) return { ok: true, status: 200, json: async () => ({ response: { access_token: 'T' } }) };
    chamadas++;
    return { ok: true, status: 200, json: async () => ({ complete: true, ranking: [{ item_id: 'MLB_A', units: 2 }] }) };
  };
  const I = carregar('', fetchMock);
  I.state.sellerId = '1';
  await I.loadSalesRanking();
  await I.loadSalesRanking();
  check('segunda chamada não vai à rede', chamadas === 1, String(chamadas));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);

})();
