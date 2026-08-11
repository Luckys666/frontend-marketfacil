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

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
