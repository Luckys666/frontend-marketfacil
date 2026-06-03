if (window.__buscadorCatalogosLoaded) { /* prevent double execution */ } else {
window.__buscadorCatalogosLoaded = true;

// --- CONFIGURAÇÃO ---
const pageSize = 20;
let currentOffset = 0;
let currentQuery = '';
let accessToken = null;
let globalUserId = null;
let globalTotal = 0;
let isLoading = false;
let isLoadingCredentials = false;

// Filter state
let filterLogistic = 'Todos';
let filterFrete = 'Todos';
let filterCompetitors = 'Todos';
let filterSort = 'relevancia';

const BASE_URL_CATALOG = 'https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-catalog';
const PROXY_BASE_URL = 'https://mlb-proxy-fdb71524fd60.herokuapp.com/api';
const ACCESS_TOKEN_ENDPOINT_URL = 'https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2';
const USER_ID_ENDPOINT_URL = 'https://app.marketfacil.com.br/api/1.1/wf/get-user-id';

let searchCache = new Map();
let itemDetailsCache = new Map();
let userDetailsCache = new Map();
let shippingDetailsCache = new Map();
let shippingCostCache = new Map();
let commissionCache = new Map();
let catalogCompetitorsCache = new Map();
let visitsCache = new Map();
let eshopCache = new Map();

const searchInput = document.getElementById('ac-search-input');
const searchButton = document.getElementById('ac-search-button');
const logisticFilterSelect = document.getElementById('ac-logistic-filter');
const resultsContainer = document.getElementById('ac-results');
const paginationContainer = document.getElementById('ac-pagination-controls');
const progressBar = document.getElementById('ac-top-progress-bar');
const progressFill = document.getElementById('ac-top-progress-fill');

const renderedCatalogsOnPage = new Set();
// Store rendered catalog data for client-side filtering/sorting
let renderedCatalogData = [];
const placeholderSvgDataUri = createPlaceholderSvg();

// --- Progress Bar ---
function showProgress(pct) {
  if (progressBar) progressBar.classList.add('ac-progress-visible');
  if (progressFill) progressFill.style.width = Math.min(pct, 100) + '%';
}
function hideProgress() {
  if (progressFill) progressFill.style.width = '100%';
  setTimeout(() => {
    if (progressBar) progressBar.classList.remove('ac-progress-visible');
    if (progressFill) progressFill.style.width = '0%';
  }, 400);
}

// --- Funções Auxiliares ---
function updateButtonState() {
  searchButton.disabled = isLoading || isLoadingCredentials;
}

function showMessage(message, type = "info") {
  isLoading = false;
  isLoadingCredentials = false;
  updateButtonState();
  hideProgress();
  if (type === 'error') {
    resultsContainer.innerHTML = '<div class="ac-error-message"><span class="ac-error-icon">\u26A0\uFE0F</span><p>' + message + '</p><small>Tente novamente ou verifique o console.</small></div>';
  } else {
    resultsContainer.innerHTML = '<div class="ac-info-message"><span style="font-size:2rem;line-height:1;">\uD83D\uDCCA</span><p>' + message + '</p></div>';
  }
  paginationContainer.innerHTML = '';
}

function showLoading(message) {
  resultsContainer.innerHTML = '<div class="ac-loading-message"><div class="ac-spinner"><div class="ac-spinner-ring"></div><div class="ac-spinner-ring"></div><div class="ac-spinner-dot"></div></div><p>' + message + '</p><small>Isso pode levar alguns segundos...</small></div>';
}

function formatCurrency(value, siteId) {
  if (typeof value !== 'number' || isNaN(value)) return 'N/A';
  if (typeof window !== 'undefined' && typeof window.MF_formatCurrency === 'function') {
    return window.MF_formatCurrency(value, siteId || (window.MF_currentSiteId ? window.MF_currentSiteId() : 'MLB'));
  }
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizeMlbId(input) {
  if (!input || typeof input !== 'string') return null;
  if (typeof window !== 'undefined' && typeof window.MF_normalizeItemInput === 'function') {
    const info = window.MF_normalizeItemInput(input);
    if (info) return info.itemId;
  }
  const m = input.match(/(MLB|MCO|MLA|MLM|MLC|MLU)-?(\d+)/i);
  return m ? (m[1].toUpperCase() + m[2]) : null;
}

function createPlaceholderSvg() {
  const svg = '<svg width="120" height="120" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="120" fill="#f1f5f9"></rect><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-size="11px" font-family="sans-serif">Sem Imagem</text></svg>';
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getReputationBadge(rep) {
  if (!rep) return '<span style="color:var(--text-muted);font-size:.75rem;">-</span>';
  const lvl = rep.level_id || '';
  const color = rep.power_seller_status;
  let medal = '', mColor = 'var(--text-muted)';
  if (color === 'platinum') { medal = '\uD83E\uDD47'; mColor = '#a78bfa'; }
  else if (color === 'gold') { medal = '\uD83E\uDD47'; mColor = '#f59e0b'; }
  else if (color === 'silver') { medal = '\uD83E\uDD48'; mColor = '#94a3b8'; }
  else if (lvl.includes('5')) { medal = '\u2B50'; mColor = 'var(--green-dark)'; }
  else if (lvl.includes('4')) { medal = '\u2B50'; mColor = '#f59e0b'; }
  else if (lvl.includes('3')) { medal = '\u2B50'; mColor = '#94a3b8'; }
  const pct = rep.transactions?.ratings?.positive;
  const pctText = typeof pct === 'number' ? (pct * 100).toFixed(0) + '%' : '';
  return '<span style="color:' + mColor + ';font-size:.78rem;" title="' + lvl + '">' + medal + ' ' + pctText + '</span>';
}

// --- Funções de API ---
async function fetchApi(baseUrl, paramsObj, options = {}, description = 'API', cacheInstance = null, cacheKey = null) {
  if (cacheInstance && cacheKey && cacheInstance.has(cacheKey)) return cacheInstance.get(cacheKey);
  const params = new URLSearchParams(paramsObj);
  let url = baseUrl + '?' + params.toString();
  let responseData = null, lastError = null, triedWithHeader = false;

  if (accessToken && !options.skipAuthHeader) {
    triedWithHeader = true;
    try {
      const r = await fetch(url, { ...options, headers: { ...options.headers, 'Authorization': 'Bearer ' + accessToken } });
      const t = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status + ' - ' + (t || r.statusText));
      responseData = JSON.parse(t);
    } catch (e) { lastError = e; }
  }
  // Fallback de access_token via query param removido — proxy exige Bearer header
  if (!responseData && (options.skipAuthHeader || !accessToken || options.skipAuthHeaderFallback)) {
    try {
      const r = await fetch(url, options);
      const t = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status + ' - ' + (t || r.statusText));
      responseData = JSON.parse(t);
      lastError = null;
    } catch (e) { if (!lastError) lastError = e; }
  }
  if (!responseData && lastError) throw lastError;
  if (!responseData) throw new Error('[' + description + '] Fetch falhou.');
  if (cacheInstance && cacheKey) cacheInstance.set(cacheKey, responseData);
  return responseData;
}

async function fetchAccessTokenInternal() {
  const response = await fetch(ACCESS_TOKEN_ENDPOINT_URL);
  if (!response.ok) throw new Error('Falha access token: ' + response.status);
  const data = await response.json();
  if (data?.response?.access_token) return data.response.access_token;
  throw new Error('Access token não encontrado.');
}

async function fetchUserIdForScraping() {
  const response = await fetch(USER_ID_ENDPOINT_URL, { method: 'POST' });
  if (!response.ok) throw new Error('Falha User ID: ' + response.status);
  const data = await response.json();
  const userId = data?.response?.user_id || data?.user_id || (typeof data === 'string' ? data : null);
  if (userId) return userId;
  throw new Error('User ID não encontrado.');
}

// A2 cutover: em 401 do proxy, invalida globalUserId, re-minta via get-user-id e retry 1×.
// Retorna a Response (ou a 1ª 401 se o re-mint falhou). Caller decide UX.
async function withMintRetry(buildRequestFn) {
  let resp = await buildRequestFn(globalUserId);
  if (resp.status !== 401) return resp;
  globalUserId = null;
  try { globalUserId = await fetchUserIdForScraping(); }
  catch (_) { return resp; }
  if (!globalUserId) return resp;
  return await buildRequestFn(globalUserId);
}

async function fetchCatalogs(query, offset = 0) {
  const params = { q: query, status: 'active', offset: offset, limit: pageSize };
  const cacheKey = 'catalogs_' + query + '_' + offset;
  const data = await fetchApi(BASE_URL_CATALOG, params, {}, 'Catalogs', searchCache, cacheKey);
  if (data?.paging?.total != null) {
    globalTotal = (offset === 0) ? data.paging.total : Math.max(globalTotal, data.paging.total);
  }
  if (data?.results) {
    if (offset === 0) { globalTotal = data.results.length; if (data.results.length === pageSize) globalTotal = Math.max(globalTotal, pageSize * 2 - 1); }
    else globalTotal = Math.max(globalTotal, offset + data.results.length);
    if (data.results.length < pageSize) globalTotal = offset + data.results.length;
  } else if (offset === 0) globalTotal = 0;
  return data;
}

async function fetchCatalogDetails(productId) {
  try { return await fetchApi(BASE_URL_CATALOG, { product_id: productId }, {}, 'CatalogDetails ' + productId); }
  catch (e) { return null; }
}

async function fetchCatalogCompetitors(productId) {
  if (!productId) return null;
  const cacheKey = 'catalog_competitors_' + productId;
  try { return await fetchApi(PROXY_BASE_URL + '/competition/competitors', { product_id: productId }, {}, 'Competitors ' + productId, catalogCompetitorsCache, cacheKey); }
  catch (e) { return { competitors: [] }; }
}

async function fetchItemDetails(itemId) {
  const nId = normalizeMlbId(itemId);
  if (!nId || !globalUserId) return null;
  const cacheKey = 'item_' + nId;
  if (itemDetailsCache.has(cacheKey)) return itemDetailsCache.get(cacheKey);
  try {
    // withMintRetry: em 401 (token expirado), re-minta e retry 1×; senão passa direto
    const r = await withMintRetry((uid) => fetch(PROXY_BASE_URL + '/ml-scraper?url=' + nId, { headers: { 'x-user-id': uid } }));
    const t = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const s = JSON.parse(t);
    const pFull = parseFloat(s.price_original) || parseFloat(s.price) || 0;
    const pDisc = parseFloat(s.price) || pFull;
    const mapped = {
      id: s.seller?.item_id || nId, title: s.title, price: pDisc,
      original_price: pFull > pDisc ? pFull : null,
      category_id: s.seller?.category_id, listing_type_id: s.installments?.listing_type_id || null,
      seller_id: s.seller?.seller_id || null, thumbnail: s.pictures?.[0] || null,
      pictures: Array.isArray(s.pictures) ? s.pictures.map(u => ({ url: u, secure_url: u })) : [],
      shipping: { logistic_type: s.shipping_mode || undefined, free_shipping: s.free_shipping === true, tags: s.shipping_tags || [] },
      attributes: s.attributes || [], condition: s.condition || null,
      warranty: s.warranty || null, total_sales: s.total_sales || null
    };
    itemDetailsCache.set(cacheKey, mapped);
    return mapped;
  } catch (e) { itemDetailsCache.set(cacheKey, null); return null; }
}

async function fetchCommissions(price, category_id, listing_type_id) {
  if (price == null || !category_id || !listing_type_id) return null;
  if (price === 0) return { sale_fee_amount: 0, percentage_fee: 0 };
  const params = { price: price, category_id: category_id, listing_type_id: listing_type_id, currency_id: 'BRL' };
  const cacheKey = 'comm_' + price + '_' + category_id + '_' + listing_type_id;
  try { return await fetchApi(PROXY_BASE_URL + '/fetch-commissions', params, {}, 'Commissions', commissionCache, cacheKey); }
  catch (e) { return null; }
}

async function fetchShippingCost(itemId, sellerId) {
  if (!itemId || !sellerId) return null;
  const nId = normalizeMlbId(itemId);
  if (!nId) return null;
  const cacheKey = 'shipcost_' + nId + '_' + sellerId;
  try {
    const data = await fetchApi(PROXY_BASE_URL + '/shipping-cost', { user_id: String(sellerId), item_id: nId }, { headers: { 'Cache-Control': 'no-cache' }}, 'ShipCost ' + nId, shippingCostCache, cacheKey);
    if (data?.coverage?.all_country?.list_cost !== undefined) return { cost: data.coverage.all_country.list_cost, currency: 'BRL' };
    return null;
  } catch (e) { shippingCostCache.set(cacheKey, null); return null; }
}

async function fetchShippingDetails(itemId) {
  const nId = normalizeMlbId(itemId);
  if (!nId) return null;
  const cacheKey = 'shipdetails_' + nId;
  try {
    const data = await fetchApi(PROXY_BASE_URL + '/shipping-details', { item_id: nId }, { headers: { 'Cache-Control': 'no-cache' }}, 'ShipDetails ' + nId, shippingDetailsCache, cacheKey);
    return data?.channels?.[0] || data;
  } catch (e) { shippingDetailsCache.set(cacheKey, null); return null; }
}

async function fetchUserDetails(sellerId) {
  if (!sellerId) return null;
  const cacheKey = 'user_' + sellerId;
  try { return await fetchApi(PROXY_BASE_URL + '/users/' + sellerId, {}, {}, 'User ' + sellerId, userDetailsCache, cacheKey); }
  catch (e) { return null; }
}

async function fetchEshopInfo(sellerId) {
  if (!sellerId) return null;
  const cacheKey = 'eshop_' + sellerId;
  if (eshopCache.has(cacheKey)) return eshopCache.get(cacheKey);
  try {
    const data = await fetchApi(PROXY_BASE_URL + '/eshops/seller/' + sellerId, {}, {}, 'Eshop ' + sellerId);
    eshopCache.set(cacheKey, data);
    return data;
  } catch (e) { eshopCache.set(cacheKey, null); return null; }
}

async function fetchAndAggregateVisits(itemIds) {
  if (!itemIds || itemIds.length === 0) return { aggregated: null, individuals: [] };
  const individualVisitData = [];
  const visitPromises = itemIds.map(itemId => {
    const nId = normalizeMlbId(itemId);
    if (!nId) { individualVisitData.push({ itemId: itemId, totalVisitsInPeriod: 0, data: null, error: true }); return Promise.resolve(null); }
    return fetchApi(PROXY_BASE_URL + '/fetch-visits', { item_id: nId, last: 90, unit: 'day' }, {}, 'Visits ' + nId, visitsCache, 'visits_' + nId)
      .then(data => {
        let total = 0;
        if (data?.results && Array.isArray(data.results)) total = data.results.reduce((s, e) => s + (e.total || 0), 0);
        individualVisitData.push({ itemId: itemId, totalVisitsInPeriod: total, data: data, error: false });
        return data;
      }).catch(e => { individualVisitData.push({ itemId: itemId, totalVisitsInPeriod: 0, data: null, error: true }); return null; });
  });
  const allData = await Promise.all(visitPromises);
  const agg = {};
  allData.forEach(vd => { if (vd?.results) vd.results.forEach(d => { const k = d.date.substring(0, 10); if (typeof d.total === 'number') agg[k] = (agg[k] || 0) + d.total; }); });
  let finalAgg = null;
  if (Object.keys(agg).length > 0) finalAgg = { results: Object.entries(agg).map(([d, t]) => ({ date: d, total: t })).sort((a, b) => new Date(a.date) - new Date(b.date)) };
  return { aggregated: finalAgg, individuals: itemIds.map(id => individualVisitData.find(i => i.itemId === id) || { itemId: id, totalVisitsInPeriod: 0, data: null, error: true }) };
}

// --- Mapping ---
function mapListingType(type) {
  switch (type) { case 'gold_pro': return 'Premium'; case 'gold_special': return 'Clássico'; case 'free': return 'Grátis'; default: return type || '-'; }
}
function mapLogisticType(type) {
  if (!type || typeof type !== 'string') return 'sem-logistica';
  switch (type.toLowerCase().trim()) {
    case 'cross_docking': return 'Coleta'; case 'xd_drop_off': return 'Places'; case 'drop_off': return 'Correios';
    case 'fulfillment': return 'Full'; case 'me1': return 'ME1'; case 'self_service_in': case 'me2': return 'ME2';
    case 'custom': return 'Custom'; case 'not_specified': return 'Não Esp.'; case 'default': return 'Desconhecida'; default: return type;
  }
}
function mapLogisticEmoji(m) {
  switch (m) { case 'Coleta': return '\uD83D\uDE9A'; case 'Places': return '\uD83D\uDCE6'; case 'Correios': return '\u2709\uFE0F';
    case 'Full': return '\u26A1'; case 'ME1': return '\uD83D\uDE9B'; case 'ME2': return '\uD83D\uDE80'; case 'Custom': return '\uD83E\uDD1D';
    case 'Não Esp.': return '\u2753'; case 'sem-logistica': return '\uD83D\uDEAB'; default: return ''; }
}
function getLogisticBadge(info) {
  const lt = info?.logistic_type;
  const m = mapLogisticType(lt);
  const cls = 'ac-logistica-' + m.toLowerCase().replace(/[^a-z0-9]/g, '');
  return '<span class="' + cls + '" title="' + m + (lt ? ' (' + lt + ')' : '') + '">' + mapLogisticEmoji(m) + ' ' + m + '</span>';
}
function getFreteGratisBadge(info) {
  if (info && typeof info.free_shipping === 'boolean') {
    return info.free_shipping
      ? '<span class="ac-beneficio ac-flex-sim">Frete Grátis</span>'
      : '<span class="ac-beneficio ac-flex-nao">Sem Frete Grátis</span>';
  }
  return '';
}

// --- Gráfico (Proposta U) ---
async function renderVisitsChart(chartData, chartCanvasId, chartLabel) {
  const container = document.getElementById(chartCanvasId)?.closest('.ac-catalog-chart-container');
  if (!chartData?.results?.length) { if (container) container.innerHTML = '<p style="font-size:.75em;color:var(--text-muted);text-align:center;">Sem visitas.</p>'; return; }
  const canvas = document.getElementById(chartCanvasId);
  if (!canvas || !container) return;
  container.innerHTML = '';
  canvas.style.display = 'block';
  container.appendChild(canvas);
  try {
    const ctx = canvas.getContext('2d');
    if (canvas.chartInstance) canvas.chartInstance.destroy();
    let labels, timeOpts = {}, scaleType = 'category', tooltipCb = (t) => t[0].label;
    if (typeof dateFns !== 'undefined' && Chart?.adapters?.date) {
      scaleType = 'time'; labels = chartData.results.map(v => dateFns.parseISO(v.date));
      timeOpts = { unit: 'day', tooltipFormat: 'dd/MM/yyyy', displayFormats: { day: 'dd/MM' } };
      tooltipCb = (t) => { const d = new Date(t[0].parsed.x); return dateFns.format(d, 'dd/MM/yyyy'); };
    } else { labels = chartData.results.map(v => { const d = new Date(v.date); return ('0'+d.getUTCDate()).slice(-2)+'/'+('0'+(d.getUTCMonth()+1)).slice(-2); }); }
    const vals = chartData.results.map(v => v.total);
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, 'rgba(0,102,255,0.35)'); grad.addColorStop(1, 'rgba(0,214,143,0.05)');
    canvas.chartInstance = new Chart(ctx, {
      type: 'line', data: { labels: labels, datasets: [{ label: chartLabel || 'Visitas', data: vals, fill: true, backgroundColor: grad, borderColor: '#0066ff', borderWidth: 1.5, tension: .35, pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: '#0066ff' }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: scaleType, time: scaleType === 'time' ? timeOpts : undefined, ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 10, family: "'Geist Mono',monospace" } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0, font: { size: 10, family: "'Geist Mono',monospace" } }, grid: { color: '#e2e8f0', borderDash: [2,3] } } }, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { title: tooltipCb }, backgroundColor: '#0f172a', padding: 8, cornerRadius: 6 } }, interaction: { mode: 'nearest', axis: 'x', intersect: false } }
    });
  } catch (e) { if (container) container.innerHTML = '<p style="font-size:.75em;color:var(--red-dark);text-align:center;">Erro gráfico.</p>'; }
}

