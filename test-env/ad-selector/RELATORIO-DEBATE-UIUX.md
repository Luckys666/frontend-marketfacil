# Relatório Final — Debate de UI/UX do Painel Seletor de Anúncios

**Produto:** Painel Seletor de Anúncios (Marketfacil) — tela de triagem que antecede a Análise de Anúncios
**Protótipo:** `C:\Users\Lucas Sertori\Documents\frontend-marketfacil\test-env\ad-selector\index.html` (arquivo único, CSS+JS inline)
**Ambientes de teste:** `http://127.0.0.1:3477/` (dados reais, 13 ativos / 4 produtos) e `http://127.0.0.1:3477/?mock=1` (65+ itens, todos os cenários)
**Data do relatório:** 03/07/2026
**Personas do debate:** vendedora-iniciante, vendedor-profissional, ux-designer, copywriter

---

## 1. Resumo executivo

**Consenso formal: NÃO alcançado.** Ao fim da rodada 4, as quatro personas mantiveram veredito "revisar" — nenhuma aprovação. Porém, a leitura do moderador é de **convergência clara em andamento**: as notas subiram de forma consistente a cada rodada, os blockers caíram de 9 para 8 entre as rodadas 3 e 4, e 100% das mudanças planejadas nas duas rodadas desta sessão foram aplicadas e verificadas (check técnico OK, servidor vivo, `serve.js` intocado).

### Evolução das notas

| Rodada | Nota média | Vereditos | Blockers | Mudanças aplicadas |
|---|---|---|---|---|
| 1–2 (sessão anterior) | 6,5–7 → 7–8,5 | revisar | — | 20 |
| 3 | 7,6 | 4× revisar (7,5 / 7,5 / 7,5 / 8) | 9 | 10 |
| 4 | **8,0** | 4× revisar (8 / 8 / 8 / 8) | 8 | 10 |

**Total acumulado: 40 mudanças aplicadas em 4 rodadas.** Na rodada 4 as quatro personas convergiram na mesma nota (8,0) — o desacordo restante não é sobre direção, e sim sobre itens de cauda: acessibilidade (pacote deliberadamente adiado para o port), validações que dependem de token real da API do Mercado Livre e polimentos de densidade/desktop. Nenhum blocker remanescente contesta decisões de produto já tomadas.

**Recomendação do moderador:** encerrar o ciclo de debate no protótipo. O retorno marginal por rodada está caindo (Δ nota: rodada 3→4 = +0,4) e os itens restantes ou pertencem ao port ao Bubble ou dependem de validação externa. Prosseguir para a Fase 4 (port ao Bubble) levando a lista da seção 5.

---

## 2. Principais mudanças aplicadas nas rodadas 3–4

### Rodada 3 (10 mudanças — foco: mobile-first, honestidade da UI e coerência dos sinais)

1. **Mobile: 1º anúncio na primeira dobra** — controles secundários colapsam em "Filtrar e ordenar ▾", priorizando o conteúdo que o vendedor veio ver.
2. **Linha-família não agrupa sob recorte ativo** (chip, busca ou "Com desconto") — evita esconder o anúncio que casou com o filtro dentro de um grupo.
3. **Título da linha-família = prefixo comum das variações** — some o "— Tam M" enganoso ao lado de números somados da família.
4. **Busca por nome: gate de validação do `q=`** + UI resiliente no modo SKU (não promete o que a API pode não entregar).
5. **Mobile: barra da análise quebra em 2 linhas** — título legível em vez de coluna espremida de 126px.
6. **Coluna Sinais coerente:** "Ainda sem vendas" + informativos sempre dentro do "+N sinais" (desktop), e "+N" com aparência de ação clicável.
7. **Exportar honesto:** botão "Baixar planilha desta página" + banner sem instrução impossível.
8. **"Com desconto" ativo:** faixa persistente acima da lista + pager consistente com a tabela.
9. **"⟳ Atualizar" honesto:** skeleton nos chips, botão desabilitado durante a recarga e tabela recarregada de fato.
10. **Pacote de microcopy, contraste e tooltips** (8 itens pequenos).

### Rodada 4 (10 mudanças — foco: precisão das mensagens, iOS e exportação completa)

