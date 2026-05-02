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

// === MF_renderError — error UI padrão Marketfacil (idempotente) ===
if (typeof window.MF_renderError !== 'function') {
  (function(){
    function buildMcUrl() {
      return window.location.href.includes('version-test')
        ? 'https://app.marketfacil.com.br/version-test/minha-conta'
        : 'https://app.marketfacil.com.br/minha-conta';
    }
    var TYPES = {
      no_ml_account: { icon: '🔐', title: 'Conta do Mercado Livre não conectada', msg: 'Pra usar essa ferramenta, conecte sua conta do Mercado Livre ao Marketfacil em <b>Minha Conta</b>.', cta: { label: 'Conectar conta do ML →', href: buildMcUrl } },
      session_expired: { icon: '⏳', title: 'Sessão expirou', msg: 'Sua sessão com o Mercado Livre expirou. Reconecte sua conta no Marketfacil pra continuar.', cta: { label: 'Reconectar conta →', href: buildMcUrl } },
      forbidden: { icon: '🚫', title: 'Acesso negado', msg: 'O Mercado Livre bloqueou essa requisição. Tente novamente em alguns minutos.', cta: null },
      rate_limited: { icon: '⏱', title: 'Muitas requisições', msg: 'Você atingiu o limite. Aguarde um instante e tente de novo.', cta: null },
      network_error: { icon: '🌐', title: 'Falha de conexão', msg: 'Não foi possível conectar ao Marketfacil. Verifique sua internet e tente novamente.', cta: null }
    };
    function injectStyles() {
      if (document.getElementById('mf-error-styles')) return;
      var style = document.createElement('style');
      style.id = 'mf-error-styles';
      style.textContent = ".mf-error-card{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;text-align:center;font-family:'DM Sans',sans-serif;color:#1e3a5f}.mf-error-icon{font-size:48px;line-height:1;margin-bottom:12px}.mf-error-title{font-size:18px;font-weight:700;margin:0 0 8px 0;color:#1e3a5f}.mf-error-msg{font-size:14px;color:#475569;max-width:480px;margin:0 0 16px 0;line-height:1.45}.mf-error-cta{display:inline-block;padding:10px 20px;background:#1e3a5f;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;transition:background .15s ease}.mf-error-cta:hover{background:#0f172a;color:#fff;text-decoration:none}";
      (document.head || document.body).appendChild(style);
    }
    function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
    window.MF_renderError = function(container, type, opts) {
      if (!container) return;
      injectStyles();
      var cfg = TYPES[type];
      if (!cfg) { container.innerHTML = '<div class="mf-error-card"><p class="mf-error-msg">'+escapeHtml((opts&&opts.msg)||'Erro inesperado.')+'</p></div>'; return; }
      var title = (opts && opts.title) || cfg.title;
      var msg = (opts && opts.msg) || cfg.msg;
      var cta = cfg.cta && (typeof cfg.cta.href === 'function' ? { label: cfg.cta.label, href: cfg.cta.href() } : cfg.cta);
      container.innerHTML = '<div class="mf-error-card mf-error-'+type+'"><div class="mf-error-icon">'+cfg.icon+'</div><p class="mf-error-title">'+escapeHtml(title)+'</p><p class="mf-error-msg">'+msg+'</p>'+(cta?'<a href="'+escapeHtml(cta.href)+'" class="mf-error-cta">'+escapeHtml(cta.label)+'</a>':'')+'</div>';
    };
    window.MF_ERROR_TYPES = Object.keys(TYPES);
  })();
}
// === fim MF_renderError ===

// --- Configuração & Constantes ---
const SCANNER_API_BASE = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';

const SCANNER_TAGS_NEGATIVAS = new Set([
    "poor_quality_picture", "poor_quality_thumbnail",
    "incomplete_technical_specs", "moderation_penalty"
]);

