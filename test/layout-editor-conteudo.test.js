/**
 * Teste de LAYOUT dos editores de descrição e garantia.
 *
 * Existe pelo mesmo motivo do layout-alerta-renomear: em 10/08/2026 o alerta foi pro ar
 * vazando pra fora do card com 392 testes verdes — eles olham o HTML gerado, não onde os
 * pixels caem. Toda UI nova com largura 100%, padding e borda entra aqui.
 *
 * Diferença: o markup NÃO é copiado. Ele sai das próprias funções do analyzer, carregadas
 * no harness — cópia de markup em teste envelhece calada e passa a medir uma tela que não
 * existe mais.
 *
 * Sem conta e sem rede. Rodar: node test/layout-editor-conteudo.test.js
 */
const fs = require('fs');
const path = require('path');
const PW = 'C:/Users/Lucas Sertori/Documents/squads-marketfacil/node_modules/playwright-core';
const { chromium } = require(PW);
const { carregar } = require('./harness-analyzer');

const RAIZ = path.resolve(__dirname, '..');
const CSS = fs.readFileSync(path.join(RAIZ, 'css', 'analyzer.css'), 'utf8');
const LARGURAS = [1400, 900, 600, 375];

let ok = 0, falhou = 0;
const check = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ok  - ${nome}`); }
  else { falhou++; console.log(`  FAIL- ${nome}${extra ? ' | ' + extra : ''}`); }
};

// Markup real, vindo do analyzer.
const { get } = carregar();
const state = {
  detail: {
    id: 'MLB123456789', title: 'Camiseta básica', category_id: 'MLB1051',
    family_id: '999', // liga o aviso de família, que é a linha mais comprida da caixa
    sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '3 meses' }],
  },
  descriptionData: { plain_text: 'Texto herdado do catálogo que serve de ponto de partida.', source: 'catalog' },
};
const htmlDescricao = get('MF_editorDescricaoHtml')(state);
const htmlGarantia = get('MF_editorGarantiaHtml')(state);

/*
 * A linha do checklist com os DOIS atalhos de 13/08. É a que mais assusta na régua:
 * "Usar Garantia do vendedor por 7 dias" é um rótulo comprido, com `white-space: nowrap`,
 * ao lado de "Informar garantia" e do texto da linha. Em 375px isso é candidato natural a
 * estourar o card — e o card tem overflow escondido, então estouro vira sumiço silencioso.
 */
const ctxChk = carregar();
ctxChk.sandbox.currentAnalysisState = {
  detail: { id: 'MLB1', title: 'Camiseta básica', category_id: 'MLB1051', sale_terms: [], pictures: [], attributes: [] },
  garantiaPadrao: { tipo: 'vendedor', tempo: 7, unidade: 'dias', rotulo: 'Garantia do vendedor por 7 dias' },
  accessToken: 'T', containerIdSuffix: '',
};
ctxChk.get('exibirChecklistRapido')(ctxChk.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
const htmlChecklist = ctxChk.reg['quickChecklist'].innerHTML;

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
body{margin:0;padding:20px;font-family:sans-serif}.palco{max-width:620px}
/* O checklist tem overflow escondido: é ele que corta o que vaza. */
.simula-card{overflow:hidden;border:1px solid #ddd;border-radius:8px;padding:10px}</style></head>
<body><div class="ana-wrapper"><div class="palco">
  <!-- O botão como ele nasce na linha do checklist: foi este que apareceu como
       "ESCREVER DESCRIÇÃO" no print de 12/08. -->
  <div class="simula-card" id="card-linha" style="margin-bottom:14px">
    <button type="button" class="mf-conteudo-botao">Escrever descrição</button>
  </div>
  <div class="simula-card" id="card-chk" style="margin-bottom:14px">${htmlChecklist}</div>
  <div class="simula-card" id="card-desc">${htmlDescricao}</div>
  <div class="simula-card" id="card-gar" style="margin-top:14px">${htmlGarantia}</div>
</div></div></body></html>`;

