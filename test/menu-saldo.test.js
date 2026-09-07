'use strict';
/*
 * Linha de créditos de IA no menu lateral (js/menu-saldo.js).
 *
 * O que ele promete, e o que cada bloco aqui trava:
 *  - fala em créditos de IA (carteira de toda função com IA); sempre diz quando renova;
 *  - a barra MEDE o que resta (largura em %), sem cor de alarme;
 *  - falha, cota desligada ou número inválido = cartão oculto, nunca "0 de 0";
 *  - a primeira pintura vem do sessionStorage (2 min) e a resposta fresca sobrescreve;
 *  - o aviso do Agente (evento no document) atualiza o cartão sem nova chamada;
 *  - o reusable pode estar 2x na página: pinta em todas as cópias.
 *
 * Rodar: node test/menu-saldo.test.js
 */
const fs = require('fs');
const path = require('path');
const { carregar } = require('./harness-menu-saldo');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('menu-saldo.test.js');

const COTA = { limite: 50, usadas: 12, restante: 38, renova_em: '2026-10-01' };
const ZERADA = { limite: 50, usadas: 50, restante: 0, renova_em: '2026-10-01' };
const COMPRADOS = { restante: 300, vence_em: '2027-03-15' };
// Raiz pintada por innerHTML tem innerHTML; nó filho parseado só tem textContent. Os dois valem.
const texto = (el) => String(el.innerHTML || el.textContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const larguraDaBarra = (raiz) => {
  const cheio = raiz.querySelector('.mf-saldo-cheio');
  const m = cheio && /width:\s*([\d.]+)%/.exec(cheio.getAttribute('style') || '');
  return m ? Number(m[1]) : null;
};
const rotaSaldo = (body, status) => [/creditos\/saldo/, () => ({ status: status || 200, body })];
const rotaCota = (body, status) => [/gpt-ficha\/cota/, () => ({ status: status || 200, body })];
const rotaUid = (uid) => [/get-user-id/, () => ({ body: { response: { user_id: uid === undefined ? 'user-1' : uid } } })];

(async () => {
  console.log('\n== render com números: uma frase de vendedor, barra medida, sem alarme ==');
  {
    const { M, raiz } = carregar();
    M.render(COTA, null);
    const r = raiz();
    check('cartão visível', !r.hasAttribute('hidden'));
    check('sem título/caixa: a unidade vai na própria linha', !/Análises com IA/.test(texto(r)) && /créditos de IA/.test(texto(r)), texto(r));
    check('"38 de 50 créditos de IA" (carteira de toda função com IA, não só análises)', /38 de 50 créditos de IA/.test(texto(r)), texto(r));
    check('diz quando renova, no formato do Agente (01/10)', /renovam 01\/10/.test(texto(r)), texto(r));
    check('duas linhas curtas e a barra: no máximo 4 divs (linha, barra, cheio, rodapé)', r.querySelectorAll('div').length <= 4, String(r.querySelectorAll('div').length));
    check('a 1ª linha é só "38 de 50 créditos de IA" (cabe em 224 px sem reticências)', /^38 de 50 créditos de IA$/.test(texto(r.querySelector('.mf-saldo-txt'))), texto(r.querySelector('.mf-saldo-txt')));
    check('barra mede o que RESTA: 76%', larguraDaBarra(r) === 76, String(larguraDaBarra(r)));
    check('nenhuma classe de alarme (alerta/vermelho/ambar)', !/alerta|vermelh|ambar|warn|danger/i.test(r.innerHTML));
    check('não fala em "análises" na linha (a unidade é o crédito; a análise é só o uso de hoje)', !/análises/.test(texto(r)), texto(r));
    check('sem travessão', !/[—–―]/.test(r.innerHTML));
    check('ícone de crédito de IA (sparkle SVG) antes do número, na mesma linha', /<svg class="mf-ia"[\s\S]*?<\/svg>\s*<b>38<\/b>/.test(r.innerHTML), r.innerHTML.slice(0, 200));
    check('o ícone tem nome acessível', /aria-label="Crédito de IA"/.test(r.innerHTML));
    const ajuda = r.querySelector('.mf-saldo-ajuda');
    check('tem o "?" com a regra de contagem no title (tooltip nativo: o elemento do Bubble corta overflow)', !!ajuda && /1 crédito = 1 análise de ficha que ganhou sugestão/.test(ajuda.getAttribute('title') || ''), ajuda && ajuda.getAttribute('title'));
    check('e a regra diz que ficha completa não gasta', !!ajuda && /ficha completa não gasta/i.test(ajuda.getAttribute('title') || ''));
  }

  console.log('\n== zerou: sem culpa, sem venda; barra em 0 ==');
  {
    const { M, raiz } = carregar();
    M.render(ZERADA, null);
    const r = raiz();
    check('"Créditos de IA acabaram" (curto, cabe na largura do menu)', /^Créditos de IA acabaram$/.test(texto(r.querySelector('.mf-saldo-txt'))), texto(r));
    check('"voltam 01/10"', /voltam 01\/10/.test(texto(r)), texto(r));
    check('barra em 0%', larguraDaBarra(r) === 0, String(larguraDaBarra(r)));
    check('não vende pacote (Fase 3 não existe)', !/compr(e|ar) /i.test(texto(r)), texto(r));
  }

  console.log('\n== compradas: segunda linha só quando há saldo comprado ==');
  {
    const { M, raiz } = carregar();
    M.render(COTA, COMPRADOS);
    const t = texto(raiz());
    check('"+300 comprados"', /\+300 comprados/.test(t), t);
    check('com vencimento no formato do Agente', /vencem 15\/03/.test(t), t);
    M.render(COTA, { restante: 0, vence_em: null });
    check('comprados zerados: linha some', !/comprados/.test(texto(raiz())), texto(raiz()));
  }

  console.log('\n== falha nunca vira zero: oculto sem número ==');
  for (const [nome, cota] of [['null', null], ['limite vazio', { limite: '', restante: '' }], ['limite null', { limite: null, restante: null }], ['restante texto', { limite: 50, restante: 'x' }]]) {
    const { M, raiz } = carregar();
    M.render(COTA, null);
    M.render(cota, null);
    const r = raiz();
    check(`cota ${nome}: cartão oculto`, r.hasAttribute('hidden'), r.innerHTML.slice(0, 120));
    check(`cota ${nome}: sem "0 de"`, !/0 de /.test(texto(r)));
  }

  console.log('\n== renova_em ausente: ainda diz que renova no começo do mês ==');
  {
    const { M, raiz } = carregar();
    M.render({ limite: 50, usadas: 12, restante: 38 }, null);
    check('"renovam no começo do mês"', /renovam no começo do mês/i.test(texto(raiz())), texto(raiz()));
    check('sem data não sobra "renovam" solto', !/renovam\s*$/.test(texto(raiz())));
  }

  console.log('\n== carregar(): ledger primeiro; desligado, a cota simples ==');
  {
    const { M, raiz, box } = carregar({ rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: true, saldo: { mes: COTA, comprados: COMPRADOS } })] });
    const r = await M.carregar();
    check('ledger ativo: usa saldo.mes', r && r.restante === 38, JSON.stringify(r));
    check('e pinta os comprados', /\+300 comprados/.test(texto(raiz())));
    check('não chamou a rota de cota', !box.chamadas.some((c) => /gpt-ficha\/cota/.test(c.url)));
    check('Authorization Bearer com o user id', box.chamadas.some((c) => /creditos\/saldo/.test(c.url) && c.init.headers && c.init.headers.Authorization === 'Bearer user-1'));
  }
  {
    const { M, raiz, box } = carregar({ rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: false }), rotaCota({ ok: true, cota: COTA })] });
    const r = await M.carregar();
    check('ledger desligado: cai na cota da Fase 1', r && r.restante === 38 && /38 de 50/.test(texto(raiz())), JSON.stringify(r));
    check('chamou saldo E cota, nesta ordem', box.chamadas.filter((c) => /herokuapp/.test(c.url)).map((c) => /saldo/.test(c.url) ? 'saldo' : 'cota').join(',') === 'saldo,cota');
  }
  {
    const { M, raiz } = carregar({ rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: false }), rotaCota({ ok: true, cota: null })] });
    const r = await M.carregar();
    check('cota desligada no proxy (cota: null): oculto', r === null && raiz().hasAttribute('hidden'));
  }
  {
    const { M, raiz } = carregar({ rotas: [rotaUid(), rotaSaldo(null, 404), rotaCota({ ok: true, cota: COTA })] });
    const r = await M.carregar();
    check('rota de saldo em 404 não derruba o cartão', r && r.restante === 38);
  }
  {
    const { M, raiz } = carregar({ rotas: [rotaUid(), rotaSaldo(null, 500), rotaCota(null, 500)] });
    const r = await M.carregar();
    check('proxy caído: oculto, sem "erro" na tela', r === null && raiz().hasAttribute('hidden') && !/erro/i.test(texto(raiz())));
  }
  {
    const { M, raiz, box } = carregar({ rotas: [rotaUid(null)] });
    const r = await M.carregar();
    check('sem usuário logado: oculto e NENHUMA chamada ao proxy', r === null && raiz().hasAttribute('hidden') && !box.chamadas.some((c) => /herokuapp/.test(c.url)));
  }
  {
    const { M, raiz } = carregar({ falhar: true });
    const r = await M.carregar();
    check('rede caída no get-user-id: oculto, sem lançar', r === null && raiz().hasAttribute('hidden'));
  }

  console.log('\n== cache de 2 minutos: primeira pintura guardada, resposta fresca manda ==');
  {
    const { M, storage, raiz } = carregar({ rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: false }), rotaCota({ ok: true, cota: COTA })] });
    await M.carregar();
    const chaves = [...storage.keys()];
    check('guardou no sessionStorage com o usuário na chave', chaves.length === 1 && /user-1/.test(chaves[0]), chaves.join(','));
    const guardado = JSON.parse(storage.get(chaves[0]));
    check('guardou cota e carimbo de tempo', guardado.cota && guardado.cota.restante === 38 && typeof guardado.t === 'number');

    // Nova página: pinta do cache ANTES do fetch responder, e depois o fetch sobrescreve.
    let liberar; const lento = new Promise((res) => { liberar = res; });
    const segunda = carregar({
      sessao: [...storage.entries()],
      rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: false }), [/gpt-ficha\/cota/, async () => { await lento; return { body: { ok: true, cota: { ...COTA, usadas: 13, restante: 37 } } }; }]],
    });
    const p = segunda.M.carregar();
    await new Promise((r) => setImmediate(r));
    check('pintou 38 do cache antes da resposta', /38 de 50/.test(texto(segunda.raiz())), texto(segunda.raiz()));
    liberar();
    await p;
    check('resposta fresca sobrescreve: 37', /37 de 50/.test(texto(segunda.raiz())), texto(segunda.raiz()));
  }
  {
    const velho = JSON.stringify({ t: 1_700_000_000_000 - 3 * 60 * 1000, cota: COTA, comprados: null });
    let liberar; const lento = new Promise((res) => { liberar = res; });
    const { M, raiz } = carregar({
      sessao: [['mf_saldo_user-1', velho]],
      rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: false }), [/gpt-ficha\/cota/, async () => { await lento; return { body: { ok: true, cota: COTA } }; }]],
    });
    const p = M.carregar();
    await new Promise((r) => setImmediate(r));
    check('cache com mais de 2 min NÃO pinta', raiz().hasAttribute('hidden'), texto(raiz()));
    liberar(); await p;
  }
  {
    const { M, storage, raiz } = carregar({
      sessao: [['mf_saldo_user-1', JSON.stringify({ t: 1_700_000_000_000, cota: COTA, comprados: null })]],
      rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: false }), rotaCota({ ok: true, cota: null })],
    });
    await M.carregar();
    check('cota desligada depois: cartão some E cache é apagado', raiz().hasAttribute('hidden') && storage.size === 0);
  }

  console.log('\n== o Agente avisa, o menu acompanha (sem nova chamada) ==');
  {
    const { M, raiz, box, storage } = carregar({ rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: false }), rotaCota({ ok: true, cota: COTA })] });
    await M.carregar();
    const antes = box.chamadas.length;
    box.document.dispatchEvent(new box.CustomEvent('mf:analises-cota', { detail: { cota: { ...COTA, usadas: 13, restante: 37 }, comprados: null } }));
    check('cartão mostra 37', /37 de 50/.test(texto(raiz())), texto(raiz()));
    check('sem chamada nova', box.chamadas.length === antes);
    check('cache acompanhou (próxima página já nasce em 37)', [...storage.values()].some((v) => /"restante":37/.test(v)));
    box.document.dispatchEvent(new box.CustomEvent('mf:analises-cota', { detail: { cota: null } }));
    check('aviso sem número não apaga o que estava certo', /37 de 50/.test(texto(raiz())), texto(raiz()));
  }

  console.log('\n== boot: carrega sozinho ao entrar na página ==');
  {
    const { box } = carregar({ rotas: [rotaUid(), rotaSaldo({ ok: true, ativo: false }), rotaCota({ ok: true, cota: COTA })] });
    check('nada chamado antes do boot', box.chamadas.length === 0);
    box.rodarTimers();
    await new Promise((r) => setImmediate(r));
    check('boot pediu o usuário e o saldo', box.chamadas.some((c) => /get-user-id/.test(c.url)) && box.chamadas.some((c) => /creditos\/saldo/.test(c.url)));
  }

  console.log('\n== duas cópias do reusable na página ==');
  {
    const { M, raizes } = carregar({ copias: 2 });
    M.render(COTA, null);
    const rs = raizes();
    check('há 2 raízes', rs.length === 2);
    check('as duas pintaram 38', rs.every((r) => /38 de 50/.test(texto(r))));
    M.render(null, null);
    check('as duas ocultam', rs.every((r) => r.hasAttribute('hidden')));
  }

  console.log('\n== o que vai pro Bubble: um script só, com guarda ==');
  {
    const arq = path.join(__dirname, '..', 'build', 'menu-saldo-inject-html.txt');
    check('build gerado', fs.existsSync(arq));
    if (fs.existsSync(arq)) {
      const s = fs.readFileSync(arq, 'utf8');
      check('exatamente 1 "</script>" (a mais truncaria o elemento)', (s.match(/<\/script>/g) || []).length === 1);
      check('guarda contra dupla execução', /__MF_MENU_SALDO__/.test(s));
      check('CSS escopado em .mf-saldo (não vaza pro menu)', !/(^|\n)\s*(body|a|div|span|p)\s*\{/.test(s.replace(/<script[\s\S]*<\/script>/, '')));
      check('cabe no clipboard do Bubble (< 200 KB)', s.length < 200000, String(s.length));
      check('nasce oculto (sem número, sem espaço)', /<div class="mf-saldo"[^>]*\bhidden\b/.test(s));
    }
  }

  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
