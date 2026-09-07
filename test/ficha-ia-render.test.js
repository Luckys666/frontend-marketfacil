'use strict';
/*
 * A tela. Três coisas que ela não pode errar:
 *   1. falha de rede NUNCA vira "nenhum campo pra melhorar" (são estados diferentes);
 *   2. campo sem base APARECE — é resultado, não ausência de resultado. Se sumir, o
 *      vendedor acha que a ferramenta não funcionou;
 *   3. campo que muda o link fica FORA do "aceitar tudo" (decisão do Lucas, 30/08).
 *
 * Rodar: node test/ficha-ia-render.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('ficha-ia-render.test.js');

const CAMPOS = [
  { id: 'MATERIAL', name: 'Material', preenchido: false, obrigatorio: true, _mudaLink: false, _extra: false },
  { id: 'MODEL', name: 'Modelo', preenchido: true, valor_atual: 'Panela Pressão Tramontina 3L', obrigatorio: false, _mudaLink: false, _extra: false },
  { id: 'COLOR', name: 'Cor', preenchido: true, valor_atual: 'Rosa', obrigatorio: false, _mudaLink: true, _extra: false },
  { id: 'VOLTAGE', name: 'Voltagem', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false },
];
const RESPOSTA = {
  ok: true,
  sugestoes: [
    { id: 'MATERIAL', acao: 'preencher', valor: 'Aço inox', caracteres: 8, palavras_novas: ['inox'],
      origens: [{ palavra: 'aco', fonte: 'atributo:COMPOSITION', trecho: 'Aço carbono' }, { palavra: 'inox', fonte: 'descricao', trecho: 'acabamento inox escovado' }] },
    { id: 'MODEL', acao: 'trocar', valor: 'Pressão Rápida', atual: 'Panela Pressão Tramontina 3L', motivo: 'repete_titulo', caracteres: 14, palavras_novas: ['rapida'],
      origens: [{ palavra: 'pressao', fonte: 'titulo', trecho: 'Panela de Pressão' }, { palavra: 'rapida', fonte: 'descricao', trecho: 'cozimento rápida' }] },
    { id: 'COLOR', acao: 'trocar', valor: 'Coral', atual: 'Rosa', motivo: 'muito_curto', caracteres: 5, palavras_novas: ['coral'],
      origens: [{ palavra: 'coral', fonte: 'descricao', trecho: 'tom coral' }] },
  ],
  palavras_novas_sugeridas: [
    { id: 'FINISH', name: 'Acabamento', valor: 'Antiaderente', palavra: 'antiaderente', combos: ['panela antiaderente', 'frigideira antiaderente'], buscas: 6, caracteres: 12 },
  ],
  sem_base: [{ id: 'VOLTAGE', name: 'Voltagem' }],
  descartadas: 2,
};

// O ML indexa os 30 primeiros caracteres de cada campo, então em campo de TEXTO sobrar
// espaço é busca que o anúncio deixa de alcançar — e o contador é um chamado pra caçar mais
// palavra. Mas em lista fechada, sim/não e número o valor é único e exato: "Quadrado" ocupa
// 8 e não existe nada que ocupe mais. Ali o "8/30" acusa desperdício que não existe e manda
// o vendedor procurar o que não há (visto em MLB6683355882, 31/08/2026).
console.log('\n== contador de caracteres: só onde ainda cabe escolha ==');
{
  const { M, el } = carregar();
  const campos = [
    { id: 'STYLES', name: 'Estilos', value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false },
    { id: 'NECK_TYPE', name: 'Tipo de gola', value_type: 'list', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false },
    { id: 'IS_KIT', name: 'É kit', value_type: 'boolean', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false },
    { id: 'COMPOSITION', name: 'Composição', value_type: 'string', preenchido: false, obrigatorio: false, _mudaLink: false, _extra: false },
  ];
  const dados = {
    ok: true,
    sugestoes: [
      { id: 'STYLES', acao: 'preencher', valor: 'Casual', caracteres: 6, palavras_novas: ['casual'], origens: [] },
      { id: 'NECK_TYPE', acao: 'preencher', valor: 'Quadrado', caracteres: 8, palavras_novas: ['quadrado'], origens: [] },
      { id: 'IS_KIT', acao: 'preencher', valor: 'Não', caracteres: 3, palavras_novas: [], origens: [] },
      { id: 'COMPOSITION', acao: 'preencher', valor: 'Algodao,Elastano,Ribana Teste', caracteres: 29, palavras_novas: ['algodao'], origens: [] },
    ],
    palavras_novas_sugeridas: [], sem_base: [], descartadas: 0,
  };
  M.renderPainel('ficha-ia-body', { estado: 'ok', dados, campos, placar: { preenchidos: 0, total: 4 } });
  const body = el('ficha-ia-body');
  const linhaDe = (id) => body.querySelectorAll('.fia-linha').find
    ? body.querySelectorAll('.fia-linha').find((l) => l.getAttribute('data-campo') === id)
    : null;

  const texto = (id) => { const l = linhaDe(id); return l ? l.textContent : ''; };

  check('campo de texto mostra o contador', /6\/30/.test(texto('STYLES')), texto('STYLES'));
  check('e chama pra encher o que sobra', /cabe mais 24/.test(texto('STYLES')), texto('STYLES'));
  check('lista fechada NÃO mostra contador', !/\/30/.test(texto('NECK_TYPE')), texto('NECK_TYPE'));
  check('lista fechada NÃO manda encher', !/cabe mais/.test(texto('NECK_TYPE')), texto('NECK_TYPE'));
  check('sim/não NÃO mostra contador', !/\/30/.test(texto('IS_KIT')), texto('IS_KIT'));
  check('texto quase cheio mostra o contador', /29\/30/.test(texto('COMPOSITION')), texto('COMPOSITION'));
  check('mas não pede mais por 1 caractere', !/cabe mais/.test(texto('COMPOSITION')), texto('COMPOSITION'));
}

console.log('\n== separarSecoes ==');
{
  const { M } = carregar();
  const s = M.separarSecoes(RESPOSTA, CAMPOS);
  check('preencher vai pra "achei no seu anúncio"', s.comEvidencia.map((x) => x.id).join() === 'MATERIAL');
  check('trocar vai pra "vale trocar"', s.trocas.map((x) => x.id).join() === 'MODEL');
  check('campo que muda o link vai pra "só um a um"', s.sohUmAUm.map((x) => x.id).join() === 'COLOR');
  check('e NÃO está em nenhuma das duas listas de lote',
    !s.comEvidencia.concat(s.trocas).some((x) => x.id === 'COLOR'));
  check('palavra nova vai pra lista própria', s.palavrasNovas.map((x) => x.id).join() === 'FINISH');
  check('e NÃO entra nas listas de lote',
    !s.comEvidencia.concat(s.trocas).some((x) => x.id === 'FINISH'));
}

console.log('\n== contarTokensNovos: o número que o vendedor entende ==');
{
  const { M } = carregar();
  check('soma os tokens distintos', M.contarTokensNovos([{ palavras_novas: ['inox'] }, { palavras_novas: ['rapida'] }]) === 2);
  check('não conta o mesmo token duas vezes', M.contarTokensNovos([{ palavras_novas: ['inox'] }, { palavras_novas: ['inox', 'rapida'] }]) === 2);
  check('lista vazia é zero', M.contarTokensNovos([]) === 0);
  check('campo sem token novo não infla o número', M.contarTokensNovos([{ palavras_novas: [] }]) === 0);
}

console.log('\n== obrigatório vem antes de extra dentro de cada lista (spec §3.3) ==');
{
  const { M } = carregar();
  const campos = [
    { id: 'EXTRA1', name: 'Campo extra', preenchido: false, obrigatorio: false, _mudaLink: false },
    { id: 'OBRIG1', name: 'Campo do ML', preenchido: false, obrigatorio: true, _mudaLink: false },
  ];
  const resp = {
    ok: true,
    sugestoes: [
      { id: 'EXTRA1', acao: 'preencher', valor: 'a', fonte: 'titulo', trecho: 'a', caracteres: 1 },
      { id: 'OBRIG1', acao: 'preencher', valor: 'b', fonte: 'titulo', trecho: 'b', caracteres: 1 },
    ],
    sem_base: [], descartadas: 0,
  };
  const s = M.separarSecoes(resp, campos);
  check('obrigatório primeiro', s.comEvidencia[0].id === 'OBRIG1', s.comEvidencia.map((x) => x.id).join());
}

console.log('\n== placar ==');
{
  const { M } = carregar();
  const p = M.contarPlacar(CAMPOS);
  check('conta preenchidos', p.preenchidos === 2, String(p.preenchidos));
  check('conta total de campos que ele PODE mexer', p.total === 4, String(p.total));
}

console.log('\n== cache: mesma ficha reaproveita, ficha mudada invalida ==');
{
  const { M } = carregar();
  const a = M.chaveCache('MLB1', [{ id: 'X', valor_atual: 'um' }]);
  const b = M.chaveCache('MLB1', [{ id: 'X', valor_atual: 'um' }]);
  const c = M.chaveCache('MLB1', [{ id: 'X', valor_atual: 'dois' }]);
  check('mesma ficha, mesma chave', a === b);
  check('ficha mudada, chave nova', a !== c);
  check('outro anúncio, chave nova', a !== M.chaveCache('MLB2', [{ id: 'X', valor_atual: 'um' }]));
}

console.log('\n== render: sucesso ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'ok', dados: RESPOSTA, campos: CAMPOS, placar: { preenchidos: 2, total: 4 } });
  const html = el('ficha-ia-body').innerHTML;
  const txt = el('ficha-ia-body').textContent;
  check('mostra o placar', txt.includes('2 de 4'), txt.slice(0, 120));
  check('mostra o contador de palavras novas', /\+2 palavras novas/i.test(txt), txt.slice(0, 200));
  check('mostra TODAS as origens de um valor composto', html.includes('Aço carbono') && html.includes('acabamento inox escovado'));
  check('e diz qual palavra veio de onde', html.includes('aco') && html.includes('inox'));
  check('mostra o valor de hoje na troca', html.includes('Panela Pressão Tramontina 3L'));
  check('mostra o valor novo', html.includes('Pressão Rápida'));
  check('campo sem base APARECE', txt.includes('Voltagem'));
  // O texto mudou em 31/08: dizer "a IA não chuta fato de produto" virou mentira depois
  // que a lista de palpites passou a chutar. Agora a seção explica o que sobrou pro
  // vendedor — e por que vale preencher.
  // 06/09: a seção virou "Só você sabe" (o que sobrou é o que nem o anúncio nem o tipo de
  // produto respondem; tudo o mais agora vem pré-preenchido em "Revise antes de aceitar").
  check('e diz por que está vazio', /s[óo] voc[êe] sabe|nem o an[úu]ncio nem o tipo de produto/i.test(txt), txt.slice(0, 200));
  check('sem prometer que a IA não chuta (ela chuta agora)', !/n[ãa]o chuta/i.test(txt));
  check('não conta pro vendedor quantas a peneira descartou', !/descartad/i.test(txt));
  // 31/08: em vez de um botão de lote só, cada bloco tem o seu e existe um "aplicar tudo".
  check('o botão de aplicar tudo existe', /Aplicar tudo/i.test(txt), txt.slice(0, 160));
  check('e cada bloco tem o seu botão', /Aplicar os marcados|Aplicar as/i.test(txt));
  check('avisa que o campo caro renomeia', /perde a exposi|muda(r)? o link|troca o link/i.test(txt));
  check('nunca escreve "atributo"', !/atributo/i.test(txt), txt.slice(0, 200));
  check('nunca escreve GPT/OpenAI', !/gpt|openai/i.test(txt));
}

console.log('\n== render: a lista de palavras novas (D9) ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'ok', dados: RESPOSTA, campos: CAMPOS, placar: { preenchidos: 2, total: 4 } });
  const html = el('ficha-ia-body').innerHTML;
  const txt = el('ficha-ia-body').textContent;
  check('a seção existe', /palavras novas/i.test(txt), txt.slice(0, 300));
  // 06/09 (tela limpa): o aviso da seção virou o "?" do título; continua na tela, como title.
  check('avisa que quem afirma é o vendedor (title do "?" da seção)', /só o que é verdade|s[óo] o que [ée] verdade/i.test(html));
  check('mostra quantas buscas a palavra abre', /6 buscas/.test(txt), txt.slice(0, 400));
  check('mostra os combos', html.includes('panela antiaderente'));
  check('avisa que o anúncio não diz isso hoje (title do "?" da seção)', /n[ãa]o diz isso/i.test(html));
  // O checkbox dela nasce SEM checked — é a trava que impede afirmar por inércia.
  const bloco = html.slice(html.indexOf('fia-nova'));
  check('nasce DESMARCADA', bloco.indexOf('checked') === -1 || bloco.indexOf('data-nova') < bloco.indexOf('checked'),
    bloco.slice(0, 200));
  // Desde 31/08 tudo nasce marcado: o vendedor confere e desmarca o que discordar. O botão
  // conta as 4 (3 com evidência + 1 palavra nova) e recalcula a cada marcar/desmarcar.
  // 3, não 4: são 2 com evidência + 1 palavra nova. A "Cor" é campo que muda o link, então
  // fica fora do lote — e o número do botão prova isso sem precisar de outra asserção.
  check('o "aplicar tudo" conta tudo que está marcado, menos o campo caro',
    /Aplicar tudo[\s\S]{0,80}\(3\)/.test(html), txt.slice(0, 300));
  check('e a palavra nova nasce marcada', /fia-check-nova[^>]*checked/.test(html), html.slice(html.indexOf('fia-check-nova'), html.indexOf('fia-check-nova') + 120));
  check('cada bloco tem marcar/desmarcar todos', /Marcar todos[\s\S]{0,200}Desmarcar todos/.test(html));
}

// Campo que já tem valor curto ("Forro duplo", 11 de 30) também recebe palavra nova — o
// servidor soma nos 19 que sobram e recusa qualquer proposta que perca palavra do valor
// antigo. Mas quem lê a tela vê só o valor novo na caixa: sem dizer que é SOMA, o vendedor
// desmarca com medo de apagar o que escreveu.
console.log('\n== palavra nova em campo que já tinha valor: soma, não substitui ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', {
    estado: 'ok',
    dados: {
      ok: true,
      sugestoes: [],
      palavras_novas_sugeridas: [
        { id: 'FINISH', name: 'Acabamento', valor: 'Inox antiaderente', atual: 'Inox',
          palavra: 'antiaderente', combos: [], buscas: 6, caracteres: 17 },
      ],
      sem_base: [], descartadas: 0,
    },
    campos: CAMPOS,
    placar: { preenchidos: 2, total: 4 },
  });
  const html = el('ficha-ia-body').innerHTML;
  const txt = el('ficha-ia-body').textContent;
  check('diz que acrescenta ao valor de hoje', /acrescenta a:/i.test(txt), txt.slice(0, 300));
  check('e mostra qual era o valor', /Inox/.test(txt));
  // Riscar diria que "Inox" está saindo, e não está.
  check('não risca o valor antigo', !/<s>[\s\S]{0,40}Inox/.test(html), html.slice(0, 400));

  // Campo vazio não pode ganhar a nota de soma — ali não há nada a que somar.
  M.renderPainel('ficha-ia-body', {
    estado: 'ok',
    dados: {
      ok: true,
      sugestoes: [],
      palavras_novas_sugeridas: [
        { id: 'FINISH', name: 'Acabamento', valor: 'Antiaderente', palavra: 'antiaderente', combos: [], buscas: 6, caracteres: 12 },
      ],
      sem_base: [], descartadas: 0,
    },
    campos: CAMPOS,
    placar: { preenchidos: 2, total: 4 },
  });
  check('campo vazio não fala em acrescentar', !/acrescenta a:/i.test(el('ficha-ia-body').textContent));
}

// Um campo recebe quantas palavras couberem nos 30. Enquanto a linha mostrava só a
// primeira, o vendedor via um ganho cinco vezes menor do que o real e podia desmarcar
// achando que não valia a pena (visto em MLB6683355884, 31/08/2026).
console.log('\n== a linha mostra TODAS as palavras que entraram, e a soma das buscas ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', {
    estado: 'ok',
    dados: {
      ok: true,
      sugestoes: [],
      palavras_novas_sugeridas: [
        { id: 'AGID', name: 'AGID', valor: 'look,encontro,peca', palavra: 'look', buscas: 7,
          entraram: [
            { palavra: 'look', buscas: 4 },
            { palavra: 'encontro', buscas: 2 },
            { palavra: 'peca', buscas: 1 },
          ],
          combos: [], caracteres: 18 },
      ],
      sem_base: [], descartadas: 0,
    },
    campos: CAMPOS,
    placar: { preenchidos: 2, total: 4 },
  });
  const txt = el('ficha-ia-body').textContent;
  check('diz quantas palavras entraram', /3 palavras/.test(txt), txt.slice(0, 300));
  check('e nomeia todas', /look/.test(txt) && /encontro/.test(txt) && /peca/.test(txt), txt.slice(0, 300));
  check('com a soma das buscas, não só a da primeira', /7 buscas/.test(txt), txt.slice(0, 300));

  // Uma palavra só continua lendo como antes — plural forçado soaria errado.
  M.renderPainel('ficha-ia-body', {
    estado: 'ok',
    dados: {
      ok: true,
      sugestoes: [],
      palavras_novas_sugeridas: [
        { id: 'AGID', name: 'AGID', valor: 'look', palavra: 'look', buscas: 4,
          entraram: [{ palavra: 'look', buscas: 4 }], combos: [], caracteres: 4 },
      ],
      sem_base: [], descartadas: 0,
    },
    campos: CAMPOS,
    placar: { preenchidos: 2, total: 4 },
  });
  const um = el('ficha-ia-body').textContent;
  check('uma palavra só não vira "1 palavras"', !/1 palavras/.test(um) && /4 buscas/.test(um), um.slice(0, 200));
}

console.log('\n== render: nada passou na régua != falha ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', {
    estado: 'ok',
    dados: { ok: true, sugestoes: [], sem_base: CAMPOS.map((c) => ({ id: c.id, name: c.name })), descartadas: 4 },
    campos: CAMPOS, placar: { preenchidos: 2, total: 4 },
  });
  const txt = el('ficha-ia-body').textContent;
  check('diz que olhou e não achou base', /n[ãa]o achei|n[ãa]o encontrei/i.test(txt), txt.slice(0, 200));
  check('sugere o caminho (completar a descrição)', /descri/i.test(txt));
  check('lista os campos sem base', txt.includes('Voltagem') && txt.includes('Material'));
}

console.log('\n== render: falha NUNCA vira zero ==');
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'falha', dados: null, campos: CAMPOS, placar: { preenchidos: 2, total: 4 } });
  const txt = el('ficha-ia-body').textContent;
  check('diz que a consulta falhou', /n[ãa]o consegui|n[ãa]o deu|n[ãa]o foi poss/i.test(txt), txt.slice(0, 200));
  check('oferece tentar de novo', /tentar de novo|tente de novo/i.test(txt));
  check('NÃO diz que não há campo pra melhorar', !/nenhum campo|tudo certo|nada a melhorar/i.test(txt));
}
{
  const { M, el } = carregar();
  M.renderPainel('ficha-ia-body', { estado: 'ocupado', dados: null, campos: CAMPOS, placar: { preenchidos: 2, total: 4 } });
  const txt = el('ficha-ia-body').textContent;
  check('429 é estado explícito', /ocupada|aguarde|alguns segundos/i.test(txt), txt.slice(0, 200));
  check('e não vira zero', !/nenhum campo/i.test(txt));
}

console.log('\n== render: ficha completa é conclusão, não vazio ==');
{
  const { M, el } = carregar();
  const todos = CAMPOS.map((c) => ({ ...c, preenchido: true }));
  M.renderPainel('ficha-ia-body', {
    estado: 'ok', dados: { ok: true, sugestoes: [], sem_base: [], descartadas: 0 },
    campos: todos, placar: { preenchidos: 4, total: 4 },
  });
  const txt = el('ficha-ia-body').textContent;
  check('comemora a conclusão', txt.includes('🎉'), txt.slice(0, 200));
  check('placar cheio', txt.includes('4 de 4'));
}

console.log('\n== buscarSugestoes: mapeia status pra estado ==');
(async () => {
  {
    const { M, box } = carregar({ resposta: RESPOSTA });
    const r = await M.buscarSugestoes({ titulo: 'x', campos: [{ id: 'A' }] });
    check('200 vira ok', r.estado === 'ok', r.estado);
    check('chama o proxy na rota certa', box.chamadas[0].url.includes('/api/gpt-ficha'));
    check('manda o token no header, nunca na URL',
      !!box.chamadas[0].init.headers.Authorization && !box.chamadas[0].url.includes('Bearer'));
  }
  {
    const { M } = carregar({ status: 429 });
    check('429 vira ocupado', (await M.buscarSugestoes({ titulo: 'x', campos: [{ id: 'A' }] })).estado === 'ocupado');
  }
  {
    const { M } = carregar({ status: 403 });
    check('403 vira sem_plano', (await M.buscarSugestoes({ titulo: 'x', campos: [{ id: 'A' }] })).estado === 'sem_plano');
  }
  {
    const { M } = carregar({ status: 401 });
    check('401 vira sessao', (await M.buscarSugestoes({ titulo: 'x', campos: [{ id: 'A' }] })).estado === 'sessao');
  }
  {
    const { M } = carregar({ falhar: true });
    check('rede caída vira falha', (await M.buscarSugestoes({ titulo: 'x', campos: [{ id: 'A' }] })).estado === 'falha');
  }
  {
    const { M, box } = carregar({ resposta: RESPOSTA });
    await M.buscarSugestoes({ titulo: 'x', campos: [{ id: 'A' }] });
    await M.buscarSugestoes({ titulo: 'x', campos: [{ id: 'A' }] });
    check('sem retry automático: 2 pedidos = 2 chamadas, nunca 4', box.chamadas.length === 2, String(box.chamadas.length));
  }

  // Desde o P2 (30/08) quem lê o anúncio é o proxy, no ML — e as recusas de LÁ chegam aqui
  // com `code`. Dois 403 diferentes: um manda ativar plano, o outro diz que o anúncio é de
  // outra conta. Mandar o vendedor ativar um plano que ele já tem é pior que não avisar.
  const rotaComCode = (status, code) => [[/gpt-ficha/, async () => ({ status, body: { error: 'x', code } })]];
  {
    const { M } = carregar({ rotas: rotaComCode(403, 'anuncio_de_outra_conta') });
    check('403 de anúncio alheio NÃO vira sem_plano',
      (await M.buscarSugestoes({}, 'u', 'tok')).estado === 'outra_conta');
  }
  {
    const { M } = carregar({ rotas: rotaComCode(403, 'sem_plano') });
    check('403 de plano continua sem_plano', (await M.buscarSugestoes({}, 'u', 'tok')).estado === 'sem_plano');
  }
  {
    const { M } = carregar({ rotas: rotaComCode(404, 'anuncio_nao_encontrado') });
    check('404 vira nao_encontrado', (await M.buscarSugestoes({}, 'u', 'tok')).estado === 'nao_encontrado');
  }
  {
    const { M } = carregar({ rotas: rotaComCode(502, 'anuncio_ilegivel') });
    check('não conseguir ler o anúncio é estado próprio, não "não achei base"',
      (await M.buscarSugestoes({}, 'u', 'tok')).estado === 'anuncio_ilegivel');
  }
  {
    const { M } = carregar({ rotas: rotaComCode(503, 'ml_indisponivel') });
    check('ML fora também', (await M.buscarSugestoes({}, 'u', 'tok')).estado === 'anuncio_ilegivel');
  }
  {
    const { M, box } = carregar({ resposta: RESPOSTA });
    await M.buscarSugestoes({ item_id: 'MLB1' }, 'user-1', 'TOKEN-ML');
    const h = box.chamadas[0].init.headers;
    check('o token do ML viaja em header próprio', h['X-ML-Token'] === 'TOKEN-ML', JSON.stringify(h));
    check('e o Authorization continua sendo o user_id do app', h.Authorization === 'Bearer user-1');
  }
  {
    const { M } = carregar({ rotas: [[/gpt-ficha/, async () => ({ status: 200, body: { ok: true, sugestoes: [] } })]] });
    const r = await M.buscarSugestoes({}, 'u', 'tok');
    check('200 continua entregando o corpo', r.estado === 'ok' && r.dados.ok === true, JSON.stringify(r));
  }

  console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
