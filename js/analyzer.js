/**
 * Ad Analyzer Widget Logic
 */

// -------------- Constantes de Configuração --------------
const MIN_CHARS_TITULO_RUIM = 40;
const MIN_CHARS_TITULO_BOM = 50;
const MAX_CHARS_TITULO_BOM = 60;
const PONTOS_PENALIDADE_TITULO_CURTO = -15;
const PONTOS_PENALIDADE_TITULO_MEDIO = -8;
const TAMANHO_IDEAL_ATRIBUTO = 30;
const PONTOS_PENALIDADE_POR_10_CHARS_DIF_ATR = -2;
const PONTOS_PENALIDADE_POR_PALAVRA_REPETIDA = -3;
const PONTOS_PENALIDADE_SEM_ATRIBUTOS = -15;
const PONTOS_PENALIDADE_MODERATION_PENALTY = -50;
const PONTOS_BONUS_DESCRICAO = 5;
const ATRIBUTOS_IGNORADOS_REPETICAO = new Set([]); // Lista limpa para ser mais rigoroso
const ATRIBUTOS_IGNORADOS_COMPLETAMENTE = new Set(['GTIN', 'SKU', 'SELLER_SKU', 'INMETRO_CERTIFICATION_REGISTRATION_NUMBER']);
const VALORES_IGNORADOS_PENALIDADE = new Set(['isento', 'não aplicável', 'na']);

const tagSignificados = {
    "good_quality_picture": "Anúncio possui fotos de boa qualidade.",
    "good_quality_thumbnail": "A foto principal (miniatura) do anúncio é de boa qualidade.",
    "poor_quality_picture": "Anúncio possui fotos de baixa qualidade.",
    "poor_quality_thumbnail": "A foto principal (miniatura) do anúncio é de baixa qualidade.",
    "brand_verified": "A marca do produto foi verificada pelo Mercado Livre.",
    "extended_warranty_eligible": "O produto é elegível para garantia estendida.",
    "immediate_payment": "Pagamento deve ser feito imediatamente.",
    "cart_eligible": "O produto pode ser adicionado ao carrinho de compras.",
    "incomplete_technical_specs": "A ficha técnica do produto está incompleta (segundo tag do ML).",
    "catalog_product_candidate": "Este anúncio é um candidato a usar o catálogo do Mercado Livre.",
    "moderation_penalty": "Penalidade por moderação. Violação de regra detectada.",
    "free_shipping": "O anúncio oferece frete grátis.",
};
const TAGS_NEGATIVAS = new Set([
    "poor_quality_picture", "poor_quality_thumbnail",
    "incomplete_technical_specs", "moderation_penalty"
]);

const BASE_URL_PROXY = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
const API_FETCH_ITEM_ENDPOINT = `${BASE_URL_PROXY}/api/fetch-item`; // Rota unificada para item(s) e descrição
const API_USER_PRODUCTS_ENDPOINT = `${BASE_URL_PROXY}/api/user-products`; // ROTA PARA MLBU
const API_ATTRIBUTES_ENDPOINT = `${BASE_URL_PROXY}/api/attributes`;
const API_PERFORMANCE_ENDPOINT = `${BASE_URL_PROXY}/api/performance`;
const API_VISITS_ENDPOINT = `${BASE_URL_PROXY}/api/visits`; // Nova rota para visitas
const API_REVIEWS_ENDPOINT = `${BASE_URL_PROXY}/api/reviews`; // Nova rota para reviews

function deveIgnorarAtributoPorNome(nome) {
    if (!nome) return false;
    const nomeLower = nome.toLowerCase();
    const FRASES_IGNORADAS_NOME_ATRIBUTO = ['número de', 'número do', 'registro de', 'registro do'];
    return FRASES_IGNORADAS_NOME_ATRIBUTO.some(frase => nomeLower.startsWith(frase));
}

function normalizeMlbId(input) {
    const regex = /(MLB|MLBU)-?(\d+)/i;
    const match = input.match(regex);
    return match ? match[1].toUpperCase() + match[2] : null;
}

