'use strict';
/*
 * Sinal de termo repetido no título.
 *
 * Caso real da conta: "Sapatilha … Estilo Melissa Rosa **Rosa** 36" — o family_name já
 * termina em "Rosa" e a ML acrescenta o nome da variação, que também é "Rosa". Mesmo
 * mecanismo do "Kit Jogo 3 Panelas … Vaquinha **Vaquinha**".
 *
 * ⚠️ É DIAGNÓSTICO, SEM BOTÃO (decisão de 09/08/2026): as duas correções possíveis —
 * mexer no family_name ou no nome da variação — resetam o anúncio pelo mecanismo do
 * permalink, medido em conta real em 10/08. O sinal aponta e diz o preço; quem decide
 * é o vendedor.
 *
 * O recorte por valor de variação existe por causa de um falso positivo real:
 * "Kit Máscara Cílios 4d + Máscara Cílios Incolor" repete "Máscara" e "Cílios" DE
 * PROPÓSITO — é um kit de dois produtos.
 *
 * Rodar: node test/titulo-repetido.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get, reg, sandbox } = carregar();
const MF_termosRepetidosNoTitulo = get('MF_termosRepetidosNoTitulo');
const MF_valoresDaVariacao = get('MF_valoresDaVariacao');
const exibirTitulo = get('exibirTitulo');

console.log('titulo-repetido.test.js');

// ── os casos reais ──────────────────────────────────────────────────────
console.log('\n== casos reais da conta ==');
{
  const r1 = MF_termosRepetidosNoTitulo('Sapatilha Confortável E Super Leve Estilo Melissa Rosa Rosa 36', ['Rosa', '36']);
  check('pega "Rosa" repetido', r1.length === 1 && r1[0].termo === 'Rosa' && r1[0].vezes === 2, JSON.stringify(r1));

  const r2 = MF_termosRepetidosNoTitulo('Kit Jogo 3 Panelas Antiaderente Vaquinha Vaquinha', ['Vaquinha']);
  check('pega "Vaquinha" repetido', r2.length === 1 && r2[0].termo === 'Vaquinha', JSON.stringify(r2));
}

// ── o falso positivo que motivou o recorte ──────────────────────────────
console.log('\n== kit de dois produtos não é erro de título ==');
{
  const titulo = 'Kit Máscara Cílios 4d 9,5g + Máscara Cílios Incolor 12g';
  const semRecorte = MF_termosRepetidosNoTitulo(titulo);
  check('sem recorte, acusaria Máscara e Cílios', semRecorte.length >= 2, JSON.stringify(semRecorte));

  const comRecorte = MF_termosRepetidosNoTitulo(titulo, ['Preto']);
  check('com recorte por variação, não acusa nada', comRecorte.length === 0, JSON.stringify(comRecorte));
}

// ── palavras curtas não contam ──────────────────────────────────────────
console.log('\n== conectores repetem por gramática ==');
{
  const r = MF_termosRepetidosNoTitulo('Kit 2 Sapatilhas Zaxy Link Macia E Flexível Preto E Rosa 36', ['Preto e Rosa', '36']);
  check('"E" repetido não vira sinal', !r.some(x => x.termo.toLowerCase() === 'e'), JSON.stringify(r));
}

// ── acento e caixa ──────────────────────────────────────────────────────
console.log('\n== a mesma palavra escrita diferente ==');
{
  const r = MF_termosRepetidosNoTitulo('Capa Pelúcia Decorativa Pelo Alto Pelucia Branca', ['Pelúcia']);
  check('"Pelúcia" e "Pelucia" contam como a mesma', r.length === 1, JSON.stringify(r));
}

// ── entradas vazias ─────────────────────────────────────────────────────
console.log('\n== nada pra dizer, não diz ==');
{
  check('título vazio → []', MF_termosRepetidosNoTitulo('', ['Rosa']).length === 0);
  check('título null → []', MF_termosRepetidosNoTitulo(null, ['Rosa']).length === 0);
  check('sem repetição → []', MF_termosRepetidosNoTitulo('Shampoo Shine Blue Coconut 300ml', ['Coconut']).length === 0);
  check('variação vazia não filtra nada (comportamento genérico)',
    MF_termosRepetidosNoTitulo('Rosa Rosa Bonita', []).length === 1);
}

// ── de onde saem os termos da variação ──────────────────────────────────
console.log('\n== MF_valoresDaVariacao ==');
{
  const cats = [{ id: 'COLOR', hierarchy: 'CHILD_PK' }, { id: 'BRAND', hierarchy: 'PARENT_PK' }];
  const detail = {
    attributes: [{ id: 'COLOR', value_name: 'Rosa' }, { id: 'BRAND', value_name: 'Grendene' }]
  };
  const v = MF_valoresDaVariacao(detail, cats);
  check('pega CHILD_PK', v.includes('Rosa'), JSON.stringify(v));
  check('ignora PARENT_PK', !v.includes('Grendene'), JSON.stringify(v));

  const comCombin = { attribute_combinations: [{ value_name: 'Azul' }], attributes: [] };
  check('pega attribute_combinations (variação do modelo antigo)',
    MF_valoresDaVariacao(comCombin, cats).includes('Azul'));
  check('sem nada não quebra', MF_valoresDaVariacao(null, null).length === 0);
}

// ── na tela: aponta, não manda corrigir ─────────────────────────────────
console.log('\n== o aviso aparece e NÃO oferece correção ==');
{
  sandbox.window.currentAnalysisState = { categoryAttributes: [{ id: 'COLOR', hierarchy: 'CHILD_PK' }] };
  const detail = {
    id: 'MLB6695198754',
    title: 'Sapatilha Confortável E Super Leve Estilo Melissa Rosa Rosa 36',
    attributes: [{ id: 'COLOR', value_name: 'Rosa' }],
    pictures: [{ secure_url: 'x' }],
    permalink: 'https://produto.mercadolivre.com.br/MLB-6695198754-x-_JM',
    status: 'paused'
  };
  exibirTitulo(detail.title, false, 'tituloTexto', detail);
  const html = reg['tituloTexto'].innerHTML;
  check('cita o termo repetido', html.includes('Rosa') && html.includes('duas vezes'), html.slice(0, 300));
  check('avisa que arrumar custa a exposição', html.includes('perde a exposição'), '');
  // O ponto da decisão de 09/08: nada de botão, link de edição ou onclick de correção aqui.
  const trecho = html.substring(html.indexOf('duas vezes') - 600, html.indexOf('duas vezes') + 600);
  check('não tem botão de corrigir no aviso', !/<button|openAttrEditor|mfRenomeia/i.test(trecho), trecho.slice(0, 200));

  // Título sem repetição não deve renderizar a faixa
  const detail2 = { id: 'MLB1', title: 'Shampoo Shine Blue Coconut 300ml', attributes: [{ id: 'COLOR', value_name: 'Coconut' }], status: 'active' };
  exibirTitulo(detail2.title, false, 'tituloTexto2', detail2);
  check('sem repetição, nenhuma faixa', !reg['tituloTexto2'].innerHTML.includes('duas vezes'));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
