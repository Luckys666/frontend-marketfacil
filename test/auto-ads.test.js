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
check('HOLD_RAW mapeia Y (Nao se pode mostrar) / S (Em revisao) / M (Pausado no ML)',
  AA.HOLD_RAW && /Não se pode mostrar/.test(AA.HOLD_RAW.Y[0]) && /revisão/.test(AA.HOLD_RAW.S[0]) && /Pausado no ML/.test(AA.HOLD_RAW.M[0]));

// anúncios fora das campanhas (unservable): card com motivos
const dpU = AA.demoPlan(3, null);
check('demoPlan expoe unservable (3 fora das campanhas)', dpU.unservable && dpU.unservable.count === 3);
let renderUOk = true;
try { AA.render(dpU); } catch (e) { renderUOk = false; }
check('AA.render nao lanca com unservable no plano', renderUOk);

// catálogo perdendo a ficha: card de aviso no plano (não imprime em faixa nenhuma)
const dpBL = AA.demoPlan(3, null);
check('demoPlan expoe buybox_losers', dpBL.buybox_losers && dpBL.buybox_losers.count === 2);
let renderBLOk = true; let blHtml = '';
try { AA.render(dpBL); } catch (e) { renderBLOk = false; }
check('AA.render nao lanca com buybox_losers no plano', renderBLOk);

// teste de alcance: plano separado com instrucao de cadencia
const dpProbe = AA.demoPlan(3, null);
check('demoPlan expoe probe_items (teste de alcance)', dpProbe.probe_items && Object.keys(dpProbe.probe_items).length === 1);
let renderProbeOk = true;
try { AA.render(dpProbe); } catch (e) { renderProbeOk = false; }
check('AA.render nao lanca com probe_items no plano', renderProbeOk);

// guidedCreation marca o que ja existe quando bands_missing vem do backend
const gc = AA.guidedCreation({ bands_missing: ['NA'] });
check('guidedCreation destaca só o que falta (✓ já existe nas outras)', /já existe/.test(gc));
check('guidedCreation expoe ROAS/ACOS por faixa (liberado)', /33,33/.test(gc));

// ---------- v4 (artefato "Seu plano de ação" + ciclos persistentes) ----------

// demoPlan expõe os campos novos do backend
const dp4 = AA.demoPlan(3, null);
check('demoPlan expoe health_score/health_factors', typeof dp4.health_score === 'number' && Array.isArray(dp4.health_factors));
check('demoPlan expoe plan_weights e budget_reductions', dp4.plan_weights && Array.isArray(dp4.budget_reductions));

// o render monta o artefato: score + etapas numeradas + checkbox de feito
AA.advertiserId = 4242;
let html4 = '';
try { AA.render(dp4); html4 = byId('aa-out').innerHTML; } catch (e) { html4 = ''; }
check('render mostra o score de saúde (72)', /aa-score/.test(html4) && />72</.test(html4));
check('render tem o header "Seu plano de ação"', /Seu plano de ação/.test(html4));
check('render tem etapas com checkbox "marcar etapa como feita"', /marcar etapa como feita/.test(html4));
check('render tem a etapa final "Confirme as mudanças"', /Confirme as mudanças/.test(html4));
check('render tem details "como subir o score"', /como subir o score/.test(html4));
check('render tem etapa de reduzir orçamento (budget_reductions)', /Reduza o orçamento/.test(html4) && /R\$ 18/.test(html4));

// ordenação por impacto: faixa 1003 (peso 42.5) vem antes da 1001 (peso 10.1)
// (olha só a partir da etapa "Reorganize" — a etapa de saneamento antes dela também usa o Econômico)
const planPart4 = html4.slice(html4.indexOf('Reorganize'));
check('plano ordenado por plan_weights (1003 antes de 1001)',
  planPart4.indexOf('Acelerado') !== -1 && planPart4.indexOf('Acelerado') < planPart4.indexOf('Econômico'));

// planCards nova assinatura: corpo da etapa, SEM wrapper de card nem header proprio
const body4 = AA.planCards(dp4, ['1003', '1001']);
check('planCards NAO tem mais o wrapper aa-card/header proprio', body4.indexOf('aa-card') === -1 && body4.indexOf('Plano pronto') === -1);
check('planCards vazio retorna string vazia', AA.planCards({ plan: {} }, []) === '');

// ciclo persistente: ensureCycle cria, aaStageDone marca e persiste, closeCycle arquiva
const cyc = AA.loadCycle();
check('ensureCycle criou o ciclo no localStorage (mf_aa_cycle_<id>)', !!cyc && Array.isArray(cyc.stageIds));
sandbox.aaStageDone('plan', true, null);
check('aaStageDone persiste o feito no ciclo', !!(AA.loadCycle().done || {}).plan);
AA.render(dp4);   // re-render preserva o done
check('re-render preserva etapa marcada como feita', /is-done/.test(byId('aa-out').innerHTML));
AA.closeCycle(dp4.summary);
check('closeCycle arquiva no histórico e limpa o ciclo', AA.loadHist().length === 1 && AA.loadCycle() === null);
AA.render(dp4);
check('render mostra ciclos anteriores (histórico)', /ciclos anteriores \(1\)/.test(byId('aa-out').innerHTML));

