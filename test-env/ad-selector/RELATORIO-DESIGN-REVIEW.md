# Relatório de Design Review — Painel Seletor de Anúncios

**Produto:** Painel Seletor de Anúncios (MarketFácil) — tela de triagem que abre antes da Análise de Anúncios
**Arquivo:** `C:\Users\Lucas Sertori\Documents\frontend-marketfacil\test-env\ad-selector\index.html`
**Data:** 2026-07-04 · **Rodadas:** 4 debates UI/UX + 3 levas de feedback do Lucas
**Lentes consultadas:** Designer visual/UI · Especialista mobile-first · Designer de dados (dataviz)
**Nota média do time:** **7/10** (7 · 7 · 7 — consenso raro e informativo)

---

## 1. Resumo executivo

As três lentes convergiram em **7/10** de forma independente, o que é um sinal forte: **a estrutura está certa, o que falta é polimento de hierarquia**. A fundação já é de "produto pago" — cabeçalho navy uppercase, zebra, números em DM Mono tabular, sinais achatados em LED flat (a decisão de hoje do Lucas acertou) e o tratamento de preço, que é o elemento mais bem resolvido da linha. **O design está pronto para o port ao Bubble na estrutura, mas ainda não no acabamento.**

O que segura a nota é uma **inversão de hierarquia recorrente na tela cujo único trabalho é "o que precisa de atenção"**: as pills azuis de contagem/expandir são o elemento mais forte da coluna Sinais e chegam antes do vermelho de severidade; o CTA primário "Analisar →" é um fantasma que parece desabilitado no mobile; rótulos de sinal truncam no meio da palavra; e o sparkline, além de decorativo, mente sobre comparabilidade entre linhas. No mobile some o colapso de sinais (card gigante, ~1 por dobra) e o gesto de análise é ambíguo. **Recomendação do diretor: fazer a leva de ajustes de peso/ordem descrita abaixo ANTES do port** — são quase todos mudanças de ordem de concatenação e CSS, custo baixo e impacto imediato na percepção de qualidade. Nenhum deles reabre decisão tomada.

---

## 2. Acertos consolidados (preservar no port)

Dedup entre as três lentes — o que deve atravessar o port intacto:

- **Espinha visual da tabela (Proposta U).** Cabeçalho navy uppercase com letter-spacing, zebra `#f8fafc`, números/IDs em **DM Mono tabular** alinhados à direita. Conjunto limpo e coeso — as 3 lentes pedem para preservar exatamente. *(ui-visual + dataviz)*
- **Sinais como LED flat** (quadrado 7px + texto, cor só na severidade alta). Foi a decisão certa de hoje: comunica gravidade e ranqueia o olho sem virar arco-íris de pills. É a **identidade "tech" da tela** — manter e estender esse registro pro resto da UI. *(as 3 lentes)*
- **Tratamento de preço:** original riscado + pill de desconto verde + preço final, ancorados na mesma borda direita. Elemento mais bem resolvido da linha — escaneável, hierarquia interna clara. **Não mexer.** *(ui-visual + dataviz + mobile)*
- **Fluxo de análise integrado:** barra "← Voltar para a lista" + estado vazio com título/subtítulo claros + botão **sólido** azul "Abrir análise no app". Esse botão filled é a prova de que o padrão de CTA forte já existe no projeto — é o que os "Analisar →" devem herdar. *(ui-visual + mobile)*
- **Integridade de dados:** sublinhas derivadas só de janelas reais completas, conversão só com visitas>0, tooltips que explicam a base do cálculo. Sem thresholds inventados. *(dataviz)*
- **Catálogo como marcador dedicado** (fora da coluna Sinais): "é catálogo" é atributo de identidade, não sinal de saúde — taxonomia limpa. Preservar o conceito (só baixar o peso visual, ver P8). *(dataviz)*
- **IA e detalhes mobile:** filtros colapsados em "Filtrar e ordenar ▾", "Baixar planilha" rebaixado, foto 72px, título sem corte, 16px no foco (anti auto-zoom iOS), alvos de 44px em ícones/CTA, reflow do preço com desconto. Base mobile correta. *(mobile)*

---

## 3. Problemas consolidados (ordenados por prioridade)

