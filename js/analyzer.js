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

    let cor = 'red';
    let expl = '';

    if (isMlbu) {
        // Regra MLBU: >= 50 é bom. Não tem limite máximo ruim (dentro do razoável).
        if (len >= 50) {
            cor = 'green';
            expl = `[Ideal: Pelo menos 50 caracteres. Títulos longos são aceitos em Produtos de Usuário (User Products).]`;
        } else {
            cor = 'red'; // ou gray/orange dependendo do quão curto
            expl = `[Curto demais: Utilize pelo menos 50 caracteres para melhor indexação.]`;
        }
    } else {
        // Regra MLB Clássica
        expl = `Abaixo de ${MIN_CHARS_TITULO_RUIM} caracteres é ruim.`;
        if (len >= MIN_CHARS_TITULO_BOM && len <= MAX_CHARS_TITULO_BOM) { cor = 'green'; expl = `[Ideal: ${MIN_CHARS_TITULO_BOM}-${MAX_CHARS_TITULO_BOM} caracteres]`; }
        else if (len >= MIN_CHARS_TITULO_RUIM && len < MIN_CHARS_TITULO_BOM) { cor = 'gray'; expl = `[Aceitável: ${MIN_CHARS_TITULO_RUIM}-${MIN_CHARS_TITULO_BOM - 1} caracteres. Ideal: ${MIN_CHARS_TITULO_BOM}-${MAX_CHARS_TITULO_BOM} caracteres]`; }
    }

    el.innerHTML = `<p style="color: ${cor};"><strong>Título:</strong> ${titulo || 'N/A'} (${len} caracteres)<br><small>${expl}</small></p>`;
}

function exibirDescricaoIndicator(descriptionData, containerId = "descricaoIndicator") {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hasDesc = descriptionData?.plain_text?.trim() !== "";
    const cor = hasDesc ? 'green' : 'gray';
    const texto = hasDesc ? 'Sim, possui.' : 'Não possui.';
    const icone = hasDesc ? '✅' : 'ℹ';
    el.innerHTML = `<h4 class="section-title-underlined">Descrição em Texto</h4>
                    <p class="status-message" style="color:${cor};">${icone} ${texto}</p>`;
}

function processarAtributos(fichaTecnica, titulo, usedFallback = false, containerId = "fichaTecnicaTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;
    let html = `<h4 class="section-title-underlined">Análise da Ficha Técnica</h4>`;
    if (!Array.isArray(fichaTecnica) || fichaTecnica.length === 0) { html += '<p>Nenhuma ficha técnica disponível.</p>'; el.innerHTML = html; return; }
    const pTit = getPalavrasUnicas(titulo);
    const validAttrs = fichaTecnica.filter(a => typeof a === 'object' && a && a.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id));
    if (validAttrs.length === 0) { html += '<p>Nenhum atributo válido para análise.</p>'; el.innerHTML = html; return; }
    const pPorAttr = new Map();
    validAttrs.forEach(a => pPorAttr.set(a.id, getPalavrasUnicas(a.value_name)));
    validAttrs.forEach(attr => {
        const nome = attr.name || attr.id, valor = attr.value_name.trim(), vLow = valor.toLowerCase(), len = valor.length;
        const ignorarPenalidades = deveIgnorarAtributoPorNome(nome);

        let cor = definirCorPorQuantidadeCaracteres(len, attr.id, valor);
        let reptTxt = '', tamTxt = '', temRept = false;

        if (ignorarPenalidades) {
            if (len > 0) cor = 'inherit'; // Se ignorado e preenchido, cor neutra
        } else {
            // Lógica original de penalidades
            if (len > TAMANHO_IDEAL_ATRIBUTO && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                tamTxt = ` <span class="length-warning" title="Valores de atributo com mais de ${TAMANHO_IDEAL_ATRIBUTO} caracteres podem ter as palavras excedentes não consideradas para indexação na busca do Mercado Livre, prejudicando a visibilidade do seu anúncio.">⚠ Longo</span>`;
                if (cor === 'green') cor = 'gray';
            }
            if (!ATRIBUTOS_IGNORADOS_REPETICAO.has(attr.id) && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                const pAtuais = pPorAttr.get(attr.id);
                const reptTit = encontrarIntersecao(pAtuais, pTit);
                if (reptTit.length > 0) {
                    reptTxt += ` <span class="repeticao-info" title="Repetir palavras (${reptTit.join(', ')}) ocupa espaço que poderia ser usado para outras palavras-chave relevantes, otimizando a encontrabilidade do seu anúncio.">(Repete Título: ${reptTit.join(', ')})</span>`;
                    temRept = true;
                }
                let reptOutros = new Set();
                pPorAttr.forEach((pOutro, outroId) => {
                    const oAttr = validAttrs.find(a => a.id === outroId);
                    if (oAttr && attr.id !== outroId && !ATRIBUTOS_IGNORADOS_REPETICAO.has(outroId)) {
                        const oValLow = oAttr.value_name?.trim().toLowerCase();
                        if (oValLow && !VALORES_IGNORADOS_PENALIDADE.has(oValLow)) encontrarIntersecao(pAtuais, pOutro).forEach(p => reptOutros.add(p));
                    }
                });
                if (reptOutros.size > 0) {
                    const palavrasRepetidasArray = Array.from(reptOutros);
                    reptTxt += ` <span class="repeticao-info" title="Repetir palavras (${palavrasRepetidasArray.join(', ')}) em diferentes atributos da ficha técnica ocupa espaço valioso. Use sinônimos ou informações complementares.">(Repete Ficha: ${palavrasRepetidasArray.join(', ')})</span>`;
                    temRept = true;
                }
            }
            if (temRept) cor = 'red';
        }

        html += `<p><strong style="color: ${cor};">${nome}:</strong> ${valor} <span style="font-size:0.9em;color:${cor};">(${len} caracteres)</span>${tamTxt}${reptTxt}</p>`;
    });
    if (usedFallback) html += '<p style="font-size:0.9em;color:gray;margin-top:10px;"><i>ℹ️ Análise de terceiros pode incluir atributos não editáveis.</i></p>';
    el.innerHTML = html;
}

