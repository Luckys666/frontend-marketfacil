'use strict';
/*
 * Massa de teste da LOGICA do frontend Ads Automatizado (auto-ads.html).
 * Carrega o <script> da pagina num sandbox (vm) com stubs minimos de browser
 * (DOM/localStorage/location/fetch) e valida o comportamento puro:
 *   - o script carrega/inicializa sem lancar
 *   - as funcoes do fluxo guiado existem
 *   - o BOOKMARKLET foi removido (aaApplyAuto/execFn/bookmarklet nao existem)
 *   - BAND_NAMES e derivado de BAND_NAME_BY_KEY (sem duplicata)
 *   - persistencia da selecao (fix P6): sem advertiserId NAO grava; com id grava+restaura
 * Rodar: node test/auto-ads.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.on('unhandledRejection', function(){});   // o init dispara aaCheckBands (fetch) async

const html = fs.readFileSync(path.join(__dirname, '..', 'auto-ads.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!m) { console.error('FAIL: bloco <script> nao encontrado'); process.exit(1); }
const js = m[1];

// ---------- stubs minimos de browser ----------
function makeEl(){
  return {
    innerHTML: '', textContent: '', value: '', disabled: false, checked: false, style: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, getAttribute(){ return null; }, appendChild(){}, remove(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){}, focus(){}, select(){},
  };
}
const store = {};
const localStorage = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v){ store[k] = String(v); },
  removeItem(k){ delete store[k]; },
};
const documentStub = {
  getElementById(){ return makeEl(); },
  querySelector(){ return null; },
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
  body: makeEl(),
  addEventListener(){},
};
const sandbox = {
  document: documentStub, localStorage,
  location: { search: '' }, navigator: { clipboard: null },
  setTimeout(){}, clearTimeout(){}, fetch(){ return Promise.reject(new Error('no-net')); },
  console, JSON, Object, Array, Math, RegExp, parseFloat, parseInt, isFinite, Promise,
};
sandbox.window = sandbox;          // window === global

vm.createContext(sandbox);
let loadErr = null;
try { vm.runInContext(js, sandbox, { filename: 'auto-ads.inline.js' }); }
catch (e) { loadErr = e; }

let pass = 0, fail = 0;
const check = (label, cond) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' - ' + label); };

const AA = sandbox.AA;
const defaultAllMode = AA ? AA.allMode : undefined;   // captura o default ANTES dos testes de persistencia mutarem
check('script carrega/inicializa sem lancar', !loadErr && !!AA);
if (!AA) { console.log('\n' + pass + ' passaram, ' + (fail || 1) + ' falharam'); process.exit(1); }

// fluxo guiado: funcoes presentes
['aaGeneratePlan', 'aaVerify', 'aaCopyText', 'aaOpenMl', 'aaLoadAds', 'aaToggleItem', 'aaCheckBands']
  .forEach((fn) => check('window.' + fn + ' existe', typeof sandbox[fn] === 'function'));

// bookmarklet REMOVIDO
check('aaApplyAuto NAO existe (bookmarklet removido)', typeof sandbox.aaApplyAuto === 'undefined');
check('AA.execFn NAO existe', typeof AA.execFn === 'undefined');
check('AA.bookmarklet NAO existe', typeof AA.bookmarklet === 'undefined');

// BAND_NAMES derivado de BAND_NAME_BY_KEY (sem duplicata)
check('BAND_NAMES tem 5 nomes', Array.isArray(AA.BAND_NAMES) && AA.BAND_NAMES.length === 5);
check('BAND_NAMES == values(BAND_NAME_BY_KEY)',
  JSON.stringify(AA.BAND_NAMES) === JSON.stringify(Object.keys(AA.BAND_NAME_BY_KEY).map((k) => AA.BAND_NAME_BY_KEY[k])));
check('BAND_NAMES[0] é o Econômico', /Econômico/.test(AA.BAND_NAMES[0]));

// persistencia P6: sem advertiserId NAO grava (evita salvar em mf_aa_sel_x)
AA.advertiserId = null; AA.sel = { MLBX: 1 }; AA.allMode = false; AA.saveSel();
check('saveSel sem advertiserId NAO grava (fix P6)',
  localStorage.getItem('mf_aa_sel_x') === null && localStorage.getItem('mf_aa_sel_null') === null);

// persistencia: com advertiserId grava na chave certa e loadSel restaura
AA.advertiserId = 322738; AA.sel = { MLB1: 1, MLB2: 1 }; AA.allMode = false; AA.saveSel();
check('saveSel grava em mf_aa_sel_<id>', localStorage.getItem('mf_aa_sel_322738') !== null);
AA.sel = {}; AA.allMode = false; AA.loadSel();
check('loadSel restaura a selecao', !!AA.sel.MLB1 && !!AA.sel.MLB2);

// allMode persiste
AA.advertiserId = 999; AA.sel = {}; AA.allMode = true; AA.saveSel();
AA.allMode = false; AA.loadSel();
check('loadSel restaura allMode=true', AA.allMode === true);

// selecao e isolada por advertiser
AA.advertiserId = 111; AA.sel = { A: 1 }; AA.allMode = false; AA.saveSel();
AA.advertiserId = 222; AA.sel = {}; AA.allMode = false; AA.loadSel();
check('selecao isolada por advertiser (222 nao ve a do 111)', !AA.sel.A);

// v2: onboarding (allMode ligado por padrao) + macro 30x30 no plano
check('allMode vem LIGADO por padrao (onboarding: automatizar todos)', defaultAllMode === true);
check('AA.applyAllModeUI existe', typeof AA.applyAllModeUI === 'function');
const dp = AA.demoPlan(3, null);
check('demoPlan expoe costGrowthPct/revGrowthPct (macro 30x30)',
  dp.summary && typeof dp.summary.revGrowthPct === 'number' && typeof dp.summary.costGrowthPct === 'number');
let renderOk = true; try { AA.render(dp); } catch (e) { renderOk = false; }
check('AA.render nao lanca com plano demo (inclui card macro 30x30)', renderOk);

console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