// --- Renderização ---
async function renderResults(dataFromFetch) {
  if (!dataFromFetch?.results?.length) { if (currentOffset === 0) showMessage("Nenhum resultado encontrado."); return; }

  const total = dataFromFetch.results.length;
  const chartsToRender = [];
  const htmlPromises = dataFromFetch.results.map(async (catalogEntry, index) => {
    const catId = String(catalogEntry.id);
    if (renderedCatalogsOnPage.has(catId)) return null;
    renderedCatalogsOnPage.add(catId);
    showProgress(20 + ((index + 1) / total) * 60);

    const details = await fetchCatalogDetails(catId);
    if (!details || details.status !== 'active') {
      return { html: '<div class="ac-catalog-item" data-logistic-type="sem-logistica" data-frete="nao" data-competitors="0" data-price="0" data-visits="0" style="opacity:.7;border-left:3px solid #ffc107;"><div class="ac-catalog-details"><p style="font-family:var(--font-mono);font-size:.82rem;color:var(--text-muted);">' + catId + '</p><p style="color:var(--text-secondary);font-size:.9rem;">Catálogo indisponível ou inativo.</p></div></div>', data: null };
    }

    const compResp = await fetchCatalogCompetitors(catId);
    const compList = (compResp && Array.isArray(compResp.results)) ? compResp.results : (compResp && Array.isArray(compResp.competitors)) ? compResp.competitors : [];
    const compCount = compList.length;
    const catLink = 'https://www.mercadolivre.com.br/p/' + details.id;

    const brand = details.attributes?.find(a => a.id === 'BRAND');
    const brandName = brand ? brand.value_name : null;
    let brandHTML = brandName ? '<span style="font-size:.82rem;color:var(--text-secondary);">Marca: <a href="https://app.marketfacil.com.br/busca-inpi?marca=' + encodeURIComponent(brandName) + '" target="_blank" style="color:var(--blue);text-decoration:none;">' + escapeHtml(brandName) + '</a></span>' : '';

    let imageURL = placeholderSvgDataUri;
    if (details.pictures?.[0]?.url) imageURL = details.pictures[0].url;

    let mappedLogistic = details.shipping?.logistic_type ? mapLogisticType(details.shipping.logistic_type) : 'sem-logistica';
    let hasFreeShipping = false;
    let lowestPrice = null;
    let totalVisits = 0;
    let topCompHTML = '';
    let chartCanvasId = 'ac-visitsChart-' + catId + '-' + (currentOffset + index);

    if (compList.length > 0) {
      const sorted = [...compList].filter(c => c.price != null).sort((a, b) => a.price - b.price);
      const top3 = sorted.slice(0, 3);
      lowestPrice = sorted[0]?.price || null;

      topCompHTML = '<div class="ac-top-competitors-section"><span class="ac-top-competitors-label">Top 3 — Menor Preço</span>';

      if (top3.length > 0) {
        const top3Ids = top3.map(c => c.item_id).filter(Boolean);
        const visitData = await fetchAndAggregateVisits(top3Ids);
        let totalTop3Visits = 0;
        if (visitData?.individuals) totalTop3Visits = visitData.individuals.reduce((s, i) => s + i.totalVisitsInPeriod, 0);
        totalVisits = totalTop3Visits;

        const top3Details = await Promise.all(top3.map(async (c) => {
          const [itemD, sellerD, shipD, eshopD] = await Promise.all([
            fetchItemDetails(c.item_id), fetchUserDetails(c.seller_id),
            fetchShippingDetails(c.item_id), fetchEshopInfo(c.seller_id)
          ]);
          return { ...c, itemD, sellerD, shipD, eshopD };
        }));

        for (const comp of top3Details) {
          const name = String(comp.sellerD?.nickname || comp.seller_id || 'N/A');
          const finalPrice = comp.itemD?.price ?? comp.price;
          const origPrice = comp.itemD?.original_price ?? comp.original_price ?? comp.price;
          const city = comp.seller_address?.city?.name || '-';
          const state = comp.seller_address?.state?.name || '-';
          const shipInfo = comp.shipD || comp.shipping || {};
          const isFreeShip = shipInfo.free_shipping === true;
          if (isFreeShip) hasFreeShipping = true;
          const listType = mapListingType(comp.listing_type_id || comp.itemD?.listing_type_id);
          const warranty = comp.itemD?.warranty;
          const isOfficialStore = !!comp.eshopD?.id;
          const eshopName = comp.eshopD?.nick_name || '';

          // Comissão
          let commVal = 0, commDisp = 'N/A', commPct = '';
          if (finalPrice != null && (comp.category_id || comp.itemD?.category_id) && (comp.listing_type_id || comp.itemD?.listing_type_id)) {
            const commData = await fetchCommissions(finalPrice, comp.category_id || comp.itemD?.category_id, comp.listing_type_id || comp.itemD?.listing_type_id);
            if (commData?.sale_fee_amount !== undefined) {
              commVal = commData.sale_fee_amount;
              commDisp = formatCurrency(commVal);
              if (finalPrice > 0) commPct = ' (' + (commVal / finalPrice * 100).toFixed(1) + '%)';
            }
          }

          // Frete — busca custo para TODOS os vendedores (ML cobra taxa de frete de todos)
          let shipCostVal = 0, shipCostDisp = '-';
          if (comp.seller_id && comp.item_id) {
            const shipCostData = await fetchShippingCost(comp.item_id, comp.seller_id);
            if (shipCostData?.cost !== undefined) {
              shipCostVal = shipCostData.cost;
              shipCostDisp = formatCurrency(shipCostVal);
            }
          }

          // Repasse = Preço Final - Comissão - Taxa de Frete ML
          const repasse = (finalPrice != null) ? finalPrice - commVal - shipCostVal : null;
          const repasseDisp = repasse != null ? formatCurrency(repasse) : 'N/A';
          const repasseColor = repasse != null && repasse >= 0 ? 'var(--green-dark)' : 'var(--red-dark)';

          // Discount %
          const discPct = origPrice && origPrice > finalPrice ? '-' + ((1 - finalPrice / origPrice) * 100).toFixed(0) + '%' : '';

          // Visits
          let indVisits = 0, visitsPct = 0;
          if (visitData?.individuals) {
            const v = visitData.individuals.find(i => i.itemId === comp.item_id);
            if (v) { indVisits = v.totalVisitsInPeriod; if (totalTop3Visits > 0) visitsPct = (indVisits / totalTop3Visits * 100); }
          }

          // Reputation
          const repBadge = getReputationBadge(comp.sellerD?.seller_reputation);

          // Garantia — só mostra se curta e útil (remove textos longos do ML)
          let warrantyShort = '';
          if (warranty) {
            const w = warranty.replace(/\.$/, '').trim();
            if (w.length <= 40) warrantyShort = w;
            else {
              const m = w.match(/(\d+\s*(?:mes|mês|ano|dia|year|month|day)[a-zê]*)/i);
              if (m) warrantyShort = m[1];
            }
          }

          topCompHTML +=
          '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:6px;">' +
            // Header: nome + badges
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
              '<a href="https://www.mercadolivre.com.br/perfil/' + escapeHtml(name.toUpperCase()) + '" target="_blank" style="font-weight:600;color:var(--text);text-decoration:none;font-size:.88rem;">' + escapeHtml(name) + '</a>' +
              repBadge +
              (isOfficialStore ? '<span style="font-size:.72rem;background:#e0e7ff;color:#3730a3;padding:1px 6px;border-radius:4px;font-weight:600;">LOJA OFICIAL</span>' : '') +
              '<span style="font-size:.75rem;color:var(--text-muted);">' + escapeHtml(city) + '/' + escapeHtml(state) + '</span>' +
            '</div>' +
            // Row: badges de logística
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' +
              getLogisticBadge(shipInfo) +
              getFreteGratisBadge(shipInfo) +
              '<span style="font-size:.72rem;background:#f1f5f9;color:var(--text-secondary);padding:2px 8px;border-radius:4px;font-weight:500;">' + listType + '</span>' +
              (warrantyShort ? '<span style="font-size:.72rem;background:#f1f5f9;color:var(--text-secondary);padding:2px 8px;border-radius:4px;font-weight:500;">' + escapeHtml(warrantyShort) + '</span>' : '') +
            '</div>' +
            // Grid: dados financeiros
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:4px 16px;font-size:.82rem;">' +
              '<div><span style="color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;">Preço</span><div style="font-family:var(--font-mono);font-weight:600;color:var(--text);">' + formatCurrency(finalPrice) + (discPct ? ' <span style="color:var(--red);font-size:.75rem;">' + discPct + '</span>' : '') + '</div></div>' +
              '<div><span style="color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;">Comissão</span><div style="font-family:var(--font-mono);">' + commDisp + '<span style="font-size:.72rem;color:var(--text-muted);">' + commPct + '</span></div></div>' +
              '<div><span style="color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;">Frete ML</span><div style="font-family:var(--font-mono);">' + shipCostDisp + '</div></div>' +
              '<div><span style="color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;">Repasse</span><div style="font-family:var(--font-mono);font-weight:600;color:' + repasseColor + ';">' + repasseDisp + '</div></div>' +
              '<div><span style="color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;">Visitas 90d</span><div style="font-family:var(--font-mono);">' + indVisits.toLocaleString('pt-BR') + ' <span style="font-size:.72rem;color:var(--text-muted);">(' + visitsPct.toFixed(1) + '%)</span></div></div>' +
            '</div>' +
            // Footer: link do anúncio
            '<div style="margin-top:6px;"><a href="https://produto.mercadolivre.com.br/' + comp.item_id.replace('MLB', 'MLB-') + '" target="_blank" style="font-size:.75rem;color:var(--blue);text-decoration:none;font-family:var(--font-mono);">' + comp.item_id + '</a></div>' +
          '</div>';
        }

        // Image fallback from top competitor
        if (imageURL === placeholderSvgDataUri && top3Details[0]?.itemD?.pictures?.[0]?.url) {
          imageURL = top3Details[0].itemD.pictures[0].secure_url || top3Details[0].itemD.pictures[0].url;
        } else if (imageURL === placeholderSvgDataUri && top3Details[0]?.itemD?.thumbnail) {
          imageURL = top3Details[0].itemD.thumbnail.replace(/-\w\.(jpg|jpeg|png|webp)$/i, '-O.$1');
        }
        if (mappedLogistic === 'sem-logistica' && top3Details[0]?.shipping?.logistic_type) mappedLogistic = mapLogisticType(top3Details[0].shipping.logistic_type);

        if (visitData?.aggregated) chartsToRender.push({ chartData: visitData.aggregated, chartCanvasId: chartCanvasId, chartLabel: 'Visitas Top ' + top3Ids.length });

      } else { topCompHTML += '<p style="font-size:.85rem;color:var(--text-muted);">Sem detalhes disponíveis.</p>'; }
      topCompHTML += '</div>';
    } else { topCompHTML = '<div class="ac-top-competitors-section"><p style="font-size:.85rem;color:var(--text-muted);">Nenhum concorrente listado.</p></div>'; }

    const priceRange = compList.length > 1 ? (function() {
      const prices = compList.filter(c => c.price != null).map(c => c.price);
      if (prices.length < 2) return '';
      return '<span style="font-family:var(--font-mono);font-size:.78rem;color:var(--text-muted);">' + formatCurrency(Math.min(...prices)) + ' ~ ' + formatCurrency(Math.max(...prices)) + '</span>';
    })() : '';

    const headerHTML = '<a href="' + catLink + '" target="_blank" class="ac-catalog-title" title="' + escapeHtml(details.name || '') + '">' + escapeHtml((details.name || 'Nome não disponível').substring(0, 100)) + (details.name?.length > 100 ? '...' : '') + '</a>' +
      '<div class="ac-catalog-meta">' +
        '<span class="ac-catalog-id">' + details.id + '</span>' +
        brandHTML +
        '<span style="font-family:var(--font-mono);font-size:.82rem;"><strong style="color:var(--text);">' + compCount + '</strong> <span style="color:var(--text-muted);">anúncios</span></span>' +
        priceRange +
      '</div>';

    const imageHTML = '<div class="ac-catalog-image-container"><img src="' + imageURL + '" alt="' + escapeHtml(details.name || '') + '" class="ac-catalog-image" onerror="this.onerror=null;this.src=\'' + placeholderSvgDataUri + '\';"></div>';
    const chartHTML = '<div class="ac-catalog-chart-container"><canvas id="' + chartCanvasId + '"></canvas></div>';

    const fullHTML = '<div class="ac-catalog-item" data-logistic-type="' + mappedLogistic + '" data-frete="' + (hasFreeShipping ? 'sim' : 'nao') + '" data-competitors="' + compCount + '" data-price="' + (lowestPrice || 0) + '" data-visits="' + totalVisits + '">' +
      imageHTML + '<div class="ac-catalog-details">' + headerHTML + topCompHTML + '</div>' + chartHTML + '</div>';

    return { html: fullHTML, data: { id: catId, price: lowestPrice, visits: totalVisits, competitors: compCount, frete: hasFreeShipping, logistic: mappedLogistic } };
  });

  const results = (await Promise.all(htmlPromises)).filter(r => r !== null);

  if (currentOffset === 0) { resultsContainer.innerHTML = ''; renderedCatalogData = []; }

  results.forEach(r => { if (r.data) renderedCatalogData.push(r.data); });

  if (results.length > 0) resultsContainer.insertAdjacentHTML('beforeend', results.map(r => r.html).join(''));
  else if (currentOffset === 0) showMessage("Nenhum resultado encontrado.");

  chartsToRender.forEach(c => { if (document.getElementById(c.chartCanvasId)) renderVisitsChart(c.chartData, c.chartCanvasId, c.chartLabel); });
  applyAllFilters();
}

