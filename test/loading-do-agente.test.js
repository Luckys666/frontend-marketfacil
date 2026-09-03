'use strict';
/*
 * A barra de passos acende pelo que o código DIZ, não pela palavra que a frase tem.
 *
 * Por que existe: em 02/09 reescrevi as mensagens do loading para tirar o jargão
 * ("Obtendo credenciais...", "Servidor ocupado...", "Cruzando dados de indexação..."). O
 * passo aceso era escolhido por um mapa que procurava PALAVRAS dentro da frase
 * (`{'credenciais': 0, 'servidor': 1, 'cruzando': 3}`), então trocar a redação passou a
 * acender o passo errado, em silêncio. "Vendo o que seu anúncio já cobre" casava com
 * 'anúncio' e voltava a barra para o passo 1 no fim da análise.
 *
 * Nenhum dos 37 arquivos de teste pegou, porque nenhum EXECUTAVA o keyword-agent: todos
 * liam a fonte com regex. Este roda o módulo de verdade e MEDE quais passos ficam acesos.
 * Ver [[feedback_teste_de_layout_mede_nao_olha]].
 *
 * Rodar: node test/loading-do-agente.test.js
 */
const fs = require('fs');
const path = require('path');
const { carregar } = require('./harness-keyword-agent');

let pass = 0, fail = 0;
const check = (nome, cond, detalhe) => {
  if (cond) { pass++; console.log('  ok  - ' + nome); }
  else { fail++; console.error('  FAIL- ' + nome + (detalhe ? ' | ' + detalhe : '')); }
};

console.log('loading-do-agente.test.js');

const FONTE = fs.readFileSync(path.join(__dirname, '..', 'js', 'keyword-agent.js'), 'utf8');
const acesos = (doc) => [...doc.querySelectorAll('#kw-loading .kw-step')]
  .map((s) => (s.classList.contains('active') ? '1' : '0')).join('');

console.log('\n== o passo dito é o passo aceso ==');
{
  const { K, doc } = carregar();
  const esperado = ['1000', '1100', '1110', '1111'];
  [0, 1, 2, 3].forEach((p) => {
    K.updateLoadingStep('passo ' + p, p);
    check('passo ' + p + ' acende ' + esperado[p], acesos(doc) === esperado[p], acesos(doc));
  });
}

console.log('\n== a barra não anda para trás quando a frase muda ==');
{
  // O caso exato do bug: a última etapa fala do anúncio, e o mapa antigo mandava a barra
  // de volta para o passo 1 por causa da palavra.
  const { K, doc } = carregar();
  K.updateLoadingStep('Vendo o que seu anúncio já cobre...', K.KW_PASSO.INDEXACAO);
  check('a etapa final acende os quatro', acesos(doc) === '1111', acesos(doc));
}

console.log('\n== retry troca a frase e deixa a barra onde está ==');
{
  const { K, doc } = carregar();
  K.updateLoadingStep('Lendo o anúncio...', K.KW_PASSO.ANUNCIO);
  const antes = acesos(doc);
  K.updateLoadingStep('A conexão caiu. Tentando de novo (2 de 3)');
  check('a barra não se mexe sem passo', acesos(doc) === antes, antes + ' -> ' + acesos(doc));
  check('mas a frase é trocada',
    doc.querySelector('#kw-loading .kw-loading-msg').textContent === 'A conexão caiu. Tentando de novo (2 de 3)',
    doc.querySelector('#kw-loading .kw-loading-msg').textContent);
}

console.log('\n== as quatro etapas da análise dizem o passo ==');
{
  // Uma etapa que esquecer o passo volta a depender da redação, que é o bug de origem.
  const etapas = [
    ['Preparando', 'CONEXAO'],
    ['Lendo o anúncio', 'ANUNCIO'],
    ['Procurando palavras que faltam', 'PALAVRAS'],
    ['Vendo o que seu anúncio já cobre', 'INDEXACAO'],
  ];
  etapas.forEach(([frase, passo]) => {
    const re = new RegExp('updateLoadingStep\\([^)]*' + frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^)]*KW_PASSO\\.' + passo);
    check('"' + frase + '" pede o passo ' + passo, re.test(FONTE));
  });
  // e a ordem em que aparecem no arquivo é a ordem em que a tela acende
  const ordem = (FONTE.match(/KW_PASSO\.(CONEXAO|ANUNCIO|PALAVRAS|INDEXACAO)/g) || [])
    .map((s) => s.replace('KW_PASSO.', ''));
  const semRepetir = ordem.filter((x, i) => ordem.indexOf(x) === i);
  check('as etapas aparecem na ordem em que acendem',
    semRepetir.join(',') === 'CONEXAO,ANUNCIO,PALAVRAS,INDEXACAO', semRepetir.join(','));
}

console.log('\n== a adivinhação não voltou ==');
{
  check('não existe mapa de palavra para passo', !/stepMap/.test(FONTE));
  check('o passo não sai de includes() sobre o texto',
    !/text\.toLowerCase\(\)\.includes/.test(FONTE));
  const { K, doc } = carregar();
  // Uma frase cheia das palavras do mapa antigo não pode mexer na barra por conta própria.
  K.updateLoadingStep('Preparando...', K.KW_PASSO.CONEXAO);
  K.updateLoadingStep('cruzando servidor credenciais palavras anúncio limite');
  check('frase com as palavras do mapa antigo não mexe na barra', acesos(doc) === '1000', acesos(doc));
}

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
