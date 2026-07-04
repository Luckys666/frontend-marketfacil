# Painel Seletor de Anúncios — protótipo standalone

Protótipo (fora do Bubble) da tela que vai aparecer **antes** da função de
Análise de Anúncios: lista os anúncios ativos da conta do Mercado Livre do
usuário, com filtros, chips de problemas da conta, badges de sinais por anúncio,
**agrupamento de variações por produto (UP)**, **preço com desconto** e paginação.
Clicar num anúncio **colapsa o painel e mostra a análise inline** (fluxo integrado
— ver seção própria).

## Como rodar

```bash
cd test-env/ad-selector
node serve.js
```

Abra **http://127.0.0.1:3477** no navegador. `Ctrl+C` para parar.

- Sem dependências (Node puro, `http`/`https` nativos). Nada de `npm install`.
- **Nada aqui é commitado no git.**
- Modo demonstração sem API: **http://127.0.0.1:3477/?mock=1** (73 anúncios
  fictícios — inclui 2 famílias UP com variações, itens com desconto, tipos e
  logísticas variados — cobrindo todos os badges e a paginação 50/50, sem gastar
  chamada).

## Arquitetura

```
Browser  ──►  serve.js (127.0.0.1:3477)  ──►  api.mercadolibre.com
                     │
                     └── injeta "Authorization: Bearer <token>" server-side
```

- **O token do Mercado Livre nunca chega ao browser.** O front sempre chama
  `/api/ml/<caminho>`; o `serve.js` lê o `access_token` do disco
  (`~/.ml-mcp-tokens.json`) **a cada request**, injeta o header `Authorization`
  e repassa a resposta da ML (status + corpo JSON) de volta.
- O token **nunca** aparece em logs (logamos só método + caminho, sem query),
  **nunca** em mensagens de erro, e **nunca** é renovado pelo protótipo. Se a ML
  devolver `401`, repassamos `401` e o front mostra "Sua conta do Mercado Livre
  desconectou".
- Rotas do proxy são allow-listadas: só `GET`, e só caminhos que começam com
  `users/`, `items` ou `questions/search` (qualquer outra coisa → `403`).
- `GET /api/health` → `{ ok, user_id }` (o `user_id` é público; o token não).

### Fluxo de dados

1. `GET /api/ml/users/me` → `id` do vendedor.
2. Chips da conta (contagens): 1× `include_filters=true` (labels/status/sub_status)
   + 2× gauge (`unhealthy`, `warning`, lendo `paging.total`) + 1×
   `missing_product_identifiers`. Cacheado em `sessionStorage` por 10 min.
3. Página: `GET /api/ml/users/{id}/items/search?status=active&limit=50&offset=0&orders=last_updated_desc`
   (+ filtros ativos). **`results` é array de strings (ids)** — o front trata
   isso defensivamente.
4. Hidratação em blocos de 20: `GET /api/ml/items?ids=<20>&attributes=...`
   (resposta verbosa `[{code, body}]`). Atributos pedidos:
   `id,title,price,original_price,thumbnail,status,sub_status,health,tags,sold_quantity,available_quantity,permalink,warranty,catalog_listing,listing_type_id,shipping,date_created,family_id,user_product_id`.
   O `secure_thumbnail` **não** é pedido (nunca volta no multiget) — a URL https
   é derivada do `thumbnail` (troca `http`→`https`). `pictures` também fica de
   fora (pesa ~1,5KB por item). `original_price` alimenta o desconto; `family_id`
   + `user_product_id` alimentam o agrupamento por produto.
5. **Camada B — sinais por interseção de IDs** (enriquece as linhas depois de
   pintadas): para cada sinal com contador > 0 nos counts já carregados (se o chip
   diz 0, **não** faz a chamada), varre os IDs que casam com o filtro
   (`items/search?<filtro>&limit=100`, até 300 IDs) e guarda num `Set` em
   `sessionStorage` (10 min). Na hora de montar o badge, é lookup O(1). Sinais:
   `reputation_health_gauge=unhealthy|warning`, `labels=with_low_quality_image`,
   `missing_product_identifiers=true`, `labels=few_available`.
6. **Camada C — perguntas sem resposta**: 1× `questions/search?seller_id={id}&status=UNANSWERED&limit=50`
   por conta (cache 10 min) → mapa `item_id → nº` → badge por linha.
7. **Camada C — visitas 30d**: 1 chamada **por item** da página visível
   (`items/{id}/visits?date_from&date_to`), com limite de concorrência. A ML
   **não** tem endpoint bulk de visitas por item (`items/visits?ids=` aceita só
   1 id), então o custo é ~50 chamadas/página (ver "Custo de chamadas"). Se
   qualquer chamada falhar, a célula mostra `—` sem quebrar. Gated em
   `CONFIG.SHOW_VISITS`.
8. Clique na linha/botão → **fluxo integrado** (ver seção): colapsa o painel e
   mostra a barra "← Voltar" + placeholder da análise. O botão "Abrir análise no
   app ↗" é o stand-in que faz `window.open('…/analise-anuncio?item=<id>')`.