const SCANNER_TAGS_POSITIVAS = new Set([
    "good_quality_picture", "good_quality_thumbnail",
    "brand_verified", "extended_warranty_eligible",
    "cart_eligible", "immediate_payment",
    "free_shipping", "shipping_discount_item",
    "catalog_boost", "loyalty_discount_eligible",
    "meliplus_item", "supermarket_eligible"
]);

// Mapa centralizado de tradução de tags (usado no dropdown, cards e CSV)
const TAG_TRANSLATIONS = {
    // Negativas
    "poor_quality_picture": "Foto de Baixa Qualidade",
    "poor_quality_thumbnail": "Miniatura Ruim",
    "incomplete_technical_specs": "Ficha Técnica Incompleta",
    "moderation_penalty": "Penalidade (Infração)",
    // Positivas
    "good_quality_picture": "Foto Boa",
    "good_quality_thumbnail": "Miniatura Boa",
    "brand_verified": "Marca Verificada",
    "extended_warranty_eligible": "Elegível Garantia Est.",
    "immediate_payment": "Pgto Imediato",
    "cart_eligible": "Carrinho",
    "free_shipping": "Frete Grátis",
    "shipping_discount_item": "Desconto no Frete",
    "catalog_boost": "Impulso no Catálogo",
    "loyalty_discount_eligible": "Mercado Pontos",
    "meliplus_item": "Meli+",
    "supermarket_eligible": "Supermercado",
    // Informativas
    "user_product_listing": "Vinculado a Catálogo",
    "variations_migration_uptin": "Variação Migrada",
    "catalog_product_candidate": "Candidato a Catálogo",
    "catalog_listing": "Anúncio de Catálogo",
    "dragged_bids_and_visits": "Anúncio Recriado",
    "picture_crop_fix": "Foto Auto-Ajustada",
    "deal_of_the_day": "Oferta do Dia",
    "best_seller_candidate": "Candidato a Mais Vendido"
};

// Dicas de como resolver cada problema (apenas críticas)
const TAG_TIPS = {
    "poor_quality_picture": "Suas fotos foram reprovadas pelo robô do Mercado Livre. Troque por imagens com boa iluminação, fundo branco e alta resolução (mín. 1200x1200px).",
    "poor_quality_thumbnail": "A miniatura principal não passou na análise automática do ML. Use uma foto nítida, centralizada e sem textos sobrepostos.",
    "incomplete_technical_specs": "Preencha a Ficha Técnica completa no anúncio. Quanto mais atributos preenchidos, melhor o posicionamento nas buscas.",
    "moderation_penalty": "Este anúncio recebeu uma penalidade por infração às regras do Mercado Livre. Revise o conteúdo e corrija o problema indicado."
};

