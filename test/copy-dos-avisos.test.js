'use strict';
/*
 * Texto explicativo que o vendedor não pediu não fica na tela.
 *
 * Histórico curto, porque errei duas vezes antes de entender o pedido:
 *  1º  o Lucas apontou que dois avisos "não faziam sentido" — reescrevi para ficarem
 *      CORRETOS, e ficaram mais longos;
 *  2º  ele disse que "matam o UX" — encurtei, de 170 e 266 para 78 e 80 caracteres;
 *  3º  ele foi direto: *"você não entendeu, não precisa ter essa informação ali. esses
 *      textos só atrapalham, pode remover"*.
 *
 * A régua não era precisão nem tamanho: era **necessidade**. O card já se chama "ACOS e
 * TACOS por dia" e o gráfico já rotula as duas séries com nome e cor; o campo de ficha já
 * carrega o selo "só no ML" com o porquê no `title`. Um parágrafo abaixo disso repete o que
 * a tela já disse — e a repetição é justamente o que cansa.
 *
 * O que este arquivo protege agora: os parágrafos ficam FORA, a informação essencial
 * continua no selo/título, e nenhum parágrafo novo nasce longo.
 *
 * Rodar: node test/copy-dos-avisos.test.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'analyzer.js'), 'utf8');

console.log('copy-dos-avisos.test.js');

console.log('\n== o gráfico não explica a si mesmo por escrito ==');
{
  const i = fonte.indexOf('ACOS e TACOS por dia');
  const card = i >= 0 ? fonte.slice(i, i + 1200) : '';
  check('o card existe', !!card);

  // Nenhum parágrafo de legenda abaixo do canvas.
  const temParagrafo = /<p class="text-small"[\s\S]{0,400}?<\/p>/.test(card);
  check('não há parágrafo explicando barras e linha', !temParagrafo,
    (card.match(/<p class="text-small"[\s\S]{0,160}/) || [''])[0].replace(/\s+/g, ' '));

  // O nome do card continua sendo o que explica.
  check('o título do card segue nomeando as duas métricas',
    /ACOS e TACOS por dia/.test(card));
}

console.log('\n== o campo de família se explica pelo selo, não por rodapé ==');
{
  const iFicha = fonte.indexOf('Preenchendo estes campos');
  const bloco = iFicha >= 0 ? fonte.slice(iFicha, iFicha + 1600) : '';
  check('a lista de campos faltando existe', !!bloco);

  check('sem parágrafo de rodapé sobre marca/modelo/linha',
    !/campos? marcados?/i.test(bloco) && !/ficam no Mercado Livre/i.test(bloco),
    (bloco.match(/<p class="text-small"[\s\S]{0,160}/) || [''])[0].replace(/\s+/g, ' '));

  // A informação não sumiu: mudou para onde só quem quiser vai buscar.
  check('o selo "só no ML" continua no campo', /só no ML<\/span>/.test(bloco),
    'selo ausente — aí a informação sumiu de verdade');
  const titleDoSelo = (fonte.match(/title="(Marca[^"]*)"/) || [])[1] || '';
  check('e o porquê continua no title do selo', titleDoSelo.length >= 60,
    `${titleDoSelo.length} chars: ${titleDoSelo.slice(0, 90)}`);
}

console.log('\n== e a nota de rodapé do card de família também saiu ==');
{
  check('sem nota repetindo o que o selo de cada campo já diz',
    !/mfd-fb-shared-note/.test(fonte),
    (fonte.match(/mfd-fb-shared-note[^<]{0,80}/) || [''])[0]);
  // O selo por campo é o que carrega o recado ali.
  check('o selo por campo continua', /mfd-fb-shared-tag/.test(fonte));
}

console.log('\n== nenhum parágrafo novo nasce longo ==');
{
  /*
   * O "tipo" no relato do Lucas ("esses aviso tipo …") era a pista de que se tratava de uma
   * CLASSE. Este check falha sozinho quando alguém — eu, provavelmente — escrever o próximo.
   * O teto é generoso de propósito: aviso de erro precisa dizer o estado E a saída.
   */
  const TETO = 120;
  const longos = [];
  const re = /<p class="text-small"[^>]*>([\s\S]{0,700}?)<\/p>/g;
  let m;
  while ((m = re.exec(fonte)) !== null) {
    const visivel = m[1]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\$\{[^}]*\?[^}]*:\s*'([^']*)'\s*\}/g, '$1')
      .replace(/\$\{[^}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (visivel.length > TETO) longos.push(`${visivel.length}: ${visivel.slice(0, 90)}…`);
  }
  check(`nenhum parágrafo da tela passa de ${TETO} caracteres`,
    longos.length === 0, longos.join(' || '));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
