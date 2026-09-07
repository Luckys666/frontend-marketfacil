'use strict';
/*
 * 06/09/2026 (Lucas): "tem muita explicação pra uma coisa que era pra ser intuitiva… precisamos
 * da coisa mais limpa." A tela da ficha passa a explicar por ESTRUTURA, não por frase:
 *  - cada linha = checkbox + nome + valor (com o X/30) + no máximo um selo curto;
 *  - o detalhe (de onde veio, porquê, o que saiu, o que entrou) fica dentro de um <details>
 *    fechado, um por linha;
 *  - nenhuma frase de apoio fixa fora das seções de risco; o "?" do título guarda o aviso;
 *  - sem "Aplicar só este" em cada linha: checkbox + um botão por seção. O botão vermelho do
 *    campo que muda o link continua, porque ali a consequência exige um clique próprio.
 *
 * Este teste MEDE (feedback_teste_de_layout_mede_nao_olha): conta texto e elementos, não olha.
 * Rodar: node test/ficha-ia-limpa.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-limpa.test.js');

const campo = (id, name, extra) => ({ id, name, value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false, ...(extra || {}) });
const CAMPOS = [
  campo('MATERIAL', 'Material', { obrigatorio: true }),
  campo('MODEL', 'Modelo', { preenchido: true, valor_atual: 'Basica' }),
  campo('LINE', 'Linha'),
  campo('IS_VEGAN', 'É vegano', { value_type: 'boolean' }),
  campo('FONTE', 'Fonte do produto'),
  campo('SIZE', 'Tamanho', { _mudaLink: true, preenchido: true, valor_atual: 'M' }),
  campo('GTIN', 'Código universal'),
];
const DADOS = {
  ok: true,
  sugestoes: [
    { id: 'MATERIAL', acao: 'preencher', valor: 'Malha canelada macia', caracteres: 20, palavras_novas: ['malha', 'canelad', 'macia'], origens: [{ palavra: 'malha', fonte: 'descricao', trecho: 'malha canelada' }, { palavra: 'macia', fonte: 'descricao', trecho: 'macia' }] },
    { id: 'MODEL', acao: 'trocar', valor: 'Basica cropped verao', atual: 'Basica', motivo: 'muito_curto', caracteres: 20, palavras_novas: ['cropp', 'verao'], origens: [{ palavra: 'cropped', fonte: 'descricao', trecho: 'cropped' }], prioridade: true },
    { id: 'SIZE', acao: 'trocar', valor: 'M', atual: 'M ', motivo: 'nao_indexa', caracteres: 1, palavras_novas: [], origens: [] },
  ],
  palavras_novas_sugeridas: [
    { id: 'LINE', name: 'Linha', valor: 'antifrizz acetinado', atual: 'Finisher Hair', tirado_do_titulo: ['Finisher', 'Hair'], palavra: 'antifrizz', palavras_novas: ['antifrizz', 'acetinado'], buscas: 13, combos: ['pomada antifrizz', 'cera acetinada'], entraram: [{ palavra: 'antifrizz', buscas: 9, combos: [] }, { palavra: 'acetinado', buscas: 4, combos: [] }], caracteres: 19, prioridade: true },
  ],
  palpites: [
    { id: 'FONTE', name: 'Fonte do produto', valor: 'Kiran 2024 cropped verao', caracteres: 24, palavras_novas: ['cropp', 'verao'], porque: 'marca e ano do produto', completado_com: ['cropped', 'verao'] },
    { id: 'IS_VEGAN', name: 'É vegano', valor: 'Não', caracteres: 3, palavras_novas: [], porque: 'Não há declaração vegana no anúncio', silencio: true },
  ],
  sem_base: [{ id: 'GTIN', name: 'Código universal' }],
  descartadas: 0,
};

// Texto que o vendedor vê SEM abrir nada: tudo menos o que está dentro de <details>.
// ⚠️ No mini-dom só a raiz pintada por innerHTML tem innerHTML; nó filho só tem textContent. Por
// isso a medição por linha usa textContent (da linha menos o do details), nunca innerHTML — com
// innerHTML vazio a medição passava em branco (harness que devolve vazio não é teste).
const visivel = (el) => String(el.innerHTML || '').replace(/<details[\s\S]*?<\/details>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const visivelNo = (no) => {
  const total = String(no.textContent || '');
  const det = no.querySelector('details');
  const dentro = det ? String(det.textContent || '') : '';
  return (dentro ? total.replace(dentro, ' ') : total).replace(/\s+/g, ' ').trim();
};

(async () => {
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'ok', dados: DADOS, campos: CAMPOS, placar: M.contarPlacar(CAMPOS) });
  const body = el('ficha-ia-body');
  const html = body.innerHTML;

  console.log('\n== nenhuma frase de apoio solta ==');
  check('sem legenda dos 30 caracteres no topo', !/fia-legenda/.test(html));
  check('sem nota embaixo do "Aplicar tudo"', !/fia-tudo-nota/.test(html));
  const avisos = body.querySelectorAll('.fia-aviso');
  check('o único aviso em texto é o da seção que muda o link (risco)', avisos.length === 1 && /fia-aviso-risco/.test(avisos[0].getAttribute('class') || ''), String(avisos.length));
  const ajudas = body.querySelectorAll('.fia-secao-ajuda');
  check('cada outra seção tem um "?" com a explicação no title', ajudas.length >= 4 && ajudas.every((a) => (a.getAttribute('title') || '').length > 10), String(ajudas.length));
  check('a explicação do X/30 não é frase na tela (só title)', !/lê os primeiros/.test(visivel(body)) && /30 primeiros caracteres/.test(html), html.slice(0, 300));

  console.log('\n== cada linha: checkbox + nome + valor + selo; o resto atrás de um <details> ==');
  const linhas = body.querySelectorAll('.fia-linha');
  check('há 7 linhas', linhas.length === 7, String(linhas.length));
  let mediu = 0;
  for (const l of linhas) {
    const id = l.getAttribute('data-campo');
    const txt = visivelNo(l);
    if (txt.length) mediu++;
    const nome = (CAMPOS.find((c) => c.id === id) || {}).name || id;
    // Sem o nome, o valor, o X/30 e o "cabe mais N", o que sobra visível tem que caber em poucas
    // palavras: selos curtos ("rende busca", "+2 · 13 buscas", "substitui", "rótulo?", "o ML pede").
    const sobra = txt.replace(nome, '').replace(/\d+\/30/g, '').replace(/cabe mais \d+/g, '').replace(/[✅✏️🔍🤔ⓘ]/g, '').trim();
    // O campo que muda o link é a exceção deliberada: o botão vermelho fala por extenso.
    const caro = !!((CAMPOS.find((c) => c.id === id) || {})._mudaLink);
    check(`${id}: texto visível fora do valor é curto (≤ 8 palavras${caro ? ', fora o botão vermelho' : ''}): "${sobra}"`, sobra.replace(caro ? /Corrigir e mudar o link do anúncio/ : /$^/, '').split(/\s+/).filter(Boolean).length <= 8, txt);
    check(`${id}: sem "veio de", "acrescenta a", "porque" ou "completado" à vista`, !/veio de|acrescenta a|no lugar de|completado com|não afirma|marca e ano/i.test(txt), txt);
    check(`${id}: no máximo um <details> por linha`, l.querySelectorAll('details').length <= 1, String(l.querySelectorAll('details').length));
  }
  check('a medição por linha leu texto de verdade (não passou em branco)', mediu === linhas.length, `${mediu}/${linhas.length}`);
  check('MATERIAL: a origem continua no DOM, dentro do details', /data-campo="MATERIAL"[\s\S]*?<details[\s\S]*?veio de[\s\S]*?<\/details>/.test(html));
  check('FONTE: o porquê e o "completado com" continuam no DOM, dentro do details', /data-campo="FONTE"[\s\S]*?<details[\s\S]*?marca e ano[\s\S]*?completado com[\s\S]*?<\/details>/.test(html));
  check('LINE: o "no lugar de" continua no DOM, dentro do details', /data-campo="LINE"[\s\S]*?<details[\s\S]*?no lugar de[\s\S]*?<\/details>/.test(html));

  console.log('\n== selos curtos no lugar de frases ==');
  check('LINE: selo "+2 · 13 buscas" com as palavras no title', /data-campo="LINE"[\s\S]*?class="fia-selo fia-selo-ganho"[^>]*title="[^"]*antifrizz[^"]*"[^>]*>\+2 · 13 buscas</.test(html), html.slice(html.indexOf('data-campo="LINE"'), html.indexOf('data-campo="LINE"') + 700));
  check('IS_VEGAN: selo "rótulo?" com o aviso de silêncio no title', /data-campo="IS_VEGAN"[\s\S]*?class="fia-selo fia-selo-rotulo"[^>]*title="[^"]*não afirma[^"]*"/.test(html));
  check('MODEL (troca): selo "substitui" com o valor de hoje no title', /data-campo="MODEL"[\s\S]*?class="fia-selo fia-selo-troca"[^>]*title="[^"]*Basica[^"]*"[^>]*>substitui</.test(html));
  check('MODEL e LINE (prioridade) mantêm o selo "rende busca"', /data-campo="MODEL"[\s\S]*?fia-selo-prio/.test(html) && /data-campo="LINE"[\s\S]*?fia-selo-prio/.test(html));

  console.log('\n== botões: um por seção, mais o vermelho do campo que muda o link ==');
  const umAUm = body.querySelectorAll('.fia-aplicar-um');
  check('só o campo que muda o link tem botão próprio, e ele é o vermelho', umAUm.length === 1 && /fia-perigo/.test(umAUm[0].getAttribute('class') || '') && /link/i.test(umAUm[0].textContent), String(umAUm.length));
  const tudo = body.querySelector('.fia-aplicar-tudo');
  check('"Aplicar tudo" só com o número; o resto vai no title', tudo && /^Aplicar tudo \(\d+\)$/.test(tudo.textContent.replace(/\s+/g, ' ').trim()) && /muda o link/.test(tudo.getAttribute('title') || '') && /1 substitui/.test(tudo.getAttribute('title') || ''), tudo && (tudo.textContent + ' | ' + tudo.getAttribute('title')));
  check('cada seção com checkbox tem o próprio botão', body.querySelectorAll('.fia-aplicar-secao').length >= 4, String(body.querySelectorAll('.fia-aplicar-secao').length));

  console.log('\n== tela de variações: uma pergunta, sem explicação ==');
  {
    const { M: M2, el: el2 } = carregar();
    const html2 = (() => {
      M2.renderPainel('ficha-ia-body', { estado: 'ok', dados: DADOS, campos: CAMPOS, placar: M2.contarPlacar(CAMPOS) });
      return el2('ficha-ia-body').innerHTML;
    })();
    check('(render normal continua ok)', html2.length > 100);
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
