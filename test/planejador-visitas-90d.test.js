'use strict';
/*
 * PLANEJADOR — visitas Ads e Orgânico têm que cobrir a janela inteira (27/08/26).
 *
 * Sintoma: em 90d, a linha de Impressões ia de ponta a ponta mas as barras de
 * Visitas Ads e Visitas Orgânicas só começavam ~30 dias antes de hoje.
 *
 * Duas causas somadas:
 *
 *  1) JANELA FIXA DE 30 DIAS. O /api/fetch-visits-bulk tenta o multiget
 *     /items/visits?ids=..., que o ML só aceita com 1 id — o lote de 5 sempre
 *     falha e cai no fallback por item com `time_window?last=30&unit=day`
 *     HARDCODED, ignorando date_from/date_to. Ver reference_ml_visits_user_level.
 *     A conta inteira sai em UMA chamada por /api/user-visits-daily, cobre a
 *     janela pedida e ainda enxerga visita de catálogo, que a soma por item
 *     não vê (23.211 vs 6.958 na conta-prova).
 *
 *  2) CLIQUE DE ADS ERA APAGADO PELA FALTA DE VISITA. O gráfico fazia
 *     `Math.min(totalVisitas, cliquesAds)`: dia sem dado de visita zerava
 *     TAMBÉM a barra azul, mesmo com o clique existindo no daily_aggregated.
 *     Dado que falta é buraco, não zero.
 */
const { carregar, overview } = require('./harness-ads-planner');

let pass = 0, fail = 0;
const check = (label, cond, detail) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' - ' + label + (detail && !cond ? ' [' + detail + ']' : '')); };

// 91 dias (29/05 a 27/08), com clique e impressão TODO dia
const dias = [];
{
    const d = new Date('2026-05-29T00:00:00Z');
    const fim = new Date('2026-08-27T00:00:00Z');
    while (d <= fim) { dias.push(d.toISOString().split('T')[0]); d.setUTCDate(d.getUTCDate() + 1); }
}
const daily = dias.map(date => ({
    date, cost: 10, clicks: 5, prints: 200,
    total_amount: 50, organic_units_amount: 20, units_quantity: 1, organic_units_quantity: 2
}));
const AGG = { total_cost: 910, total_revenue: 4550, organic_revenue: 1820, total_clicks: 455, total_impressions: 18200, total_orders: 91, organic_orders: 182, avg_acos: 20, avg_tacos: 14, overall_roas: 5, avg_ctr: 2.5, avg_cvr: 20, avg_cpc: 2, ads_sales_pct: 71 };

const serieDoGrafico = (h) => {
    const g = h.grafico('adp-chart-visits');
    if (!g) return null;
    const ds = g.cfg.data.datasets;
    const acha = (nome) => ds.find(x => x.label.includes(nome));
    return {
        labels: g.cfg.data.labels.length,
        ads: acha('Ads').data,
        organico: acha('Org').data,
        impressoes: acha('Impress').data
    };
};

