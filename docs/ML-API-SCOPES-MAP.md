# Mapeamento Scopes Atuais × Endpoints ML

> **Versão**: 2026-04-22 (final — conclusão empírica após migração de app)
> **Contexto**: análise das permissões reais do app MarketFácil no Mercado Livre. Dois apps comparados no mesmo user ML:
> - **App antigo** "Marketfacil Aplicativo" (`client_id 4542852165474092`) — em uso em produção, NÃO tem `write` legacy
> - **App novo** "Marketfacil v2" (`client_id 3367244116001781`) — criado em 2026-04-22, TEM `write` legacy e todos os URNs corretos
>
> **Conclusão**: os scopes globais (`write`, `urn:global:admin:*:/read-write`) são fixados no momento da criação do app. Editar permissões depois só atualiza URNs funcionais; não concede write retroativamente. A migração pro app novo é o único caminho pra destravar PUT /items em produção.
>
> **MCP do ML**: `https://mcp.mercadolibre.com/mcp` com tools `search_documentation` e `get_documentation_page` (só consulta, não muda API).

## Scopes do token — App antigo (4542852165474092) em produção

Retornados pela resposta `/oauth/token` do ML (confirmados empiricamente após correção das 4 permissões de "Leitura" → "Leitura e escrita" em 2026-04-22):

| Scope | Status |
|---|---|
| `offline_access` | ✅ |
| `read` | ✅ |
| `urn:global:admin:oauth:/read-only` | ✅ (só read-only) |
| `urn:ml:all:comunication:/read-write` | ✅ |
| `urn:ml:all:publish-sync:/read-write` | ✅ |
| `urn:ml:mktp:ads:/read-write` | ✅ |
| `urn:ml:mktp:comunication:/read-write` | ✅ |
| `urn:ml:mktp:invoices:/read-write` | ✅ |
| `urn:ml:mktp:metrics:/read-only` | ✅ (máximo disponível) |
| `urn:ml:mktp:offers:/read-write` | ✅ |
| `urn:ml:mktp:orders-shipments:/read-write` | ✅ |
| `urn:ml:mktp:publish-sync:/read-write` | ✅ |
| `urn:ml:vis:comunication:/read-write` | ✅ |
| `urn:ml:vis:publish-sync:/read-write` | ✅ |
| `write` (legacy) | ❌ **AUSENTE — não pode mais ser adicionado neste app** |
| `urn:global:admin:info:/read-only` + `:/read-write` | ❌ ausente |
| `urn:global:admin:oauth:/read-write` | ❌ ausente |
| `urn:global:admin:users:/read-only` + `:/read-write` | ❌ ausente |

## Scopes do token — App novo (3367244116001781)

App criado em 2026-04-22 com as mesmas permissões funcionais do app antigo. **Recebeu `write` legacy + todos os admin URNs**:

```
offline_access read write
urn:global:admin:info:/read-only
urn:global:admin:info:/read-write
urn:global:admin:oauth:/read-only
urn:global:admin:oauth:/read-write
urn:global:admin:users:/read-only
urn:global:admin:users:/read-write
urn:ml:all:comunication:/read-write
urn:ml:all:publish-sync:/read-write
urn:ml:mktp:ads:/read-write
urn:ml:mktp:comunication:/read-write
urn:ml:mktp:invoices:/read-write
urn:ml:mktp:metrics:/read-only
urn:ml:mktp:offers:/read-write
urn:ml:mktp:orders-shipments:/read-write
urn:ml:mktp:publish-sync:/read-write
```

Com este token, `PUT /items/{id}`, `PUT /items/{id}/description`, `DELETE /items/{id}/pictures/{id}`, `POST /items` passam a ser aceitos pelo sistema de scopes (podem ainda falhar por regra de negócio do ML, mas não mais por scope).

## Dois sistemas de erro paralelos (IMPORTANTE)

| Sistema | Endpoint usa | Erro quando falta |
|---|---|---|
| **Legacy OAuth2** (`read`/`write`/`offline_access`) | `PUT /items/{id}` e derivados | `{"error":"unauthorized_scopes","status":401}` |
| **Permissões Funcionais** (`urn:ml:*`) | `/user-products/*`, `/reputation/*`, `/advertising/*`, endpoints novos | `{"code":"PA_UNAUTHORIZED_RESULT_FROM_POLICIES","status":403}` |

