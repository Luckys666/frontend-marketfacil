# AD-SELECTOR-SPEC — Painel Seletor de Anúncios

> **Status:** protótipo em desenvolvimento (2026-07-03). Ainda NÃO está no Bubble.
> **Objetivo:** tela que aparece ANTES da Análise de Anúncios (`analise-anuncio`, elemento `bTKMH`): lista os anúncios da conta ML do usuário com filtros, badges de problemas e paginação. Clicar num anúncio dispara a análise existente.

## 1. Motivação e requisitos (Lucas, 03/07/2026)

1. Mostrar anúncios ativos da conta antes da análise (hoje o usuário precisa colar o link).
2. Filtrar por ID, nome e outros campos.
3. Paginação (padrão do app: 50/50, nada upfront, "Mostrando X de Y" com total real).
4. **Pré-filtrado** + **avisar o que já tem problema** para o usuário arrumar — elencando problemas que o app já sabe tratar.
5. Validar tudo numa página standalone ("por fora") com o token do Lucas ANTES de ir pro version-test.

## 2. Descoberta-chave: a API do ML já entrega os "problemas"

O `users/{user_id}/items/search` (doc oficial, verificada 03/07/2026 via MCP ML) suporta filtros que mapeiam 1:1 para problemas que o app já trata:

| Filtro da API | Problema | Função do app que resolve |
|---|---|---|
| `reputation_health_gauge=unhealthy\|warning` | Perdendo exposição (reclamações/cancelamentos) | Análise de Anúncios |
| `labels=incomplete_technical_specs` | Ficha técnica incompleta | Agente Palavras-Chave (ficha técnica) |
| `labels=with_low_quality_image` | Foto de baixa qualidade | Redimensionador (capa é a única penalizada) |
| `missing_product_identifiers=true` | Sem GTIN/identificador | Análise de Anúncios |
| `labels=without_stock` | Pausado sem estoque | — |
| `labels=being_reviewed` / `sub_status=*` | Em revisão / infração / corrigir | — |
| `include_filters=true` | **Contagem de todos os problemas da conta em 1 chamada** | alimenta o resumo em chips |

Campo `health` (0–1) no item = nota de saúde do próprio ML, por anúncio.

### 2.1 Resultados da validação com token real ✅ (03/07/2026)

Probe com 25 requests read-only na conta 649733403 (316 itens, 13 ativos). Relatórios em `scratchpad/ml-api-validation/` (report.md/json — sem token).

| Param | Veredito | Observações |
|---|---|---|
| `q=` | ✅ funciona | Combinável (`status=active&q=Blusinha` → 13→9, títulos batem). Sozinho varre TODOS os status — sempre combinar com `status=`. `restrictions` → `query_allowed:true`. |
| `labels=` (PLURAL) | ✅ filtra de fato | Totais batem com counts do include_filters. ⚠️ `label=` (singular) é IGNORADO silenciosamente (devolve inventário inteiro) e `tags=` é indefinido — usar SEMPRE `labels=`. |
| `include_filters=true` | ✅ o mais valioso | 1 chamada devolve todas as facetas com contadores: status, sub_status, listing_type_id, logistic_type, shipping e 22 labels. Fonte única do resumo em chips. |
| `reputation_health_gauge=` | ✅ | healthy=1 / warning=0 / unhealthy=0 nessa conta. |
| `sub_status=`, `orders=` | ✅ | price_asc confirmado crescente; 15 ordenações disponíveis. |
| `sku=`/`seller_sku=` | ⚠️ não validável | Conta não usa SKU (seller_custom_field null em todos). Testar em conta com SKU antes de expor na UI. |
| Multiget `attributes=` | ✅ | Todos os campos voltam EXCETO `secure_thumbnail` (derivar do thumbnail). `health` = null em 11/13 (sinal fraco — badge só quando presente). `pictures` pesa ~1,5KB/item — NÃO pedir na listagem. `catalog_listing` + tag `catalog_boost` identificam catálogo. |
| CORS direto do browser | ❌ NÃO usar | GET tem `ACAO:*` mas o preflight OPTIONS retorna 403; e Bearer no cliente viola a política de zero-vazamento. **Tudo via proxy** (protótipo: serve.js local; produção: mlb-proxy). |