function exibirAtributosCategoria(categoryAttributes, adAttributes, containerId = "categoryAttributes") {
    const el = document.getElementById(containerId);
    if (!el) return;
    let html = `<h4 class="section-title-underlined">Campos Indexáveis da Categoria</h4>`;
    if (!Array.isArray(categoryAttributes) || categoryAttributes.length === 0) {
        html += '<p>Não foi possível carregar os atributos para esta categoria.</p>';
        el.innerHTML = html;
        return;
    }

    const stringAttributes = categoryAttributes.filter(attr => attr.value_type === 'string' && !attr.tags?.read_only);
    if (stringAttributes.length === 0) {
        html += '<p>Esta categoria não possui campos de texto adicionais para indexação.</p>';
        el.innerHTML = html;
        return;
    }

    const adAttributesMap = new Map(adAttributes.map(attr => [attr.id, attr.value_name]));
    let ulHtml = '<ul>';
    stringAttributes.forEach(catAttr => {
        const adValue = adAttributesMap.get(catAttr.id);
        const isFilled = adValue && adValue.trim() !== '';
        if (isFilled) {
            ulHtml += `<li class="filled">✅ <strong>${catAttr.name}:</strong> Preenchido <em>(${adValue})</em></li>`;
        } else {
            ulHtml += `<li class="not-filled">❌ <strong>${catAttr.name}:</strong> Não Preenchido</li>`;
        }
    });
    ulHtml += '</ul>';
    el.innerHTML = html + ulHtml;
}

function exibirInformacaoGarantia(detail, containerId = "warrantyInfo") {
    const el = document.getElementById(containerId);
    if (!el) return;
    let html = `<h4 class="section-title-underlined">Informação de Garantia</h4>`;
    const temGarantia = detail?.warranty;
    const cor = temGarantia ? 'green' : 'red';
    const icone = temGarantia ? '✅' : '❌';
    const texto = temGarantia ? 'Sim, garantia preenchida.' : 'Não, garantia não preenchida.';
    html += `<p class="status-message" style="color:${cor};">${icone} ${texto}</p>`;
    el.innerHTML = html;
}

