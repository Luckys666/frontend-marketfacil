# Regras de Negócio — Product Ads (Mercado Livre)

Este documento define as regras de negócio que orientam o **Planejador de Ads** do MarketFácil. Toda lógica de alertas, sugestões e indicadores deve seguir estas regras.

---

## 1. Métricas Fundamentais

### ROAS (Return on Ad Spend)
- **Definição:** Faturamento via Ads ÷ Custo dos Ads
- **Interpretação:**
  - `ROAS > 1` → Lucro com ads (você fatura mais do que gasta)
  - `ROAS < 1` → Prejuízo com ads (gasta mais do que fatura)
  - `ROAS = 0` → Sem vendas geradas por ads
- **Não há valor "ideal" universal** — depende da margem de cada vendedor

### ACOS (Advertising Cost of Sale)
- **Definição:** Custo dos Ads ÷ Faturamento via Ads × 100
- **Relação com ROAS:** `ACOS = 100 / ROAS`
- **Interpretação:** Quanto menor, melhor (menos gasto por venda gerada)
- **Não há valor "bom/ruim" universal** — depende da margem

### TACOS (Total Advertising Cost of Sale) — **Métrica Principal**
- **Definição:** Custo dos Ads ÷ Faturamento TOTAL (ads + orgânico) × 100
- **Por que é a mais importante:** É o que **realmente consome a margem** do vendedor
- **Interpretação:** O percentual do faturamento total que vai para publicidade
- **Meta:** Deve ser definida pelo usuário com base na margem de lucro
- **Regra:** Meta de TACOS = configuração global que afeta toda a análise

### CTR (Click-Through Rate)
- **Definição:** Cliques ÷ Impressões × 100
- **Não tem valor absoluto "bom"** — varia muito por categoria
- **Comparação válida:** Apenas relativa (item vs média da própria conta)

### Conversão (CVR)
- **Definição:** Vendas ÷ Cliques × 100
- **Não tem valor absoluto "bom"** — varia muito por categoria
- **Comparação válida:** Apenas relativa (item vs média da própria conta)

---

## 2. Regras Críticas

### 2.1. NUNCA sugerir alterar título de anúncio
- **Por quê:** Alterar título destrói a relevância acumulada do anúncio no algoritmo do ML
- **Substituir por:** "Revise características e fotos" / "Otimize ficha técnica"
- **Aplicação:** Toda recomendação de melhoria de CTR/conversão deve mencionar foto, características, preço e descrição — **nunca título**

### 2.2. ROAS abaixo de 1x = Prejuízo (objetivo)
- Único alerta de "ruim" sem depender de meta do usuário
- Aplicar tanto no nível geral quanto por anúncio

### 2.3. Comparações relativas, não absolutas
- CTR, CVR, ACOS, TACOS, ROAS de cada item devem ser comparados com a **mediana ou quartis da própria conta**
- Nunca usar thresholds fixos universais (ex: "CTR < 1% é ruim")
- Usar quartis (Q1/Q2/Q3) para distribuir cores de forma equilibrada

---

## 3. Critérios de Escala

### Anúncio Elegível para Escala
Um anúncio é elegível para escalar (aumentar investimento) quando atende **TODAS** as condições:
1. **ROAS acima da meta** da campanha (`item._roas > camp.roas_target`)
2. **Gastou pelo menos 50% do preço do produto** em ads (`item.cost >= item._price * 0.5`)
3. **Tem vendas registradas** (`item.orders > 0`)

### Próximo da Escala
- ROAS acima da meta da campanha
- Mas ainda não gastou 50% do preço do produto
- Recomendação: continuar acompanhando

### Próximo da Meta (Aceitável)
- Até **10% abaixo da meta** de ROAS
- Está chegando lá, não é ruim
- Cor: azul claro

### Abaixo da Meta
- Mais de 10% abaixo da meta de ROAS
- Precisa otimizar antes de aumentar investimento

---

## 4. Tipos de Alertas

### Objetivos (independem de meta)
- **ROAS < 1** → Prejuízo
- **Gasto > R$50 sem vendas** → Pause e otimize
- **Gasto > 50% do preço sem venda** → Urgente (revisar)

### Relativos à conta (mediana/quartis)
- CTR muito abaixo da média da conta
- Conversão muito abaixo da média da conta
- ACOS muito acima da média da conta

### Relativos à meta do usuário
- TACOS dentro/próximo/acima/muito acima da meta
- ROAS de campanha vs `roas_target`

### Tendências (período atual vs anterior)
- **Impressões em queda > 30%** → Investigar orçamento ou competitividade
- **Tráfego sem conversão** → Cliques subindo + conversão caindo
- **Escala ineficiente** → Investimento sobe mais que vendas
- **Canibalização de orgânico** → Cliques ads sobem + vendas orgânicas caem
- **Dependência de ads crescente** → % vendas orgânicas diminui

### Por dependência
- **Dependência > 60% do faturamento via ads** → Alerta amarelo
- **Dependência > 80%** → Alerta vermelho

---

## 5. Eficiência de Escala

### Princípio
A relação entre crescimento de investimento e crescimento de vendas mostra se a escala é saudável.

### Cenários
| Investimento | Vendas | Diagnóstico |
|---|---|---|
| ↑ +X% | ↑ +Y% (Y > X) | **Escala eficiente** ✓ |
| ↑ +X% | ↑ +Y% (X > Y) | **Atenção na escala** ⚠ |
| ↑ +X% | ↓ ou estagnado | **Escala ineficiente** ✗ |
| ↓ −X% | ↑ +Y% | **Otimização eficiente** ✓ |
| ↓ −X% | ↓ −Y% (Y < X) | **Redução controlada** ⚠ |
| ↓ −X% | ↓ −Y% (Y > X) | **Queda desproporcional** ✗ |

