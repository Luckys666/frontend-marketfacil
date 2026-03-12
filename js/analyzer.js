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
const API_VISITS_ENDPOINT = `${BASE_URL_PROXY}/api/fetch-visits`; // Rota no backend para visitas
const API_REVIEWS_ENDPOINT = `${BASE_URL_PROXY}/api/fetch-reviews`; // Rota no backend para reviews

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

const API_ANALYZE_IMAGE_ENDPOINT = `${BASE_URL_PROXY}/api/analyze-image`;

window.ignoredAttributesGlobally = new Set();
window.currentAnalysisState = null;

window.toggleIgnoreAttribute = function (attrId) {
    if (window.ignoredAttributesGlobally.has(attrId)) {
        window.ignoredAttributesGlobally.delete(attrId);
    } else {
        window.ignoredAttributesGlobally.add(attrId);
    }
    reRenderAnalysisView();
};

function reRenderAnalysisView() {
    if (!window.currentAnalysisState) return;
    const { detail, descriptionData, usedFallback, containerIdSuffix, categoryAttributes, visitsData, reviewsData } = window.currentAnalysisState;

    // Update dependent components
    processarAtributos(detail.attributes, detail.title, usedFallback, `fichaTecnicaTexto${containerIdSuffix}`);
    exibirAtributosCategoria(categoryAttributes, detail.attributes, `categoryAttributes${containerIdSuffix}`);

    // Re-render score WITH analysisData so improvements panel persists
    const analysisData = { title: detail.title, detail, descriptionData, categoryAttributes, visitsData, reviewsData };
    exibirPontuacao(calcularPontuacaoQualidade(detail, descriptionData, usedFallback), usedFallback, `qualityScore${containerIdSuffix}`, analysisData);
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

    // Configura ranges baseados em MLBU ou MLB
    const idealMin = isMlbu ? 50 : MIN_CHARS_TITULO_BOM;
    const idealMax = isMlbu ? 999 : MAX_CHARS_TITULO_BOM; // MLBU sem limite max

    let state = 'bad';
    let progressPercent = 0;

    if (len >= idealMin && (isMlbu || len <= idealMax)) {
        state = 'good';
        progressPercent = 100;
    } else if (len >= 40) { // Regra genérica de aceitável
        state = 'neutral';
        progressPercent = 70;
    } else {
        progressPercent = Math.max(10, (len / 60) * 100);
    }

    const badgeClass = state;
    const badgeText = state === 'good' ? 'Excelente' : (state === 'neutral' ? 'Aceitável' : 'Muito Curto');

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.1s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📝</span>
                <span class="ana-card-title">Análise do Título</span>
                <span class="status-badge ${badgeClass}" style="margin-left:auto;">${badgeText}</span>
            </div>
            
            <div style="margin-bottom: 20px;">
                <p class="title-display">${titulo || 'Nenhum título encontrado'}</p>
                <div class="char-counter-bar">
                    <div class="char-progress ${state}" style="width: ${progressPercent}%"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:5px;">
                     <span class="text-small">${len} caracteres</span>
                     <span class="text-small">Meta: ${idealMin}+</span>
                </div>
            </div>

            ${state !== 'good' ? `
            <div class="info-box" style="margin-bottom:0; background:#fff7ed; border-color:#fed7aa; color:#9a3412;">
                 <p><strong>Dica:</strong> Títulos detalhados entre ${idealMin} e ${idealMax || 60} caracteres ajudam na busca do Mercado Livre.</p>
            </div>
            ` : ''}
        </div>
    `;

    // Animate progress bar width after render
    setTimeout(() => {
        const bar = el.querySelector('.char-progress');
        if (bar) bar.style.width = `${Math.min(100, (len / 60) * 100)}%`;
    }, 300);
}

function exibirDescricaoIndicator(descriptionData, containerId = "descricaoIndicator") {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hasDesc = descriptionData?.plain_text?.trim() !== "";
    const badgeClass = hasDesc ? 'success' : 'error';
    const icon = hasDesc ? '✅' : '❌';
    const text = hasDesc ? 'Detectada' : 'Sem Texto';

    el.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background:#fff; border:1px solid #e2e8f0; border-radius:12px;">
            <span style="font-weight:600; font-size:0.9rem;"><span style="margin-right:6px;">📝</span> Descrição</span>
            <span class="status-badge ${badgeClass}">${icon} ${text}</span>
        </div>
    `;
}