// --- Paginação ---
function renderPaginationControls() {
  paginationContainer.innerHTML = '';
  if (globalTotal === 0) return;
  let curPage = Math.floor(currentOffset / pageSize) + 1;
  let totalPages = Math.ceil(globalTotal / pageSize);
  if (totalPages <= 1 && globalTotal <= pageSize) {
    if (globalTotal > 0) paginationContainer.innerHTML = '<span style="font-size:.85rem;color:var(--text-secondary);font-family:var(--font-mono);">' + globalTotal + ' resultado(s)</span>';
    return;
  }
  if (totalPages === 0) return;

  let html = '<div class="ac-page-buttons">';
  if (curPage > 1) html += '<button class="ac-page-number" data-offset="' + ((curPage-2)*pageSize) + '" style="width:auto;padding:0 14px;font-family:var(--font-ui);">\u2190 Anterior</button>';
  const half = 2; let sp, ep;
  if (totalPages <= 7) { sp = 1; ep = totalPages; }
  else if (curPage <= half+1) { sp = 1; ep = 5; }
  else if (curPage >= totalPages - half) { sp = totalPages - 4; ep = totalPages; }
  else { sp = curPage - half; ep = curPage + half; }
  if (sp > 1) { html += '<button class="ac-page-number" data-page="1">1</button>'; if (sp > 2) html += '<span style="color:var(--text-muted);padding:0 4px;">\u2026</span>'; }
  for (let i = sp; i <= ep; i++) html += '<button class="' + (i === curPage ? 'ac-page-number ac-current' : 'ac-page-number') + '" data-page="' + i + '">' + i + '</button>';
  if (ep < totalPages) { if (ep < totalPages-1) html += '<span style="color:var(--text-muted);padding:0 4px;">\u2026</span>'; html += '<button class="ac-page-number" data-page="' + totalPages + '">' + totalPages + '</button>'; }
  if (curPage < totalPages) html += '<button class="ac-page-number" data-offset="' + (curPage*pageSize) + '" style="width:auto;padding:0 14px;font-family:var(--font-ui);">Próximo \u2192</button>';
  html += '</div><span class="ac-pagination-info">Página <strong>' + curPage + '</strong> de <strong>' + totalPages + '</strong> \u00B7 Total: <strong>' + globalTotal + '</strong></span>';
  paginationContainer.innerHTML = html;
  paginationContainer.querySelectorAll('button[data-offset], button.ac-page-number[data-page]').forEach(btn => {
    btn.addEventListener('click', function() {
      if (isLoading) return;
      let off = this.hasAttribute('data-offset') ? parseInt(this.getAttribute('data-offset')) : (parseInt(this.getAttribute('data-page')) - 1) * pageSize;
      if (off !== currentOffset) { currentOffset = off; loadPage(); }
    });
  });
}