### Custo de chamadas

- **Uma vez por sessão** (cacheado 10 min, chaves separadas mock/real):
  `users/me` (1) + counts dos chips (4: include_filters + 2 gauge + missing) +
  Camada B (≤3 chamadas por sinal com contador > 0; sinais com contador 0 custam
  0) + perguntas (1).
- **Por página exibida**: 1 `items/search` (IDs) + 3 multiget (50÷20, arredondado
  pra cima) + **~50 visitas** (1 por item; camada C). Sem a camada de visitas
  (`SHOW_VISITS=false`) são ~4 chamadas/página; **com** visitas, ~54/página.
  A coluna Visitas é o item mais caro do painel — decidir na fase de produção
  se entra (e com qual janela/estratégia) por causa do rate limit por `userId`.

### Sinais (badges) por anúncio

Regras no objeto `PROBLEM_RULES` e nas configs `SIGNAL_SETS` / `PROBLEM_CHIPS`
(topo do `<script>` do `index.html`), fáceis de ajustar. Badges de **problema**
suprimem o "Sem problemas"; badges **informativos** (cinza/azul neutros) aparecem
junto — a leitura "Sem problemas · Sem frete grátis · Ainda sem vendas" é coerente
(status + fatos). No desktop, os informativos ficam sempre dentro do colapsador
"+N sinais" (ver adiante) — as 3 vagas visíveis são só de problemas (+ o verde).

**Camada A — direto do multiget:**
- `health` numérico < `0.7` → **Saúde do anúncio X%** (vermelho; percentual
  arredondado — a métrica e o threshold do ML ficam intocados, só a apresentação
  muda). `health` vem `null` na maioria dos itens → nesse caso **não** gera badge
  (null = ausência de dado, não é "Sem problemas" nem problema).
- tag `incomplete_technical_specs` → **Ficha técnica incompleta**
- título < 50 chars **E** `sold_quantity === 0` → **Título curto** (regra do app:
  **nunca** sinalizar título de anúncio que já vende — reseta a indexação no ML)
- `warranty` vazio → **Garantia não informada** (cinza — aponta o campo a preencher)
- `sub_status` → badge conforme o valor (`forbidden` → Infração, `waiting_for_patch`
  → Corrigir para reativar, `held`/`suspended` → Suspenso, `under_review` → Em
  revisão, `payment_required` → Aguardando pagamento…). Valor **desconhecido** →
  "Precisa de atenção" (nunca a string crua da API em inglês)
- `listing_type_id === 'free'` → **Anúncio Grátis — baixa exposição** (laranja;
  fato do ML, não regra nossa)
- `shipping.free_shipping === false` → **Sem frete grátis** (cinza, informativo)
- `sold_quantity === 0` → **Ainda sem vendas** (cinza, informativo neutro — o
  "Ainda" evita a contradição visual com "Sem problemas" na mesma linha)
- `catalog_listing === true` **ou** tag `catalog_boost` → **Catálogo** (azul,
  informativo — não é problema)

**Camada B — interseção de IDs (o item está no `Set` do sinal):**
- `unhealthy` → **Perdendo exposição** (vermelho) · `warning` → **Risco de
  perder exposição** (laranja — mesmo vocabulário do chip da conta)
- `with_low_quality_image` → **Foto de baixa qualidade** (laranja; substitui a
  dependência do nome da tag por item — o array `lowQualityPhotoTags` fica como
  redundância)
- `missing_product_identifiers` → **Sem código de barras (GTIN)** (cinza; mesmo
  texto do chip da conta)
- `few_available` → **Estoque quase no fim** (amarelo)

**Camada C — dados vivos:**
- visitas 30d `=== 0` → **Sem visitas em 30 dias** (cinza) + valor na coluna
  "Visitas (30 dias)"
- perguntas sem resposta `> 0` → **N pergunta(s) sem resposta** (laranja)

Sem nenhum problema → **Sem problemas** (verde). Exceção: se a varredura de algum
sinal da Camada B ficou **incompleta** (conta com mais de 300 anúncios no sinal, ou
erro no meio da varredura) e o item **não** está no trecho coberto, a célula fica
**sem veredito** em vez de afirmar um "Sem problemas" possivelmente falso.

**Visual dos sinais (04/07, pedido Lucas "tá tudo meio estranho")**: sinal =
**indicador LED flat + texto** (`.badge::before` = quadradinho 7px na cor da
severidade; texto neutro, severidade alta ganha texto colorido) — **sem fundo de
pill por sinal** (o "arco-íris de pills" virou lista limpa, mesma linguagem dos
chips do resumo). **Ações continuam pills azuis** (clicável parece clicável):
"N variações ▾", "N anúncios vinculados ▾", "+N sinais ▾" (`.badge.variations`,
`.badge-more` — `::before` desligado nelas).