**Arquitetura confirmada:** paginar com `items/search` (IDs) + hidratar em lotes de 20 no multiget com attributes enxuto (sem pictures/health pesados); chips a partir de `include_filters=true`; busca `q=` sempre combinada com status; ordenação server-side.

## 3. UX (Proposta U — Light Trading)

```
┌─ ⚠ Resumo da conta (chips clicáveis = pré-filtro server-side) ─┐
│ 🔴 3 perdendo exposição  🟠 12 ficha incompleta  🟠 8 foto ruim │
├─ Filtros ──────────────────────────────────────────────────────┤
│ [busca ID/nome/SKU]  [Ativos|Pausados|Todos]  [ordenar ▾]      │
├─ Tabela (header navy sticky, zebra, mono nos números) ─────────┤
│ thumb │ MLB… │ Título │ R$ preço │ estoque │ badges │ Analisar │
├────────────────────────────────────────────────────────────────┤
│ Mostrando 1–50 de 437          [← Anterior] [Próxima →]        │
└────────────────────────────────────────────────────────────────┘
```

- Abre **pré-filtrado em Ativos**, `orders=last_updated_desc`; chips de problema em destaque no topo (decisão: não abrir direto em "com problemas" — conta saudável ficaria vazia).
- Badges por linha (sinais rápidos client-side, sem prometer o score completo): saúde ML baixa, ficha incompleta, foto ruim, título curto (**só se `sold_quantity===0`** — nunca mexer em título que vende), <3 fotos, sem garantia, sub_status.
- Busca: `MLBU?\d+` → item direto; texto → `q=` (validado; fallback `sku=`).

### 3.1 Modelo de integração (decisão Lucas 03/07: "integrado à análise, não uma coisa separada")
- O painel é o **estado inicial do widget bTKMH** — mesma página, mesmo elemento, zero navegação.
- **Clique num anúncio → `handleAnalysisClick(id)` INLINE**: o painel colapsa numa barra compacta sticky ("← Voltar para a lista · MLBxxx") e a análise renderiza abaixo, no fluxo atual do `resultsContainer`.
- **Voltar** restaura a lista SEM refetch: estado (filtros, página, scroll) preservado em memória/sessionStorage.
- **Input único inteligente**: o campo de busca do painel absorve o input de colar link atual — se o texto é link/ID (MLB/MLBU/`/p/`) → dispara a análise direto (parse existente); se é texto livre → filtra a lista (`q=`). Um campo só, dois comportamentos; nada do fluxo atual se perde (aditivo).
- No protótipo standalone, o clique demonstra o colapso + barra Voltar; o botão "Abrir análise no app" (window.open com `?item=`) é só o stand-in até o port. **PROTOTYPE-ONLY**: o port F4 substitui o bloco do placeholder INTEIRO pelo `resultsContainer` real — o botão "Abrir análise no app ↗" e todos os textos desse placeholder existem só no protótipo; nenhum deles vai pro Bubble.
- Mobile (<720px): tabela vira cards. Chips com o link da ferramenta que resolve o problema (vende as outras features).

## 4. Arquitetura

### 4.1 Protótipo standalone ✅ rodando e validado (03/07)
`test-env/ad-selector/` — `index.html` + `serve.js` (Node zero-deps, porta 3477, 127.0.0.1 only). **Como rodar:** `cd test-env/ad-selector && node serve.js` → `http://127.0.0.1:3477` (mock: `/?mock=1`).
- `serve.js` injeta o Bearer **server-side** lendo `~/.ml-mcp-tokens.json` a cada request (renovação é exclusiva do proxy MCP — nunca renovar por fora). O token **nunca chega ao browser/DevTools**; logs só método+path; whitelist `users/`, `items`; só GET; 401 da ML → "sessão expirada".
- `?mock=1` para desenvolver sem API (65 itens fake, 55 ativos = 2 páginas; exercita paginação 50/50 e todos os badges).

**Teste no browser com conta real (649733403 "SEU ENCANTO", 13 ativos / 292 pausados):** listagem, hidratação (multiget verbose `[{code,body}]`), chips do include_filters (só `without_stock=100` visível — os de count 0 ocultam), filtro server-side por chip (pager "1–50 de 100", toggle sincroniza, "Limpar filtros" aparece), badges (Título curto, Sem estoque, Catálogo em 1 item real), 0 erros de console nos dois modos.

