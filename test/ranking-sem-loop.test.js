'use strict';
/*
 * A visão PADRÃO do Seletor não pode entrar em recursão quando não há ranking.
 *
 * Achado pela revisão de 16/08/2026. `loadPage()` entra no ramo do ranking sempre que
 * `order === sold_desc && !search && !filtroForaDoRanking()`, e os dois caminhos de
 * insucesso terminam em `return loadPage()` — sem mudar NADA que a condição leia.
 * `state.ordemDegradada` é escrito, mas a guarda não o consulta.
 *
 * Os dois cenários, ambos reais:
 *  - Conta sem venda no status selecionado: `loadSalesRanking()` devolve o ranking
 *    MEMOIZADO (`state.ranking = []` — array vazio é truthy em JS, então o memo responde
 *    sem ir à rede), `!ranking.length` dispara de novo → laço em memória, aba travada em
 *    "Carregando seus anúncios…". É a tela inicial de quem ainda não vendeu.
 *  - Rota fora do ar (404/500): mesmo laço, mas cada volta chama `/api/sales-ranking` —
 *    tempestade de requisições contra o proxy, justamente no cenário "front subiu antes do
 *    servidor" que o comentário do código diz estar tratando.
 *
 * ⚠️ Um laço recursivo com `await` não libera o event loop para timers, então não dá pra
 * flagrar isso com `setTimeout`: o teste SEGURA o processo. Por isso quem mede o tempo é o
 * runner externo (`timeout 25 node test/ranking-sem-loop.test.js`) e, aqui dentro, um teto
 * de chamadas que transforma o laço em falha legível em vez de travamento.
 *
 * Rodar: node test/ranking-sem-loop.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const mkEl = () => ({
  innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, appendChild() {}, querySelector() { return null; },
  querySelectorAll() { return []; }, setAttribute() {}, getAttribute() { return null; },
  closest() { return null; }, focus() {}, click() {}, remove() {},
});
const mkStorage = () => {
  const s = {};
  Object.defineProperties(s, {
    getItem: { value(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; }, enumerable: false },
    setItem: { value(k, v) { this[k] = String(v); }, enumerable: false },
    removeItem: { value(k) { delete this[k]; }, enumerable: false },
  });
  return s;
};

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ad-selector.js'), 'utf8');

// TETO: acima disto o laço é dado como infinito e o teste falha por asserção, não por
// travamento. 40 é folgado — o caminho são passa por loadPage no máximo duas vezes.
const TETO = 40;

function carregar(fetchImpl) {
  const patched = src.replace(/\nboot\(\);\n/, `
window.__internos = { state, CONFIG, loadPage, loadSalesRanking, filtroForaDoRanking,
  ORDER_MAIS_VENDIDOS, ORDER_FALLBACK };
`);
  const box = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: mkStorage(), sessionStorage: mkStorage(),
    fetch: fetchImpl,
    // querySelector devolve elemento: loadPage escreve o 'Carregando...' no host, e um
    // null aqui mataria o teste antes de exercitar o laço que ele existe pra medir.
    document: { readyState: 'complete', getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(), head: mkEl(), addEventListener() {}, querySelector: () => mkEl(), querySelectorAll: () => [] },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    history: { replaceState() {} },
    scrollTo() {}, requestAnimationFrame(fn) { try { fn(); } catch (_) {} return 0; },
  };
  box.window = box; box.globalThis = box;
  box.location = { href: 'https://app.marketfacil.com.br/seletor', search: '', pathname: '/seletor' };
  box.window.location = box.location;
  vm.createContext(box);
  vm.runInContext(patched, box, { filename: 'ad-selector.js' });
  return box.__internos;
}

const tokenOk = { ok: true, status: 200, json: async () => ({ response: { access_token: 'T' } }) };

(async () => {
  console.log('ranking-sem-loop.test.js');

  // ── conta sem nenhuma venda: o ranking volta vazio ─────────────────────────
  console.log('\n== conta sem venda registrada não trava a tela ==');
  {
    let chamadasRanking = 0, chamadasLista = 0;
    const I = carregar(async (url) => {
      const u = String(url);
      if (u.includes('getAccessToken2')) return tokenOk;
      if (u.includes('/api/sales-ranking')) {
        chamadasRanking++;
        if (chamadasRanking > TETO) throw new Error('LAÇO: /api/sales-ranking chamado ' + chamadasRanking + 'x');
        return { ok: true, status: 200, json: async () => ({ complete: true, ranking: [] }) };
      }
      if (u.includes('/api/fetch-ads')) {
        chamadasLista++;
        if (chamadasLista > TETO) throw new Error('LAÇO: /api/fetch-ads chamado ' + chamadasLista + 'x');
        return { ok: true, status: 200, json: async () => ({ results: [], paging: { total: 0 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    I.state.sellerId = '1267924722';

    let terminou = false, erro = null;
    try { await I.loadPage(); terminou = true; } catch (e) { erro = e; }

    check('loadPage TERMINA (não recursa pra sempre)', terminou, erro && erro.message);
    check('o ranking vazio não é repedido em laço', chamadasRanking <= 2, String(chamadasRanking));
    check('e a lista comum é carregada como plano B', chamadasLista >= 1, String(chamadasLista));
    check('o vendedor é avisado de que a ordem mudou',
      !!I.state.ordemDegradada && /venda/i.test(I.state.ordemDegradada), String(I.state.ordemDegradada));
    check('sem prender a ordem antiga na URL: state.order não muda',
      I.state.order === I.ORDER_MAIS_VENDIDOS, I.state.order);
  }

  // ── rota fora do ar: 404 (front na frente do servidor) ─────────────────────
  console.log('\n== rota de ranking fora do ar não vira tempestade de chamadas ==');
  {
    let chamadasRanking = 0, chamadasLista = 0;
    const I = carregar(async (url) => {
      const u = String(url);
      if (u.includes('getAccessToken2')) return tokenOk;
      if (u.includes('/api/sales-ranking')) {
        chamadasRanking++;
        if (chamadasRanking > TETO) throw new Error('LAÇO: /api/sales-ranking chamado ' + chamadasRanking + 'x');
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
      }
      if (u.includes('/api/fetch-ads')) {
        chamadasLista++;
        if (chamadasLista > TETO) throw new Error('LAÇO: /api/fetch-ads chamado ' + chamadasLista + 'x');
        return { ok: true, status: 200, json: async () => ({ results: [], paging: { total: 0 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    I.state.sellerId = '1267924722';

    let terminou = false, erro = null;
    try { await I.loadPage(); terminou = true; } catch (e) { erro = e; }

    check('loadPage TERMINA com a rota em 404', terminou, erro && erro.message);
    check('não martela /api/sales-ranking', chamadasRanking <= 2, String(chamadasRanking));
    check('cai na lista comum', chamadasLista >= 1, String(chamadasLista));
    check('e diz o porquê', !!I.state.ordemDegradada, String(I.state.ordemDegradada));
  }

  // ── uma vez degradado, seguir paginando não volta a tentar o ranking ───────
  console.log('\n== paginar depois da degradação não reabre a tentativa ==');
  {
    let chamadasRanking = 0;
    const I = carregar(async (url) => {
      const u = String(url);
      if (u.includes('getAccessToken2')) return tokenOk;
      if (u.includes('/api/sales-ranking')) {
        chamadasRanking++;
        if (chamadasRanking > TETO) throw new Error('LAÇO: ranking ' + chamadasRanking + 'x');
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ results: [], paging: { total: 0 } }) };
    });
    I.state.sellerId = '1267924722';

    await I.loadPage();
    const depoisDaPrimeira = chamadasRanking;
    await I.loadPage();
    await I.loadPage();
    check('a rota quebrada não é reconsultada a cada página',
      chamadasRanking === depoisDaPrimeira, `1ª: ${depoisDaPrimeira} | depois de 3 páginas: ${chamadasRanking}`);
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
