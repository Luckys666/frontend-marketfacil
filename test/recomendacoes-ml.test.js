'use strict';
/*
 * Recomendações do Mercado Livre na tela de análise (Lucas, 10/08/2026:
 * "estão aparecendo duplicadas em algumas contas").
 *
 * Eram DOIS defeitos no mesmo lugar:
 *  1. A mesma lista (mlQuality.pending) era renderizada em dois cards — "Checklist
 *     Rápido" mostrava as 3 primeiras como "Prioridades ML" e "O que Melhorar" mostrava
 *     todas. As 3 primeiras saíam duas vezes na mesma tela. Só acontecia em anúncio
 *     ATIVO com pendência (a /performance dá 400 em pausado e em catálogo), o que
 *     explica o "em algumas contas".
 *  2. Dentro da própria lista: uma `variable` com várias `rules` pendentes gera uma linha
 *     por regra, e quando a regra não traz `wordings.title` todas caem no mesmo fallback
 *     — mesma frase repetida N vezes.
 *
 * Rodar: node test/recomendacoes-ml.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get, reg, sandbox } = carregar();
const extractMLQualityItems = get('extractMLQualityItems');
const exibirChecklistRapido = get('exibirChecklistRapido');
const exibirPontuacao = get('exibirPontuacao');

console.log('recomendacoes-ml.test.js');

// ── massa: resposta de /item/{id}/performance como a ML devolve ──────────
const perfComRegrasSemTitulo = {
  score: 62,
  level: 'STANDARD',
  buckets: [{
    title: 'Ficha técnica',
    variables: [{
      key: 'ATTRIBUTES',
      title: 'Complete a ficha técnica',
      status: 'PENDING',
      // três regras pendentes, NENHUMA com wordings.title → todas caem no fallback
      rules: [
        { key: 'R1', status: 'PENDING', mode: 'OPPORTUNITY' },
        { key: 'R2', status: 'PENDING', mode: 'OPPORTUNITY' },
        { key: 'R3', status: 'PENDING', mode: 'WARNING' }
      ]
    }]
  }]
};

const perfNormal = {
  score: 80,
  level: 'STANDARD',
  buckets: [{
    title: 'Qualidade',
    variables: [
      {
        key: 'PICTURES', title: 'Melhore as fotos', status: 'PENDING',
        rules: [{ key: 'P1', status: 'PENDING', mode: 'WARNING', wordings: { title: 'Suba fotos com fundo branco', label: 'Corrigir', link: 'https://ml/fotos' } }]
      },
      {
        key: 'GTIN', title: 'Informe o código universal', status: 'PENDING',
        rules: [{ key: 'G1', status: 'PENDING', mode: 'OPPORTUNITY', wordings: { title: 'Informe o código universal do produto' } }]
      },
      { key: 'DESC', title: 'Descrição completa', status: 'COMPLETED', rules: [] },
      { key: 'SHIP', title: 'Frete grátis', status: 'COMPLETED', rules: [] }
    ]
  }]
};

// ── 1. dedup dentro da lista ────────────────────────────────────────────
console.log('\n== dedup dentro da lista ==');
{
  const q = extractMLQualityItems(perfComRegrasSemTitulo);
  check('3 regras sem wordings.title viram UMA linha',
    q.pending.length === 1, `veio ${q.pending.length}: ${JSON.stringify(q.pending.map(p => p.text))}`);
  check('o texto é o título da variable',
    q.pending[0] && q.pending[0].text === 'Complete a ficha técnica', JSON.stringify(q.pending[0]));
}

// ── 2. dedup prefere a linha acionável ──────────────────────────────────
console.log('\n== dedup mantém a linha com link ==');
{
  const perf = {
    score: 50, level: 'BASIC',
    buckets: [{
      title: 'B', variables: [{
        key: 'V', title: 'Mesma frase', status: 'PENDING',
        rules: [
          { key: 'A', status: 'PENDING', mode: 'OPPORTUNITY' }, // sem link
          { key: 'B', status: 'PENDING', mode: 'OPPORTUNITY', wordings: { title: 'Mesma frase', label: 'Resolver', link: 'https://ml/resolver' } }
        ]
      }]
    }]
  };
  const q = extractMLQualityItems(perf);
  check('duas regras com o mesmo texto viram uma', q.pending.length === 1, String(q.pending.length));
  check('a que sobra é a que tem link (é a acionável)',
    q.pending[0] && q.pending[0].link === 'https://ml/resolver', JSON.stringify(q.pending[0]));
}

// ── 3. o que não é duplicata continua inteiro ───────────────────────────
console.log('\n== recomendações distintas não são engolidas ==');
{
  const q = extractMLQualityItems(perfNormal);
  check('duas pendências distintas continuam duas', q.pending.length === 2, JSON.stringify(q.pending.map(p => p.text)));
  check('completos distintos continuam dois', q.completed.length === 2, JSON.stringify(q.completed.map(p => p.text)));
  check('score e level preservados', q.score === 80 && q.level === 'standard', `${q.score}/${q.level}`);
  check('modo WARNING preservado', q.pending.some(p => p.mode === 'WARNING'));
}

// ── 4. sem dado da ML não inventa lista ─────────────────────────────────
console.log('\n== ausência de dado não vira lista vazia enganosa ==');
{
  check('performanceData null → null', extractMLQualityItems(null) === null);
  check('sem buckets → null', extractMLQualityItems({ score: 10 }) === null);
  check('buckets não-array → null', extractMLQualityItems({ buckets: 'x' }) === null);
  const vazio = extractMLQualityItems({ score: 100, buckets: [] });
  check('buckets vazio → listas vazias (não null)', vazio && vazio.pending.length === 0 && vazio.completed.length === 0);
}

// ── 5. a duplicação de TELA: só um card renderiza as recomendações ──────
console.log('\n== só um card mostra as recomendações ==');
{
  const detail = {
    id: 'MLB1', title: 'Produto teste', pictures: [{ id: 1 }, { id: 2 }, { id: 3 }],
    attributes: [], sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }],
    status: 'active'
  };
  const descricao = { plain_text: 'descrição longa o suficiente para contar' };

  exibirChecklistRapido(detail, descricao, 'quickChecklist');
  const htmlChecklist = reg['quickChecklist'] ? reg['quickChecklist'].innerHTML : '';
  check('Checklist Rápido não fala mais em "Prioridades ML"',
    !htmlChecklist.includes('Prioridades ML'), htmlChecklist.slice(0, 200));
  check('Checklist Rápido continua mostrando o que é dele (garantia/imagens)',
    htmlChecklist.includes('Garantia') && htmlChecklist.includes('Imagens'), htmlChecklist.slice(0, 200));

  exibirPontuacao(70, false, 'scoreCircle', { title: detail.title, detail }, 'scoreChecklist', perfNormal);
  const htmlScore = reg['scoreChecklist'] ? reg['scoreChecklist'].innerHTML : '';

  /*
   * 13/08/2026 — o par de 11/08 (Checklist × O que Melhorar) foi resolvido, mas na tela
   * a recomendação continuava saindo duas vezes: sobrou "O que Melhorar" × o card
   * "Qualidade do Anúncio (Mercado Livre)", que renderiza a MESMA `mlQuality.pending`,
   * com os mesmos deep links, só que agrupada por bloco e com %.
   * Medido em MLB3264800533: "Preencha as características principais", "Ofereça frete
   * grátis…" e "Participe de uma promoção…" em dois nós do DOM, em cards diferentes.
   *
   * Decisão do Lucas (13/08): fica só no card dedicado, que já tem o nível, o % por bloco
   * e as concluídas. "O que Melhorar" volta a ser só dos nossos checks.
   * As duas fontes são o MESMO `performanceData`, então nada some sozinho: sem dado da ML
   * o card dedicado já diz "Qualidade ainda não calculada" e não havia o que mostrar.
   */
  check('"O que Melhorar" não repete mais as Ações Recomendadas pelo ML',
    !htmlScore.includes('Ações Recomendadas pelo ML'), htmlScore.slice(0, 200));
  check('e nenhuma recomendação da ML sobrou nele',
    !htmlScore.includes('fundo branco') && !htmlScore.includes('código universal'), htmlScore.slice(0, 300));
  check('"O que Melhorar" continua mostrando os checks que são DELE',
    htmlScore.includes('Título') || htmlScore.includes('Descrição') || htmlScore.includes('Garantia'),
    htmlScore.slice(0, 300));

  // O card dedicado é quem carrega a lista — e com os links, senão a recomendação vira
  // aviso sem saída.
  const exibirPerf = get('exibirPerformance');
  exibirPerf(perfNormal, 'performanceTexto0');
  const htmlPerf = reg['performanceTexto0'] ? reg['performanceTexto0'].innerHTML : '';
  check('o card "Qualidade do Anúncio (ML)" mostra as duas recomendações',
    htmlPerf.includes('fundo branco') && htmlPerf.includes('código universal'), htmlPerf.slice(0, 300));
  check('e mantém o link de resolver', htmlPerf.includes('https://ml/fotos'), htmlPerf.slice(0, 300));

  // A frase não pode sair em NENHUM par de cards da mesma tela.
  const frase = 'fundo branco';
  const cardsComAFrase = [htmlChecklist, htmlScore, htmlPerf].filter((h) => h.includes(frase)).length;
  check('cada recomendação aparece em UM card só', cardsComAFrase === 1, `apareceu em ${cardsComAFrase} cards`);
}