1. **"Variação sem estoque"** na linha-família quando o estoque somado é > 0 (antes dizia "Sem estoque" e mentia).
2. **Sair de um chip devolve o status anterior**; Esc deixa de apagar a triagem em andamento.
3. **"Tudo certo!" nunca aparece quando o resumo falhou** — fim do falso positivo mais perigoso da tela.
4. **iOS: fim do zoom automático** na busca e nos selects (+ caret redundante removido no mobile).
5. **Barra de análise sempre identifica o anúncio** (link/ID visível e colável no celular).
6. **"Baixar todos os anúncios" num arquivo só** + aviso quando a página está vazia.
7. **"Vendas (total)" em toda parte** + planilha com cabeçalhos pt-BR e 3 colunas novas (custo de API zero).
8. **Pacote de copy honesta:** pager explica o agrupamento por família, desconto ganha substantivo e escopo, "mais recentes" vira "atualizados recentemente".
9. **"Fechar filtros ▴"** — o botão de filtros mostra quando está aberto.
10. **Dicas de "o que fazer" nos sinais graves** — hover no desktop, toque no mobile (sem thresholds inventados; critérios do próprio ML).

Ambas as rodadas: `index.html` e `README.md` editados; `serve.js` intocado; verificação técnica OK (`node --check` no script extraído, HTTP 200 no mock).

---

## 3. Divergências e como foram resolvidas

| Divergência | Personas envolvidas | Resolução |
|---|---|---|
| **Badge verde "Sem problemas" convivendo com sinais informativos** (contradição visual) | ux-designer × vendedora-iniciante | Decidido pelo público majoritário: o verde tranquiliza a iniciante; removê-lo faria linhas com apenas "Sem frete grátis" lerem como problema. A contradição foi resolvida por outro caminho — "Ainda sem vendas" + informativos colapsados no "+N sinais" (rodada 3, mudança 6). O blocker foi **atendido**, não descartado. |
| **"Clique" vs "toque" na copy** | copywriter × realidade mobile-first | Resolvido a favor de "toque ou clique" / verbo neutro, porque a maioria do público usa celular. Textos consolidados no pacote de microcopy da rodada 3. |
| **Rótulo "PRODUTO" / badge "ver N variações" na linha-família** | copywriter | Superado por solução melhor: o prefixo comum no título (rodada 3, mudança 3) eliminou o "— Tam M" que causava a confusão original. Rótulo e ID da linha-família permanecem no item deliberadamente adiado pelo moderador. |
| **Teto de 2 badges na linha-família** (densidade × informação) | vendedor-profissional × demais | Adiado com critério: cortar sinal visível para ganhar densidade só se a densidade real continuar ruim **após** as mudanças da rodada 4. Observar antes de esconder informação. |
| **Filtro por categoria** | vendedor-profissional | O dado do `available_filters` chega de graça, mas o parâmetro `category=` na busca não foi validado com token real — mesma classe de risco do `q=`. Adiado para validar junto com a busca; entra com implementação pronta quando validado. |
| **Detecção heurística de busca ignorada** (comparar totais com/sem `q=`) | derivada do blocker de busca | Rejeitada por falso positivo provável em conta pequena (termo genérico devolve o mesmo total legitimamente). A validação com token real cobre o caso; o restante do blocker virou o gate de validação da rodada 3. |

Padrão de resolução adotado pelo moderador ao longo da sessão: **(a)** conflitos de percepção se decidem pelo público majoritário (pequeno vendedor, mobile); **(b)** conflitos técnicos se decidem por validação real antes de prometer na UI; **(c)** nada que viole as regras invioláveis ou reabra decisões de produto já tomadas.

---

## 4. O que foi descartado e por quê

### Rodada 3

- **Filtro por categoria** (profissional) — risco de parâmetro não validado com token real; adiado junto com a validação do `q=`.
- **"Baixar tudo (até 1.000)"** (profissional) — custo/complexidade desproporcional para o protótipo (rajada de ~20 buscas + multigets, barra de progresso, erros parciais). Candidata pós-port. *(Nota: a rodada 4 entregou versão viável de "baixar todos num arquivo só".)*
- **Heurística de `q=` ignorado** — falso positivo provável em conta pequena (ver seção 3).
- **Micro-rótulo visível "ver no ML" ao lado do ↗ no mobile** (iniciante) — ruído textual no card; os aria-labels entraram no pacote de microcopy e o restante da acessibilidade segue adiado de propósito.
- **Remover o badge verde com informativos presentes** (ux-designer) — resolvido por caminho alternativo (ver seção 3).
- **Clamp de 2 linhas / max-width no título desktop** (profissional + ux) — polish desktop de impacto menor para público majoritariamente mobile; cortado pelo teto de 10 mudanças. Fila da próxima fase.
- **Micro-rótulo "PRODUTO" na linha-família** (copywriter) — superado pela mudança do prefixo comum.
- **"Clique" puro nos textos** (copywriter) — resolvido como "toque ou clique".