## ✅ O que FUNCIONA (testado de verdade)

### Pictures — adicionar (mas não remover nem reordenar)
```bash
# 1. Upload da imagem
POST /pictures?site_id=MLB
Body: {"source":"https://url-da-imagem.jpg"}
→ 200 OK, retorna {"id":"XXXXX-MLB...","variations":[...]}

# 2. Anexar a um item existente
POST /items/{ITEM_ID}/pictures
Body: {"id":"XXXXX-MLB..."}
→ 200 OK, item agora tem +1 foto
```
**Teste real**: adicionei a foto `833291-MLB109821735150_042026` no MLB2177029808 (1 foto → 2 fotos). Confirmado no DB do ML.

### Estoque (user-products)
```bash
PUT /user-products/{UP_ID}/stock
PUT /user-products/{UP_ID}/stock/type/{type}  # seller_warehouse, selling_address
```
Já usado em produção no multi-estoque do MarketFácil.

### Variações (scope aceito — dados precisam estar certos)
```bash
POST /items/{ITEM_ID}/variations
→ 400 se dados ruins, scope não é barreira
```

### Orders / Feedback
```bash
POST /orders/{ORDER_ID}/feedback
→ 400 "purchase_id" se ID errado, scope aceito
```

### Upload imagens genérico
```bash
POST /pictures
POST /pictures/items  # com referrer_id do app
```

## ❌ O que NÃO funciona — 401 Unauthorized scopes

Todos estes foram testados e retornam `{"error":"unauthorized_scopes","status":401}`. **Precisa de `write` legacy que o nosso token não tem**:

### Atualizar campos do item
```
PUT /items/{id}         → bloqueado pra title, price, attributes, pictures, description, available_quantity, status, video_id, category_id, listing_type_id
PUT /items/{id}?api_version=2  → também bloqueado (api_version não troca o sistema de permissão)
```

### Descrição dedicada
```
POST /items/{id}/description          → 401
PUT  /items/{id}/description          → 401
PUT  /items/{id}/description?api_version=2  → 401
```

### Listing type (destacar/mudar tipo)
```
POST /items/{id}/listing_type  → 401 (doc oficial diz que esse é o endpoint)
```

### Deletar/remover
```
DELETE /items/{id}/pictures/{pic_id}  → 401 (asymmetry: POST add funciona, DELETE bloqueia)
PUT    /items/{id} body:{"deleted":true}  → 401 (única forma documentada de excluir)
POST   /items/{id}/pictures/reorder   → 401
```

### Criação / novo item
```
POST /items  → 401 (criar anúncio novo totalmente)
```

### Variação de item já criado
```
PUT /items/{id}/variations/{var_id}  → 401
```

## ⚠️ Bloqueado por URN (não é write legacy)

```
POST /answers  → 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES (comunication é read-only)
```

## ➕ Descoberta: ASSIMETRIA POST vs DELETE em pictures

**Característica bizarra mas empírica**:
- `POST /items/{id}/pictures` body `{"id":"pic_id"}` → ✅ scope OK, adiciona picture
- `DELETE /items/{id}/pictures/{pic_id}` → ❌ 401 unauthorized_scopes
- `POST /items/{id}/pictures/remove|delete` → ❌ 401

Ou seja: **a gente pode ADICIONAR fotos mas não pode REMOVER** pelas mesmas credenciais. ML trata essas duas operações com scopes diferentes. Isso permite uma feature limitada de "upload assistido" no app, mas remoção tem que ser manual no editor ML.

## O que ISSO significa pro MarketFácil na prática

### Features **possíveis** de implementar agora:

1. **📸 "Adicionar imagem a um anúncio"** — fluxo: user faz upload → `POST /pictures` → recebe ID → `POST /items/{id}/pictures` com ID → pronto. **Funciona!**
2. **📦 Edição de estoque inline** — já existe no multi-estoque
3. **⭐ Feedback de pedidos** — pode automatizar pós-venda
4. **📊 Leitura completa** — qualidade, purchase_experience, performance, ads metrics, visitas, reviews, tendências, etc
5. **🔗 Deep links pro editor ML** — pra qualquer edição que exija write legacy (já usado nas regras da API Quality). User clica, edita na UI nativa do ML.