// --- Filtros ---
function applyAllFilters() {
  const items = document.querySelectorAll('#analisadorCatalogoApp .ac-catalog-item');
  let visible = 0;
  // Collect items for sorting
  const itemsArr = Array.from(items);

  itemsArr.forEach(item => {
    const logistic = item.getAttribute('data-logistic-type');
    const frete = item.getAttribute('data-frete');
    const comps = parseInt(item.getAttribute('data-competitors') || '0');

    let show = true;
    if (filterLogistic !== 'Todos' && logistic !== filterLogistic) show = false;
    if (filterFrete === 'sim' && frete !== 'sim') show = false;
    if (filterFrete === 'nao' && frete !== 'nao') show = false;
    if (filterCompetitors === 'baixa' && comps > 5) show = false;
    if (filterCompetitors === 'media' && (comps < 6 || comps > 20)) show = false;
    if (filterCompetitors === 'alta' && comps < 21) show = false;

    item.style.display = show ? 'flex' : 'none';
    if (show) visible++;
  });

  // Sort visible items
  if (filterSort !== 'relevancia' && itemsArr.length > 1) {
    const parent = itemsArr[0].parentNode;
    const sorted = itemsArr.filter(i => i.style.display !== 'none').sort((a, b) => {
      const priceA = parseFloat(a.getAttribute('data-price') || '0');
      const priceB = parseFloat(b.getAttribute('data-price') || '0');
      const visitsA = parseFloat(a.getAttribute('data-visits') || '0');
      const visitsB = parseFloat(b.getAttribute('data-visits') || '0');
      const compsA = parseInt(a.getAttribute('data-competitors') || '0');
      const compsB = parseInt(b.getAttribute('data-competitors') || '0');
      switch (filterSort) {
        case 'menor-preco': return priceA - priceB;
        case 'maior-preco': return priceB - priceA;
        case 'mais-visitas': return visitsB - visitsA;
        case 'menos-concorrentes': return compsA - compsB;
        default: return 0;
      }
    });
    sorted.forEach(item => parent.appendChild(item));
    itemsArr.filter(i => i.style.display === 'none').forEach(i => parent.appendChild(i));
  }

  const existing = document.getElementById('ac-no-filter-match-msg');
  if (existing) existing.remove();
  if (visible === 0 && items.length > 0) {
    resultsContainer.insertAdjacentHTML('beforeend', '<div id="ac-no-filter-match-msg" class="ac-info-message" style="margin-top:14px;"><span style="font-size:1.5rem;">\uD83D\uDD0D</span><p>Nenhum item com esses filtros nesta página.</p></div>');
  }
}

