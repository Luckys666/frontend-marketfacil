'use strict';
/*
 * A escrita. Três travas que não podem cair:
 *   1. campo bloqueado NÃO VIRA REQUISIÇÃO (a recusa do proxy é rede, não proteção);
 *   2. confirm_rename_variation sai em TODO CHILD_PK — front mais estreito que servidor
 *      é recusa permanente na mão do vendedor (o erro de 10/08/2026);
 *   3. 200 com _family_task_error no corpo é ERRO, não sucesso.
 *
 * Rodar: node test/ficha-ia-aplicacao.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('ficha-ia-aplicacao.test.js');

const SOLTO = { id: 'MLB1', title: 'Panela 3 Litros', attributes: [] };
const FAMILIA = { id: 'MLB2', title: 'Sapatilha Rosa 36', user_product_id: 'MLBU1', attributes: [{ id: 'COLOR', value_name: 'Rosa' }] };
const MATERIAL = { id: 'MATERIAL', name: 'Material', value_type: 'string', tags: {} };
const FORMATO = { id: 'SHAPE', name: 'Formato', value_type: 'list', tags: {}, values: [{ id: '101', name: 'Redondo' }] };
const COR = { id: 'COLOR', name: 'Cor', value_type: 'string', hierarchy: 'CHILD_PK', tags: {} };
const MARCA_PARENT = { id: 'BRAND', name: 'Marca', value_type: 'string', hierarchy: 'PARENT_PK', tags: {} };

console.log('\n== montarAtributo ==');
{
  const { M } = carregar();
  check('texto livre manda value_name',
    JSON.stringify(M.montarAtributo({ id: 'MATERIAL', valor: 'Alumínio' }, MATERIAL)) === JSON.stringify({ id: 'MATERIAL', value_name: 'Alumínio' }));
  const daLista = M.montarAtributo({ id: 'SHAPE', valor: 'Redondo', value_id: '101' }, FORMATO);
  check('lista manda value_id junto', daLista.value_id === '101' && daLista.value_name === 'Redondo');
}

console.log('\n== campo bloqueado não vira requisição ==');
(async () => {
  {
    const { M, box } = carregar();
    const r = await M.aplicar('MLB2', [{ id: 'BRAND', valor: 'Nike' }], [MARCA_PARENT], FAMILIA, 'tok');
    check('não chamou o proxy', box.chamadas.length === 0, String(box.chamadas.length));
    check('devolve erro explicando', r.ok === false && /grupo|fam[íi]lia|Mercado Livre/i.test(r.erro), r.erro);
  }

  console.log('\n== lote ==');
  {
    const { M, box } = carregar({ resposta: { id: 'MLB1', attributes: [{ id: 'MATERIAL', value_name: 'Alumínio' }] } });
    const r = await M.aplicar('MLB1', [
      { id: 'MATERIAL', valor: 'Alumínio' },
      { id: 'SHAPE', valor: 'Redondo', value_id: '101' },
    ], [MATERIAL, FORMATO], SOLTO, 'tok');
    check('um PUT só pro lote', box.chamadas.length === 1, String(box.chamadas.length));
    check('método é PUT', box.chamadas[0].init.method === 'PUT');
    check('token no header', box.chamadas[0].init.headers.Authorization === 'Bearer tok');
    check('token fora da URL', !box.chamadas[0].url.includes('tok'));
    const corpo = JSON.parse(box.chamadas[0].init.body);
    check('manda os dois campos', corpo.attributes.length === 2);
    check('sem confirm_rename_variation quando não precisa', !('confirm_rename_variation' in corpo));
    check('reporta quantos salvou', r.ok === true && r.salvos === 2, JSON.stringify(r));
  }

  console.log('\n== CHILD_PK: a flag sai SEMPRE ==');
  {
    const { M, box } = carregar({ resposta: { id: 'MLB2', attributes: [] } });
    await M.aplicar('MLB2', [{ id: 'COLOR', valor: 'Coral' }], [COR], FAMILIA, 'tok');
    const corpo = JSON.parse(box.chamadas[0].init.body);
    check('confirm_rename_variation: true', corpo.confirm_rename_variation === true);
  }

  console.log('\n== erro parcial: 200 no cabeçalho, recusa no corpo ==');
  {
    const { M } = carregar({ resposta: { _family_task_error: { code: 'PA_UNAUTHORIZED', message: 'PolicyAgent' } } });
    const r = await M.aplicar('MLB2', [{ id: 'MATERIAL', valor: 'Couro' }], [MATERIAL], FAMILIA, 'tok');
    check('200 com _family_task_error NÃO é sucesso', r.ok === false, JSON.stringify(r));
    check('e a mensagem manda pro lugar certo', /Mercado Livre/i.test(r.erro), r.erro);
  }
  {
    const { M } = carregar({ resposta: { _item_put_error: { cause: [{ code: 'invalid_length', message: 'too long' }] } } });
    const r = await M.aplicar('MLB1', [{ id: 'MATERIAL', valor: 'x' }], [MATERIAL], SOLTO, 'tok');
    check('_item_put_error também barra', r.ok === false);
  }

  console.log('\n== erro do ML vira português ==');
  {
    const { M } = carregar();
    check('value_not_in_allowed_values',
      /escolha uma das opções da lista/i.test(M.traduzirErro({ cause: [{ code: 'value_not_in_allowed_values' }] }, MATERIAL)));
    check('required',
      /exige|obrigat/i.test(M.traduzirErro({ cause: [{ code: 'item.attributes.required' }] }, MATERIAL)));
    check('conflito de variação vira explicação, não código',
      /varia/i.test(M.traduzirErro({ cause: [{ message: 'Same attributes are used in more than one' }] }, COR)));
    check('recusa do proxy usa o texto pronto dele',
      M.traduzirErro({ code: 'child_pk_would_split_family', error: 'Esse campo tiraria o anúncio do grupo.' }, COR) === 'Esse campo tiraria o anúncio do grupo.');
    check('nunca mostra "atributo" pro vendedor',
      !/atributo/i.test(M.traduzirErro({ cause: [{ code: 'invalid_value', message: 'atributo inválido' }] }, MATERIAL)));
  }

  console.log('\n== um campo, um valor: as duas listas não podem brigar ==');
  {
    const { M, box } = carregar({ resposta: { id: 'MLB1', attributes: [] } });
    // A lista 1 propõe "Aço inox"; a lista de palavras novas propõe "Aço inox escovado" pro
    // MESMO campo. Mandar os dois no PUT faz a ML gravar um e descartar o outro sem ninguém
    // saber qual — e o vendedor vê um valor que ele não escolheu.
    const r = await M.aplicar('MLB1', [
      { id: 'MATERIAL', valor: 'Aço inox' },
      { id: 'MATERIAL', valor: 'Aço inox escovado' },
    ], [MATERIAL], SOLTO, 'tok');
    const corpo = JSON.parse(box.chamadas[0].init.body);
    check('vai um atributo só', corpo.attributes.length === 1, JSON.stringify(corpo.attributes));
    check('e vence o último marcado', corpo.attributes[0].value_name === 'Aço inox escovado', corpo.attributes[0].value_name);
    check('o salvo reportado bate com o enviado', r.salvos === 1, String(r.salvos));
  }

  console.log('\n== falha de rede ==');
  {
    const { M } = carregar({ falhar: true });
    const r = await M.aplicar('MLB1', [{ id: 'MATERIAL', valor: 'Alumínio' }], [MATERIAL], SOLTO, 'tok');
    check('não finge que salvou', r.ok === false);
    check('e não diz que salvou zero como se fosse resultado', !/nenhum campo/i.test(r.erro || ''));
  }

  console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
