if (window.__competitionLoaded) { /* prevent double execution when Bubble renders this element twice */ } else {
window.__competitionLoaded = true;

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


// --- Global Variables ---
  let globalCompetitorsData = []; // Dados detalhados dos competidores CARREGADOS
  let globalCompetitorIds = []; // TODOS os IDs de competidores do catálogo (API inicial)
  let globalCompetitorApiData = {}; // Dados ricos da API /competition/competitors indexados por item_id
  let globalAccessToken = "";
  let globalUserId = ""; // User ID for scraper
  let globalWinnerItemId = "";
  let globalSelectedDays = 90; // Período selecionado para visitas na tabela/cálculos
  let isFetchingBatch = false; // Indica se um lote de dados completos está sendo buscado
  let isUpdatingVisits = false; // Indica se apenas visitas estão sendo atualizadas
  // Variável global para o total de visitas de todos os competidores carregados NO PERÍODO SELECIONADO
  let globalTotalLoadedVisitas = 0;
  let visitsCache = {};           // Cache: { 'MLB123_90': {results:[...]} }
  let globalMlSellerId = null;    // ML numeric seller_id do usuário logado
  let globalSortColumn = 'visitas'; // Coluna de ordenação ativa
  let globalSortDirection = 'desc'; // 'asc' | 'desc'
  let globalFilters = { logistica: '', frete: '', flex: '', loja: '', uf: '' };
  let globalCusto = 0;       // Custo do produto no simulador de margem
  let globalTaxRate = 0;     // Alíquota de imposto (%) no simulador de margem
  let globalShippingFee = 0; // Custo de envio ML (taxa de frete da tabela)


  // --- Helper Functions ---
  function fillEmptySpan(htmlString) {
    if (typeof htmlString !== 'string') return htmlString;
    return htmlString.replace(/(<span[^>]*>)(\s*?)(<\/span>)/g, '$1 $3');
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function sanitizeUrl(url) {
    if (typeof url !== 'string') return '';
    const u = url.trim();
    if (u.startsWith('https://') || u.startsWith('http://')) return u.replace('http://', 'https://');
    return '';
  }

  function formatSellerName(nickname) {
    if (!nickname || nickname === 'N/A') return nickname;
    // Separar em palavras: FERNANDODOSSANTOSTURQUINO → difícil
    // Mas: GD3IMPORTSLTDA, TG1SUPRIMENTOS, BRPAPEIS → manter
    // Se tem underscores ou espaços, formatar cada parte
    let name = nickname.replace(/_/g, ' ').trim();
    // Se é tudo maiúsculo e > 15 chars sem espaço, tentar quebrar em palavras comuns
    if (name === name.toUpperCase() && name.length <= 25 && !name.includes(' ')) {
      // Apenas converter para Title Case simples
      name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    } else if (name.includes(' ')) {
      // Múltiplas palavras: Title Case
      name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    return name;
  }

  // Helpers i18n — usam site ativo (window.MF_CURRENT_SITE) pra locale/currency
  function _mfCfg() {
    if (typeof window !== 'undefined' && window.MF_getSiteConfig && window.MF_currentSiteId) {
      return window.MF_getSiteConfig(window.MF_currentSiteId());
    }
    return { locale: 'pt-BR', currency: 'BRL', currencySymbol: 'R$' };
  }
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '-';
    const c = _mfCfg();
    try { return Number(v).toLocaleString(c.locale, { style: 'currency', currency: c.currency, maximumFractionDigits: 2 }); }
    catch (_) { return c.currencySymbol + ' ' + Number(v).toFixed(2); }
  }
  function fmtNum(v) {
    if (v == null || isNaN(v)) return '-';
    const c = _mfCfg();
    try { return Number(v).toLocaleString(c.locale); } catch (_) { return String(v); }
  }
  function curSymbol() { return _mfCfg().currencySymbol; }

  // Aceita qualquer prefixo de site ML (MLB/MCO/MLA/MLM/MLC/MLU) além de URLs
  function normalizeMlbId(input) {
    if (!input || typeof input !== 'string') {
      console.error('Invalid item ID input:', input);
      return null;
    }
    // Tenta o helper global primeiro (quando site-config.js está carregado)
    if (typeof window !== 'undefined' && typeof window.MF_normalizeItemInput === 'function') {
      const info = window.MF_normalizeItemInput(input);
      if (info) return info.itemId;
    }
    // Fallback local: regex que aceita qualquer prefixo
    const r = /(MLB|MCO|MLA|MLM|MLC|MLU)-?(\d+)/i;
    const m = input.match(r);
    return m ? (m[1].toUpperCase() + m[2]) : null;
  }

  // --- Credential Fetching ---
  async function fetchAccessToken() {
    try {
      const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
      if (!r.ok) {
        const d = await r.text();
        throw new Error(`HTTP ${r.status}: ${d}`);
      }
      const d = await r.json();
      if (d?.response?.access_token) {
        console.log("Access Token OK.");
        return d.response.access_token;
      }
      throw new Error('Token não encontrado.');
    } catch (e) {
      console.error('Erro token:', e);
      return null;
    }
  }
  async function fetchUserIdForScraping() {
    try {
      const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/get-user-id', {
        method: 'POST'
      });
      if (!r.ok) {
        const d = await r.text();
        throw new Error(`HTTP ${r.status}: ${d}`);
      }
      const d = await r.json();
      let uId = d?.response?.user_id || d?.user_id || (typeof d === 'string' ? d : null);
      if (uId) {
        console.log("User ID OK.");
        return uId;
      }
      throw new Error('User ID não encontrado.');
    } catch (e) {
      console.error('Erro User ID:', e);
      return null;
    }
  }

  async function fetchCurrentMlUserId(accessToken) {
    try {
      const r = await fetch('https://mlb-proxy-fdb71524fd60.herokuapp.com/api/users/me', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d?.id ? String(d.id) : null;
    } catch (e) {
      return null;
    }
  }

  // --- Item Details Fetching (Competition API Data + Scraper) ---
  // Usa dados pré-carregados da API /competition/competitors como base
  // e o scraper para dados visuais (fotos, título, atributos) que o ML bloqueou via API.
  async function fetchItemDetails(itemId) {
    const nId = normalizeMlbId(itemId);
    if (!nId) {
      console.error(`fetchItemDetails: Invalid ID: ${itemId}`);
      return null;
    }

    // 1. Dados estruturais da API de competidores (já pré-carregados)
    const compData = globalCompetitorApiData[nId] || null;

    // 2. Scraper para dados visuais — com cache localStorage 7 dias (scraper é caro)
    let scraperData = null;
    const _sKey = `mf_sc_${nId}`;
    try {
      const _sc = localStorage.getItem(_sKey);
      if (_sc) {
        const { ts, d: _d } = JSON.parse(_sc);
        if (Date.now() - ts < 7 * 24 * 60 * 60 * 1000) { scraperData = _d; console.log(`[Scraper Cache] Hit: ${nId}`); }
      }
    } catch(_e) {}
    if (!scraperData && globalUserId) {
      try {
        // Constrói URL de produto completa por site (scraper aceita URL ou ID puro).
        // Pra catálogo usa /p/, pra anúncio usa articulo/produto do site certo.
        const _sUrl = (window.MF_productUrl ? window.MF_productUrl(nId) : null) || nId;
        const sR = await fetch(`https://mlb-proxy-fdb71524fd60.herokuapp.com/api/ml-scraper?url=${encodeURIComponent(_sUrl)}`, {
          method: 'GET',
          headers: { 'x-user-id': globalUserId }
        });
        if (sR.ok) {
          const sD = await sR.json();
          if (sD?.title && sD.price != null) {
            scraperData = sD;
            console.log(`[Scraper] OK ${nId}: dados obtidos.`);
            try { localStorage.setItem(_sKey, JSON.stringify({ ts: Date.now(), d: scraperData })); } catch(_e) {}
          } else {
            console.warn(`[Scraper] Dados mínimos ausentes ${nId}.`);
          }
        } else {
          console.warn(`[Scraper] Falhou ${nId} (${sR.status}).`);
        }
      } catch (sE) {
        console.warn(`[Scraper] Erro ${nId}:`, sE.message);
      }
    }

    // 3. Se não temos dados de nenhuma fonte, falha
    if (!compData && !scraperData) {
      console.error(`[fetchItemDetails] Sem dados para ${nId}.`);
      return null;
    }

    // 4. Montar objeto combinando as fontes (API competidores = estrutural, scraper = visual)
    const sD = scraperData || {};
    const aD = compData || {};

    const pF = aD.price || parseFloat(sD.price) || 0;
    const pDF = parseFloat(sD.price_discounted) || aD.price || pF;
    const sellerId = aD.seller_id || sD.seller?.seller_id || null;
    const categoryId = aD.category_id || sD.seller?.category_id || null;

    const officialStoreId = aD.official_store_id
      || (sD.seller?.official_store ? (sD.seller.official_store_id || null) : null);

    const listingType = aD.listing_type_id || sD.installments?.listing_type_id || null;

    // Shipping: API competidores é a fonte mais confiável
    const apiShipping = aD.shipping || {};
    const shipping = {
      mode: apiShipping.mode || sD.shipping_mode || null,
      logistic_type: apiShipping.logistic_type || sD.shipping_mode || 'default',
      free_shipping: typeof apiShipping.free_shipping === 'boolean' ? apiShipping.free_shipping : (sD.free_shipping === true),
      tags: apiShipping.tags || [],
      store_pick_up: typeof apiShipping.store_pick_up === 'boolean' ? apiShipping.store_pick_up : (sD.store_pick_up === true),
      local_pick_up: typeof apiShipping.local_pick_up === 'boolean' ? apiShipping.local_pick_up : (sD.local_pick_up === true)
    };

    // Fotos: scraper tem as URLs de alta resolução
    let pictures = [];
    if (Array.isArray(sD.pictures) && sD.pictures.length > 0) {
      pictures = sD.pictures.map(url => ({ url, secure_url: url }));
    }

    // Reputação: scraper tem dados visuais (nível, medalha)
    const sellerRep = sD.seller?.seller_reputation || {};
    const powerStatus = sD.seller?.seller_reputation?.power_seller_status || null;

    const source = compData ? (scraperData ? 'api+scraper' : 'api') : 'scraper';

    const nD = {
      id: nId,
      title: sD.title || nId,
      price: pF,
      price_discounted: pDF,
      category_id: categoryId,
      listing_type_id: listingType,
      seller_id: sellerId,
      pictures: pictures,
      seller_reputation: sellerRep,
      power_seller_status: powerStatus,
      official_store_id: officialStoreId,
      shipping: shipping,
      seller_address: aD.seller_address || sD.seller?.address || {},
      attributes: sD.attributes || [],
      description: sD.description || null,
      warranty: aD.warranty || sD.warranty || null,
      original_price: aD.original_price || ((pF !== pDF) ? pF : null),
      _source: source,
      _scraper_seller_nickname: sD.seller?.nickname || null,
      _scraper_seller_permalink: sD.seller?.permalink || null,
    };

    if (compData) {
      console.log(`[fetchItemDetails] ${nId} OK (${source}) — seller:${sellerId}, cat:${categoryId}, tipo:${listingType}`);
    }

    return nD;
  }

  // --- Other Fetch Functions (APIs Essenciais) ---
  async function fetchCatalogDetails(catalogId, accessToken) {
    try {
      const siteId = (window.MF_siteIdFromItemId ? window.MF_siteIdFromItemId(catalogId) : 'MLB');
      const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-catalog?product_id=${catalogId}&site_id=${siteId}`;
      const r = await fetch(u, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      return await r.json();
    } catch (e) {
      console.error(`Erro catálogo ${catalogId}:`, e);
      return null;
    }
  }
  // Busca dados de visitas para um item e período específicos
  async function fetchVisits(itemId, accessToken, days) {
    const id = normalizeMlbId(itemId);
    if (!id) {
      console.error(`fetchVisits ID inválido ${itemId}`);
      return {
        results: []
      };
    }
    const cacheKey = `${id}_${days}`;
    if (visitsCache[cacheKey]) {
      return visitsCache[cacheKey];
    }
    try {
      const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-visits?item_id=${id}&last=${days}&unit=day`;
      const r = await fetch(u, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!r.ok) {
        if (r.status === 404) {
            console.warn(`[API Visits] Visitas não encontradas para ${id} (${days}d) - 404.`);
            return { results: [] };
        }
        throw new Error(`Erro ${r.status}`);
      }
      const d = await r.json();
      if (!d?.results) {
          console.warn(`[API Visits] Resposta visitas vazia/inválida para ${id} (${days}d).`);
          return { results: [] };
      }
      visitsCache[cacheKey] = d;
      return d;
    } catch (e) {
      console.error(`[API Visits] Erro visitas ${id} (${days}d):`, e);
      return {
        results: []
      };
    }
  }

  // --- MODIFIED FUNCTION ---
  async function fetchUserDetails(userIdForApi) { // Parameter renamed for clarity
    // Check if userIdForApi is null, undefined, or empty
    if (!userIdForApi) {
      console.warn(`fetchUserDetails: userIdForApi inválido/ausente: '${userIdForApi}'`);
      return null;
    }

    // Check if accessToken is available
    if (!globalAccessToken) {
        console.error(`fetchUserDetails: Access Token ausente para Heroku API.`);
        return null;
    }

    try {
      // Construct the Heroku API URL
      const herokuApiUrl = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/users/${userIdForApi}`;
      
      console.log(`[API User Heroku] Fetching user details for ID '${userIdForApi}' from ${herokuApiUrl}`);

      const r = await fetch(herokuApiUrl, {
        method: 'GET', // Assuming GET request for fetching user details
        headers: {
          'Authorization': `Bearer ${globalAccessToken}`, // Add Bearer token for authentication
          'Content-Type': 'application/json', // Standard header
          'Cache-Control': 'no-cache' // Added Cache-Control similar to other authenticated calls
        }
      });

      if (!r.ok) {
        let m = `Status ${r.status}`;
        try {
          const d = await r.json(); // Try to parse error response as JSON
          if (d?.message) m += ` (${d.message})`;
          else if (d?.error) m += ` (${d.error})`; // Check for a generic error property
          else m += ` (${JSON.stringify(d)})`; // Fallback to stringify if no known error message format
        } catch (parseError) {
          // If response is not JSON or JSON parsing fails, try to get the response as text
          try {
            const textError = await r.text();
            m += ` (Response: ${textError})`;
          } catch (textErrorCatch) {
            m += ` (Could not parse error response)`;
          }
        }
        console.warn(`[API User Heroku] Falhou ID '${userIdForApi}': ${m}`);
        return null; // Retorna null em caso de falha na API
      }
      // Assuming the Heroku API returns JSON data compatible with what the rest of the script expects
      return await r.json();
    } catch (e) {
      console.error(`[API User Heroku] Erro user ID '${userIdForApi}':`, e);
      return null;
    }
  }
  // --- END OF MODIFIED FUNCTION ---

  async function fetchBrandName(sellerId) {
    if (!sellerId || !globalAccessToken) return null;
    try {
      const r = await fetch(`https://mlb-proxy-fdb71524fd60.herokuapp.com/api/users/${sellerId}/brands`, {
        headers: { 'Authorization': `Bearer ${globalAccessToken}` }
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (data.brands && data.brands.length > 0) {
        return data.brands[0].fantasy_name || data.brands[0].name || null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function fetchShippingFreeCost(itemId, sellerId, accessToken) {
    const id = normalizeMlbId(itemId);
    // Adiciona check para sellerId null/inválido
    if (!id || !sellerId || isNaN(Number(sellerId))) {
      console.warn(`fetchShippingFreeCost: IDs inválidos item:${itemId},seller:${sellerId}`);
      return null; // Retorna null se sellerId for inválido
    }
    try {
      const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/shipping-cost?user_id=${sellerId}&item_id=${id}`;
      const r = await fetch(u, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Cache-Control': 'no-cache'
        }
      });
      if (!r.ok) {
        if (r.status === 404) {
             console.warn(`[API Frete Custo] Custo frete não encontrado ${id} (404).`);
             return null;
        }
        throw new Error(`Erro ${r.status}`);
      }
      const d = await r.json();
      if (d?.coverage?.all_country?.list_cost !== undefined) {
          return { cost: d.coverage.all_country.list_cost, currency: curSymbol() };
      }
      if (d?.error) console.warn(`[API Frete Custo] API Frete/Custo erro ${id}: ${d.message||d.error}`);
      return null;
    } catch (e) {
      console.error(`[API Frete Custo] Erro frete/custo ${id}:`, e);
      return null;
    }
  }
  async function fetchCommissions(price, category_id, listing_type_id, accessToken) {
    if (!category_id || price == null || price <= 0) {
      console.warn(`fetchCommissions dados insuf/inválidos (cat ou price)`, {
        price,
        category_id,
        listing_type_id
      });
      return null;
    }
    try {
      const p = new URLSearchParams({
        price,
        currency_id: _mfCfg().currency,
        category_id
      });
      if (listing_type_id) p.append('listing_type_id', listing_type_id);
      const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-commissions?${p.toString()}`;
      const r = await fetch(u, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!r.ok) {
        if (r.status === 400) {
          console.warn(`[API Comissao] Req inválida (400) p/ price ${price}, cat ${category_id}, type ${listing_type_id}`);
          return null;
        }
        throw new Error(`Erro ${r.status}`);
      }
      const d = await r.json();
      return d;
    } catch (e) {
      console.error('[API Comissao] Erro comissões:', {
        price,
        category_id,
        listing_type_id
      }, e);
      return null;
    }
  }

  // Busca detalhes de envio (modalidade, flex tags) via API
  async function fetchShippingDetails(itemId, accessToken) {
    const nId = normalizeMlbId(itemId);
    if (!nId) {
      console.error(`fetchShippingDetails: ID inválido ${itemId}`);
      return null;
    }
    if (!accessToken) {
      console.error(`fetchShippingDetails: Token ausente ${nId}`);
      return null;
    }
    try {
      const url = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/shipping-details?item_id=${nId}`;
      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Cache-Control': 'no-cache'
        }
      });
      if (!r.ok) {
        if (r.status === 404) {
          console.warn(`[API Shipping Details] Envio não encontrado ${nId} (404).`);
          return null;
        }
        let m = `Erro ${r.status} envio`;
        try {
          const d = await r.json();
          if (d?.error) m += `: ${d.error}`;
          if (d?.details?.message) m += `(${d.details.message})`;
        } catch (_) {}
        console.warn(`[API Shipping Details] Falhou ${nId}: ${m}`);
        return null;
      }
      const d = await r.json();
      // API retorna um array de canais, geralmente queremos o primeiro ou o objeto principal
      return d?.channels?.[0] || d;
    } catch (e) {
      console.error(`[API Shipping Details] Erro detalhes envio ${nId}:`, e);
      return null;
    }
  }


  async function fetchReviews(itemId, accessToken) {
    const nId = normalizeMlbId(itemId);
    if (!nId || !accessToken) return null;
    try {
      const r = await fetch(`https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-reviews?item_id=${nId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

    // Função auxiliar para renderizar HTML de Flex
    function formatWarranty(w) {
      if (!w || w === '-') return '-';
      const m = w.match(/(\d+)\s*(dia[s]?|m[eê]s(?:es)?|ano[s]?)/i);
      if (m) {
        const n = parseInt(m[1], 10);
        const u = m[2].toLowerCase();
        if (u.startsWith('dia')) return n + 'd';
        if (u.startsWith('m')) return n + 'm';
        if (u.startsWith('ano')) return n === 1 ? '1a' : n + 'a';
      }
      return w.length > 6 ? w.slice(0, 6) + '…' : w;
    }

    function getRatingHtml(avg, count) {
      if (!avg) return '<span title="Sem avaliações">-</span>';
      const color = avg >= 4.5 ? '#15803d' : avg >= 4 ? '#ca8a04' : '#dc2626';
      const cStr = count ? `(${count.toLocaleString(_mfCfg().locale)})` : '';
      return `<span style="color:${color};font-weight:700;white-space:nowrap;" title="${avg.toFixed(1)} estrelas · ${count||0} avaliações">★ ${avg.toFixed(1)} <small style="color:#64748b;font-size:0.78rem;font-weight:400;">${cStr}</small></span>`;
    }

    function getFlexHtml(flexValue) {
      if (flexValue === "Sim") {
        return `<span class="beneficio flex-sim" title="Oferece envio Flex">Sim</span>`;
      } else if (flexValue === "Não") {
        return `<span class="beneficio flex-nao" title="Não oferece envio Flex">Não</span>`;
      }
      return '<span title="Envio Flex: N/I">-</span>';
    }


  // --- HTML Rendering Functions ---

  // Renderiza HTML para o tipo de logística (com funções inlined)
  function getLogisticaStyledHtml(shipping) {
    const lT = shipping?.logistic_type;
    if (lT) {
        let mT;
        const lowerLT = String(lT).toLowerCase();
        switch (lowerLT) {
            case 'cross_docking': mT = 'Coleta'; break;
            case 'xd_drop_off': mT = 'Places'; break;
            case 'drop_off': mT = 'Correios'; break;
            case 'fulfillment': mT = 'Full'; break;
            case 'me1': mT = 'ME1'; break;
            case 'me2': mT = 'ME2'; break;
            case 'custom': mT = 'Custom'; break;
            case 'not_specified': mT = 'Não Esp.'; break;
            case 'default': mT = 'Desconhecida'; break;
            default: mT = lT || 'Desconhecida';
        }

        let txt;
        switch (mT) {
            case 'Coleta': txt = 'Coleta 🚚'; break;
            case 'Places': txt = 'Places 📦'; break;
            case 'Correios': txt = 'Correios ✉️'; break;
            case 'Full': txt = 'Full ⚡'; break;
            case 'ME1': txt = 'ME1 🚛'; break;
            case 'ME2': txt = 'ME2 🚀'; break;
            case 'Custom': txt = 'Custom 🤝'; break;
            case 'Não Esp.': txt = 'N/E❓'; break;
            case 'Desconhecida': txt = '❓'; break;
            default: txt = mT;
        }

      let cN = "logistica-desconhecida";
      switch (mT) { // Usa mapped type para o nome da classe CSS
        case "Coleta": cN = "logistica-coleta"; break;
        case "Places": cN = "logistica-places"; break;
        case "Correios": cN = "logistica-correios"; break;
        case "Full": cN = "logistica-full"; break;
        case "ME1": cN = "logistica-me1"; break;
        case "ME2": cN = "logistica-me2"; break;
        case "Custom": cN = "logistica-custom"; break;
        case "Não Esp.": cN = "logistica-nesp"; break;
          case "Desconhecida": cN = "logistica-desconhecida"; break;
      }
      // Título inclui tanto o tipo mapeado quanto o tipo cru da API/Scraper
      return `<span class="${cN}" title="Logística: ${mT} (${lT})">${txt}</span>`;
    }
    return '<span class="logistica-desconhecida" title="Logística: N/I">-</span>';
  }

  // Renderiza HTML para o tipo de anúncio (com função inlined)
  function getTipoAnuncioHtml(listing_type_id) {
    if (listing_type_id) {
      let t;
      switch(listing_type_id){
          case 'gold_pro': t='Premium'; break;
          case 'gold_special': t='Clássico'; break;
          case 'free': t='Grátis'; break;
          default: t = String(listing_type_id) || '-';
      }

      let c = "";
      if (t === "Premium") c = "tipo-premium";
      else if (t === "Clássico") c = "tipo-classico";
      else if (t === "Grátis") c = "tipo-gratis";
      else c = "tipo-outro";
      return `<span class="${c}" title="Tipo Anúncio: ${t}">${t}</span>`;
    }
    return '<span class="tipo-desconhecido" title="Tipo Anúncio: N/I">-</span>';
  }

  // Renderiza HTML para a reputação do vendedor
  function getReputacaoHtml(reputacaoValue) {
    if (reputacaoValue && typeof reputacaoValue === 'string' && reputacaoValue !== '-') {
      const r = reputacaoValue.charAt(0);
        const levelMap = {'5':'verde', '4':'verde-claro', '3':'amarelo', '2':'laranja', '1':'vermelho'};
        const color = levelMap[r] || 'gray';
        const titleMap = {'5':'Ótima', '4':'Boa', '3':'Regular', '2':'Ruim', '1':'Péssima'};
        const title = titleMap[r] || 'N/I';

        if (color !== 'gray') {
          return `<span class="reputacao reputacao-${color}" title="Reputação: ${title}"> </span>`;
        }
    }
    return '<span class="reputacao reputacao-gray" title="Reputação: N/I"> </span>';
  }

  // Renderiza HTML para a medalha do vendedor
  function getMedalhaHtml(power_seller_status) {
    const lS = String(power_seller_status || '').toLowerCase().trim();
    let t = "Medalha: Nenhuma";
    if (lS.includes('platinum')) {
      t = "Medalha: Platinum";
      return `<span class="medalha mercado-lider-platinum" title="${t}">Platinum</span>`;
    } else if (lS.includes('gold')) {
      t = "Medalha: Gold";
      return `<span class="medalha mercado-lider-gold" title="${t}">Gold</span>`;
    } else if (lS.includes('líder') || lS.includes('lider')) {
      t = "Medalha: Líder";
      return `<span class="medalha mercado-lider" title="${t}">Líder</span>`;
    }
    return `<span title="${t}">-</span>`;
  }

  // Renderiza HTML para Loja Oficial
  function getLojaOficialHtml(official_store_id) {
    const isOfficial = official_store_id != null && String(official_store_id).trim() !== '';
    const title = `Loja Oficial: ${isOfficial?'Sim':'Não'}`;
    return isOfficial ? `<span class="loja-oficial-sim" title="${title}">Sim</span>` : `<span class="loja-oficial-nao" title="${title}">Não</span>`;
  }

  // Renderiza HTML para Minha Página
  function getEshopHtml(hasEshop, eshopUrl) {
    if (!hasEshop) return `<span class="eshop-nao" title="Sem Minha Página">—</span>`;
    if (eshopUrl) return `<a href="${eshopUrl}" target="_blank" rel="noopener" class="eshop-sim" title="Ver Minha Página">&#127968; Sim</a>`;
    return `<span class="eshop-sim" title="Tem Minha Página (Loja Oficial)">&#127968; Sim</span>`;
  }


  // --- Charting Functions ---
  // Exibe o gráfico de visitas em um canvas
  async function showSellerChartInCanvas(competitorId, accessToken, canvas, sellerName, days) {
    const chartDays = days || globalSelectedDays || 90;
    const id = normalizeMlbId(competitorId);
    if (!id || !canvas) {
      console.error("showSellerChartInCanvas: ID/Canvas inválido.");
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error(`Falha Ctx 2D ${id}`);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "16px Arial";
    ctx.fillStyle = "#888";
    ctx.textAlign = "center";
    ctx.fillText("Carregando...", canvas.width / 2, canvas.height / 2);
    console.log(`[Chart Load ${id}] Load: ${sellerName} (${chartDays}d)`);
    let vD;
    const _mem = globalCompetitorsData.find(c => c.item_id === id);
    if (_mem?.visitsResults?.length > 0 && chartDays === globalSelectedDays) {
      vD = { results: _mem.visitsResults };
    } else {
      try {
        console.log(`[Chart Load ${id}] Fetch visits (${chartDays}d)...`);
        vD = await fetchVisits(id, accessToken, chartDays);
        console.log(`[Chart Load ${id}] Visits received: ${vD?.results?.length || 0} points`);
      } catch (e) {
        console.error(`[Chart Load ${id}] ERRO FATAL VISITS:`, e);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "red";
        ctx.fillText(`Erro visits (${e.message}).`, canvas.width / 2, canvas.height / 2);
        return;
      }
    }
    if (!vD?.results || !Array.isArray(vD.results) || vD.results.length === 0) {
      console.warn(`[Chart Load ${id}] No/empty visits.`);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#888";
      ctx.fillText("Visitas indisponíveis.", canvas.width / 2, canvas.height / 2);
      return;
    }
    try {
      console.log(`[Chart Process ${id}] Process ${vD.results.length} points.`);
      vD.results.sort((a, b) => new Date(a.date) - new Date(b.date));
      const l = vD.results.map(r => r.date.split('T')[0]);
      const v = vD.results.map(r => r.total || 0);
      if (typeof Chart === 'undefined') {
        console.error("[Chart Init Error Critical] Chart global não encontrado.");
        throw new Error("Chart.js não carregado");
      }
      let eC = Chart.getChart(canvas);
      if (eC) {
        console.log(`[Chart Init ${id}] Destroying existing.`);
        eC.destroy();
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      console.log(`[Chart Init ${id}] Calling new Chart()...`);
      const _grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 200);
      _grad.addColorStop(0, 'rgba(0,102,255,0.15)');
      _grad.addColorStop(0.5, 'rgba(0,214,143,0.06)');
      _grad.addColorStop(1, 'rgba(0,214,143,0.0)');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: l,
          datasets: [{
            label: `Visitas`,
            data: v,
            borderColor: '#0066ff',
            backgroundColor: _grad,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: '#0066ff',
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5,
            pointHoverBackgroundColor: '#00d68f',
            tension: 0.35,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: {
              type: 'time',
              time: { unit: 'day', parser: 'yyyy-MM-dd', tooltipFormat: 'dd/MM/yyyy', displayFormats: { day: 'dd/MM' } },
              grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false },
              ticks: { color: '#94a3b8', font: { size: 10, family: "'DM Mono',Consolas,monospace" }, maxRotation: 0 },
              border: { display: false }
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
              ticks: { color: '#94a3b8', font: { size: 10, family: "'DM Mono',Consolas,monospace" } },
              border: { display: false }
            }
          },
          plugins: {
            legend: { display: false },
            title: { display: false },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#fff',
              bodyColor: '#00d68f',
              titleFont: { family: "'DM Sans',sans-serif", size: 12 },
              bodyFont: { family: "'DM Mono',Consolas,monospace", size: 13, weight: '600' },
              borderColor: 'rgba(0,102,255,0.3)',
              borderWidth: 1,
              padding: 12,
              cornerRadius: 8,
              displayColors: false,
              callbacks: {
                label: (ctx) => `${ctx.parsed.y.toLocaleString(_mfCfg().locale)} visitas`
              }
            }
          }
        }
      });
      console.log(`[Chart Init ${id}] Rendered OK.`);
    } catch (cE) {
      console.error(`[Chart Init ${id}] ERRO chart:`, cE);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "red";
      ctx.fillText(`Erro gráfico (${cE.message}). Ver console.`, canvas.width / 2, canvas.height / 2);
    }
  }

  // Mostra/oculta a linha do gráfico
  function toggleChartRow(competitorId, accessToken, rowElement, sellerName) {
    let nR = rowElement.nextElementSibling;
    const b = rowElement.querySelector('.toggle-chart-btn');
    if (nR?.classList.contains('chart-row')) {
      const c = nR.querySelector('canvas');
      if (c) {
        let i = Chart.getChart(c);
        if (i) i.destroy();
      }
      nR.parentNode.removeChild(nR);
      if (b) b.textContent = 'Ver gráfico';
      rowElement.classList.remove('chart-visible');
    } else {
      let cR = document.createElement('tr');
      cR.classList.add('chart-row');
      let c = document.createElement('td');
      const hC = rowElement.closest('table').querySelector('thead tr').cells.length;
      c.setAttribute('colspan', hC);
      cR.appendChild(c);
      let cC = document.createElement('div');
      cC.className = 'chart-card';
      cC.style.cssText = 'margin:8px 12px;';
      let cHeader = document.createElement('div');
      cHeader.className = 'chart-card-header';
      cHeader.innerHTML = `<span class="chart-card-icon">📈</span> <span class="chart-card-label">${sellerName || competitorId}</span><span class="chart-card-id">${competitorId}</span>`;
      cC.appendChild(cHeader);
      let cBody = document.createElement('div');
      cBody.className = 'chart-card-body';
      cBody.style.cssText = 'height:300px;position:relative;';
      let cv = document.createElement('canvas');
      cv.id = `chart-${competitorId}`;
      cBody.appendChild(cv);
      cC.appendChild(cBody);
      c.appendChild(cC);
      rowElement.parentNode.insertBefore(cR, rowElement.nextSibling);
      if (b) b.textContent = 'Ocultar gráfico';
      rowElement.classList.add('chart-visible');
      // Scroll table wrapper to left and chart into view
      const wrapper = rowElement.closest('.comp-table-wrapper');
      if (wrapper) wrapper.scrollLeft = 0;
      setTimeout(() => { cR.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
      showSellerChartInCanvas(competitorId, globalAccessToken, cv, sellerName, globalSelectedDays);
    }
  }

  // --- Atualiza APENAS os dados de visitas para os competidores JÁ CARREGADOS ---
  async function updateLoadedCompetitorVisits() {
      if (isFetchingBatch || isUpdatingVisits) {
          console.warn("Update Visits: Já em progresso ou buscando lote. Ignorando.");
          return;
      }
      isUpdatingVisits = true;
      const statusElement = document.getElementById("resultadoTexto");
      statusElement.textContent = `Atualizando visitas (${globalSelectedDays}d)...`;
      statusElement.className = 'text-info';
      const totalLoaded = globalCompetitorsData.length;
      let updatedCount = 0;
      globalTotalLoadedVisitas = 0; // Resetar o total global antes de somar os novos totais

      console.log(`[Update Visits] Iniciando atualização de visitas para ${totalLoaded} itens...`);

      const updatePromises = globalCompetitorsData.map(async (competitor) => {
          try {
                // Buscar APENAS os dados de visitas para o novo período selecionado globalmente
                const d = await fetchVisits(competitor.item_id, globalAccessToken, globalSelectedDays);
                if (d?.results) {
                    competitor.visitsResults = d.results; // Atualiza dados completos de visitas no objeto
                    competitor.visitsTotalSelectedPeriod = d.results.reduce((a, c) => a + (c.total || 0), 0); // Atualiza total para o período
                } else {
                    // Manter dados vazios se a busca de visitas falhar
                    competitor.visitsResults = [];
                    competitor.visitsTotalSelectedPeriod = 0;
                }
                updatedCount++;
          } catch (e) {
                console.warn(`Update Visits: Erro ao buscar visitas para ${competitor.item_id}: ${e.message}`);
                // Manter dados vazios em caso de erro fatal na busca de visitas para este item
                competitor.visitsResults = [];
                competitor.visitsTotalSelectedPeriod = 0;
                updatedCount++;
          }
      });

      // Esperar que todas as atualizações de visitas terminem
      await Promise.allSettled(updatePromises);

      // Recalcular o total global de visitas com os novos totais por item (agora somando todos os carregados)
      globalTotalLoadedVisitas = globalCompetitorsData.reduce((sum, item) => sum + (item.visitsTotalSelectedPeriod || 0), 0);
      console.log(`[Update Visits] Concluído. Total global acumulado: ${globalTotalLoadedVisitas}`);

      // Obter a página e itemsPerPage atuais para redesenhar a tabela na mesma posição
      const currentTable = document.querySelector('.competitors-table');
      // Usar valores padrão se a tabela ainda não existir
      const itemsPerPage = parseInt(currentTable?.getAttribute('data-items-per-page') || '10', 10);
      const currentPage = parseInt(currentTable?.getAttribute('data-current-page') || '1', 10);

      isUpdatingVisits = false;
      renderPaginatedCompetitorsTable(currentPage, itemsPerPage); // Re-renderiza a tabela na página atual
        // O status final será atualizado dentro de renderPaginatedCompetitorTable
  }


  // Executa map assíncrono com no máximo `limit` chamadas paralelas (throttle)
  async function throttledMap(items, fn, limit) {
    const results = new Array(items.length);
    const queue = items.map((item, i) => ({ item, i }));
    let qi = 0;
    async function worker() {
      while (qi < queue.length) {
        const { item, i } = queue[qi++];
        try {
          results[i] = { status: 'fulfilled', value: await fn(item) };
        } catch (e) {
          results[i] = { status: 'rejected', reason: e };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  // Exporta globalCompetitorsData para CSV e força download
  function exportCompetitorsCsv() {
    if (!globalCompetitorsData.length) return;
    const headers = ['Vendedor','Seller ID','Preço','Preço Final','Frete Grátis','Comissão','% Comissão','Repasse','Flex','Logística','Tipo','Visitas','Reputação','Medalha','Loja Oficial'];
    const rows = globalCompetitorsData.map(c => [
      c.seller_name || '',
      c.seller_id || '',
      c.priceNumeric || '',
      c.discountedPriceNumeric || '',
      (c.frete_gratis || '').replace(/,/g, ';'),
      (c.commissionValueDisplay || '').replace(/,/g, '.'),
      (c.commissionPercentageDisplay || '').replace(/,/g, '.'),
      (c.repasse || '').replace(/,/g, '.'),
      c.flex || '',
      c.shipping?.logistic_type || '',
      c.listing_type_id || '',
      c.visitsTotalSelectedPeriod != null ? c.visitsTotalSelectedPeriod : '',
      c.reputacao || '',
      c.power_seller_status || '',
      c.official_store_id ? 'Sim' : 'Não'
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `competidores_${globalSelectedDays}d_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Helper Function to Process a Batch (Busca dados completos de um lote) ---
  // Esta função busca todos os detalhes (APIs) para um conjunto de IDs
  // Ela SOMA as visitas dos itens processados ao total global.
  async function fetchAndProcessCompetitorBatch(batchIds) {
    if (isFetchingBatch) {
      console.warn("Batch Fetch: Em progresso. Ignorando.");
      return [];
    }
     if (isUpdatingVisits) {
         console.warn("Batch Fetch: Atualização de visitas em progresso. Ignorando.");
         return [];
     }

    isFetchingBatch = true;
    const statusElement = document.getElementById("resultadoTexto");
    const itemsToProcess = batchIds.length;
    console.log(`[Batch Fetch] Iniciando lote de ${itemsToProcess} IDs: [${batchIds.join(', ')}]`);
    const currentlyLoaded = globalCompetitorsData.length;
    statusElement.className = 'text-info'; // Define a classe inicial
    let processedCount = 0;

    try {
      // Processar os IDs do lote com throttle (máx 4 paralelos)
      const results = await throttledMap(batchIds, async (competitorId) => {

        // Declarar variáveis ANTES do try/catch interno
        let itemDetails = null;
        let shippingInfo = null;
        let visitsResults = [];
        let visitsTotalSelectedPeriod = 0;
        let sN = 'N/A';
        let finalRepLevel = '-';
        let finalMedalStatus = null;
        let shpC = 0;
        let cmV = null;
        let cmP = null;
        let cmPD = 'N/C';
        let cmVD = '-';
        let rpVl = 0;
        let rpD = '-';
        let prD = '-';
        let dscD = '-';
        let dscPD = '-';
        let flexValue = "Não";
        let pDs = '-';
        let hasFreeShipping = false;
        let fGD = 'Não';
        let totalSales = null;
        let uf = null;
        let warranty = null;
        let ratingAvg = null;
        let ratingCount = null;

        try {
          // 1. Busca detalhes básicos (SCRAPER ONLY)
          itemDetails = await fetchItemDetails(competitorId);
          if (!itemDetails) {
            console.warn(`[Batch Proc] Item ${competitorId} falhou na busca de detalhes básicos.`);
            throw new Error("Falha nos detalhes básicos do item.");
          }

          const _stRaw = itemDetails.seller_address?.state;
          const _stName = typeof _stRaw === 'string' ? _stRaw : (_stRaw?.name || null);
          if (_stName) {
            const _ufMap = {'Acre':'AC','Alagoas':'AL','Amapá':'AP','Amazonas':'AM','Bahia':'BA','Ceará':'CE','Distrito Federal':'DF','Espírito Santo':'ES','Goiás':'GO','Maranhão':'MA','Mato Grosso':'MT','Mato Grosso do Sul':'MS','Minas Gerais':'MG','Pará':'PA','Paraíba':'PB','Paraná':'PR','Pernambuco':'PE','Piauí':'PI','Rio de Janeiro':'RJ','Rio Grande do Norte':'RN','Rio Grande do Sul':'RS','Rondônia':'RO','Roraima':'RR','Santa Catarina':'SC','São Paulo':'SP','Sergipe':'SE','Tocantins':'TO'};
            uf = _ufMap[_stName] || null;
          }
          warranty = itemDetails.warranty || null;

          // 2. Busca detalhes de envio (API) - Usa itemDetails.id
          shippingInfo = await fetchShippingDetails(itemDetails.id, globalAccessToken);

          // 3. Mescla/Atualiza detalhes de envio, priorizando API
          if (shippingInfo) {
            itemDetails.shipping = {
              mode: shippingInfo.mode || itemDetails.shipping?.mode,
              logistic_type: shippingInfo.logistic_type || itemDetails.shipping?.logistic_type,
              free_shipping: typeof shippingInfo.free_shipping === 'boolean' ? shippingInfo.free_shipping : itemDetails.shipping?.free_shipping,
              tags: shippingInfo.tags || itemDetails.shipping?.tags || [],
              store_pick_up: typeof shippingInfo.store_pick_up === 'boolean' ? shippingInfo.store_pick_up : itemDetails.shipping?.store_pick_up,
              local_pick_up: typeof shippingInfo.local_pick_up === 'boolean' ? shippingInfo.local_pick_up : itemDetails.shipping?.local_pick_up
            };
          } else {
            console.warn(`[Batch Proc] /shipping-details falhou/vazio p/ ${itemDetails.id}. Usando dados iniciais.`);
          }

          // 4. Busca Visitas (API) para o período selecionado globalmente
          const visitsData = await fetchVisits(itemDetails.id, globalAccessToken, globalSelectedDays);
          if (visitsData?.results) {
              visitsResults = visitsData.results;
              visitsTotalSelectedPeriod = visitsResults.reduce((a, c) => a + (c.total || 0), 0);
          }

          // 5. Busca Detalhes do Vendedor & Refina Reputação/Medalha (API)
          sN = formatSellerName(itemDetails._scraper_seller_nickname) || 'N/A';
          let sellerPermalink = null; // Link do perfil do vendedor no ML
          finalRepLevel = itemDetails.seller_reputation?.level_id || '-';
          finalMedalStatus = itemDetails.power_seller_status || null;

          let userIdToQuery = null;
          let idSource = "";

          if (itemDetails.seller_id) {
              userIdToQuery = String(itemDetails.seller_id);
              idSource = "seller_id";
          } else if (itemDetails.official_store_id) {
              userIdToQuery = String(itemDetails.official_store_id);
              idSource = "official_store_id";
          }

          // Minha Página: permalink /pagina/ OU loja oficial (sempre tem)
          const scraperPermalink = itemDetails._scraper_seller_permalink || '';
          let hasEshop = scraperPermalink.includes('/pagina/') || !!itemDetails.official_store_id;
          let eshopUrl = scraperPermalink.includes('/pagina/') ? scraperPermalink : null;
          if (userIdToQuery) {
              console.log(`[Batch Proc] Buscando user details via ${idSource}: ${userIdToQuery}`);
              const userDetails = await fetchUserDetails(userIdToQuery);
              if (userDetails) {
                  sellerPermalink = userDetails.permalink || null;
                  sN = formatSellerName(userDetails.nickname) || 'N/A';
                  if (userDetails.seller_reputation?.level_id) {
                      finalRepLevel = userDetails.seller_reputation.level_id;
                  }
                  if (userDetails.seller_reputation?.power_seller_status) {
                      finalMedalStatus = userDetails.seller_reputation.power_seller_status;
                  }
                  const _t = userDetails.seller_reputation?.transactions?.total;
                  if (_t != null) totalSales = Number(_t);
              } else {
                  console.warn(`[Batch Proc] fetchUserDetails falhou para ${idSource} ${userIdToQuery}.`);
              }

              // Tenta buscar nome da loja oficial via /brands (só funciona para Lojas Oficiais)
              if (itemDetails.seller_id && itemDetails.official_store_id) {
                  const brandName = await fetchBrandName(itemDetails.seller_id);
                  if (brandName) {
                      sN = brandName;
                      console.log(`[Batch Proc] Nome da loja oficial encontrado via brands: ${brandName}`);
                  }
              }
          } else {
              console.warn(`[Batch Proc] seller_id e official_store_id NULOS para ${itemDetails.id}.`);
          }


          // 6. Calcula Finanças (Comissões e Custo Frete Grátis via APIs)
          const prV = itemDetails.price || 0;
          const dscP = itemDetails.price_discounted != null ? itemDetails.price_discounted : prV;
          const dscV = prV - dscP;


          hasFreeShipping = itemDetails.shipping?.free_shipping === true;
          fGD = hasFreeShipping ? 'Sim' : 'Não';
          // Buscar custo de envio ML para TODOS os itens (taxa de frete)
          if (itemDetails.seller_id) {
            try {
              const d = await fetchShippingFreeCost(itemDetails.id, itemDetails.seller_id, globalAccessToken);
              if (d?.cost != null) {
                shpC = Number(d.cost);
                if (hasFreeShipping) {
                  fGD = `Sim (${d.currency||'R$'} ${shpC.toLocaleString(_mfCfg().locale,{minimumFractionDigits:2,maximumFractionDigits:2})})`;
                }
              } else if (hasFreeShipping) {
                fGD = 'Sim (Custo?)';
              }
            } catch (e) {
              console.warn(`[Batch Proc] Erro Frete Custo ${itemDetails.id}: ${e.message}`);
              if (hasFreeShipping) fGD = 'Sim (Erro?)';
            }
          } else {
            shpC = 0;
            if (hasFreeShipping) fGD = 'Sim (Custo?)';
          }

          if (itemDetails.category_id && dscP > 0) {
            let commissionData = null;
            try {
              commissionData = await fetchCommissions(dscP, itemDetails.category_id, itemDetails.listing_type_id, globalAccessToken);
            } catch (cE) {
              console.warn(`[Batch Proc] Erro ao buscar Comissão ${itemDetails.id}: ${cE.message}`);
              cmPD = 'Erro';
              cmVD = 'Erro';
            }
            if (commissionData) {
              if (!itemDetails.listing_type_id && commissionData.listing_type_id) {
                console.log(`%c[Fallback] Atualizando listing_type p/ ${itemDetails.id} via comissão: ${commissionData.listing_type_id}`, "color: blue");
                itemDetails.listing_type_id = commissionData.listing_type_id;
              }
              if (commissionData.sale_fee_amount != null) {
                cmV = Number(commissionData.sale_fee_amount);
                cmVD = fmtMoney(cmV);
                if (dscP > 0) {
                  cmP = (cmV / dscP) * 100;
                  cmPD = cmP.toFixed(1) + '%';
                } else {
                  cmPD = 'Div/0';
                  console.warn(`[Batch Proc] Preço 0 p/ ${itemDetails.id}, não calc % comissão.`);
                }
              } else {
                cmPD = '-';
                cmVD = '-';
                console.warn(`[Batch Proc] Comissão OK p/ ${itemDetails.id}, mas sem sale_fee_amount.`);
              }
            } else if (!cmPD || cmPD === 'N/C') {
              cmPD = 'Erro';
              cmVD = 'Erro';
            }
          } else {
            console.warn(`[Batch Proc] Comissão N/C ${itemDetails.id} (sem cat/price).`);
              cmPD = 'N/C'; cmVD = '-';
          }

          // Repasse: só desconta frete do vendedor se ele oferece frete grátis
          const _shpDeduct = hasFreeShipping ? shpC : 0;
          rpVl = dscP - (cmV || 0) - _shpDeduct;
          rpD = (dscP > 0 || cmV > 0 || _shpDeduct > 0) ? rpVl.toLocaleString(_mfCfg().locale, { style: 'currency', currency: _mfCfg().currency }) : '-';

          prD = prV > 0 ? prV.toLocaleString(_mfCfg().locale, { style: 'currency', currency: _mfCfg().currency }) : '-';
          dscD = dscV > 0.01 ? dscV.toLocaleString(_mfCfg().locale, { style: 'currency', currency: _mfCfg().currency }) : '-';
          dscPD = (dscP !== prV && dscP > 0) ? dscP.toLocaleString(_mfCfg().locale, { style: 'currency', currency: _mfCfg().currency }) : prD;

            if (typeof itemDetails.priceNumeric === 'number' && typeof itemDetails.discountedPriceNumeric === 'number' && itemDetails.priceNumeric > 0 && itemDetails.discountedPriceNumeric < itemDetails.priceNumeric) {
              let pc = ((itemDetails.priceNumeric - itemDetails.discountedPriceNumeric) / itemDetails.priceNumeric) * 100;
              pDs = pc.toFixed(0) + '%';
            }

          flexValue = itemDetails.shipping?.tags?.some(tag => tag === "self_service_in" || tag === "mandatory_flex_shipping") ? "Sim" : "Não";


          const compData = {
            item_id: itemDetails.id,
            seller_id: itemDetails.seller_id,
            seller_name: sN,
            seller_permalink: sellerPermalink, // Link do perfil do vendedor no ML
            reputacao: finalRepLevel,
            power_seller_status: finalMedalStatus,
            official_store_id: itemDetails.official_store_id,
            price: prD,
            discount: dscD,
            discountedPrice: dscPD,
            listing_type_id: itemDetails.listing_type_id,
            shipping: itemDetails.shipping,
            visitsResults: visitsResults,
            visitsTotalSelectedPeriod: visitsTotalSelectedPeriod,
            commissionPercentageDisplay: cmPD,
            commissionValueDisplay: cmVD,
            repasse: rpD,
            repasseNumeric: rpVl,
            frete_gratis: fGD,
            shippingCostML: shpC,
            commissionNumeric: cmV,
            flex: flexValue,
            priceNumeric: prV,
            discountedPriceNumeric: dscP,
            totalSales: totalSales,
            uf: uf,
            warranty: warranty,
            hasEshop: hasEshop,
            eshopUrl: eshopUrl,
            ratingAvg: ratingAvg,
            ratingCount: ratingCount
          };
          return compData;
        } catch (error) {
          console.error(`[Batch Proc] Erro ao processar ${competitorId}:`, error.message, error);
          return null;
        } finally {
            processedCount++;
        }
      }, 4); // limit: 4 chamadas paralelas

      const newData = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);

      globalCompetitorsData.push(...newData);

      const batchTotalVisits = newData.reduce((sum, item) => sum + (item.visitsTotalSelectedPeriod || 0), 0);
      globalTotalLoadedVisitas += batchTotalVisits;
      console.log(`[Batch Fetch] Lote concluído. ${newData.length} itens válidos adicionados. Total global de competidores: ${globalCompetitorsData.length}. Total global visitas acumulado: ${globalTotalLoadedVisitas}`);

      return newData;

    } catch (batchError) {
      console.error("[Batch Fetch] Erro fatal no lote:", batchError);
      throw batchError;
    } finally {
      isFetchingBatch = false;
        if (!isUpdatingVisits) {
            requestAnimationFrame(() => {
                const totalLoaded = globalCompetitorsData.length;
                const totalKnown = globalCompetitorIds.length;
                const statusElement = document.getElementById("resultadoTexto");
                if (!statusElement) return;

                if (totalKnown > 0) {
                    if (totalLoaded === totalKnown) {
                        statusElement.textContent = `Todos os ${totalLoaded} competidores carregados.`;
                        statusElement.className = 'text-success';
                    } else {
                        statusElement.textContent = `Carregados ${totalLoaded}/${totalKnown}. Continue paginando para carregar mais.`;
                        statusElement.className = 'text-info';
                    }
                } else if (totalLoaded > 0) {
                    statusElement.textContent = `Processamento concluído. ${totalLoaded} competidores carregados (total desconhecido).`;
                    statusElement.className = 'text-success';
                } else {
                    statusElement.textContent = 'Nenhum competidor encontrado.';
                    statusElement.className = 'text-warning';
                }
            });
        }
    }
  }


  // --- Renderiza a Tabela Paginação ---
  async function renderPaginatedCompetitorsTable(currentPage, itemsPerPage) {
    const tabelaContainer = document.getElementById('tabelaCompetidores');
    const paginationContainer = document.getElementById('paginationControls');
    const statusElement = document.getElementById("resultadoTexto");
    if (!tabelaContainer || !paginationContainer || !statusElement) {
        console.error("renderPaginatedCompetitorsTable: Elementos DOM essenciais não encontrados!");
        return;
    }

    globalCompetitorsData.sort((a, b) => {
      let av, bv;
      switch (globalSortColumn) {
        case 'vendedor': av = (a.seller_name||'').toLowerCase(); bv = (b.seller_name||'').toLowerCase(); break;
        case 'preco': av = a.priceNumeric||0; bv = b.priceNumeric||0; break;
        case 'final': av = a.discountedPriceNumeric||0; bv = b.discountedPriceNumeric||0; break;
        case 'repasse': av = a.repasseNumeric||0; bv = b.repasseNumeric||0; break;

        case 'visitas': default: av = a.visitsTotalSelectedPeriod||0; bv = b.visitsTotalSelectedPeriod||0; break;
      }
      if (av < bv) return globalSortDirection === 'asc' ? -1 : 1;
      if (av > bv) return globalSortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    const totalLoadedItems = globalCompetitorsData.length;
    const totalKnownItems = globalCompetitorIds.length;
    const totalPages = totalKnownItems > 0 ? Math.ceil(totalKnownItems / itemsPerPage) : 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const competitorsSlice = globalCompetitorsData.slice(startIndex, Math.min(endIndex, totalLoadedItems));

    console.log(`[Render Table] Req Page: ${currentPage}, Items/Page: ${itemsPerPage}, Slice Range: ${startIndex}-${Math.min(endIndex, totalLoadedItems)-1}, Loaded: ${totalLoadedItems}/${totalKnownItems}, Total Pages: ${totalPages}`);

    if (competitorsSlice.length > 0) {
      console.log(`[Render Table] Rendering available data page ${currentPage}. Slice count: ${competitorsSlice.length}`);
      tabelaContainer.innerHTML = '';
      paginationContainer.innerHTML = '';

      // --- Busca do Líder para Δ Dest. e card ---
      const winnerData = globalCompetitorsData.find(c => c.item_id === globalWinnerItemId);
      const winnerPrice = winnerData?.discountedPriceNumeric || 0;

      // --- Aplicar filtros globais ---
      const filteredSlice = competitorsSlice.filter(c => {
        if (globalFilters.logistica && c.shipping?.logistic_type !== globalFilters.logistica) return false;
        if (globalFilters.frete === 'sim' && !String(c.frete_gratis||'').startsWith('Sim')) return false;
        if (globalFilters.frete === 'nao' && String(c.frete_gratis||'').startsWith('Sim')) return false;
        if (globalFilters.flex === 'sim' && c.flex !== 'Sim') return false;
        if (globalFilters.flex === 'nao' && c.flex !== 'Não') return false;
        if (globalFilters.loja === 'sim' && !c.official_store_id) return false;
        if (globalFilters.loja === 'nao' && c.official_store_id) return false;
        if (globalFilters.uf && (typeof c.uf === 'string' ? c.uf : '').toUpperCase() !== globalFilters.uf.toUpperCase()) return false;
        return true;
      });

      // --- Top progress bar (3px no topo da página) ---
      let _topProg = document.getElementById('comp-top-progress');
      if (!_topProg) {
        _topProg = document.createElement('div');
        _topProg.id = 'comp-top-progress';
        _topProg.className = 'top-progress';
        _topProg.innerHTML = '<div class="top-progress-fill"></div>';
        document.body.insertBefore(_topProg, document.body.firstChild);
      }
      const _topPct = totalKnownItems > 0 ? Math.round(totalLoadedItems / totalKnownItems * 100) : 100;
      _topProg.querySelector('.top-progress-fill').style.width = _topPct + '%';

      // --- Resumo estatístico ---
      const _allLoaded = globalCompetitorsData;
      const _prices = _allLoaded.filter(c => c.discountedPriceNumeric > 0).map(c => c.discountedPriceNumeric);
      const _avgPrice = _prices.length ? (_prices.reduce((a,b)=>a+b,0)/_prices.length) : 0;
      const _minPrice = _prices.length ? Math.min(..._prices) : 0;
      const _maxPrice = _prices.length ? Math.max(..._prices) : 0;
      const _full = _allLoaded.filter(c => c.shipping?.logistic_type === 'fulfillment').length;
      const _frete = _allLoaded.filter(c => String(c.frete_gratis||'').startsWith('Sim')).length;
      const _flex = _allLoaded.filter(c => c.flex === 'Sim').length;
      // --- Ticker Bar (animated stats) ---
      const _fullPct = _allLoaded.length ? Math.round(_full/_allLoaded.length*100) : 0;
      const _fretePct = _allLoaded.length ? Math.round(_frete/_allLoaded.length*100) : 0;
      const _flexPct = _allLoaded.length ? Math.round(_flex/_allLoaded.length*100) : 0;
      const _tickerItems = [
        ['PREÇO MÉDIO', _avgPrice.toLocaleString(_mfCfg().locale,{style:'currency',currency:_mfCfg().currency}), ''],
        ['FAIXA', `${_minPrice.toLocaleString(_mfCfg().locale,{style:'currency',currency:_mfCfg().currency})} — ${_maxPrice.toLocaleString(_mfCfg().locale,{style:'currency',currency:_mfCfg().currency})}`, ''],
        ['FULL', `${_fullPct}%`, 'blue'],
        ['FRETE GRÁTIS', `${_fretePct}%`, _fretePct > 0 ? 'green' : 'red'],
        ['FLEX', `${_flexPct}%`, _flexPct > 30 ? 'green' : ''],
        ['VENDEDORES', `${totalKnownItems}`, ''],
        ['LÍDER', `${(winnerData?.visitsTotalSelectedPeriod||0).toLocaleString(_mfCfg().locale)} vis`, 'green'],
      ];
      const _tickerHtml = _tickerItems.map(([l,v,c]) => `<div class="ticker-item"><span class="ticker-label">${l}</span><span class="ticker-value${c?' '+c:''}">${v}</span></div>`).join('');
      const _ticker = document.createElement('div');
      _ticker.className = 'ticker-bar';
      _ticker.innerHTML = `<div class="ticker-inner">${_tickerHtml}${_tickerHtml}</div>`;
      tabelaContainer.appendChild(_ticker);

      // --- Progress Bar (loading sellers) ---
      const _loadPct = totalKnownItems > 0 ? Math.round(totalLoadedItems / totalKnownItems * 100) : 100;
      const _progressBar = document.createElement('div');
      _progressBar.className = 'loading-bar-container';
      _progressBar.innerHTML = `<span class="loading-text">Carregando vendedores: <strong>${totalLoadedItems} / ${totalKnownItems}</strong></span><div class="loading-track"><div class="loading-fill" style="width:${_loadPct}%"></div></div><span class="loading-pct">${_loadPct}%</span>`;
      tabelaContainer.appendChild(_progressBar);

      // --- Card "Como Ganhar o Destaque" ---
      const myItem = globalMlSellerId ? _allLoaded.find(c => String(c.seller_id) === globalMlSellerId) : null;
      if (myItem && winnerData && myItem.item_id !== winnerData.item_id) {
        const _card = document.createElement('div');
        _card.className = 'como-ganhar';
        const _logMap = { fulfillment: 'Full ⚡', cross_docking: 'Coleta 🚚', xd_drop_off: 'Places 📦', drop_off: 'Correios ✉️' };
        const _getLog = s => _logMap[s?.logistic_type] || s?.logistic_type || '?';
        const _gaps = [
          ['Preço Final',
            `Você: ${(myItem.discountedPriceNumeric||0).toLocaleString(_mfCfg().locale,{style:'currency',currency:_mfCfg().currency})}`,
            `Líder: ${(winnerPrice).toLocaleString(_mfCfg().locale,{style:'currency',currency:_mfCfg().currency})}`,
            myItem.discountedPriceNumeric <= winnerPrice ? 'gap-ok' : 'gap-bad'],
          ['Logística',
            `Você: ${_getLog(myItem.shipping)}`,
            `Líder: ${_getLog(winnerData.shipping)}`,
            myItem.shipping?.logistic_type === winnerData.shipping?.logistic_type ? 'gap-ok' :
              myItem.shipping?.logistic_type === 'fulfillment' ? 'gap-ok' : 'gap-bad'],
          ['Frete Grátis',
            `Você: ${String(myItem.frete_gratis||'Não').split(' ')[0]}`,
            `Líder: ${String(winnerData.frete_gratis||'Não').split(' ')[0]}`,
            String(myItem.frete_gratis||'').startsWith('Sim') ? 'gap-ok' : 'gap-warn'],
          ['Reputação',
            `Você: nível ${(myItem.reputacao||'-').substring(0,1)}`,
            `Líder: nível ${(winnerData.reputacao||'-').substring(0,1)}`,
            (myItem.reputacao||'0').substring(0,1) >= (winnerData.reputacao||'0').substring(0,1) ? 'gap-ok' : 'gap-bad'],
          ['Visitas/período',
            `Você: ${(myItem.visitsTotalSelectedPeriod||0).toLocaleString(_mfCfg().locale)}`,
            `Líder: ${(winnerData.visitsTotalSelectedPeriod||0).toLocaleString(_mfCfg().locale)}`,
            (myItem.visitsTotalSelectedPeriod||0) >= (winnerData.visitsTotalSelectedPeriod||0) ? 'gap-ok' : 'gap-warn'],
        ];
        _card.innerHTML = `<h6>🎯 Como Ganhar o Destaque</h6>`;
        _gaps.forEach(([label, you, lider, cls]) => {
          const row = document.createElement('div');
          row.className = `gap-item ${cls}`;
          row.innerHTML = `<span><b>${label}</b></span><span>${you}</span><span>${lider}</span>`;
          _card.appendChild(row);
        });
        tabelaContainer.appendChild(_card);
      }

      // --- Toolbar: Toggle Filters with counts + CSV ---
      const _toolbar = document.createElement('div');
      _toolbar.className = 'comp-toolbar';
      const _filtersLeft = document.createElement('div');
      _filtersLeft.className = 'toolbar-left';
      const _hasAnyFilter = Object.values(globalFilters).some(v => v);
      const _totalL = _allLoaded.length || 1;
      const _toggles = [
        ['Todos', '', '', !_hasAnyFilter, _allLoaded.length],
        ['Full', 'logistica', 'fulfillment', globalFilters.logistica === 'fulfillment', _full],
        ['Frete Grátis', 'frete', 'sim', globalFilters.frete === 'sim', _frete],
        ['Flex', 'flex', 'sim', globalFilters.flex === 'sim', _flex],
        ['Loja Oficial', 'loja', 'sim', globalFilters.loja === 'sim', _allLoaded.filter(c => !!c.official_store_id).length],
      ];
      _toggles.forEach(([label, key, val, active, count]) => {
        const pct = Math.round(count / _totalL * 100);
        const btn = document.createElement('button');
        btn.className = 'filter-toggle' + (active ? ' active' : '');
        btn.innerHTML = `${label} <span class="filter-count">${pct}%</span>`;
        btn.onclick = () => {
          if (!key) { globalFilters = { logistica:'', frete:'', flex:'', loja:'', uf:'' }; }
          else { globalFilters = { logistica:'', frete:'', flex:'', loja:'', uf:'' }; globalFilters[key] = val; }
          renderPaginatedCompetitorsTable(1, itemsPerPage);
        };
        _filtersLeft.appendChild(btn);
      });
      _toolbar.appendChild(_filtersLeft);
      const _toolRight = document.createElement('div');
      _toolRight.className = 'toolbar-right';
      const _csvBtn = document.createElement('button');
      _csvBtn.className = 'comp-csv-btn';
      _csvBtn.innerHTML = '▼ Exportar CSV';
      _csvBtn.title = `Exportar ${globalCompetitorsData.length} competidores`;
      _csvBtn.onclick = () => exportCompetitorsCsv();
      _toolRight.appendChild(_csvBtn);
      _toolbar.appendChild(_toolRight);
      tabelaContainer.appendChild(_toolbar);

      const table = document.createElement('table');
      table.className = 'competitors-table table table-striped table-hover table-sm';
      table.setAttribute('data-items-per-page', itemsPerPage);
      table.setAttribute('data-current-page', currentPage);

      const thead = table.createTHead();
      thead.className = 'thead-light';
      const hR = thead.insertRow();
      const hds = ['Pos.', 'Vendedor', 'Rep.', 'Med.', 'Loja', 'Pág.', 'UF', 'Preço', 'Desc.', '%', 'Final', 'Δ Dest.', 'Frete Grátis', 'Frete', 'Flex', 'Log.', 'Tipo', 'Garantia', 'Comissão', '% Comis.', 'Repasse'];
      if (globalCusto > 0) hds.push('Margem');
      hds.push('Visitas', 'Visitas %', 'Tend.', 'Ação');
      const hTs = ['Posição no ranking', 'Nome', 'Reputação', 'Medalha', 'Loja Oficial', 'Minha Página', 'Estado', 'Preço Original', 'Valor Desconto', '% Desconto', 'Preço Final', 'Diferença vs Destaque', 'Frete Grátis', 'Custo de Envio ML', 'Envio Flex', 'Logística', 'Tipo Anúncio', 'Garantia', 'Comissão', 'Comissão %', 'Repasse (Líquido)'];
      if (globalCusto > 0) hTs.push('Margem de lucro estimada');
      hTs.push(`Visitas (${globalSelectedDays}d)`, '% Visitas', 'Tendência (7d)', 'Ações');

      const _mobileHideCols = ['Rep.','Loja','Pág.','Desc.','%','Tipo','Garantia','Comissão','% Comis.','Repasse','Visitas %','Margem','Frete'];
      hds.forEach((hTxt, idx) => {
        const th = document.createElement('th');
        th.scope = 'col';
        if (_mobileHideCols.includes(hTxt)) th.classList.add('col-hide-mobile');
        if (hTxt === 'Visitas') {
          th.innerHTML = '';
          const d = document.createElement('div');
          d.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
          d.appendChild(document.createTextNode('Visitas '));
          const s = document.createElement('select');
          s.id = 'visitsSelector';
          s.title = 'Período';
          s.className = 'form-select form-select-sm';
          s.style.cssText = 'width:auto;margin-left:3px;';
          [7, 15, 30, 60, 90].forEach(dys => {
            const o = document.createElement('option');
            o.value = dys;
            o.textContent = dys + 'd';
            if (dys === globalSelectedDays) o.selected = true;
            s.appendChild(o);
          });
          s.addEventListener('change', async () => {
              const newSelectedDays = parseInt(s.value) || 90;
              if (newSelectedDays === globalSelectedDays) return;
              globalSelectedDays = newSelectedDays;
              // Fechar gráficos abertos (ficam desatualizados com novo período)
              document.querySelectorAll('.chart-row').forEach(cr => {
                const cv = cr.querySelector('canvas');
                if (cv) { let ch = Chart.getChart(cv); if (ch) ch.destroy(); }
                cr.remove();
              });
              document.querySelectorAll('.chart-visible').forEach(r => r.classList.remove('chart-visible'));
              document.querySelectorAll('.toggle-chart-btn').forEach(b => { b.textContent = 'Ver gráfico'; });
              await updateLoadedCompetitorVisits();
          });
          d.appendChild(s);
          th.appendChild(d);
          th.title = `Visitas/Período Selecionado (atualmente ${globalSelectedDays} dias)`;
          // Tornar texto "Visitas" clicável para ordenar
          const visLabel = d.childNodes[0];
          if (visLabel) {
            const vSpan = document.createElement('span');
            vSpan.style.cursor = 'pointer';
            const vInd = `<span class="sort-ind${globalSortColumn==='visitas'?' active':''}">${globalSortColumn==='visitas'?(globalSortDirection==='asc'?'▲':'▼'):'⇕'}</span>`;
            vSpan.innerHTML = 'Visitas ' + vInd;
            vSpan.title = 'Clique para ordenar por visitas';
            vSpan.addEventListener('click', () => {
              if (globalSortColumn === 'visitas') globalSortDirection = globalSortDirection === 'desc' ? 'asc' : 'desc';
              else { globalSortColumn = 'visitas'; globalSortDirection = 'desc'; }
              renderPaginatedCompetitorsTable(currentPage, itemsPerPage);
            });
            d.replaceChild(vSpan, visLabel);
          }
        } else {
          const _sortMap = { 'Vendedor':'vendedor', 'Preço':'preco', 'Final':'final', 'Repasse':'repasse' };
          const sortKey = _sortMap[hTxt];
          if (sortKey) {
            th.classList.add('th-sortable');
            const ind = globalSortColumn === sortKey ? (globalSortDirection === 'asc' ? '▲' : '▼') : '⇕';
            th.innerHTML = `${hTxt} <span class="sort-ind${globalSortColumn===sortKey?' active':''}">${ind}</span>`;
            th.addEventListener('click', () => {
              if (globalSortColumn === sortKey) globalSortDirection = globalSortDirection === 'desc' ? 'asc' : 'desc';
              else { globalSortColumn = sortKey; globalSortDirection = 'desc'; }
              renderPaginatedCompetitorsTable(currentPage, itemsPerPage);
            });
          } else {
            th.textContent = hTxt;
          }
        }
        th.title = hTs[idx];
        if (['Pos.', 'Rep.', 'Med.', 'Loja', 'Pág.', 'UF', 'Flex', 'Log.', 'Tipo', 'Tend.', 'Garantia'].includes(hTxt)) th.classList.add('text-center');
        if (['Preço', 'Desc.', '%', 'Final', 'Δ Dest.', 'Frete Grátis', 'Frete', 'Comissão', '% Comis.', 'Repasse', 'Visitas', 'Visitas %', 'Margem'].includes(hTxt)) th.classList.add('text-end');
        if (hTxt === 'Margem') th.classList.add('margem-highlight-th');
        hR.appendChild(th);
      });

      const tbody = table.createTBody();
      filteredSlice.forEach((cmp) => {
        const r = tbody.insertRow();
        const isWinner = cmp.item_id === globalWinnerItemId;
        const isMyItem = globalMlSellerId && cmp.seller_id && String(cmp.seller_id) === globalMlSellerId;
        const isThreat = !isWinner && winnerPrice > 0 && cmp.discountedPriceNumeric > 0 && cmp.discountedPriceNumeric <= winnerPrice * 1.05;
        if (isWinner) r.classList.add('table-success', 'winner-row');
        if (isMyItem) r.classList.add('my-item-row');
        if (isThreat && !isMyItem) r.classList.add('threat-row');

        // Posição no ranking (índice global pós-ordenação)
        const rankPos = globalCompetitorsData.indexOf(cmp) + 1;
        const posD = `#${rankPos}`;

        // Δ Dest. (diferença vs vendedor em destaque)
        let deltaBB = '-';
        if (winnerPrice > 0 && cmp.discountedPriceNumeric > 0 && !isWinner) {
          const diff = cmp.discountedPriceNumeric - winnerPrice;
          const sign = diff > 0 ? '+' : '';
          deltaBB = `<span class="${diff > 0 ? 'delta-neg' : 'delta-pos'}">${sign}${diff.toLocaleString(_mfCfg().locale,{style:'currency',currency:_mfCfg().currency})}</span>`;
        } else if (isWinner) {
          deltaBB = '<span style="color:#16a34a;font-weight:600;">★ Líder</span>';
        }

        let vC = '-';
        let tI = '-';
        const visitsCount = cmp.visitsTotalSelectedPeriod;
        if (visitsCount != null && visitsCount >= 0) {
            vC = visitsCount.toLocaleString(_mfCfg().locale);
            if (cmp.visitsResults?.length >= 14) {
                const sV = [...cmp.visitsResults].sort((a, b) => new Date(a.date) - new Date(b.date));
                const l7 = sV.slice(-7).reduce((a, c) => a + (c.total || 0), 0);
                const p7 = sV.slice(-14, -7).reduce((a, c) => a + (c.total || 0), 0);
                if (l7 > p7) tI = '<span style="color:green;" title="Alta (últimos 7 dias vs 7 dias anteriores)">▲</span>';
                else if (l7 < p7) tI = '<span style="color:red;" title="Baixa (últimos 7 dias vs 7 dias anteriores)">▼</span>';
                else tI = '<span title="Estável (últimos 7 dias vs 7 dias anteriores)">▬</span>';
            } else tI = '<span title="Dados insuficientes (<14d)">-</span>';
        }

        let visitPercentageDisplay = '-';
        if (globalTotalLoadedVisitas > 0 && visitsCount != null && visitsCount >= 0) {
          visitPercentageDisplay = ((visitsCount / globalTotalLoadedVisitas) * 100).toFixed(1) + '%';
        } else if (visitsCount > 0 && globalTotalLoadedVisitas === 0 && globalCompetitorsData.length > 0) {
            visitPercentageDisplay = '100.0%';
        } else if (visitsCount === 0 && globalTotalLoadedVisitas >= 0 && globalCompetitorsData.length > 0) {
            visitPercentageDisplay = '0.0%';
        }

        let sN = escapeHtml(cmp.seller_name || 'N/A');
        if (isWinner) sN = `★ ${sN}`;
        if (cmp.seller_permalink) {
          const sellerUrl = sanitizeUrl(cmp.seller_permalink);
          if (sellerUrl) sN = `<a href="${escapeHtml(sellerUrl)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline dotted;text-underline-offset:3px;" title="Ver perfil no ML">${sN}</a>`;
        }

        let rH = getReputacaoHtml(cmp.reputacao);
        let mH = getMedalhaHtml(cmp.power_seller_status);
        let lH = getLojaOficialHtml(cmp.official_store_id);
        let lgH = getLogisticaStyledHtml(cmp.shipping);
        let tH = getTipoAnuncioHtml(cmp.listing_type_id);

        const p = cmp.price || '-';
        const d = cmp.discount || '-';
        const pD = cmp.discountedPrice || '-';
        const fG = cmp.frete_gratis || '-';
        const cmVD = cmp.commissionValueDisplay || '-';
        const cPD = cmp.commissionPercentageDisplay || 'N/C';
        const rp = cmp.repasse || '-';

        const ufD = cmp.uf ? cmp.uf.toUpperCase() : '-';
        const garantiaD = formatWarranty(cmp.warranty);

        let pDs = '-';
        if (typeof cmp.priceNumeric === 'number' && typeof cmp.discountedPriceNumeric === 'number' && cmp.priceNumeric > 0 && cmp.discountedPriceNumeric < cmp.priceNumeric) {
          pDs = (((cmp.priceNumeric - cmp.discountedPriceNumeric) / cmp.priceNumeric) * 100).toFixed(0) + '%';
        }
        let flexHtml = getFlexHtml(cmp.flex);
        let eH = getEshopHtml(cmp.hasEshop, cmp.eshopUrl);

        const freteD = (cmp.shippingCostML > 0) ? fmtMoney(cmp.shippingCostML) : '—';
        const cls = [posD, sN, rH, mH, lH, eH, ufD, p, d, pDs, pD, deltaBB, fG, freteD, flexHtml, lgH, tH, garantiaD, cmVD, cPD, rp];
        if (globalCusto > 0) {
          const _precoVenda = cmp.discountedPriceNumeric || 0;
          const _comissao = cmp.commissionNumeric;
          if (_precoVenda > 0 && _comissao != null) {
            const _impostoVenda = _precoVenda * (globalTaxRate / 100);
            const _margemR = _precoVenda - _comissao - globalShippingFee - globalCusto - _impostoVenda;
            const _margemPct = (_margemR / _precoVenda * 100);
            const _mCls = _margemR >= 0 ? 'comp-margem-pos' : 'comp-margem-neg';
            const _sign = _margemR >= 0 ? '+' : '';
            cls.push(`<span class="${_mCls}">${_sign}${_margemR.toLocaleString(_mfCfg().locale,{style:'currency',currency:_mfCfg().currency})}<br><small>${_sign}${_margemPct.toFixed(1)}%</small></span>`);
          } else if (_comissao == null) {
            cls.push('<span class="comp-margem-nil" title="Comissão indisponível">N/D</span>');
          } else {
            cls.push('<span class="comp-margem-nil">—</span>');
          }
        }
        cls.push(vC, visitPercentageDisplay, tI);

        cls.forEach((cD, cIdx) => {
          const td = document.createElement('td');
          const hT = hds[cIdx];
          if (_mobileHideCols.includes(hT)) td.classList.add('col-hide-mobile');
          if (typeof cD === 'string' && (cD.includes('<span') || cD.includes('<a '))) td.innerHTML = fillEmptySpan(cD);
          else td.textContent = cD;
          if (['Pos.', 'Rep.', 'Med.', 'Loja', 'Pág.', 'UF', 'Flex', 'Log.', 'Tipo', 'Tend.', 'Garantia'].includes(hT)) td.classList.add('text-center');
          if (['Preço', 'Desc.', '%', 'Final', 'Δ Dest.', 'Frete Grátis', 'Frete', 'Comissão', '% Comis.', 'Repasse', 'Visitas', 'Visitas %', 'Margem'].includes(hT)) td.classList.add('text-end');
          if (hT === 'Margem') td.classList.add('margem-highlight');
          if (hT === 'Vendedor') {
            td.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;font-weight:600;font-size:1.05rem;';
            td.title = cmp.seller_name || '';
          }
          if (hT === 'Frete Grátis') {
            td.title = String(cD).includes('(') ? `Custo: ${String(cD).substring(String(cD).indexOf('(')+1, String(cD).indexOf(')'))}` : (String(cD).startsWith('Sim') ? 'Frete Grátis' : 'Sem Frete Grátis');
          }
          if (hT === 'Δ Dest.') td.title = `Diferença de preço vs Vendedor em Destaque (${winnerPrice.toLocaleString(_mfCfg().locale,{style:'currency',currency:_mfCfg().currency})})`;

          if (hT === 'Visitas %') td.title = `${visitPercentageDisplay} das visitas totais (${globalSelectedDays}d)`;
          if (hT === 'Visitas') td.title = `Visitas nos últimos ${globalSelectedDays} dias`;
          if (hT === 'Repasse') td.title = 'Preço Final - Comissão - Frete Grátis';
          if (hT === 'Garantia') { td.title = cmp.warranty || 'Garantia não informada'; td.style.whiteSpace = 'nowrap'; }
          r.appendChild(td);
        });

        const tdB = document.createElement('td');
        tdB.classList.add('text-center');
        const btn = document.createElement('button');
        btn.textContent = 'Ver gráfico';
        btn.className = 'btn btn-outline-primary btn-sm toggle-chart-btn';
        btn.title = `Gráfico: ${cmp.seller_name}`;
        btn.disabled = isFetchingBatch || isUpdatingVisits;
        btn.onclick = (e) => {
            e.stopPropagation();
            toggleChartRow(cmp.item_id, globalAccessToken, r, cmp.seller_name);
        };
        tdB.appendChild(btn);
        r.appendChild(tdB);
      });

      // Wrap table in horizontal-scroll container
      const _tWrap = document.createElement('div');
      _tWrap.className = 'comp-table-wrapper comp-table-fadein';
      _tWrap.appendChild(table);
      tabelaContainer.appendChild(_tWrap);

      if (totalKnownItems > 0 && (totalPages > 1 || totalLoadedItems < totalKnownItems)) {
        const pN = document.createElement('div');
        pN.className = 'comp-pagination';

        // Left: info
        const pInfo = document.createElement('div');
        pInfo.className = 'pag-info';
        pInfo.innerHTML = `Página <strong>${currentPage}</strong> de <strong>${totalPages}</strong> · <span class="pag-loaded">${totalLoadedItems} de ${totalKnownItems} carregados</span>`;
        pN.appendChild(pInfo);

        // Center: page buttons
        const pBtns = document.createElement('div');
        pBtns.className = 'pag-buttons';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'pag-btn';
        prevBtn.textContent = '‹';
        prevBtn.disabled = isFetchingBatch || isUpdatingVisits || (currentPage === 1);
        prevBtn.onclick = () => {
          if (currentPage > 1) renderPaginatedCompetitorsTable(currentPage - 1, itemsPerPage);
        };
        pBtns.appendChild(prevBtn);
        for (let pg = 1; pg <= Math.min(totalPages, 5); pg++) {
          const pgBtn = document.createElement('button');
          pgBtn.className = 'pag-btn' + (pg === currentPage ? ' active' : '');
          pgBtn.textContent = pg;
          pgBtn.onclick = () => renderPaginatedCompetitorsTable(pg, itemsPerPage);
          pBtns.appendChild(pgBtn);
        }
        const disableNext = isFetchingBatch || isUpdatingVisits || (totalLoadedItems >= totalKnownItems) || totalKnownItems === 0;
        const nextBtn = document.createElement('button');
        nextBtn.className = 'pag-btn';
        nextBtn.textContent = '›';
        nextBtn.disabled = disableNext;
        nextBtn.onclick = () => {
          if (totalLoadedItems < totalKnownItems) {
              const nextPageIndex = startIndex + itemsPerPage;
              if (nextPageIndex < totalLoadedItems) {
                  renderPaginatedCompetitorsTable(currentPage + 1, itemsPerPage);
              } else if (totalLoadedItems < totalKnownItems) {
                  const fetchStartIndex = totalLoadedItems;
                  const fetchEndIndex = Math.min(totalLoadedItems + itemsPerPage, totalKnownItems);
                  const nextBatchIds = globalCompetitorIds.slice(fetchStartIndex, fetchEndIndex);
                  if (nextBatchIds.length > 0) {
                        statusElement.textContent = `Carregando lote ${Math.floor(totalLoadedItems/itemsPerPage) + 1}...`;
                        statusElement.className = 'text-info';
                        paginationContainer.innerHTML = "";
                        tabelaContainer.innerHTML = getLoadingHtml(`Carregando vendedores ${totalLoadedItems + 1}–${Math.min(totalLoadedItems + nextBatchIds.length, totalKnownItems)} de ${totalKnownItems}…`, '');
                        fetchAndProcessCompetitorBatch(nextBatchIds)
                            .then(() => {
                                console.log(`[Render Table] Batch fetch OK. Total Loaded agora: ${globalCompetitorsData.length}.`);
                                renderPaginatedCompetitorsTable(currentPage + 1, itemsPerPage);
                            })
                            .catch(error => {
                                console.error("Erro ao buscar próximo lote:", error);
                                renderPaginatedCompetitorsTable(currentPage, itemsPerPage);
                            });
                  } else {
                      console.warn("[Render Table] Clique em Próxima página, mas não há mais IDs para buscar (nextBatchIds vazio).");
                      renderPaginatedCompetitorsTable(currentPage, itemsPerPage);
                  }
              } else {
                  console.warn("[Render Table] Clique em Próxima página, mas todos os itens conhecidos já estão carregados.");
                  renderPaginatedCompetitorsTable(currentPage, itemsPerPage);
              }
          } else {
              console.warn("[Render Table] Clique em Próxima página, mas a navegação está desabilitada.");
          }
        };
        pBtns.appendChild(nextBtn);
        pN.appendChild(pBtns);

        // Right: mini progress bar
        const pProgress = document.createElement('div');
        pProgress.className = 'pag-progress';
        const _pPct = Math.round(totalLoadedItems / totalKnownItems * 100);
        pProgress.innerHTML = `<div class="loading-track" style="width:100px;height:6px;"><div class="loading-fill" style="width:${_pPct}%"></div></div><span class="loading-pct" style="font-size:0.8rem;">${totalLoadedItems}/${totalKnownItems}</span>`;
        pN.appendChild(pProgress);

        paginationContainer.appendChild(pN);
      }
    } else {
        console.log(`[Render Table] No competitors to render on page ${currentPage} from loaded data. Slice length: ${competitorsSlice.length}, Total Loaded: ${totalLoadedItems}`);
        tabelaContainer.innerHTML = '<p class="text-center text-muted">Nenhum competidor para exibir nesta página.</p>';
        paginationContainer.innerHTML = '';
        const nextPageIndexNeeded = startIndex + itemsPerPage;
        if (totalKnownItems > 0 && totalLoadedItems < totalKnownItems && startIndex >= totalLoadedItems && !isFetchingBatch && !isUpdatingVisits) {
            console.log(`[Render Table] Página ${currentPage} está além dos dados carregados (${totalLoadedItems}). Total Known: ${totalKnownItems}. Disparando fetch do próximo lote...`);
            statusElement.textContent = `Carregando lote ${Math.floor(totalLoadedItems/itemsPerPage) + 1}...`;
            statusElement.className = 'text-info';
            const fetchStartIndex = totalLoadedItems;
            const fetchEndIndex = Math.min(totalLoadedItems + itemsPerPage, totalKnownItems);
            const nextBatchIds = globalCompetitorIds.slice(fetchStartIndex, fetchEndIndex);
            if (nextBatchIds.length > 0) {
                tabelaContainer.innerHTML = getLoadingHtml(`Carregando vendedores ${totalLoadedItems + 1}–${Math.min(totalLoadedItems + nextBatchIds.length, totalKnownItems)} de ${totalKnownItems}…`, '');
                fetchAndProcessCompetitorBatch(nextBatchIds)
                    .then(() => {
                        console.log(`[Render Table] Batch fetch OK para página ${currentPage}. Total Loaded agora: ${globalCompetitorsData.length}. Re-renderizando.`);
                        renderPaginatedCompetitorsTable(currentPage, itemsPerPage);
                    })
                    .catch(error => {
                        console.error(`[Render Table] Erro ao carregar lote para página ${currentPage}:`, error);
                        appendError("Erro ao carregar mais dados.");
                        tabelaContainer.innerHTML = '<p class="text-danger text-center">Erro ao carregar mais dados.</p>';
                    });
            } else {
                console.warn("[Render Table] Lógica de busca de lote na página vazia encontrou 0 IDs para buscar (nextBatchIds vazio).");
                if (totalLoadedItems >= totalKnownItems) {
                    console.log("[Render Table] Não há mais itens para buscar, todos conhecidos já carregados.");
                    statusElement.textContent = `Todos os ${totalLoadedItems} competidores carregados.`;
                    statusElement.className = 'text-success';
                } else {
                    statusElement.textContent = 'Erro interno ao determinar o próximo lote.'; statusElement.className = 'text-danger';
                    console.error("[Render Table] Logic error: nextBatchIds empty when expecting more.");
                }
            }
        } else if (isFetchingBatch || isUpdatingVisits) {
            console.log("[Render Table] Não há itens para exibir nesta página, mas um fetch/update está em progresso.");
        } else if (totalKnownItems > 0 && totalLoadedItems === totalKnownItems && startIndex >= totalLoadedItems) {
            console.log("[Render Table] Página solicitada está além dos dados carregados, e todos os IDs conhecidos já foram buscados.");
        } else if (totalKnownItems === 0 && totalLoadedItems === 0) {
            console.log("[Render Table] Nenhum competidor conhecido ou carregado.");
            statusElement.textContent = 'Nenhum competidor encontrado.'; statusElement.className = 'text-warning';
        }
    }

    if (!isFetchingBatch && !isUpdatingVisits) {
        const currentVisibleItems = competitorsSlice.length;
        const totalKnown = globalCompetitorIds.length;
        const totalLoaded = globalCompetitorsData.length;
        if (totalKnown > 0) {
            if (totalLoaded === totalKnown) {
                statusElement.textContent = `Exibindo ${currentVisibleItems} competidores (Total: ${totalLoaded}).`;
                statusElement.className = 'text-success';
            } else {
                statusElement.textContent = `Exibindo ${currentVisibleItems} competidores. Carregados: ${totalLoaded}/${totalKnown}.`;
                statusElement.className = 'text-info';
            }
        } else if (totalLoaded > 0) {
            statusElement.textContent = `Exibindo ${currentVisibleItems} competidores (Total carregado: ${totalLoaded}, total desconhecido).`;
            statusElement.className = 'text-info';
        } else {
            if (!statusElement.textContent.startsWith('Erro') && !statusElement.textContent.startsWith('Nenhum')) {
                statusElement.textContent = 'Aguardando busca...';
                statusElement.className = 'text-muted';
            }
        }
    }
  }


  // --- Renderiza o Cabeçalho do Catálogo ---
  function renderCatalogHeader(catalogDetails, winner) {
    const h = document.getElementById('catalogHeader');
    h.innerHTML = '';
    h.className = 'catalog-header-container';
    h.style.cssText = '';
    if (!catalogDetails) return;

    const imgSrc = catalogDetails.pictures?.[0]?.secure_url || catalogDetails.pictures?.[0]?.url || '';
    const catId = catalogDetails.id || '';
    const title = catalogDetails.name || 'Catálogo';
    const sellersCount = globalCompetitorIds.length;

    let winnerLine = '';
    if (winner?.item_id) {
      const v = (winner.visitsTotalSelectedPeriod != null && winner.visitsTotalSelectedPeriod >= 0) ? winner.visitsTotalSelectedPeriod.toLocaleString(_mfCfg().locale) : '-';
      const sN = winner.seller_name || '—';
      winnerLine = `<div class="prod-winner">🏆 <strong>${sN}</strong> · <span class="prod-mono">${v} visitas/${globalSelectedDays}d</span></div>`;
    }

    h.innerHTML = `<div class="prod-card-inner">
      <img class="prod-img" src="${imgSrc}" alt="${title}">
      <div class="prod-info">
        <div class="prod-title-row"><a class="prod-title" href="${(window.MF_getSiteConfig ? 'https://' + window.MF_getSiteConfig(window.MF_siteIdFromItemId ? window.MF_siteIdFromItemId(catId) : 'MLB').host : 'https://www.mercadolivre.com.br') + '/p/' + catId}" target="_blank">${title}</a></div>
        <div class="prod-meta">
          <span class="prod-id">${catId}</span>
          <span class="prod-sellers">${sellersCount} vendedores</span>
        </div>
        ${winnerLine}
      </div>
    </div>`;
  }

  // --- Simulador de Margem ---
  function renderMarginSimulator() {
    // Criar wrapper grid (produto | simulador) se não existir
    let wrapper = document.getElementById('headerSimWrapper');
    const catalogHeader = document.getElementById('catalogHeader');
    const resultsContainer = document.getElementById('resultsContainer');
    if (!wrapper && resultsContainer && catalogHeader) {
      wrapper = document.createElement('div');
      wrapper.id = 'headerSimWrapper';
      resultsContainer.insertBefore(wrapper, catalogHeader);
      wrapper.appendChild(catalogHeader);
    }
    let simEl = document.getElementById('marginSimContainer');
    if (!simEl) {
      simEl = document.createElement('div');
      simEl.id = 'marginSimContainer';
      if (wrapper) wrapper.appendChild(simEl);
    }
    const statusLine = globalCusto > 0
      ? `<div class="msim-status"><span class="msim-status-active">✓ Coluna Margem ativa</span></div>`
      : '';
    simEl.innerHTML = `<div class="msim-card">
  <div class="msim-header">💰 Simulador de Margem</div>
  <div class="msim-grid-values">
    <div class="msim-cell"><div class="msim-label">CUSTO</div><div class="msim-input-wrap"><span class="msim-prefix">${curSymbol()}</span><input class="msim-input" type="number" id="msimCusto" placeholder="0,00" min="0" step="0.01" value="${globalCusto > 0 ? globalCusto : ''}"></div></div>
    <div class="msim-cell"><div class="msim-label">FRETE</div><div class="msim-input-wrap"><span class="msim-prefix">${curSymbol()}</span><input class="msim-input" type="number" id="msimFrete" placeholder="0,00" min="0" step="0.01" value="${globalShippingFee > 0 ? globalShippingFee : ''}"></div></div>
    <div class="msim-cell"><div class="msim-label">IMPOSTO</div><div class="msim-input-wrap"><span class="msim-prefix">%</span><input class="msim-input msim-input-sm" type="number" id="msimTax" placeholder="0" min="0" max="50" step="0.1" value="${globalTaxRate > 0 ? globalTaxRate : ''}"></div></div>
  </div>
  <div class="msim-footer"><div class="msim-actions"><button class="msim-btn" id="msimCalc">Calcular</button>${globalCusto > 0 ? '<button class="msim-btn-clear" id="msimClear">Limpar</button>' : ''}</div>${statusLine}</div>
</div>`;
    function applyMarginCalc() {
      const c = parseFloat(document.getElementById('msimCusto')?.value) || 0;
      const f = parseFloat(document.getElementById('msimFrete')?.value) || 0;
      const t = parseFloat(document.getElementById('msimTax')?.value) || 0;
      globalCusto = c;
      globalShippingFee = f;
      globalTaxRate = t;
      const tbl = document.querySelector('.competitors-table');
      const curPage = parseInt(tbl?.getAttribute('data-current-page') || '1', 10);
      const ipp = parseInt(tbl?.getAttribute('data-items-per-page') || '10', 10);
      renderMarginSimulator();
      if (globalCompetitorsData.length > 0) renderPaginatedCompetitorsTable(curPage, ipp);
    }
    const calcBtn = document.getElementById('msimCalc');
    const clearBtn = document.getElementById('msimClear');
    const custoInput = document.getElementById('msimCusto');
    if (calcBtn) calcBtn.addEventListener('click', applyMarginCalc);
    if (clearBtn) clearBtn.addEventListener('click', () => {
      globalCusto = 0; globalTaxRate = 0;
      // Re-detectar frete dos dados carregados
      globalShippingFee = 0;
      for (const c of globalCompetitorsData) { if (c.shippingCostML > 0) { globalShippingFee = c.shippingCostML; break; } }
      renderMarginSimulator();
      if (globalCompetitorsData.length > 0) {
        const tbl = document.querySelector('.competitors-table');
        const ipp = parseInt(tbl?.getAttribute('data-items-per-page') || '10', 10);
        renderPaginatedCompetitorsTable(1, ipp);
      }
    });
    if (custoInput) custoInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') applyMarginCalc(); });
    const taxInput = document.getElementById('msimTax');
    const freteInput = document.getElementById('msimFrete');
    if (taxInput) taxInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') applyMarginCalc(); });
    if (freteInput) freteInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') applyMarginCalc(); });
  }

  function getLoadingHtml(msg, sub) {
    const subHtml = sub ? `<p class="comp-loading-sub">${sub}</p>` : '';
    return `<div class="comp-loading"><div class="comp-orbital"><div class="comp-orbital-ring"></div><div class="comp-orbital-ring"></div><div class="comp-orbital-dot"></div></div><p class="comp-loading-msg">${msg}</p>${subHtml}<div class="comp-loading-bar"><div class="comp-loading-bar-fill"></div></div><div class="comp-loading-steps"><span class="step active">Conexão</span><span class="step-dot">→</span><span class="step">Catálogo</span><span class="step-dot">→</span><span class="step">Vendedores</span><span class="step-dot">→</span><span class="step">Visitas</span></div></div>`;
  }

  function getSkeletonHtml(n) {
    const ws = ['55%','78%','42%','65%','33%','70%','48%','60%','38%','72%'];
    const hws = ['','85%','58%','62%','58%','52%','48%','42%','52%','60%','48%','52%'];
    const thead = '<thead><tr>' + hws.map(w => w ? `<th><span class="comp-skel-th" style="width:${w}"></span></th>` : '<th></th>').join('') + '</tr></thead>';
    let rows = '';
    for (let i = 0; i < (n || 5); i++) {
      const w1 = ws[i % ws.length]; const w2 = ws[(i+3)%ws.length]; const w3 = ws[(i+6)%ws.length];
      rows += `<tr class="comp-skel-row"><td><span class="comp-skel-cell" style="width:22px"></span></td><td><span class="comp-skel-cell" style="width:${w1}"></span></td><td><span class="comp-skel-cell" style="width:${w2}"></span></td><td><span class="comp-skel-cell" style="width:52px"></span></td><td><span class="comp-skel-cell" style="width:40px"></span></td><td><span class="comp-skel-cell" style="width:${w3}"></span></td><td><span class="comp-skel-cell" style="width:46px"></span></td><td><span class="comp-skel-cell" style="width:36px"></span></td><td><span class="comp-skel-cell" style="width:54px"></span></td><td><span class="comp-skel-cell" style="width:42px"></span></td><td><span class="comp-skel-cell" style="width:60px"></span></td><td><span class="comp-skel-cell" style="width:30px"></span></td></tr>`;
    }
    return `<div class="comp-table-wrapper"><table class="comp-skel-table competitors-table">${thead}<tbody>${rows}</tbody></table></div>`;
  }

  // --- Handler Principal (Inicia o processo) ---
  let _handleRunning = false;
  async function handleFetchVisitas() {
    if (_handleRunning) { console.log('handleFetchVisitas: já em execução, ignorando chamada duplicada.'); return; }
    _handleRunning = true;
    try {
    const catalogHeader = document.getElementById("catalogHeader");
    const tabelaContainer = document.getElementById("tabelaCompetidores");
    const paginationContainer = document.getElementById("paginationControls");
    const chartsContainer = document.getElementById("chartsContainer");
    const statusElement = document.getElementById("resultadoTexto");
    const resultsContainer = document.getElementById('resultsContainer');

    if(catalogHeader) catalogHeader.innerHTML = "";
    if(tabelaContainer) tabelaContainer.innerHTML = getLoadingHtml('Analisando catálogo…', 'Buscando dados do Mercado Livre');
    if(paginationContainer) paginationContainer.innerHTML = "";
    if(chartsContainer) chartsContainer.innerHTML = "";
    if(statusElement) { statusElement.textContent = ""; statusElement.className = ''; }
    if(resultsContainer) resultsContainer.querySelectorAll('.alert-danger').forEach(el => el.remove());


    globalCompetitorsData = [];
    globalCompetitorIds = [];
    globalWinnerItemId = "";
    isFetchingBatch = false;
    isUpdatingVisits = false;
    globalTotalLoadedVisitas = 0;
    visitsCache = {};
    globalMlSellerId = null;
    globalSortColumn = 'visitas';
    globalSortDirection = 'desc';
    globalFilters = { logistica: '', frete: '', flex: '', loja: '', uf: '' };


    const _inputEl = document.getElementById("inputCatalog");
    if (!_inputEl) { appendError('Erro interno: campo de busca não encontrado. Recarregue a página.'); return; }
    const iU = _inputEl.value.trim();
    if (!iU) {
      appendError('Cole o link do catálogo ou anúncio no campo acima.');
      if(tabelaContainer) tabelaContainer.innerHTML = '';
      if(statusElement) { statusElement.textContent = 'Informe um link.'; statusElement.className='text-danger'; }
      return;
    }

    if(statusElement) { statusElement.textContent = 'Credenciais...'; statusElement.className = 'text-info'; }
    try {
      globalAccessToken = await fetchAccessToken();
      globalUserId = await fetchUserIdForScraping();
      if (!globalAccessToken || !globalUserId) {
        if (tabelaContainer && window.MF_renderError) window.MF_renderError(tabelaContainer, 'no_ml_account');
        if(statusElement) { statusElement.textContent = 'Conta ML não conectada.'; statusElement.className = 'text-danger'; }
        return;
      }
      console.log("Credenciais OK.");
      globalMlSellerId = await fetchCurrentMlUserId(globalAccessToken);
      if(statusElement) { statusElement.textContent = 'Credenciais OK. Buscando...'; }
    } catch (e) {
      console.error("Erro credenciais:", e);
      appendError('Não foi possível conectar à sua conta. Verifique sua conexão e tente novamente.');
      if(statusElement) { statusElement.textContent = 'Falha na conexão.'; statusElement.className = 'text-danger'; }
      if(tabelaContainer) tabelaContainer.innerHTML = '';
      return;
    }

    // Regex aceita qualquer prefixo de site ML (MLB/MCO/MLA/MLM/MLC/MLU)
    let isCatalogUrl = /\/p\/(MLB|MCO|MLA|MLM|MLC|MLU)[A-Z0-9]+/i.test(iU) || /^(MLB|MCO|MLA|MLM|MLC|MLU)\d+$/i.test(iU.trim());
    let pId = normalizeMlbId(iU);
    // Detecta site_id do input e torna ATIVO pra formatters de moeda/locale
    const detectedSite = (window.MF_siteIdFromItemId ? window.MF_siteIdFromItemId(pId || iU) : 'MLB');
    window.MF_CURRENT_SITE = detectedSite;

    const itemsPerPage = 10;

    try {
      if (isCatalogUrl) {
        const cM = iU.match(/\/p\/((MLB|MCO|MLA|MLM|MLC|MLU)[A-Z0-9]+)/i);
        const bM = iU.trim().match(/^((MLB|MCO|MLA|MLM|MLC|MLU)\d+)$/i);
        if (!cM && !bM) { appendError('Entrada inválida. Cole a URL do catálogo (.../p/MLB123456) ou apenas o ID (MLB123456). Aceita MCO/MLA/MLM/MLC/MLU.'); return; }
        const cId = (cM ? cM[1] : bM[1]).toUpperCase();
        console.log(`Iniciando Catálogo: ${cId}`);
        if(statusElement) { statusElement.textContent = `Buscando catálogo ${cId}...`; }

        const cD = await fetchCatalogDetails(cId, globalAccessToken);
        if (!cD) {
            const errorMsg = `Não foi possível obter os detalhes do catálogo ${cId}. Verifique o link e tente novamente.`;
            appendError(errorMsg);
            if(statusElement) { statusElement.textContent = 'Erro catálogo!'; statusElement.className='text-danger'; }
            if(tabelaContainer) tabelaContainer.innerHTML = '';
            return;
        }
        console.log("Catálogo OK.");
        renderCatalogHeader(cD, null);

        if(statusElement) { statusElement.textContent = `Buscando IDs competidores ${cId}...`; }
        let cIdList = [];
        try {
          const _sId = (window.MF_siteIdFromItemId ? window.MF_siteIdFromItemId(cId) : 'MLB');
          const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/competition/competitors?product_id=${cId}&site_id=${_sId}`;
          const r = await fetch(u, {
            headers: { 'Authorization': `Bearer ${globalAccessToken}` }
          });
          if (!r.ok) {
            let m = `Erro ${r.status} competidores`;
            try {
              const d = await r.json();
              if (d?.message) m += `: ${d.message}`
            } catch (_) {}
            throw new Error(m);
          }
          const d = await r.json();
          if (!d?.competitors) throw new Error('Resp competidores inválida.');
          // Guardar dados ricos de cada competidor indexados por item_id
          globalCompetitorApiData = {};
          d.competitors.forEach(c => {
            if (c.item_id) globalCompetitorApiData[c.item_id] = c;
          });
          cIdList = d.competitors.map(c => c.item_id).filter(id => id);
          globalCompetitorIds = cIdList;
          console.log(`Encontrados ${globalCompetitorIds.length} IDs.`);

          if (globalCompetitorIds.length === 0) {
            const msg = 'Nenhum competidor ativo encontrado para este catálogo.';
            appendError(msg);
            if(tabelaContainer) tabelaContainer.innerHTML = `<p class="text-center text-muted">${msg}</p>`;
            if(statusElement) { statusElement.textContent = `Catálogo ${cId}: sem competidores.`; statusElement.className = 'text-warning'; }
            return;
          }
        } catch (e) {
          throw new Error('Falha busca IDs competidores: ' + e.message);
        }

        const initialBatchIds = globalCompetitorIds.slice(0, itemsPerPage);
        if(tabelaContainer) tabelaContainer.innerHTML = getLoadingHtml('Carregando competidores…', `Buscando detalhes de ${initialBatchIds.length} de ${globalCompetitorIds.length} anúncios`) + getSkeletonHtml(Math.min(initialBatchIds.length, 5));
        if(paginationContainer) paginationContainer.innerHTML = "";
        if(statusElement) { statusElement.textContent = `Buscando detalhes 1º lote (${initialBatchIds.length}/${globalCompetitorIds.length})...`; }

        await fetchAndProcessCompetitorBatch(initialBatchIds);

        if (globalCompetitorsData.length === 0 && globalCompetitorIds.length > 0) {
            throw new Error(`Falha ao carregar dados detalhados para o 1º lote de ${globalCompetitorIds.length} IDs.`);
        } else if (globalCompetitorsData.length === 0 && globalCompetitorIds.length === 0) {
            const msg = 'Nenhum competidor encontrado.';
            appendError(msg);
            if(tabelaContainer) tabelaContainer.innerHTML = `<p class="text-center text-muted">${msg}</p>`;
            if(statusElement) { statusElement.textContent = 'Sem competidores.'; statusElement.className = 'text-warning'; }
            return;
        }

        const winnerItem = globalCompetitorsData.reduce((mostVisited, current) => {
            return (current?.visitsTotalSelectedPeriod || 0) > (mostVisited?.visitsTotalSelectedPeriod || 0) ? current : mostVisited;
        }, { visitsTotalSelectedPeriod: -1 });

          globalWinnerItemId = winnerItem?.item_id || "";

          if (winnerItem?.item_id) {
              console.log(`Vencedor determinado (mais visitas carregadas: ${winnerItem.visitsTotalSelectedPeriod || 0}): ${globalWinnerItemId}`);
          } else {
              console.log(`Nenhum vencedor determinado dos dados carregados (sem visitas > 0). Total de itens carregados: ${globalCompetitorsData.length}`);
          }

        renderCatalogHeader(cD, winnerItem);
        // Auto-detectar custo de envio ML do catálogo (primeiro disponível)
        for (const c of globalCompetitorsData) {
          if (c.shippingCostML > 0) { globalShippingFee = c.shippingCostML; break; }
        }
        renderPaginatedCompetitorsTable(1, itemsPerPage);
        renderMarginSimulator();

      } else if (pId) {
        console.log(`Iniciando Anúncio Individual: ${pId}`);
        if(statusElement) { statusElement.textContent = `Buscando anúncio ${pId}...`; }

        const iD = await fetchItemDetails(pId);
        if (!iD) {
          const errorMsg = `Falha detalhes anúncio ${pId}.`;
          appendError(errorMsg);
          if(statusElement) { statusElement.textContent = 'Erro anúncio!'; statusElement.className='text-danger'; }
          if(tabelaContainer) tabelaContainer.innerHTML = '';
          return;
        }
        console.log(`Anúncio OK: ${iD?.id || 'unknown'}`);

        if(catalogHeader) catalogHeader.innerHTML =
          `<div class="catalog-header-container d-flex align-items-center p-3 rounded mb-2">
            <img src="${iD.pictures?.[0]?.secure_url||iD.thumbnail||''}" class="me-3 rounded" style="width:64px;height:64px;object-fit:contain;background:white;padding:6px;border-radius:8px;" alt="img">
            <div style="min-width:0;"><div class="catalog-title" style="font-size:0.95rem;font-weight:700;color:#1e3a5f;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${iD.title||pId}</div><span style="font-size:0.72rem;color:#0369a1;margin-top:3px;display:block;">${pId}</span></div>
          </div>`;

        if(tabelaContainer) tabelaContainer.innerHTML = '';
        if(paginationContainer) paginationContainer.innerHTML = '';

        if(statusElement) { statusElement.textContent = `Buscando visitas ${pId}...`; }
        if(chartsContainer) chartsContainer.innerHTML = getLoadingHtml('Carregando gráfico…', '');

        const vD = await fetchVisits(pId, globalAccessToken, 90);

        if (!vD?.results?.length) {
          if(chartsContainer) chartsContainer.innerHTML = '<p class="text-center text-muted p-3">Visitas indisponíveis para este anúncio nos últimos 90 dias.</p>';
            if(statusElement) { statusElement.textContent = `Anúncio ${pId} carregado (sem visitas nos últimos 90 dias).`; statusElement.className = 'text-warning'; }
        } else {
          vD.results.sort((a, b) => new Date(a.date) - new Date(b.date));
          const l = vD.results.map(r => r.date.split('T')[0]);
          const v = vD.results.map(r => r.total || 0);

          const ct = document.getElementById('chartsContainer');
          if(ct) {
              ct.innerHTML = '';
              // Wrapper card estilo trading
              const chartCard = document.createElement('div');
              chartCard.className = 'chart-card';
              const chartTitle = document.createElement('div');
              chartTitle.className = 'chart-card-header';
              chartTitle.innerHTML = `<span class="chart-card-icon">📈</span> <span class="chart-card-label">Visitas — 90 dias</span><span class="chart-card-id">${pId}</span>`;
              chartCard.appendChild(chartTitle);
              const chartBody = document.createElement('div');
              chartBody.className = 'chart-card-body';
              chartCard.appendChild(chartBody);
              ct.appendChild(chartCard);
              const cv = document.createElement('canvas');
              cv.id = `chart-${pId}`;
              cv.height = 280;
              chartBody.appendChild(cv);

              if (typeof Chart === 'undefined') {
                throw new Error("Chart.js não carregado.");
              }

              const ctx = cv.getContext('2d');
              const _grad2 = ctx.createLinearGradient(0, 0, 0, 300);
              _grad2.addColorStop(0, 'rgba(59,130,246,0.22)');
              _grad2.addColorStop(1, 'rgba(59,130,246,0.0)');
              new Chart(ctx, {
                type: 'line',
                data: {
                  labels: l,
                  datasets: [{
                    label: 'Visitas',
                    data: v,
                    borderColor: '#3b82f6',
                    backgroundColor: _grad2,
                    borderWidth: 2.5,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#3b82f6',
                    pointBorderColor: 'white',
                    pointBorderWidth: 2,
                    tension: 0.4,
                    fill: true
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  scales: {
                    x: {
                      type: 'time',
                      time: { unit: 'day', parser: 'yyyy-MM-dd', tooltipFormat: 'dd/MM/yyyy', displayFormats: { day: 'dd/MM' } },
                      grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
                      ticks: { color: '#64748b', font: { size: 11, family: "'DM Sans',sans-serif" }, maxRotation: 0 },
                      border: { display: false }
                    },
                    y: {
                      beginAtZero: true,
                      grid: { color: 'rgba(0,0,0,0.05)', drawBorder: false },
                      ticks: { color: '#64748b', font: { size: 11, family: "'DM Sans',sans-serif" } },
                      border: { display: false }
                    }
                  },
                  plugins: {
                    legend: { display: false },
                    title: { display: false },
                    tooltip: {
                      backgroundColor: '#0f172a',
                      titleColor: '#e2e8f0',
                      bodyColor: '#94a3b8',
                      borderColor: '#334155',
                      borderWidth: 1,
                      padding: 10,
                      callbacks: { label: (c) => ` ${c.parsed.y.toLocaleString(_mfCfg().locale)} visitas` }
                    }
                  }
                }
              });
              if(statusElement) { statusElement.textContent = `Anúncio ${pId} carregado.`; statusElement.className = 'text-success'; }
          } else {
              console.error("chartsContainer não encontrado após busca.");
              if(statusElement) { statusElement.textContent = 'Erro: Container de gráfico não encontrado.'; statusElement.className = 'text-danger'; }
          }
        }
      } else {
        const errorMsg = 'Entrada inválida. Use um link de catálogo (/p/MLB...) ou ID/link de anúncio (MLB...).';
        throw new Error(errorMsg);
      }
    } catch (e) {
      console.error("Erro principal:", e);
      const _userMsg = e.message?.includes('401') ? 'Sessão expirada. Reconecte sua conta em Minha Conta e tente novamente.'
        : e.message?.includes('403') ? 'Acesso negado pelo Mercado Livre. Tente novamente em alguns minutos.'
        : e.message?.includes('fetch') || e.message?.includes('network') ? 'Erro de conexão. Verifique sua internet e tente novamente.'
        : 'Ocorreu um erro inesperado. Tente novamente.';
      appendError(_userMsg);
      if(statusElement) { statusElement.textContent = 'Erro!'; statusElement.className = 'text-danger'; }
      if(tabelaContainer) tabelaContainer.innerHTML = '';
      if(catalogHeader) catalogHeader.innerHTML = '';
      if(paginationContainer) paginationContainer.innerHTML = '';
      if(chartsContainer) chartsContainer.innerHTML = '';
    }
    } finally { _handleRunning = false; }
  }

  // --- Inicialização (roda imediatamente — Bubble renderiza após DOMContentLoaded) ---
  (function _initApp() {
    // Injetar CSS de loading imediatamente — garante animações antes da 1ª interação
    if (!document.getElementById('comp-google-font')) {
      const _fl = document.createElement('link');
      _fl.id = 'comp-google-font';
      _fl.rel = 'stylesheet';
      _fl.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap';
      document.head.appendChild(_fl);
    }
    if (!document.getElementById('comp-loading-styles')) {
      const _ls = document.createElement('style');
      _ls.id = 'comp-loading-styles';
      _ls.textContent = `#resultsContainer,#resultsContainer *{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}.comp-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px 36px;gap:16px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,.08);margin:4px 0;}.comp-orbital{position:relative;width:56px;height:56px;flex-shrink:0;}.comp-orbital-ring{position:absolute;inset:0;border-radius:50%;border:3px solid transparent;}.comp-orbital-ring:nth-child(1){border-top-color:#0066ff;border-right-color:#0066ff;animation:comp-spin-f .75s linear infinite;}.comp-orbital-ring:nth-child(2){inset:10px;border-bottom-color:#00d68f;border-left-color:#00d68f;animation:comp-spin-f 1.1s linear infinite reverse;}.comp-orbital-dot{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:8px;height:8px;border-radius:50%;background:#0066ff;animation:comp-pulse 1.2s ease-in-out infinite;}@keyframes comp-spin-f{to{transform:rotate(360deg);}}@keyframes comp-pulse{0%,100%{transform:translate(-50%,-50%) scale(.7);opacity:.4;}50%{transform:translate(-50%,-50%) scale(1);opacity:1;}}.comp-loading-bar{width:280px;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;}.comp-loading-bar-fill{height:100%;width:45%;background:linear-gradient(90deg,transparent,#0066ff,#00d68f,transparent);animation:comp-sweep 1.6s ease-in-out infinite;}@keyframes comp-sweep{0%{transform:translateX(-222%);}100%{transform:translateX(333%);}}.comp-loading-msg{color:#0f172a;font-weight:700;font-size:1rem;margin:0;text-align:center;}.comp-loading-sub{color:#475569;font-size:0.85rem;margin:0;text-align:center;}.comp-loading-steps{display:flex;gap:8px;align-items:center;margin-top:4px;}.comp-loading-steps .step{font-size:0.75rem;font-weight:600;color:#94a3b8;padding:3px 10px;border-radius:4px;background:#f1f5f9;}.comp-loading-steps .step.active{color:#0066ff;background:#e8f0ff;}.comp-loading-steps .step-dot{color:#d1d5db;font-size:0.7rem;}.comp-skel-table{width:100%;border-collapse:collapse;min-width:960px;}.comp-skel-table thead th{background:#0f172a;padding:12px 10px;border:none;}.comp-skel-th{height:10px;border-radius:4px;background:rgba(255,255,255,.15);display:inline-block;}.comp-skel-row td{padding:11px 10px;border-bottom:1px solid #f1f5f9;background:#fff;}.comp-skel-cell{height:12px;border-radius:4px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:comp-shimmer 1.5s ease-in-out infinite;display:inline-block;}.comp-skel-row:nth-child(even) td{background:#f8fafc;}.comp-skel-row:nth-child(2) .comp-skel-cell{animation-delay:.1s;}.comp-skel-row:nth-child(3) .comp-skel-cell{animation-delay:.15s;}.comp-skel-row:nth-child(4) .comp-skel-cell{animation-delay:.2s;}.comp-skel-row:nth-child(5) .comp-skel-cell{animation-delay:.25s;}@keyframes comp-shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}.comp-table-fadein{animation:comp-fadein .35s ease;}@keyframes comp-fadein{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}`;
      document.head.appendChild(_ls);
    }
    if (!document.getElementById('comp-table-styles')) {
      const _s = document.createElement('style');
      _s.id = 'comp-table-styles';
      _s.textContent = `/* === PROPOSTA U — LIGHT TRADING === */.top-progress{height:3px;background:#e2e8f0;position:fixed;top:0;left:0;right:0;z-index:9999;}.top-progress-fill{height:100%;background:linear-gradient(90deg,#0066ff,#00d68f);border-radius:0 2px 2px 0;transition:width .6s ease;}#resultsContainer,#resultsContainer *{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}#resultadoTexto{display:none!important;}/* HEADER + SIM GRID */#headerSimWrapper{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;align-items:start;margin-bottom:16px;}#headerSimWrapper>#catalogHeader{margin-bottom:0!important;}@media(max-width:960px){#headerSimWrapper{grid-template-columns:1fr;}}/* PRODUCT CARD */.catalog-header-container{background:#fff!important;border:1px solid #e2e8f0!important;border-radius:10px!important;box-shadow:0 1px 3px rgba(0,0,0,.06)!important;padding:0!important;margin:0!important;align-self:start!important;height:auto!important;}.prod-card-inner{display:flex;align-items:flex-start;gap:16px;padding:18px 20px;}.prod-img{width:88px;height:88px;border-radius:10px;object-fit:cover;border:1px solid #e2e8f0;flex-shrink:0;background:#f8fafc;}.prod-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;}.prod-title-row{}.prod-title{font-size:1rem;font-weight:600;color:#0f172a!important;text-decoration:none!important;line-height:1.35;display:block;}.prod-title:hover{color:#0066ff!important;}.prod-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:0.85rem;color:#475569;}.prod-id{font-family:'DM Mono',Consolas,monospace;font-size:0.78rem;color:#0066ff;background:#e8f0ff;padding:2px 8px;border-radius:4px;font-weight:500;}.prod-sellers{font-weight:600;color:#0f172a;}.prod-winner{font-size:0.85rem;color:#059669;display:flex;align-items:center;gap:4px;}.prod-winner strong{color:#059669;}.prod-mono{font-family:'DM Mono',Consolas,monospace;color:#0066ff;font-weight:600;font-size:0.82rem;}/* SIMULATOR */.msim-card{background:#fff;border:1px solid #e2e8f0;border-top:3px solid #0066ff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);height:100%;display:flex;flex-direction:column;}.msim-header{padding:14px 20px;font-weight:600;font-size:0.9rem;color:#0066ff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:8px;}.msim-grid-values{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#e2e8f0;}.msim-cell{background:#fff;padding:16px;text-align:center;}.msim-label{font-size:0.72rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;}.msim-input-wrap{display:flex;align-items:center;border:1.5px solid #e2e8f0;border-radius:6px;overflow:hidden;background:#fff;transition:border-color .15s,box-shadow .15s;margin:0 auto;max-width:160px;}.msim-input-wrap:focus-within{border-color:#0066ff;box-shadow:0 0 0 3px rgba(0,102,255,.1);}.msim-prefix{padding:0 10px;background:#f8fafc;font-size:0.85rem;font-weight:600;color:#94a3b8;border-right:1px solid #e2e8f0;height:42px;display:flex;align-items:center;font-family:'DM Mono',Consolas,monospace;}.msim-input{border:none;outline:none;padding:0 10px;height:42px;font-size:1.05rem;font-weight:600;color:#0f172a;width:100%;background:#fff;font-family:'DM Mono',Consolas,monospace;text-align:center;}.msim-input-sm{}.msim-footer{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid #e2e8f0;}.msim-actions{display:flex;gap:8px;align-items:center;}.msim-btn{height:38px;padding:0 22px;border-radius:6px;background:#0066ff;color:#fff;font-weight:700;font-size:0.88rem;border:none;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit;}.msim-btn:hover{background:#0052cc;transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,102,255,.3);}.msim-btn-clear{height:38px;padding:0 14px;border-radius:6px;background:#f8fafc;color:#64748b;font-weight:600;font-size:0.82rem;border:1px solid #e2e8f0;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit;}.msim-btn-clear:hover{background:#f1f5f9;border-color:#94a3b8;}.msim-status{display:flex;align-items:center;}.msim-status-active{font-size:0.78rem;color:#059669;font-weight:600;}.msim-tax-hint{display:block;font-size:0.68rem;color:#94a3b8;margin-top:4px;}/* TICKER BAR */.ticker-bar{background:#0f172a;border-radius:10px;padding:0;margin-bottom:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.1);}.ticker-inner{display:flex;animation:ticker-scroll 25s linear infinite;width:max-content;}.ticker-inner:hover{animation-play-state:paused;}.ticker-item{display:flex;align-items:center;gap:10px;padding:14px 24px;border-right:1px solid rgba(255,255,255,.08);white-space:nowrap;flex-shrink:0;}.ticker-label{font-size:0.72rem;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.06em;font-weight:600;}.ticker-value{font-family:'DM Mono',Consolas,monospace;font-size:0.95rem;font-weight:600;color:#fff;}.ticker-value.green{color:#00d68f;}.ticker-value.red{color:#ff3b5c;}.ticker-value.blue{color:#60a5fa;}@keyframes ticker-scroll{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}/* LOADING PROGRESS */.loading-bar-container{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 18px;margin-bottom:16px;display:flex;align-items:center;gap:14px;box-shadow:0 1px 3px rgba(0,0,0,.06);}.loading-text{font-size:0.85rem;color:#475569;white-space:nowrap;font-weight:500;}.loading-text strong{color:#0066ff;font-family:'DM Mono',Consolas,monospace;}.loading-track{flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;}.loading-fill{height:100%;background:linear-gradient(90deg,#0066ff,#00d68f);border-radius:4px;position:relative;transition:width .4s ease;}.loading-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);animation:shimmer 1.5s infinite;}@keyframes shimmer{0%{transform:translateX(-100%);}100%{transform:translateX(100%);}}.loading-pct{font-family:'DM Mono',Consolas,monospace;font-size:0.85rem;font-weight:600;color:#0066ff;white-space:nowrap;}/* TOOLBAR */.comp-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap;}.toolbar-left{display:flex;gap:4px;flex-wrap:wrap;}.toolbar-right{display:flex;gap:8px;align-items:center;}.filter-toggle{padding:7px 16px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;font-size:0.85rem;font-weight:500;color:#475569;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap;}.filter-toggle:hover{border-color:#0066ff;color:#0066ff;}.filter-toggle.active{background:#0066ff;color:#fff;border-color:#0066ff;box-shadow:0 2px 8px rgba(0,102,255,.25);}.filter-count{font-family:'DM Mono',Consolas,monospace;font-size:0.72rem;opacity:.6;margin-left:2px;}.filter-toggle.active .filter-count{opacity:.8;}/* CSV BTN */.comp-csv-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 16px;border-radius:6px;border:1px solid #059669;background:#ecfdf5;font-size:0.82rem;font-weight:600;color:#059669;cursor:pointer;transition:all .15s;height:36px;font-family:inherit;}.comp-csv-btn:hover{background:#059669;color:#fff;}/* TABLE */.comp-table-wrapper{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,.08);margin-bottom:16px;background:#fff;}.competitors-table{width:100%;border-collapse:collapse;min-width:960px;font-size:0.95rem;}.competitors-table thead th{background:#0f172a;color:rgba(255,255,255,.85);font-weight:600;font-size:0.78rem;padding:12px 12px;white-space:nowrap;border:none;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;z-index:2;}.competitors-table thead th:first-child{position:sticky;left:0;z-index:3;background:#0f172a;border-radius:10px 0 0 0;}.competitors-table thead th:nth-child(2){position:sticky;left:44px;z-index:3;background:#0f172a;box-shadow:3px 0 8px rgba(0,0,0,.3);}.th-sortable{cursor:pointer;user-select:none;transition:background .12s;}.th-sortable:hover{background:#1e293b!important;}.sort-ind{margin-left:2px;opacity:.55;font-size:.65em;}.sort-ind.active{opacity:1;}.competitors-table tbody td{padding:11px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle;background:#fff;font-size:0.95rem;color:#0f172a;line-height:1.4;}.competitors-table tbody tr:nth-child(even) td{background:#f8fafc;}.competitors-table tbody tr{transition:background .12s;}.competitors-table tbody tr:hover td{background:#e8f0ff!important;}.competitors-table tbody td:first-child{position:sticky;left:0;z-index:1;background:#fff;font-weight:800;color:#64748b;font-size:0.85rem;width:44px;text-align:center;font-family:'DM Mono',Consolas,monospace;}.competitors-table tbody td:nth-child(2){position:sticky;left:44px;z-index:1;background:#fff;box-shadow:3px 0 8px rgba(0,0,0,.04);}.competitors-table tbody tr:nth-child(even) td:first-child,.competitors-table tbody tr:nth-child(even) td:nth-child(2){background:#f8fafc;}/* ROW HIGHLIGHTS */.winner-row td{background:linear-gradient(90deg,rgba(0,214,143,.08),transparent)!important;border-bottom:1px solid #bbf7d0!important;}.winner-row td:first-child{border-left:3px solid #00d68f;color:#059669!important;}.threat-row td{background:#fff8f2!important;}.threat-row td:first-child{border-left:3px solid #ea580c;}.my-item-row td{background:#e8f0ff!important;}.my-item-row td:first-child{border-left:3px solid #0066ff;}/* MARGIN COLUMN */.margem-highlight-th{background:#0a1628!important;border-left:3px solid #00d68f!important;color:#00d68f!important;font-weight:700!important;}.comp-margem-pos{color:#059669;font-weight:700;font-family:'DM Mono',Consolas,monospace;font-size:1rem;}.comp-margem-neg{color:#dc2626;font-weight:700;font-family:'DM Mono',Consolas,monospace;font-size:1rem;}.comp-margem-nil{color:#94a3b8;}td.margem-highlight{background:linear-gradient(90deg,rgba(0,214,143,.15),rgba(0,214,143,.03))!important;border-left:3px solid #00d68f!important;}.winner-row td.margem-highlight{background:linear-gradient(90deg,rgba(0,214,143,.22),rgba(0,214,143,.06))!important;}td.margem-highlight:has(.comp-margem-neg){background:linear-gradient(90deg,rgba(255,59,92,.15),rgba(255,59,92,.03))!important;border-left-color:#ff3b5c!important;}/* DELTA */.delta-pos{color:#059669;font-weight:700;font-size:0.92rem;}.delta-neg{color:#dc2626;font-weight:700;font-size:0.92rem;}/* BADGES */.medalha{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;letter-spacing:.03em;white-space:nowrap;text-transform:uppercase;}.mercado-lider-platinum{background:#e8e0f0;color:#6b21a8;}.mercado-lider-gold{background:#fef3c7;color:#92400e;}.mercado-lider{background:#ecfdf5;color:#059669;}.reputacao{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle;}.reputacao-verde{background:#00d68f;box-shadow:0 0 6px rgba(0,214,143,.5);}.reputacao-verde-claro{background:#65a30d;}.reputacao-amarelo{background:#ca8a04;box-shadow:0 0 4px rgba(202,138,4,.4);}.reputacao-laranja{background:#ea580c;box-shadow:0 0 4px rgba(234,88,12,.4);}.reputacao-vermelho{background:#dc2626;box-shadow:0 0 4px rgba(220,38,38,.4);}.reputacao-gray{background:#94a3b8;}.logistica-full,.logistica-coleta,.logistica-places,.logistica-correios,.logistica-me1,.logistica-me2,.logistica-custom,.logistica-nesp,.logistica-desconhecida{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;white-space:nowrap;}.logistica-full{background:#e8f0ff;color:#0066ff;}.logistica-coleta{background:#fef3c7;color:#92400e;}.logistica-places{background:#e0e7ff;color:#3730a3;}.logistica-correios{background:#fee2e2;color:#b91c1c;}.logistica-me1,.logistica-me2,.logistica-custom,.logistica-nesp{background:#f1f5f9;color:#475569;}.logistica-desconhecida{background:#f8fafc;color:#94a3b8;}.tipo-premium,.tipo-classico,.tipo-gratis,.tipo-outro,.tipo-desconhecido{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;white-space:nowrap;}.tipo-premium{background:#fce7f3;color:#9d174d;}.tipo-classico{background:#f1f5f9;color:#475569;}.tipo-gratis{background:#ecfdf5;color:#059669;}.tipo-outro,.tipo-desconhecido{background:#f1f5f9;color:#94a3b8;}.beneficio{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;white-space:nowrap;}.flex-sim{background:#ecfdf5;color:#059669;}.flex-nao{color:#d1d5db;}.loja-oficial-sim{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;background:#e8f0ff;color:#0066ff;white-space:nowrap;}.loja-oficial-nao{color:#94a3b8;font-size:0.85rem;}.eshop-sim{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;background:#e8f0ff;color:#0066ff;white-space:nowrap;}.eshop-nao{color:#d1d5db;font-size:0.85rem;}/* CHART CARD */.chart-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,.08);overflow:hidden;margin-top:16px;}.chart-card-header{display:flex;align-items:center;gap:8px;padding:14px 20px;background:#0f172a;color:#fff;font-size:0.88rem;font-weight:600;}.chart-card-icon{font-size:1rem;}.chart-card-label{flex:1;font-family:'DM Sans',sans-serif;letter-spacing:.02em;}.chart-card-id{font-family:'DM Mono',Consolas,monospace;font-size:0.75rem;color:rgba(255,255,255,.45);font-weight:400;}.chart-card-body{padding:20px 16px 12px;}/* CHART ROW */.chart-row td{background:#f8fafc!important;padding:0!important;border-bottom:1px solid #e2e8f0!important;}.toggle-chart-btn{font-size:0.78rem!important;padding:6px 12px!important;border-radius:6px!important;font-weight:600!important;white-space:nowrap!important;min-height:34px!important;border:1px solid #e2e8f0!important;background:#fff!important;color:#475569!important;transition:all .12s!important;}.toggle-chart-btn:hover{border-color:#0066ff!important;color:#0066ff!important;}.chart-visible .toggle-chart-btn{background:#0066ff!important;color:#fff!important;border-color:#0066ff!important;}/* PAGINATION */.comp-pagination{display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 18px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-top:16px;}.pag-info{font-size:0.85rem;color:#475569;}.pag-info strong{color:#0f172a;}.pag-loaded{color:#0066ff;font-weight:600;}.pag-buttons{display:flex;gap:4px;}.pag-btn{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid #e2e8f0;background:#fff;font-family:'DM Mono',Consolas,monospace;font-size:0.85rem;color:#475569;cursor:pointer;transition:all .12s;}.pag-btn:hover{border-color:#0066ff;color:#0066ff;}.pag-btn.active{background:#0066ff;color:#fff;border-color:#0066ff;}.pag-btn:disabled{opacity:.35;cursor:default;}.pag-progress{display:flex;align-items:center;gap:8px;}/* COMO GANHAR */.como-ganhar{border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:16px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);}.como-ganhar h6{color:#0066ff;font-weight:700;margin-bottom:12px;font-size:1rem;}.gap-item{display:grid;grid-template-columns:1.3fr 1fr 1fr;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:0.92rem;align-items:center;gap:8px;}.gap-item:last-child{border-bottom:none;}.gap-item>span:first-child{font-weight:700;color:#374151;}.gap-bad{color:#dc2626;font-weight:600;}.gap-ok{color:#059669;font-weight:600;}.gap-warn{color:#d97706;font-weight:600;}/* AUTH ERROR */.comp-auth-error{display:flex;flex-direction:column;align-items:center;gap:14px;padding:48px 24px;text-align:center;}.comp-auth-error-icon{font-size:2.8rem;line-height:1;}.comp-auth-error-title{color:#dc2626;font-weight:800;font-size:1.1rem;margin:0;}.comp-auth-error-msg{color:#64748b;font-size:0.95rem;margin:0;max-width:360px;line-height:1.5;}.comp-auth-error-link{display:inline-flex;align-items:center;gap:8px;background:#0066ff;color:#fff!important;padding:11px 24px;border-radius:8px;font-weight:700;font-size:0.95rem;text-decoration:none!important;transition:all .15s;margin-top:4px;box-shadow:0 4px 12px rgba(0,102,255,.3);}.comp-auth-error-link:hover{background:#0052cc;transform:translateY(-1px);}/* INPUT/BUTTON INTEGRATION */#inputCatalog{border:1.5px solid #e2e8f0!important;border-radius:8px!important;font-family:'DM Sans',sans-serif!important;font-size:0.95rem!important;padding:10px 14px!important;transition:border-color .15s,box-shadow .15s!important;background:#fff!important;}#inputCatalog:focus{border-color:#0066ff!important;box-shadow:0 0 0 3px rgba(0,102,255,.1)!important;outline:none!important;}#meuBotao{background:#0066ff!important;color:#fff!important;border:none!important;border-radius:8px!important;font-family:'DM Sans',sans-serif!important;font-weight:700!important;font-size:0.9rem!important;padding:10px 24px!important;cursor:pointer!important;transition:all .15s!important;box-shadow:0 2px 8px rgba(0,102,255,.25)!important;}#meuBotao:hover{background:#0052cc!important;transform:translateY(-1px)!important;box-shadow:0 4px 12px rgba(0,102,255,.35)!important;}/* RESPONSIVE */@media(max-width:767px){.competitors-table{min-width:580px;}.col-hide-mobile{display:none!important;}.competitors-table tbody td{padding:10px 8px;font-size:0.9rem;}.competitors-table thead th{padding:10px 8px;font-size:0.75rem;}.filter-bar select{height:34px;}.stat-chip{padding:10px 14px;}.msim-input{width:70px;}.msim-fields{gap:8px;}}@media(min-width:768px) and (max-width:1024px){.competitors-table tbody td{padding:10px 9px;font-size:0.9rem;}.competitors-table thead th{font-size:0.75rem;padding:11px 9px;}}`;
      document.head.appendChild(_s);
    }
    // Bind de botões com retry (Bubble pode ainda não ter criado os elementos)
    function _bindUI() {
      const b = document.getElementById("meuBotao");
      const i = document.getElementById("inputCatalog");
      if (b && i) {
        b.addEventListener("click", handleFetchVisitas);
        i.addEventListener("keypress", function(e) {
          if (e.key === "Enter") {
            e.preventDefault();
            handleFetchVisitas();
          }
        });
        return true;
      }
      return false;
    }
    function _tryBind(attempt) {
      if (_bindUI()) return;
      if (attempt < 4) {
        setTimeout(() => _tryBind(attempt + 1), 800 * attempt);
      } else {
        console.warn("UI elements not found after retries.");
      }
    }
    _tryBind(1);

    if (typeof Chart === 'undefined') {
      console.warn("Chart.js NÃO detectado no DOMContentLoaded. Gráficos não funcionarão.");
    } else {
      console.log("Chart.js detectado globalmente no DOMContentLoaded.");
      Chart.defaults.font.family = "'Segoe UI',Tahoma,Geneva,Verdana,sans-serif";
    }
    console.log("App pronta.");
  })();

  // --- Função Genérica para Exibir Erros ---
  function appendError(message) {
    console.error("App Error:", message);
    const c = document.getElementById('resultsContainer');
    const s = document.getElementById("resultadoTexto");

    if (s) {
      s.textContent = message;
      s.className = 'text-danger';
    }

    if (c) {
      const existingAlerts = c.querySelectorAll('.alert-danger');
      for (const alert of existingAlerts) {
          if (alert.textContent.includes(message)) {
              console.warn("Erro duplicado, não adicionando alerta:", message);
              return;
          }
      }
      const e = document.createElement('div');
      e.className = 'alert alert-danger alert-dismissible fade show';
      e.setAttribute('role', 'alert');
      e.textContent = message;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-close';
      b.setAttribute('data-bs-dismiss', 'alert');
      b.setAttribute('aria-label', 'Close');
      e.appendChild(b);
      c.prepend(e);
    }
  }

  // Expose to global scope for Bubble Toolbox workflows
  window.handleFetchVisitas = handleFetchVisitas;

} // end if (!window.__competitionLoaded)