// ── 6. contagem do cabeçalho bate com o que está na tela ────────────────
console.log('\n== a contagem do cabeçalho bate com as linhas ==');
{
  /*
   * O contador mudou de card em 13/08 junto com a lista. O que ele não pode fazer é
   * discordar do que está desenhado logo abaixo — é a classe de bug das três contagens de
   * campos (05/08). Com três regras caindo no mesmo fallback, a tela mostra UMA linha:
   * o cabeçalho tem que dizer 1, não 3.
   */
  const q = extractMLQualityItems(perfComRegrasSemTitulo);
  const exibirPerformance = get('exibirPerformance');
  exibirPerformance(perfComRegrasSemTitulo, 'performanceTexto2');
  const html = reg['performanceTexto2'] ? reg['performanceTexto2'].innerHTML : '';
  const linhasNaTela = (html.match(/Complete a ficha técnica/g) || []).length;
  check('a tela mostra UMA linha (as 3 regras deduplicadas)', linhasNaTela === 1, String(linhasNaTela));
  check(`e o cabeçalho diz ${q.pending.length} pendente, batendo com ela`,
    html.includes(`${q.pending.length} pendente`),
    `esperado "${q.pending.length} pendente" | html tem: ${(html.match(/\d+ pendente/g) || []).join(',')}`);

  // E o card que perdeu a seção não pode ter ficado com um contador órfão.
  exibirPontuacao(50, false, 'scoreCircle2', { title: 't', detail: { id: 'MLB2', attributes: [] } }, 'scoreChecklist2', perfComRegrasSemTitulo);
  const htmlMelhorar = reg['scoreChecklist2'] ? reg['scoreChecklist2'].innerHTML : '';
  check('"O que Melhorar" não ficou com contador X/Y sem lista',
    !/\d+\/\d+/.test(htmlMelhorar), (htmlMelhorar.match(/\d+\/\d+/g) || []).join(','));
}

