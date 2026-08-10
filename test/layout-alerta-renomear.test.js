/**
 * Teste de LAYOUT do alerta de renomear variação.
 *
 * Por que existe: o alerta foi pro ar com o botão "Renomear mesmo assim" vazando pra fora
 * do card (o Lucas viu no print). Os testes de unidade passaram todos — eles olham o HTML
 * gerado, não onde os pixels caem. A causa foi CSS: `.attr-edit-box` normal é `row`, e os
 * filhos assumem isso (`.attr-edit-input` é `flex: 1 1 140px`, `.attr-edit-hint` é
 * `flex-basis: 100%`); virando `column`, esses valores viram ALTURA. E
 * `.attr-edit-save/.cancel` são quadrados de 28px com `padding: 0`, que cortam um botão de
 * texto — as regras novas empatavam em especificidade e perdiam pela ordem do arquivo.
 *
 * Roda sem conta e sem rede: monta o mesmo HTML do openAttrEditor numa página local com o
 * CSS real e mede as caixas.
 */
const fs = require('fs');
const path = require('path');
const PW = 'C:/Users/Lucas Sertori/Documents/squads-marketfacil/node_modules/playwright-core';
const { chromium } = require(PW);

const RAIZ = path.resolve(__dirname, '..');
const CSS = fs.readFileSync(path.join(RAIZ, 'css', 'analyzer.css'), 'utf8');
const LARGURAS = [1400, 900, 600, 375];

let ok = 0, falhou = 0;
const check = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ok  - ${nome}`); }
  else { falhou++; console.log(`  FAIL- ${nome}${extra ? ' | ' + extra : ''}`); }
};

// Mesmo markup que openAttrEditor gera no ramo `renomeia`
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
body{margin:0;padding:20px;font-family:sans-serif}.palco{max-width:620px}</style></head>
<body><div class="ana-wrapper"><div class="palco">
<div class="attribute-item" style="min-width:0;background:var(--green-light);border-color:var(--green);">
  <div id="attr-edit-wrapper-COLOR" style="flex-grow:1;min-width:0;overflow:hidden;">
    <div class="attr-edit-box mf-attr-perigo">
      <div class="mf-alerta-renomear">
        <div class="mf-alerta-titulo">⚠️ Isto renomeia a variação — o anúncio perde a exposição</div>
        <div class="mf-alerta-texto">O link do anúncio muda e ele recomeça do zero, como se fosse novo. Acontece igual se você renomear pelo Mercado Livre. Só vale a pena se o nome estiver realmente errado.</div>
      </div>
      <input type="text" id="attr-input-COLOR" class="attr-edit-input" value="Marrom 2" />
      <div class="mf-alerta-acoes">
        <button type="button" class="attr-edit-cancel mf-btn-manter">Manter como está</button>
        <button type="button" class="attr-edit-save mf-btn-renomear">Renomear mesmo assim</button>
      </div>
      <div id="attr-edit-error-COLOR" class="attr-edit-error" style="display:none;"></div>
      <div class="attr-edit-hint">Cor — até 60 caracteres</div>
    </div>
  </div>
</div></div></div></body></html>`;

(async () => {
  console.log('layout-alerta-renomear.test.js');
  const tmp = path.join(require('os').tmpdir(), 'mf-alerta-layout.html');
  fs.writeFileSync(tmp, PAGINA, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file:///' + tmp.replace(/\\/g, '/'));

  for (const larg of LARGURAS) {
    await page.setViewportSize({ width: larg, height: 900 });
    await page.waitForTimeout(120);
    if (process.env.MF_PRINT) {
      await page.screenshot({ path: `${process.env.MF_PRINT}/alerta-${larg}.png`, fullPage: false });
    }
    const m = await page.evaluate(() => {
      const box = document.querySelector('.attr-edit-box');
      // Referência é a CAIXA DO EDITOR, não o card externo: o card tem padding próprio, e
      // medir contra ele acusaria como vazamento o recuo normal do conteúdo.
      const cr = box.getBoundingClientRect();
      const medir = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return {
          larg: Math.round(r.width), alt: Math.round(r.height),
          foraDireita: Math.round(r.right - cr.right),
          foraEsquerda: Math.round(cr.left - r.left),
          cortado: e.scrollWidth > e.clientWidth + 1
        };
      };
      // …e a própria caixa do editor tem que caber no card, senão o overflow:hidden do
      // wrapper corta o conteúdo (foi assim que "Renomear mesmo assim" virou "MESM ASSII").
      const card = document.querySelector('.attribute-item').getBoundingClientRect();
      return {
        caixaForaDoCard: Math.round(box.getBoundingClientRect().right - card.right),
        caixaAlt: Math.round(box.getBoundingClientRect().height),
        input: medir('#attr-input-COLOR'),
        manter: medir('.mf-btn-manter'),
        renomear: medir('.mf-btn-renomear'),
        alerta: medir('.mf-alerta-renomear'),
        hint: medir('.attr-edit-hint')
      };
    });

    const dentro = (x) => x && x.foraDireita <= 1 && x.foraEsquerda <= 1;
    check(`${larg}px: "Renomear mesmo assim" não vaza do card`, dentro(m.renomear), JSON.stringify(m.renomear));
    check(`${larg}px: "Manter como está" não vaza do card`, dentro(m.manter), JSON.stringify(m.manter));
    check(`${larg}px: o texto do botão não fica cortado`, m.renomear && !m.renomear.cortado, JSON.stringify(m.renomear));
    check(`${larg}px: o input não vira caixa gigante`, m.input && m.input.alt > 20 && m.input.alt < 70, JSON.stringify(m.input));
    check(`${larg}px: o alerta cabe na caixa`, dentro(m.alerta), JSON.stringify(m.alerta));
    check(`${larg}px: a caixa do editor cabe no card`, m.caixaForaDoCard <= 1, `fora=${m.caixaForaDoCard}`);
    check(`${larg}px: a caixa toda tem altura sã`, m.caixaAlt > 120 && m.caixaAlt < 400, `alt=${m.caixaAlt}`);
    // O botão perigoso não pode ser o maior: quem confirma tem que passar pelo destaque.
    check(`${larg}px: "Manter como está" é o botão de destaque`,
      m.manter && m.renomear && m.manter.larg >= m.renomear.larg,
      `manter=${m.manter && m.manter.larg} renomear=${m.renomear && m.renomear.larg}`);
  }

  await browser.close();
  console.log(`\n${ok} passaram, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})();
