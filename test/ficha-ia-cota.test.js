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
    check('tem saída: Ver meu plano', /Ver meu plano/.test(html) && /minha-conta/.test(html));
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
    // 07/09 (Lucas): "muita redundância de informação, principalmente sobre os créditos". O placar
    // NÃO repete a cota: o número vive na linha do menu lateral (e no topo só quando o menu não
    // está na tela). A resposta fresca continua alimentando o topo/menu por `mostrarCotaNoTopo`.
    check('placar NÃO repete a cota (o número vive no menu lateral)', !/análises usadas este mês/.test(html) && !/fia-placar-cota/.test(html) && !/renova dia/.test(html), html.slice(0, 600));
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
      [/creditos\/saldo$/, () => ({ body: { ok: true, ativo: false, saldo: null } })],
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

  console.log('\n== número que não é número esconde o contador, nunca vira "0 de 50" ==');
  {
    const { M, el, doc } = carregar();
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    M.mostrarCotaNoTopo({ limite: 50, usadas: 50, restante: null, renova_em: '2026-10-01' });
    check('restante null esconde o contador', el('fia-cota-topo').hasAttribute('hidden'));
  }
  {
    const { M, el, doc } = carregar();
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    M.mostrarCotaNoTopo({ limite: '', restante: 3 });
    check('limite vazio esconde o contador', el('fia-cota-topo').hasAttribute('hidden'));
  }
  {
    const { M, el, doc } = carregar();
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    M.mostrarCotaNoTopo({ limite: 50, restante: 'abc' });
    check('restante que não é número esconde o contador', el('fia-cota-topo').hasAttribute('hidden'));
  }
  {
    check('linhaCotaDoPlacar: usadas null não vira "0 de 50"', M0.linhaCotaDoPlacar({ limite: 50, usadas: null, renova_em: '2026-10-01' }) === '');
  }
  {
    check('linhaCotaDoPlacar: limite vazio some do placar', M0.linhaCotaDoPlacar({ limite: '', usadas: 3 }) === '');
  }

  console.log('\n== créditos comprados aparecem no topo, quando existem ==');
  {
    const { M, el, doc } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/creditos\/saldo$/, () => ({ body: { ok: true, ativo: true, saldo: { mes: { limite: 58, usadas: 58, restante: 0, renova_em: '2026-10-01' }, comprados: { restante: 1200, vence_em: '2026-09-06' }, total_restante: 1200 } } })],
    ] });
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    await M.carregarCota();
    const html = el('fia-cota-topo').innerHTML;
    check('mês zerado e compradas: "0 de 58" e "1.200 compradas"', /0[\s\S]*de 58 análises este mês/.test(html) && /1\.200[\s\S]*compradas/.test(html), html);
    check('diz quando as compradas vencem', /vencem dia 06\/09/.test(html));
  }
  {
    const { M, el, doc } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/creditos\/saldo$/, () => ({ body: { ok: true, ativo: false, saldo: null } })],
      [/gpt-ficha\/cota$/, () => ({ body: { ok: true, cota: { limite: 50, usadas: 3, restante: 47, renova_em: '2026-10-01' } } })],
    ] });
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    await M.carregarCota();
    check('ledger desligado: cai na cota da Fase 1', /47[\s\S]*de 50/.test(el('fia-cota-topo').innerHTML));
  }
  {
    const { M, el, doc } = carregar();
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    M.mostrarCotaNoTopo({ limite: 50, usadas: 1, restante: 49, renova_em: '2026-10-01' }, { restante: 0, vence_em: null });
    check('compradas = 0: não aparece a parte das compradas', !/compradas/.test(el('fia-cota-topo').innerHTML));
  }
  {
    const { M, el, doc } = carregar();
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    // Compradas sem data de vencimento (ex: cortesia, ou o campo ainda não veio do ledger):
    // mostra a quantidade e omite o "vencem", em vez de escrever "vencem dia" seguido de nada.
    M.mostrarCotaNoTopo({ limite: 50, usadas: 1, restante: 49, renova_em: '2026-10-01' }, { restante: 300, vence_em: null });
    const html = el('fia-cota-topo').innerHTML;
    check('compradas sem data de vencimento: mostra a quantidade e omite o "vencem"',
      !el('fia-cota-topo').hasAttribute('hidden') && /300/.test(html) && /compradas/.test(html) && !/vencem/.test(html), html);
  }

  console.log('\n== ledger indisponível: cai em Fase 1, contador não some ==');
  {
    const { M, el, doc } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/creditos\/saldo$/, () => ({ status: 503, body: { error: 'x', code: 'creditos_indisponiveis' } })],
      [/gpt-ficha\/cota$/, () => ({ body: { ok: true, cota: { limite: 50, usadas: 3, restante: 47, renova_em: '2026-10-01' } } })],
    ] });
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    await M.carregarCota();
    check('ledger fora (503): cai na cota da Fase 1, o contador não some', /47[\s\S]*de 50/.test(el('fia-cota-topo').innerHTML));
  }
  {
    const { M, el, doc } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/creditos\/saldo$/, () => ({ status: 404, body: { error: 'Not found' } })],
      [/gpt-ficha\/cota$/, () => ({ body: { ok: true, cota: { limite: 50, usadas: 3, restante: 47, renova_em: '2026-10-01' } } })],
    ] });
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    await M.carregarCota();
    check('rota de saldo ainda não existe (404): cai na cota da Fase 1', /47[\s\S]*de 50/.test(el('fia-cota-topo').innerHTML));
  }
  {
    const { M, el, doc } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/creditos\/saldo$/, () => ({ status: 503, body: { error: 'x' } })],
      [/gpt-ficha\/cota$/, () => ({ status: 500, body: { error: 'x' } })],
    ] });
    const topoEl = doc.getElementById('fia-cota-topo');
    topoEl.setAttribute('class', 'fia-cota');
    topoEl.setAttribute('hidden', '');
    const r = await M.carregarCota();
    check('as duas falham: null e escondido, nunca "0 de 50"', r === null && el('fia-cota-topo').hasAttribute('hidden'));
  }

  console.log('\n== abrirFichaIA de ponta a ponta: o contador do topo acompanha a análise ==');
  {
    // Mesmas rotas que test/ficha-ia-corridas.test.js monta para abrirFichaIA, com a
    // diferença de que /api/gpt-ficha devolve `cota` (o que a análise de verdade traz) e o
    // corpo é mutável: o segundo bloco troca os números pra provar que reabrir do cache não
    // busca de novo.
    let respostaGptFicha = {
      ok: true,
      sugestoes: [], palavras_novas_sugeridas: [], palpites: [], sem_base: [], descartadas: 0,
      cota: { limite: 50, usadas: 12, restante: 38, renova_em: '2026-10-01' },
    };
    const rotas = [
      [/getAccessToken2/, async () => ({ body: { response: { access_token: 'TOKEN-ML' } } })],
      [/get-user-id/, async () => ({ body: { response: { user_id: 'user-1' } } })],
      [/\/api\/fetch-item\?/, async () => ({ body: [{ code: 200, body: { id: 'MLB1', title: 'Panela', category_id: 'C1', site_id: 'MLB', attributes: [] }, description: { plain_text: 'd' } }] })],
      [/\/api\/attributes\//, async () => ({ body: [{ id: 'MATERIAL', name: 'Material', value_type: 'string', value_max_length: 255, tags: {} }] })],
      [/\/api\/catalog-quality/, async () => ({ status: 404, body: {} })],
      [/creditos\/saldo$/, async () => ({ body: { ok: true, ativo: false, saldo: null } })],
      [/gpt-ficha\/cota$/, async () => ({ body: { ok: true, cota: { limite: 50, usadas: 11, restante: 39, renova_em: '2026-10-01' } } })],
      [/gpt-ficha$/, async () => ({ body: respostaGptFicha })],
    ];
    const { M, el, doc, box } = carregar({ rotas });
    doc.getElementById('fia-cota-topo').setAttribute('hidden', '');

    await M.abrirFichaIA('MLB1');
    const topo1 = el('fia-cota-topo').innerHTML;
    check('refresh depois da análise: o contador do topo acompanha a resposta',
      /38[\s\S]*de 50/.test(topo1), topo1);

    // Entre a primeira e a segunda abertura, o vendedor analisou OUTRO anúncio: o número de
    // verdade caiu para 20. Reabrir a ficha de MLB1 (que vem do cache, com o 38 antigo
    // dentro) não pode reescrever por cima desse número mais recente.
    M.mostrarCotaNoTopo({ limite: 50, usadas: 30, restante: 20, renova_em: '2026-10-01' });

    const chamadasAntes = box.chamadas.filter((c) => /gpt-ficha$/.test(c.url)).length;
    // Se o cache falhasse e uma nova análise deste MESMO anúncio acontecesse, o servidor
    // devolveria isto — mas ela não pode acontecer: a resposta já está em cache.
    respostaGptFicha = { ...respostaGptFicha, cota: { limite: 50, usadas: 30, restante: 20, renova_em: '2026-10-01' } };
    await M.abrirFichaIA('MLB1');
    const chamadasDepois = box.chamadas.filter((c) => /gpt-ficha$/.test(c.url)).length;
    const topo2 = el('fia-cota-topo').innerHTML;
    check('reabrir do cache NÃO reescreve o contador (senão ele volta para trás)',
      chamadasDepois === chamadasAntes && /20[\s\S]*de 50/.test(topo2) && !/38[\s\S]*de 50/.test(topo2),
      `chamadas ${chamadasAntes}->${chamadasDepois} | ${topo2}`);
  }

  console.log('\n== sem redundância: com a linha do menu na tela, o topo fica escondido (mas avisa) ==');
  {
    // 07/09 (Lucas): "muita redundância de informação, principalmente sobre os créditos". Um lugar só.
    const { M, box, el } = carregar();
    el('fia-cota-topo');
    const menu = box.document.createElement('div');
    menu.setAttribute('class', 'mf-saldo');
    menu.getBoundingClientRect = () => ({ width: 280, height: 48 });
    box.document.body.appendChild(menu);
    const avisos = [];
    box.document.addEventListener('mf:analises-cota', (ev) => avisos.push(ev.detail));
    M.mostrarCotaNoTopo({ limite: 50, usadas: 13, restante: 37, renova_em: '2026-10-01' }, null);
    check('menu visível: o topo fica escondido', el('fia-cota-topo').hasAttribute('hidden'));
    check('mas o menu recebe o número (um lugar só, e é o menu)', avisos.length === 1 && avisos[0].cota.restante === 37, JSON.stringify(avisos));
    // Celular: o menu lateral existe no DOM mas está com largura zero → o topo aparece.
    menu.getBoundingClientRect = () => ({ width: 0, height: 0 });
    M.mostrarCotaNoTopo({ limite: 50, usadas: 13, restante: 37, renova_em: '2026-10-01' }, null);
    check('menu sem largura (celular): o topo aparece', !el('fia-cota-topo').hasAttribute('hidden'));
  }

  console.log('\n== o contador do Agente avisa o menu lateral (mesmo número nos dois lugares) ==');
  {
    const { M, box, el } = carregar();
    el('fia-cota-topo'); // o contador só desenha (e só avisa) se o elemento do topo existir
    const avisos = [];
    box.document.addEventListener('mf:analises-cota', (ev) => avisos.push(ev.detail));
    const cota = { limite: 50, usadas: 13, restante: 37, renova_em: '2026-10-01' };
    M.mostrarCotaNoTopo(cota, { restante: 300, vence_em: '2027-03-15' });
    check('disparou 1 aviso', avisos.length === 1, String(avisos.length));
    check('com a cota e as compradas', !!(avisos[0] && avisos[0].cota && avisos[0].cota.restante === 37 && avisos[0].comprados && avisos[0].comprados.restante === 300), JSON.stringify(avisos[0]));
    M.mostrarCotaNoTopo(null);
    check('sem número, não avisa (o menu manteria o que estava certo)', avisos.length === 1, String(avisos.length));
  }

  console.log('\n== quanto custa cada ação: o preço vem do proxy e aparece no botão ==');
  {
    // Lucas (06/09): "precisamos mostrar quantos créditos vão custar cada coisa… cada análise,
    // ou também criação, etc." O número vem do servidor (regra de decisão) e o front só pinta:
    // uma variável CSS no <html> que o selo dos botões "Analisar" lê via content: var(...).
    const { M, box, el } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/creditos\/saldo/, () => ({ status: 404, body: {} })],
      [/gpt-ficha\/cota$/, () => ({ body: { ok: true, cota: { limite: 50, usadas: 10, restante: 40, renova_em: '2026-10-01' }, precos: { ficha_analise: 1 } } })],
    ] });
    el('fia-cota-topo');
    await M.carregarCota();
    check('o preço da análise fica guardado', M._estado().precos && M._estado().precos.ficha_analise === 1, JSON.stringify(M._estado().precos));
    check('e vira variável CSS no <html> (string entre aspas, para content:)', box.document.documentElement._vars['--mf-custo-ficha'] === '"1"', JSON.stringify(box.document.documentElement._vars));
    check('o selo do botão tem o lugar do número (mf-ia-custo)', /class="mf-ia-custo"/.test(String(box.MFSEL_HOST.iconeBotao || '')), String(box.MFSEL_HOST.iconeBotao).slice(0, 200));
    check('o contador do topo diz quanto custa cada análise', /1 crédito/.test(el('fia-cota-topo').innerHTML), el('fia-cota-topo').innerHTML.slice(0, 220));
  }
  {
    const { M, box, el } = carregar({ rotas: [
      [/get-user-id/, () => ({ body: { response: { user_id: 'user-1' } } })],
      [/creditos\/saldo/, () => ({ status: 404, body: {} })],
      [/gpt-ficha\/cota$/, () => ({ body: { ok: true, cota: null } })],
    ] });
    el('fia-cota-topo');
    await M.carregarCota();
    check('sem preço do servidor, nenhuma variável é gravada (o botão fica só com o ícone)', !('--mf-custo-ficha' in box.document.documentElement._vars), JSON.stringify(box.document.documentElement._vars));
  }

  console.log('\n== ícone de crédito de IA: o mesmo sparkle do menu, no contador e nos botões do Agente ==');
  {
    const { M, box, el } = carregar();
    el('fia-cota-topo');
    M.mostrarCotaNoTopo({ limite: 50, usadas: 13, restante: 37, renova_em: '2026-10-01' }, null);
    check('contador do topo começa com o sparkle', /^\s*<svg class="mf-ia"/.test(el('fia-cota-topo').innerHTML), el('fia-cota-topo').innerHTML.slice(0, 120));
    check('o Agente entrega o ícone ao Seletor pelo host (botões "Analisar" ganham o selo só aqui)', box.MFSEL_HOST && /<svg class="mf-ia"/.test(String(box.MFSEL_HOST.iconeBotao || '')), String(box.MFSEL_HOST && box.MFSEL_HOST.iconeBotao).slice(0, 120));
    check('o selo do botão explica quando gasta', /Usa crédito de IA/.test(String(box.MFSEL_HOST.iconeBotao || '')));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
