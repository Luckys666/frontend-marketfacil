# Frontend Marketfacil

Este diretório contém os arquivos estáticos e componentes HTML utilizados na plataforma Marketfacil.

## Testando Componentes

🚫 **ATENÇÃO: O AD ANALYZER (E OUTRAS FERRAMENTAS COM BD) NÃO PODEM SER TESTADOS LOCALMENTE.** 🚫
Devido a dependências de banco de dados e APIs fechadas, **TODOS os testes devem ser realizados exclusivamente no ambiente Bubble:**
👉 https://app.marketfacil.com.br/version-test/analise-anuncio-v2

A pasta `test-env/` serve **apenas** para inspiração estrutural ou testes isolados de marcação (HTML/CSS) mockados, mas nunca para o fluxo de dados real.

### Fluxo de Trabalho (Deploy para Teste)
1. Edite o `analyzer.js`, `analyzer.css` ou o HTML fonte (`bubble-components/ad-analyzer.html`).
2. Se o HTML mudar, copie e cole o código no editor do Bubble.
3. Se o CSS ou JS mudar, faça o `git push` deste repositório para o GitHub e efetue o *Purge* da CDN jsDelivr para que o Bubble puxe a versão mais recente em `https://app.marketfacil.com.br/version-test/analise-anuncio-v2`.página para ver o resultado em tempo real.
5. Após validar as mudanças, você pode commitar e fazer o push para o GitHub. (Depois as mudanças refletirão na CDN).

---