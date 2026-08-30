'use strict';
/*
 * Harness do módulo ficha-ia. Mesmo desenho do harness-analyzer: sandbox vm com stubs
 * mínimos de DOM, porque o módulo é acoplado ao DOM e não dá pra require() direto.
 *
 * Uso:
 *   const { carregar } = require('./harness-ficha-ia');
 *   const { M, box } = carregar();          // M = window.MFFicha
 *   const { M, box } = carregar({ resposta: {...} });   // fetch devolve isso
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkEl(id) {
  const el = {
    id: id || '', _html: '', value: '', hidden: false, disabled: false, checked: false,
    style: { removeProperty() {}, setProperty() {} }, dataset: {}, children: [], _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] || null; },
    appendChild(n) { this.children.push(n); return n; }, removeChild() {},
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); } });
  const semTags = () => String(el._html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  Object.defineProperty(el, 'textContent', { get: semTags, set(v) { el._html = String(v); }, configurable: true });
  return el;
}

function carregar(opts = {}) {
  const reg = {};
  const box = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
  };
  box.chamadas = [];
  box.fetch = async (url, init) => {
    box.chamadas.push({ url: String(url), init: init || {} });
    if (opts.falhar) throw new Error('rede caiu');
    return {
      ok: opts.status ? opts.status < 400 : true,
      status: opts.status || 200,
      json: async () => opts.resposta || { ok: true, sugestoes: [], sem_base: [], descartadas: 0 },
    };
  };
  box.document = {
    readyState: 'complete',
    getElementById(id) { if (!reg[id]) reg[id] = mkEl(id); return reg[id]; },
    createElement: () => mkEl(), body: mkEl('body'), head: mkEl('head'),
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  };
  box.window = box; box.globalThis = box;
  box.location = { href: 'https://app.marketfacil.com.br/agente-de-palavras-chave', search: '', pathname: '/agente-de-palavras-chave' };
  box.window.location = box.location;

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ficha-ia.js'), 'utf8');
  vm.createContext(box);
  vm.runInContext(src, box, { filename: 'ficha-ia.js' });
  return { M: box.MFFicha, box, el: (id) => box.document.getElementById(id) };
}

module.exports = { carregar, mkEl };
