'use strict';
/*
 * Harness pra carregar js/dashboard.js fora do browser.
 *
 * O dashboard é uma IIFE em strict mode: nada vaza pro contexto. O acesso é
 * pelo window.MFD (helpers públicos) e window.MFD._test (funções de cálculo).
 *
 * Uso:
 *   const { carregar } = require('./harness-dashboard');
 *   const { MFD, STATE, storage } = carregar();
 *   MFD._test.computeConversions({ ... });
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkEl(id) {
  const el = {
    id: id || '', _html: '', value: '', className: '', dataset: {},
    children: [], style: { removeProperty() {}, setProperty() {} }, _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(n) { this.children.push(n); return n; },
    removeChild() {}, click() {}, focus() {}, remove() {}, replaceWith() {},
    scrollIntoView() {}, addEventListener() {}, removeEventListener() {},
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el.children = []; }
  });
  // innerText/textContent DERIVAM do innerHTML — teste que lê '' fixo passa
  // sem olhar nada, que é o falso positivo que deixa bug passar.
  const semTags = () => String(el._html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  Object.defineProperty(el, 'textContent', { get: semTags, set(v) { el._html = String(v); }, configurable: true });
  Object.defineProperty(el, 'innerText', { get: semTags, configurable: true });
  return el;
}

function carregar(opts = {}) {
  const reg = {};
  const documentStub = {
    readyState: 'complete',
    documentElement: mkEl('html'),
    getElementById(id) { if (!reg[id]) reg[id] = mkEl(id); return reg[id]; },
    createElement() { return mkEl(''); },
    createDocumentFragment() { return mkEl(''); },
    body: mkEl('body'), head: mkEl('head'),
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  };

  const storage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; }
  };

  const sandbox = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, Infinity, NaN,
    encodeURIComponent, decodeURIComponent,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: storage, sessionStorage: storage,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    document: documentStub,
    navigator: { userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    // Sem autostart: o teste controla o STATE na mão
    MFD_AUTOSTART: false
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { href: 'https://app.marketfacil.com.br/', search: opts.search || '' };
  sandbox.window.location = sandbox.location;

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'dashboard.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'dashboard.js' });

  const MFD = sandbox.MFD;
  if (!MFD || !MFD._test) throw new Error('dashboard.js não expôs window.MFD._test');
  return { MFD, T: MFD._test, STATE: MFD.STATE, storage, sandbox, documentStub, reg };
}

// Monta STATE com um cenário completo, do jeito que o dashboard fica depois de
// todos os fetches resolverem. Devolve o próprio STATE pra ajuste fino.
function cenario(STATE, { agg = {}, visits = null, orders = null, prev = null, period = 30, sellerId = '999' } = {}) {
  STATE.period = period;
  STATE.sellerId = sellerId;
  STATE.containerId = 'mfd-root';
  STATE.loading = false;
  STATE.visitsLoading = false;
  STATE.ordersLoading = false;
  STATE.visitsData = visits;
  STATE.ordersData = orders;
  STATE.prevSnapshot = prev;
  STATE.data = {
    aggregated: agg,
    daily_aggregated: [],
    campaigns: [],
    totals: { activeItems: 10, pausedItems: 0, itemsWithAds: 1, countsUnknown: false },
    fetchedAt: 0
  };
  return STATE;
}

// Extrai os números de uma coluna do HTML do card, como o usuário lê na tela.
function lerColuna(html, classe) {
  const re = new RegExp('<div class="mfd-vs-col ' + classe + '">([\\s\\S]*?)(?=<div class="mfd-vs-col |</div>\\s*</div>\\s*</div>\\s*$)');
  const m = html.match(re);
  const bloco = m ? m[1] : '';
  const celulas = {};
  const cellRe = /<div class="mfd-vs-kpi-label">([^<]*?)(?:\s*<span class="mfd-tip)[\s\S]*?<div class="mfd-vs-kpi-value[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let c;
  while ((c = cellRe.exec(bloco)) !== null) {
    celulas[c[1].trim()] = c[2].replace(/<[^>]+>/g, '').trim();
  }
  const rev = bloco.match(/<span class="mfd-vs-value"[^>]*>([\s\S]*?)<\/span>/);
  celulas['Receita'] = rev ? rev[1].replace(/<[^>]+>/g, '').trim() : null;
  return celulas;
}

module.exports = { carregar, cenario, lerColuna, mkEl };
