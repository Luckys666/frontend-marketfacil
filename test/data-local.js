'use strict';
/*
 * Data YYYY-MM-DD no fuso LOCAL, para fixtures de teste.
 *
 * ⚠️ Por que isto existe (16/08/2026, 21h): `new Date().toISOString().slice(0, 10)` devolve a
 * data em **UTC**. No Brasil (GMT-3), a partir das 21h o dia UTC já virou — então um fixture
 * que quer dizer "hoje" passa a gerar a data de AMANHÃ, e a régua do app (que conta dias
 * civis locais, como o vendedor conta) calcula idade -1 e joga o registro fora da janela.
 *
 * O efeito é traiçoeiro: a suíte inteira fica verde o dia todo e sete checks quebram sozinhos
 * depois do jantar, sem ninguém ter tocado no código. Foi exatamente o que aconteceu — as
 * falhas apareceram entre uma rodada e outra em que só o TEXTO de dois avisos mudou.
 *
 * A API da ML, medida no mesmo dia, devolve `"2026-08-13T00:00:00Z"`: o rótulo do dia é o que
 * importa, e é isso que estes fixtures precisam imitar.
 */
function dataLocal(diasAtras) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (diasAtras || 0));
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

module.exports = { dataLocal };
