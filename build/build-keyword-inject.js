// Builds the combined HTML+JS content for Bubble element bTKbr
// Run: node build/build-keyword-inject.js
// Output: build/keyword-agent-inject-html.txt (bTKbr) + -css.txt (bTKbs)
//
// ⚠️ ORDEM DOS SCRIPTS IMPORTA: ficha-ia.js define window.MFSEL_HOST e PRECISA rodar
// antes de ad-selector.js, que lê essa variável no topo pra saber em que tela está.
// Invertido, o painel volta ao default da Análise e o clique não abre a ficha.

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8').trim();

const html = ler('build', 'keyword-agent-bubble.html');
const fichaJs = ler('js', 'ficha-ia.js');
const selectorJs = ler('js', 'ad-selector.js');
const agenteJs = ler('js', 'keyword-agent.js');

const outHtmlPath = path.join(__dirname, 'keyword-agent-inject-html.txt');
const outCssPath = path.join(__dirname, 'keyword-agent-inject-css.txt');

// bTKbr: HTML template + os três scripts, nesta ordem
const combined = `${html}
<script>
${fichaJs}
</script>
<script>
${selectorJs}
</script>
<script>
${agenteJs}
</script>`;
fs.writeFileSync(outHtmlPath, combined, 'utf8');
console.log(`bTKbr content: ${outHtmlPath} (${combined.length} chars)`);
if (combined.length > 200000) {
  console.log('⚠️  Passou de 200 KB: o inject NÃO vai pelo clipboard do Bubble.');
  console.log('   Usar servidor local + page.request.get do Playwright, e validar o');
  console.log('   comprimento ANTES do blur.');
}

// bTKbs: CSS dos três, num <style> só
const css = [ler('css', 'keyword-agent.css'), ler('css', 'ad-selector.css'), ler('css', 'ficha-ia.css')].join('\n\n');
const cssContent = `<style>\n${css}\n</style>`;
fs.writeFileSync(outCssPath, cssContent, 'utf8');
console.log(`bTKbs content: ${outCssPath} (${cssContent.length} chars)`);
