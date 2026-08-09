'use strict';
/*
 * Como o vendedor ENTRA na análise: a busca do painel e o link direto.
 *
 * Bugs que estes testes travam (medidos em conta real 08/08/2026, SEU ENCANTO):
 *  1. Busca com espaço ou acento virava TELA DE ERRO. A escada caía no degrau
 *     seller_sku=, o proxy recusa SKU fora de /^[\w\-.]{1,100}$/ com 400, e o
 *     catch tratava isso como app quebrado: "não conseguimos carregar seus
 *     anúncios" para quem digitou "sapatilha preta".
 *  2. Busca por nome só olhava o status selecionado (o painel abre em "Ativos"):
 *     q=sapatilha dava 0 em ativos e 15 em todos, e a tela ainda afirmava que
 *     não existia anúncio com esse nome.
 *  3. Link ?item=MLBU… morria em "não foi possível obter os dados do anúncio":
 *     a chamada programática fixava type:'mlb' e o MLBU ia pro endpoint errado.
 *
 * Rodar: node test/busca-e-entrada.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

// ───────────────────────── harness mínimo de browser ─────────────────────
function mkEl(id) {
  const el = {
    id: id || '', _html: '', textContent: '', value: '', hidden: false, disabled: false,
    className: '', children: [], style: {}, _attrs: {}, dataset: {},
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? null; },
    appendChild(n) { this.children.push(n); return n; },
    removeChild() {}, click() {}, focus() {}, select() {}, scrollIntoView() {},
    addEventListener() {}, removeEventListener() {}, remove() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; }, closest() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); } });
  return el;
}
function mkSandbox() {
  const reg = {};
  const documentStub = {
    readyState: 'complete',
    getElementById(id) { if (!reg[id]) reg[id] = mkEl(id); return reg[id]; },
    createElement() { return mkEl(); }, createDocumentFragment() { return mkEl(); },
    body: mkEl('body'), head: mkEl('head'), documentElement: mkEl('html'),
    addEventListener() {}, querySelector() { return mkEl(); }, querySelectorAll() { return []; }
  };
  const storage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean, URLSearchParams,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: storage, sessionStorage: storage,
    document: documentStub, navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    history: { replaceState() {} }, scrollTo() {}, requestAnimationFrame(fn) { try { fn(); } catch (_) {} return 0; },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { href: 'https://app.marketfacil.com.br/analise-anuncio', search: '', pathname: '/analise-anuncio' };
  sandbox.window.location = sandbox.location;
  return sandbox;
}

console.log('busca-e-entrada.test.js');

/* =======================================================================
   PARTE 1 — escada de busca do painel (js/ad-selector.js)
   O arquivo é uma IIFE fechada: trocamos a chamada boot() (que dispararia
   rede) por um export dos internos. O código testado é o de produção.
   ======================================================================= */
const selSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ad-selector.js'), 'utf8');
check('ad-selector ainda termina chamando boot() (o teste depende disso)', /\nboot\(\);\n/.test(selSrc));
const selPatched = selSrc.replace(/\nboot\(\);\n/, `
window.__internos = { pareceSku, nextSearchStep, avancarDegrau, emptyStateMsg, state, CONFIG };
`);
const selBox = mkSandbox();
selBox.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
vm.createContext(selBox);
vm.runInContext(selPatched, selBox, { filename: 'ad-selector.js' });
const I = selBox.__internos;
check('internos do painel expostos para o teste', !!(I && I.pareceSku && I.nextSearchStep));

// ── 1a. o que pode virar consulta de SKU ────────────────────────────────
check('SKU comum passa (ABC-123.4)', I.pareceSku('ABC-123.4') === true);
check('SKU só dígitos passa', I.pareceSku('panela123') === true);
check('termo com espaço NÃO é SKU', I.pareceSku('sapatilha preta') === false);
check('termo com acento NÃO é SKU', I.pareceSku('caneca ção') === false);
check('termo vazio não é SKU', I.pareceSku('') === false);
check('texto longo demais não é SKU', I.pareceSku('a'.repeat(101)) === false);