function verificarTags(tags, usedFallback = false, containerId = "tagsTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;
    let html = `<h4 class="section-title-underlined">Tags do Anúncio (Item)</h4>`;
    if (usedFallback) { html += `<p class="status-message" style="color: gray;">ℹ️ Análise de tags indisponível para scraper.</p>`; el.innerHTML = html; return; }

    if (!Array.isArray(tags) || tags.length === 0) {
        html += `<p class="status-message" style="color: gray;">Nenhuma tag encontrada.</p>`;
        el.innerHTML = html; return;
    }

    let temTagNegativa = false;
    let ulHtml = '<ul>';
    tags.forEach(tag => {
        const isAlertTag = TAGS_NEGATIVAS.has(tag);
        if (isAlertTag) temTagNegativa = true;
        const isGoodTag = typeof tag === 'string' && (tag.includes('good_quality') || tag === 'brand_verified');
        const corItem = isAlertTag ? 'red' : 'inherit';
        const icone = isAlertTag ? '❌' : (isGoodTag ? '✅' : 'ℹ');
        const significado = tagSignificados[tag] || "Tag não mapeada.";
        ulHtml += `<li style="color: ${corItem}; margin-bottom: 4px;"> ${icone} <strong>${tag}</strong>: ${significado} </li>`;
    });
    ulHtml += '</ul>';

    if (!temTagNegativa) {
        html += `<p class="status-message" style="color: green;">✅ Nenhum problema identificado nas tags do anúncio.</p>`;
    }
    html += ulHtml;
    el.innerHTML = html;
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
    perfEl.innerHTML = `<h4 class="section-title-underlined">Detalhes da Qualidade do Anúncio</h4>`;

    if (!performanceData || typeof performanceData !== 'object' || Object.keys(performanceData).length === 0) {
        perfEl.innerHTML += '<p class="status-message" style="color:gray;">Nenhum dado de detalhe da qualidade disponível.</p>';
        return;
    }

    const overallP = document.createElement('p');
    overallP.className = 'overall-performance-score';
    const scoreDetailsSpan = document.createElement('span');
    scoreDetailsSpan.className = 'score-details';

    let scoreLevelText = performanceData.level_wording || 'N/A';
    let modeText = '', modeClass = '', modeIcon = '';

    if (performanceData.mode) {
        modeText = ` (${performanceData.mode.charAt(0).toUpperCase() + performanceData.mode.slice(1).toLowerCase()})`;
        if (performanceData.mode === 'OPPORTUNITY') { modeClass = 'opportunity'; modeIcon = '📈 '; }
        else if (performanceData.mode === 'WARNING') { modeClass = 'warning'; modeIcon = '⚠️ '; }
        else if (performanceData.mode === 'CRITICAL_WARNING') { modeClass = 'critical-warning'; modeIcon = '🚨 '; }
    }

    scoreDetailsSpan.innerHTML = `
        <strong>Nível de Qualidade:</strong> ${scoreLevelText}
        ${modeIcon}<span class="performance-mode ${modeClass}">${modeText}</span>
        ${performanceData.calculated_at ? `<br><small>Calculado em: ${new Date(performanceData.calculated_at).toLocaleDateString()}</small>` : ''}
    `;
    overallP.appendChild(scoreDetailsSpan);

    const perfScore = performanceData.score;
    let overallPerfScoreLevel = 'unknown';
    if (perfScore !== undefined) {
        if (perfScore >= 75) overallPerfScoreLevel = 'good';
        else if (perfScore >= 50) overallPerfScoreLevel = 'neutral';
        else overallPerfScoreLevel = 'bad';

        const circleDiv = document.createElement('div');
        circleDiv.className = 'circular-progress medium';
        circleDiv.setAttribute('data-score-level', overallPerfScoreLevel);
        circleDiv.style.setProperty('--score', perfScore);
        const textSpan = document.createElement('span');
        textSpan.className = 'score-text';
        textSpan.textContent = Math.round(perfScore);
        circleDiv.appendChild(textSpan);
        overallP.appendChild(circleDiv);
    }
    perfEl.appendChild(overallP);

    if (Array.isArray(performanceData.buckets)) {
        performanceData.buckets.forEach(bucket => {
            if (!bucket || typeof bucket !== 'object') return;
            let bLevel = 'neutral';
            if (bucket.score >= 75) bLevel = 'good'; else if (bucket.score < 50) bLevel = 'bad';
            const bDiv = document.createElement('div');
            bDiv.className = 'performance-bucket';
            bDiv.setAttribute('data-score-level', bLevel);
            const bH5 = document.createElement('h5');
            const bCirc = document.createElement('div');
            bCirc.className = 'circular-progress small';
            bCirc.setAttribute('data-score-level', bLevel);
            bCirc.style.setProperty('--score', bucket.score !== undefined ? bucket.score : 0);
            const bScoreTxt = document.createElement('span');
            bScoreTxt.className = 'score-text';
            bScoreTxt.textContent = bucket.score !== undefined ? Math.round(bucket.score) : 'N/A';
            bCirc.appendChild(bScoreTxt);
            bH5.appendChild(bCirc);
            const bStrong = document.createElement('strong');
            bStrong.textContent = bucket.title || bucket.key || 'Bucket';
            bH5.appendChild(bStrong);
            bDiv.appendChild(bH5);

            const compVars = [], pendVars = [];
            if (Array.isArray(bucket.variables)) {
                bucket.variables.forEach(v => {
                    if (v && typeof v === 'object') (v.status === 'COMPLETED' ? compVars : pendVars).push(v);
                });
            }

            [...pendVars, ...compVars].forEach((variable, index) => {
                if (index === pendVars.length && pendVars.length > 0 && compVars.length > 0) {
                    const sep = document.createElement('hr');
                    sep.style.cssText = 'margin:10px 0;border:0;border-top:1px dashed #ccc;';
                    bDiv.appendChild(sep);
                }
                let vLevel = 'neutral', vStatus = variable.status || 'UNKNOWN';
                if (variable.score >= 75) vLevel = 'good'; else if (variable.score < 50) vLevel = 'bad';
                if (vStatus === 'COMPLETED') vLevel = 'good';

                const vP = document.createElement('p');
                vP.className = 'performance-variable';
                vP.setAttribute('data-status', vStatus);
                if (vStatus === 'COMPLETED') vP.style.cursor = 'default';

                const vCirc = document.createElement('div');
                vCirc.className = 'circular-progress tiny';
                vCirc.setAttribute('data-score-level', vLevel);
                vCirc.style.setProperty('--score', variable.score !== undefined ? variable.score : 0);
                const vScoreTxt = document.createElement('span');
                vScoreTxt.className = 'score-text';
                vScoreTxt.textContent = variable.score !== undefined ? Math.round(variable.score) : 'N/A';
                vCirc.appendChild(vScoreTxt);
                vP.appendChild(vCirc);

                const vStrong = document.createElement('strong');
                vStrong.textContent = `${variable.title || variable.key || 'Variável'}:`;
                vP.appendChild(vStrong);

                if (vStatus !== 'COMPLETED' && Array.isArray(variable.rules) && variable.rules.some(r => r.wordings?.title)) {
                    const arrow = document.createElement('span');
                    arrow.className = 'variable-dropdown-arrow';
                    arrow.innerHTML = '▼';
                    vP.appendChild(arrow);
                    variable.rules.forEach(rule => {
                        if (rule.wordings?.title) {
                            const sugSpan = document.createElement('span');
                            sugSpan.className = 'suggestion';
                            sugSpan.textContent = rule.wordings.title + (performanceData.calculated_at ? ` (Ref: ${new Date(performanceData.calculated_at).toLocaleDateString()})` : '');
                            vP.appendChild(sugSpan);
                        }
                    });
                }
                bDiv.appendChild(vP);
            });
            perfEl.appendChild(bDiv);
        });
    } else {
        perfEl.innerHTML += '<p class="status-message" style="color:gray;">Estrutura de "buckets" de detalhes inesperada.</p>';
    }

    perfEl.querySelectorAll('.circular-progress').forEach(circle => {
        const score = parseFloat(circle.style.getPropertyValue('--score'));
        circle.style.setProperty('--score', 0);
        void circle.offsetWidth;
        setTimeout(() => circle.style.setProperty('--score', score), 10);
    });

    perfEl.querySelectorAll('.performance-variable').forEach(varEl => {
        const oldL = varEl._clickListener;
        if (oldL) varEl.removeEventListener('click', oldL);
        if (varEl.querySelector('.suggestion')) {
            const newL = function () { this.classList.toggle('active'); };
            varEl.addEventListener('click', newL);
            varEl._clickListener = newL;
        }
    });
}

