'use strict';
/*
 * As pendências P4–P19 do FICHA-IA-PENDENCIAS.md — o que três agentes sem contexto do
 * projeto acharam olhando a tela como vendedor, como revisor de texto e como caçador de
 * bug, depois de a suíte estar verde e de um /code-review high já ter passado.
 *
 * O fio comum: a tela sabia mais do que dizia. O botão que reseta a exposição do anúncio
 * era igual ao que só preenche um campo; o aviso de risco não dizia que os OUTROS campos
 * são seguros; "0 salvos" aparecia com 4 de 5 campos já publicados.
 *
 * Rodar: node test/ficha-ia-pendencias.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('ficha-ia-pendencias.test.js');

const CAMPOS = [
  { id: 'MATERIAL', name: 'Material', value_type: 'string', preenchido: false, obrigatorio: true, _mudaLink: false, _extra: false },
  { id: 'MODEL', name: 'Modelo', value_type: 'string', preenchido: true, valor_atual: 'Panela Tramontina', obrigatorio: false, _mudaLink: false, _extra: false },
  { id: 'COLOR', name: 'Cor', value_type: 'string', preenchido: true, valor_atual: 'Rosa', obrigatorio: false, _mudaLink: true, _extra: false },
  { id: 'MPN', name: 'MPN', value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false },
  { id: 'AGID', name: 'AGID', value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false },
  { id: 'VOLTAGE', name: 'Voltagem', value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false },
];
const DADOS = {
  ok: true,
  sugestoes: [
    { id: 'MATERIAL', acao: 'preencher', valor: 'Aço inox', caracteres: 8, palavras_novas: ['inox'],
      origens: [{ palavra: 'inox', fonte: 'descricao', trecho: 'acabamento inox' }] },
    { id: 'MODEL', acao: 'trocar', valor: 'Pressão Rápida', atual: 'Panela Tramontina', motivo: 'repete_titulo',
      caracteres: 14, palavras_novas: ['rapida'], origens: [{ palavra: 'rapida', fonte: 'descricao', trecho: 'cozimento rápido' }] },
    { id: 'COLOR', acao: 'trocar', valor: 'Coral', atual: 'Rosa', motivo: 'muito_curto', caracteres: 5,
      palavras_novas: ['coral'], origens: [{ palavra: 'coral', fonte: 'descricao', trecho: 'tom coral' }] },
  ],
  palavras_novas_sugeridas: [
    { id: 'MPN', name: 'MPN', valor: 'antiaderente', palavra: 'antiaderente', combos: ['panela antiaderente'],
      buscas: 6, caracteres: 12, palavras_novas: ['antiaderente'], entraram: [{ palavra: 'antiaderente', buscas: 6 }] },
  ],
  palpites: [
    { id: 'AGID', name: 'AGID', valor: 'cozinha diaria', porque: 'É algodão: passa a ferro sem problema.',
      palavras_novas: ['cozinha', 'diaria'], caracteres: 14 },
  ],
  sem_base: [{ id: 'VOLTAGE', name: 'Voltagem' }],
  descartadas: 0,
};

const pintar = (dados, campos) => {
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', {
    estado: 'ok', dados: dados || DADOS, campos: campos || CAMPOS,
    placar: { preenchidos: 2, total: (campos || CAMPOS).length },
  });
  const body = el('ficha-ia-body');
  return { M, el, body, html: body.innerHTML, txt: body.textContent };
};
const secao = (body, nome) => body.querySelectorAll('.fia-secao').find((s) => (s.getAttribute('data-secao') || '') === nome);

console.log('\n== P4 — o botão que custa caro não pode ser igual ao que não custa nada ==');
{
  const { body } = pintar();
  const cara = secao(body, 'caros');
  const barata = secao(body, 'achei');
  const btCaro = cara && cara.querySelector('button');
  // 06/09 (tela limpa): a linha comum não tem mais botão próprio; quem aplica é o da seção.
  const btBarato = barata && barata.querySelector('.fia-aplicar-secao');
  check('a seção do campo caro tem botão', !!btCaro, String(!!cara));
  check('e ele NÃO diz a mesma coisa que o inofensivo',
    btCaro && btBarato && btCaro.textContent.trim() !== btBarato.textContent.trim(),
    (btCaro && btCaro.textContent) + ' vs ' + (btBarato && btBarato.textContent));
  check('o texto dele avisa a consequência', btCaro && /link|exposi/i.test(btCaro.textContent), btCaro && btCaro.textContent);
  check('e ele tem classe própria pra não parecer o de sempre',
    btCaro && /fia-perigo/.test(btCaro.getAttribute('class') || ''), btCaro && btCaro.getAttribute('class'));
}

console.log('\n== P5 — se um bloco é perigoso, a tela precisa dizer que os outros não são ==');
{
  const { body } = pintar();
  // 06/09 (tela limpa): a frase saiu da tela e virou title do botão. Continua afirmando.
  const barra = body.querySelector('.fia-aplicar-tudo');
  check('o "aplicar tudo" afirma (no title) que o resto é seguro',
    barra && /(nada|nenhum)[^.]*muda o link/i.test(barra.getAttribute('title') || ''), barra && barra.getAttribute('title'));
}

console.log('\n== P6 — "aplicar tudo" avisa quando está substituindo o que o vendedor escreveu ==');
{
  const { body } = pintar();
  const barra = body.querySelector('.fia-aplicar-tudo');
  check('diz (no title) quantos substituem valor existente',
    barra && /\b1 substitui\b/i.test(barra.getAttribute('title') || ''), barra && barra.getAttribute('title'));
  const troca = body.querySelectorAll('.fia-linha').find((l) => l.getAttribute('data-campo') === 'MODEL');
  check('e a linha que substitui leva o selo "substitui"', !!(troca && troca.querySelector('.fia-selo-troca')), troca && troca.textContent.slice(0, 200));
}
{
  const semTroca = { ...DADOS, sugestoes: DADOS.sugestoes.filter((s) => s.acao !== 'trocar') };
  const { body } = pintar(semTroca);
  const barra = body.querySelector('.fia-aplicar-tudo');
  check('e não inventa aviso quando não há troca nenhuma',
    barra && !/substitu/i.test(barra.getAttribute('title') || ''), barra && barra.getAttribute('title'));
}

console.log('\n== P9 — o número entre parênteses significava duas coisas diferentes ==');
{
  const { body } = pintar();
  const linha = body.querySelectorAll('.fia-linha').find((l) => l.getAttribute('data-campo') === 'MODEL');
  const antes = linha && linha.querySelector('.fia-antes');
  check('o tamanho do valor de hoje vem com a unidade, não solto entre parênteses',
    antes && /17\/30/.test(antes.textContent) && !/\(17\)/.test(antes.textContent), antes && antes.textContent);
}

console.log('\n== P10 — "X/30" sem legenda em nenhuma das sete telas ==');
{
  const { txt, html } = pintar();
  // 06/09 (tela limpa): a legenda saiu da tela; a explicação mora no title do "X/30".
  check('a tela explica o que é o X/30 no title, não como frase solta', /30 primeiros caracteres/.test(html) && !/lê os primeiros/i.test(txt), txt.slice(0, 400));
}

console.log('\n== P12 — o título da seção diz o CONTEÚDO, não o processo ==');
{
  const { body } = pintar();
  const cara = secao(body, 'caros');
  const titulo = cara && cara.querySelector('.fia-secao-titulo');
  check('a seção mais perigosa se chama pelo que ela é',
    titulo && /link/i.test(titulo.textContent) && !/um a um/i.test(titulo.textContent), titulo && titulo.textContent);
}

console.log('\n== P13 — "Vale trocar" e "Palavras novas" eram indistinguíveis ==');
{
  // O caso em que a confusão dói: as duas listas mexem num campo que JÁ TEM valor. Uma
  // substitui o que o vendedor escreveu; a outra acrescenta ao lado. Enquanto as duas
  // mostravam só "+N palavra nova", ele não tinha como saber qual era qual.
  const comAtual = {
    ...DADOS,
    palavras_novas_sugeridas: [{ ...DADOS.palavras_novas_sugeridas[0], atual: 'Código 123', valor: 'Código 123 antiaderente' }],
  };
  const { body } = pintar(comAtual);
  const trocas = secao(body, 'trocar');
  const novas = secao(body, 'novas');
  check('a linha de troca diz que SUBSTITUI', trocas && /substitui/i.test(trocas.textContent), trocas && trocas.textContent.slice(0, 200));
  check('a de palavra nova diz que ACRESCENTA', novas && /acrescenta|soma|junta/i.test(novas.textContent), novas && novas.textContent.slice(0, 200));
  check('e a de palavra nova não fala em substituir', novas && !/substitui/i.test(novas.textContent), novas && novas.textContent.slice(0, 200));
}

console.log('\n== P15 — a tela não mostrava como o campo vai FICAR ==');
{
  const { body } = pintar();
  const linha = body.querySelectorAll('.fia-linha').find((l) => l.getAttribute('data-campo') === 'MODEL');
  check('cada linha rotula o valor final', linha && /vai ficar/i.test(linha.textContent), linha && linha.textContent);
}

console.log('\n== P16/P17 — a frase de maior consequência era a mais difícil de ler ==');
{
  const { txt, html, body } = pintar();
  // Só os textos explicativos: rótulo e placar não têm pontuação, e mediriam a tela inteira
  // como se fosse uma frase só.
  const avisos = body.querySelectorAll('.fia-aviso, .fia-estado-texto, .fia-legenda').map((n) => n.textContent);
  const frases = avisos.join(' ').split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter((f) => f.length > 3);
  const longa = frases.find((f) => f.length > 160);
  check('nenhuma frase da tela passa de 160 caracteres', !longa, longa);
  check('sem seta de diff no lugar de "veio de"', !html.includes('←'), html.slice(html.indexOf('fia-origem'), html.indexOf('fia-origem') + 200));
  check('a origem é escrita em português', /veio de/i.test(txt), txt.slice(0, 300));
}

console.log('\n== P18 — dois 🎉 para a mesma conquista ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', {
    estado: 'ok',
    dados: { ok: true, sugestoes: [], palavras_novas_sugeridas: [], palpites: [], sem_base: [], descartadas: 0 },
    campos: [{ id: 'A', name: 'A', preenchido: true }],
    placar: { preenchidos: 1, total: 1 },
  });
  const txt = el('ficha-ia-body').textContent;
  check('a ficha completa comemora UMA vez', (txt.match(/🎉/g) || []).length === 1, txt);
}

console.log('\n== P11/P17 — "sem plano" era o único estado sem saída ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'sem_plano', dados: null, campos: [], placar: { preenchidos: 0, total: 0 } });
  const body = el('ficha-ia-body');
  const cta = body.querySelector('a');
  check('o estado sem plano tem para onde ir', !!cta, body.innerHTML.slice(0, 300));
  check('e o link vai pra conta do vendedor', cta && /minha-conta/.test(cta.getAttribute('href') || ''), cta && cta.getAttribute('href'));
  check('sem falar em "recurso"', !/recurso/i.test(body.textContent), body.textContent);
}
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'sessao', dados: null, campos: [], placar: { preenchidos: 0, total: 0 } });
  const body = el('ficha-ia-body');
  check('sessão expirada vira conexão com o Mercado Livre', /Mercado Livre/i.test(body.textContent), body.textContent);
  check('sem falar em "sessão"', !/sess[ãa]o/i.test(body.textContent), body.textContent);
  check('e tem como reconectar', !!body.querySelector('a'), body.innerHTML.slice(0, 300));
}

console.log('\n== P14 — o placar de palavras novas não acompanhava o que estava marcado ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'ok', dados: DADOS, campos: CAMPOS, placar: { preenchidos: 2, total: 6 } });
  M.ligarBotoes();
  const body = el('ficha-ia-body');
  const placar = body.querySelector('#fia-tokens');
  const antes = placar && placar.textContent;
  const marca = body.querySelector('.fia-check');
  marca.checked = false;
  marca.dispatchEvent({ type: 'change', target: marca });
  const depois = body.querySelector('#fia-tokens');
  check('o placar existe', !!placar, String(!!placar));
  check('e cai quando o vendedor desmarca uma linha',
    depois && depois.textContent !== antes, antes + ' -> ' + (depois && depois.textContent));
}

console.log('\n== P19 — o campo do erro casava por pedaço do nome ==');
(async () => {
  {
    const MAIN = { id: 'MAIN_COLOR', name: 'Cor principal', value_type: 'string', tags: {} };
    const COR = { id: 'COLOR', name: 'Cor', value_type: 'string', tags: {} };
    const item = { id: 'MLB1', title: 'Panela', attributes: [] };
    const { M } = carregar({
      status: 400,
      resposta: { cause: [{ code: 'invalid_length', references: ['item.attributes.MAIN_COLOR'], message: 'too long' }] },
    });
    const r = await M.aplicar('MLB1', [{ id: 'COLOR', valor: 'Coral' }, { id: 'MAIN_COLOR', valor: 'Rosa claro' }], [COR, MAIN], item, 'tok');
    check('o erro aponta o campo certo, não o que só compartilha o final do id',
      /Cor principal/.test(r.erro || ''), r.erro);
  }

  console.log('\n== P8 — sucesso parcial não é "0 salvos" ==');
  {
    const MATERIAL = { id: 'MATERIAL', name: 'Material', value_type: 'string', tags: {} };
    const MARCA = { id: 'BRAND', name: 'Marca', value_type: 'string', hierarchy: 'PARENT_PK', tags: {} };
    const item = { id: 'MLB1', title: 'Panela', attributes: [] };
    // O proxy roteia família em duas pernas: o PUT direto gravou MATERIAL, e a perna de
    // família recusou BRAND. O corpo devolvido é o item DEPOIS da gravação — dá pra
    // conferir o que entrou em vez de chutar zero.
    const { M } = carregar({
      resposta: {
        id: 'MLB1',
        attributes: [{ id: 'MATERIAL', value_name: 'Alumínio' }],
        _family_task_error: { cause: [{ code: 'forbidden', references: ['BRAND'], message: 'not allowed' }] },
      },
    });
    const r = await M.aplicar('MLB1', [{ id: 'MATERIAL', valor: 'Alumínio' }, { id: 'BRAND', valor: 'Tramontina' }], [MATERIAL, MARCA], item, 'tok');
    check('conta o que realmente gravou', r.salvos === 1, JSON.stringify(r));
    check('e continua dizendo que houve problema', r.ok === false, JSON.stringify(r));
    check('nomeando o campo que ficou de fora', /Marca/.test(r.erro || ''), r.erro);
    check('e devolvendo quais entraram, pra tela não apagar a linha errada',
      Array.isArray(r.gravados) && r.gravados.join() === 'MATERIAL', JSON.stringify(r.gravados));
  }
  {
    // Sem o item de volta não dá pra conferir nada — e aí a tela não pode inventar que
    // salvou. Zero continua sendo a resposta honesta.
    const MATERIAL = { id: 'MATERIAL', name: 'Material', value_type: 'string', tags: {} };
    const item = { id: 'MLB1', title: 'Panela', attributes: [] };
    const { M } = carregar({ resposta: { id: 'MLB1', _item_put_error: { cause: [{ code: 'invalid_length' }] } } });
    const r = await M.aplicar('MLB1', [{ id: 'MATERIAL', valor: 'x' }], [MATERIAL], item, 'tok');
    check('sem prova de gravação, não conta nenhum', r.ok === false && r.salvos === 0, JSON.stringify(r));
  }

  console.log('\n== P7 — dois cliques, dois PUTs ==');
  {
    const CAT = [
      { id: 'MATERIAL', name: 'Material', value_type: 'string', value_max_length: 255, tags: {} },
      { id: 'BRAND', name: 'Marca', value_type: 'string', value_max_length: 255, tags: {} },
    ];
    const puts = [];
    let liberar;
    const espera = new Promise((r) => { liberar = r; });
    const rotas = [
      [/getAccessToken2/, async () => ({ body: { response: { access_token: 'T' } } })],
      [/get-user-id/, async () => ({ body: { response: { user_id: 'u1' } } })],
      [/\/api\/fetch-item\?/, async () => ({ body: [{ code: 200, body: { id: 'MLB1111111111', title: 'Panela', category_id: 'C1', site_id: 'MLB', attributes: [] }, description: { plain_text: 'd' } }] })],
      [/\/api\/attributes\//, async () => ({ body: CAT })],
      [/\/api\/catalog-quality/, async () => ({ status: 404, body: {} })],
      [/\/api\/gpt-ficha/, async () => ({ body: {
        ok: true,
        sugestoes: [
          { id: 'MATERIAL', acao: 'preencher', valor: 'Aco inox', origens: [], palavras_novas: ['inox'], caracteres: 8 },
          { id: 'BRAND', acao: 'preencher', valor: 'Tramontina', origens: [], palavras_novas: ['tramontina'], caracteres: 10 },
        ],
        palavras_novas_sugeridas: [], palpites: [], sem_base: [], descartadas: 0,
      } })],
      // O PUT fica pendurado até o teste soltar: é assim que o segundo clique acontece
      // com o primeiro ainda no ar.
      [/\/api\/fetch-item-update/, async (u, init) => { puts.push(JSON.parse(init.body || '{}')); await espera; return { body: { id: 'MLB1111111111', attributes: [] } }; }],
    ];
    const { M, el } = carregar({ rotas });
    await M.abrirFichaIA('MLB1111111111');
    const body = el('ficha-ia-body');
    const bt = body.querySelector('.fia-aplicar-tudo');

    const primeiro = bt.click();
    const segundo = bt.click();
    check('o segundo clique não dispara outro PUT enquanto o primeiro está no ar',
      puts.length === 1, String(puts.length));
    liberar({});
    await Promise.all([primeiro, segundo]);
  }

  console.log('\n== o bloco "espiar outro anúncio" sai da frente enquanto a ficha está aberta ==');
  {
    const CAT = [{ id: 'MATERIAL', name: 'Material', value_type: 'string', value_max_length: 255, tags: {} }];
    const rotas = [
      [/getAccessToken2/, async () => ({ body: { response: { access_token: 'T' } } })],
      [/get-user-id/, async () => ({ body: { response: { user_id: 'u1' } } })],
      [/\/api\/fetch-item\?/, async () => ({ body: [{ code: 200, body: { id: 'MLB1111111111', title: 'Panela', category_id: 'C1', site_id: 'MLB', attributes: [] }, description: { plain_text: 'd' } }] })],
      [/\/api\/attributes\//, async () => ({ body: CAT })],
      [/\/api\/catalog-quality/, async () => ({ status: 404, body: {} })],
      [/\/api\/gpt-ficha/, async () => ({ body: { ok: true, sugestoes: [], palavras_novas_sugeridas: [], palpites: [], sem_base: [], descartadas: 0 } })],
    ];
    const { M, el } = carregar({ rotas });
    const externo = el('kw-externo');
    await M.abrirFichaIA('MLB1111111111');
    check('com a ficha aberta, o campo de colar link some', externo.hidden === true, String(externo.hidden));
    M.voltarParaLista();
    check('e volta quando ele volta pra lista', externo.hidden === false, String(externo.hidden));
  }

  console.log('\n== a tela fala como gente (31/08, passe de texto) ==');
  {
    const { body, txt } = pintar();

    // O travessão é a pontuação favorita de texto gerado, e a tela tinha um em quase todo
    // aviso. Some junto o "— escolher —" do select.
    check('nenhum travessão no que o vendedor lê', !txt.includes('—'),
      (txt.match(/[^.]{0,40}—[^.]{0,40}/g) || []).join(' // '));

    // Emoji em título de seção é decoração; o ícone que fica é o da linha, que diz de onde
    // veio o valor.
    const titulos = body.querySelectorAll('.fia-secao-titulo').map((n) => n.textContent.trim());
    const comEmoji = titulos.filter((t) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t));
    check('título de seção sem emoji', comEmoji.length === 0, comEmoji.join(' // '));

    // Cinco tarjas amarelas tiram do amarelo o significado que ele precisa ter na única
    // seção que pode custar caro.
    const comFundo = body.querySelectorAll('.fia-aviso').filter((n) => /fia-aviso-risco/.test(n.getAttribute('class') || ''));
    check('só a seção de risco usa a tarja amarela', comFundo.length === 1, String(comFundo.length));
    check('e é justamente a que muda o link',
      comFundo[0] && /link/i.test(comFundo[0].textContent), comFundo[0] && comFundo[0].textContent);

    // Aviso sem risco não pode ter cor de alerta no CSS.
    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'ficha-ia.css'), 'utf8');
    check('o aviso comum não tem fundo de alerta',
      !/\.fia-aviso \{[^}]*background/.test(css), (css.match(/\.fia-aviso \{[^}]*\}/) || [''])[0]);
  }

  console.log('\n== o card é UM só, no padrão do app (31/08, noite) ==');
  {
    // Medido no navegador com o painel renderizado de verdade: as 7 linhas têm a MESMA
    // casca (fundo, borda, raio, padding, opacidade). O que separa "achei no seu anúncio"
    // de "palavras novas" é de ONDE vem a afirmação — e isso o título da seção, o aviso e o
    // ícone da linha já dizem. Fundo acinzentado + borda tracejada davam a estas listas
    // cara de rascunho (Lucas, 31/08: "precisa ser no mesmo padrão do app").
    //
    // A checagem aqui é sobre o CSS, que é onde a divergência morava; a medição do estilo
    // computado foi feita no navegador, com o preview do painel.
    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'ficha-ia.css'), 'utf8');

    check('a variante de palavra nova não tem casca própria',
      !/\.fia-nova\s*\{[^}]*dashed/.test(css) && !/\.fia-nova\s*\{[^}]*background:\s*#fcfcfd/.test(css));
    check('nem a de campo vazio', !/\.fia-vazia\s*\{[^}]*dashed/.test(css));
    check('nenhuma seção fica apagada por opacidade', !/\.fia-sem-base\s*\{[^}]*opacity/.test(css));
    check('e não sobrou borda tracejada em lugar nenhum', !/dashed/.test(css),
      (css.match(/[^\n]*dashed[^\n]*/g) || []).join(' // '));
  }

  console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