**Achados do teste:**
- `thumbnail` da ML vem `http://` → derivar https trocando o protocolo (secure_thumbnail nunca retorna).
- Bug corrigido: cache de contagens (sessionStorage) compartilhava chave entre mock e real → chaves separadas `mf_sel_counts` / `mf_sel_counts:mock`.
- Pendente: nome real da tag POR ITEM de "foto ruim" (amostra só tinha `good_quality_thumbnail`; array `PROBLEM_RULES.lowQualityPhotoTags` cobre os 3 candidatos; o chip da conta usa o label `with_low_quality_image`, validado).

### 4.2 Produção (fase Bubble)
- **mlb-proxy** ✅ pronto (03/07): branch `feature/ad-selector-endpoints`, commit `60f4dcb` (base master `8249bbd`), worktree `heroku/mlb-proxy-adselector`. **SEM push/deploy** — sobe junto com a fase Bubble, mediante aprovação.
  - `/api/fetch-ads`: passthrough aditivo de `q, sku, seller_sku, sub_status, labels, reputation_health_gauge, missing_product_identifiers, include_filters` (whitelists em constantes; inválido → 400 neutro; ignorados no modo scan — ML não os aceita com `search_type=scan`; comportamento byte-a-byte idêntico quando ausentes, coberto por teste de regressão).
  - `/api/fetch-item`: param `attributes=` (`/^[a-zA-Z0-9_,.]+$/`, max 500) → multiget leve, descrições puladas; ausente = intocado.
  - `utils/validators.js`: helpers novos no padrão existente. Testes: `tests/adSelectorRoutes.test.js` (30 checks); suíte completa verde (mintAuth + engine 88 + bandMatch 18 + bandsHealth 16 + rotas 40 + adSelector 30).
- **Frontend**: módulo novo em `js/analyzer.js` + componentes em `css/analyzer.css`, rebuild via `build-analyzer.js`, inject no `bTKMH` (version-test → aprovação → Live).

### 4.3 Fluxo de dados por página (economia de servidor)
1 × ids (`items/search`, limit 50) + 3 × multiget attributes (20 ids cada) + contagens dos chips (1 × `include_filters` + gauges `limit=1`, **cache sessionStorage 10 min**) ≈ 5-7 requests/página.
- ⚠️ `results` do items/search é **array de STRINGS**.
- ⚠️ offset trava em 1000 (modo scan fora do escopo do painel; aviso "refine com filtros").

## 5. Segurança
- Token sempre server-side (protótipo) / Bearer via header (produção, nunca em URL).
- `escapeHtml()` em todo dado da API antes de innerHTML.
- Mensagens de erro sem termos de infraestrutura (política Anubis/no-scraping do projeto).
- Nenhum log de token; logs do serve.js só método+path.

## 6. Fases
- [x] F0 — Plano + spec (este doc) — 03/07
- [x] F1 — Validação params API com token real (agente `api-validation`) — 03/07
- [x] F2 — Protótipo standalone rodando com dados reais (agente `prototype-ui` + integração) — 03/07
- [x] F3 — Branch mlb-proxy pronta com testes (agente `proxy-branch`; deploy só quando for pro Bubble) — 03/07
- [ ] F4 — Aprovação do Lucas no protótipo → portar pro widget bTKMH (version-test)
- [ ] F5 — Validação version-test → aprovação explícita → Deploy Live

### Sinais v2 (03/07, rodada 2) — 3 camadas ✅ implementadas no protótipo
- **A (multiget)**: Anúncio Grátis (listing_type free), Sem frete grátis, Sem vendas.
- **B (interseção de IDs)**: badges POR ANÚNCIO de Perdendo exposição/Risco (gauge), Foto de baixa qualidade, Sem GTIN, Estoque quase no fim — Sets por sinal (só busca quando contador>0; cap 300/sinal; sessionStorage TTL 10min). Resolve a pendência da tag de foto ruim por item.
- **C (dados vivos)**: coluna Visitas 30d + badge Sem visitas; N perguntas sem resposta (`questions/search?status=UNANSWERED`, 1 chamada/conta, exigiu `questions/search` na whitelist do serve.js). Chips novos: Estoque quase no fim (few_available), Corrigir para reativar (fix_required). Render progressivo (A pinta na hora; B/C enriquecem — race de página corrigido com `state.loading`).