function getPalavrasUnicas(texto) {
    if (!texto) return new Set();
    return new Set(texto.toLowerCase().replace(/[.,!?;:()"'/\\-]/g, ' ').split(/\s+/).filter(p => p && p.length >= 3));
}

function encontrarIntersecao(set1, set2) {
    const repetidas = [];
    for (const palavra of set1) { if (set2.has(palavra)) repetidas.push(palavra); }
    return repetidas;
}

function definirCorPorQuantidadeCaracteres(caracteresValor, attributeId = null, valorTexto = '') {
    if (VALORES_IGNORADOS_PENALIDADE.has(valorTexto.toLowerCase())) return 'inherit';
    if (attributeId === 'BRAND' && caracteresValor > 0 && caracteresValor < TAMANHO_IDEAL_ATRIBUTO) return 'green';
    if (caracteresValor >= 20 && caracteresValor <= TAMANHO_IDEAL_ATRIBUTO) return 'green';
    if (caracteresValor > TAMANHO_IDEAL_ATRIBUTO && caracteresValor <= TAMANHO_IDEAL_ATRIBUTO + 10) return 'gray';
    if (caracteresValor === 0) return 'red';
    return 'red';
}

function exibirTitulo(titulo, isMlbu = false, containerId = "tituloTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;
    const len = titulo ? titulo.length : 0;

    let badgeClass = 'error';
    let expl = '';

    if (isMlbu) {
        if (len >= 50) { badgeClass = 'success'; expl = 'Tamanho Ideal (MLBU)'; }
        else { badgeClass = 'error'; expl = 'Curto (Min 50)'; }
    } else {
        if (len >= MIN_CHARS_TITULO_BOM && len <= MAX_CHARS_TITULO_BOM) { badgeClass = 'success'; expl = 'Tamanho Ideal'; }
        else if (len >= MIN_CHARS_TITULO_RUIM && len < MIN_CHARS_TITULO_BOM) { badgeClass = 'muted'; expl = 'Aceitável'; }
        else { badgeClass = 'error'; expl = 'Ruim'; }
    }

    el.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">📝</span>
                <span class="ana-card-title">Análise do Título</span>
                <span class="status-badge ${badgeClass}" style="margin-left:auto;">${expl}</span>
            </div>
            <p class="text-value" style="font-size: 1.25rem; font-weight:700;">${titulo || 'N/A'}</p>
            <p class="text-small" style="margin-top:5px;">${len} caracteres</p>
        </div>
    `;
}

function exibirDescricaoIndicator(descriptionData, containerId = "descricaoIndicator") {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hasDesc = descriptionData?.plain_text?.trim() !== "";
    const badgeClass = hasDesc ? 'success' : 'muted';
    const text = hasDesc ? 'Descrição Detectada' : 'Sem Descrição em Texto';

    el.innerHTML = `
        <div class="ana-card" style="padding: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-weight:600; font-size:1rem;">Descrição em Texto</span>
                <span class="status-badge ${badgeClass}">${text}</span>
            </div>
        </div>
    `;
}

function processarAtributos(fichaTecnica, titulo, usedFallback = false, containerId = "fichaTecnicaTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;

    let contentHtml = '';

    if (!Array.isArray(fichaTecnica) || fichaTecnica.length === 0) {
        contentHtml = '<p class="text-small">Nenhuma ficha técnica disponível.</p>';
    } else {
        const pTit = getPalavrasUnicas(titulo);
        const validAttrs = fichaTecnica.filter(a => typeof a === 'object' && a && a.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id));

        if (validAttrs.length === 0) {
            contentHtml = '<p class="text-small">Nenhum atributo válido para análise.</p>';
        } else {
            const pPorAttr = new Map();
            validAttrs.forEach(a => pPorAttr.set(a.id, getPalavrasUnicas(a.value_name)));

            contentHtml = '<div style="display:flex; flex-direction:column; gap:12px;">';

            validAttrs.forEach(attr => {
                const nome = attr.name || attr.id, valor = attr.value_name.trim(), vLow = valor.toLowerCase(), len = valor.length;
                const ignorarPenalidades = deveIgnorarAtributoPorNome(nome);
                let cor = definirCorPorQuantidadeCaracteres(len, attr.id, valor);
                let reptTxt = '', tamTxt = '', temRept = false;

                // Lógica de penalidades (mantida)
                if (ignorarPenalidades) {
                    if (len > 0) cor = 'inherit';
                } else {
                    if (len > TAMANHO_IDEAL_ATRIBUTO && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                        tamTxt = `<span class="status-badge muted" title="Pode ser considerado longo">Longo</span>`;
                        if (cor === 'green') cor = 'gray';
                    }
                    if (!ATRIBUTOS_IGNORADOS_REPETICAO.has(attr.id) && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                        const pAtuais = pPorAttr.get(attr.id);
                        const reptTit = encontrarIntersecao(pAtuais, pTit);
                        if (reptTit.length > 0) {
                            reptTxt += `<span class="status-badge error" title="Repete título: ${reptTit.join(', ')}">Repetição</span>`;
                            temRept = true;
                        }
                        // Verifica repetição com outros atributos... (Simplificado para UX)
                        let reptOutros = new Set();
                        pPorAttr.forEach((pOutro, outroId) => {
                            const oAttr = validAttrs.find(a => a.id === outroId);
                            if (oAttr && attr.id !== outroId && !ATRIBUTOS_IGNORADOS_REPETICAO.has(outroId)) {
                                const oValLow = oAttr.value_name?.trim().toLowerCase();
                                if (oValLow && !VALORES_IGNORADOS_PENALIDADE.has(oValLow)) encontrarIntersecao(pAtuais, pOutro).forEach(p => reptOutros.add(p));
                            }
                        });
                        if (reptOutros.size > 0) {
                            reptTxt += `<span class="status-badge error" title="Repete outros campos: ${Array.from(reptOutros).join(', ')}">Repetição Interna</span>`;
                            temRept = true;
                        }
                    }
                    if (temRept) cor = 'red';
                }

                const styleColor = cor === 'green' ? 'var(--ana-success)' : (cor === 'red' ? 'var(--ana-danger)' : 'var(--ana-text-main)');

                contentHtml += `
                    <div style="padding-bottom:8px; border-bottom:1px solid #f1f5f9;">
                        <span class="text-label">${nome}</span>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="text-value" style="color:${styleColor};">${valor}</span>
                            <div style="display:flex; gap:5px;">${tamTxt}${reptTxt}</div>
                        </div>
                    </div>`;
            });
            contentHtml += '</div>';
        }
    }

    if (usedFallback) contentHtml += '<p class="text-small" style="margin-top:10px;">ℹ️ Dados parciais (Scraper)</p>';

    el.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">📋</span>
                <span class="ana-card-title">Ficha Técnica</span>
            </div>
            ${contentHtml}
        </div>
    `;
}

function exibirAtributosCategoria(categoryAttributes, adAttributes, containerId = "categoryAttributes") {
    const el = document.getElementById(containerId);
    if (!el) return;

    let contentHtml = '';
    const stringAttributes = Array.isArray(categoryAttributes) ? categoryAttributes.filter(attr => attr.value_type === 'string' && !attr.tags?.read_only) : [];

    if (!Array.isArray(categoryAttributes) || stringAttributes.length === 0) {
        contentHtml = '<p class="text-small">Sem campos adicionais sugeridos para esta categoria.</p>';
    } else {
        const adAttributesMap = new Map(adAttributes.map(attr => [attr.id, attr.value_name]));
        contentHtml = '<ul style="list-style:none; padding:0; margin:0;">';

        stringAttributes.forEach(catAttr => {
            const adValue = adAttributesMap.get(catAttr.id);
            const isFilled = adValue && adValue.trim() !== '';

            const icon = isFilled ? '✅' : '❌';
            const colorClass = isFilled ? 'success' : 'error';
            const textClass = isFilled ? 'text-value' : 'text-small';

            contentHtml += `
                <li style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f5f9;">
                    <span style="font-size:0.9rem;">${catAttr.name}</span>
                    <span class="status-badge ${colorClass}">${isFilled ? 'Preenchido' : 'Faltando'}</span>
                </li>`;
        });
        contentHtml += '</ul>';
    }

    el.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">📂</span>
                <span class="ana-card-title">Campos da Categoria</span>
            </div>
            ${contentHtml}
        </div>
    `;
}

function exibirInformacaoGarantia(detail, containerId = "warrantyInfo") {
    const el = document.getElementById(containerId);
    if (!el) return;
    const temGarantia = detail?.warranty;
    const badgeClass = temGarantia ? 'success' : 'error';
    const text = temGarantia ? 'Garantia Informada' : 'Sem Garantia';

    el.innerHTML = `
        <div class="ana-card" style="padding: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-weight:600; font-size:1rem;">Garantia</span>
                <span class="status-badge ${badgeClass}">${text}</span>
            </div>
        </div>
    `;
}

function verificarTags(tags, usedFallback = false, containerId = "tagsTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;

    let contentHtml = '';
    if (usedFallback) {
        contentHtml = '<p class="text-small">Análise de tags indisponível (Scraper).</p>';
    } else if (!Array.isArray(tags) || tags.length === 0) {
        contentHtml = '<p class="text-small">Nenhuma tag ativa encontrada.</p>';
    } else {
        contentHtml = '<div style="display:flex; flex-wrap:wrap; gap:8px;">';
        tags.forEach(tag => {
            const isAlertTag = TAGS_NEGATIVAS.has(tag);
            const isGoodTag = typeof tag === 'string' && (tag.includes('good_quality') || tag === 'brand_verified');

            let badgeClass = 'muted';
            if (isAlertTag) badgeClass = 'error';
            else if (isGoodTag) badgeClass = 'success';

            const significado = tagSignificados[tag] || null;
            const titleAttr = significado ? `title="${significado}"` : '';

            contentHtml += `<span class="status-badge ${badgeClass}" ${titleAttr} style="cursor:help;">${tag}</span>`;
        });
        contentHtml += '</div>';
    }

    el.innerHTML = `
         <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">🏷️</span>
                <span class="ana-card-title">Tags Ativas</span>
            </div>
            ${contentHtml}
        </div>
    `;
}

function exibirUpTags(tags, containerId = "upTagsTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;
    let html = `<h4 class="section-title-underlined">Tags do Produto (UP)</h4>`;
    if (!Array.isArray(tags) || tags.length === 0) {
        html += `<p class="status-message" style="color: gray;">Nenhuma tag encontrada para este produto.</p>`;
        el.innerHTML = html; return;
    }
    let ulHtml = '<ul>';
    tags.forEach(tag => {
        ulHtml += `<li style="margin-bottom: 4px;"> ℹ️ <strong>${tag}</strong></li>`;
    });
    ulHtml += '</ul>';
    el.innerHTML = html + ulHtml;
}


function exibirPerformance(performanceData, containerId = "performanceTexto") {
    const perfEl = document.getElementById(containerId);
    if (!perfEl) return;

    if (!performanceData || typeof performanceData !== 'object' || Object.keys(performanceData).length === 0) {
        perfEl.innerHTML = `
            <div class="ana-card">
                <div class="ana-card-header"><span class="ana-card-icon">⚡</span><span class="ana-card-title">Qualidade Detalhada</span></div>
                <p class="text-small">Sem detalhes avançados disponíveis.</p>
            </div>`;
        return;
    }

    let bucketsHtml = '';
    if (Array.isArray(performanceData.buckets)) {
        performanceData.buckets.forEach(bucket => {
            if (!bucket || typeof bucket !== 'object') return;

            const bScore = bucket.score !== undefined ? Math.round(bucket.score) : 0;
            const bLevel = bScore >= 75 ? 'good' : (bScore < 50 ? 'bad' : 'neutral');
            const color = bLevel === 'good' ? '#10b981' : (bLevel === 'bad' ? '#ef4444' : '#f59e0b');

            let varsHtml = '';

            // Collect variables
            const vars = Array.isArray(bucket.variables) ? bucket.variables : [];
            vars.forEach(v => {
                const vScore = v.score !== undefined ? Math.round(v.score) : 0;
                const vStatus = v.status || 'UNKNOWN';
                const isError = vStatus === 'ERROR' || vScore < 50;
                const vColor = vStatus === 'COMPLETED' || vScore >= 75 ? '#10b981' : (isError ? '#ef4444' : '#f59e0b');

                let rulesHtml = '';
                if (vStatus !== 'COMPLETED' && Array.isArray(v.rules)) {
                    v.rules.forEach(r => {
                        if (r.wordings?.title) {
                            rulesHtml += `<div class="text-small" style="margin-top:5px; padding-left:10px; border-left:2px solid ${vColor}; color:#64748b;">💡 ${r.wordings.title}</div>`;
                        }
                    });
                }

                varsHtml += `
                    <div style="margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.9rem; color:${vColor}; font-weight:600;">${v.title || v.key}</span>
                            <span class="text-small" style="background:${vColor}20; color:${vColor}; padding:2px 8px; border-radius:10px;">${vStatus}</span>
                        </div>
                        ${rulesHtml}
                    </div>
                `;
            });

            bucketsHtml += `
                <div style="margin-bottom:20px; border:1px solid #e2e8f0; border-radius:8px; padding:15px; border-left:4px solid ${color};">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px dashed #e2e8f0; padding-bottom:10px;">
                        <span style="font-weight:700; color:${color};">${bucket.title || bucket.key}</span>
                        <span style="font-weight:700; font-size:1.1rem; color:${color};">${bScore}%</span>
                    </div>
                    ${varsHtml}
                </div>
            `;
        });
    }

    perfEl.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">⚡</span>
                <span class="ana-card-title">Diagnóstico de Qualidade</span>
            </div>
            <div>
                 <p class="text-small" style="margin-bottom:15px;">
                    <strong>Nível:</strong> ${performanceData.level_wording || 'N/A'} 
                    ${performanceData.mode ? `<span class="status-badge muted">${performanceData.mode}</span>` : ''}
                 </p>
                 ${bucketsHtml}
            </div>
        </div>
    `;
}

function exibirPontuacao(score, usedFallback = false, containerId = "qualityScore") {
    const el = document.getElementById(containerId);
    if (!el) return;
    let level = 'bad';
    if (score >= 75) level = 'good'; else if (score >= 50) level = 'neutral';

    el.innerHTML = `
        <div class="ana-card" style="align-items: center; text-align: center; justify-content: center;">
            <div class="ana-card-header" style="width:100%; justify-content:center; border-bottom:none;">
                <span class="ana-card-title">Qualidade do Anúncio</span>
            </div>
            <div class="circular-progress" data-score-level="${level}" style="--score: 0; width: 100px; height: 100px;">
                <span class="score-text" style="font-size: 2em;">${score}</span>
            </div>
            <div style="margin-top: 15px;">
                <span class="status-badge ${level === 'good' ? 'success' : (level === 'neutral' ? 'muted' : 'error')}">
                    ${level === 'good' ? 'Excelente' : (level === 'neutral' ? 'Regular' : 'Precisa Melhorar')}
                </span>
            </div>
            ${usedFallback ? '<p class="text-small" style="margin-top:10px;">⚠ Estimativa (Dados limitados)</p>' : ''}
        </div>
    `;

    // Animate
    setTimeout(() => {
        const circle = el.querySelector('.circular-progress');
        if (circle) circle.style.setProperty('--score', score);
    }, 100);
}

function appendError(message, containerId = 'resultsContainer') {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    if (containerId === 'resultsContainer') cont.classList.remove('initial-state');
    if (Array.from(cont.querySelectorAll('.error-message')).some(el => el.textContent.includes(message))) return;
    const p = document.createElement('p');
    p.className = 'error-message';
    p.innerHTML = `❌ ${message}`;
    cont.appendChild(p);
}

function clearResults() {
    const resultsContainer = document.getElementById('resultsContainer');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
    }
}


function hideLoading() {
    const el = document.getElementById("loadingIndicator");
    if (el) el.style.display = 'none';
}

// --- Credential Fetching (Funções Atualizadas) ---
async function fetchAccessToken() {
    try {
        const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
        if (!r.ok) {
            const d = await r.text(); // Tenta pegar texto se não for JSON
            throw new Error(`HTTP ${r.status}: ${d}`);
        }
        const d = await r.json();
        if (d?.response?.access_token) {
            console.log("Access Token OK.");
            return d.response.access_token;
        }
        console.warn('Token não encontrado na resposta:', d);
        throw new Error('Token não encontrado na resposta.');
    } catch (e) {
        console.error('Erro ao buscar Access Token:', e.message);
        return null;
    }
}

async function fetchUserIdForScraping() { // Nome da função atualizado
    try {
        const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/get-user-id', {
            method: 'POST' // Assegura que o método é POST se necessário
        });
        if (!r.ok) {
            const d = await r.text();
            throw new Error(`HTTP ${r.status}: ${d}`);
        }
        const d = await r.json();
        // Lógica mais robusta para extrair user_id
        let uId = d?.response?.user_id || d?.user_id || (typeof d === 'string' && d.match(/^\d+x\d+$/) ? d : null);
        if (uId) {
            console.log("User ID OK.");
            return uId;
        }
        console.warn('User ID não encontrado na resposta:', d);
        throw new Error('User ID não encontrado na resposta.');
    } catch (e) {
        console.error('Erro ao buscar User ID:', e.message);
        return null;
    }
}

