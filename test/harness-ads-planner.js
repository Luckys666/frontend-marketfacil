'use strict';
/*
 * Harness pra carregar js/ads-planner.js fora do browser.
 *
 * Diferente do dashboard.js (IIFE que expõe window.MFD._test), o ads-planner.js
 * declara tudo no topo do script — rodando num contexto de vm, as `function`
 * viram propriedades do próprio sandbox. Então o teste chama direto:
 *
 *   const { carregar } = require('./harness-ads-planner');
 *   const h = carregar();
 *   h.S.fetchAdsItemsPage('tok', { limit: 50 });
 *   h.html('adp-overview');
 *
 * O initAdsPlanner() do fim do arquivo não faz nada aqui: ele sai na hora porque
 * document.querySelector('.adp-wrapper') devolve null no stub.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkEl(id) {
  const el = {
    id: id || '', _html: '', value: '', className: '', dataset: {}, tagName: 'DIV',
    children: [], style: { removeProperty() {}, setProperty() {} }, _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(n) { this.children.push(n); return n; },
    removeChild() {}, click() {}, focus() {}, remove() {}, replaceWith() {}, after() {},
    scrollIntoView() {}, addEventListener() {}, removeEventListener() {},
    closest() { return null; },
    getContext() { return { canvas: el }; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el.children = []; }
  });
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
  const chamadas = []; // toda URL passada ao fetch
  const timers = [];   // callbacks de setTimeout, drenados por rodarTimers()
  const charts = [];   // toda config passada ao `new Chart(...)`

  // Stub do Chart.js: não desenha nada, só guarda o que foi mandado desenhar.
  // É o que permite MEDIR a série (quantos pontos, quais valores) em vez de olhar.
  function Chart(ctx, cfg) {
    const id = ctx && ctx.canvas ? ctx.canvas.id : '';
    charts.push({ id, cfg });
    this.data = cfg && cfg.data;
    this.destroy = () => {};
  }
  Chart.getChart = () => null;
  Chart.register = () => {};

  const documentStub = {
    readyState: 'complete',
    title: 'Planejador de Ads',
    documentElement: mkEl('html'),
    getElementById(id) { if (!reg[id]) reg[id] = mkEl(id); return reg[id]; },
    createElement() { return mkEl(''); },
    createDocumentFragment() { return mkEl(''); },
    body: mkEl('body'), head: mkEl('head'),
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };

  const mkStorage = () => ({
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; }
  });
  const localStorage = mkStorage();
  const sessionStorage = mkStorage();

  const respostas = opts.respostas || {}; // { 'trecho da url': objetoDeResposta }
  const sandbox = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, Infinity, NaN,
    encodeURIComponent, decodeURIComponent, URLSearchParams, Intl,
    setTimeout: (fn) => { if (typeof fn === 'function') timers.push(fn); return timers.length; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage, sessionStorage,
    async fetch(url) {
      chamadas.push(String(url));
      const achou = Object.keys(respostas).find(k => String(url).includes(k));
      const body = achou ? respostas[achou] : {};
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    },
    document: documentStub,
    Chart,
    navigator: { userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { href: 'https://app.marketfacil.com.br/planejador-ads', search: opts.search || '', hostname: 'app.marketfacil.com.br' };
  sandbox.window.location = sandbox.location;

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ads-planner.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'ads-planner.js' });

  return {
    S: sandbox,
    chamadas,
    charts,
    // Os charts nascem dentro de um setTimeout — sem drenar, nada é desenhado.
    rodarTimers: () => { while (timers.length) { const fn = timers.shift(); try { fn(); } catch (e) { console.error('timer:', e.message); } } },
    grafico: (id) => charts.filter(c => c.id === id).pop() || null,
    reg,
    localStorage,
    sessionStorage,
    html: (id) => (reg[id] ? reg[id].innerHTML : ''),
    texto: (id) => (reg[id] ? reg[id].innerText : '')
  };
}

// Overview mínimo no formato que renderFullDashboard monta.
function overview(patch = {}) {
  return Object.assign({
    seller_id: 111, seller_info: { nickname: 'LOJA TESTE' }, site_id: 'MLB', advertiser_id: 999,
    total_items: 42, total_items_with_ads: 25, items_sampled: 25, items_skipped: 0, partial: false,
    date_from: '2026-05-29', date_to: '2026-08-27',
    fetch_failed: false, fetch_errors: null,
    aggregated: null, daily_aggregated: [], campaigns: [], items: []
  }, patch);
}

module.exports = { carregar, overview, mkEl };
