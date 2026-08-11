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

const { get, reg } = carregar();
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
  check('"O que Melhorar" mostra as Ações Recomendadas pelo ML',
    htmlScore.includes('Ações Recomendadas pelo ML'), htmlScore.slice(0, 200));
  check('e mostra as duas recomendações reais',
    htmlScore.includes('fundo branco') && htmlScore.includes('código universal'));

  // O ponto da correção: a mesma frase não pode sair nos dois cards.
  const frase = 'fundo branco';
  const nosDois = htmlChecklist.includes(frase) && htmlScore.includes(frase);
  check('nenhuma recomendação aparece nos DOIS cards', !nosDois,
    `checklist=${htmlChecklist.includes(frase)} score=${htmlScore.includes(frase)}`);
}

// ── 6. contagem do cabeçalho bate com o que está na tela ────────────────
console.log('\n== a contagem do cabeçalho bate com as linhas ==');
{
  // Com o dedup, o "X/Y" tem que contar a lista JÁ deduplicada — senão o cabeçalho diz 3
  // e a tela mostra 1, que é a mesma classe de bug das três contagens de campos (05/08).
  const q = extractMLQualityItems(perfComRegrasSemTitulo);
  exibirPontuacao(50, false, 'scoreCircle2', { title: 't', detail: { id: 'MLB2', attributes: [] } }, 'scoreChecklist2', perfComRegrasSemTitulo);
  const html = reg['scoreChecklist2'] ? reg['scoreChecklist2'].innerHTML : '';
  const esperado = `${q.pending.length}/${q.pending.length + q.completed.length}`;
  check(`cabeçalho mostra ${esperado} (a lista deduplicada)`, html.includes(esperado),
    `esperado ${esperado} | html tem: ${(html.match(/\d+\/\d+/g) || []).join(',')}`);
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

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
