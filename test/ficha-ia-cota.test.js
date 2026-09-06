'use strict';
/*
 * Créditos na tela: o 429 de cota NÃO é "muita gente analisando", e o placar mostra as
 * análises do mês. Falha nunca vira zero: sem saldo lido, o contador some.
 *
 * Rodar: node test/ficha-ia-cota.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-cota.test.js');

const COTA_ESGOTADA = {
  error: 'Você usou as 50 análises de ficha deste mês. Renova em 01/10/2026.',
  code: 'cota_mensal',
  cota: { limite: 50, usadas: 50, restante: 0, renova_em: '2026-10-01' },
};
const PAYLOAD = { item_id: 'MLB1', campos: [], palavras_que_faltam: [] };

(async () => {
  const M0 = carregar().M;

  console.log('\n== 429 com código de cota vira estado "cota" ==');
  {
    const { M } = carregar({ rotas: [[/gpt-ficha$/, () => ({ status: 429, body: COTA_ESGOTADA })]] });
    const r = await M.buscarSugestoes(PAYLOAD, 'user-1', 'tok', null);
    check('estado = cota', r.estado === 'cota', JSON.stringify(r));
    check('dados carregam o corpo do servidor (cota e mensagem)', r.dados && r.dados.cota && r.dados.cota.limite === 50 && /Renova/.test(r.dados.error));
  }
  {
    const { M } = carregar({ rotas: [[/gpt-ficha$/, () => ({ status: 429, body: { ...COTA_ESGOTADA, code: 'sem_creditos' } })]] });
    const r = await M.buscarSugestoes(PAYLOAD, 'user-1', 'tok', null);
    check('sem_creditos (Fase 2) cai no MESMO estado', r.estado === 'cota');
  }
  {
    const { M } = carregar({ rotas: [[/gpt-ficha$/, () => ({ status: 429, body: { error: 'A IA está ocupada agora.' } })]] });
    const r = await M.buscarSugestoes(PAYLOAD, 'user-1', 'tok', null);
    check('429 SEM código continua sendo "ocupado"', r.estado === 'ocupado' && r.dados === null, JSON.stringify(r));
  }

  console.log('\n== estado "cota": diz quando renova e leva para Minha Conta ==');
  {
    const { M, el } = carregar();
    M.renderPainel('ficha-ia-body', { estado: 'cota', dados: COTA_ESGOTADA, campos: [], placar: { preenchidos: 0, total: 0 } });
    const html = el('ficha-ia-body').innerHTML;
    check('título fala das análises do mês', /análises deste mês acabaram/i.test(html), html.slice(0, 300));
    check('mostra a mensagem do servidor (a data de renovação está nela)', /01\/10\/2026/.test(html), html.slice(0, 300));
    check('não é "muita gente analisando"', !/muita gente/i.test(html));
    check('tem saída: Ver meus créditos', /Ver meus créditos/.test(html) && /minha-conta/.test(html));
    check('sem botão "tentar de novo" (não adianta insistir)', !/fia-retry/.test(html));
    check('sem travessão', !/[—–―]/.test(html));
  }
  {
    const { M, el } = carregar();
    M.renderPainel('ficha-ia-body', { estado: 'cota', dados: null, campos: [], placar: { preenchidos: 0, total: 0 } });
    check('sem corpo do servidor ainda explica que renova no começo do mês', /começo do mês/i.test(el('ficha-ia-body').innerHTML));
  }

  console.log('\n== placar: as análises do mês aparecem quando a resposta traz cota ==');
  {
    const { M, el } = carregar();
    const campos = [{ id: 'MATERIAL', name: 'Material', value_type: 'string', preenchido: false, obrigatorio: true, _mudaLink: false, _extra: false }];
    const dados = { ok: true, sugestoes: [{ id: 'MATERIAL', acao: 'preencher', valor: 'Aço inox', caracteres: 8, palavras_novas: ['inox'], origens: [{ palavra: 'inox', fonte: 'descricao', trecho: 'inox' }] }],
      palavras_novas_sugeridas: [], palpites: [], sem_base: [], descartadas: 0,
      cota: { limite: 50, usadas: 38, restante: 12, renova_em: '2026-10-01' } };
    M.renderPainel('ficha-ia-body', { estado: 'ok', dados, campos, placar: M.contarPlacar(campos) });
    const html = el('ficha-ia-body').innerHTML;
    check('placar mostra "38 de 50 análises usadas este mês"', /38 de 50 análises usadas este mês/.test(html), html.slice(0, 600));
    check('e diz quando renova', /renova dia 01\/10/i.test(html));
  }
  {
    const { M, el } = carregar();
    const campos = [{ id: 'MATERIAL', name: 'Material', value_type: 'string', preenchido: false, obrigatorio: true, _mudaLink: false, _extra: false }];
    const dados = { ok: true, sugestoes: [], palavras_novas_sugeridas: [], palpites: [], sem_base: [{ id: 'MATERIAL', name: 'Material' }], descartadas: 0 };
    M.renderPainel('ficha-ia-body', { estado: 'ok', dados, campos, placar: M.contarPlacar(campos) });
    check('sem cota na resposta, o placar NÃO inventa número', !/análises usadas/.test(el('ficha-ia-body').innerHTML));
  }
  check('formatarDia: 2026-10-01 -> 01/10', M0.formatarDia('2026-10-01') === '01/10', M0.formatarDia('2026-10-01'));
  check('formatarDia: lixo -> vazio', M0.formatarDia('') === '' && M0.formatarDia(null) === '');

  console.log('\n== contador no topo: aparece com saldo lido, some sem ele ==');
  {
    const { M, el, doc } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/gpt-ficha\/cota$/, () => ({ body: { ok: true, cota: { limite: 50, usadas: 38, restante: 12, renova_em: '2026-10-01' } } })],
    ] });
    // O mini-dom não linka `body.innerHTML` ao cache de `getElementById` (`el()` usa
    // `getElementById`): criar o nó por `body.innerHTML` deixaria `el()` devolver um div
    // fantasma, desconectado do que `carregarCota` de fato altera. Criar pelo próprio
    // `getElementById` mantém os dois olhando o MESMO nó.
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    doc.getElementById('ficha-ia-body');
    const cota = await M.carregarCota();
    const topo = el('fia-cota-topo');
    check('carregarCota devolve a cota', cota && cota.restante === 12, JSON.stringify(cota));
    check('topo visível', !topo.hasAttribute('hidden'));
    check('topo diz "Você ainda tem 12 de 50 análises este mês"', /Você ainda tem[\s\S]*12[\s\S]*de 50 análises este mês/.test(topo.innerHTML), topo.innerHTML);
    check('e quando renova', /renovam dia 01\/10/.test(topo.innerHTML));
  }
  {
    const { M, el, doc } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/gpt-ficha\/cota$/, () => ({ body: { ok: true, cota: null } })],
    ] });
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    await M.carregarCota();
    check('sem cota configurada: topo continua escondido', el('fia-cota-topo').hasAttribute('hidden'));
  }
  {
    const { M, el, doc } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/gpt-ficha\/cota$/, () => ({ status: 500, body: { error: 'x' } })],
    ] });
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    const r = await M.carregarCota();
    check('falha ao ler: devolve null e NÃO mostra "0 de 50"', r === null && el('fia-cota-topo').hasAttribute('hidden'));
  }
  {
    const { M, el, doc } = carregar();
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    M.mostrarCotaNoTopo({ limite: 50, usadas: 50, restante: 0, renova_em: '2026-10-01' });
    check('restante 0 é número real, não falha: mostra "0 de 50"', /0[\s\S]*de 50 análises/.test(el('fia-cota-topo').innerHTML) && !el('fia-cota-topo').hasAttribute('hidden'));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
