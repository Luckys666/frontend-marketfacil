'use strict';
/*
 * Fase 4b — o cartão do lote na tela (07/09/2026): cria com o filtro escolhido, acompanha o
 * progresso com o token do ML fresco, mostra o placar derivado do banco (erro nunca some),
 * abre grupos e membros, e "Revisar" abre a ficha com a resposta pronta SEM chamar a IA.
 *
 * Rodar: node test/ficha-ia-lote.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-lote.test.js');

const LOTE = (over) => ({ id: 77, status: 'rodando', status_texto: 'Analisando seus anúncios.', filtro: 'ficha_incompleta', total: 40, feitos: 4, com_sugestao: 2, sem_sugestao: 1, erros: 1, ignorados: 0, creditos_gastos: 2, grupos: 2, chamadas_ia: 4, ...(over || {}) });
const RESPOSTA_PRONTA = { ok: true, prioritarios: ['MODEL'], sugestoes: [{ id: 'MATERIAL', acao: 'preencher', valor: 'Malha canelada', caracteres: 14, palavras_novas: ['canelada'], origens: [{ palavra: 'canelada', fonte: 'descricao', trecho: 'malha canelada' }] }], palavras_novas_sugeridas: [], palpites: [], sem_base: [], descartadas: 0 };

function montar(extra) {
  const chamadas = { post: 0, get: 0, pausar: 0, retomar: 0, gptFicha: 0 };
  let lote = LOTE();
  const rotas = [
    [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
    [/getAccessToken2/, () => ({ body: { response: { access_token: 'ML-TOKEN' } } })],
    [/gpt-ficha\/lote\/77\/grupos\/[^/]+$/, () => ({ body: { ok: true, itens: [
      { item_id: 'MLB1', titulo: 'Pastilha dianteira', status: 'pronto', resposta: RESPOSTA_PRONTA },
      { item_id: 'MLB2', titulo: 'Pastilha traseira', status: 'sem_sugestao', resposta: { sugestoes: [] } },
      { item_id: 'MLB3', titulo: 'Disco', status: 'erro', resposta: null },
    ] } })],
    [/gpt-ficha\/lote\/77\/grupos\?/, () => ({ body: { ok: true, grupos: [
      { chave: 'MLB|C1|bosch|MATERIAL#abc', representante_item_id: 'MLB1', representante_titulo: 'Pastilha dianteira', membros: 3, com_sugestao: 1 },
      { chave: 'MLB|C1|bosch|MATERIAL#def', representante_item_id: 'MLB9', representante_titulo: 'Filtro', membros: 1, com_sugestao: 1 },
    ] } })],
    [/gpt-ficha\/lote\/77\/pausar$/, () => { chamadas.pausar++; lote = LOTE({ status: 'pausado_pelo_vendedor', status_texto: 'Pausado por você.' }); return { body: { ok: true, lote } }; }],
    [/gpt-ficha\/lote\/77\/retomar$/, () => { chamadas.retomar++; lote = LOTE({ status: 'rodando' }); return { body: { ok: true, lote } }; }],
    [/gpt-ficha\/lote\/77$/, () => { chamadas.get++; return { body: { ok: true, lote, status_texto: lote.status_texto } }; }],
    [/gpt-ficha\/lote$/, (url, init) => { chamadas.post++; chamadas.corpo = JSON.parse(init.body); chamadas.headers = init.headers; return (extra && extra.aoCriar) ? extra.aoCriar() : { status: 201, body: { ok: true, lote, status_texto: 'Analisando seus anúncios.' } }; }],
    [/gpt-ficha$/, () => { chamadas.gptFicha++; return { body: RESPOSTA_PRONTA }; }],
    [/fetch-item\?item_id=MLB1$/, () => ({ body: [{ code: 200, body: { id: 'MLB1', title: 'Pastilha dianteira', category_id: 'C1', attributes: [{ id: 'BRAND', value_name: 'Bosch' }] }, description: { plain_text: 'malha canelada' } }] })],
    [/attributes\/C1/, () => ({ body: [{ id: 'BRAND', name: 'Marca', value_type: 'string', tags: {} }, { id: 'MATERIAL', name: 'Material', value_type: 'string', tags: {} }] })],
    [/catalog-quality/, () => ({ body: {} })],
  ];
  const h = carregar({ rotas, armazem: (extra && extra.armazem) || [] });
  h.doc.getElementById('fia-conta-e-lote');
  h.doc.getElementById('fia-lote');
  h.doc.getElementById('ficha-ia-view'); h.doc.getElementById('ficha-ia-body'); h.doc.getElementById('ficha-ia-painel'); h.doc.getElementById('ficha-ia-head');
  return { ...h, chamadas, setLote: (l) => { lote = l; } };
}

(async () => {
  console.log('\n== sem lote guardado: o convite, com o custo por estrutura ==');
  const { M, el, box, chamadas } = montar();
  await M.montarLote();
  const card = el('fia-lote');
  check('cartão visível com "Preencher em lote"', !card.hasAttribute('hidden') && !!card.querySelector('.fia-lote-abrir'));
  check('nenhum POST foi feito só por abrir a página', chamadas.post === 0);
  await card.querySelector('.fia-lote-abrir').click();
  check('abre as opções: incompletas marcada por padrão', !!card.querySelector('.fia-lote-opcoes') && card.querySelectorAll('input[name="fia-lote-filtro"]')[0].checked === true);
  check('o custo aparece com o ícone de crédito e a regra "ficha sem nada a fazer não gasta"', !!card.querySelector('.mf-ia') && /não gasta/.test(card.textContent));

  console.log('\n== Começar cria o lote e o placar aparece ==');
  await card.querySelector('.fia-lote-comecar').click();
  check('POST /lote com filtro ficha_incompleta', chamadas.post === 1 && chamadas.corpo.filtro === 'ficha_incompleta', JSON.stringify(chamadas.corpo));
  check('Bearer = user_id do app; X-ML-Token = token do ML', chamadas.headers.Authorization === 'Bearer user-1' && chamadas.headers['X-ML-Token'] === 'ML-TOKEN');
  check('id guardado no localStorage por usuário', box.armazem.get('mf_ficha_lote_user-1') === '77');
  check('selo "● Rodando"', /● Rodando/.test(card.querySelector('.fia-lote-selo').textContent));
  check('placar 4/40, ◆ 2, créditos 2, 2 grupos', /4\/40/.test(card.textContent) && /◆ 2/.test(card.textContent) && /2 grupos/.test(card.textContent), card.textContent);
  const barra = card.querySelector('.fia-lote-barra .fia-barra-feito');
  check('a barra mede 4/40 = 10%', /width:\s*10%/.test(barra.getAttribute('style') || ''), barra.getAttribute('style'));
  check('erro nunca some: "⚠ 1 erro" à vista', /⚠ 1 erro/.test(card.textContent));
  check('status_texto vai no title do selo, não na tela', /Analisando seus anúncios/.test(card.querySelector('.fia-lote-selo').getAttribute('title') || '') && !/Analisando seus anúncios/.test(card.textContent));
  check('há um poll agendado para 10 s', box.timers.filter(Boolean).length === 1 && box.timers.filter(Boolean)[0].ms === 10000, JSON.stringify(box.timers.map((t) => t && t.ms)));
  check('botão Pausar (uma ação por estado)', !!card.querySelector('.fia-lote-pausar') && !card.querySelector('.fia-lote-retomar'));

  console.log('\n== o poll lê o progresso com o token ==');
  await box.rodarTimers();
  check('GET /lote/77 foi feito', chamadas.get === 1);
  check('e reagendou o próximo', box.timers.filter(Boolean).length === 1);

  console.log('\n== pausar / retomar ==');
  await card.querySelector('.fia-lote-pausar').click();
  check('POST pausar; selo "◌ Pausado"; botão Retomar', chamadas.pausar === 1 && /◌ Pausado/.test(card.querySelector('.fia-lote-selo').textContent) && !!card.querySelector('.fia-lote-retomar'));
  check('pausado: poll mais lento (60 s)', box.timers.filter(Boolean).slice(-1)[0].ms === 60000);
  await card.querySelector('.fia-lote-retomar').click();
  check('POST retomar; volta a rodar', chamadas.retomar === 1 && /● Rodando/.test(card.querySelector('.fia-lote-selo').textContent));

  console.log('\n== grupos e membros ==');
  await card.querySelector('.fia-lote-ver-grupos').click();
  const grupos = card.querySelectorAll('.fia-grupo');
  check('2 grupos, com o título do representante e o placar', grupos.length === 2 && /Pastilha dianteira/.test(grupos[0].textContent) && /◆ 1/.test(grupos[0].textContent));
  await grupos[0].querySelector('.fia-grupo-abrir').click();
  const membros = card.querySelectorAll('.fia-membro');
  check('3 membros com selo por status', membros.length === 3 && /com sugestão/.test(membros[0].textContent) && /sem sugestão/.test(membros[1].textContent) && /falhou/.test(membros[2].textContent), card.textContent);
  check('"Revisar" só no que tem sugestão', card.querySelectorAll('.fia-membro-abrir').length === 1);

  console.log('\n== Revisar abre a ficha com a resposta pronta, sem IA ==');
  await card.querySelector('.fia-membro-abrir').click();
  const body = el('ficha-ia-body');
  check('a ficha do MLB1 abriu com a sugestão do lote', /Malha canelada/.test(body.innerHTML) && M._estado().itemId === 'MLB1', body.innerHTML.slice(0, 200));
  check('NENHUM POST /gpt-ficha (não gastou crédito)', chamadas.gptFicha === 0);
  check('o placar da conta e o lote somem enquanto a ficha está aberta', el('fia-conta-e-lote').hidden === true);
  M.voltarParaLista();
  check('voltar mostra o bloco de novo', el('fia-conta-e-lote').hidden === false);

  console.log('\n== concluído: Fechar limpa o id guardado ==');
  {
    const h2 = montar({ armazem: [['mf_ficha_lote_user-1', '77']] });
    h2.setLote(LOTE({ status: 'concluido', feitos: 40, total: 40, erros: 0 }));
    await h2.M.montarLote();
    const c2 = h2.el('fia-lote');
    check('lote guardado é retomado ao abrir a página (GET, sem POST)', h2.chamadas.get === 1 && h2.chamadas.post === 0);
    check('selo "✓ Concluído" e botão Fechar; sem poll', /✓ Concluído/.test(c2.querySelector('.fia-lote-selo').textContent) && !!c2.querySelector('.fia-lote-novo') && h2.box.timers.filter(Boolean).length === 0);
    check('sem erro: nada de "⚠"', !/⚠/.test(c2.textContent));
    await c2.querySelector('.fia-lote-novo').click();
    check('Fechar: volta ao convite e esquece o id', !!c2.querySelector('.fia-lote-abrir') && !h2.box.armazem.has('mf_ficha_lote_user-1'));
  }

  console.log('\n== recusas com frase própria ==');
  {
    const h3 = montar({ aoCriar: () => ({ status: 412, body: { error: 'x', code: 'creditos_desligados' } }) });
    await h3.M.montarLote();
    await h3.el('fia-lote').querySelector('.fia-lote-abrir').click();
    await h3.el('fia-lote').querySelector('.fia-lote-comecar').click();
    check('412: "ainda não está liberado"', /ainda não está liberado/.test(h3.el('fia-lote').textContent), h3.el('fia-lote').textContent);
  }
  {
    const h4 = montar({ aoCriar: () => ({ status: 409, body: { error: 'Você já tem um preenchimento em andamento.', code: 'lote_em_andamento', lote: LOTE({ id: 77 }) } }) });
    await h4.M.montarLote();
    await h4.el('fia-lote').querySelector('.fia-lote-abrir').click();
    await h4.el('fia-lote').querySelector('.fia-lote-comecar').click();
    check('409: adota o lote que já roda', /● Rodando/.test(h4.el('fia-lote').textContent) && h4.box.armazem.get('mf_ficha_lote_user-1') === '77');
  }
  {
    const h5 = montar({ aoCriar: () => ({ status: 429, body: { error: 'Seus créditos deste mês acabaram. Renovam dia 1.', code: 'sem_creditos' } }) });
    await h5.M.montarLote();
    await h5.el('fia-lote').querySelector('.fia-lote-abrir').click();
    await h5.el('fia-lote').querySelector('.fia-lote-comecar').click();
    check('429: a frase do servidor', /créditos deste mês acabaram/.test(h5.el('fia-lote').textContent));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
