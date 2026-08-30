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
  // Este corte é por POSIÇÃO, não por escopo: leva junto tudo que estiver entre as duas
  // funções. Em 11/08/2026 quatro funções novas do gráfico de visitas foram escritas logo
  // acima de exibirTendenciaVisitas e sumiram aqui — o bundle foi pro Bubble com a CHAMADA
  // e sem a DECLARAÇÃO, e o card ficou vazio na tela sem um erro sequer no build.
  const recortado = js.substring(aiStart, aiEnd);
  // Só declarações de TOP-LEVEL (coluna 0) — variável dentro das funções de IA sai junto
  // com elas, e isso é o esperado.
  const declaracoesPerdidas = (recortado.match(/^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm) || [])
    .map((m) => m.trim().split(/\s+/)[1])
    .filter((n) => n && !/^(renderAiImageAnalyzer|iniciarAnaliseIA)$/.test(n));
  if (declaracoesPerdidas.length) {
    console.error('\n❌ BUILD ABORTADO — o corte da seção de IA levaria junto:');
    for (const n of declaracoesPerdidas) console.error(`   • ${n}`);
    console.error('\nEsse corte vai de renderAiImageAnalyzer até exibirTendenciaVisitas e apaga');
    console.error('TUDO que estiver no meio. Mova essas declarações para fora dessa faixa.\n');
    process.exit(1);
  }
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
// O shell do painel vive em build/selector-shell.html porque DOIS bundles precisam dele:
// este (Análise, bTKMH) e o do Agente de Palavras-Chave (bTKbr). Enquanto era string
// aqui dentro, o Agente foi montado só com <div id="mfselRoot"></div> vazio — e o painel
// nunca subiu, porque wireControls() procura #filtersToggle e morre no null.
// O '\n' na frente reproduz a quebra que a string tinha logo depois da crase de
// abertura. Sem ele o bundle inteiro desloca uma linha — que é o tipo de diferença que
// passa batida numa revisão e some no diff de 774 mil caracteres.
const selectorHtml = '\n' + fs.readFileSync(path.join(__dirname, 'build', 'selector-shell.html'), 'utf8').trimEnd();

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
// Normaliza CRLF -> LF: os fontes estão em CRLF (Windows), mas ao colar no campo do Bubble
// o browser converte tudo pra LF. Sem isso o arquivo em disco tem um tamanho e o campo
// tem outro (5.943 chars de diferença em 11/08/2026), e a validação de tamanho do script
// de injeção — que é o que impede salvar um paste truncado — dispara falso negativo.
// O artefato precisa ser byte a byte o que vai pro Bubble, senão não serve de prova.
const htmlLF = html.replace(/\r\n/g, '\n');
const outputPath = path.join(__dirname, 'build', 'analyzer-bubble.html');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(outputPath, htmlLF, 'utf8');
console.log(`Build complete: ${outputPath} (${(htmlLF.length / 1024).toFixed(1)} KB, ${htmlLF.length} chars, LF)`);