// card secundário de melhorias (buybox + unservable) com links pras outras funções
check('card "Melhore estes anúncios" presente', /Melhore estes anúncios/.test(byId('aa-out').innerHTML));
check('card de melhorias linka Concorrência de Catálogo', /concorrencia-catalogo/.test(byId('aa-out').innerHTML));
check('card de melhorias linka Análise de Anúncios', /analise-anuncio/.test(byId('aa-out').innerHTML));

// render adota o advertiser_id do plano (ciclo por conta mesmo sem carregar a lista de anuncios)
AA.advertiserId = null;
const dpAdv = AA.demoPlan(3, null); dpAdv.advertiser_id = 55667;
AA.render(dpAdv);
check('render seta AA.advertiserId a partir do plano (ciclo por conta)', AA.advertiserId === 55667 && AA.cycleKey() === 'mf_aa_cycle_55667');
AA.advertiserId = 4242;

// estado vazio: sem etapas -> "Tudo no lugar"
const dpEmpty = AA.demoPlan(3, null);
dpEmpty.plan = {}; dpEmpty.plan_items = {}; dpEmpty.probe_items = {}; dpEmpty.budget_reductions = [];
dpEmpty.sanitize_plan = {}; dpEmpty.sanitize_items = {}; dpEmpty.paused = { count: 0, items: [] };
let emptyOk = true;
try { AA.render(dpEmpty); } catch (e) { emptyOk = false; }
check('render nao lanca com plano vazio (Tudo no lugar)', emptyOk && /Tudo no lugar/.test(byId('aa-out').innerHTML));

// ── v4.5 (12/06): etapa de saneamento + pausados + aviso de equilíbrio ────────
AA.advertiserId = 4242;
const dp5 = AA.demoPlan(3, null);
AA.render(dp5);
let html5 = byId('aa-out').innerHTML;
check('render tem a etapa "Proteja 1 anúncio com aviso" (sanitize)', /Proteja 1 anúncio com aviso/.test(html5));
check('etapa sanitize lista o código buscável do penalizado', /MLB1212121212/.test(html5));
check('card "Pausados por você" presente e colapsado (details)', /Pausados por você \(1\)/.test(html5) && /fora da análise/.test(html5));
check('balanced=true NÃO mostra aviso de equilíbrio', !/segurar os aumentos/.test(html5));
const dp6 = AA.demoPlan(3, null);
dp6.summary.balanced = false;
AA.render(dp6);
check('balanced=false mostra o aviso de equilíbrio (investimento × faturamento)', /segurar os aumentos/.test(byId('aa-out').innerHTML));

// ── A2 (X-MF-Auth): mint + cache + header + retry-401 ─────────────────────────
check('AA.MINT_WF aponta pro workflow get-user-id', /get-user-id$/.test(AA.MINT_WF));
check('AA.getMfAuth existe', typeof AA.getMfAuth === 'function');

(async () => {
  // fetch fake: workflow de token ML, workflow do mint e proxy (captura headers; 401 A2 na 1ª)
  let mintCalls = 0, proxyCalls = 0, lastHeaders = null, failFirst = false;
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
  sandbox.fetch = function(url, opts){
    url = String(url);
    if (url.indexOf('getAccessToken2') !== -1) return Promise.resolve(resp(200, { response: { access_token: 'ML-TOKEN' } }));
    if (url.indexOf('get-user-id') !== -1) { mintCalls++; return Promise.resolve(resp(200, { response: { user_id: '123x456.999.v2.feedbeef' + mintCalls } })); }
    proxyCalls++;
    lastHeaders = (opts && opts.headers) || {};
    if (failFirst && proxyCalls === 1) return Promise.resolve(resp(401, { error: 'authorization_required', action: 'reload' }));
    return Promise.resolve(resp(200, { ok: true }));
  };

  AA._mfAuth = null;
  const t1 = await AA.getMfAuth();
  const t2 = await AA.getMfAuth();
  check('getMfAuth retorna o user_id (token A2) e CACHEIA (1 chamada de rede)', !!t1 && t1 === t2 && mintCalls === 1);

  const r1 = await AA.api('/api/auto-ads/plan?tacos_target=3');
  check('AA.api manda Authorization + X-MF-Auth', r1.ok && lastHeaders.Authorization === 'Bearer ML-TOKEN' && !!lastHeaders['X-MF-Auth']);

  // retry-401: 1ª resposta 401 authorization_required -> re-minta e repete UMA vez
  AA._mfAuth = null; mintCalls = 0; proxyCalls = 0; failFirst = true;
  const r2 = await AA.api('/api/auto-ads/plan?tacos_target=3');
  check('401 de A2 re-minta e repete 1x (resultado final ok)', r2.ok && proxyCalls === 2 && mintCalls === 2);

  // mint indisponível (fora do app): API segue chamando SEM o header (off/dual no backend)
  AA._mfAuth = null; proxyCalls = 0; failFirst = false;
  sandbox.fetch = function(url, opts){
    url = String(url);
    if (url.indexOf('getAccessToken2') !== -1) return Promise.resolve(resp(200, { response: { access_token: 'ML-TOKEN' } }));
    if (url.indexOf('get-user-id') !== -1) return Promise.reject(new Error('offline'));
    proxyCalls++; lastHeaders = (opts && opts.headers) || {};
    return Promise.resolve(resp(200, { ok: true }));
  };
  const r3 = await AA.api('/api/auto-ads/ads');
  check('mint indisponível: chamada sai sem X-MF-Auth (não trava o fluxo)', r3.ok && proxyCalls === 1 && !lastHeaders['X-MF-Auth']);

  console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