### Rodada 3 (03/07) — família, desconto, filtros, praticidades, fluxo integrado ✅
- **Agrupamento por família (UP)**: por `family_id` (campos `family_id`/`user_product_id` validados no multiget). Linha-produto: chip "N variações", faixa de preço, soma estoque/visitas/vendas, união de badges; expansível (▸) com "Analisar variação". Clique analisa o PRODUTO via `user_product_id` (MLBU) — conta real: 13 anúncios → 4 produtos. Limitação: agrupa dentro da página de 50.
- **Desconto**: `original_price > price` → riscado + badge "-X%"; família mostra o maior desconto. (`sale_price` não vem no multiget — usar price/original_price.)
- **Filtros validados com token real**: `listing_type_id=` ✅ (select Tipo: Premium/Clássico/Grátis), `logistic_type=` ✅ (select Logística: Full/Flex/etc.), `shipping_cost=free` ❌ IGNORADO pela API no users/items/search → removido da UI.
- **Praticidades**: copiar ID, abrir no ML, CSV da página (BOM p/ Excel), estado completo na URL (F5 restaura), atalhos "/" e Esc, ⟳ refresh de contagens, quick-filter "Com desconto" (client-side, com aviso "só os 50 desta página").
- **Fluxo integrado (modelo do widget)**: clique colapsa o painel → barra sticky "← Voltar" → análise inline (placeholder no protótipo); Voltar restaura sem refetch; input único aceita link/ID (análise direta) ou texto (filtro).

⚠️ **ACHADO CRÍTICO — visitas NÃO têm bulk**: `items/visits?ids=X,Y` → 400 "maximum amount of items to query is 1"; `users/{id}/items_visits` = só total da conta. Visitas por item = **1 chamada/item (~50/página, concorrência 6)**. Custo/página: ~4 sem visitas vs ~54 com. Flag `CONFIG.SHOW_VISITS` (default true no protótipo). **DECISÃO PENDENTE pra F4/produção** (rate limit por userId): opções — (a) coluna sob demanda (botão "carregar visitas"), (b) só nos 10 primeiros, (c) remover coluna e manter só via análise profunda.

### Pendências conhecidas antes da F4
- Nome real da tag por item de foto ruim (confirmar com um item que tenha foto ruim de fato).
- `sku=`/`seller_sku=` não validados (conta de teste sem SKU) — validar em conta com SKU antes de expor a opção na UI.
- `health` por item é sinal fraco (null na maioria) — o gauge da conta é a via confiável.
- Cruzamento exato "paused + without_stock" não sai em 1 chamada (chip usa o label como aproximação).
- Portar UI para `js/analyzer.js`/`css/analyzer.css` + `build-analyzer.js` (trocar `/api/ml/*` pelas rotas do mlb-proxy) e deployar o branch do proxy junto.

### Rodadas de feedback do Lucas (04/07) — visual + catálogo + taxas ✅
**Visual/densidade (3 levas):**
- Chips do resumo sem bolinha emoji → **indicador flat estilo LED** (`.chip-ind`, `sev:` no PROBLEM_CHIPS). Copiar ID = ícone SVG (sem 📋).
- **Coluna ID eliminada** → ID em linha menor SOB o título (coluna "Anúncio"), copiar/abrir sempre visíveis (55%→100% hover). Caret de família na mesma célula, glifo maior e gutter menor.
- **Preços alinhados**: pill "-X%" em linha própria ACIMA do preço (`.badge-off` block) — todos os preços da tabela terminam na mesma borda (validado: 44 linhas no mesmo pixel). Família mostra faixa original riscada + "até -X%".
- **Densidade**: 2 badges visíveis + "+N sinais" (era 3), `th-sinais min-width` + `.badges max-width` garantem faixa da coluna, td padding 7px, botão da família = "Analisar →" (tooltip "produto inteiro") — linha ~65px, ~11 anúncios/tela.
- **Botão Analisar sticky** (`position:sticky; right:0` + fundo por estado) — nunca é cortado nem atropelado pelos sinais, mesmo com scroll horizontal em janela estreita.
- Foto 44→56px (desktop) e 72px (card mobile).
- **Fix mobile**: `td.fit{width:1%}` vazava pro card (caixa 3px, conteúdo transbordava) → reset `width:100%` no @media; preço empilha à direita (td block + label float).

