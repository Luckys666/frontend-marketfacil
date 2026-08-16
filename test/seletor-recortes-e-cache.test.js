'use strict';
/*
 * Quatro defeitos do Seletor achados pela revisão de 16/08/2026.
 *
 * 1. Os atalhos server-side dos recortes ("Frete grátis abaixo de R$ 79" e "Com desconto")
 *    montam a própria URL e IGNORAM os selects Tipo e Logística — que continuam mostrando o
 *    filtro escolhido. `filtroForaDoRanking()` já trata os dois como filtros que o caminho
 *    do servidor não conhece; estas duas funções esqueceram. O vendedor filtra "Clássico" e
 *    recebe anúncios de todo tipo, sem nada na tela dizendo isso.
 *
 * 2. Os caches de moderação, promoções e ficha usam chave FIXA, sem o vendedor. O cache do
 *    ranking documenta exatamente esse risco e leva `sellerId` na chave: trocar de conta
 *    recarrega a página na mesma aba e o sessionStorage sobrevive. Por 10 minutos a conta
 *    nova renderiza com os mapas da conta anterior — nenhum "Parado pelo Mercado Livre",
 *    nenhum preço de campanha: um "está tudo bem" silencioso sobre anúncios que estão fora
 *    do ar. É a mesma classe de vazamento entre contas que o ownershipGate existe pra
 *    impedir no servidor.
 *
 * 3. "Baixar planilha" com recorte ativo cai em `exportAllCsv()` sempre que a varredura não
 *    deixou cache válido — e `scanAccount` grava `chave: null` DE PROPÓSITO quando alguma
 *    parte falhou. Aí o arquivo sai com os primeiros N anúncios da conta inteira, rotulado
 *    "Planilha baixada com N anúncios", com a faixa "Mostrando só: Com desconto" logo acima.
 *
 * 4. `if (v === lastSubmit) return;` é permanente: depois de uma busca que falhou (proxy
 *    fora do ar, 429), apertar Enter de novo no mesmo termo não faz nada. O propósito do
 *    guard é só descartar o evento GÊMEO (Enter dispara keydown e 'search' juntos), não
 *    proibir a segunda tentativa.
 *
 * Rodar: node test/seletor-recortes-e-cache.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const mkEl = () => ({
  innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, appendChild() {}, querySelector() { return null; },
  querySelectorAll() { return []; }, setAttribute() {}, getAttribute() { return null; },
  closest() { return null; }, focus() {}, click() {}, remove() {},
});
const mkStorage = () => {
  const s = {};
  Object.defineProperties(s, {
    getItem: { value(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; }, enumerable: false },
    setItem: { value(k, v) { this[k] = String(v); }, enumerable: false },
    removeItem: { value(k) { delete this[k]; }, enumerable: false },
  });
  return s;
};

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ad-selector.js'), 'utf8');

function carregar(fetchImpl) {
  const patched = src.replace(/\nboot\(\);\n/, `
window.__internos = { state, CONFIG, podeFiltrarFreteNoServidor, podeFiltrarDescontoNoServidor,
  filtroForaDoRanking, exportCsv, scanKey, loadModerations, loadPromocoes, loadFichaTecnica,
  setBanner, quickFilterAtivo };
`);
  const box = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: mkStorage(), sessionStorage: mkStorage(),
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
    document: { readyState: 'complete', getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(), head: mkEl(), addEventListener() {}, querySelector: () => mkEl(), querySelectorAll: () => [] },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    history: { replaceState() {} }, Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    scrollTo() {}, requestAnimationFrame(fn) { try { fn(); } catch (_) {} return 0; },
  };
  box.window = box; box.globalThis = box;
  box.location = { href: 'https://app.marketfacil.com.br/seletor', search: '', pathname: '/seletor' };
  box.window.location = box.location;
  vm.createContext(box);
  vm.runInContext(patched, box, { filename: 'ad-selector.js' });
  return { I: box.__internos, box };
}

console.log('seletor-recortes-e-cache.test.js');

// =========================================================================================
console.log('\n== 1. recorte pelo servidor não engole os filtros Tipo e Logística ==');
{
  const { I } = carregar();

  I.state.freeShipUnder = true;
  check('frete pelo servidor vale quando não há outro filtro', I.podeFiltrarFreteNoServidor() === true);
  I.state.listingType = 'gold_special';
  check('com "Tipo" escolhido, o atalho de frete sai de cena',
    I.podeFiltrarFreteNoServidor() === false, 'listingType=gold_special');
  I.state.listingType = ''; I.state.logisticType = 'fulfillment';
  check('com "Logística" escolhida, idem', I.podeFiltrarFreteNoServidor() === false, 'logisticType=fulfillment');

  I.state.freeShipUnder = false; I.state.logisticType = '';
  I.state.discountOnly = true;
  check('desconto pelo servidor vale sozinho', I.podeFiltrarDescontoNoServidor() === true);
  I.state.listingType = 'gold_pro';
  check('com "Tipo" escolhido, o atalho de desconto sai de cena',
    I.podeFiltrarDescontoNoServidor() === false, 'listingType=gold_pro');
  I.state.listingType = ''; I.state.logisticType = 'cross_docking';
  check('com "Logística" escolhida, idem', I.podeFiltrarDescontoNoServidor() === false);

  // Coerência com a régua que já existia: quem sai do ranking também sai destes atalhos.
  I.state.discountOnly = false; I.state.logisticType = 'fulfillment';
  check('a régua bate com filtroForaDoRanking', I.filtroForaDoRanking() === true);
}

// =========================================================================================
console.log('\n== 2. cache de uma conta não pode aparecer na outra ==');
{
  const fonte = src;
  for (const chave of ['mf_sel_moderation', 'mf_sel_promo', 'mf_sel_ficha']) {
    // Chave literal e fixa = mesma gaveta para todas as contas.
    const literalFixa = new RegExp(`getCachedJson\\('${chave}'\\)`).test(fonte)
      || new RegExp(`setCachedJson\\('${chave}'`).test(fonte);
    check(`${chave} não usa chave fixa`, !literalFixa, literalFixa ? 'ainda literal' : 'com vendedor');
  }
  // E a prova de comportamento: mesma chave para dois vendedores diferentes é o defeito.
  const { I } = carregar();
  I.state.sellerId = 'AAA';
  const kA = typeof I.scanKey === 'function' ? String(I.scanKey()) : '';
  I.state.sellerId = 'BBB';
  const kB = typeof I.scanKey === 'function' ? String(I.scanKey()) : '';
  check('a chave da varredura também separa vendedores', kA !== kB, `${kA} × ${kB}`);

  // ⚠️ Varredura da CLASSE inteira, não das três chaves que a revisão citou. A primeira
  // leva corrigiu moderação, promoções e ficha; sobraram counts, sinais, perguntas e
  // vendas-30d — todas guardando dado DA CONTA numa gaveta compartilhada. Este check falha
  // sozinho quando alguém criar a oitava.
  const CHAVES_NAO_SAO_DE_CONTA = [
    'mf_sel_attrs_',   // atributos são da CATEGORIA da ML, iguais para qualquer vendedor
  ];
  const literais = [];
  // A aspa tem de ser seguida de `,` ou `)` — com `+` depois, a chave está sendo
  // concatenada com o vendedor, que é justamente o certo.
  const re = /(?:get|set)CachedJson\(\s*'(mf_sel_[a-z0-9_]*)'\s*[,)]/g;
  let m;
  while ((m = re.exec(fonte)) !== null) {
    if (!CHAVES_NAO_SAO_DE_CONTA.some((p) => m[1].startsWith(p))) literais.push(m[1]);
  }
  check('nenhuma chave de dado-da-conta é literal fixa', literais.length === 0,
    [...new Set(literais)].join(', '));

  // E a constante que serve de chave também precisa do vendedor na hora de usar.
  const usaCountsKey = /COUNTS_CACHE_KEY\s*\+\s*[^;]*sellerId|sellerId[^;]*COUNTS_CACHE_KEY/.test(fonte);
  check('a chave de contagens leva o vendedor', usaCountsKey,
    (fonte.match(/CachedJson\([^)]*COUNTS_CACHE_KEY[^)]*\)/g) || []).slice(0, 2).join(' | '));
}

// A partir daqui é assíncrono: `exportAllCsv` é async e `exportCsv` a dispara sem await,
// então medir sem ceder o event loop é medir antes de a exportação acontecer.
(async () => {

// =========================================================================================
console.log('\n== 3. planilha do recorte não vira "a conta inteira" quando a varredura falha ==');
{
  // Mede o EFEITO, não uma flag. Duas armadilhas custaram uma volta cada aqui:
  //  - `state.__exportouTudo` (1ª versão) não é escrito por ninguém: passava antes E depois
  //    do fix, medindo nada;
  //  - `exportAllCsv` é ASYNC e `exportCsv` a chama sem await, então um check síncrono
  //    rodava antes de qualquer fetch — e também passava sem a guarda. Por isso o `await`
  //    e o `state.total` alto: sem eles a exportação nem chega a paginar.
  const tick = () => new Promise((r) => setImmediate(r));

  let blobs = 0, chamadas = 0;
  const um = carregar(async () => {
    chamadas++;
    return { ok: true, status: 200, json: async () => ({ results: ['MLB9'], paging: { total: 500 } }) };
  });
  um.box.Blob = function () { blobs++; };
  um.I.state.sellerId = '1267924722';
  um.I.state.discountOnly = true;                    // recorte ativo na tela
  um.I.state.total = 500;                            // conta grande: exportAllCsv PAGINA
  um.I.state.lastItems = [];
  // Varredura que teve falhas: scanAccount grava chave null DE PROPÓSITO.
  um.I.state.scan = { chave: null, itens: [{ id: 'MLB1' }], varridos: 100, total: 100, parcial: true };
  um.I.exportCsv();
  await tick(); await tick();

  check('não gera arquivo com lista que não representa o recorte', blobs === 0, String(blobs));
  check('e não sai paginando a conta inteira por baixo', chamadas === 0, String(chamadas));

  // Contraprova — sem ela o fix poderia ser "nunca exportar nada" e o teste aplaudiria.
  let blobs2 = 0;
  const dois = carregar();
  dois.box.Blob = function () { blobs2++; };
  dois.I.state.sellerId = '1267924722';
  dois.I.state.discountOnly = true;
  dois.I.state.scan = {
    chave: dois.I.scanKey(), itens: [{ id: 'MLB1', title: 'Produto', price: 10 }],
    varridos: 10, total: 10, parcial: false,
  };
  dois.I.exportCsv();
  await tick();
  check('varredura íntegra continua baixando a planilha', blobs2 === 1, String(blobs2));
}

// =========================================================================================
console.log('\n== 4. buscar de novo o MESMO termo depois de falhar tem que funcionar ==');
{
  // O guard existe para o par de eventos gêmeos do input type=search (keydown + 'search'),
  // que chegam no mesmo instante. Uma segunda tentativa do vendedor vem segundos depois.
  const fonte = src;
  const trecho = fonte.slice(fonte.indexOf('lastSubmit'), fonte.indexOf('lastSubmit') + 1600);
  check('o guard não é comparação permanente de texto',
    !/if \(v === lastSubmit\) return;/.test(trecho),
    (trecho.match(/if \(v === lastSubmit\) return;/) || [''])[0]);
  check('o guard leva tempo em conta (evento gêmeo, não segunda tentativa)',
    /lastSubmitEm|Date\.now\(\)/.test(trecho), 'sem marca de tempo no guard');
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
})();
