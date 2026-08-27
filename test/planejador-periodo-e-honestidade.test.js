'use strict';
/*
 * PLANEJADOR DE ADS — o período tem que chegar em TUDO, e falha não pode virar zero.
 *
 * Regressões cobertas (27/08/26):
 *
 *  1) O botão de período (7/15/30/60/90) mexia nos KPIs e no gráfico, mas as
 *     chamadas ao /ads-items iam SEM date_from/date_to — o proxy caía no default
 *     de 30 dias. A tabela "Anúncios Detalhados", o ranking, os alertas e os
 *     insights por campanha ficavam eternamente em 30 dias enquanto o cabeçalho
 *     dizia 7d ou 90d.
 *
 *  2) Chamada que falhou virava "Nenhum Product Ads Ativo" — numa conta com 25
 *     anúncios ativos (caso real 26/08/26). Falha é estado, não ausência.
 *
 *  3) Meta de TACOS comemorava "✓ Meta atingida!" com 0% numa conta que não
 *     gastou nada no período. Não se premia o que não aconteceu.
 */
const { carregar, overview } = require('./harness-ads-planner');

let pass = 0, fail = 0;
const check = (label, cond, detail) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' - ' + label + (detail && !cond ? ' [' + detail + ']' : '')); };

const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const param = (url, k) => (new URL(url).searchParams).get(k);

