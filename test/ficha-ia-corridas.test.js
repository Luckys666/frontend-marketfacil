'use strict';
/*
 * Os três bloqueadores do FICHA-IA-PENDENCIAS (30/08/2026).
 *
 * P1 — `estadoFicha` é singleton. Abrir o anúncio A, voltar, abrir o B: se a cadeia de A
 *      resolver depois da de B, a tela mostra A achando que é B, e um salvar() de A que
 *      chega atrasado marca campo de B como gravado. A tela passa a mentir sobre o que
 *      está no anúncio. Agravante: nada na tela dizia QUAL anúncio estava aberto.
 * P3 — "Aplicar só este" achava o input por `document.querySelector('[data-campo=X]')`.
 *      O prompt pede uma proposta por palavra, então duas linhas com o mesmo campo são
 *      esperadas — e o clique na segunda gravava o valor da primeira.
 *
 * Estes testes exercitam o caminho de verdade: fetch, render, clique no DOM, PUT.
 *
 * Rodar: node test/ficha-ia-corridas.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('ficha-ia-corridas.test.js');

const CATEGORIA = [
  { id: 'MATERIAL', name: 'Material', value_type: 'string', value_max_length: 255, tags: {} },
  { id: 'BRAND', name: 'Marca', value_type: 'string', value_max_length: 255, tags: {} },
];

function anuncio(id, titulo) {
  return [{
    code: 200,
    body: { id, title: titulo, category_id: 'MLB1051', site_id: 'MLB', attributes: [] },
    description: { plain_text: 'Panela de aco com acabamento inox escovado.' },
  }];
}

/** Um adiado: a promessa só anda quando o teste manda. É o que encena a corrida. */
function adiado() {
  let liberar;
  const p = new Promise((r) => { liberar = r; });
  return { p, liberar };
}

/**
 * Mundo completo: todas as rotas que abrirFichaIA percorre.
 * `atrasos[itemId]` segura o /api/fetch-item daquele anúncio até o teste liberar.
 */
