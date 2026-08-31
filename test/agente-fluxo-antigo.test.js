'use strict';
/*
 * O painel novo é ADITIVO. Colar link continua funcionando — inclusive com anúncio de
 * TERCEIRO, que é justamente o que o painel novo (que lista só a conta do vendedor) não
 * cobre. Se este arquivo ficar vermelho, a feature nova tirou algo de quem já usava.
 *
 * Rodar: node test/agente-fluxo-antigo.test.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};

console.log('agente-fluxo-antigo.test.js');

const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'keyword-agent.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'keyword-agent-bubble.html'), 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '..', 'build', 'keyword-agent-inject-html.txt'), 'utf8');

console.log('\n== o fluxo de colar link continua inteiro ==');
[
  ['handleAnalyzeKeywords', /function handleAnalyzeKeywords/],
  ['normalizeMlInput (parse de link/ID/catálogo)', /function normalizeMlInput/],
  ['extractIndexedWords (palavras indexadas)', /function extractIndexedWords/],
  ['buildMissingWordsMap (palavras que faltam)', /function buildMissingWordsMap/],
  ['renderTitleGenerator (gerador de títulos)', /function renderTitleGenerator/],
  ['as 7 categorias de combos', /CATEGORY_CONFIG/],
  ['withMintRetry (retry de sessão)', /function withMintRetry/],
].forEach(([nome, re]) => check(nome + ' segue no arquivo', re.test(js)));

check('o scraper (que atende anúncio de terceiro) segue sendo chamado', /ml-scraper/.test(js));
check('gpt-palavras segue sendo chamado', /gpt-palavras/.test(js));
check('gpt-titulos segue sendo chamado', /gpt-titulos/.test(js));
check('retry do scraper continua limitado a 3', /MAX_SCRAPE_TRIES\s*=\s*3/.test(js));
check('e NÃO há retry no GPT', !/gpt-palavras[\s\S]{0,400}?MAX_.*TRIES/.test(js));

console.log('\n== os containers antigos continuam no template ==');
['input-link-anuncio', 'btn-analisar', 'kw-error', 'kw-loading', 'kw-product-header',
 'kw-indexed', 'kw-stats', 'kw-missing', 'kw-title-generator', 'kw-results', 'kw-categories']
  .forEach((id) => check('#' + id + ' segue no HTML', html.includes('id="' + id + '"')));

console.log('\n== e os containers novos entraram ==');
['ficha-ia-view', 'ficha-ia-body']
  .forEach((id) => check('#' + id + ' existe no template', html.includes('id="' + id + '"')));
// O #mfselRoot NÃO fica no template: ele vem do shell compartilhado (selector-shell.html)
// na hora do build, porque o mesmo shell alimenta o bundle da Análise. O template só
// marca o lugar — e o bundle é quem tem que sair completo.
check('o template marca o lugar do shell', html.includes('<!--SELECTOR-SHELL-->'));
check('#mfselRoot existe no BUNDLE (é lá que o painel procura)', bundle.includes('id="mfselRoot"'));

console.log('\n== ordem do bundle: MFSEL_HOST antes do seletor ==');
{
  const iFicha = bundle.indexOf('__mfFichaIaLoaded');
  const iSeletor = bundle.indexOf('Painel Seletor de Anúncios');
  const iAgente = bundle.indexOf('__keywordAgentLoaded');
  check('ficha-ia está no bundle', iFicha > -1);
  check('ad-selector está no bundle', iSeletor > -1);
  check('keyword-agent está no bundle', iAgente > -1);
  check('ficha-ia vem ANTES do seletor (é quem define MFSEL_HOST)', iFicha < iSeletor, iFicha + ' vs ' + iSeletor);
}

console.log('\n== o bundle não vazou segredo ==');
[/sk-[A-Za-z0-9]{10,}/, /OPENAI_KEY/, /decodo/i]
  .forEach((re) => check('nada casando com ' + re, !re.test(bundle)));

// A regra é sobre o que o VENDEDOR vê: "scraping" e nome de fornecedor de dados não
// aparecem na tela nem em payload. Identificador interno é outra conversa — o
// `fetchUserIdForScraping` do keyword-agent já está no ar assim desde antes disto, e
// varrer o bundle inteiro faria este teste reprovar código que não é desta feature.
{
  const textoVisivel = (bundle.match(/>[^<>{}]{4,}</g) || []).join(' ')
    + (bundle.match(/(?:textContent|innerHTML|placeholder|title)\s*[=:]\s*['"`][^'"`]{4,}['"`]/g) || []).join(' ');
  [/scraping/i, /decodo/i, /\bGPT\b/, /OpenAI/i].forEach((re) =>
    check('a tela nunca escreve ' + re, !re.test(textoVisivel)));
}

console.log('\n== a régua ficou no servidor, não no bundle público ==');
{
  const ficha = fs.readFileSync(path.join(__dirname, '..', 'js', 'ficha-ia.js'), 'utf8');
  // Se o prompt, a lista de categorias bloqueadas ou os limiares aparecerem aqui, a receita
  // vazou: este repo é PÚBLICO e o bundle do Bubble é legível no DevTools.
  check('o prompt não está no front', !/TAREFA 1|REGRA ABSOLUTA|COMO A BUSCA DO MERCADO/i.test(ficha));
  check('a lista de categorias bloqueadas não está no front', !/CATEGORIAS_BLOQUEADAS|concorrencia/i.test(ficha));
  check('a régua de evidência não está no front', !/verificarOrigens|procurarOrigem/.test(ficha));
  check('o front não filtra palavra por categoria', !/categoria\s*===\s*['\"]/.test(ficha));
}

// ⚠️ A régua do D9 MUDOU em 31/08, por decisão do Lucas: "o usuário só quer conferir e
// aplicar. o que estiver errado eles vão desmarcar". Tudo nasce marcado.
//
// O que protege o vendedor não é mais o checkbox vazio — é a tela dizer DE ONDE vem cada
// valor (o bloco separado, o aviso no topo dele, o "porquê" na linha do palpite) e o campo
// que muda o link continuar fora de qualquer aplicação em lote.
console.log('\n== o que muda o link do anúncio nunca entra em lote ==');
{
  const ficha = fs.readFileSync(path.join(__dirname, '..', 'js', 'ficha-ia.js'), 'utf8');
  check('a seção dos campos caros é renderizada SEM checkbox',
    /secao\('⚠️ Só um a um', sohUmAUm, false/.test(ficha), 'o terceiro argumento é comCheckbox');
  check('e a barra do topo diz quantos ficaram de fora',
    /ficam de fora|fica de fora/.test(ficha));
  check('a palavra nova continua num bloco separado, com o aviso da origem',
    /fia-secao-novas[\s\S]{0,400}não diz nenhuma delas/.test(ficha));
  check('e o palpite mostra em que a IA se baseou', /fia-porque/.test(ficha));
}

console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
