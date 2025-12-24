/**
 * MarketFácil - Account Scanner Widget
 * Repositório: Luckys666/frontend-marketfacil
 * 
 * Este script gerencia a busca massiva de anúncios e filtragem local.
 */

// Estado Global do Scanner
window.scannerState = {
    allItems: [],
    uniqueTags: new Set(),
    isScanning: false
};

// --- Configuração & Constantes (Duplicadas para garantir independência) ---
const SCANNER_API_BASE = 'https://mlb-proxy-fdb71524fd60.herokuapp.com'; // Ou usar a do analyzer se garantido
const SCANNER_TAGS_NEGATIVAS = new Set([
    "poor_quality_picture", "poor_quality_thumbnail",
    "incomplete_technical_specs", "moderation_penalty"
]);

// --- Funções de API (Autocontidas) ---

async function getScannerAccessToken() {
    // Tenta reusar do analyzer se disponível, senão busca
    if (typeof fetchAccessToken === 'function') return fetchAccessToken();

    try {
        const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
        if (!r.ok) throw new Error('Falha ao obter token');
        const d = await r.json();
        return d.response.access_token;
    } catch (e) {
        console.error('Erro Token Scanner:', e);
        return null;
    }
}

async function getScannerUserId() {
    if (typeof fetchUserIdForScraping === 'function') return fetchUserIdForScraping();

    try {
        const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/get-user-id', { method: 'POST' });
        const d = await r.json();
        return d.response.user_id || d.user_id;
    } catch (e) {
        return null;
    }
}

// --- Core Logic ---

async function startAccountScan() {
    if (window.scannerState.isScanning) return;

    // UI Elements
    const scanBtn = document.getElementById('scanButton');
    const progressDiv = document.getElementById('scanProgress');
    const progressBar = document.getElementById('scanProgressBar');
    const statusText = document.getElementById('scanStatusText');
    const countText = document.getElementById('scanCountText');
    const resultsContainer = document.getElementById('scannerResults');
    const filterSelect = document.getElementById('tagFilter');

    // Reset UI
    window.scannerState.isScanning = true;
    window.scannerState.allItems = [];
    window.scannerState.uniqueTags.clear();

    if (scanBtn) scanBtn.disabled = true;
    if (progressDiv) progressDiv.style.display = 'block';
    if (resultsContainer) resultsContainer.innerHTML = '';
    if (progressBar) progressBar.style.width = '0%';

    try {
        if (statusText) statusText.textContent = 'Autenticando...';

        const [token, userId] = await Promise.all([getScannerAccessToken(), getScannerUserId()]);

        if (!token || !userId) throw new Error('Falha de autenticação. Recarregue a página.');

        // 1. Fetch All IDs
        if (statusText) statusText.textContent = 'Mapeando conta (pode demorar)...';

        const allIds = await scannerFetchAllIds(userId, token, (progress) => {
            if (statusText) statusText.textContent = `Mapeando: ${progress.loaded} anúncios encontrados...`;
        });

        const total = allIds.length;
        if (statusText) statusText.textContent = `Processando detalhes de ${total} anúncios...`;

        // 2. Fetch Details in Batches
        const BATCH_SIZE = 50;
        let processed = 0;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batchIds = allIds.slice(i, i + BATCH_SIZE);
            const items = await scannerFetchDetails(batchIds, token);

            // Process tags & store
            items.forEach(item => {
                if (item) {
                    window.scannerState.allItems.push(item);
                    if (item.tags) item.tags.forEach(t => window.scannerState.uniqueTags.add(t));
                }
            });

            processed += batchIds.length;
            const percent = Math.round((processed / total) * 100);

            if (progressBar) progressBar.style.width = `${percent}%`;
            if (statusText) statusText.textContent = `Processando: ${processed}/${total} (${percent}%)`;

            // Render partial results (optional, but good for feedback)
            // renderScannerGrid(window.scannerState.allItems); // Might be too heavy to re-render all every time
            // Let's just wait for end to render ALL, or render batch?
            // User prefers "filter after", so showing all initially is fine.
        }

        // 3. Finalize
        updateFilterDropdown();
        renderScannerGrid(window.scannerState.allItems);

        if (statusText) statusText.textContent = 'Varredura Completa!';
        if (countText) countText.textContent = `${window.scannerState.allItems.length} anúncios analisados`;
        if (progressBar) progressBar.style.width = '100%';

    } catch (e) {
        console.error('Scanner Error:', e);
        if (statusText) statusText.textContent = `Erro: ${e.message}`;
        alert('Erro ao escanear: ' + e.message);
    } finally {
        window.scannerState.isScanning = false;
        if (scanBtn) scanBtn.disabled = false;
    }
}

