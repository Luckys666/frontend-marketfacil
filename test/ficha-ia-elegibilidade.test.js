'use strict';
/*
 * "O que o vendedor não puder mexer, ele não pode nem tentar" (Lucas, 07/08/2026).
 *
 * Campo bloqueado não vira sugestão, não vai pro payload da IA e não chega a virar
 * requisição. A recusa do proxy é rede de segurança, não a proteção — anúncio fora do
 * grupo de família NÃO tem volta fácil (family_id.collision).
 *
 * Rodar: node test/ficha-ia-elegibilidade.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('ficha-ia-elegibilidade.test.js');
const { M } = carregar();

const SOLTO = { id: 'MLB1', title: 'Panela de Pressão 3 Litros', attributes: [{ id: 'BRAND', value_name: 'Tramontina' }] };
const FAMILIA = { id: 'MLB2', title: 'Sapatilha Rosa 36', user_product_id: 'MLBU1', attributes: [{ id: 'COLOR', value_name: 'Rosa' }] };
const COM_VARIACOES = { id: 'MLB3', title: 'Camiseta', variations: [{ id: 1 }, { id: 2 }], attributes: [] };

const MATERIAL = { id: 'MATERIAL', name: 'Material', value_type: 'string', tags: {} };
const GIFTABLE = { id: 'GIFTABLE', name: 'Regalavel', value_type: 'string', tags: {} };
const READONLY = { id: 'X', name: 'Campo do ML', value_type: 'string', tags: { read_only: true } };
const TIPO_ESTRANHO = { id: 'Y', name: 'Composto', value_type: 'compound', tags: {} };
const MARCA_PARENT = { id: 'BRAND', name: 'Marca', value_type: 'string', hierarchy: 'PARENT_PK', tags: {} };
const CONDICAO = { id: 'ITEM_CONDITION', name: 'Condição', value_type: 'list', hierarchy: 'ITEM', tags: {}, values: [{ id: '1', name: 'Novo' }] };
const COR_CHILD = { id: 'COLOR', name: 'Cor', value_type: 'string', hierarchy: 'CHILD_PK', tags: {} };
const TECIDO_CHILD_VAZIO = { id: 'FABRIC_DESIGN', name: 'Estampa', value_type: 'string', hierarchy: 'CHILD_PK', tags: {} };
const VOLTAGEM_FAMILY = { id: 'BATTERY_VOLTAGE', name: 'Voltagem da bateria', value_type: 'string', hierarchy: 'FAMILY', tags: {} };
const CAMPO_EXTRA = { id: 'PRODUCT_DATA_SOURCE', name: 'Fonte do produto', value_type: 'string', tags: { hidden: true } };

console.log('\n== o que fica de fora ==');
check('read_only é do ML', M.motivoBloqueado(READONLY, SOLTO) === 'sistema');
check('GIFTABLE é do ML mesmo sem tag', M.motivoBloqueado(GIFTABLE, SOLTO) === 'sistema');
check('tipo que não dá pra editar', M.motivoBloqueado(TIPO_ESTRANHO, SOLTO) === 'tipo');
check('CHILD_PK com variações vai pra tela de variações', M.motivoBloqueado(COR_CHILD, COM_VARIACOES) === 'variacao');
check('PARENT_PK em família quebraria o grupo', M.motivoBloqueado(MARCA_PARENT, FAMILIA) === 'familia');
check('ITEM_CONDITION em família entra na assinatura', M.motivoBloqueado(CONDICAO, FAMILIA) === 'familia');
check('CHILD_PK VAZIO em família migra o UP e não tem volta', M.motivoBloqueado(TECIDO_CHILD_VAZIO, FAMILIA) === 'familia');

console.log('\n== o que fica dentro ==');
check('campo comum', M.motivoBloqueado(MATERIAL, SOLTO) === null);
check('PARENT_PK fora de família não tem grupo pra quebrar', M.motivoBloqueado(MARCA_PARENT, SOLTO) === null);
check('ITEM_CONDITION fora de família', M.motivoBloqueado(CONDICAO, SOLTO) === null);
check('hierarchy FAMILY grava pelo item (medido em conta real)', M.motivoBloqueado(VOLTAGEM_FAMILY, FAMILIA) === null);
check('CHILD_PK PREENCHIDO em família entra (com aviso)', M.motivoBloqueado(COR_CHILD, FAMILIA) === null);
check('campo extra (hidden sem read_only) entra — quase ninguém preenche', M.motivoBloqueado(CAMPO_EXTRA, SOLTO) === null);

console.log('\n== renomear variação e mudar o link são coisas diferentes ==');
check('COLOR preenchido em família renomeia', M.renomeiaVariacao(COR_CHILD, FAMILIA) === true);
check('e "Rosa" está no título -> muda o link', M.mudaOLink(COR_CHILD, FAMILIA) === true);
{
  const semNoTitulo = { id: 'MLB4', title: 'Kit 2 Panelas', user_product_id: 'MLBU2', attributes: [{ id: 'UNITS_PER_PACKAGE', value_name: '2' }] };
  const unidades = { id: 'UNITS_PER_PACKAGE', name: 'Unidades', value_type: 'number', hierarchy: 'CHILD_PK', tags: {} };
  check('renomeia', M.renomeiaVariacao(unidades, semNoTitulo) === true);
  check('mas valor de 1 char só casa como palavra inteira — "2" está solto no título', M.mudaOLink(unidades, semNoTitulo) === true);
}
check('campo solto sem família não renomeia nada', M.renomeiaVariacao(COR_CHILD, SOLTO) === false);

console.log('\n== camposElegiveis e o payload ==');
{
  const cats = [MATERIAL, READONLY, MARCA_PARENT, CAMPO_EXTRA, { id: 'GTIN', name: 'Código universal', value_type: 'string', tags: {} }];
  const elegiveis = M.camposElegiveis(cats, FAMILIA, null).map((c) => c.id).sort();
  check('bloqueados somem', !elegiveis.includes('X') && !elegiveis.includes('BRAND'));
  check('GTIN some (é código, IA não adivinha)', !elegiveis.includes('GTIN'), elegiveis.join(','));
  check('sobram os editáveis', elegiveis.includes('MATERIAL') && elegiveis.includes('PRODUCT_DATA_SOURCE'));
}
{
  const faltantes = [
    ['inducao', { count: 4, categories: new Set(['pesquisa']), phrases: ['panela inducao', 'panela para inducao'] }],
    ['tramontina pro', { count: 2, categories: new Set(['concorrencia']), phrases: ['linha pro'] }],
  ];
  const payload = M.montarPayload({
    detail: SOLTO, descricao: 'Panela de alumínio fundido.',
    categoryAttributes: [MATERIAL, READONLY], obrigatoriosML: new Set(['MATERIAL']),
    palavrasQueFaltam: faltantes, siteId: 'MLB',
  });
  check('manda o título', payload.titulo === SOLTO.title);
  check('manda a descrição', payload.descricao.includes('alumínio'));
  check('manda a ficha atual', payload.ficha_atual.some((a) => a.id === 'BRAND'));
  check('manda só campo elegível', payload.campos.length === 1 && payload.campos[0].id === 'MATERIAL');
  check('marca o obrigatório', payload.campos[0].obrigatorio === true);
  check('marca que está vazio', payload.campos[0].preenchido === false);
  check('manda o site', payload.site_id === 'MLB');
  check('NÃO manda régua nenhuma (peso/limiar são do servidor)',
    !('limiar' in payload) && !('regras' in payload) && !('prompt' in payload));

  // As palavras que faltam viajam como OBJETO: o proxy precisa dos combos (pra tela mostrar
  // as buscas que abrem) e da categoria (pra barrar `concorrencia`).
  const p0 = payload.palavras_que_faltam[0];
  check('palavra que falta vira objeto', typeof p0 === 'object' && p0.palavra === 'inducao', JSON.stringify(p0));
  check('carrega os combos', p0.combos.length === 2, JSON.stringify(p0.combos));
  check('carrega quantas buscas abre', p0.buscas === 4, String(p0.buscas));
  check('carrega a categoria (quem decide o bloqueio é o proxy)', p0.categoria === 'pesquisa', String(p0.categoria));
  check('o front NÃO filtra concorrência — isso é régua, e régua é do servidor',
    payload.palavras_que_faltam.length === 2, String(payload.palavras_que_faltam.length));
}

console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
