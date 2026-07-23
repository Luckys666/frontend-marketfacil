/**
 * Build script: combines CSS + JS + HTML into a single inline block for Bubble.
 * CSS already uses Proposta U design system with .ana-wrapper class.
 */
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'css', 'analyzer.css');
const jsPath = path.join(__dirname, 'js', 'analyzer.js');

let css = fs.readFileSync(cssPath, 'utf8');
let js = fs.readFileSync(jsPath, 'utf8');

// Painel Seletor de Anúncios (F4) — aditivo: arquivos próprios, analyzer intocado.
// CSS todo prefixado com .ana-wrapper .mfsel; JS em IIFE com guard próprio.
const selCss = fs.readFileSync(path.join(__dirname, 'css', 'ad-selector.css'), 'utf8');
const selJs = fs.readFileSync(path.join(__dirname, 'js', 'ad-selector.js'), 'utf8');

// ============================================================
// JS CHANGES — Remove AI image section + Guard
// ============================================================

// REMOVE: API_ANALYZE_IMAGE_ENDPOINT constant
js = js.replace(
  "const API_ANALYZE_IMAGE_ENDPOINT = `${BASE_URL_PROXY}/api/analyze-image`;",
  "// AI image analysis removed"
);

// REMOVE: renderAiImageAnalyzer + iniciarAnaliseIA functions
const aiStartMarker = 'function renderAiImageAnalyzer(detail, containerId) {';
const aiEndMarker = '\nfunction exibirTendenciaVisitas';
const aiStart = js.indexOf(aiStartMarker);
const aiEnd = js.indexOf(aiEndMarker);
if (aiStart !== -1 && aiEnd !== -1) {
  js = js.substring(0, aiStart) + '// AI image analysis section removed\n' + js.substring(aiEnd);
}

