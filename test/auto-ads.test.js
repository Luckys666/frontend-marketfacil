'use strict';
/*
 * Massa de teste da LOGICA do frontend Ads Automatizado (auto-ads.html).
 * Carrega o <script> da pagina num sandbox (vm) com stubs minimos de browser
 * (DOM/localStorage/location/fetch) e valida o comportamento puro:
 *   - o script carrega/inicializa sem lancar
 *   - as funcoes do fluxo guiado existem (e o bookmarklet segue REMOVIDO)
 *   - BAND_NAMES e derivado de BAND_NAME_BY_KEY (sem duplicata)
 *   - persistencia da selecao (fix P6) + da meta de TACOS
 *   - validacao da meta de TACOS (0/vazio/999 NAO viram 3 em silencio)
 *   - plan_search_ids usado no Copiar (familia = ID do UP, nao MLB)
 *   - deep-link do ML com ?fe-rollout-version=v2
 *   - "selecionar visiveis" pula hold (sem estoque)
 *   - esc() escapa aspas simples (dados em atributos onclick)
 *   - rehydrate existe (re-render do element no Bubble)
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

// ---------- stubs minimos de browser (elementos CACHEADOS por id p/ estado persistir) ----------
function makeEl(){
  const el = {
    innerHTML: '', textContent: '', value: '', disabled: false, checked: false, style: {},
    _cls: {},
    classList: {
      add(c){ el._cls[c] = 1; }, remove(c){ delete el._cls[c]; },
      toggle(c, on){ if (on === undefined) { el._cls[c] ? delete el._cls[c] : el._cls[c] = 1; } else if (on) el._cls[c] = 1; else delete el._cls[c]; },
      contains(c){ return !!el._cls[c]; },
    },
    setAttribute(){}, getAttribute(){ return null; }, appendChild(){}, remove(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){}, focus(){}, select(){},
  };
  return el;
}
const els = {};
const byId = (id) => { if (!els[id]) els[id] = makeEl(); return els[id]; };
const store = {};
const localStorage = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v){ store[k] = String(v); },
  removeItem(k){ delete store[k]; },
};
const documentStub = {
  getElementById: byId,
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
  console, JSON, Object, Array, Math, RegExp, parseFloat, parseInt, isFinite, Promise, String,
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
if (!AA) { console.log('\n' + pass + ' passaram, ' + (fail || 1) + ' falharam'); if (loadErr) console.error(loadErr); process.exit(1); }

// fluxo guiado: funcoes presentes
['aaGeneratePlan', 'aaVerify', 'aaCopyText', 'aaOpenMl', 'aaLoadAds', 'aaToggleItem', 'aaCheckBands', 'aaTacosChanged', 'aaSelectPage', 'aaOpenCampaign']
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

// ---------- v3 (revisao profunda 09/06) ----------

// validacao da meta de TACOS: 0/vazio/letra/999 NAO viram 3 em silencio
byId('aa-tacos').value = '0';
check('readTacos: 0 -> invalido (null)', AA.readTacos() === null);
byId('aa-tacos').value = '';
check('readTacos: vazio -> invalido (null)', AA.readTacos() === null);
byId('aa-tacos').value = '999';
check('readTacos: 999 -> invalido (null)', AA.readTacos() === null);
byId('aa-tacos').value = '7.5';
check('readTacos: 7.5 -> valido', AA.readTacos() === 7.5);

// persistencia da meta
byId('aa-tacos').value = '12';
sandbox.aaTacosChanged();
check('meta de TACOS persiste em localStorage', localStorage.getItem('mf_aa_tacos') === '12');
byId('aa-tacos').value = '3';
AA.restoreTacos();
check('restoreTacos restaura a meta salva', byId('aa-tacos').value == 12);

// mudar meta/selecao invalida a comparacao do "Verificar" (banner fictÍcio)
AA._prevMoves = 5;
sandbox.aaTacosChanged();
check('mudar a meta zera _prevMoves (sem banner fictício)', AA._prevMoves === null);
AA._prevMoves = 5;
sandbox.aaToggleItem('MLBZ', true);
check('mudar a selecao zera _prevMoves', AA._prevMoves === null);
delete AA.sel.MLBZ;

// plan_search_ids: o Copiar usa o ID BUSCAVEL (familia = ID do UP), nao o MLB filho
const cards = AA.planCards(AA.demoPlan(3, ['MLB1111111111', 'MLB2222222222']));
check('planCards copia plan_search_ids (ID do UP da familia presente)', cards.indexOf('774884615150225') !== -1);
check('planCards instrui a apertar Enter na busca do ML', /Enter/.test(cards));
check('planCards conta anuncios pelo plan_items (2 na faixa B1)', /2 anúncio/.test(cards));

// deep-link novo do painel ML (sem ?fe-rollout-version=v2 o ML manda pro hub)
check('ML_ADD_ADS tem fe-rollout-version=v2', /fe-rollout-version=v2/.test(AA.ML_ADD_ADS));
check('ML_CAMPAIGNS aponta pra lista nova (sem /sales/)', AA.ML_CAMPAIGNS.indexOf('/admin/campaigns') !== -1 && AA.ML_CAMPAIGNS.indexOf('/sales/') === -1);

// "selecionar visiveis" pula hold (sem estoque)
AA.ads = AA.demoAds(0).ads; AA.sel = {}; AA.advertiserId = 4242;
sandbox.aaSelectPage(true);
check('aaSelectPage marca os elegiveis e PULA hold', !!AA.sel.MLB111 && !AA.sel.MLB115);

// esc() escapa aspas simples (dados do backend entram em onclick='...')
check("esc escapa aspas simples (mapa contem &#39;)", js.indexOf('&#39;') !== -1);

// estados/robustez
check('AA.api existe (fetch padronizado, sem "Unexpected token <")', typeof AA.api === 'function');
check('AA.errMsg traduz 401 pra mensagem de sessao do ML', /Mercado Livre/.test(AA.errMsg({ status: 401 })));
check('AA.errMsg traduz falha de rede', /internet|servidor/.test(AA.errMsg({ netFail: true })));
check('AA.rehydrate existe (re-render do element no Bubble)', typeof AA.rehydrate === 'function');
check('guard de requisicao em voo (_busy) existe', AA._busy === false);
check('STATUS mapeia delegated/revoked (sem ingles cru)', AA.STATUS.delegated && AA.STATUS.revoked);

// catálogo perdendo a ficha: card de aviso no plano (não imprime em faixa nenhuma)
const dpBL = AA.demoPlan(3, null);
check('demoPlan expoe buybox_losers', dpBL.buybox_losers && dpBL.buybox_losers.count === 2);
let renderBLOk = true; let blHtml = '';
try { AA.render(dpBL); } catch (e) { renderBLOk = false; }
check('AA.render nao lanca com buybox_losers no plano', renderBLOk);

// guidedCreation marca o que ja existe quando bands_missing vem do backend
const gc = AA.guidedCreation({ bands_missing: ['NA'] });
check('guidedCreation destaca só o que falta (✓ já existe nas outras)', /já existe/.test(gc));
check('guidedCreation expoe ROAS/ACOS por faixa (liberado)', /33,33/.test(gc));

console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