---

## 6. Orçamento Ideal

### Definição
**O orçamento ideal NÃO é um percentual fixo do faturamento.** É o orçamento que permite ao anúncio competir sem ser limitado.

### Sinais de orçamento insuficiente
- Impressões caindo apesar do gasto alto
- Orçamento diário esgotando antes do fim do dia
- Gasto da campanha próximo (>90%) do budget definido

### Recomendação ao usuário
"Aumente o orçamento se as impressões estão caindo ou estagnando com gasto alto."

---

## 7. Estratégias de Campanha (ML)

### PROFITABILITY (Rentabilidade)
- Foco em ROAS alto
- Bom para produtos com margem apertada
- Meta sugerida: ROAS alvo da campanha

### VISIBILITY (Visibilidade)
- Foco em impressões e tráfego
- Bom para produtos novos ou marca
- Meta sugerida: ACOS alvo da campanha

---

## 8. Hierarquia de Recomendações

### Para anúncios com baixo desempenho
1. **NÃO alterar título** (perde relevância)
2. Revisar **foto principal** (fundo branco, produto centralizado)
3. Revisar **ficha técnica/atributos**
4. Revisar **preço competitivo**
5. Revisar **descrição**
6. Verificar **estoque e frete**
7. Como último recurso: pausar e refazer (criar novo anúncio)

### Para anúncios com bom desempenho
1. Verificar se está **elegível para escala** (gastou 50% do preço + ROAS > meta)
2. Aumentar **lance** ou reduzir **ROAS alvo** para ganhar mais entregas
3. Aumentar **orçamento diário** se estiver esgotando

---

## 9. Indicadores no Resumo Executivo

O resumo executivo deve seguir formato **checklist** com 4-6 itens:
1. **ROAS** — saudável vs prejuízo
2. **TACOS** — vs meta do usuário
3. **Dependência de Ads** — % das vendas
4. **Escala** — investimento vs vendas
5. (Opcional) **Tendências** — quando há mudança significativa

Cada item deve ter:
- **Ícone de status:** ✓ (good) / • (info) / ⚠ (warning) / ✗ (bad)
- **Label** em negrito
- **Texto curto** explicando o número

---

## 10. Métricas Agregadas vs Individuais

### Geral da Conta
- ROAS, ACOS, TACOS calculados sobre TOTAL (soma de todos os items)
- Tendências comparam períodos (1ª metade vs 2ª metade do período selecionado)

### Por Campanha
- Soma das métricas dos items dentro da campanha
- TACOS vs meta global do usuário (não da campanha — a campanha tem ROAS/ACOS target)
- Comparação ROAS da campanha vs `roas_target` da campanha

### Por Item
- Cores baseadas em **quartis da conta** (top 25% verde, bottom 25% vermelho)
- Sugestões baseadas em **comparação relativa** com a média da conta
- Elegibilidade para escala baseada em meta da campanha

---

## 11. Período de Análise

### Períodos disponíveis
- 7 dias, 15 dias, 30 dias (padrão), 60 dias, 90 dias

### Regras para tendências
- Comparação primeira metade vs segunda metade do período
- Mínimo de 6 dias de dados para calcular tendência
- Tendências < 1% são consideradas "neutras" (não exibidas)

---

## 12. Vocabulário (importante para UX)

### Sempre usar
- "Características e fotos" (não "título e fotos")
- "Otimizar listagem"
- "Revisar atributos"
- "Meta de TACOS" (não "TACOS ideal")
- "Acima/abaixo da média da conta" (não "alto/baixo")

### Nunca usar
- "Mude o título"
- "TACOS ideal é X%"
- "ACOS bom é abaixo de Y%"
- Thresholds absolutos universais

---

## 13. Endpoints do Mercado Livre Usados

### Listas e busca
- `GET /users/me` — dados do vendedor autenticado
- `GET /users/{seller_id}/items/search` — lista de itens (com paginação)
- `GET /advertising/advertisers?product_id=PADS` — advertiser_id

### Métricas de Ads
- `GET /advertising/MLB/product_ads/ads/{item_id}?date_from=&date_to=&metrics=...`
  - Header: `api-version: 2`
  - Métricas: clicks, prints, ctr, cost, cpc, acos, units_quantity, organic_units_quantity, total_amount, organic_units_amount, cvr, roas
- `GET /advertising/MLB/product_ads/ads/{item_id}?aggregation_type=DAILY` — métricas diárias

### Campanhas
- `GET /advertising/MLB/product_ads/campaigns/{campaign_id}` — info da campanha (name, strategy, acos_target, roas_target, budget, status)

### Visitas
- `GET /items/visits?ids=&date_from=&date_to=` — visitas em lote (max ~5 IDs por chamada)

---

## 14. Validação de Dados

### Quando exibir empty state
- Conta sem nenhum Product Ads ativo
- Período selecionado sem dados

### Quando exibir banner "Poucos dados"
- Custo total < R$1 E impressões < 100
- Mensagem: "Suas métricas ficarão mais precisas conforme acumular mais dados"

### Quando NÃO calcular tendência
- Menos de 6 dias de dados
- Períodos muito curtos (não confiáveis)

---

**Última atualização:** 2026-04-12
**Mantido por:** Equipe MarketFácil
