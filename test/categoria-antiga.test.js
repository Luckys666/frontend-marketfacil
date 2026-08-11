'use strict';
/*
 * Anúncio que mudou de categoria continuava mostrando campos da categoria ANTIGA
 * (Lucas, 11/08/2026, relato de usuários).
 *
 * Causa raiz medida na conta real: quando o vendedor muda a categoria de um anúncio, a ML
 * **não apaga** os atributos da categoria antiga — eles seguem gravados no item. A Ficha
 * Técnica lista `detail.attributes` (o que está no item) sem cruzar com `categoryAttributes`
 * (o que a categoria atual define), então os órfãos entram como se fossem da ficha atual.
 *
 * Caso real: MLB3084958679, "Kit Válvula De Segurança", categoria MLB455571, exibindo
 * 6 campos de MANÔMETRO — "Posição da conexão", "Tipo de preenchimento líquido",
 * "Usos recomendados"… e com um "Tipo de manômetro" gravado no item. Em 25 anúncios
 * varridos, média de 1,9 órfão; MLB3075695717 ("Removedor de Tintas") carregava OEM,
 * PART_NUMBER e VEHICLE_TYPE, de autopeça.
 *
 * Descartado na investigação: não há cache nosso de categoria (nem front nem proxy), e o
 * catalog_quality está sincronizado com o item (30 comparados, 0 divergentes).
 *
 * A escolha é MARCAR, não esconder: o valor está mesmo gravado no anúncio e só some do ML
 * quando o vendedor salva. Esconder faria o campo desaparecer sem explicação; marcar diz
 * que ele não conta mais para esta categoria.
 *
 * Rodar: node test/categoria-antiga.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get, reg, sandbox } = carregar();
const processarAtributos = get('processarAtributos');

console.log('categoria-antiga.test.js');

// Categoria ATUAL do anúncio (válvula): não tem os campos de manômetro
const catValvula = [
  { id: 'BRAND', name: 'Marca', value_type: 'string', hierarchy: 'ITEM', tags: {} },
  { id: 'MODEL', name: 'Modelo', value_type: 'string', hierarchy: 'ITEM', tags: {} },
  { id: 'WORKING_PRESSURE', name: 'Pressão de trabalho', value_type: 'string', hierarchy: 'ITEM', tags: {} },
];
// O que está GRAVADO no item: os da categoria atual + sobras da antiga (manômetro)
const attrsDoItem = [
  { id: 'BRAND', name: 'Marca', value_type: 'string', value_name: 'Wayne' },
  { id: 'WORKING_PRESSURE', name: 'Pressão de trabalho', value_type: 'string', value_name: '175 psi' },
  { id: 'PRESSURE_GAUGE_TYPE', name: 'Tipo de manômetro', value_type: 'string', value_name: 'Analógico' },
  { id: 'LIQUID_FILLER_TYPE', name: 'Tipo de preenchimento líquido', value_type: 'string', value_name: 'Seco' },
  { id: 'CONNECTION_POSITION', name: 'Posição da conexão', value_type: 'string', value_name: 'Inferior' },
];

console.log('\n== a ficha avisa que o campo não é mais desta categoria ==');
{
  sandbox.window.currentAnalysisState = { categoryAttributes: catValvula, detail: { category_id: 'MLB455571' } };
  processarAtributos(attrsDoItem, 'Kit Válvula De Segurança 175 Psi', false, 'fichaTecnicaTexto');
  const html = reg['fichaTecnicaTexto'].innerHTML;
  const txt = reg['fichaTecnicaTexto'].textContent;

  check('o campo órfão continua visível (o valor existe no anúncio)',
    txt.includes('Tipo de manômetro'), txt.slice(0, 200));
  check('mas vem marcado como fora da categoria',
    /outra categoria|n[ãa]o (é|e) desta categoria|categoria antiga/i.test(txt), txt.slice(0, 300));
  check('os três órfãos são marcados',
    (txt.match(/outra categoria/gi) || []).length >= 3, String((txt.match(/outra categoria/gi) || []).length));
  check('campo da categoria atual NÃO é marcado',
    !/Pressão de trabalho[^|]{0,40}outra categoria/i.test(txt.replace(/\s+/g, ' ')), '');
  check('e continua aparecendo normalmente', txt.includes('Pressão de trabalho'));
}

console.log('\n== sem saber a categoria, não acusa ninguém ==');
{
  // Categoria indisponível (rede falhou, MLBU, catálogo): marcar tudo como "de outra
  // categoria" seria pior que não marcar nada — chamada que falhou não vira acusação.
  sandbox.window.currentAnalysisState = { categoryAttributes: null, detail: {} };
  processarAtributos(attrsDoItem, 'Kit Válvula', false, 'fichaSemCat');
  const txt = reg['fichaSemCat'].textContent;
  check('nenhum campo marcado quando não há lista da categoria',
    !/outra categoria/i.test(txt), txt.slice(0, 200));
  check('a ficha continua mostrando os campos', txt.includes('Tipo de manômetro'));

  sandbox.window.currentAnalysisState = { categoryAttributes: [], detail: {} };
  processarAtributos(attrsDoItem, 'Kit Válvula', false, 'fichaCatVazia');
  check('lista vazia também não acusa', !/outra categoria/i.test(reg['fichaCatVazia'].textContent));
}

console.log('\n== anúncio que nunca mudou de categoria fica igual ==');
{
  sandbox.window.currentAnalysisState = { categoryAttributes: catValvula, detail: { category_id: 'MLB455571' } };
  const soDaCategoria = [
    { id: 'BRAND', name: 'Marca', value_type: 'string', value_name: 'Wayne' },
    { id: 'MODEL', name: 'Modelo', value_type: 'string', value_name: 'W-175' },
  ];
  processarAtributos(soDaCategoria, 'Kit Válvula', false, 'fichaLimpa');
  const txt = reg['fichaLimpa'].textContent;
  check('nada marcado', !/outra categoria/i.test(txt), txt.slice(0, 160));
  check('os campos aparecem', txt.includes('Marca') && txt.includes('Modelo'));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
