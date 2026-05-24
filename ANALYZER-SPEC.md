# Análise de Anúncios — Especificação Completa

> **REGRA DE OURO**: este documento lista TODAS as seções que a função "Análise de Anúncios" DEVE conter. Antes de qualquer refactor, consultar este arquivo. **Nunca remover nada daqui sem aprovação explícita do Lucas** — só adicionar.

## Onde fica
- **Página Bubble**: `analise-anuncio`
- **HTML Element**: `bTKMH` no editor Bubble
- **Source**: `frontend-marketfacil/js/analyzer.js` + `css/analyzer.css`
- **Build**: `node build-analyzer.js` → `build/analyzer-bubble.html`
- **Inject**: Playwright → text-entry → Ctrl+V

## Fluxos suportados (sempre 3)
1. **MLB** — anúncio comum: link ou ID como `MLB123`, `MLA456`, `MCO789`, etc
2. **MLBU** — produto de usuário: link `/up/MLBU...`
3. **Catálogo** — link `/p/MLB...` ou `/p/MCO...`

### i18n obrigatório
- Detecta site pelo prefixo do ID (MLB/MCO/MLA/MLM/MLC/MLU)
- Seta `window.MF_CURRENT_SITE` pra formatters (moeda/locale)
- Passa `site_id` em todas as rotas do proxy que aceitam

## Template (ordem das seções — NÃO REMOVER NENHUMA)

```
┌─────────────────────────────────────────────────────────────┐
│ ROW 1: [ Título + Imagem | Score Circle | O que Melhorar ] │
├─────────────────────────────────────────────────────────────┤
│ ROW 2: [ Checklist Rápido | Tendência Visitas | Reviews ]  │
├─────────────────────────────────────────────────────────────┤
│ ROW 3: Product Ads (métricas completas)                    │
├─────────────────────────────────────────────────────────────┤
│ ROW 3.5: Qualidade do Anúncio ML (API performance)         │
├─────────────────────────────────────────────────────────────┤
│ ROW 3.6: Experiência de Compra ML (API purchase_experience)│
├─────────────────────────────────────────────────────────────┤
│ ROW 4: Ficha Técnica (atributos string preenchidos)        │
├─────────────────────────────────────────────────────────────┤
│ ROW 4b: Campos da Categoria (gaps + editor de atributos)   │
├─────────────────────────────────────────────────────────────┤
│ ROW 5: Tags do Anúncio (good_quality, brand_verified, etc) │
└─────────────────────────────────────────────────────────────┘
```

Cada ROW tem seu container com id sufixado (`${containerIdSuffix}`) pra permitir múltiplas análises.

## Seções — conteúdo detalhado

### ROW 1 — Título | Score | O que Melhorar

#### `tituloTexto${suffix}` — exibirTitulo(detail.title, isMlbu, ...)
- Título do anúncio
- Thumbnail do produto
- ID do anúncio (MLB/MCO/etc)
- Link pro anúncio no ML
- Badge de tipo (anúncio / produto MLBU / catálogo)

#### `scoreCircle${suffix}` — exibirPontuacao(score, usedFallback, ..., analysisData, ..., performanceData)
- Círculo SVG com score numérico grande (heurístico MF)
- Badge "Classe S/A/B/C" abaixo baseado em pontuação:
  - 100 → "🏆 Classe S: Anúncio Impecável!"
  - ≥75 → "⭐ Classe A: Quase Perfeito!"
  - ≥50 → "📈 Classe B: Tem Potencial"
  - <50 → "⛏️ Classe C: Precisa de Trabalho"
- **Badge adicional ML** (quando performanceData disponível): mostra `ML 75% ⭐ Profissional` abaixo do badge Classe. **NÃO substitui**, só adiciona.
- Se `usedFallback=true`, mostrar "⚠ Estimativa"

#### `scoreChecklist${suffix}` — card "O que Melhorar"
Mostra TODOS os checks heurísticos do `analysisData` — nunca remover nenhum:
- **Título**: curto (<40 chars) / médio (40-50) / otimizado (≥50)
- **Descrição**: presente / ausente
- **Garantia**: informada / não informada
- **Tags negativas**: presentes / ausentes (usa TAGS_NEGATIVAS)
- **Ficha técnica**: X atributos preenchidos / poucos / vazia
- **Campos da categoria**: completos / X faltando (usa `categoryAttributes` + `window.ignoredAdAttributes`)
- **Tendência de visitas**: subindo / estáveis / queda / sem visitas (últimos 7 vs 7 anteriores de `visitsData`)
- **Reviews**: rating ≥4 / abaixo / sem avaliações

