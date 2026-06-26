'use strict';
/*
 * Massa de teste de anúncios Mercado Livre para a feature "Auditoria de Tags".
 * Fonte curada em ml-ads.json (casos nomeados por `_case`); aqui adicionamos
 * geradores programáticos (conta grande, conta vazia) e um simulador do Proxy.
 *
 * Campos que o scanner.js consome de cada anúncio: id, title, price, permalink,
 * thumbnail, tags[]. Também aceita os formatos "embrulhados" { body, description }
 * e { result } que o Proxy/ML retornam em alguns endpoints.
 */
const path = require('path');
const curated = require(path.join(__dirname, 'ml-ads.json'));

const byCase = {};
curated.forEach(function (it) { if (it._case) byCase[it._case] = it; });

// Conta vazia (sem nenhum anúncio).
const emptyAccount = [];

// Gera uma conta grande (>= n anúncios) com tags rotativas (problema + neutras).
// Usado pra exercitar paginação e agregação em escala (200+/500+ itens).
function makeLargeAccount(n) {
  const pools = [
    ['good_quality_picture', 'free_shipping', 'brand_verified'],   // limpo
    ['incomplete_technical_specs'],                                // problema
    ['poor_quality_picture', 'moderation_penalty'],                // problema (2)
    ['catalog_listing', 'user_product_listing'],                   // neutra
    []                                                             // sem tag
  ];
  const out = [];
  for (let i = 0; i < n; i++) {
    const tags = pools[i % pools.length].slice();
    out.push({
      id: 'MLB' + (700000000 + i),
      title: 'Produto de Teste ' + (i + 1) + ' — Ação Promoção Coração',
      price: Math.round((9.9 + i * 0.37) * 100) / 100,
      permalink: 'https://produto.mercadolivre.com.br/MLB-' + (700000000 + i) + '-produto',
      thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_' + i + '.webp',
      tags: tags
    });
  }
  return out;
}

// Conta com cardápio de tags previsível pra teste de varredura ponta-a-ponta.
const scanAccount = [
  {
    id: 'MLB2000000001',
    title: 'Anúncio com Ficha Incompleta',
    price: 49.9,
    permalink: 'https://produto.mercadolivre.com.br/MLB-2000000001',
    thumbnail: 'https://http2.mlstatic.com/D_a.webp',
    tags: ['incomplete_technical_specs', 'free_shipping']
  },
  {
    id: 'MLB2000000002',
    title: 'Anúncio Saudável',
    price: 120,
    permalink: 'https://produto.mercadolivre.com.br/MLB-2000000002',
    thumbnail: 'https://http2.mlstatic.com/D_b.webp',
    tags: ['good_quality_picture', 'brand_verified']
  },
  {
    id: 'MLB2000000003',
    title: 'Anúncio de Catálogo',
    price: 999,
    permalink: 'https://produto.mercadolivre.com.br/MLB-2000000003',
    thumbnail: 'https://http2.mlstatic.com/D_c.webp',
    tags: ['catalog_listing']
  }
];

module.exports = {
  curated: curated,
  byCase: byCase,
  emptyAccount: emptyAccount,
  scanAccount: scanAccount,
  makeLargeAccount: makeLargeAccount
};
