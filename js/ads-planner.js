/* === ADS PLANNER — MarketFácil === */
/* Planejador de Ads com dados reais da API de Product Ads do Mercado Livre */

// ══════════════════════════════════════════════════════
// Section 0: Constants & Config
// ══════════════════════════════════════════════════════

const BASE_URL_PROXY = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
const API_ADS_OVERVIEW = `${BASE_URL_PROXY}/api/ads-overview`;
const API_FETCH_ITEM   = `${BASE_URL_PROXY}/api/fetch-item`;
const API_FETCH_VISITS_BULK = `${BASE_URL_PROXY}/api/fetch-visits-bulk`;

// Thresholds objetivos (nao dependem de categoria/margem)
const THRESHOLDS = {
    roas_critical: 1, // ROAS < 1 = perdendo dinheiro (objetivo, sempre ruim)
    ads_dependency_ok: 60, // <= 60% = saudavel
    ads_dependency_warning: 60, // 60-80% = alerta
    ads_dependency_critical: 80, // > 80% = excesso
    // Thresholds relativos: item vs media da conta
    relative_deviation: 0.5 // 50% pior que a media = alerta
};

const CACHE_KEY = 'adp_overview_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Helpers i18n — usam MF_getSiteConfig quando disponível, senão fallback MLB
function _mfCfg() {
    if (typeof window !== 'undefined' && window.MF_getSiteConfig) {
        const sid = window.MF_currentSiteId ? window.MF_currentSiteId() : 'MLB';
        return window.MF_getSiteConfig(sid);
    }
    return { locale: 'pt-BR', currency: 'BRL', currencySymbol: 'R$' };
}