async function fetchApiData(fullUrl, accessToken) {
    console.log(`Buscando dados de ${fullUrl}...`);
    try {
        const response = await fetch(fullUrl, { headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {} });
        console.log(`Status: ${response.status}`);
        if (!response.ok) {
            let errorMsg = `Erro ${response.status}`;
            try { const errorData = await response.json(); errorMsg += `: ${errorData.message || errorData.error || JSON.stringify(errorData)}`; } catch (e) { /*ignore*/ }
            throw new Error(errorMsg);
        }
        const data = await response.json();
        console.log(`Resposta (parcial):`, JSON.stringify(data).substring(0, 200) + "...");
        return data;
    } catch (error) {
        console.error(`Erro ao buscar ${fullUrl}:`, error);
        return null;
    }
}

async function fetchItemDetails(itemIds, accessToken) {
    const url = `${API_FETCH_ITEM_ENDPOINT}?item_id=${itemIds.join(',')}`;
    return fetchApiData(url, accessToken);
}

async function fetchPerformanceData(itemId, accessToken) { return fetchApiData(`${API_PERFORMANCE_ENDPOINT}?item_id=${itemId}`, accessToken); }
async function fetchCategoryAttributes(categoryId, accessToken) { return fetchApiData(`${API_ATTRIBUTES_ENDPOINT}/${categoryId}`, accessToken); }