Na tabela, os badges são **ordenados por severidade** com o "Sem problemas" primeiro
(verde → vermelho → laranja → amarelo → cinza → azul). No **desktop**, as vagas
visíveis (até **2** — mantém a linha baixa e cabem ~11 anúncios na tela; a coluna
Sinais tem faixa garantida via `th.th-sinais { min-width }` + `.badges
{ max-width }`, senão a coluna Anúncio engole a largura e os badges empilham 3+
dobras) são só de **problemas** (vermelho/laranja/amarelo, mais o verde);
os **informativos** (cinza/azul) e o excedente de problemas colapsam sempre num
**"+N sinais ▾"** azul-claro **clicável** (mesma cara do badge "N variações", que
já é lido como ação; "− mostrar menos ▴" recolhe; o tooltip continua como
redundância). Badges de problema com ação conhecida (Foto de baixa qualidade,
Ficha técnica incompleta, Sem GTIN, Perdendo exposição, Risco de perder
exposição, Corrigir para reativar, Anúncio Grátis, Título curto, Garantia não
informada, Infração, Congelado e Saúde do anúncio X%) ganham **dica de "o que
fazer"**: tooltip no hover (desktop) e, no **mobile** (onde `title=` é
invisível), **toque no badge** abre a dica logo abaixo dos sinais do card
(mesmo badge fecha, outro badge troca — sem disparar a análise da linha). No
**mobile** o card também colapsa (design review P6): mostra os 2 sinais mais
graves + **"+N sinais ▾"** (alvos de toque ≥38px — P10). A tabela também tem a
coluna **Vendas (total)** (`sold_quantity` — total desde a criação do anúncio,
dito no tooltip do cabeçalho; já vem no multiget — custo zero de chamadas).

O botão **"Analisar →" é sticky na borda direita** (`.analyze-cell` com
`position: sticky; right: 0` + fundo sólido por estado zebra/hover/selected/
subrow): em janela estreita, quando a tabela rola horizontalmente, o botão
continua visível por cima do conteúdo rolado — **os sinais nunca atropelam o
botão** (no card mobile o sticky é resetado). Foto do anúncio: **56px** no
desktop e **72px** no card mobile. O caret ▸ de família tem glifo maior
(1.1rem) e gutter menor (padding 8px, margem 4px).

Os chips do resumo da conta incluem, além dos anteriores, **Estoque quase no fim**
(`few_available`) e **Corrigir para reativar** (`fix_required`), quando o
`include_filters` traz contador > 0. O marcador de severidade dos chips é um
**quadradinho flat estilo LED** (`.chip-ind`, `sev: red|orange|yellow|gray` no
`PROBLEM_CHIPS`) — as bolinhas emoji 🔴🟠🟡⚪ saíram (pedido do Lucas: visual mais
"tech"); a faixa "Mostrando só:" usa o mesmo indicador.

## Design review aplicado (04/07 — time de design Opus 4.8, nota 7/10, "mandar bala em tudo")

As 14 correções do `RELATORIO-DESIGN-REVIEW.md` foram aplicadas:
- **P1**: severidade primeiro na coluna Sinais; pills de ação ("N variações",
  "vinculados", "+N sinais") por ÚLTIMO e em **ghost** (borda fina, sem fundo).
- **P2**: `vertical-align: top` nas células — valor primário na mesma altura em
  toda a linha (fim do zigzag).
- **P3**: sparkline honesto — baseline tênue, traço slate (fora do azul
  interativo), **ponto final colorido por tendência** (verde sobe / vermelho cai
  / cinza estável; últimas 7d vs 7d anteriores, ±10%), nº com largura fixa
  (lane alinhada); **escondido no card mobile**.
- **P4**: CTA "Analisar →" sólido no mobile (azul/branco) e opacity 1 + borda
  1.5px no desktop.
- **P5**: fim do truncamento de rótulos (`th-sinais` 360px; `.badges` sem
  max-width rígido — rótulo longo quebra linha, não some; título 340→300px).
- **P6**: mobile colapsa sinais (2 + "+N ▾"; `showAll = expanded`).
- **P7**: no mobile só **botão/foto/título** disparam a análise (fim do toque
  acidental ao rolar).
- **P8**: ◆ CATÁLOGO em ghost (outline navy) — identidade, não alarme.
- **P9**: emojis de controle (🔍🏷️⬇⟳✅🎉🗂️🚚) → ícones SVG flat em traço; copy
  "conv." → **"conversão"**.
- **P10**: badges do card mobile com min-height 38px + gap maior (alvo da dica).
- **P11**: ID discreto no card mobile (menor, 80% opacidade).
- **P12**: sublinha "≈ X dias" **só até 365 dias** — o "≈ 1 ano+" repetido virou
  ruído e foi suprimido (horizonte de exibição que já existia, não threshold novo).
- **P13**: sublinhas com `tabular-nums` (sem tremor) e conversão um degrau acima
  (`--text-secondary`, peso 500).
- **P14**: carrossel de chips com fade na borda direita (pista de rolagem).