**Catálogo:**
- **Marcador especial** `◆ CATÁLOGO` (tag navy junto do título, `.tag-catalog`) — substitui o antigo badge azul informativo (saiu do computeBadges). Coluna "Catálogo" (Sim/—) na planilha.
- **Anúncios vinculados** via `item_relations` (adicionado ao MULTIGET_ATTRS — ⚠️ **NÃO validado com token real ainda**; se não vier, o expansor não aparece): pill "N anúncios vinculados ▾" expande sub-linhas; item na página = dados completos; fora da página = ID + "fora desta página" + Analisar (fluxo aceita só o ID).

**Vendas 30d / conversão / previsão de estoque:**
- Nova camada C: `orders/search?seller&order.status=paid&order.date_created.from=` (janela 30d) — **1-3 chamadas POR CONTA** (teto SALES30_MAX_PAGES=3×50 pedidos, cache 10min) → mapa item→unidades 30d. ⚠️ escopo de orders no token real ainda não validado; sem escopo, degrada limpo (sem conversão; previsão cai no ritmo desde a criação).
- **Taxa de conversão 30d** = vendas30d ÷ visitas30d ("X% conv." sob as visitas; família = somas). SÓ aparece quando as duas janelas reais existem (SHOW_VISITS on + camada completa) — conta com mais pedidos que o teto NÃO mostra taxa (parcial enganaria).
- **Previsão de estoque "≈ X dias"** prioriza ritmo dos últimos 30 dias (pedido do Lucas); fallback = ritmo desde a criação (date_created); tooltips dizem a base. >365d = "≈ 1 ano+"; sem vendas/estoque/data = não mostra.
- Planilha ganhou colunas: Vendas (30 dias), Conversão 30d (%), Catálogo.

**Exportação:** botão único **"⬇ Baixar planilha"** = baixa TODOS os anúncios da lista atual (filtros ativos) num arquivo, progresso no botão, teto 1.000 (limite do ML) — "baixar só a página" foi REMOVIDO (decisão Lucas: não fazia sentido). Conta que cabe numa página não refaz chamadas. Exceção: "Com desconto" (recorte client-side) exporta o que a tabela mostra.

### 4ª leva (04/07) — sinais flat, sparkline de visitas, conversão ✅
- **Sinais redesenhados** ("tá tudo meio estranho" → resolvido): sinal = indicador LED flat 7px + texto neutro (severidade alta = texto colorido), SEM fundo de pill — mesma linguagem dos chips. Ações continuam pills azuis (variações/vinculados/+N). Fim do arco-íris.
- **Minigráfico de tendência de visitas** (sparkline SVG 56×16 ao lado do nº): chamada de visitas trocada para `items/{id}/visits/time_window?last=30&unit=day` — total + série diária na MESMA chamada (custo idêntico ao total puro). Família = soma das séries. ⚠️ time_window não validado com token real (o date_from/date_to foi).
- **Conversão** reescrita como "conv. X%" e mock com taxas variadas 2%–14% (taxa única em tudo parecia bug).
- Whitelist do serve.js: + `orders/search` (GET read-only, vendas 30d).

### 5ª leva (04/07) — filtro "Frete grátis abaixo de R$ 79" ✅
Pedido do Lucas (problema recorrente de usuários): abaixo de R$ 79 o frete grátis não é obrigatório e sai do bolso do vendedor (margem quase negativa). Implementado com dados que já vêm no multiget (`price` + `shipping.free_shipping` — custo zero): **sinal laranja** "Frete grátis abaixo de R$ 79" por linha (com dica) + **quick-filter client-side** 🚚 ao lado do "Com desconto" (faixa persistente, pager honesto, URL `frete79=1`, combina com desconto). Piso configurável em `PROBLEM_RULES.freeShippingFloor` (se o ML mudar, texto acompanha).