function processarAtributos(fichaTecnica, titulo, usedFallback = false, containerId = "fichaTecnicaTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!Array.isArray(fichaTecnica) || fichaTecnica.length === 0) {
        el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.2s;">
            <div class="ana-card-header"><span class="ana-card-icon">📋</span><span class="ana-card-title">Ficha Técnica</span></div>
            <p class="text-small">Nenhuma ficha técnica disponível.</p>
        </div>`;
        return;
    }

    const pTit = getPalavrasUnicas(titulo);
    const validAttrs = fichaTecnica.filter(a => typeof a === 'object' && a && a.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id));

    const problemAttrs = [];
    const okAttrs = [];

    const pPorAttr = new Map();
    validAttrs.forEach(a => pPorAttr.set(a.id, getPalavrasUnicas(a.value_name)));

    validAttrs.forEach(attr => {
        const nome = attr.name || attr.id;
        const valor = attr.value_name.trim();
        const vLow = valor.toLowerCase();
        const len = valor.length;
        const ignorarPenalidades = deveIgnorarAtributoPorNome(nome);

        let issues = [];

        if (!ignorarPenalidades) {
            // Check Length
            if (!VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                if (len > TAMANHO_IDEAL_ATRIBUTO) {
                    issues.push('Não Indexa (>30)');
                } else if (len < 20 && attr.id !== 'BRAND') {
                    issues.push('Muito Curto (<20)');
                }
            }

            // Check Repetition
            if (!ATRIBUTOS_IGNORADOS_REPETICAO.has(attr.id) && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                const pAtuais = pPorAttr.get(attr.id);
                if (encontrarIntersecao(pAtuais, pTit).length > 0) issues.push('Repete Título');

                // Repetition Internal
                let reptOutros = false;
                pPorAttr.forEach((pOutro, outroId) => {
                    if (attr.id !== outroId && !ATRIBUTOS_IGNORADOS_REPETICAO.has(outroId)) {
                        const otherAttr = validAttrs.find(a => a.id === outroId);
                        if (otherAttr && !VALORES_IGNORADOS_PENALIDADE.has(otherAttr.value_name.toLowerCase())) {
                            if (encontrarIntersecao(pAtuais, pOutro).length > 0) reptOutros = true;
                        }
                    }
                });
                if (reptOutros) issues.push('Valor Duplicado');
            }
        }

        if (issues.length > 0) {
            problemAttrs.push({ id: attr.id, name: nome, value: valor, issues });
        } else {
            okAttrs.push({ id: attr.id, name: nome, value: valor });
        }
    });

    const renderList = (list, isProblem) => {
        if (list.length === 0) return '';
        return list.map(item => `
            <div class="attribute-item ${isProblem ? 'problem' : ''}" style="min-width:0; ${window.ignoredAttributesGlobally.has(item.id) ? 'opacity: 0.5; filter: grayscale(1);' : ''}">
                <div style="flex-grow: 1; min-width:0; overflow:hidden;">
                    <span class="text-label" style="margin-bottom:2px;">${item.name}</span>
                    <span class="text-value" style="word-break:break-word; ${window.ignoredAttributesGlobally.has(item.id) ? 'text-decoration: line-through;' : ''}">${item.value}</span>
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                    ${isProblem && !window.ignoredAttributesGlobally.has(item.id) ? `<div class="status-badge error" style="font-size:0.7rem; flex-shrink:0; white-space:nowrap;">${item.issues.join(', ')}</div>` : (!window.ignoredAttributesGlobally.has(item.id) ? '<span style="color:#10b981; font-weight:bold; flex-shrink:0;">✔ OK</span>' : '<span style="color:gray; font-size:0.8rem; flex-shrink:0;">Ignorado</span>')}
                    <button onclick="window.toggleIgnoreAttribute('${item.id}')" title="${window.ignoredAttributesGlobally.has(item.id) ? 'Incluir na pontuação' : 'Desconsiderar da pontuação'}" class="btn-ignore-clean ${window.ignoredAttributesGlobally.has(item.id) ? 'ignored' : ''}">
                        ${window.ignoredAttributesGlobally.has(item.id) ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`}
                    </button>
                </div>
            </div>
        `).join('');
    };

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.2s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📋</span>
                <span class="ana-card-title">Ficha Técnica</span>
                <span class="text-small" style="margin-left:auto; color:var(--ana-text-muted);">${problemAttrs.length + okAttrs.length} atributos</span>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                <div>
                    <div class="specs-group-title problem" style="margin-bottom:8px;">⚠️ Atenção (${problemAttrs.length})</div>
                    ${problemAttrs.length > 0 ? renderList(problemAttrs, true) : '<p class="text-small" style="color:#10b981;">Nenhum problema encontrado 🎉</p>'}
                </div>
                <div>
                    <div class="specs-group-title valid" style="margin-bottom:8px;">✅ Tudo Certo (${okAttrs.length})</div>
                    ${okAttrs.length > 0 ? renderList(okAttrs, false) : '<p class="text-small">Nenhum atributo validado.</p>'}
                </div>
            </div>
            ${usedFallback ? '<p class="text-small" style="margin-top:10px;">ℹ️ Dados via Scraper (Parcial)</p>' : ''}
        </div>
    `;
}

function exibirAtributosCategoria(categoryAttributes, adAttributes, containerId = "categoryAttributes") {
    const el = document.getElementById(containerId);
    if (!el) return;

    let contentHtml = '';
    const stringAttributes = Array.isArray(categoryAttributes) ? categoryAttributes.filter(attr => attr.value_type === 'string' && !attr.tags?.read_only) : [];

    if (!Array.isArray(categoryAttributes) || stringAttributes.length === 0) {
        // Hide completely if no relevant attributes to show, or show message
        contentHtml = '<p class="text-small">Sem campos adicionais sugeridos para esta categoria.</p>';
    } else {
        const adAttributesMap = new Map(adAttributes.map(attr => [attr.id, attr.value_name]));

        // Sort: Faltando first
        stringAttributes.sort((a, b) => {
            const valA = adAttributesMap.get(a.id);
            const valB = adAttributesMap.get(b.id);
            const filledA = valA && valA.trim() !== '';
            const filledB = valB && valB.trim() !== '';
            return filledA === filledB ? 0 : (filledA ? 1 : -1);
        });

        const missingAttrs = [];
        const filledAttrs = [];
        stringAttributes.forEach(catAttr => {
            const adValue = adAttributesMap.get(catAttr.id);
            const isFilled = adValue && adValue.trim() !== '';
            if (isFilled) filledAttrs.push({ catAttr, adValue });
            else missingAttrs.push({ catAttr, adValue });
        });

        const renderCatItem = (catAttr, adValue, isFilled) => `
             <div class="attribute-item" style="min-width:0; ${!isFilled ? 'background:#fff1f2; border-color:#fda4af;' : 'background:#f0fdf4; border-color:#bbf7d0;'} ${window.ignoredAttributesGlobally.has(catAttr.id) ? 'opacity: 0.5; filter: grayscale(1);' : ''}">
                <div style="flex-grow: 1; min-width:0; overflow:hidden;">
                    <span class="text-label" style="margin-bottom:2px;">${catAttr.name}</span>
                    ${isFilled ? `<span class="text-value" style="word-break:break-word; ${window.ignoredAttributesGlobally.has(catAttr.id) ? 'text-decoration: line-through;' : ''}">${adValue}</span>` : '<span class="text-small" style="color:#ef4444;">Não preenchido</span>'}
                </div>
                <div style="display:flex; align-items:center; gap: 8px; flex-shrink:0;">
                    ${isFilled && !window.ignoredAttributesGlobally.has(catAttr.id) ? '<span style="color:#10b981; font-weight:bold;">✔</span>' : (!window.ignoredAttributesGlobally.has(catAttr.id) ? '<span class="status-badge error" style="flex-shrink:0;">Faltando</span>' : '<span style="color:gray; font-size:0.8rem;">Ignorado</span>')}
                    <button onclick="window.toggleIgnoreAttribute('${catAttr.id}')" title="${window.ignoredAttributesGlobally.has(catAttr.id) ? 'Incluir na pontuação' : 'Desconsiderar da pontuação'}" class="btn-ignore-clean ${window.ignoredAttributesGlobally.has(catAttr.id) ? 'ignored' : ''}">
                        ${window.ignoredAttributesGlobally.has(catAttr.id) ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`}
                    </button>
                </div>
            </div>`;

        // Build 2-column layout
        const missingHtml = missingAttrs.length > 0
            ? missingAttrs.map(({ catAttr, adValue }) => renderCatItem(catAttr, adValue, false)).join('')
            : '<p class="text-small" style="color:#10b981;">Todos preenchidos 🎉</p>';
        const filledHtml = filledAttrs.length > 0
            ? filledAttrs.map(({ catAttr, adValue }) => renderCatItem(catAttr, adValue, true)).join('')
            : '<p class="text-small">Nenhum preenchido.</p>';

        contentHtml = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                <div>
                    <div class="specs-group-title problem" style="margin-bottom:8px;">⚠️ Faltando (${missingAttrs.length})</div>
                    ${missingHtml}
                </div>
                <div>
                    <div class="specs-group-title valid" style="margin-bottom:8px;">✅ Preenchidos (${filledAttrs.length})</div>
                    ${filledHtml}
                </div>
            </div>`;
    }

    const totalItems = Array.isArray(categoryAttributes) ? categoryAttributes.filter(a => a.value_type === 'string' && !a.tags?.read_only).length : 0;

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.25s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📂</span>
                <span class="ana-card-title">Campos da Categoria</span>
                <span class="text-small" style="margin-left:auto; color:var(--ana-text-muted);">${totalItems} campos</span>
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
    const icon = temGarantia ? '✅' : '❌';
    const text = temGarantia ? 'Informada' : 'Ausente';

    el.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background:#fff; border:1px solid #e2e8f0; border-radius:12px;">
            <span style="font-weight:600; font-size:0.9rem;"><span style="margin-right:6px;">🛡️</span> Garantia</span>
            <span class="status-badge ${badgeClass}">${icon} ${text}</span>
        </div>
    `;
}