(async () => {
    // ── 1) o período chega no /ads-items ────────────────────────────────────
    for (const dias of [7, 15, 30, 60, 90]) {
        const h = carregar({ respostas: { '/api/ads-items': { items: [], paging: { ml_total: 0, returned: 0, exhausted: true } } } });
        h.S.window._currentDays = dias;
        await h.S.fetchAdsItemsPage('tok', { limit: 50, sort_by: 'cost', sort: 'desc' });

        const url = h.chamadas.find(u => u.includes('/api/ads-items'));
        const from = url && param(url, 'date_from');
        const to = url && param(url, 'date_to');
        check(`${dias}d: /ads-items recebe a janela`, !!from && !!to, `url=${url}`);
        check(`${dias}d: janela tem ${dias} dias`, from && to && diasEntre(from, to) === dias, `${from}..${to} = ${from && to ? diasEntre(from, to) : '?'}d`);
    }

    // janela explícita do chamador continua mandando (busca por data específica)
    {
        const h = carregar({ respostas: { '/api/ads-items': { items: [], paging: {} } } });
        h.S.window._currentDays = 90;
        await h.S.fetchAdsItemsPage('tok', { limit: 50, date_from: '2026-01-01', date_to: '2026-01-31' });
        const url = h.chamadas.find(u => u.includes('/api/ads-items'));
        check('janela explícita não é sobrescrita', param(url, 'date_from') === '2026-01-01' && param(url, 'date_to') === '2026-01-31', url);
    }

    // teto de 90 dias (o ML devolve 400 acima disso)
    {
        const h = carregar({ respostas: { '/api/ads-items': { items: [], paging: {} } } });
        const r = h.S.adpPeriodRange(365);
        check('janela nunca passa de 90 dias', diasEntre(r.from, r.to) === 90, `${r.from}..${r.to}`);
    }

    // ── 2) falha do ML nunca vira "você não tem ads" ────────────────────────
    {
        const h = carregar();
        h.S.renderDashboardOverview(overview({ fetch_failed: true, fetch_errors: [{ call: 'ads_daily', status: 500 }] }), 'adp-overview');
        const t = h.texto('adp-overview');
        check('falha: NÃO diz "Nenhum Product Ads Ativo"', !t.includes('Nenhum Product Ads Ativo'), t.slice(0, 120));
        check('falha: diz que não conseguiu buscar', /não consegui buscar/i.test(t), t.slice(0, 120));
        check('falha: oferece tentar de novo', /Tentar de novo/i.test(t), t.slice(0, 120));
    }
    {
        // conta com anúncios mas sem resumo: também é falha, não ausência
        const h = carregar();
        h.S.renderDashboardOverview(overview({ aggregated: null, total_items_with_ads: 25 }), 'adp-overview');
        const t = h.texto('adp-overview');
        check('sem resumo com 25 anúncios: não diz "Nenhum Product Ads Ativo"', !t.includes('Nenhum Product Ads Ativo'), t.slice(0, 120));
    }
    {
        // conta que REALMENTE não tem ads continua com o convite certo
        const h = carregar();
        h.S.renderDashboardOverview(overview({ aggregated: null, total_items_with_ads: 0 }), 'adp-overview');
        const t = h.texto('adp-overview');
        check('conta sem ads de verdade: mantém o convite pra ativar', t.includes('Nenhum Product Ads Ativo'), t.slice(0, 120));
    }
    {
        // falha lateral (lista de campanhas) NÃO pode esconder KPI que veio certo
        const h = carregar();
        const agg = { total_cost: 100, total_revenue: 5000, organic_revenue: 1000, total_clicks: 10, total_impressions: 900, total_orders: 3, organic_orders: 1, avg_acos: 2, avg_tacos: 1.67, overall_roas: 50, avg_ctr: 1.1, avg_cvr: 30, avg_cpc: 10, ads_sales_pct: 83 };
        h.S.renderDashboardOverview(overview({ aggregated: agg, fetch_failed: true, fetch_errors: [{ call: 'campaigns_list', status: 404 }] }), 'adp-overview');
        const t = h.texto('adp-overview');
        check('falha lateral não esconde os KPIs', !/não consegui buscar seus n/i.test(t) && t.length > 50, t.slice(0, 140));

        h.S.renderCampaignInsights(overview({ aggregated: agg, campaigns: [], fetch_failed: true, fetch_errors: [{ call: 'campaigns_list', status: 404 }] }), 'adp-campaigns');
        const c = h.texto('adp-campaigns');
        check('campanhas: falha aparece em vez de sumir', /não consegui buscar suas campanhas/i.test(c), c.slice(0, 140));

        h.S.renderCampaignInsights(overview({ aggregated: agg, campaigns: [] }), 'adp-campaigns2');
        check('campanhas: sem falha e sem campanha, seção some', h.texto('adp-campaigns2') === '', h.texto('adp-campaigns2').slice(0, 120));
    }
    {
        const h = carregar();
        h.S.renderCharts(overview({ daily_aggregated: [], fetch_failed: true, fetch_errors: [{ call: 'ads_daily', status: 500 }] }), 'adp-charts', {});
        const t = h.texto('adp-charts');
        check('gráfico: falha não vira "dados insuficientes"', !/insuficientes/i.test(t), t.slice(0, 120));
        check('gráfico: diz que o ML não devolveu', /não devolveu/i.test(t), t.slice(0, 120));
    }
    {
        const h = carregar();
        h.S.renderCharts(overview({ daily_aggregated: [{ date: '2026-08-27', cost: 0 }] }), 'adp-charts', {});
        check('gráfico: sem falha, mantém "dados insuficientes"', /insuficientes/i.test(h.texto('adp-charts')), h.texto('adp-charts').slice(0, 120));
    }

    // ── 3) meta de TACOS não comemora sem gasto ─────────────────────────────
    const aggZerado = { total_cost: 0, total_revenue: 0, organic_revenue: 0, total_clicks: 0, total_impressions: 0, total_orders: 0, organic_orders: 0, avg_acos: 0, avg_tacos: 0, overall_roas: 0, avg_ctr: 0, avg_cvr: 0, avg_cpc: 0, ads_sales_pct: 0 };
    const aggBom = { ...aggZerado, total_cost: 100, total_revenue: 5000, organic_revenue: 1000, avg_tacos: 1.67, overall_roas: 50 };
    {
        const h = carregar();
        h.S.window._tacosTarget = 3;
        h.S.renderEngagementPanel(overview({ aggregated: aggZerado }), [], 'adp-engagement');
        const t = h.texto('adp-engagement');
        check('sem gasto: não comemora meta atingida', !/Meta atingida/i.test(t), t.slice(0, 200));
        check('sem gasto: diz que não houve investimento', /Sem investimento no período/i.test(t), t.slice(0, 200));
        check('sem gasto: tarefa manda conferir as campanhas', /campanhas est/i.test(t) || !/Tudo em ordem/i.test(t), t.slice(0, 300));
    }
    {
        const h = carregar();
        h.S.window._tacosTarget = 3;
        h.S.renderEngagementPanel(overview({ aggregated: aggBom }), [], 'adp-engagement');
        const t = h.texto('adp-engagement');
        check('com gasto e TACOS abaixo da meta: comemora de verdade', /Meta atingida/i.test(t), t.slice(0, 200));
    }

    console.log(`\n${pass} passaram, ${fail} falharam`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERRO no teste:', e && e.stack || e); process.exit(1); });
