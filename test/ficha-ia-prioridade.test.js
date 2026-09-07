'use strict';
/*
 * 06/09/2026 (Lucas): preencher TUDO; modelo, linha, fabricante e MPN primeiro; nenhum palpite
 * descartado por silêncio (a tela AVISA); "ficaram com você" vira revisão.
 *
 * O que a tela promete aqui (as regras vêm prontas do proxy; o front só ordena e rotula):
 *  - itens com `prioridade` aparecem no topo de cada lista;
 *  - palpite com `silencio` mostra "O anúncio não afirma isso";
 *  - valor completado pelo servidor diz com o quê;
 *  - os títulos: "Revise antes de aceitar" (palpites) e "Só você sabe" (sem nada a propor).
 *
 * Rodar: node test/ficha-ia-prioridade.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-prioridade.test.js');

const campo = (id, name, extra) => ({ id, name, value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false, ...(extra || {}) });
const CAMPOS = [campo('MATERIAL', 'Material'), campo('MODEL', 'Modelo'), campo('LINE', 'Linha'), campo('IS_VEGAN', 'É vegano', { value_type: 'boolean' }), campo('FONTE', 'Fonte do produto')];
const sug = (id, valor, extra) => ({ id, acao: 'preencher', valor, caracteres: valor.length, palavras_novas: [], origens: [{ palavra: valor.split(' ')[0], fonte: 'descricao', trecho: valor }], ...(extra || {}) });

(async () => {
  const { M, el } = carregar();
  const dados = {
    ok: true,
    sugestoes: [sug('MATERIAL', 'Malha canelada macia'), sug('MODEL', 'Cropped verao basica', { prioridade: true })],
    palavras_novas_sugeridas: [],
    palpites: [
      { id: 'FONTE', name: 'Fonte do produto', valor: 'Kiran 2024 cropped verao', caracteres: 24, palavras_novas: ['cropp', 'verao'], porque: 'marca e ano', completado_com: ['cropped', 'verao'] },
      { id: 'LINE', name: 'Linha', valor: 'Finisher Hair acetinada', caracteres: 23, palavras_novas: [], porque: 'linha do produto', prioridade: true },
      { id: 'IS_VEGAN', name: 'É vegano', valor: 'Não', caracteres: 3, palavras_novas: [], porque: 'Não há declaração vegana no anúncio', silencio: true },
    ],
    sem_base: [{ id: 'GTIN', name: 'Código universal de produto' }],
    descartadas: 0,
  };
  M.renderPainel('ficha-ia-body', { estado: 'ok', dados, campos: CAMPOS.concat([campo('GTIN', 'Código universal de produto')]), placar: M.contarPlacar(CAMPOS) });
  const html = el('ficha-ia-body').innerHTML;

  console.log('\n== prioridade no topo de cada lista ==');
  check('na lista "Achei no seu anúncio", MODEL (prioridade) vem antes de MATERIAL', html.indexOf('data-campo="MODEL"') < html.indexOf('data-campo="MATERIAL"'), String([html.indexOf('data-campo="MODEL"'), html.indexOf('data-campo="MATERIAL"')]));
  check('nos palpites, LINE (prioridade) vem antes de FONTE e IS_VEGAN', html.indexOf('data-campo="LINE"') < html.indexOf('data-campo="FONTE"') && html.indexOf('data-campo="LINE"') < html.indexOf('data-campo="IS_VEGAN"'));
  check('o item prioritário ganha um selo discreto na linha', /data-campo="MODEL"[\s\S]*?fia-selo-prio/.test(html) && /data-campo="LINE"[\s\S]*?fia-selo-prio/.test(html));
  check('quem não é prioridade não ganha selo', !/data-campo="MATERIAL"[\s\S]*?<\/div>\s*<div class="fia-linha-topo">[\s\S]*?fia-selo-prio/.test(html.slice(html.indexOf('data-campo="MATERIAL"'), html.indexOf('data-campo="MATERIAL"') + 400)));

  console.log('\n== títulos e avisos ==');
  check('a seção dos palpites chama "Revise antes de aceitar"', /Revise antes de aceitar/.test(html) && !/Confira estes/.test(html));
  check('o palpite pelo silêncio avisa "O anúncio não afirma isso"', /data-campo="IS_VEGAN"[\s\S]*?O anúncio não afirma isso/.test(html));
  check('o palpite sobre o produto NÃO leva esse aviso', !/data-campo="LINE"[\s\S]{0,900}?O anúncio não afirma isso/.test(html.slice(html.indexOf('data-campo="LINE"'), html.indexOf('data-campo="IS_VEGAN"'))));
  check('valor completado pelo servidor diz com o quê', /data-campo="FONTE"[\s\S]*?completado com[\s\S]*?cropped, verao/i.test(html));
  check('a seção do que sobrou chama "Só você sabe" (não "Ficaram com você")', /Só você sabe/.test(html) && !/Ficaram com você/.test(html));
  check('e ela só tem o campo sem proposta nenhuma (GTIN)', /fia-sem-base[\s\S]*?data-campo="GTIN"/.test(html) && !/fia-sem-base[\s\S]*?data-campo="IS_VEGAN"/.test(html));
  check('palpites nascem marcados (o vendedor corrige na hora)', /data-campo="IS_VEGAN"[\s\S]*?class="fia-check-nova"[^>]*checked/.test(html));

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
