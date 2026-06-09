'use strict';
/*
 * build-auto-ads.js — gera build/auto-ads-bubble.html a partir de auto-ads.html (standalone).
 * Transformacao p/ o Bubble (1 elemento HTML):
 *   - CSS do <style> -> escopado em #aa-app (nao vaza pro resto da pagina Bubble).
 *   - body content -> envolto em <div id="aa-app">.
 *   - <script> -> <script id="aa-bootstrap" type="text/x-marketfacil-script"> + <img onerror> que o executa
 *     (porque <script> em innerHTML NAO roda no Bubble — ver reference_bubble_consolidated_html_pattern).
 * Uso: node build/build-auto-ads.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'auto-ads.html');
const OUT = path.join(ROOT, 'build', 'auto-ads-bubble.html');
const SCOPE = '#aa-app';

// padding da .aa-wrap difere: standalone = pagina cheia; Bubble = dentro do app (mais compacto)
const WRAP_PADDING_BUBBLE = '8px 4px 48px';

function scopeCss(css) {
  const out = [];
  let i = 0; const n = css.length;
  while (i < n) {
    const braceStart = css.indexOf('{', i);
    if (braceStart < 0) { const rest = css.slice(i).trim(); if (rest) out.push(rest); break; }
    const header = css.slice(i, braceStart).trim();
    // acha o } que fecha (balanceado)
    let depth = 0, j = braceStart, end = -1;
    for (; j < n; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (depth === 0) { end = j; break; } } }
    if (end < 0) { out.push(css.slice(i)); break; }
    let body = css.slice(braceStart + 1, end);

    if (/^@(keyframes|font-face|page)/i.test(header)) {
      out.push(header + '{' + body + '}');                     // mantem global
    } else if (/^@(media|supports)/i.test(header)) {
      out.push(header + '{\n' + scopeCss(body) + '\n}');       // escopa o conteudo interno
    } else {
      const isBody = /^\s*body\s*$/.test(header);
      if (isBody) body = body.replace(/(^|;)\s*(margin|background)\s*:[^;]*;?/gi, '$1'); // body: dropa margin/bg
      const sels = header.split(',').map((s) => {
        s = s.trim();
        if (!s) return s;
        if (s === ':root' || s === 'html' || s === 'body') return SCOPE;
        if (s === '*') return SCOPE + ' *';
        if (s.indexOf(SCOPE) === 0) return s;
        return SCOPE + ' ' + s;
      }).filter(Boolean);
      out.push(sels.join(',') + '{' + body + '}');
    }
    i = end + 1;
  }
  return out.join('\n');
}

function build() {
  const html = fs.readFileSync(SRC, 'utf8');

  const styleM = html.match(/<style>([\s\S]*?)<\/style>/i);
  if (!styleM) throw new Error('bloco <style> nao encontrado');
  let css = styleM[1];
  // ajuste de padding da wrap p/ o contexto Bubble
  css = css.replace(/(\.aa-wrap\{[^}]*padding:)[^;]+;/i, '$1' + WRAP_PADDING_BUBBLE + ';');
  const scopedCss = scopeCss(css);

  const bodyM = html.match(/<body>([\s\S]*?)<\/body>/i);
  if (!bodyM) throw new Error('bloco <body> nao encontrado');
  let bodyContent = bodyM[1];

  const scriptM = bodyContent.match(/<script>([\s\S]*?)<\/script>/i);
  if (!scriptM) throw new Error('bloco <script> nao encontrado');
  const js = scriptM[1];
  // remove o <script> do HTML; o resto do body vira o conteudo do #aa-app
  const htmlContent = bodyContent.replace(/<script>[\s\S]*?<\/script>/i, '').trim();

  // src="data:," dispara onerror SEM request de rede (src="x" gerava um 404 no host a cada render).
  // No RE-render do element o boot ja rodou (__aaBootDone) -> chama AA.rehydrate() pra reidratar o
  // DOM novo (sem isso o monitor ficava no skeleton eterno e o checkbox dessincronizava).
  const bootstrap =
    '<img alt="" src="data:," style="display:none;width:0;height:0" onerror="' +
    "(function(img){var t=document.getElementById('aa-bootstrap');if(!t){return}" +
    "if(window.__aaBootDone){try{window.AA&&window.AA.rehydrate&&window.AA.rehydrate()}catch(e){}img.remove();return}" +
    "window.__aaBootDone=true;var s=document.createElement('script');s.textContent=t.textContent;document.head.appendChild(s);img.remove();})(this)" +
    '">';

  const result =
    '<style>\n' + scopedCss + '\n</style>\n' +
    '<div id="aa-app">\n' + htmlContent + '\n</div>\n\n' +
    '<script id="aa-bootstrap" type="text/x-marketfacil-script">\n' + js + '\n</script>\n\n' +
    bootstrap + '\n';

  fs.writeFileSync(OUT, result, 'utf8');
  console.log('OK -> ' + path.relative(ROOT, OUT) + ' (' + result.length + ' chars)');
}

build();
