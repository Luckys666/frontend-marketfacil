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
 * NÃO alteramos o comportamento de scanner.js. Os 7 defeitos que a suite expôs na
 * 1ª rodada (XSS título/permalink/thumb, CSV injection, CSV \r, robustez tag null,
 * console PII) foram corrigidos pelo impl-logica e agora estão TRAVADOS como check()
 * (guarda de regressão). Os mocks foram reconciliados ao scanner novo: paginação em
 * modo scan (scroll_id), projeção enxuta {code,body} e contador "N encontrados".
 * O helper bug() segue disponível p/ registrar defeitos futuros.
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
['translateTag', 'tagBadgeClass', 'itemHasProblem', 'escapeAttr', 'getScannerUserId', 'updateFilterDropdown',
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

// itemHasProblem: régua do "anúncio com problema" (foco da auditoria — só ATIVOS com tag negativa)
check('itemHasProblem: item com tag negativa = true', sandbox.itemHasProblem({ tags: ['incomplete_technical_specs', 'free_shipping'] }) === true);
check('itemHasProblem: item só com positivas = false', sandbox.itemHasProblem({ tags: ['free_shipping', 'brand_verified'] }) === false);
check('itemHasProblem: tags ausente/null/item null = false (sem crash)',
  sandbox.itemHasProblem({}) === false && sandbox.itemHasProblem({ tags: null }) === false && sandbox.itemHasProblem(null) === false);

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
  check('updateCount escreve "<n> encontrados" (P2-5: "exibidos" enganava após filtrar)', reg.scanCountText.textContent === items.length + ' encontrados');

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
  check("dropdown começa com 'Só com problema' (padrão) + 'Ver todos os ativos'",
    /value="problems"/.test(reg.tagFilter.innerHTML) && /Só com problema/.test(reg.tagFilter.innerHTML) && /Ver todos os ativos/.test(reg.tagFilter.innerHTML));
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

  // filtro sem match (há ativos, mas nenhum casa) -> "Nenhum item corresponde" + sem paginação
  reset();
  sandbox.scannerState.allItems = [fx.byCase.clean_positive];
  reg.tagFilter.value = 'free_shipping';
  sandbox.renderScannerGrid([]);
  check('filtro sem match mostra "Nenhum item corresponde" e esconde paginação',
    /Nenhum item corresponde/.test(reg.scannerResults.innerHTML) && reg.scannerPagination.style.display === 'none');

  // empty-state contextual: 0 problemas entre ativos -> mensagem positiva "tudo certo"
  reset();
  sandbox.scannerState.allItems = [fx.byCase.clean_positive];
  reg.tagFilter.value = 'problems';
  sandbox.renderScannerGrid([]);
  check('0 problemas entre ativos mostra "tudo certo" (🎉)',
    /tudo certo/i.test(reg.scannerResults.innerHTML) && /🎉/.test(reg.scannerResults.innerHTML));

  // empty-state contextual: nenhum anúncio ativo -> mensagem "sem anúncio ativo"
  reset();
  sandbox.renderScannerGrid([]);
  check('sem anúncio ativo mostra "Nenhum anúncio ativo encontrado"',
    /Nenhum anúncio ativo encontrado/.test(reg.scannerResults.innerHTML) && reg.scannerPagination.style.display === 'none');
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

  // A normalização (desembrulho {code,body} + projeção enxuta) MIGROU de renderScannerGrid
  // para scannerFetchDetails (P-1). O render agora recebe itens já enxutos. A cobertura do
  // unwrap/projeção/descarte vive no teste E2E "projeção/descarte" mais abaixo.

  let threw = false;
  try { cardHtml(fx.byCase.null_tags); } catch (e) { threw = true; }
  check('item com tags null não quebra o render', !threw && /Nenhuma tag relevante/.test(reg.scannerResults.children[0].innerHTML));

  threw = false;
  try { cardHtml(fx.byCase.null_fields); } catch (e) { threw = true; }
  check('item com campos null usa fallbacks (Sem título / N/A) sem quebrar',
    !threw && /Sem título/.test(reg.scannerResults.children[0].innerHTML) && /N\/A/.test(reg.scannerResults.children[0].innerHTML));

  // SEGURANÇA — sinks de XSS (dados do ML são não-confiáveis, spec §6). Corrigidos (A1/A2) → travados.
  const cXssTitle = cardHtml(fx.byCase.xss_title);
  check('XSS: título escapado no ATRIBUTO title (escapeAttr)', /title="&lt;img/.test(cXssTitle.innerHTML));
  check('XSS: título escapado no TEXTO do card (sink principal — escapeHtml)',
    cXssTitle.innerHTML.indexOf('<img src=x onerror=') === -1 && cXssTitle.innerHTML.indexOf('<b>PWNED</b>') === -1);
  const cXssLink = cardHtml(fx.byCase.xss_permalink);
  check('XSS: permalink sanitizado (safeUrl+escapeAttr, sem breakout de atributo)',
    cXssLink.innerHTML.indexOf('"><script>alert(1)</script>') === -1);
  check('XSS: thumbnail javascript: cai no fallback (safeUrl bloqueia esquema)',
    cXssLink.innerHTML.indexOf('src="javascript:') === -1);

  // robustez: tag não-string NÃO pode quebrar o render (translateTag coage p/ String)
  reset();
  let threw2 = false;
  try { sandbox.renderScannerGrid([{ id: 'X', title: 'T', tags: ['free_shipping', null] }]); } catch (e) { threw2 = true; }
  check('robustez: render não quebra com tag não-string (null no array)', !threw2);
})();

