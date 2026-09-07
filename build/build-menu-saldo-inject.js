// Monta o conteúdo do elemento HTML bTMDR (reusable "Menu Lateral"): o cartão de análises
// com IA. Um elemento só: <style> + marcação + <script> com guarda.
// Run: node build/build-menu-saldo-inject.js
// Output: build/menu-saldo-inject-html.txt
//
// ⚠️ O Bubble renderiza o elemento via innerHTML-like: um "</script>" literal dentro do JS
// (mesmo em comentário ou string) fecha a tag antes da hora e trunca o script. O build recusa.

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8').trim();

const html = ler('build', 'menu-saldo-bubble.html');
const js = ler('js', 'menu-saldo.js');

if (/<\/script>/i.test(js)) {
  throw new Error('js/menu-saldo.js contém "</script>" literal: truncaria o elemento no Bubble.');
}
if (!/__MF_MENU_SALDO__/.test(js)) {
  throw new Error('js/menu-saldo.js perdeu a guarda __MF_MENU_SALDO__: rodaria duas vezes no reusable.');
}

const combinado = `${html}
<script>
${js}
</script>`;

const saida = path.join(__dirname, 'menu-saldo-inject-html.txt');
fs.writeFileSync(saida, combinado, 'utf8');
console.log(`bTMDR content: ${saida} (${combinado.length} chars)`);
if (combinado.length > 200000) {
  console.log('⚠️  Passou de 200 KB: o inject NÃO vai pelo clipboard do Bubble.');
}
