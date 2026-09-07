'use strict';
/*
 * Placar da conta (gamificação N2, 07/09/2026): "Ficha ▰▰▰ 812/1.240 ▲ 37 +140" com os
 * números prontos do proxy. MEDE a barra. Falha nunca vira zero: sem número, o bloco some.
 *
 * Rodar: node test/ficha-ia-conta.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-conta.test.js');

const pct = (el) => { const m = el && /width:\s*([\d.]+)%/.exec(el.getAttribute('style') || ''); return m ? Number(m[1]) : null; };
const ROTAS_BASE = [
  [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
  [/getAccessToken2/, () => ({ body: { response: { access_token: 'ML-TOKEN' } } })],
];
function montar(conta) {
  const h = carregar({ rotas: ROTAS_BASE.concat([[/gpt-ficha\/conta/, conta]]) });
  h.doc.getElementById('fia-conta');
  return h;
}

(async () => {
  console.log('\n== números prontos do proxy viram barra + número + selos ==');
  {
    const { M, el, box } = montar(() => ({ body: { ok: true, total: 1240, incompletos: 428, completos: 812, aplicados_ciclo: 140, concluidos_ciclo: 37, renova_em: '2026-09-30' } }));
    const d = await M.carregarConta();
    const alvo = el('fia-conta');
    check('carregou', !!d && !alvo.hasAttribute('hidden'));
    const req = box.chamadas.find((c) => /gpt-ficha\/conta/.test(c.url));
    check('manda o user_id no Bearer e o token do ML no X-ML-Token', req && req.init.headers.Authorization === 'Bearer user-1' && req.init.headers['X-ML-Token'] === 'ML-TOKEN');
    check('número 812/1.240 em pt-BR', /812\/1\.240/.test(alvo.textContent), alvo.textContent);
    check('a barra mede 812/1240 = 65%', pct(alvo.querySelector('.fia-barra-feito')) === 65, String(pct(alvo.querySelector('.fia-barra-feito'))));
    check('▲ 37 e +140 aparecem', /▲ 37/.test(alvo.textContent) && /\+140/.test(alvo.textContent));
    check('sem 🎉 com incompletos > 0', !/🎉/.test(alvo.innerHTML));
    check('a barra avisa no title que a ML demora até 1 h', /1 hora/.test(alvo.innerHTML));
    check('nada em frase: só rótulo "Ficha"', !/anúncios ativos/.test(alvo.textContent));
  }

  console.log('\n== zeros do ciclo não viram selo; conta completa ganha 🎉 uma vez ==');
  {
    const { M, el } = montar(() => ({ body: { ok: true, total: 30, incompletos: 0, completos: 30, aplicados_ciclo: 0, concluidos_ciclo: 0 } }));
    await M.carregarConta();
    const alvo = el('fia-conta');
    check('sem ▲ e sem + quando é zero', !/▲/.test(alvo.textContent) && !/\+/.test(alvo.textContent), alvo.textContent);
    check('🎉 uma vez', (alvo.innerHTML.match(/🎉/g) || []).length === 1);
    check('barra 100%', pct(alvo.querySelector('.fia-barra-feito')) === 100);
  }

  console.log('\n== medidores null (banco fora): a barra fica, os selos somem ==');
  {
    const { M, el } = montar(() => ({ body: { ok: true, total: 10, incompletos: 4, completos: 6, aplicados_ciclo: null, concluidos_ciclo: null } }));
    await M.carregarConta();
    const alvo = el('fia-conta');
    check('barra e número presentes', /6\/10/.test(alvo.textContent) && !/▲/.test(alvo.textContent) && !/\+/.test(alvo.textContent));
  }

  console.log('\n== falha nunca vira zero ==');
  {
    const { M, el } = montar(() => ({ status: 503, body: { error: 'O Mercado Livre não respondeu agora.', code: 'ml_indisponivel' } }));
    const d = await M.carregarConta();
    check('503: bloco oculto, sem número', d === null && el('fia-conta').hasAttribute('hidden'));
  }
  {
    const { M, el } = montar(() => ({ body: { ok: true, total: 0, incompletos: 0, completos: 0 } }));
    await M.carregarConta();
    check('conta sem anúncio ativo: oculto (não "0/0")', el('fia-conta').hasAttribute('hidden'));
  }
  {
    const { M, el } = montar(() => ({ __erro: 'rede caiu' }));
    const d = await M.carregarConta();
    check('rede caiu: oculto', d === null && el('fia-conta').hasAttribute('hidden'));
  }
  {
    const { M, box } = carregar({ rotas: ROTAS_BASE });
    const d = await M.carregarConta();
    check('página sem o bloco: não chama nada', d === null && !box.chamadas.some((c) => /gpt-ficha\/conta/.test(c.url)));
  }

  console.log('\n== contador do topo: reavalia quando a tela muda de tamanho ==');
  {
    const { M, el, doc } = carregar();
    const topo = el('fia-cota-topo');
    // Um menu lateral "na tela" (largura > 0), como no desktop.
    const menu = doc.createElement('div'); menu.setAttribute('class', 'mf-saldo'); menu.getBoundingClientRect = () => ({ width: 280, height: 48 });
    doc.body.appendChild(menu);
    M.mostrarCotaNoTopo({ limite: 50, usadas: 12, restante: 38, renova_em: '2026-10-01' });
    check('menu visível: o topo fica oculto', topo.hasAttribute('hidden'));
    // Virou celular: o menu sumiu (largura 0). Sem resize, o topo continuaria oculto.
    menu.getBoundingClientRect = () => ({ width: 0, height: 0 });
    M.reavaliarCotaTopo();
    check('menu sumiu (largura 0): reavaliar mostra o topo', !topo.hasAttribute('hidden'));
    menu.getBoundingClientRect = () => ({ width: 280, height: 48 });
    M.reavaliarCotaTopo();
    check('menu voltou: o topo some de novo', topo.hasAttribute('hidden'));
  }
  {
    const { M, el } = carregar();
    const topo = el('fia-cota-topo');
    M.mostrarCotaNoTopo(null);
    M.reavaliarCotaTopo();
    check('sem número lido, reavaliar nunca mostra o topo', topo.hasAttribute('hidden'));
  }

  console.log('\n== htmlDaConta é puro e valida ==');
  {
    const { M } = carregar();
    check('total inválido: vazio', M.htmlDaConta({ total: 'x', completos: 1 }) === '' && M.htmlDaConta(null) === '');
    check('completos acima do total é cortado no total', /5\/5/.test(M.htmlDaConta({ total: 5, completos: 9, incompletos: 0 })));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
