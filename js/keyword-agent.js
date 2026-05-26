if (window.__keywordAgentLoaded) { /* prevent double execution */ } else {
window.__keywordAgentLoaded = true;

// --- Config ---
const PROXY_BASE = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
const SCRAPER_ENDPOINT = `${PROXY_BASE}/api/ml-scraper`;
const GPT_KEYWORDS_ENDPOINT = `${PROXY_BASE}/api/gpt-palavras`;

let globalUserId = '';
let globalIndexedWords = new Set();
let globalProductData = null;
let globalTitleMaxChars = 60; // 60 para anúncio comum, 200 para catálogo

// --- Cache de resultados (evita re-scraping do mesmo produto) ---
const resultCache = new Map();

// XSS defense: escapa chars HTML antes de inserir em innerHTML
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Fetch com retry automático ---
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if (resp.status === 429) {
        if (attempt === maxRetries) return resp;
        updateLoadingStep(`Limite temporário... aguardando (${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      if (resp.status >= 500 && attempt < maxRetries) {
        updateLoadingStep(`Servidor ocupado... tentativa ${attempt + 1}/${maxRetries}`);
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      return resp;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      updateLoadingStep(`Reconectando... tentativa ${attempt + 1}/${maxRetries}`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

// --- Stopwords (não contam como indexáveis) ---
const STOPWORDS = new Set([
  'o','a','os','as','um','uma','uns','umas','e','de','do','da','dos','das',
  'no','na','nos','nas','para','com','em','por','sem','ao','à','até',
  'que','se','ou','não','mais','como','mas','sua','seu','seus','suas',
  'este','esta','esse','essa','isso','aqui','ali','x','-','/'
]);

// --- Helpers ---
// Aceita qualquer prefixo ML (MLB/MCO/MLA/MLM/MLC/MLU) + variantes MLBU
const ML_SITE_PREFIXES = 'MLB|MCO|MLA|MLM|MLC|MLU';
function normalizeMlInput(input) {
  if (!input || typeof input !== 'string') return null;
  input = input.trim();
  const catalogMatch = input.match(new RegExp(`\\/p\\/((?:${ML_SITE_PREFIXES})\\w+)`, 'i'));
  if (catalogMatch) return { type: 'catalog', url: input, id: catalogMatch[1].toUpperCase() };
  const itemUrlMatch = input.match(new RegExp(`mercadoli[bv]re\\.com[^/]*.*/(${ML_SITE_PREFIXES})-?(\\d+)`, 'i'));
  if (itemUrlMatch) return { type: 'item', url: input, id: itemUrlMatch[1].toUpperCase() + itemUrlMatch[2] };
  if (/mercadoli[bv]re\.com/i.test(input)) {
    return { type: 'url', url: input, id: null };
  }
  const itemMatch = input.match(new RegExp(`^(${ML_SITE_PREFIXES})-?(\\d+)$`, 'i'));
  if (itemMatch) return { type: 'item', url: null, id: itemMatch[1].toUpperCase() + itemMatch[2] };
  const userCatMatch = input.match(new RegExp(`^(${ML_SITE_PREFIXES})U-?(\\d+)$`, 'i'));
  if (userCatMatch) return { type: 'mlbu', url: null, id: userCatMatch[1].toUpperCase() + 'U' + userCatMatch[2] };
  return null;
}

function buildScraperUrl(parsed) {
  if (parsed.url) return parsed.url;
  // Usa o helper global quando disponível, senão fallback MLB
  if (typeof window !== 'undefined' && typeof window.MF_productUrl === 'function' && parsed.id) {
    const u = window.MF_productUrl(parsed.id);
    if (u) return u;
  }
  if (parsed.type === 'item') return `https://produto.mercadolivre.com.br/MLB-${parsed.id.replace(/^MLB/i, '')}`;
  if (parsed.type === 'catalog') return `https://www.mercadolivre.com.br/p/${parsed.id}`;
  return null;
}

function normalizeWord(w) {
  return w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function extractWords(text) {
  if (!text) return [];
  return text.split(/[\s,;.!?()\/\-–—]+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !STOPWORDS.has(w.toLowerCase()))
    .map(w => normalizeWord(w))
    .filter(w => w.length > 1);
}

function extractIndexedWords(productData) {
  const words = new Set();

  // Palavras do título (todas indexáveis)
  if (productData.title) {
    extractWords(productData.title).forEach(w => words.add(w));
  }

  // Primeiros 30 chars de cada atributo string
  if (productData.attributes) {
    productData.attributes.forEach(attr => {
      if (attr.value_name && typeof attr.value_name === 'string') {
        const first30 = attr.value_name.substring(0, 30);
        extractWords(first30).forEach(w => words.add(w));
      }
    });
  }

  return words;
}

function findNewWords(phrase, indexedWords) {
  const phraseWords = extractWords(phrase);
  return phraseWords.filter(w => !indexedWords.has(w));
}

function hasNewWords(phrase, indexedWords) {
  return findNewWords(phrase, indexedWords).length > 0;
}

// --- Credentials ---
async function fetchUserIdForScraping() {
  try {
    const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/get-user-id', { method: 'POST' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return d?.response?.user_id || d?.user_id || null;
  } catch (e) {
    console.error('Erro User ID:', e);
    return null;
  }
}

// --- UI Helpers ---
function showError(msg) {
  const el = document.getElementById('kw-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function hideError() {
  const el = document.getElementById('kw-error');
  if (el) el.style.display = 'none';
}
function showLoading(show) {
  const container = document.getElementById('kw-loading');
  if (!container) return;
  if (show) {
    container.innerHTML = getLoadingHtml('Iniciando análise...', '');
    container.style.display = 'flex';
  } else {
    container.style.display = 'none';
  }
  const results = document.getElementById('kw-results');
  if (results && show) results.style.display = 'none';
}
function updateLoadingStep(text) {
  const el = document.querySelector('#kw-loading .kw-loading-msg');
  if (el) el.textContent = text;
  // Update active step
  const steps = document.querySelectorAll('#kw-loading .kw-step');
  if (steps.length > 0) {
    const stepMap = { 'credenciais': 0, 'anúncio': 1, 'buscando': 1, 'reconectando': 1, 'servidor': 1, 'limite': 1, 'palavras': 2, 'analisando': 2, 'cruzando': 3 };
    const key = Object.keys(stepMap).find(k => text.toLowerCase().includes(k));
    const activeIdx = key !== undefined ? stepMap[key] : 0;
    steps.forEach((s, i) => { s.classList.toggle('active', i <= activeIdx); });
  }
}
function updateProgress(pct) {
  const bar = document.querySelector('#kw-loading .kw-loading-bar-fill');
  if (bar) bar.style.width = pct + '%';
  const txt = document.querySelector('#kw-loading .kw-progress-text');
  if (txt) txt.textContent = Math.round(pct) + '%';
}
function getLoadingHtml(msg, sub) {
  const subHtml = sub ? `<p class="kw-loading-sub">${sub}</p>` : '';
  return `<div class="kw-loading-card">
    <div class="kw-orbital">
      <div class="kw-orbital-ring"></div>
      <div class="kw-orbital-ring"></div>
      <div class="kw-orbital-dot"></div>
    </div>
    <p class="kw-loading-msg">${msg}</p>
    ${subHtml}
    <div class="kw-loading-bar-wrapper">
      <div class="kw-loading-bar-fill" style="width:0%"></div>
    </div>
    <span class="kw-progress-text mono">0%</span>
    <div class="kw-loading-steps">
      <span class="kw-step active">Conexão</span>
      <span class="kw-step-dot">→</span>
      <span class="kw-step">Scraping</span>
      <span class="kw-step-dot">→</span>
      <span class="kw-step">IA Keywords</span>
      <span class="kw-step-dot">→</span>
      <span class="kw-step">Indexação</span>
    </div>
  </div>`;
}

// --- Category Config ---
const CATEGORY_CONFIG = {
  sinonimia: { icon: '🔄', label: 'Sinônimos', color: '#3b82f6', bg: '#eff6ff' },
  pesquisa: { icon: '🔍', label: 'Termos de Pesquisa', color: '#8b5cf6', bg: '#f5f3ff' },
  utilidades: { icon: '🛠️', label: 'Utilidades', color: '#f59e0b', bg: '#fffbeb' },
  concorrencia: { icon: '⚔️', label: 'Concorrência', color: '#ef4444', bg: '#fef2f2' },
  beneficios: { icon: '✨', label: 'Benefícios', color: '#10b981', bg: '#ecfdf5' },
  contexto: { icon: '📍', label: 'Contexto de Uso', color: '#06b6d4', bg: '#ecfeff' },
  regional: { icon: '🗺️', label: 'Termos Regionais', color: '#f97316', bg: '#fff7ed' }
};

// --- Render: Product Header ---
function renderProductHeader(data) {
  const header = document.getElementById('kw-product-header');
  if (!header) return;
  const img = data.pictures?.length > 0
    ? `<img src="${data.pictures[0]}" alt="" class="kw-product-img" />`
    : '';
  const price = data.price
    ? `<span class="kw-product-price mono">R$ ${parseFloat(data.price).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`
    : '';
  const badges = [
    data.is_catalog ? '<span class="kw-badge kw-badge-catalog">CATÁLOGO</span>' : '',
    data.shipping_mode === 'fulfillment' ? '<span class="kw-badge kw-badge-full">FULL</span>' : ''
  ].filter(Boolean).join(' ');

  header.innerHTML = `
    <div class="kw-product-card">
      ${img}
      <div class="kw-product-info">
        <div class="kw-product-title">${data.title || 'Produto'}</div>
        <div class="kw-product-meta">${price} ${badges}</div>
        ${data.catalog_product_id ? `<span class="kw-product-seller">${data.catalog_product_id}</span>` : ''}
      </div>
    </div>`;
  header.style.display = 'block';
}

// --- Render: Indexed Words ---
function renderIndexedWords(data, indexedWords) {
  const el = document.getElementById('kw-indexed');
  if (!el) return;

  const titleWords = data.title ? extractWords(data.title) : [];
  const attrWords = new Set();
  if (data.attributes) {
    data.attributes.forEach(attr => {
      if (attr.value_name) {
        extractWords(attr.value_name.substring(0, 30)).forEach(w => {
          if (!titleWords.includes(w)) attrWords.add(w);
        });
      }
    });
  }

  const titleTags = [...new Set(titleWords)].map(w =>
    `<span class="kw-word-title">✓ ${w}</span>`
  ).join('');
  const attrTags = [...attrWords].map(w =>
    `<span class="kw-word-attr">⚙ ${w}</span>`
  ).join('');

  el.innerHTML = `
    <div class="kw-indexed-header">
      <span class="kw-section-label">Palavras indexadas neste anúncio</span>
      <span class="mono" style="font-size:0.75rem;color:var(--green-dark);font-weight:600;">${indexedWords.size} palavras</span>
    </div>
    <div class="kw-indexed-words">${titleTags}${attrTags}</div>
    <div class="kw-indexed-hint">Título: ${titleWords.length} palavras · Atributos (30 chars): ${attrWords.size} palavras extras</div>`;
  el.style.display = 'block';
}

// --- Analyse: Build word-centric map ---
function buildMissingWordsMap(keywords, indexedWords) {
  // Map: word → { count, categories: Set, phrases: [] }
  const wordMap = new Map();

  for (const [catKey, terms] of Object.entries(keywords)) {
    if (!terms) continue;
    terms.forEach(phrase => {
      const newWords = findNewWords(phrase, indexedWords);
      newWords.forEach(w => {
        if (!wordMap.has(w)) wordMap.set(w, { count: 0, categories: new Set(), phrases: [] });
        const entry = wordMap.get(w);
        entry.count++;
        entry.categories.add(catKey);
        if (entry.phrases.length < 5) entry.phrases.push(phrase);
      });
    });
  }

  // Sort by count (most relevant first)
  return [...wordMap.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
}

// --- Render: Stats Bar ---
function renderStatsBar(missingWords, totalSuggestions, totalCategories) {
  const el = document.getElementById('kw-stats');
  if (!el) return;

  el.innerHTML = `
    <div class="kw-stat"><span class="kw-stat-value mono">${missingWords.length}</span><span class="kw-stat-label">Palavras Faltando</span></div>
    <div class="kw-stat-divider"></div>
    <div class="kw-stat"><span class="kw-stat-value mono kw-yellow">${totalSuggestions}</span><span class="kw-stat-label">Combos IA</span></div>
    <div class="kw-stat-divider"></div>
    <div class="kw-stat"><span class="kw-stat-value mono kw-white">${totalCategories}</span><span class="kw-stat-label">Categorias</span></div>
    <div class="kw-stats-actions">
      <button class="kw-btn-stats kw-btn-copy-all" onclick="window.__kwCopyMissing()">Copiar Palavras</button>
    </div>`;
  el.style.display = 'flex';
}

// --- Render: Missing Words (PRIMARY output) ---
function renderMissingWords(missingWords) {
  const container = document.getElementById('kw-missing');
  if (!container) return;

  if (missingWords.length === 0) {
    container.innerHTML = `<div class="kw-missing-empty">Seu anúncio já cobre todas as palavras sugeridas pela IA!</div>`;
    container.style.display = 'block';
    return;
  }

  let html = `
    <div class="kw-missing-header">
      <span class="kw-section-label">Palavras que faltam no seu anúncio</span>
      <span class="mono" style="font-size:0.75rem;color:var(--red-dark);font-weight:600;">${missingWords.length} palavras</span>
    </div>
    <p class="kw-missing-hint">Adicione estas palavras ao título ou atributos para ranquear em mais buscas. Quanto mais combos, mais relevante a palavra.</p>
    <div class="kw-missing-list">`;

  missingWords.forEach(([word, data], i) => {
    const catIcons = [...data.categories].map(c => {
      const cfg = CATEGORY_CONFIG[c];
      return cfg ? `<span class="kw-mw-cat" style="background:${cfg.bg};color:${cfg.color}" title="${cfg.label}">${cfg.icon}</span>` : '';
    }).join('');

    const phrasesPreview = data.phrases.slice(0, 3).map(p =>
      `<span class="kw-mw-phrase">${p}</span>`
    ).join('');

    html += `
      <div class="kw-mw-card kw-fade-in" style="animation-delay:${i * 0.03}s" onclick="window.__kwCopyWord(this, '${word.replace(/'/g, "\\'")}')">
        <div class="kw-mw-main">
          <span class="kw-mw-word">${word}</span>
          <span class="kw-mw-score mono">${data.count} combo${data.count > 1 ? 's' : ''}</span>
          <div class="kw-mw-cats">${catIcons}</div>
        </div>
        <div class="kw-mw-phrases">${phrasesPreview}</div>
      </div>`;
  });

  html += '</div>';
  container.innerHTML = html;
  container.style.display = 'block';
}

window.__kwCopyWord = function(el, word) {
  navigator.clipboard.writeText(word).then(() => {
    el.classList.add('kw-mw-copied');
    setTimeout(() => el.classList.remove('kw-mw-copied'), 1000);
  });
};

window.__kwCopyMissing = function() {
  const words = [];
  document.querySelectorAll('.kw-mw-word').forEach(el => words.push(el.textContent));
  navigator.clipboard.writeText(words.join(', ')).then(() => {
    const btn = document.querySelector('.kw-btn-copy-all');
    if (btn) { btn.textContent = 'Copiado!'; setTimeout(() => btn.textContent = 'Copiar Palavras', 1500); }
  });
};

// --- Render: Categories (with Geral overview) ---
function renderCategories(keywords, indexedWords, missingWords) {
  const container = document.getElementById('kw-categories');
  if (!container) return;

  // Build "Geral" card — all missing words as quick-copy tags
  const geralTags = missingWords.map(([word, data]) => {
    return `<span class="kw-tag kw-has-new" data-phrase="${word}" onclick="window.__kwToggleTag(this)">${word}<span class="kw-mw-score-mini mono">${data.count}</span></span>`;
  }).join('');

  let html = `
    <div class="kw-cats-header" onclick="window.__kwToggleCats()">
      <span class="kw-section-label">Combos de busca por categoria</span>
      <span class="kw-cats-toggle" id="kw-cats-toggle">Recolher ▴</span>
    </div>
    <div class="kw-cats-body" id="kw-cats-body">
    <div class="kw-category-card kw-full-width kw-fade-in" style="--cat-color:#0066ff">
      <div class="kw-category-header">
        <div class="kw-category-icon" style="background:var(--blue-light)">🎯</div>
        <span class="kw-category-name">Geral — Todas as Palavras Faltando</span>
        <span class="kw-cat-new">+${missingWords.length} novas</span>
      </div>
      <div class="kw-tags">${geralTags}</div>
    </div>
    <div class="kw-grid">`;

  let catIndex = 0;
  for (const [key, terms] of Object.entries(keywords)) {
    if (!terms || terms.length === 0) continue;
    const cfg = CATEGORY_CONFIG[key] || { icon: '📝', label: key, color: '#6b7280', bg: '#f9fafb' };

    let newWordsInCat = new Set();
    terms.forEach(t => findNewWords(t, indexedWords).forEach(w => newWordsInCat.add(w)));

    const isLast = catIndex === Object.keys(keywords).filter(k => keywords[k]?.length > 0).length - 1;

    const tagsHtml = terms.map(t => {
      const newW = findNewWords(t, indexedWords);
      const isNew = newW.length > 0;
      const cls = isNew ? 'kw-tag kw-has-new' : 'kw-tag kw-all-indexed';
      const dataNew = newW.join(',');
      const highlighted = isNew ? t.split(/\s+/).map(w => {
        const norm = normalizeWord(w);
        return newW.includes(norm) ? `<strong>${w}</strong>` : w;
      }).join(' ') : t;
      return `<span class="${cls}" data-new="${dataNew}" data-phrase="${t.replace(/"/g, '&quot;')}" onclick="window.__kwToggleTag(this)">${highlighted}${isNew ? '<span class="kw-new-dot"></span>' : '<span class="kw-check-mark">✓</span>'}</span>`;
    }).join('');

    html += `
      <div class="kw-category-card${isLast && catIndex % 2 === 0 ? ' kw-full-width' : ''}" style="--cat-color:${cfg.color}">
        <div class="kw-category-header">
          <div class="kw-category-icon" style="background:${cfg.bg}">${cfg.icon}</div>
          <span class="kw-category-name">${cfg.label}</span>
          ${newWordsInCat.size > 0 ? `<span class="kw-cat-new">+${newWordsInCat.size} novas</span>` : `<span class="kw-cat-new kw-cat-zero">+0 novas</span>`}
          <span class="kw-category-count">${terms.length}</span>
        </div>
        <div class="kw-tags">${tagsHtml}</div>
      </div>`;
    catIndex++;
  }

  html += '</div></div>';
  container.innerHTML = html;

  const results = document.getElementById('kw-results');
  if (results) results.style.display = 'block';
}

window.__kwToggleCats = function() {
  const body = document.getElementById('kw-cats-body');
  const toggle = document.getElementById('kw-cats-toggle');
  if (!body || !toggle) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  toggle.textContent = open ? 'Expandir ▾' : 'Recolher ▴';
};

// --- Tag Click (copy individual) ---
window.__kwToggleTag = function(el) {
  const phrase = el.dataset.phrase;
  if (!phrase) return;
  navigator.clipboard.writeText(phrase).then(() => {
    el.classList.add('kw-selected');
    setTimeout(() => el.classList.remove('kw-selected'), 1200);
  });
};



// --- Main ---
async function handleAnalyzeKeywords() {
  hideError();
  const inputEl = document.getElementById('input-link-anuncio');
  const rawInput = inputEl?.value?.trim();

  if (!rawInput) { showError('Cole o link ou ID do anúncio para analisar.'); return; }
  const parsed = normalizeMlInput(rawInput);
  if (!parsed) { showError('Link ou ID inválido. Use um link do Mercado Livre ou ID (ex: MLB12345678).'); return; }

  // Reset UI
  ['kw-product-header','kw-indexed','kw-stats','kw-missing','kw-title-builder','kw-results'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  showLoading(true);
  updateProgress(5);
  updateLoadingStep('Obtendo credenciais...');

  try {
    if (!globalUserId) {
      globalUserId = await fetchUserIdForScraping();
      if (!globalUserId) { showLoading(false); showError('Não foi possível obter suas credenciais. Recarregue a página.'); return; }
    }
    updateProgress(15);

    updateLoadingStep('Buscando dados do anúncio...');
    const scraperUrl = buildScraperUrl(parsed);
    if (!scraperUrl) { showLoading(false); showError('Não foi possível montar a URL do produto.'); return; }

    // Check cache first
    const cacheKey = scraperUrl;
    let productData;
    if (resultCache.has(cacheKey)) {
      productData = resultCache.get(cacheKey);
      updateProgress(40);
    } else {
      const scraperResp = await fetchWithRetry(`${SCRAPER_ENDPOINT}?url=${encodeURIComponent(scraperUrl)}`, {
        headers: { 'x-user-id': globalUserId }
      }, 3);
      if (!scraperResp.ok) {
        const err = await scraperResp.json().catch(() => ({}));
        showLoading(false);
        if (scraperResp.status === 403) { showError('Acesso restrito. Verifique seu plano.'); return; }
        if (scraperResp.status === 429) { showError('Muitas requisições. Aguarde alguns minutos e tente novamente.'); return; }
        showError(err.error || `Erro ${scraperResp.status}. Tente novamente.`);
        return;
      }
      productData = await scraperResp.json();
      resultCache.set(cacheKey, productData);
      updateProgress(40);
    }

    globalProductData = productData;

    if (!productData.title) { showLoading(false); showError('Não foi possível extrair os dados. Verifique o link.'); return; }

    // Set title max chars based on product type
    globalTitleMaxChars = productData.is_catalog ? 200 : 60;

    // Extract indexed words
    globalIndexedWords = extractIndexedWords(productData);

    // Render product + indexed words
    renderProductHeader(productData);
    renderIndexedWords(productData, globalIndexedWords);

    // Build GPT text
    updateLoadingStep('Analisando palavras-chave com IA...');
    let texto = productData.title || '';
    if (productData.attributes?.length > 0) {
      const attrs = productData.attributes.filter(a => a.value_name?.length > 1).map(a => `${a.id}: ${a.value_name}`).join('. ');
      if (attrs) texto += '. ' + attrs;
    }
    if (productData.description) texto += '. ' + productData.description;
    updateProgress(50);

    const gptResp = await fetch(GPT_KEYWORDS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${globalUserId}` },
      body: JSON.stringify({ texto })
    });
    if (!gptResp.ok) {
      const err = await gptResp.json().catch(() => ({}));
      showLoading(false);
      if (gptResp.status === 403) { showError('Acesso restrito. Verifique seu plano.'); return; }
      if (gptResp.status === 429) { showError('Limite de análises GPT atingido. Aguarde alguns minutos.'); return; }
      showError(err.error || `Erro ${gptResp.status}. Tente novamente.`);
      return;
    }

    updateProgress(90);
    updateLoadingStep('Cruzando dados de indexação...');
    const keywords = await gptResp.json();

    // Build word-centric analysis
    const missingWords = buildMissingWordsMap(keywords, globalIndexedWords);
    const totalSuggestions = Object.values(keywords).reduce((s, t) => s + (t?.length || 0), 0);
    const totalCategories = Object.keys(keywords).filter(k => keywords[k]?.length > 0).length;

    // Render everything (word-centric first)
    renderStatsBar(missingWords, totalSuggestions, totalCategories);
    renderMissingWords(missingWords);
    renderTitleGenerator();
    renderCategories(keywords, globalIndexedWords, missingWords);
    updateProgress(100);
    setTimeout(() => showLoading(false), 300);

  } catch (err) {
    console.error('Erro na análise:', err);
    showLoading(false);
    showError(`Erro: ${err.message}`);
  }
}

window.handleAnalyzeKeywords = handleAnalyzeKeywords;

// --- Title Generator ---
const GPT_TITLES_ENDPOINT = `${PROXY_BASE}/api/gpt-titulos`;

function renderTitleGenerator() {
  const el = document.getElementById('kw-title-generator');
  if (!el) return;
  el.innerHTML = `
    <div class="kw-tg-header">
      <span class="kw-section-label">Gerar Títulos com IA</span>
      <button class="kw-btn-generate" id="kw-btn-generate" onclick="window.__kwGenerateTitles()">
        <span class="kw-btn-generate-text">Gerar 3 Títulos</span>
        <span class="kw-btn-generate-loading" style="display:none">Gerando...</span>
      </button>
    </div>
    <div id="kw-titles-list" class="kw-titles-list"></div>`;
  el.style.display = 'block';
}

window.__kwGenerateTitles = async function() {
  const btn = document.getElementById('kw-btn-generate');
  const listEl = document.getElementById('kw-titles-list');
  if (!btn || !listEl || !globalProductData) return;

  // Show loading
  btn.querySelector('.kw-btn-generate-text').style.display = 'none';
  btn.querySelector('.kw-btn-generate-loading').style.display = 'inline';
  btn.disabled = true;
  listEl.innerHTML = '<div class="kw-titles-loading"><div class="kw-titles-shimmer"></div><div class="kw-titles-shimmer"></div><div class="kw-titles-shimmer"></div></div>';

  try {
    // Collect new words from missing words section
    const newWordsSet = new Set();
    document.querySelectorAll('#kw-missing .kw-mw-word').forEach(el => {
      newWordsSet.add(el.textContent.trim().toLowerCase());
    });

    // Collect terms only from category cards (not Geral)
    const allTerms = [];
    document.querySelectorAll('#kw-cats-body .kw-grid .kw-tag').forEach(t => {
      if (t.dataset.phrase) allTerms.push(t.dataset.phrase);
    });

    const resp = await fetch(GPT_TITLES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${globalUserId}` },
      body: JSON.stringify({
        produto_principal: globalProductData.title,
        termos_chave: allTerms,
        is_catalogo: globalProductData.is_catalog || false,
        quantidade: 3,
        palavras_ja_indexadas: [...globalIndexedWords].join(', '),
        palavras_novas: [...newWordsSet].join(', ')
      })
    });

    if (!resp.ok) throw new Error('Erro ao gerar títulos');
    const data = await resp.json();

    if (!data.titulos || data.titulos.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Nenhum título gerado.</p>';
      return;
    }

    listEl.innerHTML = data.titulos.map((t, i) => {
      const charClass = t.dentro_limite ? (t.caracteres <= globalTitleMaxChars - 10 ? 'kw-m-ok' : 'kw-m-warn') : 'kw-m-over';

      // Count new words
      const titleWords = t.texto.split(/\s+/);
      const newCount = titleWords.filter(w => {
        const norm = normalizeWord(w);
        return norm.length > 1 && !globalIndexedWords.has(norm) && !STOPWORDS.has(w.toLowerCase());
      }).length;

      return `
        <div class="kw-title-card kw-slide-in" style="animation-delay:${i * 0.12}s">
          <div class="kw-title-card-header">
            <span class="kw-title-number">${i + 1}</span>
            <span class="kw-title-chars ${charClass} mono" id="kw-tc-${i}">${t.caracteres}/${globalTitleMaxChars}</span>
            <span class="kw-title-new-count mono" id="kw-tn-${i}">+${newCount} novas</span>
            <button class="kw-btn-copy-title" onclick="window.__kwCopySingleTitle(this, ${i})">Copiar</button>
          </div>
          <div class="kw-title-text-gen" contenteditable="true" id="kw-te-${i}" oninput="window.__kwUpdateCardMetrics(${i})">${t.texto}</div>
        </div>`;
    }).join('');

    // Highlight new words in each title
    data.titulos.forEach((t, i) => {
      window.__kwUpdateCardMetrics(i);
    });

  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--red-dark);font-size:0.85rem;">Erro: ${escapeHtml(err.message)}</p>`;
  } finally {
    btn.querySelector('.kw-btn-generate-text').style.display = 'inline';
    btn.querySelector('.kw-btn-generate-loading').style.display = 'none';
    btn.disabled = false;
  }
};

window.__kwUpdateCardMetrics = function(i) {
  const el = document.getElementById('kw-te-' + i);
  const charsEl = document.getElementById('kw-tc-' + i);
  const newEl = document.getElementById('kw-tn-' + i);
  if (!el) return;

  const text = el.textContent || '';
  const chars = text.length;
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const newWords = words.filter(w => {
    const norm = normalizeWord(w);
    return norm.length > 1 && !globalIndexedWords.has(norm) && !STOPWORDS.has(w.toLowerCase());
  });

  if (charsEl) {
    const warnAt = globalTitleMaxChars - 10;
    charsEl.textContent = chars + '/' + globalTitleMaxChars;
    charsEl.className = 'kw-title-chars mono ' + (chars <= warnAt ? 'kw-m-ok' : chars <= globalTitleMaxChars ? 'kw-m-warn' : 'kw-m-over');
  }
  if (newEl) {
    newEl.textContent = '+' + newWords.length + ' novas';
  }
};

window.__kwCopySingleTitle = function(btn, i) {
  const el = document.getElementById('kw-te-' + i);
  const text = el?.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓';
    btn.classList.add('kw-copied-btn');
    setTimeout(() => { btn.textContent = 'Copiar'; btn.classList.remove('kw-copied-btn'); }, 1500);
  });
};

function bindButton() {
  const btn = document.getElementById('btn-analisar');
  if (btn && !btn.__kwBound) {
    btn.__kwBound = true;
    btn.addEventListener('click', handleAnalyzeKeywords);
  }
}
document.addEventListener('DOMContentLoaded', bindButton);
setTimeout(bindButton, 500);
setTimeout(bindButton, 2000);

} // end guard
