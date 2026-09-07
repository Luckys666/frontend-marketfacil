'use strict';
/*
 * Harness do cartão de análises do menu lateral (js/menu-saldo.js). Sandbox vm + mini-dom,
 * no mesmo molde do harness-ficha-ia: o DOM parseia o HTML que o render gera de verdade.
 *
 * Diferenças que importam aqui:
 *  - `sessionStorage` é REAL (Map), porque o cartão guarda o último número para a primeira
 *    pintura entre páginas, e o teste precisa ver o que ficou guardado.
 *  - `agora` é injetável, para envelhecer o cache sem esperar 2 minutos.
 *  - `document.dispatchEvent` existe, porque o Agente avisa o menu por evento.
 *
 * Uso:
 *   const { carregar } = require('./harness-menu-saldo');
 *   const { M, box, raizes } = carregar({ rotas: [[/creditos\/saldo/, () => ({ body: {...} })]] });
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarDocumento, parseFragmento } = require('./mini-dom');

const HTML_DO_ELEMENTO = () => {
  const bruto = fs.readFileSync(path.join(__dirname, '..', 'build', 'menu-saldo-bubble.html'), 'utf8');
  // Só a marcação: o <style> e o <script> não interessam ao mini-dom.
  return bruto.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').trim();
};

function carregar(opts = {}) {
  const doc = criarDocumento();
  const storage = new Map(opts.sessao || []);
  const box = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    // O boot do módulo agenda carregar() num setTimeout. Aqui ele fica na fila: o teste
    // dispara quando quer (box.rodarTimers) e, no resto do tempo, a contagem de chamadas
    // não vem poluída pelo boot.
    setTimeout: (fn) => { box.timers.push(fn); return box.timers.length; }, clearTimeout() {},
    sessionStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  box.chamadas = [];
  box.timers = [];
  box.rodarTimers = () => { const t = box.timers.splice(0); for (const fn of t) { try { fn(); } catch (_) {} } };
  box.fetch = async (url, init) => {
    box.chamadas.push({ url: String(url), init: init || {} });
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
    return { ok: true, status: 200, json: async () => ({}) };
  };

  // O document do mini-dom registra ouvintes mas não dispara: o cartão escuta o aviso do
  // Agente no document, então o teste precisa disparar de verdade.
  doc.dispatchEvent = (ev) => { for (const fn of (doc._ouvintes.get(ev.type) || [])) fn.call(doc, ev); };

  // Quantas cópias do elemento? O reusable "Menu Lateral" pode estar duas vezes na página
  // (desktop + mobile); o cartão tem que pintar em TODAS, sem depender de id único.
  const copias = opts.copias === undefined ? 1 : opts.copias;
  for (let i = 0; i < copias; i++) {
    for (const n of parseFragmento(HTML_DO_ELEMENTO())) doc.body.appendChild(n);
  }

  box.document = doc;
  box.window = box; box.globalThis = box;
  box.location = { href: 'https://app.marketfacil.com.br/inicio', search: '', pathname: '/inicio' };

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'menu-saldo.js'), 'utf8');
  vm.createContext(box);
  vm.runInContext(src, box, { filename: 'menu-saldo.js' });
  const raizes = () => doc.querySelectorAll('.mf-saldo');
  return { M: box.MFSaldo, box, doc, storage, raizes, raiz: () => raizes()[0] };
}

module.exports = { carregar };