### Features **impossíveis** sem resolver o write legacy:
- Editar título de anúncio ativo
- Editar descrição
- Editar atributos (ficha técnica) via API
- Editar preço
- Remover/reordenar fotos
- Pausar/ativar anúncio
- Criar anúncio novo via API
- Excluir anúncio
- Gerenciar campanhas de ads, promoções, responder perguntas (outros URN scopes também são read-only)

### Recomendação pros próximos passos

1. **Migrar pro app novo `Marketfacil v2` (3367244116001781)** — única forma de destravar `PUT /items` em produção. Requer trocar client_id/secret no Bubble + Heroku e reconectar os usuários ativos.
2. **Implementar "Adicionar foto"** no analyzer — funciona com token atual do app antigo também, não depende de write.
3. **Adicionar "Feedback de venda automatizado"** — pode ser UX diferencial, funciona no app antigo.

## Teoria final sobre o bloqueio (confirmada empiricamente)

### ✅ Teoria vencedora — "Scopes globais fixados na criação do app"
No momento em que o app é criado, o ML decide quais scopes globais (`write`, `urn:global:admin:*:/read-write`) serão concedidos — e isso é **imutável** depois. Editar as permissões funcionais no DevCenter afeta apenas os URNs funcionais (`urn:ml:mktp:*`, `urn:ml:all:*`). Nem revogar autorização + reconectar destrava `write` se ele não foi concedido na criação.

**Evidência**:
- App antigo (4542852165474092) e app novo (3367244116001781) têm **config idêntica** hoje (verificada lado-a-lado no DevCenter em 2026-04-22)
- Consent screen do app novo lista "Write - Scope Oauth"; do app antigo, não
- Token do app novo vem com `write` + admin URNs; do app antigo, não
- Mudar de 4 permissões "Leitura" → "Leitura e escrita" no app antigo atualizou os URNs funcionais mas NÃO adicionou `write`

### ❌ Teoria A — "App pós-migração URN" (descartada)
Inicialmente suspeitei que apps criados depois de alguma migração do ML não recebiam mais `write`. **Descartada**: o app novo foi criado em 2026-04-22 (mesmo dia dos testes) e recebeu `write`. Logo, não é questão temporal/migração.

### ❌ Teoria B — Certificação (descartada)
Lucas confirmou que outros apps NÃO-certificados funcionam. Descartada.

### ❌ Teoria C — VIS como business unit bloqueando write (descartada)
Hipótese de que marcar VIS junto com ML suprimia `write`. **Descartada** após comparar: app antigo tem VIS marcado, app novo não — mas a ausência de write no app antigo persiste mesmo após mudanças em outros campos.

## Como testar as teorias

```bash
# Confirmar que PUT /items tá bloqueado (token atual)
curl -X PUT "https://api.mercadolibre.com/items/MLB2177029808" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"available_quantity":5}'
# → 401 unauthorized_scopes

# Testar que POST pictures funciona
PIC=$(curl -s -X POST "https://api.mercadolibre.com/pictures?site_id=MLB" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"https://http.cat/200.jpg"}' | jq -r .id)

curl -X POST "https://api.mercadolibre.com/items/MLB2177029808/pictures" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\":\"$PIC\"}"
# → 200 OK, item agora tem +1 foto
```

## Referências

- **Docs de permissões funcionais**: https://developers.mercadolivre.com.br/pt_br/permissoes-funcionais
- **Docs de autenticação**: https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
- **Docs de atualização de publicações**: https://developers.mercadolivre.com.br/pt_br/atualiza-tuas-publicacoes
- **Docs de atributos**: https://developers.mercadolivre.com.br/pt_br/atributos
- **Docs de imagens**: https://developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens
- **Docs de descrição**: https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos
- **Docs de user-products**: https://developers.mercadolivre.com.br/pt_br/user-products
- **Docs MCP Server ML**: https://developers.mercadolivre.com.br/pt_br/server-mcp
- **DevCenter do app antigo** (em produção, sem write): https://developers.mercadolivre.com.br/devcenter/edit-app/4542852165474092
- **DevCenter do app novo** (Marketfacil v2, com write): https://developers.mercadolivre.com.br/devcenter/edit-app/3367244116001781