// ── card "Qualidade do Anúncio (Mercado Livre)" ─────────────────────────
console.log('\n== a ML repete o texto na variable e na rule ==');
{
  // Medido na conta em 11/08/2026 (reclamação de usuários): em 11 anúncios ativos,
  // 18 de 36 linhas de regra tinham texto IDÊNTICO ao título da variável logo acima —
  // metade do card era a mesma frase duas vezes:
  //     ○ Participe de uma promoção para receber mais visitas
  //        💡 Participe de uma promoção para receber mais visitas
  const exibirPerformance = get('exibirPerformance');
  const perf = {
    score: 60, level: 'STANDARD',
    buckets: [{
      title: 'Exposição', key: 'EXPOSURE', score: 40,
      variables: [
        {
          key: 'PROMO', title: 'Participe de uma promoção para receber mais visitas',
          status: 'PENDING', score: 0,
          rules: [{ key: 'R1', status: 'PENDING', mode: 'OPPORTUNITY',
            wordings: { title: 'Participe de uma promoção para receber mais visitas', label: 'Criar promoção', link: 'https://ml/promo' } }]
        },
        {
          key: 'FRETE', title: 'Frete grátis', status: 'PENDING', score: 20,
          rules: [{ key: 'R2', status: 'PENDING', mode: 'WARNING',
            wordings: { title: 'Ofereça frete grátis para ficar mais competitivo', label: 'Ativar', link: 'https://ml/frete' } }]
        }
      ]
    }]
  };
  exibirPerformance(perf, 'performanceTexto');
  const html = reg['performanceTexto'].innerHTML;
  const txt = reg['performanceTexto'].textContent;

  const frase = 'Participe de uma promoção para receber mais visitas';
  const vezes = txt.split(frase).length - 1;
  check('a frase repetida aparece UMA vez só', vezes === 1, `apareceu ${vezes}x`);

  // O que a regra agrega além do texto é a AÇÃO — isso não pode sumir junto.
  check('o link da regra continua na tela', html.includes('https://ml/promo'), '');
  check('e o rótulo da ação também', txt.includes('Criar promoção'), '');

  // Regra com texto DIFERENTE continua aparecendo: ali ela acrescenta informação.
  check('regra com texto próprio continua sendo mostrada',
    txt.includes('Ofereça frete grátis para ficar mais competitivo'), '');
  check('e o título da variável dela também', txt.includes('Frete grátis'), '');
  check('link da outra regra preservado', html.includes('https://ml/frete'), '');
}