(async () => {
  console.log('layout-editor-conteudo.test.js');
  const tmp = path.join(require('os').tmpdir(), 'mf-editor-conteudo-layout.html');
  fs.writeFileSync(tmp, PAGINA, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file:///' + tmp.replace(/\\/g, '/'));

  for (const larg of LARGURAS) {
    await page.setViewportSize({ width: larg, height: 1000 });
    await page.waitForTimeout(120);
    if (process.env.MF_PRINT) {
      await page.screenshot({ path: `${process.env.MF_PRINT}/editor-conteudo-${larg}.png`, fullPage: true });
    }

    const m = await page.evaluate(() => {
      const medirDentro = (cardSel, sel) => {
        const card = document.querySelector(cardSel);
        const e = card && card.querySelector(sel);
        if (!card || !e) return null;
        const cr = card.getBoundingClientRect();
        const r = e.getBoundingClientRect();
        return {
          larg: Math.round(r.width), alt: Math.round(r.height),
          foraDireita: Math.round(r.right - cr.right),
          foraEsquerda: Math.round(cr.left - r.left),
          cortado: e.scrollWidth > e.clientWidth + 1,
        };
      };
      // `.ana-wrapper button` põe TODO botão em caixa alta. Só a tela mostrou isso
      // (12/08): "ESCREVER DESCRIÇÃO" gritava dentro do checklist.
      const caixaAlta = (sel) => {
        const e = document.querySelector(sel);
        return e ? getComputedStyle(e).textTransform : '(sem elemento)';
      };
      // Cor e visibilidade entram junto: em 12/08 o teste media posição e tamanho e passou
      // com os botões gritando em CAIXA ALTA. Medir não basta — tem que medir o que a
      // pessoa VÊ.
      const visual = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const cs = getComputedStyle(e);
        return { transform: cs.textTransform, visibilidade: cs.visibility, cor: cs.color, fundo: cs.backgroundColor, display: cs.display };
      };
      return {
        rapidoGar: medirDentro('#card-chk', '#mf-rapido-garantia'),
        rapidoDesc: medirDentro('#card-chk', '#mf-rapido-descricao'),
        manualGar: medirDentro('#card-chk', "button[onclick*=\"'garantia'\"]"),
        visualRapidoGar: visual('#mf-rapido-garantia'),
        visualRapidoDesc: visual('#mf-rapido-descricao'),
        transformBotaoLinha: caixaAlta('#card-linha .mf-conteudo-botao'),
        transformSalvar: caixaAlta('#mf-desc-salvar'),
        transformSugerir: caixaAlta('#mf-desc-sugerir'),
        transformGarantia: caixaAlta('#mf-gar-salvar'),
        pagina: { scroll: document.documentElement.scrollWidth, cliente: document.documentElement.clientWidth },
        textarea: medirDentro('#card-desc', '.mf-conteudo-textarea'),
        salvarDesc: medirDentro('#card-desc', '#mf-desc-salvar'),
        sugerir: medirDentro('#card-desc', '#mf-desc-sugerir'),
        avisoFamilia: medirDentro('#card-desc', '.mf-conteudo-aviso'),
        rodapeDesc: medirDentro('#card-desc', '.mf-conteudo-rodape'),
        selectTipo: medirDentro('#card-gar', '#mf-gar-tipo'),
        inputTempo: medirDentro('#card-gar', '#mf-gar-tempo'),
        salvarGar: medirDentro('#card-gar', '#mf-gar-salvar'),
        linhaGarantia: medirDentro('#card-gar', '.mf-garantia-linha'),
      };
    });

    const dentro = (x) => x && x.foraDireita <= 1 && x.foraEsquerda <= 1;

    check(`${larg}px: a página não ganha rolagem lateral`, m.pagina.scroll <= m.pagina.cliente, JSON.stringify(m.pagina));

    // ── atalhos de 1 clique (13/08) ──
    check(`${larg}px: "Usar 7 dias do vendedor" cabe no card`, dentro(m.rapidoGar), JSON.stringify(m.rapidoGar));
    check(`${larg}px: e não fica cortado`, m.rapidoGar && !m.rapidoGar.cortado, JSON.stringify(m.rapidoGar));
    check(`${larg}px: "Escrever com IA" cabe no card`, dentro(m.rapidoDesc), JSON.stringify(m.rapidoDesc));
    check(`${larg}px: e não fica cortado`, m.rapidoDesc && !m.rapidoDesc.cortado, JSON.stringify(m.rapidoDesc));
    // O atalho não pode empurrar o caminho manual pra fora: quem não quer o padrão precisa
    // continuar enxergando a porta de saída.
    check(`${larg}px: o botão manual da garantia continua dentro`, dentro(m.manualGar), JSON.stringify(m.manualGar));
    check(`${larg}px: os atalhos não saem em CAIXA ALTA`,
      m.visualRapidoGar && m.visualRapidoGar.transform !== 'uppercase'
      && m.visualRapidoDesc && m.visualRapidoDesc.transform !== 'uppercase',
      `gar=${m.visualRapidoGar && m.visualRapidoGar.transform} desc=${m.visualRapidoDesc && m.visualRapidoDesc.transform}`);
    check(`${larg}px: os atalhos estão visíveis`,
      m.visualRapidoGar && m.visualRapidoGar.visibilidade === 'visible' && m.visualRapidoGar.display !== 'none'
      && m.visualRapidoDesc && m.visualRapidoDesc.visibilidade === 'visible',
      JSON.stringify([m.visualRapidoGar, m.visualRapidoDesc]));
    // Ele é o caminho que resolve na hora: precisa se distinguir do botão neutro do lado,
    // senão vira mais uma escolha — o oposto do que o Lucas pediu.
    check(`${larg}px: o atalho tem cor própria, não a do botão neutro`,
      m.visualRapidoGar && m.visualRapidoGar.fundo !== 'rgba(0, 0, 0, 0)' && m.visualRapidoGar.fundo !== 'transparent',
      JSON.stringify(m.visualRapidoGar));
    check(`${larg}px: os botões não saem em CAIXA ALTA`,
      m.transformBotaoLinha !== 'uppercase' && m.transformSalvar !== 'uppercase'
      && m.transformSugerir !== 'uppercase' && m.transformGarantia !== 'uppercase',
      `linha=${m.transformBotaoLinha} salvar=${m.transformSalvar} sugerir=${m.transformSugerir} garantia=${m.transformGarantia}`);
    // O caso clássico: width:100% + padding + borda sem box-sizing estoura pra direita, e o
    // overflow:hidden do card come a borda.
    check(`${larg}px: o textarea cabe no card`, dentro(m.textarea), JSON.stringify(m.textarea));
    check(`${larg}px: o textarea tem altura de textarea`, m.textarea && m.textarea.alt >= 110 && m.textarea.alt < 400, JSON.stringify(m.textarea));
    check(`${larg}px: "Salvar descrição" não vaza`, dentro(m.salvarDesc), JSON.stringify(m.salvarDesc));
    check(`${larg}px: "Salvar descrição" não fica cortado`, m.salvarDesc && !m.salvarDesc.cortado, JSON.stringify(m.salvarDesc));
    check(`${larg}px: "Sugerir com IA" não vaza`, dentro(m.sugerir), JSON.stringify(m.sugerir));
    check(`${larg}px: "Sugerir com IA" não fica cortado`, m.sugerir && !m.sugerir.cortado, JSON.stringify(m.sugerir));
    check(`${larg}px: o aviso de família cabe`, dentro(m.avisoFamilia), JSON.stringify(m.avisoFamilia));
    check(`${larg}px: o rodapé cabe`, dentro(m.rodapeDesc), JSON.stringify(m.rodapeDesc));

    check(`${larg}px: o tipo de garantia cabe`, dentro(m.selectTipo), JSON.stringify(m.selectTipo));
    check(`${larg}px: o campo de prazo cabe`, dentro(m.inputTempo), JSON.stringify(m.inputTempo));
    check(`${larg}px: "Salvar garantia" não vaza`, dentro(m.salvarGar), JSON.stringify(m.salvarGar));
    check(`${larg}px: "Salvar garantia" não fica cortado`, m.salvarGar && !m.salvarGar.cortado, JSON.stringify(m.salvarGar));
    check(`${larg}px: a linha da garantia cabe`, dentro(m.linhaGarantia), JSON.stringify(m.linhaGarantia));

    // No celular os botões ganham a linha inteira; espremidos ao lado do contador, "Salvar
    // descrição" quebrava no meio da palavra.
    if (larg <= 600) {
      check(`${larg}px: os botões ocupam a largura útil`, m.salvarDesc && m.salvarDesc.larg >= 90, JSON.stringify(m.salvarDesc));
      check(`${larg}px: tipo e prazo empilham`, m.selectTipo && m.linhaGarantia && m.selectTipo.larg >= m.linhaGarantia.larg * 0.8,
        `tipo=${m.selectTipo && m.selectTipo.larg} linha=${m.linhaGarantia && m.linhaGarantia.larg}`);
    }
  }

  await browser.close();
  console.log(`\n${ok} passaram, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})();
