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

// === Full inline build (CSS + HTML + JS) for element bTKMH ===
const html = `${fontsImport}
<style>
${css}
</style>
<div class="ana-wrapper">
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
</script>`;

// Write output
const outputPath = path.join(__dirname, 'build', 'analyzer-bubble.html');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
console.log(`Build complete: ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
