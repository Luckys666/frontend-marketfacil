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

  console.log('\n== as palavras do Agente são DO anúncio, não da sessão ==');
  {
    // Elas saem do cruzamento entre o que a IA sugeriu e o que AQUELE anúncio já indexa.
    // Guardadas numa variável só, as palavras do anúncio analisado antes entravam como
    // sugestão do próximo aberto pelo Seletor — e a lista 2 afirma característica do
    // produto. Mesmo defeito do P1, em outra roupa.
    let payloadDoB = null;
    const { rotas } = mundo({ sugestoes: { MLB2222222222: RESPOSTA_B } });
    const comEspiao = rotas.map(([p, fn]) => [p, async (url, init) => {
      if (/gpt-ficha/.test(url)) payloadDoB = JSON.parse(init.body || '{}');
      return fn(url, init);
    }]);
    const { M } = carregar({ rotas: comEspiao });

    // o vendedor analisou o anúncio A no Agente
    M.registrarPalavras('MLB1111111111', [
      { palavra: 'antiaderente', combos: ['panela antiaderente'], buscas: 9, categorias: ['beneficios'] },
    ]);
    // e então abriu a ficha do B pelo Seletor
    await M.abrirFichaIA('MLB2222222222');

    check('o payload do B não leva as palavras do A',
      !!payloadDoB && (payloadDoB.palavras_que_faltam || []).length === 0,
      JSON.stringify(payloadDoB && payloadDoB.palavras_que_faltam));
  }
  {
    let payloadDoA = null;
    const { rotas } = mundo({ sugestoes: { MLB1111111111: RESPOSTA_A } });
    const comEspiao = rotas.map(([p, fn]) => [p, async (url, init) => {
      if (/gpt-ficha/.test(url)) payloadDoA = JSON.parse(init.body || '{}');
      return fn(url, init);
    }]);
    const { M } = carregar({ rotas: comEspiao });

    M.registrarPalavras('MLB1111111111', [
      { palavra: 'antiaderente', combos: ['panela antiaderente'], buscas: 9, categorias: ['beneficios'] },
    ]);
    await M.abrirFichaIA('MLB1111111111');

    const p = (payloadDoA || {}).palavras_que_faltam || [];
    check('mas o anúncio certo recebe as suas', p.length === 1 && p[0].palavra === 'antiaderente', JSON.stringify(p));
    check('com os combos, que a tela usa pra mostrar as buscas que abrem', !!(p[0] && p[0].combos && p[0].combos.length));
    check('e a categoria, que o proxy usa pra barrar concorrência', !!(p[0] && p[0].categorias));
  }

  console.log('\n== a ficha caça sozinha as palavras que o anúncio não tem ==');
  {
    // O maior ganho da ferramenta é entrar em buscas que o anúncio não alcança. Até aqui,
    // isso só acontecia se o vendedor colasse o link no campo de cima e clicasse ANALISAR;
    // quem escolhia pela lista do Seletor — o caminho principal — recebia a ficha sem
    // nenhuma palavra nova.
    let payload = null;
    const { rotas } = mundo({ sugestoes: { MLB1111111111: RESPOSTA_A } });
    const comEspiao = rotas.map(([p, fn]) => [p, async (url, init) => {
      if (/gpt-ficha/.test(url)) payload = JSON.parse(init.body || '{}');
      return fn(url, init);
    }]);
    const { M, box } = carregar({ rotas: comEspiao });

    const chamadas = [];
    box.MFKw = {
      SCRAPER_ENDPOINT: 'https://proxy/api/ml-scraper',
      GPT_KEYWORDS_ENDPOINT: 'https://proxy/api/gpt-palavras',
      fetchUserIdForScraping: async () => 'user-1',
      buildScraperUrl: ({ id }) => 'https://produto/' + id,
      withMintRetry: async (fn) => fn('user-1'),
      extractIndexedWords: () => new Set(['panela']),
      buildMissingWordsMap: () => [['antiaderente', { count: 6, categories: new Set(['beneficios']), phrases: ['panela antiaderente'] }]],
    };
    const fetchAntigo = box.fetch;
    // O mock exige o formato REAL de cada endpoint. Na primeira versão ele aceitava
    // qualquer coisa, então passou com um POST inventado — e o proxy respondeu 404 na
    // conta real. Mock que aceita o que o código manda mede a intenção, não o sistema.
    box.fetch = async (url, init) => {
      const u = String(url);
      const cfg = init || {};
      chamadas.push(u);
      if (u.includes('ml-scraper')) {
        const metodo = (cfg.method || 'GET').toUpperCase();
        const temUrlNaQuery = /[?&]url=/.test(u);
        const temUserId = !!(cfg.headers && cfg.headers['x-user-id']);
        if (metodo !== 'GET' || !temUrlNaQuery || !temUserId) {
          return { ok: false, status: 404, json: async () => ({ error: 'formato errado' }) };
        }
        return { ok: true, status: 200, json: async () => ({ title: 'Panela', description: 'inox' }) };
      }
      if (u.includes('gpt-palavras')) {
        const corpo = JSON.parse(cfg.body || '{}');
        if ((cfg.method || '').toUpperCase() !== 'POST' || !corpo.texto) {
          return { ok: false, status: 400, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({ beneficios: ['antiaderente'] }) };
      }
      return fetchAntigo(url, init);
    };

    await M.abrirFichaIA('MLB1111111111');

    // ⚠️ NADA de scraper aqui: o anúncio é da conta de quem está usando e o item já veio
    // pela API do ML nesta mesma abertura. Raspar a página seria pedir de novo, por fora, o
    // que já está na mão — com crédito de Decodo, risco de Anubis e segundos a mais
    // (Lucas, 31/08: "por que raios estamos usando o scraper se o anúncio é da conta da
    // própria pessoa?").
    check('a caça NÃO chama o scraper', !chamadas.some((u) => u.includes('ml-scraper')), JSON.stringify(chamadas));
    check('e o gerador de palavras é chamado', chamadas.some((u) => u.includes('gpt-palavras')));
    const p = (payload || {}).palavras_que_faltam || [];
    check('as palavras chegaram na análise da ficha', p.length === 1 && p[0].palavra === 'antiaderente', JSON.stringify(p));
    check('com as buscas que cada uma abre', p[0] && p[0].buscas === 6, JSON.stringify(p[0]));

    // segunda abertura do MESMO anúncio não paga de novo
    const antes = chamadas.filter((u) => u.includes('gpt-palavras')).length;
    await M.abrirFichaIA('MLB1111111111');
    const depois = chamadas.filter((u) => u.includes('gpt-palavras')).length;
    check('reabrir o mesmo anúncio não caça de novo', depois === antes, `${antes} -> ${depois}`);
  }
  {
    // A caça é um bônus: se ela falhar, a ficha ainda vale pelo que o texto sustenta.
    let payload = null;
    const { rotas } = mundo({ sugestoes: { MLB1111111111: RESPOSTA_A } });
    const comEspiao = rotas.map(([p, fn]) => [p, async (url, init) => {
      if (/gpt-ficha/.test(url)) payload = JSON.parse(init.body || '{}');
      return fn(url, init);
    }]);
    const { M, box } = carregar({ rotas: comEspiao });
    box.MFKw = {
      SCRAPER_ENDPOINT: 'https://proxy/api/ml-scraper',
      GPT_KEYWORDS_ENDPOINT: 'https://proxy/api/gpt-palavras',
      fetchUserIdForScraping: async () => { throw new Error('scraper fora'); },
      buildScraperUrl: () => 'https://produto/x',
      withMintRetry: async (fn) => fn('u'),
      extractIndexedWords: () => new Set(),
      buildMissingWordsMap: () => [],
    };

    await M.abrirFichaIA('MLB1111111111');
    check('a caça falhar não derruba a ficha', !!payload, 'a análise da ficha nem aconteceu');
    check('e ela segue com o que o anúncio sustenta',
      (payload.palavras_que_faltam || []).length === 0 && !!payload.item_id, JSON.stringify(payload && payload.item_id));
    const corpo = ((box.document.getElementById('ficha-ia-body') || {}).innerHTML) || '';
    check('a tela não mostra erro por causa disso', !/não deu pra consultar/i.test(corpo), corpo.slice(0, 90));
  }

  console.log('\n== "Voltar para a lista" volta mesmo ==');
  {
    // O botão ficava morto na tela: o listener era registrado no `DOMContentLoaded`, que no
    // Bubble já disparou muito antes deste script rodar (o HTML entra por innerHTML).
    // Nenhum teste percebia porque o `document.addEventListener` do harness era no-op.
    const { rotas } = mundo({ sugestoes: { MLB1111111111: RESPOSTA_A } });
    const { M, el, doc, box } = carregar({ rotas });

    const view = el('ficha-ia-view');
    const painel = el('ficha-ia-painel');
    // o botão vive na barra da ficha, montada pelo shell do bundle
    el('ficha-ia-barra').innerHTML = '<button type="button" id="ficha-ia-voltar">← Voltar para a lista</button>';

    await M.abrirFichaIA('MLB1111111111');
    check('a ficha está aberta', view.hidden === false, String(view.hidden));

    // o Seletor é quem redesenha a lista ao sair da análise
    let saiuDaAnalise = 0;
    box.MFSelExitAnalysis = () => { saiuDaAnalise++; };

    await doc.querySelector('#ficha-ia-voltar').click();

    check('clicar no botão fecha a ficha', view.hidden === true, String(view.hidden));
    check('e mostra o painel de volta', painel.hidden === false, String(painel.hidden));
    check('e tira o Seletor do modo análise', saiuDaAnalise === 1, String(saiuDaAnalise));
  }

  console.log('\n== produto com variações: a escolha acontece na própria tela ==');
  {
    // Antes a tela dizia "volte para a lista e abra a variação que você quer melhorar" —
    // jogar o trabalho de volta pro vendedor, que nem sempre sabe qual linha da lista é
    // qual variação.
    const variacoes = ['MLB1111111111', 'MLB2222222222'];
    const { rotas } = mundo({ sugestoes: {} });
    const comProduto = [
      [/\/api\/users\/me/, async () => ({ body: { id: 649733403 } })],
      [/\/api\/user-products\/[^/]+\/items/, async () => ({ body: { results: variacoes } })],
      [/\/api\/fetch-item\?item_id=ML[A-Z]\d+,/, async () => ({
        body: [
          { code: 200, body: { id: 'MLB1111111111', title: 'Blusinha Branca P', status: 'active',
            attributes: [{ id: 'COLOR', name: 'Cor', value_name: 'Branco' }, { id: 'SIZE', name: 'Tamanho', value_name: 'P' }] } },
          { code: 200, body: { id: 'MLB2222222222', title: 'Blusinha Preta M', status: 'paused',
            attributes: [{ id: 'COLOR', name: 'Cor', value_name: 'Preto' }, { id: 'SIZE', name: 'Tamanho', value_name: 'M' }] } },
        ],
      })],
    ].concat(rotas);
    const { M, el } = carregar({ rotas: comProduto });

    await M.abrirFichaIA('MLBU3935191872');
    const body = el('ficha-ia-body');
    const botoes = body.querySelectorAll('.fia-var');

    check('as duas variações aparecem pra escolher', botoes.length === 2, String(botoes.length));
    check('cada uma mostra o que a distingue',
      body.textContent.includes('Branco') && body.textContent.includes('Preto')
      && body.textContent.includes('P') && body.textContent.includes('M'),
      body.textContent.slice(0, 140));
    check('a pausada aparece marcada como tal', body.textContent.includes('pausado'));
    check('e não manda mais o vendedor "voltar para a lista"',
      !/volte para a lista/i.test(body.textContent), body.textContent.slice(0, 120));

    // clicar numa variação abre a ficha DELA
    await botoes[1].click();
    check('clicar na variação abre a ficha dela', M._estado().itemId === 'MLB2222222222', String(M._estado().itemId));
  }
  {
    // Produto com uma variação só: pedir pra escolher entre uma coisa é clique à toa.
    const { rotas } = mundo({ sugestoes: { MLB1111111111: RESPOSTA_A } });
    const comProduto = [
      [/\/api\/users\/me/, async () => ({ body: { id: 649733403 } })],
      [/\/api\/user-products\/[^/]+\/items/, async () => ({ body: { results: ['MLB1111111111'] } })],
    ].concat(rotas);
    const { M, el } = carregar({ rotas: comProduto });

    await M.abrirFichaIA('MLBU3935191872');
    check('com uma variação só, abre direto', M._estado().itemId === 'MLB1111111111', String(M._estado().itemId));
    check('sem tela de escolha no meio', el('ficha-ia-body').querySelectorAll('.fia-var').length === 0);
  }
  {
    // A ML não devolveu as variações: dizer o que houve, não uma parede em branco.
    const { rotas } = mundo({ sugestoes: {} });
    const comProduto = [
      [/\/api\/users\/me/, async () => ({ body: { id: 649733403 } })],
      [/\/api\/user-products\/[^/]+\/items/, async () => ({ status: 500, body: {} })],
    ].concat(rotas);
    const { M, el } = carregar({ rotas: comProduto });
    await M.abrirFichaIA('MLBU3935191872');
    const t = el('ficha-ia-body').textContent;
    check('sem variações, a tela explica e oferece tentar de novo',
      /não achei as variações/i.test(t) && /tentar de novo/i.test(t), t.slice(0, 120));
  }

  console.log('\n== clique num grupo: as irmãs vêm do Seletor, não do user-product ==');
  {
    // Quem agrupa as variações é o Seletor, por `family_id`. O `user_product_id` que ele
    // entregava é o de UMA delas — e na conta do Lucas cada variação tem o seu, com um
    // item só dentro. Sem receber as irmãs, a ficha abria direto uma variação qualquer e
    // o vendedor não escolhia nada.
    let buscouUserProduct = 0;
    const { rotas } = mundo({ sugestoes: {} });
    const comGrupo = [
      [/\/api\/user-products\//, async () => { buscouUserProduct++; return { body: { results: ['MLB1111111111'] } }; }],
      [/\/api\/fetch-item\?item_id=ML[A-Z]\d+,/, async () => ({
        body: [
          { code: 200, body: { id: 'MLB1111111111', title: 'Blusinha P', status: 'active',
            attributes: [{ id: 'SIZE', name: 'Tamanho', value_name: 'P' }] } },
          { code: 200, body: { id: 'MLB2222222222', title: 'Blusinha M', status: 'active',
            attributes: [{ id: 'SIZE', name: 'Tamanho', value_name: 'M' }] } },
        ],
      })],
    ].concat(rotas);
    const { M, el } = carregar({ rotas: comGrupo });

    // é isto que o Seletor passa quando o clique foi numa linha-produto
    await M.abrirFichaIA('MLBU3935191872', ['MLB1111111111', 'MLB2222222222']);

    const cartoes = el('ficha-ia-body').querySelectorAll('.fia-var');
    check('as duas irmãs viram escolha', cartoes.length === 2, String(cartoes.length));
    check('e o produto nem precisou ser consultado', buscouUserProduct === 0, String(buscouUserProduct));
    check('mostrando o tamanho de cada uma',
      el('ficha-ia-body').textContent.includes('P') && el('ficha-ia-body').textContent.includes('M'));
  }
  {
    // Grupo de um só (ou clique numa linha simples) continua abrindo direto.
    const { rotas } = mundo({ sugestoes: { MLB1111111111: RESPOSTA_A } });
    const { M, el } = carregar({ rotas });
    await M.abrirFichaIA('MLB1111111111', ['MLB1111111111']);
    check('grupo de uma variação abre a ficha direto', M._estado().itemId === 'MLB1111111111', String(M._estado().itemId));
    check('sem tela de escolha', el('ficha-ia-body').querySelectorAll('.fia-var').length === 0);
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
