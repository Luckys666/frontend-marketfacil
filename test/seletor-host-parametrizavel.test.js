'use strict';
/*
 * O Seletor passa a rodar em duas casas: a Análise de Anúncios (como hoje) e o Agente de
 * Palavras-Chave (novo). A obrigação desta suíte é provar que a casa antiga não sentiu:
 * sem window.MFSEL_HOST, tudo resolve exatamente para o que resolvia antes.
 *
 * Rodar: node test/seletor-host-parametrizavel.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('seletor-host-parametrizavel.test.js');

const mkEl = () => ({
  innerHTML: '', textContent: '', value: '', hidden: false, style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, removeEventListener() {}, appendChild() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, getAttribute() { return null; }, closest() { return null; },
  focus() {}, click() {}, remove() {},
});

function mkSandbox(hostConfig) {
  const documentStub = {
    readyState: 'complete', getElementById: () => mkEl(), createElement: () => mkEl(),
    body: mkEl(), head: mkEl(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  };
  const box = {
    console, JSON, Object, Array, Math, RegExp, Set, Map, Date, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURIComponent, decodeURIComponent,
    URLSearchParams, setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    document: documentStub, navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    history: { replaceState() {} }, scrollTo() {}, requestAnimationFrame(fn) { try { fn(); } catch (_) {} return 0; },
  };
  box.window = box; box.globalThis = box;
  box.location = { href: 'https://app.marketfacil.com.br/x', search: '', pathname: '/x' };
  box.window.location = box.location;
  if (hostConfig) box.MFSEL_HOST = hostConfig;
  box.chamadasLegado = 0;
  box.handleAnalysisClick = function () { box.chamadasLegado++; };
  return box;
}

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ad-selector.js'), 'utf8');
check('ad-selector ainda termina em boot() (o teste depende disso)', /\nboot\(\);\n/.test(src));

function carregar(hostConfig) {
  const patched = src.replace(/\nboot\(\);\n/, '\nwindow.__internos = { HOST, chipsDoPainel };\n');
  const box = mkSandbox(hostConfig);
  vm.createContext(box);
  vm.runInContext(patched, box, { filename: 'ad-selector.js' });
  return box;
}

console.log('\n== sem MFSEL_HOST: a Análise segue exatamente como era ==');
{
  const box = carregar(null);
  const HOST = box.__internos.HOST;
  check('raiz default é .ana-wrapper', HOST.root === '.ana-wrapper', String(HOST.root));
  check('resultsId default é resultsContainer', HOST.resultsId === 'resultsContainer', String(HOST.resultsId));
  check('onSelect default existe', typeof HOST.onSelect === 'function');
  HOST.onSelect('MLB123');
  check('onSelect default chama handleAnalysisClick', box.chamadasLegado === 1, String(box.chamadasLegado));
}

console.log('\n== com MFSEL_HOST: o Agente manda ==');
{
  let recebido = null;
  const box = carregar({ root: '.kw-wrapper', resultsId: null, onSelect: (id) => { recebido = id; } });
  const HOST = box.__internos.HOST;
  check('raiz do Agente', HOST.root === '.kw-wrapper', String(HOST.root));
  check('sem container de resultado', HOST.resultsId === null);
  HOST.onSelect('MLB999');
  check('onSelect do Agente recebe o id', recebido === 'MLB999', String(recebido));
  check('e o legado NÃO foi chamado', box.chamadasLegado === 0, String(box.chamadasLegado));
}

console.log('\n== nenhum literal solto sobrou no código ==');
{
  // O literal PODE existir em dois lugares: na linha que define o default do HOST
  // (`root:` / `resultsId:`) e em quem lê o HOST. Em qualquer outro lugar ele é um
  // resquício de DOM chumbado — e o Agente quebraria calado nesse ponto.
  const corpo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const linhaDeDefault = (l, chave) => new RegExp('^\\s*' + chave + ':\\s').test(l);
  const solto = (literal, chave, leitor) => corpo.split('\n').filter((l) =>
    l.includes(literal) && !linhaDeDefault(l, chave) && !l.includes('MFSEL_HOST') && !l.includes(leitor));
  const a = solto("'.ana-wrapper'", 'root', 'HOST.root');
  check("'.ana-wrapper' só aparece na definição do default", a.length === 0, a.join(' / '));
  const b = solto("'resultsContainer'", 'resultsId', 'HOST.resultsId');
  check("'resultsContainer' só aparece na definição do default", b.length === 0, b.join(' / '));
  // E o acesso ao container passa a ser sempre pelo helper, que devolve null no Agente.
  check('ninguém mais chama getElementById direto pro container do host',
    !/getElementById\(['"]resultsContainer['"]\)/.test(corpo));
}

// O resumo e os filtros também são do painel, não fixos: quem entrou pra melhorar ficha
// não é ajudado por "Pausados sem estoque" nem por "Frete grátis abaixo de R$ 79" (Lucas,
// 31/08). Sem MFSEL_HOST nada muda — a Análise continua com tudo.
console.log('\n== chips e filtros de preço são do painel ==');
{
  const todos = carregar(null).__internos.chipsDoPainel().map((c) => c.id);
  check('sem host, TODOS os chips continuam (a Análise não sente nada)',
    todos.length >= 8 && todos.includes('paused_no_stock'), todos.join(','));
  check('e os filtros de preço ficam ligados', carregar(null).__internos.HOST.filtrosDePreco !== false);
}
{
  const box = carregar({ chips: ['incomplete_specs', 'missing_gtin'], filtrosDePreco: false });
  const escolhidos = box.__internos.chipsDoPainel().map((c) => c.id);
  check('com host, só os chips pedidos aparecem', escolhidos.join() === 'incomplete_specs,missing_gtin', escolhidos.join());
  check('na ordem em que o host pediu', escolhidos[0] === 'incomplete_specs');
  check('e os filtros de preço saem', box.__internos.HOST.filtrosDePreco === false);
  check('os de operação ficam de fora',
    !escolhidos.includes('paused_no_stock') && !escolhidos.includes('few_available'), escolhidos.join());
}
{
  // id que não existe não pode virar um chip fantasma na tela
  const r = carregar({ chips: ['nao_existe', 'incomplete_specs'] }).__internos.chipsDoPainel().map((c) => c.id);
  check('id desconhecido é ignorado em silêncio', r.join() === 'incomplete_specs', r.join());
}
{
  // Com os chips restritos, "nenhum problema nos seus anúncios" seria falso: a conta pode
  // ter 101 pausados sem estoque e a tela só ter olhado ficha (visto em conta real, 31/08).
  const padrao = carregar(null).__internos.HOST.textoSemProblemas;
  check('sem host, a mensagem de tudo certo é a de sempre', /Nenhum problema encontrado/.test(padrao), padrao);
  const proprio = carregar({ chips: ['incomplete_specs'], textoSemProblemas: 'Nenhuma ficha incompleta 🎉' }).__internos.HOST.textoSemProblemas;
  check('o painel pode dizer o que ELE conferiu', proprio === 'Nenhuma ficha incompleta 🎉', proprio);
}

console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