function transformMlbuData(mlbuData) {
    if (!mlbuData || typeof mlbuData !== 'object') return null;
    const transformedAttributes = mlbuData.attributes.map(attr => {
        const value = attr.values && attr.values.length > 0 ? attr.values[0] : {};
        return {
            id: attr.id,
            name: attr.name,
            value_name: value.name || null,
            value_type: attr.value_type || 'string'
        };
    });

    return {
        id: mlbuData.id,
        title: mlbuData.name,
        category_id: mlbuData.domain_id.replace('MLB-', ''),
        seller_id: mlbuData.user_id,
        attributes: transformedAttributes,
        tags: mlbuData.tags || [],
        warranty: null,
        pictures: mlbuData.pictures || []
    };
}

async function fetchVisits(itemId, accessToken) {
    // Tenta usar o Core se disponível (mesmo usado pelo visits.js)
    if (window.MarketFacilCore && typeof window.MarketFacilCore.getVisits === 'function') {
        try {
            console.log('Utilizando MarketFacilCore.getVisits...');
            return await window.MarketFacilCore.getVisits(itemId, '30'); // '30' dias como string para garantir compatibilidade
        } catch (e) {
            console.warn('Falha no Core, tentando rota direta...', e);
        }
    }
    // Busca visitas dos últimos 30 dias para cálculo de tendência via rota direta
    return fetchApiData(`${API_VISITS_ENDPOINT}?item_id=${itemId}&days=30`, accessToken);
}

