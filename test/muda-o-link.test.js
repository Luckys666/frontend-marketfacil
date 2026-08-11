'use strict';
/*
 * mfMudaOLink — quais campos de variação MUDAM o link do anúncio.
 *
 * Base empírica (conta real, 10/08/2026, medido com reversão):
 *   MLB6695198754 "Sapatilha … Melissa Rosa Rosa 36", COLOR "Rosa"→"Coral"
 *     → título mudou e permalink mudou NO MESMO INSTANTE, e seguiu mudado por 30 min:
 *       …-melissa-rosa-rosa-36-_JM  →  …-melissa-rosa-coral-36-_JM
 *   MLB2177029901 "Finalizador … Lakkoa 40ml", UNITS_PER_PACKAGE "1"→"2"
 *     → título e permalink INTACTOS em todas as leituras (+0/+2/+5/+10/+20/+30 min)
 *
 * Na mesma conta: 137 CHILD_PK com o valor no título, 467 sem. O alerta antigo disparava
 * nos 604 — ensinar o vendedor a ignorar vermelho é o mesmo que não ter vermelho.
 *
 * ⚠️ A separação que estes testes protegem: mfMudaOLink governa o ALERTA;
 * mfRenomeiaVariacao (todo CHILD_PK preenchido) governa a flag confirm_rename_variation
 * mandada ao proxy. Estreitar a flag junto com o alerta faria o proxy recusar e o vendedor
 * clicar em loop — foi exatamente o incidente de 10/08.
 *
 * Rodar: node test/muda-o-link.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get } = carregar();
const mfMudaOLink = get('mfMudaOLink');
const mfRenomeiaVariacao = get('mfRenomeiaVariacao');
const MF_chaveTexto = get('MF_chaveTexto');

console.log('muda-o-link.test.js');

const COR = { id: 'COLOR', name: 'Cor', value_type: 'list', hierarchy: 'CHILD_PK', tags: {} };
const UNIDADES = { id: 'UNITS_PER_PACKAGE', name: 'Unidades por embalagem', value_type: 'number', hierarchy: 'CHILD_PK', tags: {} };
const TAMANHO = { id: 'SIZE', name: 'Tamanho', value_type: 'string', hierarchy: 'CHILD_PK', tags: {} };
const MARCA = { id: 'BRAND', name: 'Marca', value_type: 'string', hierarchy: 'PARENT_PK', tags: {} };
const SKU = { id: 'SELLER_SKU', name: 'SKU', value_type: 'string', hierarchy: 'ITEM', tags: {} };

// ── os dois casos medidos em conta real ─────────────────────────────────
console.log('\n== os dois anúncios que eu medi ==');
{
  const sapatilha = {
    id: 'MLB6695198754', user_product_id: 'MLBU3939487550', family_id: '2876035301934736',
    title: 'Sapatilha Confortável E Super Leve Estilo Melissa Rosa Rosa 36',
    attributes: [{ id: 'COLOR', value_id: '51994', value_name: 'Rosa' }, { id: 'SIZE', value_name: '36' }]
  };
  check('COLOR="Rosa" no título → avisa (permalink mudou de verdade)',
    mfMudaOLink(COR, sapatilha) === true);
  check('SIZE="36" também aparece no título → avisa',
    mfMudaOLink(TAMANHO, sapatilha) === true);

  const finalizador = {
    id: 'MLB2177029901', user_product_id: 'MLBU1323416506', family_id: '7804092687379346',
    title: 'Finalizador Reconstrução Ultra Repair Serum Lakkoa 40ml',
    attributes: [{ id: 'UNITS_PER_PACKAGE', value_name: '1' }]
  };
  check('UNITS_PER_PACKAGE="1" fora do título → NÃO avisa (permalink não mudou)',
    mfMudaOLink(UNIDADES, finalizador) === false);
}

// ── a separação alerta × flag do proxy ──────────────────────────────────
console.log('\n== a flag do proxy continua saindo em TODO CHILD_PK ==');
{
  const finalizador = {
    user_product_id: 'MLBU1', title: 'Finalizador Ultra Repair Serum Lakkoa 40ml',
    attributes: [{ id: 'UNITS_PER_PACKAGE', value_name: '1' }]
  };
  check('mfMudaOLink false…', mfMudaOLink(UNIDADES, finalizador) === false);
  check('…mas mfRenomeiaVariacao continua true (senão o proxy recusa e trava o vendedor)',
    mfRenomeiaVariacao(UNIDADES, finalizador) === true);
}

// ── na dúvida, avisa ────────────────────────────────────────────────────
console.log('\n== sem base pra afirmar, volta ao conservador ==');
{
  const semTitulo = { user_product_id: 'MLBU1', attributes: [{ id: 'COLOR', value_name: 'Rosa' }] };
  check('sem título → avisa', mfMudaOLink(COR, semTitulo) === true);

  const semValor = { user_product_id: 'MLBU1', title: 'Produto qualquer', attributes: [] };
  check('sem valor gravado → não é renomeação (campo vazio tem outro dano)',
    mfMudaOLink(COR, semValor) === false);

  // Valor de 1 caractere não pode ser testado por substring: o "P" casaria com o "p" de
  // "Preta". A régua vira palavra inteira.
  const pDentroDeOutraPalavra = { user_product_id: 'MLBU1', title: 'Camiseta Básica Preta', attributes: [{ id: 'SIZE', value_name: 'P' }] };
  check('"P" só dentro de "Preta" → NÃO avisa', mfMudaOLink(TAMANHO, pDentroDeOutraPalavra) === false);

  const pComoPalavra = { user_product_id: 'MLBU1', title: 'Camiseta Básica Preta P', attributes: [{ id: 'SIZE', value_name: 'P' }] };
  check('"P" como palavra do título → avisa', mfMudaOLink(TAMANHO, pComoPalavra) === true);
}

// ── o título escrito diferente do valor ─────────────────────────────────
console.log('\n== a ML escreve o valor de outro jeito no título ==');
{
  // Este é o falso negativo perigoso: comparação crua não casaria "180 mL" com "180ml"
  // e o campo passaria batido JUSTO onde ele muda o link.
  const semEspaco = {
    user_product_id: 'MLBU1', title: 'Finalizador Elixir Leave-in Lakkoa 180ml',
    attributes: [{ id: 'NET_VOLUME', value_name: '180 mL' }]
  };
  const VOLUME = { id: 'NET_VOLUME', name: 'Volume líquido', value_type: 'number_unit', hierarchy: 'CHILD_PK', tags: {} };
  check('"180 mL" casa com "180ml" no título → avisa', mfMudaOLink(VOLUME, semEspaco) === true);

  const comAcento = {
    user_product_id: 'MLBU1', title: 'Sapatilha Marrom Cafe 37',
    attributes: [{ id: 'COLOR', value_name: 'Marrom Café' }]
  };
  check('acento não atrapalha ("Marrom Café" × "Marrom Cafe")', mfMudaOLink(COR, comAcento) === true);

  const caixa = {
    user_product_id: 'MLBU1', title: 'Kit 2 Sapatilhas Zaxy Preto E Rosa 36',
    attributes: [{ id: 'COLOR', value_name: 'preto e rosa' }]
  };
  check('caixa não atrapalha ("preto e rosa" × "Preto E Rosa")', mfMudaOLink(COR, caixa) === true);
}

// ── o que nunca foi renomeação continua fora ────────────────────────────
console.log('\n== hierarquias que não são nome de variação ==');
{
  const item = {
    user_product_id: 'MLBU1', title: 'Sapatilha Grendene Rosa 36',
    attributes: [{ id: 'BRAND', value_name: 'Grendene' }, { id: 'SELLER_SKU', value_name: 'ROSA-36' }]
  };
  check('PARENT_PK (Marca) não é nome de variação, mesmo aparecendo no título',
    mfMudaOLink(MARCA, item) === false);
  check('ITEM (SKU) idem', mfMudaOLink(SKU, item) === false);

  const solto = { id: 'MLB1', title: 'Sapatilha Rosa 36', attributes: [{ id: 'COLOR', value_name: 'Rosa' }] };
  check('item fora de família: o título é do vendedor, não da ML',
    mfMudaOLink(COR, solto) === false);
}

// ── a normalização em si ────────────────────────────────────────────────
console.log('\n== MF_chaveTexto ==');
{
  check('remove acento', MF_chaveTexto('Café') === 'cafe', MF_chaveTexto('Café'));
  check('remove espaço e caixa', MF_chaveTexto('180 mL') === '180ml', MF_chaveTexto('180 mL'));
  check('remove pontuação', MF_chaveTexto('Preto/Rosa') === 'pretorosa', MF_chaveTexto('Preto/Rosa'));
  check('null vira vazio', MF_chaveTexto(null) === '');
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
