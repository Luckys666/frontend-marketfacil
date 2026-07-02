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

// Conta com cardápio de tags + status previsível pra teste de varredura ponta-a-ponta.
// O scan do ML devolve IDs de TODOS os status; o scanner recorta só os ATIVOS (decisão Lucas 02/07).
// Aqui há 4 ativos (2 com problema, 2 sem) + 1 pausado (deve ser DESCARTADO na varredura).
const scanAccount = [
  {
    id: 'MLB2000000001',
    title: 'Anúncio com Ficha Incompleta',
    price: 49.9,
    permalink: 'https://produto.mercadolivre.com.br/MLB-2000000001',
    thumbnail: 'https://http2.mlstatic.com/D_a.webp',
    status: 'active',
    tags: ['incomplete_technical_specs', 'free_shipping']
  },
  {
    id: 'MLB2000000002',
    title: 'Anúncio Saudável',
    price: 120,
    permalink: 'https://produto.mercadolivre.com.br/MLB-2000000002',
    thumbnail: 'https://http2.mlstatic.com/D_b.webp',
    status: 'active',
    tags: ['good_quality_picture', 'brand_verified']
  },
  {
    id: 'MLB2000000003',
    title: 'Anúncio de Catálogo',
    price: 999,
    permalink: 'https://produto.mercadolivre.com.br/MLB-2000000003',
    status: 'active',
    thumbnail: 'https://http2.mlstatic.com/D_c.webp',
    tags: ['catalog_listing']
  },
  {
    // PAUSADO com problema: precisa ser IGNORADO na varredura (você tirou do ar de propósito).
    id: 'MLB2000000004',
    title: 'Anúncio Pausado com Foto Ruim',
    price: 75,
    permalink: 'https://produto.mercadolivre.com.br/MLB-2000000004',
    thumbnail: 'https://http2.mlstatic.com/D_d.webp',
    status: 'paused',
    tags: ['poor_quality_picture']
  },
  {
    // ATIVO penalizado: entra no foco (é problema em anúncio no ar).
    id: 'MLB2000000005',
    title: 'Anúncio Ativo Penalizado',
    price: 250,
    permalink: 'https://produto.mercadolivre.com.br/MLB-2000000005',
    thumbnail: 'https://http2.mlstatic.com/D_e.webp',
    status: 'active',
    tags: ['moderation_penalty']
  }
];

module.exports = {
  curated: curated,
  byCase: byCase,
  emptyAccount: emptyAccount,
  scanAccount: scanAccount,
  makeLargeAccount: makeLargeAccount
};