async function scannerFetchAllIds(userId, token, onProgress) {
    let ids = [];
    let offset = 0;
    let total = 1;
    const LIMIT = 50;
    const SEARCH_URI = `https://api.mercadolibre.com/users/${userId}/items/search`;

    while (offset < total) {
        try {
            const res = await fetch(`${SEARCH_URI}?search_type=scan&limit=${LIMIT}&offset=${offset}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.results) ids = ids.concat(data.results);
            if (data.paging) total = data.paging.total;

            offset += LIMIT;
            if (onProgress) onProgress({ loaded: ids.length, total });

            await new Promise(r => setTimeout(r, 50)); // Rate limit guard
        } catch (e) {
            console.warn('Erro fetch IDs:', e);
            break;
        }
    }
    return ids;
}

async function scannerFetchDetails(ids, token) {
    if (!ids.length) return [];
    try {
        // Reuse proxy endpoint if possible, or direct API
        // Using direct API for multimidget if proxy handles it? 
        // Analyzer uses: `${BASE_URL_PROXY}/api/fetch-item?item_id=${ids.join(',')}`
        // Let's try to use the same pattern as analyzer.
        const proxyUrl = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-item?item_id=${ids.join(',')}`;
        const res = await fetch(proxyUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();

        // Data format from proxy: [{ code: 200, body: {...} }, ...]
        return data.map(d => (d.code === 200 ? d.body : null)).filter(Boolean);
    } catch (e) {
        console.warn('Batch detail err:', e);
        return [];
    }
}

// --- UI & Filtering ---

function updateFilterDropdown() {
    const select = document.getElementById('tagFilter');
    if (!select) return;

    // Keep "All" and static options, or rebuild?
    // User wants to see tags that appeared.
    // Let's append detected tags that aren't already there.

    // Clear and set default
    select.innerHTML = '<option value="all">Ver Tudo</option>';

    // Sort tags
    const sortedTags = Array.from(window.scannerState.uniqueTags).sort();

    // Add common critical tags pinned to top if found
    const critical = ['poor_quality_picture', 'poor_quality_thumbnail', 'incomplete_technical_specs', 'moderation_penalty'];

    const groups = {
        'Críticas': [],
        'Informativas': []
    };

    sortedTags.forEach(tag => {
        if (critical.includes(tag)) groups['Críticas'].push(tag);
        else groups['Informativas'].push(tag);
    });

    if (groups['Críticas'].length) {
        const d = document.createElement('optgroup');
        d.label = "⚠️ Críticas";
        groups['Críticas'].forEach(t => {
            const op = document.createElement('option');
            op.value = t;
            op.textContent = `${t} 🚩`;
            d.appendChild(op);
        });
        select.appendChild(d);
    }

    if (groups['Informativas'].length) {
        const d = document.createElement('optgroup');
        d.label = "ℹ️ Outras";
        groups['Informativas'].forEach(t => {
            const op = document.createElement('option');
            op.value = t;
            op.textContent = t;
            d.appendChild(op);
        });
        select.appendChild(d);
    }
}

function handleScannerFilterChange() {
    const filter = document.getElementById('tagFilter').value;
    const all = window.scannerState.allItems;

    if (filter === 'all') {
        renderScannerGrid(all);
        updateCount(all.length);
    } else {
        const filtered = all.filter(item => item.tags && item.tags.includes(filter));
        renderScannerGrid(filtered);
        updateCount(filtered.length);
    }
}

function updateCount(n) {
    const el = document.getElementById('scanCountText');
    if (el) el.textContent = `${n} exibidos`;
}

function renderScannerGrid(items) {
    const container = document.getElementById('scannerResults');
    if (!container) return;
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#64748b;">Nenhum item corresponde ao filtro.</div>';
        return;
    }

    // Limit render for performance if huge? 
    // Render first 100? or lazy load?
    // For now render all, browser handles 1-2k DOM nodes okay usually, but pagination would be better.
    // Let's stick to full render for MVP "all in one page".

    const fragment = document.createDocumentFragment();

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'ana-card';
        div.style.cssText = 'animation:fadeIn 0.3s ease; display:flex; flex-direction:column; gap:10px;';

        const thumb = item.thumbnail || '';
        const price = item.price ? `R$ ${item.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';

        // Tags Badges
        let tagsHtml = '';
        if (item.tags) {
            item.tags.forEach(t => {
                const isBad = SCANNER_TAGS_NEGATIVAS.has(t);
                const color = isBad ? 'error' : 'muted';
                tagsHtml += `<span class="status-badge ${color}" style="font-size:0.7rem;">${t}</span>`;
            });
        }

        div.innerHTML = `
            <div style="display:flex; gap:12px;">
                <img src="${thumb}" style="width:70px; height:70px; object-fit:cover; border-radius:6px; background:#f8fafc;">
                <div style="flex:1; min-width:0;">
                    <a href="${item.permalink}" target="_blank" class="text-value" style="font-size:0.9rem; margin-bottom:4px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.title}">${item.title}</a>
                    <div style="color:#10b981; font-weight:700; font-size:0.95rem;">${price}</div>
                    <div style="color:#64748b; font-size:0.75rem;">${item.id}</div>
                </div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:4px; max-height:60px; overflow:hidden;">${tagsHtml}</div>
            <button onclick="if(window.handleAnalysisClick) window.handleAnalysisClick('${item.id}')" style="margin-top:auto; width:100%; padding:8px; background:#eff6ff; color:#3b82f6; border:none; border-radius:6px; font-weight:600; cursor:pointer;">Analisar Detalhes</button>
        `;
        fragment.appendChild(div);
    });

    container.appendChild(fragment);
}

// Bind events global
window.startAccountScan = startAccountScan;
window.handleScannerFilterChange = handleScannerFilterChange; 
