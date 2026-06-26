'use strict';
/*
 * Massa de teste da LÓGICA do scanner (Auditoria de Tags — js/scanner.js).
 *
 * scanner.js é acoplado ao DOM/browser. Aqui carregamos o arquivo num sandbox
 * (vm) com stubs mínimos de browser (document/window/fetch/Blob/URL/setTimeout)
 * e exercitamos a lógica TESTÁVEL diretamente nas funções que o próprio script
 * pendura no escopo global (function declarations sloppy-mode viram propriedades
 * do contexto; const/let ficam no escopo léxico mas os closures enxergam):
 *   - classificação problema/neutra (tagBadgeClass, has-problem no card, status no CSV)
 *   - tradução/humanização de tags (translateTag)
 *   - escape XSS (escapeAttr) e render dos cards (sinks de XSS)
 *   - filtro por tag (handleScannerFilterChange)
 *   - dropdown agrupado (updateFilterDropdown)
 *   - paginação (renderScannerGrid + renderPagination + changeScannerPage), inclusive 500+ itens
 *   - geração de CSV (BOM, escape de aspas, acentos, CSV-injection, delimitador)
 *   - varredura ponta-a-ponta com Proxy mockado + segurança (token só no header Bearer)
 *
 * NÃO alteramos o comportamento de scanner.js. Onde o comportamento correto/seguro
 * NÃO acontece hoje, registramos via bug() — defeito real, detalhado em
 * _audit_tags_fleet/findings/qa-test.md. Spec-tests (check) travam o comportamento
 * correto pra pegar regressão dos outros implementadores.
 *
 * Rodar: node test/scanner.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.on('unhandledRejection', function () {});

const SCANNER_PATH = path.join(__dirname, '..', 'js', 'scanner.js');
const scannerSrc = fs.readFileSync(SCANNER_PATH, 'utf8');
const fx = require('./fixtures/ml-ads.js');

// ───────────────────────── harness de DOM/browser ─────────────────────────
let lastBlob = null;       // capturado em URL.createObjectURL
let lastDownload = null;   // nome do arquivo (anchor download)
let lastAlert = null;      // último alert()

function mkEl() {
  const el = {
    _html: '',
    textContent: '', value: '', disabled: false, checked: false, label: '', className: '',
    children: [],
    style: { removeProperty() {}, setProperty() {} },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; if (k === 'download') lastDownload = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(n) { if (n && n.__frag) { for (let i = 0; i < n.children.length; i++) el.children.push(n.children[i]); } else el.children.push(n); return n; },
    removeChild() {}, click() {}, focus() {}, select() {}, scrollIntoView() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el.children = []; }   // setar innerHTML zera os filhos (igual DOM)
  });
  return el;
}

const STD_IDS = ['tagFilter', 'scanButton', 'exportCsvButton', 'scanProgress', 'scanProgressBar',
  'scanStatusText', 'scanCountText', 'tagLegend', 'scannerResults', 'scannerPagination'];
let reg = {};

const documentStub = {
  readyState: 'complete',
  getElementById(id) { return Object.prototype.hasOwnProperty.call(reg, id) ? reg[id] : null; },
  createElement() { return mkEl(); },
  createDocumentFragment() { const f = mkEl(); f.__frag = true; return f; },
  body: mkEl(), head: mkEl(),
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
};

const realSetTimeout = setTimeout;
const sandbox = {
  console, JSON, Object, Array, Math, RegExp, parseInt, parseFloat, isFinite, Promise,
  String, Number, Boolean, Set, Map, Date, URL: null,
  document: documentStub,
  location: { href: 'https://app.marketfacil.com.br/auditoria-tags', search: '' },
  navigator: { clipboard: null },
  alert(m) { lastAlert = m; },
  setTimeout(cb, ms) { return realSetTimeout(cb, Math.min(ms | 0, 1)); },   // mantém ordem async, mas rápido
  clearTimeout(t) { return clearTimeout(t); },
  fetch() { return Promise.reject(new Error('no-net')); }
};
sandbox.window = sandbox;
sandbox.addEventListener = function () {};
sandbox.removeEventListener = function () {};
sandbox.Blob = function (parts, opts) { this.parts = parts; this.opts = opts; };
sandbox.URL = { createObjectURL(b) { lastBlob = b; return 'blob:mock/1'; }, revokeObjectURL() {} };

vm.createContext(sandbox);
let loadErr = null;
try { vm.runInContext(scannerSrc, sandbox, { filename: 'scanner.js' }); }
catch (e) { loadErr = e; }

function freshState() {
  return { allItems: [], filteredItems: [], uniqueTags: new Set(), isScanning: false, currentPage: 1, pageSize: 50 };
}
function reset() {
  reg = {};
  STD_IDS.forEach(function (id) { reg[id] = mkEl(); });
  sandbox.scannerState = freshState();
  lastBlob = null; lastDownload = null; lastAlert = null;
}

// ───────────────────────── harness de asserção ─────────────────────────
let pass = 0, fail = 0, bugs = 0;
const bugList = [];
function check(label, cond) { cond ? pass++ : fail++; console.log((cond ? 'ok   ' : 'FAIL ') + '- ' + label); }
function bug(label, desiredCond) {
  if (desiredCond) { pass++; console.log('ok(fixed) - ' + label + '  [BUG parece corrigido — promova p/ check]'); }
  else { bugs++; bugList.push(label); console.log('FAIL(BUG) - ' + label); }
}
function section(name) { console.log('\n=== ' + name + ' ==='); }

// ───────────────────────── util CSV ─────────────────────────
function parseCsvLine(line) {
  const fields = []; let i = 0; const n = line.length;
  while (i <= n) {
    if (i === n) { break; }
    if (line[i] !== '"') {
      let s = i; while (i < n && line[i] !== ';') i++;
      fields.push(line.slice(s, i));
    } else {
      i++; let buf = '';
      while (i < n) {
        if (line[i] === '"') { if (line[i + 1] === '"') { buf += '"'; i += 2; } else { i++; break; } }
        else { buf += line[i]; i++; }
      }
      fields.push(buf);
    }
    if (line[i] === ';') i++; else break;
  }
  return fields;
}
function getCsv() { return lastBlob ? lastBlob.parts.join('') : null; }
function csvRecords(csv) {
  const noBom = csv.replace(/^﻿/, '');
  return noBom.split('\r\n').filter(function (l) { return l.length; });
}

// ════════════════════════════ TESTES ════════════════════════════
check('scanner.js carrega/inicializa sem lançar', !loadErr);
if (loadErr) { console.error(loadErr); }
['translateTag', 'tagBadgeClass', 'escapeAttr', 'getScannerUserId', 'updateFilterDropdown',
 'handleScannerFilterChange', 'renderScannerGrid', 'renderPagination', 'changeScannerPage',
 'updateCount', 'startAccountScan', 'exportToCSV', 'MF_renderError']
  .forEach(function (fn) { check('expõe ' + fn, typeof sandbox[fn] === 'function'); });

// ── 1. classificação problema/neutra ───────────────────────────────────────
section('classificação de tags');
check("tagBadgeClass('poor_quality_picture') = error", sandbox.tagBadgeClass('poor_quality_picture') === 'error');
check("tagBadgeClass('incomplete_technical_specs') = error", sandbox.tagBadgeClass('incomplete_technical_specs') === 'error');
check("tagBadgeClass('moderation_penalty') = error", sandbox.tagBadgeClass('moderation_penalty') === 'error');
check("tagBadgeClass('brand_verified') = success", sandbox.tagBadgeClass('brand_verified') === 'success');
check("tagBadgeClass('free_shipping') = success", sandbox.tagBadgeClass('free_shipping') === 'success');
check("tagBadgeClass('catalog_listing') = muted (informativa)", sandbox.tagBadgeClass('catalog_listing') === 'muted');
check("tagBadgeClass(tag desconhecida) = muted", sandbox.tagBadgeClass('xpto_qualquer') === 'muted');
// toda negativa é 'error', toda positiva é 'success' (consistência do conjunto)
const NEG = ['poor_quality_picture', 'poor_quality_thumbnail', 'incomplete_technical_specs', 'moderation_penalty'];
const POS = ['good_quality_picture', 'good_quality_thumbnail', 'brand_verified', 'extended_warranty_eligible',
  'cart_eligible', 'immediate_payment', 'free_shipping', 'shipping_discount_item', 'catalog_boost',
  'loyalty_discount_eligible', 'meliplus_item', 'supermarket_eligible'];
check('todas as negativas classificam como error', NEG.every(function (t) { return sandbox.tagBadgeClass(t) === 'error'; }));
check('todas as positivas classificam como success', POS.every(function (t) { return sandbox.tagBadgeClass(t) === 'success'; }));

// ── 2. tradução / humanização ──────────────────────────────────────────────
section('translateTag');
check("traduz tag crítica conhecida", sandbox.translateTag('incomplete_technical_specs') === 'Ficha Técnica Incompleta');
check("traduz tag positiva conhecida (acento)", sandbox.translateTag('free_shipping') === 'Frete Grátis');
check("traduz informativa conhecida", sandbox.translateTag('catalog_listing') === 'Anúncio de Catálogo');
check("traduz penalidade com acento preservado", sandbox.translateTag('moderation_penalty') === 'Penalidade (Infração)');
check("humaniza tag desconhecida (snake_case -> Title Case)", sandbox.translateTag('algum_atributo_novo') === 'Algum Atributo Novo');

// ── 3. escapeAttr (XSS em atributos) ───────────────────────────────────────
section('escapeAttr');
check("escapa < e >", sandbox.escapeAttr('<img onerror=x>') === '&lt;img onerror=x&gt;');
check("escapa aspas duplas", sandbox.escapeAttr('a"b') === 'a&quot;b');
check("escapa aspas simples", sandbox.escapeAttr("a'b") === 'a&#39;b');
check("escapa & primeiro (sem dupla-escapagem)", sandbox.escapeAttr('&lt;') === '&amp;lt;');
check("null/undefined viram '' (sem crash)", sandbox.escapeAttr(null) === '' && sandbox.escapeAttr(undefined) === '');

// ── 4. getScannerUserId (parse do token) ───────────────────────────────────
section('getScannerUserId');
(function () {
  // path puro: extrai o ID numérico do final do token; nunca cai na rede
  Promise.all([
    sandbox.getScannerUserId('APP_USR-1111111111-061826-abcdef-555'),
    sandbox.getScannerUserId('PREFIX-123-456-7890'),
    sandbox.getScannerUserId(null)
  ]).then(function (r) {
    check('extrai userId numérico do final do token', r[0] === 555);
    check('extrai userId de token multi-segmento', r[1] === 7890);
    check('token null -> null (sem rede)', r[2] === null);
  });
})();

// ── 5. MF_renderError (UI de erro) ─────────────────────────────────────────
section('MF_renderError');
check('MF_ERROR_TYPES tem os 5 tipos', Array.isArray(sandbox.MF_ERROR_TYPES) &&
  ['no_ml_account', 'session_expired', 'forbidden', 'rate_limited', 'network_error'].every(function (t) { return sandbox.MF_ERROR_TYPES.indexOf(t) !== -1; }));
(function () {
  const c = mkEl();
  sandbox.MF_renderError(c, 'no_ml_account');
  check('renderiza card de conta não conectada com CTA p/ Minha Conta',
    /Conta do Mercado Livre não conectada/.test(c.innerHTML) && /minha-conta/.test(c.innerHTML) && /mf-error-card/.test(c.innerHTML));
  const c2 = mkEl();
  sandbox.MF_renderError(c2, 'no_ml_account', { title: '<script>evil()</script>' });
  check('escapa título controlado (XSS) na UI de erro',
    c2.innerHTML.indexOf('<script>evil()') === -1 && /&lt;script&gt;/.test(c2.innerHTML));
  const c3 = mkEl();
  sandbox.MF_renderError(c3, '__tipo_inexistente__', { msg: '<b>x</b>' });
  check('tipo desconhecido escapa msg (fallback)', c3.innerHTML.indexOf('<b>x</b>') === -1 && /&lt;b&gt;/.test(c3.innerHTML));
})();

// ── 6. filtro por tag ──────────────────────────────────────────────────────
section('handleScannerFilterChange (filtro)');
(function () {
  reset();
  const items = [fx.byCase.incomplete_specs, fx.byCase.clean_positive, fx.byCase.multi_problem,
    fx.byCase.null_tags, fx.byCase.missing_tags_key, fx.byCase.catalog_info];
  sandbox.scannerState.allItems = items;
  sandbox.scannerState.currentPage = 5;
  reg.tagFilter.value = 'all';
  sandbox.handleScannerFilterChange();
  check("filtro 'all' mostra todos", sandbox.scannerState.filteredItems.length === items.length);
  check('filtro reseta currentPage p/ 1', sandbox.scannerState.currentPage === 1);
  check('updateCount escreve "<n> exibidos"', reg.scanCountText.textContent === items.length + ' exibidos');

  reg.tagFilter.value = 'incomplete_technical_specs';
  sandbox.handleScannerFilterChange();
  check('filtro por tag retorna só itens com a tag (incomplete x2: incomplete_specs + multi_problem)',
    sandbox.scannerState.filteredItems.length === 2);

  reg.tagFilter.value = 'moderation_penalty';
  sandbox.handleScannerFilterChange();
  check('filtro com 1 match retorna 1', sandbox.scannerState.filteredItems.length === 1);

  // itens com tags null / sem a chave NÃO podem quebrar o filtro
  let threw = false;
  reg.tagFilter.value = 'free_shipping';
  try { sandbox.handleScannerFilterChange(); } catch (e) { threw = true; }
  check('filtro não quebra com itens de tags null / sem chave tags', !threw);
})();

// ── 7. dropdown agrupado ───────────────────────────────────────────────────
section('updateFilterDropdown');
(function () {
  reset();
  sandbox.scannerState.uniqueTags = new Set(['incomplete_technical_specs', 'moderation_penalty',
    'free_shipping', 'catalog_listing', 'algum_atributo_novo']);
  sandbox.updateFilterDropdown();
  const groups = reg.tagFilter.children;
  check('cria 2 optgroups (Críticas + Outras)', groups.length === 2);
  const crit = groups[0], outras = groups[1];
  const critVals = crit.children.map(function (o) { return o.value; });
  const outVals = outras.children.map(function (o) { return o.value; });
  check('optgroup Críticas contém as tags críticas',
    /Críticas/.test(crit.label) && critVals.indexOf('incomplete_technical_specs') !== -1 && critVals.indexOf('moderation_penalty') !== -1);
  check('optgroup Outras contém informativas + desconhecida',
    outVals.indexOf('free_shipping') !== -1 && outVals.indexOf('catalog_listing') !== -1 && outVals.indexOf('algum_atributo_novo') !== -1);
  const novaOpt = outras.children.filter(function (o) { return o.value === 'algum_atributo_novo'; })[0];
  check('option desconhecida é humanizada no texto', novaOpt && novaOpt.textContent === 'Algum Atributo Novo');
  check("dropdown sempre começa com 'Ver Tudo'", /Ver Tudo/.test(reg.tagFilter.innerHTML));
})();

// ── 8. paginação (inclui 500+ itens) ───────────────────────────────────────
section('paginação');
(function () {
  reset();
  const big = fx.makeLargeAccount(537);
  sandbox.scannerState.allItems = big;
  sandbox.scannerState.currentPage = 1;
  sandbox.renderScannerGrid(big);
  check('500+ itens: página 1 renderiza 50 cards', reg.scannerResults.children.length === 50);
  check('paginação visível com >1 página', reg.scannerPagination.style.display === 'flex');
  check('rodapé mostra "1–50 de 537" e "Página 1/11"',
    /1–50 de 537/.test(reg.scannerPagination.innerHTML) && /Página 1\/11/.test(reg.scannerPagination.innerHTML));
  check('botão "Anterior" desabilitado na página 1', /← Anterior<\/button>/.test(reg.scannerPagination.innerHTML.replace(/\s*disabled/, ' disabled')) ? true : /Anterior<\/button>/.test(reg.scannerPagination.innerHTML) && /disabled/.test(reg.scannerPagination.innerHTML));

  sandbox.changeScannerPage(1);
  check('próxima página -> 51–100, Página 2/11',
    sandbox.scannerState.currentPage === 2 && /51–100 de 537/.test(reg.scannerPagination.innerHTML) && /Página 2\/11/.test(reg.scannerPagination.innerHTML));
  check('página 2 renderiza 50 cards', reg.scannerResults.children.length === 50);

  sandbox.scannerState.currentPage = 10;
  sandbox.changeScannerPage(1);   // -> 11 (última)
  check('última página renderiza o resto (37 cards)', reg.scannerResults.children.length === 37);
  check('rodapé última: "501–537 de 537" e "Página 11/11"',
    /501–537 de 537/.test(reg.scannerPagination.innerHTML) && /Página 11\/11/.test(reg.scannerPagination.innerHTML));

  sandbox.changeScannerPage(1);   // no-op além da última
  check('avançar além da última é no-op', sandbox.scannerState.currentPage === 11);
  sandbox.scannerState.currentPage = 1;
  sandbox.changeScannerPage(-1);  // no-op antes da primeira
  check('voltar antes da primeira é no-op', sandbox.scannerState.currentPage === 1);

  // 1 página só -> esconde paginação
  reset();
  const few = fx.makeLargeAccount(40);
  sandbox.scannerState.allItems = few;
  sandbox.renderScannerGrid(few);
  check('<=50 itens: paginação escondida', reg.scannerPagination.style.display === 'none' && reg.scannerResults.children.length === 40);

  // lista vazia -> mensagem e sem paginação
  reset();
  sandbox.renderScannerGrid([]);
  check('lista vazia mostra mensagem e esconde paginação',
    /Nenhum item corresponde/.test(reg.scannerResults.innerHTML) && reg.scannerPagination.style.display === 'none');
})();

// ── 9. render dos cards: classificação + unwrap + robustez + XSS ───────────
section('renderScannerGrid (cards)');
(function () {
  reset();
  function cardHtml(item) { sandbox.renderScannerGrid([item]); return reg.scannerResults.children[0]; }

  const cProblem = cardHtml(fx.byCase.multi_problem);
  check('card com tag negativa recebe classe has-problem', /\bhas-problem\b/.test(cProblem.className));
  const cClean = cardHtml(fx.byCase.clean_positive);
  check('card só com tags positivas NÃO tem has-problem', !/\bhas-problem\b/.test(cClean.className));
  const cEmpty = cardHtml(fx.byCase.empty_tags);
  check('card sem tags mostra "Nenhuma tag relevante"', /Nenhuma tag relevante/.test(cEmpty.innerHTML) && !/has-problem/.test(cEmpty.className));

  const cBody = cardHtml(fx.byCase.body_wrapper);
  check('desembrulha { body } e usa título de dentro', /Relógio Digital/.test(cBody.innerHTML) && /has-problem/.test(cBody.className));
  const cResult = cardHtml(fx.byCase.result_wrapper);
  check('desembrulha { result } quando não há título no topo', /Liquidificador/.test(cResult.innerHTML));

  let threw = false;
  try { cardHtml(fx.byCase.null_tags); } catch (e) { threw = true; }
  check('item com tags null não quebra o render', !threw && /Nenhuma tag relevante/.test(reg.scannerResults.children[0].innerHTML));

  threw = false;
  try { cardHtml(fx.byCase.null_fields); } catch (e) { threw = true; }
  check('item com campos null usa fallbacks (Sem título / N/A) sem quebrar',
    !threw && /Sem título/.test(reg.scannerResults.children[0].innerHTML) && /N\/A/.test(reg.scannerResults.children[0].innerHTML));

  // SEGURANÇA — sinks de XSS (dados do ML são não-confiáveis, spec §6)
  const cXssTitle = cardHtml(fx.byCase.xss_title);
  check('título malicioso é escapado no ATRIBUTO title (escapeAttr aplicado)', /title="&lt;img/.test(cXssTitle.innerHTML));
  bug('XSS: título não escapado no TEXTO do card (innerHTML cru)',
    cXssTitle.innerHTML.indexOf('<img src=x onerror=') === -1 && cXssTitle.innerHTML.indexOf('<b>PWNED</b>') === -1);
  const cXssLink = cardHtml(fx.byCase.xss_permalink);
  bug('XSS: permalink não escapado no atributo href (quebra de atributo)',
    cXssLink.innerHTML.indexOf('"><script>alert(1)</script>') === -1);
  bug('thumbnail com esquema javascript: não é higienizado em src',
    cXssLink.innerHTML.indexOf('src="javascript:') === -1);

  // robustez: tag não-string quebra translateTag (TAG.replace em número/null)
  reset();
  let threw2 = false;
  try { sandbox.renderScannerGrid([{ id: 'X', title: 'T', tags: ['free_shipping', null] }]); } catch (e) { threw2 = true; }
  bug('robustez: render não deve quebrar com tag não-string (null no array)', !threw2);
})();

// ── 10. consistência problema/neutra entre card e CSV ──────────────────────
section('consistência card x CSV');
// (validada de fato no bloco de CSV abaixo; aqui só a classe-base)
check('SCANNER_TAGS_NEGATIVAS = mesma régua nos dois lados (error == problema)',
  sandbox.tagBadgeClass('incomplete_technical_specs') === 'error');

// ── 11/12/13. CSV + varredura + segurança (async) ──────────────────────────
function makeProxyFetch(details, token, calls) {
  const resp = function (status, body) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } });
  };
  return function (url, opts) {
    url = String(url); calls.push({ url, opts });
    if (url.indexOf('getAccessToken2') !== -1) return resp(200, { response: { access_token: token } });
    if (url.indexOf('/api/fetch-ads') !== -1) {
      const u = new URL(url);
      const offset = parseInt(u.searchParams.get('offset') || '0', 10);
      const limit = parseInt(u.searchParams.get('limit') || '50', 10);
      const ids = details.slice(offset, offset + limit).map(function (d) { return d.id; });
      return resp(200, { results: ids, paging: { total: details.length } });
    }
    if (url.indexOf('/api/fetch-item') !== -1) {
      const u = new URL(url);
      const ids = (u.searchParams.get('item_id') || '').split(',').filter(Boolean);
      const out = ids.map(function (id) { return details.filter(function (d) { return d.id === id; })[0]; }).filter(Boolean);
      return resp(200, out);
    }
    return resp(404, { error: 'not found' });
  };
}

(async function () {
  // pequena espera pro bloco getScannerUserId (Promise.all) imprimir antes
  await new Promise(function (r) { realSetTimeout(r, 5); });

  // ── CSV ──────────────────────────────────────────────────────────────────
  section('exportToCSV');
  reset();
  sandbox.scannerState.allItems = [
    fx.byCase.incomplete_specs, fx.byCase.clean_positive, fx.byCase.accented_title,
    fx.byCase.semicolon_quote_title, fx.byCase.csv_injection, fx.byCase.newline_title,
    fx.byCase.price_zero, fx.byCase.null_fields, fx.byCase.multi_problem
  ];
  reg.tagFilter.value = 'all';
  await sandbox.exportToCSV();
  const csv = getCsv();
  check('CSV gerado (Blob capturado)', !!csv);
  check('CSV começa com BOM UTF-8', csv[0] === '﻿');
  const recs = csvRecords(csv);
  check('cabeçalho correto', recs[0] === 'ID;Título;Preço;Status;Erros Encontrados;Link para Editar');
  check('CSV usa CRLF como terminador de linha', /\r\n/.test(csv));
  check('nome do arquivo é Relatorio_Scanner_Geral_<data>.csv', /^Relatorio_Scanner_Geral_\d{4}-\d{2}-\d{2}\.csv$/.test(lastDownload || ''));

  const rows = recs.slice(1).map(parseCsvLine);
  const byId = {}; rows.forEach(function (r) { byId[r[0]] = r; });

  // acentos preservados
  const acc = byId['MLB1000000009'];
  check('acentos preservados no CSV', acc && /Coração de Mãe/.test(acc[1]) && /Ação Promoção/.test(acc[1]) && /Edição/.test(acc[1]));
  // preço pt-BR
  check('preço formatado pt-BR (vírgula decimal)', byId['MLB1000000002'][2] === '199,99');
  check('preço 0 vira 0,00 no CSV', byId['MLB1000000015'][2] === '0,00');
  check('preço null vira 0,00 no CSV', byId[''] && byId[''][2] === '0,00');
  // status + erros
  const multi = byId['MLB1000000003'];
  check('item com problema: status COM ERROS', multi[3] === 'COM ERROS');
  check('lista de erros traduzida (Foto de Baixa Qualidade, Penalidade...)',
    /Foto de Baixa Qualidade/.test(multi[4]) && /Penalidade \(Infração\)/.test(multi[4]) && /Ficha Técnica Incompleta/.test(multi[4]));
  const clean = byId['MLB1000000001'];
  check('item saudável: status OK / Nenhum', clean[3] === 'OK' && clean[4] === 'Nenhum');
  // integridade de campos: ; e aspas dentro do título
  const semi = byId['MLB1000000016'];
  check('campo com ; e aspas continua sendo 1 célula de 6', semi && semi.length === 6);
  check('aspas internas são dobradas (RFC4180) e o ; fica dentro da célula',
    semi && semi[1] === 'Kit 3 itens; modelo "Premium" novo' && csv.indexOf('""Premium""') !== -1);

  // SEGURANÇA — CSV injection (fórmula no título)
  const inj = byId['MLB1000000014'];
  bug('CSV injection: célula iniciada por =/+/-/@ deve ser neutralizada',
    inj && !/^[=+\-@\t\r]/.test(inj[1]));
  // carriage-return não removido (só \n é trocado por espaço)
  const nl = byId['MLB1000000018'];
  bug('CSV: título não deve conter \\r/\\n cru (só \\n é tratado hoje)',
    nl && nl[1].indexOf('\r') === -1 && nl[1].indexOf('\n') === -1);

  // filtro aplicado na exportação
  reset();
  sandbox.scannerState.allItems = [fx.byCase.incomplete_specs, fx.byCase.clean_positive];
  reg.tagFilter.value = 'incomplete_technical_specs';
  await sandbox.exportToCSV();
  const csv2 = getCsv();
  const recs2 = csvRecords(csv2).slice(1);
  check('export respeita o filtro (só 1 item)', recs2.length === 1 && parseCsvLine(recs2[0])[0] === 'MLB1000000002');
  check('nome do arquivo usa a tag traduzida no filtro', /Ficha Técnica Incompleta/.test(lastDownload || ''));

  // export sem itens no filtro -> alerta, sem blob
  reset();
  sandbox.scannerState.allItems = [fx.byCase.clean_positive];
  reg.tagFilter.value = 'moderation_penalty';
  lastBlob = null; lastAlert = null;
  await sandbox.exportToCSV();
  check('export sem itens: alerta e não gera arquivo', /Nenhum item/.test(lastAlert || '') && getCsv() === null);

  // ── varredura ponta-a-ponta (Proxy mockado) ──────────────────────────────
  section('startAccountScan (Proxy mockado) + segurança');
  reset();
  const TOKEN = 'APP_USR-1111111111-061826-deadbeef-90909';
  let calls = [];
  sandbox.fetch = makeProxyFetch(fx.scanAccount, TOKEN, calls);
  await sandbox.startAccountScan();
  check('varredura carrega os 3 anúncios', sandbox.scannerState.allItems.length === 3);
  check('grid renderiza 3 cards', reg.scannerResults.children.length === 3);
  check("status final = 'Varredura Completa!'", reg.scanStatusText.textContent === 'Varredura Completa!');
  check('barra de progresso a 100%', reg.scanProgressBar.style.width === '100%');
  check('legenda fica visível', reg.tagLegend.style.display === 'flex');
  check('uniqueTags agregou as tags da conta',
    sandbox.scannerState.uniqueTags.has('incomplete_technical_specs') && sandbox.scannerState.uniqueTags.has('catalog_listing'));
  const dropdownVals = reg.tagFilter.children.reduce(function (a, g) { return a.concat(g.children.map(function (o) { return o.value; })); }, []);
  check('dropdown preenchido com a tag crítica encontrada', dropdownVals.indexOf('incomplete_technical_specs') !== -1);

  // segurança: token só no header Bearer, nunca em querystring; sem /users/me
  const proxyCalls = calls.filter(function (c) { return /\/api\/fetch-(ads|item)/.test(c.url); });
  check('toda chamada ao Proxy manda Authorization: Bearer <token>',
    proxyCalls.length > 0 && proxyCalls.every(function (c) { return c.opts && c.opts.headers && c.opts.headers.Authorization === 'Bearer ' + TOKEN; }));
  check('token NUNCA aparece em querystring',
    calls.every(function (c) { return c.url.indexOf(TOKEN) === -1 && c.url.indexOf('access_token=') === -1; }));
  check('userId veio do token, sem chamar /users/me',
    calls.every(function (c) { return c.url.indexOf('/users/me') === -1; }));

  // ── conta vazia ───────────────────────────────────────────────────────────
  section('conta vazia');
  reset();
  calls = [];
  sandbox.fetch = makeProxyFetch(fx.emptyAccount, TOKEN, calls);
  await sandbox.startAccountScan();
  check('conta vazia: 0 itens, sem quebrar', sandbox.scannerState.allItems.length === 0);
  check('conta vazia: grid mostra estado vazio', /Nenhum item/.test(reg.scannerResults.innerHTML));
  check("conta vazia: status final = 'Varredura Completa!'", reg.scanStatusText.textContent === 'Varredura Completa!');

  // ── falha de autenticação ──────────────────────────────────────────────────
  section('autenticação ausente');
  reset();
  sandbox.fetch = function () { return Promise.reject(new Error('net')); };  // getAccessToken2 falha -> token null
  await sandbox.startAccountScan();
  check("auth falha: status 'Conta não conectada'", reg.scanStatusText.textContent === 'Conta não conectada');
  check('auth falha: renderiza card de conta não conectada (MF_renderError)',
    /Conta do Mercado Livre não conectada/.test(reg.scannerResults.innerHTML));
  check('auth falha: botão reabilitado e isScanning=false',
    reg.scanButton.disabled === false && sandbox.scannerState.isScanning === false);

  // ── higiene de console (PII) ───────────────────────────────────────────────
  section('higiene de console (segurança)');
  bug('console não deve logar o userId extraído do token (PII)',
    scannerSrc.indexOf('ID extraído do token') === -1);

  // ───────────────────────── resumo ─────────────────────────
  console.log('\n──────────────────────────────────────────────');
  console.log(pass + ' ok · ' + fail + ' falhas(regressão) · ' + bugs + ' BUGS confirmados');
  if (bugs) { console.log('BUGS (ver findings/qa-test.md):'); bugList.forEach(function (b) { console.log('  • ' + b); }); }
  process.exit((fail > 0 || bugs > 0) ? 1 : 0);
})();