function exibirPontuacao(score, usedFallback = false, containerId = "qualityScore") {
    const el = document.getElementById(containerId);
    if (!el) return;
    let level = 'bad';
    if (score >= 75) level = 'good'; else if (score >= 50) level = 'neutral';
    el.innerHTML = `<p><strong>Pontuação de Qualidade Estimada:</strong></p>`;
    const circle = document.createElement('div');
    circle.className = 'circular-progress';
    circle.setAttribute('data-score-level', level);
    circle.style.setProperty('--score', 0);
    void circle.offsetWidth;
    setTimeout(() => circle.style.setProperty('--score', score), 10);
    const text = document.createElement('span');
    text.className = 'score-text';
    text.textContent = score;
    circle.appendChild(text);
    el.appendChild(circle);
    el.style.border = usedFallback ? '2px dashed orange' : 'none';
    el.style.paddingTop = usedFallback ? '13px' : '15px';
    el.style.borderTop = usedFallback ? '2px dashed orange' : '2px solid #e9ecef';
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

    el.innerHTML = `<h4 class="section-title-underlined">Análise de Tendência de Visitas (30 dias)</h4>`;

    if (!visitsData || !visitsData.results || visitsData.results.length === 0) {
        // Tenta diagnosticar o motivo
        const motivo = !visitsData ? "Erro ao carregar dados." : "Nenhuma visita registrada no período.";
        el.innerHTML += `<p class="status-message" style="color:gray;">${motivo}</p>`;
        return;
    }

    const results = visitsData.results;
    // Ordenar por data
    results.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Dividir em dois períodos (primeira metade vs segunda metade)
    const midPoint = Math.floor(results.length / 2);
    const firstHalf = results.slice(0, midPoint);
    const secondHalf = results.slice(midPoint);

    const sumVisits = (arr) => arr.reduce((acc, curr) => acc + curr.total, 0);
    const totalFirst = sumVisits(firstHalf);
    const totalSecond = sumVisits(secondHalf);
    const totalVisits = totalFirst + totalSecond;

    let trend = 'Estável';
    let icon = '➡️';
    let color = 'gray';

    // Tratamento para divisão por zero se o primeiro período for 0
    let percentChange = 0;
    if (totalFirst === 0) {
        if (totalSecond > 0) percentChange = 100; // Crescimento infinito/novo
        else percentChange = 0; // 0 para 0
    } else {
        const diff = totalSecond - totalFirst;
        percentChange = (diff / totalFirst) * 100;
    }

    if (percentChange > 5) {
        trend = 'Subindo';
        icon = '📈';
        color = 'green';
    } else if (percentChange < -5) {
        trend = 'Caindo';
        icon = '📉';
        color = 'red';
    }

    // Se houver poucas visitas (ex: < 10 no total), alertar que a análise pode ser imprecisa
    const lowDataWarning = totalVisits < 10 ? '<br><small style="color:orange">Poucas visitas para determinar tendência confiável.</small>' : '';

    const html = `
        <div class="visits-trend-card" style="display: flex; align-items: center; justify-content: space-around; background: #f9fafb; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
            <div style="text-align: center;">
                <span style="font-size: 2em;">${icon}</span>
                <p style="margin: 5px 0 0; font-weight: bold; color: ${color};">${trend}</p>
            </div>
            <div style="text-align: left; font-size: 0.9em;">
                <p><strong>Total (30d):</strong> ${totalVisits}</p>
                <p><strong>1ª Quinzena:</strong> ${totalFirst}</p>
                <p><strong>2ª Quinzena:</strong> ${totalSecond}</p>
                <p style="color: ${color}; font-size: 0.85em;">(${percentChange === 100 && totalFirst === 0 ? 'Novo' : percentChange.toFixed(1) + '%'} vs período anterior)${lowDataWarning}</p>
            </div>
        </div>
    `;
    el.innerHTML += html;
}

