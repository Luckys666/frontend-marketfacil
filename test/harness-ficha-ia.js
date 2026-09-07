'use strict';
/*
 * Harness do módulo ficha-ia. Sandbox vm, porque o módulo é acoplado ao DOM e não dá pra
 * require() direto.
 *
 * O DOM aqui é o mini-dom: ele PARSEIA o HTML que o render gera, em vez de devolver stubs.
 * Antes, `querySelector` e `closest` devolviam null sempre — e por isso `marcadosNoLote`,
 * `umCampo` e o handler de clique nunca rodaram em teste nenhum (foi por essa fresta que o
 * P3 passou).
 *
 * Uso:
 *   const { carregar } = require('./harness-ficha-ia');
 *   const { M, box } = carregar();                      // fetch devolve o padrão
 *   const { M, box } = carregar({ resposta: {...} });    // fetch devolve isso
 *   const { M, box } = carregar({ rotas: [[/regex/, () => ({...})]] });  // por URL
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarDocumento } = require('./mini-dom');

function carregar(opts = {}) {
  const doc = criarDocumento();
  const box = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, AbortController: global.AbortController,
    setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  box.chamadas = [];

  // `rotas` responde por URL — é o que permite encenar "o anúncio A demora mais que o B",
  // que é o cenário do P1. Sem ela, todo fetch devolve a mesma coisa e a corrida não existe.
  box.fetch = async (url, init) => {
    const reg = { url: String(url), init: init || {} };
    box.chamadas.push(reg);
    for (const [padrao, responder] of (opts.rotas || [])) {
      if (padrao.test(String(url))) {
        const r = await responder(String(url), init || {});
        if (r && r.__erro) throw new Error(r.__erro);
        return {
          ok: r.status ? r.status < 400 : true,
          status: r.status || 200,
          json: async () => (r.body === undefined ? {} : r.body),
        };
      }
    }
    if (opts.falhar) throw new Error('rede caiu');
    return {
      ok: opts.status ? opts.status < 400 : true,
      status: opts.status || 200,
      json: async () => opts.resposta || { ok: true, sugestoes: [], sem_base: [], descartadas: 0 },
    };
  };

  box.document = doc;
  box.window = box; box.globalThis = box;
  box.location = { href: 'https://app.marketfacil.com.br/agente-de-palavras-chave', search: '', pathname: '/agente-de-palavras-chave' };
  box.window.location = box.location;

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ficha-ia.js'), 'utf8');
  vm.createContext(box);
  vm.runInContext(src, box, { filename: 'ficha-ia.js' });
  return { M: box.MFFicha, box, doc, el: (id) => doc.getElementById(id) };
}

module.exports = { carregar };