// ── 1b. ordem dos degraus ───────────────────────────────────────────────
const resetEstado = (busca, status) => {
  I.state.search = busca; I.state.status = status;
  I.state.searchParam = 'q'; I.state.qAllTried = false;
  I.state.skuTried = false; I.state.skuAltTried = false; I.state.statusRestore = null;
};

resetEstado('sapatilha', 'active');
let passo = I.nextSearchStep();
check('nome sem resultado em "Ativos" tenta o mesmo nome em todos os status',
  passo && passo.param === 'q' && passo.todosOsStatus === true, JSON.stringify(passo));

I.state.qAllTried = true; I.state.status = 'all';
passo = I.nextSearchStep();
check('depois do nome em todos, tenta SELLER_SKU (termo sem espaço)',
  passo && passo.param === I.CONFIG.SKU_PARAM, JSON.stringify(passo));

I.state.searchParam = I.CONFIG.SKU_PARAM; I.state.skuTried = true;
passo = I.nextSearchStep();
check('depois do SELLER_SKU, tenta o outro campo de SKU',
  passo && passo.param === I.CONFIG.SKU_PARAM_ALT, JSON.stringify(passo));

I.state.searchParam = I.CONFIG.SKU_PARAM_ALT; I.state.skuAltTried = true;
check('escada acaba (nada além do segundo SKU)', I.nextSearchStep() === null);

// ── 1c. termo que não pode ser SKU nunca chega no degrau de SKU ─────────
resetEstado('sapatilha preta', 'all');   // já em "todos": o degrau q_all não se aplica
check('termo com espaço não gera NENHUMA consulta de SKU', I.nextSearchStep() === null,
  JSON.stringify(I.nextSearchStep()));
resetEstado('caneca ção', 'all');
check('termo com acento não gera NENHUMA consulta de SKU', I.nextSearchStep() === null);

// ── 1d. avancarDegrau liga "Todos" e guarda o status pra devolver ───────
resetEstado('sapatilha', 'active');
const subiu = I.avancarDegrau();
check('avancarDegrau sobe um degrau quando há próximo', subiu === true);
check('avancarDegrau guarda o status anterior para restaurar depois',
  I.state.statusRestore === 'active', String(I.state.statusRestore));
check('avancarDegrau marca que o nome-em-todos já foi tentado', I.state.qAllTried === true);
resetEstado('sapatilha preta', 'all');
check('avancarDegrau devolve false quando a escada acabou', I.avancarDegrau() === false);

// ── 1e. o texto do "nada encontrado" não pode afirmar o que não checou ──
I.state.search = 'sapatilha preta';
let vazio = I.emptyStateMsg();
check('sem resultado para termo com espaço, a mensagem NÃO afirma que olhou o SKU',
  !/no título nem no SKU/.test(vazio), vazio);
check('mensagem diz que procurou entre ativos e pausados', /ativos e pausados/.test(vazio), vazio);
I.state.search = 'panela123';
vazio = I.emptyStateMsg();
check('para termo que É um SKU possível, a mensagem segue citando o SKU',
  /no título nem no SKU/.test(vazio), vazio);

/* =======================================================================
   PARTE 2 — entrada por link/ID (js/analyzer.js)
   ======================================================================= */
const anaBox = mkSandbox();
const urlsChamadas = [];
anaBox.fetch = async (url) => {
  urlsChamadas.push(String(url));
  return { ok: true, status: 200, json: async () => ({ response: { access_token: 'tok', user_id: '1' } }) };
};
vm.createContext(anaBox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'analyzer.js'), 'utf8'), anaBox, { filename: 'analyzer.js' });
const get = (n) => anaBox[n] || vm.runInContext(`typeof ${n} !== 'undefined' ? ${n} : undefined`, anaBox);
const normalizeMlbId = get('normalizeMlbId');

check('normalizeMlbId entende MLBU como produto', normalizeMlbId('MLBU3923551945').type === 'mlbu');
check('normalizeMlbId entende MLB como anúncio', normalizeMlbId('MLB6683355888').type === 'mlb');
check('normalizeMlbId entende link /p/ como catálogo',
  normalizeMlbId('https://www.mercadolivre.com.br/x/p/MLB39023499').type === 'catalog');