### Design review APLICADO (04/07 — Lucas: "pode mandar bala em tudo") ✅
As 14 correções (P1–P14) do relatório foram aplicadas e validadas: severidade antes das pills (que viraram ghost), top-align nas células, sparkline honesto (baseline + ponto de tendência ±10% últimas 7d vs anteriores + slate + oculto no mobile), CTA sólido, fim do truncamento (th-sinais 360/badges sem teto/título 300), colapso de sinais no mobile (2+"+N"), toque restrito a botão/foto/título no card, ◆CATÁLOGO ghost, emojis→SVG flat, "conv."→"conversão", alvos 38px, ID discreto no card, "≈ 1 ano+" suprimido (mostra só ≤365d), tabular-nums nas sublinhas, fade no carrossel de chips. Checks: sem overflow (1288/1288), 0 badges cortados, 0 erros console, toque em número não navega / botão navega.

### Design review do time (04/07, Opus 4.8) — nota 7/10
Workflow `design-review-ad-selector` (3 lentes concluídas: UI visual, mobile-first, dataviz — a lente UX-fluxos falhou no output estruturado; nota 7/7/7). Veredito: **estrutura pronta pro port, falta polimento de hierarquia** — 14 problemas priorizados em `RELATORIO-DESIGN-REVIEW.md` (P1 pills azuis vencem a severidade; P4 CTA fantasma; P5 truncamento de rótulos; P6 mobile sem colapso de sinais; P3 sparkline sem baseline/escala local). Top 5 acionáveis quase todos CSS/ordem de emissão. Recomendação: aplicar a leva ANTES do port. Guardrail: P12 (suprimir "≈ 1 ano+") só com regra real, sem threshold inventado.

### Layout responsivo definitivo + guarda de regressão (04/07, 3 rounds de "cortado/vazando") ✅
Histórico: sinais sumiam sob o botão sticky por 3 caminhos diferentes — (1) janela < 1366 (tabela rolava e o sticky cobria), (2) expansão de família/vinculados alargava a tabela (botão "Analisar variação →" +53px; título/badges de sub-linha sem teto), (3) bandas cegas 1320–1341 e ≤1080 (tier de larguras fixas não encolhia).
Solução final: **coluna do botão estável** (todos os botões = "Analisar →" + tooltips), **Sinais com largura fixa no desktop cheio** (330px, casada com th) e **tier 721–1345px com larguras FLUIDAS por clamp(vw)** — Título/Sinais encolhem com a JANELA, não com o conteúdo (⇒ expansão nunca muda a largura da tabela); folga ~20px pra scrollbar clássica; piso ~920px (abaixo: scroll + sombra no botão sticky como pista); `.row-id` com flex-wrap; badge estreito quebra texto por dentro; card mobile "Vinculado" nas regras de card.
**Guarda: `window.mfLayoutCheck()`** embutido no protótipo (PROTOTYPE-ONLY) — acusa tabela>host, elemento fora da própria célula e scroll horizontal mobile. **Regra: rodar após QUALQUER mudança de CSS/render, com famílias E vinculados expandidos, em 1366/1100/1000/390.** Matriz validada 04/07: 920–1440 (fechado×expandido) + 390 = zero problemas. No port ao Bubble, replicar o check (ou portar a função) na F4.

### Validações NOVAS pendentes pra F4 (além das anteriores)
- `item_relations` no multiget com token real (anúncios vinculados).
- Escopo de leitura de `orders/search` no token real (conversão + previsão 30d).
- `items/{id}/visits/time_window?last=30&unit=day` com token real (sparkline; fallback trivial = voltar pro endpoint de total).

## 7. Decisões registradas
- Pré-filtro default = Ativos + chips destacados (não "só problemas").
- Badges = "sinais", não score (score completo continua sendo a análise profunda).
- Título curto nunca sinalizado se o anúncio tem vendas (regra do app).
- Painel é ADITIVO — nada do fluxo atual de análise é removido.
- Catálogo é MARCADOR dedicado junto do título, não badge de sinal (04/07).
- Exportação é sempre "todos da lista atual" — nunca "só a página" (04/07).
- Taxas (conversão/previsão 30d) só aparecem com dados de janelas reais e completas — parcial não vira número na tela (04/07).