**Estabilidade na expansão** (pós-review; "quando abre as variações ou anúncios
vinculados fica cortado"): expandir família/vinculados ALARGAVA a tabela (a
coluna do botão crescia +53px com "Analisar variação →", e título/badges de
sub-linha sem teto esticavam as colunas) → com a tabela já flush, o excedente
ficava sob o botão sticky. Correções: botão da variação virou **"Analisar →"**
(tooltip "Analisa só esta variação" — o título da sub-linha já diz que é
variação); **`.badges` com largura FIXA** (340px desktop / 258px tier — casada
com o `th.th-sinais`), então a coluna Sinais nunca muda; título de sub-linha
com `max-width` (300px/190px) quebrando linha sem ellipsis. Invariante validado:
**a largura da tabela é IDÊNTICA fechada e expandida** (1288/1288 @1366;
1055/1055 @1100), zero elementos sob o botão.

**Tier compacto 721–1345px, agora FLUIDO** ("os sinais estão sendo cortados" /
"a parte antes da variação tá vazando"): sem ele a tabela (~1278px) rolava
horizontalmente e o **botão sticky cobria a coluna Sinais**. No tier: foto 44px,
sparkline oculto, paddings 7px — e **Título/Sinais com largura por `clamp(vw)`**
(encolhem 1px por 1px de janela; como dependem da JANELA e não do conteúdo,
expandir família/vinculados não muda a largura da tabela). Constantes com ~20px
de folga pra barra de rolagem clássica do Windows. A banda 1320–1345 entrou no
tier (antes vazava ~2–22px sem proteção). Piso do clamp ≈ 920px de janela;
abaixo disso rola com a **sombra à esquerda** no botão sticky (affordance) e,
se um badge for mais largo que a faixa mínima, o texto **quebra dentro do
badge** em vez de vazar. `.row-id` tem `flex-wrap` (ID/ícones quebram linha em
coluna estreita em vez de vazar).

**⛔ GUARDA DE REGRESSÃO — `mfLayoutCheck()`** (PROTOTYPE-ONLY, exposto em
`window`): já quebramos "cortado/vazando" 3x por caminhos diferentes. Depois de
QUALQUER mudança de CSS/render, rode no console `mfLayoutCheck()` — com
famílias E vinculados **expandidos** — em pelo menos **1366, 1100, 1000 e 390**
de largura. Ele acusa: tabela maior que o host (vai sumir sob o botão sticky),
elemento passando da borda da própria célula, e scroll horizontal da página no
mobile. Matriz validada em 04/07: **920–1440px (fechado E expandido) + 390 =
zero problemas**. O card mobile de **anúncio vinculado** (`data-label=
"Vinculado"`) usa as mesmas regras de card de Título/Variação (antes renderizava
como linha rotulada quebrada).

## Vendas 30d, conversão e estoque estimado em dias

**Camada C — vendas 30d por conta** (`loadSales30`): `orders/search?seller=…
&order.status=paid&order.date_created.from=<30d atrás>` — **1-3 chamadas POR
CONTA** (teto `SALES30_MAX_PAGES`=3 × 50 pedidos, cache sessionStorage 10 min)
→ mapa `item_id → unidades vendidas nos últimos 30 dias`. Honestidade: se a
conta tem **mais pedidos que o teto**, `sales30Incomplete=true` e **nenhuma taxa
aparece** (número parcial enganaria); sem escopo de orders no token → degrada
limpo (segue sem conversão; previsão cai no ritmo desde a criação).
⚠️ Escopo de leitura de `orders/search` **ainda não validado com token real**.

**Taxa de conversão 30d** (`convHtml`): `vendas30d ÷ visitas30d`, exibida como
"conv. X%" **sob o número de visitas** — só quando as **duas janelas reais**
existem (`SHOW_VISITS` on, visitas > 0, camada de vendas completa). Na
linha-família: somas das variações. Também vira coluna na planilha.

**Minigráfico de tendência de visitas** (`sparklineSvg`, pedido Lucas 04/07): a
chamada de visitas mudou de `items/{id}/visits?date_from&date_to` para
**`items/{id}/visits/time_window?last=30&unit=day`** — devolve o **total E a
série diária na MESMA chamada** (custo idêntico, zero chamada extra). A série
(`state.visitsSeries`) vira um **sparkline SVG inline** (56×16px, linha azul) ao
lado do número de visitas, tooltip "Visitas por dia nos últimos 30 dias". Na
linha-família: soma elemento a elemento das séries das variações (só quando
todas carregaram). ⚠️ `time_window` ainda **não validado com token real** (o
endpoint antigo de total foi). No mock, a série tem 4 formatos determinísticos
por id (subindo/caindo/estável/pico recente) e a conversão varia 2%–14% por
item. Nota: a whitelist do `serve.js` ganhou `orders/search` (vendas 30d).