### Rodada 4

- **Botão flutuante "↑ voltar ao topo" no mobile** (iniciante) — componente novo com custo/benefício menor que os 10 selecionados; registrado para fase futura.
- **Link "− fechar variações" no último subcard** (iniciante) — nicho (famílias com 8+ variações); reavaliar com uso real.
- **✓ em anúncios já analisados na sessão** (profissional) — melhoria válida de fluxo, mas exige novo estado de sessão + render extra; **candidata forte para a próxima fase**.
- **Teto de 2 badges na linha-família** (profissional) — observar densidade real antes de esconder informação.
- **⟳ Atualizar renovar visitas** (profissional) — coluna Visitas está atrás de flag e o cache de sessão é intencional; baixa gravidade.
- **Contraste do `--text-muted`** em `.price-orig`/`.section-label`/`.ab-id` (ux-designer) — válido, mas pertence ao pacote de acessibilidade adiado para o port; agendado junto para não fragmentar o pacote.
- **Explicação do limite de 1.000 no pager** (ux-designer) — só afeta contas >1.000 anúncios, minoria do público; fila junto com o pager numérico já adiado.
- **Preservar scrollLeft do carrossel de chips** (ux-designer) — incômodo real, mitigado pela faixa "Mostrando só:"; registrado para fase futura.
- **Coluna Visitas condicional a SHOW_VISITS** (ux-designer) — só se materializa no port com a flag desligada; item do port, não do protótipo.
- **Gestão de foco ao entrar/sair da análise** (ux-designer) — pertence ao pacote a11y adiado; mantido agrupado para coerência no port.

---

## 5. Recomendações remanescentes para o port ao Bubble

### 5.1 Pacote de acessibilidade (adiado deliberadamente — implementar agrupado no port)
- Navegação por teclado e leitor de tela nos controles de expansão (famílias, "+N sinais").
- Gestão de foco ao entrar/sair da análise (colapso + barra "← Voltar").
- `prefers-reduced-motion`.
- Contraste do `--text-muted` em `.price-orig`, `.section-label`, `.ab-id`.

### 5.2 Dependências do app real / API (validar antes de expor na UI)
- **Validar `q=` (busca por nome) e `category=` com token real** — o gate está pronto no protótipo; com a validação, a busca por nome e o filtro por categoria destravam juntos.
- Botão "Reconectar conta" no erro 401 (depende da rota real do app).
- Sort "Mais vendidos" (falta confirmar suporte na API).
- Coluna Visitas: garantir comportamento correto com `SHOW_VISITS` desligada no Bubble.
- Nota de sinais incompletos em contas com >300 itens por sinal.

### 5.3 Melhorias funcionais na fila (por prioridade sugerida)
1. **✓ em anúncios já analisados na sessão** — maior ganho de fluxo por esforço; candidata forte.
2. "Limpar filtros" inline no empty state.
3. Preservar scrollLeft do carrossel de chips ao voltar da análise.
4. Botão "↑ voltar ao topo" no mobile.
5. Pager com números/salto de página + explicação do limite de 1.000.
6. Clamp de 2 linhas no título (desktop).
7. Sticky do thead na faixa 721–1319px.
8. Definir qual ID exibir na linha-família (MLBU vs primeiro MLB).
9. "− fechar variações" no fim de famílias longas (reavaliar com uso real).
10. Teto de badges na linha-família (só se a densidade continuar ruim em uso real).

### 5.4 Invariantes a preservar no port (não regredir)
- `escapeHtml` em todo dado vindo da API; nenhuma chamada de rede nova por item.
- Copy 100% pt-BR sem jargão técnico; vocabulário do dia a dia do ML.
- Design system Proposta U (Light Trading): DM Sans/DM Mono, mono alinhado à direita em números/IDs, radius 10px/6px, zebra `#f8fafc`, hover `#e8f0ff`.
- Decisões já tomadas: agrupamento por família (clique analisa o MLBU), fluxo integrado com colapso + "← Voltar", badges como sinais (não score), Visitas atrás de flag, "Título curto" nunca em anúncio com vendas, sem thresholds inventados.
- Comportamentos conquistados no debate: "Tudo certo!" só com resumo bem-sucedido; família não agrupa sob recorte; "Variação sem estoque" quando estoque somado > 0; exportação e "⟳ Atualizar" honestos.

---

*Relatório gerado pelo moderador do debate multi-persona. Rodadas 1–2 em sessão anterior (20 mudanças); rodadas 3–4 nesta sessão (20 mudanças). Protótipo em test-env; `serve.js` intocado durante todo o ciclo.*
