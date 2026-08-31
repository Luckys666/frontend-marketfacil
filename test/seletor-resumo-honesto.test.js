'use strict';
/*
 * O resumo do topo contradizia a lista logo abaixo.
 *
 * Visto em conta real (31/08/2026): "Nenhum anúncio seu está com ficha incompleta 🎉" em
 * cima e "Ficha incompleta em 2 variações" duas linhas depois. Os dois números vêm da ML e
 * os dois estão certos — medem coisas diferentes: o chip conta ANÚNCIO com o label
 * `incomplete_technical_specs`; o sinal da linha conta VARIAÇÃO com
 * `adoption_status.ft.missing_attributes`. Certos separados, mentem juntos.
 *
 * A correção não é escolher um número: é a mensagem verde parar de afirmar mais do que ela
 * sabe, e dizer o que o pente-fino achou quando achou algo. E vale SÓ onde o host pedir —
 * a Análise de Anúncios está LIVE e não pode sentir nada disto.
 *
 * Rodar: node test/seletor-resumo-honesto.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarDocumento } = require('./mini-dom');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('seletor-resumo-honesto.test.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ad-selector.js'), 'utf8');

function carregar(hostConfig) {
  const doc = criarDocumento();
  doc.getElementById('chipsArea').setAttribute('id', 'chipsArea');
  const box = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    document: doc, navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    history: { replaceState() {} }, scrollTo() {}, requestAnimationFrame(fn) { try { fn(); } catch (_) {} return 0; },
  };
  box.window = box; box.globalThis = box;
  box.location = { href: 'https://app.marketfacil.com.br/x', search: '', pathname: '/x' };
  box.window.location = box.location;
  if (hostConfig) box.MFSEL_HOST = hostConfig;
  box.handleAnalysisClick = function () {};
  const patched = src.replace(/\nboot\(\);\n/, '\nwindow.__internos = { HOST, renderChips, state };\n');
  vm.createContext(box);
  vm.runInContext(patched, box, { filename: 'ad-selector.js' });
  return { box, doc, area: () => doc.getElementById('chipsArea') };
}

const HOST_FICHA = {
  root: '.kw-wrapper', resultsId: null, onSelect() {},
  chips: ['incomplete_specs', 'missing_gtin'],
  textoSemProblemas: 'O Mercado Livre não está sinalizando ficha incompleta na sua conta.',
  avisarFichaConferida: true,
};

console.log('\n== a Análise de Anúncios (LIVE) não sente nada ==');
{
  const { box, area } = carregar(null);
  box.__internos.state.fichaMap = { MLB1: { missing: ['BRAND'] }, MLB2: { missing: [] } };
  box.__internos.renderChips({});
  const txt = area().textContent;
  check('sem host, a mensagem é a de sempre', /Nenhum problema encontrado/.test(txt), txt);
  check('e não aparece ressalva nenhuma', !/conferindo|pente/i.test(txt), txt);
}

console.log('\n== no painel da ficha, o verde não contradiz mais a lista ==');
{
  const { box, area } = carregar(HOST_FICHA);
  // A ML não sinaliza nada (todos os chips em zero), mas o pente-fino da própria tela
  // achou duas variações com campo faltando.
  box.__internos.state.fichaMap = {
    MLB1: { missing: ['BRAND', 'MODEL'] },
    MLB2: { missing: ['COLOR'] },
    MLB3: { missing: [] },
  };
  box.__internos.renderChips({ label_incomplete_technical_specs: 0, missing_product_identifiers: 0 });
  const txt = area().textContent;
  check('a mensagem verde continua', /não está sinalizando/i.test(txt), txt);
  check('mas a tela conta o que ELA achou', /2 varia/i.test(txt), txt);
  check('e diz que os dois números medem coisas diferentes',
    /confer|olhando campo a campo|pente/i.test(txt), txt);
}
{
  const { box, area } = carregar(HOST_FICHA);
  box.__internos.state.fichaMap = { MLB1: { missing: [] }, MLB2: { missing: [] } };
  box.__internos.renderChips({ label_incomplete_technical_specs: 0 });
  const txt = area().textContent;
  check('quando o pente-fino também não acha nada, a tela não inventa ressalva',
    !/varia/i.test(txt), txt);
}
{
  const { box, area } = carregar(HOST_FICHA);
  // Sem a camada de ficha carregada (ela falha calada em conta grande), não há o que
  // ressalvar — e afirmar "nenhuma" seria a mesma mentira de antes, do outro lado.
  box.__internos.state.fichaMap = {};
  box.__internos.renderChips({ label_incomplete_technical_specs: 0 });
  const txt = area().textContent;
  check('sem o pente-fino carregado, nada de número inventado', !/varia/i.test(txt), txt);
}
{
  const { box, area } = carregar(HOST_FICHA);
  box.__internos.state.fichaMap = { MLB1: { missing: ['BRAND'] } };
  box.__internos.renderChips({ label_incomplete_technical_specs: 3 });
  const txt = area().textContent;
  check('com chip aparecendo, a ressalva não rouba a cena', !/2 varia/i.test(txt), txt);
  check('e o chip do Mercado Livre continua lá', /Ficha técnica incompleta/i.test(txt), txt);
}
{
  const { box, area } = carregar(HOST_FICHA);
  box.__internos.state.fichaMap = { MLB1: { missing: ['BRAND'] } };
  box.__internos.renderChips({ label_incomplete_technical_specs: 0 });
  const txt = area().textContent;
  check('uma variação só não vira "1 variações"', /1 varia[çc][ãa]o\b/i.test(txt) && !/1 varia[çc][õo]es/i.test(txt), txt);
}

console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
