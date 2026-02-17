/**
 * MarketFácil - Account Scanner Widget
 * Repositório: Luckys666/frontend-marketfacil
 * 
 * Este script gerencia a busca massiva de anúncios e filtragem local via Proxy.
 */

// Estado Global do Scanner
window.scannerState = {
    allItems: [],
    filteredItems: [],
    uniqueTags: new Set(),
    isScanning: false,
    currentPage: 1,
    pageSize: 50
};

// --- Configuração & Constantes ---
const SCANNER_API_BASE = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
const SCANNER_TAGS_NEGATIVAS = new Set([
    "poor_quality_picture", "poor_quality_thumbnail",
    "incomplete_technical_specs", "moderation_penalty"
]);

// Mapa centralizado de tradução de tags (usado no dropdown, cards e CSV)
const TAG_TRANSLATIONS = {
    "poor_quality_picture": "Foto de Baixa Qualidade",
    "poor_quality_thumbnail": "Miniatura Ruim",
    "incomplete_technical_specs": "Ficha Técnica Incompleta",
    "moderation_penalty": "Penalidade (Infração)",
    "brand_verified": "Marca Verificada",
    "extended_warranty_eligible": "Elegível Garantia Est.",
    "good_quality_picture": "Foto Boa",
    "good_quality_thumbnail": "Miniatura Boa",
    "immediate_payment": "Pgto Imediato",
    "cart_eligible": "Carrinho",
    "free_shipping": "Frete Grátis",
    "catalog_product_candidate": "Candidato a Catálogo",
    "dragged_bids_and_visits": "Este anúncio já foi finalizado e recriado",
    "shipping_discount_item": "Desconto no Frete"
};

// Dicas de como resolver cada problema
const TAG_TIPS = {
    "poor_quality_picture": "Suas fotos foram reprovadas pelo robô do Mercado Livre. Troque por imagens com boa iluminação, fundo branco e alta resolução (mín. 1200x1200px).",
    "poor_quality_thumbnail": "A miniatura principal não passou na análise automática do ML. Use uma foto nítida, centralizada e sem textos sobrepostos.",
    "incomplete_technical_specs": "Preencha a Ficha Técnica completa no anúncio. Quanto mais atributos preenchidos, melhor o posicionamento nas buscas.",
    "moderation_penalty": "Este anúncio recebeu uma penalidade por infração às regras do Mercado Livre. Revise o conteúdo e corrija o problema indicado."
};

function translateTag(tag) {
    return TAG_TRANSLATIONS[tag] || tag;
}

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
    if (token && typeof token === 'string') {
        const parts = token.split('-');
        const possibleId = parts[parts.length - 1];
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
                return data.id;
            }
        } catch (e) {
            console.warn('Erro ao buscar ID via Proxy:', e);
        }
    }

    console.warn('Scanner: Não foi possível obter ID numérico via Token ou Proxy.');
    return null;
}

// --- Core Logic ---