console.log('\n== variação de caixa/acento não escapa da dedup ==');
{
  const exibirPerformance = get('exibirPerformance');
  const perf = {
    score: 50, level: 'BASIC',
    buckets: [{
      title: 'B', key: 'B', score: 10,
      variables: [{
        key: 'V', title: 'Adicione ficha técnica', status: 'PENDING',
        rules: [{ key: 'R', status: 'PENDING', mode: 'OPPORTUNITY',
          wordings: { title: 'ADICIONE FICHA TÉCNICA', label: 'Ir', link: 'https://ml/ft' } }]
      }]
    }]
  };
  exibirPerformance(perf, 'performanceTexto2');
  const txt = reg['performanceTexto2'].textContent;
  const n = (txt.match(/dicione ficha/gi) || []).length;
  check('mesma frase em caixa diferente conta como repetida', n === 1, `apareceu ${n}x`);
}

console.log('\n== o que não é repetição continua intacto ==');
{
  const exibirPerformance = get('exibirPerformance');
  const perf = {
    score: 90, level: 'PREMIUM',
    buckets: [{
      title: 'Ficha', key: 'F', score: 90,
      variables: [
        { key: 'OK', title: 'Descrição completa', status: 'COMPLETED', score: 100, rules: [] },
        { key: 'V2', title: 'Fotos', status: 'PENDING', score: 50, rules: [
          { key: 'A', status: 'PENDING', mode: 'OPPORTUNITY', wordings: { title: 'Suba fotos de 1200x1200' } },
          { key: 'B', status: 'PENDING', mode: 'WARNING', wordings: { title: 'Remova texto sobreposto' } }
        ] }
      ]
    }]
  };
  exibirPerformance(perf, 'performanceTexto3');
  const txt = reg['performanceTexto3'].textContent;
  check('variável concluída continua listada', txt.includes('Descrição completa'));
  check('as duas regras distintas aparecem',
    txt.includes('Suba fotos de 1200x1200') && txt.includes('Remova texto sobreposto'));
  check('o título da variável aparece', txt.includes('Fotos'));
  check('o score do bucket aparece', txt.includes('90%'));
}

/* =========================================================================
   13/08/2026 — o card não pode falar pelo Mercado Livre

   Visto ao vivo em MLB3426071385: a tela dizia "Qualidade ainda não calculada pelo ML" e
   a mesma rota respondia 200 com score 58. A chamada tinha falhado uma vez (o proxy vinha
   apanhando de rate limit) e `fetchApiData` engole TODO erro devolvendo null — que o card
   desenhava como uma afirmação sobre a ML.

   É a regra do "falha nunca vira zero" com outra roupa: em vez de virar 0, virou "eles não
   calcularam". O vendedor lê e conclui que o problema é de lá.

   400 continua sendo ausência legítima: é o que a ML responde em anúncio pausado e em
   catálogo, onde ela realmente não calcula qualidade.
   ========================================================================= */
console.log('\n== falha de rede não vira recado do Mercado Livre ==');
{
  const exibirPerformance = get('exibirPerformance');

  exibirPerformance({ _falhou: true, _status: 429 }, 'perfFalhou');
  const htmlFalha = reg['perfFalhou'].innerHTML;
  const textoFalha = reg['perfFalhou'].textContent;
  check('falha NÃO diz que o ML não calculou', !/não calculada/i.test(textoFalha), textoFalha.slice(0, 200));
  check('falha assume que o problema é nosso', /não deu para consultar|não conseguimos/i.test(textoFalha), textoFalha.slice(0, 200));
  check('e oferece tentar de novo', /mfRecarregarQualidadeML/.test(htmlFalha), htmlFalha.slice(0, 400));

  // Ausência de verdade continua com o texto de ausência.
  exibirPerformance(null, 'perfVazio');
  const textoVazio = reg['perfVazio'].textContent;
  check('sem dado da ML segue dizendo "ainda não calculada"', /não calculada/i.test(textoVazio), textoVazio.slice(0, 200));
  check('e ausência não oferece "tentar de novo"', !/mfRecarregarQualidadeML/.test(reg['perfVazio'].innerHTML), reg['perfVazio'].innerHTML.slice(0, 300));
}