function verificarTags(tags, usedFallback = false, containerId = "tagsTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (usedFallback) {
        el.innerHTML = '<div class="ana-card"><p class="text-small">Análise de tags indisponível (Scraper).</p></div>';
        return;
    }
    if (!Array.isArray(tags) || tags.length === 0) {
        el.innerHTML = '<div class="ana-card"><p class="text-small">Nenhuma tag ativa encontrada.</p></div>';
        return;
    }

    const goodTags = [];
    const alertTags = [];
    const neutralTags = [];

    tags.forEach(tag => {
        const isAlertTag = TAGS_NEGATIVAS.has(tag);
        const isGoodTag = typeof tag === 'string' && (tag.toLowerCase().includes('good_quality') || tag === 'brand_verified');
        const significado = tagSignificados[tag] || null;
        const titleAttr = significado ? `title="${significado}"` : '';
        const badge = `<span class="status-badge ${isAlertTag ? 'error' : (isGoodTag ? 'success' : 'muted')}" ${titleAttr} style="cursor:help; font-size:0.72rem;">${tag}</span>`;
        if (isAlertTag) alertTags.push(badge);
        else if (isGoodTag) goodTags.push(badge);
        else neutralTags.push(badge);
    });

    const renderCol = (title, icon, color, items) => {
        if (items.length === 0) return `<div><div style="font-size:0.78rem; font-weight:700; color:${color}; margin-bottom:8px;">${icon} ${title} (0)</div><div style="padding:12px; text-align:center; background:#f8fafc; border-radius:8px; border:1px dashed #e2e8f0;"><span class="text-small" style="color:#10b981;">✅ Tudo limpo!</span></div></div>`;
        return `
            <div>
                <div style="font-size:0.78rem; font-weight:700; color:${color}; margin-bottom:8px;">${icon} ${title} (${items.length})</div>
                <div style="display:flex; flex-wrap:wrap; gap:5px;">${items.join('')}</div>
            </div>`;
    };

    el.innerHTML = `
         <div class="ana-card">
            <div class="ana-card-header" style="margin-bottom:10px;">
                <span class="ana-card-icon">🏷️</span>
                <span class="ana-card-title">Tags Ativas</span>
                <span class="text-small" style="margin-left:auto; color:var(--ana-text-muted);">${tags.length} tags</span>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:16px;">
                ${renderCol('Boas Práticas', '✅', '#10b981', goodTags)}
                ${renderCol('Atenção', '⚠️', '#ef4444', alertTags)}
                ${renderCol('Neutras', 'ℹ️', '#94a3b8', neutralTags)}
            </div>
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
            <div class="ana-card" style="animation-delay: 0.3s;">
                <div class="ana-card-header"><span class="ana-card-icon">⚡</span><span class="ana-card-title">Qualidade Detalhada</span></div>
                <p class="text-small">Sem detalhes avançados disponíveis.</p>
            </div>`;
        return;
    }

    const buckets = Array.isArray(performanceData.buckets) ? performanceData.buckets.filter(b => b && typeof b === 'object') : [];

    const renderBucket = (bucket) => {
        const bScore = bucket.score !== undefined ? Math.round(bucket.score) : 0;
        const bLevel = bScore >= 75 ? 'good' : (bScore < 50 ? 'bad' : 'neutral');
        const color = bLevel === 'good' ? '#10b981' : (bLevel === 'bad' ? '#ef4444' : '#f59e0b');
        const vars = Array.isArray(bucket.variables) ? bucket.variables : [];
        let varsHtml = '';
        vars.forEach(v => {
            const vStatus = v.status || 'UNKNOWN';
            const vColor = vStatus === 'COMPLETED' ? '#10b981' : (vStatus === 'ERROR' ? '#ef4444' : '#f59e0b');
            const statusMap = { 'COMPLETED': 'Concluído', 'PENDING': 'Pendente', 'ERROR': 'Erro' };
            let rulesHtml = '';
            if (vStatus !== 'COMPLETED' && Array.isArray(v.rules)) {
                v.rules.forEach(r => { if (r.wordings?.title) rulesHtml += `<div class="text-small" style="margin-top:4px; padding-left:8px; border-left:2px solid ${vColor}; color:#64748b;">💡 ${r.wordings.title}</div>`; });
            }
            varsHtml += `<div style="margin-bottom:10px;"><div style="display:flex; justify-content:space-between; align-items:center;"><span style="font-size:0.82rem; color:${vColor}; font-weight:600;">${v.title || v.key}</span><span class="text-small" style="background:${vColor}20; color:${vColor}; padding:2px 6px; border-radius:8px; font-size:0.7rem;">${statusMap[vStatus] || vStatus}</span></div>${rulesHtml}</div>`;
        });
        return `
            <div style="border:1px solid #e2e8f0; border-radius:10px; padding:14px; border-left:4px solid ${color}; background:#fff; flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px dashed #e2e8f0; padding-bottom:8px;">
                    <span style="font-weight:700; color:${color}; font-size:0.88rem;">${bucket.title || bucket.key}</span>
                    <span style="font-weight:700; font-size:1rem; color:${color};">${bScore}%</span>
                </div>
                ${varsHtml}
            </div>`;
    };

    const bucketsHtml = buckets.length > 0
        ? `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:12px;">${buckets.map(renderBucket).join('')}</div>`
        : '<p class="text-small">Sem dados de diagnóstico.</p>';

    perfEl.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.3s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">⚡</span>
                <span class="ana-card-title">Diagnóstico</span>
                <span class="text-small" style="margin-left:auto; color:var(--ana-text-muted);">
                    Nível: ${performanceData.level_wording || 'N/A'}
                </span>
            </div>
            ${bucketsHtml}
        </div>
    `;
}

function exibirPontuacao(score, usedFallback = false, containerId = "qualityScore", analysisData = null) {
    const el = document.getElementById(containerId);
    if (!el) return;

    let level = 'bad';
    if (score >= 75) level = 'good'; else if (score >= 50) level = 'neutral';

    const defs = `
        <defs>
            <linearGradient id="gradientGood" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#34d399;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
            </linearGradient>
        </defs>
    `;
    const strokeDasharray = `${score}, 100`;
    const celebration = score === 100 ? '<div class="celebration-confetti">🎉</div>' : '';

    let xpGainText = '';
    if (score === 100) xpGainText = '🏆 Classe S: Anúncio Impecável!';
    else if (score >= 75) xpGainText = '⭐ Classe A: Quase Perfeito!';
    else if (score >= 50) xpGainText = '📈 Classe B: Tem Potencial';
    else xpGainText = '⛏️ Classe C: Precisa de Trabalho';

    // Build improvement checklist from our analysis
    let improvementsHtml = '';
    if (analysisData) {
        const checks = [];
        const d = analysisData;
        // Title check
        const titleLen = (d.title || '').length;
        if (titleLen < 40) checks.push({ ok: false, text: `Título muito curto (${titleLen} chars)` });
        else if (titleLen < 50) checks.push({ ok: false, text: `Título poderia ser maior (${titleLen}/50+)` });
        else checks.push({ ok: true, text: 'Título otimizado' });
        // Description
        const hasDesc = !!(d.descriptionData?.plain_text?.trim());
        checks.push({ ok: hasDesc, text: hasDesc ? 'Descrição presente' : 'Adicionar descrição em texto' });
        // Warranty
        const hasWarranty = !!d.detail?.warranty;
        checks.push({ ok: hasWarranty, text: hasWarranty ? 'Garantia informada' : 'Informar garantia' });
        // Tags
        const hasBadTags = Array.isArray(d.detail?.tags) && d.detail.tags.some(t => TAGS_NEGATIVAS.has(t));
        checks.push({ ok: !hasBadTags, text: hasBadTags ? 'Tags negativas detectadas' : 'Sem tags negativas' });
        // Attributes (exclude ignored ones)
        const attrs = d.detail?.attributes || [];
        const stringAttrs = attrs.filter(a => a?.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id) && !window.ignoredAttributesGlobally.has(a.id));
        const filledCount = stringAttrs.length;
        if (filledCount === 0) checks.push({ ok: false, text: 'Ficha técnica vazia' });
        else if (filledCount < 3) checks.push({ ok: false, text: `Poucos atributos (${filledCount})` });
        else checks.push({ ok: true, text: `${filledCount} atributos preenchidos` });
        // Category fields
        if (d.categoryAttributes && Array.isArray(d.categoryAttributes)) {
            const catString = d.categoryAttributes.filter(a => a.value_type === 'string' && !a.tags?.read_only);
            const catMap = new Map();
            (d.detail?.attributes || []).forEach(a => { if (a?.value_name) catMap.set(a.id, a.value_name); });
            const missing = catString.filter(c => {
                if (window.ignoredAttributesGlobally.has(c.id)) return false;
                const v = catMap.get(c.id); return !v || v.trim() === '';
            });
            if (missing.length > 0) checks.push({ ok: false, text: `${missing.length} campos da categoria faltando` });
            else checks.push({ ok: true, text: 'Categoria completa' });
        }
        // Visit trend
        if (d.visitsData && d.visitsData.results && !d.visitsData.error) {
            const results = d.visitsData.results || [];
            results.sort((a, b) => new Date(a.date) - new Date(b.date));
            const len = results.length;
            const sumV = arr => arr.reduce((a, c) => a + (c.total || 0), 0);
            const total30 = sumV(results);
            const total7 = sumV(results.slice(Math.max(0, len - 7)));
            const totalPrev7 = sumV(results.slice(Math.max(0, len - 14), Math.max(0, len - 7)));

            if (total30 === 0) {
                checks.push({ ok: false, text: 'Sem visitas nos últimos 30 dias' });
            } else {
                let pct = 0;
                if (totalPrev7 === 0) pct = total7 > 0 ? 100 : 0;
                else pct = ((total7 - totalPrev7) / totalPrev7) * 100;

                if (pct < -5) checks.push({ ok: false, text: `Visitas em queda (${pct.toFixed(0)}%)` });
                else if (pct > 5) checks.push({ ok: true, text: `Visitas subindo (+${pct.toFixed(0)}%)` });
                else checks.push({ ok: true, text: `Visitas estáveis (${total30} no mês)` });
            }
        }
        // Reviews
        if (d.reviewsData && d.reviewsData.paging && d.reviewsData.paging.total > 0) {
            const avg = d.reviewsData.rating_average || 0;
            if (avg >= 4) checks.push({ ok: true, text: `Avaliações: ${avg.toFixed(1)} estrelas` });
            else checks.push({ ok: false, text: `Avaliações abaixo de 4 (${avg.toFixed(1)}⭐)` });
        } else {
            checks.push({ ok: false, text: 'Sem avaliações ainda' });
        }

        const failedChecks = checks.filter(c => !c.ok);
        const passedChecks = checks.filter(c => c.ok);

        improvementsHtml = `
            <div class="ana-card" style="animation-delay: 0.1s;">
                <div class="ana-card-header" style="border-bottom:none;">
                    <span class="ana-card-icon">📝</span>
                    <span class="ana-card-title">O que Melhorar</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    ${failedChecks.map(c => `<div style="display:flex; align-items:center; gap:8px; padding:6px 10px; background:#fff1f2; border-radius:8px; border-left:3px solid #ef4444;"><span style="color:#ef4444; font-weight:bold; flex-shrink:0;">✖</span><span class="text-small" style="color:#991b1b;">${c.text}</span></div>`).join('')}
                    ${passedChecks.map(c => `<div style="display:flex; align-items:center; gap:8px; padding:5px 10px; background:#f0fdf4; border-radius:8px; border-left:3px solid #10b981;"><span style="color:#10b981; font-weight:bold; flex-shrink:0;">✔</span><span class="text-small" style="color:#166534;">${c.text}</span></div>`).join('')}
                </div>
            </div>
        `;
    }

    el.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 2fr; gap:16px; align-items:start;">
            <div class="ana-card" style="align-items: center; text-align: center; justify-content: center; animation-delay: 0s; min-width:180px;">
                <div class="ana-card-header" style="width:100%; justify-content:center; border-bottom:none;">
                    <span class="ana-card-title">Qualidade</span>
                </div>
                <div class="score-container">
                    ${celebration}
                     <div class="score-circle-outer">
                        <svg viewBox="0 0 36 36" class="circular-chart">
                            ${defs}
                            <path class="circle-bg"
                                d="M18 2.0845
                                    a 15.9155 15.9155 0 0 1 0 31.831
                                    a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            <path class="circle ${level}"
                                stroke-dasharray="0, 100"
                                d="M18 2.0845
                                    a 15.9155 15.9155 0 0 1 0 31.831
                                    a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                        </svg>
                        <span class="score-number">${score}</span>
                     </div>
                </div>
                <div style="margin-top: 8px;">
                    <span class="status-badge ${level === 'good' ? 'success' : (level === 'neutral' ? 'muted' : 'error')}" style="font-size:0.72rem;">
                        ${xpGainText}
                    </span>
                </div>
                ${usedFallback ? '<p class="text-small" style="margin-top:8px;">⚠ Estimativa</p>' : ''}
            </div>
            ${improvementsHtml}
        </div>
    `;

    // Animate stroke
    setTimeout(() => {
        const circle = el.querySelector('.circle');
        if (circle) circle.setAttribute('stroke-dasharray', strokeDasharray);
    }, 200);
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
        title: mlbuData.short_name || (mlbuData.name ? mlbuData.name.split(' - ')[0].trim() : ''),
        category_id: mlbuData.domain_id.replace('MLB-', ''),
        seller_id: mlbuData.user_id,
        attributes: transformedAttributes,
        variations: mlbuData.variations || [],
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
    // Busca visitas dos últimos 30 dias para cálculo de tendência via rota direta usando last=30 e unit=day (padrão do backend)
    return fetchApiData(`${API_VISITS_ENDPOINT}?item_id=${itemId}&last=30&unit=day`, accessToken);
}

