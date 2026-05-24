/*
 * MarketFacil - Site Config (frontend)
 * Fonte da verdade por site ML (MLB/MCO/MLA/MLM/MLC/MLU).
 * Espelha heroku/mlb-proxy/utils/siteConfig.js
 * Uso: window.MF_getSiteConfig('MCO'), window.MF_siteIdFromItemId('MLB123'),
 *      window.MF_formatCurrency(1234.5, 'MCO')
 */
(function () {
  if (window.MF_SITES) return; // guard

  const SITES = {
    MLB: { country: 'Brasil', domain: 'mercadolivre.com.br', host: 'www.mercadolivre.com.br', productHost: 'produto.mercadolivre.com.br', listHost: 'lista.mercadolivre.com.br', currency: 'BRL', currencySymbol: 'R$', locale: 'pt-BR', productAds: true },
    MCO: { country: 'Colombia', domain: 'mercadolibre.com.co', host: 'www.mercadolibre.com.co', productHost: 'articulo.mercadolibre.com.co', listHost: 'listado.mercadolibre.com.co', currency: 'COP', currencySymbol: '$', locale: 'es-CO', productAds: true },
    MLA: { country: 'Argentina', domain: 'mercadolibre.com.ar', host: 'www.mercadolibre.com.ar', productHost: 'articulo.mercadolibre.com.ar', listHost: 'listado.mercadolibre.com.ar', currency: 'ARS', currencySymbol: '$', locale: 'es-AR', productAds: true },
    MLM: { country: 'Mexico', domain: 'mercadolibre.com.mx', host: 'www.mercadolibre.com.mx', productHost: 'articulo.mercadolibre.com.mx', listHost: 'listado.mercadolibre.com.mx', currency: 'MXN', currencySymbol: '$', locale: 'es-MX', productAds: true },
    MLC: { country: 'Chile', domain: 'mercadolibre.cl', host: 'www.mercadolibre.cl', productHost: 'articulo.mercadolibre.cl', listHost: 'listado.mercadolibre.cl', currency: 'CLP', currencySymbol: '$', locale: 'es-CL', productAds: false },
    MLU: { country: 'Uruguay', domain: 'mercadolibre.com.uy', host: 'www.mercadolibre.com.uy', productHost: 'articulo.mercadolibre.com.uy', listHost: 'listado.mercadolibre.com.uy', currency: 'UYU', currencySymbol: '$', locale: 'es-UY', productAds: false },
  };
  const DEFAULT_SITE_ID = 'MLB';
  const SITE_PREFIX_RE = /^(MLB|MCO|MLA|MLM|MLC|MLU)/i;

  function resolveSiteId(siteId) {
    if (!siteId) return DEFAULT_SITE_ID;
    const up = String(siteId).toUpperCase();
    return SITES[up] ? up : DEFAULT_SITE_ID;
  }

  function getSiteConfig(siteId) {
    const id = resolveSiteId(siteId);
    return Object.assign({ siteId: id }, SITES[id]);
  }

  function siteIdFromItemId(id) {
    if (!id) return DEFAULT_SITE_ID;
    const m = String(id).toUpperCase().match(/^([A-Z]{2,4})-?\d+/);
    if (!m) return DEFAULT_SITE_ID;
    const prefix = m[1];
    const base = prefix.endsWith('U') && prefix.length > 2 ? prefix.slice(0, -1) : prefix;
    return SITES[base] ? base : DEFAULT_SITE_ID;
  }

  // Normaliza um input (ID solto, URL) pra objeto { siteId, itemId, numericId }
  function normalizeItemInput(input) {
    if (!input) return null;
    const s = String(input).trim();

    // ID direto: MLB123, MCO-456, etc.
    const directMatch = s.toUpperCase().match(/^(MLB|MCO|MLA|MLM|MLC|MLU)-?(\d+)$/);
    if (directMatch) {
      return { siteId: directMatch[1], itemId: directMatch[1] + directMatch[2], numericId: directMatch[2] };
    }

    // URL de produto ou lista
    const urlMatch = s.toUpperCase().match(/(MLB|MCO|MLA|MLM|MLC|MLU)-?(\d+)/);
    if (urlMatch) {
      return { siteId: urlMatch[1], itemId: urlMatch[1] + urlMatch[2], numericId: urlMatch[2] };
    }

    // URL de catálogo /p/{PRODUCT_ID}
    const catMatch = s.toUpperCase().match(/\/P\/((MLB|MCO|MLA|MLM|MLC|MLU)\w+)/);
    if (catMatch) {
      return { siteId: catMatch[2], itemId: catMatch[1], numericId: null, isCatalog: true };
    }

    return null;
  }

  function formatCurrency(value, siteId) {
    const cfg = getSiteConfig(siteId);
    try {
      return Number(value || 0).toLocaleString(cfg.locale, { style: 'currency', currency: cfg.currency, maximumFractionDigits: 2 });
    } catch (_) {
      return cfg.currencySymbol + ' ' + Number(value || 0).toFixed(2);
    }
  }

  function formatNumber(value, siteId) {
    const cfg = getSiteConfig(siteId);
    try {
      return Number(value || 0).toLocaleString(cfg.locale);
    } catch (_) {
      return String(value);
    }
  }

  function formatDate(date, siteId, options) {
    const cfg = getSiteConfig(siteId);
    try {
      return new Date(date).toLocaleDateString(cfg.locale, options || { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) {
      return String(date);
    }
  }

  function productUrl(itemId) {
    const info = normalizeItemInput(itemId);
    if (!info) return null;
    const cfg = getSiteConfig(info.siteId);
    if (info.isCatalog) return `https://${cfg.host}/p/${info.itemId}`;
    return `https://${cfg.productHost}/${cfg.siteId}-${info.numericId}`;
  }

  // Lê o país ativo do usuário (seletor no Bubble). Fallback: detectar do primeiro item.
  // O Bubble deve setar window.MF_CURRENT_SITE via JS element quando o usuário troca.
  function currentSiteId(fallbackItemId) {
    if (window.MF_CURRENT_SITE && SITES[window.MF_CURRENT_SITE]) return window.MF_CURRENT_SITE;
    if (fallbackItemId) return siteIdFromItemId(fallbackItemId);
    return DEFAULT_SITE_ID;
  }

  window.MF_SITES = SITES;
  window.MF_DEFAULT_SITE_ID = DEFAULT_SITE_ID;
  window.MF_SITE_PREFIX_RE = SITE_PREFIX_RE;
  window.MF_resolveSiteId = resolveSiteId;
  window.MF_getSiteConfig = getSiteConfig;
  window.MF_siteIdFromItemId = siteIdFromItemId;
  window.MF_normalizeItemInput = normalizeItemInput;
  window.MF_formatCurrency = formatCurrency;
  window.MF_formatNumber = formatNumber;
  window.MF_formatDate = formatDate;
  window.MF_productUrl = productUrl;
  window.MF_currentSiteId = currentSiteId;
})();
