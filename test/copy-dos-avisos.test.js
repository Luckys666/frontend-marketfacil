'use strict';
/*
 * Dois avisos que o Lucas leu na tela em 16/08/2026 e não fizeram sentido
 * (`?item=MLB3264800533`).
 *
 * 1. Legenda do gráfico ACOS/TACOS: "Barras: quanto do faturamento vindo de Ads foi para o
 *    anúncio." Isso não descreve o ACOS — nem descreve coisa nenhuma. ACOS é o custo da
 *    publicidade sobre o faturamento que ela gerou; TACOS é o MESMO custo sobre o
 *    faturamento inteiro. O que separa os dois é o DENOMINADOR, e era exatamente isso que a
 *    frase não dizia. Barras = ACOS %, linha = TACOS % (conferido no dataset do Chart).
 *
 * 2. "O campo marcado agrupa as variações do produto — edite no Mercado Livre." O campo era
 *    "Linha", e o Lucas perguntou: "a gente não tava editando campos tipo linha no app já?"
 *    📏 MEDIDO na categoria MLB235597: LINE é `hierarchy: PARENT_PK` (junto de BRAND e
 *    MODEL). O bloqueio está CERTO — o que foi liberado em 06/08 foi `FAMILY`, não
 *    PARENT_PK, porque a doc de User Products diz que mexer em marca/modelo pode tirar o
 *    anúncio da família. Ou seja: o comportamento acertou e o TEXTO errou, porque não
 *    distingue os dois tipos de campo de família — e quem leu concluiu, com razão, que a
 *    tela tinha regredido.
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

console.log('\n== legenda do gráfico ACOS/TACOS descreve o que o gráfico desenha ==');
{
  // Pega o parágrafo que fica logo abaixo do canvas de ACOS/TACOS.
  const i = fonte.indexOf('ACOS e TACOS por dia');
  // Tags fora: `Barras (<b>ACOS</b>)` tem markup no meio e um regex ingenuo para no '<'.
  const trecho = i >= 0 ? fonte.slice(i, i + 1400).replace(/<[^>]*>/g, '') : '';
  check('a legenda existe', !!trecho, 'card não encontrado');

  check('não diz mais que o faturamento de Ads "foi para o anúncio"',
    !/foi para o an[úu]ncio/i.test(trecho),
    (trecho.match(/foi para o an[úu]ncio/i) || [''])[0]);

  // O que separa ACOS de TACOS é o denominador; a legenda tem de nomear os dois.
  check('a legenda nomeia ACOS junto das barras', /Barras[^<]{0,40}ACOS/i.test(trecho),
    (trecho.match(/Barras[^<]{0,60}/i) || [''])[0]);
  check('a legenda nomeia TACOS junto da linha', /Linha[^<]{0,40}TACOS/i.test(trecho),
    (trecho.match(/Linha[^<]{0,60}/i) || [''])[0]);
  // O que separa ACOS de TACOS é a BASE: só a campanha × tudo que o anúncio vendeu.
  const legendaAcos = (trecho.match(/Barras[\s\S]{0,400}?org[âa]nico[^.]*\./i) || [''])[0];
  check('e diz que a diferença é o total x só o que veio da campanha',
    /(tudo|total)/i.test(legendaAcos) && /org[âa]nico/i.test(legendaAcos),
    legendaAcos.replace(/\s+/g, ' ').slice(0, 200));
}

console.log('\n== aviso do campo PARENT_PK não sugere que o app regrediu ==');
{
  // ⚠️ Medir a STRING QUE VAI PRA TELA, não o entorno no arquivo: a 1ª versão deste bloco
  // lia o trecho da fonte e passava por causa dos COMENTÁRIOS do código, que já falavam de
  // marca/modelo e de desvincular. Comentário não é o que o vendedor lê.
  // A frase é montada por template (singular/plural), então mede-se a LINHA inteira que a
  // gera — e só a parte de texto, sem o CSS.
  const linha = fonte.split('\n').find((l) => /campos? marcados?[^\n]{0,60}(agrup|identifi)/i.test(l)) || '';
  const legenda = linha.replace(/style="[^"]*"/g, '').replace(/<[^>]*>/g, ' ');
  check('o aviso existe', !!legenda.trim(), linha.slice(0, 80));

  // O texto tem de dizer QUAL é o risco — "edite no Mercado Livre" sozinho soa como
  // limitação do app, não como proteção do anúncio.
  check('diz o que acontece se o campo mudar',
    /(sairia|sair\b|tirar|desvincul|perde|sai do grupo)/i.test(legenda),
    legenda.replace(/\s+/g, ' ').slice(0, 180));

  // E tem de nomear QUE TIPO de campo é. Sem isso, quem lembrava da liberação de 06/08
  // (campos FAMILY editáveis no app) lê a tela como regressão — foi o que aconteceu.
  // ⚠️ `\b` obrigatório: sem ele "marca" casa dentro de "marcado" e o check passa sozinho.
  check('nomeia o tipo de campo (marca/modelo/linha), em vez de só "campo marcado"',
    /\b(marca|modelo|linha)\b/i.test(legenda),
    legenda.replace(/\s+/g, ' ').slice(0, 200));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