// --- Loading ---
async function loadPage() {
  isLoading = true;
  updateButtonState();
  showProgress(10);
  showLoading(currentOffset === 0 && currentQuery ? 'Buscando "' + currentQuery.substring(0,30) + '"...' : 'Carregando página ' + (Math.floor(currentOffset/pageSize)+1) + '...');
  paginationContainer.innerHTML = '';
  try {
    showProgress(20);
    const data = await fetchCatalogs(currentQuery, currentOffset);
    if (!data?.results?.length) {
      if (currentOffset === 0 && currentQuery) showMessage('Nenhum catálogo encontrado para "' + currentQuery + '".');
      else if (currentOffset > 0) showMessage('Não há mais resultados.');
      else showMessage('Digite um termo para busca.');
      hideProgress(); return;
    }
    await renderResults(data);
  } catch (e) { showMessage('Erro: ' + e.message, 'error'); }
  finally { renderPaginationControls(); isLoading = false; isLoadingCredentials = false; updateButtonState(); hideProgress(); }
}

async function ensureCredentials() {
  if (accessToken && globalUserId) return true;
  isLoadingCredentials = true; updateButtonState();
  try {
    if (!accessToken) accessToken = await fetchAccessTokenInternal();
    if (accessToken && !globalUserId) globalUserId = await fetchUserIdForScraping();
    if (accessToken && globalUserId) { isLoadingCredentials = false; updateButtonState(); return true; }
    throw new Error('Credenciais incompletas.');
  } catch (e) {
    if (accessToken) { isLoadingCredentials = false; updateButtonState(); return true; }
    showMessage('Erro credenciais: ' + e.message + '. Reconecte ao Mercado Livre.', 'error');
    accessToken = null; globalUserId = null; return false;
  }
}