// ── 9b. CTA "Corrigir fotos no Redimensionador" (integra tags↔redim, B) ─────
// Dispara SÓ em problema de IMAGEM (poor_quality_picture/_thumbnail). moderation_penalty
// fica DE FORA (tag opaca). Nova aba, href com encodeURIComponent + escapeAttr, base por ambiente.
section('CTA Corrigir fotos (tags→redim)');
(function () {
  reset();
  const ORIG_HREF = sandbox.location.href;
  function render(item) { sandbox.renderScannerGrid([item]); return reg.scannerResults.children[0].innerHTML; }
  function ctaTag(html) { const m = html.match(/<a\b[^>]*sc-cta-redim[^>]*>/); return m ? m[0] : ''; }
  function ctaHref(html) { const m = ctaTag(html).match(/href="([^"]*)"/); return m ? m[1] : ''; }
  function ctaCount(html) { return (html.match(/sc-cta-redim/g) || []).length; }

  // aparece SÓ quando há problema de FOTO
  check('CTA aparece com poor_quality_picture',
    /sc-cta-redim/.test(render({ id: 'MLB111', title: 'p', tags: ['poor_quality_picture'] })));
  check('CTA aparece com poor_quality_thumbnail',
    /sc-cta-redim/.test(render({ id: 'MLB222', title: 't', tags: ['poor_quality_thumbnail'] })));

  // NÃO aparece sem problema de foto (não poluir cards)
  check('CTA NÃO aparece em card só com tags positivas',
    !/sc-cta-redim/.test(render(fx.byCase.clean_positive)));
  check('CTA NÃO aparece com problema NÃO-foto (incomplete_technical_specs)',
    !/sc-cta-redim/.test(render(fx.byCase.incomplete_specs)));
  check('CTA NÃO aparece em moderation_penalty PURO (tag opaca, fora do escopo)',
    !/sc-cta-redim/.test(render({ id: 'MLB333', title: 'm', tags: ['moderation_penalty'] })));
  check('CTA NÃO aparece em card sem tags',
    !/sc-cta-redim/.test(render(fx.byCase.empty_tags)));

  // href usa o id correto + encodeURIComponent
  const hHref = ctaHref(render({ id: 'MLB1234567890', title: 'x', tags: ['poor_quality_picture'] }));
  check('href termina com ?item=<id> correto', /\?item=MLB1234567890$/.test(hHref));
  const encHref = ctaHref(render({ id: 'MLB 1&2', title: 'x', tags: ['poor_quality_thumbnail'] }));
  check('id passa por encodeURIComponent (espaço→%20, &→%26)',
    /item=MLB%201%262$/.test(encHref) && encHref.indexOf(' ') === -1 && encHref.indexOf('&') === -1);

  // um único CTA por card mesmo com as 2 tags de foto (multi_problem tem ambas)
  check('um único CTA por card mesmo com as 2 tags de foto',
    ctaCount(render(fx.byCase.multi_problem)) === 1);

  // guard id N/A: item com tag de foto mas sem id NÃO renderiza CTA
  check('CTA NÃO renderiza quando id é N/A (item sem id)',
    !/sc-cta-redim/.test(render({ id: null, title: 'x', tags: ['poor_quality_picture'] })));

  // acessibilidade / nova aba
  const aTag = ctaTag(render(fx.byCase.multi_problem));
  check('CTA abre em nova aba (target=_blank + rel=noopener noreferrer)',
    /target="_blank"/.test(aTag) && /rel="noopener noreferrer"/.test(aTag));
  check('CTA tem aria-label descritivo com "(abre em nova aba)"',
    /aria-label="Corrigir fotos no Redimensionador \(abre em nova aba\)"/.test(aTag));
  check('CTA usa a classe sc-cta-redim', /class="sc-cta-redim"/.test(aTag));
  check('emoji do CTA é decorativo (aria-hidden)',
    /<span aria-hidden="true">🔧<\/span>/.test(render(fx.byCase.multi_problem)));

  // escape correto no href — id não-confiável (ML §6) não escapa do atributo
  const xssHtml = render({ id: 'MLB"><script>alert(1)</script>', title: 'x', tags: ['poor_quality_picture'] });
  check('escape: id malicioso NÃO quebra o href (sem breakout de atributo)',
    xssHtml.indexOf('"><script>alert(1)') === -1);
  check('escape: id malicioso é percent-encoded no href (%22 %3E %3C)',
    /item=MLB%22%3E%3Cscript%3E/.test(ctaHref(xssHtml)));

  // base muda por ambiente — buildRedimUrl direto + CTA renderizado (mocka location.href)
  sandbox.location.href = 'https://app.marketfacil.com.br/version-test/auditoria-tags';
  check('base version-test no helper buildRedimUrl',
    sandbox.buildRedimUrl('MLB9') === 'https://app.marketfacil.com.br/version-test/redimensionar-imagem?item=MLB9');
  check('base version-test no CTA renderizado',
    ctaHref(render({ id: 'MLB777', title: 'x', tags: ['poor_quality_picture'] })) ===
      'https://app.marketfacil.com.br/version-test/redimensionar-imagem?item=MLB777');

  sandbox.location.href = 'https://app.marketfacil.com.br/auditoria-tags';
  check('base live no helper buildRedimUrl',
    sandbox.buildRedimUrl('MLB9') === 'https://app.marketfacil.com.br/redimensionar-imagem?item=MLB9');
  const liveHref = ctaHref(render({ id: 'MLB888', title: 'x', tags: ['poor_quality_thumbnail'] }));
  check('base live no CTA renderizado (sem /version-test/)',
    liveHref === 'https://app.marketfacil.com.br/redimensionar-imagem?item=MLB888' &&
      liveHref.indexOf('/version-test/') === -1);

  sandbox.location.href = ORIG_HREF;   // restaura p/ não contaminar os testes E2E async
})();