**Estoque estimado em dias** ("≈ X dias" sob o estoque, `.stock-days` +
tooltip): prioriza o **ritmo dos últimos 30 dias** (`vendas30d ÷ 30` — pedido do
Lucas: previsão pelo ritmo recente); **fallback** = ritmo médio desde a criação
(`sold_quantity ÷ idade` via `date_created`, que já vem no multiget). O tooltip
diz **qual base** foi usada. Regras: só aparece com vendas > 0, estoque > 0 (e
data, no fallback); acima de 365 dias vira **"≈ 1 ano+"**. Na linha-família:
soma das vendas 30d das variações (ou soma dos ritmos de vida, no fallback).

## Catálogo: marcador especial + anúncios vinculados

- **Marcador `◆ CATÁLOGO`** (`.tag-catalog`, navy, junto do título na linha do
  ID): substitui o antigo badge azul informativo (saiu do `computeBadges` — 
  catálogo não é "sinal", é natureza do anúncio). Critério: `catalog_listing:
  true` OU tag `catalog_boost` (`isCatalogItem`). Aparece em linha simples,
  linha-família (se qualquer variação for catálogo) e sub-linhas. Na planilha:
  coluna `Catálogo` (Sim/vazio).
- **Anúncios vinculados** (`item_relations`, adicionado ao `MULTIGET_ATTRS` —
  ⚠️ **não validado com token real**; se o campo não vier, o expansor
  simplesmente não aparece): em anúncio de catálogo com relações, uma pill
  **"N anúncios vinculados ▾"** (mesmo visual da pill de variações) expande
  sub-linhas: item presente na página carregada → sub-linha completa (preço,
  estoque, sinais, Analisar); item fora da página → sub-linha mínima com o ID,
  badge "fora desta página" e **Analisar** (o fluxo de análise aceita só o ID;
  a barra mostra o ID como fallback de título). Estado em
  `state.expandedRelations`; **sem agregação de números** entre catálogo e
  vinculados (nada de somas inventadas).

## Agrupamento por família (UP)

Roupas (e outros) têm produtos com variações — cada variação é um anúncio MLB da
mesma família. Analisar variação por variação não faz sentido, então o painel
**agrupa por `family_id`** (`CONFIG.GROUP_FAMILIES`):

- Famílias com 2+ variações **na página** viram 1 **linha-produto**: thumb do item
  **mais vendido**, **título = maior prefixo comum** entre as variações (helper
  `familyTitle`: "Camiseta Estampada Algodão — Tam P/M/G" → "Camiseta Estampada
  Algodão"; apara separadores e sufixos curtos tipo "Tam"; se o prefixo ficar
  <10 caracteres, cai no título do mais vendido — título de UMA variação ao lado
  de números SOMADOS induzia erro de leitura), chip azul **"N variações ▾/▴"**
  (clicável — também expande/colapsa), **faixa** de preço `R$ min–max` em 1 linha
  (ou valor único se iguais), **soma** de estoque/visitas/vendas, ícones de
  copiar/abrir na célula ID, e **união** dos badges de todas as variações (dedup;
  "Sem problemas" some se qualquer variação tiver problema — o filtro é pela classe
  verde, robusto a mudanças de texto). Badges por variação **não contradizem os
  números agregados da linha**: se a família tem vendas, "Ainda sem vendas" vira
  **"Variação ainda sem vendas"** (idem "Variação sem visitas", "Variação:
  estoque quase no fim" e — quando o estoque somado é > 0 — "Sem estoque" vira
  **"Variação sem estoque"**) — o vendedor acha a variação-problema expandindo a
  família. O botão da linha-produto é **"Analisar →"** (igual às linhas simples;
  tooltip "Analisa o produto inteiro" — o rótulo longo "Analisar produto →"
  estourava a largura da tabela em 1366px).
- Clique na linha-produto → analisa o **produto** via `user_product_id` (formato
  `MLBU…` — o fluxo UP do analyzer mostra produto + anúncios vinculados). Fallback:
  `id` MLB do representativo se `user_product_id` vier null.
- **Expansível**: o caret ▸ (área de toque ampliada, ~40px) ou o chip
  "N variações" abre as variações como sub-linhas indentadas, cada uma com seus
  badges, preço e um botão "Analisar variação" (analisa o MLB específico).
- O contador da paginação mantém o total real de **anúncios** ("Mostrando 1–50 de
  63 anúncios") e acrescenta "· agrupados em **N** produtos" quando agrupa (a
  única frase da tela que explica a feature de agrupamento).
- Famílias com 1 variação na página caem como linha simples (sem chip). Itens sem
  `family_id` (clássicos) seguem linha normal.
- **Sob recorte (chip de problema, busca ou "Com desconto") o agrupamento é
  desligado**: o agregado somaria só as variações que bateram no recorte e a linha
  "N variações · Estoque X" mentiria sobre o produto inteiro (induziria decisão de
  reposição errada). Cada variação vira linha simples com os números reais dela; o
  clique continua analisando o **produto** (`user_product_id`). Sem recorte, o
  agrupamento volta ao normal.

Validado com token real: os 13 anúncios ativos da conta de teste colapsam em
**4 produtos** (uma família tem 8 variações).

## Preço com desconto

