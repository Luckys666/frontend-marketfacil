/**
 * Ad Analyzer Widget Logic
 */

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

// -------------- Constantes de Configuração --------------
const MIN_CHARS_TITULO_RUIM = 40;
const MIN_CHARS_TITULO_BOM = 50;
const MAX_CHARS_TITULO_BOM = 999; // Sem limite max
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
const API_ADS_METRICS_ENDPOINT = `${BASE_URL_PROXY}/api/ads-metrics`; // Rota para métricas de Product Ads

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function deveIgnorarAtributoPorNome(nome) {
    if (!nome) return false;
    const nomeLower = nome.toLowerCase();
    const FRASES_IGNORADAS_NOME_ATRIBUTO = ['número de', 'número do', 'registro de', 'registro do'];
    return FRASES_IGNORADAS_NOME_ATRIBUTO.some(frase => nomeLower.startsWith(frase));
}

function normalizeMlbId(input) {
    // Aceita qualquer prefixo ML (MLB/MCO/MLA/MLM/MLC/MLU) + variantes de catálogo (MLBU, MCOU, etc.)

    // 1. Link de catálogo: /p/{PREFIX}...
    const catalogMatch = input.match(/\/p\/((?:MLB|MCO|MLA|MLM|MLC|MLU)\w+)/i);
    if (catalogMatch) return { id: catalogMatch[1].toUpperCase(), type: 'catalog' };

    // 2. Link da tela de edição do painel ML: /anuncios/{ID}/modificar/...
    const editMatch = input.match(/\/anuncios\/((?:MLB|MCO|MLA|MLM|MLC|MLU)U?-?\d+)/i);
    if (editMatch) {
        const raw = editMatch[1].toUpperCase().replace('-', '');
        const isUserCat = /^(?:MLB|MCO|MLA|MLM|MLC|MLU)U\d/.test(raw);
        return { id: raw, type: isUserCat ? 'mlbu' : 'mlb' };
    }

    // 3. Catálogo de usuário (MLBU, MCOU, etc)
    const userCatMatch = input.match(/(MLB|MCO|MLA|MLM|MLC|MLU)U-?(\d+)/i);
    if (userCatMatch) {
        return { id: userCatMatch[1].toUpperCase() + 'U' + userCatMatch[2], type: 'mlbu' };
    }

    // 4. Item normal
    const regex = /(MLB|MCO|MLA|MLM|MLC|MLU)-?(\d+)/i;
    const match = input.match(regex);
    if (match) {
        return { id: match[1].toUpperCase() + match[2], type: 'mlb' };
    }
    return null;
}

const API_ANALYZE_IMAGE_ENDPOINT = `${BASE_URL_PROXY}/api/analyze-image`;

window.ignoredAdAttributes = new Set();
window.ignoredCatalogAttributes = new Set();
window.ignoredAttributesGlobally = window.ignoredAdAttributes; // backward compat
window.currentAnalysisState = null;
window.lastCatalogUrl = null;

window.toggleIgnoreAttribute = function (attrId, context) {
    const targetSet = context === 'catalog' ? window.ignoredCatalogAttributes : window.ignoredAdAttributes;
    if (targetSet.has(attrId)) {
        targetSet.delete(attrId);
    } else {
        targetSet.add(attrId);
    }
    // Keep global in sync for backward compat
    window.ignoredAttributesGlobally = window.ignoredAdAttributes;
    if (context !== 'catalog') reRenderAnalysisView();
};

// ============================================================
// Edição inline de atributos de categoria (PUT /items/{id})
// ============================================================
function exampleNumberForUnit(unit) {
    if (!unit) return '30';
    const u = String(unit).toLowerCase().trim();
    // Massa
    if (['g', 'mg'].includes(u)) return '500';
    if (['kg', 'lb', 'lbs', 'oz'].includes(u)) return '1';
    if (['ton', 't'].includes(u)) return '1';
    // Volume
    if (['ml', 'cc'].includes(u)) return '300';
    if (['l', 'gal'].includes(u)) return '1';
    if (['fl oz'].includes(u)) return '16';
    // Comprimento curto
    if (['mm'].includes(u)) return '300';
    if (['cm', '"', 'in', 'pol', 'polegadas'].includes(u)) return '30';
    // Comprimento longo
    if (['m', 'ft', 'yd', 'km', 'mi'].includes(u)) return '1';
    // Tempo
    if (['s', 'seg'].includes(u)) return '60';
    if (['min', 'h', 'hora', 'horas'].includes(u)) return '1';
    if (['dia', 'dias'].includes(u)) return '30';
    if (['mes', 'meses', 'mês', 'meses'].includes(u)) return '12';
    if (['ano', 'anos'].includes(u)) return '1';
    // Potência / Energia
    if (['w', 'mw', 'btu'].includes(u)) return '500';
    if (['kw', 'hp'].includes(u)) return '1';
    // Voltagem
    if (['v'].includes(u)) return '220';
    if (['mv', 'kv'].includes(u)) return '1';
    // Corrente
    if (['a', 'ma'].includes(u)) return '1';
    // Frequência
    if (['hz'].includes(u)) return '60';
    if (['khz', 'mhz', 'ghz'].includes(u)) return '1';
    // Storage
    if (['b', 'bytes'].includes(u)) return '1024';
    if (['kb'].includes(u)) return '256';
    if (['mb'].includes(u)) return '64';
    if (['gb'].includes(u)) return '128';
    if (['tb'].includes(u)) return '1';
    // Resolução / pixels
    if (['px', 'pixels'].includes(u)) return '1080';
    if (['mp', 'megapixels'].includes(u)) return '12';
    if (['ppi', 'dpi'].includes(u)) return '300';
    // Pessoas / unidades
    if (['pessoas', 'lugares', 'assentos', 'cadeiras', 'peças'].includes(u)) return '4';
    // Temperatura
    if (['°c', '°f', 'c', 'f'].includes(u)) return '25';
    // Velocidade
    if (['rpm'].includes(u)) return '1500';
    if (['km/h', 'mph'].includes(u)) return '100';
    // Default
    return '30';
}


// ============================================================
// MF Attribute Validation Helpers
// Pré-valida e traduz erros do ML pra mensagens amigáveis em PT-BR.
// ============================================================
const MF_GTIN_LIKE_IDS = new Set(['GTIN', 'UPC', 'EAN', 'JAN', 'ISBN']);
function MF_isGtinLike(attrId) {
    return MF_GTIN_LIKE_IDS.has(String(attrId || '').toUpperCase());
}

function MF_validateAttrInput(catAttr, rawValue) {
    if (!catAttr) return { ok: true, cleanedValue: rawValue };
    const val = String(rawValue || '').trim();
    if (!val) return { ok: false, error: 'Preencha um valor.' };

    const id = String(catAttr.id || '').toUpperCase();
    const valueType = catAttr.value_type;
    const maxLen = catAttr.value_max_length;
    const name = catAttr.name || 'campo';

    // GTIN/EAN/UPC — limpa não-dígitos e valida tamanho (8, 12, 13 ou 14)
    if (MF_isGtinLike(id)) {
        // Limpa só separadores comuns (espaço, traço, ponto, parêntese), preservando letras pra detectar erro
        const cleaned = val.replace(/[\s\-.()]+/g, '');
        if (/[^\d]/.test(cleaned)) {
            return { ok: false, error: `${name}: digite só números. Use o código de barras do produto (8, 12, 13 ou 14 dígitos).` };
        }
        if (cleaned.length === 0) {
            return { ok: false, error: `${name} precisa ser numérico. Use o código de barras do produto (8, 12, 13 ou 14 dígitos).` };
        }
        const validLengths = [8, 12, 13, 14];
        if (!validLengths.includes(cleaned.length)) {
            return { ok: false, error: `${name} precisa ter 8, 12, 13 ou 14 dígitos. Você digitou ${cleaned.length}.` };
        }
        return { ok: true, cleanedValue: cleaned, autoCleaned: cleaned !== val };
    }

    // SKU — limita pelo max_length da categoria (default 60)
    if (id === 'SELLER_SKU') {
        const limit = maxLen || 60;
        if (val.length > limit) {
            return { ok: false, error: `SKU pode ter no máximo ${limit} caracteres. Você digitou ${val.length}.` };
        }
        return { ok: true, cleanedValue: val };
    }

    // Numéricos / dimensões — precisa começar com dígito
    if (valueType === 'number' || valueType === 'number_unit') {
        if (!/^[\d.,]/.test(val)) {
            const unit = catAttr.default_unit || (Array.isArray(catAttr.allowed_units) ? (catAttr.allowed_units[0]?.id || catAttr.allowed_units[0]?.name) : '');
            return { ok: false, error: `${name} precisa começar com um número${unit ? ` (ex: 30 ${unit})` : ' (ex: 30)'}.` };
        }
        return { ok: true, cleanedValue: val };
    }

    // Texto livre com max_length
    if (maxLen && val.length > maxLen) {
        return { ok: false, error: `${name}: máximo de ${maxLen} caracteres. Você digitou ${val.length}.` };
    }

    return { ok: true, cleanedValue: val };
}

function MF_translateMlError(errData, catAttr) {
    const fallbackName = catAttr?.name || 'campo';
    if (!errData) return 'Erro desconhecido.';

    const cause = Array.isArray(errData.cause) ? errData.cause[0] : null;
    const code = String(cause?.code || errData.ml_error || errData.error || '');
    const rawMsg = String(cause?.message || errData.message || '');

    // Traduz texto ES/EN → PT comum (usado tanto em mensagens mapeadas como no fallback)
    const toPt = (txt) => String(txt || '')
        .replace(/no es valido/gi, 'não é válido')
        .replace(/no es válido/gi, 'não é válido')
        .replace(/debe contener/gi, 'precisa ter')
        .replace(/debe ser/gi, 'precisa ser')
        .replace(/no puede ser/gi, 'não pode ser')
        .replace(/atributo/gi, 'campo')
        .replace(/atributos/gi, 'campos')
        .replace(/El formato/gi, 'O formato')
        .replace(/El valor/gi, 'O valor')
        .replace(/valor del campo/gi, 'valor do campo')
        .replace(/duplicado/gi, 'duplicado (já existe)')
        .replace(/obligatorio/gi, 'obrigatório')
        .replace(/caractere/gi, 'caractere')
        .replace(/Validation error/gi, `Não foi possível validar ${fallbackName}`);

    if (/invalid_format/i.test(code)) {
        return `${fallbackName}: formato inválido. Veja a dica logo abaixo do campo.${rawMsg ? ` (Detalhe: ${toPt(rawMsg)})` : ''}`;
    }
    if (/value_not_in_allowed_values/i.test(code)) {
        return `${fallbackName}: escolha uma opção da lista de sugestões — texto livre não é aceito aqui.`;
    }
    if (/invalid_value/i.test(code)) {
        return `${fallbackName}: valor não aceito pelo Mercado Livre. ${toPt(rawMsg)}`.trim();
    }
    if (/invalid_length|too_long|too_short|max_length|min_length/i.test(code) || /length|too\s+(long|short)|caracteres/i.test(rawMsg)) {
        return `${fallbackName}: tamanho fora do permitido. ${toPt(rawMsg)}`.trim();
    }
    if (/required|missing/i.test(code)) {
        return `${fallbackName} é obrigatório — você precisa preencher esse campo.`;
    }
    if (/duplicated|already_exists/i.test(code)) {
        return `${fallbackName}: esse valor já está em uso em outro anúncio seu.`;
    }
    if (/read[_\s-]?only/i.test(code)) {
        return `${fallbackName} não pode ser editado depois que o anúncio foi publicado.`;
    }
    if (/deprecated/i.test(code)) {
        return `${fallbackName}: esse campo foi descontinuado pelo Mercado Livre.`;
    }
    if (/forbidden|not_allowed|not_authorized/i.test(code) || /forbidden/i.test(rawMsg)) {
        return `${fallbackName}: esse campo não pode ser alterado nessa categoria/anúncio.`;
    }
    if (/conflict/i.test(code)) {
        return `${fallbackName}: conflito com outro campo do anúncio. ${toPt(rawMsg)}`.trim();
    }

    // ML retorna code "item.attributes.invalid" + references com "variation.attribute_combinations"
    // quando o atributo é gerenciado por variação. Detectamos por references (mais robusto que regex em msg).
    const refs = Array.isArray(cause?.references) ? cause.references : [];
    const isVariationConflict = /Same attributes are used in/i.test(rawMsg)
        || refs.some(r => /variation[s]?\.attribute_combinations/i.test(String(r)));
    if (isVariationConflict) {
        return `${fallbackName} é gerenciado por variação nesse anúncio. Não dá pra editar aqui no campo geral — você precisa editar em cada variação separadamente, na página do anúncio no Mercado Livre.`;
    }

    // Fallback: mensagem traduzida + nome do campo + código (se houver)
    const ptMsg = toPt(rawMsg);
    if (ptMsg) {
        return `${fallbackName}: ${ptMsg}`;
    }
    return `Não foi possível validar ${fallbackName}.${code ? ` (código: ${code})` : ''}`;
}

function MF_getAttrPlaceholder(catAttr) {
    if (!catAttr) return '';
    const id = String(catAttr.id || '').toUpperCase();
    if (MF_isGtinLike(id)) return 'ex: 7891234567890 (código de barras, 8/12/13/14 dígitos)';
    if (id === 'SELLER_SKU') return 'ex: SKU-001 (código interno seu)';
    if (id === 'PACKAGE_LENGTH') return 'ex: 30 cm';
    if (id === 'PACKAGE_WIDTH') return 'ex: 20 cm';
    if (id === 'PACKAGE_HEIGHT') return 'ex: 10 cm';
    if (id === 'PACKAGE_WEIGHT') return 'ex: 500 g';
    return '';
}

// Atributos comumente gerenciados por variação no Mercado Livre.
// Se o anúncio tem variations[], editar esses no campo geral resulta em erro
// "Same attributes are used in more than of item.attributes...".
const MF_VARIATION_ATTR_IDS = new Set(['COLOR', 'SIZE', 'MAIN_COLOR', 'SELLER_SKU', 'GTIN']);

window.openAttrEditor = function (attrId) {
    const state = window.currentAnalysisState;
    if (!state) return;
    const catAttr = (state.categoryAttributes || []).find(a => a.id === attrId);
    if (!catAttr) return;

    const wrapper = document.getElementById(`attr-edit-wrapper-${attrId}`);
    if (!wrapper) return;

    // Bloqueia edição se anúncio tem variações E o atributo é normalmente per-variação
    const hasVariations = Array.isArray(state.detail?.variations) && state.detail.variations.length > 0;
    const isVariationAttr = MF_VARIATION_ATTR_IDS.has(String(attrId).toUpperCase());
    if (hasVariations && isVariationAttr) {
        const itemId = state.detail?.id || '';
        const editUrl = itemId ? `https://www.mercadolivre.com.br/anuncios/${itemId}/modificar/variantes` : '';
        wrapper.innerHTML = `
            <div class="attr-edit-box" style="background:var(--yellow-light); border:1px solid var(--yellow); padding:8px; border-radius:6px;">
                <div style="font-size:0.85rem; color:var(--text); margin-bottom:6px;">
                    <strong>${catAttr.name}</strong> é gerenciado por variação nesse anúncio.
                </div>
                <div style="font-size:0.78rem; color:var(--text-secondary); margin-bottom:8px;">
                    Esse anúncio tem ${state.detail.variations.length} variações. Edite esse campo em cada variação separadamente, na página do anúncio no Mercado Livre.
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    ${editUrl ? `<a href="${editUrl}" target="_blank" rel="noopener" class="attr-edit-save" style="text-decoration:none; padding:4px 10px; background:var(--blue); color:white; border-radius:4px; font-size:0.78rem;">Abrir variações no ML →</a>` : ''}
                    <button type="button" onclick="window.cancelAttrEditor('${attrId}')" class="attr-edit-cancel" title="Fechar">✕</button>
                </div>
            </div>
        `;
        return;
    }

    const currentAd = (state.detail.attributes || []).find(a => a.id === attrId) || {};
    const currentValueName = currentAd.value_name || '';
    const currentValueId = currentAd.value_id || '';

    const allowedValues = Array.isArray(catAttr.values) ? catAttr.values : [];
    const maxLen = catAttr.value_max_length || 255;
    const valueType = catAttr.value_type || 'string';

    let inputHtml;
    let hintExtra = '';
    if (valueType === 'boolean') {
        // Boolean — ML só aceita "Sim" ou "Não" exatos
        const isYes = (currentValueName || '').toLowerCase() === 'sim';
        const isNo = (currentValueName || '').toLowerCase() === 'não';
        inputHtml = `<select id="attr-input-${attrId}" class="attr-edit-input">
            <option value="">-- Selecione --</option>
            <option value="242085" data-name="Sim"${isYes ? ' selected' : ''}>Sim</option>
            <option value="242084" data-name="Não"${isNo ? ' selected' : ''}>Não</option>
        </select>`;
    } else if (valueType === 'list' && allowedValues.length > 0) {
        // Strict list — ML rejeita texto livre aqui, força select
        const opts = allowedValues.map(v => {
            const selected = String(v.id) === String(currentValueId) ? ' selected' : '';
            const nameAttr = String(v.name || '').replace(/"/g, '&quot;');
            return `<option value="${v.id}" data-name="${nameAttr}"${selected}>${escapeHtml(v.name)}</option>`;
        }).join('');
        inputHtml = `<select id="attr-input-${attrId}" class="attr-edit-input">
            <option value="">-- Selecione uma opção --</option>
            ${opts}
        </select>`;
        hintExtra = ` · escolha uma opção da lista (texto livre não é aceito)`;
    } else if (allowedValues.length > 0) {
        // String com sugestões — permite texto livre, ML aceita pra ganhar keywords
        const datalistId = `attr-datalist-${attrId}`;
        const opts = allowedValues.map(v => `<option value="${escapeHtml(v.name)}">`).join('');
        inputHtml = `<input type="text" id="attr-input-${attrId}" class="attr-edit-input" value="${escapeHtml(currentValueName)}" maxlength="${maxLen}" list="${datalistId}" autocomplete="off" placeholder="comece a digitar pra ver sugestões" />
            <datalist id="${datalistId}">${opts}</datalist>`;
        hintExtra = ` · ${allowedValues.length} sugestões disponíveis — pode combinar ou digitar livre`;
    } else if (valueType === 'number' || valueType === 'number_unit') {
        const unit = catAttr.default_unit || (Array.isArray(catAttr.allowed_units) ? (catAttr.allowed_units[0]?.id || catAttr.allowed_units[0]?.name) : '');
        const exNum = exampleNumberForUnit(unit);
        const fromHelper = MF_getAttrPlaceholder(catAttr);
        const placeholder = fromHelper || (valueType === 'number_unit' && unit ? `ex: ${exNum} ${unit}` : `ex: ${exNum}`);
        inputHtml = `<input type="text" id="attr-input-${attrId}" class="attr-edit-input" value="${escapeHtml(currentValueName)}" placeholder="${escapeHtml(placeholder)}" maxlength="${maxLen}" inputmode="decimal" />`;
        hintExtra = valueType === 'number_unit' && unit
            ? ` · digite o valor em ${unit} (ex: ${exNum} ${unit}) — só números`
            : ` · digite só números (ex: ${exNum})`;
    } else {
        // Default: string free text
        const placeholder = MF_getAttrPlaceholder(catAttr);
        const phAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';
        const isGtin = MF_isGtinLike(attrId);
        const inputModeAttr = isGtin ? ' inputmode="numeric"' : '';
        inputHtml = `<input type="text" id="attr-input-${attrId}" class="attr-edit-input" value="${escapeHtml(currentValueName)}" maxlength="${maxLen}"${phAttr}${inputModeAttr} />`;
        if (isGtin) hintExtra = ` · cole o código de barras (só números: 8, 12, 13 ou 14 dígitos)`;
        else if (String(attrId).toUpperCase() === 'SELLER_SKU') hintExtra = ` · seu código interno (qualquer texto, até ${maxLen} caracteres)`;
    }

    wrapper.innerHTML = `
        <div class="attr-edit-box">
            ${inputHtml}
            <button type="button" onclick="window.saveAttr('${attrId}')" class="attr-edit-save" title="Salvar">✓</button>
            <button type="button" onclick="window.cancelAttrEditor('${attrId}')" class="attr-edit-cancel" title="Cancelar">✕</button>
            <div id="attr-edit-error-${attrId}" class="attr-edit-error" style="display:none;"></div>
            <div class="attr-edit-hint">${catAttr.name}${maxLen && maxLen < 255 ? ` — até ${maxLen} caracteres` : ''}${hintExtra}</div>
        </div>
    `;
    const input = document.getElementById(`attr-input-${attrId}`);
    if (input) {
        input.focus();
        if (input.tagName === 'INPUT' && input.value) input.select();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); window.saveAttr(attrId); }
            if (e.key === 'Escape') { e.preventDefault(); window.cancelAttrEditor(attrId); }
        });
    }
};

