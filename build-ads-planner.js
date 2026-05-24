/**
 * Build script: combines CSS + JS + HTML into a single inline block for Bubble.
 * CSS uses Proposta U design system with .adp-wrapper class.
 */
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'css', 'ads-planner.css');
const jsPath = path.join(__dirname, 'js', 'ads-planner.js');

let css = fs.readFileSync(cssPath, 'utf8');
let js = fs.readFileSync(jsPath, 'utf8');

// Wrap entire JS in guard for Bubble double-execution
js = `if (!window.__adsPlannerLoaded) {
window.__adsPlannerLoaded = true;

${js}

}`;

// HTML Template
const fontsImport = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"><\/script>`;

const html = `${fontsImport}
<style>
${css}
</style>
<div class="adp-wrapper">
    <div class="comp-loading">
        <div class="comp-orbital">
            <div class="comp-orbital-ring"></div>
            <div class="comp-orbital-ring"></div>
            <div class="comp-orbital-dot"></div>
        </div>
        <p class="comp-loading-msg">Inicializando Planejador de Ads...</p>
        <div class="comp-loading-bar"><div class="comp-loading-bar-fill"></div></div>
    </div>
</div>

<script>
${js}
<\/script>`;

// Write output
const outputPath = path.join(__dirname, 'build', 'ads-planner-bubble.html');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
console.log(`Build complete: ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
