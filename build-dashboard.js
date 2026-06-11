/**
 * Build script: combina CSS + JS + HTML em um bloco inline pronto para
 * injeção no HTML element bTLuq da página dashboard do Bubble.
 *
 * CSS já usa o design Light Trading (Proposta U) com classe .mfd-wrapper.
 *
 * Uso: node build-dashboard.js
 * Saída: build/dashboard-bubble.html
 */
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'css', 'dashboard.css');
const jsPath  = path.join(__dirname, 'js',  'dashboard.js');

let css = fs.readFileSync(cssPath, 'utf8');
let js  = fs.readFileSync(jsPath,  'utf8');

// O dashboard.js já tem IIFE que expõe MFD_init no window — só envelopa em
// guard pra o caso do Bubble re-injetar o HTML element em outra página.
js = `if (!window.__mfdLoaded) {
window.__mfdLoaded = true;

${js}

}`;

// Fontes + Chart.js (mesmas versões do analyzer/planner pra reaproveitar cache)
const fontsImport = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;700&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"><\/script>`;

const html = `${fontsImport}
<style>
${css}
</style>

<!-- DASHBOARD MARKETFACIL · injetado pelo build em ${new Date().toISOString()} -->
<div id="mfd-root">
    <div class="mfd-wrapper">
        <div class="mfd-loading">
            <div class="mfd-orbital">
                <div class="mfd-orbital-ring"></div>
                <div class="mfd-orbital-ring"></div>
                <div class="mfd-orbital-dot"></div>
            </div>
            <p class="mfd-loading-msg">Inicializando seu painel...</p>
            <div class="mfd-loading-bar"><div class="mfd-loading-bar-fill"></div></div>
        </div>
    </div>
</div>

<script>
${js}
<\/script>`;

const outputPath = path.join(__dirname, 'build', 'dashboard-bubble.html');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
console.log(`Build complete: ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
