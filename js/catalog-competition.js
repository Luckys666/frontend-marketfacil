// --- Global Variables ---
  let globalCompetitorsData = []; // Dados detalhados dos competidores CARREGADOS
  let globalCompetitorIds = []; // TODOS os IDs de competidores do catálogo (API inicial)
  let globalAccessToken = "";
  let globalUserId = ""; // User ID for scraper
  let globalWinnerItemId = "";
  let globalSelectedDays = 90; // Período selecionado para visitas na tabela/cálculos
  let isFetchingBatch = false; // Indica se um lote de dados completos (scraper+apis) está sendo buscado
  let isUpdatingVisits = false; // Indica se apenas visitas estão sendo atualizadas
  // Variável global para o total de visitas de todos os competidores carregados NO PERÍODO SELECIONADO
  let globalTotalLoadedVisitas = 0;


  // --- Helper Functions ---
  function fillEmptySpan(htmlString) {
    if (typeof htmlString !== 'string') return htmlString;
    return htmlString.replace(/(<span[^>]*>)(\s*?)(<\/span>)/g, '$1 $3');
  }

  function normalizeMlbId(input) {
    if (!input || typeof input !== 'string') {
      console.error('Invalid MLB ID input:', input);
      return null;
    }
    const r = /(?:MLB-?|\/p\/MLB|\/)([0-9]+)/i;
    const m = input.match(r);
    return m && m[1] ? 'MLB' + m[1] : null;
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

  // --- Item Details Fetching (Scraper + API Fallback) ---
  // Usa o scraper para obter dados visuais e a API oficial como fallback para dados estruturais.
  async function fetchItemDetails(itemId) {
    const nId = normalizeMlbId(itemId);
    if (!nId) {
      console.error(`fetchItemDetails: Invalid ID: ${itemId}`);
      return null;
    }

    let scraperData = null;
    let apiData = null;

    // 1. Tentar scraper (dados visuais: preço exibido, fotos, reputação visual)
    if (globalUserId) {
      try {
        const sR = await fetch(`https://mlb-proxy-fdb71524fd60.herokuapp.com/api/ml-scraper?url=${nId}`, {
          method: 'GET',
          headers: { 'x-user-id': globalUserId }
        });
        if (sR.ok) {
          const sD = await sR.json();
          if (sD?.title && sD.price != null) {
            scraperData = sD;
            console.log(`[Scraper] OK ${nId}: título e preço obtidos.`);
          } else {
            console.warn(`[Scraper] Dados mínimos ausentes ${nId} (sem título ou preço).`);
          }
        } else {
          console.warn(`[Scraper] Falhou ${nId} (${sR.status}).`);
        }
      } catch (sE) {
        console.warn(`[Scraper] Erro ${nId}:`, sE.message);
      }
    }

    // 2. Buscar dados via API oficial (category_id, seller_id, listing_type, shipping)
    if (globalAccessToken) {
      try {
        const apiR = await fetch(`https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-item?item_id=${nId}`, {
          headers: { 'Authorization': `Bearer ${globalAccessToken}` }
        });
        if (apiR.ok) {
          const apiResult = await apiR.json();
          // API multiget retorna array de {code, body}
          const item = Array.isArray(apiResult) ? apiResult[0]?.body : apiResult;
          if (item?.id) {
            apiData = item;
            console.log(`[API] OK ${nId}: dados estruturais obtidos (cat: ${item.category_id}, seller: ${item.seller_id}).`);
          }
        } else {
          console.warn(`[API] Falhou ${nId} (${apiR.status}).`);
        }
      } catch (aE) {
        console.warn(`[API] Erro ${nId}:`, aE.message);
      }
    }

    // 3. Se nem scraper nem API retornaram dados úteis, falha
    if (!scraperData && !apiData) {
      console.error(`[fetchItemDetails] Sem dados para ${nId} (scraper e API falharam).`);
      return null;
    }

    // 4. Montar objeto combinando as duas fontes (scraper para visual, API para estrutural)
    const sD = scraperData || {};
    const aD = apiData || {};

    const pF = parseFloat(sD.price) || aD.price || 0;
    const pDF = parseFloat(sD.price_discounted) || aD.price || pF;
    const sellerId = sD.seller?.seller_id || aD.seller_id || null;
    const categoryId = sD.seller?.category_id || aD.category_id || null;
    const itemIdResolved = sD.seller?.item_id || aD.id || nId;

    const officialStoreId = aD.official_store_id
      || (sD.seller?.official_store ? (sD.seller.official_store_id || null) : null);

    // Determinar listing_type_id: API é mais confiável
    const listingType = aD.listing_type_id || sD.installments?.listing_type_id || null;

    // Shipping: API é mais confiável, scraper como fallback
    const apiShipping = aD.shipping || {};
    const shipping = {
      mode: apiShipping.mode || sD.shipping_mode || null,
      logistic_type: apiShipping.logistic_type || sD.shipping_mode || 'default',
      free_shipping: typeof apiShipping.free_shipping === 'boolean' ? apiShipping.free_shipping : (sD.free_shipping === true),
      tags: apiShipping.tags || [],
      store_pick_up: typeof apiShipping.store_pick_up === 'boolean' ? apiShipping.store_pick_up : (sD.store_pick_up === true),
      local_pick_up: typeof apiShipping.local_pick_up === 'boolean' ? apiShipping.local_pick_up : (sD.local_pick_up === true)
    };

    // Fotos: scraper tem as URLs de alta resolução, API tem structured data
    let pictures = [];
    if (Array.isArray(sD.pictures) && sD.pictures.length > 0) {
      pictures = sD.pictures.map(url => ({ url, secure_url: url }));
    } else if (Array.isArray(aD.pictures)) {
      pictures = aD.pictures;
    }

    // Reputação: scraper tem dados visuais (nível, medalha), API tem dados do seller
    const sellerRep = sD.seller?.seller_reputation || aD.seller_reputation || {};
    const powerStatus = sD.seller?.seller_reputation?.power_seller_status
      || aD.seller_reputation?.power_seller_status || null;

    const nD = {
      id: itemIdResolved,
      title: sD.title || aD.title || nId,
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
      seller_address: sD.seller?.address || aD.seller_address || {},
      attributes: (sD.attributes?.length > 0 ? sD.attributes : aD.attributes) || [],
      description: sD.description || null,
      warranty: sD.warranty || null,
      original_price: (pF !== pDF) ? pF : (aD.original_price || null),
      _source: scraperData ? (apiData ? 'scraper+api' : 'scraper') : 'api',
      _scraper_seller_nickname: sD.seller?.nickname || null,
    };

    if (!nD.category_id) {
      console.warn(`[fetchItemDetails] category_id ausente para ${nId} — comissões não serão calculadas.`);
    }
    if (!nD.listing_type_id) {
      console.warn(`[fetchItemDetails] listing_type_id ausente para ${nId}.`);
    }

    return nD;
  }

  // --- Other Fetch Functions (APIs Essenciais) ---
  async function fetchCatalogDetails(catalogId, accessToken) {
    try {
      const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-catalog?product_id=${catalogId}&access_token=${accessToken}`;
      const r = await fetch(u);
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
    try {
      const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-visits?item_id=${id}&access_token=${accessToken}&last=${days}&unit=day`;
      const r = await fetch(u);
      if (!r.ok) {
        if (r.status === 404) {
            console.warn(`[API Visits] Visitas não encontradas para ${id} (${days}d) - 404.`);
            return { results: [] };
        }
        throw new Error(`Erro ${r.status}`);
      }
      const d = await r.json();
      if (!d?.results) {
          console.warn(`[API Visits] Resposta visitas vazia/inválida para ${id} (${days}d).`, d);
          return { results: [] };
      }
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
          return { cost: d.coverage.all_country.list_cost, currency: "R$" };
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
        access_token: accessToken,
        currency_id: 'BRL',
        category_id
      });
      if (listing_type_id) p.append('listing_type_id', listing_type_id);
      const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/fetch-commissions?${p.toString()}`;
      const r = await fetch(u);
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


    // Função auxiliar para renderizar HTML de Flex
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


  // --- Charting Functions ---
  // Exibe o gráfico de visitas em um canvas
  async function showSellerChartInCanvas(competitorId, accessToken, canvas, sellerName) {
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
    console.log(`[Chart Load ${id}] Load: ${sellerName}`);
    let vD;
    try {
      console.log(`[Chart Load ${id}] Fetch visits...`);
      // Gráfico SEMPRE usa 90 dias
      vD = await fetchVisits(id, accessToken, 90);
      console.log(`[Chart Load ${id}] Visits Resp:`, vD);
    } catch (e) {
      console.error(`[Chart Load ${id}] ERRO FATAL VISITS:`, e);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "red";
      ctx.fillText(`Erro visits (${e.message}).`, canvas.width / 2, canvas.height / 2);
      return;
    }
    if (!vD?.results || !Array.isArray(vD.results) || vD.results.length === 0) {
      console.warn(`[Chart Load ${id}] No/empty visits.`, vD);
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
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: l,
          datasets: [{
            label: `Visitas Diárias`,
            data: v,
            borderColor: 'rgba(75,192,192,1)',
            backgroundColor: 'rgba(75,192,192,0.2)',
            tension: 0.1,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day',
                parser: 'yyyy-MM-dd',
                tooltipFormat: 'dd/MM/yyyy',
                displayFormats: {
                  day: 'dd/MM'
                }
              },
              title: {
                display: true,
                text: 'Data'
              }
            },
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Visitas'
              }
            }
          },
          plugins: {
            legend: {
              display: false
            },
            title: {
              display: true,
              text: `Visitas: ${sellerName} (${id}) - 90 dias`
            },
            tooltip: {
              mode: 'index',
              intersect: false
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
      cC.style.height = '250px';
      cC.style.padding = '10px';
      cC.style.position = 'relative';
      let cv = document.createElement('canvas');
      cv.id = `chart-${competitorId}`;
      cC.appendChild(cv);
      c.appendChild(cC);
      rowElement.parentNode.insertBefore(cR, rowElement.nextSibling);
      if (b) b.textContent = 'Ocultar gráfico';
      rowElement.classList.add('chart-visible');
      showSellerChartInCanvas(competitorId, globalAccessToken, cv, sellerName);
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

      renderPaginatedCompetitorsTable(currentPage, itemsPerPage); // Re-renderiza a tabela na página atual

      isUpdatingVisits = false;
        // O status final será atualizado dentro de renderPaginatedCompetitorTable
  }


  // --- Helper Function to Process a Batch (Busca dados completos de um lote) ---
  // Esta função busca todos os detalhes (scraper + APIs) para um conjunto de IDs
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
      // Processar os IDs do lote em paralelo
      const competitorDetailPromises = batchIds.map(async (competitorId) => {

        // Declarar variáveis ANTES do try/catch interno
        let itemDetails = null;
        let shippingInfo = null;
        let visitsResults = [];
        let visitsTotalSelectedPeriod = 0;
        let sN = 'N/A';
        let finalRepLevel = '-';
        let finalMedalStatus = null;
        let shpC = 0;
        let cmV = 0;
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

        try {
          // 1. Busca detalhes básicos (SCRAPER ONLY)
          itemDetails = await fetchItemDetails(competitorId);
          if (!itemDetails) {
            console.warn(`[Batch Proc] Item ${competitorId} falhou na busca de detalhes básicos (scraper).`);
            throw new Error("Falha nos detalhes básicos do item.");
          }

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
            console.warn(`[Batch Proc] /shipping-details falhou/vazio p/ ${itemDetails.id}. Usando apenas dados do scraper.`);
          }

          // 4. Busca Visitas (API) para o período selecionado globalmente
          const visitsData = await fetchVisits(itemDetails.id, globalAccessToken, globalSelectedDays);
          if (visitsData?.results) {
              visitsResults = visitsData.results;
              visitsTotalSelectedPeriod = visitsResults.reduce((a, c) => a + (c.total || 0), 0);
          }

          // 5. Busca Detalhes do Vendedor & Refina Reputação/Medalha (API)
          sN = itemDetails._scraper_seller_nickname || 'N/A';
          finalRepLevel = itemDetails.seller_reputation?.level_id || '-';
          finalMedalStatus = itemDetails.power_seller_status || null;

          // --- MODIFIED LOGIC TO CHOOSE ID FOR fetchUserDetails ---
          let userIdToQuery = null;
          let idSource = ""; // For logging

          if (itemDetails.seller_id) {
              userIdToQuery = String(itemDetails.seller_id); // Ensure it's a string
              idSource = "seller_id";
          } else if (itemDetails.official_store_id) {
              userIdToQuery = String(itemDetails.official_store_id); // Ensure it's a string
              idSource = "official_store_id";
          }

          if (userIdToQuery) {
              console.log(`[Batch Proc] Attempting to fetch user details using ${idSource}: ${userIdToQuery}`);
              const userDetails = await fetchUserDetails(userIdToQuery); // Pass the chosen ID
              if (userDetails) {
                  sN = userDetails.nickname || sN;
                  if (userDetails.seller_reputation?.level_id) {
                      finalRepLevel = userDetails.seller_reputation.level_id;
                  }
                  if (userDetails.seller_reputation?.power_seller_status) {
                      finalMedalStatus = userDetails.seller_reputation.power_seller_status;
                  }
                  // IMPORTANT: Ensure your Heroku endpoint returns data in a structure that matches
                  // the properties accessed here (e.g., nickname, seller_reputation.level_id, etc.)
                  // or update the property access accordingly.
              } else {
                  console.warn(`[Batch Proc] fetchUserDetails (Heroku) falhou para ${idSource} ${userIdToQuery}, usando dados iniciais/scraper.`);
              }
          } else {
              console.warn(`[Batch Proc] seller_id e official_store_id NULOS para ${itemDetails.id}, não buscar user details.`);
          }
          // --- END OF MODIFIED LOGIC ---


          // 6. Calcula Finanças (Comissões e Custo Frete Grátis via APIs)
          const prV = itemDetails.price || 0;
          const dscP = itemDetails.price_discounted != null ? itemDetails.price_discounted : prV;
          const dscV = prV - dscP;


          hasFreeShipping = itemDetails.shipping?.free_shipping === true;
          fGD = hasFreeShipping ? 'Sim' : 'Não';
          if (hasFreeShipping && itemDetails.seller_id) {
            try {
              const d = await fetchShippingFreeCost(itemDetails.id, itemDetails.seller_id, globalAccessToken);
              if (d?.cost != null) {
                shpC = Number(d.cost);
                fGD = `Sim (${d.currency||'R$'} ${shpC.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})})`;
              } else {
                fGD = 'Sim (Custo?)';
              }
            } catch (e) {
              console.warn(`[Batch Proc] Erro Frete Custo ${itemDetails.id}: ${e.message}`);
              fGD = 'Sim (Erro?)';
            }
          } else if (hasFreeShipping && !itemDetails.seller_id) {
            console.warn(`[Batch Proc] Frete grátis ${itemDetails.id}, mas sem seller_id p/ custo.`);
            shpC = 0;
            fGD = 'Sim (Custo?)';
          } else {
              shpC = 0;
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
                cmVD = cmV.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL'
                });
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

          rpVl = dscP - cmV - shpC;
          rpD = (dscP > 0 || cmV > 0 || shpC > 0) ? rpVl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';

          prD = prV > 0 ? prV.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';
          dscD = dscV > 0.01 ? dscV.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';
          dscPD = (dscP !== prV && dscP > 0) ? dscP.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : prD;

            if (typeof itemDetails.priceNumeric === 'number' && typeof itemDetails.discountedPriceNumeric === 'number' && itemDetails.priceNumeric > 0 && itemDetails.discountedPriceNumeric < itemDetails.priceNumeric) {
              let pc = ((itemDetails.priceNumeric - itemDetails.discountedPriceNumeric) / itemDetails.priceNumeric) * 100;
              pDs = pc.toFixed(0) + '%';
            }

          flexValue = itemDetails.shipping?.tags?.some(tag => tag === "self_service_in" || tag === "mandatory_flex_shipping") ? "Sim" : "Não";

          const compData = {
            item_id: itemDetails.id,
            seller_id: itemDetails.seller_id,
            seller_name: sN,
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
            frete_gratis: fGD,
            flex: flexValue,
            priceNumeric: prV,
            discountedPriceNumeric: dscP
          };
          return compData;
        } catch (error) {
          console.error(`[Batch Proc] Erro ao processar ${competitorId}:`, error.message, error);
          return null;
        } finally {
            processedCount++;
        }
      });

      const results = await Promise.allSettled(competitorDetailPromises);
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

    globalCompetitorsData.sort((a, b) => (b.visitsTotalSelectedPeriod || 0) - (a.visitsTotalSelectedPeriod || 0));

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

      const table = document.createElement('table');
      table.className = 'competitors-table table table-striped table-hover table-sm';
      table.setAttribute('data-items-per-page', itemsPerPage);
      table.setAttribute('data-current-page', currentPage);

      const thead = table.createTHead();
      thead.className = 'thead-light';
      const hR = thead.insertRow();
      const hds = ['Vendedor', 'Rep.', 'Med.', 'Loja', 'Preço', 'Desc.', '%', 'Final', 'Frete Grátis', 'Comissão R$', '% Comis.', 'Repasse', 'Flex', 'Log.', 'Tipo', 'Visitas', 'Visitas %', 'Tend.', 'Ação'];
      const hTs = ['Nome', 'Reputação', 'Medalha', 'Loja Oficial', 'Preço Original', 'Valor Desconto', '% Desconto', 'Preço Final', 'Frete Grátis', 'Valor Comissão', 'Comissão %', 'Repasse (Líquido)', 'Envio Flex', 'Logística', 'Tipo Anúncio', `Visitas (últimos ${globalSelectedDays} dias)`, `% Visitas do Total Carregado`, 'Tendência (7d)', 'Ações'];

      hds.forEach((hTxt, idx) => {
        const th = document.createElement('th');
        th.scope = 'col';
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
              await updateLoadedCompetitorVisits();
          });
          d.appendChild(s);
          th.appendChild(d);
          th.title = `Visitas/Período Selecionado (atualmente ${globalSelectedDays} dias)`;
        } else {
            th.textContent = hTxt;
        }
        th.title = hTs[idx];
        if (['Rep.', 'Med.', 'Loja', 'Flex', 'Log.', 'Tipo', 'Tend.'].includes(hTxt)) th.classList.add('text-center');
        if (['Preço', 'Desc.', '%', 'Final', 'Frete Grátis', 'Comissão R$', '% Comis.', 'Repasse', 'Visitas', 'Visitas %'].includes(hTxt)) th.classList.add('text-end');
        hR.appendChild(th);
      });

      const tbody = table.createTBody();
      competitorsSlice.forEach((cmp) => {
        const r = tbody.insertRow();
        if (cmp.item_id === globalWinnerItemId) r.classList.add('table-success', 'winner-row');

        let vC = '-';
        let tI = '-';
        const visitsCount = cmp.visitsTotalSelectedPeriod;
        if (visitsCount != null && visitsCount >= 0) {
            vC = visitsCount.toLocaleString('pt-BR');
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
          const visitPercentage = (visitsCount / globalTotalLoadedVisitas) * 100;
          visitPercentageDisplay = visitPercentage.toFixed(1) + '%';
        } else if (visitsCount > 0 && globalTotalLoadedVisitas === 0 && globalCompetitorsData.length > 0) {
            visitPercentageDisplay = '100.0%';
        } else if (visitsCount === 0 && globalTotalLoadedVisitas >= 0 && globalCompetitorsData.length > 0) {
            visitPercentageDisplay = '0.0%';
        } else if (globalTotalLoadedVisitas === 0 && globalCompetitorsData.length === 0) {
            visitPercentageDisplay = '-';
        }

        let sN = cmp.seller_name || 'N/A';
        if (cmp.item_id === globalWinnerItemId) sN = `★ ${sN}`;

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

        let pDs = '-';
        if (typeof cmp.priceNumeric === 'number' && typeof cmp.discountedPriceNumeric === 'number' && cmp.priceNumeric > 0 && cmp.discountedPriceNumeric < cmp.priceNumeric) {
          let pc = ((cmp.priceNumeric - cmp.discountedPriceNumeric) / cmp.priceNumeric) * 100;
          pDs = pc.toFixed(0) + '%';
        }
        let flexHtml = getFlexHtml(cmp.flex);

        const cls = [
          sN, rH, mH, lH, p, d, pDs, pD, fG, cmVD, cPD, rp, flexHtml, lgH, tH, vC, visitPercentageDisplay, tI
        ];

        cls.forEach((cD, cIdx) => {
          const td = document.createElement('td');
          const hT = hds[cIdx];
          if (typeof cD === 'string' && cD.includes('<span')) td.innerHTML = fillEmptySpan(cD);
          else td.textContent = cD;
          if (['Rep.', 'Med.', 'Loja', 'Flex', 'Log.', 'Tipo', 'Tend.'].includes(hT)) td.classList.add('text-center');
          if (['Preço', 'Desc.', '%', 'Final', 'Frete Grátis', 'Comissão R$', '% Comis.', 'Repasse', 'Visitas', 'Visitas %'].includes(hT)) td.classList.add('text-end');
          if (hT === 'Vendedor') {
            td.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;';
            td.title = cmp.seller_name || '';
          }
          if (hT === 'Frete Grátis') {
              if (typeof cD === 'string' && cD.includes('(')) {
                  td.title = `Frete Grátis (Custo para o vendedor: ${cD.substring(cD.indexOf('(') + 1, cD.indexOf(')'))})`;
              } else if (cD === 'Sim') {
                  td.title = 'Frete Grátis (Custo não encontrado)';
              } else if (cD === 'Não') {
                  td.title = 'Sem Frete Grátis';
              } else {
                  td.title = cD;
              }
          }
          if (hT === 'Visitas %') {
              if (globalTotalLoadedVisitas > 0) {
                td.title = `${visitPercentageDisplay} do total de visitas dos ${totalLoadedItems} itens carregados nos últimos ${globalSelectedDays} dias.`;
              } else if (globalCompetitorsData.length > 0) {
                  td.title = `Total de visitas dos itens carregados é 0.`;
              } else {
                  td.title = `Nenhum dado carregado para calcular a porcentagem.`;
              }
          }
          if (hT === 'Visitas') {
                td.title = `Total de visitas nos últimos ${globalSelectedDays} dias.`;
          }
            if (hT === 'Repasse') {
                td.title = 'Preço Final (Descontado) - Valor da Comissão - Custo do Frete Grátis';
            }
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
      tabelaContainer.appendChild(table);

      if (totalKnownItems > 0 && (totalPages > 1 || totalLoadedItems < totalKnownItems)) {
        const pN = document.createElement('nav');
        pN.setAttribute('aria-label', 'Paginação');
        const pL = document.createElement('ul');
        pL.className = 'pagination justify-content-center mt-3';

        const pLi = document.createElement('li');
        pLi.className = `page-item ${currentPage===1?'disabled':''}`;
        const pLk = document.createElement('button');
        pLk.className = 'page-link';
        pLk.innerHTML = '«';
        pLk.disabled = isFetchingBatch || isUpdatingVisits || (currentPage === 1);
        pLk.onclick = () => {
          if (currentPage > 1) renderPaginatedCompetitorsTable(currentPage - 1, itemsPerPage);
        };
        pLi.appendChild(pLk);
        pL.appendChild(pLi);

        const pILi = document.createElement('li');
        pILi.className = 'page-item disabled';
        const pISp = document.createElement('span');
        pISp.className = 'page-link';
        let pageText = `${currentPage}/${totalKnownItems > 0 ? totalPages : '--'}`;
        if (totalKnownItems > 0 && totalLoadedItems < totalKnownItems) {
            pageText += ` (${totalLoadedItems}/${totalKnownItems})`;
        } else if (totalKnownItems > 0 && totalLoadedItems === totalKnownItems) {
            pageText = `${currentPage}/${totalPages} (${totalLoadedItems} total)`;
        } else if (totalKnownItems === 0 && totalLoadedItems > 0) {
            pageText = `Página ${currentPage} (${totalLoadedItems} carregados, total desconhecido)`;
        } else if (totalKnownItems === 0 && totalLoadedItems === 0) {
            pageText = `Página ${currentPage}/-- (0/0)`;
        }
        pISp.textContent = pageText;
        pILi.appendChild(pISp);
        pL.appendChild(pILi);

        const nLi = document.createElement('li');
        const disableNext = isFetchingBatch || isUpdatingVisits || (totalLoadedItems >= totalKnownItems) || totalKnownItems === 0;
        nLi.className = `page-item ${disableNext?'disabled':''}`;
        const nLk = document.createElement('button');
        nLk.className = 'page-link';
        nLk.innerHTML = '»';
        nLk.disabled = disableNext;
        nLk.onclick = () => {
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
        nLi.appendChild(nLk);
        pL.appendChild(nLi);
        pN.appendChild(pL);
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
    h.className = 'catalog-header-container d-flex align-items-center mb-3 p-2 border rounded';
    if (!catalogDetails) return;
    const iC = document.createElement('div');
    iC.className = 'flex-shrink-0 me-3';
    const i = document.createElement('img');
    i.classList.add('catalog-image', 'rounded');
    i.style.cssText = 'width:80px;height:80px;object-fit:contain;';
    if (catalogDetails.pictures?.[0]?.url) {
      i.src = catalogDetails.pictures[0].secure_url || catalogDetails.pictures[0].url;
      i.alt = `Img: ${catalogDetails.name||'Catálogo'}`;
    } else {
      i.alt = 'Img N/D';
    }
    iC.appendChild(i);
    const nC = document.createElement('div');
    nC.className = 'flex-grow-1';
    const t = document.createElement('h5');
    t.className = 'catalog-title mb-1';
    t.textContent = catalogDetails.name || 'Catálogo';
    nC.appendChild(t);
    const wI = document.createElement('p');
    wI.className = 'catalog-winner-info text-muted mb-0 small';
    let wT = 'BB Ganhador: N/A';
    const bId = catalogDetails.buy_box_winner?.item_id;
    if (winner?.item_id) {
      let v = '-';
      const visitsCount = winner.visitsTotalSelectedPeriod;
      if (visitsCount != null && visitsCount >= 0) {
          v = visitsCount.toLocaleString('pt-BR');
      }
      const sN = winner.seller_name || `(ID: ${winner.seller_id})`;
      if (bId && winner.item_id === bId) {
        wT = `★ BB: ${sN} (${v} vis/${globalSelectedDays}d)`;
        wI.className += ' text-success fw-bold';
      } else if (bId) {
        wT = `Destaque: ${sN} (${v} vis). BB Oficial: ${bId}`;
        wI.className += ' text-warning';
      } else {
        wT = `Destaque: ${sN} (${v} vis/${globalSelectedDays}d)`;
        wI.className += ' text-info';
      }
    } else if (bId) {
      wT = `Buy Box (API): ${bId}`;
      wI.className += ' text-secondary';
    } else {
        if (globalCompetitorsData.length > 0) {
            wT = `Nenhum competidor carregado teve visitas nos últimos ${globalSelectedDays} dias.`;
            wI.className += ' text-muted';
        } else {
            wT = `BB Ganhador: N/A`;
            wI.className += ' text-muted';
        }
    }
    wI.textContent = wT;
    nC.appendChild(wI);
    h.appendChild(iC);
    h.appendChild(nC);
  }

  // --- Handler Principal (Inicia o processo) ---
  async function handleFetchVisitas() {
    const catalogHeader = document.getElementById("catalogHeader");
    const tabelaContainer = document.getElementById("tabelaCompetidores");
    const paginationContainer = document.getElementById("paginationControls");
    const chartsContainer = document.getElementById("chartsContainer");
    const statusElement = document.getElementById("resultadoTexto");
    const resultsContainer = document.getElementById('resultsContainer');

    if(catalogHeader) catalogHeader.innerHTML = "";
    if(tabelaContainer) tabelaContainer.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-primary"></div><p class="mt-2">Buscando...</p></div>';
    if(paginationContainer) paginationContainer.innerHTML = "";
    if(chartsContainer) chartsContainer.innerHTML = "";
    if(statusElement) { statusElement.textContent = ""; statusElement.className = ''; }
    if(resultsContainer) resultsContainer.innerHTML = '';


    globalCompetitorsData = [];
    globalCompetitorIds = [];
    globalWinnerItemId = "";
    isFetchingBatch = false;
    isUpdatingVisits = false;
    globalTotalLoadedVisitas = 0;


    const iU = document.getElementById("inputCatalog").value.trim();
    if (!iU) {
      appendError('Erro: Campo vazio.');
      if(tabelaContainer) tabelaContainer.innerHTML = '';
      if(statusElement) { statusElement.textContent = 'Campo vazio.'; statusElement.className='text-danger'; }
      return;
    }

    if(statusElement) { statusElement.textContent = 'Credenciais...'; statusElement.className = 'text-info'; }
    try {
      globalAccessToken = await fetchAccessToken();
      globalUserId = await fetchUserIdForScraping();
      if (!globalAccessToken || !globalUserId) throw new Error(`Falha cred: ${!globalAccessToken?'Token ':' '}${!globalUserId?'UserID':''}`);
      console.log("Credenciais OK.");
      if(statusElement) { statusElement.textContent = 'Credenciais OK. Buscando...'; }
    } catch (e) {
      console.error("Erro credenciais:", e);
      appendError('Erro credenciais: '+e.message);
      if(statusElement) { statusElement.textContent = 'Erro cred!'; statusElement.className = 'text-danger'; }
      if(tabelaContainer) tabelaContainer.innerHTML = '';
      return;
    }

    let isCatalogUrl = /\/?p\/MLB[0-9]+/i.test(iU);
    let pId = normalizeMlbId(iU);

    const itemsPerPage = 10;

    try {
      if (isCatalogUrl) {
        const cM = iU.match(/\/p\/(MLB[0-9]+)/i);
        const cId = cM[1];
        console.log(`Iniciando Catálogo: ${cId}`);
        if(statusElement) { statusElement.textContent = `Buscando catálogo ${cId}...`; }

        const cD = await fetchCatalogDetails(cId, globalAccessToken);
        if (!cD) {
            const errorMsg = `Não obter detalhes do catálogo ${cId}.`;
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
          const u = `https://mlb-proxy-fdb71524fd60.herokuapp.com/api/competition/competitors?product_id=${cId}&access_token=${globalAccessToken}`;
          const r = await fetch(u);
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
        if(tabelaContainer) tabelaContainer.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-secondary"></div><p class="mt-2 text-muted">Carregando detalhes do primeiro lote...</p></div>';
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
        renderPaginatedCompetitorsTable(1, itemsPerPage);

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
        console.log("Anúncio OK:", iD);

        if(catalogHeader) catalogHeader.innerHTML =
          `<div class="d-flex align-items-center p-2 border rounded">
            <img src="${iD.pictures?.[0]?.secure_url||iD.thumbnail||''}" class="me-3 rounded" style="width:60px;height:60px;object-fit:contain;" alt="img">
            <h5 class="mb-0">${iD.title||pId}</h5>
          </div>`;

        if(tabelaContainer) tabelaContainer.innerHTML = '';
        if(paginationContainer) paginationContainer.innerHTML = '';

        if(statusElement) { statusElement.textContent = `Buscando visitas ${pId}...`; }
        if(chartsContainer) chartsContainer.innerHTML = '<div class="text-center p-4"><div class="spinner-border spinner-border-sm"></div> Carregando gráfico...</div>';

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
              const cv = document.createElement('canvas');
              cv.id = `chart-${pId}`;
              cv.height = 300;
              ct.appendChild(cv);

              if (typeof Chart === 'undefined') {
                throw new Error("Chart.js não carregado.");
              }

              const ctx = cv.getContext('2d');
              new Chart(ctx, {
                type: 'line',
                data: {
                  labels: l,
                  datasets: [{
                    label: `Visitas Diárias`,
                    data: v,
                    borderColor: 'rgba(75,192,192,1)',
                    backgroundColor: 'rgba(75,192,192,0.2)',
                    tension: 0.1,
                    fill: true
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: {
                      type: 'time',
                      time: {
                        unit: 'day',
                        parser: 'yyyy-MM-dd',
                        tooltipFormat: 'dd/MM/yyyy',
                        displayFormats: {
                          day: 'dd/MM'
                        }
                      },
                    },
                    y: {
                      beginAtZero: true,
                      title: {
                        display: true,
                        text: 'Visitas'
                      }
                    }
                  },
                  plugins: {
                    legend: {
                      display: false
                    },
                    title: {
                      display: true,
                      text: `Visitas: ${iD.title||pId} (90 dias)`
                    },
                    tooltip: {
                      mode: 'index',
                      intersect: false
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
      appendError("Erro: " + e.message);
      if(statusElement) { statusElement.textContent = 'Erro!'; statusElement.className = 'text-danger'; }
      if(tabelaContainer) tabelaContainer.innerHTML = '';
      if(catalogHeader) catalogHeader.innerHTML = '';
      if(paginationContainer) paginationContainer.innerHTML = '';
      if(chartsContainer) chartsContainer.innerHTML = '';
    }
  }

  // --- Event Listener (Inicia a aplicação quando o DOM estiver pronto) ---
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById("buscarCatalogVisitasBtn");
    const i = document.getElementById("inputCatalog");
    if (b && i) {
      b.addEventListener("click", handleFetchVisitas);
      i.addEventListener("keypress", function(e) {
        if (e.key === "Enter") {
          e.preventDefault();
          handleFetchVisitas();
        }
      });
    } else {
      console.error("Elementos UI (botão ou input) não encontrados.");
      document.body.insertAdjacentHTML('afterbegin', '<p style="color:red;text-align:center;">Erro: Componentes UI não encontrados!</p>');
    }

    if (typeof Chart === 'undefined') {
      console.warn("Chart.js NÃO detectado no DOMContentLoaded. Gráficos não funcionarão.");
    } else {
      console.log("Chart.js detectado globalmente no DOMContentLoaded.");
      Chart.defaults.font.family = "'Segoe UI',Tahoma,Geneva,Verdana,sans-serif";
    }
    console.log("App pronta.");
  });

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