async function performSearch() {
  if (isLoading || isLoadingCredentials) return;
  const query = searchInput.value.trim();
  if (!query) { showMessage('Digite um termo de busca ou ID de produto.'); return; }
  isLoading = true; isLoadingCredentials = true; updateButtonState();
  showProgress(5); showLoading('Obtendo credenciais...');
  paginationContainer.innerHTML = '';
  if (!await ensureCredentials()) { isLoading = false; isLoadingCredentials = false; updateButtonState(); hideProgress(); return; }
  isLoadingCredentials = false;
  currentQuery = query; currentOffset = 0; globalTotal = 0;
  renderedCatalogsOnPage.clear(); renderedCatalogData = [];
  await loadPage();
}

// --- Event Listeners ---
searchButton.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); performSearch(); } });

if (logisticFilterSelect) {
  logisticFilterSelect.addEventListener('change', () => {
    filterLogistic = logisticFilterSelect.value;
    applyAllFilters();
  });
}

document.addEventListener('ac-filter-change', (e) => {
  const { filter, value } = e.detail;
  if (filter === 'frete') filterFrete = value;
  else if (filter === 'competitors') filterCompetitors = value;
  else if (filter === 'sort') { filterSort = value; }
  applyAllFilters();
});

console.log("Buscador de Catálogos v3.0 (Proposta U + Filtros Avançados) carregado.");
window.performCatalogSearch = performSearch;

} // end guard