function fmt(n, decimals = 2) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString(_mfCfg().locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMoney(n) {
    const cfg = _mfCfg();
    if (n == null || isNaN(n)) return cfg.currencySymbol + ' —';
    return cfg.currencySymbol + ' ' + Number(n).toLocaleString(cfg.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(Math.round(n)).toLocaleString(_mfCfg().locale);
}

// Métricas consolidadas de uma campanha. Preferimos camp.metrics (vem da API do ML
// via /ads-aggregated e cobre 100% dos anúncios da campanha no período). Fallback:
// soma dos items carregados — PARCIAL, pois /ads-items traz só os top 50 da conta.
function getCampaignMetrics(camp, items) {
    const m = camp && camp.metrics;
    if (m) {
        const cost = m.cost || 0;
        const revenue = m.revenue || 0;
        const orgRevenue = m.organic_revenue || 0;
        const clicks = m.clicks || 0;
        const impressions = m.impressions || 0;
        const orders = m.orders || 0;
        const orgOrders = m.organic_orders || 0;
        const totalRev = revenue + orgRevenue;
        const totalOrders = orders + orgOrders;
        return {
            cost, revenue, organic_revenue: orgRevenue, clicks, impressions, orders, organic_orders: orgOrders,
            acos: revenue > 0 ? (cost / revenue) * 100 : 0,
            tacos: totalRev > 0 ? (cost / totalRev) * 100 : 0,
            roas: cost > 0 ? revenue / cost : 0,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
            adsSalesPct: totalOrders > 0 ? (orders / totalOrders) * 100 : 0,
            partial: false
        };
    }
    const ci = (items || []).filter(i => i.campaign_id === (camp && camp.campaign_id));
    const cost = ci.reduce((s, i) => s + (i.cost || 0), 0);
    const revenue = ci.reduce((s, i) => s + (i.revenue || 0), 0);
    const orgRevenue = ci.reduce((s, i) => s + (i.organic_revenue || 0), 0);
    const clicks = ci.reduce((s, i) => s + (i.clicks || 0), 0);
    const impressions = ci.reduce((s, i) => s + (i.impressions || 0), 0);
    const orders = ci.reduce((s, i) => s + (i.orders || 0), 0);
    const orgOrders = ci.reduce((s, i) => s + (i.organic_orders || 0), 0);
    const totalRev = revenue + orgRevenue;
    const totalOrders = orders + orgOrders;
    return {
        cost, revenue, organic_revenue: orgRevenue, clicks, impressions, orders, organic_orders: orgOrders,
        acos: revenue > 0 ? (cost / revenue) * 100 : 0,
        tacos: totalRev > 0 ? (cost / totalRev) * 100 : 0,
        roas: cost > 0 ? revenue / cost : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
        adsSalesPct: totalOrders > 0 ? (orders / totalOrders) * 100 : 0,
        partial: true
    };
}

// ══════════════════════════════════════════════════════
// Section 0.5: Retention Engine (localStorage-based)
// ══════════════════════════════════════════════════════
// Hooks de dependência/engajamento sem banco de dados.
// Tudo persistido em localStorage por seller_id.

const RT_NS = 'mf_adp_';
const RT_MAX_HISTORY = 90; // dias de snapshots guardados
const RT_REVISION_DAYS = 15; // lembrete de revisão

function rtKey(sellerId, slot) { return `${RT_NS}${slot}_${sellerId || 'unknown'}`; }

function rtGet(sellerId, slot, fallback) {
    try {
        const raw = localStorage.getItem(rtKey(sellerId, slot));
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch (_) { return fallback; }
}

function rtSet(sellerId, slot, value) {
    try { localStorage.setItem(rtKey(sellerId, slot), JSON.stringify(value)); } catch (_) {}
}

function rtToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function rtDaysBetween(a, b) {
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

// Compute health score 0-100 from current overview
function rtComputeHealth(overview) {
    const agg = overview.aggregated || {};
    const target = window._tacosTarget || 3;
    let score = 100;
    // ROAS penalty
    const roas = agg.overall_roas || 0;
    if (roas < 1) score -= 40;
    else if (roas < 2) score -= 20;
    else if (roas < 3) score -= 10;
    // TACOS vs target
    const tacos = agg.avg_tacos || 0;
    if (tacos > target * 1.5) score -= 25;
    else if (tacos > target) score -= 12;
    // Dependency
    const totalRev = (agg.total_revenue || 0) + (agg.total_organic_revenue || 0);
    const adsPct = totalRev > 0 ? ((agg.total_revenue || 0) / totalRev) * 100 : 0;
    if (adsPct > 80) score -= 20;
    else if (adsPct > 60) score -= 10;
    // Items with no sales penalty
    const items = (overview.items || []).filter(i => i.has_ads);
    const noSales = items.filter(i => (i.cost || 0) > 50 && (i.orders || 0) === 0).length;
    if (noSales > 0) score -= Math.min(15, noSales * 3);
    return Math.max(0, Math.min(100, Math.round(score)));
}

// Save snapshot of current visit (deduped by date+period)
let _rtLastSnapshotKey = null;
function rtSaveSnapshot(overview) {
    if (!overview || !overview.seller_id) return;
    const sid = overview.seller_id;
    const key = sid + '_' + rtToday() + '_' + (window._currentDays || 30);
    if (_rtLastSnapshotKey === key) return; // already saved this run
    _rtLastSnapshotKey = key;
    const agg = overview.aggregated || {};
    const totalRev = (agg.total_revenue || 0) + (agg.total_organic_revenue || 0);
    const adsPct = totalRev > 0 ? ((agg.total_revenue || 0) / totalRev) * 100 : 0;
    const currentPeriod = window._currentDays || 30;
    const snapshot = {
        date: rtToday(),
        period: currentPeriod, // grava o período pra comparar apenas snapshots equivalentes
        ts: Date.now(),
        tacos: agg.avg_tacos || 0,
        acos: agg.avg_acos || 0,
        roas: agg.overall_roas || 0,
        cost: agg.total_cost || 0,
        revenue: agg.total_revenue || 0,
        organic_revenue: agg.total_organic_revenue || 0,
        adsPct: adsPct,
        clicks: agg.total_clicks || 0,
        impressions: agg.total_impressions || 0,
        items_with_ads: overview.total_items_with_ads || 0,
        health: rtComputeHealth(overview)
    };
    const history = rtGet(sid, 'history', []);
    // Dedupe: mesmo dia E mesmo período (remove só o snapshot equivalente)
    const filtered = history.filter(h => !(h.date === snapshot.date && (h.period || 30) === currentPeriod));
    filtered.push(snapshot);
    // Cap to last RT_MAX_HISTORY entries
    while (filtered.length > RT_MAX_HISTORY) filtered.shift();
    rtSet(sid, 'history', filtered);

    // Update streak
    const lastVisit = rtGet(sid, 'lastVisit', null);
    const streakObj = rtGet(sid, 'streak', { current: 0, best: 0, lastDate: null });
    if (streakObj.lastDate !== snapshot.date) {
        if (streakObj.lastDate) {
            const gap = rtDaysBetween(streakObj.lastDate, snapshot.date);
            if (gap === 1) streakObj.current += 1;
            else if (gap > 1) streakObj.current = 1;
        } else {
            streakObj.current = 1;
        }
        streakObj.lastDate = snapshot.date;
        if (streakObj.current > streakObj.best) streakObj.best = streakObj.current;
        rtSet(sid, 'streak', streakObj);
    }
    rtSet(sid, 'lastVisit', snapshot.date);

    // Update best week (best ROAS)
    const best = rtGet(sid, 'bestRoas', null);
    if (!best || snapshot.roas > best.roas) {
        rtSet(sid, 'bestRoas', { roas: snapshot.roas, date: snapshot.date });
    }

    // Track baseline cost (1st visit) for "economy generated" estimate
    const baseline = rtGet(sid, 'baseline', null);
    if (!baseline) {
        rtSet(sid, 'baseline', { cost: snapshot.cost, revenue: snapshot.revenue, date: snapshot.date });
    }

    // Snapshot por item e por campanha (alimenta tendências em listagens)
    try { rtSaveItemAndCampaignSnapshots(overview); } catch(_) {}
}

// Salva snapshots leves por item e por campanha (top 50 itens por custo) pra alimentar tendências
// nas listagens (Ranking, Insights por Campanha) sem precisar buscar daily por item.
function rtSaveItemAndCampaignSnapshots(overview) {
    if (!overview || !overview.seller_id) return;
    const sid = overview.seller_id;
    const date = rtToday();
    const period = window._currentDays || 30;
    // Itens — top 50 por custo
    const items = (overview.items || []).filter(i => i.has_ads).slice().sort((a,b) => (b.cost||0) - (a.cost||0)).slice(0, 50);
    const itemSnap = {};
    for (const i of items) {
        const totalRev = (i.revenue || 0) + (i.organic_revenue || 0);
        itemSnap[i.item_id] = {
            cost: i.cost || 0,
            revenue: i.revenue || 0,
            roas: (i.cost > 0) ? (i.revenue / i.cost) : 0,
            tacos: totalRev > 0 ? (i.cost / totalRev) * 100 : 0,
            acos: i.acos || 0,
            ctr: i.ctr || 0,
            cvr: i.cvr || 0,
            prints: i.impressions || 0,
            clicks: i.clicks || 0,
            orders: i.orders || 0
        };
    }
    const itemKey = `items_${period}`;
    const itemHist = rtGet(sid, itemKey, []);
    const itemFiltered = itemHist.filter(h => h.date !== date);
    itemFiltered.push({ date, ts: Date.now(), data: itemSnap });
    while (itemFiltered.length > 14) itemFiltered.shift();
    rtSet(sid, itemKey, itemFiltered);

    // Campanhas — todas (metrics da API quando disponível; senão soma parcial dos items)
    const campaigns = overview.campaigns || [];
    const allItems = overview.items || [];
    const campSnap = {};
    for (const c of campaigns) {
        const cm = getCampaignMetrics(c, allItems);
        campSnap[c.campaign_id] = {
            cost: cm.cost, revenue: cm.revenue, prints: cm.impressions, clicks: cm.clicks, orders: cm.orders,
            roas: cm.roas,
            acos: cm.acos,
            tacos: cm.tacos,
            ctr: cm.ctr,
            cvr: cm.cvr,
            adsSalesPct: cm.adsSalesPct
        };
    }
    const campKey = `campaigns_${period}`;
    const campHist = rtGet(sid, campKey, []);
    const campFiltered = campHist.filter(h => h.date !== date);
    campFiltered.push({ date, ts: Date.now(), data: campSnap });
    while (campFiltered.length > 14) campFiltered.shift();
    rtSet(sid, campKey, campFiltered);
}

// Tendência por item (% delta vs snapshot anterior). Retorna null se não há histórico suficiente.
function rtGetItemTrend(sellerId, itemId, period) {
    if (!sellerId || !itemId) return null;
    const p = period || (window._currentDays || 30);
    const history = rtGet(sellerId, `items_${p}`, []);
    if (history.length < 2) return null;
    const cur = history[history.length - 1].data && history[history.length - 1].data[itemId];
    const prev = history[history.length - 2].data && history[history.length - 2].data[itemId];
    if (!cur || !prev) return null;
    const t = (cv, pv) => (!pv || pv === 0) ? null : ((cv - pv) / Math.abs(pv)) * 100;
    return {
        roas: t(cur.roas, prev.roas),
        tacos: t(cur.tacos, prev.tacos),
        acos: t(cur.acos, prev.acos),
        ctr: t(cur.ctr, prev.ctr),
        cvr: t(cur.cvr, prev.cvr),
        prints: t(cur.prints, prev.prints),
        clicks: t(cur.clicks, prev.clicks),
        cost: t(cur.cost, prev.cost),
        revenue: t(cur.revenue, prev.revenue),
        orders: t(cur.orders, prev.orders),
        prevDate: history[history.length - 2].date
    };
}

function rtGetCampaignTrend(sellerId, campaignId, period) {
    if (!sellerId || !campaignId) return null;
    const p = period || (window._currentDays || 30);
    const history = rtGet(sellerId, `campaigns_${p}`, []);
    if (history.length < 2) return null;
    const cur = history[history.length - 1].data && history[history.length - 1].data[campaignId];
    const prev = history[history.length - 2].data && history[history.length - 2].data[campaignId];
    if (!cur || !prev) return null;
    const t = (cv, pv) => (!pv || pv === 0) ? null : ((cv - pv) / Math.abs(pv)) * 100;
    return {
        roas: t(cur.roas, prev.roas),
        tacos: t(cur.tacos, prev.tacos),
        acos: t(cur.acos, prev.acos),
        ctr: t(cur.ctr, prev.ctr),
        cvr: t(cur.cvr, prev.cvr),
        prints: t(cur.prints, prev.prints),
        clicks: t(cur.clicks, prev.clicks),
        cost: t(cur.cost, prev.cost),
        revenue: t(cur.revenue, prev.revenue),
        orders: t(cur.orders, prev.orders),
        adsSalesPct: t(cur.adsSalesPct, prev.adsSalesPct),
        prevDate: history[history.length - 2].date
    };
}

// Mini badge de tendência compacto (use em listagens). invertColor = true quando aumentar é ruim (ACOS, TACOS, custo).
function rtTrendChip(pct, invertColor = false, opts = {}) {
    if (pct == null || isNaN(pct)) return '';
    const abs = Math.abs(pct);
    if (abs < 1) return '<span style="color:var(--text-muted);font-size:0.6rem;font-family:DM Mono,monospace;" title="Estável vs visita anterior">~0%</span>';
    const arrow = pct > 0 ? '▲' : '▼';
    const isUp = pct > 0;
    const good = invertColor ? !isUp : isUp;
    const color = good ? '#059669' : '#dc2626';
    const label = abs >= 500 ? '>500' : (abs >= 100 ? Math.round(abs) : abs.toFixed(1));
    const fontSize = opts.size || '0.6rem';
    return `<span style="color:${color};font-size:${fontSize};font-family:DM Mono,monospace;font-weight:700;" title="${good?'Melhorou':'Piorou'} ${label}% vs visita anterior">${arrow}${label}%</span>`;
}

function rtGetPrevSnapshot(sellerId, beforeDate, period) {
    const history = rtGet(sellerId, 'history', []);
    if (history.length < 2) return null;
    const targetPeriod = period || (window._currentDays || 30);
    // Find last snapshot before the given date with SAME period
    for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        const hPeriod = h.period || 30;
        if (h.date < beforeDate && hPeriod === targetPeriod) return h;
    }
    return null;
}

function rtGetLatestSnapshotSamePeriod(sellerId, period) {
    const history = rtGet(sellerId, 'history', []);
    const targetPeriod = period || (window._currentDays || 30);
    for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        if ((h.period || 30) === targetPeriod) return h;
    }
    return null;
}

// ===== Watchlist (#3) =====
function rtToggleWatch(sellerId, itemId) {
    const list = rtGet(sellerId, 'watchlist', []);
    const idx = list.indexOf(itemId);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(itemId);
    rtSet(sellerId, 'watchlist', list);
    return list.indexOf(itemId) >= 0;
}
function rtIsWatched(sellerId, itemId) {
    return rtGet(sellerId, 'watchlist', []).indexOf(itemId) >= 0;
}

// ===== Dismissed alerts (#4) =====
function rtDismissAlert(sellerId, alertId) {
    const dismissed = rtGet(sellerId, 'dismissedAlerts', {});
    dismissed[alertId] = { date: rtToday(), ts: Date.now() };
    rtSet(sellerId, 'dismissedAlerts', dismissed);
}
function rtIsDismissed(sellerId, alertId) {
    const dismissed = rtGet(sellerId, 'dismissedAlerts', {});
    return !!dismissed[alertId];
}

// ===== Action diary (#10) =====
function rtLogAction(sellerId, type, target, note) {
    const diary = rtGet(sellerId, 'diary', []);
    diary.push({ date: rtToday(), ts: Date.now(), type, target, note });
    while (diary.length > 200) diary.shift();
    rtSet(sellerId, 'diary', diary);
}

// ===== Daily checklist (#16) =====
function rtGetDailyChecklist(sellerId) {
    const today = rtToday();
    const stored = rtGet(sellerId, 'dailyChecklist', null);
    if (stored && stored.date === today) return stored;
    return null;
}
function rtSetDailyChecklist(sellerId, items) {
    rtSet(sellerId, 'dailyChecklist', { date: rtToday(), items });
}

// ===== Goals (#8) =====
function rtGetGoal(sellerId) {
    return rtGet(sellerId, 'goal', null);
}
function rtSetGoal(sellerId, goal) {
    rtSet(sellerId, 'goal', goal);
}

// ===== Onboarding quiz (#13) =====
function rtGetOnboarding(sellerId) {
    return rtGet(sellerId, 'onboarding', null);
}
function rtSetOnboarding(sellerId, data) {
    rtSet(sellerId, 'onboarding', data);
}

// ===== Revision reminders (#20) =====
function rtMarkCampaignRevised(sellerId, campaignId) {
    const revised = rtGet(sellerId, 'campaignRevised', {});
    revised[campaignId] = rtToday();
    rtSet(sellerId, 'campaignRevised', revised);
    rtLogAction(sellerId, 'revisao_campanha', campaignId, '');
}
function rtCampaignsNeedingRevision(sellerId, campaigns) {
    const revised = rtGet(sellerId, 'campaignRevised', {});
    const today = rtToday();
    return (campaigns || []).filter(c => {
        const cid = c.campaign_id || c.id;
        if (!cid) return false;
        const last = revised[cid];
        if (!last) return true;
        return rtDaysBetween(last, today) >= RT_REVISION_DAYS;
    });
}

// ===== Personal best week comparison =====
function rtGetBestRoas(sellerId) {
    return rtGet(sellerId, 'bestRoas', null);
}

// ===== Render: Retention banner (top of page) =====
function renderRetentionBanner(overview, containerId) {
    const c = document.getElementById(containerId);
    if (!c || !overview || !overview.seller_id) return;
    const sid = overview.seller_id;
    const today = rtToday();
    const currentPeriod = window._currentDays || 30;
    const streak = rtGet(sid, 'streak', { current: 0, best: 0, lastDate: null });
    // Só compara snapshots do MESMO período (evita delta falso ao trocar entre 7d/30d)
    const prev = rtGetPrevSnapshot(sid, today, currentPeriod);
    const current = rtGetLatestSnapshotSamePeriod(sid, currentPeriod);

    let pieces = [];

    // Streak (#2)
    if (streak.current >= 2) {
        pieces.push(`<span class="adp-rt-pill" style="background:#fef3c7;color:#92400e;">🔥 ${streak.current} dia${streak.current>1?'s':''} seguidos</span>`);
    }

    // Last visit + delta (#1)
    if (prev) {
        const gap = rtDaysBetween(prev.date, today);
        const tacosDelta = (current.tacos - prev.tacos);
        const roasDelta = (current.roas - prev.roas);
        const tacosColor = tacosDelta < 0 ? '#059669' : (tacosDelta > 0.5 ? '#dc2626' : '#64748b');
        const roasColor = roasDelta > 0 ? '#059669' : (roasDelta < -0.2 ? '#dc2626' : '#64748b');
        const tacosArrow = tacosDelta > 0 ? '▲' : (tacosDelta < 0 ? '▼' : '•');
        const roasArrow = roasDelta > 0 ? '▲' : (roasDelta < 0 ? '▼' : '•');
        pieces.push(`<span class="adp-rt-pill">📊 vs sua visita há ${gap}d: TACOS <b style="color:${tacosColor};">${tacosArrow} ${fmt(Math.abs(tacosDelta), 1)}pp</b> · ROAS <b style="color:${roasColor};">${roasArrow} ${fmt(Math.abs(roasDelta), 2)}x</b></span>`);
    } else {
        pieces.push(`<span class="adp-rt-pill" style="background:#dbeafe;color:#1e40af;">👋 Bem-vindo — começamos a comparar suas métricas a partir da próxima visita</span>`);
    }

    // Gap warning (#2)
    if (prev) {
        const gap = rtDaysBetween(prev.date, today);
        if (gap >= 5) {
            pieces.push(`<span class="adp-rt-pill" style="background:#fee2e2;color:#991b1b;">⚠ Faz ${gap} dias que não revisa</span>`);
        }
    }

    // Best Roas (#9)
    const best = rtGetBestRoas(sid);
    if (best && current && best.roas > current.roas + 0.1) {
        pieces.push(`<span class="adp-rt-pill" style="background:#ede9fe;color:#5b21b6;">🏆 Seu recorde: ROAS ${fmt(best.roas, 2)}x (${best.date})</span>`);
    }

    const bellHtml = renderNovidadesBell(overview, sid);
    if (!pieces.length && !bellHtml) { c.innerHTML = ''; return; }
    c.innerHTML = `<div class="adp-rt-banner">${pieces.join('')}${bellHtml}</div>`;
}

// ===== Render: Anomaly modal (#15) =====
function renderAnomalyModal(overview) {
    if (!overview || !overview.seller_id) return;
    const sid = overview.seller_id;
    const currentPeriod = window._currentDays || 30;
    // Só compara snapshots do MESMO período
    const samePeriod = rtGet(sid, 'history', []).filter(h => (h.period || 30) === currentPeriod);
    if (samePeriod.length < 2) return;
    const current = samePeriod[samePeriod.length - 1];
    const prev = samePeriod[samePeriod.length - 2];
    if (rtDaysBetween(prev.date, current.date) > 7) return; // só compara visitas próximas
    const anomalies = [];
    if (prev.cost > 0 && current.cost > prev.cost * 1.8) {
        anomalies.push(`Gasto em ads aumentou ${fmt(((current.cost/prev.cost)-1)*100, 0)}% (R$ ${fmt(prev.cost, 0)} → R$ ${fmt(current.cost, 0)})`);
    }
    if (prev.roas > 1 && current.roas < prev.roas * 0.6) {
        anomalies.push(`ROAS despencou de ${fmt(prev.roas, 2)}x para ${fmt(current.roas, 2)}x`);
    }
    if (prev.adsPct > 0 && (current.adsPct - prev.adsPct) > 15) {
        anomalies.push(`Dependência de ads pulou de ${fmt(prev.adsPct, 0)}% para ${fmt(current.adsPct, 0)}%`);
    }
    if (!anomalies.length) return;
    // Check if already shown today
    const shown = rtGet(sid, 'anomalyShown', null);
    if (shown === rtToday()) return;
    rtSet(sid, 'anomalyShown', rtToday());

    const modal = document.createElement('div');
    modal.className = 'adp-rt-modal';
    modal.innerHTML = `
        <div class="adp-rt-modal-content">
            <div class="adp-rt-modal-header">⚠ Algo mudou desde sua última visita</div>
            <ul style="margin:8px 0 16px 0;padding-left:20px;font-size:0.85rem;color:#0f172a;">
                ${anomalies.map(a => `<li style="margin-bottom:6px;">${escapeHtml(a)}</li>`).join('')}
            </ul>
            <button onclick="this.closest('.adp-rt-modal').remove()" style="padding:12px 18px;background:#0066ff;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:0.85rem;cursor:pointer;font-family:inherit;">Entendi, ver detalhes</button>
        </div>`;
    document.body.appendChild(modal);
}

// ===== Render: Onboarding modal (#13) =====
function renderOnboardingModal(overview) {
    if (!overview || !overview.seller_id) return;
    const sid = overview.seller_id;
    if (rtGetOnboarding(sid)) return;
    const inputStyle = 'width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:0.9rem;font-family:inherit;margin-bottom:12px;box-sizing:border-box;background:#fff;color:#0f172a;';
    const labelStyle = 'display:block;font-size:0.78rem;font-weight:700;margin-bottom:6px;color:#0f172a;';
    const modal = document.createElement('div');
    modal.className = 'adp-rt-modal';
    modal.innerHTML = `
        <div class="adp-rt-modal-content" style="max-width:480px;">
            <div class="adp-rt-modal-header">👋 Bem-vindo ao Planejador de Ads</div>
            <p style="font-size:0.85rem;color:#475569;margin:6px 0 16px;">3 perguntas rápidas pra personalizar suas análises:</p>
            <label style="${labelStyle}">Margem média dos seus produtos (%)</label>
            <input id="adp-onb-margin" type="number" value="20" min="0" max="100" style="${inputStyle}">
            <label style="${labelStyle}">Meta de TACOS (%)</label>
            <input id="adp-onb-tacos" type="number" value="3" min="0" max="100" step="0.5" style="${inputStyle}">
            <label style="${labelStyle}">Foco da sua estratégia</label>
            <select id="adp-onb-focus" style="${inputStyle}">
                <option value="profitability">Rentabilidade (ROAS alto)</option>
                <option value="visibility">Visibilidade (mais tráfego)</option>
                <option value="balance">Equilíbrio</option>
            </select>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button onclick="window.adpFinishOnboarding()" style="flex:1;padding:12px 16px;background:#0066ff;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;">Salvar e começar</button>
                <button onclick="this.closest('.adp-rt-modal').remove()" style="padding:12px 16px;background:#fff;color:#475569;border:1px solid #cbd5e1;border-radius:6px;font-weight:600;font-size:0.85rem;cursor:pointer;font-family:inherit;">Mais tarde</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

window.adpFinishOnboarding = function() {
    const sid = (window._currentOverview && window._currentOverview.seller_id) || '';
    if (!sid) return;
    const margin = parseFloat(document.getElementById('adp-onb-margin').value) || 20;
    const tacos = parseFloat(document.getElementById('adp-onb-tacos').value) || 3;
    const focus = document.getElementById('adp-onb-focus').value;
    rtSetOnboarding(sid, { margin, tacos, focus, date: rtToday() });
    window._tacosTarget = tacos;
    window._userMargin = margin;
    document.querySelectorAll('.adp-rt-modal').forEach(m => m.remove());
    if (window._currentOverview) renderFullDashboard(window._currentOverview, window._currentItemDetails, window._currentVisitsData);
};

// ===== Render: Engagement panel (combines streak, goal, daily checklist, best, economy, score history) =====
function renderEngagementPanel(overview, alerts, containerId) {
    const c = document.getElementById(containerId);
    if (!c || !overview || !overview.seller_id) { if (c) c.innerHTML = ''; return; }
    const sid = overview.seller_id;
    const history = rtGet(sid, 'history', []);
    const current = history[history.length - 1] || {};
    const streak = rtGet(sid, 'streak', { current: 0, best: 0, lastDate: null });
    const goal = rtGetGoal(sid);
    const baseline = rtGet(sid, 'baseline', null);

    // Score sparkline
    const last30 = history.slice(-30);
    const scores = last30.map(h => h.health || 0);
    const sparkW = 200, sparkH = 32;
    let sparkSvg = '';
    if (scores.length >= 2) {
        const max = Math.max(...scores, 100);
        const min = Math.min(...scores, 0);
        const range = max - min || 1;
        const pts = scores.map((s, i) => {
            const x = (i / (scores.length - 1)) * sparkW;
            const y = sparkH - ((s - min) / range) * sparkH;
            return `${x},${y}`;
        }).join(' ');
        sparkSvg = `<svg width="${sparkW}" height="${sparkH}" style="display:block;"><polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="2"/></svg>`;
    }

    // Score delta vs prev
    const prev = history.length >= 2 ? history[history.length - 2] : null;
    const scoreDelta = prev ? (current.health || 0) - (prev.health || 0) : 0;
    const scoreColor = (current.health || 0) >= 75 ? '#059669' : (current.health || 0) >= 50 ? '#d97706' : '#dc2626';
    const scoreArrow = scoreDelta > 0 ? '▲' : (scoreDelta < 0 ? '▼' : '•');
    const scoreDeltaStr = scoreDelta !== 0 ? ` <span style="font-size:0.7rem;color:${scoreDelta>0?'#059669':'#dc2626'};">${scoreArrow}${Math.abs(scoreDelta)}</span>` : '';

    // Goal progress — unified com window._tacosTarget (editável inline)
    const currentTacosVal = (overview.aggregated && overview.aggregated.avg_tacos) || current.tacos || 0;
    // Inicializa meta se não houver: usa o atual como ponto de partida
    const activeTarget = window._tacosTarget || (goal && goal.metric === 'tacos' ? goal.target : currentTacosVal || 3);
    if (!window._tacosTarget && activeTarget > 0) window._tacosTarget = activeTarget;

    const ok = currentTacosVal <= activeTarget;
    const pctReached = activeTarget > 0 ? Math.min(100, (activeTarget / Math.max(currentTacosVal, 0.01)) * 100) : 0;
    const daysLeft = goal && goal.endDate ? rtDaysBetween(rtToday(), goal.endDate) : 0;
    const statusLine = ok
        ? `<span style="color:#059669;font-weight:700;">\u2713 Meta atingida!</span> ${daysLeft > 0 ? `<span style="color:var(--text-muted);"> \u00b7 ${daysLeft}d restantes</span>` : ''}`
        : `<span style="color:#dc2626;font-weight:700;">Acima da meta</span> ${daysLeft > 0 ? `<span style="color:var(--text-muted);"> \u00b7 ${daysLeft}d restantes</span>` : ''}`;
    const goalHtml = `<div class="adp-rt-card adp-rt-card-glow" style="--glow-color:${ok?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'};">
        <div class="adp-rt-card-title">\ud83c\udfaf Meta de TACOS</div>
        <div style="display:flex;align-items:baseline;gap:6px;margin:4px 0;">
            <span style="font-size:0.68rem;color:var(--text-muted);">atual</span>
            <span style="font-size:1.4rem;font-weight:800;color:${ok?'#059669':'#dc2626'};font-family:'DM Mono',monospace;line-height:1;"><span class="adp-count-up" data-target="${fmt(currentTacosVal, 2)}">0</span>%</span>
        </div>
        <div class="adp-rt-bar"><div class="adp-rt-bar-fill" style="width:${Math.min(100,pctReached)}%;background:${ok?'#10b981':'#ef4444'};"></div></div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:0.72rem;flex-wrap:wrap;">
            <span style="color:var(--text-muted);">m\u00e1ximo</span>
            <input type="number" id="adp-goal-inline-input" value="${fmt(activeTarget, 2).replace(',','.')}" min="0" max="100" step="0.5"
                style="width:60px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.78rem;font-family:'DM Mono',monospace;font-weight:700;color:#0f172a;text-align:right;background:#fff;"
                oninput="window.adpUpdateTacosTarget(this.value)"
                onkeydown="window.adpTacosInputKey(event)">
            <span style="color:var(--text-muted);">%</span>
            <button type="button" id="adp-goal-save-btn" class="adp-goal-save-btn" onclick="window.adpSaveTacosTarget()" disabled title="Salvar meta de TACOS">Salvar</button>
            <span id="adp-goal-saved-feedback" style="font-size:0.68rem;color:#059669;font-weight:700;opacity:0;transform:translateY(-4px);transition:opacity .2s ease, transform .2s ease;">✓ Salvo</span>
        </div>
        <div style="font-size:0.68rem;margin-top:6px;">${statusLine}</div>
    </div>`;

    // Economy generated (#18)
    let economyHtml = '';
    if (baseline && current && history.length >= 3) {
        const days = rtDaysBetween(baseline.date, rtToday()) || 1;
        const projectedCost = baseline.cost; // assume sem otimização gastaria igual ao baseline para o mesmo período
        const actualCost = current.cost;
        const economy = Math.max(0, projectedCost - actualCost);
        if (economy > 0) {
            economyHtml = `<div class="adp-rt-card">
                <div class="adp-rt-card-title">💰 Economia Estimada</div>
                <div style="font-size:1.4rem;font-weight:700;color:#059669;font-family:'DM Mono',monospace;">${fmtMoney(economy)}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);">vs baseline de ${days}d atrás</div>
            </div>`;
        }
    }

    // Daily checklist (#16)
    const stored = rtGetDailyChecklist(sid);
    let checklist = stored ? stored.items : null;
    if (!checklist) {
        // Generate based on current state
        checklist = [];
        const items = (overview.items || []).filter(i => i.has_ads);
        const noSales = items.filter(i => (i.cost || 0) > 30 && (i.orders || 0) === 0);
        if (noSales.length > 0) checklist.push({ id: 'no_sales', text: `Revisar ${noSales.length} anúncio(s) gastando sem vender`, done: false });
        const lowRoas = items.filter(i => (i._roas || 0) > 0 && (i._roas || 0) < 1).slice(0, 3);
        if (lowRoas.length > 0) checklist.push({ id: 'low_roas', text: `Avaliar ${lowRoas.length} anúncio(s) com ROAS < 1`, done: false });
        if ((current.tacos || 0) > (window._tacosTarget || 3)) checklist.push({ id: 'tacos_high', text: 'TACOS acima da meta — revisar campanhas', done: false });
        const watchlist = rtGet(sid, 'watchlist', []);
        if (watchlist.length > 0) checklist.push({ id: 'watchlist', text: `Conferir ${watchlist.length} anúncio(s) em observação`, done: false });
        if (!checklist.length) checklist.push({ id: 'all_good', text: '🎉 Tudo em ordem — explore oportunidades de escala', done: false });
        rtSetDailyChecklist(sid, checklist);
    }
    const doneCount = checklist.filter(it => it.done).length;
    const checklistHtml = `<div class="adp-rt-card" style="grid-column:span 2;">
        <div class="adp-rt-card-title">✓ Tarefas de hoje (${doneCount}/${checklist.length})</div>
        <ul class="adp-rt-checklist">
            ${checklist.map((it, idx) => `<li>
                <label style="cursor:pointer;display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" ${it.done?'checked':''} onchange="window.adpToggleTask(${idx})" style="cursor:pointer;">
                    <span style="${it.done?'text-decoration:line-through;color:var(--text-muted);':''}">${escapeHtml(it.text)}</span>
                </label>
            </li>`).join('')}
        </ul>
    </div>`;

    // Score history (sparkline only — main score is shown at the top via renderHealthScore)
    const healthHtml = scores.length >= 2 ? `<div class="adp-rt-card adp-rt-card-glow" style="--glow-color:${scoreColor}55;">
        <div class="adp-rt-card-title">📈 Histórico de Saúde</div>
        <div style="font-size:1.4rem;font-weight:800;color:${scoreColor};font-family:'DM Mono',monospace;line-height:1;"><span class="adp-count-up" data-target="${current.health || 0}">0</span>${scoreDeltaStr}</div>
        <div style="margin-top:6px;">${sparkSvg}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);">${last30.length} dias acompanhados</div>
    </div>` : '';

    // Gamification cards (level, scaling streak, benchmark, potencial economia)
    const gam = renderGamificationCards(overview, sid);

    // (streak agora vem de renderGamificationCards via gam.streakHtml)

    c.innerHTML = `
        <div class="adp-section-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>🎯 Seu Acompanhamento <span style="font-weight:400;font-size:0.68rem;text-transform:none;color:var(--text-muted);margin-left:8px;">Progresso pessoal e tarefas</span></span>
            <button class="adp-period-btn" onclick="window.adpShareResult()" style="background:var(--blue);color:#fff;font-size:0.7rem;text-transform:none;letter-spacing:0;">📸 Compartilhar resultado</button>
        </div>
        <div class="adp-rt-grid">
            ${gam.levelHtml}
            ${gam.streakHtml}
            ${healthHtml}
            ${goalHtml}
            ${economyHtml}
            ${gam.economiaHtml}
            ${checklistHtml}
        </div>`;
    /* trigger animations */
    setTimeout(() => adpAnimateNumbers(c), 50);

    /* Sincroniza estado inicial do botão Salvar: disabled quando meta já persistida */
    try {
        const goalInput = document.getElementById('adp-goal-inline-input');
        if (goalInput) window.adpUpdateTacosTarget(goalInput.value);
    } catch(_) {}

    /* milestone confetti — first time hitting a new level */
    try {
        const xp = rtCalcXP(sid);
        const lvl = rtGetLevel(xp);
        const lastLevel = rtGet(sid, 'lastLevelSeen', null);
        if (lastLevel && lastLevel !== lvl.name && lvl.min > 0) {
            adpConfetti();
        }
        rtSet(sid, 'lastLevelSeen', lvl.name);
    } catch(_) {}
}

// Unified TACOS target updater — called from both the goal card (inline input)
// and the simulator config bar. Keeps everything in sync without re-rendering the card
// (so the user can keep typing).
let _adpGoalDebounce = null;
let _adpSavedFeedbackTimer = null;

// Atualiza apenas em memória (sem persistir) — usado durante digitação.
// Mantém o simulador e demais seções refletindo o valor em tempo real,
// mas não grava em localStorage até o usuário clicar em "Salvar".
window.adpUpdateTacosTarget = function(val) {
    const t = parseFloat(String(val).replace(',', '.'));
    if (isNaN(t) || t < 0) return;
    window._tacosTarget = t;
    window._simSavedTacos = t;

    // Sync goal inline input (se usuário editou em outro lugar)
    const goalInput = document.getElementById('adp-goal-inline-input');
    if (goalInput && document.activeElement !== goalInput && parseFloat(goalInput.value) !== t) goalInput.value = t;

    // Atualiza label "Meta atual" no simulador (display-only)
    const simMetaLabel = document.getElementById('adp-sim-meta-display');
    if (simMetaLabel) simMetaLabel.textContent = `${fmt(t, 2)}%`;

    // Marca o botão de salvar como pendente se o valor diverge do persistido
    const sid = (window._currentOverview && window._currentOverview.seller_id) || '';
    const persisted = sid ? (rtGetGoal(sid) || {}).target : null;
    const saveBtn = document.getElementById('adp-goal-save-btn');
    if (saveBtn) {
        const dirty = persisted == null || Math.abs((parseFloat(persisted) || 0) - t) > 1e-9;
        saveBtn.classList.toggle('adp-goal-save-btn--dirty', dirty);
        saveBtn.disabled = !dirty;
    }
};

// Persiste a meta + dá feedback visual. Chamado pelo botão Salvar / Enter / blur.
window.adpSaveTacosTarget = function() {
    const input = document.getElementById('adp-goal-inline-input');
    if (!input) return;
    const t = parseFloat(String(input.value).replace(',', '.'));
    if (isNaN(t) || t < 0) return;
    window._tacosTarget = t;
    window._simSavedTacos = t;

    const sid = (window._currentOverview && window._currentOverview.seller_id) || '';
    if (sid) {
        const existing = rtGetGoal(sid) || {};
        const end = existing.endDate || (() => {
            const d = new Date(); d.setMonth(d.getMonth() + 1);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        })();
        rtSetGoal(sid, { metric: 'tacos', target: t, startDate: existing.startDate || rtToday(), endDate: end });
    }

    // Feedback visual: troca o botão por "✓ Salvo" por ~1.8s
    const saveBtn = document.getElementById('adp-goal-save-btn');
    const feedback = document.getElementById('adp-goal-saved-feedback');
    if (saveBtn) {
        saveBtn.classList.remove('adp-goal-save-btn--dirty');
        saveBtn.disabled = true;
    }
    if (feedback) {
        feedback.style.opacity = '1';
        feedback.style.transform = 'translateY(0)';
        clearTimeout(_adpSavedFeedbackTimer);
        _adpSavedFeedbackTimer = setTimeout(() => {
            feedback.style.opacity = '0';
            feedback.style.transform = 'translateY(-4px)';
        }, 1800);
    }

    // Re-render das seções dependentes — apenas seções fora do card de Meta, senão o
    // feedback "✓ Salvo" some no re-render. Debounce > tempo do feedback (1800ms).
    clearTimeout(_adpGoalDebounce);
    _adpGoalDebounce = setTimeout(() => {
        try { if (window._currentOverview) renderCampaignInsights(window._currentOverview, 'adp-campaigns'); } catch(_) {}
        // Executive summary só re-renderiza depois do feedback sumir
        setTimeout(() => {
            try { if (window._currentOverview) renderExecutiveSummary(window._currentOverview, _currentDays, 'adp-summary'); } catch(_) {}
        }, 400);
    }, 1800);
};

window.adpTacosInputKey = function(ev) {
    if (ev && ev.key === 'Enter') {
        ev.preventDefault();
        window.adpSaveTacosTarget();
    }
};

// legacy shim — se algo ainda chamar adpEditGoal, abre o input
window.adpEditGoal = function() {
    const el = document.getElementById('adp-goal-inline-input');
    if (el) { el.focus(); el.select(); }
};

window.adpToggleTask = function(idx) {
    const sid = (window._currentOverview && window._currentOverview.seller_id) || '';
    if (!sid) return;
    const stored = rtGetDailyChecklist(sid);
    if (!stored) return;
    stored.items[idx].done = !stored.items[idx].done;
    rtSetDailyChecklist(sid, stored.items);
    if (stored.items[idx].done) rtLogAction(sid, 'tarefa_concluida', stored.items[idx].id, stored.items[idx].text);
    renderEngagementPanel(window._currentOverview, [], 'adp-engagement');
};

// ===== Level system (Bronze → Diamante) =====
const RT_LEVELS = [
    { min: 0,    name: 'Iniciante',    emoji: '🌱', color: '#94a3b8', glow: 'rgba(148,163,184,.4)' },
    { min: 50,   name: 'Bronze',       emoji: '🥉', color: '#d97706', glow: 'rgba(217,119,6,.45)' },
    { min: 200,  name: 'Prata',        emoji: '🥈', color: '#64748b', glow: 'rgba(100,116,139,.45)' },
    { min: 500,  name: 'Ouro',         emoji: '🥇', color: '#eab308', glow: 'rgba(234,179,8,.5)' },
    { min: 1000, name: 'Platina',      emoji: '💎', color: '#0891b2', glow: 'rgba(8,145,178,.5)' },
    { min: 2000, name: 'Diamante',     emoji: '💠', color: '#0066ff', glow: 'rgba(0,102,255,.55)' }
];

function rtCalcXP(sellerId) {
    const history = rtGet(sellerId, 'history', []);
    const diary = rtGet(sellerId, 'diary', []);
    const streak = rtGet(sellerId, 'streak', { current: 0, best: 0 });
    let xp = 0;
    xp += history.length * 10;            // 10 XP por dia visitado
    xp += diary.length * 3;               // 3 XP por ação
    xp += (streak.best || 0) * 5;         // bonus por melhor sequência
    // Bonus por health médio
    if (history.length > 0) {
        const avgHealth = history.reduce((s, h) => s + (h.health || 0), 0) / history.length;
        xp += Math.floor(avgHealth);
    }
    return xp;
}

function rtGetLevel(xp) {
    let lvl = RT_LEVELS[0];
    let next = RT_LEVELS[1] || lvl;
    for (let i = 0; i < RT_LEVELS.length; i++) {
        if (xp >= RT_LEVELS[i].min) {
            lvl = RT_LEVELS[i];
            next = RT_LEVELS[i + 1] || RT_LEVELS[i];
        }
    }
    const range = Math.max(1, next.min - lvl.min);
    const progress = next === lvl ? 100 : Math.min(100, ((xp - lvl.min) / range) * 100);
    return { ...lvl, xp, next, progress, xpToNext: Math.max(0, next.min - xp) };
}

// ===== Scaling streak visual =====
function rtStreakVisual(days) {
    if (days === 0) return { emoji: '💨', label: 'Comece hoje', tier: 0, glow: 'rgba(148,163,184,.3)' };
    if (days < 3)   return { emoji: '✨', label: 'Começando',   tier: 1, glow: 'rgba(59,130,246,.4)' };
    if (days < 7)   return { emoji: '🔥', label: 'Esquentando',  tier: 2, glow: 'rgba(249,115,22,.5)' };
    if (days < 15)  return { emoji: '🔥🔥', label: 'Em chamas',  tier: 3, glow: 'rgba(234,88,12,.55)' };
    if (days < 30)  return { emoji: '🔥🔥🔥', label: 'Pegando fogo', tier: 4, glow: 'rgba(220,38,38,.6)' };
    return { emoji: '🌋', label: 'Lendário', tier: 5, glow: 'rgba(168,85,247,.65)' };
}

// ===== Potencial economia (#8 reframed) =====
function rtCalcPotencialEconomia(overview) {
    const items = (overview.items || []).filter(i => i.has_ads);
    // anúncios com ACOS > 30% OU ROAS < 1
    const wasteful = items.filter(i => (i.acos > 30 && i.cost > 5) || (i._roas > 0 && i._roas < 1 && i.cost > 5));
    if (wasteful.length === 0) return null;
    // potencial = custo dos wasteful * ineficiência relativa
    const target = 20; // ACOS alvo razoável
    let potencial = 0;
    wasteful.forEach(i => {
        const tacos = i.acos || 0;
        if (tacos > target) {
            const overhead = (tacos - target) / tacos;
            potencial += i.cost * overhead;
        }
    });
    return { value: potencial, count: wasteful.length, items: wasteful };
}

// ===== Novidades / sino (#18) =====
function rtCalcNovidades(overview, sellerId) {
    if (!sellerId) return [];
    const currentPeriod = window._currentDays || 30;
    const samePeriod = rtGet(sellerId, 'history', []).filter(h => (h.period || 30) === currentPeriod);
    if (samePeriod.length < 2) return [];
    const cur = samePeriod[samePeriod.length - 1];
    const prev = samePeriod[samePeriod.length - 2];
    const gap = rtDaysBetween(prev.date, cur.date);
    const news = [];
    if (gap >= 1) {
        if (cur.roas > prev.roas + 0.3) news.push(`ROAS subiu ${fmt(cur.roas - prev.roas, 2)}x desde sua última visita`);
        if (cur.tacos < prev.tacos - 0.5) news.push(`TACOS melhorou ${fmt(prev.tacos - cur.tacos, 1)}pp`);
        if (cur.items_with_ads > prev.items_with_ads) news.push(`+${cur.items_with_ads - prev.items_with_ads} novos anúncios com ads`);
        if (cur.cost > prev.cost * 1.5) news.push(`Gasto aumentou ${fmt(((cur.cost/prev.cost)-1)*100, 0)}%`);
    }
    return news;
}

// ======================================================
// Tab notifications (title + favicon badge)
// ======================================================
const ADP_TITLE_BASE = 'Planejador de Ads';

function adpGetDismissedNotifications(sid) {
    const today = rtToday();
    const stored = rtGet(sid, 'notificationsDismissed', null);
    if (stored && stored.date === today) return new Set(stored.ids || []);
    return new Set();
}

function adpSaveDismissedNotifications(sid, idsSet) {
    rtSet(sid, 'notificationsDismissed', { date: rtToday(), ids: Array.from(idsSet) });
}

function adpComputeNotificationCount(overview, alerts) {
    if (!overview || !overview.seller_id) return { count: 0, items: [] };
    const sid = overview.seller_id;
    const dismissed = adpGetDismissedNotifications(sid);

    const items = [];
    // Alertas críticos e warnings
    (alerts || []).forEach(a => {
        if (a.severity === 'critical' || a.severity === 'warning') {
            if (!dismissed.has(a.id)) {
                items.push({ id: a.id, severity: a.severity, title: a.title, message: a.message });
            }
        }
    });
    // Novidades
    const news = rtCalcNovidades(overview, sid);
    news.forEach((n, idx) => {
        const id = 'novidade_' + idx;
        if (!dismissed.has(id)) {
            items.push({ id, severity: 'info', title: 'Novidade', message: n });
        }
    });

    return { count: items.length, items, dismissed };
}

// Cache do favicon original pra restaurar depois
let _adpOriginalFaviconUrl = null;

function adpRemoveCustomFavicon() {
    // Remove nossos overrides; o favicon original (que nunca foi removido) volta a valer
    document.querySelectorAll('link[data-adp-fav="1"]').forEach(l => l.remove());
}

function adpDrawFavicon(count, color) {
    // Sem notificações → remove nosso override e deixa o original aparecer
    if (!count || count <= 0) {
        adpRemoveCustomFavicon();
        return;
    }

    // Captura favicon original na primeira chamada (ignora nossos overrides)
    if (!_adpOriginalFaviconUrl) {
        const originals = document.querySelectorAll('link[rel*="icon"]');
        for (const l of originals) {
            if (l.dataset.adpFav !== '1' && l.href) {
                _adpOriginalFaviconUrl = l.href;
                break;
            }
        }
    }
    if (!_adpOriginalFaviconUrl) return; // nada pra sobrepor

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            // Desenha o favicon original por baixo
            ctx.drawImage(img, 0, 0, size, size);
            // Badge overlay (canto superior direito)
            const bR = 18;
            const bX = size - bR - 2;
            const bY = bR + 2;
            // Ring branco pra destacar do fundo do favicon
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(bX, bY, bR + 3, 0, Math.PI * 2);
            ctx.fill();
            // Círculo do badge
            ctx.fillStyle = color || '#ef4444';
            ctx.beginPath();
            ctx.arc(bX, bY, bR, 0, Math.PI * 2);
            ctx.fill();
            // Número
            ctx.fillStyle = '#fff';
            const txt = count > 9 ? '9+' : String(count);
            ctx.font = 'bold ' + (count > 9 ? 20 : 26) + 'px -apple-system, "DM Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(txt, bX, bY + 2);

            const url = canvas.toDataURL('image/png');
            // Remove overrides antigos (mantém os originais intactos)
            adpRemoveCustomFavicon();
            // Injeta o novo override (sempre DEPOIS do original para o browser usá-lo)
            const link = document.createElement('link');
            link.rel = 'icon';
            link.type = 'image/png';
            link.href = url;
            link.dataset.adpFav = '1';
            document.head.appendChild(link);
        } catch (err) {
            // Canvas tainted por CORS → não conseguimos desenhar. Abortar silenciosamente
            // pra preservar o favicon original sem override quebrado.
            console.warn('Favicon badge: canvas tainted (CORS), keeping original', err);
        }
    };
    img.onerror = () => { /* falha no carregamento: mantém original */ };
    img.src = _adpOriginalFaviconUrl;
}

function adpUpdateTabNotifications(overview, alerts) {
    const result = adpComputeNotificationCount(overview, alerts);
    const count = result.count;
    // Title
    if (count > 0) {
        document.title = `(${count}) ${ADP_TITLE_BASE}`;
    } else {
        document.title = ADP_TITLE_BASE;
    }
    // Favicon badge
    const hasCritical = (result.items || []).some(i => i.severity === 'critical');
    adpDrawFavicon(count, hasCritical ? '#ef4444' : '#f59e0b');
    // Store on window for bell panel
    window._adpNotifications = result;
    return result;
}

window.adpClearAllNotifications = function() {
    const ov = window._currentOverview;
    if (!ov || !ov.seller_id) return;
    const result = window._adpNotifications;
    if (!result) return;
    const sid = ov.seller_id;
    const dismissed = adpGetDismissedNotifications(sid);
    (result.items || []).forEach(i => dismissed.add(i.id));
    adpSaveDismissedNotifications(sid, dismissed);
    // Refresh UI
    adpUpdateTabNotifications(ov, window._currentAlerts || []);
    try { renderRetentionBanner(ov, 'adp-rt-banner'); } catch(_) {}
    // Close panel if open
    const panel = document.getElementById('adp-notifications-panel');
    if (panel) panel.remove();
};

window.adpDismissNotification = function(id) {
    const ov = window._currentOverview;
    if (!ov || !ov.seller_id) return;
    const sid = ov.seller_id;
    const dismissed = adpGetDismissedNotifications(sid);
    dismissed.add(id);
    adpSaveDismissedNotifications(sid, dismissed);
    adpUpdateTabNotifications(ov, window._currentAlerts || []);
    window.adpToggleNotificationsPanel();
    window.adpToggleNotificationsPanel();
};

window.adpToggleNotificationsPanel = function() {
    const existing = document.getElementById('adp-notifications-panel');
    if (existing) { existing.remove(); return; }
    const result = window._adpNotifications;
    if (!result || !result.items.length) return;
    const panel = document.createElement('div');
    panel.id = 'adp-notifications-panel';
    panel.className = 'adp-notif-panel';
    const sevConfig = {
        critical: { color: '#ef4444', icon: '\ud83d\udea8' },
        warning: { color: '#f59e0b', icon: '\u26a0' },
        info: { color: '#0066ff', icon: '\u2139' }
    };
    panel.innerHTML = `
        <div class="adp-notif-header">
            <div>
                <div style="font-weight:800;font-size:0.92rem;">\ud83d\udd14 Notifica\u00e7\u00f5es</div>
                <div style="font-size:0.68rem;color:#64748b;margin-top:2px;">${result.count} pendente${result.count > 1 ? 's' : ''}</div>
            </div>
            <button class="adp-notif-clear-all" onclick="window.adpClearAllNotifications()">Limpar tudo</button>
        </div>
        <div class="adp-notif-list">
            ${result.items.map(i => {
                const cfg = sevConfig[i.severity] || sevConfig.info;
                return `<div class="adp-notif-item" style="--notif-color:${cfg.color};">
                    <div class="adp-notif-icon">${cfg.icon}</div>
                    <div class="adp-notif-body">
                        <div class="adp-notif-title">${escapeHtml(i.title)}</div>
                        <div class="adp-notif-msg">${escapeHtml(i.message)}</div>
                    </div>
                    <button class="adp-notif-x" onclick="window.adpDismissNotification('${i.id.replace(/'/g,'')}')">\u00d7</button>
                </div>`;
            }).join('')}
        </div>
    `;
    document.body.appendChild(panel);
    // click outside to close
    setTimeout(() => {
        const handler = (e) => {
            if (!panel.contains(e.target) && !e.target.closest('.adp-rt-bell')) {
                panel.remove();
                document.removeEventListener('click', handler);
            }
        };
        document.addEventListener('click', handler);
    }, 50);
};

// ===== Render: gamification panel (replaces simple engagement cards with rich visuals) =====
function renderGamificationCards(overview, sellerId) {
    const xp = rtCalcXP(sellerId);
    const lvl = rtGetLevel(xp);
    const streak = rtGet(sellerId, 'streak', { current: 0, best: 0 });
    const sv = rtStreakVisual(streak.current);
    const economia = rtCalcPotencialEconomia(overview);

    // Level card
    const levelHtml = `<div class="adp-rt-card adp-rt-card-glow" style="--glow-color:${lvl.glow};">
        <div class="adp-rt-card-title">${lvl.emoji} Nível</div>
        <div style="font-size:1.3rem;font-weight:800;color:${lvl.color};font-family:'DM Sans',sans-serif;line-height:1.1;letter-spacing:-.02em;">${lvl.name}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin:4px 0;">${fmtInt(xp)} XP</div>
        <div class="adp-rt-bar"><div class="adp-rt-bar-fill" style="width:${lvl.progress}%;background:${lvl.color};"></div></div>
        <div style="font-size:0.66rem;color:var(--text-muted);margin-top:4px;">${lvl.next === lvl ? 'Nível máximo' : fmtInt(lvl.xpToNext)+' XP até '+lvl.next.name}</div>
    </div>`;

    // Streak card with scaling visual
    const streakHtml = `<div class="adp-rt-card adp-rt-card-glow" style="--glow-color:${sv.glow};">
        <div class="adp-rt-card-title">🔥 Sequência</div>
        <div style="font-size:1.6rem;line-height:1;letter-spacing:-.5px;">${sv.emoji}</div>
        <div style="font-size:1.6rem;font-weight:800;font-family:'DM Mono',monospace;color:#d97706;line-height:1;margin-top:4px;" class="adp-count-up" data-target="${streak.current}">${streak.current}</div>
        <div style="font-size:0.72rem;color:var(--text-secondary);">${sv.label} · dia${streak.current!==1?'s':''}</div>
        <div style="font-size:0.66rem;color:var(--text-muted);margin-top:4px;">Recorde: ${streak.best}</div>
    </div>`;

    // Potencial economia card
    let economiaHtml = '';
    if (economia && economia.value > 10) {
        // Stringify apenas os item_ids pra passar pro filtro
        const wastefulIds = (economia.items || []).map(i => i.item_id).join(',');
        economiaHtml = `<div class="adp-rt-card adp-rt-card-glow adp-rt-card-pulse" style="--glow-color:rgba(16,185,129,.5);grid-column:span 2;border-left:4px solid #10b981;">
            <div class="adp-rt-card-title" style="color:#059669;">💰 Potencial economia hoje</div>
            <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-top:4px;">
                <div style="font-size:2rem;font-weight:800;color:#059669;font-family:'DM Mono',monospace;line-height:1;">
                    R$ <span class="adp-count-up" data-target="${Math.round(economia.value)}">0</span>
                </div>
                <div style="font-size:0.78rem;color:var(--text-secondary);">
                    em ${economia.count} an\u00fancio${economia.count>1?'s':''} consumindo margem.
                    <a href="javascript:void(0)" onclick="window.adpFilterWasteful('${wastefulIds}')" style="color:#0066ff;font-weight:700;text-decoration:none;">Ver quais \u2192</a>
                </div>
            </div>
        </div>`;
    }

    return { levelHtml, streakHtml, economiaHtml };
}

// ===== Animation helpers =====
function adpAnimateNumbers(container) {
    if (!container) return;
    const els = container.querySelectorAll('.adp-count-up:not(.adp-counted)');
    els.forEach(el => {
        const target = parseFloat(el.dataset.target || el.textContent) || 0;
        const start = 0;
        // duration scales with magnitude (small numbers feel snappier)
        const duration = Math.min(1200, 600 + Math.log10(Math.max(1, Math.abs(target))) * 200);
        const startTime = performance.now();
        const decimals = (target % 1 !== 0) ? 2 : 0;
        el.classList.add('adp-counted');
        const fmt = (v) => decimals === 0
            ? Math.round(v).toLocaleString('pt-BR')
            : v.toFixed(decimals).replace('.', ',');
        const tick = (now) => {
            const t = Math.min(1, (now - startTime) / duration);
            // expo-out easing: starts fast, decelerates smoothly
            const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
            const val = start + (target - start) * eased;
            el.textContent = fmt(val);
            if (t < 1) requestAnimationFrame(tick);
            else el.textContent = fmt(target);
        };
        requestAnimationFrame(tick);
    });
}

function adpConfetti() {
    const colors = ['#0066ff', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
    const root = document.createElement('div');
    root.className = 'adp-confetti-root';
    for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'adp-confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = (Math.random() * 0.4) + 's';
        piece.style.animationDuration = (1.6 + Math.random() * 1.4) + 's';
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        root.appendChild(piece);
    }
    document.body.appendChild(root);
    setTimeout(() => root.remove(), 3500);
}

// ===== Bell / novidades (#18) =====
function renderNovidadesBell(overview, sellerId) {
    if (!sellerId) return '';
    // Usa notification count unificado (alertas + novidades, minus dismissed)
    const result = window._adpNotifications || adpComputeNotificationCount(overview, window._currentAlerts || []);
    if (!result || !result.count) return '';
    return `<div class="adp-rt-bell" onclick="event.stopPropagation();window.adpToggleNotificationsPanel()" title="Notifica\u00e7\u00f5es">
        <span class="adp-rt-bell-icon">\ud83d\udd14</span>
        <span class="adp-rt-bell-badge">${result.count > 9 ? '9+' : result.count}</span>
    </div>`;
}

window.adpToggleNovidades = function() {
    window.adpToggleNotificationsPanel();
};

// ===== Share result card (trading-inspired) =====
// Tier config — Mercado Líder levels + Loja Oficial
function adpGetTierConfig(sellerInfo) {
    const status = (sellerInfo?.power_seller_status || '').toLowerCase();
    const hasOfficialStore = !!sellerInfo?.official_store_id;

    const tiers = {
        'platinum': {
            name: 'Mercado Líder · Platinum',
            chipLabel: '\u2666 Mercado L\u00edder \u00b7 Platinum',
            short: 'PLATINUM',
            // Radial violet gradient
            bgInner: '#3a1a78',      // radial center 1
            bgInner2: '#4a1d96',     // radial center 2
            bgBase: '#08021a',        // base deep
            topBar: ['#7c3aed', '#c4b5fd', '#ffffff', '#c4b5fd', '#7c3aed'],
            logoGrad: ['#ffffff', '#c4b5fd'],
            logoTextColor: '#08021a',
            nameColor: '#ffffff',
            chipBg: 'rgba(196,181,253,0.12)',
            chipBorder: 'rgba(196,181,253,0.4)',
            chipText: '#e9d5ff',
            statColor: '#f3e8ff',
            subColor: 'rgba(233, 213, 255, 0.55)'
        },
        'gold': {
            name: 'Mercado Líder · Gold',
            chipLabel: '\u2605 Mercado L\u00edder \u00b7 Gold',
            short: 'GOLD',
            bgInner: '#3a2a05',
            bgInner2: null,
            bgBase: '#0d0803',
            topBar: ['#854d0e', '#facc15', '#fbbf24', '#854d0e'],
            logoGrad: ['#fbbf24', '#d97706'],
            logoTextColor: '#0d0803',
            nameColor: '#fef3c7',
            chipBg: 'rgba(251,191,36,0.12)',
            chipBorder: 'rgba(251,191,36,0.4)',
            chipText: '#fde68a',
            statColor: '#fef3c7',
            subColor: 'rgba(254, 243, 199, 0.55)'
        },
        'silver': {
            name: 'Mercado Líder · Silver',
            chipLabel: '\u25c6 Mercado L\u00edder \u00b7 Silver',
            short: 'SILVER',
            bgInner: '#2a2e3a',
            bgInner2: null,
            bgBase: '#0a0c12',
            topBar: ['#64748b', '#e5e7eb', '#64748b'],
            logoGrad: ['#e5e7eb', '#94a3b8'],
            logoTextColor: '#0a0c12',
            nameColor: '#f1f5f9',
            chipBg: 'rgba(226,232,240,0.1)',
            chipBorder: 'rgba(226,232,240,0.3)',
            chipText: '#e2e8f0',
            statColor: '#e2e8f0',
            subColor: 'rgba(226, 232, 240, 0.55)'
        },
        'default': {
            name: 'Vendedor Mercado Livre',
            chipLabel: 'Vendedor Mercado Livre',
            short: '',
            bgInner: '#0f1e3d',
            bgInner2: null,
            bgBase: '#05080f',
            topBar: ['#0066ff', '#10b981'],
            logoGrad: ['#0066ff', '#0066ff'],
            logoTextColor: '#ffffff',
            nameColor: '#ffffff',
            chipBg: 'rgba(0,102,255,0.12)',
            chipBorder: 'rgba(0,102,255,0.3)',
            chipText: '#60a5fa',
            statColor: '#ffffff',
            subColor: 'rgba(255, 255, 255, 0.55)'
        }
    };

    const tier = tiers[status] || tiers['default'];
    tier.hasOfficialStore = hasOfficialStore;
    return tier;
}

// Helper: rounded rect path
function adpRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

window.adpShareResult = function() {
    const ov = window._currentOverview;
    if (!ov) return;
    const agg = ov.aggregated || {};
    const tacos = agg.avg_tacos || 0;
    const roas = agg.overall_roas || 0;
    const acos = agg.avg_acos || 0;
    const cost = agg.total_cost || 0;
    const revenue = agg.total_revenue || 0;
    const days = _currentDays || 30;
    const tier = adpGetTierConfig(ov.seller_info);

    // Delta: first half vs second half
    const daily = ov.daily_aggregated || [];
    let roasDelta = null;
    if (daily.length >= 4) {
        const mid = Math.floor(daily.length / 2);
        const first = daily.slice(0, mid);
        const second = daily.slice(mid);
        const fCost = first.reduce((s,d)=>s+(parseFloat(d.cost)||0),0);
        const fRev = first.reduce((s,d)=>s+(parseFloat(d.total_amount)||0),0);
        const sCost = second.reduce((s,d)=>s+(parseFloat(d.cost)||0),0);
        const sRev = second.reduce((s,d)=>s+(parseFloat(d.total_amount)||0),0);
        const fRoas = fCost > 0 ? fRev / fCost : 0;
        const sRoas = sCost > 0 ? sRev / sCost : 0;
        if (fRoas > 0) roasDelta = ((sRoas - fRoas) / fRoas) * 100;
    }

    // Sparkline data: daily ROAS
    const sparkData = daily.map(d => {
        const c = parseFloat(d.cost) || 0;
        const r = parseFloat(d.total_amount) || 0;
        return c > 0 ? r / c : 0;
    });

    const W = 1080, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const M = 80; // margin

    // ============================================
    // BACKGROUND: radial gradient top-right (base) + optional second radial (platinum)
    // ============================================
    ctx.fillStyle = tier.bgBase;
    ctx.fillRect(0, 0, W, H);
    // Radial 1 — top right
    const rg1 = ctx.createRadialGradient(W * 0.85, 80, 40, W * 0.85, 80, 900);
    rg1.addColorStop(0, tier.bgInner);
    rg1.addColorStop(0.7, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg1;
    ctx.fillRect(0, 0, W, H);
    // Radial 2 — bottom left (platinum only, blue when oficial)
    if (tier.bgInner2) {
        const rg2color = tier.hasOfficialStore ? '#1e3a8a' : tier.bgInner2;
        const rg2 = ctx.createRadialGradient(W * 0.15, H - 100, 40, W * 0.15, H - 100, 900);
        rg2.addColorStop(0, rg2color);
        rg2.addColorStop(0.7, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg2;
        ctx.fillRect(0, 0, W, H);
    }

    // ============================================
    // TOP BAR (linha fina no topo com gradiente do tier)
    // ============================================
    const topBarStops = tier.hasOfficialStore && tier.short === 'PLATINUM'
        ? ['#7c3aed', '#3b82f6', '#ffffff', '#3b82f6', '#7c3aed']
        : tier.topBar;
    const topBar = ctx.createLinearGradient(0, 0, W, 0);
    topBarStops.forEach((c, i) => topBar.addColorStop(i / (topBarStops.length - 1), c));
    ctx.fillStyle = topBar;
    ctx.fillRect(0, 0, W, 6);

    // ============================================
    // HEADER: logo + marca + (check oficial) + data à direita
    // ============================================
    const headerY = 120;
    // Logo circle com gradient
    const logoR = 34;
    const logoX = M + logoR;
    const logoGrad = ctx.createLinearGradient(logoX - logoR, headerY - logoR, logoX + logoR, headerY + logoR);
    logoGrad.addColorStop(0, tier.logoGrad[0]);
    logoGrad.addColorStop(1, tier.logoGrad[1]);
    ctx.fillStyle = logoGrad;
    ctx.beginPath();
    ctx.arc(logoX, headerY, logoR, 0, Math.PI * 2);
    ctx.fill();
    // Letra M
    ctx.fillStyle = tier.logoTextColor;
    ctx.font = 'bold 36px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', logoX, headerY);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Brand "marketfacil ·"
    const brandX = logoX + logoR + 18;
    ctx.fillStyle = tier.nameColor;
    ctx.font = '800 38px "DM Sans", sans-serif';
    const brandText = 'marketfacil';
    ctx.fillText(brandText, brandX, headerY + 13);
    const brandW = ctx.measureText(brandText).width;
    ctx.fillStyle = tier.chipText;
    ctx.fillText(' ·', brandX + brandW, headerY + 13);

    // Check azul de verificação (Loja Oficial) ao lado da marca
    if (tier.hasOfficialStore) {
        const checkX = brandX + brandW + 32;
        const checkY = headerY;
        const checkR = 16;
        // Glow
        ctx.shadowColor = 'rgba(59, 130, 246, 0.7)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(checkX, checkY, checkR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Checkmark
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(checkX - 7, checkY);
        ctx.lineTo(checkX - 2, checkY + 5);
        ctx.lineTo(checkX + 7, checkY - 5);
        ctx.stroke();
        ctx.lineCap = 'butt';
    }

    // Data à direita
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getFullYear()).slice(-2)} · ${days}D`;
    ctx.fillStyle = tier.subColor;
    ctx.font = '500 22px "DM Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(dateStr, W - M, headerY + 8);
    ctx.textAlign = 'left';

    // ============================================
    // TIER CHIPS (e chip extra "Loja Oficial" se aplicável)
    // ============================================
    const chipY = 220;
    const drawChip = (x, y, label, bg, border, text) => {
        const padX = 24, padY = 14;
        ctx.font = '800 18px "DM Sans", sans-serif';
        const tw = ctx.measureText(label).width;
        const w = tw + padX * 2;
        const h = 44;
        // bg
        ctx.fillStyle = bg;
        adpRoundRect(ctx, x, y, w, h, h / 2);
        ctx.fill();
        // border
        ctx.strokeStyle = border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // text
        ctx.fillStyle = text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y + h / 2 + 1);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        return w;
    };
    const chip1W = drawChip(M, chipY, tier.chipLabel, tier.chipBg, tier.chipBorder, tier.chipText);
    // Loja Oficial chip (alinhado ao lado do tier chip)
    if (tier.hasOfficialStore) {
        drawChip(M + chip1W + 12, chipY, '\u2713 Loja Oficial', 'rgba(59,130,246,0.15)', 'rgba(59,130,246,0.5)', '#93c5fd');
    }

    // ============================================
    // LABEL "ROAS · Últimos X dias"
    // ============================================
    const labelY = 330;
    ctx.fillStyle = tier.subColor;
    ctx.font = '700 20px "DM Sans", sans-serif';
    ctx.fillText(`ROAS · Últimos ${days} dias`, M, labelY);

    // ============================================
    // BIG ROAS VALUE (verde grande estilo PnL)
    // ============================================
    const roasColor = roas >= 3 ? '#10b981' : roas >= 1 ? '#f59e0b' : '#ef4444';
    const bigY = 470;
    ctx.fillStyle = roasColor;
    ctx.font = '700 170px "DM Mono", monospace';
    ctx.fillText(`${fmt(roas, 2)}x`, M, bigY);

    // Delta
    const deltaY = bigY + 55;
    ctx.fillStyle = roasColor;
    ctx.font = '700 28px "DM Mono", monospace';
    let deltaText;
    if (roasDelta != null) {
        const arrow = roasDelta >= 0 ? '\u25b2' : '\u25bc';
        const sign = roasDelta >= 0 ? '+' : '';
        deltaText = `${arrow} ${sign}${fmt(roasDelta, 2)}%`;
    } else {
        deltaText = '\u25b2 em análise';
    }
    ctx.fillText(deltaText, M, deltaY);

    // ============================================
    // SPARKLINE (chart de evolução do ROAS)
    // ============================================
    const chartX = M, chartY = deltaY + 30, chartW = W - M * 2, chartH = 140;
    if (sparkData.length >= 2) {
        const nonZero = sparkData.filter(v => v > 0);
        const max = nonZero.length ? Math.max(...nonZero) : 1;
        const min = nonZero.length ? Math.min(...nonZero) : 0;
        const range = Math.max(0.01, max - min);

        // Fill gradient
        const fillGrad = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
        fillGrad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
        fillGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');

        ctx.beginPath();
        sparkData.forEach((v, i) => {
            const x = chartX + (i / (sparkData.length - 1)) * chartW;
            const norm = v > 0 ? (v - min) / range : 0;
            const y = chartY + chartH - norm * chartH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        // Close fill
        ctx.lineTo(chartX + chartW, chartY + chartH);
        ctx.lineTo(chartX, chartY + chartH);
        ctx.closePath();
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Line
        ctx.beginPath();
        sparkData.forEach((v, i) => {
            const x = chartX + (i / (sparkData.length - 1)) * chartW;
            const norm = v > 0 ? (v - min) / range : 0;
            const y = chartY + chartH - norm * chartH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.lineCap = 'butt';
    }

    // ============================================
    // STATS ROW (4 colunas)
    // ============================================
    const statsY = chartY + chartH + 50;
    // Linha superior
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M, statsY - 24);
    ctx.lineTo(W - M, statsY - 24);
    ctx.stroke();

    const statCols = [
        { label: 'TACOS', value: `${fmt(tacos, 1)}%` },
        { label: 'ACOS', value: `${fmt(acos, 1)}%` },
        { label: 'GASTO', value: fmtMoney(cost) },
        { label: 'FATURAMENTO', value: fmtMoney(revenue) }
    ];
    const colW = (W - M * 2) / 4;
    statCols.forEach((s, i) => {
        const x = M + i * colW;
        // label
        ctx.fillStyle = tier.subColor;
        ctx.font = '700 14px "DM Sans", sans-serif';
        ctx.fillText(s.label, x, statsY);
        // value
        ctx.fillStyle = tier.statColor;
        ctx.font = '700 26px "DM Mono", monospace';
        ctx.fillText(s.value, x, statsY + 36);
    });

    // ============================================
    // FOOTER (URL · Instagram)
    // ============================================
    const footY = H - 50;
    ctx.fillStyle = tier.subColor;
    ctx.font = '500 18px "DM Mono", monospace';
    ctx.fillText('app.marketfacil.com.br', M, footY);
    ctx.textAlign = 'right';
    ctx.fillText('@market.facil', W - M, footY);
    ctx.textAlign = 'left';

    // --- DOWNLOAD via toDataURL (mais confi\u00e1vel que toBlob) ---
    try {
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `marketfacil-${tier.short ? tier.short.toLowerCase() + '-' : ''}${rtToday()}.png`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            try { document.body.removeChild(a); } catch(_) {}
        }, 100);
    } catch (err) {
        console.error('Erro ao gerar imagem:', err);
        alert('N\u00e3o foi poss\u00edvel gerar a imagem. Tente novamente.');
    }
    const sid = ov.seller_id;
    if (sid) rtLogAction(sid, 'share', 'result_card_' + (tier.short || 'default'), '');
};