`original_price > price` → mostra o **original riscado** (menor, muted), o preço
atual e um badge verde **"-X%"** (percentual arredondado). Na linha-produto, a
faixa usa o preço **efetivo**, mostra também a **faixa dos preços originais
riscada** (`origMin`/`origMax` no `familyAgg`, só variações com desconto) e o
badge vira **"até -X%"** (maior desconto da família). `sale_price` **não** vem no
multiget (fato conhecido) — usamos `price` vs `original_price`, que é o que o ML
exibe. A coluna Preço (e as demais numéricas) usa `th.fit/td.fit` (`width:1%`):
encolhem no conteúdo e o espaço livre vai pro título e sinais. **A pill "-X%"
fica em linha própria ACIMA do preço** (`.badge-off` é block com
`margin-left:auto`): o preço fica sozinho na linha dele e **todos os preços da
tabela alinham na mesma borda direita** (pill inline alargava a coluna e
desalinhava as linhas). No mobile, o td do preço vira `display:block` com o
rótulo flutuado (riscado → pill → preço empilham à direita) e `td.fit` volta a
`width:100%` (o `width:1%` é conceito de desktop — no card ele encolhia a caixa
pra ~3px e o conteúdo transbordava).

## Filtros e praticidades

- **Tipo de anúncio** (`listing_type_id`, **validado**): Todos · Premium (gold_pro)
  · Clássico (gold_special) · Grátis (free).
- **Envio** (`logistic_type`, **validado**): Todos · Full (fulfillment) · Flex
  (self_service) · Coleta (xd_drop_off). Obs.: a conta de teste é toda Coleta —
  Full/Flex retornam 0 nela, mas o filtro funciona.
- **Chips de problema × toggle de status**: ativar um chip **sem** status próprio
  zera o toggle pra "Todos" (a lista bate com a contagem do chip, que é sem filtro
  de status); **desativar o chip devolve o status que o usuário tinha antes**
  (guardado em `state.prevStatus` — sair do chip não larga a triagem em "Todos");
  trocar o status **manualmente** é escolha explícita e zera esse retorno; trocar
  pra um valor incompatível com o chip ativo **solta o chip** (a lista nunca
  contradiz o toggle). Com chip ativo, uma **faixa azul** acima da tabela diz o
  que está filtrado ("Mostrando só: …") e traz o botão embutido **"voltar para a
  minha lista"** (desativa o chip ali mesmo e devolve o status anterior, sem
  voltar ao resumo); no celular, ativar um chip rola a página até a lista filtrada.
- **"🚚 Frete grátis abaixo de R$ 79"** — quick-filter **client-side** (pedido
  Lucas 04/07; problema recorrente de usuários): mostra os anúncios com **preço
  abaixo do piso de obrigatoriedade** (`PROBLEM_RULES.freeShippingFloor = 79` —
  regra do ML: frete grátis obrigatório a partir de R$ 79) **e** frete grátis
  ligado — nesses, o frete sai do bolso do vendedor e a margem quase zera.
  Mesmo padrão do "Com desconto": faixa persistente explicativa, pager honesto,
  URL (`frete79=1`), combina com o desconto (E lógico). O mesmo critério vira o
  **sinal laranja "Frete grátis abaixo de R$ 79"** em cada linha
  (`isCheapFreeShipping`, camada A — custo zero), com dica de "o que fazer".
- **"Com desconto"** — quick-filter **client-side** (a ML não tem param de
  desconto): filtra **só a página carregada**. Com o filtro ativo, uma **faixa azul
  persistente** acima da lista diz "Mostrando só: 🏷️ Com desconto (desta página)"
  com o botão embutido **"voltar para a minha lista"** (o estado nunca some da
  vista ao rolar), e o contador da paginação vira "Mostrando **N** anúncios com
  desconto (dos 1–50 de T)" — o pager bate com o que a tabela mostra.
- **ID junto do título** — a coluna ID foi absorvida pela coluna **"Anúncio"**:
  o ID fica em linha menor (DM Mono, muted) logo abaixo do título, com **copiar**
  (ícone SVG flat, `COPY_ICON_SVG`) e **abrir no ML** (↗ permalink) sempre
  visíveis em opacidade reduzida (100% no hover da linha; no mobile alvo de toque
  maior). O caret ▸ de família vive na mesma célula (`.cell-main` → caret +
  `.cell-text` com título + `.row-id`).