window.cancelAttrEditor = function (attrId) {
    // Simple approach: re-render the card to restore original view
    const state = window.currentAnalysisState;
    if (!state) return;
    const containerId = `categoryAttributes${state.containerIdSuffix || ''}`;
    exibirAtributosCategoria(state.categoryAttributes, state.detail.attributes, containerId);
};

window.saveAttr = async function (attrId) {
    const state = window.currentAnalysisState;
    if (!state) return;
    const input = document.getElementById(`attr-input-${attrId}`);
    const errorEl = document.getElementById(`attr-edit-error-${attrId}`);
    if (!input) return;

    const saveBtn = document.querySelector(`#attr-edit-wrapper-${attrId} .attr-edit-save`);
    const cancelBtn = document.querySelector(`#attr-edit-wrapper-${attrId} .attr-edit-cancel`);
    const showError = (msg) => {
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓'; }
        if (cancelBtn) cancelBtn.disabled = false;
        if (input) input.disabled = false;
    };

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
    if (cancelBtn) cancelBtn.disabled = true;
    if (input) input.disabled = true;
    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }

    const catAttr = (state.categoryAttributes || []).find(a => a.id === attrId);
    let attrPayload;
    if (input.tagName === 'SELECT') {
        const opt = input.options[input.selectedIndex];
        if (!opt || !opt.value) return showError(`Selecione uma opção da lista para "${catAttr?.name || 'este campo'}".`);
        attrPayload = { id: attrId, value_id: opt.value, value_name: opt.dataset.name || opt.textContent.trim() };
    } else {
        const rawVal = (input.value || '').trim();
        // Pré-validação amigável antes de chamar a ML
        const validation = MF_validateAttrInput(catAttr, rawVal);
        if (!validation.ok) return showError(validation.error);
        const val = validation.cleanedValue || rawVal;
        // Se a auto-correção limpou caracteres inválidos (ex: GTIN), reflete no input
        if (validation.autoCleaned && input) input.value = val;
        // Se bater exato com uma allowed_value, manda value_id também (mais robusto)
        const exactMatch = Array.isArray(catAttr?.values)
            ? catAttr.values.find(v => String(v.name || '').toLowerCase() === val.toLowerCase())
            : null;
        if (exactMatch) {
            attrPayload = { id: attrId, value_id: exactMatch.id, value_name: exactMatch.name };
        } else {
            attrPayload = { id: attrId, value_name: val };
        }
    }

    const itemId = state.detail?.id;
    const token = state.accessToken || window._adsAccessToken;
    if (!itemId || !token) return showError('Sessão expirada. Recarregue a página.');

    try {
        const res = await fetch(`${BASE_URL_PROXY}/api/fetch-item-update?item_id=${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ attributes: [attrPayload] })
        });
        if (!res.ok) {
            let msg = `Erro ${res.status}`;
            try {
                const err = await res.json();
                msg = MF_translateMlError(err, catAttr) || err.error || err.message || msg;
            } catch (_) {}
            return showError(msg);
        }
        const updated = await res.json();
        if (Array.isArray(updated?.attributes)) {
            state.detail.attributes = updated.attributes;
        } else {
            // Optimistic: merge the single attribute into state
            const idx = (state.detail.attributes || []).findIndex(a => a.id === attrId);
            const merged = { ...(idx >= 0 ? state.detail.attributes[idx] : { id: attrId }), ...attrPayload };
            if (idx >= 0) state.detail.attributes[idx] = merged;
            else (state.detail.attributes = state.detail.attributes || []).push(merged);
        }
        // Re-render the category card with fresh values
        const containerId = `categoryAttributes${state.containerIdSuffix || ''}`;
        exibirAtributosCategoria(state.categoryAttributes, state.detail.attributes, containerId);
        // Also re-render ficha técnica + score since attributes changed
        processarAtributos(state.detail.attributes, state.detail.title, state.usedFallback, `fichaTecnicaTexto${state.containerIdSuffix || ''}`);
    } catch (e) {
        return showError(e.message || 'Falha de rede');
    }
};

function reRenderAnalysisView() {
    if (!window.currentAnalysisState) return;
    const { detail, descriptionData, usedFallback, containerIdSuffix, categoryAttributes, visitsData, reviewsData } = window.currentAnalysisState;

    // Update dependent components
    processarAtributos(detail.attributes, detail.title, usedFallback, `fichaTecnicaTexto${containerIdSuffix}`);
    exibirAtributosCategoria(categoryAttributes, detail.attributes, `categoryAttributes${containerIdSuffix}`);

    // Re-render score WITH analysisData so improvements panel persists
    const analysisData = { title: detail.title, detail, descriptionData, categoryAttributes, visitsData, reviewsData };
    exibirPontuacao(calcularPontuacaoQualidade(detail, descriptionData, usedFallback, categoryAttributes), usedFallback, `scoreCircle${containerIdSuffix}`, analysisData, `scoreChecklist${containerIdSuffix}`);
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

function exibirTitulo(titulo, isMlbu = false, containerId = "tituloTexto", detail = null) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Detect if title contains variation name (common in MLB items from MLBU)
    // Variations add " - VariationName" or " VariationName" to the title
    const variations = detail?.variations || [];
    let tituloBase = titulo || '';
    let variacaoNome = '';

    if (variations.length > 0 && detail?.attribute_combinations) {
        // Single item with attribute_combinations = it's a specific variation
        variacaoNome = detail.attribute_combinations.map(a => a.value_name).join(' ');
    } else if (variations.length > 0) {
        // Try to detect variation suffix in title by checking variation attribute names
        for (const v of variations) {
            if (v.attribute_combinations) {
                const varLabel = v.attribute_combinations.map(a => a.value_name).join(' ');
                if (titulo && titulo.endsWith(varLabel)) {
                    tituloBase = titulo.slice(0, -varLabel.length).replace(/[\s\-]+$/, '');
                    variacaoNome = varLabel;
                    break;
                }
            }
        }
    }

    const lenBase = tituloBase.length;
    const lenVar = variacaoNome.length;
    const lenTotal = (titulo || '').length;
    const hasVariation = variacaoNome.length > 0;

    // Para análise, usar o tamanho do título BASE (sem variação)
    const lenAnalise = hasVariation ? lenBase : lenTotal;

    const idealMin = isMlbu ? 50 : MIN_CHARS_TITULO_BOM;

    let state = 'bad';
    let progressPercent = 0;

    if (lenAnalise >= idealMin) {
        state = 'good';
        progressPercent = 100;
    } else if (lenAnalise >= 40) {
        state = 'neutral';
        progressPercent = 70;
    } else {
        progressPercent = Math.max(10, (lenAnalise / 60) * 100);
    }

    const badgeClass = state;
    const badgeText = state === 'good' ? 'Excelente' : (state === 'neutral' ? 'Aceitável' : 'Muito Curto');
    const imgUrl = detail?.pictures?.[0]?.secure_url || '';

    // Variation info section
    let varHtml = '';
    if (hasVariation) {
        const varState = lenVar >= 20 ? 'good' : (lenVar >= 10 ? 'neutral' : 'bad');
        varHtml = `
            <div style="margin-top:12px; padding:10px 14px; background:var(--blue-light); border-radius:var(--radius-sm); border-left:3px solid var(--blue);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--blue); font-weight:600;">Nome da Variação</span>
                    <span class="status-badge ${varState === 'good' ? 'success' : (varState === 'neutral' ? 'muted' : 'error')}" style="font-size:0.65rem;">${lenVar} chars</span>
                </div>
                <span style="font-weight:600; font-size:0.9rem; color:var(--text);">${escapeHtml(variacaoNome)}</span>
                <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">💡 Use até 30 caracteres para adicionar palavras-chave de busca extras.</div>
            </div>`;
    }

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.1s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📝</span>
                <span class="ana-card-title">Análise do Título</span>
                <span class="status-badge ${badgeClass}" style="margin-left:auto;">${badgeText}</span>
            </div>

            <div style="display:flex; gap:20px; align-items:flex-start;">
                ${imgUrl ? `<div class="cover-img-glow"><img src="${imgUrl}" style="width:90px; height:90px; object-fit:contain; border-radius:var(--radius-sm); display:block;"></div>` : ''}
                <div style="flex:1; min-width:0;">
                    <div style="margin-bottom:${hasVariation ? '8' : '20'}px;">
                        <p class="title-display">${hasVariation ? escapeHtml(tituloBase) : (escapeHtml(titulo) || 'Nenhum título encontrado')}</p>
                        <div class="char-counter-bar">
                            <div class="char-progress ${state}" style="width: ${progressPercent}%"></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-top:5px;">
                             <span class="text-small">${hasVariation ? `${lenBase} chars (título)` : `${lenTotal} caracteres`}</span>
                             <span class="text-small">Meta: ${idealMin}+</span>
                        </div>
                    </div>

                    ${varHtml}

                    ${state !== 'good' && !hasVariation ? `
                    <div class="info-box" style="margin-bottom:0; margin-top:8px; background:#fff7ed; border-color:#fed7aa; color:#9a3412;">
                         <p><strong>Dica:</strong> Títulos detalhados acima de ${idealMin} caracteres ajudam na busca do Mercado Livre.</p>
                    </div>
                    ` : ''}
                    ${(() => {
                        // Aviso especial: se o título NÃO está bom mas o anúncio tem muitas vendas,
                        // NÃO mexer — alterar título reseta o histórico e perde exposição.
                        const soldQty = detail?.sold_quantity || 0;
                        const HEAVY_SALES_THRESHOLD = 50; // ~50+ vendas já é um histórico forte
                        if (state !== 'good' && soldQty >= HEAVY_SALES_THRESHOLD) {
                            return `
                            <div style="margin-top:10px; padding:12px 14px; background:linear-gradient(135deg, #fef3c7, #fde68a); border:1px solid #f59e0b; border-left:4px solid #d97706; border-radius:var(--radius-sm);">
                                <div style="display:flex; align-items:flex-start; gap:10px;">
                                    <span style="font-size:1.2rem; flex-shrink:0;">🛡️</span>
                                    <div style="flex:1; min-width:0;">
                                        <div style="font-weight:700; font-size:0.85rem; color:#78350f; margin-bottom:3px;">Atenção: anúncio com histórico consolidado</div>
                                        <div class="text-small" style="color:#78350f; line-height:1.4;">Este anúncio já tem <strong>${soldQty.toLocaleString((window.MF_getSiteConfig && window.MF_currentSiteId) ? window.MF_getSiteConfig(window.MF_currentSiteId()).locale : 'pt-BR')} vendas</strong>. Mesmo que o título pudesse ser otimizado, <strong>alterar o título agora pode fazer o anúncio perder posicionamento e exposição</strong> — o Mercado Livre tende a repensar o ranking quando o título muda. Avalie com cuidado antes de mexer.</div>
                                    </div>
                                </div>
                            </div>`;
                        }
                        return '';
                    })()}
                </div>
            </div>
        </div>
    `;

    // Animate progress bar width after render
    setTimeout(() => {
        const bar = el.querySelector('.char-progress');
        if (bar) bar.style.width = `${Math.min(100, (lenAnalise / 60) * 100)}%`;
    }, 300);
}

function exibirDescricaoIndicator(descriptionData, containerId = "descricaoIndicator") {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hasDesc = !!(descriptionData && ((descriptionData.plain_text && descriptionData.plain_text.trim()) || (descriptionData.text && descriptionData.text.trim())));
    const badgeClass = hasDesc ? 'success' : 'error';
    const icon = hasDesc ? '✅' : '❌';
    const fromCatalog = descriptionData?.source === 'catalog';
    const text = hasDesc ? (fromCatalog ? 'Do catálogo' : 'Detectada') : 'Sem Texto';

    el.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius);">
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

            // Check Repetition — collect exact words and sources
            if (!ATRIBUTOS_IGNORADOS_REPETICAO.has(attr.id) && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                const pAtuais = pPorAttr.get(attr.id);
                const reptTitulo = encontrarIntersecao(pAtuais, pTit);
                if (reptTitulo.length > 0) {
                    const words = reptTitulo.map(w => `<span style="background:#fde68a;color:#92400e;padding:0 3px;border-radius:3px;font-weight:600;">${w}</span>`).join(' ');
                    issues.push(`Repete o Título: ${words}`);
                }

                // Repetition with other attributes
                const dupColors = ['#dbeafe','#fce7f3','#e0e7ff','#fef3c7','#ccfbf1'];
                let colorIdx = 0;
                pPorAttr.forEach((pOutro, outroId) => {
                    if (attr.id !== outroId && !ATRIBUTOS_IGNORADOS_REPETICAO.has(outroId)) {
                        const otherAttr = validAttrs.find(a => a.id === outroId);
                        if (otherAttr && !VALORES_IGNORADOS_PENALIDADE.has(otherAttr.value_name.toLowerCase())) {
                            const palavrasRepetidas = encontrarIntersecao(pAtuais, pOutro);
                            if (palavrasRepetidas.length > 0) {
                                const bg = dupColors[colorIdx % dupColors.length];
                                colorIdx++;
                                const words = palavrasRepetidas.map(w => `<span style="background:${bg};padding:0 3px;border-radius:3px;font-weight:600;">${w}</span>`).join(' ');
                                issues.push(`Duplica com <strong>${otherAttr.name || outroId}</strong>: ${words}`);
                            }
                        }
                    }
                });
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
        return list.map(item => {
            const ignored = window.ignoredAdAttributes.has(item.id);
            const issuesHtml = isProblem && !ignored && item.issues ? item.issues.map(iss => `<div style="font-size:0.72rem; color:var(--red-dark); margin-top:3px; line-height:1.3;">⚠ ${iss}</div>`).join('') : '';
            return `
            <div class="attribute-item ${isProblem ? 'problem' : ''}" style="min-width:0; ${ignored ? 'opacity:0.5; filter:grayscale(1);' : ''}">
                <div style="flex-grow:1; min-width:0; overflow:hidden;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="text-label" style="margin-bottom:2px;">${escapeHtml(item.name)}</span>
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            ${!isProblem && !ignored ? '<span style="color:var(--green); font-weight:bold;">✔</span>' : ''}
                            ${ignored ? '<span style="color:gray; font-size:0.75rem;">Ignorado</span>' : ''}
                            <button onclick="window.toggleIgnoreAttribute('${item.id}', 'ad')" title="${ignored ? 'Incluir' : 'Ignorar'}" class="btn-ignore-clean ${ignored ? 'ignored' : ''}">
                                ${ignored ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'}
                            </button>
                        </div>
                    </div>
                    <span class="text-value" style="word-break:break-word; ${ignored ? 'text-decoration:line-through;' : ''}">${escapeHtml(item.value)}</span>
                    ${issuesHtml}
                </div>
            </div>`;
        }).join('');
    };

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.2s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📋</span>
                <span class="ana-card-title">Ficha Técnica</span>
                <span class="text-small" style="margin-left:auto; color:var(--text-muted);">${problemAttrs.length + okAttrs.length} atributos</span>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                <div>
                    <div class="specs-group-title problem" style="margin-bottom:8px;">⚠️ Atenção (${problemAttrs.length})</div>
                    ${problemAttrs.length > 0 ? renderList(problemAttrs, true) : '<p class="text-small" style="color:var(--green);">Nenhum problema encontrado 🎉</p>'}
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
    // Include string, list, boolean, number, number_unit — skip only read_only
    const EDITABLE_TYPES = new Set(['string', 'list', 'boolean', 'number', 'number_unit']);
    const stringAttributes = Array.isArray(categoryAttributes) ? categoryAttributes.filter(attr => EDITABLE_TYPES.has(attr.value_type) && !attr.tags?.read_only) : [];

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

        const renderCatItem = (catAttr, adValue, isFilled) => {
            const isIgnored = window.ignoredAdAttributes.has(catAttr.id);
            const canEdit = !isIgnored && !catAttr.tags?.read_only;
            const pencilSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>`;
            return `
             <div class="attribute-item" style="min-width:0; ${!isFilled ? 'background:var(--red-light); border-color:var(--red);' : 'background:var(--green-light); border-color:var(--green);'} ${isIgnored ? 'opacity: 0.5; filter: grayscale(1);' : ''}">
                <div id="attr-edit-wrapper-${catAttr.id}" style="flex-grow: 1; min-width:0; overflow:hidden;">
                    <span class="text-label" style="margin-bottom:2px;">${catAttr.name}</span>
                    ${isFilled ? `<span class="text-value" style="word-break:break-word; ${isIgnored ? 'text-decoration: line-through;' : ''}">${adValue}</span>` : '<span class="text-small" style="color:var(--red);">Não preenchido</span>'}
                </div>
                <div style="display:flex; align-items:center; gap: 6px; flex-shrink:0;">
                    ${isFilled && !isIgnored ? '<span style="color:var(--green); font-weight:bold;">✔</span>' : (!isIgnored ? '<span class="status-badge error" style="flex-shrink:0;">Faltando</span>' : '<span style="color:gray; font-size:0.8rem;">Ignorado</span>')}
                    ${canEdit ? `<button onclick="window.openAttrEditor('${catAttr.id}')" title="Editar valor" class="btn-edit-clean" style="padding:2px;">${pencilSvg}</button>` : ''}
                    <button onclick="window.toggleIgnoreAttribute('${catAttr.id}', 'ad')" title="${isIgnored ? 'Incluir na pontuação' : 'Desconsiderar da pontuação'}" class="btn-ignore-clean ${isIgnored ? 'ignored' : ''}" style="padding:2px;">
                        ${isIgnored ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`}
                    </button>
                </div>
            </div>`;
        };

        // Build 2-column layout
        const missingHtml = missingAttrs.length > 0
            ? missingAttrs.map(({ catAttr, adValue }) => renderCatItem(catAttr, adValue, false)).join('')
            : '<p class="text-small" style="color:var(--green);">Todos preenchidos 🎉</p>';
        const filledHtml = filledAttrs.length > 0
            ? filledAttrs.map(({ catAttr, adValue }) => renderCatItem(catAttr, adValue, true)).join('')
            : '<p class="text-small">Nenhum preenchido.</p>';

        contentHtml = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                <div>
                    <div class="specs-group-title valid" style="margin-bottom:8px;">✅ Preenchidos (${filledAttrs.length})</div>
                    ${filledHtml}
                </div>
                <div>
                    <div class="specs-group-title problem" style="margin-bottom:8px;">⚠️ Faltando (${missingAttrs.length})</div>
                    ${missingHtml}
                </div>
            </div>`;
    }

    const totalItems = Array.isArray(categoryAttributes) ? categoryAttributes.filter(a => EDITABLE_TYPES.has(a.value_type) && !a.tags?.read_only).length : 0;

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.25s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📂</span>
                <span class="ana-card-title">Campos da Categoria</span>
                <span class="text-small" style="margin-left:auto; color:var(--text-muted);">${totalItems} campos</span>
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
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius);">
            <span style="font-weight:600; font-size:0.9rem;"><span style="margin-right:6px;">🛡️</span> Garantia</span>
            <span class="status-badge ${badgeClass}">${icon} ${text}</span>
        </div>
    `;
}

function exibirChecklistRapido(detail, descriptionData, containerId = "quickChecklist", performanceData = null) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // 3 sanity checks básicos (descrição, garantia, imagens) — SEMPRE renderizados
    const hasDesc = !!(descriptionData && ((descriptionData.plain_text && descriptionData.plain_text.trim()) || (descriptionData.text && descriptionData.text.trim())));
    const descSource = descriptionData?.source;
    const descSourceLabel = descSource === 'catalog' ? 'Herdada do catálogo' : (descSource === 'user_product' ? 'Herdada do produto (MLBU)' : 'Detectada');
    const hasWarranty = !!detail?.warranty;

    // Count images per variation (min 3 each)
    let imageDetail = '';
    let imageOk = true;
    const variations = detail?.variations || [];
    if (variations.length > 0) {
        const varProblems = [];
        variations.forEach((v, i) => {
            const picCount = v.picture_ids ? v.picture_ids.length : 0;
            const label = v.attribute_combinations ? v.attribute_combinations.map(a => a.value_name).join('/') : `Variação ${i+1}`;
            if (picCount < 3) {
                varProblems.push(`${label}: ${picCount} foto${picCount !== 1 ? 's' : ''}`);
                imageOk = false;
            }
        });
        const totalPics = detail?.pictures?.length || 0;
        if (varProblems.length > 0) {
            imageDetail = `${totalPics} fotos total — ${varProblems.length} variação(ões) com menos de 3: ${varProblems.join('; ')}`;
        } else {
            imageDetail = `${totalPics} fotos total — todas as ${variations.length} variações com 3+ fotos`;
        }
    } else {
        const imageCount = detail?.pictures?.length || 0;
        imageOk = imageCount >= 3;
        imageDetail = imageOk ? `${imageCount} fotos` : `Mínimo 3 fotos (tem ${imageCount})`;
    }

    const items = [
        { ok: hasDesc, label: 'Descrição em texto', detail: hasDesc ? descSourceLabel : 'Não preenchida' },
        { ok: hasWarranty, label: 'Garantia', detail: hasWarranty ? detail.warranty : 'Não informada' },
        { ok: imageOk, label: `Imagens${variations.length > 0 ? ` (${variations.length} variações)` : ''}`, detail: imageDetail },
    ];

    const renderItem = (item) => `
        <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; background:${item.ok ? 'var(--green-light)' : 'var(--red-light)'}; border-radius:var(--radius-sm); border-left:3px solid ${item.ok ? 'var(--green)' : 'var(--red)'};">
            <span style="font-size:1.1rem; flex-shrink:0;">${item.ok ? '✅' : '❌'}</span>
            <div style="flex:1;">
                <span style="font-weight:600; font-size:0.88rem; color:var(--text);">${item.label}</span>
                <span class="text-small" style="display:block; margin-top:1px;">${item.detail}</span>
            </div>
        </div>`;

    // Seção adicional: top 3 pendências da ML Quality API (quando disponível)
    const mlQuality = extractMLQualityItems(performanceData);
    let mlExtraHtml = '';
    if (mlQuality && mlQuality.pending.length > 0) {
        const top = mlQuality.pending.slice(0, 3);
        const moreLabel = mlQuality.pending.length > 3 ? `<div class="text-small" style="text-align:center; margin-top:4px; color:var(--text-muted); font-size:0.7rem;">+${mlQuality.pending.length - 3} em "Qualidade do Anúncio"</div>` : '';
        const renderMLRow = (p) => {
            const isWarn = p.mode === 'WARNING';
            const bg = isWarn ? 'var(--red-light)' : 'var(--yellow-light,#fef3c7)';
            const bd = isWarn ? 'var(--red)' : 'var(--yellow,#f59e0b)';
            const icon = isWarn ? '⚠️' : '💡';
            const linkHtml = p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" rel="noopener" style="color:var(--blue); text-decoration:none; font-weight:600; font-size:0.68rem; white-space:nowrap; flex-shrink:0;">${escapeHtml(p.label || 'Ver')} →</a>` : '';
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:${bg};border-radius:var(--radius-sm);border-left:3px solid ${bd};">
                <span style="flex-shrink:0;">${icon}</span>
                <span class="text-small" style="color:var(--text); flex:1; line-height:1.3;">${escapeHtml(p.text)}</span>
                ${linkHtml}
            </div>`;
        };
        mlExtraHtml = `
            <div style="margin-top:12px; padding-top:10px; border-top:1px dashed var(--border,#e5e7eb);">
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                    <span style="font-size:0.85rem;">⚡</span>
                    <span style="font-weight:700; font-size:0.75rem; color:var(--text); text-transform:uppercase; letter-spacing:0.03em;">Prioridades ML</span>
                    <span class="text-small" style="margin-left:auto; color:var(--text-muted); font-size:0.68rem;">${mlQuality.pending.length} pendências</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    ${top.map(renderMLRow).join('')}
                    ${moreLabel}
                </div>
            </div>`;
    }

    el.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">✅</span>
                <span class="ana-card-title">Checklist Rápido</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${items.map(renderItem).join('')}
            </div>
            ${mlExtraHtml}
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
        const displayName = tagSignificados[tag] || tag.replace(/_/g, ' ');
        const badge = `<span class="status-badge ${isAlertTag ? 'error' : (isGoodTag ? 'success' : 'muted')}" title="${tag}" style="cursor:help; font-size:0.72rem;">${displayName}</span>`;
        if (isAlertTag) alertTags.push(badge);
        else if (isGoodTag) goodTags.push(badge);
        else neutralTags.push(badge);
    });

    const renderCol = (title, icon, color, items) => {
        if (items.length === 0) return `<div><div style="font-size:0.78rem; font-weight:700; color:${color}; margin-bottom:8px;">${icon} ${title} (0)</div><div style="padding:12px; text-align:center; background:var(--row-alt); border-radius:var(--radius-sm); border:1px dashed var(--border);"><span class="text-small" style="color:var(--green);">✅ Tudo limpo!</span></div></div>`;
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
                <span class="text-small" style="margin-left:auto; color:var(--text-muted);">${tags.length} tags</span>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:16px;">
                ${renderCol('Boas Práticas', '✅', 'var(--green)', goodTags)}
                ${renderCol('Atenção', '⚠️', 'var(--red)', alertTags)}
                ${renderCol('Neutras', 'ℹ️', 'var(--text-muted)', neutralTags)}
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

    if (!performanceData || typeof performanceData !== 'object' || !performanceData.buckets) {
        perfEl.innerHTML = `
            <div class="ana-card" style="animation-delay: 0.3s;">
                <div class="ana-card-header"><span class="ana-card-icon">⚡</span><span class="ana-card-title">Qualidade do Anúncio (Mercado Livre)</span></div>
                <p class="text-small" style="color:var(--text-muted);">Qualidade ainda não calculada pelo ML. Os anúncios ativos do marketplace têm esse dado atualizado periodicamente.</p>
            </div>`;
        return;
    }

    const score = Math.round(performanceData.score || 0);
    const level = (performanceData.level || '').toLowerCase();
    // Mapeamento nível → cor/label
    const levelMap = {
        excellent: { color: 'var(--green)', bg: 'var(--green-light)', label: 'Excelente' },
        good: { color: 'var(--blue)', bg: 'rgba(0,102,255,0.1)', label: 'Bom' },
        fair: { color: 'var(--yellow)', bg: 'var(--yellow-light)', label: 'Regular' },
        poor: { color: 'var(--red)', bg: 'var(--red-light)', label: 'Ruim' },
        basic: { color: 'var(--yellow)', bg: 'var(--yellow-light)', label: 'Básico' },
        standard: { color: 'var(--blue)', bg: 'rgba(0,102,255,0.1)', label: 'Padrão' },
        premium: { color: 'var(--green)', bg: 'var(--green-light)', label: 'Premium' }
    };
    const lvl = levelMap[level] || (
        score >= 75 ? levelMap.good : (score >= 50 ? levelMap.fair : levelMap.poor)
    );
    const levelLabel = performanceData.level_wording || lvl.label;

    const buckets = Array.isArray(performanceData.buckets) ? performanceData.buckets.filter(b => b && typeof b === 'object') : [];

    // Contadores globais de pending / opportunity / warning
    let totalPending = 0, totalWarning = 0, totalOpportunity = 0;
    buckets.forEach(b => {
        (b.variables || []).forEach(v => {
            if (v.status === 'PENDING') totalPending++;
            (v.rules || []).forEach(r => {
                if (r.status === 'PENDING') {
                    if (r.mode === 'WARNING') totalWarning++;
                    else totalOpportunity++;
                }
            });
        });
    });

    const renderRule = (r, fallbackColor) => {
        const mode = r.mode || 'OPPORTUNITY';
        const isWarn = mode === 'WARNING';
        const ruleColor = isWarn ? 'var(--red)' : fallbackColor;
        const icon = isWarn ? '⚠️' : '💡';
        const title = r.wordings?.title || r.key || '';
        const link = r.wordings?.link;
        const label = r.wordings?.label || 'Ver';
        const linkHtml = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="color:var(--blue); text-decoration:none; font-weight:600; font-size:0.78rem; white-space:nowrap;">${escapeHtml(label)} →</a>` : '';
        return `
            <div style="display:flex; gap:8px; align-items:flex-start; margin-top:6px; padding:8px 10px; background:var(--bg-subtle,#f8fafc); border-left:3px solid ${ruleColor}; border-radius:var(--radius-sm);">
                <span style="font-size:0.85rem;">${icon}</span>
                <div style="flex:1; min-width:0;">
                    <div class="text-small" style="color:var(--text); line-height:1.35;">${escapeHtml(title)}</div>
                </div>
                ${linkHtml}
            </div>`;
    };

    const renderBucket = (bucket) => {
        const bScore = bucket.score !== undefined ? Math.round(bucket.score) : 0;
        const bLevel = bScore >= 85 ? 'good' : (bScore < 50 ? 'bad' : 'neutral');
        const color = bLevel === 'good' ? 'var(--green)' : (bLevel === 'bad' ? 'var(--red)' : 'var(--yellow)');
        const vars = Array.isArray(bucket.variables) ? bucket.variables : [];
        // Prioriza variáveis pendentes no topo
        vars.sort((a, b) => {
            const ap = a.status === 'PENDING' ? 0 : 1;
            const bp = b.status === 'PENDING' ? 0 : 1;
            return ap - bp;
        });
        let varsHtml = '';
        vars.forEach(v => {
            const vStatus = v.status || 'UNKNOWN';
            const isCompleted = vStatus === 'COMPLETED';
            const vColor = isCompleted ? 'var(--green)' : 'var(--yellow)';
            const icon = isCompleted ? '✓' : '○';
            const vScore = v.score !== undefined ? Math.round(v.score) : null;
            let rulesHtml = '';
            if (!isCompleted && Array.isArray(v.rules)) {
                v.rules.filter(r => r.status !== 'COMPLETED').forEach(r => { rulesHtml += renderRule(r, vColor); });
            }
            varsHtml += `
                <div style="padding:10px 0; border-bottom:1px solid var(--border,#e5e7eb);">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="color:${vColor}; font-weight:700; font-size:0.95rem;">${icon}</span>
                        <span style="flex:1; font-size:0.85rem; font-weight:600; color:var(--text);">${escapeHtml(v.title || v.key || '')}</span>
                        ${vScore !== null ? `<span style="font-family:var(--font-mono, 'DM Mono',monospace); font-size:0.75rem; color:${vColor}; font-weight:700;">${vScore}%</span>` : ''}
                    </div>
                    ${rulesHtml}
                </div>`;
        });
        return `
            <div style="border:1px solid var(--border,#e5e7eb); border-radius:var(--radius,8px); padding:14px 16px; border-top:3px solid ${color}; background:var(--bg-card,#fff);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-weight:700; font-size:0.92rem; color:var(--text);">${escapeHtml(bucket.title || bucket.key || '')}</span>
                    <span style="font-family:var(--font-mono, 'DM Mono',monospace); font-weight:700; font-size:1rem; color:${color};">${bScore}%</span>
                </div>
                ${varsHtml}
            </div>`;
    };

    const bucketsHtml = buckets.length > 0
        ? `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:14px; margin-top:14px;">${buckets.map(renderBucket).join('')}</div>`
        : '<p class="text-small" style="color:var(--text-muted);">Sem dados de diagnóstico por seção.</p>';

    // Header com score grande estilo trading — segue padrão dos outros cards
    const pendingBadge = totalPending > 0
        ? `<span style="background:${lvl.bg}; color:${lvl.color}; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">${totalPending} pendente${totalPending > 1 ? 's' : ''}</span>`
        : `<span style="background:var(--green-light); color:var(--green); padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">✓ Tudo em dia</span>`;

    const warnBadge = totalWarning > 0
        ? `<span style="background:var(--red-light); color:var(--red); padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700; margin-left:6px;">⚠ ${totalWarning} problema${totalWarning > 1 ? 's' : ''}</span>`
        : '';

    perfEl.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.3s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">⚡</span>
                <span class="ana-card-title">Qualidade do Anúncio (Mercado Livre)</span>
            </div>
            <div style="display:flex; align-items:center; gap:18px; padding:14px; background:linear-gradient(135deg, ${lvl.bg}, transparent); border-radius:var(--radius,8px); border:1px solid var(--border,#e5e7eb);">
                <div style="font-family:var(--font-mono, 'DM Mono',monospace); font-size:2.4rem; font-weight:800; color:${lvl.color}; line-height:1;">${score}<span style="font-size:1.2rem; color:var(--text-muted);">%</span></div>
                <div style="flex:1;">
                    <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:2px;">Nível atual</div>
                    <div style="font-weight:700; font-size:1.1rem; color:${lvl.color};">${escapeHtml(levelLabel)}</div>
                </div>
                <div style="text-align:right;">
                    ${pendingBadge}${warnBadge}
                    <div class="text-small" style="color:var(--text-muted); margin-top:6px; font-size:0.72rem;">Fonte: API Mercado Livre</div>
                </div>
            </div>
            ${bucketsHtml}
        </div>
    `;
}

// Exibe Experiência de Compra do Mercado Livre (API /reputation/items/{id}/purchase_experience/integrators)
function exibirExperienciaCompra(purchaseData, containerId = "purchaseExperience") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!purchaseData || typeof purchaseData !== 'object' || purchaseData.error) {
        el.innerHTML = `
            <div class="ana-card" style="animation-delay: 0.35s;">
                <div class="ana-card-header"><span class="ana-card-icon">🛒</span><span class="ana-card-title">Experiência de Compra (Mercado Livre)</span></div>
                <p class="text-small" style="color:var(--text-muted);">Dados de experiência de compra indisponíveis no momento.</p>
            </div>`;
        return;
    }

    const title = purchaseData.title?.text || purchaseData.title || '';
    const subtitles = Array.isArray(purchaseData.subtitles) ? purchaseData.subtitles : [];
    const actions = Array.isArray(purchaseData.actions) ? purchaseData.actions : [];
    const reputation = purchaseData.reputation || null;
    const statusRaw = purchaseData.status?.id || null;
    const statusTranslations = {
        active: 'Ativo', paused: 'Pausado', closed: 'Encerrado',
        under_review: 'Em revisão', inactive: 'Inativo', pending: 'Pendente'
    };
    const status = statusRaw ? (statusTranslations[statusRaw] || statusRaw) : null;
    const metricsDetails = purchaseData.metrics_details || null;
    const freeze = purchaseData.freeze?.text || '';

    // Interpola o texto dos subtitles da ML: {0}..{N} são substituídos por placeholders[N]
    // (ML usa "<b>"/"</b>" nos placeholders para destacar trechos em negrito).
    const renderSubtitleText = (s) => {
        const raw = (typeof s === 'string') ? s : (s?.text || '');
        const phs = Array.isArray(s?.placeholders) ? s.placeholders : [];
        const escapedText = escapeHtml(raw);
        return escapedText.replace(/\{(\d+)\}/g, (_m, idx) => {
            const ph = phs[+idx];
            if (ph == null) return '';
            return (ph === '<b>' || ph === '</b>') ? ph : escapeHtml(String(ph));
        });
    };

    // Mapa de cor da reputação ML (gray/green/yellow/orange/red)
    const repColorMap = {
        green: { c: 'var(--green)', bg: 'var(--green-light)', label: 'Ótima experiência' },
        yellow: { c: 'var(--yellow,#f59e0b)', bg: 'var(--yellow-light,#fef3c7)', label: 'Precisa de atenção' },
        orange: { c: '#f97316', bg: '#ffedd5', label: 'Alerta' },
        red: { c: 'var(--red)', bg: 'var(--red-light)', label: 'Crítico' },
        gray: { c: 'var(--text-muted)', bg: 'var(--bg-subtle,#f8fafc)', label: 'Sem dados suficientes' },
        light_gray: { c: 'var(--text-muted)', bg: 'var(--bg-subtle,#f8fafc)', label: 'Sem dados suficientes' }
    };
    const rep = reputation ? (repColorMap[reputation.color] || repColorMap.gray) : null;

    // Header principal
    let headerHtml = '';
    if (rep) {
        const repValueDisplay = (reputation.value != null && reputation.value >= 0) ? `${reputation.value}%` : '—';
        headerHtml = `
            <div style="display:flex; align-items:center; gap:16px; padding:14px; background:linear-gradient(135deg, ${rep.bg}, transparent); border-radius:var(--radius,8px); border:1px solid var(--border,#e5e7eb);">
                <div style="font-family:var(--font-mono, 'DM Mono',monospace); font-size:1.8rem; font-weight:800; color:${rep.c}; line-height:1;">${repValueDisplay}</div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:700; font-size:0.95rem; color:var(--text); line-height:1.3;">${escapeHtml(title || rep.label)}</div>
                    ${subtitles.length > 0 ? subtitles.map(s => `<div class="text-small" style="color:var(--text-muted); margin-top:3px; line-height:1.35;">${renderSubtitleText(s)}</div>`).join('') : ''}
                </div>
                <div style="text-align:right;">
                    <span style="background:${rep.bg}; color:${rep.c}; padding:4px 10px; border-radius:20px; font-size:0.72rem; font-weight:700;">${escapeHtml(rep.label)}</span>
                    ${status ? `<div class="text-small" style="color:var(--text-muted); margin-top:6px; font-size:0.7rem;">Status: ${escapeHtml(status)}</div>` : ''}
                </div>
            </div>`;
    } else {
        headerHtml = `
            <div style="padding:14px; background:var(--bg-subtle,#f8fafc); border-radius:var(--radius,8px); border:1px solid var(--border,#e5e7eb);">
                <div style="font-weight:700; font-size:0.95rem; color:var(--text); line-height:1.35;">${escapeHtml(title)}</div>
                ${subtitles.length > 0 ? subtitles.map(s => `<div class="text-small" style="color:var(--text-muted); margin-top:4px; line-height:1.35;">${renderSubtitleText(s)}</div>`).join('') : ''}
            </div>`;
    }

    // Freeze (alerta de congelamento) — quando houver
    const freezeHtml = freeze ? `
        <div style="margin-top:12px; padding:10px 14px; background:var(--red-light); border-radius:var(--radius-sm); border-left:3px solid var(--red);">
            <span class="text-small" style="color:var(--red-dark); font-weight:600;">🚨 ${escapeHtml(freeze)}</span>
        </div>` : '';

    // Ação recomendada — mensagem derivada dos problemas detectados
    // (as "actions" cruas do ML — "Alterar anúncio", "Pausar a partir da lista" — não fazem sentido fora da UI do Mercado Livre)
    let actionsHtml = '';
    const metricsProblems = (metricsDetails && Array.isArray(metricsDetails.problems)) ? metricsDetails.problems : [];
    if (metricsProblems.length > 0) {
        const recByKey = {
            DIFFERENT_FROM_REQUESTED: 'Verifique se seu anúncio corresponde ao produto enviado para evitar novos problemas.',
            PRODUCT_DEFECTIVE: 'Revise a qualidade e o controle do produto antes do envio para evitar reclamações.',
            PRODUCT_BROKEN: 'Reforce a embalagem para evitar avarias durante o transporte.',
            NOT_DELIVERED: 'Acompanhe os envios e confirme a postagem no prazo para evitar reclamações.',
            DELAYED: 'Revise seus prazos de postagem e logística para evitar atrasos.',
            SHIPPING: 'Revise os prazos e a logística de envio para evitar atrasos.'
        };
        const firstProblem = metricsProblems[0];
        const keyTwo = firstProblem?.level_two?.key || '';
        const recText = recByKey[keyTwo] || 'Verifique se seu anúncio corresponde ao produto enviado para evitar novos problemas.';
        actionsHtml = `
            <div style="margin-top:12px;">
                <div style="font-weight:700; font-size:0.78rem; color:var(--text); text-transform:uppercase; letter-spacing:0.03em; margin-bottom:6px;">Ação recomendada</div>
                <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--yellow-light,#fef3c7);border-radius:var(--radius-sm);border-left:3px solid var(--yellow,#f59e0b);">
                    <span style="flex-shrink:0;">💡</span>
                    <span class="text-small" style="color:var(--text); flex:1; line-height:1.4;">${escapeHtml(recText)}</span>
                </div>
            </div>`;
    }

    // Helper: extrai texto de um campo que pode ser string ou objeto {text, order}
    const fieldText = (f) => {
        if (f == null) return '';
        if (typeof f === 'string') return f;
        if (typeof f === 'object') return f.text || f.title || f.label || '';
        return String(f);
    };

    // Métricas detalhadas — problemas detectados e distribuição por período
    let metricsHtml = '';
    if (metricsDetails) {
        const problems = Array.isArray(metricsDetails.problems) ? metricsDetails.problems : [];
        const dist = metricsDetails.distribution || null;
        const empty = metricsDetails.empty_state_title || '';

        let problemsInner = '';

        // 1) Lista rica de problemas (quando a API traz metrics_details.problems)
        if (problems.length > 0) {
            const renderProblem = p => {
                const tag = fieldText(p.tag);
                const qty = fieldText(p.quantity);
                const l2 = fieldText(p.level_two?.title);
                const l3 = fieldText(p.level_three?.title);
                const remedy = fieldText(p.level_three?.remedy);
                const color = p.color || 'var(--red)';
                return `<div style="padding:10px 12px;background:var(--bg-subtle,#f8fafc);border-radius:var(--radius-sm);border-left:3px solid ${escapeHtml(color)};">
                    ${(tag || qty) ? `<div class="text-small" style="font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:0.68rem;letter-spacing:0.04em;margin-bottom:4px;">${escapeHtml(tag)}${(tag && qty) ? ' • ' : ''}${escapeHtml(qty)}</div>` : ''}
                    ${l2 ? `<div class="text-small" style="color:var(--text);font-weight:600;">${escapeHtml(l2)}</div>` : ''}
                    ${l3 ? `<div class="text-small" style="color:var(--text-muted);margin-top:2px;">${escapeHtml(l3)}</div>` : ''}
                    ${remedy ? `<div class="text-small" style="color:var(--text);margin-top:6px;padding:6px 8px;background:var(--yellow-light,#fef3c7);border-radius:var(--radius-sm);line-height:1.4;">💡 ${escapeHtml(remedy)}</div>` : ''}
                </div>`;
            };
            problemsInner += problems.map(renderProblem).join('');
        }

        // 2) Distribuição por categoria (level_one) — complementar
        if (dist && Array.isArray(dist.level_one) && dist.level_one.length > 0) {
            const renderLvl = l => {
                const title = fieldText(l.title) || fieldText(l.key) || '';
                const pct = (l.percentage != null) ? `${l.percentage}%` : (l.value != null ? l.value : '—');
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--bg-subtle,#f8fafc);border-radius:var(--radius-sm);">
                    <span class="text-small" style="color:var(--text);">${escapeHtml(title)}</span>
                    <span class="text-small" style="font-weight:700; color:var(--red);">${escapeHtml(String(pct))}</span>
                </div>`;
            };
            problemsInner += `<div style="display:flex; flex-direction:column; gap:4px; margin-top:${problems.length > 0 ? '8px' : '0'};">${dist.level_one.map(renderLvl).join('')}</div>`;
        }

        if (problemsInner) {
            metricsHtml = `
                <div style="margin-top:12px;">
                    <div style="font-weight:700; font-size:0.78rem; color:var(--text); text-transform:uppercase; letter-spacing:0.03em; margin-bottom:6px;">Problemas detectados</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">${problemsInner}</div>
                </div>`;
        } else if (empty) {
            metricsHtml = `
                <div style="margin-top:12px; padding:10px 14px; background:var(--green-light); border-radius:var(--radius-sm); border-left:3px solid var(--green);">
                    <span class="text-small" style="color:var(--green-dark); font-weight:600;">✓ ${escapeHtml(empty)}</span>
                </div>`;
        }
    }

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.35s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">🛒</span>
                <span class="ana-card-title">Experiência de Compra (Mercado Livre)</span>
            </div>
            ${headerHtml}
            ${freezeHtml}
            ${actionsHtml}
            ${metricsHtml}
        </div>
    `;
}

// Extrai items de checklist e score a partir da ML Quality API (item/{id}/performance)
function extractMLQualityItems(performanceData) {
    if (!performanceData || !Array.isArray(performanceData.buckets)) return null;
    const pending = [];
    const completed = [];
    performanceData.buckets.forEach(bucket => {
        const bucketLabel = bucket.title || bucket.key || '';
        (bucket.variables || []).forEach(v => {
            const title = v.title || v.key || '';
            if (v.status === 'COMPLETED') {
                completed.push({ text: title, bucket: bucketLabel });
            } else {
                const pendingRules = (v.rules || []).filter(r => r.status !== 'COMPLETED');
                if (pendingRules.length > 0) {
                    pendingRules.forEach(r => {
                        pending.push({
                            text: r.wordings?.title || title,
                            label: r.wordings?.label || null,
                            link: r.wordings?.link || null,
                            mode: r.mode || 'OPPORTUNITY',
                            bucket: bucketLabel
                        });
                    });
                } else {
                    pending.push({ text: title, bucket: bucketLabel, mode: 'OPPORTUNITY', link: null });
                }
            }
        });
    });
    return {
        pending,
        completed,
        score: Math.round(performanceData.score || 0),
        level: (performanceData.level || '').toLowerCase(),
        level_wording: performanceData.level_wording || null
    };
}

function exibirPontuacao(score, usedFallback = false, containerId = "scoreCircle", analysisData = null, checklistContainerId = "scoreChecklist", performanceData = null) {
    const el = document.getElementById(containerId);
    const checkEl = document.getElementById(checklistContainerId);
    if (!el) return;

    // ML Quality — ADICIONAL ao score heurístico (não substitui). Score grande continua sendo o heurístico MF.
    const mlQuality = extractMLQualityItems(performanceData);

    let level = 'bad';
    if (score >= 75) level = 'good'; else if (score >= 50) level = 'neutral';

    const defs = `
        <defs>
            <linearGradient id="gradientGood" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#00d68f;stop-opacity:1" />
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

    // Build improvement checklist — SEMPRE do heurístico do analysisData
    let improvementsHtml = '';
    let failedChecks = [];
    let passedChecks = [];
    if (analysisData) {
        const checks = [];
        const d = analysisData;
        // Title check
        const titleLen = (d.title || '').length;
        if (titleLen < 40) checks.push({ ok: false, text: `Título muito curto (${titleLen} chars)` });
        else if (titleLen < 50) checks.push({ ok: false, text: `Título poderia ser maior (${titleLen}/50+)` });
        else checks.push({ ok: true, text: 'Título otimizado' });
        // Description
        const hasDesc = !!((d.descriptionData?.plain_text?.trim()) || (d.descriptionData?.text?.trim()));
        const src = d.descriptionData?.source;
        const descText = hasDesc
            ? (src === 'catalog' ? 'Descrição herdada do catálogo' : (src === 'user_product' ? 'Descrição herdada do MLBU' : 'Descrição presente'))
            : 'Adicionar descrição em texto';
        checks.push({ ok: hasDesc, text: descText });
        // Warranty
        const hasWarranty = !!d.detail?.warranty;
        checks.push({ ok: hasWarranty, text: hasWarranty ? 'Garantia informada' : 'Informar garantia' });
        // Tags
        const hasBadTags = Array.isArray(d.detail?.tags) && d.detail.tags.some(t => TAGS_NEGATIVAS.has(t));
        checks.push({ ok: !hasBadTags, text: hasBadTags ? 'Tags negativas detectadas' : 'Sem tags negativas' });
        // Attributes (exclude ignored ones)
        const attrs = d.detail?.attributes || [];
        const stringAttrs = attrs.filter(a => a?.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id) && !window.ignoredAdAttributes.has(a.id));
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
                if (window.ignoredAdAttributes.has(c.id)) return false;
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

        failedChecks = checks.filter(c => !c.ok);
        passedChecks = checks.filter(c => c.ok);

    }

    // Badge extra quando temos ML Quality (exibido abaixo do score heurístico, sem remover nada)
    let mlBadgeHtml = '';
    if (mlQuality) {
        const levelIcons = { excellent: '🏆', premium: '🏆', good: '⭐', standard: '⭐', fair: '📈', basic: '📈', poor: '⛏️' };
        const iconML = levelIcons[mlQuality.level] || (mlQuality.score >= 75 ? '⭐' : mlQuality.score >= 50 ? '📈' : '⛏️');
        const mlLevelLabel = mlQuality.level_wording || mlQuality.level || '';
        const mlColor = mlQuality.score >= 75 ? 'var(--green)' : (mlQuality.score >= 50 ? 'var(--yellow,#f59e0b)' : 'var(--red)');
        mlBadgeHtml = `
            <div style="margin-top:8px; padding:6px 10px; background:var(--bg-subtle,#f8fafc); border-radius:var(--radius-sm); border:1px solid var(--border,#e5e7eb); display:flex; align-items:center; justify-content:center; gap:6px; width:100%;">
                <span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.03em;">ML</span>
                <span style="font-family:var(--font-mono, 'DM Mono',monospace); font-weight:800; font-size:0.95rem; color:${mlColor};">${mlQuality.score}%</span>
                <span style="font-size:0.72rem; color:${mlColor}; font-weight:600;">${iconML} ${escapeHtml(mlLevelLabel)}</span>
            </div>`;
    }

    // Score circle card
    el.innerHTML = `
        <div class="ana-card" style="align-items:center; text-align:center; justify-content:center;">
            ${celebration}
            <div class="score-circle-outer" style="width:110px; height:110px;">
                <svg viewBox="0 0 36 36" class="circular-chart">
                    ${defs}
                    <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path class="circle ${level}" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                </svg>
                <span class="score-number" style="font-size:2rem;">${score}</span>
            </div>
            <span class="status-badge ${level === 'good' ? 'success' : (level === 'neutral' ? 'muted' : 'error')}" style="font-size:0.68rem; margin-top:10px;">
                ${xpGainText}
            </span>
            ${usedFallback ? '<p class="text-small" style="margin-top:4px;">⚠ Estimativa</p>' : ''}
            ${mlBadgeHtml}
        </div>
    `;

    // Checklist card — heurístico original + seção ML ADICIONAL (quando disponível)
    if (checkEl) {
        // Seção ML extra: pendências reais do ML com deep links (além dos heurísticos)
        let mlSectionHtml = '';
        if (mlQuality && (mlQuality.pending.length > 0 || mlQuality.completed.length > 0)) {
            const renderMLRow = (p) => {
                const mode = p.mode || 'OPPORTUNITY';
                const isWarn = mode === 'WARNING';
                const cColor = isWarn ? 'var(--red)' : 'var(--yellow,#f59e0b)';
                const cBg = isWarn ? 'var(--red-light)' : 'var(--yellow-light,#fef3c7)';
                const icon = isWarn ? '⚠' : '○';
                const linkHtml = p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" rel="noopener" style="color:var(--blue); text-decoration:none; font-weight:600; font-size:0.7rem; white-space:nowrap; flex-shrink:0;">${escapeHtml(p.label || 'Resolver')} →</a>` : '';
                return `<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:${cBg};border-radius:var(--radius-sm);border-left:3px solid ${cColor};">
                    <span style="color:${cColor};font-weight:bold;flex-shrink:0;">${icon}</span>
                    <span class="text-small" style="color:var(--text); flex:1; line-height:1.3;">${escapeHtml(p.text)}</span>
                    ${linkHtml}
                </div>`;
            };
            const summaryHtml = mlQuality.pending.length === 0
                ? `<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--green-light);border-radius:var(--radius-sm);border-left:3px solid var(--green);"><span style="color:var(--green);font-weight:bold;">🎉</span><span class="text-small" style="color:var(--green-dark);">Todos os ${mlQuality.completed.length} critérios ML concluídos!</span></div>`
                : mlQuality.pending.map(renderMLRow).join('');
            mlSectionHtml = `
                <div style="margin-top:14px; padding-top:10px; border-top:1px dashed var(--border,#e5e7eb);">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                        <span style="font-size:0.85rem;">⚡</span>
                        <span style="font-weight:700; font-size:0.78rem; color:var(--text); text-transform:uppercase; letter-spacing:0.03em;">Ações Recomendadas pelo ML</span>
                        <span class="text-small" style="margin-left:auto; color:var(--text-muted); font-size:0.68rem;">${mlQuality.pending.length}/${mlQuality.pending.length + mlQuality.completed.length}</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        ${summaryHtml}
                    </div>
                </div>`;
        }

        checkEl.innerHTML = `
            <div class="ana-card" style="height:100%;">
                <div class="ana-card-header" style="padding-bottom:10px; margin-bottom:10px;">
                    <span class="ana-card-icon">📝</span>
                    <span class="ana-card-title">O que Melhorar</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                    ${failedChecks.map((c, i) => `<div class="check-fail-animate" style="display:flex;align-items:center;gap:8px;padding:4px 10px;background:var(--red-light);border-radius:var(--radius-sm);border-left:3px solid var(--red);animation-delay:${i*0.08}s;"><span style="color:var(--red);font-weight:bold;flex-shrink:0;">✖</span><span class="text-small" style="color:var(--red-dark);">${c.text}</span></div>`).join('')}
                    ${passedChecks.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:3px 10px;background:var(--green-light);border-radius:var(--radius-sm);border-left:3px solid var(--green);"><span style="color:var(--green);font-weight:bold;flex-shrink:0;">✔</span><span class="text-small" style="color:var(--green-dark);">${c.text}</span></div>`).join('')}
                </div>
                ${mlSectionHtml}
            </div>
        `;
    }

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
        console.warn('Token não encontrado na resposta.');
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
        console.warn('User ID não encontrado na resposta.');
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
        return data;
    } catch (error) {
        console.error(`Erro ao buscar dados:`, error.message);
        return null;
    }
}

async function fetchItemDetails(itemIds, accessToken) {
    const url = `${API_FETCH_ITEM_ENDPOINT}?item_id=${itemIds.join(',')}`;
    return fetchApiData(url, accessToken);
}

// Extrai qualquer texto de descrição de um payload (item, user-product ou catalog product).
function extractDescriptionText(data) {
    if (!data || typeof data !== 'object') return '';
    if (data.plain_text && String(data.plain_text).trim()) return String(data.plain_text).trim();
    if (data.text && String(data.text).trim()) return String(data.text).trim();
    if (data.short_description?.content && String(data.short_description.content).trim()) return String(data.short_description.content).trim();
    if (typeof data.description === 'string' && data.description.trim()) return data.description.trim();
    if (data.description?.plain_text && String(data.description.plain_text).trim()) return String(data.description.plain_text).trim();
    if (data.description?.text && String(data.description.text).trim()) return String(data.description.text).trim();
    if (Array.isArray(data.main_features) && data.main_features.length > 0) {
        const joined = data.main_features.map(f => (typeof f === 'string' ? f : f?.text || f?.content || '')).filter(Boolean).join('\n');
        if (joined.trim()) return joined.trim();
    }
    return '';
}

// Busca descrição herdada em cadeia: user-product (MLBU) → catalog_product. Retorna null se não achar.
async function fetchInheritedDescription(detail, accessToken) {
    // Tenta user-product primeiro (MLBU é a ficha do vendedor e pode ter descrição própria)
    if (detail?.user_product_id) {
        try {
            const up = await fetchApiData(`${API_USER_PRODUCTS_ENDPOINT}/${detail.user_product_id}`, accessToken);
            const txt = extractDescriptionText(up);
            if (txt) return { plain_text: txt, text: txt, source: 'user_product' };
        } catch (e) { console.warn('Falha ao buscar user-product:', e.message); }
    }
    // Catálogo oficial
    if (detail?.catalog_product_id) {
        try {
            const cat = await fetchApiData(`${BASE_URL_PROXY}/api/fetch-catalog?product_id=${detail.catalog_product_id}`, accessToken);
            const txt = extractDescriptionText(cat);
            if (txt) return { plain_text: txt, text: txt, source: 'catalog' };
        } catch (e) { console.warn('Falha ao buscar catálogo:', e.message); }
    }
    return null;
}

async function fetchPerformanceData(itemId, accessToken) { return fetchApiData(`${API_PERFORMANCE_ENDPOINT}?item_id=${itemId}`, accessToken); }
async function fetchPurchaseExperience(itemId, accessToken) {
    const raw = await fetchApiData(`${BASE_URL_PROXY}/api/purchase-experience?item_id=${itemId}`, accessToken);
    // Proxy retorna { [itemId]: {...} } — desembrulha
    return raw && raw[itemId] ? raw[itemId] : raw;
}
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

async function fetchAdsMetrics(itemId, accessToken, days = 30) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return fetchApiData(`${API_ADS_METRICS_ENDPOINT}?item_id=${itemId}&date_from=${from}&date_to=${to}`, accessToken);
}

window.reloadAdsMetrics = async function(days) {
    if (!window._adsItemId || !window._adsContainerId) return;
    // Refresh token in case it expired
    try {
        const freshToken = await fetchAccessToken();
        if (freshToken) window._adsAccessToken = freshToken;
    } catch(e) {}
    if (!window._adsAccessToken) return;
    const el = document.getElementById(window._adsContainerId);
    if (el) el.innerHTML = '<div class="ana-card" style="padding:30px; text-align:center;"><span class="text-small">Carregando ads (' + days + ' dias)...</span></div>';
    try {
        const data = await fetchAdsMetrics(window._adsItemId, window._adsAccessToken, days);
        exibirAdsMetrics(data, window._adsContainerId, days);
    } catch(e) {
        if (el) el.innerHTML = '<div class="ana-card"><p class="text-small error-message">Erro: ' + e.message + '</p></div>';
    }
};

function exibirAdsMetrics(adsData, containerId = "adsMetrics", activeDays = 30) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Store for reload
    window._adsContainerId = containerId;

    if (!adsData || !adsData.has_ads) {
        el.innerHTML = `
            <div class="ana-card">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📢</span>
                    <span class="ana-card-title">Product Ads</span>
                    <span class="status-badge muted" style="margin-left:auto;">Inativo</span>
                </div>
                <p class="text-small">Este anúncio não possui Product Ads ativo.</p>
            </div>`;
        return;
    }

    const daily = adsData.daily || [];
    const adInfo = adsData.ad_info || {};

    // --- 1. Calculate totals from daily data ---
    const sumField = (arr, field) => arr.reduce((s, d) => s + (d[field] || 0), 0);
    const totalImpressions = sumField(daily, 'prints');
    const totalClicks = sumField(daily, 'clicks');
    const totalCost = sumField(daily, 'cost');
    const totalOrders = sumField(daily, 'units_quantity');
    const totalRevenue = sumField(daily, 'total_amount');
    const totalOrganic = sumField(daily, 'organic_units_quantity');

    const totalOrganicRevenue = sumField(daily, 'organic_units_amount');
    const totalAllRevenue = totalRevenue + totalOrganicRevenue; // ads + organic revenue

    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';
    const acos = totalRevenue > 0 ? ((totalCost / totalRevenue) * 100).toFixed(1) : '0.0';
    const tacos = totalAllRevenue > 0 ? ((totalCost / totalAllRevenue) * 100).toFixed(1) : '0.0';
    const convRate = totalClicks > 0 ? ((totalOrders / totalClicks) * 100).toFixed(2) : '0.00';
    const cpc = totalClicks > 0 ? (totalCost / totalClicks) : 0;
    const roas = totalCost > 0 ? (totalRevenue / totalCost) : 0;

    // --- 2. Calculate trends: last half vs first half ---
    const sortedDaily = [...daily].sort((a, b) => new Date(a.date) - new Date(b.date));
    const halfIdx = Math.floor(sortedDaily.length / 2);
    const firstHalf = sortedDaily.slice(0, halfIdx);
    const lastHalf = sortedDaily.slice(halfIdx);

    const calcTrend = (lastArr, firstArr, field) => {
        const lastVal = sumField(lastArr, field);
        const firstVal = sumField(firstArr, field);
        if (firstVal === 0) return lastVal > 0 ? 100 : 0;
        return ((lastVal - firstVal) / firstVal * 100);
    };

    const calcRatioTrend = (lastArr, firstArr, numField, denField) => {
        const lastNum = sumField(lastArr, numField);
        const lastDen = sumField(lastArr, denField);
        const firstNum = sumField(firstArr, numField);
        const firstDen = sumField(firstArr, denField);
        const lastRatio = lastDen > 0 ? (lastNum / lastDen) : 0;
        const firstRatio = firstDen > 0 ? (firstNum / firstDen) : 0;
        if (firstRatio === 0) return lastRatio > 0 ? 100 : 0;
        return ((lastRatio - firstRatio) / firstRatio * 100);
    };

    const impTrend = calcTrend(lastHalf, firstHalf, 'prints');
    const clicksTrend = calcTrend(lastHalf, firstHalf, 'clicks');
    const ctrTrend = calcRatioTrend(lastHalf, firstHalf, 'clicks', 'prints');

    // ACOS trend: cost/revenue ratio
    const acosLastNum = sumField(lastHalf, 'cost');
    const acosLastDen = sumField(lastHalf, 'total_amount');
    const acosFirstNum = sumField(firstHalf, 'cost');
    const acosFirstDen = sumField(firstHalf, 'total_amount');
    const acosLast = acosLastDen > 0 ? (acosLastNum / acosLastDen) : 0;
    const acosFirst = acosFirstDen > 0 ? (acosFirstNum / acosFirstDen) : 0;
    const acosTrend = acosFirst > 0 ? ((acosLast - acosFirst) / acosFirst * 100) : (acosLast > 0 ? 100 : 0);

    const cvrTrend = calcRatioTrend(lastHalf, firstHalf, 'units_quantity', 'clicks');

    const _site = (typeof window !== 'undefined' && window.MF_currentSiteId) ? window.MF_currentSiteId() : 'MLB';
    const _cfg = (typeof window !== 'undefined' && window.MF_getSiteConfig) ? window.MF_getSiteConfig(_site) : { locale: 'pt-BR', currency: 'BRL' };
    const fmt = (n) => new Intl.NumberFormat(_cfg.locale).format(n);
    const fmtMoney = (n) => new Intl.NumberFormat(_cfg.locale, { style: 'currency', currency: _cfg.currency }).format(n);

    // Trend badge: green arrow up = good, red arrow down = bad
    // For ACOS, lower is better so invert the color logic
    const trendBadge = (val, invertColor = false) => {
        const n = parseFloat(val.toFixed(0));
        const isPositive = n > 0;
        const color = invertColor
            ? (isPositive ? 'var(--red)' : 'var(--green-dark)')
            : (isPositive ? 'var(--green-dark)' : 'var(--red)');
        const arrow = isPositive ? '&#9650;' : '&#9660;';
        if (Math.abs(n) < 1) return `<span style="color:var(--text-muted);font-size:0.72rem;">— estável</span>`;
        if (n <= -100) return `<span style="color:var(--text-muted);font-size:0.68rem;">sem dados recentes</span>`;
        if (n >= 500) return `<span style="color:${color};font-weight:600;font-size:0.72rem;">${arrow} +∞</span>`;
        return `<span style="color:${color};font-weight:600;font-size:0.72rem;">${arrow} ${Math.abs(n)}%</span>`;
    };

    // --- 3. Period buttons ---
    const periods = [7, 15, 30, 60, 90];
    const periodBtns = periods.map(d => `<button onclick="window.reloadAdsMetrics(${d})" style="padding:4px 12px; border-radius:4px; border:1px solid ${d === activeDays ? 'var(--blue)' : 'var(--border)'}; background:${d === activeDays ? 'var(--blue)' : 'var(--bg-card)'}; color:${d === activeDays ? '#fff' : 'var(--text-secondary)'}; font-size:0.75rem; font-weight:600; cursor:pointer; font-family:inherit; text-transform:none; letter-spacing:0;">${d}d</button>`).join('');

    const statusBadge = adInfo.status === 'active'
        ? '<span class="status-badge success">Ativo</span>'
        : `<span class="status-badge muted">${adInfo.status || 'Desconhecido'}</span>`;

    // --- 4. Metrics grid (5 columns) ---
    const metricCard = (label, value, trend, valueColor) => `
        <div style="text-align:center; padding:8px 6px; background:var(--row-alt); border-radius:var(--radius-sm); border:1px solid var(--border); min-width:0;">
            <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
            <div style="font-family:'DM Mono',monospace;font-size:1rem;font-weight:700;color:${valueColor || 'var(--text)'};">${value}</div>
            <div style="margin-top:2px;">${trend}</div>
        </div>`;

    // Campaign info (from adsData.campaign)
    const campaign = adsData.campaign || {};
    const campaignStrategy = campaign.strategy || '—';
    const campaignAcosTarget = campaign.acos_target || null;
    const campaignRoasTarget = campaign.roas_target || null;
    const campaignBudget = campaign.budget || null;
    const campaignName = campaign.name || '—';
    const adLevel = adInfo.current_level || null;

    const metricsGridHtml = `
        <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:8px; margin-bottom:16px;">
            ${metricCard('Impressões', fmt(totalImpressions), trendBadge(impTrend))}
            ${metricCard('Cliques', fmt(totalClicks), trendBadge(clicksTrend))}
            ${metricCard('CTR', ctr + '%', trendBadge(ctrTrend), parseFloat(ctr) >= 1 ? 'var(--green-dark)' : 'var(--red)')}
            ${metricCard('ACOS', acos + '%', trendBadge(acosTrend, true), parseFloat(acos) > 30 ? 'var(--red)' : (parseFloat(acos) > 15 ? 'var(--yellow)' : 'var(--green-dark)'))}
            ${metricCard('TACOS', tacos + '%', `<span style="font-size:0.65rem;color:var(--text-muted);">Fat. total: ${fmtMoney(totalAllRevenue)}</span>`, parseFloat(tacos) > 20 ? 'var(--red)' : (parseFloat(tacos) > 10 ? 'var(--yellow)' : 'var(--green-dark)'))}
            ${metricCard('Conversão', convRate + '%', trendBadge(cvrTrend), parseFloat(convRate) >= 5 ? 'var(--green-dark)' : 'var(--red)')}
        </div>
        ${campaign.name ? `
        <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--navy);border-radius:4px;"><span style="font-size:0.65rem;color:rgba(255,255,255,0.5);">Campanha:</span><span style="font-size:0.78rem;font-weight:600;color:#fff;">${campaignName}</span></div>
            <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--row-alt);border-radius:4px;border:1px solid var(--border);"><span style="font-size:0.65rem;color:var(--text-muted);">Estratégia:</span><span style="font-size:0.78rem;font-weight:600;">${campaignStrategy}</span></div>
            ${campaignAcosTarget ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--blue-light);border-radius:4px;"><span style="font-size:0.65rem;color:var(--text-muted);">Meta ACOS:</span><span style="font-family:'DM Mono',monospace;font-size:0.78rem;font-weight:600;color:${parseFloat(acos) <= campaignAcosTarget ? 'var(--green-dark)' : 'var(--red)'};">${campaignAcosTarget}%</span></div>` : ''}
            ${campaignRoasTarget ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--row-alt);border-radius:4px;border:1px solid var(--border);"><span style="font-size:0.65rem;color:var(--text-muted);">Meta ROAS:</span><span style="font-family:'DM Mono',monospace;font-size:0.78rem;font-weight:600;color:${roas >= campaignRoasTarget ? 'var(--green-dark)' : 'var(--red)'};">${campaignRoasTarget.toFixed(1)}x</span></div>` : ''}
            ${campaignBudget ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--row-alt);border-radius:4px;border:1px solid var(--border);"><span style="font-size:0.65rem;color:var(--text-muted);">Orçamento:</span><span style="font-family:'DM Mono',monospace;font-size:0.78rem;font-weight:600;">${fmtMoney(campaignBudget)}</span></div>` : ''}
            ${adLevel ? `<div style="display:flex;align-items:center;gap:4px;padding:4px 10px;background:${adLevel === 'green' ? 'var(--green-light)' : (adLevel === 'yellow' ? 'var(--yellow-light)' : 'var(--red-light)')};border-radius:4px;"><span style="width:6px;height:6px;border-radius:50%;background:${adLevel === 'green' ? 'var(--green)' : (adLevel === 'yellow' ? 'var(--yellow)' : 'var(--red)')};"></span><span style="font-size:0.72rem;font-weight:600;">Nível: ${adLevel}</span></div>` : ''}
        </div>` : ''}`;

    // --- 5. Navy ticker bar ---
    const tickerHtml = `
        <div style="display:flex; gap:16px; flex-wrap:wrap; padding:10px 14px; background:var(--navy); border-radius:var(--radius-sm); color:#fff; margin-bottom:12px; align-items:center;">
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Custo</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;">${fmtMoney(totalCost)}</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Faturamento</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;color:var(--green);">${fmtMoney(totalRevenue)}</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Vendas Ads</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;">${fmt(totalOrders)}</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Vendas Orgânicas</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;">${fmt(totalOrganic)}</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">ROAS</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;color:${roas >= 3 ? 'var(--green)' : 'var(--red)'};">${roas.toFixed(1)}x</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">CPC Médio</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;">${fmtMoney(cpc)}</span></div>
        </div>`;

    // --- 6. Chart 1 - ACOS Diário (Chart.js) ---
    let acosChartHtml = '';
    const acosCanvasId = 'acosChart_' + Date.now();
    let _acosChartData = null;
    if (sortedDaily.length > 0) {
        const dailyAcosValues = sortedDaily.map(d => {
            const rev = d.total_amount || 0;
            return rev > 0 ? parseFloat(((d.cost || 0) / rev * 100).toFixed(1)) : 0;
        });
        const acosLabels = sortedDaily.map(d => d.date ? new Date(d.date).toLocaleDateString(_cfg ? _cfg.locale : 'pt-BR', { day: '2-digit', month: '2-digit' }) : '');
        const acosColors = dailyAcosValues.map(v => v > 30 ? '#ff3b5c' : (v > 15 ? '#f59e0b' : '#00d68f'));

        _acosChartData = { labels: acosLabels, values: dailyAcosValues, colors: acosColors, target: campaignAcosTarget };

        acosChartHtml = `
            <div class="chart-card">
                <div class="chart-card-header">
                    <span class="chart-card-icon">📊</span>
                    <span class="chart-card-label">ACOS Diário</span>
                </div>
                <div class="chart-card-body" style="height:200px;position:relative;">
                    <canvas id="${acosCanvasId}"></canvas>
                </div>
            </div>`;
    }

    // --- 7. Chart 2 - Visitas Ads vs Orgânico + Linha de Impressões (Chart.js) ---
    let visitsAdsChartHtml = '';
    const visitsCanvasId = 'visitsAdsChart_' + Date.now();
    let _visitsChartData = null;
    const visitsResults = window.currentAnalysisState?.visitsData?.results || [];
    if (sortedDaily.length > 0) {
        // Build maps by date
        const adsClicksByDate = {};
        const adsPrintsByDate = {};
        sortedDaily.forEach(d => {
            if (d.date) {
                const key = d.date.substring(0, 10);
                adsClicksByDate[key] = d.clicks || 0;
                adsPrintsByDate[key] = d.prints || 0;
            }
        });

        // Match visits with ads per day
        const sortedVisits = visitsResults.length > 0
            ? [...visitsResults].sort((a, b) => new Date(a.date) - new Date(b.date))
            : sortedDaily.map(d => ({ date: d.date, total: d.clicks || 0 }));

        const entries = sortedVisits.map(v => {
            const dateKey = v.date ? v.date.substring(0, 10) : '';
            const total = v.total || 0;
            const adsClicks = Math.min(total, adsClicksByDate[dateKey] || 0);
            const prints = adsPrintsByDate[dateKey] || 0;
            return { date: v.date, total, ads: adsClicks, organic: Math.max(0, total - adsClicks), prints };
        });

        const visitsLabels = entries.map(e => e.date ? new Date(e.date).toLocaleDateString(_cfg ? _cfg.locale : 'pt-BR', { day: '2-digit', month: '2-digit' }) : '');
        const organicData = entries.map(e => e.organic);
        const adsData = entries.map(e => e.ads);
        const impressionsData = entries.map(e => e.prints);

        _visitsChartData = { labels: visitsLabels, organic: organicData, ads: adsData, impressions: impressionsData };

        // Total ads vs organic for ratio bar
        let totalVisitsSum = entries.reduce((s, e) => s + e.total, 0);
        let totalAdsSum = entries.reduce((s, e) => s + e.ads, 0);
        const adsPctTotal = totalVisitsSum > 0 ? ((totalAdsSum / totalVisitsSum) * 100) : 0;
        const orgPctTotal = 100 - adsPctTotal;

        visitsAdsChartHtml = `
            <div class="chart-card">
                <div class="chart-card-header">
                    <span class="chart-card-icon">📊</span>
                    <span class="chart-card-label">Visitas Diárias: Ads vs Orgânico + Impressões</span>
                </div>
                <div class="chart-card-body" style="height:220px;position:relative;">
                    <canvas id="${visitsCanvasId}"></canvas>
                </div>
            </div>
            <div style="margin-top:10px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-size:0.68rem;color:var(--text-muted);">Composição do tráfego (${activeDays}d)</span>
                    <span style="font-size:0.68rem;color:var(--text-muted);">${fmt(totalAdsSum)} ads / ${fmt(totalVisitsSum)} total</span>
                </div>
                <div style="height:12px;border-radius:6px;background:var(--border);overflow:hidden;display:flex;">
                    <div style="width:${adsPctTotal}%;background:var(--blue);display:flex;align-items:center;justify-content:center;">
                        ${adsPctTotal > 8 ? `<span style="font-size:0.5rem;color:#fff;font-weight:700;">${adsPctTotal.toFixed(0)}%</span>` : ''}
                    </div>
                    <div style="flex:1;background:var(--green);display:flex;align-items:center;justify-content:center;">
                        ${orgPctTotal > 8 ? `<span style="font-size:0.5rem;color:#fff;font-weight:700;">${orgPctTotal.toFixed(0)}%</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:2px;">
                    <span style="font-size:0.62rem;color:var(--blue);font-weight:600;">Ads ${adsPctTotal.toFixed(1)}%</span>
                    <span style="font-size:0.62rem;color:var(--green-dark);font-weight:600;">Orgânico ${orgPctTotal.toFixed(1)}%</span>
                </div>
            </div>`;
    }

    // --- 8. Chart 3 - Vendas: Ads vs Orgânico (horizontal ratio bar) ---
    let salesRatioHtml = '';
    const totalSales = totalOrders + totalOrganic;
    if (totalSales > 0) {
        const adsSalesPct = (totalOrders / totalSales) * 100;
        const orgSalesPct = (totalOrganic / totalSales) * 100;

        salesRatioHtml = `
            <div style="margin-top:16px;">
                <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:6px;">Vendas: Ads vs Orgânico</div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:0.72rem;color:var(--text-muted);">${fmt(totalOrders)} ads / ${fmt(totalOrganic)} orgânicas / ${fmt(totalSales)} total</span>
                </div>
                <div style="height:14px;border-radius:7px;background:var(--border);overflow:hidden;display:flex;">
                    <div style="width:${adsSalesPct}%;background:var(--blue);border-radius:7px 0 0 7px;display:flex;align-items:center;justify-content:center;" title="Ads: ${adsSalesPct.toFixed(1)}%">
                        ${adsSalesPct > 10 ? `<span style="font-size:0.55rem;color:#fff;font-weight:700;">${adsSalesPct.toFixed(0)}%</span>` : ''}
                    </div>
                    <div style="flex:1;background:var(--green);display:flex;align-items:center;justify-content:center;" title="Orgânico: ${orgSalesPct.toFixed(1)}%">
                        ${orgSalesPct > 10 ? `<span style="font-size:0.55rem;color:#fff;font-weight:700;">${orgSalesPct.toFixed(0)}%</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:3px;">
                    <span style="font-size:0.65rem;color:var(--blue);font-weight:600;">Ads ${adsSalesPct.toFixed(1)}%</span>
                    <span style="font-size:0.65rem;color:var(--green-dark);font-weight:600;">Orgânico ${orgSalesPct.toFixed(1)}%</span>
                </div>
            </div>`;
    }

    // --- Render ---
    el.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">📢</span>
                <span class="ana-card-title">Product Ads</span>
                ${statusBadge}
                <div style="margin-left:auto; display:flex; gap:3px; align-items:center; flex-wrap:wrap;">
                    ${periodBtns}
                </div>
            </div>

            ${metricsGridHtml}
            ${tickerHtml}
            ${acosChartHtml}
            ${visitsAdsChartHtml}
            ${salesRatioHtml}
        </div>
    `;

    // --- Chart.js initialization (after innerHTML is set) ---
    setTimeout(() => {
        if (typeof Chart === 'undefined') return;

        // ACOS Diário chart
        if (_acosChartData) {
            const acosCtx = document.getElementById(acosCanvasId);
            if (acosCtx) {
                new Chart(acosCtx, {
                    type: 'bar',
                    data: {
                        labels: _acosChartData.labels,
                        datasets: [{
                            label: 'ACOS %',
                            data: _acosChartData.values,
                            backgroundColor: _acosChartData.colors,
                            borderRadius: 3,
                            borderSkipped: false,
                            barPercentage: 0.85,
                            categoryPercentage: 0.9
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 600 },
                        scales: {
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
                                border: { display: false }
                            },
                            y: {
                                grid: { color: 'rgba(148,163,184,0.1)' },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#94a3b8', callback: v => v + '%' },
                                border: { display: false },
                                beginAtZero: true
                            }
                        },
                        plugins: {
                            title: { display: false },
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: '#0f172a',
                                titleColor: '#fff',
                                bodyColor: '#00d68f',
                                borderColor: 'rgba(0,102,255,0.3)',
                                borderWidth: 1,
                                padding: 12,
                                cornerRadius: 8,
                                displayColors: true,
                                callbacks: {
                                    label: function(ctx) { return 'ACOS: ' + ctx.parsed.y + '%'; }
                                }
                            },
                            annotation: _acosChartData.target ? {
                                annotations: {
                                    acosTarget: {
                                        type: 'line',
                                        yMin: _acosChartData.target,
                                        yMax: _acosChartData.target,
                                        borderColor: '#ff3b5c',
                                        borderWidth: 1.5,
                                        borderDash: [6, 4],
                                        label: {
                                            display: true,
                                            content: 'Meta ' + _acosChartData.target + '%',
                                            position: 'end',
                                            backgroundColor: 'rgba(255,59,92,0.85)',
                                            color: '#fff',
                                            font: { size: 9, weight: 'bold' },
                                            padding: { top: 2, bottom: 2, left: 6, right: 6 },
                                            borderRadius: 4
                                        }
                                    }
                                }
                            } : undefined
                        }
                    }
                });
            }
        }

        // Visitas Ads vs Orgânico + Impressões chart
        if (_visitsChartData) {
            const visitsCtx = document.getElementById(visitsCanvasId);
            if (visitsCtx) {
                new Chart(visitsCtx, {
                    type: 'bar',
                    data: {
                        labels: _visitsChartData.labels,
                        datasets: [
                            {
                                label: 'Orgânico',
                                data: _visitsChartData.organic,
                                backgroundColor: '#00d68f',
                                borderRadius: 3,
                                borderSkipped: false,
                                stack: 'visits',
                                order: 2
                            },
                            {
                                label: 'Ads',
                                data: _visitsChartData.ads,
                                backgroundColor: '#0066ff',
                                borderRadius: 3,
                                borderSkipped: false,
                                stack: 'visits',
                                order: 1
                            },
                            {
                                label: 'Impressões',
                                data: _visitsChartData.impressions,
                                type: 'line',
                                borderColor: '#f59e0b',
                                backgroundColor: 'rgba(245,158,11,0.1)',
                                borderWidth: 2,
                                borderDash: [5, 3],
                                pointRadius: 2,
                                pointBackgroundColor: '#f59e0b',
                                pointBorderColor: '#f59e0b',
                                fill: false,
                                yAxisID: 'y1',
                                order: 0
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 600 },
                        scales: {
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
                                border: { display: false },
                                stacked: true
                            },
                            y: {
                                grid: { color: 'rgba(148,163,184,0.1)' },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#94a3b8' },
                                border: { display: false },
                                beginAtZero: true,
                                stacked: true,
                                title: { display: true, text: 'Visitas', font: { size: 9 }, color: '#94a3b8' }
                            },
                            y1: {
                                position: 'right',
                                grid: { display: false },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#f59e0b' },
                                border: { display: false },
                                beginAtZero: true,
                                title: { display: true, text: 'Impressões', font: { size: 9 }, color: '#f59e0b' }
                            }
                        },
                        plugins: {
                            title: { display: false },
                            legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'rectRounded', padding: 14, font: { size: 10 }, color: '#94a3b8' } },
                            tooltip: {
                                backgroundColor: '#0f172a',
                                titleColor: '#fff',
                                bodyColor: '#00d68f',
                                borderColor: 'rgba(0,102,255,0.3)',
                                borderWidth: 1,
                                padding: 12,
                                cornerRadius: 8,
                                displayColors: true,
                                callbacks: {
                                    afterBody: function(items) {
                                        const idx = items[0]?.dataIndex;
                                        if (idx == null) return '';
                                        const org = _visitsChartData.organic[idx] || 0;
                                        const ads = _visitsChartData.ads[idx] || 0;
                                        const total = org + ads;
                                        const adsPct = total > 0 ? ((ads / total) * 100).toFixed(0) : '0';
                                        return 'Total: ' + total + ' | Ads: ' + adsPct + '%';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
    }, 100);
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
                const imgsHtml = data.pics.map(p => `<img src="${p.secure_url}" style="width:40px; height:40px; object-fit:cover; border-radius:5px; border:1px solid var(--border);" alt="Img">`).join('');
                const varId = data.variId || (data.varIds ? data.varIds[0] : 'geral');
                html += `
                <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:var(--row-alt); display:flex; flex-direction:column; justify-content:space-between;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-size:0.78rem; font-weight:700; color:var(--text);">${label}</span>
                        <span style="font-size:0.68rem; color:var(--text-muted);">${data.pics.length} fotos</span>
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
                style="padding:5px 14px; font-size:0.75rem; border-radius:20px; border:1px solid ${isActive ? 'var(--blue)' : 'var(--border)'}; background:${isActive ? 'var(--blue)' : 'var(--bg-card)'}; color:${isActive ? '#fff' : 'var(--text-muted)'}; cursor:pointer; transition:all 0.2s; font-weight:${isActive ? '600' : '400'};">${opt}</button>`;
        });
        tabsHtml += '</div>';

        picturesHtml = tabsHtml + `<div id="${containId}">${buildVariationCards(defaultGroup)}</div>`;

        // Store builder function globally for tab switching
        window._varBuilders = window._varBuilders || {};
        window._varBuilders[containId] = buildVariationCards;
        window._switchVarGroup = function (btn, cId, group) {
            document.getElementById(cId).innerHTML = window._varBuilders[cId](group);
            btn.parentElement.querySelectorAll('button').forEach(b => {
                b.style.background = 'var(--bg-card)'; b.style.color = 'var(--text-muted)'; b.style.borderColor = 'var(--border)'; b.style.fontWeight = '400';
            });
            btn.style.background = 'var(--blue)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--blue)'; btn.style.fontWeight = '600';
        };
    } else if (detail.pictures && detail.pictures.length > 0) {
        picturesHtml = `
            <div style="margin-bottom: 12px; border: 1px solid rgba(226, 232, 240, 0.6); border-radius: var(--radius-sm); padding: 12px; background: var(--row-alt);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-size:0.85rem; font-weight:bold; color:var(--text);">Imagens Gerais</span>
                    <button class="nerd-button" style="padding: 6px 12px; font-size: 0.8rem;" onclick="iniciarAnaliseIA('${detail.id}', 'geral')">
                        🪄 Analisar Imagens
                    </button>
                </div>
                <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;">`;
        detail.pictures.forEach(pic => {
            picturesHtml += `<img src="${pic.secure_url}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); flex-shrink: 0;" alt="Img">`;
        });
        picturesHtml += `</div>
            <div id="aiImageResult_geral" style="margin-top: 10px; display: none;"></div>
            </div>`;
    } else {
        picturesHtml = '<p class="text-small muted">O anúncio não possui imagens para analisar.</p>';
    }

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.15s; position: relative; overflow: hidden; grid-column: 1 / -1;">
            <div style="position: absolute; top: -50px; right: -50px; width: 100px; height: 100px; background: var(--blue); opacity: 0.1; filter: blur(30px); border-radius: 50%;"></div>
            <div class="ana-card-header" style="margin-bottom: 15px;">
                <span class="ana-card-icon">✨</span>
                <span class="ana-card-title">Analisador de Imagens por IA</span>
                <span class="status-badge success" style="margin-left:auto; background: linear-gradient(135deg, #a855f7, #6366f1); color: white; border: none;">Beta</span>
            </div>
            <p class="text-small" style="margin-bottom:15px; color:var(--text-muted);">As fotos do anúncio são separadas pelas suas variações correspondentes. A IA identificará pontos fortes e melhorias específicas de exposição e quebra de objeções.</p>
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
    resEl.innerHTML = `<p class="text-small" style="color:var(--blue); margin:0;">Processando imagens via IA... ⏳</p>`;
    try {
        const token = window.currentAnalysisState ? window.currentAnalysisState.accessToken : ''; // Optional
        const r = await fetch('${API_ANALYZE_IMAGE_ENDPOINT}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId, variation_id: variationId })
        });
        if (!r.ok) throw new Error('Falha na requisição');
        const data = await r.json();
        resEl.innerHTML = `<div style="background:var(--blue-light); padding: 12px; border-radius: var(--radius-sm); border-left: 3px solid var(--blue);"><p class="text-small">${data.analysis || 'Análise concluída com sucesso!'}</p></div>`;
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
                <p class="text-small" style="color: var(--text-muted); font-style:italic;">${motivo}</p>
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
        const lineColor = colorClass === 'success' ? 'var(--green)' : (colorClass === 'error' ? 'var(--red)' : 'var(--blue)');
        const hoverColor = colorClass === 'success' ? 'var(--green-dark)' : (colorClass === 'error' ? 'var(--red-dark)' : 'var(--blue)');

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
                    <span class="text-small" style="text-align:center; color:var(--text-muted); display:block; margin-top:2px;">30 dias</span>
                </div>
                <div class="trend-stats" style="flex-grow:1; display:flex; flex-direction:column; justify-content:center; gap:6px;">
                    <div class="trend-row" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="text-small" style="color:var(--text-muted);">Últimos 7 dias</span> 
                        <span class="text-value" style="font-weight:600;">${total7} <span style="font-size:0.7rem; font-weight:bold; padding:2px 6px; border-radius:4px; margin-left:4px; color:${percentChange7 > 0 ? 'var(--green-dark)' : (percentChange7 < 0 ? 'var(--red-dark)' : 'var(--text-secondary)')}; background-color:${percentChange7 > 0 ? 'var(--green-light)' : (percentChange7 < 0 ? 'var(--red-light)' : 'var(--border)')};">${percentChange7 > 0 ? '+' : ''}${percentChange7.toFixed(1)}%</span></span>
                    </div>
                    <div class="trend-row" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="text-small" style="color:var(--text-muted);">Últimos 15 dias</span> 
                        <span class="text-value" style="font-weight:600;">${total15}</span>
                    </div>
                    <div class="trend-row" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="text-small" style="color:var(--text-muted);">Mês (30 dias)</span> 
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
                    <p class="text-small" style="color: var(--text); font-style: italic;">"${rev.content || 'Sem comentário'}"</p>
                </div>
            `;
        });
    }

    html += '</div></div>';
    el.innerHTML = html;
}

async function analisarAnuncio(itemIdToAnalyze = null, append = false) {
    const loader = document.getElementById('loadingIndicator');
    const loadingStep = document.getElementById('loadingStep');
    const loadingFill = document.getElementById('loadingFill');

    const setLoading = (text, pct) => {
        if (loadingStep) loadingStep.textContent = text;
        if (loadingFill) loadingFill.style.width = pct + '%';
    };

    try {
        if (loader) {
            setLoading('Analisando...', 10);
            loader.style.display = 'block';
        }

        if (!append) {
            clearResults();
        }

        let parsed = null;

        if (itemIdToAnalyze) {
            // Called programmatically with an MLB ID (from MLBU item click)
            parsed = { id: itemIdToAnalyze, type: 'mlb' };
        } else {
            const inputEl = document.getElementById('input-url');
            if (inputEl) {
                const val = inputEl.value.trim();
                if (val) parsed = normalizeMlbId(val);
            }
        }

        if (!parsed) {
            appendError('ID ou link inválido. Formato: MLB/MCO/MLA/MLM/MLC/MLU (+ U opcional) + números, link de anúncio ou link de catálogo (/p/...).');
            return;
        }

        const itemId = parsed.id;
        // Detecta site_id do item e torna ATIVO (formatters moeda/locale usam MF_CURRENT_SITE)
        const detectedSite = (window.MF_siteIdFromItemId ? window.MF_siteIdFromItemId(itemId) : 'MLB');
        window.MF_CURRENT_SITE = detectedSite;
        console.log(`--- Iniciando Análise: ${itemId} (tipo: ${parsed.type}, site: ${detectedSite}) ---`);
        let accessToken, userId, detail = null, fetchError = null, usedFallback = false, performanceData = null, visitsData = null, reviewsData = null, descriptionData = null, categoryAttributes = null, adsData = null, purchaseExperienceData = null;

        try {
            [accessToken, userId] = await Promise.all([fetchAccessToken(), fetchUserIdForScraping()]);
            if (!accessToken) console.warn('Access Token indisponível.');
            if (!userId) console.warn('User ID indisponível.');
        } catch (e) {
            console.error("Erro ao buscar credenciais:", e);
            fetchError = new Error('Falha crítica ao obter credenciais da aplicação.');
            fetchError.isAuthError = true;
        }

        let isMlbu = parsed.type === 'mlbu';
        let isCatalog = parsed.type === 'catalog';

        if (accessToken && !fetchError) {
            try {
                if (isCatalog) {
                    // --- CATALOG FLOW ---
                    setLoading('Buscando dados do catálogo...', 20);
                    let catalogData = null;
                    try {
                        catalogData = await fetchApiData(`${BASE_URL_PROXY}/api/fetch-catalog?product_id=${itemId}&site_id=${detectedSite}`, accessToken);
                    } catch(e) {
                        throw new Error(`Catálogo ${itemId} não encontrado ou sem permissão.`);
                    }
                    if (!catalogData || !catalogData.name) {
                        throw new Error(`Catálogo ${itemId} não encontrado. Verifique o link.`);
                    }

                    // Get ML seller_id via /users/me + fetch linked items + category attrs
                    let sellerItems = [];
                    let categoryAttrsForCatalog = null;
                    try {
                        setLoading('Buscando seus anúncios neste catálogo...', 40);
                        const meData = await fetchApiData(`${BASE_URL_PROXY}/api/users/me`, accessToken);
                        if (meData?.id) {
                            const catalogItemsData = await fetchApiData(`${BASE_URL_PROXY}/api/catalog-items?catalog_product_id=${itemId}&seller_id=${meData.id}&site_id=${detectedSite}`, accessToken);
                            if (catalogItemsData?.results?.length > 0) {
                                sellerItems = catalogItemsData.results;
                            }
                        }
                        // Fetch category attributes using category from linked item or domain
                        if (sellerItems.length > 0) {
                            setLoading('Buscando atributos da categoria...', 60);
                            const sampleItem = await fetchItemDetails([sellerItems[0]], accessToken);
                            const catId = sampleItem?.[0]?.body?.category_id;
                            if (catId) {
                                categoryAttrsForCatalog = await fetchCategoryAttributes(catId, accessToken);
                            }
                        }
                    } catch (e) {
                        console.warn('Não foi possível buscar dados completos do catálogo:', e.message);
                    }

                    // Save catalog URL for "back" button
                    window.lastCatalogUrl = itemId;
                    await displayCatalogResults(catalogData, sellerItems, accessToken, categoryAttrsForCatalog);
                    return;
                } else if (isMlbu) {
                    const mlbuData = await fetchApiData(`${API_USER_PRODUCTS_ENDPOINT}/${itemId}`, accessToken);
                    if (mlbuData?.id) {
                        detail = transformMlbuData(mlbuData);
                        console.log('Dados do Produto (MLBU) OK.');

                        const itemsData = await fetchApiData(`${API_USER_PRODUCTS_ENDPOINT}/${itemId}/items?seller_id=${detail.seller_id}`, accessToken);
                        if (itemsData?.results?.length > 0) {
                            setLoading('Buscando detalhes dos anúncios...', 70);
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
                    if (itemData?.code === 200 && itemData?.body?.id) {
                        detail = itemData.body;
                        descriptionData = itemData.description || detail.description;
                        console.log('Dados da API de Itens OK.');

                        // Anúncios UP/catálogo: descrição pode viver no user-product (MLBU) ou no catálogo.
                        // Fallback em cadeia: item → user-product → catalog_product.
                        const hasInlineDesc = !!(descriptionData?.plain_text?.trim() || descriptionData?.text?.trim());
                        if (!hasInlineDesc) {
                            const inheritedDesc = await fetchInheritedDescription(detail, accessToken);
                            if (inheritedDesc) {
                                descriptionData = inheritedDesc;
                                console.log(`Descrição herdada de: ${inheritedDesc.source}`);
                            }
                        }
                    } else if (itemData?.code === 403) {
                        throw new Error(`Acesso negado a este anúncio. Verifique se ele pertence à conta vinculada ao app.`);
                    } else {
                        throw new Error(`Não foi possível obter os dados do anúncio (código ${itemData?.code || 'desconhecido'}).`);
                    }
                }
            } catch (e) { console.warn(`Erro na API principal: ${e.message}`); fetchError = e; }
        } else if (!fetchError) {
            fetchError = new Error("Para analisar, você precisa conectar sua conta do Mercado Livre na seção 'Minha Conta'.");
            fetchError.isAuthError = true;
            console.log(fetchError.message);
        }

        if (accessToken && detail) {
            // Ensure both are treated as strings for comparison and handle potential undefined
            // FORCED TO TRUE FOR TESTING VISITS ON ANY AD IN BUBBLE
            const isOwner = true;


            const results = await Promise.allSettled([
                isOwner ? fetchVisits(detail.id, accessToken) : Promise.resolve({ error: 'not_owner' }),
                fetchReviews(detail.id, accessToken),
                fetchAdsMetrics(detail.id, accessToken),
                fetchPerformanceData(detail.id, accessToken).catch(() => null),
                fetchPurchaseExperience(detail.id, accessToken).catch(() => null)
            ]);
            visitsData = results[0].status === 'fulfilled' ? results[0].value : null;
            reviewsData = results[1].status === 'fulfilled' ? results[1].value : null;
            adsData = results[2].status === 'fulfilled' ? results[2].value : null;
            performanceData = results[3].status === 'fulfilled' ? results[3].value : null;
            purchaseExperienceData = results[4].status === 'fulfilled' ? results[4].value : null;
        }

        if (detail && detail.category_id && accessToken) {
            categoryAttributes = await fetchCategoryAttributes(detail.category_id, accessToken);
        }

        if (detail && typeof detail === 'object') {
            console.log("Processando dados...");
            const containerIdSuffix = append ? Date.now() : '';
            const backBtnHtml = window.lastCatalogUrl ? `<button class="btn-back-catalog" onclick="window.lastCatalogUrl && (document.getElementById('input-url').value = 'https://www.mercadolivre.com.br/catalogo/p/${window.lastCatalogUrl}', handleAnalysisClick())">← Voltar ao Catálogo</button>` : '';

            const containerHtml = `
                <div class="item-analysis-container" id="analysis-container${containerIdSuffix}">
                    ${backBtnHtml}

                    <!-- ROW 1: Título | Score | Melhorias (3 colunas alinhadas) -->
                    <div style="display:grid; grid-template-columns:1.3fr auto 1fr; gap:16px; align-items:stretch; margin-bottom:16px;">
                        <div id="tituloTexto${containerIdSuffix}"></div>
                        <div id="scoreCircle${containerIdSuffix}"></div>
                        <div id="scoreChecklist${containerIdSuffix}"></div>
                    </div>

                    <!-- ROW 2: Checklist + Visitas + Avaliações (3 colunas iguais) -->
                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:16px;">
                        <div id="quickChecklist${containerIdSuffix}"></div>
                        <div id="visitsTrend${containerIdSuffix}"></div>
                        <div id="reviewsContainer${containerIdSuffix}"></div>
                    </div>

                    <!-- ROW 3: Product Ads -->
                    <div id="adsMetrics${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 3.5: Qualidade ML (API /item/{id}/performance) -->
                    <div id="performanceTexto${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 3.6: Experiência de Compra ML (API /reputation/items/{id}/purchase_experience) -->
                    <div id="purchaseExperience${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 4: Ficha Técnica -->
                    <div id="fichaTecnicaTexto${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 4: Campos da Categoria -->
                    <div id="categoryAttributes${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 5: Tags -->
                    <div id="tagsTexto${containerIdSuffix}" style="margin-bottom:16px;"></div>

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
                detail, descriptionData, performanceData, visitsData, reviewsData, categoryAttributes, usedFallback, containerIdSuffix, accessToken
            };

            exibirTitulo(detail.title, isMlbu, `tituloTexto${containerIdSuffix}`, detail);
            exibirChecklistRapido(detail, descriptionData, `quickChecklist${containerIdSuffix}`, performanceData);
            processarAtributos(detail.attributes, detail.title, usedFallback, `fichaTecnicaTexto${containerIdSuffix}`);
            exibirAtributosCategoria(categoryAttributes, detail.attributes, `categoryAttributes${containerIdSuffix}`);
            verificarTags(detail.tags, usedFallback, `tagsTexto${containerIdSuffix}`);
            exibirTendenciaVisitas(visitsData, `visitsTrend${containerIdSuffix}`);
            exibirAvaliacoes(reviewsData, `reviewsContainer${containerIdSuffix}`);

            window._adsItemId = detail.id;
            window._adsAccessToken = accessToken;
            exibirAdsMetrics(adsData, `adsMetrics${containerIdSuffix}`);

            // Qualidade das publicações (API ML /item/{id}/performance)
            exibirPerformance(performanceData, `performanceTexto${containerIdSuffix}`);

            // Experiência de Compra (API ML /reputation/items/{id}/purchase_experience)
            exibirExperienciaCompra(purchaseExperienceData, `purchaseExperience${containerIdSuffix}`);

            // Pass analysis data for improvements panel (includes visits & reviews)
            const analysisData = { title: detail.title, detail, descriptionData, categoryAttributes, visitsData, reviewsData };
            // Prioriza score da ML Quality API quando disponível; senão usa heurística interna
            exibirPontuacao(
                calcularPontuacaoQualidade(detail, descriptionData, usedFallback, categoryAttributes),
                usedFallback,
                `scoreCircle${containerIdSuffix}`,
                analysisData,
                `scoreChecklist${containerIdSuffix}`,
                performanceData
            );

            // AI image analysis removed

            console.log("--- Análise Concluída ---");
        }

        if (!detail) {
            const finalMsg = fetchError ? fetchError.message : "Não foi possível obter ou processar dados do anúncio.";
            console.error("Erro Final da Análise:", finalMsg);
            if (!append) {
                clearResults();
            }
            // Padroniza erro de auth via MF_renderError
            if (fetchError && fetchError.isAuthError && typeof window.MF_renderError === 'function') {
                const cont = document.getElementById('resultsContainer');
                if (cont) {
                    cont.classList.remove('initial-state');
                    window.MF_renderError(cont, 'no_ml_account');
                }
            } else {
                appendError(`Falha na análise: ${finalMsg}`);
            }
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
        <div class="ana-card" style="flex-direction:row; align-items:center; gap:20px; border-top:3px solid var(--blue);">
            ${imgUrl ? `<img src="${imgUrl}" alt="${mlbuDetail.title}" style="width:80px; height:80px; object-fit:contain; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--row-alt); flex-shrink:0;">` : ''}
            <div style="flex:1; min-width:0;">
                <span class="status-badge success" style="margin-bottom:6px; display:inline-flex;">Produto de Usuário (MLBU)</span>
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text); line-height:1.3; margin-top:4px;">${escapeHtml(mlbuDetail.title)}</h3>
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
                const price = (typeof window !== 'undefined' && window.MF_formatCurrency)
                    ? window.MF_formatCurrency(item.price, item.site_id || (item.currency_id === 'BRL' ? 'MLB' : undefined))
                    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: item.currency_id || 'BRL' }).format(item.price);

                const btn = document.createElement('div');
                btn.className = 'item-list-btn';
                btn.onclick = () => handleAnalysisClick(item.id, false);
                const soldQty = item.sold_quantity || 0;
                btn.innerHTML = `
                    <img src="${item.thumbnail}" class="item-list-img" alt="Thumb">
                    <div style="flex-grow:1;">
                        <span class="text-value" style="font-size:0.95rem;">${escapeHtml(item.title)}</span>
                        <div style="display:flex; gap:10px; margin-top:4px; align-items:center;">
                            <span class="status-badge muted" style="font-size:0.75rem;">${listingType}</span>
                            <span class="text-label" style="color:var(--green);">${price}</span>
                            <span style="font-family:'DM Mono',monospace; font-size:0.78rem; color:var(--text-muted);">${soldQty} vendas</span>
                            <span class="text-small" style="font-family:'DM Mono',monospace; color:var(--blue);">${item.id}</span>
                        </div>
                    </div>
                    <span style="color:var(--blue);">Analisar ➔</span>
                `;
                itemsInnerContainer.appendChild(btn);
            }
        });
    } else {
        itemsInnerContainer.innerHTML += '<p class="text-small error-message">Nenhum anúncio (MLB) encontrado para este produto ou falha ao buscar detalhes.</p>';
    }
}