**Seção adicional "Ações Recomendadas pelo ML"** (quando performanceData disponível): lista as pendências da API ML Quality com deep links pro editor do ML. **É SEMPRE adicional, nunca substitui** os checks heurísticos.

### ROW 2 — Checklist | Visitas | Reviews

#### `quickChecklist${suffix}` — exibirChecklistRapido(detail, descriptionData, ..., performanceData)
3 checks sanity SEMPRE presentes:
1. **Descrição em texto**: detectada / não preenchida
2. **Garantia**: valor / não informada
3. **Imagens**: conta por variação (mínimo 3 cada) + total

**Seção adicional "Prioridades ML"** (quando performanceData disponível): top 3 pendências da API ML Quality com deep links. **Sempre adicional, nunca substitui** os 3 checks sanity.

#### `visitsTrend${suffix}` — exibirTendenciaVisitas(visitsData, ...)
- Mini gráfico de visitas (30 dias)
- Total 30d / 7d
- % de variação (último 7 vs anteriores 7)

#### `reviewsContainer${suffix}` — exibirAvaliacoes(reviewsData, ...)
- Nota média (estrelas)
- Total de avaliações
- Distribuição por estrela (barras)
- Últimos comentários

### ROW 3 — `adsMetrics${suffix}` — exibirAdsMetrics(adsData, ...)

Métricas completas de Product Ads da API `/advertising/{site}/product_ads/ads/{item_id}`:
- Status ativo/pausado
- Current level (brand/sov/etc)
- Spend, revenue, organic revenue
- ACOS, TACOS, ROAS, CTR, CVR, CPC
- Clicks, impressions, orders
- Gráfico daily de gasto vs receita
- Badge "sem Product Ads" quando não ativo
- **Degradação para países sem Product Ads** (MLC/MLU): mostrar mensagem clara

### ROW 3.5 — `performanceTexto${suffix}` — exibirPerformance(performanceData, ...)

Qualidade do anúncio via API ML `/item/{id}/performance`:
- Score grande (`75%`) + Nível atual (`Profissional`, `Básico`, etc)
- Badge "X pendentes" / "Tudo em dia"
- Badge "X problemas" (quando há WARNINGs)
- Grid de buckets (Dados do produto, Fotos, Condições, etc):
  - Nome do bucket + score do bucket
  - Lista de variáveis com status `○` PENDING ou `✓` COMPLETED
  - Regras pendentes com ícone 💡 (opportunity) ou ⚠️ (warning), deep link pro editor
- Fonte: API Mercado Livre
- Se anúncio não tem dados calculados: mostrar mensagem "Qualidade ainda não calculada"

### ROW 3.6 — `purchaseExperience${suffix}` — NOVO — exibirExperienciaCompra(purchaseData, ...)

Experiência de compra via API ML `/reputation/items/{id}/purchase_experience/integrators`:
- Título (ex: "Ainda não é possível medir sua experiência de compra")
- Subtítulos (contexto adicional)
- Reputação (color + value) quando disponível
- Ações recomendadas quando houver
- Distribuição de problemas por período (quando houver dados)
- Se não há vendas nos últimos 180 dias: mostrar mensagem informativa sem erro

### ROW 4 — `fichaTecnicaTexto${suffix}` — processarAtributos(attributes, title, ...)

Atributos string do detail (ficha técnica):
- Lista dos atributos preenchidos (id → value_name)
- Indicadores de qualidade (tamanho, repetição)
- Botão "Ignorar" por atributo (toggleIgnoreAttribute)
- Respeita `window.ignoredAdAttributes` e `ATRIBUTOS_IGNORADOS_COMPLETAMENTE`

### ROW 4b — `categoryAttributes${suffix}` — exibirAtributosCategoria(categoryAttributes, detail.attributes, ...)

Campos da categoria do ML (o que a categoria espera vs. o que o anúncio tem):
- Lista de atributos da categoria faltando
- Atributos preenchidos marcados
- Botão "Ignorar" por atributo
- **NOTA**: edição inline de atributos via `PUT /items/{id}` foi tentada e removida em 2026-04-14 porque o token OAuth do MarketFácil retorna `Unauthorized scopes` (401) — parece ser um caso de app "pós-migração URN" que não recebe mais o scope legacy `write`. Ver `docs/ML-API-SCOPES-MAP.md` pra detalhes do que é possível com os scopes atuais e teorias de solução.