function exibirAvaliacoes(reviewsData, containerId = "reviewsContainer") {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML = `<h4 class="section-title-underlined">Avaliações do Produto</h4>`;

    if (!reviewsData || !reviewsData.paging || reviewsData.paging.total === 0) {
        el.innerHTML += '<p class="status-message" style="color:gray;">Nenhuma avaliação encontrada para este produto.</p>';
        return;
    }

    // Calcular média ou usar dado da API se disponível (reviewsData geralmente retorna reviews individuais)
    // Se a rota for /reviews/item/{ITEM_ID}, o ML retorna rating_average nos dados do item, mas aqui estamos buscando reviews.
    // Vamos assumir que reviewsData contém { reviews: [], rating_average: ... } ou similar.
    // Ajuste conforme resposta real da API de reviews.
    // Se for a search de reviews padrão: { paging: {}, reviews: [], rating_average: X, rating_levels: {} }

    const average = reviewsData.rating_average || 0;
    const total = reviewsData.paging.total || 0;
    const reviews = reviewsData.reviews || [];

    const starsHtml = (score) => {
        let s = '';
        for (let i = 1; i <= 5; i++) {
            s += i <= Math.round(score) ? '★' : '☆';
        }
        return `<span style="color: #fbbf24; font-size: 1.2em;">${s}</span>`;
    };

    let html = `
        <div class="reviews-summary" style="margin-bottom: 15px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 2em; font-weight: bold;">${average.toFixed(1)}</span>
                <div style="display: flex; flex-direction: column;">
                    ${starsHtml(average)}
                    <span style="color: #6b7280; font-size: 0.9em;">${total} avaliações</span>
                </div>
            </div>
        </div>
        <div class="reviews-list" style="max-height: 300px; overflow-y: auto; padding-right: 5px;">
    `;

    if (reviews.length === 0) {
        html += '<p>Sem comentários recentes.</p>';
    } else {
        reviews.slice(0, 5).forEach(rev => { // Mostrar top 5
            html += `
                <div class="review-item" style="background: white; border: 1px solid #eee; padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        ${starsHtml(rev.rate)}
                        <span style="font-size: 0.8em; color: gray;">${new Date(rev.date_created).toLocaleDateString()}</span>
                    </div>
                    <p style="font-style: italic; font-size: 0.95em; color: #374151;">"${rev.content || 'Sem comentário'}"</p>
                </div>
            `;
        });
    }

    html += '</div>';
    el.innerHTML += html;
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
                    <div id="tituloTexto${containerIdSuffix}"></div>
                    <div id="descricaoIndicator${containerIdSuffix}"></div>
                    <div id="fichaTecnicaTexto${containerIdSuffix}"></div>
                    <div id="categoryAttributes${containerIdSuffix}"></div>
                    <div id="warrantyInfo${containerIdSuffix}"></div>
                    <div id="tagsTexto${containerIdSuffix}"></div>
                    <div id="performanceTexto${containerIdSuffix}"></div>

                    <div id="visitsTrend${containerIdSuffix}"></div>
                    <div id="reviewsContainer${containerIdSuffix}"></div>
                    <div id="qualityScore${containerIdSuffix}"></div>
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
    resultsContainer.innerHTML = `
        <img id="productImage" src="" alt="">
        <div id="tituloTexto"></div>
        <div id="upTagsTexto"></div>
        <div id="mlbuItemsList"></div>
    `;

    const titleEl = document.getElementById("tituloTexto");
    if (titleEl) {
        titleEl.innerHTML = `<p style="font-size: 1.2em; font-weight: 600; border-bottom: 1px solid #eee; padding-bottom: 8px;">Produto: ${mlbuDetail.title}</p>`;
    }
    exibirUpTags(mlbuDetail.tags);

    const imgEl = document.getElementById("productImage");
    if (imgEl && mlbuDetail.pictures.length > 0) {
        imgEl.src = mlbuDetail.pictures[0].secure_url;
        imgEl.alt = `Imagem de ${mlbuDetail.title}`;
        imgEl.style.display = 'block';
    }

    const listEl = document.getElementById('mlbuItemsList');
    listEl.innerHTML = `<h4 class="section-title-underlined">Anúncios (Itens) Vinculados</h4>`;

    const itemsDetails = await fetchItemDetails(mlbItems, accessToken);

    if (itemsDetails && itemsDetails.length > 0) {
        let html = '<ul>';
        itemsDetails.forEach(itemResp => {
            if (itemResp.code === 200 && itemResp.body) {
                const item = itemResp.body;
                const listingType = item.listing_type_id === 'gold_special' ? 'Clássico' : 'Premium';
                const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.price);

                html += `<li>
                    <button onclick="handleAnalysisClick('${item.id}', true)">
                        <img src="${item.thumbnail}" alt="Miniatura de ${item.title}">
                        <div class="item-details">
                            ${item.title}
                            <br>
                            <span class="item-listing-type">${listingType} - ${price}</span>
                        </div>
                    </button>
                </li>`;
            }
        });
        html += '</ul>';
        listEl.innerHTML += html;
    } else {
        listEl.innerHTML += '<p>Nenhum anúncio (MLB) encontrado para este produto ou falha ao buscar detalhes.</p>';
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
