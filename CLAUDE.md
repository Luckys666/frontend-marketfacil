# frontend-marketfacil

Repositório versionado do **código JS/HTML injetado no app Bubble MarketFácil**. O app real roda no Bubble — este repo é o dump/source-of-truth do que vai em cada HTML element.

## Contexto essencial

- **Stack:** Bubble (no-code) + JS/HTML custom em HTML elements
- **Deploy:** editar em `version=test`, testar em `/version-test/`, promover via Playwright no editor Bubble
- **Playwright:** usar MCP `playwright-app` (headed), **não** `playwright` (headless)
- **Profile persistente:** sessão Bubble em `_opensquad/_browser_profile/` — coordenar lock via `~/.claude/lib/browser-profile-coordinator.js` antes de abrir
- **200+ usuários ativos** — mobile é prioridade, zero tolerância a regressão

## Regras de código (JS em HTML element Bubble)

- **Guard de execução única** em todo script — evita re-inject
- **Estado em `window.*`** (nunca closures locais — re-inject mata)
- Containers DOM por ID estável
- Flag `isUpdatingVisits` pra lock de re-render
- `<script>` dentro de `innerHTML` **não executa** — setar `window.*` direto via JS
- `</script>` literal em comment de header Bubble quebra parser — evitar

## Segurança

- Tokens sempre no header `Authorization: Bearer <token>` — **nunca** query string
- Sanitizar XSS em tudo que vai pro DOM
- `console.log` limpo em produção (sem tokens, userIds, PII)
- Nunca commitar `.env`, credenciais, ou qualquer `*credentials*`/`*tokens*`/`*oauth*`

## Backend de dados

- Proxy Heroku em `heroku/mlb-proxy` — toda chamada ML passa por lá
- GPT endpoints **sem retry** (queima tokens). Retry só no scraper.
- Timeout Heroku = 30s → vira falso "CORS error" no browser

## ML API — limitações conhecidas

- Token MarketFácil **não tem write legacy**: `PUT /items/{id}` bloqueado (403)
- Para writes, usar API `user-products` (mapa completo em `docs/ML-API-SCOPES-MAP.md`)
- i18n multi-site em andamento: plano 5 fases em memória `project_ml_i18n`

## Features críticas (não quebrar)

- **Analyzer** (Análise de Anúncios): refactors são **SEMPRE aditivos**. Nunca remover seções. Spec canônica: `ANALYZER-SPEC.md`
- **Product Ads:** TACOS é métrica principal, comparar por quartis da categoria, NUNCA sugerir mudar título, copy amigável
- **Busca INPI:** encoding ISO-8859-1 (`encodeISO88591()`, `TextDecoder('iso-8859-1')`, imagens base64)

## Design system

- Padrão visual: "Proposta U" (Light Trading) — navy/off-white, chart card trading
- Loading spinner orbital reutilizável via `getLoadingHtml()`

## Como buscar código

- **Repo em disco (poucos arquivos):** usar `Grep` direto
- **Código vivo no Bubble:** abrir editor via Playwright (ver `feedback_bubble_tree` na memória)
- Repo está indexado no `codebase-memory-mcp` (559 nodes) — `search_code`/`query_graph` funcionam pra estrutura