### ROW 5 — `tagsTexto${suffix}` — verificarTags(tags, usedFallback, ...)

Tags do detail.tags:
- Pills coloridas por categoria:
  - Negativas (TAGS_NEGATIVAS): `poor_quality_picture`, `poor_quality_thumbnail`, `incomplete_technical_specs`, `moderation_penalty` → pill vermelha
  - Positivas (`good_quality_*`, `brand_verified`): pill verde
  - Neutras: pill cinza
- Tooltip com `tagSignificados[tag]` explicando cada uma
- Label traduzido via `tagSignificados` ou fallback com underscores removidos

## APIs usadas (via proxy Heroku)

| Rota do proxy | Endpoint ML | Usado em |
|---|---|---|
| `/api/fetch-item` | `/items/{id}` + `/items/{id}/description` | Dados principais |
| `/api/user-products/{id}` | `/user-products/{id}` | Fluxo MLBU |
| `/api/fetch-catalog` | `/products/{product_id}` | Fluxo Catálogo |
| `/api/catalog-items` | `/products/{product_id}/items` | Catálogo (items do seller) |
| `/api/attributes/{category_id}` | `/categories/{id}/attributes` | Campos da categoria |
| `/api/fetch-visits` | `/items/{id}/visits/time_window` | Tendência |
| `/api/fetch-reviews` | `/reviews/item/{id}` | Avaliações |
| `/api/ads-metrics` | `/advertising/{site}/product_ads/ads/{id}` | Product Ads |
| `/api/performance` | `/item/{id}/performance` | Qualidade do anúncio |
| `/api/purchase-experience` | `/reputation/items/{id}/purchase_experience/integrators` | Experiência de compra |
| `/api/users/me` | `/users/me` | seller_id pro fluxo catálogo |
| **TODO** `/api/item-update` | `PUT /items/{id}` | Edição de atributos |

Todas as rotas aceitam `site_id` como query param (default MLB). Quando o item é de outro país (ex: MCO), o proxy passa o site_id correto na chamada ao ML API.

## Paralelismo das chamadas

Durante a análise, o `Promise.allSettled` dispara em paralelo (após `fetch-item`):
```js
[
  fetchVisits(detail.id),
  fetchReviews(detail.id),
  fetchAdsMetrics(detail.id),
  fetchPerformanceData(detail.id),
  // NOVO: fetchPurchaseExperience(detail.id),
]
```

Todas com tratamento de erro (catch → null) pra não quebrar a análise se uma falhar. Cada seção renderiza "dados indisponíveis" quando a data correspondente é null.

## Sistema de pontuação (heurístico MF)

Ver `calcularPontuacaoQualidade(detail, descriptionData, usedFallback, categoryAttributes)`:
- Base: 100 pontos
- Título curto: -15 (<40) ou -8 (<50)
- Sem descrição: -10; com descrição: +3
- Sem garantia: -5
- Menos de 3 imagens: -5
- Campos da categoria faltando: -2 cada (max -20)
- Atributos (tamanho/repetição): max -25 total
- Tags negativas: -10 a -50
- Catálogo: título <80 -15, <150 -8, sem imagens -10, sem descrição -10, atributos vazios -2 cada (max -30)

## Segurança

- `escapeHtml()` em TUDO que vai pra innerHTML
- Console logs sem dumpar dados raw da API
- Tokens SEMPRE no header `Authorization: Bearer`, NUNCA na URL
- PUT /items/{id} pra edição: validar inputs, mostrar confirmação antes de salvar

## O que NUNCA pode sumir em refactor futuro

Checklist de não-remoção (pedido explícito do Lucas 2026-04-13):
- [ ] Score circle heurístico com classe S/A/B/C
- [ ] "O que Melhorar" com TODOS os checks heurísticos (título, descrição, garantia, tags negativas, atributos, categoria, visitas, reviews)
- [ ] "Checklist Rápido" com os 3 sanity checks (descrição, garantia, imagens)
- [ ] Gráfico de tendência de visitas
- [ ] Card de reviews (nota média, distribuição, comentários)
- [ ] Product Ads completo
- [ ] Ficha técnica com botão ignorar
- [ ] Campos da categoria com botão ignorar
- [ ] Tags do anúncio (pills coloridas good/bad/neutral)
- [ ] Diagnóstico (⚡ Qualidade do Anúncio — API ML performance)
- [ ] Experiência de compra (API ML purchase_experience)

Aditivos ML são SEMPRE extras — nunca substituem seções heurísticas.