Dedup entre lentes. Onde houve divergência, está registrada com a **recomendação do diretor**.

| # | Título | Onde | Correção proposta | Prio | Lente(s) |
|---|--------|------|-------------------|------|----------|
| P1 | **Pill azul de disclosure lidera a coluna Sinais na frente da severidade** — o olho bate primeiro num elemento neutro (navegação) e a âncora do início da célula muda de linha pra linha | assembler dos badges (`~L1106–1170`, família `~L1524`); CSS `.badge-more`/`.badge.variations` `L216–222` | **Diretor (síntese das 2 lentes): fazer as duas coisas.** (a) reordenar a emissão — severidade sempre primeiro (red→orange→yellow→gray), pills de ação (`variações`/`vinculados`/`+N sinais`) por último; (b) rebaixar essas pills a **ghost** (sem preenchimento, borda fina, caret) para pararem de vencer o vermelho | **alta** | ui-visual (alta) + dataviz (media) |
| P2 | **Números primários em zigzag na horizontal** — preço, estoque, vendas e visitas ficam em alturas diferentes na mesma linha; a varredura horizontal (a tarefa da tela) sobe e desce | `td { vertical-align: middle }` `L157`; células empilhadas `.stock-wrap` `L179`, `.visits-line`, preço `L1268` | Trocar `vertical-align: middle` → `top` nas td numéricas (padding-top consistente) e garantir que o **valor primário seja sempre a 1ª linha visual** da célula; sublinhas (≈ dias, conv., riscado) descem juntas numa faixa abaixo | **alta** | dataviz |
| P3 | **Sparkline mente e polui** — normaliza por linha (235 e 24 visitas desenham a mesma amplitude), sem baseline "plano" vira montanha, no mesmo azul dos elementos clicáveis, e a lane fica escalonada pela largura variável do número | `sparklineSvg()` `L1201–1211` (stroke `var(--blue)`, 56×16, max local); `.visits-line` `L179` | **Diretor (reconcilia mobile × dataviz — não é conflito):** **Desktop:** manter o spark, mas (a) baseline horizontal tênue, (b) **ponto final colorido por tendência** (verde sobe / vermelho cai / cinza estável — a direção É comparável entre linhas, a altura não), (c) fixar largura do número (~4 dígitos, text-align right) pra alinhar a lane, (d) tirar do azul-interativo. **Mobile:** **esconder o spark no card** (guardar tendência pra tela de análise) — some o ruído sem perder informação | **alta** | dataviz (alta) + ui-visual (media) + mobile (media) |
| P4 | **CTA primário "Analisar →" mais fraco que as pills secundárias** — ghost com opacity .8; no mobile (sem hover) lê como **desabilitado**, o oposto do que deveria | `.btn-analyze` `L236–246` vs pills `L217–222`; mobile full-width `L412` | **Mobile:** tornar sólido — `background: var(--blue); color:#fff; opacity:1` (mesmo tratamento do "Abrir análise no app" que já funciona). **Desktop:** subir opacity default → 1 e borda 1.5px, mantendo o fill no hover pra não saturar a tabela de azul | **alta** | ui-visual + mobile |
| P5 | **Rótulos de sinal truncam no meio da palavra** ("Perdendo exposiç", "Título", "Variação: estoque quase n") — sem reticências, some a informação de severidade. **Confirmado em v11-familia** | `.badges { max-width: 340px }` `L194`; `th.th-sinais { min-width: 330px }` `L155` | Subir `th.th-sinais` min-width 330 → ~360px e **soltar o teto rígido** do container (remover/trocar `max-width:340px` por deixar o flex-wrap respirar); garantir que a célula nunca corte (sem `overflow:hidden`); rótulo longo quebra pra próxima linha, não some | **alta** | ui-visual |
| P6 | **Mobile: sinais nunca colapsam** — `showAll = isMobile \|\| expanded` força TODOS; card de família passa de ~475px, cabe ~1 por dobra e soterra números + botão "Analisar" justo nos cards mais problemáticos. **Confirmado (L1166)** | `L1166` `const showAll = isMobile \|\| expanded`; `@media L449` | Trocar por `const showAll = expanded` e garantir o "+N sinais ▾" no card (handler `.badge-more` já existe). Mostrar 2–3 de maior severidade + colapsar o resto. Meta: 2 cards por dobra | **alta** | mobile |
| P7 | **Mobile: card inteiro dispara análise + botão dedicado** = navegação acidental ao rolar/ler e afordância dúbia (dois caminhos pra mesma ação) | `wireRows` tr click → `enterAnalysis` `L1656`; `.btn-analyze` `L412` | No mobile restringir o gatilho: só o **botão "Analisar →"** (e, opcional, foto+título) navega; corpo do card (números, área de sinais) não. Mata o toque acidental e a ambiguidade "o que é clicável" | **alta** | mobile |
| P8 | **◆ CATÁLOGO navy sólido é o objeto mais escuro da linha** e rouba peso da severidade — navy 100% usado como alarme quando é só categoria | `.tag-catalog` `L187–193` (`background: var(--navy)`) | Mantendo o marcador dedicado: baixar o peso — fundo transparente, `color: var(--navy)`, `border:1px solid var(--border)` (ou navy ~15% alpha), mesmo radius/uppercase. Reconhecível como "tipo", sem competir com o vermelho. Reservar navy sólido pro cabeçalho/chip-count | media | ui-visual |
| P9 | **Emojis de consumidor contradizem a direção "mais tech, sem emoji" de hoje** — 🔍 🏷️ ⬇ ⟳ 🎉 ✅ cercam sinais que viraram LED flat; sistema visual dividido | 🔍`L502` · 🏷️`L535` · ⬇`L531` · ⟳`L491` · vazio 🔍/✅/🎉 `L795`/`L1815` | Alinhar a iconografia ao registro flat/mono dos sinais: glifos mono/SVG discretos (lupa, tag, seta-download, refresh em traço fino, cor `--text-secondary`) ou texto puro. Estado vazio: ícone de linha coerente com o loading orbital que já existe | media | ui-visual |
| P10 | **Badges de sinal minúsculos e colados no mobile** (~17px, gap vertical 3px) — mas no touch eles SÃO o gatilho da dica "o que fazer"; abaixo dos 44px, o dedo erra o alvo | `.badges gap: 3px` `L194`; `.badge padding 1px 0` `L198`; dica por toque `L1624` | No `@media(max-width:720px)`: subir gap vertical da `.badges` (8–10px) e padding vertical do badge (ou `min-height ~40–44px`), mantendo o LED flat. Cada dica vira alvo isolado e acertável | media | mobile |
| P11 | **Mobile: ID cru (MLB…) ocupa a 2ª linha nobre** e atrasa os sinais — o dado menos útil pra triagem come o real estate logo abaixo do título | `row-id` na célula Título `L1536`; `@media L446` | No mobile promover os sinais pra logo abaixo do título e rebaixar o ID (rodapé do card ou reduzir a um ícone "copiar ID"). Vendedor reconhece por foto+título+sinais; ID copia quando precisa | media | mobile |
| P12 | **"≈ 1 ano+" repete em quase toda linha** e vira ruído, afogando os poucos "≈ 2 dias" que importam; redundante com o sinal "Estoque quase no fim" | `stockDaysHtml()` `L1245–1250` | Renderizar a sublinha "≈ X dias" só quando for **acionável** (estoque durando pouco). ⚠️ **Guardrail do diretor:** o horizonte de "acionável" deve vir de regra real já existente, **não** de threshold inventado (regra inviolável). Acima disso, suprimir | media | dataviz |
| P13 | **conv.% (métrica de decisão) fica como texto terciário** e as sublinhas (conv., ≈ dias, riscado) não são tabulares (DM Sans) → "tremem" verticalmente | `.conv-rate`/`.stock-days` `L180–182`; `.price-orig` | Aplicar DM Mono/tabular-nums nos números das sublinhas (elimina o jitter) e dar à conv. um degrau de destaque frente ao "≈ dias" (`--text-secondary` em vez de `--text-muted`, ou valor em negrito). Sem virar coluna nova | baixa | dataviz |
| P14 | **Carrossel de chips do "Resumo da conta" sem pista de rolagem** além do peek — público não-técnico pode não perceber que há mais problemas | `.chips overflow-x auto` `L424` | Reforçar a pista: fade/gradiente na borda direita quando há overflow, ou contador total ("N problemas →"). Baixa prio porque o peek já existe | baixa | mobile |