async function displayCatalogResults(catalogData, sellerItemIds, accessToken, categoryAttrs = null) {
    const resultsContainer = document.getElementById('resultsContainer');
    const catalogId = catalogData.id || catalogData.catalog_product_id;

    const title = catalogData.name || '';
    const titleLen = title.length;
    const pictures = catalogData.pictures || [];
    const attributes = catalogData.attributes || [];
    const imgUrl = pictures.length > 0 ? pictures[0].url : '';

    // Title analysis (catalog max 200 chars, below 150 is bad)
    let titleState = 'good';
    if (titleLen < 80) titleState = 'bad';
    else if (titleLen < 150) titleState = 'neutral';
    const titleBadge = titleState === 'good' ? 'Excelente' : (titleState === 'neutral' ? 'Aceitável' : 'Curto');

    // Cross catalog attributes with ALL possible category attributes
    const catalogAttrMap = new Map();
    attributes.forEach(a => {
        const val = a.values && a.values.length > 0 ? a.values[0].name : null;
        if (val) catalogAttrMap.set(a.id, { name: a.name || a.id, value: val });
    });

    // Use category attributes as the full list if available, otherwise just catalog attrs
    let allAttrs = [];
    if (Array.isArray(categoryAttrs) && categoryAttrs.length > 0) {
        allAttrs = categoryAttrs.filter(a => {
            if (a.value_type !== 'string') return false;
            if (Array.isArray(a.tags) && a.tags.some(t => t === 'read_only' || t?.id === 'read_only')) return false;
            if (a.tags?.read_only) return false;
            // Filter by relevance if available (keep relevant ones)
            if (a.relevance !== undefined && a.relevance === 0) return false;
            return true;
        }).map(a => ({
            id: a.id,
            name: a.name || a.id,
            value: catalogAttrMap.get(a.id)?.value || null
        }));
    } else {
        allAttrs = attributes.map(a => ({
            id: a.id,
            name: a.name || a.id,
            value: a.values && a.values.length > 0 ? a.values[0].name : null
        }));
    }
    const filledAttrs = allAttrs.filter(a => a.value);
    const emptyAttrs = allAttrs.filter(a => !a.value);
    // Limit empty attrs to avoid showing hundreds of irrelevant fields
    const emptyAttrsLimited = emptyAttrs.slice(0, 20);
    const emptyAttrsExtra = emptyAttrs.length - emptyAttrsLimited.length;

    // Description check — aceita short_description.content, description (string/obj), main_features ou parent_id (variação herda do pai)
    const hasDesc = !!(extractDescriptionText(catalogData) || catalogData.parent_id);

    // Images check (min 3)
    const imageOk = pictures.length >= 3;

    // --- CATALOG SCORE ---
    let catScore = 100;
    if (titleLen < 80) catScore -= 15;
    else if (titleLen < 150) catScore -= 8;
    if (!imageOk) catScore -= 10;
    if (!hasDesc) catScore -= 10;
    catScore -= Math.min(emptyAttrs.length * 2, 30);
    catScore = Math.max(0, Math.min(100, catScore));

    let catLevel = 'bad';
    if (catScore >= 75) catLevel = 'good';
    else if (catScore >= 50) catLevel = 'neutral';
    const catClass = catScore >= 75 ? '⭐ Classe A' : (catScore >= 50 ? '📈 Classe B' : '⛏️ Classe C');

    const renderAttr = (attr) => {
        const filled = !!attr.value;
        const ignored = window.ignoredCatalogAttributes.has(attr.id);
        return `
            <div style="padding:6px 10px; background:${ignored ? 'var(--row-alt)' : (filled ? 'var(--green-light)' : 'var(--red-light)')}; border-radius:var(--radius-sm); border-left:3px solid ${ignored ? 'var(--border)' : (filled ? 'var(--green)' : 'var(--red)')}; margin-bottom:4px; ${ignored ? 'opacity:0.5;' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="text-label">${escapeHtml(attr.name)}</span>
                    <button onclick="window.toggleIgnoreAttribute('${attr.id}', 'catalog'); document.getElementById('input-url').dispatchEvent(new Event('reanalyze'));" class="btn-ignore-clean ${ignored ? 'ignored' : ''}" title="${ignored ? 'Incluir' : 'Ignorar'}" style="padding:2px;">
                        ${ignored ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'}
                    </button>
                </div>
                <span class="text-value" style="display:block; ${ignored ? 'text-decoration:line-through;' : ''}">${filled ? escapeHtml(attr.value) : 'Não preenchido'}</span>
            </div>`;
    };

    // Fetch items and FILTER only those actually linked to this catalog
    let itemsHtml = '<p class="text-small" style="color:var(--text-muted); font-style:italic;">Nenhum anúncio seu vinculado a este catálogo. Vincule um anúncio pelo Mercado Livre para que apareça aqui.</p>';
    let linkedCount = 0;
    if (sellerItemIds.length > 0) {
        // Paginate: fetch max 20 items at a time
        let allItemsDetails = [];
        for (let i = 0; i < sellerItemIds.length; i += 20) {
            const chunk = sellerItemIds.slice(i, i + 20);
            const chunkDetails = await fetchItemDetails(chunk, accessToken);
            if (chunkDetails) allItemsDetails = allItemsDetails.concat(chunkDetails);
        }
        const itemsDetails = allItemsDetails;
        if (itemsDetails && itemsDetails.length > 0) {
            const allValidItems = itemsDetails.filter(r => r.code === 200 && r.body);
            // Show ONLY items confirmed linked to this catalog
            const linkedItems = allValidItems.filter(r => r.body.catalog_product_id === catalogId);
            linkedCount = linkedItems.length;

            if (linkedItems.length > 0) {
                const btns = linkedItems.map(itemResp => {
                    const item = itemResp.body;
                    const listingType = item.listing_type_id === 'gold_special' ? 'Clássico' : (item.listing_type_id === 'gold_pro' ? 'Premium' : item.listing_type_id);
                    const price = (typeof window !== 'undefined' && window.MF_formatCurrency)
                    ? window.MF_formatCurrency(item.price, item.site_id || (item.currency_id === 'BRL' ? 'MLB' : undefined))
                    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: item.currency_id || 'BRL' }).format(item.price);
                    const soldQty = item.sold_quantity || 0;
                    return `
                        <div class="item-list-btn" onclick="handleAnalysisClick('${item.id}', false)">
                            <img src="${item.thumbnail}" class="item-list-img" alt="Thumb">
                            <div style="flex-grow:1;">
                                <span class="text-value" style="font-size:0.9rem;">${escapeHtml(item.title)}</span>
                                <div style="display:flex; gap:10px; margin-top:4px; align-items:center;">
                                    <span class="status-badge muted" style="font-size:0.7rem;">${listingType}</span>
                                    <span class="text-label" style="color:var(--green);">${price}</span>
                                    <span style="font-family:'DM Mono',monospace; font-size:0.78rem; color:var(--text-muted);">${soldQty} vendas</span>
                                    <span class="text-small" style="font-family:'DM Mono',monospace; color:var(--blue);">${item.id}</span>
                                </div>
                            </div>
                            <span style="color:var(--blue); font-weight:600; font-size:0.85rem;">Analisar ➔</span>
                        </div>`;
                });
                itemsHtml = btns.join('');
            }
        }
    }

    // Checklist items
    const checkItems = [
        { ok: titleLen >= 150, label: 'Título', detail: titleLen >= 150 ? `${titleLen} caracteres` : `Curto (${titleLen} chars, meta: 150+)` },
        { ok: hasDesc, label: 'Descrição', detail: hasDesc ? 'Preenchida' : 'Sem descrição' },
        { ok: imageOk, label: `Imagens (${pictures.length})`, detail: imageOk ? `${pictures.length} fotos` : `Mínimo 3 (tem ${pictures.length})` },
        { ok: emptyAttrs.length === 0, label: 'Atributos', detail: emptyAttrs.length === 0 ? `Todos preenchidos (${filledAttrs.length})` : `${emptyAttrs.length} vazios de ${allAttrs.length}` },
    ];

    const renderCheck = (item) => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:${item.ok ? 'var(--green-light)' : 'var(--red-light)'}; border-radius:var(--radius-sm); border-left:3px solid ${item.ok ? 'var(--green)' : 'var(--red)'};">
            <span style="font-size:1rem; flex-shrink:0;">${item.ok ? '✅' : '❌'}</span>
            <div style="flex:1;">
                <span style="font-weight:600; font-size:0.85rem; color:var(--text);">${item.label}</span>
                <span class="text-small" style="display:block; margin-top:1px;">${item.detail}</span>
            </div>
        </div>`;

    resultsContainer.innerHTML = `
        <div class="item-analysis-container">
            <!-- ROW 1: Header + Score + Checklist (3 columns like MLB) -->
            <div style="display:grid; grid-template-columns:1.3fr auto 1fr; gap:16px; align-items:stretch; margin-bottom:16px;">
                <!-- Catalog Header -->
                <div class="ana-card" style="border-top:3px solid var(--blue);">
                    <div class="ana-card-header">
                        <span class="ana-card-icon">📦</span>
                        <span class="ana-card-title">Catálogo</span>
                        <span class="status-badge ${titleState === 'good' ? 'success' : (titleState === 'neutral' ? 'muted' : 'error')}" style="margin-left:auto; font-size:0.65rem;">${titleBadge}</span>
                    </div>
                    <div style="display:flex; gap:16px; align-items:flex-start;">
                        ${imgUrl ? `<div class="cover-img-glow"><img src="${imgUrl}" style="width:80px; height:80px; object-fit:contain; border-radius:var(--radius-sm); display:block;"></div>` : ''}
                        <div style="flex:1; min-width:0;">
                            <span class="text-small" style="font-family:'DM Mono',monospace; color:var(--blue); display:block; margin-bottom:4px;">${catalogId}</span>
                            <p class="title-display" style="font-size:1rem; margin-bottom:8px;">${escapeHtml(title)}</p>
                            <div class="char-counter-bar">
                                <div class="char-progress ${titleState}" style="width:${Math.min(100, (titleLen / 200) * 100)}%"></div>
                            </div>
                            <div style="display:flex; justify-content:space-between; margin-top:4px;">
                                <span class="text-small">${titleLen} chars</span>
                                <span class="text-small">Máx: 200</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Score Circle -->
                <div class="ana-card" style="align-items:center; text-align:center; justify-content:center;">
                    <div class="score-circle-outer" style="width:110px; height:110px;">
                        <svg viewBox="0 0 36 36" class="circular-chart">
                            <defs>
                                <linearGradient id="gradientGoodCat" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" style="stop-color:#00d68f;stop-opacity:1" />
                                    <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
                                </linearGradient>
                            </defs>
                            <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path class="circle ${catLevel}" stroke-dasharray="${catScore}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                        </svg>
                        <span class="score-number" style="font-size:2rem;">${catScore}</span>
                    </div>
                    <span class="status-badge ${catLevel === 'good' ? 'success' : (catLevel === 'neutral' ? 'muted' : 'error')}" style="font-size:0.68rem; margin-top:10px;">${catClass}</span>
                </div>

                <!-- Checklist -->
                <div class="ana-card">
                    <div class="ana-card-header" style="padding-bottom:10px; margin-bottom:10px;">
                        <span class="ana-card-icon">✅</span>
                        <span class="ana-card-title">Checklist do Catálogo</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${checkItems.map(renderCheck).join('')}
                    </div>
                </div>
            </div>

            <!-- ROW 2: Attributes (preenchidos esquerda, vazios direita) -->
            <div class="ana-card" style="margin-bottom:16px;">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📋</span>
                    <span class="ana-card-title">Atributos do Catálogo</span>
                    <span class="text-small" style="margin-left:auto;">${filledAttrs.length} preenchidos / ${allAttrs.length} total</span>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <div class="specs-group-title valid" style="margin-bottom:6px;">✅ Preenchidos (${filledAttrs.length})</div>
                        ${filledAttrs.length > 0 ? filledAttrs.map(renderAttr).join('') : '<p class="text-small">Nenhum</p>'}
                    </div>
                    <div>
                        <div class="specs-group-title problem" style="margin-bottom:6px;">⚠️ Vazios (${emptyAttrs.length})</div>
                        ${emptyAttrs.length > 0 ? emptyAttrsLimited.map(renderAttr).join('') + (emptyAttrsExtra > 0 ? `<p class="text-small" style="color:var(--text-muted); margin-top:8px;">...e mais ${emptyAttrsExtra} campos vazios</p>` : '') : '<p class="text-small" style="color:var(--green);">Todos preenchidos! 🎉</p>'}
                    </div>
                </div>
            </div>

            <!-- ROW 3: Seller Items -->
            <div class="ana-card" style="margin-bottom:16px;">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📦</span>
                    <span class="ana-card-title">Seus Anúncios neste Catálogo</span>
                    <span class="text-small" style="margin-left:auto;">${linkedCount} vinculado(s)</span>
                </div>
                <p class="text-small" style="margin-bottom:10px;">Clique num anúncio para ver a análise completa:</p>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    ${itemsHtml}
                </div>
            </div>
        </div>
    `;
}

function handleAnalysisClick(itemId = null, append = false) {
    analisarAnuncio(itemId, append);
}
// Expose to window for Bubble's HTML element scope
window.handleAnalysisClick = handleAnalysisClick;

function initAnalyzerPage() {
    const input = document.getElementById('input-url');
    if (input && !input.dataset.analyzerBound) {
        input.dataset.analyzerBound = '1';
        input.addEventListener('keypress', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAnalysisClick();
            }
        });
    }

    // Auto-load via ?item=MLBxxx (usado pelo Planejador de Ads)
    if (window.__analyzerAutoLoaded) return;
    try {
        const params = new URLSearchParams(window.location.search);
        const autoItem = params.get('item');
        if (autoItem && /^MLB[U]?\d+$/i.test(autoItem)) {
            window.__analyzerAutoLoaded = true;
            if (input) input.value = autoItem;
            setTimeout(() => handleAnalysisClick(autoItem), 300);
        }
    } catch (e) { /* noop */ }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnalyzerPage);
} else {
    initAnalyzerPage();
}

function calcularPontuacaoQualidade(detail, descriptionData, usedFallback = false, categoryAttributes = null) {
    if (!detail || typeof detail !== 'object') return 0;
    let score = 100;
    const title = detail.title || "", titleLen = title.length, pTit = getPalavrasUnicas(title);

    const isMlbu = detail.id && detail.id.startsWith('MLBU');

    // --- TÍTULO (-15 curto, -8 médio) ---
    if (isMlbu) {
        if (titleLen < 40) score += PONTOS_PENALIDADE_TITULO_CURTO;
        else if (titleLen < 50) score += PONTOS_PENALIDADE_TITULO_MEDIO;
    } else {
        if (titleLen < MIN_CHARS_TITULO_RUIM) score += PONTOS_PENALIDADE_TITULO_CURTO;
        else if (titleLen < MIN_CHARS_TITULO_BOM) score += PONTOS_PENALIDADE_TITULO_MEDIO;
    }

    // --- DESCRIÇÃO (-10 se não tem, +3 bônus se tem) ---
    // Aceita plain_text OU text (HTML legado) e considera descrição herdada do catálogo (UP/catalog listings).
    const hasDesc = !!(descriptionData && ((descriptionData.plain_text && descriptionData.plain_text.trim() !== "") || (descriptionData.text && descriptionData.text.trim() !== "")));
    if (hasDesc) score += 3;
    else score -= 10;

    // --- GARANTIA (-5 se não informada) ---
    if (!detail.warranty) score -= 5;

    // --- IMAGENS (-5 se menos de 3 no total ou por variação) ---
    const variations = detail.variations || [];
    if (variations.length > 0) {
        const badVars = variations.filter(v => (v.picture_ids?.length || 0) < 3);
        if (badVars.length > 0) score -= 5;
    } else {
        if ((detail.pictures?.length || 0) < 3) score -= 5;
    }

    // --- CAMPOS DA CATEGORIA (-2 por campo faltando, max -20) ---
    if (categoryAttributes && Array.isArray(categoryAttributes)) {
        const catString = categoryAttributes.filter(a => a.value_type === 'string' && !(Array.isArray(a.tags) && a.tags.some(t => t === 'read_only' || t?.id === 'read_only')) && !a.tags?.read_only);
        const adMap = new Map();
        (detail.attributes || []).forEach(a => { if (a?.value_name) adMap.set(a.id, a.value_name); });
        let missingCount = 0;
        catString.forEach(c => {
            if (window.ignoredAdAttributes.has(c.id)) return;
            const v = adMap.get(c.id);
            if (!v || v.trim() === '') missingCount++;
        });
        score -= Math.min(missingCount * 2, 20);
    }

    // --- ATRIBUTOS (tamanho e repetição, max -25 total) ---
    let attrPenalty = 0;
    if (Array.isArray(detail.attributes) && detail.attributes.length > 0) {
        let validCount = 0;
        const validAttrs = detail.attributes.filter(a => typeof a === 'object' && a && a.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id) && !window.ignoredAdAttributes.has(a.id));
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
                        attrPenalty += Math.floor(diff / 10) * PONTOS_PENALIDADE_POR_10_CHARS_DIF_ATR;
                    }
                }
                if (!ATRIBUTOS_IGNORADOS_REPETICAO.has(attr.id) && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                    attrPenalty += encontrarIntersecao(pAtuais, pTit).length * PONTOS_PENALIDADE_POR_PALAVRA_REPETIDA;
                }
            }
        });
        if (validCount === 0) attrPenalty += PONTOS_PENALIDADE_SEM_ATRIBUTOS;
    } else attrPenalty += PONTOS_PENALIDADE_SEM_ATRIBUTOS * 1.5;
    score += Math.max(attrPenalty, -25); // Cap attribute penalties at -25

    // --- TAGS ---
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