function mundo({ atrasos = {}, sugestoes = {}, putAdiado = null, onPut = () => {} } = {}) {
  const puts = [];
  const rotas = [
    [/getAccessToken2/, async () => ({ body: { response: { access_token: 'TOKEN-ML' } } })],
    [/get-user-id/, async () => ({ body: { response: { user_id: 'user-app-1' } } })],
    [/\/api\/fetch-item\?/, async (url) => {
      const id = /item_id=([^&]+)/.exec(url)[1];
      if (atrasos[id]) await atrasos[id].p;
      return { body: anuncio(id, 'Panela ' + id) };
    }],
    [/\/api\/attributes\//, async () => ({ body: CATEGORIA })],
    [/\/api\/catalog-quality/, async () => ({ status: 404, body: {} })],
    [/\/api\/gpt-ficha/, async (url, init) => {
      const corpo = JSON.parse(init.body || '{}');
      return { body: sugestoes[corpo.item_id] || { ok: true, sugestoes: [], palavras_novas_sugeridas: [], sem_base: [], descartadas: 0 } };
    }],
    [/\/api\/fetch-item-update/, async (url, init) => {
      puts.push({ url, corpo: JSON.parse(init.body || '{}') });
      onPut();
      if (putAdiado) await putAdiado.p;
      return { body: {} };
    }],
  ];
  return { rotas, puts };
}

const RESPOSTA_A = {
  ok: true,
  sugestoes: [{ id: 'MATERIAL', acao: 'preencher', valor: 'Aco inox', origens: [], palavras_novas: ['inox'], caracteres: 8 }],
  palavras_novas_sugeridas: [], sem_base: [], descartadas: 0,
};
const RESPOSTA_B = {
  ok: true,
  sugestoes: [{ id: 'BRAND', acao: 'preencher', valor: 'Tramontina', origens: [], palavras_novas: ['tramontina'], caracteres: 10 }],
  palavras_novas_sugeridas: [], sem_base: [], descartadas: 0,
};

(async () => {
  console.log('\n== P1 · a resposta atrasada do anúncio anterior não sequestra a tela ==');
  {
    const atrasoA = adiado();
    const { rotas } = mundo({
      atrasos: { MLB1111111111: atrasoA },
      sugestoes: { MLB1111111111: RESPOSTA_A, MLB2222222222: RESPOSTA_B },
    });
    const { M, el } = carregar({ rotas });

    const abrirA = M.abrirFichaIA('MLB1111111111');   // fica pendurado no fetch-item
    await M.abrirFichaIA('MLB2222222222');            // o vendedor voltou e abriu outro
    check('depois de abrir o B, o estado é do B', M._estado().itemId === 'MLB2222222222', String(M._estado().itemId));

    atrasoA.liberar();                                 // agora o A responde, atrasado
    await abrirA;

    check('o A atrasado NÃO volta a ser o anúncio da vez', M._estado().itemId === 'MLB2222222222', String(M._estado().itemId));
    check('o detalhe carregado continua sendo o do B',
      (M._estado().detail || {}).id === 'MLB2222222222', String((M._estado().detail || {}).id));
    const html = el('ficha-ia-body').innerHTML;
    check('a tela mostra o campo do B, não o do A', html.includes('Marca') && !html.includes('Material'),
      html.slice(0, 200));
  }

  console.log('\n== P1 · um salvar() atrasado não marca campo do anúncio que está na tela ==');
  {
    const putLento = adiado();
    const { rotas, puts } = mundo({
      sugestoes: { MLB1111111111: RESPOSTA_A, MLB2222222222: RESPOSTA_B },
      putAdiado: putLento,
    });
    const { M, el } = carregar({ rotas });

    await M.abrirFichaIA('MLB1111111111');
    const salvando = M.salvar([{ id: 'MATERIAL', valor: 'Aco inox' }]);   // PUT pendurado
    await M.abrirFichaIA('MLB2222222222');                                // troca de anúncio
    putLento.liberar();
    await salvando;

    check('o PUT foi para o anúncio A (quem o vendedor mandou salvar)',
      puts.length === 1 && puts[0].url.includes('MLB1111111111'), JSON.stringify(puts.map((p) => p.url)));
    check('nenhum campo do B foi marcado como preenchido',
      M._estado().campos.every((c) => !c.preenchido),
      JSON.stringify(M._estado().campos.map((c) => c.id + ':' + c.preenchido)));
    check('a tela do B não anuncia "campo preenchido agora"',
      !el('ficha-ia-body').textContent.includes('preenchido agora'),
      el('ficha-ia-body').textContent.slice(0, 160));
  }

  console.log('\n== P1 · a tela diz QUAL anúncio está aberto ==');
  {
    const { rotas } = mundo({ sugestoes: { MLB1111111111: RESPOSTA_A } });
    const { M, el } = carregar({ rotas });
    await M.abrirFichaIA('MLB1111111111');
    const head = el('ficha-ia-head').textContent;
    check('o cabeçalho mostra o título do anúncio', head.includes('Panela MLB1111111111'), head);
    check('o cabeçalho mostra o ID', head.includes('MLB1111111111'), head);
  }

  console.log('\n== P3 · aplicar na segunda linha grava o valor DA SEGUNDA ==');
  {
    // O prompt pede "uma proposta por palavra": duas palavras novas no mesmo campo é o
    // caso esperado, não a exceção.
    const DUAS_NO_MESMO_CAMPO = {
      ok: true,
      sugestoes: [],
      palavras_novas_sugeridas: [
        { id: 'MATERIAL', name: 'Material', valor: 'Aco inox', palavra: 'inox', buscas: 9, combos: [], caracteres: 8 },
        { id: 'MATERIAL', name: 'Material', valor: 'Aco escovado', palavra: 'escovado', buscas: 4, combos: [], caracteres: 12 },
      ],
      sem_base: [], descartadas: 0,
    };
    const { rotas, puts } = mundo({ sugestoes: { MLB1111111111: DUAS_NO_MESMO_CAMPO } });
    const { M, el } = carregar({ rotas });
    await M.abrirFichaIA('MLB1111111111');

    const body = el('ficha-ia-body');
    const linhas = body.querySelectorAll('.fia-nova');
    check('as duas propostas aparecem', linhas.length === 2, String(linhas.length));

    const botoes = body.querySelectorAll('.fia-aplicar-um');
    check('cada proposta tem o seu botão', botoes.length === 2, String(botoes.length));
    await botoes[1].click();

    check('o PUT saiu', puts.length === 1, String(puts.length));
    const enviado = ((puts[0] || {}).corpo || {}).attributes || [];
    check('gravou o valor da linha clicada, não o da primeira',
      enviado.length === 1 && enviado[0].value_name === 'Aco escovado',
      JSON.stringify(enviado));
  }

  console.log('\n== P3 · o valor editado à mão é o que vai, linha a linha ==');
  {
    const DUAS = {
      ok: true,
      sugestoes: [],
      palavras_novas_sugeridas: [
        { id: 'MATERIAL', name: 'Material', valor: 'Aco inox', palavra: 'inox', buscas: 9, combos: [], caracteres: 8 },
        { id: 'MATERIAL', name: 'Material', valor: 'Aco escovado', palavra: 'escovado', buscas: 4, combos: [], caracteres: 12 },
      ],
      sem_base: [], descartadas: 0,
    };
    const { rotas, puts } = mundo({ sugestoes: { MLB1111111111: DUAS } });
    const { M, el } = carregar({ rotas });
    await M.abrirFichaIA('MLB1111111111');

    const body = el('ficha-ia-body');
    const inputs = body.querySelectorAll('.fia-valor');
    inputs[1].value = 'Aco escovado premium';        // o vendedor ajustou a segunda
    await body.querySelectorAll('.fia-aplicar-um')[1].click();

    const enviado = ((puts[0] || {}).corpo || {}).attributes || [];
    check('foi o texto que o vendedor deixou na linha dele',
      enviado.length === 1 && enviado[0].value_name === 'Aco escovado premium',
      JSON.stringify(enviado));
  }

  console.log('\n== o lote continua ignorando as palavras novas (regressão do D9) ==');
  {
    const MISTO = {
      ok: true,
      sugestoes: [{ id: 'MATERIAL', acao: 'preencher', valor: 'Aco inox', origens: [], palavras_novas: ['inox'], caracteres: 8 }],
      palavras_novas_sugeridas: [
        { id: 'BRAND', name: 'Marca', valor: 'Tramontina', palavra: 'tramontina', buscas: 3, combos: [], caracteres: 10 },
      ],
      sem_base: [], descartadas: 0,
    };
    const { rotas, puts } = mundo({ sugestoes: { MLB1111111111: MISTO } });
    const { M, el } = carregar({ rotas });
    await M.abrirFichaIA('MLB1111111111');

    const body = el('ficha-ia-body');
    // marca a palavra nova de propósito: nem marcada ela pode entrar no lote
    const checkNova = body.querySelector('.fia-check-nova');
    if (checkNova) checkNova.checked = true;
    await body.querySelector('.fia-lote').click();

    const enviado = ((puts[0] || {}).corpo || {}).attributes || [];
    check('o lote salvou só o que tem base no anúncio',
      enviado.length === 1 && enviado[0].id === 'MATERIAL', JSON.stringify(enviado));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