window.adpToggleWatch = function(itemId, btn) {
    const sid = (window._currentOverview && window._currentOverview.seller_id) || '';
    if (!sid) return;
    const isWatched = rtToggleWatch(sid, itemId);
    if (btn) btn.textContent = isWatched ? '⭐' : '☆';
    rtLogAction(sid, isWatched ? 'watch_add' : 'watch_remove', itemId, '');
    // Update filter badge count
    try { _renderTableUI('adp-table'); } catch(_) {}
    // Update watchlist progress bar
    try { renderWatchlistProgress(window._currentOverview, 'adp-rt-watch'); } catch(_) {}
};

// ===== Render: Watchlist progress (#3) =====
function renderWatchlistProgress(overview, containerId) {
    const c = document.getElementById(containerId);
    if (!c || !overview || !overview.seller_id) { if (c) c.innerHTML = ''; return; }
    const sid = overview.seller_id;
    const watchIds = rtGet(sid, 'watchlist', []);
    if (!watchIds.length) { c.innerHTML = ''; return; }
    const items = (overview.items || []).filter(i => watchIds.indexOf(i.item_id) >= 0);
    if (!items.length) { c.innerHTML = ''; return; }

    // Compare to snapshots
    const watchSnap = rtGet(sid, 'watchSnapshots', {});
    let improved = 0, worsened = 0, stable = 0;
    items.forEach(it => {
        const prev = watchSnap[it.item_id];
        const curRoas = it._roas || 0;
        if (prev != null) {
            if (curRoas > prev * 1.1) improved++;
            else if (curRoas < prev * 0.9) worsened++;
            else stable++;
        }
        watchSnap[it.item_id] = curRoas;
    });
    rtSet(sid, 'watchSnapshots', watchSnap);

    c.innerHTML = `<div class="adp-rt-watchbar">
        ⭐ <b>${items.length}</b> em observação:
        ${improved>0?`<span style="color:#059669;">▲ ${improved} melhorou</span>`:''}
        ${worsened>0?`<span style="color:#dc2626;">▼ ${worsened} piorou</span>`:''}
        ${stable>0?`<span style="color:#64748b;">• ${stable} estável</span>`:''}
        ${(improved+worsened+stable===0)?`<span style="color:#64748b;">comparativo na próxima visita</span>`:''}
    </div>`;
}

// ===== Render: Revision reminders (#20 - 15 days) =====
function renderRevisionReminders(overview, containerId) {
    const c = document.getElementById(containerId);
    if (!c || !overview || !overview.seller_id) { if (c) c.innerHTML = ''; return; }
    const sid = overview.seller_id;
    const need = rtCampaignsNeedingRevision(sid, overview.campaigns || []);
    if (!need.length) { c.innerHTML = ''; return; }
    const list = need.slice(0, 5).map(c2 => {
        const cid = c2.campaign_id || c2.id || '';
        return `
        <li>
            <span>${escapeHtml(c2.name || cid)}</span>
            <button class="adp-rt-link" onclick="window.adpMarkRevised('${escapeHtml(cid)}')">marcar como revisado</button>
        </li>
    `;
    }).join('');
    c.innerHTML = `<div class="adp-rt-revcard">
        <div class="adp-rt-card-title">🔔 Revisão a cada ${RT_REVISION_DAYS} dias</div>
        <div style="font-size:0.72rem;color:var(--text-secondary);margin-bottom:6px;">${need.length} campanha(s) sem revisão há ${RT_REVISION_DAYS}+ dias:</div>
        <ul class="adp-rt-revlist">${list}</ul>
    </div>`;
}

window.adpMarkRevised = function(campaignId) {
    const sid = (window._currentOverview && window._currentOverview.seller_id) || '';
    if (!sid) return;
    rtMarkCampaignRevised(sid, campaignId);
    if (window._currentOverview) renderRevisionReminders(window._currentOverview, 'adp-revisions');
};

// ===== Render: Top/Bottom percentile insights (#17) + Highlights (#14) =====
function renderHighlightsAndBenchmark(overview, itemDetails, containerId) {
    const c = document.getElementById(containerId);
    if (!c || !overview) { if (c) c.innerHTML = ''; return; }
    const items = (overview.items || []).filter(i => i.has_ads && (i._roas || 0) > 0);
    if (items.length < 4) { c.innerHTML = ''; return; }
    const sorted = [...items].sort((a, b) => (b._roas || 0) - (a._roas || 0));
    const winner = sorted[0];
    const loser = sorted[sorted.length - 1];
    const top10 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.1)));
    const bot10 = sorted.slice(-Math.max(1, Math.ceil(sorted.length * 0.1)));
    const avg = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0) / arr.length;
    const topCtr = avg(top10, x => x.ctr) * 100;
    const botCtr = avg(bot10, x => x.ctr) * 100;
    const topCvr = avg(top10, x => x._cvr || 0) * 100;
    const botCvr = avg(bot10, x => x._cvr || 0) * 100;

    const winnerTitle = (itemDetails[winner.item_id] && itemDetails[winner.item_id].title) || winner.item_id;
    const loserTitle = (itemDetails[loser.item_id] && itemDetails[loser.item_id].title) || loser.item_id;
    const winnerD = itemDetails[winner.item_id] || {};
    const loserD = itemDetails[loser.item_id] || {};
    const priceLine = (d) => {
        const p = d.price || 0;
        const op = d.original_price || 0;
        if (!p) return '';
        if (op > p) {
            const dp = ((op - p) / op) * 100;
            return `<div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px;"><span style="font-family:'DM Mono',monospace;font-weight:600;color:var(--green-dark);">${fmtMoney(p)}</span> <span style="text-decoration:line-through;">${fmtMoney(op)}</span> <span style="color:var(--green-dark);font-weight:700;">-${fmt(dp, 0)}%</span></div>`;
        }
        return `<div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px;font-family:'DM Mono',monospace;">${fmtMoney(p)}</div>`;
    };

    c.innerHTML = `
        <div class="adp-section-title">⭐ Destaques da Semana <span style="font-weight:400;font-size:0.68rem;text-transform:none;color:var(--text-muted);margin-left:8px;">O que os melhores anúncios têm em comum</span></div>
        <div class="adp-rt-grid">
            <div class="adp-rt-card" style="border-left:4px solid #10b981;">
                <div class="adp-rt-card-title" style="color:#059669;">🏆 Anúncio Vencedor</div>
                <div style="font-size:0.78rem;font-weight:600;color:var(--text);margin:4px 0;">${escapeHtml(winnerTitle.slice(0, 60))}</div>
                ${priceLine(winnerD)}
                <div style="font-size:1.2rem;font-weight:700;font-family:'DM Mono',monospace;color:#059669;margin-top:4px;">ROAS ${fmt(winner._roas, 2)}x</div>
                ${winnerD.permalink ? `<a href="${escapeHtml(winnerD.permalink)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:0.62rem;background:#fff159;color:#222;border:1px solid #d6c500;padding:3px 8px;border-radius:3px;text-decoration:none;font-weight:700;">🔗 Ver no ML</a>` : ''}
            </div>
            <div class="adp-rt-card" style="border-left:4px solid #ef4444;">
                <div class="adp-rt-card-title" style="color:#dc2626;">⚠ Precisa de Atenção</div>
                <div style="font-size:0.78rem;font-weight:600;color:var(--text);margin:4px 0;">${escapeHtml(loserTitle.slice(0, 60))}</div>
                ${priceLine(loserD)}
                <div style="font-size:1.2rem;font-weight:700;font-family:'DM Mono',monospace;color:#dc2626;margin-top:4px;">ROAS ${fmt(loser._roas, 2)}x</div>
                ${loserD.permalink ? `<a href="${escapeHtml(loserD.permalink)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:0.62rem;background:#fff159;color:#222;border:1px solid #d6c500;padding:3px 8px;border-radius:3px;text-decoration:none;font-weight:700;">🔗 Ver no ML</a>` : ''}
            </div>
            <div class="adp-rt-card" style="grid-column:span 2;">
                <div class="adp-rt-card-title">📊 Top 10% vs Bottom 10% (sua conta)</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.78rem;margin-top:6px;">
                    <div><b>CTR médio:</b><br><span style="color:#059669;font-family:'DM Mono',monospace;">${fmt(topCtr, 2)}%</span> vs <span style="color:#dc2626;font-family:'DM Mono',monospace;">${fmt(botCtr, 2)}%</span></div>
                    <div><b>Conversão média:</b><br><span style="color:#059669;font-family:'DM Mono',monospace;">${fmt(topCvr, 2)}%</span> vs <span style="color:#dc2626;font-family:'DM Mono',monospace;">${fmt(botCvr, 2)}%</span></div>
                </div>
                <div style="font-size:0.7rem;color:var(--text-muted);margin-top:8px;">Os melhores anúncios têm CTR ${topCtr>botCtr?(fmt(topCtr/Math.max(botCtr,0.01),1)+'x maior'):'similar'} e conversão ${topCvr>botCvr?(fmt(topCvr/Math.max(botCvr,0.01),1)+'x maior'):'similar'}.</div>
            </div>
        </div>`;
}

// ══════════════════════════════════════════════════════
// Section 1: Auth & Data Fetching
// ══════════════════════════════════════════════════════

async function fetchAccessToken() {
    try {
        const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (d?.response?.access_token) return d.response.access_token;
        throw new Error('Token not found');
    } catch (e) {
        console.error('Erro ao buscar Access Token:', e.message);
        return null;
    }
}

async function fetchAdsOverview(token_, days = 30, limit = 500) {
    let token = token_;
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = now.toISOString().split('T')[0];

    // Check cache (chave inclui limit pra evitar mistura de runs com tamanhos diferentes)
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.days === days && parsed.limit === limit && Date.now() - parsed.ts < CACHE_TTL) {
                return parsed.data;
            }
        }
    } catch (_) {}

    const url = `${API_ADS_OVERVIEW}?date_from=${from}&date_to=${to}&limit=${limit}`;
    let resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    // Retry on 401 (token may not be ready on first load)
    if (resp.status === 401) {
        console.warn('Token 401, aguardando 3s e tentando novamente...');
        await new Promise(r => setTimeout(r, 3000));
        const newToken = await fetchAccessToken();
        if (newToken) token = newToken;
        resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // Cache
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, days, limit, ts: Date.now() }));
    } catch (_) {}

    return data;
}

const ITEM_DETAILS_CACHE_KEY = 'adp_item_details_cache';
const ITEM_DETAILS_CACHE_VERSION = 2; // bump pra invalidar caches velhos corrompidos
const ITEM_DETAILS_CACHE_TTL = 60 * 60 * 1000; // 1h

// Valida entry do cache — rejeita shells vazios de execuções com erro
function _isValidItemDetail(entry) {
    return !!(entry && typeof entry === 'object' && typeof entry.title === 'string' && entry.title.length > 0);
}