async function startAccountScan() {
    console.log("Scanner v2.1 - UX Overhaul");
    if (window.scannerState.isScanning) return;

    const scanBtn = document.getElementById('scanButton');
    const progressDiv = document.getElementById('scanProgress');
    const progressBar = document.getElementById('scanProgressBar');
    const statusText = document.getElementById('scanStatusText');
    const countText = document.getElementById('scanCountText');
    const resultsContainer = document.getElementById('scannerResults');

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

        if (statusText) statusText.textContent = 'Mapeando conta (pode demorar)...';

        const allIds = await scannerFetchAllIds(userId, token, (progress) => {
            if (statusText) statusText.textContent = `Mapeando: ${progress.loaded} anúncios encontrados...`;
        });

        const total = allIds.length;
        if (statusText) statusText.textContent = `Processando detalhes de ${total} anúncios...`;

        const BATCH_SIZE = 20;
        let processed = 0;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batchIds = allIds.slice(i, i + BATCH_SIZE);
            const items = await scannerFetchDetails(batchIds, token);

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

        updateFilterDropdown();
        window.scannerState.currentPage = 1;
        window.scannerState.filteredItems = window.scannerState.allItems;
        renderScannerGrid(window.scannerState.allItems);
        updateCount(window.scannerState.allItems.length);

        // Mostrar legenda de tags
        const legend = document.getElementById('tagLegend');
        if (legend) legend.style.display = 'flex';

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
    const PROXY_ADS_URL = `${SCANNER_API_BASE}/api/fetch-ads`;

    while (offset < total) {
        try {
            let url = `${PROXY_ADS_URL}?seller_id=${userId}&limit=${LIMIT}`;
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
            if (data.scroll_id) scrollId = data.scroll_id;
            offset += LIMIT;
            if (onProgress) onProgress({ loaded: ids.length, total });
            await new Promise(r => setTimeout(r, 100));
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
        const proxyUrl = `${SCANNER_API_BASE}/api/fetch-item?item_id=${ids.join(',')}`;
        const res = await fetch(proxyUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            return data.map(item => {
                if (item.body) {
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
    const sortedTags = Array.from(window.scannerState.uniqueTags).sort();

    const critical = ['poor_quality_picture', 'poor_quality_thumbnail', 'incomplete_technical_specs', 'moderation_penalty'];
    const groups = { 'Críticas': [], 'Informativas': [] };

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
            op.textContent = translateTag(t);
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
            op.textContent = translateTag(t);
            d.appendChild(op);
        });
        select.appendChild(d);
    }
}

function handleScannerFilterChange() {
    const filter = document.getElementById('tagFilter').value;
    const all = window.scannerState.allItems;

    window.scannerState.currentPage = 1;
    if (filter === 'all') {
        window.scannerState.filteredItems = all;
    } else {
        window.scannerState.filteredItems = all.filter(item => item.tags && item.tags.includes(filter));
    }
    renderScannerGrid(window.scannerState.filteredItems);
    updateCount(window.scannerState.filteredItems.length);
}

function updateCount(n) {
    const el = document.getElementById('scanCountText');
    if (el) el.textContent = `${n} exibidos`;
}

function renderScannerGrid(items) {
    const container = document.getElementById('scannerResults');
    if (!container) return;
    container.innerHTML = '';

    // Guardar items filtrados para paginação
    window.scannerState.filteredItems = items;
    const totalItems = items.length;

    if (totalItems === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#64748b;">Nenhum item corresponde ao filtro.</div>';
        renderPagination(0, 0, 0);
        return;
    }

    const page = window.scannerState.currentPage;
    const pageSize = window.scannerState.pageSize;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIdx = (page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    const pageItems = items.slice(startIdx, endIdx);

    const fragment = document.createDocumentFragment();

    pageItems.forEach(item => {
        if (!item) return;

        let safeItem = item;
        if (item.body) {
            safeItem = { ...item.body, description: item.description };
        }
        if (!safeItem.title && safeItem.result) safeItem = safeItem.result;

        const div = document.createElement('div');
        div.className = 'ana-card';
        div.style.cssText = 'opacity: 1; animation: slideUpFade 0.5s ease forwards; display:flex; flex-direction:column; gap:10px; background: white; padding: 12px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);';

        const thumb = safeItem.thumbnail || 'https://http2.mlstatic.com/D_NQ_NP_906934-MLA47913349685_102021-O.webp';
        const price = safeItem.price ? `R$ ${safeItem.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';

        let tagsHtml = '';
        let tipsHtml = '';
        if (safeItem.tags) {
            safeItem.tags.forEach(t => {
                const isBad = SCANNER_TAGS_NEGATIVAS.has(t);
                const color = isBad ? 'error' : 'muted';
                const tip = TAG_TIPS[t] || '';
                const titleAttr = tip ? ` title="${tip}"` : '';
                const cursor = tip ? ' cursor:help;' : '';
                tagsHtml += `<span class="status-badge ${color}" style="font-size:0.7rem;${cursor}"${titleAttr}>${translateTag(t)}</span>`;
                if (isBad && tip) {
                    tipsHtml += `<div style="font-size:0.72rem; color:#ef4444; margin-top:4px; line-height:1.3;">💡 <b>${translateTag(t)}:</b> ${tip}</div>`;
                }
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
            <div style="margin-top:10px; padding-top:8px; border-top:1px dashed #e2e8f0;">
                 <div style="display:flex; flex-wrap:wrap; gap:4px;">
                    ${tagsHtml || '<span style="font-size:0.7rem; color:#cbd5e1; font-style:italic; padding:2px 0;">Nenhuma tag relevante.</span>'}
                </div>
                ${tipsHtml ? `<div style="margin-top:6px; padding:8px; background:#fef2f2; border-radius:6px; border: 1px solid #fecaca;">${tipsHtml}</div>` : ''}
            </div>
        `;
        fragment.appendChild(div);
    });

    container.appendChild(fragment);
    renderPagination(page, totalPages, totalItems);
}

function renderPagination(page, totalPages, totalItems) {
    const paginationDiv = document.getElementById('scannerPagination');
    if (!paginationDiv) return;

    if (totalPages <= 1) {
        paginationDiv.style.display = 'none';
        return;
    }

    paginationDiv.style.display = 'flex';
    paginationDiv.style.justifyContent = 'center';
    paginationDiv.style.alignItems = 'center';
    paginationDiv.style.gap = '12px';

    const pageSize = window.scannerState.pageSize;
    const startItem = (page - 1) * pageSize + 1;
    const endItem = Math.min(page * pageSize, totalItems);

    paginationDiv.innerHTML = `
        <button onclick="changeScannerPage(-1)" ${page <= 1 ? 'disabled' : ''}
            style="padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: ${page <= 1 ? '#f1f5f9' : '#fff'}; color: ${page <= 1 ? '#94a3b8' : '#3b82f6'}; cursor: ${page <= 1 ? 'not-allowed' : 'pointer'}; font-weight: 600; font-size: 0.85rem;">
            ← Anterior
        </button>
        <span style="font-size: 0.85rem; color: #475569; font-weight: 500;">
            ${startItem}–${endItem} de ${totalItems} &nbsp;|&nbsp; Página ${page}/${totalPages}
        </span>
        <button onclick="changeScannerPage(1)" ${page >= totalPages ? 'disabled' : ''}
            style="padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: ${page >= totalPages ? '#f1f5f9' : '#fff'}; color: ${page >= totalPages ? '#94a3b8' : '#3b82f6'}; cursor: ${page >= totalPages ? 'not-allowed' : 'pointer'}; font-weight: 600; font-size: 0.85rem;">
            Próxima →
        </button>
    `;
}

function changeScannerPage(delta) {
    const totalItems = window.scannerState.filteredItems.length;
    const totalPages = Math.ceil(totalItems / window.scannerState.pageSize);
    const newPage = window.scannerState.currentPage + delta;

    if (newPage < 1 || newPage > totalPages) return;

    window.scannerState.currentPage = newPage;
    renderScannerGrid(window.scannerState.filteredItems);

    // Scroll suave pro topo dos resultados
    const container = document.getElementById('scannerResults');
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Bind events global
window.startAccountScan = startAccountScan;
window.handleScannerFilterChange = handleScannerFilterChange;
window.changeScannerPage = changeScannerPage;

// Guard contra cliques múltiplos no export
let _csvExporting = false;

async function exportToCSV() {
    if (_csvExporting) return;

    const btn = document.getElementById('exportCsvButton');
    const filter = document.getElementById('tagFilter').value;
    const all = window.scannerState.allItems;
    let itemsToExport = [];

    if (filter === 'all') {
        itemsToExport = all;
    } else {
        itemsToExport = all.filter(item => item.tags && item.tags.includes(filter));
    }

    if (itemsToExport.length === 0) {
        alert("Nenhum item para exportar com o filtro atual.");
        return;
    }

    // Travar botão completamente
    _csvExporting = true;
    if (btn) {
        btn.textContent = '⏳ Preparando...';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.style.pointerEvents = 'none';
    }

    try {
        const totalItems = itemsToExport.length;
        let csvContent = "ID;Título;Preço;Status;Erros Encontrados;Link para Editar\r\n";

        // Processar em chunks de 100 para manter UI responsiva
        const CHUNK_SIZE = 100;
        for (let i = 0; i < totalItems; i += CHUNK_SIZE) {
            const chunk = itemsToExport.slice(i, i + CHUNK_SIZE);

            chunk.forEach(item => {
                let safeItem = item;
                if (item.body) safeItem = { ...item.body, description: item.description };
                if (!safeItem.title && safeItem.result) safeItem = safeItem.result;

                const id = safeItem.id || '';
                let title = (safeItem.title || '').replace(/"/g, '""').replace(/\n/g, ' ');
                const price = safeItem.price ? safeItem.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00';
                const permalink = safeItem.permalink || '';
                const tags = safeItem.tags || [];

                const problemas = tags.filter(t => SCANNER_TAGS_NEGATIVAS.has(t));
                const temErro = problemas.length > 0;
                const status = temErro ? "COM ERROS" : "OK";
                const listaErros = temErro
                    ? problemas.map(p => TAG_TRANSLATIONS[p] || p).join(', ')
                    : "Nenhum";

                csvContent += `"${id}";"${title}";"${price}";"${status}";"${listaErros}";"${permalink}"\r\n`;
            });

            // Atualizar progresso e dar respiro pro browser
            const processed = Math.min(i + CHUNK_SIZE, totalItems);
            if (btn) btn.textContent = `⏳ Processando ${processed}/${totalItems}...`;
            await new Promise(r => setTimeout(r, 0));
        }

        // Gerar arquivo
        if (btn) btn.textContent = '⏳ Gerando arquivo...';
        await new Promise(r => setTimeout(r, 50));

        const bom = "\uFEFF";
        const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.setAttribute("href", url);
        const date = new Date().toISOString().slice(0, 10);
        link.setAttribute("download", `Relatorio_Scanner_${filter === 'all' ? 'Geral' : translateTag(filter)}_${date}.csv`);

        // Mostrar "Baixando" ANTES do click
        if (btn) btn.textContent = '⏳ Baixando...';
        await new Promise(r => setTimeout(r, 50));

        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Aguardar o navegador processar o download (blob grande pode demorar)
        await new Promise(resolve => {
            let resolved = false;
            const done = () => {
                if (resolved) return;
                resolved = true;
                window.removeEventListener('focus', onFocus);
                clearTimeout(fallback);
                setTimeout(resolve, 1500);
            };
            const onFocus = () => done();
            setTimeout(() => {
                window.addEventListener('focus', onFocus);
            }, 500);
            const fallback = setTimeout(done, 8000);
        });

        URL.revokeObjectURL(url);

        // Feedback rápido de sucesso e liberar
        if (btn) {
            btn.textContent = '✅ Relatório baixado!';
            btn.style.opacity = '0.9';
        }
        await new Promise(r => setTimeout(r, 2000));

        _csvExporting = false;
        if (btn) {
            btn.textContent = '📊 Exportar Relatório';
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.pointerEvents = '';
        }

    } catch (e) {
        console.error('Erro ao exportar CSV:', e);
        alert('Erro ao gerar relatório: ' + e.message);
        _csvExporting = false;
        if (btn) {
            btn.textContent = '📊 Exportar Relatório';
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.pointerEvents = '';
        }
    }
}
window.exportToCSV = exportToCSV;
