/**
 * MarketFácil - Account Scanner Widget
 * Repositório: Luckys666/frontend-marketfacil
 * 
 * Este script gerencia a busca massiva de anúncios e filtragem local via Proxy.
 */

// Estado Global do Scanner
window.scannerState = {
    allItems: [],
    uniqueTags: new Set(),
    isScanning: false
};

// --- Configuração & Constantes ---
const SCANNER_API_BASE = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
const SCANNER_TAGS_NEGATIVAS = new Set([
    "poor_quality_picture", "poor_quality_thumbnail",
    "incomplete_technical_specs", "moderation_penalty"
]);

// --- Funções de API (Autocontidas) ---

async function getScannerAccessToken() {
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

async function getScannerUserId(token) {
    // 1. Método Preferencial: Extrair ID diretamente do Token
    // Formato Mercado Livre: APP_USR-Seq-Seq-Seq-UserId (O último segmento é o ID)
    if (token && typeof token === 'string') {
        const parts = token.split('-');
        const possibleId = parts[parts.length - 1]; // Pega o último pedaço

        // Verifica se parece um ID numérico válido
        if (possibleId && /^\d+$/.test(possibleId)) {
            console.log('Scanner: ID extraído do token:', possibleId);
            return parseInt(possibleId, 10);
        }
    }

    // 2. Fallback: Tenta via Proxy (/users/me)
    if (token) {
        try {
            const r = await fetch(`${SCANNER_API_BASE}/api/users/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (r.ok) {
                const data = await r.json();
                return data.id; // Retorna o ID numérico do MLB
            }
        } catch (e) {
            console.warn('Erro ao buscar ID via Proxy:', e);
        }
    }

    // 3. Fallback: Removido para evitar erros de CORS e IDs inválidos (Bubble ID vs MLB ID).
    console.warn('Scanner: Não foi possível obter ID numérico via Token ou Proxy.');
    return null;
}

// --- Core Logic ---

async function startAccountScan() {
    console.log("Scanner v2.0 - Forced Visibility Update");
    if (window.scannerState.isScanning) return;

    // UI Elements
    const scanBtn = document.getElementById('scanButton');
    const progressDiv = document.getElementById('scanProgress');
    const progressBar = document.getElementById('scanProgressBar');
    const statusText = document.getElementById('scanStatusText');
    const countText = document.getElementById('scanCountText');
    const resultsContainer = document.getElementById('scannerResults');

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

        const token = await getScannerAccessToken();
        const userId = await getScannerUserId(token);

        if (!token || !userId) throw new Error('Falha de autenticação. Recarregue a página.');

        // 1. Fetch All IDs via Proxy
        if (statusText) statusText.textContent = 'Mapeando conta (pode demorar)...';

        const allIds = await scannerFetchAllIds(userId, token, (progress) => {
            if (statusText) statusText.textContent = `Mapeando: ${progress.loaded} anúncios encontrados...`;
        });

        const total = allIds.length;
        if (statusText) statusText.textContent = `Processando detalhes de ${total} anúncios...`;

        // 2. Fetch Details in Batches (Max 20 per batch for this Proxy Endpoint)
        const BATCH_SIZE = 20;
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
        }

        // 3. Finalize
        updateFilterDropdown();
        renderScannerGrid(window.scannerState.allItems);
        updateCount(window.scannerState.allItems.length);

        if (statusText) statusText.textContent = 'Varredura Completa!';
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
    let scrollId = null;

    // Use Proxy Route for Ads
    const PROXY_ADS_URL = `${SCANNER_API_BASE}/api/fetch-ads`;

    while (offset < total) {
        try {
            let url = `${PROXY_ADS_URL}?seller_id=${userId}&limit=${LIMIT}`;

            // Logic to handle Proxy's scroll/scan support
            if (scrollId) {
                url += `&scroll_id=${scrollId}`;
            } else {
                url += `&offset=${offset}`;
            }

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                const errTxt = await res.text();
                throw new Error(`Erro Proxy (${res.status}): ${errTxt}`);
            }

            const data = await res.json();

            if (data.results) ids = ids.concat(data.results);
            if (data.paging) total = data.paging.total;
            if (data.scroll_id) scrollId = data.scroll_id; // Capture scroll_id if API returns it

            offset += LIMIT;

            if (onProgress) onProgress({ loaded: ids.length, total });

            await new Promise(r => setTimeout(r, 100)); // Rate limit guard

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
        // Use Proxy Endpoint: /fetch-item (Max 20 IDs)
        // returns array of items with 'description' property injected
        const proxyUrl = `${SCANNER_API_BASE}/api/fetch-item?item_id=${ids.join(',')}`;
        const res = await fetch(proxyUrl, { headers: { 'Authorization': `Bearer ${token}` } });

        if (!res.ok) throw new Error(`Status ${res.status}`);

        const data = await res.json();

        // Normaliza a resposta: O endpoint /fetch-item (Multiget) retorna [{ code, body, description }]
        // Precisamos extrair o 'body' para ter os dados planos do item (id, title, price, etc).
        if (Array.isArray(data)) {
            return data.map(item => {
                // Se tiver a estrutura de multiget (com body), extraímos.
                if (item.body) {
                    // Preservamos a description se ela tiver sido injetada pelo Proxy
                    return { ...item.body, description: item.description };
                }
                return item;
            });
        }
        return [];

    } catch (e) {
        console.warn('Batch detail err:', e);
        return [];
    }
}

// --- UI & Filtering ---

function updateFilterDropdown() {
    const select = document.getElementById('tagFilter');
    if (!select) return;

    select.innerHTML = '<option value="all">Ver Tudo</option>';

    // Sort tags
    const sortedTags = Array.from(window.scannerState.uniqueTags).sort();

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

    const fragment = document.createDocumentFragment();

    items.forEach(item => {
        if (!item) return;

        // Double-check normalização (caso algo tenha passado errado)
        let safeItem = item;
        if (item.body) safeItem = { ...item.body, description: item.description };

        console.log('Rendering item:', safeItem.id, safeItem.title); // DEBUG

        const div = document.createElement('div');
        div.className = 'ana-card';
        // FIX: 'ana-card' css has opacity:0. We must force opacity:1 or use the correct animation 'slideUpFade' or 'mf-fadeIn'.
        // Adding opacity: 1 explicitly to guarantee visibility.
        div.style.cssText = 'opacity: 1; animation: slideUpFade 0.5s ease forwards; display:flex; flex-direction:column; gap:10px; background: white; padding: 12px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);';

        const thumb = safeItem.thumbnail || 'https://http2.mlstatic.com/D_NQ_NP_906934-MLA47913349685_102021-O.webp'; // Fallback img
        const price = safeItem.price ? `R$ ${safeItem.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';

        let tagsHtml = '';
        if (safeItem.tags) {
            safeItem.tags.forEach(t => {
                const isBad = SCANNER_TAGS_NEGATIVAS.has(t);
                const color = isBad ? 'error' : 'muted';
                tagsHtml += `<span class="status-badge ${color}" style="font-size:0.7rem;">${t}</span>`;
            });
        }

        const title = safeItem.title || 'Sem título';
        const id = safeItem.id || 'N/A';
        const permalink = safeItem.permalink || '#';

        div.innerHTML = `
            <div style="display:flex; gap:12px;">
                <img src="${thumb}" style="width:70px; height:70px; object-fit:cover; border-radius:6px; background:#f8fafc; border:1px solid #eee;">
                <div style="flex:1; min-width:0;">
                    <a href="${permalink}" target="_blank" class="text-value" style="font-size:0.9rem; margin-bottom:4px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:none; color:#1e293b; font-weight:600;" title="${title}">${title}</a>
                    <div style="color:#10b981; font-weight:700; font-size:0.95rem;">${price}</div>
                    <div style="color:#64748b; font-size:0.75rem;">${id}</div>
                </div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:4px; max-height:60px; overflow:hidden; margin-top:5px;">${tagsHtml}</div>
            <button onclick="if(window.handleAnalysisClick) window.handleAnalysisClick('${id}', true)" style="margin-top:auto; width:100%; padding:8px; background:#eff6ff; color:#3b82f6; border:none; border-radius:6px; font-weight:600; cursor:pointer; transition: background 0.2s;">Analisar Detalhes</button>
        `;
        fragment.appendChild(div);
    });

    container.appendChild(fragment);
}

// Bind events global
window.startAccountScan = startAccountScan;
window.handleScannerFilterChange = handleScannerFilterChange;