(async () => {
    // ── 1) UMA chamada de conta inteira, com a janela pedida ────────────────
    for (const d of [30, 90]) {
        const h = carregar({ respostas: { '/api/user-visits-daily': { results: dias.map(date => ({ date, total: 100 })) } } });
        const r = await h.S.fetchVisitsAccountDaily(111, d, 'tok');
        const chamadasVisitas = h.chamadas.filter(u => /visits/i.test(u));
        const url = chamadasVisitas[0] || '';
        check(`${d}d: uma única chamada de visitas`, chamadasVisitas.length === 1, `${chamadasVisitas.length} chamadas`);
        check(`${d}d: usa o endpoint de conta inteira`, url.includes('/api/user-visits-daily'), url);
        check(`${d}d: pede a janela certa (last=${d})`, url.includes(`last=${d}`), url);
        check(`${d}d: declara a janela medida`, !!(r && r.from && r.to), JSON.stringify(r && { de: r.from, ate: r.to }));
    }

    // ── 1b) resposta ESPARSA e DESORDENADA (como o ML responde de verdade) ───
    {
        // last=90 na conta-prova: 46 pontos, nenhum com zero, cobrindo 29/05..26/08
        const esparsos = dias.filter((_, i) => i % 2 === 0).map(date => ({ date, total: 4 })).reverse();
        const h = carregar({ respostas: { '/api/user-visits-daily': { results: esparsos } } });
        const r = await h.S.fetchVisitsAccountDaily(111, 90, 'tok');
        check('esparso: dia omitido NÃO vira chave', Object.keys(r.daily).length === esparsos.length, `${Object.keys(r.daily).length} chaves`);
        check('esparso: janela medida vai até o último dia com dado', r.to === dias[dias.length - 1] || r.to === dias[dias.length - 2], `to=${r.to}`);
    }

    // fallback por item quando a conta inteira não responde
    {
        const h = carregar({ respostas: { '/api/user-visits-daily': null, '/api/fetch-visits-bulk': { MLB1: { results: [{ date: '2026-08-27', total: 7 }] } } } });
        h.S.fetch = async (url) => {
            h.chamadas.push(String(url));
            if (String(url).includes('user-visits-daily')) return { ok: false, status: 500, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => ({ MLB1: { results: [{ date: '2026-08-27', total: 7 }] } }) };
        };
        const r = await h.S.fetchVisitsAccountDaily(111, 90, 'tok', ['MLB1']);
        check('fallback: cai pro por-item quando a conta inteira falha', !!r && r.accountWide === false, JSON.stringify(r && { aw: r.accountWide }));
        check('fallback: ainda traz o dia que existe', !!(r && r.daily && r.daily['2026-08-27'] === 7), JSON.stringify(r && r.daily));
    }

    // ── 2) O gráfico cobre a janela inteira quando a visita cobre ───────────
    {
        const h = carregar();
        // resposta esparsa: só os dias pares têm visita; a janela medida é a inteira
        const paresComVisita = dias.filter((_, i) => i % 2 === 0);
        const visitas = { accountWide: true, from: dias[0], to: dias[dias.length - 1], daily: Object.fromEntries(paresComVisita.map(d => [d, 100])) };
        h.S.renderCharts(overview({ aggregated: AGG, daily_aggregated: daily }), 'adp-charts', visitas);
        h.rodarTimers();
        const s = serieDoGrafico(h);
        check('90d: gráfico de visitas tem os 91 pontos', s && s.labels === 91, s ? `labels=${s.labels}` : 'sem gráfico');
        check('90d: nenhum buraco dentro da janela medida', s && s.organico.every(v => v != null), s ? `buracos=${s.organico.filter(v => v == null).length}` : '');
        check('90d: ads preenchido nos 91 dias', s && s.ads.filter(v => v != null && v > 0).length === 91, s ? `preenchidos=${s.ads.filter(v => v != null && v > 0).length}` : '');
        check('90d: dia com visita = total − cliques de ads', s && s.organico[0] === 95, s ? `org[0]=${s.organico[0]}` : '');
        check('90d: dia omitido pelo ML vira ZERO, não buraco', s && s.organico[1] === 0, s ? `org[1]=${s.organico[1]}` : '');
    }

    // ── 3) Dia sem visita não pode apagar o clique de ads ───────────────────
    {
        const h = carregar();
        // visita só nos últimos 30 dias — o retrato do bug
        const ultimos30 = dias.slice(-31);
        const visitas = { accountWide: false, from: ultimos30[0], to: ultimos30[ultimos30.length - 1], daily: Object.fromEntries(ultimos30.map(d => [d, 100])) };
        h.S.renderCharts(overview({ aggregated: AGG, daily_aggregated: daily }), 'adp-charts', visitas);
        h.rodarTimers();
        const s = serieDoGrafico(h);
        check('visita curta: ads NÃO é apagado nos dias sem visita', s && s.ads.filter(v => v > 0).length === 91, s ? `ads>0 em ${s.ads.filter(v => v > 0).length} de 91` : '');
        check('visita curta: orgânico vira buraco, não zero', s && s.organico.slice(0, 60).every(v => v == null), s ? `primeiros=${JSON.stringify(s.organico.slice(0, 3))}` : '');
        check('visita curta: orgânico preenchido onde há visita', s && s.organico.slice(-31).every(v => v === 95), s ? `ultimos=${JSON.stringify(s.organico.slice(-3))}` : '');
    }

    // ── 4) Composição de tráfego só conta dia com visita ────────────────────
    {
        const h = carregar();
        const ultimos30 = dias.slice(-31);
        const visitas = { accountWide: false, from: ultimos30[0], to: ultimos30[ultimos30.length - 1], daily: Object.fromEntries(ultimos30.map(d => [d, 100])) };
        h.S.renderCharts(overview({ aggregated: AGG, daily_aggregated: daily }), 'adp-charts', visitas);
        const t = h.texto('adp-charts');
        // 31 dias × 100 visitas = 3.100; ads = 31 × 5 = 155 -> 5,0%
        check('composição usa só os dias com visita (3.100 total)', /3\.100/.test(t), (t.match(/[\d.]+ ads \/ [\d.]+ total/) || ['?'])[0]);
        check('composição: ads = 155', /155 ads/.test(t), (t.match(/[\d.]+ ads \/ [\d.]+ total/) || ['?'])[0]);
    }

    console.log(`\n${pass} passaram, ${fail} falharam`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERRO no teste:', e && e.stack || e); process.exit(1); });
