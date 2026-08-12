'use strict';
/*
 * Card de marcações do ML: veredito antes do detalhe (Lucas, 12/08/2026).
 *
 * "nas tags ativas pode colocar algo mais simples como 'tudo certo' ou 'está com problemas'
 * antes das pessoas ver todos os detalhes das tags. isso deixaria esse card mais limpo."
 *
 * O que estes testes protegem:
 *  - o veredito é o primeiro texto do card, não uma soma que o vendedor tem que fazer
 *  - "tudo certo" só aparece quando NÃO há tag negativa (elogio falso é pior que silêncio)
 *  - a lista completa continua no card, atrás de um clique — nada foi escondido de vez
 *  - com problema, o detalhe abre sozinho: quem precisa ver não tem que procurar
 *
 * Rodar: node test/tags-veredito.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const { get, reg } = carregar();
const verificarTags = get('verificarTags');

console.log('tags-veredito.test.js');

console.log('\n== anúncio sem problema ==');
{
  verificarTags(['good_quality_picture', 'brand_verified', 'immediate_payment'], false, 'tagsOk');
  const html = reg['tagsOk'].innerHTML;
  const texto = reg['tagsOk'].textContent;
  check('diz que está tudo certo', texto.includes('Tudo certo por aqui'), texto.slice(0, 200));
  check('não fala em ponto de atenção', !texto.includes('ponto de atenção'), texto.slice(0, 200));
  // O veredito vem antes da lista: quem bate o olho já sabe.
  check('o veredito aparece antes das etiquetas',
    texto.indexOf('Tudo certo') < texto.indexOf('Boas Práticas'), texto.slice(0, 200));
  check('a lista continua disponível', html.includes('Ver todas as marcações'), html.slice(0, 300));
  check('e vem fechada quando não há o que ver', !/<details[^>]*\sopen/.test(html), html.slice(0, 400));
}

console.log('\n== anúncio marcado pelo ML ==');
{
  // TAGS_NEGATIVAS decide o que é problema — a régua é a mesma do resto da tela.
  const negativas = [...get('TAGS_NEGATIVAS')];
  verificarTags([negativas[0], 'good_quality_picture'], false, 'tagsRuim');
  const html = reg['tagsRuim'].innerHTML;
  const texto = reg['tagsRuim'].textContent;
  check('conta 1 ponto de atenção', texto.includes('1 ponto de atenção'), texto.slice(0, 200));
  check('no singular', !texto.includes('1 pontos'), texto.slice(0, 200));
  check('não diz que está tudo certo', !texto.includes('Tudo certo por aqui'), texto.slice(0, 200));
  check('o detalhe já vem aberto', /<details[^>]*\sopen/.test(html), html.slice(0, 400));
}
{
  const negativas = [...get('TAGS_NEGATIVAS')];
  verificarTags([negativas[0], negativas[1]], false, 'tagsRuim2');
  const texto = reg['tagsRuim2'].textContent;
  check('plural com 2', texto.includes('2 pontos de atenção'), texto.slice(0, 200));
}

console.log('\n== o que não pode sumir ==');
{
  const negativas = [...get('TAGS_NEGATIVAS')];
  verificarTags([negativas[0], 'good_quality_picture', 'immediate_payment'], false, 'tagsTudo');
  const texto = reg['tagsTudo'].textContent;
  check('as três colunas continuam no card',
    texto.includes('Boas Práticas') && texto.includes('Atenção') && texto.includes('Neutras'), texto.slice(0, 300));
  check('o total de marcações aparece', texto.includes('3 marcações'), texto.slice(0, 200));
}
{
  verificarTags([], false, 'tagsVazio');
  check('sem tag nenhuma não inventa veredito', !reg['tagsVazio'].textContent.includes('Tudo certo por aqui'),
    reg['tagsVazio'].textContent);
  verificarTags(['x'], true, 'tagsFallback');
  check('scraper parcial continua avisando', reg['tagsFallback'].textContent.includes('indisponível'),
    reg['tagsFallback'].textContent);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
