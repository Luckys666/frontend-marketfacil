'use strict';
/*
 * O mini-DOM é infra de teste. Se ele mente, todo teste que depende dele mente junto —
 * que foi exatamente o que aconteceu com o harness de stubs (querySelector devolvendo
 * sempre null passava por "não achou" em vez de "seletor errado").
 *
 * Rodar: node test/mini-dom.test.js
 */
const { criarDocumento, parseFragmento, casa } = require('./mini-dom');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('mini-dom.test.js');

console.log('\n== parsing ==');
{
  const doc = criarDocumento();
  const box = doc.getElementById('caixa');
  box.innerHTML = '<div class="linha" data-campo="MATERIAL"><span class="nome">Material</span>'
    + '<input type="text" class="valor" data-campo="MATERIAL" value="A&ccedil;o inox" />'
    + '<button class="aplicar" data-campo="MATERIAL">Aplicar</button></div>';
  check('achou a linha', !!box.querySelector('.linha'));
  check('input é filho da linha', box.querySelector('.linha').querySelector('.valor') !== null);
  check('input não engole os irmãos (tag vazia)', box.querySelector('.linha').children.length === 3,
    String(box.querySelector('.linha').children.length));
  check('atributo lido', box.querySelector('.valor').getAttribute('data-campo') === 'MATERIAL');
  check('dataset em camelCase', box.querySelector('.linha').dataset.campo === 'MATERIAL');
  check('textContent junta os filhos', box.textContent.includes('Material'));
}
{
  const [n] = parseFragmento('<input class="v" value="aspas &quot;duplas&quot; e &amp;" />');
  check('entidades decodificadas no atributo', n.value === 'aspas "duplas" e &', n.value);
}
{
  const filhos = parseFragmento('<div class="a"></div><div class="b"></div>');
  check('fragmento com dois irmãos na raiz', filhos.length === 2, String(filhos.length));
}

console.log('\n== seletores ==');
{
  const doc = criarDocumento();
  const box = doc.getElementById('c');
  box.innerHTML = '<input class="fia-check" data-campo="A" checked />'
    + '<input class="fia-check fia-check-nova" data-campo="A" data-nova="1" />'
    + '<input class="fia-valor" data-campo="A" value="um" />'
    + '<input class="fia-valor" data-campo="A" data-nova="1" value="dois" />';
  check('.classe', box.querySelectorAll('.fia-check').length === 2, String(box.querySelectorAll('.fia-check').length));
  check(':not(.classe)', box.querySelectorAll('.fia-check:not(.fia-check-nova)').length === 1);
  check('[attr="v"]', box.querySelectorAll('[data-nova="1"]').length === 2);
  check('composto .a[attr]', box.querySelectorAll('.fia-valor[data-nova="1"]').length === 1);
  check(':not([attr]) exclui quem tem o atributo',
    box.querySelector('.fia-valor:not([data-nova])').value === 'um',
    box.querySelector('.fia-valor:not([data-nova])').value);
  check('checked vem do atributo', box.querySelector('.fia-check').checked === true);
  check('sem checked é false', box.querySelectorAll('.fia-check')[1].checked === false);
  let lancou = false;
  try { box.querySelector('.a > .b'); } catch (e) { lancou = true; }
  check('combinador NÃO suportado (>) LANÇA em vez de mentir "não achei"', lancou);
  // vírgula é OU, como no CSS — e é assim que o painel junta os dois tipos de checkbox
  check('lista de seletores (".a, .b") pega os dois',
    box.querySelectorAll('.fia-check, .fia-valor').length === 4,
    String(box.querySelectorAll('.fia-check, .fia-valor').length));
}

console.log('\n== descendente: ".bloco .item" ==');
{
  const doc = criarDocumento();
  const box = doc.getElementById('desc');
  box.innerHTML = '<div class="bloco a"><span class="item">1</span><span class="item">2</span></div>'
    + '<div class="bloco b"><span class="item">3</span></div>';
  check('pega só os de dentro do bloco pedido', box.querySelectorAll('.a .item').length === 2,
    String(box.querySelectorAll('.a .item').length));
  check('e o outro bloco tem o seu', box.querySelectorAll('.b .item').length === 1);
  check('sem prefixo, pega todos', box.querySelectorAll('.item').length === 3);
  check('na ordem do documento', box.querySelectorAll('.item')[0].textContent === '1');
}

console.log('\n== closest ==');
{
  const doc = criarDocumento();
  const box = doc.getElementById('d');
  box.innerHTML = '<div class="linha" data-campo="A"><div class="topo"><button class="btn">x</button></div>'
    + '<input class="valor" value="certo" /></div>'
    + '<div class="linha" data-campo="A"><input class="valor" value="errado" /></div>';
  const btn = box.querySelector('.btn');
  check('closest sobe até a linha', btn.closest('.linha') !== null);
  check('closest acha a linha CERTA (a primeira, que contém o botão)',
    btn.closest('.linha').querySelector('.valor').value === 'certo',
    btn.closest('.linha').querySelector('.valor').value);
  check('closest casa o próprio elemento', btn.closest('.btn') === btn);
  check('closest sem match devolve null', btn.closest('.inexistente') === null);
}

console.log('\n== eventos sobem (delegação) ==');
{
  const doc = criarDocumento();
  const box = doc.getElementById('e');
  box.innerHTML = '<div class="linha"><button class="btn">x</button></div>';
  let alvoVisto = null;
  box.addEventListener('click', (ev) => { alvoVisto = ev.target; });
  const btn = box.querySelector('.btn');
  btn.click();
  check('o clique no botão chega no container', alvoVisto === btn);
}
console.log('\n== o clique chega ao DOCUMENT (delegação global) ==');
{
  const doc = criarDocumento();
  const box = doc.getElementById('g');
  box.innerHTML = '<button id="voltar">Voltar</button>';
  let vistos = 0;
  doc.addEventListener('click', (ev) => { if (ev.target.closest('#voltar')) vistos++; });
  box.querySelector('#voltar').click();
  check('handler no document recebe o clique', vistos === 1, String(vistos));
  box.querySelector('#voltar').click();
  check('e continua recebendo', vistos === 2, String(vistos));
}

(async () => {
  const doc = criarDocumento();
  const box = doc.getElementById('f');
  box.innerHTML = '<button class="btn">x</button>';
  const ordem = [];
  box.addEventListener('click', async () => { ordem.push('inicio'); await null; ordem.push('fim'); });
  const p = box.querySelector('.btn').click();
  check('click devolve promise dos handlers async', !!p && typeof p.then === 'function');
  await p;
  check('dá pra esperar o handler async terminar', ordem.join(',') === 'inicio,fim', ordem.join(','));

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