function translateTag(tag) {
    if (TAG_TRANSLATIONS[tag]) return TAG_TRANSLATIONS[tag];
    // Fallback: humaniza tag desconhecida (snake_case → "Snake Case")
    return tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function tagBadgeClass(tag) {
    if (SCANNER_TAGS_NEGATIVAS.has(tag)) return 'error';
    if (SCANNER_TAGS_POSITIVAS.has(tag)) return 'success';
    return 'muted';
}

function escapeAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

        if (!token || !userId) {
            const authErr = new Error('AUTH_FAILED');
            authErr.isAuthError = true;
            throw authErr;
        }

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
        if (progressDiv) progressDiv.style.display = 'none';

        if (e.isAuthError) {
            // Mensagem amigável de autenticação — padronizada via MF_renderError
            if (statusText) statusText.textContent = 'Conta não conectada';
            if (resultsContainer && window.MF_renderError) {
                window.MF_renderError(resultsContainer, 'no_ml_account');
            }
        } else {
            // Erro genérico (API, rede, etc.)
            if (statusText) statusText.textContent = `Erro: ${e.message}`;
            if (resultsContainer) {
                resultsContainer.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 30px 20px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px;">
                        <div style="font-size: 2rem; margin-bottom: 8px;">⚠️</div>
                        <p style="color: #991b1b; font-weight: 600; margin: 0 0 8px 0;">Erro ao escanear</p>
                        <p style="color: #64748b; font-size: 0.85rem; margin: 0 0 12px 0;">${e.message}</p>
                        <p style="color: #94a3b8; font-size: 0.75rem; margin: 0;">Se o problema persistir, verifique se sua conta está conectada em <a href="https://app.marketfacil.com.br/minha-conta" target="_blank" style="color: #3b82f6; text-decoration: underline;">Minha Conta</a>.</p>
                    </div>
                `;
            }
        }
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

        const tags = Array.isArray(safeItem.tags) ? safeItem.tags : [];
        const hasProblem = tags.some(t => SCANNER_TAGS_NEGATIVAS.has(t));

        const div = document.createElement('div');
        div.className = 'ana-card' + (hasProblem ? ' has-problem' : '');
        div.style.cssText = 'animation: slideUpFade 0.4s ease forwards; display:flex; flex-direction:column; gap:8px;';

        const thumb = safeItem.thumbnail || 'https://http2.mlstatic.com/D_NQ_NP_906934-MLA47913349685_102021-O.webp';
        const price = safeItem.price ? `R$ ${safeItem.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';

        let tagsHtml = '';
        let tipsHtml = '';
        tags.forEach(t => {
            const cls = tagBadgeClass(t);
            const tip = TAG_TIPS[t] || '';
            const titleAttr = tip ? ` title="${escapeAttr(tip)}"` : '';
            const cursor = tip ? ' style="cursor:help;"' : '';
            tagsHtml += `<span class="status-badge ${cls}"${cursor}${titleAttr}>${translateTag(t)}</span>`;
            if (cls === 'error' && tip) {
                tipsHtml += `<div class="sc-tip">💡 <b>${translateTag(t)}:</b> ${tip}</div>`;
            }
        });

        const title = safeItem.title || 'Sem título';
        const id = safeItem.id || 'N/A';
        const permalink = safeItem.permalink || '#';

        div.innerHTML = `
            <div style="display:flex; gap:12px; align-items:flex-start;">
                <img class="sc-thumb" src="${thumb}" alt="">
                <div style="flex:1; min-width:0;">
                    <a href="${permalink}" target="_blank" class="sc-title" title="${escapeAttr(title)}">${title}</a>
                    <div class="sc-price">${price}</div>
                    <div class="sc-id">${id}</div>
                </div>
            </div>
            <div class="sc-tags-row">
                ${tagsHtml || '<span class="sc-empty-tags">Nenhuma tag relevante.</span>'}
            </div>
            ${tipsHtml || ''}
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
        <button onclick="changeScannerPage(-1)" ${page <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="sc-page-info">${startItem}–${endItem} de ${totalItems}&nbsp;·&nbsp;Página ${page}/${totalPages}</span>
        <button onclick="changeScannerPage(1)" ${page >= totalPages ? 'disabled' : ''}>Próxima →</button>
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

// Limpa inline styles do HTML antigo do Bubble que conflitam com o CSS Light Trading
function scannerCleanupInlineStyles() {
    const exportBtn = document.getElementById('exportCsvButton');
    if (exportBtn) {
        // Remove background/color/border inline (inclusive !important) deixando o CSS dominar
        ['background', 'background-color', 'color', 'border', 'border-color', 'border-style', 'border-width', 'height']
            .forEach(p => exportBtn.style.removeProperty(p));
    }
    const scanBtn = document.getElementById('scanButton');
    if (scanBtn) {
        ['height'].forEach(p => scanBtn.style.removeProperty(p));
    }
    const tagFilter = document.getElementById('tagFilter');
    if (tagFilter) {
        ['padding', 'border', 'border-color', 'border-style', 'border-width', 'border-radius']
            .forEach(p => tagFilter.style.removeProperty(p));
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scannerCleanupInlineStyles);
} else {
    scannerCleanupInlineStyles();
}

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
