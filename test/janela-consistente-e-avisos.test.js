'use strict';
/*
 * Quatro defeitos achados pela revisão de código de 16/08/2026, todos no analyzer.
 *
 * 1. A MESMA régua de janela em dois dialetos. `MF_visitasDosUltimos` foi corrigida hoje
 *    para contar dias civis, mas `somaJanela` e o recorte de `pontos` do card "Desempenho
 *    do Anúncio" continuaram com `(Date.now() - dia@12:00)/86400000` — o padrão que oscila
 *    com a hora do almoço. Resultado: além de voltar a mudar de manhã pra tarde, o "30
 *    dias" da tabela passou a DISCORDAR do "30 dias" que alimenta score, oportunidades e
 *    snapshot para o mesmo anúncio. Corrigir metade de uma régua é pior que não corrigir:
 *    cria duas verdades.
 *
 * 2. Tooltip do gráfico lia um `Set` local sempre vazio (`escondidas`) em vez de
 *    `MF_visOcultas`. Desligar "Vendas" sumia com o painel e com a coluna, mas o tooltip
 *    continuava listando vendas em todo dia.
 *
 * 3. A guarda "nunca deixar o card sem painel" comparava com as TRÊS séries em vez das
 *    disponíveis. Anúncio sem Product Ads só tem "visitas": desligá-la dava
 *    `MF_visOcultas.size === 1 < 3`, a guarda não disparava e o redesenho calculava
 *    `H = 0*(46+12) + (0-1)*14 = -14` → `viewBox` com altura NEGATIVA e gráfico em branco.
 *
 * 4. Erro depois de sucesso saía pintado de azul: `MF_avisoAtalho` troca a classe para
 *    `mf-conteudo-info` e `MF_erroAtalho` só reescrevia o texto, sem devolver a classe de
 *    erro. "Não deu para gravar (erro 500)" com cara de recado neutro.
 *
 * Rodar: node test/janela-consistente-e-avisos.test.js
 */
const { carregar, mkEl } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

// =========================================================================================
console.log('\n# 1. Uma régua de janela só, contada em dias civis');
{
  const { get, sandbox } = carregar();
  const MF_idadeEmDias = get('MF_idadeEmDias');
  const MF_visitasDosUltimos = get('MF_visitasDosUltimos');

  check('existe uma função única que traduz data em idade', typeof MF_idadeEmDias === 'function',
    typeof MF_idadeEmDias);

  if (typeof MF_idadeEmDias === 'function') {
    const manha = new Date('2026-08-16T08:00:00').getTime();
    const tarde = new Date('2026-08-16T22:00:00').getTime();
    check('hoje é 0 de manhã e de noite',
      MF_idadeEmDias('2026-08-16', manha) === 0 && MF_idadeEmDias('2026-08-16', tarde) === 0,
      `${MF_idadeEmDias('2026-08-16', manha)} / ${MF_idadeEmDias('2026-08-16', tarde)}`);
    check('ontem é 1 nas duas horas',
      MF_idadeEmDias('2026-08-15', manha) === 1 && MF_idadeEmDias('2026-08-15', tarde) === 1,
      `${MF_idadeEmDias('2026-08-15', manha)} / ${MF_idadeEmDias('2026-08-15', tarde)}`);
    // O dia da borda é o que escorregava: 30 dias atrás entrava antes do meio-dia e saía
    // depois. É a diferença entre "300 visitas" e "290 visitas" no mesmo anúncio.
    check('o dia da borda não muda de lado ao meio-dia',
      MF_idadeEmDias('2026-07-17', manha) === MF_idadeEmDias('2026-07-17', tarde),
      `${MF_idadeEmDias('2026-07-17', manha)} × ${MF_idadeEmDias('2026-07-17', tarde)}`);
    check('data inválida não vira número', MF_idadeEmDias('abc', manha) === null,
      String(MF_idadeEmDias('abc', manha)));
  }

  // A prova que importa: as duas contas do MESMO card têm de bater.
  const diasAtras = (n) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n);
    return d.toISOString().substring(0, 10);
  };
  const visitas60 = { results: Array.from({ length: 60 }, (_, i) => ({ date: diasAtras(i + 1), total: 10 })) };
  const adsDaily = Array.from({ length: 30 }, (_, i) => ({
    date: diasAtras(i + 1), clicks: 5, prints: 50, cost: 10, total_amount: 200,
    units_quantity: 1, organic_units_quantity: 1, organic_units_amount: 150,
  }));

  const h = carregar();
  h.sandbox.currentAnalysisState = { visitsData: visitas60 };
  h.get('exibirTendenciaVisitas')(visitas60, 'card', { has_ads: true, daily: adsDaily });
  const texto = h.reg['card'].textContent.replace(/\s+/g, ' ');

  // 30 dias × 10 visitas = 300, que é o mesmo que MF_visitasDosUltimos entrega ao score.
  const doScore = MF_visitasDosUltimos(visitas60.results, 30).reduce((s, v) => s + v.total, 0);
  const naTabela = (texto.match(/30 dias\s+(\d+)/) || [])[1];
  check('a tabela de 30 dias concorda com a janela do score',
    naTabela !== undefined && Number(naTabela) === doScore, `tabela=${naTabela} score=${doScore}`);
  void sandbox;
}

