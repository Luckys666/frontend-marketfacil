'use strict';
/*
 * F5 do Seletor de Anúncios: o que sobrevive a recarregar a página.
 *
 * O estado do painel já ia pra URL desde o port, MENOS o degrau da escada de busca:
 * 'buscapor' estava na lista de chaves (e era apagado a cada escrita), mas nunca era
 * escrito nem lido. Resultado: o F5 devolvia a busca ao primeiro degrau e a escada
 * refazia todas as chamadas até chegar onde já estava.
 *
 * Numa conta com mais de mil anúncios isso não é detalhe — é a diferença entre uma
 * consulta e quatro por F5, na mesma família de desperdício que a leva de 09/08 corrigiu
 * ("busca por ID entrando na escada, 4 chamadas repetidas").
 *
 * Rodar: node test/f5-seletor.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

console.log('f5-seletor.test.js');

// ── sandbox: mesmo truque da busca-e-entrada (troca boot() por export) ──
let urlEscrita = '';
function mkSandbox(search) {
  const mkEl = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, closest() { return null; }, focus() {}, click() {}, remove() {}
  });
  const documentStub = {
    readyState: 'complete', getElementById: () => mkEl(), createElement: () => mkEl(),
    body: mkEl(), head: mkEl(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => []
  };
  const sandbox = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    document: documentStub, navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
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
check('ad-selector ainda termina em boot() (o teste depende disso)', /\nboot\(\);\n/.test(src));

function carregar(search) {
  const patched = src.replace(/\nboot\(\);\n/, `
window.__internos = { readStateFromUrl, writeStateToUrl, state, CONFIG, resetSearchLadder, MFSEL_URL_KEYS };
`);
  const box = mkSandbox(search);
  vm.createContext(box);
  vm.runInContext(patched, box, { filename: 'ad-selector.js' });
  return box.__internos;
}

const I0 = carregar('');
check('internos expostos', !!(I0 && I0.readStateFromUrl && I0.writeStateToUrl));

// ── o degrau volta ao recarregar ────────────────────────────────────────
console.log('\n== o degrau da escada sobrevive ao F5 ==');
{
  const I = carregar('?busca=ABC-123&buscapor=seller_sku&status=all');
  I.readStateFromUrl();
  check('termo restaurado', I.state.search === 'ABC-123', I.state.search);
  check('degrau restaurado (seller_sku, não q)', I.state.searchParam === 'seller_sku', String(I.state.searchParam));
  // Sem estas flags a escada tentaria de novo o que já falhou antes do F5.
  check('marca que o degrau "q com todos" já passou', I.state.qAllTried === true);
  check('não marca degraus que ainda não aconteceram', I.state.skuTried === false && I.state.skuAltTried === false);
}
{
  const I = carregar('?busca=ABC-123&buscapor=sku');
  I.readStateFromUrl();
  check('último degrau restaura os dois anteriores',
    I.state.searchParam === 'sku' && I.state.qAllTried === true && I.state.skuTried === true,
    `${I.state.searchParam}/${I.state.qAllTried}/${I.state.skuTried}`);
}
{
  const I = carregar('?busca=sapatilha&buscapor=q');
  I.readStateFromUrl();
  check('primeiro degrau não marca nada como tentado',
    I.state.searchParam === 'q' && I.state.qAllTried === false && I.state.skuTried === false);
}

// ── o alargamento de status volta junto com o degrau ────────────────────
console.log('\n== degrau de SKU restaura o "Todos" que a escada tinha ligado ==');
{
  // Achado testando na tela (11/08): o degrau voltava, mas com status=active. Como a
  // escada só chega no degrau de SKU alargando pra "Todos" (SKU casa exato e o anúncio
  // costuma estar pausado), o F5 escondia justamente o anúncio recém-encontrado.
  const I = carregar('?busca=ABC-123&buscapor=sku');
  I.readStateFromUrl();
  check('status vira "all"', I.state.status === 'all', I.state.status);
  check('guarda o status do vendedor pra devolver depois', I.state.statusRestore === 'active', String(I.state.statusRestore));

  const I2 = carregar('?busca=ABC-123&buscapor=seller_sku');
  I2.readStateFromUrl();
  check('vale pro degrau seller_sku também', I2.state.status === 'all', I2.state.status);

  // Escolha manual manda: writeStateToUrl só põe `status` na URL quando é o do VENDEDOR,
  // então status na URL significa que ele escolheu — e aí não se alarga nada.
  const I3 = carregar('?busca=ABC-123&buscapor=sku&status=paused');
  I3.readStateFromUrl();
  check('status explícito na URL é respeitado (não alarga)', I3.state.status === 'paused', I3.state.status);

  const I4 = carregar('?busca=sapatilha&buscapor=q');
  I4.readStateFromUrl();
  check('degrau q NÃO alarga sozinho', I4.state.status !== 'all', I4.state.status);
}

// ── valor de fora não é confiável ───────────────────────────────────────
console.log('\n== buscapor vem da URL, então é validado ==');
{
  for (const lixo of ['seller_id', 'DROP TABLE', '../../etc', '']) {
    const I = carregar('?busca=abc&buscapor=' + encodeURIComponent(lixo));
    I.readStateFromUrl();
    check(`"${lixo || '(vazio)'}" não vira degrau`,
      I.state.searchParam === 'q' || I.state.searchParam === I.CONFIG.SKU_PARAM,
      String(I.state.searchParam));
  }
  const I = carregar('?busca=abc');
  I.readStateFromUrl();
  check('sem buscapor, cai no degrau inicial (como antes)',
    I.state.searchParam === (I.CONFIG.USE_Q_PARAM ? 'q' : I.CONFIG.SKU_PARAM), String(I.state.searchParam));
}

// ── ida e volta ─────────────────────────────────────────────────────────
console.log('\n== escreve e lê de volta o mesmo estado ==');
{
  const I = carregar('');
  I.state.search = 'PANELA-9';
  I.state.searchParam = 'seller_sku';
  I.state.status = 'paused';
  I.state.statusRestore = null;
  urlEscrita = '';
  I.writeStateToUrl();
  check('buscapor foi escrito na URL', /buscapor=seller_sku/.test(urlEscrita), urlEscrita);
  check('busca foi escrita', /busca=PANELA-9/.test(urlEscrita), urlEscrita);

  const I2 = carregar(urlEscrita.startsWith('?') ? urlEscrita : '');
  I2.readStateFromUrl();
  check('releitura devolve o mesmo termo', I2.state.search === 'PANELA-9', I2.state.search);
  check('releitura devolve o mesmo degrau', I2.state.searchParam === 'seller_sku', String(I2.state.searchParam));
  check('releitura devolve o mesmo status', I2.state.status === 'paused', I2.state.status);
}

// ── sem busca não polui a URL ───────────────────────────────────────────
console.log('\n== sem busca, nada de buscapor ==');
{
  const I = carregar('');
  I.state.search = '';
  I.state.searchParam = 'seller_sku'; // resto de uma busca anterior
  urlEscrita = '';
  I.writeStateToUrl();
  check('sem termo, buscapor não vai pra URL', !/buscapor/.test(urlEscrita), urlEscrita);
}

// ── params alheios continuam intactos (regra do port) ───────────────────
console.log('\n== params de fora do painel são preservados ==');
{
  const I = carregar('?item=MLB123&debug=1&busca=abc&buscapor=q');
  I.readStateFromUrl();
  urlEscrita = '';
  I.state.search = 'abc';
  I.state.searchParam = 'seller_sku';
  I.writeStateToUrl();
  check('?item= sobrevive', /item=MLB123/.test(urlEscrita), urlEscrita);
  check('?debug= sobrevive', /debug=1/.test(urlEscrita), urlEscrita);
  check('buscapor foi atualizado, não duplicado',
    (urlEscrita.match(/buscapor=/g) || []).length === 1 && /buscapor=seller_sku/.test(urlEscrita), urlEscrita);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