// O bug: a chamada programática (deep-link, clique na lista) ignorava esse
// parse. Aqui checamos o CAMINHO: analisarAnuncio('MLBU…') tem que consultar a
// rota de produto, nunca a de anúncio.
(async () => {
  const analisarAnuncio = get('analisarAnuncio');
  check('analisarAnuncio existe', typeof analisarAnuncio === 'function');

  urlsChamadas.length = 0;
  await analisarAnuncio('MLBU3923551945').catch(() => {});
  const bateuProduto = urlsChamadas.some(u => u.includes('/api/user-products/MLBU3923551945'));
  const bateuAnuncio = urlsChamadas.some(u => /\/api\/fetch-item\?item_id=MLBU/.test(u));
  check('link direto de produto (MLBU) consulta a rota de PRODUTO', bateuProduto,
    urlsChamadas.filter(u => u.includes('/api/')).slice(0, 4).join(' | '));
  check('link direto de produto (MLBU) NÃO cai na rota de anúncio', !bateuAnuncio);

  urlsChamadas.length = 0;
  await analisarAnuncio('MLB6683355888').catch(() => {});
  check('clique num anúncio da lista (MLB) continua indo pra rota de anúncio',
    urlsChamadas.some(u => /\/api\/fetch-item\?item_id=MLB6683355888/.test(u)),
    urlsChamadas.filter(u => u.includes('/api/')).slice(0, 4).join(' | '));

  /* ===================================================================
     PARTE 3 — jargão da ML não chega à tela
     =================================================================== */
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'analyzer.js'), 'utf8');
  check('status da publicidade tem tradução para os 6 valores documentados pela ML',
    ['active', 'paused', 'hold', 'idle', 'delegated', 'revoked'].every(s => new RegExp(`\\b${s}:\\s*\\{\\s*texto:`).test(fonte)));
  check('nenhum selo imprime o status cru da publicidade',
    !/status-badge muted">\$\{adInfo\.status/.test(fonte));
  check('o selo "Nível: <valor cru>" saiu da tela', !/Nível: \$\{adLevel\}/.test(fonte));
  check('erro de anúncio inexistente não mostra "código" técnico',
    !/código \$\{itemData\?\.code/.test(fonte));
  check('dica de publicidade parada lê o campo certo (status, não current_level)',
    /_adStatus = adsData\?\.ad_info\?\.status/.test(fonte) && /_adStatus === 'hold'/.test(fonte));
  check('dica de publicidade parada não manda mais mexer no lance',
    !/lance está abaixo do mínimo da categoria/.test(fonte));

  /* ===================================================================
     PARTE 4 — a tela diz se o anúncio está no ar
     Analisar um pausado sem ver "Pausado" faz ler nota, visitas e Ads
     como se ele estivesse vendendo. A conta de teste tem 100 pausados.
     =================================================================== */
  check('a análise mostra a situação do anúncio', /situacaoHtml/.test(fonte));
  check('pausado por falta de estoque é distinguido do pausado pelo vendedor',
    /out_of_stock/.test(fonte) && /Pausado — sem estoque/.test(fonte));
  check('a situação aparece junto dos ids, no topo da análise',
    /\$\{situacaoHtml\}[\s\S]{0,200}chipId\('Anúncio'/.test(fonte));

  /* ===================================================================
     PARTE 5 — atalhos e ruído na tela do produto (decisões do Lucas 08/08)
     Conferido também em conta real: MLBU3923551945 (1 anúncio) abre a
     análise direto; MLBU1323129818 (2 anúncios) mantém a escolha.
     =================================================================== */
  check('produto com UM anúncio vinculado pula a tela de escolha',
    /results\.length === 1/.test(fonte) && /return await analisarAnuncio\(unicoId, append\)/.test(fonte));
  check('produto com dois ou mais anúncios mantém a tela de escolha',
    /displayMlbuResults\(detail, itemsData\.results, accessToken\)/.test(fonte));
  check('tags técnicas do produto (ex.: "primary") não vão pra tela',
    /const tagsHtml = '';/.test(fonte) && !/mlbuDetail\.tags\.forEach/.test(fonte));

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
