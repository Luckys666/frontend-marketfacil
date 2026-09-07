'use strict';
/*
 * Desfazer (07/09/2026, Lucas: "se a pessoa aprovar acidentalmente algo não tem como
 * reverter"). Cada gravação guarda o valor de antes; "Desfazer" grava de volta pela mesma rota
 * — campo que estava vazio volta a ficar vazio (value_name: null) — com origem própria (o proxy
 * não conta como aplicação), restaura as sugestões e o placar, e o histórico marca "desfeito".
 *
 * Rodar: node test/ficha-ia-desfazer.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-desfazer.test.js');

const campo = (id, name, extra) => ({ id, name, value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false, tags: {}, ...(extra || {}) });
const CAMPOS = () => [campo('BRAND', 'Marca', { preenchido: true, valor_atual: 'Kiran' }), campo('MATERIAL', 'Material'), campo('MODEL', 'Modelo')];
const DETALHE = () => ({ id: 'MLB1', title: 'Blusa', attributes: [{ id: 'BRAND', value_name: 'Kiran' }] });
const sug = (id, valor, extra) => ({ id, acao: 'preencher', valor, caracteres: valor.length, palavras_novas: ['x' + id.toLowerCase()], origens: [{ palavra: valor, fonte: 'descricao', trecho: valor }], ...(extra || {}) });
const DADOS = () => ({ ok: true, prioritarios: [], sugestoes: [sug('MATERIAL', 'Malha canelada'), sug('BRAND', 'Kiran Basics', { acao: 'trocar', atual: 'Kiran' })], palavras_novas_sugeridas: [], palpites: [], sem_base: [{ id: 'MODEL', name: 'Modelo' }], descartadas: 0 });

function montar(rotas) {
  const h = carregar({ rotas });
  const e = h.M._estado();
  e.itemId = 'MLB1'; e.detail = DETALHE(); e.campos = CAMPOS(); e.token = 'tok'; e.userId = 'user-1'; e.resposta = DADOS();
  h.M.renderPainel('ficha-ia-body', { estado: 'ok', dados: e.resposta, campos: e.campos, placar: h.M.contarPlacar(e.campos) });
  h.M.ligarBotoes();
  return h;
}

(async () => {
  console.log('\n== salvar guarda o antes; a tela mostra o histórico com Desfazer ==');
  const devolvido = { id: 'MLB1', attributes: [{ id: 'BRAND', value_name: 'Kiran Basics' }, { id: 'MATERIAL', value_name: 'Malha canelada' }] };
  const { M, el, box } = montar([[/fetch-item-update/, () => ({ body: devolvido })]]);
  const body = el('ficha-ia-body');
  await body.querySelector('.fia-aplicar-tudo').click();
  check('um PUT com os 2 campos', box.chamadas.filter((c) => /fetch-item-update/.test(c.url)).length === 1 && JSON.parse(box.chamadas[0].init.body).attributes.length === 2);
  check('placar subiu para 2 de 3', /2 de 3/.test(body.querySelector('.fia-placar').textContent), body.querySelector('.fia-placar').textContent);
  const hist = body.querySelector('.fia-historico');
  check('histórico com uma linha "Salvo" e os nomes dos campos', !!hist && /Salvo/.test(hist.textContent) && /Material/.test(hist.textContent) && /Marca/.test(hist.textContent), hist && hist.textContent);
  const btn = hist.querySelector('.fia-desfazer');
  check('a linha tem o botão Desfazer', !!btn);
  const h = M.historicoDoAnuncio('MLB1');
  check('o antes foi fotografado: Marca era "Kiran", Material era vazio', h.length === 1 && h[0].campos.find((c) => c.id === 'BRAND').de === 'Kiran' && h[0].campos.find((c) => c.id === 'MATERIAL').de === '', JSON.stringify(h[0] && h[0].campos));
  check('as sugestões saíram da tela', !body.querySelector('.fia-secao[data-secao="achei"]') && !body.querySelector('.fia-secao[data-secao="trocar"]'));

  console.log('\n== Desfazer grava o antes de volta ==');
  await btn.click();
  const puts = box.chamadas.filter((c) => /fetch-item-update/.test(c.url));
  check('segundo PUT', puts.length === 2);
  const corpo = JSON.parse(puts[1].init.body);
  const marca = corpo.attributes.find((a) => a.id === 'BRAND');
  const material = corpo.attributes.find((a) => a.id === 'MATERIAL');
  check('Marca volta para "Kiran"', marca && marca.value_name === 'Kiran', JSON.stringify(corpo));
  check('Material, que estava vazio, é APAGADO (value_name null)', material && material.value_name === null && material.value_id === null, JSON.stringify(material));
  check('origem "agente-ficha-desfazer" (o proxy não conta como aplicação)', puts[1].init.headers['X-MF-Origem'] === 'agente-ficha-desfazer');
  const e = M._estado();
  check('estado local voltou: Material vazio, Marca = Kiran', e.campos.find((c) => c.id === 'MATERIAL').preenchido === false && e.campos.find((c) => c.id === 'BRAND').valor_atual === 'Kiran');
  check('detail.attributes sem MATERIAL e com BRAND = Kiran', !e.detail.attributes.find((a) => a.id === 'MATERIAL') && e.detail.attributes.find((a) => a.id === 'BRAND').value_name === 'Kiran');
  check('placar voltou para 1 de 3', /1 de 3/.test(body.querySelector('.fia-placar').textContent), body.querySelector('.fia-placar').textContent);
  check('as sugestões voltaram para a tela', !!body.querySelector('.fia-secao[data-secao="achei"]') && !!body.querySelector('.fia-secao[data-secao="trocar"]'));
  const hist2 = body.querySelector('.fia-historico');
  check('a primeira linha está "desfeito" e sem botão; a segunda é "Desfeito" e pode ser desfeita de novo (refazer)',
    hist2.querySelectorAll('.fia-hist-linha').length === 2 && /desfeito/.test(hist2.querySelectorAll('.fia-hist-linha')[0].textContent) && hist2.querySelectorAll('.fia-desfazer').length === 1, hist2.textContent);
  check('mensagem "Desfeito: 2 campos voltaram como estavam."', /Desfeito: 2 campos voltaram/.test(body.textContent));

  console.log('\n== o histórico é por anúncio ==');
  check('outro anúncio não vê este histórico', M.historicoDoAnuncio('MLB2').length === 0);

  console.log('\n== campo que muda o link: o Desfazer avisa ==');
  {
    const campos = [campo('COLOR', 'Cor', { preenchido: true, valor_atual: 'Rosa', _mudaLink: true, hierarchy: 'CHILD_PK' })];
    const h = carregar({ rotas: [[/fetch-item-update/, () => ({ body: { id: 'MLB2', attributes: [{ id: 'COLOR', value_name: 'Rosa claro' }] } })]] });
    const e2 = h.M._estado();
    e2.itemId = 'MLB2'; e2.detail = { id: 'MLB2', title: 'Sapatilha', user_product_id: 'MLBU1', attributes: [{ id: 'COLOR', value_name: 'Rosa' }] }; e2.campos = campos; e2.token = 'tok'; e2.userId = 'u';
    e2.resposta = { ok: true, sugestoes: [sug('COLOR', 'Rosa claro', { acao: 'trocar', atual: 'Rosa' })], palavras_novas_sugeridas: [], palpites: [], sem_base: [] };
    h.M.renderPainel('ficha-ia-body', { estado: 'ok', dados: e2.resposta, campos, placar: h.M.contarPlacar(campos) });
    h.M.ligarBotoes();
    const b2 = h.el('ficha-ia-body');
    await b2.querySelector('.fia-aplicar-um').click();
    const d = b2.querySelector('.fia-desfazer');
    check('o Desfazer de um campo que muda o link é vermelho e avisa no title', !!d && d.classList.contains('fia-perigo') && /link/.test(d.getAttribute('title') || ''), d && d.getAttribute('title'));
  }

  console.log('\n== falha no desfazer: nada é restaurado, o erro aparece ==');
  {
    let vez = 0;
    const h = montar([[/fetch-item-update/, () => (vez++ === 0 ? { body: devolvido } : { status: 400, body: { message: 'ML recusou' } })]]);
    const b3 = h.el('ficha-ia-body');
    await b3.querySelector('.fia-aplicar-tudo').click();
    await b3.querySelector('.fia-desfazer').click();
    const e3 = h.M._estado();
    check('estado continua salvo (não fingiu que desfez)', e3.campos.find((c) => c.id === 'MATERIAL').preenchido === true);
    check('erro na tela e o Desfazer continua disponível', !!b3.querySelector('.fia-erro') && !!b3.querySelector('.fia-desfazer'));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