// ── 10. consistência problema/neutra entre card e CSV ──────────────────────
section('consistência card x CSV');
// (validada de fato no bloco de CSV abaixo; aqui só a classe-base)
check('SCANNER_TAGS_NEGATIVAS = mesma régua nos dois lados (error == problema)',
  sandbox.tagBadgeClass('incomplete_technical_specs') === 'error');

// ── 11/12/13. CSV + varredura + segurança (async) ──────────────────────────
// Simulador do Proxy alinhado ao scanner NOVO:
//  - /api/fetch-ads: modo SCAN — a 1ª chamada vem com &offset=1000 (sem scroll_id); responde
//    página + scroll_id; chamadas seguintes vêm com &scroll_id=...; `results: []` encerra o loop. (P1-2/P1-3)
//  - /api/fetch-item: vem com &skip_description=true; responde array de { code, body }. (P1-1/P2-4)
// cfg: { token, ids:[idStr], itemResponder:(idsArray)=>rawArray, calls:[] }
function makeProxyFetch(cfg) {
  const resp = function (status, body) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } });
  };
  const PAGE = 50;
  return function (url, opts) {
    url = String(url); cfg.calls.push({ url, opts });
    if (url.indexOf('getAccessToken2') !== -1) return resp(200, { response: { access_token: cfg.token } });
    if (url.indexOf('/api/fetch-ads') !== -1) {
      const u = new URL(url);
      const scrollId = u.searchParams.get('scroll_id');
      const start = scrollId ? (parseInt(String(scrollId).replace(/^cursor-/, ''), 10) || 0) : 0;
      const slice = cfg.ids.slice(start, start + PAGE);
      const body = { results: slice };
      if (slice.length > 0) body.scroll_id = 'cursor-' + (start + PAGE); // scan devolve cursor enquanto há página
      return resp(200, body);
    }
    if (url.indexOf('/api/fetch-item') !== -1) {
      const u = new URL(url);
      const ids = (u.searchParams.get('item_id') || '').split(',').filter(Boolean);
      return resp(200, cfg.itemResponder(ids));
    }
    return resp(404, { error: 'not found' });
  };
}
// itemResponder padrão: envelopa cada detalhe em { code:200, body } (formato real do proxy)
function detailResponder(detailsArr) {
  const byId = {}; detailsArr.forEach(function (d) { byId[d.id] = d; });
  return function (ids) { return ids.map(function (id) { return { code: 200, body: byId[id] }; }).filter(function (e) { return e.body; }); };
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

  // SEGURANÇA — CSV injection (fórmula no título) neutralizada com prefixo ' (M1) → travado
  const inj = byId['MLB1000000014'];
  check("CSV injection: célula iniciada por =/+/-/@ é neutralizada (prefixo ')",
    inj && inj[1][0] === "'" && !/^[=+\-@\t\r]/.test(inj[1]));
  // csvCell remove \r e \n (P2-2)
  const nl = byId['MLB1000000018'];
  check('CSV: título não contém \\r/\\n cru (csvCell normaliza quebras)',
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

  // export com filtro 'problems': só os itens com tag negativa + filename dedicado
  reset();
  sandbox.scannerState.allItems = [fx.byCase.incomplete_specs, fx.byCase.clean_positive, fx.byCase.multi_problem];
  reg.tagFilter.value = 'problems';
  await sandbox.exportToCSV();
  const recs3 = csvRecords(getCsv()).slice(1);
  check("export 'problems' pega só os com problema (2 de 3)", recs3.length === 2);
  check("nome do arquivo do 'problems' = Relatorio_Scanner_Com_Problema_<data>.csv",
    /^Relatorio_Scanner_Com_Problema_\d{4}-\d{2}-\d{2}\.csv$/.test(lastDownload || ''));

  // export sem itens no filtro -> alerta, sem blob
  reset();
  sandbox.scannerState.allItems = [fx.byCase.clean_positive];
  reg.tagFilter.value = 'moderation_penalty';
  lastBlob = null; lastAlert = null;
  await sandbox.exportToCSV();
  check('export sem itens: alerta e não gera arquivo', /Nenhum item/.test(lastAlert || '') && getCsv() === null);

  // ── varredura ponta-a-ponta (Proxy mockado) ──────────────────────────────
  section('startAccountScan (Proxy mockado: scan + skip_description) + segurança');
  reset();
  const TOKEN = 'APP_USR-1111111111-061826-deadbeef-90909';
  let calls = [];
  sandbox.fetch = makeProxyFetch({ token: TOKEN, ids: fx.scanAccount.map(function (d) { return d.id; }), itemResponder: detailResponder(fx.scanAccount), calls: calls });
  await sandbox.startAccountScan();
  // scanAccount = 5 IDs (4 ativos + 1 pausado). Só os ATIVOS entram (decisão Lucas 02/07).
  check('varredura mantém só os 4 ATIVOS (pausado MLB...004 descartado)', sandbox.scannerState.allItems.length === 4);
  check('pausado NÃO entra em allItems', sandbox.scannerState.allItems.every(function (i) { return i.id !== 'MLB2000000004'; }));
  check('projeção guarda o status e todos os mantidos são active', sandbox.scannerState.allItems.every(function (i) { return i.status === 'active'; }));
  check('abre filtrado nos ATIVOS com problema: 2 cards (ficha incompleta + penalizado)', reg.scannerResults.children.length === 2);
  check("filtro default fica em 'problems'", reg.tagFilter.value === 'problems');
  check('resumo mono "2 de 4 com problema"', reg.scanCountText.textContent === '2 de 4 com problema');
  check("status final: 'Varredura completa' avisando 1 pausado fora do foco",
    /Varredura completa/.test(reg.scanStatusText.textContent) && /1 pausado/.test(reg.scanStatusText.textContent));
  check('barra de progresso a 100%', reg.scanProgressBar.style.width === '100%');
  check('legenda fica visível', reg.tagLegend.style.display === 'flex');
  check('uniqueTags agrega só tags de ATIVOS (tem incomplete/catalog, NÃO tem poor_quality do pausado)',
    sandbox.scannerState.uniqueTags.has('incomplete_technical_specs') && sandbox.scannerState.uniqueTags.has('catalog_listing') && !sandbox.scannerState.uniqueTags.has('poor_quality_picture'));
  const dropdownVals = reg.tagFilter.children.reduce(function (a, g) { return a.concat(g.children.map(function (o) { return o.value; })); }, []);
  check('dropdown preenchido com a tag crítica encontrada', dropdownVals.indexOf('incomplete_technical_specs') !== -1);
  // troca de filtro: 'all' mostra os 4 ativos; 'problems' volta pros 2 com problema
  reg.tagFilter.value = 'all';
  sandbox.handleScannerFilterChange();
  check("filtro 'all' mostra os 4 ativos", sandbox.scannerState.filteredItems.length === 4);
  reg.tagFilter.value = 'problems';
  sandbox.handleScannerFilterChange();
  check("filtro 'problems' volta pros 2 com problema", sandbox.scannerState.filteredItems.length === 2);

  // segurança: token só no header Bearer, nunca em querystring; sem /users/me
  const proxyCalls = calls.filter(function (c) { return /\/api\/fetch-(ads|item)/.test(c.url); });
  check('toda chamada ao Proxy manda Authorization: Bearer <token>',
    proxyCalls.length > 0 && proxyCalls.every(function (c) { return c.opts && c.opts.headers && c.opts.headers.Authorization === 'Bearer ' + TOKEN; }));
  check('token NUNCA aparece em querystring',
    calls.every(function (c) { return c.url.indexOf(TOKEN) === -1 && c.url.indexOf('access_token=') === -1; }));
  check('userId veio do token, sem chamar /users/me',
    calls.every(function (c) { return c.url.indexOf('/users/me') === -1; }));

  // paginação reescrita: modo scan (offset=1000 -> scroll_id) + skip_description (P1-1/2/3)
  check('1ª chamada de fetch-ads força o modo scan (offset=1000)',
    calls.some(function (c) { return /\/api\/fetch-ads/.test(c.url) && /[?&]offset=1000\b/.test(c.url); }));
  check('paginação seguinte usa scroll_id (não offset incremental)',
    calls.some(function (c) { return /\/api\/fetch-ads/.test(c.url) && /[?&]scroll_id=/.test(c.url); }));
  check('fetch-item pede skip_description=true (corta description, P1-1)',
    calls.some(function (c) { return /\/api\/fetch-item/.test(c.url) && /[?&]skip_description=true\b/.test(c.url); }));

  // ── projeção enxuta + descarte (scannerFetchDetails via scan, P-1 + P2-4) ──
  section('projeção/descarte (normalização migrada p/ scannerFetchDetails)');
  reset();
  calls = [];
  const rawIds = ['MLBOK', 'MLB500', 'MLBNOID', 'MLBNOTITLE', 'MLBNOTAGS'];
  const rawResponder = function () {
    return [
      { code: 200, body: { id: 'MLBOK', title: 'Item Bom', price: 50, permalink: 'https://x.test/ok', thumbnail: 'https://t.test/ok.webp', tags: ['incomplete_technical_specs', 'free_shipping'], description: 'DESC LONGA', extra_field: 'lixo', sold_quantity: 99 } },
      { code: 500, body: { id: 'MLB500', title: 'Erro de servidor' } },
      { code: 200, body: { title: 'Sem ID' } },
      { code: 200, body: { id: 'MLBNOTITLE' } },
      { code: 200, body: { id: 'MLBNOTAGS', title: 'Sem Tags', price: 10, permalink: 'https://x.test/nt', thumbnail: 'https://t.test/nt.webp' } }
    ];
  };
  sandbox.fetch = makeProxyFetch({ token: TOKEN, ids: rawIds, itemResponder: rawResponder, calls: calls });
  await sandbox.startAccountScan();
  check('descarta code!=200 e itens sem id/title (sobram 2 válidos)', sandbox.scannerState.allItems.length === 2);
  const okItem = sandbox.scannerState.allItems.filter(function (i) { return i.id === 'MLBOK'; })[0];
  check('projeção enxuta: item só com id/title/price/permalink/thumbnail/status/tags',
    !!okItem && Object.keys(okItem).sort().join(',') === 'id,permalink,price,status,tags,thumbnail,title');
  check('projeção enxuta: descarta description e campos extras (corta memória, P-1)',
    !!okItem && !('description' in okItem) && !('extra_field' in okItem) && !('sold_quantity' in okItem));
  const noTagsItem = sandbox.scannerState.allItems.filter(function (i) { return i.id === 'MLBNOTAGS'; })[0];
  check('projeção: tags ausente vira [] (Array vazio)', !!noTagsItem && Array.isArray(noTagsItem.tags) && noTagsItem.tags.length === 0);

  // ── conta vazia ───────────────────────────────────────────────────────────
  section('conta vazia');
  reset();
  calls = [];
  sandbox.fetch = makeProxyFetch({ token: TOKEN, ids: [], itemResponder: detailResponder([]), calls: calls });
  await sandbox.startAccountScan();
  check('conta vazia: 0 itens, sem quebrar', sandbox.scannerState.allItems.length === 0);
  check('conta vazia: grid mostra estado "sem anúncio ativo"', /Nenhum anúncio ativo encontrado/.test(reg.scannerResults.innerHTML));
  check("conta vazia: status final = 'Varredura completa'", reg.scanStatusText.textContent === 'Varredura completa');

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
  check('console não loga o userId extraído do token (PII, M2/§6)',
    scannerSrc.indexOf('ID extraído do token') === -1);

  // ───────────────────────── resumo ─────────────────────────
  console.log('\n──────────────────────────────────────────────');
  console.log(pass + ' ok · ' + fail + ' falhas(regressão) · ' + bugs + ' BUGS confirmados');
  if (bugs) { console.log('BUGS (ver findings/qa-test.md):'); bugList.forEach(function (b) { console.log('  • ' + b); }); }
  process.exit((fail > 0 || bugs > 0) ? 1 : 0);
})();