### Divergências registradas
- **P3 (sparkline) — mobile pede ESCONDER, dataviz/ui-visual pedem MELHORAR.** Não é conflito real: **melhorar no desktop** (baseline + ponto de tendência colorido + lane fixa) e **esconder no card mobile**. Recomendação do diretor adotada na linha P3.
- **P1 (pill azul) — ui-visual pede só reordenar (zero mudança de estilo), dataviz pede rebaixar a ghost.** São complementares. Diretor: **fazer as duas** — a reordenação resolve o scan vertical, o ghost resolve o contraste. Custo somado ainda é baixo.

---

## 4. Top 5 recomendações acionáveis (melhor custo-benefício)

1. **Reordenar + rebaixar os badges da coluna Sinais** *(P1 — a de maior ROI).* No assembler, emitir severidade primeiro (red→orange→yellow→gray) e as pills de ação por último; no CSS, trocar o preenchimento azul dessas pills por ghost (borda fina + caret). É quase só ordem de concatenação — corrige a inversão de hierarquia apontada por 2 lentes na tela cujo trabalho é "o que precisa de atenção". **Risco: baixíssimo.**

2. **Deixar o CTA "Analisar →" sólido** *(P4).* Mobile: `background:var(--blue); color:#fff; opacity:1`. Desktop: opacity default 1 + borda 1.5px, fill no hover. Reusa o padrão do "Abrir análise no app" que já existe e funciona. Tira a tela do território "protótipo/desabilitado" com uma mudança de CSS.

