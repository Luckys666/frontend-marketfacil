'use strict';
/*
 * Etapa "1. Obrigatórios": quem decide o que é obrigatório.
 *
 * Antes a régua era `tags.required`/`catalog_required` da CATEGORIA — uma inferência que
 * não sabe nada do domínio nem do catálogo daquele anúncio. O catalog_quality traz
 * `adoption_status.required`, que é a régua da própria ML para AQUELE item.
 *
 * Estrutura medida em conta real (10/08/2026): `attributes` são os que o anúncio JÁ tem,
 * `missing_attributes` os que faltam — obrigatórios = união dos dois.
 *
 * ⚠️ O motivo de o fallback continuar existindo: em 11 anúncios ativos da conta, 9 traziam
 * a lista e 2 vinham com os dois campos null. E a API só responde em anúncio ATIVO (400 em
 * pausado e em catálogo) — a conta tem 253 pausados. Trocar a régua sem fallback esvaziaria
 * a etapa justamente na maioria dos anúncios.
 *
 * Rodar: node test/obrigatorios-ml.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get } = carregar();
const mfCampoObrigatorio = get('mfCampoObrigatorio');
const mfObrigatoriosDoML = get('mfObrigatoriosDoML');

console.log('obrigatorios-ml.test.js');

const MARCA = { id: 'BRAND', name: 'Marca', tags: { required: true } };
const KIT = { id: 'IS_KIT', name: 'É kit', tags: {} };
const ATIVOS = { id: 'ACTIVE_INGREDIENTS', name: 'Ingredientes ativos', tags: {} };
const COR = { id: 'COLOR', name: 'Cor', tags: { catalog_required: true } };
const EXTRA = { id: 'HAIR_COLOR', name: 'Cor do cabelo', tags: {} };

// Resposta real de MLB2177029808 (encurtada)
const qualidadeReal = {
  item_id: 'MLB2177029808',
  adoption_status: {
    ft: { complete: false, attributes: ['NAME', 'BRAND'], missing_attributes: ['IS_KIT', 'ACTIVE_INGREDIENTS'] },
    required: { complete: false, attributes: ['BRAND'], missing_attributes: ['IS_KIT', 'ACTIVE_INGREDIENTS'] },
    all: { complete: false, attributes: ['BRAND'], missing_attributes: ['IS_KIT'] }
  }
};

// ── a lista da ML ───────────────────────────────────────────────────────
console.log('\n== mfObrigatoriosDoML lê required, não ft nem all ==');
{
  const set = mfObrigatoriosDoML(qualidadeReal);
  check('devolve um Set', set instanceof Set, String(set));
  check('une attributes + missing_attributes (3 ids)', set.size === 3, [...set].join(','));
  check('tem o que falta (IS_KIT)', set.has('IS_KIT'));
  check('tem o que já está preenchido (BRAND)', set.has('BRAND'));
  check('NÃO pega de ft (NAME só existe lá)', !set.has('NAME'), [...set].join(','));
}

// ── quando a ML não diz ─────────────────────────────────────────────────
console.log('\n== ausência vira null, nunca Set vazio ==');
{
  // Set vazio faria mfCampoObrigatorio devolver false pra tudo e a etapa "Obrigatórios"
  // apareceria vazia — pior que a inferência antiga, porque parece resposta.
  check('sem qualidade → null', mfObrigatoriosDoML(null) === null);
  check('sem adoption_status → null', mfObrigatoriosDoML({ item_id: 'MLB1' }) === null);
  check('required com os dois campos null → null (os 2 de 11 medidos)',
    mfObrigatoriosDoML({ adoption_status: { required: { complete: true, attributes: null, missing_attributes: null } } }) === null);
  check('required com listas vazias → null',
    mfObrigatoriosDoML({ adoption_status: { required: { attributes: [], missing_attributes: [] } } }) === null);
}

// ── a régua com a lista da ML ───────────────────────────────────────────
console.log('\n== com a lista da ML, é ela que manda ==');
{
  const set = mfObrigatoriosDoML(qualidadeReal);
  check('IS_KIT é obrigatório mesmo sem tag na categoria',
    mfCampoObrigatorio(KIT, set) === true);
  check('ACTIVE_INGREDIENTS idem', mfCampoObrigatorio(ATIVOS, set) === true);
  check('BRAND continua obrigatório', mfCampoObrigatorio(MARCA, set) === true);
  // O ponto de virada: a categoria dizia catalog_required, a ML não põe na lista do item.
  check('COLOR com catalog_required NÃO entra se a ML não listou',
    mfCampoObrigatorio(COR, set) === false);
  check('extra continua extra', mfCampoObrigatorio(EXTRA, set) === false);
}

// ── fallback preserva o comportamento antigo ────────────────────────────
console.log('\n== sem a lista, volta pras tags da categoria ==');
{
  for (const semLista of [null, undefined, new Set()]) {
    const rotulo = semLista instanceof Set ? 'Set vazio' : String(semLista);
    check(`(${rotulo}) required da categoria vale`, mfCampoObrigatorio(MARCA, semLista) === true);
    check(`(${rotulo}) catalog_required vale`, mfCampoObrigatorio(COR, semLista) === true);
    check(`(${rotulo}) sem tag não é obrigatório`, mfCampoObrigatorio(KIT, semLista) === false);
  }
  check('chamada com 1 argumento (jeito antigo) continua funcionando',
    mfCampoObrigatorio(MARCA) === true && mfCampoObrigatorio(EXTRA) === false);
}

// ── robustez ────────────────────────────────────────────────────────────
console.log('\n== entradas estranhas não quebram ==');
{
  const set = mfObrigatoriosDoML(qualidadeReal);
  check('catAttr null não quebra', mfCampoObrigatorio(null, set) === false);
  check('catAttr null sem lista não quebra', mfCampoObrigatorio(null, null) === false);
  check('required não-objeto → null', mfObrigatoriosDoML({ adoption_status: { required: 'x' } }) === null);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