- **"⬇ Baixar planilha"** (botão verde; decisão Lucas 04/07: **baixar "só a
  página" foi removido — não fazia sentido**): baixa **TODOS os anúncios da
  lista atual** (respeitando os filtros ativos: status, chip, busca, tipo,
  logística) num arquivo só (`anuncios-AAAA-MM-DD.csv`), percorrendo as páginas
  **sequencialmente** com as **mesmas chamadas da paginação manual** (search +
  multiget — zero custo novo por item; **sem** chamadas de visitas, a coluna
  preenche só com o que já está em memória). Progresso no próprio botão
  ("Baixando 150 de 480…"); conta que **cabe numa página não refaz chamada
  nenhuma** (usa o que está na tela); conta com > 1.000 anúncios → baixa os
  primeiros 1.000 e o banner explica o teto do ML; em erro, aviso amigável e
  reabilita. **Exceção**: com "Com desconto" ativo (recorte client-side da
  página carregada), a planilha exporta exatamente o que a tabela mostra
  (`anuncios-com-desconto-…csv`). Formato Excel pt-BR: separador **`;`**,
  vírgula decimal, BOM UTF-8; cabeçalhos: `ID, Título, Preço, Preço original,
  Estoque, Vendas (total), Vendas (30 dias), Visitas (30 dias), Conversão 30d
  (%), Status, Tipo, Catálogo, Envio, Perguntas sem resposta, Sinais, Link`.
- **Estado na URL** (`history.replaceState`): status, ordenação, busca, chip, tipo,
  logística, desconto e página vão na querystring — **F5 mantém** e o link é
  compartilhável.
- **Atalhos**: `/` foca a busca; `Esc` sai da análise ou desfoca o campo de
  busca — **`Esc` nunca limpa filtros/chip/página** (a triagem nunca é destruída
  por acidente; limpar segue pelos botões intencionais "Limpar filtros" /
  "voltar para a minha lista").
- **⟳ Atualizar** ao lado dos chips força o refresh do resumo (limpa o cache de
  10 min) **e recarrega a tabela** (1 search + multigets da página atual — custo
  igual a um F5, nada novo por item; fecha o ciclo corrigir→voltar→conferir).
  Enquanto atualiza: skeleton real nos chips + botão desabilitado (sem spin fake).
  Se o resumo falhar, aparece um aviso com a saída ("toque ou clique em ⟳
  Atualizar para tentar de novo") em vez de sumir em silêncio. **Falha total das
  4 chamadas de contagem nunca vira "Tudo certo!"**: `fetchCounts` lança erro se
  nenhuma respondeu (nada é cacheado), e re-renders de chips sem cache válido
  (limpar filtros / soltar chip) rebuscam com skeleton (`renderChipsFresh`) em
  vez de pintar `{}` — conta legitimamente vazia (chamadas ok, zero problemas)
  continua mostrando a mensagem verde.
- **Saídas de emergência**: o estado vazio com filtros ativos tem botão
  **"Limpar filtros"**; o estado de sessão expirada (401) tem botão
  **"Reconectar conta"** (`CONFIG.RECONNECT_URL` — placeholder, ajustar quando a
  URL real existir).
- **Mobile**: o card abre com **foto + título + sinais** (o "por quê" na primeira
  dobra, não o ID); variações expandidas aparecem recuadas com filete azul (lêem
  como "filhas" do produto); todos os controles com alvo de toque ≥44px (botões
  Analisar, chips, ⟳, "N variações", lupa, copiar/abrir, pager); a **setinha ▸ do
  caret fica oculta** no card (a pill "N variações ▾" já é o controle óbvio de
  expandir — a setinha era ruído com alvo pequeno); busca e selects usam
  **16px de fonte** no mobile (elimina o auto-zoom do Safari/Chrome iOS ao focar,
  sem `maximum-scale` — o pinch-zoom segue livre); os **controles secundários**
  (ordenação, tipo, envio, limpar, planilha, "Com desconto") **colapsam atrás do
  botão "Filtrar e ordenar ▾"** — busca e o toggle Ativos/Pausados/Todos ficam
  sempre visíveis (status é triagem primária) e o 1º anúncio entra na primeira
  dobra; **aberto, o botão vira "Fechar filtros ▴"** (mesmo padrão de caret que
  flipa das famílias); com filtros do bloco ativos mostra "(N)" em azul (o
  estado nunca fica invisível); na barra de análise o layout **quebra em 2
  linhas** (linha 1 = "← Voltar" + foto; linha 2 = título em largura cheia) e o
  ID mono fica oculto — **exceto** quando a análise veio de **link/ID colado**
  (sem título): aí o ID em DM Mono ocupa o slot do título e a barra nunca fica
  anônima; limpar a busca pelo "x" nativo refaz a lista. O bloco
  `@media (max-width:720px)` fica **no fim do `<style>`** de propósito (as
  regras mobile precisam vencer a cascata) — não mover de volta pra cima.

## Fluxo integrado (modelo final do widget bTKMH)

O painel é o **estado inicial** do widget; a análise é **inline**, não uma tela
separada:

- **Selecionar texto do título não dispara a análise** (soltar o mouse depois de
  arrastar sobre a linha não conta como clique); clique simples segue analisando.
- Clicar numa linha (produto ou anúncio) **não abre aba** — colapsa o painel
  inteiro e mostra, no topo, uma **barra sticky** "← Voltar para a lista" + thumb +
  ID + título, e abaixo um **placeholder** em linguagem de usuário ("A análise
  completa aparece aqui"; a nota técnica sobre o `resultsContainer` virou
  comentário HTML) + botão "Abrir análise no app ↗" (stand-in).
- **"← Voltar" restaura a lista SEM refetch** — filtros, página e **posição de
  scroll** preservados (estado em memória; a tabela continua montada, só oculta).
- **Input único inteligente**: o campo de busca aceita também **link/ID colado** —
  se casa com link do ML, `MLB…`, `MLBU…` ou `/p/MLB…`, vai **direto** pra análise
  daquele item; texto livre filtra a lista (`q=`). Placeholder: "Nome, ID ou link
  do anúncio". A lupa 🔍 é um **botão real** (submete a busca no clique) e o input
  é `type="search"` com `enterkeyhint="search"` (teclado do celular mostra
  "buscar").

## Limitações conhecidas

- **Offset trava em 1.000.** A `items/search` da ML não pagina além de 1.000
  resultados. Ao chegar nesse teto, o protótipo mostra um aviso amigável
  ("use a busca ou os filtros para refinar"); **não** existe modo de varredura
  (scan). Para contas com > 1.000 anúncios, a busca por ID/nome/SKU e os
  filtros/chips são o caminho para chegar num anúncio específico.
- **Busca por nome (`q=`) — validada e ativa** (`CONFIG.USE_Q_PARAM = true`).
  Confirmado com token real: `q=` funciona, mas **sempre** combinado com
  `status=` (sozinho varre todos os status). O front já manda `status=` junto
  (exceto no modo "Todos", que é justamente varrer tudo de propósito). Busca por
  ID (`MLB…`/`MLBU…`) hidrata direto, sem passar pela search. O fallback `sku=`
  fica implementado mas **não foi validado** (a conta de teste não usa SKU).
  **Gate de release**: o aval da tela fica condicionado à validação do `q=` com
  token real — se não filtrar, `USE_Q_PARAM=false` antes de qualquer port ao
  Bubble. No modo SKU a UI se explica: placeholder vira "ID ou link do anúncio
  (ex.: MLB123456789)" e o estado vazio orienta a colar o ID/link.
- **Filtro de labels usa sempre `labels=` (plural).** O `label=` singular é
  ignorado silenciosamente pela ML (devolve o inventário inteiro) e `tags=` é
  indefinido — nenhum dos dois é usado.
- Contagem de "Pausados sem estoque" usa a contagem do label `without_stock`
  vinda do `include_filters` (aproximação; o cruzamento exato status+label não
  é retornado numa única chamada).
- **Visitas 30d é o sinal mais caro.** Não existe endpoint bulk de visitas por
  item na ML (`items/visits?ids=` só aceita 1 id; `users/{id}/items_visits` dá só
  o total da conta), então é 1 chamada por item da página (~50/página). Fica atrás
  da flag `CONFIG.SHOW_VISITS` e com limite de concorrência. Para produção, avaliar
  se compensa (rate limit por `userId`).
- **`questions/search` exige a whitelist atualizada no `serve.js`.** Se o servidor
  estiver rodando com uma versão antiga do `serve.js` (sem `questions/search` na
  whitelist), as chamadas de perguntas retornam `403` e o front degrada sem badges
  de pergunta (sem quebrar). Reinicie o `serve.js` para habilitar.
- **Camada B cobre até 300 IDs por sinal.** Acima disso o badge cobre só os 300
  primeiros (logado no console em dev) e a varredura é marcada como **incompleta**:
  itens fora do trecho coberto ficam **sem o badge "Sem problemas"** (melhor sem
  veredito do que um veredito falso — decisão registrada: não subir o teto, pra não aumentar o
  custo de chamadas por conta). O cache usa o prefixo `mf_sel_sig2_` (formato
  `{ ids, incomplete }`). Revisar na fase de produção se algum sinal passar de
  300 anúncios.
- **Agrupamento por família é dentro da página de 50.** Uma família que atravessa a
  fronteira da página aparece dividida (parte numa página, parte na outra). Na fase
  Bubble dá pra resolver melhor (ex.: agrupar no servidor); no protótipo está ok.
- **`shipping_cost=free` foi testado e REMOVIDO.** Com token real, o param foi
  **ignorado** pela `items/search` (devolveu o total inteiro), então não virou
  filtro. `listing_type_id` e `logistic_type` foram testados e **funcionam** (por
  isso viraram selects). O quick-filter "Com desconto" é client-side porque a ML
  não tem param de desconto.
- **"Com desconto" filtra só a página atual** (client-side). A faixa persistente
  acima da lista e o contador "Mostrando N com desconto (dos anúncios X–Y de T)"
  deixam o recorte explícito (regra do projeto: nunca filtrar dataset truncado em
  silêncio).

## Próximos passos

- Portar para o widget do app no Bubble (**bTKMH**), servindo os dados via o
  **mlb-proxy** (Heroku) em vez do `serve.js` local — o proxy passa a injetar o
  Bearer e a aplicar rate limit por `userId`, como as outras rotas.
- Confirmar o comportamento de `q=` e fixar `USE_Q_PARAM`.
- Validar os nomes reais das tags de foto ruim / labels no `include_filters`
  com dados de produção e ajustar `PROBLEM_RULES` / `PROBLEM_CHIPS`.