async function fetchReviews(itemId, accessToken) {
    return fetchApiData(`${API_REVIEWS_ENDPOINT}/${itemId}`, accessToken);
}

function exibirTendenciaVisitas(visitsData, containerId = "visitsTrend") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!visitsData || !visitsData.results || visitsData.results.length === 0) {
        const motivo = !visitsData ? "Erro ao carregar dados." : "Sem visitas no período.";
        el.innerHTML = `
            <div class="ana-card">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📊</span>
                    <span class="ana-card-title">Visitas (30 dias)</span>
                </div>
                <p class="text-small" style="color: var(--ana-text-muted);">${motivo}</p>
            </div>`;
        return;
    }

    const results = visitsData.results;
    results.sort((a, b) => new Date(a.date) - new Date(b.date));
    const midPoint = Math.floor(results.length / 2);
    const firstHalf = results.slice(0, midPoint);
    const secondHalf = results.slice(midPoint);
    const sumVisits = (arr) => arr.reduce((acc, curr) => acc + curr.total, 0);
    const totalFirst = sumVisits(firstHalf);
    const totalSecond = sumVisits(secondHalf);
    const totalVisits = totalFirst + totalSecond;

    let trend = 'Estável';
    let icon = '➡️';
    let colorClass = 'muted';
    let percentChange = 0;

    if (totalFirst === 0) {
        percentChange = totalSecond > 0 ? 100 : 0;
    } else {
        percentChange = ((totalSecond - totalFirst) / totalFirst) * 100;
    }

    if (percentChange > 5) { trend = 'Subindo'; icon = '📈'; colorClass = 'success'; }
    else if (percentChange < -5) { trend = 'Caindo'; icon = '📉'; colorClass = 'error'; }

    const lowDataWarning = totalVisits < 10 ? '<div class="margin-top:8px;"><span class="status-badge muted">⚠️ Poucos dados</span></div>' : '';

    el.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">📊</span>
                <span class="ana-card-title">Tendência Visitas</span>
            </div>
            <div style="display: flex; gap: 15px; align-items: center;">
                <div class="trend-indicator">
                    <span class="trend-icon">${icon}</span>
                    <span class="trend-text ${colorClass}">${trend}</span>
                    <span class="text-small" style="margin-top:2px;">${percentChange === 100 && totalFirst === 0 ? 'Novo' : percentChange.toFixed(1) + '%'}</span>
                </div>
                <div class="trend-stats" style="flex-grow:1;">
                    <div class="trend-row"><span class="text-small">Total (30d)</span> <span class="text-value">${totalVisits}</span></div>
                    <div class="trend-row"><span class="text-small">1ª Quinzena</span> <span class="text-value">${totalFirst}</span></div>
                    <div class="trend-row"><span class="text-small">2ª Quinzena</span> <span class="text-value">${totalSecond}</span></div>
                </div>
            </div>
            ${lowDataWarning}
        </div>
    `;
}

function exibirAvaliacoes(reviewsData, containerId = "reviewsContainer") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!reviewsData || !reviewsData.paging || reviewsData.paging.total === 0) {
        el.innerHTML = `
            <div class="ana-card">
                <div class="ana-card-header"><span class="ana-card-icon">⭐</span><span class="ana-card-title">Avaliações</span></div>
                <p class="text-small">Nenhuma avaliação encontrada.</p>
            </div>`;
        return;
    }

    const average = reviewsData.rating_average || 0;
    const total = reviewsData.paging.total || 0;
    const reviews = reviewsData.reviews || [];

    const starsHtml = (score) => {
        let s = '';
        for (let i = 1; i <= 5; i++) s += i <= Math.round(score) ? '★' : '☆';
        return `<span class="review-stars">${s}</span>`;
    };

    let html = `
        <div class="ana-card">
            <div class="ana-card-header"><span class="ana-card-icon">⭐</span><span class="ana-card-title">Avaliações</span></div>
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 20px;">
                <span class="review-score-big">${average.toFixed(1)}</span>
                <div style="display: flex; flex-direction: column;">
                    ${starsHtml(average)}
                    <span class="text-small">${total} opiniões</span>
                </div>
            </div>
            <div class="reviews-list" style="max-height: 250px; overflow-y: auto;">
    `;

    if (reviews.length === 0) {
        html += '<p class="text-small">Sem comentários recentes.</p>';
    } else {
        reviews.slice(0, 5).forEach(rev => {
            html += `
                <div class="review-item">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        ${starsHtml(rev.rate)}
                        <span class="text-small">${new Date(rev.date_created).toLocaleDateString()}</span>
                    </div>
                    <p class="text-small" style="color: var(--ana-text-main); font-style: italic;">"${rev.content || 'Sem comentário'}"</p>
                </div>
            `;
        });
    }

    html += '</div></div>';
    el.innerHTML = html;
}

async function analisarAnuncio(itemIdToAnalyze = null, append = false) {
    const loader = document.getElementById('loadingIndicator');

    try {
        if (loader) {
            loader.querySelector('span').textContent = 'Analisando, por favor aguarde... ⏳';
            loader.style.display = 'flex';
        }

        if (!append) {
            clearResults();
        }

        const inputVal = document.getElementById('input-url').value.trim();
        const itemId = itemIdToAnalyze || normalizeMlbId(inputVal);

        if (!itemId) {
            appendError('ID ou link inválido. Formato: MLB/MLBU123456789 ou link.');
            return;
        }

        console.log(`--- Iniciando Análise: ${itemId} ---`);
        let accessToken, userId, detail = null, fetchError = null, usedFallback = false, performanceData = null, visitsData = null, reviewsData = null, descriptionData = null, categoryAttributes = null;

        try {
            [accessToken, userId] = await Promise.all([fetchAccessToken(), fetchUserIdForScraping()]);
            if (!accessToken) console.warn('Access Token indisponível.');
            if (!userId) console.warn('User ID indisponível.');
        } catch (e) {
            console.error("Erro ao buscar credenciais:", e);
            fetchError = new Error('Falha crítica ao obter credenciais da aplicação.');
        }

        let isMlbu = itemId.startsWith('MLBU');

        if (accessToken && !fetchError) {
            try {
                if (isMlbu) {
                    const mlbuData = await fetchApiData(`${API_USER_PRODUCTS_ENDPOINT}/${itemId}`, accessToken);
                    if (mlbuData?.id) {
                        detail = transformMlbuData(mlbuData);
                        console.log('Dados do Produto (MLBU) OK.');

                        const itemsData = await fetchApiData(`${API_USER_PRODUCTS_ENDPOINT}/${itemId}/items?seller_id=${detail.seller_id}`, accessToken);
                        if (itemsData?.results?.length > 0) {
                            if (loader) loader.querySelector('span').textContent = 'Buscando detalhes dos anúncios... ⏳';
                            await displayMlbuResults(detail, itemsData.results, accessToken);
                            return; // Retorna para o finally esconder o loader
                        } else {
                            throw new Error(`Nenhum anúncio (MLB) associado a este produto (MLBU) foi encontrado.`);
                        }
                    } else {
                        throw new Error(`API de Produtos do Usuário: Resposta sem dados válidos.`);
                    }
                } else { // Rota MLB
                    const data = await fetchItemDetails([itemId], accessToken);
                    const itemData = data?.[0];
                    if (itemData?.body?.id) {
                        detail = itemData.body;
                        descriptionData = detail.description;
                        console.log('Dados da API de Itens OK.');
                    } else {
                        throw new Error(`API de Itens: Resposta sem dados válidos ou com erro. Corpo: ${JSON.stringify(itemData)}`);
                    }
                }
            } catch (e) { console.warn(`Erro na API principal: ${e.message}`); fetchError = e; }
        } else if (!fetchError) {
            fetchError = new Error("Para analisar, você precisa conectar sua conta do Mercado Livre na seção 'Minha Conta'.");
            console.log(fetchError.message);
        }

        if (accessToken && detail) {
            const results = await Promise.allSettled([
                fetchPerformanceData(detail.id, accessToken),
                fetchVisits(detail.id, accessToken),
                fetchReviews(detail.id, accessToken)
            ]);
            performanceData = results[0].status === 'fulfilled' ? results[0].value : null;
            visitsData = results[1].status === 'fulfilled' ? results[1].value : null;
            reviewsData = results[2].status === 'fulfilled' ? results[2].value : null;
        }

        if (detail && detail.category_id && accessToken) {
            categoryAttributes = await fetchCategoryAttributes(detail.category_id, accessToken);
        }

        if (detail && typeof detail === 'object') {
            console.log("Processando dados...");
            const containerIdSuffix = append ? `-${detail.id}` : '';
            const containerHtml = `
                <div class="item-analysis-container" id="analysis-container${containerIdSuffix}">
                    <div class="analysis-grid">
                        <!-- Linha 1: Título e Identificação -->
                        <div class="grid-full" id="tituloTexto${containerIdSuffix}"></div>

                        <!-- Linha 2: Métricas Principais (3 colunas) -->
                        <div class="grid-third" id="qualityScore${containerIdSuffix}"></div>
                        <div class="grid-third" id="visitsTrend${containerIdSuffix}"></div>
                        <div class="grid-third" id="reviewsContainer${containerIdSuffix}"></div>

                        <!-- Linha 3: Detalhes Técnicos e Performance -->
                        <div class="grid-half" style="display:flex; flex-direction:column; gap:20px;">
                            <div id="fichaTecnicaTexto${containerIdSuffix}"></div>
                            <div id="categoryAttributes${containerIdSuffix}"></div>
                            <div id="tagsTexto${containerIdSuffix}"></div>
                        </div>
                        <div class="grid-half" style="display:flex; flex-direction:column; gap:20px;">
                             <div id="performanceTexto${containerIdSuffix}"></div>
                             <div id="descricaoIndicator${containerIdSuffix}"></div>
                             <div id="warrantyInfo${containerIdSuffix}"></div>
                        </div>
                    </div>
                </div>
            `;

            if (append) {
                const resultsContainer = document.getElementById('resultsContainer');
                resultsContainer.insertAdjacentHTML('beforeend', containerHtml);
            } else {
                document.getElementById('resultsContainer').innerHTML = containerHtml;
            }

            exibirTitulo(detail.title, `tituloTexto${containerIdSuffix}`);
            exibirDescricaoIndicator(descriptionData, `descricaoIndicator${containerIdSuffix}`);
            processarAtributos(detail.attributes, detail.title, usedFallback, `fichaTecnicaTexto${containerIdSuffix}`);
            exibirAtributosCategoria(categoryAttributes, detail.attributes, `categoryAttributes${containerIdSuffix}`);
            exibirInformacaoGarantia(detail, `warrantyInfo${containerIdSuffix}`);
            verificarTags(detail.tags, usedFallback, `tagsTexto${containerIdSuffix}`);
            exibirPerformance(performanceData, `performanceTexto${containerIdSuffix}`);
            exibirTendenciaVisitas(visitsData, `visitsTrend${containerIdSuffix}`);
            exibirAvaliacoes(reviewsData, `reviewsContainer${containerIdSuffix}`);
            exibirPontuacao(calcularPontuacaoQualidade(detail, descriptionData, usedFallback), usedFallback, `qualityScore${containerIdSuffix}`);
            console.log("--- Análise Concluída ---");
        }

        if (!detail) {
            const finalMsg = fetchError ? fetchError.message : "Não foi possível obter ou processar dados do anúncio.";
            console.error("Erro Final da Análise:", finalMsg);
            if (!append) {
                clearResults();
            }
            appendError(`Falha na análise: ${finalMsg}`);
        }

    } catch (e) {
        console.error("Erro geral na função analisarAnuncio:", e);
        appendError(`Ocorreu um erro inesperado: ${e.message}`);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

async function displayMlbuResults(mlbuDetail, mlbItems, accessToken) {
    const resultsContainer = document.getElementById('resultsContainer');

    // Create Grid Container
    resultsContainer.innerHTML = `
        <div class="analysis-grid">
            <div class="grid-full" id="mlbuHeader"></div>
            <div class="grid-full" id="mlbuItemsList"></div>
        </div>
    `;

    // Header Card (Product Info + Tags)
    const headerEl = document.getElementById("mlbuHeader");
    let tagsHtml = '';
    if (mlbuDetail.tags && mlbuDetail.tags.length > 0) {
        tagsHtml = '<div style="margin-top:10px; display:flex; gap:5px; flex-wrap:wrap;">';
        mlbuDetail.tags.forEach(t => tagsHtml += `<span class="status-badge muted">${t}</span>`);
        tagsHtml += '</div>';
    }

    const imgUrl = mlbuDetail.pictures && mlbuDetail.pictures.length > 0 ? mlbuDetail.pictures[0].secure_url : '';

    headerEl.innerHTML = `
        <div class="ana-card" style="flex-direction:row; align-items:center; gap:20px;">
            ${imgUrl ? `<img src="${imgUrl}" alt="${mlbuDetail.title}" style="width:100px; height:100px; object-fit:contain; border-radius:8px; border:1px solid #e2e8f0;">` : ''}
            <div>
                <span class="status-badge success" style="margin-bottom:5px;">Produto de Usuário (MLBU)</span>
                <h3 style="font-size:1.5rem; font-weight:700; color:var(--ana-text-main); line-height:1.2;">${mlbuDetail.title}</h3>
                ${tagsHtml}
            </div>
        </div>
    `;

    // Items List
    const listEl = document.getElementById('mlbuItemsList');
    listEl.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">📦</span>
                <span class="ana-card-title">Anúncios (Itens) Vinculados</span>
            </div>
            <div id="itemsContainer" style="display:flex; flex-direction:column; gap:10px;">
                <p class="text-small" style="margin-bottom:10px;">Selecione um anúncio abaixo para ver a análise detalhada:</p>
            </div>
        </div>
    `;
    const itemsInnerContainer = listEl.querySelector('#itemsContainer');

    const itemsDetails = await fetchItemDetails(mlbItems, accessToken);

    if (itemsDetails && itemsDetails.length > 0) {
        itemsDetails.forEach(itemResp => {
            if (itemResp.code === 200 && itemResp.body) {
                const item = itemResp.body;
                const listingType = item.listing_type_id === 'gold_special' ? 'Clássico' : (item.listing_type_id === 'gold_pro' ? 'Premium' : item.listing_type_id);
                const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.price);

                const btn = document.createElement('div');
                btn.className = 'item-list-btn';
                btn.onclick = () => handleAnalysisClick(item.id, true);
                btn.innerHTML = `
                    <img src="${item.thumbnail}" class="item-list-img" alt="Thumb">
                    <div style="flex-grow:1;">
                        <span class="text-value" style="font-size:0.95rem;">${item.title}</span>
                        <div style="display:flex; gap:10px; margin-top:4px;">
                            <span class="status-badge muted" style="font-size:0.75rem;">${listingType}</span>
                            <span class="text-label" style="color:var(--ana-success);">${price}</span>
                        </div>
                    </div>
                    <span style="color:var(--ana-primary);">Analisar ➔</span>
                `;
                itemsInnerContainer.appendChild(btn);
            }
        });
    } else {
        itemsInnerContainer.innerHTML += '<p class="text-small error-message">Nenhum anúncio (MLB) encontrado para este produto ou falha ao buscar detalhes.</p>';
    }
}

