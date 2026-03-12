const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'bubble-components', 'ad-analyzer.html');
const cssPath = path.join(__dirname, 'css', 'analyzer.css');
const jsPath = path.join(__dirname, 'js', 'analyzer.js');
const outPath = path.join(__dirname, 'test-env', 'ad-analyzer.html');

console.log('Lendo arquivos...');
let html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

console.log('Removendo links CDN antigos do HTML...');
// Remove CSS link tag for analyzer.css
html = html.replace(/<link[^>]*href=["'][^"']*analyzer\.css["'][^>]*>/i, '');
// Remove ANY jsdelivr CSS link tags
html = html.replace(/<link[^>]*href=["'][^"']*jsdelivr[^"']*["'][^>]*>/gi, '');
// Remove JS script tag
html = html.replace(/<script[^>]*src=["'][^"']*analyzer\.js["'][^>]*><\/script>/gi, '');
html = html.replace(/<script[^>]*src=["'][^"']*jsdelivr[^"']*["'][^>]*><\/script>/gi, '');

console.log('Injetando CSS e JS Inline...');
// Append style and script to the very end of the file
const inlineContent = `
<!-- INLINE CSS INJETADO PELO BUILDER -->
<style>
${css}
</style>

<!-- INLINE JS INJETADO PELO BUILDER -->
<script>
${js}
</script>
`;

// Append to EOF
const finalHtml = html + inlineContent;

fs.writeFileSync(outPath, finalHtml, 'utf8');
console.log('✅ Tudo pronto! Arquivo gerado em:', outPath);
console.log('Copie o conteúdo DESTE arquivo e cole no Bubble para testar instantaneamente.');
