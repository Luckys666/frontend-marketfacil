'use strict';
/*
 * As bordas — onde o code-review de 30/08/2026 achou 12 defeitos com a suíte 100% verde.
 *
 * O ponto cego era este: os outros arquivos testam lógica pura (evidência, validação,
 * render) com o fetch mockado, então nada olhava o CONTRATO entre ficha-ia.js, o proxy,
 * o ad-selector.js e o keyword-agent.js. Dois dos defeitos eram fatais — a feature não
 * funcionaria de jeito nenhum — e nenhum teste piscou.
 *
 * Cada bloco aqui trava um defeito daquela lista pelo NOME dele.
 *
 * Rodar: node test/ficha-ia-integracao.test.js
 */
const fs = require('fs');
const path = require('path');
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('ficha-ia-integracao.test.js');

const raiz = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
// Varre CÓDIGO, não comentário: os comentários citam de propósito o que era errado
// ("descriptions", "window.globalUserId") pra explicar por que a correção existe.
const lerCodigo = (...p) => ler(...p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

console.log('\n== #1 o shell do Seletor existe no bundle (senão o painel nunca sobe) ==');
{
  // ad-selector.js NÃO monta o próprio HTML: wireControls() chama addEventListener em
  // #filtersToggle sem guarda. Com o shell ausente ele lança, o boot cai no
  // legacyFallback e o painel some sem erro visível.
  const shell = ler('build', 'selector-shell.html');
  ['mfselRoot', 'panelView', 'analysisView', 'chipsCard', 'filtersCard', 'filtersToggle',
   'searchInput', 'orderSelect', 'tableHost', 'statusGroup']
    .forEach((id) => check('shell tem #' + id, shell.includes('id="' + id + '"')));
  check('shell tem a classe .mfsel (as 258 regras do CSS dependem dela)', /class="mfsel"/.test(shell));

  const bundle = ler('build', 'keyword-agent-inject-html.txt');
  check('o bundle do Agente leva o shell inteiro, não um div vazio',
    bundle.includes('id="filtersToggle"') && bundle.includes('id="panelView"'));
  check('e o div vazio não sobrou', !/<div id="mfselRoot"><\/div>/.test(bundle));
  check('o shell fica dentro do wrapper de escopo do CSS',
    /class="ana-wrapper mfsel-on"[^>]*>\s*<div class="mfsel"/.test(bundle));

  // O mesmo shell alimenta os DOIS bundles — se divergirem, um dos painéis quebra calado.
  const analyzer = ler('build', 'analyzer-bubble.html');
  check('o bundle da Análise usa o MESMO shell', analyzer.includes(shell.trim().split('\n')[0]));
  check('build-analyzer lê o shell do arquivo, não de uma string local',
    /selector-shell\.html/.test(ler('build-analyzer.js')));
  check('build do Agente idem', /selector-shell\.html/.test(ler('build', 'build-keyword-inject.js')));
  check('o build falha alto se o marcador sumir do template',
    /indexOf\(marcador\) === -1[\s\S]{0,140}throw new Error/.test(ler('build', 'build-keyword-inject.js')));
}

console.log('\n== #2 a descrição do /api/fetch-item é IRMÃ do body ==');
(async () => {
  {
    // Formato real do proxy (routes/itemsRoutes.js): [{ code, body, description }]
    const resposta = [{
      code: 200,
      body: { id: 'MLB1', title: 'Panela de Pressao 3 Litros', category_id: 'MLB1051', site_id: 'MLB', attributes: [] },
      description: { plain_text: 'Panela de aco com acabamento inox escovado.', text: '' },
    }];
    const { M, box } = carregar({ resposta });
    let payloadVisto = null;
    box.fetch = async (url, init) => {
      box.chamadas.push({ url: String(url), init: init || {} });
      if (String(url).includes('/api/gpt-ficha')) {
        payloadVisto = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ ok: true, sugestoes: [], palavras_novas_sugeridas: [], sem_base: [], descartadas: 0 }) };
      }
      if (String(url).includes('get-user-id')) return { ok: true, status: 200, json: async () => ({ response: { user_id: '1x2' } }) };
      if (String(url).includes('getAccessToken2')) return { ok: true, status: 200, json: async () => ({ response: { access_token: 'tok' } }) };
      if (String(url).includes('/api/attributes/')) return { ok: true, status: 200, json: async () => ([{ id: 'MATERIAL', name: 'Material', value_type: 'string', tags: {} }]) };
      if (String(url).includes('/api/catalog-quality')) return { ok: true, status: 200, json: async () => ({ available: false }) };
      return { ok: true, status: 200, json: async () => resposta };
    };
    await M.abrirFichaIA('MLB1');
    // O defeito #2 era ler `detail.descriptions.plain_text` (que não existe): a descrição
    // chegava sempre vazia e quase toda sugestão morria na régua. Desde o P2 (30/08) quem
    // lê a descrição é o proxy, no ML — então o que este bloco trava agora é o CONTRATO
    // novo: o front manda o ID, e a fonte de evidência não passa mais pelo navegador.
    check('o payload leva o ID do anúncio', payloadVisto && payloadVisto.item_id === 'MLB1',
      JSON.stringify(payloadVisto && payloadVisto.item_id));
    check('o payload NÃO leva a descrição', payloadVisto && !('descricao' in payloadVisto));
    check('o payload NÃO leva o título', payloadVisto && !('titulo' in payloadVisto));
  }
  {
    check('ninguém lê `descriptions` (plural não existe em item nenhum)',
      !/\.descriptions\b/.test(lerCodigo('js', 'ficha-ia.js')));
  }

  console.log('\n== #3 a chamada de IA vai autenticada ==');
  {
    check('não depende de window.globalUserId (é let dentro do IIFE do keyword-agent)',
      !/window\.globalUserId/.test(lerCodigo('js', 'ficha-ia.js')));
    check('busca o user_id no workflow do app', /get-user-id/.test(ler('js', 'ficha-ia.js')));

    const resposta = [{ code: 200, body: { id: 'MLB1', title: 'Panela', category_id: 'MLB1051', attributes: [] }, description: { plain_text: 'x' } }];
    const { M, box } = carregar({ resposta });
    let authIA = 'NAO CHAMOU';
    box.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/api/gpt-ficha')) { authIA = init.headers.Authorization; return { ok: true, status: 200, json: async () => ({ ok: true, sugestoes: [], sem_base: [] }) }; }
      if (u.includes('get-user-id')) return { ok: true, status: 200, json: async () => ({ response: { user_id: '1756x99' } }) };
      if (u.includes('getAccessToken2')) return { ok: true, status: 200, json: async () => ({ response: { access_token: 'tok' } }) };
      if (u.includes('/api/attributes/')) return { ok: true, status: 200, json: async () => ([]) };
      if (u.includes('/api/catalog-quality')) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => resposta };
    };
    await M.abrirFichaIA('MLB1');
    check('o Bearer leva o user_id de verdade', authIA === 'Bearer 1756x99', String(authIA));
    check('e nunca sai vazio', authIA !== 'Bearer ' && authIA !== 'Bearer undefined');
  }

  console.log('\n== #4 o listener não empilha (senão um clique vira N PUTs) ==');
  {
    const fonte = ler('js', 'ficha-ia.js');
    check('ligarBotoes tem guarda de uma vez só', /_botoesLigados/.test(fonte));
    const { M, box } = carregar();
    const ligados = [];
    const body = box.document.getElementById('ficha-ia-body');
    body.addEventListener = (tipo) => { ligados.push(tipo); };
    M.ligarBotoes(); M.ligarBotoes(); M.ligarBotoes();
    // São dois: `click` (aplicar) e `change` (recontar os botões ao marcar/desmarcar).
    // O que importa é que 3 chamadas não virem 6 listeners — aí um clique salvaria em
    // duplicata.
    check('3 chamadas não empilham listener', ligados.length === 2, ligados.join(','));
    check('e são um de cada tipo', ligados.includes('click') && ligados.includes('change'), ligados.join(','));
  }

  console.log('\n== #5 o retry nunca escreve no anúncio errado ==');
  {
    const { M } = carregar({ falhar: true });
    await M.abrirFichaIA('MLB_NOVO');
    check('o anúncio da vez é gravado ANTES do primeiro await',
      M._estado().itemId === 'MLB_NOVO', String(M._estado().itemId));
    check('e o detalhe do anúncio anterior não fica pendurado', M._estado().detail === null);
    check('nem os campos dele', M._estado().campos.length === 0);
  }

  console.log('\n== #4b/#8 estado por status: sessão expirada não é "instabilidade" ==');
  {
    const fonte = ler('js', 'ficha-ia.js');
    check('o catch olha e.status', /e\.status === 401/.test(fonte));
    check('401/403 viram sessao', /'sessao'/.test(fonte) && /403/.test(fonte));
    check('429 vira ocupado', /e\.status === 429\) \? 'ocupado'/.test(fonte));
  }

  console.log('\n== #7 o aviso de família não vaza pro próximo anúncio ==');
  {
    const { M, box } = carregar({ falhar: true });
    const head = box.document.getElementById('ficha-ia-head');
    head.innerHTML = '<p>Este anúncio faz parte de um grupo de variações.</p>';
    await M.abrirFichaIA('MLB_OUTRO');
    check('o aviso de família do anterior não sobrevive',
      !head.textContent.includes('grupo de variações'), head.textContent.slice(0, 80));
    // P1: o cabeçalho deixou de ser só o aviso — ele diz QUAL anúncio está aberto, desde o
    // primeiro instante. Sem isso, uma troca de anúncio no meio do carregamento é invisível.
    check('e o cabeçalho já mostra o anúncio da vez',
      head.textContent.includes('MLB_OUTRO'), head.textContent.slice(0, 80));
  }

  console.log('\n== #6 voltar sai do modo análise do Seletor ==');
  {
    const fonte = ler('js', 'ficha-ia.js');
    check('voltarParaLista chama o exitAnalysis do painel', /MFSelExitAnalysis/.test(fonte));
    check('e o Seletor expõe essa função', /window\.MFSelExitAnalysis\s*=\s*exitAnalysis/.test(ler('js', 'ad-selector.js')));
  }

  console.log('\n== #8 o bloqueio de marca concorrente não é burlável ==');
  {
    const { M } = carregar();
    const saida = M.formatarPalavrasQueFaltam([
      ['tramontina pro', { count: 3, categories: new Set(['utilidades', 'concorrencia']), phrases: ['linha pro'] }],
    ]);
    check('todas as categorias viajam, não só a primeira',
      Array.isArray(saida[0].categorias) && saida[0].categorias.length === 2, JSON.stringify(saida[0].categorias));
    check('a bloqueada está entre elas', saida[0].categorias.indexOf('concorrencia') >= 0);
  }

  console.log('\n== #9 deep-link ?item= não deixa tela em branco ==');
  {
    const sel = ler('js', 'ad-selector.js');
    check('skipTrigger depende do host renderizar sozinho', /skipTrigger: HOST\.resultsId !== null/.test(sel));
  }

  console.log('\n== #10 o erro do lote nomeia o campo que a ML recusou ==');
  {
    const MATERIAL = { id: 'MATERIAL', name: 'Material', value_type: 'string', tags: {} };
    const BRAND = { id: 'BRAND', name: 'Marca', value_type: 'string', tags: {} };
    const SOLTO = { id: 'MLB1', title: 'Panela', attributes: [] };
    const { M } = carregar({ status: 400, resposta: { cause: [{ code: 'invalid_length', message: 'too long', references: ['item.attributes[1].value_name'] }] } });
    const r = await M.aplicar('MLB1', [{ id: 'MATERIAL', valor: 'Aco' }, { id: 'BRAND', valor: 'X' }], [MATERIAL, BRAND], SOLTO, 'tok');
    check('aponta a Marca (índice 1), não o Material', /Marca/.test(r.erro), r.erro);
    check('e não culpa o primeiro campo do lote', !/^Material/.test(r.erro), r.erro);
  }

  console.log('\n== #11 salvar não repaga a IA ==');
  {
    const resposta = [{ code: 200, body: { id: 'MLB1', title: 'Panela', category_id: 'MLB1051', attributes: [] }, description: { plain_text: 'x' } }];
    const { M, box } = carregar();
    let chamadasIA = 0;
    box.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/api/gpt-ficha')) { chamadasIA++; return { ok: true, status: 200, json: async () => ({ ok: true, sugestoes: [], palavras_novas_sugeridas: [], sem_base: [], descartadas: 0 }) }; }
      if (u.includes('get-user-id')) return { ok: true, status: 200, json: async () => ({ response: { user_id: '1x2' } }) };
      if (u.includes('getAccessToken2')) return { ok: true, status: 200, json: async () => ({ response: { access_token: 'tok' } }) };
      if (u.includes('/api/attributes/')) return { ok: true, status: 200, json: async () => ([{ id: 'MATERIAL', name: 'Material', value_type: 'string', tags: {} }]) };
      if (u.includes('/api/catalog-quality')) return { ok: true, status: 200, json: async () => ({}) };
      if (u.includes('fetch-item-update')) return { ok: true, status: 200, json: async () => ({ id: 'MLB1', attributes: [] }) };
      return { ok: true, status: 200, json: async () => resposta };
    };
    await M.abrirFichaIA('MLB1');
    check('a abertura paga 1 chamada de IA', chamadasIA === 1, String(chamadasIA));
    await M.salvar([{ id: 'MATERIAL', valor: 'Aco inox' }]);
    check('salvar NÃO paga outra', chamadasIA === 1, String(chamadasIA));
    await M.salvar([{ id: 'MATERIAL', valor: 'Aco inox escovado' }]);
    check('nem o segundo save', chamadasIA === 1, String(chamadasIA));
  }

  console.log('\n== #12 o bundle da Análise está em dia com o fonte ==');
  {
    const bundle = ler('build', 'analyzer-bubble.html');
    const sel = ler('js', 'ad-selector.js');
    // Marcadores do que esta leva mudou no ad-selector: se o bundle não os tem, alguém
    // mexeu no fonte e esqueceu de rodar `node build-analyzer.js`.
    ['const HOST = Object.assign', 'function hostResultsEl()', 'window.MFSelExitAnalysis']
      .forEach((m) => {
        check('fonte tem "' + m + '"', sel.includes(m));
        check('bundle da Análise também', bundle.includes(m));
      });
  }

  console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
