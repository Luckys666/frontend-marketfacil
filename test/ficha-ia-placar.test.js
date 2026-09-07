'use strict';
/*
 * Gamificação, Nível 1 (proposta de 06/09, aprovada em 07/09): o placar da ficha explica por
 * ESTRUTURA. Uma barra mede os campos preenchidos de fato; um trecho de prévia mostra o que os
 * checkboxes marcados vão preencher ao salvar (e recua ao desmarcar); "◆ k/n" conta os campos que
 * rendem busca (lista vem do proxy em `prioritarios`); "+N" segue vivo. Sem frase: o rótulo
 * "campos preenchidos" vira title. 🎉 só quando tudo está preenchido de verdade.
 *
 * MEDE (feedback_teste_de_layout_mede_nao_olha): larguras em %, contagens, não olha.
 * Rodar: node test/ficha-ia-placar.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-placar.test.js');

const campo = (id, name, extra) => ({ id, name, value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false, ...(extra || {}) });
// 10 campos: 4 preenchidos (40%). Prioritários presentes: MODEL (preenchido), LINE, MPN (vazios) → ◆ 1/3.
const CAMPOS = [
  campo('BRAND', 'Marca', { preenchido: true, valor_atual: 'Kiran' }),
  campo('MODEL', 'Modelo', { preenchido: true, valor_atual: 'Basica' }),
  campo('COLOR', 'Cor', { preenchido: true, valor_atual: 'Preto' }),
  campo('SIZE', 'Tamanho', { preenchido: true, valor_atual: 'M' }),
  campo('LINE', 'Linha'),
  campo('MPN', 'MPN'),
  campo('MATERIAL', 'Material'),
  campo('FONTE', 'Fonte do produto'),
  campo('IS_VEGAN', 'É vegano', { value_type: 'boolean' }),
  campo('GTIN', 'Código universal'),
];
const sug = (id, valor, extra) => ({ id, acao: 'preencher', valor, caracteres: valor.length, palavras_novas: ['x' + id.toLowerCase()], origens: [{ palavra: valor.split(' ')[0], fonte: 'descricao', trecho: valor }], ...(extra || {}) });
const DADOS = {
  ok: true,
  prioritarios: ['MODEL', 'LINE', 'MANUFACTURER', 'MPN'],
  sugestoes: [sug('MATERIAL', 'Malha canelada macia'), sug('LINE', 'Cropped verao basica', { prioridade: true })],
  palavras_novas_sugeridas: [
    { id: 'MPN', name: 'MPN', valor: 'antifrizz,acetinado', palavra: 'antifrizz', palavras_novas: ['antifrizz', 'acetinado'], buscas: 13, combos: [], entraram: [{ palavra: 'antifrizz', buscas: 9 }, { palavra: 'acetinado', buscas: 4 }], caracteres: 19, prioridade: true },
  ],
  palpites: [{ id: 'IS_VEGAN', name: 'É vegano', valor: 'Não', caracteres: 3, palavras_novas: [], porque: 'tipo do produto' }],
  sem_base: [{ id: 'GTIN', name: 'Código universal' }, { id: 'FONTE', name: 'Fonte do produto' }],
  descartadas: 0,
};
const pct = (el) => { const m = el && /width:\s*([\d.]+)%/.exec(el.getAttribute('style') || ''); return m ? Number(m[1]) : null; };

(async () => {
  const { M, el, box } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'ok', dados: DADOS, campos: CAMPOS, placar: M.contarPlacar(CAMPOS) });
  const body = el('ficha-ia-body');
  const placar = body.querySelector('.fia-placar');

  console.log('\n== barra: mede o que está preenchido; prévia mede o que os marcados vão preencher ==');
  check('há uma barra no placar', !!placar && !!placar.querySelector('.fia-barra'));
  check('a parte feita mede 4/10 = 40%', pct(placar.querySelector('.fia-barra-feito')) === 40, String(pct(placar.querySelector('.fia-barra-feito'))));
  // Marcados que preenchem campo VAZIO: MATERIAL, LINE, MPN, IS_VEGAN = 4 → prévia 40% (além dos 40% feitos).
  check('a prévia mede 4 campos vazios marcados = 40%', pct(placar.querySelector('.fia-barra-previa')) === 40, String(pct(placar.querySelector('.fia-barra-previa'))));
  check('o número continua "4 de 10"', /4 de 10/.test(placar.textContent), placar.textContent);
  // (nó filho do mini-dom não tem innerHTML: o title é conferido no HTML da raiz)
  check('o rótulo "campos preenchidos" saiu da tela e virou title', !/campos preenchidos/.test(placar.textContent) && /title="campos preenchidos/.test(body.innerHTML), placar.textContent);

  console.log('\n== ◆ k/n: campos que rendem busca (lista do proxy) ==');
  const prio = placar.querySelector('.fia-placar-prio');
  check('mostra ◆ 1/3 (MODEL preenchido; LINE e MPN presentes e vazios; MANUFACTURER não existe nesta categoria)', !!prio && /1\/3/.test(prio.textContent), prio && prio.textContent);
  check('explica no title, não em frase', !!prio && /rende(m)? busca/i.test(prio.getAttribute('title') || '') && !/rende busca/.test(prio.textContent));

  console.log('\n== desmarcar recua a prévia; o número feito não muda até salvar ==');
  {
    M.ligarBotoes(); // o handler de change é ligado por quem abre a ficha; aqui o render foi direto
    const checks = body.querySelectorAll('.fia-check, .fia-check-nova');
    const deLine = checks.find((c) => c.getAttribute('data-campo') === 'LINE');
    deLine.checked = false;
    await deLine.dispatchEvent({ type: 'change', target: deLine });
    check('prévia caiu para 3/10 = 30%', pct(placar.querySelector('.fia-barra-previa')) === 30, String(pct(placar.querySelector('.fia-barra-previa'))));
    check('a parte feita continua 40%', pct(placar.querySelector('.fia-barra-feito')) === 40);
    check('o número continua "4 de 10" (a prévia não vira número)', /4 de 10/.test(placar.textContent));
  }

  console.log('\n== sem prioritário na categoria: o ◆ some; 🎉 só com tudo preenchido ==');
  {
    const { M: M2, el: el2 } = carregar();
    const campos2 = [campo('COLOR', 'Cor', { preenchido: true, valor_atual: 'Preto' }), campo('MATERIAL', 'Material', { preenchido: true, valor_atual: 'Malha' })];
    M2.renderPainel('ficha-ia-body', { estado: 'ok', dados: { ...DADOS, sugestoes: [], palavras_novas_sugeridas: [], palpites: [], sem_base: [] }, campos: campos2, placar: M2.contarPlacar(campos2) });
    const p2 = el2('ficha-ia-body').querySelector('.fia-placar');
    check('sem campo prioritário: o ◆ não aparece', !p2.querySelector('.fia-placar-prio'));
    const html2 = el2('ficha-ia-body').innerHTML;
    check('tudo preenchido: barra 100% e 🎉 uma vez', pct(p2.querySelector('.fia-barra-feito')) === 100 && (html2.match(/🎉/g) || []).length === 1, html2.slice(0, 300));
  }
  {
    const { M: M3, el: el3 } = carregar();
    M3.renderPainel('ficha-ia-body', { estado: 'ok', dados: { ...DADOS, prioritarios: undefined }, campos: CAMPOS, placar: M3.contarPlacar(CAMPOS) });
    check('resposta antiga sem `prioritarios`: nada quebra e o ◆ não aparece', !el3('ficha-ia-body').querySelector('.fia-placar-prio'));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
