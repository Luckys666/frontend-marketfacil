'use strict';
/*
 * Harness do módulo keyword-agent, no mesmo molde do harness-ficha-ia: sandbox vm, porque o
 * arquivo é acoplado ao DOM e não dá pra require() direto.
 *
 * Existe desde 02/09, quando o passe de texto trocou as frases do loading e a barra de
 * progresso passou a acender o passo errado — o texto era a CHAVE de um mapa. Nenhum teste
 * pegou, porque nenhum teste chegava a EXECUTAR o keyword-agent: todos liam a fonte.
 *
 * Uso:
 *   const { carregar } = require('./harness-keyword-agent');
 *   const { K, doc } = carregar();
 *   K.updateLoadingStep('Lendo o anúncio...', K.KW_PASSO.ANUNCIO);
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarDocumento } = require('./mini-dom');

// O mesmo esqueleto que `getLoadingHtml` monta: a mensagem e os quatro passos.
const LOADING_HTML = `
    <p class="kw-loading-msg">…</p>
    <div class="kw-loading-bar-wrapper"><div class="kw-loading-bar-fill" style="width:0%"></div></div>
    <span class="kw-progress-text">0%</span>
    <div class="kw-steps">
      <span class="kw-step">Conexão</span>
      <span class="kw-step">Anúncio</span>
      <span class="kw-step">Palavras</span>
      <span class="kw-step">Indexação</span>
    </div>`;

function carregar(opts = {}) {
  const doc = criarDocumento();
  // criarDocumento() nasce vazio; o mini-dom parseia innerHTML, entao o esqueleto entra por aqui.
  doc.getElementById('kw-loading').innerHTML = opts.html === undefined ? LOADING_HTML : opts.html;

  const box = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, AbortController: global.AbortController,
    // não enfileira nada: o arquivo agenda `bindButton` no fim, e esperar por ele só
    // deixaria o teste lento sem medir nada.
    setTimeout: () => 0,
    clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
  };
  box.fetch = opts.fetch || (async () => ({ ok: true, status: 200, json: async () => ({}) }));
  box.document = doc;
  box.window = box;
  box.globalThis = box;
  box.location = { href: 'https://app.marketfacil.com.br/version-test/agente-palavras-chave' };

  const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'keyword-agent.js'), 'utf8');
  vm.createContext(box);
  vm.runInContext(fonte, box, { filename: 'keyword-agent.js' });

  return { K: box.window.MFKw, doc, box };
}

module.exports = { carregar, LOADING_HTML };
