'use strict';
/*
 * A gaveta do SKU na tela (07/09/2026): nasce DESMARCADA, com o aviso do ERP à vista, fora do
 * "Aplicar tudo" enquanto desmarcada, e grava SELLER_SKU pela mesma rota, com os cabeçalhos
 * que identificam o Agente para o proxy medir. Com variações, nem vira PUT.
 *
 * Rodar: node test/ficha-ia-gaveta.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-gaveta.test.js');

const campo = (id, name, extra) => ({ id, name, value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false, tags: {}, ...(extra || {}) });
const CAMPOS = [campo('BRAND', 'Marca', { preenchido: true, valor_atual: 'Kiran' }), campo('MATERIAL', 'Material')];
const GAVETA = { id: 'SELLER_SKU', name: 'SKU', valor: 'manga-longa-academia-inverno', caracteres: 28, maximo: 255, buscas: 60, palavras_novas: ['manga', 'longa', 'academia', 'inverno'], entraram: [{ palavra: 'manga longa', buscas: 30 }, { palavra: 'academia', buscas: 20 }, { palavra: 'inverno', buscas: 10 }], combos: ['blusa manga longa'] };
const sug = (id, valor) => ({ id, acao: 'preencher', valor, caracteres: valor.length, palavras_novas: ['x' + id.toLowerCase()], origens: [{ palavra: valor, fonte: 'descricao', trecho: valor }] });
const DADOS = { ok: true, prioritarios: [], sugestoes: [sug('MATERIAL', 'Malha canelada macia')], palavras_novas_sugeridas: [], palpites: [], sem_base: [], gaveta_sku: GAVETA, descartadas: 0 };
const DETALHE = { id: 'MLB1', title: 'Blusa', attributes: [{ id: 'BRAND', value_name: 'Kiran' }] };

(async () => {
  console.log('\n== render ==');
  {
    const { M, el } = carregar();
    M.renderPainel('ficha-ia-body', { estado: 'ok', dados: DADOS, campos: CAMPOS, placar: M.contarPlacar(CAMPOS) });
    const body = el('ficha-ia-body');
    const sec = body.querySelector('.fia-secao-gaveta');
    check('a seção da gaveta existe', !!sec);
    check('título diz que é o SKU', /SKU/.test(sec.querySelector('.fia-secao-titulo').textContent));
    check('aviso do ERP à vista', /ERP/.test(sec.querySelector('.fia-aviso-gaveta').textContent));
    const cb = sec.querySelector('.fia-check-nova');
    check('nasce DESMARCADA', !!cb && cb.checked === false);
    const entrada = sec.querySelector('.fia-valor');
    check('o valor vem com hífen e o teto é 255', entrada.value === GAVETA.valor && entrada.getAttribute('data-max') === '255' && entrada.getAttribute('maxlength') === '255');
    check('contador mostra n/255, não /30', /28\/255/.test(sec.querySelector('.fia-chars').textContent));
    check('selo de ganho por estrutura (+3 · 60 buscas)', /\+3 · 60 buscas/.test(sec.textContent));
    check('"Aplicar tudo" não conta a gaveta desmarcada', /\(1\)/.test(body.querySelector('.fia-aplicar-tudo').textContent), body.querySelector('.fia-aplicar-tudo').textContent);
    check('o placar da ficha não conta o SKU como campo', /1 de 2/.test(body.querySelector('.fia-placar').textContent));
    check('botão da seção nasce em (0)', /\(0\)/.test(sec.querySelector('.fia-aplicar-secao').textContent));
  }

  console.log('\n== sem gaveta na resposta: nada muda ==');
  {
    const { M, el } = carregar();
    M.renderPainel('ficha-ia-body', { estado: 'ok', dados: { ...DADOS, gaveta_sku: null }, campos: CAMPOS, placar: M.contarPlacar(CAMPOS) });
    check('sem seção', !el('ficha-ia-body').querySelector('.fia-secao-gaveta'));
    const so = { ...DADOS, sugestoes: [] };
    M.renderPainel('ficha-ia-body', { estado: 'ok', dados: so, campos: CAMPOS, placar: M.contarPlacar(CAMPOS) });
    check('só a gaveta: a tela não diz "não achei base"', !!el('ficha-ia-body').querySelector('.fia-secao-gaveta') && !/Não achei base/.test(el('ficha-ia-body').textContent));
  }

  console.log('\n== marcar e gravar: PUT em SELLER_SKU com os cabeçalhos do Agente ==');
  {
    const { M, el, box } = carregar({ rotas: [
      [/fetch-item-update/, () => ({ body: { id: 'MLB1', attributes: [{ id: 'BRAND', value_name: 'Kiran' }, { id: 'SELLER_SKU', value_name: GAVETA.valor }] } })],
    ] });
    const e = M._estado();
    e.itemId = 'MLB1'; e.detail = JSON.parse(JSON.stringify(DETALHE)); e.campos = JSON.parse(JSON.stringify(CAMPOS)); e.token = 'tok'; e.userId = 'user-1'; e.resposta = JSON.parse(JSON.stringify(DADOS));
    M.renderPainel('ficha-ia-body', { estado: 'ok', dados: e.resposta, campos: e.campos, placar: M.contarPlacar(e.campos) });
    M.ligarBotoes();
    const body = el('ficha-ia-body');
    const cb = body.querySelector('.fia-secao-gaveta .fia-check-nova');
    cb.checked = true;
    await cb.dispatchEvent({ type: 'change', target: cb });
    check('marcada: o botão da seção diz (1)', /\(1\)/.test(body.querySelector('.fia-secao-gaveta .fia-aplicar-secao').textContent));
    check('e o "+N" do placar conta as 4 palavras da gaveta', /\+5 palavras/.test(body.querySelector('#fia-tokens').textContent), body.querySelector('#fia-tokens').textContent);
    await body.querySelector('.fia-secao-gaveta .fia-aplicar-secao').click();
    const put = box.chamadas.find((c) => /fetch-item-update/.test(c.url));
    check('houve um PUT', !!put && put.init.method === 'PUT');
    const corpo = put ? JSON.parse(put.init.body) : {};
    check('grava SELLER_SKU com o valor da gaveta', corpo.attributes && corpo.attributes.length === 1 && corpo.attributes[0].id === 'SELLER_SKU' && corpo.attributes[0].value_name === GAVETA.valor, JSON.stringify(corpo));
    check('cabeçalho de origem do Agente e x-user-id (não o token do ML)', put.init.headers['X-MF-Origem'] === 'agente-ficha' && put.init.headers['x-user-id'] === 'user-1' && put.init.headers.Authorization === 'Bearer tok');
    check('depois de salvar a gaveta some da tela', !body.querySelector('.fia-secao-gaveta'));
    check('o histórico registra o SKU com "Desfazer"', !!body.querySelector('.fia-historico') && /SKU/.test(body.querySelector('.fia-historico').textContent) && !!body.querySelector('.fia-desfazer'));
    check('mensagem de sucesso', /1 campo preenchido agora/.test(body.textContent));
  }

  console.log('\n== com variações: a trava de sempre recusa antes do PUT ==');
  {
    const { M, box } = carregar();
    const r = await M.aplicar('MLB1', [{ id: 'SELLER_SKU', valor: 'a-b' }], [M.CAMPO_GAVETA], { ...DETALHE, variations: [{ id: 1 }] }, 'tok');
    check('não chamou o proxy', box.chamadas.length === 0);
    check('explica que é por variação', r.ok === false && /varia/i.test(r.erro), r.erro);
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
