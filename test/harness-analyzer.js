'use strict';
/*
 * Harness compartilhado pra carregar js/analyzer.js fora do browser.
 *
 * O analyzer é acoplado ao DOM: roda num sandbox (vm) com stubs mínimos. Este arquivo é
 * a mesma montagem que analyzer-familia.test.js faz inline, extraída pra não copiar 60
 * linhas de stub em cada suíte nova. Os testes antigos seguem com a cópia deles — não
 * mexi neles pra não misturar refactor de teste com correção de bug.
 *
 * Uso:
 *   const { carregar } = require('./harness-analyzer');
 *   const { get, sandbox, reg } = carregar();
 *   const minhaFuncao = get('minhaFuncao');
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkEl(id, opts = {}) {
  const el = {
    id: id || '', _html: '', textContent: '', value: '', disabled: false, className: '',
    children: [], style: { removeProperty() {}, setProperty() {} }, _attrs: {}, dataset: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(n) { this.children.push(n); return n; },
    removeChild() {}, click() {}, focus() {}, select() {}, scrollIntoView() {},
    addEventListener() {}, removeEventListener() {}, remove() {},
    querySelector() { return opts.looseQS ? mkEl('', opts) : null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el.children = []; }
  });
  return el;
}

function carregar(opts = {}) {
  const reg = {};
  const documentStub = {
    readyState: 'complete',
    getElementById(id) { if (!reg[id]) reg[id] = mkEl(id, opts); return reg[id]; },
    createElement() { return mkEl('', opts); },
    createDocumentFragment() { return mkEl('', opts); },
    body: mkEl('body', opts), head: mkEl('head', opts),
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  };

  const storage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };

  const sandbox = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: storage, sessionStorage: storage,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    document: documentStub,
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { href: 'https://app.marketfacil.com.br/version-test/analise-anuncio', search: opts.search || '' };
  sandbox.window.location = sandbox.location;

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'analyzer.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'analyzer.js' });

  // Funções sloppy-mode viram propriedades do contexto; as que não vierem, buscamos via eval.
  const get = (nome) => sandbox[nome]
    || vm.runInContext(`typeof ${nome} !== 'undefined' ? ${nome} : undefined`, sandbox);

  return { get, sandbox, reg, documentStub };
}

module.exports = { carregar, mkEl };