// =========================================================================================
console.log('\n# 2. Tooltip respeita a série que o vendedor desligou');
{
  const { get, sandbox } = carregar();
  const visOcultas = get('MF_visOcultas');
  check('MF_visOcultas é o estado real das séries', visOcultas instanceof Set, typeof visOcultas);

  // O defeito é textual e determinístico: o loop do tooltip tem de consultar MF_visOcultas.
  // Ler a fonte é o que prova, porque o tooltip só existe depois de um mousemove real.
  const fonte = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'analyzer.js'), 'utf8');
  const trecho = fonte.slice(fonte.indexOf('mf-vis-tip'), fonte.indexOf('mf-vis-tip') + 9000);
  check('o tooltip não filtra por um Set local vazio',
    !/const\s+escondidas\s*=\s*new\s+Set\(\)/.test(fonte),
    (fonte.match(/const\s+escondidas\s*=\s*new\s+Set\(\)/) || [''])[0]);
  check('o tooltip consulta MF_visOcultas', /MF_visOcultas\.has/.test(trecho), 'trecho do tooltip');
  void sandbox;
}

// =========================================================================================
console.log('\n# 3. Desligar a única série disponível não quebra o gráfico');
{
  const diasAtras = (n) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n);
    return d.toISOString().substring(0, 10);
  };
  const visitas = { results: Array.from({ length: 30 }, (_, i) => ({ date: diasAtras(i + 1), total: 7 })) };

  const h = carregar();
  h.sandbox.currentAnalysisState = { visitsData: visitas };
  const visOcultas = h.get('MF_visOcultas');
  visOcultas.clear();

  // Anúncio SEM Product Ads: a única série disponível é "visitas".
  h.get('exibirTendenciaVisitas')(visitas, 'card2', null);
  const antes = h.reg['card2'].innerHTML;
  check('o gráfico desenha com a série única', /viewBox="0 0 \d+ \d+"/.test(antes),
    (antes.match(/viewBox="[^"]*"/) || [''])[0]);

  // Simula o vendedor desligando a única série disponível.
  visOcultas.add('visitas');
  h.get('exibirTendenciaVisitas')(visitas, 'card2', null);
  const depois = h.reg['card2'].innerHTML;
  const vb = (depois.match(/viewBox="([^"]*)"/) || [])[1] || '';
  const alturaNegativa = /-\d/.test(vb);
  check('nunca sai viewBox com altura negativa', !alturaNegativa, `viewBox="${vb}"`);

  // ⚠️ 2ª rodada: desenhar o painel não basta. O fallback reexibia a série mas deixava a
  // chave em MF_visOcultas, então a LEGENDA continuava dizendo "desligado"
  // (aria-pressed=false, "Mostrar Visitas") e o tooltip pulava a série — hover mostrava só
  // a data, sem valor nenhum. Tela contando duas histórias sobre o mesmo painel.
  check('a legenda concorda com o painel desenhado',
    !visOcultas.has('visitas'), [...visOcultas].join(','));
  check('e o botão não fica marcado como desligado',
    !/aria-pressed="false"[^>]*>\s*Visitas|title="Mostrar Visitas"/.test(depois),
    (depois.match(/title="[^"]*Visitas"/g) || []).join(' '));
  visOcultas.clear();
}

// =========================================================================================
console.log('\n# 4. Erro depois de sucesso não sai pintado de aviso');
{
  const { get, reg, documentStub } = carregar();
  const caixa = mkEl('mf-rapido-erro-compat');
  reg['mf-rapido-erro-compat'] = caixa;
  void documentStub;

  get('MF_avisoAtalho')('compat', 'Enviado. Agora faça qualquer alteração no anúncio.');
  const classeDoAviso = caixa.className;
  check('o aviso de sucesso usa a caixa azul', /mf-conteudo-info/.test(classeDoAviso), classeDoAviso);

  get('MF_erroAtalho')('compat', 'Não deu para gravar (erro 500).');
  check('o erro seguinte volta a ser erro', !/mf-conteudo-info/.test(caixa.className),
    caixa.className);
  check('e continua com a classe de erro', /mf-conteudo-erro/.test(caixa.className), caixa.className);
  check('o texto é o do erro', /erro 500/.test(caixa.textContent), caixa.textContent);
}

// =========================================================================================
console.log('\n# 5. Dentro do MESMO card, uma régua só (2ª rodada da revisão)');
{
  // A 1ª rodada converteu `somaJanela` e o recorte de `pontos` e DEIXOU `inWindow` na conta
  // antiga — dentro da mesma função. Resultado: `total30`, que decide se o gráfico aparece
  // e se sai o selo "⚠️ Poucos dados", discordava da tabela logo acima dele.
  // Corrigir pela metade duas vezes seguidas foi o que motivou este bloco.
  const diaISO = (n) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n);
    return d.toISOString().substring(0, 10);
  };
  const somaDaLinha = (texto, rotulo) => {
    const m = texto.match(new RegExp(rotulo + '\\s+(\\d+)'));
    return m ? Number(m[1]) : null;
  };

  // (a) visitas SÓ hoje: hoje está fora da janela por desenho (dado ainda propagando).
  {
    const h = carregar();
    h.sandbox.currentAnalysisState = { visitsData: { results: [{ date: diaISO(0), total: 40 }] } };
    h.get('exibirTendenciaVisitas')({ results: [{ date: diaISO(0), total: 40 }] }, 'so-hoje', null);
    const t = h.reg['so-hoje'].textContent.replace(/\s+/g, ' ');
    const trinta = somaDaLinha(t, '30 dias');
    const poucos = /Poucos dados/i.test(t);
    check('visitas só de hoje: a tabela diz 0 e o selo concorda',
      trinta === 0 && poucos, `30 dias=${trinta} | poucos=${poucos}`);
  }

  // (b) visitas SÓ no dia 30: dentro da janela, então NÃO é "poucos dados".
  {
    const serie = [{ date: diaISO(30), total: 40 }];
    const h = carregar();
    h.sandbox.currentAnalysisState = { visitsData: { results: serie } };
    h.get('exibirTendenciaVisitas')({ results: serie }, 'dia-30', null);
    const t = h.reg['dia-30'].textContent.replace(/\s+/g, ' ');
    const trinta = somaDaLinha(t, '30 dias');
    const poucos = /Poucos dados/i.test(t);
    check('visitas do dia 30: tabela e selo não se contradizem',
      (trinta === 40 && !poucos) || (trinta === 0 && poucos), `30 dias=${trinta} | poucos=${poucos}`);
  }

  // (c) série PERFEITAMENTE plana não pode render selo de crescimento.
  // 📏 O fixture reproduz a resposta REAL da ML, medida em 16/08/2026: `last=60` devolve as
  // idades 1..60 — hoje não vem. Com isso as janelas 1..30 e 31..60 são simétricas.
  {
    const serie = [];
    for (let i = 1; i <= 60; i++) serie.push({ date: diaISO(i), total: 10 });
    const h = carregar();
    h.sandbox.currentAnalysisState = { visitsData: { results: serie } };
    h.get('exibirTendenciaVisitas')({ results: serie }, 'plano', null);
    const t = h.reg['plano'].textContent.replace(/\s+/g, ' ');
    const variacao = (t.match(/[+-]\d+%/g) || []);
    check('série plana não inventa crescimento', variacao.length === 0, variacao.join(' '));
  }

  // (d) série CURTA (anúncio novo): a janela anterior nem existe, então não há o que
  // comparar. Sem a guarda de cobertura, a tela compara 30 dias com um punhado e cospe um
  // selo de crescimento que só fala do denominador.
  {
    const serie = [];
    for (let i = 1; i <= 35; i++) serie.push({ date: diaISO(i), total: 10 });
    const h = carregar();
    h.sandbox.currentAnalysisState = { visitsData: { results: serie } };
    h.get('exibirTendenciaVisitas')({ results: serie }, 'curto', null);
    const t = h.reg['curto'].textContent.replace(/\s+/g, ' ');
    const trinta = somaDaLinha(t, '30 dias');
    const variacao = (t.match(/[+-]\d+%/g) || []);
    check('anúncio novo mostra o total mas não compara com o que não existe',
      trinta === 300 && variacao.length === 0, `30 dias=${trinta} | selos=${variacao.join(' ')}`);
  }
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