function _loadItemCache() {
    try {
        const raw = sessionStorage.getItem(ITEM_DETAILS_CACHE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        // Invalida caches de versões antigas
        if (parsed.version !== ITEM_DETAILS_CACHE_VERSION) {
            sessionStorage.removeItem(ITEM_DETAILS_CACHE_KEY);
            return {};
        }
        if (Date.now() - (parsed.ts || 0) > ITEM_DETAILS_CACHE_TTL) return {};
        // Filtra shells inválidos (title vazio) pra forçar re-fetch
        const data = parsed.data || {};
        const clean = {};
        for (const id in data) {
            if (_isValidItemDetail(data[id])) clean[id] = data[id];
        }
        return clean;
    } catch (_) { return {}; }
}
function _saveItemCache(cache) {
    try {
        // Garante que só entries válidas são persistidas
        const clean = {};
        for (const id in cache) {
            if (_isValidItemDetail(cache[id])) clean[id] = cache[id];
        }
        sessionStorage.setItem(ITEM_DETAILS_CACHE_KEY, JSON.stringify({
            version: ITEM_DETAILS_CACHE_VERSION,
            ts: Date.now(),
            data: clean
        }));
    } catch (_) {}
}

async function fetchItemDetails(itemIds, token) {
    if (!itemIds.length) return {};
    const cache = _loadItemCache();
    const details = {};
    // Hit cache first
    const missing = [];
    for (const id of itemIds) {
        if (cache[id]) details[id] = cache[id];
        else missing.push(id);
    }
    if (missing.length === 0) return details;

    const BATCH_SIZE = 20;
    const POOL_SIZE = 5;       // batches simultâneos máx — protege o proxy do rate limit
    const MAX_RETRIES = 2;     // retries por batch/item antes de desistir

    const parseItems = (data) => {
        const arr = Array.isArray(data) ? data : (data.body ? [data] : []);
        for (const item of arr) {
            const body = item.body || item;
            // Só aceita items com título real — evita poluir cache com shells
            if (body && body.id && body.title && body.title.length > 0) {
                const thumb = (body.secure_thumbnail || body.thumbnail || '').replace(/^http:\/\//, 'https://');
                details[body.id] = {
                    title: body.title,
                    thumbnail: thumb,
                    price: body.price || 0,
                    original_price: body.original_price || 0,
                    category_id: body.category_id || '',
                    permalink: body.permalink || ''
                };
            }
        }
    };

    const batches = [];
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        batches.push(missing.slice(i, i + BATCH_SIZE));
    }

    // Phase 1: pool de batches com retry por batch (em vez de Promise.all em tudo).
    // Concorrência limitada protege o proxy de rate limit; retry trata 429/timeout.
    const fetchBatch = async (batch, attempt = 0) => {
        try {
            const resp = await fetch(`${API_FETCH_ITEM}?item_id=${batch.join(',')}&skip_description=true`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (resp.ok) {
                parseItems(await resp.json());
                return [];
            }
            // 429/5xx merece retry com backoff; 4xx outros, vai pra phase 2
            if ((resp.status === 429 || resp.status >= 500) && attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
                return fetchBatch(batch, attempt + 1);
            }
            return batch.slice();
        } catch (_) {
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
                return fetchBatch(batch, attempt + 1);
            }
            return batch.slice();
        }
    };

    let nextBatch = 0;
    const failedIds = [];
    const batchWorker = async () => {
        while (nextBatch < batches.length) {
            const idx = nextBatch++;
            const failed = await fetchBatch(batches[idx]);
            if (failed.length) failedIds.push(...failed);
        }
    };
    const workers = Array(Math.min(POOL_SIZE, batches.length)).fill(0).map(batchWorker);
    await Promise.all(workers);

    // Phase 2: itens individuais com retry — falha de 1 item só perde 1 item
    if (failedIds.length > 0) {
        const fetchSingle = async (id, attempt = 0) => {
            try {
                const resp = await fetch(`${API_FETCH_ITEM}?item_id=${id}&skip_description=true`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resp.ok) {
                    parseItems(await resp.json());
                    return true;
                }
                if ((resp.status === 429 || resp.status >= 500) && attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
                    return fetchSingle(id, attempt + 1);
                }
                return false;
            } catch (_) {
                if (attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
                    return fetchSingle(id, attempt + 1);
                }
                return false;
            }
        };

        let nextSingle = 0;
        const stillFailed = [];
        const singleWorker = async () => {
            while (nextSingle < failedIds.length) {
                const idx = nextSingle++;
                const ok = await fetchSingle(failedIds[idx]);
                if (!ok) stillFailed.push(failedIds[idx]);
            }
        };
        const singleWorkers = Array(Math.min(3, failedIds.length)).fill(0).map(singleWorker);
        await Promise.all(singleWorkers);

        if (stillFailed.length > 0) {
            console.warn(`[ads-planner] ${stillFailed.length} de ${missing.length} anúncios ficaram sem detalhes/thumbnail após retries`);
        }
    }

    // Update cache with everything we got
    Object.assign(cache, details);
    _saveItemCache(cache);
    return details;
}

async function fetchVisitsBulk(itemIds, token, dateFrom, dateTo) {
    if (!itemIds.length) return {};
    const allVisits = {};
    // Try bulk endpoint first (batches of 20 to avoid ML API limits)
    const batches = [];
    for (let i = 0; i < itemIds.length; i += 20) {
        batches.push(itemIds.slice(i, i + 20));
    }
    for (const batch of batches) {
        try {
            const ids = batch.join(',');
            const resp = await fetch(`${API_FETCH_VISITS_BULK}?items=${ids}&date_from=${dateFrom}&date_to=${dateTo}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (resp.ok) {
                const data = await resp.json();
                // ML API returns object with item_id keys containing total_visits
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    for (const [id, val] of Object.entries(data)) {
                        allVisits[id] = val;
                    }
                } else if (Array.isArray(data)) {
                    for (const item of data) {
                        if (item.item_id) allVisits[item.item_id] = item;
                    }
                }
            } else {
                // Fallback: fetch visits individually via time_window
                for (const id of batch) {
                    try {
                        const r = await fetch(`${BASE_URL_PROXY}/api/fetch-visits?item_id=${id}&date_from=${dateFrom}&date_to=${dateTo}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (r.ok) allVisits[id] = await r.json();
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }
    return allVisits;
}

// ══════════════════════════════════════════════════════
// Fase 2: endpoints paginados que delegam sort/filter ao ML
// ══════════════════════════════════════════════════════

const API_ADS_AGGREGATED = `${BASE_URL_PROXY}/api/ads-aggregated`;
const API_ADS_ITEMS = `${BASE_URL_PROXY}/api/ads-items`;
const AGG_CACHE_KEY = 'adp_aggregated_cache_v2';

// Busca agregados da conta inteira em UMA chamada ao proxy (que faz 2 ao ML).
// Retorna KPIs + série diária + lista de campanhas + count total da conta.
async function fetchAdsAggregated(token_, days = 30) {
    let token = token_;
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = now.toISOString().split('T')[0];

    // Cache
    try {
        const cached = sessionStorage.getItem(AGG_CACHE_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.days === days && Date.now() - parsed.ts < CACHE_TTL) return parsed.data;
        }
    } catch (_) {}

    const url = `${API_ADS_AGGREGATED}?date_from=${from}&date_to=${to}`;
    let resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

    // Retry 401 com token novo
    if (resp.status === 401) {
        await new Promise(r => setTimeout(r, 2500));
        const newToken = await fetchAccessToken();
        if (newToken) token = newToken;
        resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    try { sessionStorage.setItem(AGG_CACHE_KEY, JSON.stringify({ data, days, ts: Date.now() })); } catch (_) {}
    return data;
}

// Busca página de items via /ads-items. params é objeto com chaves opcionais:
//  date_from, date_to, offset, limit, sort_by, sort,
//  min_prints, min_clicks, min_cost, min_revenue, min_orders, q,
//  filters (objeto: { campaign_id, statuses, channel }),
//  advertiser_id, site_id (opcionais — passa pra evitar refetch no proxy).
async function fetchAdsItemsPage(token_, params = {}) {
    let token = token_;
    const qs = new URLSearchParams();
    for (const k of ['date_from','date_to','offset','limit','sort_by','sort','min_prints','min_clicks','min_cost','min_revenue','min_orders','q','advertiser_id','site_id']) {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') qs.append(k, params[k]);
    }
    if (params.filters && typeof params.filters === 'object') {
        for (const [fk, fv] of Object.entries(params.filters)) {
            if (fv !== undefined && fv !== null && fv !== '') qs.append(`filters[${fk}]`, fv);
        }
    }
    const url = `${API_ADS_ITEMS}?${qs.toString()}`;

    let resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (resp.status === 401) {
        await new Promise(r => setTimeout(r, 2500));
        const newToken = await fetchAccessToken();
        if (newToken) token = newToken;
        resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
}

// ══════════════════════════════════════════════════════
// Section 2: Alert Engine
// ══════════════════════════════════════════════════════

function generateAlerts(overview, itemDetails) {
    const alerts = [];
    const agg = overview.aggregated;
    if (!agg) return alerts;

    const id = (cat, key) => `${cat}_${key}`;
    const daily = overview.daily_aggregated || [];

    // ── ALERTAS OBJETIVOS (independem de margem/categoria) ──

    // ROAS < 1 = perdendo dinheiro (fato, nao opiniao)
    if (agg.total_cost > 0 && agg.overall_roas < THRESHOLDS.roas_critical) {
        alerts.push({ id: id('roas','critical'), severity: 'critical', category: 'roas',
            title: 'Perdendo Dinheiro em Ads', message: `Seu ROAS geral est\u00e1 em ${fmt(agg.overall_roas)}x. Voc\u00ea gasta mais em ads do que gera de receita com eles.`,
            action: 'Revise sua estrat\u00e9gia. Pause an\u00fancios com pior desempenho e otimize antes de reinvestir.' });
    }

    // Dependencia de ads
    const adsSalesPct = (agg.total_revenue + agg.organic_revenue) > 0 ? (agg.total_revenue / (agg.total_revenue + agg.organic_revenue)) * 100 : 0;
    if (adsSalesPct > THRESHOLDS.ads_dependency_critical) {
        alerts.push({ id: id('dependency','critical'), severity: 'critical', category: 'dependency',
            title: 'Alta Depend\u00eancia de Ads', message: `${fmt(adsSalesPct, 0)}% do faturamento vem de ads. Sua opera\u00e7\u00e3o depende excessivamente de publicidade paga.`,
            action: 'Invista em otimiza\u00e7\u00e3o de listagens (atributos, fotos, reputa\u00e7\u00e3o, pre\u00e7o competitivo) para aumentar vendas org\u00e2nicas.' });
    } else if (adsSalesPct > THRESHOLDS.ads_dependency_warning) {
        alerts.push({ id: id('dependency','warning'), severity: 'warning', category: 'dependency',
            title: 'Depend\u00eancia de Ads Elevada', message: `${fmt(adsSalesPct, 0)}% do faturamento vem de ads.`,
            action: 'Equilibre investimento em ads com otimiza\u00e7\u00e3o de listagens para tr\u00e1fego org\u00e2nico.' });
    }

    // ── ALERTAS DE TENDENCIA (baseados em dados, nao em thresholds fixos) ──
    if (daily.length >= 6) {
        const mid = Math.floor(daily.length / 2);
        const firstHalf = daily.slice(0, mid);
        const secondHalf = daily.slice(mid);
        const avgField = (arr, field) => {
            const vals = arr.filter(d => d[field] != null);
            return vals.length ? vals.reduce((s, d) => s + (parseFloat(d[field]) || 0), 0) / vals.length : 0;
        };
        const calcTrendPct = (first, second) => first > 0 ? ((second - first) / first) * 100 : 0;

        // Impressoes em queda (>30%)
        const impTrend = calcTrendPct(avgField(firstHalf, 'prints'), avgField(secondHalf, 'prints'));
        if (impTrend < -30) {
            alerts.push({ id: id('trend','impressions_down'), severity: 'warning', category: 'trend',
                title: 'Impress\u00f5es em Queda', message: `Impress\u00f5es ca\u00edram ${fmt(Math.abs(impTrend), 0)}% no per\u00edodo.`,
                action: 'Verifique or\u00e7amento (pode estar sendo esgotado cedo), competitividade de lances, ou mudan\u00e7as no marketplace.' });
        }

        // Cliques subindo + conversao caindo
        const clicksTrend = calcTrendPct(avgField(firstHalf, 'clicks'), avgField(secondHalf, 'clicks'));
        const cvr1 = avgField(firstHalf, 'clicks') > 0 ? (avgField(firstHalf, 'units_quantity') / avgField(firstHalf, 'clicks')) * 100 : 0;
        const cvr2 = avgField(secondHalf, 'clicks') > 0 ? (avgField(secondHalf, 'units_quantity') / avgField(secondHalf, 'clicks')) * 100 : 0;
        const cvrTrend = calcTrendPct(cvr1, cvr2);
        if (clicksTrend > 20 && cvrTrend < -20) {
            alerts.push({ id: id('trend','traffic_no_conv'), severity: 'warning', category: 'trend',
                title: 'Tr\u00e1fego Sem Convers\u00e3o', message: 'Cliques aumentaram mas convers\u00e3o caiu. Poss\u00edvel problema na p\u00e1gina do an\u00fancio.',
                action: 'Revise pre\u00e7o, estoque e qualidade da p\u00e1gina. O tr\u00e1fego est\u00e1 chegando mas n\u00e3o convertendo.' });
        }

        // Investimento vs faturamento (eficiencia de escala)
        const costGrowth = calcTrendPct(
            firstHalf.reduce((s, d) => s + (parseFloat(d.cost) || 0), 0),
            secondHalf.reduce((s, d) => s + (parseFloat(d.cost) || 0), 0));
        const revGrowth = calcTrendPct(
            firstHalf.reduce((s, d) => s + (parseFloat(d.total_amount) || 0) + (parseFloat(d.organic_units_amount) || 0), 0),
            secondHalf.reduce((s, d) => s + (parseFloat(d.total_amount) || 0) + (parseFloat(d.organic_units_amount) || 0), 0));
        // Alerta quando investimento sobe mais que vendas (escala ineficiente)
        if (costGrowth > 10 && costGrowth > revGrowth) {
            alerts.push({ id: id('trend','cost_outpacing_revenue'), severity: 'warning', category: 'trend',
                title: 'Escala Ineficiente', message: `Investimento subiu ${fmt(costGrowth, 0)}% mas vendas subiram apenas ${fmt(revGrowth, 0)}%.`,
                action: 'O aumento de investimento n\u00e3o est\u00e1 gerando retorno proporcional. Otimize listagens antes de investir mais.' });
        }

        // Canibalizacao de organico — comparando cliques de ads vs vendas organicas
        const adsClicksFirst = firstHalf.reduce((s, d) => s + (parseFloat(d.clicks) || 0), 0);
        const adsClicksSecond = secondHalf.reduce((s, d) => s + (parseFloat(d.clicks) || 0), 0);
        const adsGrowth = calcTrendPct(adsClicksFirst, adsClicksSecond);

        const orgUnitsFirst = firstHalf.reduce((s, d) => s + (parseFloat(d.organic_units_quantity) || 0), 0);
        const orgUnitsSecond = secondHalf.reduce((s, d) => s + (parseFloat(d.organic_units_quantity) || 0), 0);
        const orgUnitsGrowth = calcTrendPct(orgUnitsFirst, orgUnitsSecond);

        // Cenario 1: cliques ads sobem MUITO mas vendas organicas caem = canibalizacao classica
        if (adsGrowth > 15 && orgUnitsGrowth < -10) {
            alerts.push({ id: id('trend','cannibalization_sales'), severity: 'warning', category: 'trend',
                title: 'Canibaliza\u00e7\u00e3o de Vendas Org\u00e2nicas', message: `Cliques por ads cresceram ${fmt(adsGrowth, 0)}% mas vendas org\u00e2nicas ca\u00edram ${fmt(Math.abs(orgUnitsGrowth), 0)}%.`,
                action: 'Ads podem estar substituindo vendas que viriam organicamente. Reduza lances em termos de marca pr\u00f3pria ou produtos j\u00e1 com bom rank org\u00e2nico.' });
        }

        // Cenario 2: cliques ads sobem mas % organico do total cai (mesmo se vendas absolutas estaveis)
        // Compara composicao primeiro vs segundo periodo
        const adsClicksFirstSum = adsClicksFirst;
        const adsClicksSecondSum = adsClicksSecond;
        const orgFirstAmount = firstHalf.reduce((s, d) => s + (parseFloat(d.organic_units_amount) || 0), 0);
        const orgSecondAmount = secondHalf.reduce((s, d) => s + (parseFloat(d.organic_units_amount) || 0), 0);
        const adsFirstAmount = firstHalf.reduce((s, d) => s + (parseFloat(d.total_amount) || 0), 0);
        const adsSecondAmount = secondHalf.reduce((s, d) => s + (parseFloat(d.total_amount) || 0), 0);
        const orgPctFirst = (orgFirstAmount + adsFirstAmount) > 0 ? (orgFirstAmount / (orgFirstAmount + adsFirstAmount)) * 100 : 0;
        const orgPctSecond = (orgSecondAmount + adsSecondAmount) > 0 ? (orgSecondAmount / (orgSecondAmount + adsSecondAmount)) * 100 : 0;

        if (adsGrowth > 20 && (orgPctFirst - orgPctSecond) > 10 && orgPctFirst > 0) {
            alerts.push({ id: id('trend','cannibalization_traffic'), severity: 'warning', category: 'trend',
                title: 'Visitas Pagas Canibalizando Org\u00e2nicas', message: `Cliques por ads cresceram ${fmt(adsGrowth, 0)}% e a participa\u00e7\u00e3o de vendas org\u00e2nicas caiu de ${fmt(orgPctFirst, 0)}% para ${fmt(orgPctSecond, 0)}%.`,
                action: 'O aumento de tr\u00e1fego pago pode estar substituindo o tr\u00e1fego org\u00e2nico em vez de adicionar a ele. Considere reduzir lances onde voc\u00ea j\u00e1 tem boa posi\u00e7\u00e3o org\u00e2nica.' });
        }

        // Organico diminuindo como % do total
        const orgPct1 = (avgField(firstHalf, 'organic_units_amount') / (avgField(firstHalf, 'total_amount') + avgField(firstHalf, 'organic_units_amount') || 1)) * 100;
        const orgPct2 = (avgField(secondHalf, 'organic_units_amount') / (avgField(secondHalf, 'total_amount') + avgField(secondHalf, 'organic_units_amount') || 1)) * 100;
        if (orgPct1 > 0 && (orgPct1 - orgPct2) > 15) {
            alerts.push({ id: id('trend','organic_dependency'), severity: 'warning', category: 'trend',
                title: 'Depend\u00eancia de Ads Crescente', message: 'O percentual de vendas org\u00e2nicas est\u00e1 diminuindo no per\u00edodo.',
                action: 'Invista em SEO do marketplace para n\u00e3o depender exclusivamente de ads.' });
        }
    }

    // ── ALERTAS PER-ITEM RELATIVOS (comparando com a media da conta) ──
    const items = (overview.items || []).filter(i => i.has_ads);
    const avgCtr = agg.avg_ctr || 0;
    const avgCvr = agg.avg_cvr || 0;
    // Rollups: agrupar CTR/CVR abaixo da m\u00e9dia num \u00fanico alerta (evita spam de 20+)
    const lowCtrIds = [];
    const lowCvrIds = [];

    for (const item of items) {
        const title = escapeHtml(itemDetails[item.item_id]?.title || item.item_id);
        const shortTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;

        // Gasto sem vendas (objetivo)
        if (item.cost > 50 && item.orders === 0) {
            alerts.push({ id: id('item', `${item.item_id}_no_sales`), severity: 'warning', category: 'item', item_id: item.item_id,
                title: 'Gasto Sem Retorno', message: `"${shortTitle}" gastou ${fmtMoney(item.cost)} sem nenhuma venda.`,
                action: 'Pause e avalie se o an\u00fancio est\u00e1 otimizado antes de reativar.' });
        }

        // ROAS < 1 por item (objetivo)
        const itemRoas = item.cost > 0 ? item.revenue / item.cost : 0;
        if (item.cost > 10 && itemRoas > 0 && itemRoas < 1) {
            alerts.push({ id: id('item', `${item.item_id}_roas`), severity: 'warning', category: 'item', item_id: item.item_id,
                title: 'An\u00fancio com Preju\u00edzo', message: `"${shortTitle}" tem ROAS de ${fmt(itemRoas)}x. Gastando mais do que fatura.`,
                action: 'Revise este an\u00fancio. Otimize ou reduza o lance.' });
        }

        // CTR muito abaixo da media da CONTA → rollup
        if (avgCtr > 0 && item.ctr < avgCtr * (1 - THRESHOLDS.relative_deviation) && item.impressions > 500) {
            lowCtrIds.push(item.item_id);
        }

        // Conversao muito abaixo da media da CONTA → rollup
        if (avgCvr > 0 && item.cvr < avgCvr * (1 - THRESHOLDS.relative_deviation) && item.clicks > 20) {
            lowCvrIds.push(item.item_id);
        }
    }

    // Rollup CTR
    if (lowCtrIds.length > 0) {
        alerts.push({
            id: id('rollup', 'low_ctr'),
            severity: 'info',
            category: 'rollup',
            rollup_ids: lowCtrIds,
            title: `${lowCtrIds.length} an\u00fancio${lowCtrIds.length > 1 ? 's com' : ' com'} CTR abaixo da m\u00e9dia`,
            message: `M\u00e9dia da conta: ${fmt(avgCtr)}%. Esses an\u00fancios est\u00e3o performando pelo menos 50% abaixo.`,
            action: 'Revise caracter\u00edsticas e fotos (n\u00e3o altere o t\u00edtulo, isso destr\u00f3i a relev\u00e2ncia).',
            filterFn: 'adpFilterLowCtr'
        });
    }
    // Rollup CVR
    if (lowCvrIds.length > 0) {
        alerts.push({
            id: id('rollup', 'low_cvr'),
            severity: 'info',
            category: 'rollup',
            rollup_ids: lowCvrIds,
            title: `${lowCvrIds.length} an\u00fancio${lowCvrIds.length > 1 ? 's com' : ' com'} convers\u00e3o abaixo da m\u00e9dia`,
            message: `M\u00e9dia da conta: ${fmt(avgCvr)}%. Esses an\u00fancios est\u00e3o performando pelo menos 50% abaixo.`,
            action: 'Compare pre\u00e7o, fotos e condi\u00e7\u00f5es com seus outros an\u00fancios que convertem melhor.',
            filterFn: 'adpFilterLowCvr'
        });
    }

    // ── ORÇAMENTO LIMITANDO ENTREGA (regra crítica pro algoritmo ML) ──
    // Se a campanha gasta quase todo o orçamento diário, o ML não tem janela
    // completa pra calcular ROAS real e otimizar a entrega. Isso reduz performance.
    const campaignsForBudget = overview.campaigns || [];
    const itemsForBudget = overview.items || [];
    const constrainedCampaigns = [];
    for (const camp of campaignsForBudget) {
        if (!camp.budget || camp.budget <= 0) continue;
        const campCost = getCampaignMetrics(camp, itemsForBudget).cost;
        if (campCost <= 0) continue;
        const dailyAvgCost = campCost / (_currentDays || 30);
        const usage = (dailyAvgCost / camp.budget) * 100;
        if (usage >= 80) {
            constrainedCampaigns.push({ name: camp.name || camp.campaign_id, usage, budget: camp.budget, dailyAvgCost });
        }
    }
    if (constrainedCampaigns.length > 0) {
        const worst = constrainedCampaigns.sort((a,b) => b.usage - a.usage)[0];
        const names = constrainedCampaigns.slice(0, 3).map(c => c.name).join(', ');
        const severity = constrainedCampaigns.filter(c => c.usage >= 95).length > 0 ? 'critical' : 'warning';
        alerts.push({
            id: id('budget','constrained'),
            severity,
            category: 'budget',
            title: constrainedCampaigns.length === 1 ? 'Or\u00e7amento Limitando Entrega' : `${constrainedCampaigns.length} Campanhas com Or\u00e7amento Limitante`,
            message: `${names}${constrainedCampaigns.length > 3 ? ' e outras' : ''} est\u00e3o gastando ${fmt(worst.usage, 0)}% ou mais do or\u00e7amento di\u00e1rio. O Mercado Livre usa dados de 24h pra calcular ROAS e decidir entrega \u2014 se o or\u00e7amento acaba cedo, o algoritmo n\u00e3o tem janela completa e sua entrega cai nos dias seguintes.`,
            action: 'Aumente o or\u00e7amento di\u00e1rio das campanhas limitadas pra dar fol\u00f4go ao algoritmo do ML. Sem isso, fica muito mais dif\u00edcil bater sua meta de ROAS.'
        });
    }

    // Sort: critical > warning > info, then by financial impact
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => {
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
            return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return 0;
    });

    return alerts;
}

function renderAlertsPanel(alerts, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Filter dismissed
    let dismissed = [];
    try { dismissed = JSON.parse(sessionStorage.getItem('adp_dismissed_alerts') || '[]'); } catch(_) {}
    const visible = alerts.filter(a => !dismissed.includes(a.id));

    if (visible.length === 0) {
        container.innerHTML = '';
        return;
    }

    const icons = { critical: '\u26a0\ufe0f', warning: '\u26a1', info: '\u2139\ufe0f' };
    const maxShow = 3;
    const showAll = visible.length <= maxShow;

    let html = `<div class="adp-alerts-panel">
        <div class="adp-alerts-header">
            <span class="adp-alerts-title">Alertas Autom\u00e1ticos</span>
            <span class="adp-alerts-count">${visible.length} alerta${visible.length > 1 ? 's' : ''}</span>
        </div>`;

    // Action buttons baseados no tipo de alerta
    const getActionButton = (a) => {
        // Rollup alerts com filterFn → filtra IDs agregados
        if (a.filterFn && window[a.filterFn]) {
            const n = a.rollup_ids ? a.rollup_ids.length : 0;
            return `<button class="adp-alert-action-btn" onclick="window.${a.filterFn}()">\ud83d\udc49 Ver ${n} an\u00fancio${n > 1 ? 's' : ''} na tabela</button>`;
        }
        // Alerta de item específico → filtra só esse item
        if (a.item_id) {
            return `<button class="adp-alert-action-btn" onclick="window.adpFilterSingleItem('${a.item_id}')">\ud83d\udc49 Ver este an\u00fancio na tabela</button>`;
        }
        // Alerta de categoria "budget" → scroll pra campanhas
        if (a.category === 'budget') {
            return `<button class="adp-alert-action-btn" onclick="document.getElementById('adp-campaigns').scrollIntoView({behavior:'smooth'})">\ud83d\udc49 Ver campanhas afetadas</button>`;
        }
        // Alerta ROAS < 1 geral → filtra anúncios com ROAS < 1
        if (a.id === 'roas_critical' || a.category === 'roas') {
            return `<button class="adp-alert-action-btn" onclick="window.adpFilterLowRoas()">\ud83d\udc49 Ver an\u00fancios com ROAS < 1</button>`;
        }
        return '';
    };

    const renderAlert = (a, hidden = false) => `
        <div class="adp-alert ${a.severity}" data-alert-id="${a.id}" ${hidden ? 'style="display:none"' : ''}>
            <span class="adp-alert-icon">${icons[a.severity]}</span>
            <div class="adp-alert-body">
                <div class="adp-alert-title">${a.title}</div>
                <div class="adp-alert-message">${a.message}</div>
                <div class="adp-alert-action">${a.action}</div>
                ${getActionButton(a)}
            </div>
            <button class="adp-alert-dismiss" onclick="window.dismissAlert('${a.id}')" title="Fechar">\u00d7</button>
        </div>`;

    visible.forEach((a, i) => {
        html += renderAlert(a, !showAll && i >= maxShow);
    });

    if (!showAll) {
        html += `<div class="adp-alerts-expand" id="adp-alerts-expand-btn">
            <button onclick="window.toggleAlerts()">Ver mais ${visible.length - maxShow} alertas</button>
        </div>
        <div class="adp-alerts-expand" id="adp-alerts-collapse-btn" style="display:none;">
            <button onclick="window.toggleAlerts()">Mostrar menos</button>
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

window.dismissAlert = function(alertId) {
    let dismissed = [];
    try { dismissed = JSON.parse(sessionStorage.getItem('adp_dismissed_alerts') || '[]'); } catch(_) {}
    dismissed.push(alertId);
    sessionStorage.setItem('adp_dismissed_alerts', JSON.stringify(dismissed));
    const el = document.querySelector(`[data-alert-id="${alertId}"]`);
    if (el) el.style.display = 'none';
};

window.toggleAlerts = function() {
    const expandBtn = document.getElementById('adp-alerts-expand-btn');
    const collapseBtn = document.getElementById('adp-alerts-collapse-btn');
    const isExpanded = expandBtn?.style.display === 'none';

    if (isExpanded) {
        // Colapsar: esconder alertas alem do maxShow (3)
        const allAlerts = document.querySelectorAll('.adp-alert');
        allAlerts.forEach((el, i) => { if (i >= 3) el.style.display = 'none'; });
        if (expandBtn) expandBtn.style.display = '';
        if (collapseBtn) collapseBtn.style.display = 'none';
    } else {
        // Expandir: mostrar todos
        const hidden = document.querySelectorAll('.adp-alert[style*="display:none"]');
        hidden.forEach(el => el.style.display = '');
        if (expandBtn) expandBtn.style.display = 'none';
        if (collapseBtn) collapseBtn.style.display = '';
    }
};

// ══════════════════════════════════════════════════════
// Section 3: Dashboard Overview
// ══════════════════════════════════════════════════════

function calcTrend(daily, field) {
    if (!daily || daily.length < 4) return null;
    const mid = Math.floor(daily.length / 2);
    const sum = (arr) => arr.reduce((s, d) => s + (parseFloat(d[field]) || 0), 0);
    const first = sum(daily.slice(0, mid)) / mid;
    const second = sum(daily.slice(mid)) / (daily.length - mid);
    if (first === 0) return null;
    return ((second - first) / first) * 100;
}

function calcRatioTrend(daily, numField, denField) {
    if (!daily || daily.length < 4) return null;
    const mid = Math.floor(daily.length / 2);
    const ratio = (arr) => {
        const num = arr.reduce((s, d) => s + (parseFloat(d[numField]) || 0), 0);
        const den = arr.reduce((s, d) => s + (parseFloat(d[denField]) || 0), 0);
        return den > 0 ? num / den : 0;
    };
    const first = ratio(daily.slice(0, mid));
    const second = ratio(daily.slice(mid));
    if (first === 0) return null;
    return ((second - first) / first) * 100;
}

function trendBadge(pct, invertColor = false) {
    if (pct == null || isNaN(pct)) return '<span class="adp-trend-neutral">—</span>';
    const abs = Math.abs(pct);
    if (abs < 1) return '<span class="adp-trend-neutral">~0%</span>';
    const arrow = pct > 0 ? '\u2191' : '\u2193';
    let cls;
    if (invertColor) {
        cls = pct > 0 ? 'adp-trend-up-bad' : 'adp-trend-down-good';
    } else {
        cls = pct > 0 ? 'adp-trend-up' : 'adp-trend-down';
    }
    return `<span class="${cls}">${arrow} ${abs >= 500 ? '>500' : fmt(abs, 0)}%</span>`;
}

function renderDashboardOverview(overview, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const agg = overview.aggregated;
    const daily = overview.daily_aggregated || [];

    if (!agg || overview.total_items_with_ads === 0) {
        container.innerHTML = `<div class="adp-empty">
            <div class="adp-empty-icon">\ud83d\udcca</div>
            <div class="adp-empty-title">Nenhum Product Ads Ativo</div>
            <div class="adp-empty-text">Voc\u00ea ainda n\u00e3o possui an\u00fancios com Product Ads ativos. Ative Product Ads no Mercado Livre para come\u00e7ar a visualizar dados aqui.</div>
            <div style="margin-top:16px;padding:16px;background:var(--blue-light);border-radius:var(--radius-sm);max-width:500px;margin-left:auto;margin-right:auto;">
                <div style="font-size:0.82rem;font-weight:600;color:var(--blue);margin-bottom:4px;">Como ativar Product Ads?</div>
                <div style="font-size:0.78rem;color:var(--text-secondary);">1. Acesse o Mercado Livre &gt; Publicidade<br>2. Selecione os an\u00fancios que deseja promover<br>3. Defina or\u00e7amento e estrat\u00e9gia<br>4. Volte aqui para acompanhar os resultados</div>
            </div>
        </div>`;
        return;
    }

    // Low data warning
    const lowData = agg.total_cost < 1 && agg.total_impressions < 100;
    const lowDataBanner = lowData ? `<div style="background:var(--yellow-light);border:1px solid var(--yellow);border-radius:var(--radius-sm);padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.1rem;">\ud83d\udca1</span>
        <div>
            <div style="font-size:0.82rem;font-weight:600;color:var(--yellow-dark);">Poucos dados dispon\u00edveis</div>
            <div style="font-size:0.75rem;color:var(--text-secondary);">Seus ads ainda est\u00e3o come\u00e7ando. As m\u00e9tricas e alertas ficar\u00e3o mais precisos conforme voc\u00ea acumular mais dados. Considere aumentar o or\u00e7amento ou esperar alguns dias.</div>
        </div>
    </div>` : '';

    // Metric cards
    const costTrend = calcTrend(daily, 'cost');
    const revTrend = calcTrend(daily, 'total_amount');
    const acosTrend = calcRatioTrend(daily, 'cost', 'total_amount');
    const tacosTrend = (() => {
        if (!daily || daily.length < 4) return null;
        const mid = Math.floor(daily.length / 2);
        const ratio = (arr) => {
            const cost = arr.reduce((s, d) => s + (parseFloat(d.cost) || 0), 0);
            const rev = arr.reduce((s, d) => s + (parseFloat(d.total_amount) || 0) + (parseFloat(d.organic_units_amount) || 0), 0);
            return rev > 0 ? cost / rev : 0;
        };
        const f = ratio(daily.slice(0, mid));
        const s = ratio(daily.slice(mid));
        return f > 0 ? ((s - f) / f) * 100 : null;
    })();
    const roasTrend = (() => {
        if (!daily || daily.length < 4) return null;
        const mid = Math.floor(daily.length / 2);
        const ratio = (arr) => {
            const rev = arr.reduce((s, d) => s + (parseFloat(d.total_amount) || 0), 0);
            const cost = arr.reduce((s, d) => s + (parseFloat(d.cost) || 0), 0);
            return cost > 0 ? rev / cost : 0;
        };
        const f = ratio(daily.slice(0, mid));
        const s = ratio(daily.slice(mid));
        return f > 0 ? ((s - f) / f) * 100 : null;
    })();

    // Cores baseadas em fatos objetivos (ROAS < 1 = prejuizo)
    const roasColor = agg.overall_roas < THRESHOLDS.roas_critical && agg.total_cost > 0 ? 'text-red' : '';

    // === Status cr\u00edtico por KPI (Gap C) \u2014 destacar visualmente quando muito fora da meta
    const tacosTargetCard = window._tacosTarget || 0;
    const adsPctRatioCard = (agg.total_revenue + agg.organic_revenue) > 0 ? (agg.total_revenue / (agg.total_revenue + agg.organic_revenue)) : 0;
    const roasNeededCard = (tacosTargetCard > 0 && adsPctRatioCard > 0) ? (adsPctRatioCard * 100 / tacosTargetCard) : 0;

    // Severity: 'critical' = vermelho intenso, 'warning' = amarelo, '' = neutro
    const tacosSeverity = (tacosTargetCard > 0 && agg.avg_tacos > 0)
        ? (agg.avg_tacos > tacosTargetCard * 2 ? 'critical' : agg.avg_tacos > tacosTargetCard * 1.3 ? 'warning' : '')
        : '';
    const acosSeverity = agg.avg_acos > 50 ? 'critical' : agg.avg_acos > 30 ? 'warning' : '';
    const roasSeverity = (agg.total_cost > 0 && (agg.total_revenue || 0) <= 0) ? 'critical'
        : (agg.overall_roas > 0 && agg.overall_roas < 1) ? 'critical'
        : (roasNeededCard > 0 && agg.overall_roas > 0 && agg.overall_roas < roasNeededCard * 0.5) ? 'critical'
        : (roasNeededCard > 0 && agg.overall_roas > 0 && agg.overall_roas < roasNeededCard) ? 'warning'
        : '';
    const custoSeverity = (agg.total_cost > 0 && (agg.total_revenue || 0) <= 0) ? 'critical' : '';
    const fatSeverity = (agg.total_cost > 50 && (agg.total_revenue || 0) <= 0) ? 'critical' : '';

    // Inline styles (sem depender de mudan\u00e7as de CSS)
    const sevStyle = (sev) => {
        if (sev === 'critical') return 'border:2px solid #dc2626 !important;background:linear-gradient(135deg,#fef2f2,#fff);box-shadow:0 0 0 2px rgba(220,38,38,0.12);';
        if (sev === 'warning') return 'border:2px solid #d97706 !important;background:linear-gradient(135deg,#fffbeb,#fff);box-shadow:0 0 0 2px rgba(217,119,6,0.12);';
        return '';
    };
    const sevBadge = (sev, label) => {
        if (sev === 'critical') return `<div style="position:absolute;top:-8px;right:8px;font-size:0.55rem;font-weight:800;background:#dc2626;color:#fff;padding:2px 6px;border-radius:3px;letter-spacing:.3px;text-transform:uppercase;">\u26a0 ${label || 'Fora da meta'}</div>`;
        if (sev === 'warning') return `<div style="position:absolute;top:-8px;right:8px;font-size:0.55rem;font-weight:800;background:#d97706;color:#fff;padding:2px 6px;border-radius:3px;letter-spacing:.3px;text-transform:uppercase;">\u26a0 Aten\u00e7\u00e3o</div>`;
        return '';
    };
    const sevValColor = (sev) => sev === 'critical' ? 'color:#dc2626;' : sev === 'warning' ? 'color:#b45309;' : '';

    let html = lowDataBanner + `<div class="adp-metrics-grid">
        <div class="adp-metric-card" title="Total investido em Product Ads no per\u00edodo" style="position:relative;${sevStyle(custoSeverity)}">
            ${sevBadge(custoSeverity, 'Sem retorno')}
            <div class="adp-metric-label">Gasto em Ads</div>
            <div class="adp-metric-value" style="${sevValColor(custoSeverity)}">${fmtMoney(agg.total_cost)}</div>
            <div class="adp-metric-trend">${trendBadge(costTrend, true)}</div>
        </div>
        <div class="adp-metric-card" title="Receita gerada diretamente por cliques em ads" style="position:relative;${sevStyle(fatSeverity)}">
            ${sevBadge(fatSeverity, 'Zero vendas')}
            <div class="adp-metric-label">Faturamento Ads</div>
            <div class="adp-metric-value" style="${sevValColor(fatSeverity)}">${fmtMoney(agg.total_revenue)}</div>
            <div class="adp-metric-trend">${trendBadge(revTrend)}</div>
        </div>
        <div class="adp-metric-card" title="Custo de publicidade sobre vendas por ads. ACOS = Gasto \u00f7 Faturamento Ads" style="position:relative;${sevStyle(acosSeverity)}">
            ${sevBadge(acosSeverity)}
            <div class="adp-metric-label">ACOS Geral</div>
            <div class="adp-metric-value" style="${sevValColor(acosSeverity)}">${fmt(agg.avg_acos)}%</div>
            <div class="adp-metric-trend">${trendBadge(acosTrend, true)}</div>
        </div>
        <div class="adp-metric-card" title="Custo de publicidade sobre faturamento TOTAL (ads + org\u00e2nico). TACOS = Gasto \u00f7 Faturamento Total. \u00c9 o que consome sua margem.${tacosTargetCard > 0 ? ' Sua meta: ' + fmt(tacosTargetCard) + '%' : ''}" style="position:relative;${sevStyle(tacosSeverity)}">
            ${sevBadge(tacosSeverity, tacosSeverity === 'critical' ? 'Muito fora da meta' : '')}
            <div class="adp-metric-label">TACOS Geral${tacosTargetCard > 0 ? ` <span style="font-size:0.55rem;color:var(--text-muted);font-weight:500;">(meta ${fmt(tacosTargetCard)}%)</span>` : ''}</div>
            <div class="adp-metric-value" style="${sevValColor(tacosSeverity)}">${fmt(agg.avg_tacos)}%</div>
            <div class="adp-metric-trend">${trendBadge(tacosTrend, true)}</div>
        </div>
        <div class="adp-metric-card" title="Retorno sobre investimento em ads. ROAS = Faturamento Ads \u00f7 Gasto. Acima de 1x = lucro, abaixo = preju\u00edzo.${roasNeededCard > 0 ? ' ROAS necess\u00e1rio pra meta de TACOS: ' + fmt(roasNeededCard) + 'x' : ''}" style="position:relative;${sevStyle(roasSeverity)}">
            ${sevBadge(roasSeverity, roasSeverity === 'critical' ? (agg.overall_roas < 1 && agg.total_cost > 0 ? 'Preju\u00edzo' : 'Muito abaixo') : '')}
            <div class="adp-metric-label">ROAS Geral${roasNeededCard > 0 ? ` <span style="font-size:0.55rem;color:var(--text-muted);font-weight:500;">(precisa ${fmt(roasNeededCard)}x)</span>` : ''}</div>
            <div class="adp-metric-value ${roasColor}" style="${sevValColor(roasSeverity)}">${fmt(agg.overall_roas)}x</div>
            <div class="adp-metric-trend">${trendBadge(roasTrend)}</div>
        </div>
        <div class="adp-metric-card" title="Quantidade de an\u00fancios que possuem Product Ads ativo">
            <div class="adp-metric-label">An\u00fancios com Ads</div>
            <div class="adp-metric-value">${overview.total_items_with_ads}</div>
            <div class="adp-metric-trend text-muted">de ${overview.total_items} ativos</div>
        </div>
    </div>`;

    // Navy ticker bar com tendencias
    const adsSalesPct = agg.ads_sales_pct || ((agg.total_revenue + agg.organic_revenue) > 0 ? (agg.total_revenue / (agg.total_revenue + agg.organic_revenue)) * 100 : 0);

    // Calcular trends das metricas do ticker
    const impTrendTicker = calcTrend(daily, 'prints');
    const clicksTrendTicker = calcTrend(daily, 'clicks');
    const ctrTrendTicker = calcRatioTrend(daily, 'clicks', 'prints');
    const cvrTrendTicker = calcRatioTrend(daily, 'units_quantity', 'clicks');
    const cpcTrendTicker = calcRatioTrend(daily, 'cost', 'clicks');
    const adsSalesPctTrend = (() => {
        if (!daily || daily.length < 4) return null;
        const mid = Math.floor(daily.length / 2);
        const ratio = (arr) => {
            const ads = arr.reduce((s, d) => s + (parseFloat(d.total_amount) || 0), 0);
            const total = arr.reduce((s, d) => s + (parseFloat(d.total_amount) || 0) + (parseFloat(d.organic_units_amount) || 0), 0);
            return total > 0 ? ads / total : 0;
        };
        const f = ratio(daily.slice(0, mid));
        const s = ratio(daily.slice(mid));
        return f > 0 ? ((s - f) / f) * 100 : null;
    })();

    // Mini trend badge para ticker (mais compacto, cor branca)
    const tickerTrend = (pct, invert = false) => {
        if (pct == null || isNaN(pct)) return '';
        const abs = Math.abs(pct);
        if (abs < 1) return '<span style="font-size:0.55rem;color:rgba(255,255,255,0.4);">\u2014</span>';
        const arrow = pct > 0 ? '\u2191' : '\u2193';
        let color;
        if (invert) color = pct > 0 ? '#ff6b8a' : '#4ade80';
        else color = pct > 0 ? '#4ade80' : '#ff6b8a';
        return `<span style="font-size:0.55rem;color:${color};font-weight:600;margin-left:4px;">${arrow}${abs >= 500 ? '>500' : fmt(abs, 0)}%</span>`;
    };

    html += `<div class="adp-ticker-bar">
        <div class="adp-ticker-item">
            <div class="adp-ticker-label">Impress\u00f5es</div>
            <div class="adp-ticker-value">${fmtInt(agg.total_impressions)}${tickerTrend(impTrendTicker)}</div>
        </div>
        <div class="adp-ticker-item">
            <div class="adp-ticker-label">Cliques</div>
            <div class="adp-ticker-value">${fmtInt(agg.total_clicks)}${tickerTrend(clicksTrendTicker)}</div>
        </div>
        <div class="adp-ticker-item">
            <div class="adp-ticker-label">CTR M\u00e9dio</div>
            <div class="adp-ticker-value">${fmt(agg.avg_ctr)}%${tickerTrend(ctrTrendTicker)}</div>
        </div>
        <div class="adp-ticker-item">
            <div class="adp-ticker-label">Convers\u00e3o</div>
            <div class="adp-ticker-value">${fmt(agg.avg_cvr)}%${tickerTrend(cvrTrendTicker)}</div>
        </div>
        <div class="adp-ticker-item">
            <div class="adp-ticker-label">CPC M\u00e9dio</div>
            <div class="adp-ticker-value">${fmtMoney(agg.avg_cpc)}${tickerTrend(cpcTrendTicker, true)}</div>
        </div>
        <div class="adp-ticker-item">
            <div class="adp-ticker-label">% Vendas via Ads</div>
            <div class="adp-ticker-value">${fmt(adsSalesPct, 1)}%${tickerTrend(adsSalesPctTrend, true)}</div>
        </div>
    </div>`;

    container.innerHTML = html;
}

// ══════════════════════════════════════════════════════
// Section 4: Simulator Enhanced
// ══════════════════════════════════════════════════════

function renderSimulator(overview, containerId, activeDays) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const agg = overview.aggregated;
    if (!agg) return;

    // Extrapolate monthly
    const daysInData = activeDays || 30;
    const factor = 30 / daysInData;
    const monthlyRevenue = (agg.total_revenue + agg.organic_revenue) * factor;
    const monthlyCost = agg.total_cost * factor;
    const currentTacos = agg.avg_tacos;
    const currentAcos = agg.avg_acos;

    // Salvar valores anteriores se existirem (para preservar configuracao do usuario)
    const prevMargin = window._simSavedMargin || 15;
    const prevTacosTarget = window._simSavedTacos || currentTacos.toFixed(2);
    const prevIncrement = window._simSavedIncrement || 0;

    container.innerHTML = `<div class="adp-config-bar">
        <div class="adp-config-bar-header">
            <span class="adp-config-bar-icon">\ud83c\udfaf</span>
            <span class="adp-config-bar-title">Simulador de Cenário</span>
            <div class="adp-config-bar-fields">
                <span class="adp-config-hint">Meta de TACOS: <strong id="adp-sim-meta-display">${fmt(window._tacosTarget || parseFloat(prevTacosTarget) || currentTacos, 2)}%</strong> · atual: <strong>${fmt(currentTacos)}%</strong> <span style="color:var(--text-muted);font-size:0.68rem;">(edite a meta no card ao lado)</span></span>
            </div>
            <button class="adp-config-bar-toggle" id="adp-sim-toggle-btn" onclick="window.toggleSimDetails()">Simular cen\u00e1rio \u25be</button>
        </div>
        <div class="adp-config-bar-details" id="adp-sim-details" style="display:none;">
            <div style="font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:10px;">Simulador de Cen\u00e1rio</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
                <div class="adp-config-field" style="background:#fff;">
                    <label style="font-size:0.72rem;">Margem de Lucro Bruta</label>
                    <input type="number" id="adp-sim-margin" value="${prevMargin}" min="0" max="100" step="0.5" oninput="window.recalcSimulator()" style="width:60px;">
                    <span>%</span>
                </div>
                <div class="adp-config-field" style="background:#fff;">
                    <label style="font-size:0.72rem;">Incremento de Faturamento</label>
                    <input type="number" id="adp-sim-increment" value="${prevIncrement}" min="-50" max="500" step="5" oninput="window.recalcSimulator()" style="width:60px;">
                    <span>%</span>
                </div>
            </div>
            <div class="adp-sim-current-grid">
                <div class="adp-sim-current-item">
                    <span class="adp-sim-current-label">Faturamento Mensal</span>
                    <span class="adp-sim-current-value">${fmtMoney(monthlyRevenue)}</span>
                </div>
                <div class="adp-sim-current-item">
                    <span class="adp-sim-current-label">Gasto Ads Mensal</span>
                    <span class="adp-sim-current-value">${fmtMoney(monthlyCost)}</span>
                </div>
                <div class="adp-sim-current-item">
                    <span class="adp-sim-current-label">ACOS Atual</span>
                    <span class="adp-sim-current-value">${fmt(currentAcos)}%</span>
                </div>
            </div>
            <div id="adp-sim-results"></div>
        </div>
    </div>`;

    // Store data for recalc (inclui proporcao de vendas ads vs total)
    const adsRevPct = (agg.total_revenue + agg.organic_revenue) > 0 ? agg.total_revenue / (agg.total_revenue + agg.organic_revenue) : 0;
    const currentRoas = agg.overall_roas || 0;
    window._simData = { monthlyRevenue, monthlyCost, currentTacos, currentAcos, adsRevPct, currentRoas };
    window.recalcSimulator();
}

window.toggleSimDetails = function() {
    const details = document.getElementById('adp-sim-details');
    const btn = document.getElementById('adp-sim-toggle-btn');
    if (!details) return;
    if (details.style.display === 'none') {
        details.style.display = 'block';
        if (btn) btn.textContent = 'Ocultar proje\u00e7\u00e3o \u25b4';
    } else {
        details.style.display = 'none';
        if (btn) btn.textContent = 'Ver proje\u00e7\u00e3o \u25be';
    }
};

window.recalcSimulator = function() {
    const data = window._simData;
    if (!data) return;

    const margin = parseFloat(document.getElementById('adp-sim-margin')?.value) || 0;
    // Meta de TACOS agora vem exclusivamente do card principal — sem input próprio no simulador.
    const newTacos = parseFloat(window._tacosTarget) || parseFloat(data.currentTacos) || 0;
    const increment = parseFloat(document.getElementById('adp-sim-increment')?.value) || 0;

    // Salvar valores para preservar entre re-renders
    window._simSavedMargin = margin;
    window._simSavedIncrement = increment;

    // Faturamento total (ads + organico) projetado
    const newTotalRevenue = data.monthlyRevenue * (1 + increment / 100);
    // TACOS = custo ads / faturamento total → custo ads = faturamento total * TACOS
    const newAdsCost = newTotalRevenue * (newTacos / 100);
    // Margem resultante = margem bruta - TACOS (o que sobra depois de pagar ads)
    const resultingMargin = margin - newTacos;
    // Lucro = faturamento * margem bruta - custo ads
    const lucroAtual = data.monthlyRevenue * (margin / 100) - data.monthlyCost;
    const lucroNovo = newTotalRevenue * (margin / 100) - newAdsCost;
    // ROAS = Faturamento Ads / Custo Ads
    // Faturamento Ads = Faturamento Total * proporcao de ads (ex: 23.9%)
    const newAdsRevenue = newTotalRevenue * (data.adsRevPct || 0);
    const newRoas = newAdsCost > 0 ? newAdsRevenue / newAdsCost : 0;

    let statusClass, statusText;
    if (resultingMargin < 0) {
        statusClass = 'critical';
        statusText = `Margem Negativa (${fmt(resultingMargin)}%)`;
    } else if (resultingMargin < 5) {
        statusClass = 'attention';
        statusText = `Cen\u00e1rio de Aten\u00e7\u00e3o — Margem ${fmt(resultingMargin)}%`;
    } else {
        statusClass = 'viable';
        statusText = `Cen\u00e1rio Vi\u00e1vel — Margem ${fmt(resultingMargin)}%`;
    }

    const resultsEl = document.getElementById('adp-sim-results');
    if (!resultsEl) return;

    const newAcos = newAdsRevenue > 0 ? (newAdsCost / newAdsRevenue) * 100 : 0;

    resultsEl.innerHTML = `
        <div class="adp-sim-field">
            <div class="adp-sim-label">Margem Resultante (%)</div>
            <div class="adp-sim-value mono ${resultingMargin < 0 ? 'text-red' : resultingMargin < 5 ? 'text-yellow' : 'text-green'}">${fmt(resultingMargin)}%</div>
        </div>
        <div class="adp-sim-field">
            <div class="adp-sim-label">ROAS Projetado (atual: ${fmt(data.currentRoas)}x)</div>
            <div class="adp-sim-value mono">${fmt(newRoas)}x</div>
        </div>
        <div class="adp-sim-field">
            <div class="adp-sim-label">ACOS Projetado (atual: ${fmt(data.currentAcos)}%)</div>
            <div class="adp-sim-value mono">${fmt(newAcos)}%</div>
        </div>
        <div class="adp-sim-field">
            <div class="adp-sim-label">Novo Gasto em Ads</div>
            <div class="adp-sim-value mono">${fmtMoney(newAdsCost)}</div>
        </div>
        <div class="adp-sim-result ${statusClass}">${statusText}</div>
        <div class="adp-sim-compare">
            <div class="adp-sim-compare-item">
                <div class="adp-sim-compare-label">Lucro Atual</div>
                <div class="adp-sim-compare-value mono ${lucroAtual >= 0 ? 'text-green' : 'text-red'}">${fmtMoney(lucroAtual)}</div>
            </div>
            <div class="adp-sim-compare-item">
                <div class="adp-sim-compare-label">Lucro Projetado</div>
                <div class="adp-sim-compare-value mono ${lucroNovo >= 0 ? 'text-green' : 'text-red'}">${fmtMoney(lucroNovo)}</div>
            </div>
        </div>
        <div style="margin-top:12px;padding:10px 14px;background:var(--blue-light);border-radius:var(--radius-sm);font-size:0.75rem;color:var(--text-secondary);">
            <strong style="color:var(--blue);">Or\u00e7amento ideal:</strong>
            O or\u00e7amento ideal \u00e9 aquele que n\u00e3o limita impress\u00f5es. Se suas impress\u00f5es est\u00e3o caindo ou estagnando com gasto alto, aumente o or\u00e7amento di\u00e1rio.
            Com o TACOS atual, o gasto m\u00e1ximo para manter margem saud\u00e1vel seria <strong style="font-family:'DM Mono',monospace;">${fmtMoney(newTotalRevenue * (margin / 200))}</strong>/m\u00eas (metade da margem de ${fmt(margin)}%).
            ${data.monthlyCost > 0 && data.monthlyRevenue > 0 ? 'Gasto atual: <strong style="font-family:DM Mono,monospace;">' + fmtMoney(data.monthlyCost) + '</strong>/m\u00eas (' + fmt((data.monthlyCost / data.monthlyRevenue) * 100, 1) + '% do faturamento).' : ''}
        </div>`;
};

// ══════════════════════════════════════════════════════
// Section 5: Per-Item Ads Table
// ══════════════════════════════════════════════════════

let _tableData = [];
let _tableSort = { col: 'cost', dir: 'desc' };
let _tablePage = 0;
let _tableFilter = '';
let _tableCampaignFilter = '';
let _tableWatchlistOnly = false;
let _tableCustomFilter = null; // {ids, label, hint} — usado por diversas ações (queimando/wasteful/roas<1/etc)
let _allCampaigns = [];
const TABLE_PAGE_SIZE = 20;

function renderAdsTable(items, itemDetails, containerId, campaigns) {
    _tableData = items.filter(i => i.has_ads);
    const sidT = (items[0] && items[0].seller_id) || (window._currentOverview && window._currentOverview.seller_id) || '';
    // Enrich with details
    _tableData.forEach(item => {
        const d = itemDetails[item.item_id] || {};
        item._title = d.title || item.item_id;
        item._thumb = (d.thumbnail || '').replace(/^http:\/\//, 'https://');
        item._price = d.price || 0;
        item._originalPrice = d.original_price || 0;
        item._permalink = d.permalink || '';
        item._tacos = (item.revenue + (item.organic_revenue || 0)) > 0 ? (item.cost / (item.revenue + (item.organic_revenue || 0))) * 100 : 0;
        item._roas = item.cost > 0 ? item.revenue / item.cost : 0;
        item._trend = sidT ? rtGetItemTrend(sidT, item.item_id) : null;
    });

    // Collect unique campaigns for filter
    _allCampaigns = campaigns || [];
    _tablePage = 0;
    _tableFilter = '';
    _tableCampaignFilter = '';
    _tableWatchlistOnly = false;
    _tableCustomFilter = null;
    _renderTableUI(containerId);
}

function _getFilteredSorted() {
    let data = _tableData;
    if (_tableCustomFilter && _tableCustomFilter.ids && _tableCustomFilter.ids.length) {
        const set = new Set(_tableCustomFilter.ids);
        data = data.filter(i => set.has(i.item_id));
    }
    if (_tableWatchlistOnly) {
        const sid = (window._currentOverview && window._currentOverview.seller_id) || '';
        const watchIds = sid ? rtGet(sid, 'watchlist', []) : [];
        data = data.filter(i => watchIds.indexOf(i.item_id) >= 0);
    }
    if (_tableCampaignFilter) {
        data = data.filter(i => i.campaign_id === _tableCampaignFilter);
    }
    if (_tableFilter) {
        const f = _tableFilter.toLowerCase();
        data = data.filter(i => i._title.toLowerCase().includes(f) || i.item_id.toLowerCase().includes(f));
    }
    const col = _tableSort.col;
    const dir = _tableSort.dir === 'asc' ? 1 : -1;
    data.sort((a, b) => {
        let va = a[col] ?? a[`_${col}`] ?? 0;
        let vb = b[col] ?? b[`_${col}`] ?? 0;
        if (typeof va === 'string') return va.localeCompare(vb) * dir;
        return (va - vb) * dir;
    });
    return data;
}

function _renderTableUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const data = _getFilteredSorted();
    const totalPages = Math.ceil(data.length / TABLE_PAGE_SIZE);
    const page = Math.min(_tablePage, totalPages - 1);
    const start = page * TABLE_PAGE_SIZE;
    const pageData = data.slice(start, start + TABLE_PAGE_SIZE);

    const sortArrow = (col) => {
        if (_tableSort.col === col) {
            return `<span class="sort-arrow active">${_tableSort.dir === 'asc' ? '\u25b2' : '\u25bc'}</span>`;
        }
        return '<span class="sort-arrow">\u25bc</span>';
    };

    // Cores relativas usando QUARTIS (top 25% = verde, bottom 25% = vermelho)
    const calcQuartiles = (field) => {
        const valid = _tableData.filter(i => i[field] > 0).map(i => i[field]).sort((a, b) => a - b);
        if (valid.length < 4) return null;
        const q = (p) => {
            const idx = (valid.length - 1) * p;
            const lo = Math.floor(idx);
            const hi = Math.ceil(idx);
            return lo === hi ? valid[lo] : valid[lo] + (valid[hi] - valid[lo]) * (idx - lo);
        };
        return { q1: q(0.25), q2: q(0.5), q3: q(0.75) };
    };

    const acosQ = calcQuartiles('acos');
    const roasQ = calcQuartiles('_roas');
    const ctrQ = calcQuartiles('ctr');
    const cvrQ = calcQuartiles('cvr');

    // ACOS: menor = melhor (top 25% = abaixo de Q1)
    const acosClass = (v) => {
        if (v === 0 || !acosQ) return '';
        if (v <= acosQ.q1) return 'cell-good';
        if (v >= acosQ.q3) return 'cell-bad';
        if (v > acosQ.q2) return 'cell-warning';
        return '';
    };
    // ROAS: maior = melhor (top 25% = acima de Q3)
    const roasClassFn = (v) => {
        if (v === 0 || !roasQ) return '';
        if (v >= roasQ.q3) return 'cell-good';
        if (v <= roasQ.q1) return 'cell-bad';
        if (v < roasQ.q2) return 'cell-warning';
        return '';
    };
    // CTR: maior = melhor
    const ctrClass = (v) => {
        if (v === 0 || !ctrQ) return '';
        if (v >= ctrQ.q3) return 'cell-good';
        if (v <= ctrQ.q1) return 'cell-bad';
        if (v < ctrQ.q2) return 'cell-warning';
        return '';
    };
    // CVR: maior = melhor
    const cvrClass = (v) => {
        if (v === 0 || !cvrQ) return '';
        if (v >= cvrQ.q3) return 'cell-good';
        if (v <= cvrQ.q1) return 'cell-bad';
        if (v < cvrQ.q2) return 'cell-warning';
        return '';
    };
    const statusDot = (item) => {
        const roas = item.cost > 0 ? item.revenue / item.cost : 0;
        if (item.cost > 0 && roas < 1) return '<span class="adp-status-dot red"></span>';
        if (item.cost > 10 && item.orders === 0) return '<span class="adp-status-dot yellow"></span>';
        return '<span class="adp-status-dot green"></span>';
    };

    // Campaign filter dropdown
    let campaignOptions = '<option value="">Todas as campanhas</option>';
    for (const c of _allCampaigns) {
        const sel = _tableCampaignFilter === c.campaign_id ? ' selected' : '';
        campaignOptions += `<option value="${c.campaign_id}"${sel}>${escapeHtml(c.name || 'Campanha ' + c.campaign_id)}</option>`;
    }

    // Watchlist count (for filter badge)
    const sidForWatch = (window._currentOverview && window._currentOverview.seller_id) || '';
    const watchCount = sidForWatch ? rtGet(sidForWatch, 'watchlist', []).length : 0;

    const customFilterBanner = _tableCustomFilter && _tableCustomFilter.ids && _tableCustomFilter.ids.length
        ? `<div class="adp-wasteful-banner">
            <span>${_tableCustomFilter.label || 'Filtrando an\u00fancios'} <span style="opacity:.7;">${_tableCustomFilter.hint || ''}</span></span>
            <button onclick="window.adpClearCustomFilter()">\u2715 Limpar filtro</button>
          </div>`
        : '';

    let html = `<div class="adp-table-container">
        ${customFilterBanner}
        <div class="adp-table-toolbar">
            <input type="text" class="adp-table-search" placeholder="Buscar an\u00fancio..." value="${escapeHtml(_tableFilter)}" oninput="window.filterAdsTable(this.value, '${containerId}')">
            <select class="adp-table-search" style="min-width:180px;" onchange="window.filterAdsCampaign(this.value, '${containerId}')">${campaignOptions}</select>
            <button class="adp-btn-watchlist ${_tableWatchlistOnly ? 'active' : ''}" onclick="window.toggleWatchlistFilter('${containerId}')" title="Mostrar apenas an\u00fancios em observa\u00e7\u00e3o" ${watchCount === 0 ? 'disabled' : ''}>
                ${_tableWatchlistOnly ? '\u2b50' : '\u2606'} ${_tableWatchlistOnly ? 'Observando' : 'Em observa\u00e7\u00e3o'}${watchCount > 0 ? ` <span class="adp-btn-badge">${watchCount}</span>` : ''}
            </button>
            <div class="adp-table-actions">
                <span style="font-size:0.62rem;color:var(--text-muted);display:flex;align-items:center;gap:6px;">
                    <span style="display:inline-block;width:10px;height:10px;background:var(--green-light);border:1px solid var(--green);border-radius:2px;"></span> Acima da m\u00e9dia
                    <span style="display:inline-block;width:10px;height:10px;background:var(--yellow-light);border:1px solid var(--yellow);border-radius:2px;"></span> Abaixo
                    <span style="display:inline-block;width:10px;height:10px;background:var(--red-light);border:1px solid var(--red);border-radius:2px;"></span> Muito abaixo
                </span>
                <button class="adp-btn-csv" onclick="window.exportAdsCsv()">CSV</button>
            </div>
        </div>
        <div class="adp-table-scroll">
            <table class="adp-table">
                <thead><tr>
                    <th title="Clique na linha para expandir"></th>
                    <th></th>
                    <th title="Adicionar \u00e0 lista de observa\u00e7\u00e3o"></th>
                    <th onclick="window.sortAdsTable('_title','${containerId}')">T\u00edtulo ${sortArrow('_title')}</th>
                    <th onclick="window.sortAdsTable('_price','${containerId}')">Pre\u00e7o ${sortArrow('_price')}</th>
                    <th onclick="window.sortAdsTable('_roas','${containerId}')">ROAS ${sortArrow('_roas')}</th>
                    <th onclick="window.sortAdsTable('acos','${containerId}')">ACOS ${sortArrow('acos')}</th>
                    <th onclick="window.sortAdsTable('_tacos','${containerId}')">TACOS ${sortArrow('_tacos')}</th>
                    <th onclick="window.sortAdsTable('cost','${containerId}')">Custo ${sortArrow('cost')}</th>
                    <th onclick="window.sortAdsTable('revenue','${containerId}')">Fat. ${sortArrow('revenue')}</th>
                    <th onclick="window.sortAdsTable('impressions','${containerId}')" title="Impressões — quantas vezes seu anúncio foi exibido">Impr. ${sortArrow('impressions')}</th>
                    <th onclick="window.sortAdsTable('ctr','${containerId}')">CTR ${sortArrow('ctr')}</th>
                    <th onclick="window.sortAdsTable('cvr','${containerId}')">Conv. ${sortArrow('cvr')}</th>
                    <th>Status</th>
                </tr></thead>
                <tbody>`;

    for (const item of pageData) {
        const suggestions = getItemSuggestion(item);
        const alertIcon = suggestions.length > 0 && suggestions[0].icon !== '\u2705' ? `<span title="${suggestions.map(s => s.text).join(' | ')}" style="cursor:help;">${suggestions[0].icon}</span>` : '';
        const roasColor = item._roas < 1 && item.cost > 0 ? 'text-red' : item._roas >= 5 ? 'text-green' : '';
        // Preco com desconto
        let priceCell = '';
        if (item._price > 0) {
            const hasDiscount = item._originalPrice > 0 && item._originalPrice > item._price;
            if (hasDiscount) {
                const discPct = ((item._originalPrice - item._price) / item._originalPrice) * 100;
                priceCell = `<div style="line-height:1.2;"><div style="font-weight:600;">${fmtMoney(item._price)}</div><div style="font-size:0.6rem;color:var(--text-muted);text-decoration:line-through;">${fmtMoney(item._originalPrice)}</div><div style="font-size:0.6rem;color:var(--green-dark);font-weight:700;">-${fmt(discPct, 0)}%</div></div>`;
            } else {
                priceCell = fmtMoney(item._price);
            }
        } else {
            priceCell = '—';
        }

        const sid = (window._currentOverview && window._currentOverview.seller_id) || '';
        const watched = sid ? rtIsWatched(sid, item.item_id) : false;
        const titleNoData = item._title === item.item_id; // details didn't load
        const titleCell = titleNoData
            ? `<span class="adp-skel" style="width:80%;"></span>`
            : escapeHtml(item._title.length > 40 ? item._title.substring(0, 40) + '...' : item._title);
        const tr = item._trend || {};
        const trChip = (pct, invert) => rtTrendChip(pct, invert);
        html += `<tr onclick="window.toggleItemDetail('${item.item_id}', this)" class="adp-row-clickable" title="Clique para ver gr\u00e1fico di\u00e1rio e todas as m\u00e9tricas deste an\u00fancio">
            <td><span class="adp-row-expand" aria-hidden="true">\u203a</span></td>
            <td>${item._thumb ? `<img class="td-thumb" src="${escapeHtml(item._thumb)}" alt="" onerror="this.style.display='none'">` : '<div class="td-thumb" style="background:var(--row-alt);border:1px solid var(--border);"></div>'}</td>
            <td onclick="event.stopPropagation();"><button class="adp-rt-star" onclick="window.adpToggleWatch('${item.item_id}', this)" title="${watched?'Remover':'Adicionar'} da lista de observa\u00e7\u00e3o">${watched?'\u2b50':'\u2606'}</button></td>
            <td class="td-title" title="${escapeHtml(item._title)}">${titleCell} ${alertIcon}</td>
            <td class="td-mono">${priceCell}</td>
            <td class="td-mono ${roasClassFn(item._roas)}"><div>${fmt(item._roas)}x</div>${trChip(tr.roas, false)}</td>
            <td class="td-mono ${acosClass(item.acos)}"><div>${fmt(item.acos)}%</div>${trChip(tr.acos, true)}</td>
            <td class="td-mono ${acosClass(item._tacos)}"><div>${fmt(item._tacos)}%</div>${trChip(tr.tacos, true)}</td>
            <td class="td-mono"><div>${fmtMoney(item.cost)}</div>${trChip(tr.cost, true)}</td>
            <td class="td-mono"><div>${fmtMoney(item.revenue)}</div>${trChip(tr.revenue, false)}</td>
            <td class="td-mono"><div>${fmtInt(item.impressions || 0)}</div>${trChip(tr.prints, false)}</td>
            <td class="td-mono ${ctrClass(item.ctr)}"><div>${fmt(item.ctr)}%</div>${trChip(tr.ctr, false)}</td>
            <td class="td-mono ${cvrClass(item.cvr)}"><div>${fmt(item.cvr)}%</div>${trChip(tr.cvr, false)}</td>
            <td>${statusDot(item)} ${escapeHtml(item.status === 'active' ? 'Ativo' : item.status === 'paused' ? 'Pausado' : item.status || '')}</td>
        </tr>`;
    }

    html += `</tbody></table></div>`;

    // Pagination
    if (totalPages > 1) {
        html += `<div class="adp-pagination">
            <span>${start + 1}-${Math.min(start + TABLE_PAGE_SIZE, data.length)} de ${data.length}</span>
            <div class="adp-pagination-btns">
                <button class="adp-pagination-btn" onclick="window.goAdsTablePage(${page - 1},'${containerId}')" ${page === 0 ? 'disabled' : ''}>\u2190</button>`;
        for (let p = 0; p < totalPages && p < 5; p++) {
            html += `<button class="adp-pagination-btn ${p === page ? 'active' : ''}" onclick="window.goAdsTablePage(${p},'${containerId}')">${p + 1}</button>`;
        }
        html += `<button class="adp-pagination-btn" onclick="window.goAdsTablePage(${page + 1},'${containerId}')" ${page >= totalPages - 1 ? 'disabled' : ''}>\u2192</button>
            </div>
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

window.sortAdsTable = function(col, containerId) {
    if (_tableSort.col === col) {
        _tableSort.dir = _tableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        _tableSort = { col, dir: 'desc' };
    }
    _tablePage = 0;
    _renderTableUI(containerId);
};

window.filterAdsTable = function(val, containerId) {
    _tableFilter = val;
    _tablePage = 0;
    _renderTableUI(containerId);
};

window.toggleWatchlistFilter = function(containerId) {
    _tableWatchlistOnly = !_tableWatchlistOnly;
    _tablePage = 0;
    _renderTableUI(containerId);
};

// Aplica um filtro customizado na tabela, limpa outros filtros, rola até a tabela
function _applyCustomFilter(ids, label, hint) {
    if (!ids || !ids.length) return;
    _tableCustomFilter = { ids, label, hint };
    _tableWatchlistOnly = false;
    _tableCampaignFilter = '';
    _tableFilter = '';
    _tablePage = 0;
    _renderTableUI('adp-table');
    const table = document.getElementById('adp-table');
    if (table) {
        table.scrollIntoView({ behavior: 'smooth', block: 'start' });
        table.classList.add('adp-highlight-flash');
        setTimeout(() => table.classList.remove('adp-highlight-flash'), 2000);
    }
}

window.adpClearCustomFilter = function() {
    _tableCustomFilter = null;
    _tablePage = 0;
    _renderTableUI('adp-table');
};

// Backward compat shim
window.adpClearWastefulFilter = window.adpClearCustomFilter;

window.adpFilterWasteful = function(idsCsv) {
    const ids = (idsCsv || '').split(',').filter(Boolean);
    _applyCustomFilter(ids, `\ud83d\udcb0 ${ids.length} an\u00fancio${ids.length > 1 ? 's' : ''} com potencial de economia`, '(ACOS > 30% ou ROAS < 1)');
};

// Filtra an\u00fancios que est\u00e3o queimando dinheiro (gasto alto sem venda)
window.adpFilterBurningAds = function() {
    const items = _tableData.filter(i => (i.cost || 0) > 30 && (i.orders || 0) === 0);
    const ids = items.map(i => i.item_id);
    if (!ids.length) return;
    _applyCustomFilter(ids, `\ud83d\udd25 ${ids.length} an\u00fancio${ids.length > 1 ? 's' : ''} queimando dinheiro`, '(mais de R$ 30 gastos sem nenhuma venda)');
};

// Filtra an\u00fancios com ROAS abaixo de 1 (dando preju\u00edzo)
window.adpFilterLowRoas = function() {
    const items = _tableData.filter(i => (i._roas || 0) > 0 && (i._roas || 0) < 1 && (i.cost || 0) > 5);
    const ids = items.map(i => i.item_id);
    if (!ids.length) return;
    _applyCustomFilter(ids, `\ud83d\udcc9 ${ids.length} an\u00fancio${ids.length > 1 ? 's' : ''} com ROAS abaixo de 1`, '(gastando mais do que faturam)');
};

// Filtra an\u00fancios de uma campanha espec\u00edfica (por ID)
window.adpFilterByCampaign = function(campaignId, campaignName) {
    const items = _tableData.filter(i => String(i.campaign_id) === String(campaignId));
    const ids = items.map(i => i.item_id);
    if (!ids.length) return;
    _applyCustomFilter(ids, `\ud83d\udccc ${ids.length} an\u00fancio${ids.length > 1 ? 's' : ''} da campanha "${campaignName}"`, '');
};

// Filtra an\u00fancios de m\u00faltiplas campanhas (usado por health check)
window.adpFilterBadCampaigns = function(idsCsv) {
    const ids = (idsCsv || '').split(',').filter(Boolean);
    _applyCustomFilter(ids, `\ud83c\udfaf ${ids.length} an\u00fancio${ids.length > 1 ? 's' : ''} de campanhas abaixo da meta de ROAS`, '');
};

// Filtra a tabela para mostrar apenas um an\u00fancio espec\u00edfico (usado por alertas de item)
window.adpFilterSingleItem = function(itemId) {
    if (!itemId) return;
    const item = _tableData.find(i => i.item_id === itemId);
    const title = item && item._title ? item._title.slice(0, 40) : itemId;
    _applyCustomFilter([itemId], `\ud83d\udd0d Anúncio: ${title}`, '');
};

// Filtra an\u00fancios com CTR abaixo da m\u00e9dia da conta
window.adpFilterLowCtr = function() {
    const alerts = window._currentAlerts || [];
    const rollup = alerts.find(a => a.id === 'rollup_low_ctr');
    const ids = rollup?.rollup_ids || [];
    if (!ids.length) return;
    _applyCustomFilter(ids, `\ud83d\uddbc\ufe0f ${ids.length} an\u00fancio${ids.length > 1 ? 's' : ''} com CTR abaixo da m\u00e9dia`, '');
};

// Filtra an\u00fancios com convers\u00e3o abaixo da m\u00e9dia
window.adpFilterLowCvr = function() {
    const alerts = window._currentAlerts || [];
    const rollup = alerts.find(a => a.id === 'rollup_low_cvr');
    const ids = rollup?.rollup_ids || [];
    if (!ids.length) return;
    _applyCustomFilter(ids, `\ud83d\udcb0 ${ids.length} an\u00fancio${ids.length > 1 ? 's' : ''} com convers\u00e3o abaixo da m\u00e9dia`, '');
};

window.filterAdsCampaign = function(val, containerId) {
    _tableCampaignFilter = val;
    _tablePage = 0;
    _renderTableUI(containerId);
};

window.goAdsTablePage = function(page, containerId) {
    _tablePage = Math.max(0, page);
    _renderTableUI(containerId);
};

window.exportAdsCsv = function() {
    const data = _getFilteredSorted();
    const headers = ['ID do Anuncio', 'Titulo', 'ROAS', 'ACOS %', 'TACOS %', 'Custo', 'Faturamento', 'CTR %', 'Conversao %', 'Status'];
    const rows = data.map(i => [
        i.item_id, `"${(i._title || '').replace(/"/g, '""')}"`,
        fmt(i.acos), fmt(i._tacos), fmt(i._roas),
        i.cost.toFixed(2), i.revenue.toFixed(2),
        fmt(i.ctr), fmt(i.cvr), i.status || ''
    ]);
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ads-planner-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

window.toggleItemDetail = async function(itemId, rowEl) {
    const existing = rowEl.nextElementSibling;
    if (existing && existing.classList.contains('adp-detail-row')) {
        existing.remove();
        rowEl.classList.remove('adp-row-expanded');
        return;
    }
    document.querySelectorAll('.adp-detail-row').forEach(el => el.remove());
    document.querySelectorAll('.adp-row-expanded').forEach(el => el.classList.remove('adp-row-expanded'));

    const item = _tableData.find(i => i.item_id === itemId);
    if (!item) return;

    const suggestions = getItemSuggestion(item);
    const orgRev = item.organic_revenue || 0;
    const totalRev = item.revenue + orgRev;
    const adsPct = totalRev > 0 ? (item.revenue / totalRev) * 100 : 0;
    const chartId = 'adp-item-chart-' + Date.now();

    // Derived metrics
    const cpc = item.clicks > 0 ? item.cost / item.clicks : 0;
    const cpa = item.orders > 0 ? item.cost / item.orders : 0;
    const avgTicket = item.orders > 0 ? item.revenue / item.orders : 0;
    const totalOrders = (item.orders || 0) + (item.organic_orders || 0);
    const orgOrderPct = totalOrders > 0 ? (item.organic_orders / totalOrders) * 100 : 0;
    const impPerOrder = item.orders > 0 ? item.impressions / item.orders : 0;

    const chartId2 = chartId + '-b';
    const chartId3 = chartId + '-c';

    // Tend\u00eancias (snapshot vs visita anterior)
    const sidD = (window._currentOverview && window._currentOverview.seller_id) || '';
    const trendD = sidD ? rtGetItemTrend(sidD, itemId) : null;

    // Card de m\u00e9trica reutiliz\u00e1vel (com tend\u00eancia opcional)
    const metric = (label, value, sub, color, trendPct, invertColor) => `
        <div style="padding:10px 12px;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border);min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.58rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px;">
                <span>${label}</span>
                ${rtTrendChip(trendPct, invertColor)}
            </div>
            <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:0.95rem;color:${color || 'var(--text)'};line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${value}</div>
            ${sub ? `<div style="font-size:0.6rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sub}</div>` : ''}
        </div>`;

    // Banner de pre\u00e7o com desconto (sempre que houver pre\u00e7o)
    const itemPrice = item._price || 0;
    const itemOriginal = item._originalPrice || 0;
    const hasDiscount = itemOriginal > 0 && itemOriginal > itemPrice;
    const discountPct = hasDiscount ? Math.round(((itemOriginal - itemPrice) / itemOriginal) * 100) : 0;
    const priceBanner = itemPrice > 0 ? `
        <div style="margin-bottom:14px;padding:10px 14px;background:linear-gradient(135deg,#f8fafc,#fff);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            <div style="display:flex;flex-direction:column;line-height:1.1;">
                <span style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:.3px;">${hasDiscount ? 'Pre\u00e7o promocional' : 'Pre\u00e7o atual'}</span>
                <span style="font-family:'DM Mono',monospace;font-size:1.4rem;font-weight:800;color:${hasDiscount ? 'var(--green-dark)' : 'var(--text)'};">${fmtMoney(itemPrice)}</span>
            </div>
            ${hasDiscount ? `
                <div style="display:flex;flex-direction:column;line-height:1.1;">
                    <span style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:.3px;">Pre\u00e7o cheio</span>
                    <span style="font-family:'DM Mono',monospace;font-size:1rem;text-decoration:line-through;color:var(--text-muted);">${fmtMoney(itemOriginal)}</span>
                </div>
                <div style="background:var(--green-light);color:var(--green-dark);font-weight:800;padding:5px 10px;border-radius:6px;font-family:'DM Mono',monospace;font-size:0.95rem;">-${discountPct}%</div>
                <div style="font-size:0.7rem;color:var(--text-secondary);">Voc\u00ea est\u00e1 oferecendo ${fmtMoney(itemOriginal - itemPrice)} de desconto.</div>
            ` : ''}
            <div style="margin-left:auto;font-size:0.6rem;color:var(--text-muted);font-family:'DM Mono',monospace;">${escapeHtml(itemId)}</div>
        </div>` : '';

    const detailRow = document.createElement('tr');
    detailRow.className = 'adp-detail-row';
    detailRow.innerHTML = `<td colspan="14" class="adp-row-detail">
        ${priceBanner}
        <div class="adp-detail-grid-main">
            <!-- BLOCO 1: Performance por faixa -->
            <div class="adp-detail-section">
                <div class="adp-detail-section-title">\ud83d\udcca Performance</div>
                <div class="adp-detail-metrics-grid">
                    ${metric('ROAS', fmt(item._roas, 2) + 'x', 'retorno', item._roas < 1 ? 'var(--red-dark)' : item._roas >= 3 ? 'var(--green-dark)' : 'var(--yellow-dark)', trendD && trendD.roas, false)}
                    ${metric('ACOS', fmt(item.acos, 2) + '%', 'custo / fat. ads', null, trendD && trendD.acos, true)}
                    ${metric('TACOS', fmt(item._tacos, 2) + '%', 'custo / fat. total', null, trendD && trendD.tacos, true)}
                    ${metric('Pedidos Ads', fmtInt(item.orders), 'de ' + fmtInt(totalOrders) + ' totais', null, trendD && trendD.orders, false)}
                    ${metric('Ticket M\u00e9dio', fmtMoney(avgTicket), 'por pedido ads')}
                    ${metric('CPA', cpa > 0 ? fmtMoney(cpa) : '\u2014', 'custo por venda', null, trendD && trendD.cost && trendD.orders ? (trendD.cost - trendD.orders) : null, true)}
                </div>
            </div>

            <!-- BLOCO 2: Funil -->
            <div class="adp-detail-section">
                <div class="adp-detail-section-title">\ud83c\udfaf Funil de Convers\u00e3o</div>
                <div class="adp-detail-metrics-grid">
                    ${metric('Impress\u00f5es', fmtInt(item.impressions), 'an\u00fancios exibidos', null, trendD && trendD.prints, false)}
                    ${metric('Cliques', fmtInt(item.clicks), 'pessoas que clicaram', null, trendD && trendD.clicks, false)}
                    ${metric('CTR', fmt(item.ctr, 2) + '%', 'cliques / impress\u00f5es', null, trendD && trendD.ctr, false)}
                    ${metric('CPC', cpc > 0 ? fmtMoney(cpc) : '\u2014', 'custo por clique')}
                    ${metric('Convers\u00e3o', fmt(item.cvr, 2) + '%', 'vendas / cliques', null, trendD && trendD.cvr, false)}
                    ${metric('Imp/Venda', impPerOrder > 0 ? fmtInt(impPerOrder) : '\u2014', 'p/ 1 pedido')}
                </div>
            </div>

            <!-- BLOCO 3: Composi\u00e7\u00e3o Ads vs Org\u00e2nico -->
            <div class="adp-detail-section">
                <div class="adp-detail-section-title">\u2696\ufe0f Ads vs Org\u00e2nico</div>
                <div class="adp-detail-metrics-grid">
                    ${metric('Fat. Ads', fmtMoney(item.revenue), fmt(adsPct, 0) + '% do total', 'var(--blue)', trendD && trendD.revenue, false)}
                    ${metric('Fat. Org\u00e2nico', fmtMoney(orgRev), fmt(100-adsPct, 0) + '% do total', 'var(--green-dark)')}
                    ${metric('Pedidos Org.', fmtInt(item.organic_orders || 0), fmt(orgOrderPct, 0) + '% dos pedidos')}
                    ${metric('Depend\u00eancia', fmt(adsPct, 0) + '%', adsPct > 80 ? 'excesso' : adsPct > 60 ? 'alerta' : 'saud\u00e1vel', adsPct > 80 ? 'var(--red-dark)' : adsPct > 60 ? 'var(--yellow-dark)' : 'var(--green-dark)')}
                </div>
                <!-- barra visual composi\u00e7\u00e3o -->
                <div style="margin-top:10px;height:10px;border-radius:5px;background:var(--border);overflow:hidden;display:flex;">
                    <div style="width:${adsPct}%;background:var(--blue);"></div>
                    <div style="flex:1;background:var(--green);"></div>
                </div>
            </div>
        </div>

        <!-- A\u00e7\u00f5es r\u00e1pidas -->
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
            <a href="/analise-anuncio?item=${itemId}" target="_blank" rel="noopener" class="adp-detail-action-btn">
                \ud83d\udd0e Analisar este an\u00fancio
            </a>
            ${item._permalink ? `<a href="${item._permalink}" target="_blank" rel="noopener" class="adp-detail-action-btn adp-detail-action-btn-secondary">
                \ud83d\udd17 Ver no Mercado Livre
            </a>` : ''}
        </div>

        <!-- Sugest\u00f5es -->
        ${suggestions && suggestions.length ? `<div class="adp-detail-section" style="margin-top:14px;">
            <div class="adp-detail-section-title">\ud83d\udca1 Sugest\u00f5es de Otimiza\u00e7\u00e3o</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${suggestions.map(s => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.78rem;">
                    <span>${s.icon}</span><span>${s.text}</span>
                </div>`).join('')}
            </div>
        </div>` : ''}

        <!-- Gr\u00e1ficos di\u00e1rios (3 charts) -->
        <div class="adp-detail-section" style="margin-top:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
                <div class="adp-detail-section-title" style="margin-bottom:0;">\ud83d\udcc8 Evolu\u00e7\u00e3o Di\u00e1ria</div>
                <div class="adp-detail-period-selector" data-item="${itemId}">
                    ${[7, 15, 30, 60, 90].map(d => `<button class="adp-detail-period-btn ${d === _currentDays ? 'active' : ''}" data-days="${d}" onclick="window.adpLoadDetailCharts('${itemId}', ${d}, '${chartId}', '${chartId2}', '${chartId3}', this)">${d}d</button>`).join('')}
                </div>
            </div>
            <div class="adp-detail-charts-grid">
                <div>
                    <div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;font-weight:700;">Custo vs Faturamento</div>
                    <div class="adp-detail-chart-box"><canvas id="${chartId}"></canvas></div>
                </div>
                <div>
                    <div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;font-weight:700;">ACOS / TACOS / ROAS</div>
                    <div class="adp-detail-chart-box"><canvas id="${chartId2}"></canvas></div>
                </div>
                <div>
                    <div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;font-weight:700;">Impress\u00f5es / Cliques / Vendas</div>
                    <div class="adp-detail-chart-box"><canvas id="${chartId3}"></canvas></div>
                </div>
            </div>
            <div id="${chartId}-loading" style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:8px;">Carregando gr\u00e1ficos di\u00e1rios...</div>
        </div>
    </td>`;
    rowEl.after(detailRow);
    rowEl.classList.add('adp-row-expanded');

    // Carregar charts (reutiliz\u00e1vel para trocar o per\u00edodo sem re-expandir)
    window.adpLoadDetailCharts(itemId, _currentDays, chartId, chartId2, chartId3);
};

window.adpLoadDetailCharts = async function(itemId, days, chartId, chartId2, chartId3, btn) {
    // Atualiza bot\u00f5es
    if (btn) {
        const container = btn.closest('.adp-detail-period-selector');
        if (container) container.querySelectorAll('.adp-detail-period-btn').forEach(b => b.classList.toggle('active', b === btn));
    }
    // Destroi charts antigos se existirem
    [chartId, chartId2, chartId3].forEach(id => {
        const el = document.getElementById(id);
        if (el && window.Chart) {
            const existing = Chart.getChart(el);
            if (existing) existing.destroy();
        }
    });
    const loadEl = document.getElementById(chartId + '-loading');
    if (loadEl) { loadEl.style.display = ''; loadEl.textContent = `Carregando ${days}d...`; }

    try {
        const token = await fetchAccessToken();
        if (!token) throw new Error('Token');
        const now = new Date();
        const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const to = now.toISOString().split('T')[0];
        const resp = await fetch(`${BASE_URL_PROXY}/api/ads-metrics?item_id=${itemId}&date_from=${from}&date_to=${to}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) { if (loadEl) loadEl.textContent = 'Dados di\u00e1rios indispon\u00edveis'; return; }
        const data = await resp.json();
        if (loadEl) loadEl.style.display = 'none';

        const daily = data.daily || [];
        if (daily.length < 2) { if (loadEl) { loadEl.style.display = ''; loadEl.textContent = 'Poucos dados di\u00e1rios para o per\u00edodo'; } return; }

        const labels = daily.map(d => { const p = (d.date || '').split('-'); return p.length >= 3 ? p[2] + '/' + p[1] : d.date; });
        const smFont = { family: 'DM Sans', size: 9 };
        const smMono = { family: 'DM Mono', size: 8 };
        const sharedOpts = {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            hover: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { font: { family: 'DM Sans', size: 9 }, usePointStyle: true, boxWidth: 8 } },
                tooltip: {
                    mode: 'index', intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleFont: { family: 'DM Sans', size: 11, weight: '700' },
                    bodyFont: { family: 'DM Mono', size: 10 },
                    padding: 8, cornerRadius: 6, boxPadding: 3
                }
            }
        };

        // Chart 1: Custo vs Faturamento + Impress\u00f5es
        const ctxA = document.getElementById(chartId);
        if (ctxA) {
            new Chart(ctxA.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Custo', data: daily.map(d => parseFloat(d.cost) || 0), backgroundColor: 'rgba(255,59,92,0.55)', borderRadius: 2, yAxisID: 'y' },
                        { label: 'Faturamento', data: daily.map(d => parseFloat(d.total_amount) || 0), backgroundColor: 'rgba(0,102,255,0.55)', borderRadius: 2, yAxisID: 'y' },
                        { label: 'Impress\u00f5es', data: daily.map(d => parseInt(d.prints) || 0), type: 'line', borderColor: '#f59e0b', tension: 0.3, pointRadius: 1, fill: false, yAxisID: 'y2' }
                    ]
                },
                options: {
                    ...sharedOpts,
                    scales: {
                        y: { beginAtZero: true, position: 'left', ticks: { font: smMono, callback: v => 'R$' + v } },
                        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: smMono, color: '#f59e0b' } },
                        x: { ticks: { font: smFont, maxRotation: 45 } }
                    }
                }
            });
        }

        // Chart 2: ACOS / TACOS / ROAS di\u00e1rios
        const ctxB = document.getElementById(chartId2);
        if (ctxB) {
            const acosSeries = daily.map(d => {
                const cost = parseFloat(d.cost) || 0;
                const rev = parseFloat(d.total_amount) || 0;
                return rev > 0 ? (cost / rev) * 100 : 0;
            });
            const tacosSeries = daily.map(d => {
                const cost = parseFloat(d.cost) || 0;
                const rev = parseFloat(d.total_amount) || 0;
                const org = parseFloat(d.organic_units_amount) || 0;
                const total = rev + org;
                return total > 0 ? (cost / total) * 100 : 0;
            });
            const roasSeries = daily.map(d => {
                const cost = parseFloat(d.cost) || 0;
                const rev = parseFloat(d.total_amount) || 0;
                return cost > 0 ? rev / cost : 0;
            });
            new Chart(ctxB.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: 'ACOS %', data: acosSeries, borderColor: '#ff3b5c', backgroundColor: 'rgba(255,59,92,0.08)', tension: 0.3, fill: false, pointRadius: 2, yAxisID: 'y' },
                        { label: 'TACOS %', data: tacosSeries, borderColor: '#0066ff', backgroundColor: 'rgba(0,102,255,0.08)', tension: 0.3, fill: false, pointRadius: 2, yAxisID: 'y' },
                        { label: 'ROAS', data: roasSeries, borderColor: '#00d68f', backgroundColor: 'rgba(0,214,143,0.08)', tension: 0.3, fill: false, pointRadius: 2, borderDash: [4,3], yAxisID: 'y2' }
                    ]
                },
                options: {
                    ...sharedOpts,
                    scales: {
                        y: { beginAtZero: true, position: 'left', ticks: { font: smMono, callback: v => v + '%' } },
                        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: smMono, callback: v => v + 'x' } },
                        x: { ticks: { font: smFont, maxRotation: 45 } }
                    }
                }
            });
        }

        // Chart 3: Funil — impress\u00f5es, cliques, pedidos
        const ctxC = document.getElementById(chartId3);
        if (ctxC) {
            new Chart(ctxC.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: 'Impress\u00f5es', data: daily.map(d => parseInt(d.prints) || 0), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)', tension: 0.3, fill: true, pointRadius: 2, yAxisID: 'y' },
                        { label: 'Cliques', data: daily.map(d => parseInt(d.clicks) || 0), borderColor: '#0066ff', backgroundColor: 'rgba(0,102,255,0.12)', tension: 0.3, fill: true, pointRadius: 2, yAxisID: 'y2' },
                        { label: 'Pedidos', data: daily.map(d => parseInt(d.units_quantity) || parseInt(d.orders) || 0), borderColor: '#00d68f', backgroundColor: 'rgba(0,214,143,0.18)', tension: 0.3, fill: true, pointRadius: 2, yAxisID: 'y2' }
                    ]
                },
                options: {
                    ...sharedOpts,
                    scales: {
                        y: { beginAtZero: true, position: 'left', ticks: { font: smMono, color: '#f59e0b' } },
                        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: smMono } },
                        x: { ticks: { font: smFont, maxRotation: 45 } }
                    }
                }
            });
        }
    } catch (e) {
        const loadEl = document.getElementById(chartId + '-loading');
        if (loadEl) loadEl.textContent = 'Erro ao carregar gr\u00e1ficos';
    }
};

// ══════════════════════════════════════════════════════
// Section 6: Charts
// ══════════════════════════════════════════════════════

function renderCharts(overview, containerId, visitsData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const daily = overview.daily_aggregated || [];
    if (daily.length < 2) {
        container.innerHTML = '<div class="text-muted ta-center" style="padding:40px">Dados di\u00e1rios insuficientes para gerar gr\u00e1ficos.</div>';
        return;
    }

    const labels = daily.map(d => {
        const parts = d.date.split('-');
        return `${parts[2]}/${parts[1]}`;
    });

    // Build visits data merged with ads clicks
    const adsClicksByDate = {};
    const adsPrintsByDate = {};
    daily.forEach(d => {
        if (d.date) {
            adsClicksByDate[d.date] = d.clicks || 0;
            adsPrintsByDate[d.date] = d.prints || 0;
        }
    });

    // Aggregate visits from visitsData (per-item visits bulk)
    const visitsByDate = {};
    if (visitsData && typeof visitsData === 'object') {
        for (const [itemId, itemVisits] of Object.entries(visitsData)) {
            const results = itemVisits?.results || itemVisits?.data || (Array.isArray(itemVisits) ? itemVisits : []);
            for (const v of results) {
                if (v.date) {
                    const key = v.date.substring(0, 10);
                    visitsByDate[key] = (visitsByDate[key] || 0) + (v.total || v.total_visits || 0);
                }
            }
        }
    }

    // Build entries for visits chart
    const visitsEntries = daily.map(d => {
        const totalVisits = visitsByDate[d.date] || 0;
        const adsClicks = Math.min(totalVisits, adsClicksByDate[d.date] || 0);
        const prints = adsPrintsByDate[d.date] || 0;
        return { date: d.date, total: totalVisits, ads: adsClicks, organic: Math.max(0, totalVisits - adsClicks), prints };
    });

    const totalVisitsSum = visitsEntries.reduce((s, e) => s + e.total, 0);
    const totalAdsClicksSum = visitsEntries.reduce((s, e) => s + e.ads, 0);
    const adsPctTotal = totalVisitsSum > 0 ? (totalAdsClicksSum / totalVisitsSum) * 100 : 0;
    const orgPctTotal = 100 - adsPctTotal;

    // Sales composition
    const agg = overview.aggregated || {};
    const totalAdsSales = agg.total_orders || 0;
    const totalOrgSales = agg.organic_orders || 0;
    const totalSales = totalAdsSales + totalOrgSales;
    const adsSalesPct = totalSales > 0 ? (totalAdsSales / totalSales) * 100 : 0;
    const orgSalesPct = 100 - adsSalesPct;

    // Revenue composition
    const totalAdsRev = agg.total_revenue || 0;
    const totalOrgRev = agg.organic_revenue || 0;
    const totalRev = totalAdsRev + totalOrgRev;
    const adsRevPct = totalRev > 0 ? (totalAdsRev / totalRev) * 100 : 0;
    const orgRevPct = 100 - adsRevPct;

    // Trends de COMPOSIÇÃO — delta em pontos percentuais (pp) do % ads
    // Positivo = ads ganhando peso (canibalizando orgânico)
    // Negativo = orgânico ganhando peso (saudável)
    const compositionTrends = (() => {
        if (daily.length < 4) return { traffic: null, sales: null, revenue: null };
        const mid = Math.floor(daily.length / 2);
        const first = daily.slice(0, mid);
        const second = daily.slice(mid);
        const sumField = (arr, f) => arr.reduce((s, d) => s + (parseFloat(d[f]) || 0), 0);

        // Traffic: usa visitsEntries já calculado
        let trafficDelta = null;
        if (visitsEntries.length >= 4) {
            const vMid = Math.floor(visitsEntries.length / 2);
            const vFirst = visitsEntries.slice(0, vMid);
            const vSecond = visitsEntries.slice(vMid);
            const fTotal = vFirst.reduce((s, e) => s + e.total, 0);
            const fAds = vFirst.reduce((s, e) => s + e.ads, 0);
            const sTotal = vSecond.reduce((s, e) => s + e.total, 0);
            const sAds = vSecond.reduce((s, e) => s + e.ads, 0);
            if (fTotal > 0 && sTotal > 0) {
                const fPct = (fAds / fTotal) * 100;
                const sPct = (sAds / sTotal) * 100;
                trafficDelta = sPct - fPct; // em pp
            }
        }

        // Sales: units_quantity (ads) vs organic_units_quantity
        const fAdsSales = sumField(first, 'units_quantity');
        const fOrgSales = sumField(first, 'organic_units_quantity');
        const sAdsSales = sumField(second, 'units_quantity');
        const sOrgSales = sumField(second, 'organic_units_quantity');
        let salesDelta = null;
        if ((fAdsSales + fOrgSales) > 0 && (sAdsSales + sOrgSales) > 0) {
            const fPct = (fAdsSales / (fAdsSales + fOrgSales)) * 100;
            const sPct = (sAdsSales / (sAdsSales + sOrgSales)) * 100;
            salesDelta = sPct - fPct;
        }

        // Revenue: total_amount (ads) vs organic_units_amount
        const fAdsRev = sumField(first, 'total_amount');
        const fOrgRev = sumField(first, 'organic_units_amount');
        const sAdsRev = sumField(second, 'total_amount');
        const sOrgRev = sumField(second, 'organic_units_amount');
        let revenueDelta = null;
        if ((fAdsRev + fOrgRev) > 0 && (sAdsRev + sOrgRev) > 0) {
            const fPct = (fAdsRev / (fAdsRev + fOrgRev)) * 100;
            const sPct = (sAdsRev / (sAdsRev + sOrgRev)) * 100;
            revenueDelta = sPct - fPct;
        }

        return { traffic: trafficDelta, sales: salesDelta, revenue: revenueDelta };
    })();

    // Trends dos charts
    const chartRoasTrend = (() => {
        if (!daily || daily.length < 4) return null;
        const mid = Math.floor(daily.length / 2);
        const ratio = (arr) => {
            const rev = arr.reduce((s, d) => s + (parseFloat(d.total_amount) || 0), 0);
            const cost = arr.reduce((s, d) => s + (parseFloat(d.cost) || 0), 0);
            return cost > 0 ? rev / cost : 0;
        };
        const f = ratio(daily.slice(0, mid));
        const s = ratio(daily.slice(mid));
        return f > 0 ? ((s - f) / f) * 100 : null;
    })();
    const chartCostTrend = calcTrend(daily, 'cost');
    const chartRevTrend = calcTrend(daily, 'total_amount');
    const chartOrgRevTrend = calcTrend(daily, 'organic_units_amount');

    // Mini trend badge para header do chart
    const chartTrend = (pct, invert = false) => {
        if (pct == null || isNaN(pct)) return '';
        const abs = Math.abs(pct);
        if (abs < 1) return '<span style="font-size:0.6rem;color:rgba(255,255,255,0.5);margin-left:8px;">\u2194 ~0%</span>';
        const arrow = pct > 0 ? '\u2191' : '\u2193';
        let color;
        if (invert) color = pct > 0 ? '#ff6b8a' : '#4ade80';
        else color = pct > 0 ? '#4ade80' : '#ff6b8a';
        return `<span style="font-size:0.6rem;color:${color};font-weight:600;margin-left:8px;">${arrow}${abs >= 500 ? '>500' : fmt(abs, 0)}%</span>`;
    };

    container.innerHTML = `<div class="adp-charts-grid">
        <div class="adp-chart-card">
            <div class="adp-chart-header">ACOS / TACOS / ROAS Di\u00e1rio ${chartTrend(chartRoasTrend)}</div>
            <div class="adp-chart-body"><canvas id="adp-chart-acos"></canvas></div>
        </div>
        <div class="adp-chart-card">
            <div class="adp-chart-header">Custo vs Faturamento ${chartTrend(chartCostTrend, true)}</div>
            <div class="adp-chart-body"><canvas id="adp-chart-cost-rev"></canvas></div>
        </div>
        <div class="adp-chart-card">
            <div class="adp-chart-header">Visitas Di\u00e1rias: Ads vs Org\u00e2nico + Impress\u00f5es ${chartTrend(calcTrend(daily, 'prints'))}</div>
            <div class="adp-chart-body"><canvas id="adp-chart-visits"></canvas></div>
        </div>
        <div class="adp-chart-card">
            <div class="adp-chart-header">Faturamento: Ads vs Org\u00e2nico ${chartTrend(chartRevTrend)}</div>
            <div class="adp-chart-body"><canvas id="adp-chart-revenue"></canvas></div>
        </div>
        <div class="adp-chart-card full-width" style="padding:16px;">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
                ${(() => {
                    // deltaPP = pontos percentuais (positivo = ads ganhando peso = alerta)
                    const renderComp = (label, detail, adsPctVal, orgPctVal, deltaPP) => {
                        let trendBadge = '';
                        if (deltaPP != null && Math.abs(deltaPP) >= 1) {
                            // ads ganhando peso = ruim (canibalizando), vermelho
                            // ads perdendo peso = bom (org\u00e2nico crescendo), verde
                            const isBad = deltaPP > 0;
                            const color = isBad ? 'var(--red-dark)' : 'var(--green-dark)';
                            const arrow = deltaPP > 0 ? '\u25b2' : '\u25bc';
                            trendBadge = ` <span title="Varia\u00e7\u00e3o da participa\u00e7\u00e3o de ads (1\u00aa metade vs 2\u00aa metade do per\u00edodo)" style="color:${color};font-weight:700;margin-left:4px;">${arrow}${fmt(Math.abs(deltaPP), 1)}pp</span>`;
                        } else if (deltaPP != null) {
                            trendBadge = ` <span style="color:var(--text-muted);margin-left:4px;">\u2194 est\u00e1vel</span>`;
                        }
                        const hint = deltaPP != null && Math.abs(deltaPP) >= 1
                            ? (deltaPP > 0
                                ? '<div style="font-size:0.58rem;color:var(--red-dark);margin-top:3px;">\u26a0 Ads ganhando peso no per\u00edodo</div>'
                                : '<div style="font-size:0.58rem;color:var(--green-dark);margin-top:3px;">\u2713 Org\u00e2nico crescendo</div>')
                            : '';
                        return `<div style="display:flex;flex-direction:column;min-width:0;">
                            <div style="display:flex;flex-direction:column;gap:2px;margin-bottom:6px;min-height:32px;">
                                <span style="font-size:0.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
                                <span style="font-size:0.62rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${detail}</span>
                            </div>
                            <div style="height:14px;border-radius:6px;background:var(--border);overflow:hidden;display:flex;">
                                <div style="width:${adsPctVal}%;background:var(--blue);display:flex;align-items:center;justify-content:center;min-width:0;">
                                    ${adsPctVal > 8 ? '<span style="font-size:0.5rem;color:#fff;font-weight:700;">' + fmt(adsPctVal, 0) + '%</span>' : ''}
                                </div>
                                <div style="flex:1;background:var(--green);display:flex;align-items:center;justify-content:center;min-width:0;">
                                    ${orgPctVal > 8 ? '<span style="font-size:0.5rem;color:#fff;font-weight:700;">' + fmt(orgPctVal, 0) + '%</span>' : ''}
                                </div>
                            </div>
                            <div style="display:flex;justify-content:space-between;margin-top:4px;">
                                <span style="font-size:0.62rem;color:var(--blue);font-weight:600;">Ads ${fmt(adsPctVal, 1)}%${trendBadge}</span>
                                <span style="font-size:0.62rem;color:var(--green-dark);font-weight:600;">Org\u00e2nico ${fmt(orgPctVal, 1)}%</span>
                            </div>
                            ${hint}
                        </div>`;
                    };
                    return renderComp('Composi\u00e7\u00e3o de Tr\u00e1fego', `${fmtInt(totalAdsClicksSum)} ads / ${fmtInt(totalVisitsSum)} total`, adsPctTotal, orgPctTotal, compositionTrends.traffic) +
                        renderComp('Composi\u00e7\u00e3o de Vendas', `${fmtInt(totalAdsSales)} ads / ${fmtInt(totalSales)} total`, adsSalesPct, orgSalesPct, compositionTrends.sales) +
                        renderComp('Composi\u00e7\u00e3o de Receita', `${fmtMoney(totalAdsRev)} / ${fmtMoney(totalRev)}`, adsRevPct, orgRevPct, compositionTrends.revenue);
                })()}
            </div>
        </div>
    </div>`;

    // Wait for canvas to be in DOM
    setTimeout(() => {
        const chartFont = { family: 'DM Sans', size: 11 };
        const monoFont = { family: 'DM Mono', size: 10 };

        // Crosshair plugin (barra vertical no dia hover)
        const crosshairPlugin = {
            id: 'adpCrosshair',
            afterDraw: (chart) => {
                const tt = chart.tooltip;
                if (!tt || !tt.opacity) return;
                const active = tt.getActiveElements ? tt.getActiveElements() : (chart.getActiveElements && chart.getActiveElements());
                if (!active || !active.length) return;
                const x = active[0].element.x;
                const ctx = chart.ctx;
                const top = chart.chartArea.top;
                const bottom = chart.chartArea.bottom;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, bottom);
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.restore();
            }
        };

        // Interaction config compartilhada
        const sharedInteraction = { mode: 'index', intersect: false };
        const sharedHover = { mode: 'index', intersect: false };
        const sharedTooltipBase = {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleFont: { family: 'DM Sans', size: 12, weight: '700' },
            bodyFont: { family: 'DM Mono', size: 11 },
            padding: 10,
            cornerRadius: 6,
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            boxPadding: 4
        };

        // Chart 1: ACOS/TACOS/ROAS
        const acosData = daily.map(d => d.total_amount > 0 ? (d.cost / d.total_amount) * 100 : 0);
        const tacosData = daily.map(d => {
            const total = d.total_amount + d.organic_units_amount;
            return total > 0 ? (d.cost / total) * 100 : 0;
        });
        const roasData = daily.map(d => d.cost > 0 ? d.total_amount / d.cost : 0);

        const ctx1 = document.getElementById('adp-chart-acos');
        if (ctx1) {
            new Chart(ctx1.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: 'ACOS %', data: acosData, borderColor: '#ff3b5c', backgroundColor: 'rgba(255,59,92,0.08)', tension: 0.3, fill: false, pointRadius: 2, yAxisID: 'y' },
                        { label: 'TACOS %', data: tacosData, borderColor: '#0066ff', backgroundColor: 'rgba(0,102,255,0.08)', tension: 0.3, fill: false, pointRadius: 2, yAxisID: 'y' },
                        { label: 'ROAS', data: roasData, borderColor: '#00d68f', backgroundColor: 'rgba(0,214,143,0.08)', tension: 0.3, fill: false, pointRadius: 2, borderDash: [5, 3], yAxisID: 'y2' }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: sharedInteraction,
                    hover: sharedHover,
                    plugins: {
                        legend: { position: 'top', labels: { font: chartFont, usePointStyle: true } },
                        tooltip: { ...sharedTooltipBase, callbacks: {
                            label: (item) => {
                                const v = item.parsed.y;
                                if (item.dataset.label === 'ROAS') return 'ROAS: ' + v.toFixed(2) + 'x';
                                return item.dataset.label + ': ' + v.toFixed(2) + '%';
                            }
                        }}
                    },
                    scales: {
                        y: { beginAtZero: true, position: 'left', ticks: { font: monoFont, callback: v => v + '%' } },
                        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: monoFont, callback: v => v + 'x' } },
                        x: { ticks: { font: { family: 'DM Sans', size: 10 }, maxRotation: 45 } }
                    }
                },
                plugins: [crosshairPlugin]
            });
        }

        // Chart 2: Cost vs Revenue
        const ctx2 = document.getElementById('adp-chart-cost-rev');
        if (ctx2) {
            new Chart(ctx2.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Custo Ads', data: daily.map(d => d.cost), backgroundColor: 'rgba(255,59,92,0.6)', borderRadius: 3 },
                        { label: 'Fat. Ads', data: daily.map(d => d.total_amount), backgroundColor: 'rgba(0,102,255,0.6)', borderRadius: 3 },
                        { label: 'Fat. Org\u00e2nico', data: daily.map(d => d.organic_units_amount), backgroundColor: 'rgba(0,214,143,0.6)', borderRadius: 3 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: sharedInteraction,
                    hover: sharedHover,
                    plugins: {
                        legend: { position: 'top', labels: { font: chartFont, usePointStyle: true } },
                        tooltip: { ...sharedTooltipBase, callbacks: {
                            label: (item) => item.dataset.label + ': R$ ' + (item.parsed.y || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}),
                            footer: (items) => {
                                if (!items.length) return '';
                                const idx = items[0].dataIndex;
                                const d = daily[idx] || {};
                                const totalFat = (d.total_amount || 0) + (d.organic_units_amount || 0);
                                const cost = d.cost || 0;
                                const tacos = totalFat > 0 ? (cost / totalFat) * 100 : 0;
                                const roas = cost > 0 ? (d.total_amount || 0) / cost : 0;
                                return 'TACOS: ' + tacos.toFixed(2) + '%  |  ROAS: ' + roas.toFixed(2) + 'x';
                            }
                        }}
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { font: monoFont, callback: v => 'R$' + v.toLocaleString('pt-BR') } },
                        x: { ticks: { font: { family: 'DM Sans', size: 10 }, maxRotation: 45 } }
                    }
                },
                plugins: [crosshairPlugin]
            });
        }

        // Chart 3: Visitas Ads vs Organico + Impressoes
        const ctx3 = document.getElementById('adp-chart-visits');
        if (ctx3) {
            new Chart(ctx3.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Visitas Ads', data: visitsEntries.map(e => e.ads), backgroundColor: 'rgba(0,102,255,0.6)', stack: 'visits', borderRadius: 2, yAxisID: 'y' },
                        { label: 'Visitas Org\u00e2nicas', data: visitsEntries.map(e => e.organic), backgroundColor: 'rgba(0,214,143,0.6)', stack: 'visits', borderRadius: 2, yAxisID: 'y' },
                        { label: 'Impress\u00f5es', data: visitsEntries.map(e => e.prints), type: 'line', borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.3, pointRadius: 1, fill: false, yAxisID: 'y2' }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: sharedInteraction,
                    hover: sharedHover,
                    plugins: {
                        legend: { position: 'top', labels: { font: chartFont, usePointStyle: true } },
                        tooltip: { ...sharedTooltipBase, callbacks: {
                            label: (item) => item.dataset.label + ': ' + (item.parsed.y || 0).toLocaleString('pt-BR'),
                            afterBody: (items) => {
                                const idx = items[0]?.dataIndex;
                                if (idx == null) return '';
                                const org = visitsEntries[idx]?.organic || 0;
                                const ads = visitsEntries[idx]?.ads || 0;
                                const total = org + ads;
                                const adsPct = total > 0 ? ((ads / total) * 100).toFixed(0) : '0';
                                return 'Total: ' + total.toLocaleString('pt-BR') + '  |  Ads: ' + adsPct + '%';
                            }
                        }}
                    },
                    scales: {
                        y: { beginAtZero: true, position: 'left', stacked: true, ticks: { font: monoFont } },
                        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: monoFont, color: '#f59e0b' } },
                        x: { stacked: true, ticks: { font: { family: 'DM Sans', size: 10 }, maxRotation: 45 } }
                    }
                },
                plugins: [crosshairPlugin]
            });
        }

        // Chart 4: Revenue Ads vs Organic (stacked area)
        const ctx4 = document.getElementById('adp-chart-revenue');
        if (ctx4) {
            new Chart(ctx4.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: 'Faturamento Ads', data: daily.map(d => d.total_amount), borderColor: '#0066ff', backgroundColor: 'rgba(0,102,255,0.15)', fill: true, tension: 0.3, pointRadius: 2 },
                        { label: 'Faturamento Org\u00e2nico', data: daily.map(d => d.organic_units_amount), borderColor: '#00d68f', backgroundColor: 'rgba(0,214,143,0.15)', fill: true, tension: 0.3, pointRadius: 2 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: sharedInteraction,
                    hover: sharedHover,
                    plugins: {
                        legend: { position: 'top', labels: { font: chartFont, usePointStyle: true } },
                        tooltip: { ...sharedTooltipBase, callbacks: {
                            label: (item) => item.dataset.label + ': R$ ' + (item.parsed.y || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}),
                            footer: (items) => {
                                if (!items.length) return '';
                                const idx = items[0].dataIndex;
                                const d = daily[idx] || {};
                                const total = (d.total_amount || 0) + (d.organic_units_amount || 0);
                                const adsPct = total > 0 ? ((d.total_amount || 0) / total) * 100 : 0;
                                return 'Total: R$ ' + total.toLocaleString('pt-BR', {minimumFractionDigits:2}) + '  |  Ads: ' + adsPct.toFixed(0) + '%';
                            }
                        }}
                    },
                    scales: {
                        y: { beginAtZero: true, stacked: true, ticks: { font: monoFont, callback: v => 'R$' + v.toLocaleString('pt-BR') } },
                        x: { ticks: { font: { family: 'DM Sans', size: 10 }, maxRotation: 45 } }
                    }
                },
                plugins: [crosshairPlugin]
            });
        }
    }, 100);
}

// ══════════════════════════════════════════════════════
// Section 7: Campaign Insights
// ══════════════════════════════════════════════════════

function renderCampaignInsights(overview, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const campaigns = overview.campaigns || [];
    const items = overview.items || [];

    if (campaigns.length === 0) {
        container.innerHTML = '';
        return;
    }

    // Pre-scan: campanhas com or\u00e7amento limitante
    const daysForAvg = _currentDays || 30;
    const budgetConstrained = [];
    for (const camp of campaigns) {
        if (!camp.budget || camp.budget <= 0) continue;
        const campCost = getCampaignMetrics(camp, items).cost;
        if (campCost <= 0) continue;
        const usage = ((campCost / daysForAvg) / camp.budget) * 100;
        if (usage >= 80) budgetConstrained.push({ id: camp.campaign_id, usage });
    }
    const budgetConstrainedIds = new Set(budgetConstrained.map(c => c.id));

    let html = '<div class="adp-section-title">Insights por Campanha</div>';

    // Educational banner: por que or\u00e7amento importa
    if (budgetConstrained.length > 0) {
        html += `<div style="background:linear-gradient(135deg,#fef3c7,#fef9e7);border:1px solid #fbbf24;border-left:4px solid #f59e0b;border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px;display:flex;gap:12px;align-items:flex-start;">
            <div style="font-size:1.4rem;line-height:1;">\u26a0\ufe0f</div>
            <div style="flex:1;font-size:0.78rem;line-height:1.5;color:#78350f;">
                <div style="font-weight:800;color:#92400e;margin-bottom:4px;">${budgetConstrained.length === 1 ? 'Campanha com or\u00e7amento limitante' : `${budgetConstrained.length} campanhas com or\u00e7amento limitante`}</div>
                <strong>Por que isso importa:</strong> o Mercado Livre usa dados de <strong>24 horas completas</strong> pra calcular ROAS e decidir qu\u00e3o bem entregar seus an\u00fancios. Se o or\u00e7amento di\u00e1rio acaba antes do dia fechar, o algoritmo n\u00e3o tem janela pra aprender \u2014 resultado: sua entrega cai nos dias seguintes e fica muito mais dif\u00edcil bater sua meta de ROAS. As campanhas marcadas com <span style="background:#f59e0b;color:#fff;padding:1px 6px;border-radius:3px;font-size:0.68rem;font-weight:800;">\u26a0 BUDGET</span> abaixo est\u00e3o nessa situa\u00e7\u00e3o.
            </div>
        </div>`;
    }

    html += '<div class="adp-campaigns-grid">';

    const sidCamp = overview.seller_id || '';

    for (const camp of campaigns) {
        const campItems = items.filter(i => i.campaign_id === camp.campaign_id);
        // Métricas REAIS da campanha (API ML via camp.metrics). A soma dos items
        // seria parcial: /ads-items traz só os top 50 da conta inteira.
        const cm = getCampaignMetrics(camp, items);
        const campCost = cm.cost;
        const campRevenue = cm.revenue;
        const campAcos = cm.acos;
        const campTacos = cm.tacos;
        const campRoas = cm.roas;
        const campOrders = cm.orders;
        const campAdsSalesPct = cm.adsSalesPct;
        const campImpressions = cm.impressions;
        const campClicks = cm.clicks;
        const campCvr = cm.cvr;
        const campCtr = cm.ctr;

        // Tend\u00eancias por campanha (vs visita anterior)
        const cTrend = sidCamp ? rtGetCampaignTrend(sidCamp, camp.campaign_id) : null;

        const stratBadge = camp.strategy === 'PROFITABILITY' ? 'adp-badge-green' : 'adp-badge-blue';
        const stratLabel = camp.strategy === 'PROFITABILITY' ? 'Rentabilidade' : camp.strategy === 'VISIBILITY' ? 'Visibilidade' : (camp.strategy || 'N/A');
        const isBudgetLimited = budgetConstrainedIds.has(camp.campaign_id);
        const budgetInfo = isBudgetLimited ? budgetConstrained.find(c => c.id === camp.campaign_id) : null;

        // URL pra abrir campanha no Mercado Livre — usa host do site config quando dispon\u00edvel
        const mlHostCamp = (window.MF_getSiteConfig && window.MF_currentSiteId)
            ? window.MF_getSiteConfig(window.MF_currentSiteId()).host
            : 'www.mercadolivre.com.br';
        const campaignMlUrl = `https://${mlHostCamp}/anuncios/product-ads/campanha/${encodeURIComponent(camp.campaign_id)}`;

        html += `<div class="adp-campaign-card${isBudgetLimited ? ' adp-campaign-card-constrained' : ''}">
            <div class="adp-campaign-name" style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap;">
                <span style="flex:1;min-width:0;">${escapeHtml(camp.name || 'Campanha sem nome')}${isBudgetLimited ? ` <span class="adp-badge-budget-warn" title="Or\u00e7amento limitando entrega \u2014 ${fmt(budgetInfo.usage, 0)}% uso di\u00e1rio">\u26a0 BUDGET</span>` : ''}</span>
                <a href="${campaignMlUrl}" target="_blank" rel="noopener" title="Abrir esta campanha no Mercado Livre Product Ads" style="background:#fff159;color:#222;border:1px solid #d6c500;font-size:0.65rem;padding:4px 9px;border-radius:4px;text-decoration:none;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">\ud83d\udd17 Abrir no ML</a>
            </div>
            <div class="adp-campaign-badges">
                <span class="adp-badge ${stratBadge}">${stratLabel}</span>
                ${(() => {
                    // Badge de contagem: a lista de anuncios cobre so os top da conta.
                    // Com lista parcial, nao afirmar total; com 0 listados, omitir (o
                    // drilldown explica). Metricas do card seguem cobrindo a campanha inteira.
                    if (campItems.length === 0) return '';
                    if (overview.partial) return `<span class="adp-badge adp-badge-gray" title="An\u00fancios desta campanha que est\u00e3o entre os mais ativos da conta \u2014 as m\u00e9tricas do card cobrem a campanha inteira">${campItems.length} listado${campItems.length !== 1 ? 's' : ''}</span>`;
                    return `<span class="adp-badge adp-badge-gray">${campItems.length} an\u00fancio${campItems.length !== 1 ? 's' : ''}</span>`;
                })()}
                ${camp.budget ? `<span class="adp-badge ${isBudgetLimited ? 'adp-badge-red' : 'adp-badge-yellow'}">Or\u00e7amento: ${fmtMoney(camp.budget)}${isBudgetLimited ? ` (${fmt(budgetInfo.usage, 0)}% uso)` : ''}</span>` : ''}
                ${camp.acos_target ? `<span class="adp-badge adp-badge-blue">Meta ACOS: ${camp.acos_target}%</span>` : ''}
                ${camp.roas_target ? `<span class="adp-badge adp-badge-green">Meta ROAS: ${camp.roas_target}x</span>` : ''}
                ${camp.status ? `<span class="adp-badge ${camp.status === 'active' ? 'adp-badge-green' : 'adp-badge-red'}">${camp.status === 'active' ? 'Ativo' : camp.status === 'paused' ? 'Pausado' : camp.status}</span>` : ''}
            </div>
            ${(() => {
                // Célula de métrica: label / valor / tendência em linhas separadas (nada corta)
                const cell = (label, valueHtml, chip) => `<div class="adp-campaign-metric">
                    <div class="adp-campaign-metric-label">${label}</div>
                    <div class="adp-campaign-metric-value">${valueHtml}</div>
                    <div class="adp-campaign-metric-trend">${chip || '&nbsp;'}</div>
                </div>`;
                const heroCells =
                    cell('Custo da campanha', `<span title="${fmtMoney(campCost)}">${fmtMoney(campCost)}</span>`, rtTrendChip(cTrend && cTrend.cost, true, { size: '0.65rem' })) +
                    cell('Faturamento Ads', `<span class="text-green" title="${fmtMoney(campRevenue)}">${fmtMoney(campRevenue)}</span>`, rtTrendChip(cTrend && cTrend.revenue, false, { size: '0.65rem' }));
                const gridCells =
                    cell('ACOS', `<span class="${campAcos > 30 ? 'text-red' : campAcos > 20 ? 'text-yellow' : 'text-green'}">${fmt(campAcos)}%</span>`, rtTrendChip(cTrend && cTrend.acos, true)) +
                    cell('TACOS', `<span class="${campTacos > 15 ? 'text-red' : campTacos > 10 ? 'text-yellow' : 'text-green'}">${fmt(campTacos)}%</span>`, rtTrendChip(cTrend && cTrend.tacos, true)) +
                    cell('ROAS', `<span class="${campRoas < 1 ? 'text-red' : campRoas < 3 ? 'text-yellow' : 'text-green'}">${fmt(campRoas)}x</span>`, rtTrendChip(cTrend && cTrend.roas, false)) +
                    cell('% Ads', `<span class="${campAdsSalesPct > 80 ? 'text-red' : campAdsSalesPct > 60 ? 'text-yellow' : 'text-green'}">${fmt(campAdsSalesPct, 0)}%</span>`, rtTrendChip(cTrend && cTrend.adsSalesPct, true)) +
                    cell('CTR', `${fmt(campCtr, 2)}%`, rtTrendChip(cTrend && cTrend.ctr, false)) +
                    cell('CVR', `${fmt(campCvr, 2)}%`, rtTrendChip(cTrend && cTrend.cvr, false)) +
                    cell('Impressões', fmtInt(campImpressions), rtTrendChip(cTrend && cTrend.prints, false)) +
                    cell('Cliques', fmtInt(campClicks), rtTrendChip(cTrend && cTrend.clicks, false)) +
                    cell('Pedidos', fmtInt(campOrders), rtTrendChip(cTrend && cTrend.orders, false));
                return `<div class="adp-campaign-metrics adp-camp-hero">${heroCells}</div>
            <div class="adp-campaign-metrics">${gridCells}</div>`;
            })()}
            ${camp.roas_target || camp.acos_target ? (() => {
                let targetHtml = '';
                if (camp.roas_target && campRoas > 0) {
                    const pct = Math.min(100, (campRoas / camp.roas_target) * 100);
                    const color = pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';
                    targetHtml += '<div style="margin-top:12px;"><div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;">ROAS Atual vs Meta</span><span style="font-size:0.62rem;font-family:DM Mono,monospace;font-weight:700;">' + fmt(campRoas) + 'x / ' + camp.roas_target + 'x</span></div><div style="height:8px;border-radius:4px;background:var(--border);overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:4px;transition:width 0.5s;"></div></div></div>';
                }
                if (camp.acos_target && campAcos > 0) {
                    const pct = Math.min(100, (camp.acos_target / campAcos) * 100);
                    const color = pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';
                    targetHtml += '<div style="margin-top:8px;"><div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;">ACOS Atual vs Meta</span><span style="font-size:0.62rem;font-family:DM Mono,monospace;font-weight:700;">' + fmt(campAcos) + '% / ' + camp.acos_target + '%</span></div><div style="height:8px;border-radius:4px;background:var(--border);overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:4px;transition:width 0.5s;"></div></div></div>';
                }
                const tacosTarget = window._tacosTarget || (camp.roas_target ? (100 / camp.roas_target) : 0);
                if (tacosTarget > 0 && campTacos > 0) {
                    const pct = Math.min(100, (tacosTarget / campTacos) * 100);
                    const color = pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';
                    targetHtml += '<div style="margin-top:8px;"><div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;">TACOS Atual vs Meta</span><span style="font-size:0.62rem;font-family:DM Mono,monospace;font-weight:700;">' + fmt(campTacos) + '% / ' + fmt(tacosTarget) + '%</span></div><div style="height:8px;border-radius:4px;background:var(--border);overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:4px;transition:width 0.5s;"></div></div></div>';
                }
                return targetHtml;
            })() : ''}
            ${(() => {
                const alertas = [];
                if (campRoas < 1 && campCost > 0) alertas.push({ icon: '\ud83d\udea8', text: 'ROAS abaixo de 1x. Campanha est\u00e1 dando preju\u00edzo.', color: 'var(--red-light)' });
                if (campAcos > 30) alertas.push({ icon: '\u26a0\ufe0f', text: `ACOS de ${fmt(campAcos)}% est\u00e1 muito alto.`, color: 'var(--yellow-light)' });
                if (campAdsSalesPct > 80) alertas.push({ icon: '\ud83d\udea8', text: `${fmt(campAdsSalesPct,0)}% das vendas via ads. Depend\u00eancia excessiva.`, color: 'var(--red-light)' });
                if (campCtr < 0.3 && campImpressions > 500) alertas.push({ icon: '\ud83d\uddbc\ufe0f', text: `CTR de ${fmt(campCtr)}%. An\u00fancios n\u00e3o atraem cliques.`, color: 'var(--yellow-light)' });
                if (campCvr < 1 && campClicks > 20) alertas.push({ icon: '\ud83d\udcb0', text: `Convers\u00e3o de ${fmt(campCvr)}%. Cliques n\u00e3o convertem.`, color: 'var(--yellow-light)' });
                if (campCost > 50 && campOrders === 0) alertas.push({ icon: '\ud83d\udeab', text: `Gastou ${fmtMoney(campCost)} sem nenhuma venda.`, color: 'var(--red-light)' });

                if (camp.budget && campCost > 0) {
                    const dailyAvgCost = campCost / (_currentDays || 30);
                    const budgetUsage = (dailyAvgCost / camp.budget) * 100;
                    if (budgetUsage >= 95) {
                        alertas.push({ icon: '\ud83d\udea8', text: `Or\u00e7amento di\u00e1rio esgotando (${fmt(budgetUsage, 0)}% usado). O ML n\u00e3o consegue calcular ROAS com 24h completas \u2014 sua entrega cai. Aumente o or\u00e7amento j\u00e1!`, color: 'var(--red-light)' });
                    } else if (budgetUsage >= 80) {
                        alertas.push({ icon: '\ud83d\udcb8', text: `Or\u00e7amento com ${fmt(budgetUsage, 0)}% de uso di\u00e1rio. Sem janela de 24h, o algoritmo do ML n\u00e3o otimiza direito e dificulta bater sua meta.`, color: 'var(--yellow-light)' });
                    }
                }

                if (alertas.length === 0) return '';
                return '<div style="margin-top:12px;"><div style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">Pontos de Aten\u00e7\u00e3o</div>' +
                    alertas.map(a => '<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:' + a.color + ';border-radius:4px;margin-bottom:3px;font-size:0.72rem;"><span>' + a.icon + '</span><span>' + a.text + '</span></div>').join('') +
                    '</div>';
            })()}
            ${(() => {
                // Drilldown \u2014 anuncios que pertencem a esta campanha (sem tendencias por item:
                // titulo numa linha, metricas na linha de baixo \u2014 nada cortado)
                if (campItems.length === 0) {
                    // Campanha com gasto mas nenhum anuncio listado: ou os anuncios sairam
                    // da campanha (custo do periodo fica nela) ou nao estao entre os top da conta.
                    if (campCost <= 0) return '';
                    return `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">
                        <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--row-alt);border-radius:var(--radius-sm);font-size:0.7rem;line-height:1.5;color:var(--text-secondary);">
                            <span>\u2139\ufe0f</span>
                            <span>Os an\u00fancios desta campanha n\u00e3o est\u00e3o entre os mais ativos da conta no per\u00edodo \u2014 ou j\u00e1 foram movidos/removidos da campanha. Os n\u00fameros acima cobrem todo o investimento e faturamento que a campanha registrou no per\u00edodo.</span>
                        </div>
                    </div>`;
                }
                const sorted = [...campItems].sort((a,b) => (b.cost||0) - (a.cost||0));
                const top5 = sorted.slice(0, 5);
                const rest = sorted.slice(5);
                const detailsItems = (window._currentItemDetails || {});
                const drilldownId = `adp-camp-items-${camp.campaign_id}`;
                const restId = `${drilldownId}-rest`;
                const renderItemRow = (it) => {
                    const d = detailsItems[it.item_id] || {};
                    const thumb = (d.thumbnail || '').replace(/^http:\/\//,'https://');
                    const itRoas = it.cost > 0 ? (it.revenue / it.cost) : 0;
                    const totalRev = (it.revenue||0) + (it.organic_revenue||0);
                    const itTacos = totalRev > 0 ? (it.cost / totalRev) * 100 : 0;
                    const stat = (label, value, valueStyle) => `<span style="white-space:nowrap;"><span style="color:var(--text-muted);font-size:0.6rem;text-transform:uppercase;">${label}</span> <span style="font-family:'DM Mono',monospace;font-weight:700;${valueStyle || ''}">${value}</span></span>`;
                    return `<div class="adp-camp-item-row">
                        ${thumb ? `<img src="${escapeHtml(thumb)}" style="width:30px;height:30px;border-radius:4px;object-fit:cover;flex-shrink:0;">` : '<div style="width:30px;height:30px;background:var(--border);border-radius:4px;flex-shrink:0;"></div>'}
                        <div style="flex:1;min-width:0;">
                            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:0.72rem;" title="${escapeHtml(d.title || it.item_id)}">${escapeHtml(d.title || it.item_id)}</div>
                            <div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:2px;font-size:0.68rem;">
                                ${stat('Custo', fmtMoney(it.cost||0))}
                                ${stat('Fat. Ads', fmtMoney(it.revenue||0), 'color:var(--green-dark);')}
                                ${stat('ROAS', fmt(itRoas) + 'x', itRoas < 1 ? 'color:var(--red-dark);' : itRoas >= 3 ? 'color:var(--green-dark);' : '')}
                                ${stat('TACOS', fmt(itTacos) + '%')}
                            </div>
                        </div>
                    </div>`;
                };
                const top5Html = top5.map(renderItemRow).join('');
                const restHtml = rest.length ? `<div id="${restId}" style="display:none;">${rest.map(renderItemRow).join('')}</div>` : '';
                const verTodosBtn = rest.length ? `<div style="text-align:center;padding:6px;"><button onclick="window.adpToggleCampItems('${restId}', this)" style="background:transparent;border:1px solid var(--border);color:var(--text-secondary);font-size:0.68rem;padding:4px 12px;border-radius:4px;cursor:pointer;font-family:inherit;">Ver todos (+${rest.length})</button></div>` : '';
                return `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;cursor:pointer;" onclick="window.adpToggleCampDrilldown('${drilldownId}', this)">
                        <div style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;" ${overview.partial ? 'title="Mostrando os an\u00fancios desta campanha que est\u00e3o entre os mais ativos da conta \u2014 as m\u00e9tricas do card cobrem a campanha inteira"' : ''}>An\u00fancios desta campanha (${campItems.length}${overview.partial ? ' listados' : ''})</div>
                        <span class="adp-camp-drilldown-arrow" style="font-size:0.7rem;color:var(--text-muted);">\u25bc</span>
                    </div>
                    <div id="${drilldownId}" style="display:none;">
                        ${top5Html}
                        ${restHtml}
                        ${verTodosBtn}
                    </div>
                </div>`;
            })()}
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

// ══════════════════════════════════════════════════════
// Section 7b: Ranking & Sugestoes
// ══════════════════════════════════════════════════════

function getItemSuggestion(item) {
    const suggestions = [];
    const roas = item.cost > 0 ? item.revenue / item.cost : 0;

    // Alertas objetivos (fatos)
    if (item.cost > 0 && item._price > 0 && item.cost > item._price * 0.25 && item.orders === 0) {
        suggestions.push({ icon: '\ud83d\udea8', text: `Gastou ${fmtMoney(item.cost)} (${fmt((item.cost / item._price) * 100, 0)}% do pre\u00e7o de ${fmtMoney(item._price)}) sem venda. Revise urgente.` });
    } else if (item.cost > 30 && item.orders === 0) {
        suggestions.push({ icon: '\ud83d\udeab', text: 'Sem vendas. Considere pausar este an\u00fancio.' });
    }
    if (roas > 0 && roas < 1) suggestions.push({ icon: '\ud83d\udcc9', text: `ROAS ${fmt(roas)}x. Gastando mais do que fatura.` });

    // Alertas relativos (comparando com media da conta)
    const avgCtr = _tableData.length > 0 ? _tableData.reduce((s, i) => s + (i.ctr || 0), 0) / _tableData.filter(i => i.ctr > 0).length || 0 : 0;
    const avgCvr = _tableData.length > 0 ? _tableData.reduce((s, i) => s + (i.cvr || 0), 0) / _tableData.filter(i => i.cvr > 0).length || 0 : 0;

    if (avgCtr > 0 && item.ctr < avgCtr * 0.5 && item.impressions > 500) {
        suggestions.push({ icon: '\ud83d\uddbc\ufe0f', text: `CTR ${fmt(item.ctr)}% abaixo da m\u00e9dia da conta (${fmt(avgCtr)}%). Revise caracter\u00edsticas e fotos (n\u00e3o altere o t\u00edtulo).` });
    }
    if (avgCvr > 0 && item.cvr < avgCvr * 0.5 && item.clicks > 20) {
        suggestions.push({ icon: '\ud83d\udcb0', text: `Convers\u00e3o ${fmt(item.cvr)}% abaixo da m\u00e9dia da conta (${fmt(avgCvr)}%). Revise pre\u00e7o e condi\u00e7\u00f5es.` });
    }

    // Oportunidades — escala baseada na meta da campanha
    const avgRoas = _tableData.length > 0 ? _tableData.reduce((s, i) => s + (i._roas || 0), 0) / _tableData.filter(i => i._roas > 0).length || 0 : 0;
    const minSpendForScale = (item._price || 0) * 2;

    // Verificar meta da campanha (ROAS target)
    const campInfo = _allCampaigns.find(c => c.campaign_id === item.campaign_id);
    const roasTarget = campInfo?.roas_target || 0;

    if (roasTarget > 0 && roas > roasTarget && item.orders > 0) {
        // Acima da meta da campanha — eleg\u00edvel para escala
        if (item.cost >= minSpendForScale && minSpendForScale > 0) {
            suggestions.push({ icon: '\ud83d\udcc8', text: `Eleg\u00edvel para escala. ROAS ${fmt(roas)}x acima da meta (${roasTarget}x) gastando ${fmtMoney(item.cost)} (>${fmtMoney(minSpendForScale)}). Considere baixar o ROAS alvo para aumentar a entrega.` });
        } else {
            suggestions.push({ icon: '\ud83d\ude80', text: `ROAS ${fmt(roas)}x acima da meta (${roasTarget}x). Bom candidato para escalar.` });
        }
    } else if (roasTarget > 0 && roas > 0 && roas < roasTarget && item.orders > 0) {
        suggestions.push({ icon: '\u26a0\ufe0f', text: `ROAS ${fmt(roas)}x abaixo da meta (${roasTarget}x). Otimize antes de escalar.` });
    } else if (roas > avgRoas * 1.5 && item.orders > 0 && avgRoas > 0) {
        suggestions.push({ icon: '\ud83d\ude80', text: `ROAS ${fmt(roas)}x acima da m\u00e9dia da conta (${fmt(avgRoas)}x). Bom candidato para escalar.` });
    } else if (item.cost >= minSpendForScale && minSpendForScale > 0 && roas > avgRoas && roas > 1 && item.orders > 0) {
        suggestions.push({ icon: '\ud83d\udcc8', text: `Suporta escala. ROAS ${fmt(roas)}x com gasto significativo (${fmtMoney(item.cost)}).` });
    }

    if (suggestions.length === 0 && item.revenue > 0) suggestions.push({ icon: '\u2705', text: 'Desempenho saud\u00e1vel.' });
    if (suggestions.length === 0 && item.cost === 0) suggestions.push({ icon: '\u2139\ufe0f', text: 'Sem dados de gasto ainda.' });
    return suggestions;
}

function renderRanking(overview, itemDetails, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const items = (overview.items || []).filter(i => i.has_ads);
    if (items.length < 2) { container.innerHTML = ''; return; }

    // Enrich
    const campaigns = overview.campaigns || [];
    const sid = overview.seller_id || '';
    items.forEach(i => {
        const d = itemDetails[i.item_id] || {};
        i._title = d.title || i.item_id;
        i._thumb = d.thumbnail || '';
        i._permalink = d.permalink || '';
        i._price = d.price || 0;
        i._originalPrice = d.original_price || 0;
        i._roas = i.cost > 0 ? i.revenue / i.cost : 0;
        i._tacos = (i.revenue + (i.organic_revenue || 0)) > 0 ? (i.cost / (i.revenue + (i.organic_revenue || 0))) * 100 : 0;
        i._campInfo = campaigns.find(c => c.campaign_id === i.campaign_id);
        i._trend = sid ? rtGetItemTrend(sid, i.item_id) : null;
    });

    // Top 5 best ROAS (with revenue > 0)
    const withRevenue = items.filter(i => i.revenue > 0);
    const topRoas = [...withRevenue].sort((a, b) => b._roas - a._roas).slice(0, 5);
    // Top 5 worst (highest cost with lowest ROAS)
    const withCost = items.filter(i => i.cost > 0);
    const worstRoas = [...withCost].sort((a, b) => a._roas - b._roas).slice(0, 5);

    const renderRow = (item, rank, isWorstList, listType) => {
        const shortTitle = item._title.length > 40 ? item._title.substring(0, 40) + '...' : item._title;
        const roasTarget = item._campInfo?.roas_target || 0;
        const aboveMeta = roasTarget > 0 && item._roas > roasTarget;
        // Dentro dos 10% abaixo da meta = aceitavel (proximo da meta)
        const closeToMeta = roasTarget > 0 && item._roas >= roasTarget * 0.9 && item._roas < roasTarget;
        const spentEnough = item._price > 0 && item.cost >= item._price * 0.5;
        const eligibleScale = aboveMeta && spentEnough && item.orders > 0;

        let badge = '';
        if (eligibleScale) {
            badge = '<span style="font-size:0.58rem;background:var(--green-light);color:var(--green-dark);padding:2px 6px;border-radius:3px;font-weight:700;white-space:nowrap;">\ud83d\udcc8 ELEG\u00cdVEL P/ ESCALA</span>';
        } else if (aboveMeta) {
            badge = '<span style="font-size:0.58rem;background:var(--blue-light);color:var(--blue);padding:2px 6px;border-radius:3px;font-weight:700;white-space:nowrap;">ACIMA DA META</span>';
        } else if (closeToMeta) {
            badge = '<span style="font-size:0.58rem;background:#e0f2fe;color:#075985;padding:2px 6px;border-radius:3px;font-weight:700;white-space:nowrap;">PR\u00d3XIMO DA META</span>';
        } else if (roasTarget > 0 && item._roas > 0 && item._roas < roasTarget * 0.9) {
            badge = '<span style="font-size:0.58rem;background:var(--yellow-light);color:var(--yellow-dark);padding:2px 6px;border-radius:3px;font-weight:700;white-space:nowrap;">ABAIXO DA META</span>';
        }

        // Preco + desconto
        let priceInfo = '';
        if (item._price > 0) {
            const hasDiscount = item._originalPrice > 0 && item._originalPrice > item._price;
            if (hasDiscount) {
                const discountPct = ((item._originalPrice - item._price) / item._originalPrice) * 100;
                priceInfo = `<span style="font-family:'DM Mono',monospace;font-weight:600;color:var(--green-dark);">${fmtMoney(item._price)}</span> <span style="text-decoration:line-through;color:var(--text-muted);font-size:0.6rem;">${fmtMoney(item._originalPrice)}</span> <span style="color:var(--green-dark);font-weight:700;">-${fmt(discountPct, 0)}%</span>`;
            } else {
                priceInfo = `<span style="font-family:'DM Mono',monospace;font-weight:600;">${fmtMoney(item._price)}</span>`;
            }
        }

        const metaInfo = roasTarget > 0 ? `Meta: ${roasTarget}x` : '';
        // "gastou X% do preco" so aparece na lista "pra revisar"
        const spentPct = isWorstList && item._price > 0 ? fmt((item.cost / item._price) * 100, 0) + '% do pre\u00e7o' : '';

        const trend = item._trend || {};
        const detailId = `adp-rank-detail-${listType}-${item.item_id}`;
        const ctrPct = (item.ctr || 0); // ctr is a fraction in some places \u2014 need to verify; here uses %
        const cvrPct = (item.cvr || 0);
        // expand button + extras row
        const extraMetricCard = (label, value, sub, trendPct, invertColor) => `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:6px 8px;min-width:0;">
                <div style="font-size:0.55rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;font-weight:700;">${label}</div>
                <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:0.78rem;line-height:1.1;margin-top:2px;">${value}</div>
                ${sub ? `<div style="font-size:0.55rem;color:var(--text-muted);">${sub}</div>` : ''}
                ${rtTrendChip(trendPct, invertColor)}
            </div>`;

        const detailHtml = `<div id="${detailId}" style="display:none;border-top:1px dashed var(--border);background:rgba(0,0,0,0.02);padding:10px 12px;">
            <div style="font-size:0.6rem;color:var(--text-muted);font-family:'DM Mono',monospace;margin-bottom:6px;">${escapeHtml(item.item_id)}${item._campInfo ? ' \u00b7 ' + escapeHtml(item._campInfo.name || 'Campanha') : ''}${trend && trend.prevDate ? ' \u00b7 vs ' + trend.prevDate : ''}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(85px,1fr));gap:5px;">
                ${extraMetricCard('ACOS', fmt(item.acos, 2) + '%', 'gasto / fat. ads', trend.acos, true)}
                ${extraMetricCard('CTR', fmt(ctrPct, 2) + '%', 'cliques / impr.', trend.ctr, false)}
                ${extraMetricCard('CVR', fmt(cvrPct, 2) + '%', 'pedidos / clique', trend.cvr, false)}
                ${extraMetricCard('Impress\u00f5es', fmtInt(item.impressions || 0), 'pessoas alcan\u00e7adas', trend.prints, false)}
                ${extraMetricCard('Cliques', fmtInt(item.clicks || 0), 'pessoas que clicaram', trend.clicks, false)}
                ${extraMetricCard('Pedidos', fmtInt(item.orders || 0), 'vendas via ads', trend.orders, false)}
                ${extraMetricCard('Faturamento', fmtMoney(item.revenue || 0), 'gerado por ads', trend.revenue, false)}
                ${item._price > 0 ? extraMetricCard('Pre\u00e7o atual', fmtMoney(item._price), item._originalPrice > item._price ? 'antes ' + fmtMoney(item._originalPrice) : '', null, false) : ''}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                ${item._permalink ? `<a href="${escapeHtml(item._permalink)}" target="_blank" rel="noopener" style="font-size:0.7rem;background:#fff159;color:#222;border:1px solid #d6c500;padding:5px 10px;border-radius:4px;text-decoration:none;font-weight:700;display:inline-flex;align-items:center;gap:4px;">\ud83d\udd17 Ver no Mercado Livre</a>` : ''}
                <a href="/analise-anuncio?item=${encodeURIComponent(item.item_id)}" target="_blank" rel="noopener" style="font-size:0.7rem;background:var(--blue);color:#fff;padding:5px 10px;border-radius:4px;text-decoration:none;font-weight:700;display:inline-flex;align-items:center;gap:4px;">\ud83d\udd0e Analisar este an\u00fancio</a>
                <a href="https://www.mercadolivre.com.br/anuncios/${encodeURIComponent(item.item_id)}/modificar" target="_blank" rel="noopener" style="font-size:0.7rem;background:transparent;color:var(--text-secondary);border:1px solid var(--border);padding:5px 10px;border-radius:4px;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:4px;">\u270f\ufe0f Editar no ML</a>
            </div>
        </div>`;

        const trendRoas = rtTrendChip(trend.roas, false);
        const trendTacos = rtTrendChip(trend.tacos, true);
        const trendCost = rtTrendChip(trend.cost, true);

        return `<div style="border-bottom:1px solid var(--border);${rank % 2 === 0 ? 'background:var(--row-alt);' : ''}">
            <div style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;cursor:pointer;" onclick="window.adpRankToggle('${detailId}', this)" title="Clique para expandir m\u00e9tricas detalhadas">
                <span style="font-family:'DM Mono',monospace;font-size:0.72rem;font-weight:700;color:var(--text-muted);width:18px;padding-top:2px;">#${rank + 1}</span>
                ${item._thumb ? `<img src="${escapeHtml(item._thumb)}" style="width:36px;height:36px;border-radius:4px;object-fit:cover;flex-shrink:0;">` : '<div style="width:36px;height:36px;background:var(--border);border-radius:4px;flex-shrink:0;"></div>'}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(item._title)}">${escapeHtml(shortTitle)}</div>
                    <div style="font-size:0.6rem;color:var(--text-muted);font-family:'DM Mono',monospace;margin-top:1px;">${escapeHtml(item.item_id)}</div>
                    <div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px;">${priceInfo}${priceInfo && metaInfo ? ' \u2014 ' : ''}${metaInfo}${spentPct ? ' \u2014 Gastou ' + spentPct : ''}</div>
                    ${badge ? `<div style="margin-top:4px;">${badge}</div>` : ''}
                </div>
                <div style="text-align:right;min-width:60px;padding-top:2px;">
                    <div style="font-family:'DM Mono',monospace;font-size:0.82rem;font-weight:700;${item._roas > roasTarget && roasTarget > 0 ? 'color:var(--green-dark)' : item._roas >= 1 ? 'color:var(--text)' : 'color:var(--red-dark)'};">${fmt(item._roas)}x</div>
                    <div style="font-size:0.55rem;color:var(--text-muted);">ROAS</div>
                    ${trendRoas ? `<div style="margin-top:1px;">${trendRoas}</div>` : ''}
                </div>
                <div style="text-align:right;min-width:60px;padding-top:2px;">
                    <div style="font-family:'DM Mono',monospace;font-size:0.82rem;font-weight:700;">${fmt(item._tacos)}%</div>
                    <div style="font-size:0.55rem;color:var(--text-muted);">TACOS</div>
                    ${trendTacos ? `<div style="margin-top:1px;">${trendTacos}</div>` : ''}
                </div>
                <div style="text-align:right;min-width:70px;padding-top:2px;">
                    <div style="font-family:'DM Mono',monospace;font-size:0.82rem;font-weight:700;">${fmtMoney(item.cost)}</div>
                    <div style="font-size:0.55rem;color:var(--text-muted);">Custo</div>
                    ${trendCost ? `<div style="margin-top:1px;">${trendCost}</div>` : ''}
                </div>
                <div style="text-align:right;min-width:60px;padding-top:2px;">
                    <div style="font-family:'DM Mono',monospace;font-size:0.82rem;font-weight:700;">${fmtInt(item.impressions || 0)}</div>
                    <div style="font-size:0.55rem;color:var(--text-muted);">Impr.</div>
                    ${rtTrendChip(trend.prints, false) ? `<div style="margin-top:1px;">${rtTrendChip(trend.prints, false)}</div>` : ''}
                </div>
                <div style="text-align:right;min-width:50px;padding-top:2px;">
                    <div style="font-family:'DM Mono',monospace;font-size:0.82rem;font-weight:700;">${fmtInt(item.orders || 0)}</div>
                    <div style="font-size:0.55rem;color:var(--text-muted);">Pedidos</div>
                    ${rtTrendChip(trend.orders, false) ? `<div style="margin-top:1px;">${rtTrendChip(trend.orders, false)}</div>` : ''}
                </div>
                <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-end;padding-top:2px;">
                    ${item._permalink ? `<a href="${escapeHtml(item._permalink)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" title="Abrir an\u00fancio no Mercado Livre" style="background:#fff159;color:#222;border:1px solid #d6c500;font-size:0.6rem;padding:3px 7px;border-radius:3px;font-weight:700;text-decoration:none;white-space:nowrap;">\ud83d\udd17 ML</a>` : ''}
                    <span class="adp-rank-expand-btn" style="font-size:0.7rem;color:var(--text-muted);user-select:none;">\u25bc</span>
                </div>
            </div>
            ${detailHtml}
        </div>`;
    };

    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">';

    // Best performers
    html += `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-sm);animation:slideUp 0.4s ease both;">
        <div style="background:var(--green);color:#fff;padding:10px 16px;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;gap:6px;">
            \ud83c\udfc6 Top 5 Melhores An\u00fancios (ROAS)
        </div>`;
    // All sorted for "ver mais"
    const allBestSorted = [...withRevenue].sort((a, b) => b._roas - a._roas);
    const allWorstSorted = [...withCost].sort((a, b) => a._roas - b._roas);

    const toggleRankFn = (id) => `onclick="const extra=document.getElementById('${id}');const isHidden=extra.style.display==='none';extra.style.display=isHidden?'block':'none';this.textContent=isHidden?'Mostrar menos':'Ver mais';"`;

    if (topRoas.length > 0) {
        topRoas.forEach((item, i) => { html += renderRow(item, i, false, 'best'); });
        if (allBestSorted.length > 5) {
            html += `<div id="adp-best-extra" style="display:none;">`;
            allBestSorted.slice(5, 20).forEach((item, i) => { html += renderRow(item, i + 5, false, 'best'); });
            html += '</div>';
            html += `<div style="text-align:center;padding:8px;"><button ${toggleRankFn('adp-best-extra')} style="background:transparent;border:1px solid var(--border);color:var(--text-secondary);font-size:0.72rem;padding:5px 14px;border-radius:4px;cursor:pointer;font-family:inherit;">Ver mais</button></div>`;
        }
    } else {
        html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.82rem;">Nenhum an\u00fancio com faturamento ainda.</div>';
    }
    html += '</div>';

    // Worst performers
    html += `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-sm);animation:slideUp 0.4s ease both;">
        <div style="background:var(--red);color:#fff;padding:10px 16px;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;gap:6px;">
            \u26a0\ufe0f An\u00fancios para Revisar (Menor ROAS)
        </div>`;
    if (worstRoas.length > 0) {
        worstRoas.forEach((item, i) => { html += renderRow(item, i, true, 'worst'); });
        if (allWorstSorted.length > 5) {
            html += `<div id="adp-worst-extra" style="display:none;">`;
            allWorstSorted.slice(5, 20).forEach((item, i) => { html += renderRow(item, i + 5, true, 'worst'); });
            html += '</div>';
            html += `<div style="text-align:center;padding:8px;"><button ${toggleRankFn('adp-worst-extra')} style="background:transparent;border:1px solid var(--border);color:var(--text-secondary);font-size:0.72rem;padding:5px 14px;border-radius:4px;cursor:pointer;font-family:inherit;">Ver mais</button></div>`;
        }
    } else {
        html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.82rem;">Nenhum an\u00fancio com gasto ainda.</div>';
    }
    html += '</div></div>';

    container.innerHTML = html;
}

// Toggle drilldown de items dentro do card de campanha
window.adpToggleCampDrilldown = function(drilldownId, headerEl) {
    const el = document.getElementById(drilldownId);
    if (!el) return;
    const isHidden = el.style.display === 'none' || el.style.display === '';
    el.style.display = isHidden ? 'block' : 'none';
    const arrow = headerEl && headerEl.querySelector('.adp-camp-drilldown-arrow');
    if (arrow) arrow.textContent = isHidden ? '\u25b2' : '\u25bc';
};

window.adpToggleCampItems = function(restId, btn) {
    const el = document.getElementById(restId);
    if (!el) return;
    const isHidden = el.style.display === 'none' || el.style.display === '';
    el.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.textContent = isHidden ? 'Ver menos' : btn.textContent.replace('Ver menos', 'Ver todos');
};

// Toggle de expans\u00e3o pra cards do Ranking de Oportunidades
window.adpRankToggle = function(detailId, headerEl) {
    const el = document.getElementById(detailId);
    if (!el) return;
    const isHidden = el.style.display === 'none' || el.style.display === '';
    el.style.display = isHidden ? 'block' : 'none';
    const arrow = headerEl && headerEl.querySelector('.adp-rank-expand-btn');
    if (arrow) arrow.textContent = isHidden ? '\u25b2' : '\u25bc';
};

// ══════════════════════════════════════════════════════
// Section 7c: Indicador de Saude + Resumo Executivo
// ══════════════════════════════════════════════════════

// Constr\u00f3i a lista de checks que alimentam o health score.
// Cada check tem: nome, passou (true/false), peso, valor atual, alvo, mensagem.
function buildHealthChecklist(overview, alerts) {
    const agg = overview.aggregated || {};
    const items = (overview.items || []).filter(i => i.has_ads);
    const campaigns = overview.campaigns || [];
    const tacosTarget = window._tacosTarget || 0;
    const checks = [];

    // 1. ROAS acima de 1 (objetivo)
    const roas = agg.overall_roas || 0;
    const lowRoasItems = items.filter(i => (i.cost || 0) > 5 && (i.revenue || 0) < (i.cost || 0));
    checks.push({
        key: 'roas_positive',
        name: 'ROAS positivo',
        passed: roas >= 1,
        weight: 20,
        current: `${fmt(roas, 2)}x`,
        target: '\u2265 1x',
        hint: roas >= 1 ? 'Voc\u00ea est\u00e1 ganhando dinheiro com ads!' : 'Voc\u00ea est\u00e1 gastando mais do que recebe. Revise os an\u00fancios cr\u00edticos.',
        incentive: roas < 1 ? '\ud83d\udd27 Pause os an\u00fancios com pior ROAS e realoque o or\u00e7amento.' : null,
        action: (roas < 1 && lowRoasItems.length) ? {
            label: `Ver ${lowRoasItems.length} an\u00fancio${lowRoasItems.length > 1 ? 's' : ''} com ROAS < 1`,
            fn: 'adpFilterLowRoas'
        } : null
    });

    // 2. TACOS dentro da meta (mais importante!)
    if (tacosTarget > 0) {
        const tacos = agg.avg_tacos || 0;
        const passed = tacos <= tacosTarget;
        checks.push({
            key: 'tacos_on_target',
            name: `TACOS dentro da meta (\u2264 ${fmt(tacosTarget, 1)}%)`,
            passed,
            weight: 20,
            current: `${fmt(tacos, 2)}%`,
            target: `\u2264 ${fmt(tacosTarget, 1)}%`,
            hint: passed ? 'Sua meta de TACOS est\u00e1 sendo respeitada \u2014 continue assim!' : `Voc\u00ea est\u00e1 ${fmt(tacos - tacosTarget, 2)}pp acima da meta. Otimize pra diminuir o gasto relativo.`,
            incentive: !passed ? '\ud83c\udfaf Reduza lances nas campanhas com maior ACOS ou aumente o faturamento org\u00e2nico.' : null
        });
    } else {
        checks.push({
            key: 'tacos_no_target',
            name: 'Meta de TACOS definida',
            passed: false,
            weight: 10,
            current: 'n\u00e3o definida',
            target: 'definir',
            hint: 'Defina sua meta de TACOS para acompanhar seu progresso.',
            incentive: '\u270f\ufe0f Clique no card de meta acima e defina um valor.'
        });
    }

    // 3. Depend\u00eancia de ads saud\u00e1vel
    const totalRev = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
    const adsPct = totalRev > 0 ? (agg.total_revenue / totalRev) * 100 : 0;
    const depPassed = adsPct <= 60;
    checks.push({
        key: 'dependency_healthy',
        name: 'Depend\u00eancia de ads saud\u00e1vel',
        passed: depPassed,
        weight: 15,
        current: `${fmt(adsPct, 0)}% das vendas via ads`,
        target: '\u2264 60%',
        hint: depPassed ? 'Seu org\u00e2nico est\u00e1 forte!' : adsPct > 80 ? 'Depend\u00eancia excessiva \u2014 invista no org\u00e2nico.' : 'Depend\u00eancia elevada \u2014 fortale\u00e7a SEO e listagens.',
        incentive: !depPassed ? '\ud83c\udf31 Melhore fotos, atributos, pre\u00e7o e reputa\u00e7\u00e3o pra ganhar mais vendas org\u00e2nicas.' : null
    });

    // 4. Nenhuma campanha limitada por or\u00e7amento
    const daysForAvg = _currentDays || 30;
    const budgetLimited = campaigns.filter(c => {
        if (!c.budget || c.budget <= 0) return false;
        const cost = getCampaignMetrics(c, items).cost;
        if (cost <= 0) return false;
        return ((cost / daysForAvg) / c.budget) * 100 >= 80;
    });
    checks.push({
        key: 'budget_not_limited',
        name: 'Or\u00e7amento n\u00e3o limitando entrega',
        passed: budgetLimited.length === 0,
        weight: 15,
        current: budgetLimited.length === 0 ? 'Nenhuma limitada' : `${budgetLimited.length} limitada${budgetLimited.length > 1 ? 's' : ''}`,
        target: '0 campanhas',
        hint: budgetLimited.length === 0 ? 'O ML tem janela completa pra otimizar sua entrega.' : 'Sem janela de 24h, o algoritmo do ML n\u00e3o consegue calcular ROAS real.',
        incentive: budgetLimited.length > 0 ? '\ud83d\udcb8 Aumente o or\u00e7amento di\u00e1rio das campanhas marcadas com \u26a0 BUDGET.' : null
    });

    // 5. Sem alertas cr\u00edticos
    const criticalCount = alerts.filter(a => a.severity === 'critical').length;
    checks.push({
        key: 'no_critical',
        name: 'Sem alertas cr\u00edticos',
        passed: criticalCount === 0,
        weight: 10,
        current: criticalCount === 0 ? 'Nenhum' : `${criticalCount} cr\u00edtico${criticalCount > 1 ? 's' : ''}`,
        target: '0 alertas',
        hint: criticalCount === 0 ? 'Nada urgente detectado.' : 'Resolva os alertas cr\u00edticos pra melhorar seu score.',
        incentive: criticalCount > 0 ? '\ud83d\udea8 Veja o painel de alertas abaixo.' : null
    });

    // 6. An\u00fancios gastando sem vender
    const burning = items.filter(i => (i.cost || 0) > 30 && (i.orders || 0) === 0).length;
    checks.push({
        key: 'no_burning',
        name: 'Sem an\u00fancios queimando dinheiro',
        passed: burning === 0,
        weight: 10,
        current: burning === 0 ? 'Nenhum' : `${burning} an\u00fancio${burning > 1 ? 's' : ''}`,
        target: '0 an\u00fancios',
        hint: burning === 0 ? 'Seu or\u00e7amento est\u00e1 sendo bem usado!' : `${burning} an\u00fancio${burning > 1 ? 's' : ''} com mais de R$ 30 gastos sem venda.`,
        incentive: burning > 0 ? '\ud83d\udeab Pause ou revise urgentemente esses an\u00fancios na tabela abaixo.' : null,
        action: burning > 0 ? {
            label: `Ver ${burning} an\u00fancio${burning > 1 ? 's' : ''} queimando dinheiro`,
            fn: 'adpFilterBurningAds'
        } : null
    });

    // 7. ROAS m\u00e9dio superando meta da campanha (quando h\u00e1 meta)
    const campsWithTarget = campaigns.filter(c => c.roas_target > 0);
    if (campsWithTarget.length > 0) {
        const belowTarget = campsWithTarget.filter(c => {
            const campRoas = getCampaignMetrics(c, items).roas;
            return campRoas > 0 && campRoas < c.roas_target;
        });
        // IDs dos an\u00fancios das campanhas abaixo da meta (pra filtrar tabela)
        const belowCampIds = new Set(belowTarget.map(c => c.campaign_id));
        const badCampItemIds = items.filter(i => belowCampIds.has(i.campaign_id)).map(i => i.item_id);
        checks.push({
            key: 'campaigns_meet_roas',
            name: 'Campanhas batendo meta de ROAS',
            passed: belowTarget.length === 0,
            weight: 10,
            current: `${campsWithTarget.length - belowTarget.length}/${campsWithTarget.length} batendo`,
            target: '100%',
            hint: belowTarget.length === 0 ? 'Todas as campanhas com meta est\u00e3o performando.' : `${belowTarget.length} campanha${belowTarget.length > 1 ? 's' : ''} abaixo da meta definida.`,
            incentive: belowTarget.length > 0 ? '\ud83c\udfaf Revise as estrat\u00e9gias de lance dessas campanhas.' : null,
            action: belowTarget.length > 0 && badCampItemIds.length > 0 ? {
                label: `Ver an\u00fancios de ${belowTarget.length} campanha${belowTarget.length > 1 ? 's' : ''} abaixo da meta`,
                fn: 'adpFilterBadCampaigns',
                arg: badCampItemIds.join(',')
            } : null
        });
    }

    return checks;
}

function renderHealthScore(overview, alerts, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const agg = overview.aggregated;
    if (!agg || overview.total_items_with_ads === 0) { container.innerHTML = ''; return; }

    // Build checklist
    const checks = buildHealthChecklist(overview, alerts);

    // Weighted score
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const earnedWeight = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
    const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100;

    // Color scheme
    let color, label, emoji, gradient;
    if (score >= 85)      { color = '#059669'; label = 'Saud\u00e1vel';  emoji = '\ud83d\udc9a'; gradient = 'linear-gradient(135deg,#ecfdf5,#d1fae5)'; }
    else if (score >= 65) { color = '#0066ff'; label = 'Bom';         emoji = '\ud83d\udc99'; gradient = 'linear-gradient(135deg,#eff6ff,#dbeafe)'; }
    else if (score >= 45) { color = '#d97706'; label = 'Aten\u00e7\u00e3o';    emoji = '\ud83d\udc9b'; gradient = 'linear-gradient(135deg,#fffbeb,#fef3c7)'; }
    else                  { color = '#dc2626'; label = 'Cr\u00edtico';     emoji = '\u2764\ufe0f\u200d\ud83e\ude79'; gradient = 'linear-gradient(135deg,#fef2f2,#fee2e2)'; }

    const failedCount = checks.filter(c => !c.passed).length;
    const passedCount = checks.filter(c => c.passed).length;

    // Motivational copy baseada no score
    let motivational = '';
    if (score >= 85) motivational = 'Continue assim! Voc\u00ea t\u00e1 no topo.';
    else if (score >= 65) motivational = `Falta pouco pra ficar perfeito \u2014 ${failedCount} ponto${failedCount > 1 ? 's' : ''} pra melhorar.`;
    else if (score >= 45) motivational = `Voc\u00ea consegue! Tem ${failedCount} ponto${failedCount > 1 ? 's' : ''} pra ajustar.`;
    else motivational = `Bora virar o jogo! ${failedCount} ponto${failedCount > 1 ? 's' : ''} precisam de aten\u00e7\u00e3o.`;

    // Checklist expanded HTML
    const checklistItems = checks.map(c => `
        <div class="adp-health-check-item ${c.passed ? 'passed' : 'failed'}">
            <div class="adp-health-check-icon">${c.passed ? '\u2713' : '\u25cb'}</div>
            <div class="adp-health-check-body">
                <div class="adp-health-check-name">${c.name}</div>
                <div class="adp-health-check-values">
                    <span class="adp-health-check-current">${c.current}</span>
                    <span class="adp-health-check-target">alvo: ${c.target}</span>
                </div>
                <div class="adp-health-check-hint">${c.hint}</div>
                ${c.incentive ? `<div class="adp-health-check-incentive">${c.incentive}</div>` : ''}
                ${c.action ? `<button class="adp-health-check-action" onclick="window.${c.action.fn}(${c.action.arg ? `'${c.action.arg}'` : ''})">\ud83d\udc49 ${c.action.label}</button>` : ''}
            </div>
            <div class="adp-health-check-weight">+${c.weight}</div>
        </div>
    `).join('');

    container.innerHTML = `<div class="adp-health-card" style="background:${gradient};border:1px solid ${color}33;">
        <div class="adp-health-summary" onclick="window.adpToggleHealthDetails()">
            <div class="adp-health-gauge">
                <svg viewBox="0 0 36 36" class="adp-health-svg">
                    <circle cx="18" cy="18" r="15.91" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="3"/>
                    <circle cx="18" cy="18" r="15.91" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${score} ${100 - score}" stroke-linecap="round"/>
                </svg>
                <div class="adp-health-gauge-value" style="color:${color};"><span class="adp-count-up" data-target="${score}">0</span></div>
            </div>
            <div class="adp-health-info">
                <div class="adp-health-title">${emoji} Sa\u00fade dos Ads \u00b7 ${label}</div>
                <div class="adp-health-subtitle">${passedCount}/${checks.length} verifica\u00e7\u00f5es ok \u00b7 ${motivational}</div>
                <div class="adp-health-progress-bar">
                    <div class="adp-health-progress-fill" style="width:${score}%;background:${color};"></div>
                </div>
            </div>
            <button class="adp-health-expand-btn" id="adp-health-expand-btn" aria-label="Expandir detalhes">
                <span class="adp-health-expand-label">Ver detalhes</span>
                <span class="adp-health-expand-chevron">\u203a</span>
            </button>
        </div>
        <div class="adp-health-details" id="adp-health-details" style="display:none;">
            <div class="adp-health-details-header">\ud83d\udccb Verifica\u00e7\u00f5es analisadas</div>
            <div class="adp-health-check-list">${checklistItems}</div>
        </div>
    </div>`;
    setTimeout(() => adpAnimateNumbers(container), 50);
}

window.adpToggleHealthDetails = function() {
    const details = document.getElementById('adp-health-details');
    const btn = document.getElementById('adp-health-expand-btn');
    if (!details) return;
    const isOpen = details.style.display !== 'none';
    details.style.display = isOpen ? 'none' : 'block';
    if (btn) {
        btn.classList.toggle('expanded', !isOpen);
        const label = btn.querySelector('.adp-health-expand-label');
        if (label) label.textContent = isOpen ? 'Ver detalhes' : 'Ocultar';
    }
};

function renderExecutiveSummary(overview, days, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const agg = overview.aggregated;
    if (!agg || overview.total_items_with_ads === 0) { container.innerHTML = ''; return; }

    // Monthly projection
    const factor = 30 / days;
    const projCost = agg.total_cost * factor;
    const projRevenue = (agg.total_revenue + agg.organic_revenue) * factor;

    // Build checklist items
    const items = [];

    // ROAS necessario pra bater meta de TACOS dado o mix Ads/Organico
    const tacosTargetGoal = window._tacosTarget || 0;
    const adsPctRatio = (agg.total_revenue + agg.organic_revenue) > 0 ? (agg.total_revenue / (agg.total_revenue + agg.organic_revenue)) : 0;
    const roasNeededForTacos = (tacosTargetGoal > 0 && adsPctRatio > 0) ? (adsPctRatio * 100 / tacosTargetGoal) : 0;

    // 1. ROAS — honesto, comparando com ROAS necessário pra bater meta de TACOS
    if (agg.total_cost > 0 && (agg.total_revenue || 0) <= 0) {
        items.push({ status: 'bad', label: 'ROAS', text: `Zero retorno: você gastou ${fmtMoney(agg.total_cost)} sem nenhuma venda via ads no período. Pause os anúncios sem performance e diagnostique antes de reativar.` });
    } else if (agg.overall_roas > 0 && agg.overall_roas < 1 && agg.total_cost > 0) {
        items.push({ status: 'bad', label: 'ROAS', text: `${fmt(agg.overall_roas)}x \u2014 voc\u00ea est\u00e1 perdendo dinheiro: cada R$1 gasto retorna apenas R$${fmt(agg.overall_roas)}. Pause os piores AGORA pra estancar.` });
    } else if (roasNeededForTacos > 0 && agg.overall_roas > 0 && agg.overall_roas < roasNeededForTacos * 0.5) {
        items.push({ status: 'bad', label: 'ROAS', text: `${fmt(agg.overall_roas)}x \u2014 MUITO abaixo do ROAS de ${fmt(roasNeededForTacos)}x necess\u00e1rio pra bater sua meta de TACOS de ${fmt(tacosTargetGoal)}%. Voc\u00ea n\u00e3o vai chegar perto sem mudar o jogo.` });
    } else if (roasNeededForTacos > 0 && agg.overall_roas > 0 && agg.overall_roas < roasNeededForTacos) {
        items.push({ status: 'warning', label: 'ROAS', text: `${fmt(agg.overall_roas)}x \u2014 abaixo do ROAS de ${fmt(roasNeededForTacos)}x exigido pela sua meta de TACOS (${fmt(tacosTargetGoal)}%). Pause an\u00fancios caros e realoque verba.` });
    } else if (agg.overall_roas >= 10) {
        items.push({ status: 'good', label: 'ROAS', text: `${fmt(agg.overall_roas)}x \u2014 sensacional! Voc\u00ea est\u00e1 entre os melhores do marketplace \ud83c\udfc6` });
    } else if (agg.overall_roas >= 5) {
        items.push({ status: 'good', label: 'ROAS', text: `${fmt(agg.overall_roas)}x \u2014 excelente! Seus ads est\u00e3o num ritmo invej\u00e1vel \ud83d\udd25` });
    } else if (agg.overall_roas >= 3) {
        items.push({ status: 'good', label: 'ROAS', text: `${fmt(agg.overall_roas)}x \u2014 muito bom! Seus ads est\u00e3o trabalhando pra voc\u00ea \ud83d\udcaa` });
    } else if (agg.overall_roas >= 2) {
        items.push({ status: 'good', label: 'ROAS', text: `${fmt(agg.overall_roas)}x \u2014 no positivo! Cada R$1 investido vira R$${fmt(agg.overall_roas)} em vendas \u2728` });
    } else if (agg.overall_roas >= 1) {
        items.push({ status: 'info', label: 'ROAS', text: `${fmt(agg.overall_roas)}x \u2014 voc\u00ea t\u00e1 no azul. Um pequeno ajuste e esse n\u00famero decola \ud83d\ude80` });
    }

    // 2. TACOS vs meta — honesto quando muito fora da meta
    const tacosTargetUser = window._tacosTarget || 0;
    if (tacosTargetUser > 0 && agg.avg_tacos > 0) {
        const diff = agg.avg_tacos - tacosTargetUser;
        const diffPct = tacosTargetUser > 0 ? (diff / tacosTargetUser) * 100 : 0;
        if (agg.avg_tacos <= tacosTargetUser * 0.7) {
            items.push({ status: 'good', label: 'TACOS', text: `${fmt(agg.avg_tacos)}% \u2014 meta batida com folga! \ud83c\udfaf Voc\u00ea est\u00e1 muito abaixo do limite de ${fmt(tacosTargetUser)}%` });
        } else if (agg.avg_tacos <= tacosTargetUser) {
            items.push({ status: 'good', label: 'TACOS', text: `${fmt(agg.avg_tacos)}% \u2014 dentro da meta de ${fmt(tacosTargetUser)}% \u2713 continue assim!` });
        } else if (diffPct <= 10) {
            items.push({ status: 'warning', label: 'TACOS', text: `${fmt(agg.avg_tacos)}% \u2014 levemente acima da meta de ${fmt(tacosTargetUser)}%. D\u00e1 pra ajustar com pouco esfor\u00e7o.` });
        } else if (diffPct <= 30) {
            items.push({ status: 'warning', label: 'TACOS', text: `${fmt(agg.avg_tacos)}% \u2014 acima da meta de ${fmt(tacosTargetUser)}% (${fmt(diffPct, 0)}% acima). Pause an\u00fancios caros e revise lances.` });
        } else if (diffPct <= 100) {
            items.push({ status: 'bad', label: 'TACOS', text: `${fmt(agg.avg_tacos)}% \u2014 bem acima da meta de ${fmt(tacosTargetUser)}% (${fmt(diffPct, 0)}% acima). Sua margem est\u00e1 sendo consumida pelos ads.` });
        } else {
            items.push({ status: 'bad', label: 'TACOS', text: `${fmt(agg.avg_tacos)}% \u2014 MUITO fora da meta de ${fmt(tacosTargetUser)}% (${fmt(diffPct, 0)}% acima, ou ${fmt(agg.avg_tacos / tacosTargetUser, 1)}x maior). Os ads est\u00e3o destruindo sua margem. Plano de a\u00e7\u00e3o urgente.` });
        }
    } else if (agg.avg_tacos > 0) {
        items.push({ status: 'info', label: 'TACOS', text: `${fmt(agg.avg_tacos)}% \u2014 defina uma meta pra saber se est\u00e1 dentro ou fora do que voc\u00ea aceita gastar.` });
    }

    // 3. Depend\u00eancia de Ads
    const adsPct = (agg.total_revenue + agg.organic_revenue) > 0 ? (agg.total_revenue / (agg.total_revenue + agg.organic_revenue)) * 100 : 0;
    if (adsPct > 80) {
        items.push({ status: 'bad', label: 'Depend\u00eancia de Ads', text: `${fmt(adsPct, 0)}% das vendas vem de ads \u2014 t\u00e1 em excesso, seu org\u00e2nico precisa de aten\u00e7\u00e3o \ud83c\udf31` });
    } else if (adsPct > 60) {
        items.push({ status: 'warning', label: 'Depend\u00eancia de Ads', text: `${fmt(adsPct, 0)}% das vendas vem de ads \u2014 cuidado com a depend\u00eancia. Que tal fortalecer seu SEO org\u00e2nico?` });
    } else if (adsPct > 30) {
        items.push({ status: 'good', label: 'Depend\u00eancia de Ads', text: `${fmt(adsPct, 0)}% das vendas vem de ads \u2014 equil\u00edbrio saud\u00e1vel! \u2696\ufe0f` });
    } else if (adsPct > 0) {
        items.push({ status: 'good', label: 'Depend\u00eancia de Ads', text: `S\u00f3 ${fmt(adsPct, 0)}% das vendas vem de ads \u2014 sua marca \u00e9 forte no org\u00e2nico! \ud83d\udc9a` });
    }

    // 4. Efici\u00eancia de escala
    const daily = overview.daily_aggregated || [];
    if (daily.length >= 6) {
        const mid = Math.floor(daily.length / 2);
        const costFirst = daily.slice(0, mid).reduce((s, d) => s + (parseFloat(d.cost) || 0), 0);
        const costSecond = daily.slice(mid).reduce((s, d) => s + (parseFloat(d.cost) || 0), 0);
        const revFirst = daily.slice(0, mid).reduce((s, d) => s + (parseFloat(d.total_amount) || 0) + (parseFloat(d.organic_units_amount) || 0), 0);
        const revSecond = daily.slice(mid).reduce((s, d) => s + (parseFloat(d.total_amount) || 0) + (parseFloat(d.organic_units_amount) || 0), 0);
        const costGrowth = costFirst > 0 ? ((costSecond - costFirst) / costFirst) * 100 : 0;
        const revGrowth = revFirst > 0 ? ((revSecond - revFirst) / revFirst) * 100 : 0;

        if (Math.abs(costGrowth) > 5 || Math.abs(revGrowth) > 5) {
            if (revGrowth > costGrowth && costGrowth > 0) {
                items.push({ status: 'good', label: 'Escala', text: `eficiente! \ud83d\ude80 Gasto subiu ${fmt(costGrowth, 0)}% e vendas cresceram ${fmt(revGrowth, 0)}% \u2014 voc\u00ea t\u00e1 no ritmo certo` });
            } else if (costGrowth > 0 && revGrowth > 0 && costGrowth > revGrowth) {
                items.push({ status: 'warning', label: 'Escala', text: `aten\u00e7\u00e3o \u2014 gasto subiu ${fmt(costGrowth, 0)}% mas vendas s\u00f3 ${fmt(revGrowth, 0)}%. D\u00e1 pra ajustar os lances!` });
            } else if (costGrowth > 0 && revGrowth <= 0) {
                items.push({ status: 'bad', label: 'Escala', text: `investindo mais sem retorno (gasto +${fmt(costGrowth, 0)}%, vendas ${revGrowth < 0 ? '\u2212' + fmt(Math.abs(revGrowth), 0) + '%' : 'sem crescimento'}). Hora de pausar os piores!` });
            } else if (costGrowth < 0 && revGrowth > 0) {
                items.push({ status: 'good', label: 'Otimiza\u00e7\u00e3o', text: `show de bola! \ud83d\udcc9 Reduziu gasto ${fmt(Math.abs(costGrowth), 0)}% e aumentou vendas ${fmt(revGrowth, 0)}%. Isso \u00e9 arte.` });
            } else if (costGrowth < 0 && revGrowth < 0) {
                if (Math.abs(revGrowth) > Math.abs(costGrowth)) {
                    items.push({ status: 'bad', label: 'Tend\u00eancia', text: `queda desproporcional \u2014 gasto ${fmt(Math.abs(costGrowth), 0)}% menor mas vendas ca\u00edram ${fmt(Math.abs(revGrowth), 0)}%. Vamos reverter isso?` });
                } else {
                    items.push({ status: 'warning', label: 'Tend\u00eancia', text: `redu\u00e7\u00e3o controlada \u2014 cortou ${fmt(Math.abs(costGrowth), 0)}% de gasto com s\u00f3 ${fmt(Math.abs(revGrowth), 0)}% de queda nas vendas. Aceit\u00e1vel.` });
                }
            }
        }
    }

    // Overall mood — mais honesto, prioriza bad/warning sobre quantidade de good
    const goodCount = items.filter(i => i.status === 'good').length;
    const badCount = items.filter(i => i.status === 'bad').length;
    const warnCount = items.filter(i => i.status === 'warning').length;

    // Detec\u00e7\u00e3o de "muito fora da meta": qualquer KPI cr\u00edtico fora do aceit\u00e1vel
    const _adsPctNow = (agg.total_revenue + agg.organic_revenue) > 0 ? (agg.total_revenue / (agg.total_revenue + agg.organic_revenue)) * 100 : 0;
    const _noSalesItemsCount = (overview.items || []).filter(i => i.has_ads && (i.cost || 0) > 50 && (i.orders || 0) === 0).length;
    const muitoForaDaMeta = (
        (agg.total_cost > 0 && (agg.total_revenue || 0) <= 0) ||
        (agg.overall_roas > 0 && agg.overall_roas < 1) ||
        (roasNeededForTacos > 0 && agg.overall_roas > 0 && agg.overall_roas < roasNeededForTacos * 0.5) ||
        (tacosTargetUser > 0 && agg.avg_tacos > tacosTargetUser * 2) ||
        (_adsPctNow > 90) ||
        (_noSalesItemsCount >= 5)
    );

    let moodEmoji = '\ud83d\udcca';
    let moodTitle = 'Seu resumo executivo';
    let moodSubtitle = 'Veja como voc\u00ea est\u00e1 indo';
    let moodGradient = 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)';
    let moodAccent = '#0066ff';
    if (items.length > 0) {
        if (muitoForaDaMeta) {
            moodEmoji = '\ud83d\udea8';
            moodTitle = 'Aten\u00e7\u00e3o: muito fora da meta';
            moodSubtitle = 'Indicadores cr\u00edticos exigem a\u00e7\u00e3o agora';
            moodGradient = 'linear-gradient(135deg, #991b1b 0%, #450a0a 100%)';
            moodAccent = '#ef4444';
        } else if (badCount === 0 && warnCount === 0 && goodCount >= 3) {
            moodEmoji = '\ud83c\udfc6';
            moodTitle = 'Voc\u00ea t\u00e1 voando!';
            moodSubtitle = 'Todos os indicadores no verde';
            moodGradient = 'linear-gradient(135deg, #059669 0%, #047857 100%)';
            moodAccent = '#10b981';
        } else if (badCount === 0 && warnCount === 0 && goodCount >= items.length - 1) {
            moodEmoji = '\u2728';
            moodTitle = 'Mandando bem!';
            moodSubtitle = 'Quase tudo em ordem';
            moodGradient = 'linear-gradient(135deg, #059669 0%, #0891b2 100%)';
            moodAccent = '#10b981';
        } else if (badCount >= 2 || (badCount >= 1 && warnCount >= 1)) {
            moodEmoji = '\ud83d\udd27';
            moodTitle = 'Bora otimizar agora';
            moodSubtitle = `${badCount} ponto${badCount>1?'s':''} cr\u00edtico${badCount>1?'s':''}${warnCount > 0 ? ' + '+warnCount+' aviso'+(warnCount>1?'s':'') : ''} pra resolver`;
            moodGradient = 'linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)';
            moodAccent = '#ef4444';
        } else if (badCount === 1) {
            moodEmoji = '\u26a0\ufe0f';
            moodTitle = 'Um ponto cr\u00edtico hoje';
            moodSubtitle = 'Vale resolver antes que escale';
            moodGradient = 'linear-gradient(135deg, #d97706 0%, #b45309 100%)';
            moodAccent = '#f59e0b';
        } else if (warnCount >= 2) {
            moodEmoji = '\u26a1';
            moodTitle = 'Uns ajustes pra fazer';
            moodSubtitle = `${warnCount} aviso${warnCount>1?'s':''} \u2014 ajuste antes que vire problema`;
            moodGradient = 'linear-gradient(135deg, #d97706 0%, #b45309 100%)';
            moodAccent = '#f59e0b';
        } else if (warnCount === 1) {
            moodEmoji = '\u26a1';
            moodTitle = 'Quase l\u00e1';
            moodSubtitle = 'Um aviso pra revisar';
            moodGradient = 'linear-gradient(135deg, #ca8a04 0%, #854d0e 100%)';
            moodAccent = '#f59e0b';
        } else if (goodCount >= 2) {
            moodEmoji = '\ud83d\udcca';
            moodTitle = 'Voc\u00ea no controle';
            moodSubtitle = 'Tudo dentro do esperado \u2014 mantenha o ritmo';
            moodGradient = 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)';
            moodAccent = '#0066ff';
        } else {
            moodEmoji = '\ud83d\udcca';
            moodTitle = 'Aguardando dados suficientes';
            moodSubtitle = 'Em breve voc\u00ea ver\u00e1 um diagn\u00f3stico completo';
            moodGradient = 'linear-gradient(135deg, #475569 0%, #334155 100%)';
            moodAccent = '#64748b';
        }
    }

    // Status config
    const statusConfig = {
        good:    { icon: '\u2713', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', label: 'Ok' },
        info:    { icon: '\u2139', color: '#0066ff', bg: '#eff6ff', border: '#bfdbfe', label: 'Info' },
        warning: { icon: '\u26a0', color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'Aten\u00e7\u00e3o' },
        bad:     { icon: '\u2715', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Ru\u00edm' }
    };

    // Extract metric value from text (e.g., "12,55x" or "1,86%" at the start)
    const splitText = (text) => {
        const m = text.match(/^([\d.,]+[%x]?)\s*[\u2014\-]\s*(.*)$/);
        if (m) return { value: m[1], rest: m[2] };
        return { value: '', rest: text };
    };

    // Incentivos contextuais quando fora da meta
    const incentiveFor = (item) => {
        if (item.status === 'good') return '';
        if (item.label === 'ROAS') return '\ud83d\udd27 Pause os anúncios com pior desempenho e realoque o orçamento.';
        if (item.label === 'TACOS') return '\ud83c\udfaf Reduza lances ou aumente faturamento orgânico pra baixar o TACOS.';
        if (item.label === 'Dependência de Ads') return '\ud83c\udf31 Invista em SEO e listagens pra crescer o orgânico.';
        if (item.label === 'Escala') return '\u2696\ufe0f Ajuste os lances pra equilibrar gasto e retorno.';
        if (item.label === 'Otimização') return '\ud83d\udcc8 Continue monitorando — voc\u00ea est\u00e1 no caminho certo.';
        if (item.label === 'Tendência') return '\ud83d\udcca Revise as campanhas com pior performance do per\u00edodo.';
        return '';
    };

    const cardsHtml = items.map((item, idx) => {
        const cfg = statusConfig[item.status] || statusConfig.info;
        const parts = splitText(item.text);
        const incentive = incentiveFor(item);
        return `<div class="adp-exec-card" style="
            --card-color:${cfg.color};
            --card-bg:${cfg.bg};
            --card-border:${cfg.border};
            animation-delay:${idx * 0.05}s;
        ">
            <div class="adp-exec-card-icon" style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border};">
                ${cfg.icon}
            </div>
            <div class="adp-exec-card-body">
                <div class="adp-exec-card-label">${item.label}</div>
                ${parts.value ? `<div class="adp-exec-card-value" style="color:${cfg.color};">${parts.value}</div>` : ''}
                <div class="adp-exec-card-text">${parts.rest || item.text}</div>
                ${incentive ? `<div class="adp-exec-card-incentive" style="margin-top:6px;padding:5px 8px;background:rgba(0,102,255,0.06);border-left:2px solid ${cfg.color};border-radius:4px;font-size:0.7rem;color:${cfg.color};font-weight:600;">${incentive}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    // Projection card
    const projDelta = projRevenue - projCost;
    const projMargin = projRevenue > 0 ? (projDelta / projRevenue) * 100 : 0;

    container.innerHTML = `<div class="adp-exec-summary" style="animation:slideUp 0.4s ease both;margin-bottom:18px;">
        <!-- Header com mood -->
        <div class="adp-exec-header" style="background:${moodGradient};">
            <div class="adp-exec-header-main">
                <div class="adp-exec-header-emoji">${moodEmoji}</div>
                <div class="adp-exec-header-text">
                    <div class="adp-exec-header-title">${moodTitle}</div>
                    <div class="adp-exec-header-subtitle">${moodSubtitle}</div>
                </div>
            </div>
            <div class="adp-exec-header-stats">
                ${goodCount > 0 ? `<span class="adp-exec-stat" title="Indicadores positivos"><span style="color:#6ee7b7;">\u25cf</span> ${goodCount} ok</span>` : ''}
                ${warnCount > 0 ? `<span class="adp-exec-stat" title="Pontos de aten\u00e7\u00e3o"><span style="color:#fcd34d;">\u25cf</span> ${warnCount} aviso${warnCount>1?'s':''}</span>` : ''}
                ${badCount > 0 ? `<span class="adp-exec-stat" title="Cr\u00edticos"><span style="color:#fca5a5;">\u25cf</span> ${badCount} cr\u00edtico${badCount>1?'s':''}</span>` : ''}
            </div>
        </div>

        <!-- Body com cards + proje\u00e7\u00e3o -->
        <div class="adp-exec-body">
            <div class="adp-exec-cards">
                ${cardsHtml}
            </div>

            <!-- Proje\u00e7\u00e3o mensal -->
            <div class="adp-exec-projection">
                <div class="adp-exec-proj-title">\ud83d\udcc5 Proje\u00e7\u00e3o mensal</div>
                <div class="adp-exec-proj-flow">
                    <div class="adp-exec-proj-item">
                        <span class="adp-exec-proj-label">Gasto em ads</span>
                        <span class="adp-exec-proj-value" style="color:#dc2626;">${fmtMoney(projCost)}</span>
                    </div>
                    <div class="adp-exec-proj-arrow">\u2192</div>
                    <div class="adp-exec-proj-item">
                        <span class="adp-exec-proj-label">Faturamento</span>
                        <span class="adp-exec-proj-value" style="color:#059669;">${fmtMoney(projRevenue)}</span>
                    </div>
                </div>
                ${projRevenue > 0 ? `<div class="adp-exec-proj-margin" style="background:${projDelta > 0 ? '#ecfdf5' : '#fef2f2'};color:${projDelta > 0 ? '#047857' : '#b91c1c'};border:1px solid ${projDelta > 0 ? '#a7f3d0' : '#fecaca'};">
                    ${projDelta > 0 ? '\ud83d\udcb0 L\u00edquido estimado' : '\u26a0 Retorno negativo'}: <strong>${fmtMoney(projDelta)}</strong> ${projMargin > 0 ? `(${fmt(projMargin, 1)}% do faturamento)` : ''}
                </div>` : ''}
            </div>
        </div>
    </div>`;
}

// ══════════════════════════════════════════════════════
// Section 8: Init & Controller
// ══════════════════════════════════════════════════════

let _currentDays = 30;
let _currentOverview = null;
let _currentItemDetails = {};
let _currentVisitsData = {};

async function initAdsPlanner() {
    const wrapper = document.querySelector('.adp-wrapper');
    if (!wrapper) return;
    // Garante window._currentDays na 1ª carga pro share card e outras seções
    window._currentDays = _currentDays;

    // Show loading (orbital padrao)
    wrapper.innerHTML = `
        <div class="comp-loading">
            <div class="comp-orbital">
                <div class="comp-orbital-ring"></div>
                <div class="comp-orbital-ring"></div>
                <div class="comp-orbital-dot"></div>
            </div>
            <p class="comp-loading-msg" id="adp-load-text">Carregando dados de Product Ads...</p>
            <div class="comp-loading-bar"><div class="comp-loading-bar-fill"></div></div>
            <div class="comp-loading-steps">
                <span class="step" id="adp-step-1">Conex\u00e3o</span>
                <span class="step-dot">\u2192</span>
                <span class="step" id="adp-step-2">M\u00e9tricas</span>
                <span class="step-dot">\u2192</span>
                <span class="step" id="adp-step-3">Detalhes</span>
            </div>
        </div>`;

    try {
        const textEl = document.getElementById('adp-load-text');
        const setProgress = (t, step) => {
            if (textEl) textEl.textContent = t;
            if (step) {
                for (let i = 1; i <= 3; i++) {
                    const s = document.getElementById('adp-step-' + i);
                    if (!s) continue;
                    s.classList.remove('active', 'done');
                    if (i < step) s.classList.add('done');
                    else if (i === step) s.classList.add('active');
                }
            }
        };

        setProgress('Carregando dados de Product Ads...', 0);

        // Buscar token com retry silencioso (Bubble pode demorar na primeira carga)
        let token = null;
        for (let attempt = 0; attempt < 4 && !token; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2500));
            token = await fetchAccessToken();
        }
        if (!token) throw new Error('N\u00e3o foi poss\u00edvel obter token de acesso. Verifique sua conex\u00e3o com o Mercado Livre.');

        setProgress('Buscando dados de ads...', 1);

        // Fase 2: 2 calls leves em paralelo ao proxy
        //  /ads-aggregated \u2192 KPIs/charts/campaigns da conta inteira (delegados ao ML)
        //  /ads-items?sort=cost_desc&limit=50 \u2192 50 an\u00fancios mais ativos (alimentam tabela inicial,
        //                                       rankings, alertas; v\u00eam com title/thumb diretos)
        const fetchAggOnce = async (tk) => fetchAdsAggregated(tk, _currentDays);
        const fetchItemsOnce = async (tk, ctx) => fetchAdsItemsPage(tk, {
            limit: 50,
            sort_by: 'cost',
            sort: 'desc',
            advertiser_id: ctx?.advertiser_id || undefined,
            site_id: ctx?.site_id || undefined
        });

        let aggregatedResp;
        try {
            aggregatedResp = await fetchAggOnce(token);
        } catch (e) {
            if (e.message?.includes('401')) {
                await new Promise(r => setTimeout(r, 2000));
                token = await fetchAccessToken();
                if (token) aggregatedResp = await fetchAggOnce(token);
                else throw e;
            } else { throw e; }
        }

        const ctx = { advertiser_id: aggregatedResp?.advertiser_id, site_id: aggregatedResp?.site_id };
        const itemsResp = await fetchItemsOnce(token, ctx).catch(() => ({ items: [], paging: { ml_total: 0, returned: 0 } }));

        // Comp\u00f5e `overview` shim compat\u00edvel com renderFullDashboard / generateAlerts /
        // renderAdsTable / renderRanking. Items v\u00eam do /ads-items (at\u00e9 50, sort cost desc);
        // KPIs, daily, campanhas v\u00eam do /ads-aggregated (cobertura 100% da conta).
        const items = (itemsResp.items || []).map(it => ({
            item_id: it.item_id,
            has_ads: true,
            campaign_id: it.campaign_id,
            status: it.status,
            current_level: it.current_level,
            cost: it.cost || 0,
            revenue: it.revenue || 0,
            organic_revenue: it.organic_revenue || 0,
            clicks: it.clicks || 0,
            impressions: it.impressions || 0,
            orders: it.orders || 0,
            organic_orders: it.organic_orders || 0,
            acos: it.acos || 0,
            ctr: it.ctr || 0,
            cvr: it.cvr || 0,
            roas: it.roas || 0,
            cpc: it.cpc || 0
        }));

        const totalItemsWithAds = itemsResp.paging?.ml_total || items.length;
        const overview = {
            seller_id: aggregatedResp?.seller_id,
            seller_info: aggregatedResp?.seller_info || {},
            site_id: aggregatedResp?.site_id,
            advertiser_id: aggregatedResp?.advertiser_id,
            total_items: aggregatedResp?.total_items_account || 0,
            total_items_with_ads: totalItemsWithAds,
            items_sampled: items.length,
            items_skipped: Math.max(0, totalItemsWithAds - items.length),
            partial: totalItemsWithAds > items.length,
            date_from: aggregatedResp?.date_from,
            date_to: aggregatedResp?.date_to,
            aggregated: aggregatedResp?.aggregated || null,
            daily_aggregated: aggregatedResp?.daily_aggregated || [],
            campaigns: aggregatedResp?.campaigns || [],
            items
        };

        _currentOverview = overview;
        window._currentOverview = overview;
        try { rtSaveSnapshot(overview); } catch(_) {}
        try {
            const onb = rtGetOnboarding(overview.seller_id);
            if (onb && onb.tacos) window._tacosTarget = onb.tacos;
            if (onb && onb.margin) window._userMargin = onb.margin;
        } catch(_) {}

        // itemDetails: title/thumb/permalink j\u00e1 v\u00eam direto da response do /ads-items.
        // N\u00e3o precisa mais fetch separado a /items pra mais.
        setProgress(`Buscando detalhes e visitas...`, 2);
        const itemDetails = {};
        for (const it of itemsResp.items || []) {
            if (it.item_id) {
                itemDetails[it.item_id] = {
                    title: it.title || '',
                    thumbnail: it.thumbnail || '',
                    permalink: it.permalink || '',
                    price: it.price || 0,
                    original_price: it.price_usd || 0,
                    category_id: ''
                };
            }
        }
        _currentItemDetails = itemDetails;

        // Visits ainda vai por endpoint legado (n\u00e3o migrado). S\u00f3 dos 50 vis\u00edveis.
        const adsItemIds = items.map(i => i.item_id);
        if (adsItemIds.length > 0) {
            const now2 = new Date();
            const fromDate = new Date(now2.getTime() - _currentDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const toDate = now2.toISOString().split('T')[0];
            try {
                _currentVisitsData = await fetchVisitsBulk(adsItemIds, token, fromDate, toDate);
            } catch (_) { _currentVisitsData = {}; }
        }

        setProgress('Montando dashboard...', 3);
        renderFullDashboard(overview, _currentItemDetails, _currentVisitsData);

    } catch (e) {
        console.error('Erro ao inicializar Ads Planner:', e);
        wrapper.innerHTML = `
            <div class="adp-empty">
                <div class="adp-empty-icon">\u26a0\ufe0f</div>
                <div class="adp-empty-title">Erro ao carregar dados</div>
                <div class="adp-empty-text">${escapeHtml(e.message)}</div>
            </div>`;
    }
}

function renderFullDashboard(overview, itemDetails, visitsData) {
    const wrapper = document.querySelector('.adp-wrapper');
    if (!wrapper) return;

    const alerts = generateAlerts(overview, itemDetails);
    window._currentAlerts = alerts;
    // Atualiza badge do tab + favicon
    try { adpUpdateTabNotifications(overview, alerts); } catch(_) {}
    const periodBtns = [7, 15, 30, 60, 90].map(d => `<button class="adp-period-btn ${d === _currentDays ? 'active' : ''}" onclick="window.changePeriod(${d})">${d}d</button>`).join('');
    const now = new Date();
    const timestamp = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' \u2014 ' + now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Banner informativo: KPIs cobrem 100% da conta (via /ads-aggregated), mas a
    // tabela e ranking nesta versão exibem amostra dos N anúncios mais ativos por gasto.
    // Paginação total é Fase 3.
    const totalWithAds = Number(overview.total_items_with_ads) || 0;
    const sampled = Number(overview.items_sampled) || 0;
    const showSampleBanner = totalWithAds > 0 && sampled > 0 && sampled < totalWithAds;
    const truncationBanner = showSampleBanner ? `
        <div style="background:#dbeafe;border:1px solid #3b82f6;color:#1e3a8a;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:0.85rem;line-height:1.45;">
            <strong>ℹ Métricas agregadas (TACOS, ROAS, totais e gráficos) refletem 100% dos seus ${totalWithAds.toLocaleString('pt-BR')} anúncios em Product Ads.</strong>
            A tabela detalhada e os rankings abaixo mostram os ${sampled.toLocaleString('pt-BR')} anúncios mais ativos por gasto. Use os filtros pra navegar pelo restante.
        </div>` : '';

    // Build page structure — grouped into logical blocks
    wrapper.innerHTML = `
        ${truncationBanner}
        <!-- BLOCO 0: Retention banner (streak, vs last visit) -->
        <div id="adp-rt-banner"></div>

        <!-- BLOCO 1: Header com Health Score integrado -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
            <div id="adp-health" style="flex:1;min-width:280px;"></div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
                <div style="display:flex;gap:4px;align-items:center;">
                    <div class="adp-period-selector">${periodBtns}</div>
                    <button class="adp-period-btn" onclick="window.changePeriod(${_currentDays})" title="Atualizar dados" style="background:var(--blue);color:#fff;border-radius:4px;padding:6px 10px;">&#x21bb;</button>
                </div>
                <div style="font-size:0.62rem;color:var(--text-muted);">Atualizado \u00e0s ${timestamp}</div>
            </div>
        </div>

        <!-- BLOCO 0.5: Watchlist progress -->
        <div id="adp-rt-watch"></div>

        <!-- BLOCO 1.2: Engagement panel (streak, goal, score, checklist, economy) -->
        <div id="adp-engagement"></div>

        <!-- BLOCO 1.3: Revisao reminders -->
        <div id="adp-revisions"></div>

        <!-- BLOCO 1.5: Configura\u00e7\u00f5es de Meta (compacto) -->
        <div id="adp-simulator"></div>

        <!-- BLOCO 2: Resumo + Metricas -->
        <div id="adp-summary"></div>
        <div id="adp-overview"></div>

        <!-- BLOCO 3: Alertas (se houver) -->
        <div id="adp-alerts"></div>

        <!-- BLOCO 3.5: Highlights & benchmark -->
        <div id="adp-highlights"></div>

        <!-- BLOCO 4: An\u00e1lise Visual -->
        <div class="adp-section-title">\ud83d\udcca An\u00e1lise de Desempenho <span style="font-weight:400;font-size:0.68rem;text-transform:none;color:var(--text-muted);margin-left:8px;">Evolu\u00e7\u00e3o das m\u00e9tricas no per\u00edodo selecionado</span></div>
        <div id="adp-charts"></div>

        <!-- BLOCO 5: Intelig\u00eancia -->
        <div class="adp-section-title">\ud83c\udfc6 Ranking e Oportunidades <span style="font-weight:400;font-size:0.68rem;text-transform:none;color:var(--text-muted);margin-left:8px;">Melhores e piores an\u00fancios por ROAS com sugest\u00f5es de a\u00e7\u00e3o</span></div>
        <div id="adp-ranking"></div>

        <!-- BLOCO 7: Dados Detalhados -->
        <div class="adp-section-title">\ud83d\udccb An\u00fancios Detalhados <span style="font-weight:400;font-size:0.68rem;text-transform:none;color:var(--text-muted);margin-left:8px;">Clique em um an\u00fancio para ver gr\u00e1fico di\u00e1rio e sugest\u00f5es. Cores relativas \u00e0 m\u00e9dia da conta.</span></div>
        <div id="adp-table"></div>

        <!-- BLOCO 8: Campanhas -->
        <div id="adp-campaigns"></div>`;

    // Render each section
    renderRetentionBanner(overview, 'adp-rt-banner');
    renderHealthScore(overview, alerts, 'adp-health');
    renderWatchlistProgress(overview, 'adp-rt-watch');
    renderEngagementPanel(overview, alerts, 'adp-engagement');
    renderRevisionReminders(overview, 'adp-revisions');
    renderExecutiveSummary(overview, _currentDays, 'adp-summary');
    renderDashboardOverview(overview, 'adp-overview');
    renderAlertsPanel(alerts, 'adp-alerts');
    renderHighlightsAndBenchmark(overview, itemDetails, 'adp-highlights');
    renderCharts(overview, 'adp-charts', visitsData);
    renderRanking(overview, itemDetails, 'adp-ranking');
    renderSimulator(overview, 'adp-simulator', _currentDays);
    renderAdsTable(overview.items || [], itemDetails, 'adp-table', overview.campaigns || []);
    renderCampaignInsights(overview, 'adp-campaigns');

    // Onboarding (1st visit only) + anomaly modal
    renderOnboardingModal(overview);
    renderAnomalyModal(overview);
}

// Top loading bar (estilo YouTube / NProgress)
function adpShowTopLoader(msg) {
    let bar = document.getElementById('adp-top-loader');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'adp-top-loader';
        bar.className = 'adp-top-loader';
        bar.innerHTML = '<div class="adp-top-loader-fill"></div><div class="adp-top-loader-text"></div>';
        document.body.appendChild(bar);
    }
    const textEl = bar.querySelector('.adp-top-loader-text');
    if (textEl) textEl.textContent = msg || 'Carregando...';
    bar.classList.remove('done');
    bar.classList.add('loading');
}
function adpHideTopLoader() {
    const bar = document.getElementById('adp-top-loader');
    if (!bar) return;
    bar.classList.add('done');
    bar.classList.remove('loading');
    setTimeout(() => { try { bar.remove(); } catch(_) {} }, 500);
}

window.changePeriod = async function(days) {
    _currentDays = days;
    window._currentDays = days;
    // Invalida ambos os caches (legado + novo)
    try { sessionStorage.removeItem(CACHE_KEY); } catch(_) {}
    try { sessionStorage.removeItem(AGG_CACHE_KEY); } catch(_) {}

    const wrapper = document.querySelector('.adp-wrapper');
    if (!wrapper) return;

    // Update period buttons (estado visual imediato)
    document.querySelectorAll('.adp-period-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim() === `${days}d`);
    });

    // Top loading bar
    adpShowTopLoader(`Carregando ${days} dias\u2026`);

    // Indicador inline na área principal (skeleton leve)
    const overviewEl = document.getElementById('adp-overview');
    if (overviewEl) overviewEl.innerHTML = '<div class="adp-loading"><div class="adp-loading-spinner"></div><div class="adp-loading-text">Buscando dados de ' + days + ' dias\u2026</div></div>';

    try {
        adpShowTopLoader(`Conectando ao Mercado Livre\u2026`);
        const token = await fetchAccessToken();
        if (!token) throw new Error('Token indispon\u00edvel');

        adpShowTopLoader(`Buscando m\u00e9tricas dos \u00faltimos ${days} dias\u2026`);
        const aggregatedResp = await fetchAdsAggregated(token, days);
        const ctx = { advertiser_id: aggregatedResp?.advertiser_id, site_id: aggregatedResp?.site_id };
        const itemsResp = await fetchAdsItemsPage(token, {
            limit: 50, sort_by: 'cost', sort: 'desc',
            advertiser_id: ctx.advertiser_id, site_id: ctx.site_id
        }).catch(() => ({ items: [], paging: { ml_total: 0, returned: 0 } }));

        const items = (itemsResp.items || []).map(it => ({
            item_id: it.item_id, has_ads: true, campaign_id: it.campaign_id,
            status: it.status, current_level: it.current_level,
            cost: it.cost || 0, revenue: it.revenue || 0, organic_revenue: it.organic_revenue || 0,
            clicks: it.clicks || 0, impressions: it.impressions || 0,
            orders: it.orders || 0, organic_orders: it.organic_orders || 0,
            acos: it.acos || 0, ctr: it.ctr || 0, cvr: it.cvr || 0,
            roas: it.roas || 0, cpc: it.cpc || 0
        }));
        const totalItemsWithAds = itemsResp.paging?.ml_total || items.length;
        const overview = {
            seller_id: aggregatedResp?.seller_id,
            seller_info: aggregatedResp?.seller_info || {},
            site_id: aggregatedResp?.site_id,
            advertiser_id: aggregatedResp?.advertiser_id,
            total_items: aggregatedResp?.total_items_account || 0,
            total_items_with_ads: totalItemsWithAds,
            items_sampled: items.length,
            items_skipped: Math.max(0, totalItemsWithAds - items.length),
            partial: totalItemsWithAds > items.length,
            date_from: aggregatedResp?.date_from,
            date_to: aggregatedResp?.date_to,
            aggregated: aggregatedResp?.aggregated || null,
            daily_aggregated: aggregatedResp?.daily_aggregated || [],
            campaigns: aggregatedResp?.campaigns || [],
            items
        };
        _currentOverview = overview;
        window._currentOverview = overview;
        try { rtSaveSnapshot(overview); } catch(_) {}

        // Constrói itemDetails direto da resposta (já vêm title/thumb/permalink)
        const itemDetails = {};
        for (const it of itemsResp.items || []) {
            if (it.item_id) {
                itemDetails[it.item_id] = {
                    title: it.title || '', thumbnail: it.thumbnail || '',
                    permalink: it.permalink || '', price: it.price || 0,
                    original_price: 0, category_id: ''
                };
            }
        }
        _currentItemDetails = itemDetails;

        const adsItemIds = items.map(i => i.item_id);
        if (adsItemIds.length > 0) {
            adpShowTopLoader(`Carregando detalhes de ${adsItemIds.length} an\u00fancios\u2026`);
            const now3 = new Date();
            const fromDate = new Date(now3.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const toDate = now3.toISOString().split('T')[0];
            try {
                _currentVisitsData = await fetchVisitsBulk(adsItemIds, token, fromDate, toDate);
            } catch (_) { _currentVisitsData = {}; }
        }

        adpShowTopLoader('Montando dashboard\u2026');
        renderFullDashboard(overview, _currentItemDetails, _currentVisitsData);
        adpHideTopLoader();
    } catch (e) {
        console.error('Erro ao atualizar periodo:', e);
        if (overviewEl) overviewEl.innerHTML = `<div class="adp-empty"><div class="adp-empty-text">Erro: ${escapeHtml(e.message)}</div></div>`;
        adpHideTopLoader();
    }
};

// Auto-init
initAdsPlanner();