async function fetchReviews(itemId, accessToken) {
    return fetchApiData(`${API_REVIEWS_ENDPOINT}?item_id=${itemId}`, accessToken);
}

function renderAiImageAnalyzer(detail, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    let picturesHtml = '';

    if (detail.variations && detail.variations.length > 0) {
        // Group variations by each attribute name
        const attrNames = new Set();
        detail.variations.forEach(v => {
            if (v.attribute_combinations) v.attribute_combinations.forEach(a => attrNames.add(a.name));
        });
        const groupOptions = Array.from(attrNames);
        groupOptions.push('Todas'); // always have All option

        // Build variation cards grouped
        const buildVariationCards = (groupName) => {
            let groups = {};
            if (groupName === 'Todas') {
                detail.variations.forEach((v, i) => {
                    const label = v.attribute_combinations ? v.attribute_combinations.map(a => a.value_name).join(' / ') : `Variação ${i + 1}`;
                    if (!groups[label]) groups[label] = { pics: [], variId: v.id };
                    const picIds = v.picture_ids || [];
                    const pics = detail.pictures.filter(p => picIds.includes(p.id));
                    groups[label].pics.push(...pics);
                });
            } else {
                detail.variations.forEach((v, i) => {
                    const attr = v.attribute_combinations?.find(a => a.name === groupName);
                    const key = attr ? attr.value_name : 'Outros';
                    if (!groups[key]) groups[key] = { pics: [], varIds: [] };
                    groups[key].varIds.push(v.id);
                    const picIds = v.picture_ids || [];
                    const uniquePics = detail.pictures.filter(p => picIds.includes(p.id) && !groups[key].pics.some(ep => ep.id === p.id));
                    groups[key].pics.push(...uniquePics);
                });
            }
            let html = '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;">';
            Object.entries(groups).forEach(([label, data]) => {
                if (data.pics.length === 0) return;
                const imgsHtml = data.pics.map(p => `<img src="${p.secure_url}" style="width:40px; height:40px; object-fit:cover; border-radius:5px; border:1px solid #e2e8f0;" alt="Img">`).join('');
                const varId = data.variId || (data.varIds ? data.varIds[0] : 'geral');
                html += `
                <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px; background:#f8fafc; display:flex; flex-direction:column; justify-content:space-between;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-size:0.78rem; font-weight:700; color:var(--ana-text-main);">${label}</span>
                        <span style="font-size:0.68rem; color:var(--ana-text-muted);">${data.pics.length} fotos</span>
                    </div>
                    <div style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;">${imgsHtml}</div>
                    <button class="nerd-button" style="padding:5px 8px; font-size:0.72rem; width:100%; justify-content:center;" onclick="iniciarAnaliseIA('${detail.id}', '${varId}')">
                        🪄 Analisar
                    </button>
                    <div id="aiImageResult_${varId}" style="margin-top:6px; display:none;"></div>
                </div>`;
            });
            html += '</div>';
            return html;
        };

        // Tab buttons
        const tabsId = 'varGroupTabs_' + Date.now();
        const containId = 'varGroupContent_' + Date.now();
        let tabsHtml = `<div id="${tabsId}" style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">`;
        const defaultGroup = groupOptions.length > 1 ? groupOptions[0] : 'Todas';
        groupOptions.forEach((opt, i) => {
            const isActive = opt === defaultGroup;
            tabsHtml += `<button onclick="window._switchVarGroup(this, '${containId}', '${opt.replace(/'/g, "\\'")}')"
                style="padding:5px 14px; font-size:0.75rem; border-radius:20px; border:1px solid ${isActive ? '#3b82f6' : '#e2e8f0'}; background:${isActive ? '#3b82f6' : '#fff'}; color:${isActive ? '#fff' : '#64748b'}; cursor:pointer; transition:all 0.2s; font-weight:${isActive ? '600' : '400'};">${opt}</button>`;
        });
        tabsHtml += '</div>';

        picturesHtml = tabsHtml + `<div id="${containId}">${buildVariationCards(defaultGroup)}</div>`;

        // Store builder function globally for tab switching
        window._varBuilders = window._varBuilders || {};
        window._varBuilders[containId] = buildVariationCards;
        window._switchVarGroup = function (btn, cId, group) {
            document.getElementById(cId).innerHTML = window._varBuilders[cId](group);
            btn.parentElement.querySelectorAll('button').forEach(b => {
                b.style.background = '#fff'; b.style.color = '#64748b'; b.style.borderColor = '#e2e8f0'; b.style.fontWeight = '400';
            });
            btn.style.background = '#3b82f6'; btn.style.color = '#fff'; btn.style.borderColor = '#3b82f6'; btn.style.fontWeight = '600';
        };
    } else if (detail.pictures && detail.pictures.length > 0) {
        picturesHtml = `
            <div style="margin-bottom: 12px; border: 1px solid rgba(226, 232, 240, 0.6); border-radius: 8px; padding: 12px; background: #f8fafc;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-size:0.85rem; font-weight:bold; color:var(--ana-text-main);">Imagens Gerais</span>
                    <button class="nerd-button" style="padding: 6px 12px; font-size: 0.8rem;" onclick="iniciarAnaliseIA('${detail.id}', 'geral')">
                        🪄 Analisar Imagens
                    </button>
                </div>
                <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;">`;
        detail.pictures.forEach(pic => {
            picturesHtml += `<img src="${pic.secure_url}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1; flex-shrink: 0;" alt="Img">`;
        });
        picturesHtml += `</div>
            <div id="aiImageResult_geral" style="margin-top: 10px; display: none;"></div>
            </div>`;
    } else {
        picturesHtml = '<p class="text-small muted">O anúncio não possui imagens para analisar.</p>';
    }

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.15s; position: relative; overflow: hidden; grid-column: 1 / -1;">
            <div style="position: absolute; top: -50px; right: -50px; width: 100px; height: 100px; background: var(--ana-primary-gradient); opacity: 0.1; filter: blur(30px); border-radius: 50%;"></div>
            <div class="ana-card-header" style="margin-bottom: 15px;">
                <span class="ana-card-icon">✨</span>
                <span class="ana-card-title">Analisador de Imagens por IA</span>
                <span class="status-badge success" style="margin-left:auto; background: linear-gradient(135deg, #a855f7, #6366f1); color: white; border: none;">Beta</span>
            </div>
            <p class="text-small" style="margin-bottom:15px; color:var(--ana-text-muted);">As fotos do anúncio são separadas pelas suas variações correspondentes. A IA identificará pontos fortes e melhorias específicas de exposição e quebra de objeções.</p>
            <div>
                ${picturesHtml}
            </div>
        </div>
    `;
}

window.iniciarAnaliseIA = async function (itemId, variationId) {
    const resEl = document.getElementById(`aiImageResult_${variationId}`);
    if (!resEl) return;
    resEl.style.display = 'block';
    resEl.innerHTML = `<p class="text-small" style="color:var(--ana-primary); margin:0;">Processando imagens via IA... ⏳</p>`;
    try {
        const token = window.currentAnalysisState ? window.currentAnalysisState.accessToken : ''; // Optional
        const r = await fetch('${API_ANALYZE_IMAGE_ENDPOINT}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId, variation_id: variationId })
        });
        if (!r.ok) throw new Error('Falha na requisição');
        const data = await r.json();
        resEl.innerHTML = `<div style="background:#f0f9ff; padding: 12px; border-radius: 8px; border-left: 3px solid #3b82f6;"><p class="text-small">${data.analysis || 'Análise concluída com sucesso!'}</p></div>`;
    } catch (e) {
        resEl.innerHTML = `<p class="text-small error-message" style="margin:0;">O Analisador de IA ficará disponível em breve. (${e.message})</p>`;
    }
}

function exibirTendenciaVisitas(visitsData, containerId = "visitsTrend") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!visitsData || visitsData.error) {
        let motivo = "Indisponível no momento.";
        if (visitsData && visitsData.error === 'not_owner') motivo = "Restrito ao vendedor.";
        else if (visitsData && visitsData.error) motivo = "Erro na busca.";

        el.innerHTML = `
            <div class="ana-card" style="animation-delay: 0.1s;">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📊</span>
                    <span class="ana-card-title">Visitas (30 dias)</span>
                </div>
                <p class="text-small" style="color: var(--ana-text-muted); font-style:italic;">${motivo}</p>
            </div>`;
        return;
    }

    const results = visitsData.results || [];
    results.sort((a, b) => new Date(a.date) - new Date(b.date));

    const sumVisits = (arr) => arr.reduce((acc, curr) => acc + (curr.total || 0), 0);

    const len = results.length;
    const last7 = results.slice(Math.max(0, len - 7));
    const prev7 = results.slice(Math.max(0, len - 14), Math.max(0, len - 7));
    const last15 = results.slice(Math.max(0, len - 15));

    const total7 = sumVisits(last7);
    const totalPrev7 = sumVisits(prev7);
    const total15 = sumVisits(last15);
    const total30 = sumVisits(results);

    let percentChange7 = 0;
    if (totalPrev7 === 0) {
        percentChange7 = total7 > 0 ? 100 : 0;
    } else {
        percentChange7 = ((total7 - totalPrev7) / totalPrev7) * 100;
    }

    let trend = 'Estável';
    let icon = '➡️';
    let colorClass = 'muted';

    if (percentChange7 > 5) { trend = 'Subindo'; icon = '📈'; colorClass = 'success'; }
    else if (percentChange7 < -5) { trend = 'Caindo'; icon = '📉'; colorClass = 'error'; }

    let svgChart = '';
    if (results.length > 0 && total30 > 0) {
        const h = 70;
        const w = 260;
        const pad = 5;
        const maxV = Math.max(...results.map(r => r.total || 0), 1);
        const barW = (w - pad * 2) / results.length;
        const lineColor = colorClass === 'success' ? '#10b981' : (colorClass === 'error' ? '#ef4444' : '#3b82f6');
        const hoverColor = colorClass === 'success' ? '#059669' : (colorClass === 'error' ? '#b91c1c' : '#1d4ed8');

        let barsHtml = '';
        results.forEach((r, i) => {
            const barH = ((r.total || 0) / maxV) * (h - pad * 2);
            const x = pad + i * barW;
            const y = pad + (h - pad * 2) - barH;

            // Format date for tooltip
            const dObj = new Date(r.date);
            const dStr = String(dObj.getUTCDate()).padStart(2, '0') + '/' + String(dObj.getUTCMonth() + 1).padStart(2, '0');
            const tooltip = `${dStr}: ${r.total || 0} visitas`;

            barsHtml += `
                <g class="visit-bar-group" style="cursor:crosshair;">
                    <!-- Invisible rect for easier hover detection spanning full height -->
                    <rect x="${x}" y="0" width="${Math.max(barW - 1, 2)}" height="${h}" fill="transparent">
                        <title>${tooltip}</title>
                    </rect>
                    <!-- Actual bar -->
                    <rect x="${x}" y="${y}" width="${Math.max(barW - 1, 2)}" height="${barH}" fill="${lineColor}" rx="2" class="visit-bar-rect" style="transition: fill 0.2s;">
                        <title>${tooltip}</title>
                    </rect>
                </g>
            `;
        });

        svgChart = `
        <style>
            .visit-bar-group:hover .visit-bar-rect { fill: ${hoverColor}; }
        </style>
        <div style="margin-top: 15px; width: 100%; height: 75px; position:relative;">
            <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%; height:100%; overflow:visible;">
                ${barsHtml}
            </svg>
        </div>`;
    }

    const lowDataWarning = total30 < 10 ? '<div style="margin-top:8px;"><span class="status-badge muted" style="font-size:0.7rem;">⚠️ Poucos dados</span></div>' : '';

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.1s;">
            <div class="ana-card-header" style="margin-bottom:10px;">
                <span class="ana-card-icon">📊</span>
                <span class="ana-card-title">Visitas Recentes</span>
            </div>
            <div style="display: flex; gap: 15px; align-items: stretch; justify-content: space-between;">
                <div class="trend-indicator" style="display:flex; flex-direction:column; justify-content:center; align-items:center; min-width:80px; text-align:center;">
                    <span class="trend-icon" style="font-size:1.8rem; line-height:1; margin-bottom:4px;">${icon}</span>
                    <span class="trend-text ${colorClass}" style="font-weight:bold; font-size:1.6rem; line-height:1;">${total30}</span>
                    <span class="text-small" style="text-align:center; color:var(--ana-text-muted); display:block; margin-top:2px;">30 dias</span>
                </div>
                <div class="trend-stats" style="flex-grow:1; display:flex; flex-direction:column; justify-content:center; gap:6px;">
                    <div class="trend-row" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="text-small" style="color:var(--ana-text-muted);">Últimos 7 dias</span> 
                        <span class="text-value" style="font-weight:600;">${total7} <span style="font-size:0.7rem; font-weight:bold; padding:2px 6px; border-radius:4px; margin-left:4px; color:${percentChange7 > 0 ? '#065f46' : (percentChange7 < 0 ? '#991b1b' : '#334155')}; background-color:${percentChange7 > 0 ? '#d1fae5' : (percentChange7 < 0 ? '#fee2e2' : '#e2e8f0')};">${percentChange7 > 0 ? '+' : ''}${percentChange7.toFixed(1)}%</span></span>
                    </div>
                    <div class="trend-row" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="text-small" style="color:var(--ana-text-muted);">Últimos 15 dias</span> 
                        <span class="text-value" style="font-weight:600;">${total15}</span>
                    </div>
                    <div class="trend-row" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="text-small" style="color:var(--ana-text-muted);">Mês (30 dias)</span> 
                        <span class="text-value" style="font-weight:600;">${total30}</span>
                    </div>
                </div>
            </div>
            ${svgChart}
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
        <div class="ana-card" style="animation-delay: 0.1s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">⭐</span>
                <span class="ana-card-title">Avaliações</span>
            </div>
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

        let itemId = itemIdToAnalyze;

        if (!itemId) {
            const inputEl = document.getElementById('input-url');
            if (inputEl) {
                const val = inputEl.value.trim();
                if (val) itemId = normalizeMlbId(val);
            }
        }

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
            console.log(`Checking ownership: UserID=${userId}, SellerID=${detail.seller_id}`);
            // Ensure both are treated as strings for comparison and handle potential undefined
            // FORCED TO TRUE FOR TESTING VISITS ON ANY AD IN BUBBLE
            const isOwner = true;

            if (isOwner) console.log("Usuário É o dono do anúncio. Buscando visitas...");
            else console.log("Usuário NÃO é o dono do anúncio. Visitas restritas.");

            const results = await Promise.allSettled([
                fetchPerformanceData(detail.id, accessToken),
                isOwner ? fetchVisits(detail.id, accessToken) : Promise.resolve({ error: 'not_owner' }),
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
            const containerIdSuffix = append ? Date.now() : '';
            const containerHtml = `
                <div class="item-analysis-container" id="analysis-container${containerIdSuffix}">
                    
                    <!-- TÍTULO (full width) -->
                    <div id="tituloTexto${containerIdSuffix}"></div>

                    <!-- QUALITY SCORE + O QUE MELHORAR (2 columns via function) -->
                    <div id="qualityScore${containerIdSuffix}" style="margin-bottom:20px;"></div>

                    <!-- METRICS ROW (Visits + Reviews) -->
                    <div class="dashboard-metrics-bar">
                        <div id="visitsTrend${containerIdSuffix}" class="metric-card"></div>
                        <div id="reviewsContainer${containerIdSuffix}" class="metric-card"></div>
                    </div>

                    <!-- GARANTIA + DESCRIÇÃO (side by side) -->
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:20px;">
                        <div id="warrantyInfo${containerIdSuffix}"></div>
                        <div id="descricaoIndicator${containerIdSuffix}"></div>
                    </div>

                    <!-- DIAGNÓSTICO (full width, 2 col buckets internally) -->
                    <div id="performanceTexto${containerIdSuffix}" style="margin-bottom:20px;"></div>

                    <!-- AI ANALYZER FULL WIDTH -->
                    <div id="aiImageAnalyzer${containerIdSuffix}" style="margin-bottom: 20px;"></div>

                    <!-- FICHA TÉCNICA (full width, 2 col internally) -->
                    <div id="fichaTecnicaTexto${containerIdSuffix}" style="margin-bottom: 20px;"></div>

                    <!-- CAMPOS DA CATEGORIA (full width, 2 col internally) -->
                    <div id="categoryAttributes${containerIdSuffix}" style="margin-bottom: 20px;"></div>

                    <!-- TAGS (full width, 3 col internally) -->
                    <div id="tagsTexto${containerIdSuffix}" style="margin-bottom: 20px;"></div>

                </div>
            `;

            if (append) {
                const resultsContainer = document.getElementById('resultsContainer');
                resultsContainer.insertAdjacentHTML('beforeend', containerHtml);
            } else {
                document.getElementById('resultsContainer').innerHTML = containerHtml;
            }

            // Store global state for UI toggles
            window.currentAnalysisState = {
                detail, descriptionData, performanceData, visitsData, reviewsData, categoryAttributes, usedFallback, containerIdSuffix
            };

            exibirTitulo(detail.title, isMlbu, `tituloTexto${containerIdSuffix}`);
            exibirDescricaoIndicator(descriptionData, `descricaoIndicator${containerIdSuffix}`);
            processarAtributos(detail.attributes, detail.title, usedFallback, `fichaTecnicaTexto${containerIdSuffix}`);
            exibirAtributosCategoria(categoryAttributes, detail.attributes, `categoryAttributes${containerIdSuffix}`);
            exibirInformacaoGarantia(detail, `warrantyInfo${containerIdSuffix}`);
            verificarTags(detail.tags, usedFallback, `tagsTexto${containerIdSuffix}`);
            exibirPerformance(performanceData, `performanceTexto${containerIdSuffix}`);
            exibirTendenciaVisitas(visitsData, `visitsTrend${containerIdSuffix}`);
            exibirAvaliacoes(reviewsData, `reviewsContainer${containerIdSuffix}`);

            // Pass analysis data for improvements panel (includes visits & reviews)
            const analysisData = { title: detail.title, detail, descriptionData, categoryAttributes, visitsData, reviewsData };
            exibirPontuacao(calcularPontuacaoQualidade(detail, descriptionData, usedFallback), usedFallback, `qualityScore${containerIdSuffix}`, analysisData);

            // Render placeholder for AI feature
            renderAiImageAnalyzer(detail, `aiImageAnalyzer${containerIdSuffix}`);

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
        const validAttrs = detail.attributes.filter(a => typeof a === 'object' && a && a.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id) && !window.ignoredAttributesGlobally.has(a.id));
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

// End of Analyzer Logic
