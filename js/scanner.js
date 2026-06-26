/**
 * Marketfacil - Account Scanner Widget
 * Repositório: Luckys666/frontend-marketfacil
 *
 * Este script gerencia a busca massiva de anúncios e filtragem local via Proxy.
 *
 * NOTA: todo o corpo roda dentro de uma IIFE com guard de execução única
 * (window.__mfScannerInit) — evita que um re-inject do <script> pelo Bubble
 * redeclare constantes (SyntaxError) ou resete o estado da varredura (P-7/P2-1).
 */
(function () {
  'use strict';
  if (window.__mfScannerInit) return;
  window.__mfScannerInit = true;

  // Estado Global do Scanner — preservado entre re-injeções (window.*, nunca closure)
  window.scannerState = window.scannerState || {
    allItems: [],
    filteredItems: [],
    uniqueTags: new Set(),
    isScanning: false,
    currentPage: 1,
    pageSize: 50
  };

  // === MF_renderError — error UI padrão Marketfacil (idempotente) ===
  if (typeof window.MF_renderError !== 'function') {
    (function () {
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
      function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
      window.MF_renderError = function (container, type, opts) {
        if (!container) return;
        injectStyles();
        var cfg = TYPES[type];
        if (!cfg) { container.innerHTML = '<div class="mf-error-card" role="alert"><p class="mf-error-msg">' + escHtml((opts && opts.msg) || 'Erro inesperado.') + '</p></div>'; return; }
        var title = (opts && opts.title) || cfg.title;
        var msg = (opts && opts.msg) || cfg.msg;
        var cta = cfg.cta && (typeof cfg.cta.href === 'function' ? { label: cfg.cta.label, href: cfg.cta.href() } : cfg.cta);
        container.innerHTML = '<div class="mf-error-card mf-error-' + type + '" role="alert"><div class="mf-error-icon" aria-hidden="true">' + cfg.icon + '</div><p class="mf-error-title">' + escHtml(title) + '</p><p class="mf-error-msg">' + msg + '</p>' + (cta ? '<a href="' + escHtml(cta.href) + '" class="mf-error-cta">' + escHtml(cta.label) + '</a>' : '') + '</div>';
      };
      window.MF_ERROR_TYPES = Object.keys(TYPES);
    })();
  }
  // === fim MF_renderError ===

  // --- Configuração & Constantes ---
  const SCANNER_API_BASE = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
  const FALLBACK_THUMB = 'https://http2.mlstatic.com/D_NQ_NP_906934-MLA47913349685_102021-O.webp';

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
    "poor_quality_picture": "Suas fotos foram reprovadas pelo robô do Mercado Livre. Troque por imagens com boa iluminação e alta resolução (1200x1200 ou 1200x1540, depende da categoria), sem texto ou marca d'água sobreposta.",
    "poor_quality_thumbnail": "A miniatura principal não passou na análise automática do ML. Use uma foto nítida, centralizada e sem textos sobrepostos.",
    "incomplete_technical_specs": "Preencha a Ficha Técnica completa no anúncio. Quanto mais atributos preenchidos, melhor o posicionamento nas buscas.",
    "moderation_penalty": "Este anúncio recebeu uma penalidade por infração às regras do Mercado Livre. Revise o conteúdo e corrija o problema indicado."
  };

  // --- Helpers de sanitização (dados do ML são NÃO-confiáveis — brief §6) ---
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Allowlist de esquema: só http/https viram URL utilizável (bloqueia javascript:, data:, etc.).
  // NÃO neutraliza breakout de aspas — combinar SEMPRE com escapeAttr no sink. (A2)
  function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }

  // Neutraliza CSV/Formula injection (Excel/Sheets avaliam células iniciadas por = + - @ \t \r). (M1)
  function csvSafe(v) {
    v = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  }

  // Monta uma célula CSV segura: neutraliza fórmula, remove quebras de linha, escapa aspas.
  function csvCell(v) {
    var s = csvSafe(v).replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
    return '"' + s + '"';
  }

  function translateTag(tag) {
    if (TAG_TRANSLATIONS[tag]) return TAG_TRANSLATIONS[tag];
    // Fallback: humaniza tag desconhecida (snake_case → "Snake Case")
    return String(tag == null ? '' : tag).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function tagBadgeClass(tag) {
    if (SCANNER_TAGS_NEGATIVAS.has(tag)) return 'error';
    if (SCANNER_TAGS_POSITIVAS.has(tag)) return 'success';
    return 'muted';
  }

  // Erro de rede/HTTP rotulado para o MF_renderError. status 0 = falha de fetch (rede/CORS/timeout 30s do Heroku).
  function scannerHttpError(status) {
    var type = 'network_error';
    if (status === 401) type = 'session_expired';
    else if (status === 403) type = 'forbidden';
    else if (status === 429) type = 'rate_limited';
    var e = new Error('HTTP ' + (status || 'rede'));
    e.mfErrorType = type;
    e.httpStatus = status;
    return e;
  }

  // Fetch que NUNCA silencia falha: propaga erro rotulado (P0-1). Não loga corpo cru (M3).
  async function scannerFetch(url, token) {
    var res;
    try {
      res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    } catch (netErr) {
      throw scannerHttpError(0);
    }
    if (!res.ok) throw scannerHttpError(res.status);
    return res;
  }

  function setProgressAria(fillEl, percent) {
    // role="progressbar"/aria-valuemin/max ficam estáticos no track (markup do impl-layout);
    // aqui só atualizamos o valuenow no track, que é o pai do fill. (A1/A2)
    var track = fillEl && fillEl.parentElement;
    if (track && track.setAttribute) track.setAttribute('aria-valuenow', String(percent));
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
      console.error('Erro Token Scanner:', e.message);
      return null;
    }
  }

  async function getScannerUserId(token) {
    // 1. Método Preferencial: Extrair ID diretamente do Token
    if (token && typeof token === 'string') {
      const parts = token.split('-');
      const possibleId = parts[parts.length - 1];
      if (possibleId && /^\d+$/.test(possibleId)) {
        // userId é PII — não logar (M2/§6 console limpo)
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
        console.warn('Erro ao buscar ID via Proxy:', e.message);
      }
    }

    console.warn('Scanner: não foi possível obter ID numérico via Token ou Proxy.');
    return null;
  }

  // --- Core Logic ---

  async function startAccountScan() {
    if (window.scannerState.isScanning) return;

    const scanBtn = document.getElementById('scanButton');
    const exportBtn = document.getElementById('exportCsvButton');
    const progressDiv = document.getElementById('scanProgress');
    const progressBar = document.getElementById('scanProgressBar');
    const statusText = document.getElementById('scanStatusText');
    const resultsContainer = document.getElementById('scannerResults');

    window.scannerState.isScanning = true;
    window.scannerState.allItems = [];
    window.scannerState.uniqueTags.clear();

    if (scanBtn) scanBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true; // bloqueia export durante o scan (P1-5)
    if (progressDiv) progressDiv.style.display = 'block';
    if (resultsContainer) resultsContainer.innerHTML = '';
    if (progressBar) { progressBar.style.width = '0%'; setProgressAria(progressBar, 0); }

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
      let failedItems = 0; // anúncios que não puderam ser carregados (P0-1)

      // Sequencial de propósito: o rate-limit do proxy é por userId e intencional
      // (memórias project_mlb_proxy_rate_limit / project_app_scale). NÃO paralelizar agressivo. (P-2)
      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batchIds = allIds.slice(i, i + BATCH_SIZE);
        let items;
        try {
          items = await scannerFetchDetails(batchIds, token);
        } catch (batchErr) {
          const t = batchErr && batchErr.mfErrorType;
          // Erro persistente (sessão/limite/bloqueio) → aborta e mostra mensagem clara
          if (t === 'session_expired' || t === 'rate_limited' || t === 'forbidden') throw batchErr;
          // Falha transitória (rede/5xx) de UM batch: não silencia — conta e segue (P0-1)
          failedItems += batchIds.length;
          items = [];
        }

        items.forEach(item => {
          if (item) {
            window.scannerState.allItems.push(item);
            if (item.tags) item.tags.forEach(t => window.scannerState.uniqueTags.add(t));
          }
        });

        processed += batchIds.length;
        const percent = Math.round((processed / total) * 100);

        if (progressBar) { progressBar.style.width = `${percent}%`; setProgressAria(progressBar, percent); }
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

      // "Varredura Completa!" SÓ se nenhum anúncio falhou; senão avisa o usuário (P0-1)
      if (statusText) {
        statusText.textContent = failedItems > 0
          ? `Varredura concluída — ${failedItems} anúncio(s) não carregaram. Tente de novo.`
          : 'Varredura Completa!';
      }
      if (progressBar) { progressBar.style.width = '100%'; setProgressAria(progressBar, 100); }

    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'Erro inesperado';
      // Loga só a mensagem resumida — nunca o corpo cru da resposta (M3)
      console.error('Scanner: falha no scan -', msg.slice(0, 200));
      if (progressDiv) progressDiv.style.display = 'none';

      if (e && e.isAuthError) {
        // Token/userId ausentes → conta não conectada
        if (statusText) statusText.textContent = 'Conta não conectada';
        if (resultsContainer && window.MF_renderError) window.MF_renderError(resultsContainer, 'no_ml_account');
      } else if (e && e.mfErrorType && window.MF_renderError) {
        // 401/403/429/5xx/rede → erro padronizado e acionável (P0-1)
        if (statusText) statusText.textContent = 'Não foi possível concluir a varredura';
        window.MF_renderError(resultsContainer, e.mfErrorType);
      } else {
        // Genérico (raro): card de erro acessível, sem inline hardcoded (J-coordination)
        if (statusText) statusText.textContent = 'Erro ao escanear';
        if (resultsContainer) resultsContainer.innerHTML = renderGenericErrorCard(msg);
      }
    } finally {
      window.scannerState.isScanning = false;
      if (scanBtn) scanBtn.disabled = false;
      if (exportBtn) exportBtn.disabled = false;
    }
  }

  // Card de erro genérico — usa a classe do contrato §C (.sc-error-card) e é acessível (role=alert, A12).
  // Cor de texto auxiliar via classe (impl-layout); sem #94a3b8 inline (A4). e.message é escapado (A3).
  function renderGenericErrorCard(message) {
    const mc = window.location.href.includes('version-test')
      ? 'https://app.marketfacil.com.br/version-test/minha-conta'
      : 'https://app.marketfacil.com.br/minha-conta';
    return '<div class="sc-error-card" role="alert">'
      + '<div class="sc-error-icon" aria-hidden="true">⚠️</div>'
      + '<p class="sc-error-title">Erro ao escanear</p>'
      + '<p class="sc-error-text">' + escapeHtml(message) + '</p>'
      + '<p class="sc-error-hint">Se o problema persistir, verifique se sua conta está conectada em '
      + '<a href="' + escapeAttr(mc) + '" target="_blank" rel="noopener noreferrer">Minha Conta</a>.</p>'
      + '</div>';
  }

  async function scannerFetchAllIds(userId, token, onProgress) {
    // Estratégia: usar o modo SCAN do proxy desde o início (P1-2 + P1-3).
    // O proxy força search_type=scan quando offset>=1000 (sem scroll_id) — esse modo
    // NÃO filtra por status, então pega ativos, pausados, em revisão e penalizados.
    // Depois paginamos só por scroll_id e paramos quando results vier vazio
    // (não por offset<total, que duplicava o começo e perdia a cauda em contas grandes).
    const ids = [];
    const seen = new Set(); // dedup de IDs (P1-2)
    let scrollId = null;
    const PROXY_ADS_URL = `${SCANNER_API_BASE}/api/fetch-ads`;
    const MAX_PAGES = 4000; // trava de segurança (200k itens) contra loop infinito
    let pages = 0;

    while (true) {
      let url = `${PROXY_ADS_URL}?seller_id=${encodeURIComponent(userId)}`;
      if (scrollId) {
        url += `&scroll_id=${encodeURIComponent(scrollId)}`;
      } else {
        // 1ª chamada: força o modo scan do zero (offset>=1000) — volta 1ª página + scroll_id
        url += `&offset=1000`;
      }

      const res = await scannerFetch(url, token); // propaga erro em vez de break silencioso (P0-1)
      const data = await res.json();

      const results = Array.isArray(data.results) ? data.results : [];
      if (results.length === 0) break; // fim do scan

      for (const r of results) {
        const idStr = (typeof r === 'string') ? r : (r && r.id);
        if (!idStr || seen.has(idStr)) continue;
        seen.add(idStr);
        ids.push(idStr);
      }

      scrollId = data.scroll_id || null;
      if (!scrollId) break; // scan sempre devolve scroll_id; sem ele, evita loop infinito

      if (onProgress) onProgress({ loaded: ids.length });
      if (++pages >= MAX_PAGES) break;
      await new Promise(r => setTimeout(r, 100)); // respeita o throttle do proxy
    }
    return ids;
  }

  async function scannerFetchDetails(ids, token) {
    if (!ids.length) return [];
    // skip_description=true: o scanner NUNCA usa a descrição. Corta ~20x as chamadas ML por batch
    // (1 multiget vs 1 multiget + 20 /description) e o risco de timeout do Heroku. (P1-1)
    const proxyUrl = `${SCANNER_API_BASE}/api/fetch-item?item_id=${encodeURIComponent(ids.join(','))}&skip_description=true`;
    const res = await scannerFetch(proxyUrl, token); // propaga erro rotulado (P0-1)
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const out = [];
    for (const entry of data) {
      // Resposta do proxy: array de { code, body }. Descarta itens que o ML não retornou OK (P2-4).
      if (entry && entry.code && entry.code !== 200) continue;
      const body = entry && entry.body ? entry.body : entry;
      if (!body || !body.id || !body.title) continue; // sem dados mínimos → não vira card vazio (P2-4)
      // Projeção enxuta: só os campos usados no render/CSV — descarta description/body (P-1, corta memória)
      out.push({
        id: body.id,
        title: body.title,
        price: body.price,
        permalink: body.permalink,
        thumbnail: body.thumbnail,
        tags: Array.isArray(body.tags) ? body.tags : []
      });
    }
    return out;
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
    const select = document.getElementById('tagFilter');
    if (!select) return;
    const filter = select.value;
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
    // "N encontrados" reflete o total que casa o filtro (não engana após filtrar). (P2-5)
    if (el) el.textContent = `${n} encontrados`;
  }

  function renderScannerGrid(items) {
    const container = document.getElementById('scannerResults');
    if (!container) return;
    container.innerHTML = '';

    // Guardar items filtrados para paginação
    window.scannerState.filteredItems = items;
    const totalItems = items.length;

    if (totalItems === 0) {
      // Estado vazio via classe do contrato §C (sem inline) (J-coordination)
      container.innerHTML = '<div class="sc-empty-state">Nenhum item corresponde ao filtro.</div>';
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
      const safeItem = item; // itens já vêm normalizados (enxutos) de scannerFetchDetails

      const tags = Array.isArray(safeItem.tags) ? safeItem.tags : [];
      const hasProblem = tags.some(t => SCANNER_TAGS_NEGATIVAS.has(t));

      const div = document.createElement('div');
      div.className = 'ana-card' + (hasProblem ? ' has-problem' : '');
      div.setAttribute('role', 'listitem'); // semântica de lista (A9)
      // Layout (flex column/gap) e animação slideUpFade vivem em .ana-card no CSS (impl-layout),
      // pra respeitar prefers-reduced-motion (A11). Nada de estilo/animação inline aqui.

      // URLs do ML: allowlist de esquema (safeUrl) + escape de atributo (escapeAttr) — sem isso, breakout/javascript: (A2)
      let safeThumb = safeUrl(safeItem.thumbnail) || FALLBACK_THUMB;
      const safeLink = safeUrl(safeItem.permalink) || '#';
      const price = (typeof safeItem.price === 'number')
        ? `R$ ${safeItem.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        : '-';

      let tagsHtml = '';
      let tipsHtml = '';
      tags.forEach(t => {
        const cls = tagBadgeClass(t);
        const tip = TAG_TIPS[t] || '';
        const titleAttr = tip ? ` title="${escapeAttr(tip)}"` : '';
        const cursor = tip ? ' style="cursor:help;"' : '';
        // escapeHtml na label da badge — defesa caso o ML introduza tag com caractere inesperado (B1)
        tagsHtml += `<span class="status-badge ${cls}"${cursor}${titleAttr}>${escapeHtml(translateTag(t))}</span>`;
        if (cls === 'error' && tip) {
          tipsHtml += `<div class="sc-tip"><span aria-hidden="true">💡</span> <b>${escapeHtml(translateTag(t))}:</b> ${escapeHtml(tip)}</div>`;
        }
      });

      const title = safeItem.title || 'Sem título';
      const id = safeItem.id || 'N/A';

      // title escapado TAMBÉM no nó de texto (não só no atributo) — sink principal de XSS (A1)
      div.innerHTML = `
        <div class="sc-card-top">
          <img class="sc-thumb" src="${escapeAttr(safeThumb)}" alt="" loading="lazy" decoding="async">
          <div class="sc-card-meta">
            <a href="${escapeAttr(safeLink)}" target="_blank" rel="noopener noreferrer" class="sc-title" title="${escapeAttr(title)}" aria-label="${escapeAttr(title + ' (abre em nova aba)')}">${escapeHtml(title)}</a>
            <div class="sc-price">${price}</div>
            <div class="sc-id">${escapeHtml(String(id))}</div>
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

    // Só togglar display; alinhamento/gap vêm do CSS (#scannerPagination) — sem inline redundante (P-5)
    paginationDiv.style.display = 'flex';

    const pageSize = window.scannerState.pageSize;
    const startItem = (page - 1) * pageSize + 1;
    const endItem = Math.min(page * pageSize, totalItems);

    // aria-label nos botões + setas decorativas aria-hidden (A13)
    paginationDiv.innerHTML = `
      <button onclick="changeScannerPage(-1)" aria-label="Página anterior" ${page <= 1 ? 'disabled' : ''}><span aria-hidden="true">←</span> Anterior</button>
      <span class="sc-page-info">${startItem}–${endItem} de ${totalItems}&nbsp;·&nbsp;Página ${page}/${totalPages}</span>
      <button onclick="changeScannerPage(1)" aria-label="Próxima página" ${page >= totalPages ? 'disabled' : ''}>Próxima <span aria-hidden="true">→</span></button>
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

  // Guard contra cliques múltiplos no export
  let _csvExporting = false;

  async function exportToCSV() {
    if (_csvExporting) return;
    if (window.scannerState.isScanning) return; // não exportar com scan em andamento (P1-5)

    const btn = document.getElementById('exportCsvButton');
    const select = document.getElementById('tagFilter');
    const filter = select ? select.value : 'all';
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
          const safeItem = item; // já normalizado em scannerFetchDetails

          const id = safeItem.id || '';
          const title = safeItem.title || '';
          const price = (typeof safeItem.price === 'number')
            ? safeItem.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
            : '0,00';
          const permalink = safeItem.permalink || '';
          const tags = safeItem.tags || [];

          const problemas = tags.filter(t => SCANNER_TAGS_NEGATIVAS.has(t));
          const temErro = problemas.length > 0;
          const status = temErro ? "COM ERROS" : "OK";
          const listaErros = temErro
            ? problemas.map(p => TAG_TRANSLATIONS[p] || p).join(', ')
            : "Nenhum";

          // csvCell: neutraliza fórmula (M1) + remove \r\n (P2-2) + escapa aspas em TODAS as células
          csvContent += [
            csvCell(id), csvCell(title), csvCell(price),
            csvCell(status), csvCell(listaErros), csvCell(permalink)
          ].join(';') + '\r\n';
        });

        // Atualizar progresso e dar respiro pro browser
        const processed = Math.min(i + CHUNK_SIZE, totalItems);
        if (btn) btn.textContent = `⏳ Processando ${processed}/${totalItems}...`;
        await new Promise(r => setTimeout(r, 0));
      }

      // Gerar arquivo
      if (btn) btn.textContent = '⏳ Gerando arquivo...';
      await new Promise(r => setTimeout(r, 50));

      const bom = "﻿";
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
      console.error('Erro ao exportar CSV:', e.message);
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

  // --- Bind global (handlers chamados pelos onclick/onchange inline do scanner.html) ---
  window.startAccountScan = startAccountScan;
  window.handleScannerFilterChange = handleScannerFilterChange;
  window.changeScannerPage = changeScannerPage;
  window.exportToCSV = exportToCSV;
})();