function handleAnalysisClick(itemId = null, append = false) {
    analisarAnuncio(itemId, append);
}
// Expose to window for Bubble's HTML element scope
window.handleAnalysisClick = handleAnalysisClick;

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('input-url');
    if (input) {
        input.addEventListener('keypress', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAnalysisClick();
            }
        });
    }
});

function calcularPontuacaoQualidade(detail, descriptionData, usedFallback = false) {
    if (!detail || typeof detail !== 'object') return 0;
    let score = 100;
    const title = detail.title || "", titleLen = title.length, pTit = getPalavrasUnicas(title);

    const isMlbu = detail.id && detail.id.startsWith('MLBU');

    if (isMlbu) {
        // Regra MLBU
        if (titleLen < 40) score += PONTOS_PENALIDADE_TITULO_CURTO; // < 40 muito ruim
        else if (titleLen < 50) score += PONTOS_PENALIDADE_TITULO_MEDIO; // 40-49 médio
        // >= 50 OK, sem penalidade por ser longo
    } else {
        // Regra MLB
        if (titleLen < MIN_CHARS_TITULO_RUIM) score += PONTOS_PENALIDADE_TITULO_CURTO;
        else if (titleLen < MIN_CHARS_TITULO_BOM) score += PONTOS_PENALIDADE_TITULO_MEDIO;
    }

    // Penalidade se for muito grande mesmo para MLBU? O usuário disse que >60 ok.
    // Vamos manter sem penalidade extra para MLBU longo por enquanto, conforme pedido.

    if (descriptionData?.plain_text?.trim() !== "") score += PONTOS_BONUS_DESCRICAO;

    if (Array.isArray(detail.attributes) && detail.attributes.length > 0) {
        let validCount = 0;
        const validAttrs = detail.attributes.filter(a => typeof a === 'object' && a && a.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id));
        const pPorAttr = new Map(); validAttrs.forEach(a => pPorAttr.set(a.id, getPalavrasUnicas(a.value_name)));
        validAttrs.forEach(attr => {
            validCount++;
            const nome = attr.name || attr.id;
            const val = attr.value_name.trim(), vLow = val.toLowerCase(), len = val.length, pAtuais = pPorAttr.get(attr.id);
            const ignorarPenalidades = deveIgnorarAtributoPorNome(nome);

            if (!ignorarPenalidades) {
                if (!VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                    const diff = Math.abs(len - TAMANHO_IDEAL_ATRIBUTO);
                    if (attr.id !== 'BRAND' || len > TAMANHO_IDEAL_ATRIBUTO) {
                        score += Math.floor(diff / 10) * PONTOS_PENALIDADE_POR_10_CHARS_DIF_ATR;
                    }
                }
                if (!ATRIBUTOS_IGNORADOS_REPETICAO.has(attr.id) && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                    score += encontrarIntersecao(pAtuais, pTit).length * PONTOS_PENALIDADE_POR_PALAVRA_REPETIDA;
                    let reptOutros = new Set();
                    pPorAttr.forEach((pO, oId) => {
                        const oA = validAttrs.find(a => a.id === oId);
                        if (oA && attr.id !== oId && !ATRIBUTOS_IGNORADOS_REPETICAO.has(oId)) {
                            const oVL = oA.value_name?.trim().toLowerCase();
                            if (oVL && !VALORES_IGNORADOS_PENALIDADE.has(oVL))
                                encontrarIntersecao(pAtuais, pO).forEach(p => reptOutros.add(p));
                        }
                    });
                    score += reptOutros.size * PONTOS_PENALIDADE_POR_PALAVRA_REPETIDA;
                }
            }
        });
        if (validCount === 0) score += PONTOS_PENALIDADE_SEM_ATRIBUTOS;
    } else score += PONTOS_PENALIDADE_SEM_ATRIBUTOS * 1.5;

    if (!usedFallback && Array.isArray(detail.tags)) {
        if (detail.tags.includes('moderation_penalty')) score += PONTOS_PENALIDADE_MODERATION_PENALTY;
        if (detail.tags.includes('incomplete_technical_specs')) score -= 15;
        const algumaTagNegativaPresente = detail.tags.some(tagAnuncio => TAGS_NEGATIVAS.has(tagAnuncio));
        if (algumaTagNegativaPresente) {
            if (!detail.tags.includes('moderation_penalty') && !detail.tags.includes('incomplete_technical_specs')) {
                score -= 10;
            }
        }
    }
    return Math.max(0, Math.min(Math.round(score), 100));
}