// REMOVE: aiImageAnalyzer container from template
js = js.replace(
  /<!-- AI ANALYZER FULL WIDTH -->[\s\S]*?aiImageAnalyzer[^"]*"[^>]*><\/div>/,
  '<!-- AI image analysis removed -->'
);

// Wrap entire JS in guard for Bubble double-execution
js = `if (!window.__analyzerLoaded) {
window.__analyzerLoaded = true;

${js}

// Expose to window for Bubble
window.handleAnalysisClick = handleAnalysisClick;
window.analisarAnuncio = analisarAnuncio;
}`;

// ============================================================
// HTML TEMPLATE — uses .ana-wrapper (Proposta U)
// ============================================================
const fontsImport = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>`;

// === Painel Seletor de Anúncios (F4) — markup do estado inicial do widget ===
// Vem do protótipo test-env/ad-selector (validado 22/07 com API real), sem o
// placeholder de análise (a análise real renderiza no #resultsContainer abaixo).
// O .ana-wrapper nasce com a classe mfsel-on (CSS esconde o input legado) —
// se o boot do painel falhar, o JS remove a classe e o fluxo antigo volta.
const selectorHtml = `
<div class="mfsel" id="mfselRoot">
<div class="hdr">
  <h1>Selecione um anúncio para analisar</h1>
  <p id="subtitle">Os sinais mostram qual anúncio precisa de atenção — toque ou clique em um para ver a análise completa.</p>
</div>

<div id="panelView">
  <!-- Resumo da conta — chips de problemas -->
  <div class="card card-pad" id="chipsCard">
    <div class="chips-head">
      <p class="section-label">Resumo da conta</p>
      <button id="refreshCountsBtn" class="icon-btn" title="Atualizar resumo da conta"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg> Atualizar</button>
    </div>
    <div id="chipsArea">
      <div class="chips-skel"><span></span><span></span><span></span><span></span></div>
    </div>
  </div>

  <!-- Barra de filtros -->
  <div class="card card-pad filters-card" id="filtersCard">
    <div class="filters">
      <div class="search-box">
        <button type="button" class="ico" id="searchGo" title="Buscar" aria-label="Buscar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg></button>
        <input id="searchInput" type="search" inputmode="search" enterkeyhint="search" placeholder="Nome, ID ou link do anúncio" autocomplete="off">
      </div>
      <div class="btn-group" id="statusGroup">
        <button data-status="active" class="on">Ativos</button>
        <button data-status="paused">Pausados</button>
        <button data-status="all">Todos</button>
      </div>
      <button type="button" class="btn-filters-toggle" id="filtersToggle" aria-expanded="false">Filtrar e ordenar ▾</button>
      <div class="filters-more">
      <select class="sel" id="orderSelect">
        <option value="last_updated_desc">Ordenar: atualizados recentemente</option>
        <option value="price_asc">Ordenar: preço menor</option>
        <option value="price_desc">Ordenar: preço maior</option>
        <option value="available_quantity_asc">Ordenar: menos estoque</option>
      </select>
      <select class="sel" id="typeSelect">
        <option value="">Tipo: todos</option>
        <option value="gold_pro">Premium</option>
        <option value="gold_special">Clássico</option>
        <option value="free">Grátis</option>
      </select>
      <select class="sel" id="logisticSelect">
        <option value="">Envio: todos</option>
        <option value="fulfillment">Full</option>
        <option value="self_service">Flex</option>
        <option value="xd_drop_off">Coleta</option>
      </select>
      <button class="btn-clear" id="clearBtn" style="display:none">Limpar filtros</button>
      <button class="btn-export" id="exportBtn" title="Baixa todos os seus anúncios (com os filtros atuais) numa planilha que abre no Excel"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg> Baixar planilha</button>
      </div><!-- /.filters-more -->
    </div>
    <div class="quick-filters">
      <button class="chip chip-sm" id="discountChip" data-on="false"><span class="chip-emoji"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8L14.4 20.4a2 2 0 0 1-2.8 0L3 12V4a1 1 0 0 1 1-1h8Z" transform="rotate(0)"/><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none"/></svg></span> Com desconto</button>
      <button class="chip chip-sm" id="freeShipChip" data-on="false" title="Abaixo de R$ 79 o frete grátis não é obrigatório e sai do seu bolso"><span class="chip-emoji"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h12v10H2z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg></span> Frete grátis abaixo de R$ 79</button>
      <span class="quick-hint" id="discountHint" hidden>Mostrando só os anúncios com desconto desta página</span>
    </div>
  </div>

  <!-- Aviso (busca por nome indisponível etc.) -->
  <div id="bannerArea"></div>

  <!-- Tabela -->
  <div class="card tbl-card">
    <div id="tableHost">
      <!-- loading / tabela / vazio / erro injetados aqui -->
    </div>
  </div>
</div>

<!-- Fluxo integrado: clique colapsa o painel e mostra a barra "Voltar";
     a análise real renderiza no #resultsContainer, logo abaixo -->
<div id="analysisView" hidden></div>
</div>`;

// === Full inline build (CSS + HTML + JS) for element bTKMH ===
const html = `${fontsImport}
<style>
${css}

${selCss}
</style>
<div class="ana-wrapper mfsel-on">
    <div class="input-area">
        <input type="text" id="input-url" placeholder="Cole o link do anúncio, produto ou catálogo..." onclick="this.select()">
        <button id="analyzeButton" onclick="handleAnalysisClick()">Analisar</button>
    </div>

    <div class="info-box collapsible-info">
        <div class="info-header" onclick="this.parentElement.classList.toggle('expanded')">
            <span class="icon">💡</span>
            <p><strong>Dica:</strong> Analise anúncios, produtos e catálogos <b>vinculados à sua conta</b>. <i>Clique para ver os formatos aceitos.</i></p>
            <span class="chevron">▼</span>
        </div>
        <div class="collapsible-content">
            <p>Cole o link do Mercado Livre para analisar. Funciona com anúncios (MLB), produtos de usuário (MLBU) e catálogos (/p/).</p>
            <details style="margin-top: 10px; font-size: 0.9em;">
                <summary>Ver exemplos de links</summary>
                <p><strong>Anúncio (MLB):</strong> https://produto.mercadolivre.com.br/MLB-5365306260-blusinha-feminina-..._JM</p>
                <p><strong>Produto (MLBU):</strong> https://www.mercadolivre.com.br/.../up/MLBU1164018775</p>
                <p><strong>Catálogo:</strong> https://www.mercadolivre.com.br/.../p/MLB39023499</p>
            </details>
        </div>
    </div>

${selectorHtml}

    <div id="resultsContainer">
        <p class="initial-text">Insira um link de anúncio e clique em 'Analisar' para ver os resultados.</p>
    </div>

    <div id="loadingIndicator" style="display:none;">
        <div class="comp-loading">
            <div class="comp-orbital">
                <div class="comp-orbital-ring"></div>
                <div class="comp-orbital-ring"></div>
                <div class="comp-orbital-dot"></div>
            </div>
            <p id="loadingStep" class="comp-loading-msg">Analisando...</p>
            <div class="comp-loading-bar">
                <div id="loadingFill" class="comp-loading-bar-fill"></div>
            </div>
        </div>
    </div>
</div>

<script>
${js}

/* ===== Painel Seletor de Anúncios (F4) — IIFE própria, roda depois do analyzer ===== */
if (!window.__mfSelLoaded) {
window.__mfSelLoaded = true;
${selJs}
}
</script>`;

// Write output
const outputPath = path.join(__dirname, 'build', 'analyzer-bubble.html');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
console.log(`Build complete: ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
