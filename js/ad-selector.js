/* ============================================================
 * Painel Seletor de Anúncios — JS (port F4 do protótipo standalone)
 * Origem: test-env/ad-selector/index.html (validado 22/07 com API real).
 * Diferenças do port (procure "PORT F4" no código):
 *   - mlGet() fala com o mlb-proxy (fetch-ads/fetch-item/users-me) com o
 *     Bearer do app — NÃO existe mais /api/ml/* (era do serve.js local).
 *   - Análise é REAL: enterAnalysis() preenche #input-url e chama
 *     window.handleAnalysisClick() SEM argumento (o parse do analyzer
 *     detecta MLBU corretamente por esse caminho; chamada programática
 *     com argumento forçaria type:'mlb').
 *   - Camadas de visitas/perguntas/vendas-30d ficam DESLIGADAS na F4
 *     (o proxy ainda não tem essas rotas; decisão de custo pendente).
 *   - Mock removido (era PROTOTYPE-ONLY).
 * Escopo: IIFE — nada vaza pro escopo do analyzer.js (helpers homônimos
 * como escapeHtml/$ existem nos dois; cada um usa o seu).
 * ============================================================ */
(function () {

"use strict";

/* =========================================================================
   CONFIG — ajuste fácil no topo
   ========================================================================= */
const CONFIG = {
  // q= (busca por nome) VALIDADO com token real (03/07): filtra de fato e combina
  // com status=. O switch fica como kill-switch: se a ML mudar o comportamento,
  // USE_Q_PARAM=false esconde a tentativa de q= e cai direto no aviso + sku=.
  USE_Q_PARAM: true,
  ANALYZE_URL: 'https://app.marketfacil.com.br/analise-anuncio',
  RECONNECT_URL: 'https://app.marketfacil.com.br/minha-conta',  // conexão ML fica em Minha Conta (verificado 23/07 — /conexoes é 404)
  PAGE_SIZE: 50,
  HYDRATE_CHUNK: 20,
  OFFSET_CAP: 1000,            // ML trava offset em 1000
  COUNTS_CACHE_KEY: 'mf_sel_counts',
  COUNTS_TTL_MIN: 10,
  SET_TTL_MIN: 10,             // TTL dos Sets de sinais (camada B) e do mapa de perguntas (camada C)
  // Validado com token real: `secure_thumbnail` nunca volta (derivamos https do
  // próprio `thumbnail` trocando http->https) e `pictures` pesa ~1,5KB/item — fora.
  // +listing_type_id, shipping, date_created (camada A); +original_price (desconto);
  // +family_id, user_product_id (agrupamento por família UP). Todos validados no multiget.
  // item_relations VALIDADO com token real (22/07): vem populado nas DUAS pontas do
  // vínculo (o item de catálogo E o irmão não-catálogo apontam um pro outro); a pill
  // "vinculados" renderiza só no lado catálogo (isCatalogItem), evitando duplicar.
  MULTIGET_ATTRS: 'id,title,price,original_price,thumbnail,status,sub_status,health,tags,sold_quantity,available_quantity,permalink,warranty,catalog_listing,listing_type_id,shipping,date_created,family_id,user_product_id,item_relations',
  GROUP_FAMILIES: true,        // agrupar variações da mesma família (UP) em 1 linha-produto
  ANALYZE_BY_PRODUCT: true,    // clique num grupo analisa o produto (user_product_id) em vez da variação
  // Camada B — Sets de IDs por sinal (interseção). Só varre sinais com contador > 0.
  SIGNAL_SET_PAGE: 100,        // limit por página ao varrer os IDs de um sinal
  SIGNAL_SET_CAP: 300,         // teto de IDs por sinal (documentado); acima disso o badge cobre os 300 primeiros
  // Camada C — visitas 30d POR ITEM. ATENÇÃO: a ML NÃO tem endpoint bulk de visitas
  // por item (items/visits?ids= aceita só 1 id). Logo é 1 chamada por item da página
  // visível (custo ~PAGE_SIZE chamadas/página). Por isso fica atrás de uma flag:
  // PORT F4: visitas/perguntas/vendas-30d DESLIGADAS no widget — o mlb-proxy
  // ainda não tem essas rotas e o custo por chamada (visitas = 1/item) está
  // com decisão pendente. Religar = criar as rotas no proxy + flags true.
  SHOW_VISITS: false,
  SHOW_QUESTIONS: false,
  SHOW_SALES30: false,
  VISITS_WINDOW_DAYS: 30,
  VISITS_CONCURRENCY: 6,       // no máx. N chamadas de visita em voo ao mesmo tempo
  // Camada C — vendas 30d POR CONTA via orders/search (1-3 chamadas/conta, cache 10min).
  // Alimenta a taxa de conversão (vendas30÷visitas30, só com SHOW_VISITS) e a previsão
  // de estoque no ritmo recente. Se a conta tiver mais pedidos que o teto, as taxas NÃO
  // são exibidas (parcial enganaria) — a previsão cai no ritmo desde a criação.
  SALES_WINDOW_DAYS: 30,
  SALES30_MAX_PAGES: 3,        // teto de páginas de pedidos varridas (50/página)
};

/* Regras de sinais (badges) por anúncio — todas configuráveis aqui. */
const PROBLEM_RULES = {
  healthThreshold: 0.7,          // health numérico < 0.7 -> "Saúde ML"
  shortTitleMax: 50,             // título < 50 chars (só sinaliza se ainda não vende)
  // Regra do ML: frete grátis é OBRIGATÓRIO a partir deste valor; abaixo dele é
  // opcional e sai do bolso do vendedor (margem quase negativa — problema recorrente
  // relatado pelos usuários). Se o ML mudar o piso, atualizar aqui (o texto do badge acompanha).
  freeShippingFloor: 79,
  incompleteSpecsTag: 'incomplete_technical_specs',
  lowQualityPhotoTags: ['poor_quality_picture', 'poor_quality_thumbnail', 'with_low_quality_image'],
  catalogTag: 'catalog_boost',   // catalog_listing:true OU tag catalog_boost -> badge informativo "Catálogo"
  freeListingType: 'free',       // listing_type_id === 'free' -> baixa exposição (fato do ML, não regra nossa)
  // sub_status -> como exibir
  subStatusLabels: {
    forbidden:         { text: 'Infração',              cls: 'red' },
    waiting_for_patch: { text: 'Corrigir para reativar', cls: 'orange' },
    held:              { text: 'Suspenso',              cls: 'red' },
    suspended:         { text: 'Suspenso',              cls: 'red' },
    deleted:           { text: 'Excluído',              cls: 'gray' },
    out_of_stock:      { text: 'Sem estoque',           cls: 'gray' },
    freezed:           { text: 'Congelado',             cls: 'orange' },
    under_review:      { text: 'Em revisão',            cls: 'gray' },
    expired:           { text: 'Expirado',              cls: 'gray' },
    pending:           { text: 'Pendente',              cls: 'gray' },
    payment_required:  { text: 'Aguardando pagamento',  cls: 'orange' },
    picture_download_pending: { text: 'Processando fotos', cls: 'gray' },
  },
};

/* Chips de problema da conta. countKey aponta para a chave em `counts`. */
const PROBLEM_CHIPS = [
  { id: 'unhealthy',       sev: 'red',    label: 'Perdendo exposição',            filter: { reputation_health_gauge: 'unhealthy' }, countKey: 'gauge_unhealthy' },
  { id: 'warning',         sev: 'orange', label: 'Risco de perder exposição',     filter: { reputation_health_gauge: 'warning' },   countKey: 'gauge_warning' },
  { id: 'incomplete_specs',sev: 'orange', label: 'Ficha técnica incompleta',      filter: { labels: 'incomplete_technical_specs' }, countKey: 'label_incomplete_technical_specs' },
  { id: 'low_quality_img', sev: 'orange', label: 'Foto de baixa qualidade',       filter: { labels: 'with_low_quality_image' },     countKey: 'label_with_low_quality_image' },
  { id: 'paused_no_stock', sev: 'yellow', label: 'Pausados sem estoque',          filter: { status: 'paused', labels: 'without_stock' }, countKey: 'label_without_stock' },
  { id: 'being_reviewed',  sev: 'gray',   label: 'Em revisão',                     filter: { labels: 'being_reviewed' },             countKey: 'label_being_reviewed' },
  { id: 'missing_gtin',    sev: 'gray',   label: 'Sem código de barras (GTIN)',    filter: { missing_product_identifiers: 'true' },  countKey: 'missing_product_identifiers' },
  { id: 'few_available',   sev: 'yellow', label: 'Estoque quase no fim',          filter: { labels: 'few_available' },              countKey: 'label_few_available' },
  { id: 'fix_required',    sev: 'orange', label: 'Corrigir para reativar',        filter: { labels: 'fix_required' },               countKey: 'label_fix_required' },
];

/* Camada B — sinais que viram badge NA LINHA do anúncio, via interseção de IDs.
   Só busca os sinais com contador > 0 nos counts já carregados (reaproveita as contagens
   do include_filters/gauge — se o chip diz 0, não faz a chamada). */
const SIGNAL_SETS = [
  { id: 'unhealthy',       filter: { reputation_health_gauge: 'unhealthy' }, countKey: 'gauge_unhealthy',              badge: { text: 'Perdendo exposição', cls: 'red' } },
  { id: 'warning',         filter: { reputation_health_gauge: 'warning' },   countKey: 'gauge_warning',                badge: { text: 'Risco de perder exposição', cls: 'orange' } },
  { id: 'low_quality_img', filter: { labels: 'with_low_quality_image' },     countKey: 'label_with_low_quality_image', badge: { text: 'Foto de baixa qualidade', cls: 'orange' } },
  { id: 'missing_gtin',    filter: { missing_product_identifiers: 'true' },  countKey: 'missing_product_identifiers',  badge: { text: 'Sem código de barras (GTIN)', cls: 'gray' } },
  { id: 'few_available',   filter: { labels: 'few_available' },              countKey: 'label_few_available',          badge: { text: 'Estoque quase no fim', cls: 'yellow' } },
];

const MLB_RE = /^MLB[U]?\d+$/i;
// PORT F4: mock era PROTOTYPE-ONLY (?mock=1). No app fica DESLIGADO de vez —
// senão qualquer usuário com ?mock=1 na URL veria dados fictícios como reais.
const MOCK = false;

/* =========================================================================
   Estado
   ========================================================================= */
const state = {
  sellerId: null,
  status: 'active',              // active | paused | all
  order: 'last_updated_desc',
  search: '',
  searchParam: null,             // 'q' | 'sku' | null  (modo da busca por texto)
  activeChip: null,
  prevStatus: null,              // status escolhido pelo usuário antes de um chip fixar outro (devolvido ao desativar)
  listingType: '',               // '' | gold_pro | gold_special | free  (filtro Tipo — validado)
  logisticType: '',              // '' | fulfillment | self_service | xd_drop_off  (filtro Logística — validado)
  discountOnly: false,           // quick-filter client-side "Com desconto" (só a página carregada)
  freeShipUnder: false,          // quick-filter client-side "Frete grátis abaixo de R$ 79" (só a página carregada)
  offset: 0,
  total: 0,
  selectedId: null,
  expandedFamilies: {},          // familyId -> true (linhas-produto expandidas)
  savedScroll: 0,                // posição de scroll salva ao entrar na análise (fluxo integrado)
  loading: false,        // true enquanto uma página carrega (bloqueia re-render incremental tardio)
  expandedBadges: {},            // rowKey -> true (linhas com todos os sinais abertos no desktop)
  // dados progressivos (camadas B/C) — chegam assíncronos e re-renderizam a página atual
  signalSets: {},        // signalId -> Set(ids)  (camada B)
  signalSetsIncomplete: {},  // signalId -> true quando a varredura não cobriu todos os anúncios (não afirmar "OK")
  questionsMap: {},      // itemId -> nº de perguntas sem resposta  (camada C)
  visitsMap: {},         // itemId -> nº de visitas 30d (undefined=carregando, null=falhou)  (camada C)
  visitsSeries: {},      // itemId -> [visitas por dia, 30 posições] (mesma chamada do total — custo zero extra)
  sales30Map: null,      // itemId -> unidades vendidas nos últimos 30d (null=ainda não carregou/falhou)  (camada C)
  sales30Incomplete: false,  // true quando a conta tem mais pedidos que o teto varrido (não afirmar taxas)
  expandedRelations: {}, // itemId (catálogo) -> true (anúncios vinculados abertos)
  lastItems: [],         // itens da página atual, para re-render incremental
};

/* =========================================================================
   Utils
   ========================================================================= */
function escapeHtml(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Variante para dentro de faixas quebráveis (.price-wrap-range): NBSP depois do "R$"
// para a única oportunidade de quebra ser o <wbr> depois do "–".
function fmtPriceNb(n) { return fmtPrice(n).replace(' ', ' '); }
function $(sel) { return document.querySelector(sel); }
function el(html) { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }

/* =========================================================================
   Camada de rede — PORT F4: tudo via mlb-proxy com o Bearer do app.
   O protótipo falava com /api/ml/* (serve.js local injetava o token);
   no widget o token vem do WF do Bubble (mesma fonte do analyzer) e as
   rotas viram as do proxy:
     users/me                     -> /api/users/me
     users/{id}/items/search?...  -> /api/fetch-ads?seller_id={id}&...
                                     (orders= vira order=; "Todos" manda
                                      status=all — o proxy v438 omite na ML)
     items?ids=...&attributes=... -> /api/fetch-item?item_id=...&attributes=...
   Visitas/perguntas/vendas-30d NÃO têm rota no proxy — camadas desligadas
   na F4 (CONFIG.SHOW_*; decisão de custo por chamada ainda pendente).
   ========================================================================= */
const MFSEL_PROXY = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';

// Token do ML via workflow do app (mesma fonte do analyzer). Cache curto em
// memória; renovação é do backend — aqui NUNCA se renova token (regra do projeto).
let mfselTokCache = { v: null, ts: 0 };
async function mfselToken() {
  if (mfselTokCache.v && Date.now() - mfselTokCache.ts < 4 * 60 * 1000) return mfselTokCache.v;
  const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
  if (!r.ok) { const e = new Error('sessao_expirada'); e.status = 401; throw e; }
  const d = await r.json().catch(() => null);
  const tok = d && d.response && d.response.access_token;
  if (!tok) { const e = new Error('sessao_expirada'); e.status = 401; throw e; }
  mfselTokCache = { v: tok, ts: Date.now() };
  return tok;
}

// Traduz o caminho "estilo ML" (usado pelo resto do código, herdado do protótipo)
// pra rota equivalente do mlb-proxy. Caminho sem rota -> erro explícito (nunca
// bater na ML direto: CORS + política de zero-vazamento).
function mfselProxyUrl(mlPath) {
  const qIdx = mlPath.indexOf('?');
  const pathPart = qIdx === -1 ? mlPath : mlPath.slice(0, qIdx);
  const q = new URLSearchParams(qIdx === -1 ? '' : mlPath.slice(qIdx + 1));
  if (pathPart === 'users/me') return MFSEL_PROXY + '/api/users/me';
  const m = pathPart.match(/^users\/(\d+)\/items\/search$/);
  if (m) {
    const p = new URLSearchParams();
    p.set('seller_id', m[1]);
    q.forEach((v, k) => p.set(k === 'orders' ? 'order' : k, v));
    // Modo "Todos": o protótipo simplesmente NÃO mandava status; o proxy tem
    // default active, então o "todos" precisa ser explícito (status=all).
    if (!p.get('status')) p.set('status', 'all');
    return MFSEL_PROXY + '/api/fetch-ads?' + p.toString();
  }
  if (pathPart === 'items') {
    const p = new URLSearchParams();
    p.set('item_id', q.get('ids') || '');
    if (q.get('attributes')) p.set('attributes', q.get('attributes'));
    return MFSEL_PROXY + '/api/fetch-item?' + p.toString();
  }
  const e = new Error('rota_sem_proxy: ' + pathPart); e.status = 501; throw e;
}

async function mlGet(mlPath) {
  const token = await mfselToken();
  const res = await fetch(mfselProxyUrl(mlPath), { headers: { Authorization: 'Bearer ' + token } });
  let data = null;
  try { data = await res.json(); } catch (e) { /* corpo não-JSON */ }
  if (res.status === 401) {
    mfselTokCache = { v: null, ts: 0 };   // token pode ter rotacionado — próxima chamada rebusca do WF
    const err = new Error('sessao_expirada'); err.status = 401; throw err;
  }
  if (!res.ok) {
    const err = new Error('erro_ml'); err.status = res.status; err.body = data; throw err;
  }
  return data;
}

/* =========================================================================
   Contagens dos chips (com cache em sessionStorage, 10 min)
   ========================================================================= */
// Chave separada por modo: mock e real não podem compartilhar cache de contagens.
const COUNTS_KEY = CONFIG.COUNTS_CACHE_KEY + (MOCK ? ':mock' : '');
function getCachedCounts() {
  try {
    const raw = sessionStorage.getItem(COUNTS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.ts) return null;
    if (Date.now() - obj.ts > CONFIG.COUNTS_TTL_MIN * 60 * 1000) return null;
    return obj.counts;
  } catch (e) { return null; }
}
function setCachedCounts(counts) {
  try { sessionStorage.setItem(COUNTS_KEY, JSON.stringify({ ts: Date.now(), counts })); } catch (e) {}
}

async function fetchCounts(sellerId) {
  const cached = getCachedCounts();
  if (cached) return cached;

  const counts = {};
  let ok = false;   // pelo menos 1 chamada respondeu — {} por falha total NUNCA vira "Tudo certo!"

  // 1 chamada com include_filters -> counts de labels / status / sub_status
  try {
    const inc = await mlGet(`users/${sellerId}/items/search?include_filters=true&limit=1`);
    ok = true;
    const filterGroups = [].concat(inc.available_filters || [], inc.filters || []);
    filterGroups.forEach((g) => {
      (g.values || []).forEach((v) => {
        if (g.id === 'labels') counts['label_' + v.id] = v.results;
        else if (g.id === 'status') counts['status_' + v.id] = v.results;
        else if (g.id === 'sub_status') counts['substatus_' + v.id] = v.results;
      });
    });
  } catch (e) { /* segue sem esses counts */ }

  // 2 chamadas gauge (limit=1, lê paging.total)
  try {
    const g1 = await mlGet(`users/${sellerId}/items/search?reputation_health_gauge=unhealthy&limit=1`);
    ok = true;
    counts.gauge_unhealthy = (g1.paging && g1.paging.total) || 0;
  } catch (e) {}
  try {
    const g2 = await mlGet(`users/${sellerId}/items/search?reputation_health_gauge=warning&limit=1`);
    ok = true;
    counts.gauge_warning = (g2.paging && g2.paging.total) || 0;
  } catch (e) {}

  // 1 chamada missing_product_identifiers
  try {
    const m = await mlGet(`users/${sellerId}/items/search?missing_product_identifiers=true&limit=1`);
    ok = true;
    counts.missing_product_identifiers = (m.paging && m.paging.total) || 0;
  } catch (e) {}

  // Falha TOTAL (nenhuma chamada respondeu): não cachear nem renderizar {} como "Tudo certo".
  // Conta legitimamente vazia (chamadas ok, zero problemas) continua mostrando a mensagem verde.
  if (!ok) throw new Error('resumo_indisponivel');

  setCachedCounts(counts);
  return counts;
}

function renderChips(counts) {
  const area = $('#chipsArea');
  const visible = PROBLEM_CHIPS
    .map((c) => ({ chip: c, count: Number(counts[c.countKey] || 0) }))
    .filter((x) => x.count > 0);

  if (visible.length === 0) {
    area.innerHTML = '<div class="chips-clean"><span class="chip-ind" style="background:var(--green);box-shadow:0 0 0 3px var(--green-light)"></span> Tudo certo! Nenhum problema encontrado nos seus anúncios.</div>';
    return;
  }

  const html = '<div class="chips">' + visible.map(({ chip, count }) => {
    const on = state.activeChip === chip.id ? ' active' : '';
    return `<button class="chip${on}" data-chip="${chip.id}">
      <span class="chip-ind sev-${chip.sev}"></span>
      <span>${escapeHtml(chip.label)}</span>
      <span class="chip-count">${count}</span>
    </button>`;
  }).join('') + '</div><p class="chips-tip">Escolha um problema para ver só esses anúncios</p>';
  area.innerHTML = html;

  wireChipButtons(area, counts);
}

// Repinta os chips a partir do cache; sem cache (expirou ou o resumo falhou antes),
// mostra o skeleton e rebusca — {} nunca vira um falso "Tudo certo!".
function renderChipsFresh() {
  const cached = getCachedCounts();
  if (cached) { renderChips(cached); return; }
  $('#chipsArea').innerHTML = '<div class="chips-skel"><span></span><span></span><span></span><span></span></div>';
  fetchCounts(state.sellerId)
    .then((c) => { renderChips(c); })
    .catch(() => { $('#chipsArea').innerHTML = '<p class="chips-tip">Não deu para carregar o resumo agora — toque ou clique em “Atualizar” para tentar de novo.</p>'; });
}

function wireChipButtons(area, counts) {

  area.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-chip');
      state.activeChip = (state.activeChip === id) ? null : id;
      state.offset = 0;
      // chip que fixa status (paused_no_stock) sincroniza o toggle visual;
      // chip sem status próprio zera o filtro de status ("Todos") pra lista bater com a contagem do chip
      const chip = PROBLEM_CHIPS.find((c) => c.id === state.activeChip);
      if (chip) {
        // guarda o status que o usuário tinha antes do chip (pra devolver quando ele sair)
        if (state.prevStatus == null) state.prevStatus = state.status;
        if (chip.filter.status) setStatusToggle(chip.filter.status);
        else setStatusToggle('all');
      } else {
        // desativou o chip: devolve o status de antes em vez de largar em "Todos"
        setStatusToggle(state.prevStatus || 'active');
        state.prevStatus = null;
      }
      renderChips(getCachedCounts() || counts);
      syncClearBtn();
      loadPage().then(() => {
        // no celular os chips ficam acima da dobra — leva o usuário até a lista filtrada
        if (window.matchMedia('(max-width:720px)').matches) $('#tableHost').scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  });
}

/* =========================================================================
   Cache genérico em sessionStorage (chaves separadas mock/real, TTL SET_TTL_MIN)
   ========================================================================= */
function scopedKey(base) { return base + (MOCK ? ':mock' : ''); }
function getCachedJson(base) {
  try {
    const raw = sessionStorage.getItem(scopedKey(base));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.ts || Date.now() - obj.ts > CONFIG.SET_TTL_MIN * 60 * 1000) return null;
    return obj.data;
  } catch (e) { return null; }
}
function setCachedJson(base, data) {
  try { sessionStorage.setItem(scopedKey(base), JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
}

/* Re-render incremental: as camadas B/C chegam depois e enriquecem a página já pintada.
   Guardado por state.loading: callbacks tardios (visitas/sinais da página ANTERIOR) não
   podem repintar itens velhos por cima do spinner durante uma troca de página. */
function renderCurrentRows() {
  if (state.loading) return;
  if (state.lastItems && state.lastItems.length) renderRows(state.lastItems);
}

/* =========================================================================
   Camada B — Sets de IDs por sinal (só busca sinais com contador > 0)
   ========================================================================= */
async function fetchSignalIds(sellerId, filter) {
  const ids = [];
  let incomplete = false;   // true = a varredura NÃO cobriu todos os anúncios do sinal (não afirmar "OK")
  for (let offset = 0; offset < CONFIG.SIGNAL_SET_CAP; offset += CONFIG.SIGNAL_SET_PAGE) {
    const p = new URLSearchParams(filter);
    p.set('limit', String(CONFIG.SIGNAL_SET_PAGE));
    p.set('offset', String(offset));
    let resp;
    try { resp = await mlGet(`users/${sellerId}/items/search?${p.toString()}`); }
    catch (e) { if (offset > 0) incomplete = true; break; }
    const results = Array.isArray(resp.results) ? resp.results : [];
    results.forEach((it) => { const v = typeof it === 'string' ? it : (it && (it.id || it.item_id)); if (v) ids.push(v); });
    const total = (resp.paging && resp.paging.total) || 0;
    if (offset + CONFIG.SIGNAL_SET_PAGE >= total) break;
    if (offset + CONFIG.SIGNAL_SET_PAGE >= CONFIG.SIGNAL_SET_CAP && total > CONFIG.SIGNAL_SET_CAP) {
      console.warn(`[ad-selector] sinal cobre só os primeiros ${CONFIG.SIGNAL_SET_CAP} de ${total} anúncios`);
      incomplete = true;
      break;
    }
  }
  return { ids, incomplete };
}

async function loadSignalSets(sellerId, counts) {
  for (const sig of SIGNAL_SETS) {
    const cnt = Number((counts && counts[sig.countKey]) || 0);
    if (cnt <= 0) { state.signalSets[sig.id] = new Set(); state.signalSetsIncomplete[sig.id] = false; continue; }  // chip diz 0 -> não chama
    const cached = getCachedJson('mf_sel_sig2_' + sig.id);
    if (cached && Array.isArray(cached.ids)) {
      state.signalSets[sig.id] = new Set(cached.ids);
      state.signalSetsIncomplete[sig.id] = !!cached.incomplete;
      renderCurrentRows(); continue;
    }
    const found = await fetchSignalIds(sellerId, sig.filter);
    setCachedJson('mf_sel_sig2_' + sig.id, found);
    state.signalSets[sig.id] = new Set(found.ids);
    state.signalSetsIncomplete[sig.id] = !!found.incomplete;
    renderCurrentRows(); // enriquece a página assim que cada sinal fica pronto
  }
}

/* =========================================================================
   Camada C — perguntas sem resposta (1 chamada por conta, cache 10 min)
   ========================================================================= */
async function loadQuestions(sellerId) {
  if (!CONFIG.SHOW_QUESTIONS) return;   // PORT F4: sem rota no proxy ainda
  const cached = getCachedJson('mf_sel_questions');
  if (cached) { state.questionsMap = cached; renderCurrentRows(); return; }
  try {
    const resp = await mlGet(`questions/search?seller_id=${sellerId}&status=UNANSWERED&limit=50`);
    const map = {};
    (resp.questions || []).forEach((qq) => { if (qq && qq.item_id) map[qq.item_id] = (map[qq.item_id] || 0) + 1; });
    state.questionsMap = map;
    setCachedJson('mf_sel_questions', map);
    renderCurrentRows();
  } catch (e) { /* 403/erro (ex.: whitelist antiga do serve.js) -> segue sem badges de pergunta */ }
}

/* =========================================================================
   Camada C — vendas 30d por item via orders/search (POR CONTA, não por item:
   1-3 chamadas no total, cache 10 min). Soma as unidades por item dos pedidos
   pagos dos últimos 30 dias. Honestidade: se a conta tem mais pedidos que o
   teto varrido, marca incomplete e as taxas NÃO aparecem (parcial enganaria).
   Escopo de leitura de orders/search VALIDADO com token real (22/07): 200 OK.
   ========================================================================= */
async function loadSales30(sellerId) {
  if (!CONFIG.SHOW_SALES30) return;   // PORT F4: sem rota no proxy ainda
  const cached = getCachedJson('mf_sel_sales30');
  if (cached) { state.sales30Map = cached.map; state.sales30Incomplete = !!cached.incomplete; renderCurrentRows(); return; }
  try {
    const from = new Date(Date.now() - CONFIG.SALES_WINDOW_DAYS * 864e5).toISOString();
    const map = {};
    let offset = 0, total = 0, pages = 0;
    do {
      const resp = await mlGet(`orders/search?seller=${sellerId}&order.status=paid&order.date_created.from=${encodeURIComponent(from)}&limit=50&offset=${offset}`);
      total = (resp.paging && resp.paging.total) || 0;
      (resp.results || []).forEach((o) => (o.order_items || []).forEach((oi) => {
        const iid = oi && oi.item && oi.item.id;
        if (iid) map[iid] = (map[iid] || 0) + (Number(oi.quantity) || 0);
      }));
      offset += 50; pages++;
    } while (offset < total && pages < CONFIG.SALES30_MAX_PAGES);
    const incomplete = total > offset && offset >= CONFIG.SALES30_MAX_PAGES * 50;
    state.sales30Map = map;
    state.sales30Incomplete = incomplete;
    setCachedJson('mf_sel_sales30', { map, incomplete });
    renderCurrentRows();
  } catch (e) { /* sem escopo de pedidos / erro -> segue sem conversão; previsão cai no ritmo desde a criação */ }
}
// Unidades vendidas nos últimos 30d de um item (null = camada indisponível/incompleta)
function sales30Of(id) {
  if (!state.sales30Map || state.sales30Incomplete) return null;
  return state.sales30Map[id] || 0;
}

/* =========================================================================
   Camada C — visitas 30d por item. 1 chamada por item (ML não tem bulk),
   com limite de concorrência. Custo ~PAGE_SIZE chamadas por página.
   ========================================================================= */
// time_window devolve o TOTAL e a série diária na MESMA chamada (custo igual ao
// endpoint de total puro) — a série alimenta o minigráfico de tendência.
// VALIDADO com token real (22/07): 200 com total_visits + results[]; item sem
// visita nenhuma devolve results VAZIO (não 30 zeros) — o map() abaixo cobre.
async function loadVisitsForPage(ids) {
  if (!CONFIG.SHOW_VISITS) return;
  const pending = ids.filter((id) => !(id in state.visitsMap));
  if (!pending.length) return;
  let idx = 0;
  async function worker() {
    while (idx < pending.length) {
      const id = pending[idx++];
      try {
        const resp = await mlGet(`items/${id}/visits/time_window?last=${CONFIG.VISITS_WINDOW_DAYS}&unit=day`);
        state.visitsMap[id] = (resp && typeof resp.total_visits === 'number') ? resp.total_visits : null;
        if (resp && Array.isArray(resp.results)) state.visitsSeries[id] = resp.results.map((r) => Number(r && r.total) || 0);
      } catch (e) { state.visitsMap[id] = null; }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(CONFIG.VISITS_CONCURRENCY, pending.length); i++) workers.push(worker());
  await Promise.all(workers);
  renderCurrentRows();
}

/* =========================================================================
   Construção da URL de busca da página
   ========================================================================= */
function buildListUrl(offsetOverride) {
  const p = new URLSearchParams();

  // status (o filtro do chip pode sobrescrever depois)
  if (state.status === 'active') p.set('status', 'active');
  else if (state.status === 'paused') p.set('status', 'paused');
  // 'all' -> não manda status

  p.set('orders', state.order);
  p.set('limit', String(CONFIG.PAGE_SIZE));
  p.set('offset', String(offsetOverride != null ? offsetOverride : state.offset));

  // filtro do chip ativo (pode sobrescrever status)
  if (state.activeChip) {
    const chip = PROBLEM_CHIPS.find((c) => c.id === state.activeChip);
    if (chip) Object.entries(chip.filter).forEach(([k, v]) => p.set(k, v));
  }

  // filtros server-side validados com token real
  if (state.listingType) p.set('listing_type_id', state.listingType);
  if (state.logisticType) p.set('logistic_type', state.logisticType);

  // busca textual (q ou sku) — o caso MLB é tratado antes, sem chamar search
  if (state.search && state.searchParam) {
    p.set(state.searchParam, state.search);
  }

  return `users/${state.sellerId}/items/search?${p.toString()}`;
}

/* =========================================================================
   Hidratação em chunks de 20 via multiget
   ========================================================================= */
async function hydrate(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CONFIG.HYDRATE_CHUNK) {
    const chunk = ids.slice(i, i + CONFIG.HYDRATE_CHUNK);
    const resp = await mlGet(`items?ids=${chunk.join(',')}&attributes=${encodeURIComponent(CONFIG.MULTIGET_ATTRS)}`);
    (resp || []).forEach((entry) => {
      if (entry && entry.body && (entry.code === 200 || entry.body.id)) out.push(entry.body);
    });
  }
  return out;
}

/* =========================================================================
   Badges por anúncio (client-side, a partir do multiget)
   ========================================================================= */
function computeBadges(item) {
  const problems = [];  // problemas suprimem o badge "OK"
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const id = item.id || '';
  const inSet = (sigId) => !!(state.signalSets[sigId] && state.signalSets[sigId].has(id));

  // sub_status (array na ML)
  const subs = Array.isArray(item.sub_status) ? item.sub_status : (item.sub_status ? [item.sub_status] : []);
  subs.forEach((s) => {
    const map = PROBLEM_RULES.subStatusLabels[s];
    if (map) problems.push({ text: map.text, cls: map.cls });
    else problems.push({ text: 'Precisa de atenção', cls: 'gray' });  // sub_status desconhecido nunca sai em inglês
  });

  // Saúde SÓ quando numérica. Validado: health vem null na maioria (null = sem dado, sem badge).
  if (typeof item.health === 'number' && item.health < PROBLEM_RULES.healthThreshold) {
    problems.push({ text: 'Saúde do anúncio ' + Math.round(item.health * 100) + '%', cls: 'red' });
  }
  // Camada B — reputação (interseção de IDs): perder > risco
  if (inSet('unhealthy')) problems.push({ text: 'Perdendo exposição', cls: 'red' });
  else if (inSet('warning')) problems.push({ text: 'Risco de perder exposição', cls: 'orange' });

  // Ficha técnica incompleta (tag do multiget)
  if (tags.includes(PROBLEM_RULES.incompleteSpecsTag)) problems.push({ text: 'Ficha técnica incompleta', cls: 'orange' });

  // Foto de baixa qualidade — Camada B (autoritativo) OU tag (redundância) -> 1 badge só
  if (inSet('low_quality_img') || PROBLEM_RULES.lowQualityPhotoTags.some((t) => tags.includes(t))) {
    problems.push({ text: 'Foto de baixa qualidade', cls: 'orange' });
  }
  // Camada A — Anúncio Grátis (baixa exposição; fato do ML)
  if (item.listing_type_id === PROBLEM_RULES.freeListingType) {
    problems.push({ text: 'Anúncio Grátis — baixa exposição', cls: 'orange' });
  }
  // Camada A — frete grátis pago do próprio bolso (preço abaixo do piso do ML)
  if (isCheapFreeShipping(item)) problems.push({ text: CHEAP_FREESHIP_BADGE, cls: 'orange' });
  // Camada B — estoque quase no fim
  if (inSet('few_available')) problems.push({ text: 'Estoque quase no fim', cls: 'yellow' });

  // Título curto — SÓ se ainda não vendeu (nunca sinalizar título que já vende: reseta indexação)
  if ((item.title || '').length < PROBLEM_RULES.shortTitleMax && item.sold_quantity === 0) {
    problems.push({ text: 'Título curto', cls: 'yellow' });
  }
  // Camada B — sem código GTIN
  if (inSet('missing_gtin')) problems.push({ text: 'Sem código de barras (GTIN)', cls: 'gray' });

  // Camada C — sem visitas em 30 dias (só quando já carregou e deu exatamente 0)
  if (CONFIG.SHOW_VISITS && state.visitsMap[id] === 0) {
    problems.push({ text: 'Sem visitas em 30 dias', cls: 'gray' });
  }
  // Camada C — perguntas sem resposta
  const nq = state.questionsMap[id] || 0;
  if (nq > 0) problems.push({ text: nq === 1 ? '1 pergunta sem resposta' : nq + ' perguntas sem resposta', cls: 'orange' });

  // Garantia não informada (menor prioridade, mas conta como problema; aponta o campo a preencher)
  if (!item.warranty) problems.push({ text: 'Garantia não informada', cls: 'gray' });

  // Monta: problemas (ou OK) + informativos neutros (não suprimem OK).
  // Catálogo saiu dos badges: virou marcador dedicado junto do título (tag-catalog).
  const out = [];
  problems.forEach((b) => out.push(b));
  // Varredura incompleta de algum sinal (conta grande) e o item não está no Set:
  // não dá pra afirmar que está tudo bem — melhor sem veredito do que um "OK" falso.
  const uncertain = SIGNAL_SETS.some((s) => state.signalSetsIncomplete[s.id] && !(state.signalSets[s.id] && state.signalSets[s.id].has(id)));
  if (problems.length === 0 && !uncertain) out.push({ text: 'Sem problemas', cls: 'green' });
  // Camada A — informativos neutros
  if (item.shipping && item.shipping.free_shipping === false) out.push({ text: 'Sem frete grátis', cls: 'gray' });
  // "Ainda sem vendas" (não "Sem vendas"): não contradiz o "Sem problemas" na mesma linha
  if (item.sold_quantity === 0) out.push({ text: 'Ainda sem vendas', cls: 'gray' });
  return out;
}

/* =========================================================================
   Render da tabela
   ========================================================================= */
function loadingHtml(msg) {
  return `<div class="comp-loading">
    <div class="comp-orbital">
      <div class="comp-orbital-ring"></div>
      <div class="comp-orbital-ring"></div>
      <div class="comp-orbital-dot"></div>
    </div>
    <p class="comp-loading-msg">${escapeHtml(msg || 'Carregando seus anúncios…')}</p>
    <div class="comp-loading-bar"><div class="comp-loading-bar-fill"></div></div>
  </div>`;
}

/* ── Helpers de render ── */
function httpsThumb(t) { return (t || '').replace(/^http:\/\//, 'https://'); }
// Ordena por severidade; no desktop mostra no máx. 2 badges e o resto colapsa num "+N"
// clicável (expande/colapsa por linha via state.expandedBadges) — 2 mantém a linha baixa
// e cabem mais anúncios na tela. No mobile o card não tem a restrição de largura — todos
// os sinais aparecem sempre. "OK" (green) abre a lista.
const BADGE_SEVERITY = { red: 0, orange: 1, yellow: 2, gray: 3, blue: 4, green: -1 };
// Tooltips de "o que fazer" nos badges de problema (só os com entrada no mapa)
const BADGE_TITLES = {
  'Foto de baixa qualidade': 'O Mercado Livre marcou a foto principal deste anúncio como de baixa qualidade. Trocar a foto de capa resolve o sinal.',
  'Ficha técnica incompleta': 'Preencha os campos que faltam na ficha técnica do anúncio no Mercado Livre.',
  'Sem código de barras (GTIN)': 'Informe o código de barras (GTIN/EAN) do produto no anúncio.',
  'Perdendo exposição': 'O Mercado Livre está mostrando menos este anúncio nas buscas. Clique em Analisar para ver o que corrigir.',
  'Risco de perder exposição': 'Este anúncio pode passar a aparecer menos nas buscas. Analise para corrigir a tempo.',
  'Corrigir para reativar': 'O Mercado Livre pediu uma correção neste anúncio. Depois de corrigir, ele volta a valer.',
  'Anúncio Grátis — baixa exposição': 'Anúncios do tipo Grátis aparecem bem menos nas buscas do Mercado Livre.',
  'Título curto': 'Dá para aproveitar melhor o título: inclua produto, marca, modelo e a característica principal.',
  'Garantia não informada': 'Preencha o campo de garantia do anúncio — é uma informação que passa confiança para quem compra.',
  'Infração': 'O Mercado Livre apontou uma infração neste anúncio. Veja os detalhes na sua conta do Mercado Livre.',
  'Congelado': 'O Mercado Livre pausou este anúncio temporariamente. Veja os detalhes na sua conta do Mercado Livre.',
};
// Badge do frete grátis abaixo do piso (texto acompanha PROBLEM_RULES.freeShippingFloor)
const CHEAP_FREESHIP_BADGE = 'Frete grátis abaixo de R$ ' + PROBLEM_RULES.freeShippingFloor;
BADGE_TITLES[CHEAP_FREESHIP_BADGE] = 'Abaixo de R$ ' + PROBLEM_RULES.freeShippingFloor + ' o Mercado Livre não obriga frete grátis — esse frete sai do seu bolso e costuma comer quase toda a margem. Confira se compensa manter.';
// Cobre também o badge com número variável ("Saúde do anúncio 45%")
function badgeTitle(text) {
  return BADGE_TITLES[text] || (text.indexOf('Saúde do anúncio') === 0 ? 'Nota que o próprio Mercado Livre dá para este anúncio — a análise mostra o que melhorar.' : '');
}
function badgesHtml(list, rowKey) {
  const sorted = list.slice().sort((a, b) =>
    (a.cls in BADGE_SEVERITY ? BADGE_SEVERITY[a.cls] : 9) - (b.cls in BADGE_SEVERITY ? BADGE_SEVERITY[b.cls] : 9));
  const isMobile = window.matchMedia('(max-width:720px)').matches;
  const expanded = !!(rowKey != null && state.expandedBadges[rowKey]);
  // mobile também colapsa (P6 do design review): card mostra os 2 mais graves + "+N sinais ▾"
  const showAll = expanded;
  // Informativos (gray/blue) nunca ocupam as vagas visíveis do desktop — vão sempre
  // pro "+N sinais" (o verde "Sem problemas" continua visível: tranquiliza sem contradição)
  const isInfo = (b) => b.cls === 'gray' || b.cls === 'blue';
  const collapsedShown = sorted.filter((b) => !isInfo(b)).slice(0, 2);
  const shown = showAll ? sorted : collapsedShown;
  const resto = showAll ? [] : sorted.filter((b) => collapsedShown.indexOf(b) === -1);
  let html = shown.map((b) => {
    // hover no desktop (title=) + toque no mobile (data-hint, ligado em wireRows)
    const hint = badgeTitle(b.text);
    return `<span class="badge ${b.cls}"${hint ? ` title="${escapeHtml(hint)}" data-hint="${escapeHtml(hint)}"` : ''}>${escapeHtml(b.text)}</span>`;
  }).join('');
  if (resto.length) html += `<span class="badge badge-more" data-more="${escapeHtml(rowKey)}" title="${escapeHtml(resto.map((b) => b.text).join(' · '))}">${resto.length === 1 ? '+1 sinal ▾' : `+${resto.length} sinais ▾`}</span>`;
  else if (expanded && sorted.length > collapsedShown.length) html += `<span class="badge badge-more" data-more="${escapeHtml(rowKey)}">− mostrar menos ▴</span>`;
  return html;
}
// Marcador especial de catálogo (junto do título; não é badge de sinal)
function isCatalogItem(item) {
  return item.catalog_listing === true || (item.tags || []).includes(PROBLEM_RULES.catalogTag);
}
function catalogTagHtml(item) {
  if (!isCatalogItem(item)) return '';
  return '<span class="tag-catalog" title="Este anúncio participa do catálogo do Mercado Livre (disputa o destaque da página do produto).">◆ Catálogo</span>';
}
// Taxa de conversão 30d = vendas 30d ÷ visitas 30d (só quando as DUAS janelas reais existem)
function convHtml(id) {
  if (!CONFIG.SHOW_VISITS) return '';
  const v = state.visitsMap[id];
  const s = sales30Of(id);
  if (typeof v !== 'number' || v <= 0 || s == null) return '';
  const pct = Math.min(100, (s / v) * 100);
  const txt = pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `<span class="conv-rate" title="Taxa de conversão dos últimos 30 dias: ${escapeHtml(String(s))} venda${s === 1 ? '' : 's'} em ${escapeHtml(String(v))} visitas.">conversão ${txt}%</span>`;
}
// Minigráfico de tendência (visitas por dia, 30d) — SVG inline, dados numéricos próprios.
// Design review (P3): baseline tênue (dá referência de "plano"), traço FORA do azul
// interativo, e ponto final colorido pela DIREÇÃO (última semana vs anterior) — a
// direção é comparável entre linhas; a altura não (cada spark tem escala própria).
function sparkTrend(series) {
  const n = series.length;
  if (n < 14) return 'flat';
  const last = series.slice(n - 7).reduce((a, b) => a + b, 0);
  const prev = series.slice(n - 14, n - 7).reduce((a, b) => a + b, 0);
  if (prev === 0) return last > 0 ? 'up' : 'flat';
  const delta = (last - prev) / prev;
  return delta > 0.1 ? 'up' : (delta < -0.1 ? 'down' : 'flat');
}
function sparklineSvg(series) {
  if (!Array.isArray(series) || series.length < 2) return '';
  const w = 56, h = 16, n = series.length;
  const max = Math.max.apply(null, series);
  const pt = (v, i) => ({ x: (i / (n - 1)) * w, y: max > 0 ? (h - 2) - (v / max) * (h - 4) : h - 2 });
  const pts = series.map((v, i) => { const p = pt(v, i); return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  const trend = sparkTrend(series);
  const dotColor = trend === 'up' ? 'var(--green-dark)' : (trend === 'down' ? 'var(--red)' : '#94a3b8');
  const end = pt(series[n - 1], n - 1);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <line x1="0" y1="${h - 2}" x2="${w}" y2="${h - 2}" stroke="var(--border)" stroke-width="1"/>
    <polyline points="${pts}" fill="none" stroke="#94a3b8" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="2.2" fill="${dotColor}"/>
  </svg>`;
}
function visitsCell(v, id) {
  const txt = !CONFIG.SHOW_VISITS ? '—' : (v === undefined ? '…' : (v == null ? '—' : String(v)));
  const low = CONFIG.SHOW_VISITS && v === 0;
  const conv = id ? convHtml(id) : '';
  const spark = (id && typeof v === 'number' && v > 0) ? sparklineSvg(state.visitsSeries[id]) : '';
  const num = `<span class="mono cell-stock${low ? ' low' : ''}">${escapeHtml(txt)}</span>`;
  const line = spark ? `<span class="visits-line" title="Visitas por dia nos últimos 30 dias — a linha mostra a tendência.">${spark}${num}</span>` : num;
  return (spark || conv) ? `<span class="stock-wrap">${line}${conv}</span>` : num;
}
// Série somada da família (só quando TODAS as variações já têm série carregada)
function familySparkline(items) {
  const all = items.map((i) => state.visitsSeries[i.id]);
  if (!all.length || all.some((s) => !Array.isArray(s) || !s.length)) return '';
  const n = Math.min.apply(null, all.map((s) => s.length));
  const sum = [];
  for (let i = 0; i < n; i++) sum.push(all.reduce((acc, s) => acc + (s[s.length - n + i] || 0), 0));
  return sparklineSvg(sum);
}
// Estoque estimado em dias: ritmo médio = vendas totais ÷ dias desde a criação do anúncio.
// Estimativa simples com os dados que já temos (custo de API zero) — só aparece quando há
// vendas, estoque e data de criação; sem esses três, não inventamos número.
function stockDaysRate(item) {
  const q = Number(item.sold_quantity);
  if (!(q > 0) || !item.date_created) return 0;
  const age = (Date.now() - new Date(item.date_created).getTime()) / 86400000;
  return age >= 1 ? q / age : 0;
}
function stockDaysFromRate(stock, rate) {
  const s = Number(stock);
  if (!(s > 0) || !(rate > 0)) return null;
  const days = Math.round(s / rate);
  return (isFinite(days) && days >= 1) ? days : null;
}
function stockDaysHtml(days, basis) {
  // P12 do design review: acima de 1 ano a estimativa não é acionável e o "≈ 1 ano+"
  // repetido em toda linha afogava os poucos "≈ 2 dias" que importam — suprime.
  // (1 ano é o horizonte de exibição que já usávamos no texto, não um threshold novo.)
  if (days == null || days > 365) return '';
  const base = basis === '30d' ? 'no ritmo de vendas dos últimos 30 dias' : 'no ritmo de vendas desde a criação do anúncio';
  return `<span class="stock-days" title="Estimativa: ${base}, o estoque atual dura cerca de ${days} dia${days === 1 ? '' : 's'}.">≈ ${days} dias</span>`;
}
// Previsão de duração do estoque: prioriza o ritmo RECENTE (vendas 30d, quando a camada
// está completa e o item vendeu na janela); senão cai no ritmo médio desde a criação.
function stockDaysFor(item, stock) {
  const s30 = sales30Of(item.id);
  if (s30 != null && s30 > 0) return { days: stockDaysFromRate(stock, s30 / CONFIG.SALES_WINDOW_DAYS), basis: '30d' };
  return { days: stockDaysFromRate(stock, stockDaysRate(item)), basis: 'vida' };
}
function stockCellHtml(stock, lowClass, est) {
  const num = `<span class="mono cell-stock${lowClass ? ' low' : ''}">${stock != null ? escapeHtml(String(stock)) : '—'}</span>`;
  const d = est ? stockDaysHtml(est.days, est.basis) : '';
  return d ? `<span class="stock-wrap">${num}${d}</span>` : num;
}
// Desconto: % arredondado quando original_price > price
function discountPct(item) {
  const o = Number(item.original_price), p = Number(item.price);
  return (o && p && o > p) ? Math.round((1 - p / o) * 100) : 0;
}
// Frete grátis pago do próprio bolso: preço abaixo do piso de obrigatoriedade do ML
// e frete grátis ligado — o vendedor banca o frete e a margem despenca
function isCheapFreeShipping(item) {
  const p = Number(item.price);
  return !!(item.shipping && item.shipping.free_shipping === true && p > 0 && p < PROBLEM_RULES.freeShippingFloor);
}
function priceHtml(price, originalPrice, offPct) {
  const orig = (offPct && originalPrice) ? `<span class="price-orig">${escapeHtml(fmtPrice(originalPrice))}</span>` : '';
  const off = offPct ? `<span class="badge-off">-${offPct}%</span>` : '';
  // pill ANTES do preço: o preço termina sempre na borda direita da coluna (linhas alinham entre si)
  return `${orig}${off}<span class="mono cell-price">${escapeHtml(fmtPrice(price))}</span>`;
}
// Ações junto do ID: copiar + abrir no ML (ícone SVG flat — sem emoji)
const COPY_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
function idActionsHtml(id, permalink) {
  const open = permalink ? `<a class="id-act id-open" href="${escapeHtml(permalink)}" target="_blank" rel="noopener" title="Abrir no Mercado Livre" aria-label="Abrir no Mercado Livre">↗</a>` : '';
  return `<span class="id-actions"><span class="id-act id-copy" data-copy="${escapeHtml(id)}" title="Copiar ID" aria-label="Copiar ID">${COPY_ICON_SVG}</span>${open}</span>`;
}
// União de badges de várias variações (dedup por texto; "OK" some se houver qualquer outro).
// Na linha-família, badges por variação não podem contradizer os números agregados da linha:
// "Ainda sem vendas" ao lado de Vendas=7 vira "Variação ainda sem vendas" (o sinal segue honesto —
// aponta a variação-problema, que o vendedor acha expandindo a família).
function unionBadges(items, agg) {
  const seen = new Map();
  const multi = items.length > 1;
  items.forEach((it) => computeBadges(it).forEach((b) => {
    let text = b.text;
    if (multi && agg) {
      if (text === 'Ainda sem vendas' && agg.sales > 0) text = 'Variação ainda sem vendas';
      else if (text === 'Sem visitas em 30 dias' && agg.visitsSum > 0) text = 'Variação sem visitas';
      else if (text === 'Estoque quase no fim') text = 'Variação: estoque quase no fim';
      else if (text === 'Sem estoque' && agg.stock > 0) text = 'Variação sem estoque';
    }
    if (!seen.has(text)) seen.set(text, { text, cls: b.cls });
  }));
  let arr = [...seen.values()];
  if (arr.length > 1) arr = arr.filter((b) => b.cls !== 'green');
  return arr;
}
// Agrupa os itens da página por family_id (2+); famílias de 1 item viram linha simples.
// Sob recorte (chip, busca ou "Com desconto") NÃO agrupa: o agregado somaria só as
// variações que bateram no recorte e a linha "N variações · Estoque X" mentiria sobre o
// produto inteiro (agregado de família parcial induz decisão de reposição errada).
// Cada variação vira linha simples com os números reais dela; o clique continua
// analisando o produto (user_product_id), então "analisar MLBU" fica intacto.
function buildDisplayRows(items) {
  const hasCut = !!(state.activeChip || state.search || state.discountOnly || state.freeShipUnder);
  if (!CONFIG.GROUP_FAMILIES || hasCut) return items.map((it) => ({ type: 'single', item: it }));
  const rows = [];
  const idx = {};
  items.forEach((it) => {
    const fam = (it.family_id != null && it.family_id !== '') ? String(it.family_id) : null;
    if (!fam) { rows.push({ type: 'single', item: it }); return; }
    if (idx[fam] == null) { idx[fam] = rows.length; rows.push({ type: 'family', familyId: fam, items: [it] }); }
    else rows[idx[fam]].items.push(it);
  });
  return rows.map((r) => (r.type === 'family' && r.items.length === 1) ? { type: 'single', item: r.items[0] } : r);
}
// Título da linha-família: maior prefixo comum entre os títulos das variações.
// Título de UMA variação ("— Tam M") ao lado de estoque/vendas SOMADOS induz erro de
// leitura e sugere que só aquela variação será analisada. Cálculo 100% client-side
// sobre dados já carregados — zero custo de API.
function familyTitle(items, fallbackTitle) {
  const titles = items.map((i) => String(i.title || ''));
  let p = titles[0] || '';
  for (let k = 1; k < titles.length && p; k++) {
    const t = titles[k];
    let j = 0;
    const max = Math.min(p.length, t.length);
    while (j < max && p[j] === t[j]) j++;
    p = p.slice(0, j);
  }
  // corte no meio de palavra -> recua até o último espaço
  const midWord = p.length > 0 && p[p.length - 1] !== ' '
    && titles.some((t) => t.length > p.length && t[p.length] !== ' ');
  if (midWord) {
    const sp = p.lastIndexOf(' ');
    p = sp >= 0 ? p.slice(0, sp) : '';
  }
  // apara espaços e separadores do fim
  p = p.replace(/[\s—–\-·,|(]+$/, '');
  // palavra final de <=3 caracteres precedida de separador (ex.: "Tam", "Cor") sai também
  const m = p.match(/[\s—–\-·,|(]+[^\s—–\-·,|(]{1,3}$/);
  if (m) p = p.slice(0, p.length - m[0].length);
  // resultado curto demais -> mantém o comportamento atual (título do representante)
  if (p.length < 10) return fallbackTitle || '';
  return p;
}
function familyAgg(items) {
  const rep = items.reduce((a, b) => ((b.sold_quantity || 0) > (a.sold_quantity || 0) ? b : a), items[0]);
  const prices = items.map((i) => Number(i.price)).filter((n) => !isNaN(n));
  let visitsPending = false, visitsSum = 0;
  items.forEach((i) => { const v = state.visitsMap[i.id]; if (v === undefined) visitsPending = true; else if (typeof v === 'number') visitsSum += v; });
  const upItem = items.find((i) => i.user_product_id);
  // faixa dos preços originais (só variações com desconto) — pro "de R$X por R$Y" da linha-família
  const origs = items.filter((i) => discountPct(i) > 0).map((i) => Number(i.original_price)).filter((n) => !isNaN(n));
  return {
    rep,
    min: Math.min.apply(null, prices), max: Math.max.apply(null, prices),
    stock: items.reduce((s, i) => s + (Number(i.available_quantity) || 0), 0),
    sales: items.reduce((s, i) => s + (Number(i.sold_quantity) || 0), 0),
    visitsPending, visitsSum,
    maxOff: Math.max.apply(null, [0].concat(items.map(discountPct))),
    origMin: origs.length ? Math.min.apply(null, origs) : null,
    origMax: origs.length ? Math.max.apply(null, origs) : null,
    // ritmo de vendas somado das variações (vendas/dia) — pra estimativa de duração do estoque
    rateSum: items.reduce((s, i) => s + stockDaysRate(i), 0),
    count: items.length,
    userProductId: (rep.user_product_id) || (upItem && upItem.user_product_id) || null,
  };
}

// Faixa persistente enquanto um chip de problema filtra a lista (não usa setBanner:
// loadPage chama clearBanner e apagaria o aviso)
function chipFilterBannerHtml() {
  if (!state.activeChip) return '';
  const chip = PROBLEM_CHIPS.find((c) => c.id === state.activeChip);
  if (!chip) return '';
  return `<div class="banner info" style="margin:12px 12px 0"><span>ℹ️</span><span>Mostrando só: <b><span class="chip-ind sev-${chip.sev}"></span> ${escapeHtml(chip.label)}</b> — <button type="button" class="chip-clear-link" id="chipClearBtn">voltar para a minha lista</button></span></div>`;
}
// Botão "ver todos os anúncios" do banner: mesmo efeito de desativar o chip no resumo
function wireChipClearBtn() {
  const cb = document.getElementById('chipClearBtn');
  if (cb) cb.addEventListener('click', () => {
    state.activeChip = null;
    state.offset = 0;
    setStatusToggle(state.prevStatus || 'active');
    state.prevStatus = null;
    renderChipsFresh();
    syncClearBtn();
    loadPage();
  });
}
// Faixa persistente do quick-filter "Com desconto" (o filtro fica visível mesmo depois
// de rolar; pode coexistir com a faixa do chip acima)
function discountBannerHtml() {
  if (!state.discountOnly) return '';
  return `<div class="banner info" style="margin:12px 12px 0"><span>ℹ️</span><span>Mostrando só: <b>Com desconto</b> (desta página) — <button type="button" class="chip-clear-link" id="discountClearBtn">voltar para a minha lista</button></span></div>`;
}
function wireDiscountClearBtn() {
  const db = document.getElementById('discountClearBtn');
  if (db) db.addEventListener('click', () => {
    state.discountOnly = false;
    $('#discountChip').classList.toggle('active', false);
    syncClearBtn();
    writeStateToUrl();
    renderCurrentRows();
  });
}
// Faixa persistente do quick-filter "Frete grátis abaixo de R$ 79" (mesmo padrão do desconto)
function freeShipBannerHtml() {
  if (!state.freeShipUnder) return '';
  return `<div class="banner info" style="margin:12px 12px 0"><span>ℹ️</span><span>Mostrando só: <b>Frete grátis abaixo de R$ ${PROBLEM_RULES.freeShippingFloor}</b> (desta página) — nesses anúncios o frete sai do seu bolso — <button type="button" class="chip-clear-link" id="freeShipClearBtn">voltar para a minha lista</button></span></div>`;
}
function wireFreeShipClearBtn() {
  const fb = document.getElementById('freeShipClearBtn');
  if (fb) fb.addEventListener('click', () => {
    state.freeShipUnder = false;
    $('#freeShipChip').classList.toggle('active', false);
    syncClearBtn();
    writeStateToUrl();
    renderCurrentRows();
  });
}

// Sub-linha de anúncio vinculado a um catálogo (item_relations). Se o item estiver
// na página carregada, mostra os dados completos; senão, mostra o ID com ação de
// analisar (o fluxo aceita só o ID) — sem inventar números que não temos.
function relationSubrowHtml(rel) {
  const rid = String(rel.id);
  const it = state.lastItems.find((x) => x && x.id === rid);
  if (it) {
    const off = discountPct(it);
    return `<tr class="subrow" data-analyze="${escapeHtml(rid)}" data-title="${escapeHtml(it.title || '')}" data-thumb="${escapeHtml(httpsThumb(it.thumbnail))}">
      <td class="td-photo" data-label="Foto"></td>
      <td data-label="Vinculado"><div class="cell-main"><div class="cell-text">
        <div class="cell-title" title="${escapeHtml(it.title || '')}">${escapeHtml(it.title || '—')}</div>
        <div class="row-id"><span class="mono cell-id">${escapeHtml(rid)}</span>${idActionsHtml(rid, it.permalink)}</div>
      </div></div></td>
      <td class="num fit" data-label="Preço">${priceHtml(it.price, it.original_price, off)}</td>
      <td class="num fit" data-label="Estoque">${stockCellHtml(it.available_quantity, false, stockDaysFor(it, it.available_quantity))}</td>
      <td class="num fit" data-label="Vendas (total)"><span class="mono cell-stock">${it.sold_quantity != null ? escapeHtml(String(it.sold_quantity)) : '—'}</span></td>
      ${CONFIG.SHOW_VISITS ? `<td class="num fit" data-label="Visitas (30 dias)">${visitsCell(state.visitsMap[rid], rid)}</td>` : ''}
      <td data-label="Sinais"><div class="badges">${badgesHtml(computeBadges(it), rid)}</div></td>
      <td class="analyze-cell"><button class="btn-analyze-var">Analisar →</button></td>
    </tr>`;
  }
  return `<tr class="subrow" data-analyze="${escapeHtml(rid)}" data-title="" data-thumb="">
    <td class="td-photo" data-label="Foto"></td>
    <td data-label="Vinculado"><div class="cell-main"><div class="cell-text">
      <div class="cell-title">Anúncio vinculado a este catálogo</div>
      <div class="row-id"><span class="mono cell-id">${escapeHtml(rid)}</span>${idActionsHtml(rid, null)}</div>
    </div></div></td>
    <td class="num fit" data-label="Preço"><span class="mono cell-stock">—</span></td>
    <td class="num fit" data-label="Estoque"><span class="mono cell-stock">—</span></td>
    <td class="num fit" data-label="Vendas (total)"><span class="mono cell-stock">—</span></td>
    ${CONFIG.SHOW_VISITS ? '<td class="num fit" data-label="Visitas (30 dias)"><span class="mono cell-stock">—</span></td>' : ''}
    <td data-label="Sinais"><div class="badges"><span class="badge gray" title="Este anúncio não está na página atual da lista — toque em Analisar para ver os detalhes.">fora desta página</span></div></td>
    <td class="analyze-cell"><button class="btn-analyze-var">Analisar →</button></td>
  </tr>`;
}

function renderRows(items) {
  const host = $('#tableHost');

  // quick-filters client-side (só a página carregada) — podem combinar (E lógico)
  let pageItems = items;
  if (state.discountOnly) pageItems = pageItems.filter((it) => discountPct(it) > 0);
  if (state.freeShipUnder) pageItems = pageItems.filter(isCheapFreeShipping);

  const displayRows = buildDisplayRows(pageItems);
  state.displayCount = displayRows.length;

  if (!pageItems.length) {
    host.innerHTML = `${chipFilterBannerHtml()}${discountBannerHtml()}${freeShipBannerHtml()}<div class="state">
      <span class="emoji"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg></span>
      <h3>Nenhum anúncio encontrado</h3>
      <p>${(state.search && state.searchParam === 'sku') ? 'Não achamos por esse texto. Cole o ID ou o link do anúncio — é só copiar o endereço da página do anúncio no Mercado Livre.' : (state.freeShipUnder ? `Nenhum anúncio desta página está abaixo de R$ ${PROBLEM_RULES.freeShippingFloor} com frete grátis.` : (state.discountOnly ? 'Nenhum anúncio desta página está com desconto.' : 'Nenhum anúncio bate com esses filtros. Tente ajustar a busca ou limpar os filtros.'))}</p>
      ${isDefaultState() ? '' : '<button class="btn-retry" id="emptyClearBtn">Limpar filtros</button>'}
    </div>${pagerHtml()}`;
    const ec = $('#emptyClearBtn');
    if (ec) ec.addEventListener('click', () => $('#clearBtn').click());
    wireChipClearBtn();
    wireDiscountClearBtn();
    wireFreeShipClearBtn();
    wirePager();
    return;
  }

  const trs = [];
  displayRows.forEach((row) => {
    if (row.type === 'single') {
      const item = row.item;
      const id = item.id || '';
      const analyzeId = (CONFIG.ANALYZE_BY_PRODUCT && item.user_product_id) || id;
      const off = discountPct(item);
      const stock = item.available_quantity;
      const sel = state.selectedId === id ? ' selected' : '';
      // catálogo: anúncios vinculados (item_relations) expandem como sub-linhas
      const rels = (isCatalogItem(item) && Array.isArray(item.item_relations)) ? item.item_relations.filter((r) => r && r.id) : [];
      const relOpen = !!state.expandedRelations[id];
      const relPill = rels.length ? `<span class="badge variations rel-pill" data-rel="${escapeHtml(id)}">${rels.length === 1 ? '1 anúncio vinculado' : rels.length + ' anúncios vinculados'} ${relOpen ? '▴' : '▾'}</span>` : '';
      // Thumbs com loading="eager" (aqui e na linha-família): com lazy, o re-render
      // progressivo (camadas B/C trocam o innerHTML) deixava o load nativo PERMANENTEMENTE
      // sem disparar no Chrome (22/07, conta real: 4/4 thumbs em branco). São ≤50 imagens
      // de ~90px por página — eager não custa nada.
      trs.push(`<tr data-key="${escapeHtml(id)}" data-analyze="${escapeHtml(analyzeId)}" data-title="${escapeHtml(item.title || '')}" data-thumb="${escapeHtml(httpsThumb(item.thumbnail))}" class="row${sel}">
        <td class="td-photo" data-label="Foto">${item.thumbnail ? `<img class="thumb" loading="eager" src="${escapeHtml(httpsThumb(item.thumbnail))}" alt="">` : '<span class="thumb"></span>'}</td>
        <td data-label="Título"><div class="cell-main"><div class="cell-text">
          <div class="cell-title" title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || '—')}</div>
          <div class="row-id">${catalogTagHtml(item)}<span class="mono cell-id">${escapeHtml(id)}</span>${idActionsHtml(id, item.permalink)}</div>
        </div></div></td>
        <td class="num fit" data-label="Preço">${priceHtml(item.price, item.original_price, off)}</td>
        <td class="num fit" data-label="Estoque">${stockCellHtml(stock, typeof stock === 'number' && stock <= 3, stockDaysFor(item, stock))}</td>
        <td class="num fit" data-label="Vendas (total)"><span class="mono cell-stock">${item.sold_quantity != null ? escapeHtml(String(item.sold_quantity)) : '—'}</span></td>
        ${CONFIG.SHOW_VISITS ? `<td class="num fit" data-label="Visitas (30 dias)">${visitsCell(state.visitsMap[id], id)}</td>` : ''}
        <td data-label="Sinais"><div class="badges">${badgesHtml(computeBadges(item), id)}${relPill}</div></td>
        <td class="analyze-cell"><button class="btn-analyze">Analisar →</button></td>
      </tr>`);
      if (relOpen) rels.forEach((r) => trs.push(relationSubrowHtml(r)));
    } else {
      // linha-produto (família)
      const a = familyAgg(row.items);
      const key = 'fam:' + row.familyId;
      const analyzeId = (CONFIG.ANALYZE_BY_PRODUCT && a.userProductId) || a.rep.id;
      const sel = state.selectedId === key ? ' selected' : '';
      const open = !!state.expandedFamilies[row.familyId];
      // "de R$X por R$Y": faixa original riscada (variações com desconto) + faixa atual + pill
      const origRange = (a.maxOff && a.origMin != null)
        ? (a.origMin === a.origMax
          ? `<span class="price-orig">${escapeHtml(fmtPrice(a.origMin))}</span>`
          : `<span class="price-orig price-wrap-range">${escapeHtml(fmtPriceNb(a.origMin))}–<wbr>${escapeHtml(fmtPrice(a.origMax).replace(/^R\$\s?/, ''))}</span>`) : '';
      const offPill = a.maxOff ? `<span class="badge-off">${a.count > 1 && a.origMin != null ? 'até ' : ''}-${a.maxOff}%</span>` : '';
      const priceCell = a.min === a.max ? priceHtml(a.min, a.rep.original_price, a.maxOff)
        : `${origRange}${offPill}<span class="mono cell-price price-wrap-range">${escapeHtml(fmtPriceNb(a.min))}–<wbr>${escapeHtml(fmtPrice(a.max).replace(/^R\$\s?/, ''))}</span>`;
      const visitsTxt = a.visitsPending ? '…' : String(a.visitsSum);
      // severidade primeiro, pill de ação por último (P1 do design review: a pill azul
      // não pode chegar antes do vermelho na coluna cujo trabalho é "o que precisa de atenção")
      const badges = badgesHtml(unionBadges(row.items, a), key) + `<span class="badge variations" data-family="${escapeHtml(row.familyId)}">${a.count} variações ${open ? '▴' : '▾'}</span>`;
      const famTitle = familyTitle(row.items, a.rep.title);
      // previsão/conversão da família: soma das vendas 30d das variações (quando a camada está completa)
      const s30fam = (state.sales30Map && !state.sales30Incomplete) ? row.items.reduce((s, i) => s + (state.sales30Map[i.id] || 0), 0) : null;
      const famEst = (s30fam != null && s30fam > 0)
        ? { days: stockDaysFromRate(a.stock, s30fam / CONFIG.SALES_WINDOW_DAYS), basis: '30d' }
        : { days: stockDaysFromRate(a.stock, a.rateSum), basis: 'vida' };
      let famVisits = `<span class="mono cell-stock${(!a.visitsPending && a.visitsSum === 0) ? ' low' : ''}">${escapeHtml(visitsTxt)}</span>`;
      if (CONFIG.SHOW_VISITS && !a.visitsPending && a.visitsSum > 0) {
        const sparkF = familySparkline(row.items);
        const lineF = sparkF ? `<span class="visits-line" title="Visitas por dia nos últimos 30 dias (todas as variações somadas).">${sparkF}${famVisits}</span>` : famVisits;
        let convF = '';
        if (s30fam != null) {
          const pctF = Math.min(100, (s30fam / a.visitsSum) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          convF = `<span class="conv-rate" title="Taxa de conversão dos últimos 30 dias do produto (todas as variações somadas).">conversão ${pctF}%</span>`;
        }
        if (sparkF || convF) famVisits = `<span class="stock-wrap">${lineF}${convF}</span>`;
      }
      const catItem = row.items.find(isCatalogItem);
      trs.push(`<tr data-key="${escapeHtml(key)}" data-family="${escapeHtml(row.familyId)}" data-analyze="${escapeHtml(analyzeId)}" data-title="${escapeHtml(famTitle || '')}" data-thumb="${escapeHtml(httpsThumb(a.rep.thumbnail))}" class="row${sel}">
        <td class="td-photo" data-label="Foto">${a.rep.thumbnail ? `<img class="thumb" loading="eager" src="${escapeHtml(httpsThumb(a.rep.thumbnail))}" alt="">` : '<span class="thumb"></span>'}</td>
        <td data-label="Título"><div class="cell-main"><span class="caret${open ? ' open' : ''}" data-family="${escapeHtml(row.familyId)}">▸</span><div class="cell-text">
          <div class="cell-title" title="${escapeHtml(famTitle || '')}">${escapeHtml(famTitle || '—')}</div>
          <div class="row-id">${catItem ? catalogTagHtml(catItem) : ''}<span class="mono cell-id">${escapeHtml(a.rep.id)}</span>${idActionsHtml(a.rep.id, a.rep.permalink)}</div>
        </div></div></td>
        <td class="num fit" data-label="Preço">${priceCell}</td>
        <td class="num fit" data-label="Estoque">${stockCellHtml(a.stock, false, famEst)}</td>
        <td class="num fit" data-label="Vendas (total)"><span class="mono cell-stock">${a.sales}</span></td>
        ${CONFIG.SHOW_VISITS ? `<td class="num fit" data-label="Visitas (30 dias)">${famVisits}</td>` : ''}
        <td data-label="Sinais"><div class="badges">${badges}</div></td>
        <td class="analyze-cell"><button class="btn-analyze" title="Analisa o produto inteiro (todas as variações de uma vez)">Analisar →</button></td>
      </tr>`);
      if (open) {
        row.items.forEach((it) => {
          const off = discountPct(it);
          trs.push(`<tr class="subrow" data-analyze="${escapeHtml(it.id)}" data-title="${escapeHtml(it.title || '')}" data-thumb="${escapeHtml(httpsThumb(it.thumbnail))}">
            <td class="td-photo" data-label="Foto"></td>
            <td data-label="Variação"><div class="cell-main"><div class="cell-text">
              <div class="cell-title" title="${escapeHtml(it.title || '')}">${escapeHtml(it.title || '—')}</div>
              <div class="row-id">${catalogTagHtml(it)}<span class="mono cell-id">${escapeHtml(it.id)}</span>${idActionsHtml(it.id, it.permalink)}</div>
            </div></div></td>
            <td class="num fit" data-label="Preço">${priceHtml(it.price, it.original_price, off)}</td>
            <td class="num fit" data-label="Estoque">${stockCellHtml(it.available_quantity, false, stockDaysFor(it, it.available_quantity))}</td>
            <td class="num fit" data-label="Vendas (total)"><span class="mono cell-stock">${it.sold_quantity != null ? escapeHtml(String(it.sold_quantity)) : '—'}</span></td>
            ${CONFIG.SHOW_VISITS ? `<td class="num fit" data-label="Visitas (30 dias)">${visitsCell(state.visitsMap[it.id], it.id)}</td>` : ''}
            <td data-label="Sinais"><div class="badges">${badgesHtml(computeBadges(it), it.id)}</div></td>
            <td class="analyze-cell"><button class="btn-analyze-var" title="Analisa só esta variação">Analisar →</button></td>
          </tr>`);
        });
      }
    }
  });

  host.innerHTML = `${chipFilterBannerHtml()}${discountBannerHtml()}${freeShipBannerHtml()}<div class="tbl-wrap">
    <table class="grid">
      <thead><tr>
        <th>Foto</th><th>Anúncio</th>
        <th class="num fit">Preço</th><th class="num fit">Estoque</th><th class="num fit th-wrap" title="Total de vendas do anúncio desde a criação">Vendas (total)</th>${CONFIG.SHOW_VISITS ? '<th class="num fit th-wrap">Visitas (30 dias)</th>' : ''}
        <th class="th-sinais">Sinais</th><th></th>
      </tr></thead>
      <tbody>${trs.join('')}</tbody>
    </table>
  </div>${pagerHtml()}`;

  wireRows(host);
  wireChipClearBtn();
  wireDiscountClearBtn();
  wireFreeShipClearBtn();
  wirePager();
}

function wireRows(host) {
  // caret (expandir/colapsar família) — antes do clique da linha
  host.querySelectorAll('.caret').forEach((c) => {
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      const fam = c.getAttribute('data-family');
      state.expandedFamilies[fam] = !state.expandedFamilies[fam];
      renderCurrentRows();
    });
  });
  // badge "N variações" também expande/colapsa a família (mesmo comportamento do caret)
  host.querySelectorAll('.badge.variations[data-family]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const fam = b.getAttribute('data-family');
      state.expandedFamilies[fam] = !state.expandedFamilies[fam];
      renderCurrentRows();
    });
  });
  // pill "N anúncios vinculados" (catálogo) expande/colapsa as sub-linhas vinculadas
  host.querySelectorAll('.rel-pill[data-rel]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const rid = b.getAttribute('data-rel');
      state.expandedRelations[rid] = !state.expandedRelations[rid];
      renderCurrentRows();
    });
  });
  // badge "+N" / "− menos" expande/colapsa os sinais da linha (desktop)
  host.querySelectorAll('.badge-more').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = b.getAttribute('data-more');
      state.expandedBadges[key] = !state.expandedBadges[key];
      renderCurrentRows();
    });
  });
  // dica "o que fazer" no toque (mobile — title= é invisível no celular):
  // 1º toque abre a dica logo abaixo dos sinais; mesmo badge fecha; outro badge troca
  if (window.matchMedia('(max-width:720px)').matches) {
    host.querySelectorAll('.badge[data-hint]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();   // não dispara a análise da linha (mesmo padrão dos outros controles do card)
        const box = b.closest('.badges');
        if (!box) return;
        const hint = b.getAttribute('data-hint');
        const prev = box.nextElementSibling;
        const hadHint = !!(prev && prev.classList && prev.classList.contains('badge-hint'));
        const sameHint = hadHint && prev.textContent === hint;
        if (hadHint) prev.remove();
        if (!sameHint) {
          const d = document.createElement('div');
          d.className = 'badge-hint';
          d.textContent = hint;   // textContent: nunca injeta HTML
          box.insertAdjacentElement('afterend', d);
        }
      });
    });
  }
  // copiar ID
  host.querySelectorAll('.id-copy').forEach((el2) => {
    el2.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el2.getAttribute('data-copy');
      copyToClipboard(id, el2);
    });
  });
  // abrir no ML não deve disparar a análise
  host.querySelectorAll('.id-open').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  // clique na linha (produto ou anúncio) -> fluxo integrado
  // (seleção de texto no título não conta como clique: soltar o mouse após arrastar não analisa)
  // Mobile (P7 do design review): só o BOTÃO, a foto ou o título disparam a análise —
  // tocar nos números/sinais enquanto lê ou rola não navega por acidente.
  const mobTap = window.matchMedia('(max-width:720px)').matches;
  const tapAllowed = (e) => !mobTap || !!(e.target.closest && e.target.closest('.btn-analyze, .btn-analyze-var, .td-photo, .cell-title'));
  host.querySelectorAll('tr.row').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (String(window.getSelection ? window.getSelection() : '').length) return;
      if (!tapAllowed(e)) return;
      enterAnalysis(tr.getAttribute('data-analyze'), tr.getAttribute('data-title'), tr.getAttribute('data-thumb'), tr.getAttribute('data-key'));
    });
  });
  // sub-linha (variação) -> analisa a variação específica
  host.querySelectorAll('tr.subrow').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (String(window.getSelection ? window.getSelection() : '').length) return;
      if (!tapAllowed(e)) return;
      enterAnalysis(tr.getAttribute('data-analyze'), tr.getAttribute('data-title'), tr.getAttribute('data-thumb'), tr.getAttribute('data-analyze'));
    });
  });
}

function copyToClipboard(text, el2) {
  const done = () => {
    const tag = document.createElement('span');
    tag.className = 'id-copied'; tag.textContent = 'Copiado!';
    el2.parentNode.appendChild(tag);
    setTimeout(() => tag.remove(), 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(done);
  else { try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } catch (e) {} done(); }
}

function pagerHtml() {
  const total = state.total;
  const shownFrom = total === 0 ? 0 : state.offset + 1;
  const shownTo = Math.min(state.offset + CONFIG.PAGE_SIZE, total);
  const cappedTotal = Math.min(total, CONFIG.OFFSET_CAP);
  const pct = cappedTotal ? Math.min(100, Math.round((shownTo / cappedTotal) * 100)) : 0;
  const prevDisabled = state.offset <= 0 ? 'disabled' : '';
  const atCap = state.offset + CONFIG.PAGE_SIZE >= CONFIG.OFFSET_CAP;
  const nextDisabled = (shownTo >= total || atCap) ? 'disabled' : '';
  // agrupamento por família: se a página exibe menos linhas que anúncios, mostra "· N produtos"
  const grouped = (CONFIG.GROUP_FAMILIES && state.displayCount != null && state.displayCount < (shownTo - state.offset))
    ? ` · agrupados em <b>${state.displayCount}</b> produtos` : '';
  // Recorte client-side ativo: o pager conta o que a tabela realmente mostra
  const cuts = [];
  if (state.discountOnly) cuts.push('com desconto');
  if (state.freeShipUnder) cuts.push(`com frete grátis abaixo de R$ ${PROBLEM_RULES.freeShippingFloor}`);
  const info = cuts.length
    ? `Mostrando <b>${state.displayCount}</b> anúncios ${cuts.join(' e ')} (dos <b>${shownFrom}–${shownTo}</b> de <b>${total}</b>)`
    : `Mostrando <b>${shownFrom}–${shownTo}</b> de <b>${total}</b> anúncios${grouped}`;
  return `<div class="pager">
    <div class="pager-info">${info}</div>
    <div class="pager-progress"><span style="width:${pct}%"></span></div>
    <div class="pager-btns">
      <button id="prevBtn" ${prevDisabled}>← Anterior</button>
      <button id="nextBtn" ${nextDisabled}>Próxima →</button>
    </div>
  </div>`;
}

function wirePager() {
  const prev = $('#prevBtn'), next = $('#nextBtn');
  // depois de trocar de página, leva o usuário ao topo da nova lista (após o render,
  // senão o scroll acontece com a página ainda colapsada no spinner e não chega lá)
  const scrollToTable = () => { $('#tableHost').scrollIntoView({ block: 'start' }); };
  if (prev) prev.addEventListener('click', () => { if (state.offset > 0) { state.offset = Math.max(0, state.offset - CONFIG.PAGE_SIZE); loadPage().then(scrollToTable); } });
  if (next) next.addEventListener('click', () => {
    const nextOffset = state.offset + CONFIG.PAGE_SIZE;
    if (nextOffset >= CONFIG.OFFSET_CAP) {
      setBanner('warn', 'O Mercado Livre limita a navegação a 1.000 anúncios. Use a busca ou os filtros acima para refinar e chegar no anúncio que você quer.');
      return;
    }
    state.offset = nextOffset;
    loadPage().then(scrollToTable);
  });
}

/* =========================================================================
   Fluxo principal de carga de página
   ========================================================================= */
async function loadPage() {
  const host = $('#tableHost');
  state.loading = true;
  writeStateToUrl();           // mantém a URL em sincronia (F5 preserva, link compartilhável)
  host.innerHTML = loadingHtml('Carregando seus anúncios…');
  clearBanner();

  try {
    // Caso especial: busca por ID MLB/MLBU -> hidrata direto, resultado único
    if (state.search && MLB_RE.test(state.search)) {
      const items = await hydrate([state.search.toUpperCase()]);
      state.total = items.length;
      state.lastItems = items;
      state.loading = false;
      renderRows(items);
      loadVisitsForPage(items.map((i) => i.id));
      return;
    }

    const searchResp = await mlGet(buildListUrl());
    const results = Array.isArray(searchResp.results) ? searchResp.results : [];
    // results é array de STRINGS (ids) — mapeamento defensivo
    const ids = results
      .map((it) => (typeof it === 'string' ? it : (it && (it.id || it.item_id))))
      .filter(Boolean);

    state.total = (searchResp.paging && typeof searchResp.paging.total === 'number') ? searchResp.paging.total : ids.length;

    if (!ids.length) { state.lastItems = []; state.loading = false; renderRows([]); return; }
    const items = await hydrate(ids);
    state.lastItems = items;
    state.loading = false;
    renderRows(items);
    loadVisitsForPage(ids);   // camada C — visitas 30d da página (assíncrono, enriquece depois)
  } catch (err) {
    // Fallback de busca por nome: se q= falhou, tenta sku= com aviso amigável.
    // NOTA: sku= NÃO foi validado (a conta de teste não usa SKU) — caminho defensivo.
    if (state.search && state.searchParam === 'q' && err.status && err.status >= 400 && err.status !== 401) {
      state.searchParam = 'sku';
      setBanner('warn', 'A busca por nome ainda não está disponível — mostrando resultados por código (SKU). Para o resultado exato, cole o ID do anúncio (ex.: MLB123456789).');
      return loadPage();
    }
    state.loading = false;
    renderError(err);
  }
}

function renderError(err) {
  const host = $('#tableHost');
  if (err && err.status === 401) {
    host.innerHTML = `<div class="state">
      <span class="emoji">🔌</span>
      <h3>Sua conta do Mercado Livre desconectou</h3>
      <p>Reconecte sua conta do Mercado Livre para ver seus anúncios.</p>
      <button class="btn-retry" id="reconnectBtn">Reconectar conta</button>
    </div>`;
    const rc = $('#reconnectBtn');
    if (rc) rc.addEventListener('click', () => window.open(CONFIG.RECONNECT_URL, '_blank'));
    return;
  }
  host.innerHTML = `<div class="state">
    <span class="emoji">😕</span>
    <h3>Não conseguimos carregar seus anúncios</h3>
    <p>Tivemos um problema para buscar seus anúncios. Aguarde alguns segundos e tente de novo.</p>
    <button class="btn-retry" id="retryBtn">Tentar de novo</button>
  </div>`;
  const rb = $('#retryBtn');
  if (rb) rb.addEventListener('click', loadPage);
}

/* =========================================================================
   Fluxo integrado — clique colapsa o painel e mostra a barra + placeholder
   ========================================================================= */
// PORT F4: aqui o placeholder do protótipo virou a análise REAL. A barra
// "← Voltar" fica no #analysisView (dentro do .mfsel) e a análise renderiza
// logo abaixo, no #resultsContainer do analyzer (fora do .mfsel).
// opts.skipTrigger: usado no deep-link ?item= — o analyzer JÁ disparou a
// análise sozinho (initAnalyzerPage), então só montamos a barra.
// opts.rawInput: texto original colado (link) — vai pro parse do analyzer
// intacto, que entende links de anúncio/edição/catálogo além de IDs puros.
function enterAnalysis(analyzeId, title, thumb, selKey, opts) {
  if (!analyzeId) return;
  opts = opts || {};
  state.selectedId = selKey || analyzeId;
  state.savedScroll = window.scrollY || window.pageYOffset || 0;
  const safeThumb = httpsThumb(thumb);
  $('#analysisView').innerHTML = `
    <div class="analysis-bar">
      <button class="analysis-back" id="backBtn">← Voltar para a lista</button>
      ${safeThumb ? `<img class="thumb" src="${escapeHtml(safeThumb)}" alt="">` : ''}
      <div class="ab-meta">${title
        ? `<span class="ab-id mono">${escapeHtml(analyzeId)}</span><span class="ab-title">${escapeHtml(title)}</span>`
        : `<span class="ab-title mono">${escapeHtml(analyzeId)}</span>`}</div>
    </div>`;
  $('#panelView').hidden = true;
  $('#analysisView').hidden = false;
  // header "Selecione um anúncio..." contradiz o modo análise — some junto com o painel
  const hdr = document.querySelector('.mfsel .hdr');
  if (hdr) hdr.style.display = 'none';
  window.scrollTo(0, 0);
  $('#backBtn').addEventListener('click', exitAnalysis);
  const rc = document.getElementById('resultsContainer');
  if (rc) rc.style.display = '';
  if (!opts.skipTrigger) {
    // Preenche o input legado (escondido) e chama handleAnalysisClick() SEM
    // argumento: o parse do analyzer (normalizeMlbId) detecta MLB/MLBU/link/
    // catálogo. NUNCA passar o id como argumento — chamada programática força
    // type:'mlb' e quebraria a análise por produto (MLBU).
    const inputEl = document.getElementById('input-url');
    if (inputEl) inputEl.value = opts.rawInput || analyzeId;
    if (typeof window.handleAnalysisClick === 'function') window.handleAnalysisClick();
  }
}
function exitAnalysis() {
  $('#analysisView').hidden = true;
  $('#analysisView').innerHTML = '';
  $('#panelView').hidden = false;
  const hdr = document.querySelector('.mfsel .hdr');
  if (hdr) hdr.style.display = '';
  // PORT F4: a análise fica no DOM mas some da tela — voltar não refaz nada;
  // um render tardio da análise (se ainda estava carregando) cai invisível.
  const rc = document.getElementById('resultsContainer');
  if (rc) rc.style.display = 'none';
  const li = document.getElementById('loadingIndicator');
  if (li) li.style.display = 'none';
  // deep-link ?item= consumido: sai da URL para F5 voltar na LISTA, não na análise
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('item')) { p.delete('item'); const qs = p.toString(); history.replaceState(null, '', qs ? ('?' + qs) : location.pathname); }
  } catch (e) { /* noop */ }
  // restaura sem refetch: a tabela continua montada no #panelView
  renderCurrentRows();
  window.scrollTo(0, state.savedScroll || 0);
}

// Extrai MLB/MLBU de um link ou ID colado (input único inteligente)
function parseItemId(text) {
  const s = (text || '').trim();
  if (!s) return null;
  let m = s.match(/MLBU-?(\d+)/i);        // UP (produto) primeiro — é superset de MLB
  if (m) return 'MLBU' + m[1];
  m = s.match(/\/p\/(MLB\d+)/i);          // catálogo /p/MLB...
  if (m) return m[1].toUpperCase();
  m = s.match(/MLB-?(\d+)/i);             // anúncio MLB...
  if (m) return 'MLB' + m[1];
  return null;
}

/* =========================================================================
   Banner / avisos
   ========================================================================= */
function setBanner(kind, msg) {
  $('#bannerArea').innerHTML = `<div class="banner ${kind}"><span>${kind === 'warn' ? '⚠️' : 'ℹ️'}</span><span>${escapeHtml(msg)}</span></div>`;
}
// Variante que aceita HTML no corpo — usar SÓ com strings estáticas + números.
// NUNCA passar dado de API/usuário aqui: esse continua no setBanner (escapeHtml).
function setBannerHtml(kind, html) {
  $('#bannerArea').innerHTML = `<div class="banner ${kind}"><span>${kind === 'warn' ? '⚠️' : 'ℹ️'}</span><span>${html}</span></div>`;
}
function clearBanner() { $('#bannerArea').innerHTML = ''; }

/* =========================================================================
   Controles de filtro
   ========================================================================= */
function setStatusToggle(status) {
  state.status = status;
  document.querySelectorAll('#statusGroup button').forEach((b) => {
    b.classList.toggle('on', b.getAttribute('data-status') === status);
  });
}
function isDefaultState() {
  return state.status === 'active' && state.order === 'last_updated_desc' && !state.search
    && !state.activeChip && !state.listingType && !state.logisticType && !state.discountOnly
    && !state.freeShipUnder;
}
// Botão "Filtrar e ordenar" (mobile): conta os filtros ativos do bloco colapsado
// para o estado nunca ficar invisível com o bloco fechado
function updateFiltersToggle() {
  const t = $('#filtersToggle');
  if (!t) return;
  const n = (state.order !== 'last_updated_desc' ? 1 : 0) + (state.listingType ? 1 : 0)
    + (state.logisticType ? 1 : 0) + (state.discountOnly ? 1 : 0) + (state.freeShipUnder ? 1 : 0);
  // aberto/fechado no próprio rótulo (mesmo padrão de caret que flipa das famílias e do "+N sinais")
  const open = $('#filtersCard') && $('#filtersCard').classList.contains('open');
  t.textContent = open
    ? `Fechar filtros${n > 0 ? ` (${n})` : ''} ▴`
    : `Filtrar e ordenar${n > 0 ? ` (${n})` : ''} ▾`;
  t.classList.toggle('has-active', n > 0);
}
function syncClearBtn() {
  $('#clearBtn').style.display = isDefaultState() ? 'none' : '';
  updateFiltersToggle();   // roda em toda mudança de filtro
}

/* ── Exportar CSV — serialização compartilhada (página atual e "baixar todos") ── */
// planilha vai pra sócio/contador: cabeçalhos e valores em pt-BR, nunca 'active/gold_pro' cru
const CSV_STATUS_PT = { active: 'Ativo', paused: 'Pausado', closed: 'Finalizado', under_review: 'Em revisão' };
const CSV_TIPO_PT = { gold_pro: 'Premium', gold_special: 'Clássico', free: 'Grátis' };
const CSV_ENVIO_PT = { fulfillment: 'Full', self_service: 'Flex', cross_docking: 'Coleta', xd_drop_off: 'Coleta' };
function csvFromItems(items, filename) {
  // PORT F4: colunas das camadas desligadas (visitas/vendas 30d/conversão/perguntas)
  // SAEM da planilha em vez de irem vazias — coluna em branco parece dado zerado.
  const extras = { sales30: !!CONFIG.SHOW_SALES30, visits: !!CONFIG.SHOW_VISITS, questions: !!CONFIG.SHOW_QUESTIONS };
  const header = ['ID', 'Título', 'Preço', 'Preço original', 'Estoque', 'Vendas (total)'];
  if (extras.sales30) header.push('Vendas (30 dias)');
  if (extras.visits) header.push('Visitas (30 dias)');
  if (extras.sales30 && extras.visits) header.push('Conversão 30d (%)');
  header.push('Status', 'Tipo', 'Catálogo', 'Envio');
  if (extras.questions) header.push('Perguntas sem resposta');
  header.push('Sinais', 'Link');
  const esc = (val) => { const s = String(val == null ? '' : val); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = items.map((it) => {
    const v = state.visitsMap[it.id];
    const s30 = sales30Of(it.id);
    const conv = (s30 != null && typeof v === 'number' && v > 0) ? Math.min(100, (s30 / v) * 100).toFixed(1).replace('.', ',') : '';
    const sinais = computeBadges(it).map((b) => b.text).join('; ');
    const cols = [it.id, it.title || '', it.price != null ? String(it.price).replace('.', ',') : '', it.original_price != null ? String(it.original_price).replace('.', ',') : '',
            it.available_quantity != null ? it.available_quantity : '', it.sold_quantity != null ? it.sold_quantity : ''];
    if (extras.sales30) cols.push(s30 == null ? '' : s30);
    if (extras.visits) cols.push(typeof v === 'number' ? v : '');
    if (extras.sales30 && extras.visits) cols.push(conv);
    cols.push(CSV_STATUS_PT[it.status] || it.status || '',
            CSV_TIPO_PT[it.listing_type_id] || '—',
            isCatalogItem(it) ? 'Sim' : '',
            CSV_ENVIO_PT[it.shipping && it.shipping.logistic_type] || '—');
    if (extras.questions) cols.push(state.questionsMap[it.id] || 0);
    cols.push(sinais, it.permalink || '');
    return cols.map(esc).join(';');
  });
  const csv = [header.join(';'), ...lines].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });   // BOM UTF-8: acentos seguros no Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Exportar CSV — o botão baixa TODOS os anúncios da lista atual (com os filtros
      ativos) num arquivo só. "Baixar só a página" não fazia sentido pro vendedor
      (decisão Lucas 04/07). Única exceção: "Com desconto" é um recorte client-side
      da página carregada — aí a planilha respeita exatamente o que a tabela mostra. ── */
function exportCsv() {
  if (state.discountOnly || state.freeShipUnder) {
    let items = state.lastItems || [];
    if (state.discountOnly) items = items.filter((it) => discountPct(it) > 0);
    if (state.freeShipUnder) items = items.filter(isCheapFreeShipping);
    if (!items.length) { setBanner('info', 'Não há anúncios nesse recorte nesta página para colocar na planilha.'); return; }
    const fname = (state.discountOnly && !state.freeShipUnder)
      ? `anuncios-com-desconto-${new Date().toISOString().slice(0, 10)}.csv`
      : `anuncios-recorte-${new Date().toISOString().slice(0, 10)}.csv`;
    csvFromItems(items, fname);
    setBanner('info', 'Planilha baixada com os ' + items.length + ' anúncios do recorte desta página.');
    return;
  }
  exportAllCsv();
}

/* ── Baixar TODOS os anúncios num arquivo só — as MESMAS chamadas da paginação
      manual (search + multiget por página), zero custo novo por item; SEM chamadas
      de visitas (a coluna preenche só com o que já existe em state.visitsMap).
      Conta que cabe numa página: usa o que já está na tela, zero chamadas novas. ── */
let exportAllRunning = false;
async function exportAllCsv() {
  if (exportAllRunning) return;
  exportAllRunning = true;
  const exportBtn = $('#exportBtn');
  const oldLabel = exportBtn ? exportBtn.innerHTML : '';   // innerHTML: o rótulo tem ícone SVG estático
  if (exportBtn) exportBtn.disabled = true;
  const cap = Math.min(state.total, CONFIG.OFFSET_CAP);
  const all = [];
  try {
    if (state.total <= CONFIG.PAGE_SIZE && (state.lastItems || []).length) {
      all.push.apply(all, state.lastItems);
    } else {
      for (let off = 0; off < cap; off += CONFIG.PAGE_SIZE) {
        if (exportBtn) exportBtn.textContent = 'Baixando ' + Math.min(off + CONFIG.PAGE_SIZE, cap) + ' de ' + cap + '…';
        const resp = await mlGet(buildListUrl(off));
        const results = Array.isArray(resp.results) ? resp.results : [];
        const ids = results.map((it) => (typeof it === 'string' ? it : (it && (it.id || it.item_id)))).filter(Boolean);
        if (!ids.length) break;
        const items = await hydrate(ids);
        all.push.apply(all, items);
      }
    }
    if (!all.length) { setBanner('info', 'Não há anúncios nesta lista para colocar na planilha.'); return; }
    csvFromItems(all, `anuncios-${new Date().toISOString().slice(0, 10)}.csv`);
    if (state.total > CONFIG.OFFSET_CAP) setBanner('info', 'Planilha baixada com os primeiros 1.000 anúncios — o Mercado Livre limita a navegação a 1.000.');
    else setBanner('info', 'Planilha baixada com ' + all.length + ' anúncios.');
  } catch (err) {
    setBanner('warn', 'Não deu para baixar tudo agora — tente de novo em alguns segundos.');
  } finally {
    exportAllRunning = false;
    if (exportBtn) { exportBtn.disabled = false; exportBtn.innerHTML = oldLabel; }   // string estática capturada acima
  }
}

/* ── Estado na URL (F5 mantém, link compartilhável) ──
   PORT F4: mexe SÓ nas chaves do painel — params alheios (ex.: ?item= do
   deep-link, params do Bubble) são preservados intactos. */
const MFSEL_URL_KEYS = ['status', 'order', 'busca', 'chip', 'tipo', 'log', 'desconto', 'frete79', 'offset', 'mock'];
function writeStateToUrl() {
  const p = new URLSearchParams(location.search);
  MFSEL_URL_KEYS.forEach((k) => p.delete(k));
  if (state.status !== 'active') p.set('status', state.status);
  if (state.order !== 'last_updated_desc') p.set('order', state.order);
  if (state.search) p.set('busca', state.search);
  if (state.activeChip) p.set('chip', state.activeChip);
  if (state.listingType) p.set('tipo', state.listingType);
  if (state.logisticType) p.set('log', state.logisticType);
  if (state.discountOnly) p.set('desconto', '1');
  if (state.freeShipUnder) p.set('frete79', '1');
  if (state.offset) p.set('offset', String(state.offset));
  const qs = p.toString();
  history.replaceState(null, '', qs ? ('?' + qs) : location.pathname);
}
function readStateFromUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get('status')) state.status = p.get('status');
  if (p.get('order')) state.order = p.get('order');
  if (p.get('busca')) { state.search = p.get('busca'); state.searchParam = CONFIG.USE_Q_PARAM ? 'q' : 'sku'; }
  if (p.get('chip')) state.activeChip = p.get('chip');
  if (p.get('tipo')) state.listingType = p.get('tipo');
  if (p.get('log')) state.logisticType = p.get('log');
  if (p.get('desconto') === '1') state.discountOnly = true;
  if (p.get('frete79') === '1') state.freeShipUnder = true;
  if (p.get('offset')) state.offset = parseInt(p.get('offset'), 10) || 0;
}
// espelha o estado (vindo da URL) nos controles da UI
function syncControlsToState() {
  $('#searchInput').value = state.search || '';
  $('#orderSelect').value = state.order;
  $('#typeSelect').value = state.listingType || '';
  $('#logisticSelect').value = state.logisticType || '';
  setStatusToggle(state.status);
  $('#discountChip').classList.toggle('active', state.discountOnly);
  $('#freeShipChip').classList.toggle('active', state.freeShipUnder);
  // #discountHint fica sempre hidden — a faixa persistente (discountBannerHtml) assume o papel
  syncClearBtn();
}

/* ── Refresh das contagens/sinais/perguntas (limpa o cache de 10 min) ── */
function refreshCounts() {
  try { Object.keys(sessionStorage).forEach((k) => { if (/^mf_sel_/.test(k)) sessionStorage.removeItem(k); }); } catch (e) {}
  state.signalSets = {}; state.signalSetsIncomplete = {}; state.questionsMap = {};
  state.sales30Map = null; state.sales30Incomplete = false;
  loadQuestions(state.sellerId);
  loadSales30(state.sellerId);
  // retorna a promise pro chamador saber quando terminou (reabilitar o botão);
  // erro não é engolido: os chips mostram a mesma mensagem do boot
  return fetchCounts(state.sellerId)
    .then((counts) => { renderChips(counts); loadSignalSets(state.sellerId, counts); })
    .catch(() => { $('#chipsArea').innerHTML = '<p class="chips-tip">Não deu para carregar o resumo agora — toque ou clique em “Atualizar” para tentar de novo.</p>'; });
}

function wireControls() {
  // abre/fecha o bloco "Filtrar e ordenar" (só visível no mobile)
  $('#filtersToggle').addEventListener('click', () => {
    const open = $('#filtersCard').classList.toggle('open');
    $('#filtersToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    updateFiltersToggle();
  });
  // status toggle
  document.querySelectorAll('#statusGroup button').forEach((b) => {
    b.addEventListener('click', () => {
      const newStatus = b.getAttribute('data-status');
      // chip ativo que fixa um status incompatível com o novo: solta o chip
      // (senão o filtro do chip sobrescreve o status e a lista contradiz o toggle)
      if (state.activeChip) {
        const chip = PROBLEM_CHIPS.find((c) => c.id === state.activeChip);
        if (chip && chip.filter.status && chip.filter.status !== newStatus) {
          state.activeChip = null;
          document.querySelectorAll('#chipsArea .chip.active').forEach((c) => c.classList.remove('active'));
        }
      }
      state.prevStatus = null;   // troca manual de status é escolha explícita — não devolver depois
      setStatusToggle(newStatus); state.offset = 0; syncClearBtn(); loadPage();
    });
  });
  // ordenação
  $('#orderSelect').addEventListener('change', (e) => { state.order = e.target.value; state.offset = 0; syncClearBtn(); loadPage(); });
  // tipo de anúncio (validado) e logística (validado)
  $('#typeSelect').addEventListener('change', (e) => { state.listingType = e.target.value; state.offset = 0; syncClearBtn(); loadPage(); });
  $('#logisticSelect').addEventListener('change', (e) => { state.logisticType = e.target.value; state.offset = 0; syncClearBtn(); loadPage(); });
  // quick-filter client-side "Com desconto" (só a página carregada)
  $('#discountChip').addEventListener('click', () => {
    state.discountOnly = !state.discountOnly;
    $('#discountChip').classList.toggle('active', state.discountOnly);
    syncClearBtn(); writeStateToUrl();
    renderCurrentRows();
  });
  // quick-filter client-side "Frete grátis abaixo de R$ 79" (frete pago do próprio bolso)
  $('#freeShipChip').addEventListener('click', () => {
    state.freeShipUnder = !state.freeShipUnder;
    $('#freeShipChip').classList.toggle('active', state.freeShipUnder);
    syncClearBtn(); writeStateToUrl();
    renderCurrentRows();
  });
  // exportar CSV
  $('#exportBtn').addEventListener('click', exportCsv);
  // refresh contagens + recarga da tabela (1 search + multigets da página atual —
  // custo igual a um F5, nada novo por item). Skeleton real nos chips em vez de spin fake.
  $('#refreshCountsBtn').addEventListener('click', () => {
    const b = $('#refreshCountsBtn');
    b.disabled = true;
    $('#chipsArea').innerHTML = '<div class="chips-skel"><span></span><span></span><span></span><span></span></div>';
    refreshCounts().finally(() => { b.disabled = false; });
    loadPage();
  });
  // busca (Enter ou clique na lupa): link/ID colado -> análise direta; texto livre -> filtra
  function submitSearch() {
    const v = $('#searchInput').value.trim();
    const pid = parseItemId(v);
    // PORT F4: manda o texto ORIGINAL (rawInput) — link de catálogo/edição
    // carrega mais contexto que o id extraído e o parse do analyzer entende.
    if (pid) { enterAnalysis(pid, '', '', pid, { rawInput: v }); return; }
    state.search = v; state.offset = 0;
    state.searchParam = v ? (CONFIG.USE_Q_PARAM ? 'q' : 'sku') : null;
    if (v && !CONFIG.USE_Q_PARAM) setBanner('warn', 'A busca por nome ainda não está disponível — mostrando resultados por código (SKU). Para o resultado exato, cole o ID (ex.: MLB123456789).');
    syncClearBtn(); loadPage();
  }
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    submitSearch();
  });
  $('#searchGo').addEventListener('click', submitSearch);
  // "x" nativo do input type=search também refaz a lista (submitSearch é idempotente)
  $('#searchInput').addEventListener('search', submitSearch);
  // limpar filtros
  $('#clearBtn').addEventListener('click', () => {
    state.status = 'active'; state.order = 'last_updated_desc';
    state.search = ''; state.searchParam = null; state.activeChip = null; state.prevStatus = null;
    state.listingType = ''; state.logisticType = ''; state.discountOnly = false; state.freeShipUnder = false; state.offset = 0;
    syncControlsToState(); clearBanner();
    renderChipsFresh(); loadPage();
  });
  // atalhos: "/" foca a busca; Esc sai da análise / limpa
  document.addEventListener('keydown', (e) => {
    const ae = document.activeElement;
    const inInput = ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
    // PORT F4: "/" só quando o painel está visível — na análise (ou se o painel
    // nem subiu) o atalho não pode roubar a tecla do resto da página do app.
    const panelVisible = !!($('#panelView') && !$('#panelView').hidden && !document.getElementById('mfselRoot').hidden);
    if (e.key === '/' && !inInput && panelVisible) { e.preventDefault(); $('#searchInput').focus(); }
    else if (e.key === 'Escape') {
      if (!$('#analysisView').hidden) { exitAnalysis(); return; }
      // Esc nunca apaga a triagem (filtros/chips) — limpar segue pelos botões intencionais
      if (inInput && ae.id === 'searchInput') ae.blur();
    }
  });
}

/* =========================================================================
   Boot
   ========================================================================= */
async function boot() {
  // PORT F4: o painel nasce visível (classe mfsel-on já no .ana-wrapper do
  // build — sem flash do fluxo legado). Se QUALQUER coisa impedir o boot
  // (token, proxy, erro inesperado), o painel se recolhe e o fluxo legado
  // (input de colar link) volta EXATAMENTE como era — aditivo de verdade.
  const root = document.getElementById('mfselRoot');
  if (!root) return;
  const wrapper = root.closest('.ana-wrapper');
  const legacyFallback = () => {
    root.hidden = true;
    if (wrapper) wrapper.classList.remove('mfsel-on');
    const rc = document.getElementById('resultsContainer');
    if (rc) rc.style.display = '';
  };

  try {
    wireControls();
    readStateFromUrl();          // restaura filtros/página da URL (F5, link compartilhado)
    syncControlsToState();       // espelha o estado restaurado nos controles
  } catch (err) { legacyFallback(); return; }

  // Modo SKU (busca por nome desligada): o placeholder já diz o que o campo aceita
  if (!CONFIG.USE_Q_PARAM) $('#searchInput').placeholder = 'ID ou link do anúncio (ex.: MLB123456789)';

  try {
    const me = await mlGet('users/me');
    state.sellerId = me.id;
  } catch (err) {
    // Sem sessão/erro: o 401 do protótipo tinha tela própria; no app o fluxo
    // legado já cobre esse estado (o analyzer mostra o erro dele) — recolhe.
    legacyFallback(); return;
  }

  // Deep-link ?item= (Planejador etc.): o analyzer JÁ está rodando a análise
  // (initAnalyzerPage). O painel nasce COLAPSADO, só com a barra "← Voltar";
  // a lista carrega em segundo plano e aparece pronta quando ele voltar.
  let deepItem = null;
  try {
    const ip = new URLSearchParams(location.search).get('item');
    if (ip && /^MLB[U]?\d+$/i.test(ip)) deepItem = ip.toUpperCase();
  } catch (e) { /* noop */ }
  if (deepItem) {
    enterAnalysis(deepItem, '', '', deepItem, { skipTrigger: true });
  } else {
    // painel em primeiro plano: o texto inicial do analyzer fica fora da tela
    const rc = document.getElementById('resultsContainer');
    if (rc) rc.style.display = 'none';
  }

  // contagens dos chips -> em seguida camada B (sinais por interseção, só os com contador>0)
  fetchCounts(state.sellerId)
    .then((counts) => {
      renderChips(counts);
      loadSignalSets(state.sellerId, counts);
    })
    .catch(() => { $('#chipsArea').innerHTML = '<p class="chips-tip">Não deu para carregar o resumo agora — toque ou clique em “Atualizar” para tentar de novo.</p>'; });

  // camada C — perguntas sem resposta (1 chamada por conta)
  loadQuestions(state.sellerId);
  // camada C — vendas 30d por conta (1-3 chamadas; conversão + previsão de estoque)
  loadSales30(state.sellerId);

  loadPage();
}

/* PORT F4: o bloco MOCK (dataset ?mock=1, ~210 linhas) era PROTOTYPE-ONLY e
   foi REMOVIDO no port — no app, mock ligado mostraria dados fictícios como
   reais. O protótipo standalone (test-env/ad-selector) continua com ele. */

/* ── Guarda de regressão de layout (PORTADA pro widget — exigência da F4) ──
   Já quebramos "sinais cortados" 3x por caminhos diferentes (janela estreita,
   expansão de família/vinculados, banda entre breakpoints). Este check é a
   régua única: rode `mfLayoutCheck()` no console — idealmente com famílias E
   vinculados EXPANDIDOS — depois de QUALQUER mudança de CSS/render, em pelo
   menos: 1366, 1100, 1000 e 390 de largura. Invariantes:
   (1) tabela cabe no host sem scroll horizontal (janelas ≥ ~910px);
   (2) nenhum elemento passa da borda direita da própria célula (o botão sticky
       tem fundo sólido — o que passar por baixo dele "some");
   (3) largura da tabela IGUAL fechada × expandida;
   (4) mobile sem scroll horizontal da página. */
function mfLayoutCheck() {
  const out = { ok: true, problemas: [] };
  const table = document.querySelector('table.grid');
  const host = document.querySelector('.tbl-wrap');
  if (table && host) {
    const t = table.getBoundingClientRect().width, h = host.getBoundingClientRect().width;
    if (t > h + 1 && window.innerWidth >= 910) out.problemas.push('tabela ' + Math.round(t) + 'px > host ' + Math.round(h) + 'px (estouro ' + Math.round(t - h) + 'px — vai sumir sob o botão sticky)');
    document.querySelectorAll('table.grid tbody tr').forEach((tr, ri) => {
      tr.querySelectorAll('td').forEach((td) => {
        const tdR = td.getBoundingClientRect();
        td.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > tdR.right + 2) out.problemas.push('linha ' + ri + ': "' + String(el.className || el.tagName).slice(0, 30) + '" vaza ' + Math.round(r.right - tdR.right) + 'px da célula ' + (td.getAttribute('data-label') || td.className));
        });
      });
    });
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.problemas.push('página com scroll horizontal (' + (document.documentElement.scrollWidth - window.innerWidth) + 'px)');
  out.ok = out.problemas.length === 0;
  return out;
}
window.mfLayoutCheck = mfLayoutCheck;

boot();

})();
