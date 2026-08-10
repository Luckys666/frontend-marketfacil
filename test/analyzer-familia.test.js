'use strict';
/*
 * Régua de editabilidade de campos em anúncio de FAMÍLIA (js/analyzer.js).
 *
 * O que está travado aqui (medido em conta real 05/08/2026, família de 8 UPs sem vendas):
 *   - `hierarchy: FAMILY` (Voltagem da bateria, Forma de caimento…) É editável pelo app:
 *     o PUT no item grava e o family_id não muda. Antes vinha marcado "só no ML".
 *   - `hierarchy: PARENT_PK` (Marca, Modelo) continua bloqueado: é o que agrupa as
 *     variações — mudar pelo item tira o anúncio do grupo.
 *   - Item FORA de família não sofre nenhuma das duas restrições.
 *   - A régua é UMA só (mfMotivoNaoEditavel): lista de campos, lápis de edição,
 *     pontuação e cartão de variação têm que concordar — três contagens divergentes já
 *     foram bug antes (09/07 e 05/08).
 *
 * analyzer.js é acoplado ao browser: carregamos num sandbox (vm) com stubs mínimos.
 * Rodar: node test/analyzer-familia.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

// ───────────────────────── harness de DOM/browser ─────────────────────────
// Alguns renders pendurram listeners em nós que só existem depois do innerHTML
// (ex.: o seletor de ordenação da visão de família). Com looseQS ligado, o stub
// devolve um nó vazio em vez de null — o suficiente pra função terminar.
let looseQS = false;
function mkEl(id) {
  const el = {
    id: id || '', _html: '', textContent: '', value: '', disabled: false, className: '',
    children: [], style: { removeProperty() {}, setProperty() {} }, _attrs: {}, dataset: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(n) { this.children.push(n); return n; },
    removeChild() {}, click() {}, focus() {}, select() {}, scrollIntoView() {},
    addEventListener() {}, removeEventListener() {}, remove() {},
    querySelector() { return looseQS ? mkEl() : null; }, querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el.children = []; }
  });
  return el;
}

const reg = {};
const documentStub = {
  readyState: 'complete',
  getElementById(id) { if (!reg[id]) reg[id] = mkEl(id); return reg[id]; },
  createElement() { return mkEl(); },
  createDocumentFragment() { return mkEl(); },
  body: mkEl('body'), head: mkEl('head'),
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
};

const storage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

const sandbox = {
  console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
  parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
  setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
  setInterval() { return 0; }, clearInterval() {},
  localStorage: storage, sessionStorage: storage,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  document: documentStub,
  navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.location = { href: 'https://app.marketfacil.com.br/version-test/analise-anuncio', search: '' };
sandbox.window.location = sandbox.location;

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'analyzer.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'analyzer.js' });

// Funções sloppy-mode viram propriedades do contexto; as que não vierem, buscamos via eval.
const get = (nome) => sandbox[nome] || vm.runInContext(`typeof ${nome} !== 'undefined' ? ${nome} : undefined`, sandbox);
const mfMotivoNaoEditavel = get('mfMotivoNaoEditavel');
const mfCampoEditavel = get('mfCampoEditavel');
const mfSoNoML = get('mfSoNoML');
const MF_textoCampoBloqueado = get('MF_textoCampoBloqueado');
const HIER_VARIACAO = get('MF_VARIATION_EDITABLE_HIERARCHIES');
const exibirAtributosCategoria = get('exibirAtributosCategoria');
const MF_renderFamilyOverview = get('MF_renderFamilyOverview');

// ───────────────────────── massa de teste ─────────────────────────
const A = {
  familyAttr:   { id: 'BATTERY_VOLTAGE', name: 'Voltagem da bateria', value_type: 'string', hierarchy: 'FAMILY', tags: { required: true } },
  familyAttr2:  { id: 'CELL_BATTERY_TYPE', name: 'Tipo de pilha', value_type: 'list', hierarchy: 'FAMILY', tags: {}, values: [{ id: 'V1', name: 'AA' }] },
  parentPk:     { id: 'BRAND', name: 'Marca', value_type: 'string', hierarchy: 'PARENT_PK', tags: { required: true } },
  parentPk2:    { id: 'MODEL', name: 'Modelo', value_type: 'string', hierarchy: 'PARENT_PK', tags: {} },
  itemAttr:     { id: 'SELLER_SKU', name: 'SKU', value_type: 'string', hierarchy: 'ITEM', tags: {} },
  childPk:      { id: 'COLOR', name: 'Cor', value_type: 'list', hierarchy: 'CHILD_PK', tags: {} },
  readOnly:     { id: 'PACKAGE_DATA_SOURCE', name: 'Origem do pacote', value_type: 'string', hierarchy: 'ITEM', tags: { read_only: true } },
  sistema:      { id: 'GIFTABLE', name: 'Regalavel vppfull', value_type: 'string', hierarchy: 'ITEM', tags: {} },
  tipoEstranho: { id: 'SOME_BINARY', name: 'Binário', value_type: 'binary', hierarchy: 'ITEM', tags: {} }
};

const itemEmFamilia = {
  id: 'MLB6683355898', user_product_id: 'MLBU3935195960', family_id: '774884615150225',
  // COLOR já tem valor (seguro trocar); FABRIC_DESIGN está vazio (preencher desvincula)
  attributes: [{ id: 'COLOR', value_name: 'Preto' }, { id: 'FABRIC_DESIGN', value_name: '' }],
};
const itemSolto = { id: 'MLB1111111111', attributes: [] };
const itemComVariacoes = { id: 'MLB2222222222', attributes: [], variations: [{ id: 1 }] };

console.log('analyzer-familia.test.js');

// ── 1. régua base ────────────────────────────────────────────────────────
check('FAMILY em anúncio de família É editável (era o bloqueio que caiu)',
  mfMotivoNaoEditavel(A.familyAttr, itemEmFamilia) === null, String(mfMotivoNaoEditavel(A.familyAttr, itemEmFamilia)));
check('FAMILY de tipo list também é editável',
  mfMotivoNaoEditavel(A.familyAttr2, itemEmFamilia) === null);
check('PARENT_PK em anúncio de família continua bloqueado',
  mfMotivoNaoEditavel(A.parentPk, itemEmFamilia) === 'familia', String(mfMotivoNaoEditavel(A.parentPk, itemEmFamilia)));
check('PARENT_PK em anúncio SOLTO é editável (não há família pra quebrar)',
  mfMotivoNaoEditavel(A.parentPk, itemSolto) === null);
check('FAMILY em anúncio solto é editável', mfMotivoNaoEditavel(A.familyAttr, itemSolto) === null);
check('ITEM (SKU) segue editável em família', mfMotivoNaoEditavel(A.itemAttr, itemEmFamilia) === null);
check('read_only continua fora da conta', mfMotivoNaoEditavel(A.readOnly, itemEmFamilia) === 'sistema');
check('atributo de sistema (GIFTABLE) continua fora', mfMotivoNaoEditavel(A.sistema, itemEmFamilia) === 'sistema');
check('value_type sem campo de edição continua fora', mfMotivoNaoEditavel(A.tipoEstranho, itemSolto) === 'tipo');
check('atributo de variação em anúncio COM variations continua na tela de variações',
  mfMotivoNaoEditavel(A.childPk, itemComVariacoes) === 'variacao');
check('mfCampoEditavel concorda com mfMotivoNaoEditavel',
  mfCampoEditavel(A.familyAttr, itemEmFamilia) === true && mfCampoEditavel(A.parentPk, itemEmFamilia) === false);

// ── 1b. CHILD_PK: os dois lados bloqueiam, por motivos diferentes ─────────
// Vazio → ganhar o atributo tira o anúncio do grupo de variações.
// Preenchido → o valor é o NOME da variação: muda título, permalink e zera o histórico.
const fabric = { id: 'FABRIC_DESIGN', name: 'Desenho do tecido', value_type: 'string', hierarchy: 'CHILD_PK', tags: {} };
check('CHILD_PK VAZIO em família fica bloqueado (preencher tiraria do grupo)',
  mfMotivoNaoEditavel(fabric, itemEmFamilia) === 'familia', String(mfMotivoNaoEditavel(fabric, itemEmFamilia)));
check('CHILD_PK PREENCHIDO é bloqueado: renomear a variação muda o link do anúncio',
  mfMotivoNaoEditavel(A.childPk, itemEmFamilia) === 'nomevariacao', String(mfMotivoNaoEditavel(A.childPk, itemEmFamilia)));
check('renomear variação tem texto próprio (fala de link e histórico, não de grupo)',
  /link do anúncio/i.test(MF_textoCampoBloqueado(A.childPk, 'nomevariacao'))
  && !/grupo/i.test(MF_textoCampoBloqueado(A.childPk, 'nomevariacao')),
  MF_textoCampoBloqueado(A.childPk, 'nomevariacao'));
check('os dois motivos contam como "só no ML" (escondem o lápis)',
  mfSoNoML(A.childPk, itemEmFamilia) === true && mfSoNoML(A.parentPk, itemEmFamilia) === true
  && mfSoNoML(A.familyAttr, itemEmFamilia) === false);
check('CHILD_PK vazio em anúncio SOLTO continua editável (não há família)',
  mfMotivoNaoEditavel(fabric, itemSolto) === null);
check('CHILD_PK preenchido em anúncio SOLTO continua editável (não nomeia variação)',
  mfMotivoNaoEditavel(A.childPk, itemSolto) === null, String(mfMotivoNaoEditavel(A.childPk, itemSolto)));

// ── 1c. ITEM_CONDITION: a hierarchy mente (vem como ITEM) ───────────────
// A ML devolve hierarchy: ITEM, mas a doc lista ITEM_CONDITION entre os campos que
// calculam o family_id — trocar Novo↔Usado em anúncio de família quebra o grupo.
const condicao = { id: 'ITEM_CONDITION', name: 'Condição do item', value_type: 'list', hierarchy: 'ITEM', tags: { hidden: true }, values: [{ id: '1', name: 'Novo' }, { id: '2', name: 'Usado' }] };
check('ITEM_CONDITION em anúncio de família fica bloqueado',
  mfMotivoNaoEditavel(condicao, itemEmFamilia) === 'familia', String(mfMotivoNaoEditavel(condicao, itemEmFamilia)));
check('ITEM_CONDITION em anúncio solto continua editável (não há grupo pra quebrar)',
  mfMotivoNaoEditavel(condicao, itemSolto) === null);

// ── 2. hierarquias do editor por variação ────────────────────────────────
check('painel de variação passa a oferecer FAMILY', HIER_VARIACAO && HIER_VARIACAO.has('FAMILY'));
check('painel de variação NÃO oferece PARENT_PK', HIER_VARIACAO && !HIER_VARIACAO.has('PARENT_PK'));
check('painel de variação NÃO oferece CHILD_PK (é o nome da variação)',
  HIER_VARIACAO && !HIER_VARIACAO.has('CHILD_PK'));
check('painel de variação mantém CHILD_DEPENDENT/ITEM/PRODUCT_IDENTIFIER',
  ['CHILD_DEPENDENT', 'ITEM', 'PRODUCT_IDENTIFIER'].every((h) => HIER_VARIACAO.has(h)));

// ── 3. o que a tela renderiza ────────────────────────────────────────────
const CATS_TELA = [A.familyAttr, A.parentPk, A.itemAttr, fabric, A.childPk, condicao];
sandbox.window.currentAnalysisState = {
  detail: itemEmFamilia,
  categoryAttributes: CATS_TELA,
  containerIdSuffix: ''
};
sandbox.window.ignoredAdAttributes = new sandbox.Set();
const alvo = documentStub.getElementById('categoryAttributes');
exibirAtributosCategoria(CATS_TELA, itemEmFamilia.attributes, 'categoryAttributes');
const html = alvo.innerHTML;
check('campo FAMILY aparece com lápis de edição', html.includes("openAttrEditor('BATTERY_VOLTAGE')"), html.slice(0, 200));
check('campo PARENT_PK NÃO aparece com lápis', !html.includes("openAttrEditor('BRAND')"));
check('campo PARENT_PK some da lista de tarefas (sai da conta)', !html.includes('Marca'));
check('campo FAMILY entra na lista como campo a preencher', html.includes('Voltagem da bateria'));
check('CHILD_PK vazio NÃO aparece com lápis', !html.includes("openAttrEditor('FABRIC_DESIGN')"));
check('CHILD_PK vazio some da lista de tarefas', !html.includes('Desenho do tecido'));
check('CHILD_PK preenchido NÃO tem mais lápis (renomear muda o link)', !html.includes("openAttrEditor('COLOR')"));
// Sai da lista inteira, como Marca/Modelo em família: campo que o vendedor não mexe não
// vira tarefa. A nota explicativa foi zerada em 05/08 (Lucas: menos avisos na tela) — a
// cor continua visível no painel de variações e no próprio título do anúncio.
check('CHILD_PK preenchido sai da lista de campos (não vira tarefa impossível)',
  !html.includes("attr-edit-wrapper-COLOR"), html.slice(0, 200));
// Sai das etapas, mas NÃO some da tela: travar só resolve o lado do app — quem renomear
// pelo ML perde a exposição igual, e precisa ter lido o preço em algum lugar.
check('nome da variação aparece em faixa própria, com o valor atual',
  html.includes('Cor:') && html.includes('Preto'), html.slice(-600));
check('a faixa avisa que vale também para o Mercado Livre',
  /aqui ou no Mercado Livre/.test(html));
check('a faixa fala em perder exposição, não em jargão de familia/permalink',
  /perde a exposi/.test(html) && !/permalink/i.test(html));
check('a faixa nao oferece edicao (nem lapis, nem editor)',
  !html.includes("openAttrEditor('COLOR')"));
check('Condição do item não tem lápis em anúncio de família', !html.includes("openAttrEditor('ITEM_CONDITION')"));

// ── 3b. nem abrir editor, nem enviar: campo bloqueado não vira requisição ──
const openAttrEditor = get('openAttrEditor') || sandbox.window.openAttrEditor;
const saveAttr = sandbox.window.saveAttr;
let houveFetch = 0;
sandbox.fetch = async () => { houveFetch++; return { ok: true, status: 200, json: async () => ({}) }; };
sandbox.window.fetch = sandbox.fetch;
sandbox.window.currentAnalysisState.accessToken = 'token-de-teste';

// abrir o editor de um campo bloqueado devolve explicação, não campo de digitação
const wrapperCond = documentStub.getElementById('attr-edit-wrapper-ITEM_CONDITION');
openAttrEditor('ITEM_CONDITION');
check('abrir editor de campo bloqueado mostra o motivo, não um input',
  /define o grupo de varia|Mercado Livre/.test(wrapperCond.innerHTML) && !wrapperCond.innerHTML.includes('attr-input-ITEM_CONDITION'),
  wrapperCond.innerHTML.slice(0, 160));

// e mesmo forçando o salvar, nada é enviado
const inputForjado = documentStub.getElementById('attr-input-ITEM_CONDITION');
inputForjado.value = 'Usado';
inputForjado.tagName = 'INPUT';
saveAttr('ITEM_CONDITION');   // a guarda roda antes de qualquer await, então não precisa esperar
check('salvar campo bloqueado não dispara requisição', houveFetch === 0, `fetch chamado ${houveFetch}x`);
const erroCond = documentStub.getElementById('attr-edit-error-ITEM_CONDITION');
check('salvar campo bloqueado explica o motivo na tela', /grupo de varia/.test(erroCond.textContent || ''), erroCond.textContent);

// ── 4. visão de família: selo e nota ─────────────────────────────────────
looseQS = true;
const overviewBody = mkEl('ov');
sandbox.window.currentAnalysisState.categoryAttributes = [A.familyAttr, A.parentPk, A.parentPk2];
MF_renderFamilyOverview({
  family: { name: 'Família teste' },
  variations: [{ up_id: 'MLBU1', item_id: 'MLB1', status: 'active', price: 10, available_quantity: 5, item_attributes: [] }],
  common_attrs: [
    { id: 'BRAND', value_name: 'Acme' },
    { id: 'BATTERY_VOLTAGE', value_name: '12 V' }
  ]
}, overviewBody);
const ovHtml = overviewBody.innerHTML;
check('visão de família marca "só no ML" no PARENT_PK', /Marca<span class="mfd-fb-shared-tag"|Marca\s*<span class="mfd-fb-shared-tag"/.test(ovHtml), ovHtml.slice(0, 300));
check('visão de família NÃO marca o campo FAMILY',
  !/Voltagem da bateria\s*<span class="mfd-fb-shared-tag"/.test(ovHtml));
check('nota mista explica os dois casos', ovHtml.includes('os outros você preenche abrindo a variação'), ovHtml.slice(-400));

const soAgrupador = mkEl('ov2');
MF_renderFamilyOverview({
  family: { name: 'F' }, variations: [{ up_id: 'U', item_id: 'I', status: 'active', price: 1, available_quantity: 1, item_attributes: [] }],
  common_attrs: [{ id: 'BRAND', value_name: 'Acme' }]
}, soAgrupador);
check('só PARENT_PK → nota diz que só o ML edita',
  soAgrupador.innerHTML.includes('Esses campos agrupam as variações — só o Mercado Livre edita.'));

const soFamily = mkEl('ov3');
MF_renderFamilyOverview({
  family: { name: 'F' }, variations: [{ up_id: 'U', item_id: 'I', status: 'active', price: 1, available_quantity: 1, item_attributes: [] }],
  common_attrs: [{ id: 'BATTERY_VOLTAGE', value_name: '12 V' }]
}, soFamily);
check('só FAMILY → nota manda preencher pela variação',
  soFamily.innerHTML.includes('Preencha estes campos abrindo a variação.'));

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