3. **Corrigir o truncamento dos rótulos de sinal** *(P5).* `th.th-sinais` min-width 330→~360px e soltar o `max-width:340px` rígido do `.badges` (deixar o wrap respirar, sem `overflow:hidden`). Texto cortado no meio da palavra é o sinal nº1 de "quebrado" — sai com 2 linhas de CSS.

4. **Sparkline honesto + escondido no mobile** *(P3).* Desktop: baseline tênue + ponto final colorido por tendência (verde sobe / vermelho cai / cinza estável) + largura fixa do número pra alinhar a lane + sair do azul-interativo. Mobile: `display:none` no card. Uma correção fecha 3 findings de 3 lentes e transforma decoração em informação real.

5. **Mobile: colapsar sinais + restringir o gesto de análise** *(P6 + P7).* Trocar `showAll = isMobile || expanded` por `= expanded` (mostra 2–3 + "+N sinais ▾") e limitar o `enterAnalysis` ao botão/foto+título. Duas mudanças pequenas que recuperam 2 cards por dobra e matam a navegação acidental — o núcleo da experiência mobile.

---

## 5. O que NÃO mexer (decisões tomadas que alguma lente tangenciou)

- **Sinais como LED flat** (decisão de hoje do Lucas). As lentes elogiam e pedem para estender. Não voltar a pills coloridas nem a emoji nos sinais. Ajustar só ordem/peso, nunca o estilo do LED.
- **Catálogo como marcador dedicado** (não é badge, não é sinal de saúde). P8 só **baixa o peso visual** — não transformar em badge, não mover pra coluna Sinais, não remover.
- **Preço:** riscado + pill de desconto + final na mesma borda direita. Elemento mais bem resolvido — **não tocar** na estrutura (P2/P13 só alinham a baseline e tornam as sublinhas tabulares).
- **Agrupamento por família** (clique analisa MLBU) e **fluxo integrado** (colapso + "← Voltar" + "Abrir análise no app" sólido). Decisões fechadas — não reabrir; o botão sólido é justamente o padrão a herdar.
- **Taxas só com janelas reais completas / sem thresholds inventados.** Guardrail crítico sobre P12: qualquer limiar de "estoque acionável" tem de vir de regra real existente, senão a supressão do "≈ X dias" viola regra inviolável.
- **Exportação sempre "todos da lista"** e **copy 100% pt-BR sem jargão** (nada de "API", "cache", "labels"). A troca "conv." → "conversão" (P9) é a única mexida de copy sugerida, e é aditiva.
- **DM Mono à direita, cabeçalho navy uppercase, zebra, radius 10/6, paleta Proposta U** — a espinha do design system. Preservar exatamente no port ao Bubble.