/* =========================================================================
   13/08 — "na visão do mercado livre ainda tem mensagem falando pra preencher no mercado
   livre mesmo a gente já tendo ajustado teoricamente os campos" (Lucas).

   `reRenderAnalysisView` reusa o performanceData do CARREGAMENTO: salvar não reconsulta a
   ML, então o card fica congelado no estado de quando a página abriu. E mesmo
   reconsultando, a /performance da ML atualiza "periodicamente".

   Some a linha seria mentir na outra direção — não sabemos se a ML aceitou. Então a linha
   fica, marcada: o vendedor entende por que ela ainda está ali.
   ========================================================================= */
console.log('\n== o que o vendedor acabou de resolver aparece marcado ==');
{
  const exibirPerformance = get('exibirPerformance');
  const perf = {
    score: 58, level: 'STANDARD',
    buckets: [{
      title: 'Ficha', key: 'USER_PRODUCT', score: 40,
      variables: [
        { key: 'UP_TECHNICAL_SPECIFICATIONS_MAIN', title: 'Preencha as características principais', status: 'PENDING', score: 0,
          rules: [{ key: 'R1', status: 'PENDING', mode: 'OPPORTUNITY', wordings: { title: 'Preencha as características principais', label: 'Preencher', link: 'https://ml/ficha' } }] },
        { key: 'UP_FREE_SHIPPING', title: 'Ofereça frete grátis', status: 'PENDING', score: 0, rules: [] },
      ],
    }],
  };

  sandbox.currentAnalysisState = { detail: { id: 'MLB1' }, resolvidosNoML: new Set(['UP_TECHNICAL_SPECIFICATIONS_MAIN']) };
  exibirPerformance(perf, 'perfMarcado');
  const texto = reg['perfMarcado'].textContent;
  check('a linha resolvida ganha a marcação', /você (resolveu|preencheu) isso agora/i.test(texto), texto.slice(0, 500));
  check('e a marcação explica a demora sem prometer prazo',
    /leva um tempo|pode demorar/i.test(texto) && !/\d+\s*(minutos?|horas?)/i.test(texto), texto.slice(0, 500));
  check('a linha NÃO some (não sabemos se a ML aceitou)', /Preencha as características principais/.test(texto), texto.slice(0, 400));
  check('o que não foi mexido continua sem marcação',
    (texto.match(/você resolveu isso agora/gi) || []).length === 1, String((texto.match(/você resolveu isso agora/gi) || []).length));

  sandbox.currentAnalysisState = { detail: { id: 'MLB1' } };
  exibirPerformance(perf, 'perfSemMarca');
  check('sem nada resolvido, nenhuma marcação', !/você resolveu isso agora/i.test(reg['perfSemMarca'].textContent),
    reg['perfSemMarca'].textContent.slice(0, 300));
}
{
  // O mapa attrId → chave da ML. Salvar um campo qualquer da ficha marca a linha de ficha
  // técnica; GTIN tem linha própria na ML e marca a dele.
  const MF_marcaResolvidoNoML = get('MF_marcaResolvidoNoML');
  const st = { detail: { id: 'MLB1' } };
  MF_marcaResolvidoNoML(st, 'BRAND');
  check('atributo comum marca a ficha técnica', st.resolvidosNoML.has('UP_TECHNICAL_SPECIFICATIONS_MAIN'), JSON.stringify([...st.resolvidosNoML]));
  MF_marcaResolvidoNoML(st, 'GTIN');
  check('GTIN marca a linha de GTIN', st.resolvidosNoML.has('UP_GTIN'), JSON.stringify([...st.resolvidosNoML]));
  check('e não apaga a marcação anterior', st.resolvidosNoML.has('UP_TECHNICAL_SPECIFICATIONS_MAIN'), JSON.stringify([...st.resolvidosNoML]));
  check('estado sem Set não quebra', (() => { const s = {}; MF_marcaResolvidoNoML(s, 'BRAND'); return s.resolvidosNoML && s.resolvidosNoML.size === 1; })());
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
