/* === DASHBOARD MARKETFACIL ===
 * Painel inicial viciante que agrega métricas da conta inteira e
 * direciona o usuário pras ferramentas certas.
 *
 * Design system: Light Trading (Proposta U) — wrapper .mfd-wrapper
 * Storage:       localStorage `mf_dash_*` (espelha snapshots em mf_adp_* p/ continuidade)
 * Endpoints:     /api/ads-aggregated, /api/fetch-ads, /api/users/me, /api/fetch-item
 *
 * Bootstrap (no Bubble): window.MFD_init({ token: <ML_token>, sellerId: <id?>, container: 'mfd-root' })
 */

(function () {
'use strict';

// ══════════════════════════════════════════════════════════════════════
// SECTION 0 — Constantes, config, helpers
// ══════════════════════════════════════════════════════════════════════

const BASE_URL_PROXY = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
const API_ADS_AGGREGATED = `${BASE_URL_PROXY}/api/ads-aggregated`;
const API_FETCH_ADS      = `${BASE_URL_PROXY}/api/fetch-ads`;
const API_USERS_ME       = `${BASE_URL_PROXY}/api/users/me`;
const API_FETCH_ITEM     = `${BASE_URL_PROXY}/api/fetch-item`;

// Bubble workflows expostos (mesmos usados pelo analyzer/planner)
const BUBBLE_TOKEN_URL   = 'https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2';
const BUBBLE_USERID_URL  = 'https://app.marketfacil.com.br/api/1.1/wf/get-user-id';

const NS = 'mf_dash_';                // namespace localStorage do dashboard
const LEGACY_NS = 'mf_adp_';          // legado do planejador — leitura cruzada
const MAX_HISTORY = 90;
const STREAK_GAP_GRACE = 1;           // 1 dia de gap = quebra streak; mesma regra do planner

const STATE = {
  token: null,
  sellerId: null,
  sellerInfo: null,
  containerId: null,
  period: 30,
  data: null,
  prevSnapshot: null,
  loading: false
};

// ── Format helpers (i18n via MF_getSiteConfig se disponível) ───────────
function _siteCfg() {
  if (typeof window !== 'undefined' && window.MF_getSiteConfig) {
    const sid = window.MF_currentSiteId ? window.MF_currentSiteId() : 'MLB';
    try { return window.MF_getSiteConfig(sid); } catch (_) {}
  }
  return { locale: 'pt-BR', currency: 'BRL', currencySymbol: 'R$' };
}

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString(_siteCfg().locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function fmtInt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(Math.round(n)).toLocaleString(_siteCfg().locale);
}

function fmtMoney(n) {
  const cfg = _siteCfg();
  if (n == null || isNaN(n)) return cfg.currencySymbol + ' —';
  return cfg.currencySymbol + ' ' + Number(n).toLocaleString(cfg.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtMoneyCompact(n) {
  const cfg = _siteCfg();
  if (n == null || isNaN(n)) return cfg.currencySymbol + ' —';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return cfg.currencySymbol + ' ' + (n / 1_000_000).toFixed(2).replace('.', ',') + 'M';
  if (abs >= 1_000)     return cfg.currencySymbol + ' ' + (n / 1_000).toFixed(1).replace('.', ',') + 'k';
  return fmtMoney(n);
}

function fmtCompact(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2).replace('.', ',') + 'M';
  if (abs >= 1_000)     return (n / 1_000).toFixed(1).replace('.', ',') + 'k';
  return fmtInt(n);
}

function fmtPct(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return fmt(n, decimals) + '%';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}

function ymdAddDays(date, n) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function deltaArrow(delta) {
  if (delta > 0) return '▲';
  if (delta < 0) return '▼';
  return '•';
}

function deltaClass(delta, inverted = false) {
  // inverted=true para métricas onde menor = melhor (ex: TACOS, ACOS)
  if (Math.abs(delta) < 1e-9) return 'flat';
  const positive = delta > 0;
  if (inverted) return positive ? 'neg' : 'pos';
  return positive ? 'pos' : 'neg';
}

// Saudação por hora local
function saudacao() {
  const h = new Date().getHours();
  if (h < 5)  return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// Day of week pt-BR
const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// ══════════════════════════════════════════════════════════════════════
// SECTION 1 — Retention engine (localStorage por seller_id)
// ══════════════════════════════════════════════════════════════════════

function _key(slot, sid) { return `${NS}${slot}_${sid || 'unknown'}`; }
function _legacyKey(slot, sid) { return `${LEGACY_NS}${slot}_${sid || 'unknown'}`; }

function _get(slot, sid, fallback) {
  try {
    const raw = localStorage.getItem(_key(slot, sid));
    if (raw) return JSON.parse(raw);
    // tenta cair pro legacy do planner
    const rawLegacy = localStorage.getItem(_legacyKey(slot, sid));
    if (rawLegacy) return JSON.parse(rawLegacy);
  } catch (_) {}
  return fallback;
}

function _set(slot, sid, value) {
  try {
    localStorage.setItem(_key(slot, sid), JSON.stringify(value));
  } catch (_) { /* quota cheia, ignora */ }
}

function rtGetStreak(sid) {
  return _get('streak', sid, { current: 0, best: 0, lastDate: null });
}

function rtUpdateStreak(sid) {
  const today = todayStr();
  const s = rtGetStreak(sid);
  if (s.lastDate === today) return s; // já contou hoje
  if (!s.lastDate) {
    s.current = 1;
  } else {
    const gap = daysBetween(s.lastDate, today);
    if (gap === 1) s.current += 1;
    else if (gap > STREAK_GAP_GRACE) s.current = 1;
    // gap 0 nunca acontece (filtro acima)
  }
  s.lastDate = today;
  if (s.current > s.best) s.best = s.current;
  _set('streak', sid, s);
  return s;
}

function rtGetHistory(sid) {
  return _get('history', sid, []);
}

function rtSaveSnapshot(sid, period, snap) {
  if (!sid) return;
  const today = todayStr();
  const list = rtGetHistory(sid);
  // dedupe (mesmo dia + mesmo período)
  let filtered = list.filter(h => !(h.date === today && (h.period || 30) === period));
  filtered.push(Object.assign({ date: today, period, ts: Date.now() }, snap));
  // Janela por DIAS (não por nº de entradas): cada dia gera até 4 entradas
  // (uma por período visualizado) e o heatmap precisa de 90 dias completos.
  filtered = filtered.filter(h => daysBetween(h.date, today) <= MAX_HISTORY);
  while (filtered.length > MAX_HISTORY * 4) filtered.shift();
  _set('history', sid, filtered);
}

function rtGetPrevSnapshot(sid, beforeDate, period) {
  const list = rtGetHistory(sid);
  const target = period || 30;
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i].period || 30) === target && list[i].date < beforeDate) return list[i];
  }
  return null;
}

function rtGetLatestSnapshot(sid, period) {
  const list = rtGetHistory(sid);
  const target = period || 30;
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i].period || 30) === target) return list[i];
  }
  return null;
}

function rtGetBest(sid, slot) { return _get(slot, sid, null); }
function rtSetBest(sid, slot, value) { _set(slot, sid, value); }

function rtUpdateRecords(sid, snap) {
  // Best ROAS
  const bestRoas = rtGetBest(sid, 'bestRoas');
  if (snap.roas != null && (!bestRoas || snap.roas > bestRoas.value)) {
    rtSetBest(sid, 'bestRoas', { value: snap.roas, date: snap.date });
  }
  // Best Revenue (orgânico + ads)
  const totalRev = (snap.revenue || 0) + (snap.organic_revenue || 0);
  const bestRev = rtGetBest(sid, 'bestRevenue');
  if (totalRev > 0 && (!bestRev || totalRev > bestRev.value)) {
    rtSetBest(sid, 'bestRevenue', { value: totalRev, date: snap.date });
  }
}

function rtIsAlertDismissed(sid, alertId) {
  const m = _get('dismissedAlerts', sid, {});
  return !!m[alertId];
}

function rtDismissAlert(sid, alertId) {
  const m = _get('dismissedAlerts', sid, {});
  m[alertId] = { date: todayStr(), ts: Date.now() };
  _set('dismissedAlerts', sid, m);
}

function rtGetChecklist(sid) {
  const stored = _get('dailyChecklist', sid, null);
  if (stored && stored.date === todayStr()) return stored;
  return null;
}

function rtSetChecklist(sid, items) {
  _set('dailyChecklist', sid, { date: todayStr(), items });
}

function rtGetSeenInsights(sid) {
  return _get('seenInsights', sid, {}); // { id: lastDate }
}

function rtMarkInsightSeen(sid, id) {
  const m = rtGetSeenInsights(sid);
  m[id] = todayStr();
  _set('seenInsights', sid, m);
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 2 — Health Score (0-100) + componentes
// ══════════════════════════════════════════════════════════════════════
// Composta por 4 componentes balanceados; cada um vale 25 pts.
//   1. Ads efficiency (ROAS + TACOS vs target)
//   2. Coverage (proporção de itens ativos com ads / pausa / saúde)
//   3. Retention behavior (streak, frequência, ações concluídas)
//   4. Trend (delta vs período anterior — receita e ROAS)

function computeHealthBreakdown(agg, totals, prevSnap, streak) {
  const out = { components: [], total: 0 };
  const MAX = 25; // 4 componentes × 25 = 100

  // 1. Anúncios saudáveis — % de ativos SEM problema de saúde (via /api/slot)
  const activeCount = Number(totals.activeItems) || 0;
  const issues = STATE.issuesData;
  const unhealthyCount = issues && Array.isArray(issues.slots) ? issues.slots.length : 0;
  let ads = MAX;
  let adsHint = 'Carregando lista de anúncios com problema de saúde detectado pelo ML...';
  if (issues == null && STATE.issuesError) {
    adsHint = 'Não foi possível verificar a saúde dos anúncios agora — atualize a página pra tentar de novo.';
  }
  if (issues != null) {
    if (activeCount === 0) {
      ads = MAX;
      adsHint = 'Você não tem anúncios ativos pra avaliar saúde.';
    } else {
      const healthyPct = Math.max(0, (activeCount - unhealthyCount) / activeCount);
      if (healthyPct >= 1)        ads = 25;
      else if (healthyPct >= 0.9) ads = 22;
      else if (healthyPct >= 0.7) ads = 15;
      else if (healthyPct >= 0.5) ads = 8;
      else                        ads = 0;
      adsHint = unhealthyCount > 0
        ? `${unhealthyCount} de ${activeCount} ${activeCount === 1 ? 'anúncio' : 'anúncios'} com problema de saúde detectado pelo ML (tag negativa, qualidade baixa, etc).`
        : activeCount === 1
          ? 'Seu único anúncio ativo está sem problema de saúde detectado.'
          : `Todos os ${activeCount} anúncios ativos estão sem problema de saúde detectado.`;
    }
  }
  out.components.push({
    id: 'ads',
    label: 'Anúncios saudáveis',
    value: ads,
    max: MAX,
    hint: adsHint,
    what: 'Quantos % dos seus anúncios ativos NÃO têm problema de saúde reportado pelo ML.'
  });

  // 2. Reputação ML — vem do seller_reputation real
  const seller = STATE.sellerInfo || {};
  const hasRepData = !!seller.seller_reputation;
  const rep = seller.seller_reputation || {};
  const levelId = rep.level_id || '';
  const metrics = rep.metrics || {};
  let repScore = 0;
  let repHint = 'Sem dados de reputação';
  if (levelId.startsWith('5')) { repScore = 25; repHint = 'Vendedor verde — nível 5, o mais alto do Mercado Livre.'; }
  else if (levelId.startsWith('4')) { repScore = 18; repHint = 'Vendedor amarelo — nível 4. Tem o que melhorar, mas ainda bem visto.'; }
  else if (levelId.startsWith('3')) { repScore = 10; repHint = 'Vendedor laranja — nível 3. Reputação em risco, atenção.'; }
  else if (levelId) { repScore = 0; repHint = 'Vendedor vermelho ou pendente — sua reputação está derrubada e isso afeta vendas.'; }
  else if (hasRepData) {
    // ML retornou dados mas sem nível ainda — conta nova ou volume baixo.
    // Distingue "limpo (zero problemas)" de "novo com sinais negativos".
    const claimsRate = Number(metrics.claims?.rate || 0);
    const delaysRate = Number(metrics.delayed_handling_time?.rate || 0);
    const cancelsRate = Number(metrics.cancellations?.rate || 0);
    const allZero = claimsRate === 0 && delaysRate === 0 && cancelsRate === 0;
    const totalTx = Number(rep.transactions?.total || 0);
    if (allZero) {
      if (totalTx > 0) {
        repScore = 25;
        repHint = `Conta impecável: ${totalTx} venda${totalTx > 1 ? 's' : ''} sem reclamações, atrasos ou cancelamentos. Mercado Livre só atribui nível com mais volume.`;
      } else {
        repScore = 18;
        repHint = 'Sem vendas ainda — nenhum problema detectado também. Mercado Livre vai atribuir nível quando você acumular pedidos.';
      }
    } else {
      repScore = 8;
      repHint = 'Conta sem nível atribuído ainda — mas já com alguma métrica negativa. Cuide das % antes de escalar volume.';
    }
  }
  // Penaliza métricas >2% (claims, delayed handling, cancellations)
  const flagged = [];
  ['claims', 'delayed_handling_time', 'cancellations'].forEach(k => {
    const rate = Number(metrics[k]?.rate || metrics[k]?.value || 0);
    if (rate > 0.02) { repScore -= 5; flagged.push(k); }
  });
  if (flagged.length) {
    const trans = { claims: 'reclamações', delayed_handling_time: 'atrasos no envio', cancellations: 'cancelamentos' };
    repHint += ` Métrica(s) acima de 2%: ${flagged.map(f => trans[f]).join(', ')}.`;
  }
  repScore = clamp(repScore, 0, MAX);
  out.components.push({
    id: 'rep',
    label: 'Reputação ML',
    value: repScore,
    max: MAX,
    hint: repHint,
    what: 'Vem do termômetro oficial do Mercado Livre (verde/amarelo/laranja/vermelho) + reclamações, atrasos e cancelamentos dos últimos 60 dias.'
  });

  // 3. Diversificação — penaliza dependência de Ads > 75%
  const totalRev = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
  const adsPct = totalRev > 0 ? (agg.total_revenue || 0) / totalRev : 0;
  let div = MAX;
  const pctRound = Math.round(adsPct * 100);
  let divHint = `${pctRound}% da sua receita vem de Ads. Bom equilíbrio com o orgânico.`;
  if (totalRev === 0) {
    div = MAX;
    divHint = 'Sem receita no período pra calcular dependência.';
  } else if (adsPct > 0.90) {
    div = 0;
    divHint = `${pctRound}% da receita vem de Ads — você está totalmente dependente. Se pausar Ads, perde quase tudo.`;
  } else if (adsPct > 0.80) {
    div = 8;
    divHint = `${pctRound}% da receita vem de Ads — dependência alta, vulnerável a pausas e bloqueios.`;
  } else if (adsPct > 0.60) {
    div = 15;
    divHint = `${pctRound}% da receita vem de Ads — começando a ficar dependente. Atenção.`;
  } else {
    div = 25;
    divHint = pctRound === 0
      ? 'Receita 100% orgânica — base sólida. Ads pode ser uma alavanca de crescimento.'
      : `${pctRound}% da receita vem de Ads. Saudável — você tem orgânico forte como base.`;
  }
  out.components.push({
    id: 'div',
    label: 'Diversificação de receita',
    value: div,
    max: MAX,
    hint: divHint,
    what: 'Mede quanto da sua receita depende de Ads. Acima de 60% começa a penalizar — se Ads pausa, seu faturamento cai junto.'
  });

  // 5. Tração orgânica — queda em visitas e conversão orgânica vs período anterior
  let trac = MAX; // neutro sem snapshot
  let tracHint = 'Esse é seu primeiro acesso ao dashboard nesse período — vou ter comparativo a partir da próxima visita.';

  if (prevSnap) {
    // Visitas (até 12 pts)
    let visitsPts = 12;
    const visitsNow = STATE.visitsData?.total_visits || 0;
    const visitsPrev = Number(prevSnap.visits) || 0;
    if (visitsNow && visitsPrev) {
      const delta = (visitsNow - visitsPrev) / visitsPrev;
      if (delta < -0.20) visitsPts = 0;
      else if (delta < -0.05) visitsPts = 6;
      else visitsPts = 12;
    }

    // Conversão orgânica (até 13 pts)
    let convPts = 13;
    const orgOrders = Number(agg.organic_orders) || 0;
    const orgVisitsNow = Math.max(0, visitsNow - (Number(agg.total_clicks) || 0));
    const orgConvNow = orgVisitsNow > 0 ? (orgOrders / orgVisitsNow * 100) : 0;
    const orgConvPrev = Number(prevSnap.organic_conversion) || 0;
    if (orgConvNow && orgConvPrev) {
      const delta = (orgConvNow - orgConvPrev) / orgConvPrev;
      if (delta < -0.20) convPts = 0;
      else if (delta < -0.05) convPts = 6;
      else convPts = 13;
    }
    trac = clamp(visitsPts + convPts, 0, MAX);
    const labelVis = visitsPts === 12 ? 'estáveis ou subindo' : visitsPts === 6 ? 'caíram 5-20%' : 'caíram mais de 20%';
    const labelConv = convPts === 13 ? 'estável ou subindo' : convPts === 6 ? 'caiu 5-20%' : 'caiu mais de 20%';
    tracHint = `Visitas ${labelVis} · Conversão orgânica ${labelConv} vs período anterior.`;
  } else if (STATE.visitsData == null) {
    tracHint = 'Calculando suas visitas dos anúncios — vai aparecer comparativo na próxima visita.';
  }
  out.components.push({
    id: 'trac',
    label: 'Tração orgânica',
    value: trac,
    max: MAX,
    hint: tracHint,
    what: 'Compara as visitas dos anúncios e a conversão orgânica (vendas sem Ads ÷ visitas orgânicas) com o período anterior. Queda = perda de tração.'
  });

  out.total = out.components.reduce((s, c) => s + c.value, 0);
  return out;
}

function classFromScore(score) {
  if (score >= 90) return { letter: 'S', label: 'Conta Impecável', emoji: '🏆', color: 'good' };
  if (score >= 75) return { letter: 'A', label: 'Conta Forte',     emoji: '⭐', color: 'good' };
  if (score >= 55) return { letter: 'B', label: 'Tem Potencial',   emoji: '📈', color: 'neutral' };
  if (score >= 35) return { letter: 'C', label: 'Precisa de Foco', emoji: '⚙️', color: 'bad' };
  return { letter: 'D', label: 'Atenção Urgente', emoji: '⚠️', color: 'bad' };
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 3 — Fetch & bootstrap
// ══════════════════════════════════════════════════════════════════════

function periodToDates(period) {
  // "Últimos N dias" = hoje incluso + (N-1) anteriores (API trata as pontas como inclusivas)
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (period - 1));
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { from: fmtD(from), to: fmtD(to) };
}

// Desloca uma data YYYY-MM-DD em N dias (aritmética pura de calendário, sem fuso)
function shiftYmd(ymd, days) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchAdsAggregated(period) {
  const { from, to } = periodToDates(period);
  const url = `${API_ADS_AGGREGATED}?date_from=${from}&date_to=${to}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${STATE.token}` }
  });
  if (!res.ok) {
    const err = new Error(`ads-aggregated falhou (${res.status})`);
    err.status = res.status;
    err.endpoint = 'ads-aggregated';
    throw err;
  }
  return await res.json();
}

async function fetchUserMe() {
  try {
    const res = await fetch(API_USERS_ME, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

// Visitas totais da conta no período.
// Caminho preferido: /api/user-visits (ML /users/$ID/items_visits) — UMA chamada
// cobre a conta inteira, incluindo visitas atribuídas a anúncios de catálogo.
// Fallback: soma por item em chunks (contas onde o agregado falhar).
async function fetchOrganicVisits(sellerId, periodDays) {
  if (!sellerId || !STATE.token) return null;
  const { from, to } = periodToDates(periodDays);
  try {
    const r = await fetch(`${BASE_URL_PROXY}/api/user-visits?user_id=${sellerId}&date_from=${from}&date_to=${to}`, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (r.ok) {
      const d = await r.json();
      if (d && typeof d.total_visits === 'number') {
        return {
          total_visits: d.total_visits,
          accountWide: true,        // conta inteira — não é amostra
          sampled_items: null,
          capped: false,
          incomplete: false,
          total_items_account: null
        };
      }
    }
  } catch (_) { /* cai pro fallback por item */ }
  try {
    const MAX_ITEMS = 1000; // teto de segurança pra contas gigantes
    let ids = [];
    let total = 0;
    for (let offset = 0; offset < MAX_ITEMS; offset += 100) {
      const res = await fetch(`${API_FETCH_ADS}?seller_id=${sellerId}&status=active&limit=100&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${STATE.token}` }
      });
      if (!res.ok) break;
      const d = await res.json();
      const page = (d?.results || []).map(it => (typeof it === 'string' ? it : (it?.id || it?.item_id))).filter(Boolean);
      ids = ids.concat(page);
      total = d?.paging?.total || ids.length;
      if (!page.length || ids.length >= Math.min(total, MAX_ITEMS)) break;
    }
    ids = ids.slice(0, MAX_ITEMS);
    if (!ids.length) return { total_visits: 0, sampled_items: 0, capped: false, incomplete: false };

    const fetchChunk = async (batch) => {
      try {
        const url = `${BASE_URL_PROXY}/api/fetch-visits-bulk?items=${batch.join(',')}&date_from=${from}&date_to=${to}`;
        const r = await fetch(url, { headers: { 'Authorization': `Bearer ${STATE.token}` } });
        if (!r.ok) return null; // null = chunk falhou (≠ zero visitas)
        const data = await r.json();
        let sum = 0;
        // Proxy retorna { itemId: { total_visits: N, results: [...] } | array }
        for (const k of Object.keys(data || {})) {
          const it = data[k];
          if (it == null) continue;
          if (typeof it.total_visits === 'number') sum += it.total_visits;
          else if (Array.isArray(it.results)) sum += it.results.reduce((s, r) => s + (r.total || 0), 0);
          else if (Array.isArray(it)) sum += it.reduce((s, r) => s + (r.total || 0), 0);
        }
        return sum;
      } catch (_) { return null; }
    };

    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    let totalVisits = 0;
    let failedChunks = 0;
    const WAVE = 5; // 5 chunks em paralelo por onda (não estoura proxy/ML)
    for (let i = 0; i < chunks.length; i += WAVE) {
      const sums = await Promise.all(chunks.slice(i, i + WAVE).map(fetchChunk));
      for (const s of sums) {
        if (s == null) failedChunks++;
        else totalVisits += s;
      }
    }
    return {
      total_visits: totalVisits,
      sampled_items: ids.length,
      capped: total > MAX_ITEMS,
      incomplete: failedChunks > 0, // faltou pedaço → conversão sairia distorcida
      total_items_account: total
    };
  } catch (_) { return null; }
}

// Busca visitas DIÁRIAS agregadas.
// Caminho preferido: /api/user-visits-daily (ML /users/$ID/items_visits/time_window)
// — UMA chamada com a série da conta inteira. Fallback: amostra por item.
// Retorna { daily: { '2026-05-14': 1234, ... }, ... }
async function fetchOrganicVisitsDaily(sellerId, periodDays) {
  if (!sellerId || !STATE.token) return null;
  const lastDays = Math.min(90, Math.max(1, periodDays || 30));
  try {
    const r = await fetch(`${BASE_URL_PROXY}/api/user-visits-daily?user_id=${sellerId}&last=${lastDays}&unit=day`, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (r.ok) {
      const data = await r.json();
      if (data && Array.isArray(data.results)) {
        const daily = {};
        for (const point of data.results) {
          if (!point || !point.date) continue;
          const ymd = String(point.date).slice(0, 10);
          daily[ymd] = (daily[ymd] || 0) + (Number(point.total) || 0);
        }
        return { daily, accountWide: true, sampled_items: null };
      }
    }
  } catch (_) { /* cai pro fallback por item */ }
  try {
    const idsRes = await fetch(`${API_FETCH_ADS}?seller_id=${sellerId}&status=active&limit=100&offset=0`, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!idsRes.ok) return null;
    const idsData = await idsRes.json();
    const ids = (idsData?.results || []).map(it => (typeof it === 'string' ? it : (it?.id || it?.item_id))).filter(Boolean).slice(0, 60);
    if (!ids.length) return { daily: {}, sampled_items: 0 };

    const last = Math.min(90, Math.max(1, periodDays || 30));
    // Roda em paralelo, mas em batches pra não estourar rate limit
    const results = {};
    const batchSize = 10;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const batchData = await Promise.all(batch.map(async (id) => {
        try {
          const url = `${BASE_URL_PROXY}/api/fetch-visits?item_id=${id}&last=${last}&unit=day`;
          const r = await fetch(url, { headers: { 'Authorization': `Bearer ${STATE.token}` } });
          if (!r.ok) return null;
          const data = await r.json();
          return data?.results || [];
        } catch { return null; }
      }));
      for (const arr of batchData) {
        if (!Array.isArray(arr)) continue;
        for (const point of arr) {
          if (!point.date) continue;
          const ymd = point.date.slice(0, 10);
          results[ymd] = (results[ymd] || 0) + (Number(point.total) || 0);
        }
      }
    }
    return { daily: results, sampled_items: ids.length };
  } catch (_) { return null; }
}

// Busca publicações com moderação ativa + detalhe da primeira
async function fetchModerations(sellerId) {
  if (!sellerId || !STATE.token) return null;
  try {
    // Pagina até trazer todas as moderações (teto de 100 pra não estourar
    // requisição em conta muito problemática — o card avisa se passar disso)
    const PAGE = 50, MAX_IDS = 100;
    let ids = [], total = 0, offset = 0;
    do {
      const itemsRes = await fetch(`${BASE_URL_PROXY}/api/moderations/items?seller_id=${sellerId}&limit=${PAGE}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${STATE.token}` }
      });
      if (!itemsRes.ok) {
        if (offset === 0) return null; // primeira página falhou = erro real
        break;                         // página extra falhou = segue com o que tem
      }
      const itemsData = await itemsRes.json();
      const page = Array.isArray(itemsData?.results) ? itemsData.results : [];
      ids = ids.concat(page);
      total = itemsData?.paging?.total || ids.length;
      offset += PAGE;
      if (!page.length) break;
    } while (ids.length < Math.min(total, MAX_IDS));
    if (!ids.length) return { items: [], total: 0, featured: null };

    // Detalhe da primeira moderação
    let featured = null;
    try {
      const detRes = await fetch(`${BASE_URL_PROXY}/api/moderations/details?item_id=${ids[0]}`, {
        headers: { 'Authorization': `Bearer ${STATE.token}` }
      });
      if (detRes.ok) {
        const detData = await detRes.json();
        if (Array.isArray(detData) && detData.length) {
          const mod = detData[0];
          const reason = mod.wordings?.find(w => w.type === 'REASON')?.value;
          const remedy = mod.wordings?.find(w => w.type === 'REMEDY')?.value;
          featured = {
            item_id: ids[0],
            name: mod.name,
            reason,
            remedy,
            date_created: mod.date_created,
            url: `https://app.marketfacil.com.br/analise-anuncio?item=${ids[0]}`
          };
        }
      }
    } catch {}
    return { items: ids, total, featured };
  } catch (_) { return null; }
}

// Busca anúncios com problema de saúde via /api/slot (reputation_health_gauge unhealthy|warning)
async function fetchAdsWithIssues(sellerId) {
  if (!sellerId || !STATE.token) return null;
  try {
    const url = `${BASE_URL_PROXY}/api/slot?seller_id=${sellerId}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

// Pedidos do período (vendas brutas, sem descontar cancelamentos) — numerador
// da "Conversão de visitas" igual ao Seller Central (pedidos ÷ visitas).
// Unidades vendidas inflavam a conversão (1 pedido pode ter N unidades).
// includeRevenue: pede também soma de receita + série diária (paginação de
// pedidos no proxy) — usado só quando a conta não tem dados de Mercado Ads,
// porque aí os pedidos são a única fonte de receita disponível.
async function fetchOrdersCount(sellerId, periodDays, includeRevenue, range) {
  if (!sellerId || !STATE.token) return null;
  try {
    const { from, to } = range || periodToDates(periodDays);
    const rev = includeRevenue ? '&include_revenue=1' : '';
    const r = await fetch(`${BASE_URL_PROXY}/api/orders-count?seller_id=${sellerId}&date_from=${from}&date_to=${to}${rev}`, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (typeof d?.total_orders === 'number') ? d : null;
  } catch (_) { return null; }
}

async function fetchAdsCount(sellerId, status) {
  // Busca só 1 página com limit=1 pra pegar paging.total.
  // Retorna null em ERRO (≠ 0 anúncios) — quem consome trata como "desconhecido".
  try {
    const url = `${API_FETCH_ADS}?seller_id=${sellerId}&status=${status}&limit=1&offset=0`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const t = data?.paging?.total;
    return (typeof t === 'number') ? t : 0;
  } catch (_) { return null; }
}

// Reviews dos top anúncios — paraleliza (1 fetch por item, máx 5).
// Retorna { itemId: { rating_average, paging.total, latest: { rate, content, date } } }
async function fetchReviewsForItems(itemIds) {
  if (!itemIds || !itemIds.length) return {};
  const results = await Promise.all(itemIds.map(async (id) => {
    if (!id) return [id, null];
    try {
      const url = `${BASE_URL_PROXY}/api/fetch-reviews?item_id=${encodeURIComponent(id)}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${STATE.token}` }
      });
      if (!res.ok) return [id, null];
      const data = await res.json();
      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
      // Pega a review mais recente
      let latest = null;
      if (reviews.length) {
        latest = [...reviews].sort((a, b) =>
          (b.date_created || '').localeCompare(a.date_created || '')
        )[0];
      }
      return [id, {
        rating_average: data?.rating_average || 0,
        total: data?.paging?.total || reviews.length,
        levels: data?.rating_levels || null,
        latest: latest ? {
          rate: latest.rate || 0,
          title: latest.title || '',
          content: latest.content || '',
          date: latest.date_created || ''
        } : null
      }];
    } catch (_) { return [id, null]; }
  }));
  return Object.fromEntries(results);
}

// Top N anúncios em campanha (ordenados por receita)
async function fetchTopAdsItems(period, limit = 5) {
  try {
    const { from, to } = periodToDates(period);
    const url = `${BASE_URL_PROXY}/api/ads-items?date_from=${from}&date_to=${to}&offset=0&limit=${limit}&sort_by=REVENUE&sort=desc&min_cost=0.01`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (_) { return []; }
}

// Verifica se a conta é Loja Oficial via /api/users/{id}/brands.
// Retorna { isOfficial: bool, name: string|null } — name = fantasy_name ou nome
// da loja oficial encontrada. Em caso de erro/404, isOfficial = false.
async function fetchBrandInfo(sellerId) {
  if (!sellerId) return { isOfficial: false, name: null };
  try {
    const url = `${BASE_URL_PROXY}/api/users/${sellerId}/brands`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!res.ok) return { isOfficial: false, name: null };
    const data = await res.json();
    // Endpoint ML retorna lista de brands ou um objeto. Tenta vários formatos.
    let arr = [];
    if (Array.isArray(data)) arr = data;
    else if (Array.isArray(data?.brands)) arr = data.brands;
    else if (Array.isArray(data?.results)) arr = data.results;
    else if (data && typeof data === 'object' && data.id) arr = [data];

    if (!arr.length) return { isOfficial: false, name: null };
    const first = arr[0];
    const name = first?.fantasy_name || first?.name || first?.brand_name || null;
    return { isOfficial: true, name };
  } catch (_) {
    return { isOfficial: false, name: null };
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 4 — Insights diários (rotativos, baseados em estado real)
// ══════════════════════════════════════════════════════════════════════
// Cada insight tem um predicate e uma copy. Rotacionamos diariamente,
// preferindo insights que (a) ainda não foram vistos hoje e (b) batem
// com o estado atual da conta.

function buildInsights(ctx) {
  const { agg, totals, prevSnap, streak, weekday, hasOpps } = ctx;
  const list = [];

  // Helpers de delta — só calcula se tem snapshot anterior válido
  const hasPrev = prevSnap && (prevSnap.revenue || prevSnap.organic_revenue || prevSnap.sales);
  const pctChange = (now, prev) => prev > 0 ? ((now - prev) / prev) : 0;
  const absChange = (now, prev) => now - prev;
  const fmtPctDelta = (d) => (d > 0 ? '+' : d < 0 ? '-' : '') + fmt(Math.abs(d) * 100, 1) + '%';
  const fmtAbsDelta = (d, dec = 2) => (d > 0 ? '+' : d < 0 ? '-' : '') + fmt(Math.abs(d), dec);

  // Streak/engajamento (não depende de meta)
  list.push({
    id: 'tip-streak-power',
    when: () => streak.current >= 3,
    text: `Você tá há <b>${streak.current} dias</b> seguidos acompanhando o painel. Cuidar dos dados todo dia é como olhar o velocímetro: você muda de direção mais rápido quando algo escapa.`
  });

  // === TENDÊNCIAS (vs período anterior) ===

  // Receita total
  list.push({
    id: 'trend-revenue-up',
    when: () => {
      if (!hasPrev) return false;
      const now = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
      const prev = (prevSnap.revenue || 0) + (prevSnap.organic_revenue || 0);
      return pctChange(now, prev) > 0.10;
    },
    text: () => {
      const now = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
      const prev = (prevSnap.revenue || 0) + (prevSnap.organic_revenue || 0);
      return `Sua receita subiu <b>${fmt(pctChange(now, prev) * 100, 1)}%</b> em relação ao período anterior (${fmtMoneyCompact(prev)} → ${fmtMoneyCompact(now)}). Bom momento pra explorar Concorrência de Catálogo e ganhar vendas dos concorrentes.`;
    },
    cta: { label: 'Ver Concorrência de Catálogo', tool: 'catalog' }
  });

  list.push({
    id: 'trend-revenue-down',
    when: () => {
      if (!hasPrev) return false;
      const now = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
      const prev = (prevSnap.revenue || 0) + (prevSnap.organic_revenue || 0);
      return pctChange(now, prev) < -0.10;
    },
    text: () => {
      const now = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
      const prev = (prevSnap.revenue || 0) + (prevSnap.organic_revenue || 0);
      return `Sua receita caiu <b>${fmt(Math.abs(pctChange(now, prev)) * 100, 1)}%</b> vs período anterior (${fmtMoneyCompact(prev)} → ${fmtMoneyCompact(now)}). Antes de cortar Ads, audite os top 3 anúncios — geralmente o problema é estoque, ficha técnica ou tag negativa.`;
    },
    cta: { label: 'Analisar Anúncio', tool: 'analyzer' }
  });

  // Vendas
  list.push({
    id: 'trend-sales-up',
    when: () => {
      if (!hasPrev) return false;
      const now = (agg.total_orders || 0) + (agg.organic_orders || 0);
      const prev = prevSnap.sales || 0;
      return pctChange(now, prev) > 0.15;
    },
    text: () => {
      const now = (agg.total_orders || 0) + (agg.organic_orders || 0);
      const prev = prevSnap.sales || 0;
      return `Vendas <b>${fmtPctDelta(pctChange(now, prev))}</b> vs período anterior (${prev} → ${now}). Acelere enquanto o ritmo está forte — é o melhor momento pra criar variações dos produtos campeões.`;
    }
  });

  list.push({
    id: 'trend-sales-down',
    when: () => {
      if (!hasPrev) return false;
      const now = (agg.total_orders || 0) + (agg.organic_orders || 0);
      const prev = prevSnap.sales || 0;
      return pctChange(now, prev) < -0.15;
    },
    text: () => {
      const now = (agg.total_orders || 0) + (agg.organic_orders || 0);
      const prev = prevSnap.sales || 0;
      return `Vendas caíram <b>${fmt(Math.abs(pctChange(now, prev)) * 100, 1)}%</b> (${prev} → ${now}). Veja se a queda foi orgânica (perdeu exposição) ou Ads (CTR/conversão caiu) — o card Visão Geral mostra as variações separadas.`;
    }
  });

  // ROAS — só compara, não julga absoluto
  list.push({
    id: 'trend-roas-up',
    when: () => {
      if (!hasPrev) return false;
      const now = agg.overall_roas || 0;
      const prev = prevSnap.roas || 0;
      return prev > 0 && (now - prev) >= 0.5;
    },
    text: () => {
      const now = agg.overall_roas || 0;
      const prev = prevSnap.roas || 0;
      return `ROAS subiu <b>${fmt(now - prev, 2)}x</b> (${fmt(prev, 2)}x → ${fmt(now, 2)}x). Identifique no Planejador quais campanhas estão puxando esse retorno e considere escalar.`;
    },
    cta: { label: 'Abrir Planejador de Ads', tool: 'planner' }
  });

  list.push({
    id: 'trend-roas-down',
    when: () => {
      if (!hasPrev) return false;
      const now = agg.overall_roas || 0;
      const prev = prevSnap.roas || 0;
      return prev > 0 && (prev - now) >= 0.5;
    },
    text: () => {
      const now = agg.overall_roas || 0;
      const prev = prevSnap.roas || 0;
      return `ROAS caiu <b>${fmt(Math.abs(now - prev), 2)}x</b> (${fmt(prev, 2)}x → ${fmt(now, 2)}x). Antes de pausar, abra o Planejador — alguma campanha individual pode estar puxando a média pra baixo.`;
    },
    cta: { label: 'Abrir Planejador de Ads', tool: 'planner' }
  });

  // TACOS — só compara
  list.push({
    id: 'trend-tacos-up',
    when: () => {
      if (!hasPrev) return false;
      const now = agg.avg_tacos || 0;
      const prev = prevSnap.tacos || 0;
      return prev > 0 && (now - prev) >= 2;
    },
    text: () => {
      const now = agg.avg_tacos || 0;
      const prev = prevSnap.tacos || 0;
      return `TACOS subiu <b>${fmt(now - prev, 1)}pp</b> (${fmt(prev, 1)}% → ${fmt(now, 1)}%). Sua receita está custando mais em Ads — verifique se foi por aumento de gasto ou queda de receita orgânica.`;
    }
  });

  // Tendência de visitas (orgânica)
  list.push({
    id: 'trend-visits-down',
    when: () => {
      if (!hasPrev || !STATE.visitsData) return false;
      const now = STATE.visitsData.total_visits || 0;
      const prev = prevSnap.visits || 0;
      return prev > 0 && pctChange(now, prev) < -0.15;
    },
    text: () => {
      const now = STATE.visitsData.total_visits || 0;
      const prev = prevSnap.visits || 0;
      return `Visitas caíram <b>${fmt(Math.abs(pctChange(now, prev)) * 100, 1)}%</b> (${fmtInt(prev)} → ${fmtInt(now)}). Sinal de perda de exposição orgânica. Veja se algum anúncio top caiu de posição ou ganhou tag negativa.`;
    },
    cta: { label: 'Ver Auditoria de Tags', tool: 'tags' }
  });

  // Conversão Ads
  list.push({
    id: 'trend-cvr-ads-down',
    when: () => {
      if (!hasPrev) return false;
      const now = agg.avg_cvr || 0;
      // Recalcula CVR anterior se possível
      const prevCvr = Number(prevSnap.cvr) || 0;
      return prevCvr > 0 && (prevCvr - now) >= 0.5;
    },
    text: () => {
      const now = agg.avg_cvr || 0;
      const prevCvr = Number(prevSnap.cvr) || 0;
      return `Conversão de Ads caiu <b>${fmt(Math.abs(now - prevCvr), 2)}pp</b> (${fmt(prevCvr, 2)}% → ${fmt(now, 2)}%). Cliques sem virar venda = preço/ficha/foto não convencendo. Audite os anúncios com mais cliques.`;
    },
    cta: { label: 'Analisar Anúncio', tool: 'analyzer' }
  });

  // Primeira visita — informativo
  list.push({
    id: 'tip-no-prev',
    when: () => !hasPrev,
    text: `Esta é a primeira vez que coletamos seus dados. A partir do próximo acesso passamos a comparar — você vai ver a variação de cada métrica a cada visita.`
  });

  // Sem Ads ativos (independente)
  list.push({
    id: 'tip-no-ads',
    when: () => totals.itemsWithAds === 0 && totals.activeItems > 0,
    text: `Sua conta não está usando Product Ads no momento. O Planejador de Ads mostra histórico, ROAS, TACOS e quais campanhas vale auditar primeiro.`,
    cta: { label: 'Abrir Planejador de Ads', tool: 'planner' }
  });

  list.push({
    id: 'tip-buscador',
    when: () => true,
    text: `O <b>Buscador de Catálogos</b> ajuda a achar catálogos do Mercado Livre que estão recebendo vendas e nos quais você ainda não anuncia.`,
    cta: { label: 'Buscar Catálogos', tool: 'finder' }
  });

  list.push({
    id: 'tip-keyword',
    when: () => true,
    text: `O <b>Agente de Palavras-Chave</b> descobre em 30s as palavras que faltam na <b>ficha técnica</b> do seu anúncio — comparando com o que está sendo buscado no ML. Quanto mais palavras nos atributos, em mais buscas você aparece (sem mexer no título).`,
    cta: { label: 'Abrir Agente de Palavras-Chave', tool: 'keyword' }
  });

  list.push({
    id: 'tip-inpi',
    when: () => true,
    text: `Antes de criar uma marca, pesquise no <b>INPI</b>. Se já está registrada, vender no ML pode resultar em denúncia e suspensão — mesmo sem você saber.`,
    cta: { label: 'Buscar Marca no INPI', tool: 'inpi' }
  });

  list.push({
    id: 'tip-titulo-vendendo',
    when: () => true,
    text: `<b>Regra de ouro:</b> nunca mude o título de um anúncio que já vendeu nos últimos 30 dias. O ML vincula o histórico de busca ao título — alterar reseta a indexação.`
  });

  list.push({
    id: 'tip-experiencia',
    when: () => true,
    text: `A <b>Análise de Anúncio</b> mostra título, descrição, ficha técnica, tags do ML e tendência de visitas de qualquer item da sua conta. É o jeito mais rápido de entender por que um anúncio específico vende ou não.`,
    cta: { label: 'Análise de Anúncio', tool: 'analyzer' }
  });

  return list;
}

function pickInsight(ctx, sid) {
  const all = buildInsights(ctx).filter(i => i.when());
  const seen = rtGetSeenInsights(sid);
  const today = todayStr();
  // 1) prefere insights nunca vistos
  const fresh = all.filter(i => !seen[i.id]);
  if (fresh.length) return fresh[0];
  // 2) menos recentes primeiro
  all.sort((a, b) => (seen[a.id] || '0') < (seen[b.id] || '0') ? -1 : 1);
  return all[0] || null;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 5 — Build alerts
// ══════════════════════════════════════════════════════════════════════

function buildAlerts(agg, totals, prevSnap, sid) {
  const out = [];
  // Campanhas: todas pausadas
  const campaigns = STATE.campaigns || [];
  if (campaigns.length > 0) {
    const activeCamps = campaigns.filter(c => (c.status || '').toLowerCase() === 'active');
    if (activeCamps.length === 0) {
      out.push({
        id: `all-paused-${campaigns.length}`,
        level: 'crit',
        text: campaigns.length === 1 ? '🛑 Sua única campanha está pausada' : `🛑 Todas as suas ${campaigns.length} campanhas estão pausadas`,
        cta: { label: 'reativar', tool: 'planner' }
      });
    }
  }
  // Anúncios pausados em massa
  if (totals.pausedItems >= 3) {
    out.push({ id: `paused-${totals.pausedItems}`, level: 'warn', text: `${totals.pausedItems} anúncios pausados`, cta: { label: 'ver', tool: 'analyzer' } });
  }
  // ROAS abaixo de 1
  if ((agg.overall_roas || 0) < 1 && (agg.total_cost || 0) > 50) {
    out.push({ id: 'roas-sub-1', level: 'crit', text: `ROAS ${fmt(agg.overall_roas, 2)}x — perdendo dinheiro`, cta: { label: 'auditar', tool: 'planner' } });
  }
  // Gasto disparou (vs anterior)
  if (prevSnap && prevSnap.cost > 50 && (agg.total_cost || 0) > prevSnap.cost * 1.6) {
    const pct = Math.round(((agg.total_cost - prevSnap.cost) / prevSnap.cost) * 100);
    out.push({ id: `cost-spike-${todayStr()}`, level: 'warn', text: `Gasto +${pct}% vs visita anterior`, cta: { label: 'investigar', tool: 'planner' } });
  }
  // Conta sem ads
  if (totals.itemsWithAds === 0 && totals.activeItems > 0) {
    out.push({ id: 'no-ads', level: 'info', text: 'Nenhum anúncio com ads ativo', cta: { label: 'criar', tool: 'planner' } });
  }
  // Recorde batido
  const bestRoas = rtGetBest(sid, 'bestRoas');
  if (bestRoas && Math.abs(bestRoas.value - (agg.overall_roas || 0)) < 0.001 && bestRoas.date === todayStr()) {
    out.push({ id: `record-roas-${todayStr()}`, level: 'good', text: `🏆 Novo recorde: ROAS ${fmt(bestRoas.value, 2)}x` });
  }
  // Filtra dismisseds
  return out.filter(a => !rtIsAlertDismissed(sid, a.id));
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 6 — Build opportunities (top 5 priorizadas)
// ══════════════════════════════════════════════════════════════════════

function buildOpportunities(agg, totals, prevSnap, streak) {
  const ops = [];
  const target = (window._mfdTacosTarget || 15);

  // Campanhas todas pausadas (top priority)
  const campaigns = STATE.campaigns || [];
  if (campaigns.length > 0) {
    const activeCamps = campaigns.filter(c => (c.status || '').toLowerCase() === 'active');
    if (activeCamps.length === 0) {
      ops.push({
        ico: '▶️', tone: 'crit',
        title: campaigns.length === 1 ? 'Reativar sua campanha pausada' : `Reativar suas ${campaigns.length} campanhas pausadas`,
        meta: `Suas campanhas existem e têm orçamento configurado, mas estão paradas. Anúncio sem campanha ativa fica fora dos espaços de Product Ads — visibilidade despenca.`,
        score: 100, tool: 'planner'
      });
    }
  }

  // 1. Reativar anúncios pausados
  if (totals.pausedItems >= 1) {
    ops.push({
      ico: '⏸', tone: 'warn',
      title: `Reativar ${totals.pausedItems} ${totals.pausedItems === 1 ? 'anúncio pausado' : 'anúncios pausados'}`,
      meta: `Anúncio pausado some das buscas e não fatura — reative pra voltar a aparecer.`,
      score: 90, tool: 'analyzer'
    });
  }

  // 2. Subir budget se ROAS bom
  if ((agg.overall_roas || 0) >= 4 && (agg.total_cost || 0) > 50) {
    ops.push({
      ico: '🚀', tone: 'good',
      title: 'Escalar campanhas vencedoras',
      meta: `Seu ROAS de <b>${fmt(agg.overall_roas, 2)}x</b> está acima da média. Subir budget hoje multiplica receita.`,
      score: 85, tool: 'planner'
    });
  }

  // 3. Cortar ROAS < 1
  if ((agg.overall_roas || 0) < 1 && (agg.total_cost || 0) > 100) {
    ops.push({
      ico: '🛑', tone: 'crit',
      title: 'Auditar campanhas com prejuízo',
      meta: `ROAS abaixo de 1x — você está pagando para vender. Análise por anúncio identifica o culpado.`,
      score: 95, tool: 'planner'
    });
  }

  // 4. Sem ads na conta
  if (totals.itemsWithAds === 0 && totals.activeItems > 0) {
    ops.push({
      ico: '📣', tone: 'purple',
      title: 'Criar primeiro anúncio com Product Ads',
      meta: `Você tem <b>${totals.activeItems} ${totals.activeItems === 1 ? 'anúncio ativo' : 'anúncios ativos'}</b> sem ads. O alcance orgânico é limitado — ads multiplicam visitas em horas.`,
      score: 88, tool: 'planner'
    });
  }

  // 5. Falta concorrência mapeada
  ops.push({
    ico: '🔎', tone: 'default',
    title: 'Mapear concorrentes do seu top vendido',
    meta: `Concorrência de Catálogo mostra quem está abaixo de você e quem você precisa derrubar.`,
    score: 60, tool: 'catalog'
  });

  // 6. Streak fraco — gamificação
  if (streak.current < 2) {
    ops.push({
      ico: '🔥', tone: 'warn',
      title: 'Construir hábito de checagem diária',
      meta: `Quem acompanha os dados toda semana reage mais rápido a quedas e oportunidades. Comece o hábito hoje.`,
      score: 50, tool: null
    });
  }

  // 7. TACOS muito alto
  if ((agg.avg_tacos || 0) > target * 1.4) {
    ops.push({
      ico: '⚖️', tone: 'warn',
      title: `TACOS ${fmt(agg.avg_tacos, 1)}% acima da meta`,
      meta: `Sua meta é ${target}%. Reduzir TACOS sem perder volume = mais lucro líquido sem precisar vender mais.`,
      score: 70, tool: 'planner'
    });
  }

  // 8. Buscar palavras
  ops.push({
    ico: '🔑', tone: 'default',
    title: 'Atualizar palavras-chave do seu top produto',
    meta: `O Agente de Palavras-Chave gera sugestões reais em 30s baseadas no que está sendo buscado agora.`,
    score: 45, tool: 'keyword'
  });

  // 9. Buscador
  ops.push({
    ico: '💎', tone: 'purple',
    title: 'Descobrir produtos vendendo bem',
    meta: `Buscador de Catálogos cruza preço × demanda e mostra catálogos abertos que ainda não estão saturados.`,
    score: 50, tool: 'finder'
  });

  // 10. INPI
  ops.push({
    ico: '🏷', tone: 'default',
    title: 'Validar marca/produto no INPI',
    meta: `Antes de criar marca própria, confira se o nome está livre — denúncia no ML derruba conta em horas.`,
    score: 30, tool: 'inpi'
  });

  // Ordena por score desc e devolve top 5
  ops.sort((a, b) => b.score - a.score);
  return ops.slice(0, 5);
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 7 — Build top performers / atenção
// ══════════════════════════════════════════════════════════════════════
// Para o dashboard usamos o que dá pra extrair de /ads-aggregated:
// campanhas (campaigns array). Item-level vai entrar quando o usuário
// abrir uma seção "Itens" expandida (ou seguir pro Planejador).

function buildPerformers(agg, daily) {
  const top = [];
  const att = [];
  // Top: dias com maior receita ads (agregada — não temos itens aqui)
  if (Array.isArray(daily) && daily.length) {
    const sorted = [...daily].sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0));
    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      const d = sorted[i];
      top.push({
        title: 'Dia recorde',
        meta: d.date ? `${String(d.date).slice(8, 10)}/${String(d.date).slice(5, 7)}` : '—',
        value: fmtMoneyCompact(d.total_amount || 0),
        valueClass: 'pos',
        rank: ['gold','silver','bronze'][i]
      });
    }
    // Atenção: dias com gasto > receita
    const reds = daily
      .filter(d => (d.cost || 0) > 5 && (d.total_amount || 0) < (d.cost || 0))
      .sort((a, b) => (b.cost || 0) - (a.cost || 0))
      .slice(0, 3);
    reds.forEach(d => {
      att.push({
        title: 'Dia sem retorno',
        meta: d.date ? `${String(d.date).slice(8, 10)}/${String(d.date).slice(5, 7)}` : '—',
        value: `-${fmtMoneyCompact((d.cost||0)-(d.total_amount||0))}`,
        valueClass: 'neg',
        rank: 'atten'
      });
    });
  }
  return { top, att };
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 8 — Daily checklist (gerada dinamicamente)
// ══════════════════════════════════════════════════════════════════════

function buildChecklist(agg, totals, sid) {
  const stored = rtGetChecklist(sid);
  if (stored) return stored.items;

  const items = [];
  // 1. Sempre — abrir o app (já feito por estar aqui)
  items.push({ id: 'open',     text: 'Abrir o painel do dia', done: true, meta: 'feito ✓' });
  // 2. Item do meio depende do perfil: conta sem Ads não tem campanha pra auditar
  if (agg.organic_only || ((agg.total_cost || 0) === 0 && (agg.organic_revenue || 0) > 0))
    items.push({ id: 'campaigns', text: 'Rodar a Auditoria de Tags na conta', done: false, tool: 'tags' });
  else if ((agg.overall_roas || 0) < 2)
    items.push({ id: 'campaigns', text: 'Auditar campanhas com ROAS baixo', done: false, tool: 'planner' });
  else
    items.push({ id: 'campaigns', text: 'Revisar performance de uma campanha', done: false, tool: 'planner' });
  // 3. Sempre — uma exploração
  items.push({ id: 'explore',   text: 'Explorar uma feature nova hoje', done: false, tool: 'finder' });

  // Persiste só quando os dados de receita já chegaram: em conta sem Ads o
  // primeiro render vem com agg vazio e o item de campanha sairia errado pro dia todo
  if (Object.keys(agg).length) rtSetChecklist(sid, items);
  return items;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 9 — Render: HERO HEADER
// ══════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// SECTION 4.5 — Notifications (sininho + drawer)
// ══════════════════════════════════════════════════════════════════════

// IDs precisam ser únicos e estáveis. Quando atualizar a copy, incrementa o ID.
const NOTIFICATIONS = [
  {
    id: 'aviso-ml-2026-05',
    kind: 'alert',
    title: 'Estamos atualizando a integração com o Mercado Livre',
    body: 'Caso alguma função não esteja funcionando, vá em <b>Minha Conta</b>, remova a conta e adicione novamente.',
    date: '2026-05-08'
  },
  {
    id: 'novidade-planner-ads',
    kind: 'news',
    title: 'Planejador de Ads de cara nova',
    body: 'Implementamos um painel completo pra você acompanhar todas as suas métricas de Product Ads em um só lugar, de forma intuitiva e rápida.',
    date: '2026-04-20'
  },
  {
    id: 'novidade-analise-anuncios',
    kind: 'news',
    title: 'Análise de Anúncios mais completa',
    body: 'Expandimos os parâmetros de avaliação e otimizamos o sistema de pontuação. Em breve, novas funções vão tornar sua análise ainda mais estratégica.',
    date: '2026-04-15'
  }
];

const LS_READ_NOTIFS = 'mf_dash_read_notifications';

// Só exibe notificações recentes — aviso velho some sozinho (45 dias)
function activeNotifications() {
  return NOTIFICATIONS.filter(n => {
    const age = daysBetween(n.date, todayStr());
    return age >= 0 && age <= 45;
  });
}

function getReadNotifs() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_READ_NOTIFS) || '[]')); }
  catch { return new Set(); }
}
function setReadNotifs(set) {
  try { localStorage.setItem(LS_READ_NOTIFS, JSON.stringify([...set])); } catch {}
}
function unreadCount() {
  const read = getReadNotifs();
  return activeNotifications().filter(n => !read.has(n.id)).length;
}

function renderNotificationBell() {
  const unread = unreadCount();
  return `
    <button class="mfd-bell" data-mfd-action="open-notifs" aria-label="Notificações">
      🔔
      ${unread > 0 ? `<span class="mfd-bell-badge">${unread}</span>` : ''}
    </button>
  `;
}

function renderNotificationDrawer() {
  const read = getReadNotifs();
  const items = activeNotifications().map(n => {
    const isUnread = !read.has(n.id);
    const kindLabel = n.kind === 'alert' ? '⚠️ Aviso' : '🎉 Novidade';
    const kindClass = n.kind === 'alert' ? 'alert' : 'news';
    const dateLabel = (() => {
      try {
        const d = new Date(n.date + 'T12:00:00');
        const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
        return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
      } catch { return n.date; }
    })();
    return `
      <div class="mfd-notif-item ${kindClass} ${isUnread ? 'unread' : ''}">
        <div class="mfd-notif-header">
          <span class="mfd-notif-kind">${kindLabel}</span>
          <span class="mfd-notif-date">${dateLabel}</span>
        </div>
        <div class="mfd-notif-title">${escapeHtml(n.title)}</div>
        <div class="mfd-notif-body">${n.body}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="mfd-drawer-backdrop" data-mfd-action="close-notifs"></div>
    <aside class="mfd-drawer" role="dialog" aria-label="Notificações">
      <div class="mfd-drawer-header">
        <h2>Notificações</h2>
        <div>
          <button class="mfd-drawer-action" data-mfd-action="mark-all-read">Marcar todas lidas</button>
          <button class="mfd-drawer-close" data-mfd-action="close-notifs" aria-label="Fechar">✕</button>
        </div>
      </div>
      <div class="mfd-drawer-body">
        ${items || '<div class="mfd-empty">Sem notificações no momento.</div>'}
      </div>
    </aside>
  `;
}

function wireNotifications(root) {
  const dashRoot = root || document.getElementById(STATE.containerId);
  // O container persiste entre renders (só o innerHTML troca) — registra UMA vez
  if (!dashRoot || dashRoot.dataset.mfdNotifWired === '1') return;
  dashRoot.dataset.mfdNotifWired = '1';
  dashRoot.addEventListener('click', (e) => {
    const target = e.target.closest('[data-mfd-action]');
    if (!target) return;
    const action = target.dataset.mfdAction;
    if (action === 'open-notifs') {
      e.preventDefault();
      // Marca como aberto (não como lido ainda — só quando fecha)
      dashRoot.classList.add('mfd-drawer-open');
    } else if (action === 'close-notifs') {
      e.preventDefault();
      // Marca todas como lidas ao fechar
      const read = getReadNotifs();
      NOTIFICATIONS.forEach(n => read.add(n.id));
      setReadNotifs(read);
      dashRoot.classList.remove('mfd-drawer-open');
      // Atualiza badge
      const bell = dashRoot.querySelector('.mfd-bell');
      if (bell) {
        const badge = bell.querySelector('.mfd-bell-badge');
        if (badge) badge.remove();
      }
    } else if (action === 'mark-all-read') {
      e.preventDefault();
      const read = getReadNotifs();
      NOTIFICATIONS.forEach(n => read.add(n.id));
      setReadNotifs(read);
      // Re-render drawer body
      dashRoot.querySelectorAll('.mfd-notif-item.unread').forEach(el => el.classList.remove('unread'));
      const badge = dashRoot.querySelector('.mfd-bell-badge');
      if (badge) badge.remove();
    } else if (action === 'toggle-pills') {
      e.preventDefault();
      const pills = target.closest('.mfd-issue-others')?.querySelector('.mfd-issue-others-pills');
      if (pills) {
        const collapsed = pills.classList.toggle('collapsed');
        target.textContent = collapsed ? (target.dataset.more || 'ver todos') : 'mostrar menos';
      }
    }
  });
}

function renderHero(seller, agg, totals, streak, history) {
  // Só o primeiro nome na saudação. first_name do ML pode vir com nome completo
  // OU poluído com números (telefone/documento digitado no campo de nome, ex.
  // "39 873 819 mariana") — pega o primeiro token que contenha letra.
  const fullName = (seller && (seller.first_name || seller.nickname)) || '';
  let name = String(fullName).trim().split(/\s+/).filter(t => /\p{L}/u.test(t))[0] || '';
  if (!name && seller && seller.nickname) {
    name = String(seller.nickname).trim().split(/\s+/)[0] || '';
  }
  if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
  const tier = (seller && seller.seller_reputation && seller.seller_reputation.power_seller_status) || null;
  const tierMap = {
    'platinum': { label: '👑 Platinum', cls: 'platinum' },
    'gold':     { label: '🏆 Gold',     cls: '' },
    'silver':   { label: '🥈 Silver',   cls: 'silver' },
    'bronze':   { label: '🥉 Bronze',   cls: 'bronze' }
  };
  const tierBadge = tier && tierMap[tier] ? tierMap[tier] : { label: 'Loja Mercado Livre', cls: 'muted' };

  // Pulse status
  let pulseClass = 'mfd-hero-pulse';
  if ((agg.overall_roas || 0) < 1 && (agg.total_cost || 0) > 100) pulseClass += ' err';
  else if (((agg.total_cost || 0) > 0 && (agg.overall_roas || 0) < 2) || totals.pausedItems >= 3) pulseClass += ' warn';

  // Atividade dos últimos 30 dias
  const last30 = history.filter(h => daysBetween(h.date, todayStr()) < 30);
  const activeDays30 = new Set(last30.map(h => h.date)).size;

  const pills = [];
  if (streak.current >= 2) {
    pills.push(`<span class="mfd-hero-pill streak"><span class="flame">🔥</span> ${streak.current} dia${streak.current>1?'s':''} seguidos</span>`);
  } else if (streak.current === 1) {
    pills.push(`<span class="mfd-hero-pill"><span class="flame">🔥</span> Streak começando hoje</span>`);
  }
  if (streak.best > Math.max(streak.current, 6)) {
    pills.push(`<span class="mfd-hero-pill record">🏆 Recorde: ${streak.best} dias</span>`);
  }
  if (activeDays30 >= 7) {
    pills.push(`<span class="mfd-hero-pill">📅 ${activeDays30}/30 dias ativos</span>`);
  }

  // Métricas-chave em destaque no hero
  const totalRev = (Number(agg.total_revenue) || 0) + (Number(agg.organic_revenue) || 0);
  const totalOrders = (Number(agg.total_orders) || 0) + (Number(agg.organic_orders) || 0);
  const adsRoas = (Number(agg.total_revenue) || 0) > 0 && (Number(agg.total_cost) || 0) > 0
    ? Number(agg.total_revenue) / Number(agg.total_cost) : 0;
  const heroTacos = totalRev > 0 ? ((Number(agg.total_cost) || 0) / totalRev * 100) : 0;
  // TACOS no hero só quando há receita ATRIBUÍDA a Ads: com gasto e zero conversão,
  // um TACOS baixinho parece saúde quando na verdade é custo sem retorno
  const showHeroTacos = heroTacos > 0 && (Number(agg.total_revenue) || 0) > 0;
  const heroAdsSpendNoReturn = (Number(agg.total_cost) || 0) > 0 && (Number(agg.total_revenue) || 0) === 0;
  const hasData = totalRev > 0 || totalOrders > 0;
  // Receita por pedidos com paginação no cap (conta orgânica gigante): valor é piso, não total
  const revSuffix = agg.revenue_complete === false ? '+' : '';

  const html = `
    <div class="mfd-hero">
      <div class="mfd-hero-top">
        <div class="mfd-hero-greeting">
          <span class="${pulseClass}"></span>
          ${escapeHtml(saudacao())}${name ? ', ' + escapeHtml(name) : ' 👋'}
        </div>
        ${renderNotificationBell()}
      </div>
      <h1 class="mfd-hero-title">Sua conta está <b>${pulseStatus(agg, totals)}</b> hoje</h1>
      ${hasData ? `
        <div class="mfd-hero-stats">
          <div class="mfd-hero-stat">
            <span class="mfd-hero-stat-label">faturamento</span>
            <span class="mfd-hero-stat-value">${fmtMoneyCompact(totalRev)}${revSuffix}</span>
          </div>
          <div class="mfd-hero-stat">
            <span class="mfd-hero-stat-label">vendas</span>
            <span class="mfd-hero-stat-value">${fmtInt(totalOrders)}${revSuffix}</span>
          </div>
          ${adsRoas > 0 ? `
          <div class="mfd-hero-stat">
            <span class="mfd-hero-stat-label">ROAS ads</span>
            <span class="mfd-hero-stat-value">${fmt(adsRoas, 1)}x</span>
          </div>
          ` : ''}
          ${showHeroTacos ? `
          <div class="mfd-hero-stat">
            <span class="mfd-hero-stat-label">TACOS</span>
            <span class="mfd-hero-stat-value">${fmt(heroTacos, 1)}%</span>
          </div>
          ` : ''}
          ${heroAdsSpendNoReturn ? `
          <div class="mfd-hero-stat">
            <span class="mfd-hero-stat-label">investido em Ads</span>
            <span class="mfd-hero-stat-value">${fmtMoneyCompact(Number(agg.total_cost) || 0)}</span>
          </div>
          ` : ''}
        </div>
      ` : `<p class="mfd-hero-subline">${escapeHtml(buildHeroSub(agg, totals, streak, seller))}</p>`}
      ${pills.length ? `<div class="mfd-hero-pills">${pills.join('')}</div>` : ''}
    </div>
  `;
  return html;
}

function patchHealthCard() {
  const root = document.getElementById(STATE.containerId);
  if (!root || !STATE.data) return;
  const agg = STATE.data.aggregated || {};
  const totals = STATE.data.totals || {};
  const sid = STATE.sellerId;
  const streak = sid ? rtGetStreak(sid) : { current: 0, best: 0 };
  const breakdown = computeHealthBreakdown(agg, totals, STATE.prevSnapshot, streak);
  // Guarda o score no snapshot de hoje (alimenta o banner "Desde sua última visita")
  if (STATE._currentSnap && sid && STATE._currentSnap.health !== breakdown.total) {
    STATE._currentSnap.health = breakdown.total;
    rtSaveSnapshot(sid, STATE.period, STATE._currentSnap);
  }
  // Acha o health card pela classe (título mudou de capitalização no passado e
  // quebrou o match por texto — classe é estável) e re-renderiza
  const card = root.querySelector('.mfd-health-card');
  if (!card) return;
  const next = document.createElement('div');
  next.innerHTML = renderHealthCard(breakdown.total, breakdown);
  const fresh = next.querySelector('.mfd-card');
  if (fresh) card.replaceWith(fresh);
}

// Helper: gera label com tooltip ⓘ pra explicar o que mede
function kpiLabel(text, hint) {
  if (!hint) return escapeHtml(text);
  return `${escapeHtml(text)} <span class="mfd-tip" data-tip="${escapeHtml(hint)}" tabindex="0" role="button" aria-label="${escapeHtml(hint)}">ⓘ</span>`;
}

// Helper: célula uniforme de KPI no card Visão Geral.
// Sempre 3 zonas: label (1 linha), value (1 linha grande), footer (delta + sub opcional).
function kpiCell({ label, hint, value, valueTitle, valueClass = '', delta = '', sub = '' }) {
  return `
    <div class="mfd-vs-kpi">
      <div class="mfd-vs-kpi-label">${kpiLabel(label, hint)}</div>
      <div class="mfd-vs-kpi-value ${valueClass}"${valueTitle ? ` title="${escapeHtml(valueTitle)}"` : ''}>${value}</div>
      <div class="mfd-vs-kpi-footer">${delta || '<span class="mfd-vs-kpi-sub-spacer"></span>'}${sub ? `<span class="mfd-vs-kpi-sub">${sub}</span>` : ''}</div>
    </div>
  `;
}

// Helper: badge de tendência (variação vs período anterior)
// opts.inverted: true se menor = melhor (ex: TACOS, custo). Default false.
// opts.absolute: true se delta deve ser mostrado como diferença absoluta (ROAS, CTR), não %.
function deltaBadge(now, prev, opts = {}) {
  if (prev == null || isNaN(prev) || prev === 0) {
    return `<span class="mfd-delta neutral" title="Sem dado anterior pra comparar">—</span>`;
  }
  const delta = opts.absolute ? (now - prev) : ((now - prev) / Math.abs(prev) * 100);
  const inv = !!opts.inverted;
  let tone;
  if (Math.abs(delta) < (opts.absolute ? 0.05 : 0.5)) tone = 'flat';
  else if ((delta > 0) === !inv) tone = 'pos';
  else tone = 'neg';
  // Seta segue a DIREÇÃO do movimento; a cor (tone) diz se é bom ou ruim.
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '•';
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  const txt = opts.absolute
    ? sign + fmt(Math.abs(delta), 2) + (opts.suffix || '')
    : sign + fmt(Math.abs(delta), 1) + '%';
  return `<span class="mfd-delta ${tone}" title="${opts.absolute ? `${fmt(prev, 2)} → ${fmt(now, 2)}` : `${fmt(prev, 1)} → ${fmt(now, 1)}`}">${arrow} ${txt}</span>`;
}

function patchOrganicVsCard() {
  const root = document.getElementById(STATE.containerId);
  if (!root) return;
  const card = root.querySelector('.mfd-vs-card');
  if (!card) return;
  const agg = STATE.data?.aggregated || {};
  const next = document.createElement('div');
  next.innerHTML = renderOrganicVsAds(agg);
  const fresh = next.querySelector('.mfd-vs-card');
  if (fresh) card.replaceWith(fresh);
}

function renderOrganicVsAds(agg) {
  const adsRev   = Number(agg.total_revenue) || 0;
  const orgRev   = Number(agg.organic_revenue) || 0;
  const totalRev = adsRev + orgRev;
  const adsOrders = Number(agg.total_orders) || 0;
  const orgOrders = Number(agg.organic_orders) || 0;
  const totalOrders = adsOrders + orgOrders;
  const adsTicket = adsOrders > 0 ? adsRev / adsOrders : 0;
  const orgTicket = orgOrders > 0 ? orgRev / orgOrders : 0;
  const totalTicket = totalOrders > 0 ? totalRev / totalOrders : 0;

  const adsCvr = Number(agg.avg_cvr) || 0;
  const adsClicks = Number(agg.total_clicks) || 0;
  const adsCost = Number(agg.total_cost) || 0;
  const adsRoas = adsRev > 0 && adsCost > 0 ? adsRev / adsCost : 0;
  const tacos = totalRev > 0 ? (adsCost / totalRev * 100) : 0;

  // Deltas vs período anterior
  const prev = STATE.prevSnapshot || {};
  const prevAdsRev    = Number(prev.revenue) || 0;
  const prevOrgRev    = Number(prev.organic_revenue) || 0;
  const prevTotalRev  = prevAdsRev + prevOrgRev;
  const prevSales     = Number(prev.sales) || 0;
  const prevAdsOrders = Number(prev.ads_orders) || 0;
  const prevOrgOrders = Number(prev.organic_orders) || 0;
  const prevCost      = Number(prev.cost) || 0;
  const prevRoas      = Number(prev.roas) || 0;
  const prevTacos     = Number(prev.tacos) || 0;
  const prevClicks    = Number(prev.clicks) || 0;
  const prevImpressions = Number(prev.impressions) || 0;
  const prevCtr  = prevImpressions > 0 ? (prevClicks / prevImpressions * 100) : 0;
  const prevCvr  = Number(prev.cvr) || 0;
  const prevAdsTicket = prevAdsOrders > 0 ? prevAdsRev / prevAdsOrders : 0;
  const prevOrgTicket = prevOrgOrders > 0 ? prevOrgRev / prevOrgOrders : 0;
  const prevTotalTicket = prevSales > 0 ? prevTotalRev / prevSales : 0;
  const prevOrgConv = Number(prev.organic_conversion) || 0;
  const prevVisits = Number(prev.visits) || 0;
  const prevOverallConv = prevVisits > 0 ? (prevSales / prevVisits * 100) : 0;

  // Conversão via visitas (se disponível)
  const visits = STATE.visitsData;
  let orgConvText = '—';
  let overallConvText = '—';
  let orgConvNow = 0;
  let overallConvNow = 0;
  let visitsHint = '';
  let overallConvDelta = '';
  let overallConvHint = '% das visitas que viraram venda. Vendas totais ÷ visitas totais. Precisa de dados de visita.';
  let orgConvHint = 'Vendas orgânicas ÷ visitas orgânicas (visitas totais − cliques de Ads). Mede se o anúncio vende quando o cliente cai nele sem impulso.';
  if (STATE.visitsLoading) {
    visitsHint = 'Calculando...';
  } else if (visits && visits.total_visits > 0) {
    const totalVisits = visits.total_visits;
    if (visits.capped || visits.incomplete) {
      // Visitas cobrem só parte dos anúncios: dividir as vendas da conta INTEIRA
      // por visitas parciais infla a conversão (ex.: 61% impossível). Não mostra.
      visitsHint = visits.capped
        ? `${fmtInt(totalVisits)} visitas nos ${fmtInt(visits.sampled_items)} primeiros anúncios (de ${fmtInt(visits.total_items_account)}) — conversão indisponível em contas com 1.000+ anúncios`
        : `${fmtInt(totalVisits)} visitas (coleta parcial agora) — atualize a página pra calcular a conversão`;
    } else {
      const orgVisits = totalVisits - adsClicks;
      // Numerador da conversão total: PEDIDOS (vendas brutas) quando disponível —
      // mesma métrica do card "Conversão de visitas" do Seller Central. Unidades
      // (1 pedido pode ter N) inflavam o número vs o painel do ML (10,4% vs 14,9%).
      const grossOrders = (STATE.ordersData && typeof STATE.ordersData.total_orders === 'number')
        ? STATE.ordersData.total_orders : null;
      const totalConvCalc = (grossOrders != null ? grossOrders : totalOrders) / totalVisits * 100;
      // Orgânico = total − Ads, na MESMA base da conversão total: as três conversões
      // precisam fechar entre si pro usuário (orgânico ≤/≥ total ≤/≥ Ads, média
      // ponderada bate) — base mista (pedidos no total, unidades no orgânico)
      // deixava orgânico "maior" que o total e parecia bug.
      const orgSalesConv = grossOrders != null ? Math.max(0, grossOrders - adsOrders) : orgOrders;
      const orgConvCalc = orgVisits > 0 ? (orgSalesConv / orgVisits * 100) : Infinity;
      if (orgVisits <= 0 || totalConvCalc > 100 || orgConvCalc > 100) {
        // Visitas reportadas não cobrem nem os cliques de Ads (anúncio de catálogo
        // conta a visita na página do catálogo, não no item) — qualquer conversão
        // calculada daqui sairia inflada/absurda. Melhor não mostrar.
        visitsHint = `${fmtInt(totalVisits)} visitas registradas pra ${fmtInt(adsClicks)} cliques de Ads — visitas de catálogo não contam no anúncio; conversão indisponível`;
      } else {
        overallConvNow = totalConvCalc;
        overallConvText = fmtPct(overallConvNow, 2);
        orgConvNow = orgConvCalc;
        orgConvText = fmtPct(orgConvNow, 2);
        visitsHint = visits.accountWide
          ? `${fmtInt(totalVisits)} visitas na conta inteira no período`
          : `${fmtInt(totalVisits)} visitas em ${fmtInt(visits.sampled_items)} ${visits.sampled_items === 1 ? 'anúncio ativo' : 'anúncios ativos'}`;

        // Delta só compara bases iguais: pedidos vs pedidos (snapshot.orders) ou
        // unidades vs unidades (fallback antigo) — nunca mistura
        const prevOrders = Number(prev.orders) || 0;
        const prevConvSameBase = (grossOrders != null)
          ? ((prevOrders > 0 && prevVisits > 0) ? (prevOrders / prevVisits * 100) : 0)
          : prevOverallConv;
        overallConvDelta = prevConvSameBase ? deltaBadge(overallConvNow, prevConvSameBase, { absolute: true, suffix: 'pp' }) : '';
        if (grossOrders != null) {
          overallConvHint = '% das visitas que viraram pedido. Pedidos ÷ visitas totais — mesmo número do card "Conversão de visitas" do Seller Central (lá são visitas únicas; pode variar um pouco).';
          orgConvHint = 'Pedidos orgânicos (pedidos totais − vendas por Ads) ÷ visitas orgânicas (visitas totais − cliques de Ads). Mede se o anúncio vende quando o cliente cai nele sem impulso.';
        }
      }
    }
  }

  const pctOf = (a, b) => b > 0 ? +(a / b * 100).toFixed(1) : 0;
  const orgRevPct = pctOf(orgRev, totalRev);
  const adsRevPct = pctOf(adsRev, totalRev);
  const orgOrdPct = pctOf(orgOrders, totalOrders);
  const adsOrdPct = pctOf(adsOrders, totalOrders);

  // Insight contextual
  let lede = '';
  if (totalRev === 0) {
    lede = 'Sem vendas no período — quando começarem, mostro tudo aqui.';
  } else if (adsRevPct >= 70) {
    lede = `<b>${fmt(adsRevPct, 1)}%</b> da receita vem de Ads. Você depende dele — qualquer pausa derruba o faturamento.`;
  } else if (orgRevPct >= 70) {
    lede = `<b>${fmt(orgRevPct, 1)}%</b> é orgânico. Ads tem espaço pra alavancar receita.`;
  } else {
    lede = `Receita balanceada: <b>${fmt(orgRevPct, 1)}%</b> orgânico + <b>${fmt(adsRevPct, 1)}%</b> Ads.`;
  }

  const spinnerHTML = STATE.visitsLoading ? ' <span class="mfd-vs-spinner"></span>' : '';

  return `
    <div class="mfd-card mfd-vs-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">📊</span>Visão geral do período</div>
        ${visitsHint ? `<small style="font-size:.72rem;color:var(--text-muted);">${escapeHtml(visitsHint)}</small>` : ''}
      </div>
      <div class="mfd-vs-lede">${lede}</div>
      <div class="mfd-vs-grid mfd-vs-grid-3">
        <div class="mfd-vs-col mfd-vs-total">
          <div class="mfd-vs-col-header"><span class="mfd-vs-icon">📊</span><b>Total</b></div>
          <div class="mfd-vs-metric">
            <span class="mfd-vs-label">${kpiLabel('Receita', 'Soma do que entrou via Ads e via orgânico no período.')}</span>
            <span class="mfd-vs-value" title="${fmtMoney(totalRev)}">${fmtMoneyCompact(totalRev)}</span>
            <div class="mfd-vs-bar"><div class="mfd-vs-bar-fill total" style="width:100%"></div></div>
            <div class="mfd-vs-pct-row"><span class="mfd-vs-pct">100%</span>${deltaBadge(totalRev, prevTotalRev)}</div>
          </div>
          <div class="mfd-vs-kpi-row">
            ${kpiCell({ label: 'Vendas', hint: 'Total de unidades vendidas no período (Ads + orgânico).', value: fmtCompact(totalOrders), delta: deltaBadge(totalOrders, prevSales) })}
            ${kpiCell({ label: 'Ticket', hint: 'Valor médio por venda. Receita total ÷ vendas totais.', value: fmtMoneyCompact(totalTicket), valueTitle: fmtMoney(totalTicket), delta: deltaBadge(totalTicket, prevTotalTicket) })}
            ${kpiCell({ label: 'Conversão', hint: overallConvHint, value: `${overallConvText}${spinnerHTML}`, delta: overallConvDelta })}
            ${kpiCell({ label: 'Custo Ads', hint: 'Quanto você gastou em Ads no período (cliques × CPC médio).', value: fmtMoneyCompact(adsCost), valueTitle: fmtMoney(adsCost), delta: deltaBadge(adsCost, prevCost, { inverted: true }) })}
          </div>
        </div>
        <div class="mfd-vs-col mfd-vs-organic">
          <div class="mfd-vs-col-header"><span class="mfd-vs-icon">🌱</span><b>Orgânico</b></div>
          <div class="mfd-vs-metric">
            <span class="mfd-vs-label">${kpiLabel('Receita', 'Receita das vendas que aconteceram SEM impulsionamento de Ads — vieram de busca natural, listagem, catálogo.')}</span>
            <span class="mfd-vs-value" title="${fmtMoney(orgRev)}">${fmtMoneyCompact(orgRev)}</span>
            <div class="mfd-vs-bar"><div class="mfd-vs-bar-fill organic" style="width:${orgRevPct}%"></div></div>
            <div class="mfd-vs-pct-row"><span class="mfd-vs-pct">${fmt(orgRevPct, 1)}% do total</span>${deltaBadge(orgRev, prevOrgRev)}</div>
          </div>
          <div class="mfd-vs-kpi-row">
            ${kpiCell({ label: 'Vendas', hint: 'Unidades vendidas sem Ads no período.', value: fmtCompact(orgOrders), delta: deltaBadge(orgOrders, prevOrgOrders), sub: `${fmt(orgOrdPct, 1)}% do total` })}
            ${kpiCell({ label: 'Ticket', hint: 'Valor médio por venda orgânica. Receita orgânica ÷ vendas orgânicas.', value: fmtMoneyCompact(orgTicket), valueTitle: fmtMoney(orgTicket), delta: deltaBadge(orgTicket, prevOrgTicket) })}
            ${kpiCell({ label: 'Conversão', hint: orgConvHint, value: `${orgConvText}${spinnerHTML}`, delta: (orgConvNow && prevOrgConv) ? deltaBadge(orgConvNow, prevOrgConv, { absolute: true, suffix: 'pp' }) : '' })}
          </div>
        </div>
        <div class="mfd-vs-col mfd-vs-ads">
          <div class="mfd-vs-col-header"><span class="mfd-vs-icon">🎯</span><b>Ads</b></div>
          ${agg.organic_only && adsRev === 0 && adsCost === 0 ? `
          <div class="mfd-empty" style="margin-top:10px;">Você ainda não usa Product Ads — sua receita é 100% orgânica. Campanhas aceleram produtos que já vendem sozinhos.</div>
          ` : `
          <div class="mfd-vs-metric">
            <span class="mfd-vs-label">${kpiLabel('Receita', 'Receita das vendas que vieram de Ads — Mercado Livre marca a venda como impulsionada quando o cliente clicou no anúncio pago.')}</span>
            <span class="mfd-vs-value" title="${fmtMoney(adsRev)}">${fmtMoneyCompact(adsRev)}</span>
            <div class="mfd-vs-bar"><div class="mfd-vs-bar-fill ads" style="width:${adsRevPct}%"></div></div>
            <div class="mfd-vs-pct-row"><span class="mfd-vs-pct">${fmt(adsRevPct, 1)}% do total</span>${deltaBadge(adsRev, prevAdsRev)}</div>
          </div>
          <div class="mfd-vs-kpi-row mfd-vs-kpi-row-ads">
            ${kpiCell({ label: 'Vendas', hint: 'Unidades vendidas via Ads.', value: fmtCompact(adsOrders), delta: deltaBadge(adsOrders, prevAdsOrders), sub: `${fmt(adsOrdPct, 1)}% do total` })}
            ${kpiCell({ label: 'Ticket', hint: 'Valor médio por venda via Ads.', value: fmtMoneyCompact(adsTicket), valueTitle: fmtMoney(adsTicket), delta: deltaBadge(adsTicket, prevAdsTicket) })}
            ${kpiCell({ label: 'Conversão', hint: 'Cliques que viraram venda. Vendas Ads ÷ cliques Ads.', value: fmtPct(adsCvr, 2), delta: deltaBadge(adsCvr, prevCvr, { absolute: true, suffix: 'pp' }) })}
            ${kpiCell({ label: 'CTR', hint: 'Click-through rate: % das pessoas que viram o anúncio e clicaram. Cliques ÷ impressões.', value: fmtPct(Number(agg.avg_ctr) || 0, 2), delta: deltaBadge(Number(agg.avg_ctr) || 0, prevCtr, { absolute: true, suffix: 'pp' }) })}
            ${kpiCell({ label: 'ROAS', hint: 'Return on Ad Spend: pra cada R$ 1 gasto em Ads, quanto retornou em receita. Receita Ads ÷ Custo Ads.', value: `${fmt(adsRoas, 2)}x`, delta: deltaBadge(adsRoas, prevRoas, { absolute: true, suffix: 'x' }) })}
            ${kpiCell({ label: 'TACOS', hint: 'Total Advertising Cost of Sales: % do faturamento total (Ads + orgânico) que vai pra Ads. Custo Ads ÷ Receita total.', value: fmtPct(tacos, 2), delta: deltaBadge(tacos, prevTacos, { absolute: true, suffix: 'pp', inverted: true }) })}
          </div>
          `}
        </div>
      </div>
    </div>
  `;
}

function pulseStatus(agg, totals) {
  if ((agg.overall_roas || 0) < 1 && (agg.total_cost || 0) > 100) return 'pedindo atenção';
  if (totals.pausedItems >= 3) return 'precisando de revisão';
  if ((agg.overall_roas || 0) >= 4) return 'voando';
  if ((agg.total_revenue || 0) + (agg.organic_revenue || 0) > 0) return 'em movimento';
  return 'aguardando dados';
}

function buildHeroSub(agg, totals, streak, seller) {
  const totalRev = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
  const sales = (agg.total_orders || 0) + (agg.organic_orders || 0);
  const rep = seller?.seller_reputation || {};
  const repLabel = friendlyLevelLabel(rep.level_id).short;
  const tier = rep.power_seller_status;
  const tierTxt = tier ? `MercadoLíder ${tier.charAt(0).toUpperCase()+tier.slice(1)}` : null;

  if (totalRev === 0 && totals.activeItems === 0) {
    if (repLabel) return `Você é ${repLabel} no Mercado Livre — falta só ativar seus primeiros anúncios pra começarmos a medir resultados.`;
    return 'Sem dados de receita ainda. Crie um anúncio ou conecte sua conta para começarmos.';
  }
  if (totalRev === 0) {
    const prefix = tierTxt ? `${tierTxt} com ` : 'Você tem ';
    const itensTxt = `${totals.activeItems} ${totals.activeItems === 1 ? 'anúncio ativo' : 'anúncios ativos'}`;
    // A medição por pedidos pode estar carregando — não afirmar "zero vendas" ainda
    if (STATE.ordersLoading) return `${prefix}${itensTxt}. Medindo suas vendas do período...`;
    // agg sem nenhuma chave = ML não devolveu dados de Ads (conta sem campanha)
    // e a medição por pedidos falhou — sem fonte, não dá pra afirmar nada
    if (!Object.keys(agg).length) {
      return `${prefix}${itensTxt}. Não consegui medir suas vendas do período agora — recarregue pra tentar de novo.`;
    }
    return `${prefix}${itensTxt} e zero vendas no período. Bora investigar o que está prendendo as vendas.`;
  }
  const tierPrefix = tierTxt ? `${tierTxt} · ` : '';
  // Sem investimento em Ads no período, ROAS não se aplica
  if ((agg.total_cost || 0) === 0) {
    const aboutRev = agg.revenue_complete === false ? 'mais de ' : '';
    return `${tierPrefix}${aboutRev}${fmtMoneyCompact(totalRev)} faturados, ${fmtInt(sales)} unidades vendidas — 100% orgânico, sem investir em Ads.`;
  }
  // Investiu em Ads mas nenhuma venda foi atribuída a Ads: ROAS 0x não informa nada
  if ((agg.total_revenue || 0) === 0) {
    const aboutRev = agg.revenue_complete === false ? 'mais de ' : '';
    return `${tierPrefix}${aboutRev}${fmtMoneyCompact(totalRev)} faturados, ${fmtInt(sales)} unidades vendidas — 100% orgânico (Ads ainda sem vendas atribuídas no período).`;
  }
  return `${tierPrefix}${fmtMoneyCompact(totalRev)} faturados, ${fmtInt(sales)} unidades vendidas, ROAS ${fmt(agg.overall_roas || 0, 2)}x.`;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 10 — Render: PERIOD PICKER
// ══════════════════════════════════════════════════════════════════════

function renderPeriodBar() {
  const periods = [7, 30, 60, 90];
  const updated = STATE.data && STATE.data.fetchedAt ? new Date(STATE.data.fetchedAt) : null;
  const updatedText = updated
    ? `${String(updated.getHours()).padStart(2,'0')}:${String(updated.getMinutes()).padStart(2,'0')}`
    : '—';
  return `
    <div class="mfd-period-bar">
      <div class="mfd-period-tabs" id="mfd-period-tabs">
        ${periods.map(p => `<button class="mfd-period-tab ${STATE.period === p ? 'active' : ''}" data-period="${p}">${p}d</button>`).join('')}
      </div>
      <div class="mfd-period-meta">
        <span>atualizado ${updatedText}</span>
        <button class="mfd-period-refresh" id="mfd-refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>
          Atualizar
        </button>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 11 — Render: ALERTS
// ══════════════════════════════════════════════════════════════════════

function renderAlerts(alerts) {
  if (!alerts.length) return '<div class="mfd-alerts"></div>';
  return `
    <div class="mfd-alerts">
      ${alerts.map(a => `
        <div class="mfd-alert ${a.level}" data-alert-id="${escapeHtml(a.id)}" ${a.cta ? `data-tool="${escapeHtml(a.cta.tool)}"` : ''}>
          ${escapeHtml(a.text)}
          ${a.cta ? `<small style="opacity:.65;margin-left:4px;">→ ${escapeHtml(a.cta.label)}</small>` : ''}
          <button class="mfd-alert-x" data-dismiss-alert="${escapeHtml(a.id)}" title="Dispensar">×</button>
        </div>
      `).join('')}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 12 — Render: KPI BAR
// ══════════════════════════════════════════════════════════════════════

// Linha secundária de KPIs — métricas operacionais já no payload /ads-aggregated
function renderSecondaryKpis(agg) {
  const totalRev = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
  const sales = (agg.total_orders || 0) + (agg.organic_orders || 0);
  const ticket = sales > 0 ? totalRev / sales : 0;
  const ctr = agg.avg_ctr || 0;
  const cvr = agg.avg_cvr || 0;
  const cpc = agg.avg_cpc || 0;
  const adsPct = agg.ads_sales_pct || 0;

  // Tone helpers (thresholds genéricos honestos pra ML)
  const ctrTone   = ctr === 0 ? '' : ctr < 0.5 ? 'crit' : ctr < 1 ? 'warn' : ctr >= 2 ? 'good' : '';
  const ctrLabel  = ctr === 0 ? null : ctr < 0.5 ? 'baixo' : ctr < 1 ? 'normal' : ctr >= 2 ? 'bom' : 'normal';
  const cvrTone   = cvr === 0 ? '' : cvr < 1 ? 'crit' : cvr < 3 ? 'warn' : 'good';
  const cvrLabel  = cvr === 0 ? null : cvr < 1 ? 'baixo' : cvr < 3 ? 'normal' : 'bom';
  const adsTone   = adsPct === 0 ? '' : adsPct < 20 ? 'warn' : adsPct < 65 ? 'good' : 'warn';
  const adsLabel  = adsPct === 0 ? null : adsPct < 20 ? 'subutilizado' : adsPct < 65 ? 'saudável' : 'alta dependência';

  const kpis = [
    {
      label: 'Ticket médio', ico: '🧾',
      value: ticket > 0 ? fmtMoneyCompact(ticket) : '—',
      help: 'Quanto, em média, vale cada venda. Total faturado dividido pelo número de vendas.'
    },
    {
      label: 'Conversão (CVR)', ico: '🎯',
      value: cvr > 0 ? fmtPct(cvr, 2) : '—',
      help: 'Taxa de conversão de Product Ads — % dos cliques que viram venda. O nível bom varia por categoria e faixa de preço.',
      tone: cvrTone, deltaText: cvrLabel, isHealth: true
    },
    {
      label: 'CTR', ico: '👁️',
      value: ctr > 0 ? fmtPct(ctr, 2) : '—',
      help: 'Click-through rate dos seus ads — % das pessoas que viram seu anúncio e clicaram. Mede atratividade do título e da imagem.',
      tone: ctrTone, deltaText: ctrLabel, isHealth: true
    },
    {
      label: 'CPC médio', ico: '💸',
      value: cpc > 0 ? fmtMoney(cpc) : '—',
      help: 'Custo médio por clique nos ads. Você paga só quando alguém clica.'
    },
    {
      label: '% via ads', ico: '📊',
      value: adsPct > 0 ? fmtPct(adsPct, 0) : '—',
      help: 'Que parte da sua receita veio de Product Ads. Quanto maior, mais o faturamento depende de impulso pago.',
      tone: adsTone, deltaText: adsLabel, isHealth: true
    }
  ];

  return `
    <div class="mfd-kpi-bar mfd-kpi-bar-secondary">
      ${kpis.map(k => renderKpi(k)).join('')}
    </div>
  `;
}

function renderKpiBar(agg, totals, prevSnap, healthScore) {
  const totalRev = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
  const sales = (agg.total_orders || 0) + (agg.organic_orders || 0);
  const tacos = agg.avg_tacos || 0;
  const roas = agg.overall_roas || 0;
  // Sem gasto em Ads no período, TACOS/ROAS não se aplicam — "0%"/"0x" parece métrica ruim
  const hasAdsSpend = (agg.total_cost || 0) > 0;
  // Receita por pedidos com paginação no cap: valor é piso, não total
  const kpiRevSuffix = agg.revenue_complete === false ? '+' : '';

  const revPrev = prevSnap ? ((prevSnap.revenue || 0) + (prevSnap.organic_revenue || 0)) : null;
  const salesPrev = prevSnap ? (prevSnap.sales || 0) : null;
  const tacosPrev = prevSnap ? (prevSnap.tacos || 0) : null;
  const roasPrev  = prevSnap ? (prevSnap.roas || 0) : null;

  const revDelta = revPrev != null && revPrev > 0 ? ((totalRev - revPrev) / revPrev) * 100 : null;
  const salesDelta = salesPrev != null && salesPrev > 0 ? ((sales - salesPrev) / salesPrev) * 100 : null;
  const tacosDelta = tacosPrev != null ? (tacos - tacosPrev) : null;
  const roasDelta  = roasPrev  != null ? (roas  - roasPrev)  : null;

  const kpis = [
    {
      label: 'Receita',
      ico: '💰',
      value: fmtMoneyCompact(totalRev) + kpiRevSuffix,
      help: 'Total que você faturou no período (vendas via ads + vendas orgânicas).',
      delta: revDelta,
      deltaText: revDelta != null ? `${deltaArrow(revDelta)} ${fmt(Math.abs(revDelta), 1)}%` : null,
      deltaInverted: false,
      tone: revDelta == null ? '' : (revDelta > 0 ? 'good' : revDelta < 0 ? 'crit' : ''),
      sparklineDataKey: 'revenue'
    },
    {
      label: 'Vendas',
      ico: '🛒',
      value: fmtCompact(sales) + kpiRevSuffix,
      help: 'Quantidade de unidades vendidas no período (somando ads e orgânicas).',
      delta: salesDelta,
      deltaText: salesDelta != null ? `${deltaArrow(salesDelta)} ${fmt(Math.abs(salesDelta), 1)}%` : null,
      deltaInverted: false,
      tone: salesDelta == null ? '' : (salesDelta > 0 ? 'good' : salesDelta < 0 ? 'crit' : ''),
      sparklineDataKey: 'units'
    },
    {
      label: 'TACOS',
      ico: '⚖️',
      value: hasAdsSpend ? fmtPct(tacos, 1) : '—',
      help: 'Total ACOS — quanto da sua receita TOTAL (ads + orgânica) foi gasto em ads. Quanto menor, melhor.',
      delta: hasAdsSpend ? tacosDelta : null,
      deltaText: hasAdsSpend && tacosDelta != null ? `${deltaArrow(tacosDelta)} ${fmt(Math.abs(tacosDelta), 2)}pp` : null,
      deltaInverted: true,
      tone: !hasAdsSpend || tacosDelta == null ? '' : (tacosDelta < 0 ? 'good' : tacosDelta > 0.5 ? 'warn' : ''),
      sparklineDataKey: 'tacos'
    },
    {
      label: 'ROAS',
      ico: '📈',
      value: hasAdsSpend ? fmt(roas, 2) + 'x' : '—',
      help: 'Return on Ad Spend — quanto cada R$ 1 investido em ads gerou em vendas. ROAS 4x = cada R$ 1 virou R$ 4. Abaixo de 1x você está pagando pra vender.',
      delta: hasAdsSpend ? roasDelta : null,
      deltaText: hasAdsSpend && roasDelta != null ? `${deltaArrow(roasDelta)} ${fmt(Math.abs(roasDelta), 2)}x` : null,
      deltaInverted: false,
      tone: !hasAdsSpend || roasDelta == null ? '' : (roasDelta > 0 ? 'good' : roasDelta < 0 ? 'crit' : ''),
      sparklineDataKey: 'roas'
    },
    {
      label: 'Health Score',
      ico: '❤️',
      value: String(Math.round(healthScore)),
      help: 'Nota da saúde geral da sua conta (0 a 100). Combina eficiência de ads, cobertura de catálogo, sua consistência de uso e tendência de receita.',
      delta: null,
      deltaText: classFromScore(healthScore).label,
      tone: 'purple',
      isHealth: true
    }
  ];

  return `
    <div class="mfd-kpi-bar">
      ${kpis.map(k => renderKpi(k)).join('')}
    </div>
  `;
}

function renderKpi(k) {
  const deltaClassName = k.delta == null ? 'flat' : deltaClass(k.delta, k.deltaInverted);
  const helpDot = k.help
    ? `<span class="mfd-kpi-help" tabindex="0" data-help="${escapeHtml(k.help)}" title="${escapeHtml(k.help)}">?</span>`
    : '';
  // Para KPIs estáticos (isHealth) que usam tone pra colorir badge
  const toneToBadge = { good: 'pos', warn: 'neutral', crit: 'neg', purple: 'flat' };
  const badgeClass = k.isHealth
    ? (toneToBadge[k.tone] || 'flat')
    : deltaClassName;
  return `
    <div class="mfd-kpi ${k.tone || ''}">
      <div class="mfd-kpi-label"><span class="ico">${k.ico}</span>${escapeHtml(k.label)}${helpDot}</div>
      <div class="mfd-kpi-value">${k.value}</div>
      ${k.deltaText
        ? `<div><span class="mfd-kpi-delta ${badgeClass}">${k.deltaText}</span>${!k.isHealth ? `<span class="mfd-kpi-delta-label">${STATE.prevSnapshot && STATE.prevSnapshot._synthetic ? 'vs período anterior' : 'vs visita anterior'}</span>` : ''}</div>`
        : ''}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 13 — Render: REVENUE CHART (Chart.js)
// ══════════════════════════════════════════════════════════════════════

function renderChartCard() {
  return `
    <div class="mfd-card mfd-chart-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">📊</span>Tendência de Receita</div>
      </div>
      <div class="mfd-chart-wrap">
        <canvas id="mfd-revenue-chart"></canvas>
      </div>
      <div class="mfd-chart-legend">
        <span class="mfd-chart-legend-item"><span class="mfd-chart-legend-dot" style="background:#0066ff;"></span>Receita ads</span>
        <span class="mfd-chart-legend-item"><span class="mfd-chart-legend-dot" style="background:#00d68f;"></span>Receita orgânica</span>
        <span class="mfd-chart-legend-item"><span class="mfd-chart-legend-dot" style="background:#ff3b5c;border-radius:1px;width:14px;height:2px;"></span>Custo de ads</span>
      </div>
      <div class="mfd-chart-summary" id="mfd-chart-summary"></div>
    </div>
  `;
}

let _mfdTrafficChartInstance = null;
let _mfdSalesChartInstance = null;

function renderTrafficChartCard() {
  return `
    <div class="mfd-card mfd-chart-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">👁️</span>Tráfego diário — Orgânico × Ads</div>
      </div>
      <div class="mfd-chart-wrap">
        <canvas id="mfd-traffic-chart"></canvas>
      </div>
      <div class="mfd-chart-legend">
        <span class="mfd-chart-legend-item"><span class="mfd-chart-legend-dot" style="background:#22c55e;"></span>Visitas orgânicas</span>
        <span class="mfd-chart-legend-item"><span class="mfd-chart-legend-dot" style="background:#8b5cf6;"></span>Impressões Ads</span>
        <span class="mfd-chart-legend-item"><span class="mfd-chart-legend-dot" style="background:#0066ff;border-radius:1px;width:14px;height:2px;"></span>Cliques Ads</span>
      </div>
    </div>
  `;
}

function drawTrafficChart(daily) {
  const canvas = document.getElementById('mfd-traffic-chart');
  if (!canvas) return;
  if (!window.Chart || !Array.isArray(daily) || !daily.length) {
    const wrap = canvas.closest('.mfd-chart-wrap');
    if (wrap) wrap.innerHTML = '<div class="mfd-empty">Sem dados no período ainda — o gráfico aparece com as primeiras visitas.</div>';
    return;
  }
  const ctx = canvas.getContext('2d');
  if (_mfdTrafficChartInstance) { _mfdTrafficChartInstance.destroy(); _mfdTrafficChartInstance = null; }

  const data = [...daily].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  // Normaliza datas pra YYYY-MM-DD (proxy retorna ISO; fetch-visits também).
  const dateKeys = data.map(d => (d.date || '').slice(0, 10));
  const labels = dateKeys.map(s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
  const impressions = data.map(d => +(d.prints || 0));
  const clicks      = data.map(d => +(d.clicks || 0));
  const dailyVisits = (STATE.visitsDaily && STATE.visitsDaily.daily) || {};
  // "Visitas orgânicas" = total de visitas nos items ativos amostrados − cliques de Ads
  // do mesmo dia. Se a amostragem de visitas é menor que o universo de Ads (caso
  // sellers com >60 items ativos), o subtrair pode dar negativo — nesse caso mostra
  // o total bruto como melhor aproximação. NUNCA negativo.
  const organicVisits = dateKeys.map((dateKey, i) => {
    const total = Number(dailyVisits[dateKey] || 0);
    const ads = Number(clicks[i] || 0);
    if (total <= 0) return 0;
    if (ads >= total) return total; // amostra desbalanceada — mostra total como visita "do dia"
    return total - ads;
  });

  const datasets = [
    {
      type: 'bar',
      label: 'Visitas orgânicas',
      data: organicVisits,
      backgroundColor: 'rgba(34,197,94,0.55)',
      hoverBackgroundColor: '#22c55e',
      borderRadius: 3,
      borderSkipped: false,
      yAxisID: 'y1',
      order: 3
    },
    {
      type: 'bar',
      label: 'Cliques Ads',
      data: clicks,
      backgroundColor: 'rgba(0,102,255,0.55)',
      hoverBackgroundColor: '#0066ff',
      borderRadius: 3,
      borderSkipped: false,
      yAxisID: 'y1',
      order: 2
    },
    {
      type: 'line',
      label: 'Impressões Ads',
      data: impressions,
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139,92,246,0.12)',
      borderWidth: 2.2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointBackgroundColor: '#fff',
      pointBorderColor: '#8b5cf6',
      pointBorderWidth: 2,
      tension: 0.3,
      fill: true,
      yAxisID: 'y',
      order: 1
    }
  ];

  _mfdTrafficChartInstance = new Chart(ctx, {
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.94)', padding: 10, cornerRadius: 8,
          titleFont: { family: 'DM Sans', size: 12 },
          bodyFont:  { family: 'DM Mono', size: 12, weight: 'bold' },
          callbacks: { label: (c) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}` }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'DM Mono', size: 10 }, color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
        },
        y: {
          beginAtZero: true,
          position: 'left',
          grid: { color: 'rgba(148,163,184,0.18)', borderDash: [3,3] },
          ticks: { font: { family: 'DM Mono', size: 10 }, color: '#8b5cf6', callback: v => fmtCompact(v) },
          title: { display: false }
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          grid: { display: false },
          ticks: { font: { family: 'DM Mono', size: 10 }, color: '#0066ff', callback: v => fmtCompact(v) }
        }
      }
    }
  });
}

function renderSalesChartCard() {
  return `
    <div class="mfd-card mfd-chart-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">🛒</span>Vendas diárias</div>
      </div>
      <div class="mfd-chart-wrap">
        <canvas id="mfd-sales-chart"></canvas>
      </div>
      <div class="mfd-chart-legend">
        <span class="mfd-chart-legend-item"><span class="mfd-chart-legend-dot" style="background:#0066ff;"></span>Vendas via ads</span>
        <span class="mfd-chart-legend-item"><span class="mfd-chart-legend-dot" style="background:#00d68f;"></span>Vendas orgânicas</span>
      </div>
    </div>
  `;
}

function drawSalesChart(daily) {
  const canvas = document.getElementById('mfd-sales-chart');
  if (!canvas) return;
  if (!window.Chart || !Array.isArray(daily) || !daily.length) {
    const wrap = canvas.closest('.mfd-chart-wrap');
    if (wrap) wrap.innerHTML = '<div class="mfd-empty">Sem dados no período ainda — o gráfico aparece com as primeiras vendas.</div>';
    return;
  }
  const ctx = canvas.getContext('2d');
  if (_mfdSalesChartInstance) { _mfdSalesChartInstance.destroy(); _mfdSalesChartInstance = null; }

  const data = [...daily].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const labels = data.map(d => { const s = String(d.date || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : ''; });
  const adsSales = data.map(d => +(d.units_quantity || 0));
  const orgSales = data.map(d => +(d.organic_units_quantity || 0));

  _mfdSalesChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Vendas via ads',
          data: adsSales,
          backgroundColor: 'rgba(0,102,255,0.85)',
          hoverBackgroundColor: '#0066ff',
          borderRadius: 3,
          borderSkipped: false,
          stack: 'sales'
        },
        {
          label: 'Vendas orgânicas',
          data: orgSales,
          backgroundColor: 'rgba(0,214,143,0.85)',
          hoverBackgroundColor: '#00d68f',
          borderRadius: 3,
          borderSkipped: false,
          stack: 'sales'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.94)', padding: 10, cornerRadius: 8,
          titleFont: { family: 'DM Sans', size: 12 },
          bodyFont:  { family: 'DM Mono', size: 12, weight: 'bold' },
          callbacks: { label: (c) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}` }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { family: 'DM Mono', size: 10 }, color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: 'rgba(148,163,184,0.18)', borderDash: [3,3] },
          ticks: { font: { family: 'DM Mono', size: 10 }, color: '#94a3b8', precision: 0 }
        }
      }
    }
  });
}

// Donut: concentração de gasto entre os top anúncios
let _mfdSpendDonutInstance = null;

function renderSpendDonutCard() {
  return `
    <div class="mfd-card mfd-chart-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">🎯</span>Pra onde vai seu gasto em Ads</div>
      </div>
      <div class="mfd-spend-donut-wrap">
        <div class="mfd-donut-container"><canvas id="mfd-spend-donut"></canvas></div>
        <div id="mfd-spend-donut-legend" class="mfd-donut-legend"></div>
      </div>
    </div>
  `;
}

function drawSpendDonut(items) {
  const canvas = document.getElementById('mfd-spend-donut');
  if (!canvas || !window.Chart) return;
  if (_mfdSpendDonutInstance) { _mfdSpendDonutInstance.destroy(); _mfdSpendDonutInstance = null; }
  const arr = (items || []).filter(it => (it.cost || 0) > 0).slice(0, 5);
  if (!arr.length) return;

  const palette = ['#0066ff', '#00d68f', '#8b5cf6', '#f59e0b', '#ff3b5c'];
  const labels = arr.map((it, i) => {
    const t = it.title || it.item_id || ('Item ' + (i+1));
    return t.length > 32 ? t.slice(0, 32) + '…' : t;
  });
  const values = arr.map(it => +(it.cost || 0));
  const total = values.reduce((s, n) => s + n, 0);

  const ctx = canvas.getContext('2d');
  _mfdSpendDonutInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: palette.slice(0, arr.length),
        borderColor: '#fff',
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '64%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.94)', padding: 10, cornerRadius: 8,
          titleFont: { family: 'DM Sans', size: 12 },
          bodyFont:  { family: 'DM Mono', size: 12, weight: 'bold' },
          callbacks: {
            label: (c) => {
              const pct = total > 0 ? (c.parsed / total) * 100 : 0;
              return `${fmtMoney(c.parsed)} (${fmt(pct, 0)}%)`;
            }
          }
        }
      }
    }
  });

  // Legenda lateral
  const legend = document.getElementById('mfd-spend-donut-legend');
  if (legend) {
    legend.innerHTML = arr.map((it, i) => {
      const cost = it.cost || 0;
      const pct = total > 0 ? (cost / total) * 100 : 0;
      const t = it.title || it.item_id || ('Item ' + (i+1));
      return `
        <div class="mfd-donut-leg-row">
          <span class="mfd-donut-leg-dot" style="background:${palette[i]}"></span>
          <div class="mfd-donut-leg-body">
            <div class="mfd-donut-leg-title" title="${escapeHtml(t)}">${escapeHtml(t.length > 40 ? t.slice(0, 40) + '…' : t)}</div>
            <div class="mfd-donut-leg-meta"><b>${fmtMoneyCompact(cost)}</b> · ${fmt(pct, 0)}% do gasto</div>
          </div>
        </div>
      `;
    }).join('');
    // Centro do donut: total
    const center = document.createElement('div');
    center.className = 'mfd-donut-center';
    center.innerHTML = `<span class="mfd-donut-center-vl">${fmtMoneyCompact(total)}</span><span class="mfd-donut-center-lb">total gasto</span>`;
    const wrap = document.querySelector('.mfd-donut-container');
    const old = wrap?.querySelector('.mfd-donut-center');
    if (old) old.remove();
    if (wrap) wrap.appendChild(center);
  }
}

function renderCampaignsCard(campaigns) {
  if (!Array.isArray(campaigns) || !campaigns.length) {
    return `
      <div class="mfd-card">
        <div class="mfd-card-header">
          <div class="mfd-card-title"><span class="ico">📣</span>Suas campanhas</div>
        </div>
        <div class="mfd-empty">Nenhuma campanha de Product Ads detectada. Crie a primeira pelo Mercado Livre ou abra o Planejador de Ads.</div>
      </div>
    `;
  }
  const active = campaigns.filter(c => (c.status || '').toLowerCase() === 'active');
  const paused = campaigns.filter(c => (c.status || '').toLowerCase() !== 'active');

  const row = (c) => {
    const isActive = (c.status || '').toLowerCase() === 'active';
    const stratMap = { 'profitability': 'rentabilidade', 'visibility': 'visibilidade', 'increase_traffic': 'tráfego' };
    const strat = stratMap[String(c.strategy || '').toLowerCase()] || c.strategy || '—';
    const targets = [];
    if (c.acos_target) targets.push(`ACOS alvo ${fmt(c.acos_target, 0)}%`);
    if (c.roas_target) targets.push(`ROAS alvo ${fmt(c.roas_target, 1)}x`);
    if (c.budget && (c.budget.amount || c.budget)) {
      const amount = c.budget.amount || c.budget;
      targets.push(`budget ${fmtMoneyCompact(amount)}`);
    }
    return `
      <div class="mfd-camp-item ${isActive ? 'active' : 'paused'}">
        <div class="mfd-camp-status">${isActive ? '<span class="dot active"></span>ativa' : '<span class="dot paused"></span>' + escapeHtml(({ paused: 'pausada', hold: 'em espera', idle: 'inativa', pending: 'pendente' })[String(c.status || '').toLowerCase()] || 'pausada')}</div>
        <div class="mfd-camp-body">
          <div class="mfd-camp-name" title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || ('Campanha ' + c.campaign_id))}</div>
          <div class="mfd-camp-meta">${escapeHtml(strat)}${targets.length ? ' · ' + targets.map(escapeHtml).join(' · ') : ''}</div>
        </div>
      </div>
    `;
  };

  return `
    <div class="mfd-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">📣</span>Suas campanhas</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${active.length} ativa${active.length === 1 ? '' : 's'} · ${paused.length} pausada${paused.length === 1 ? '' : 's'}</span>
      </div>
      <div class="mfd-camp-list">
        ${[...active, ...paused].slice(0, 8).map(row).join('')}
      </div>
      ${campaigns.length > 8 ? `<div class="mfd-camp-more">+${campaigns.length - 8} ${campaigns.length - 8 === 1 ? 'outra' : 'outras'} no Planejador de Ads</div>` : ''}
    </div>
  `;
}

let _mfdChartInstance = null;
function drawRevenueChart(daily) {
  const canvas = document.getElementById('mfd-revenue-chart');
  if (!canvas) return;
  if (!window.Chart || !Array.isArray(daily) || !daily.length) {
    const wrap = canvas.closest('.mfd-chart-wrap');
    if (wrap) wrap.innerHTML = '<div class="mfd-empty">Sem dados no período ainda — o gráfico aparece com as primeiras vendas.</div>';
    return;
  }
  const ctx = canvas.getContext('2d');

  // Cleanup
  if (_mfdChartInstance) { _mfdChartInstance.destroy(); _mfdChartInstance = null; }

  // Sort by date asc
  const data = [...daily].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const labels = data.map(d => { const s = String(d.date || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : ''; });

  const adsRev    = data.map(d => +(d.total_amount || 0));
  const orgRev    = data.map(d => +(d.organic_units_amount || d.organic_revenue || 0));
  const cost      = data.map(d => +(d.cost || 0));

  // Mixed chart: barras stacked (receita ads + orgânica) + linha (custo)
  _mfdChartInstance = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Receita ads',
          data: adsRev,
          backgroundColor: 'rgba(0,102,255,0.85)',
          hoverBackgroundColor: '#0066ff',
          borderRadius: 4,
          borderSkipped: false,
          stack: 'rev',
          order: 2
        },
        {
          type: 'bar',
          label: 'Receita orgânica',
          data: orgRev,
          backgroundColor: 'rgba(0,214,143,0.85)',
          hoverBackgroundColor: '#00d68f',
          borderRadius: 4,
          borderSkipped: false,
          stack: 'rev',
          order: 2
        },
        {
          type: 'line',
          label: 'Custo de ads',
          data: cost,
          borderColor: '#ff3b5c',
          backgroundColor: 'rgba(255,59,92,0)',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#ff3b5c',
          pointBorderWidth: 2,
          tension: 0.25,
          order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.94)', padding: 10, cornerRadius: 8, displayColors: true,
          titleFont: { family: 'DM Sans', size: 12 },
          bodyFont:  { family: 'DM Mono', size: 12, weight: 'bold' },
          callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.y)}` }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { family: 'DM Mono', size: 10 }, color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: 'rgba(148,163,184,0.18)', borderDash: [3,3] },
          ticks: { font: { family: 'DM Mono', size: 10 }, color: '#94a3b8', callback: v => fmtMoneyCompact(v) }
        }
      }
    }
  });

  // Summary stats
  const sumAds = adsRev.reduce((s, n) => s + n, 0);
  const sumOrg = orgRev.reduce((s, n) => s + n, 0);
  const sumCost = cost.reduce((s, n) => s + n, 0);
  const totalRev = sumAds + sumOrg;
  const adsShare = totalRev > 0 ? (sumAds / totalRev) * 100 : 0;
  const lift = sumCost > 0 ? sumAds / sumCost : 0;
  const summary = document.getElementById('mfd-chart-summary');
  if (summary) {
    summary.innerHTML = `
      <div>
        <div class="mfd-chart-stat-lb">Total faturado</div>
        <div class="mfd-chart-stat-vl">${fmtMoneyCompact(totalRev)}</div>
      </div>
      <div>
        <div class="mfd-chart-stat-lb">Ads → Receita</div>
        <div class="mfd-chart-stat-vl pos">${fmt(lift, 2)}x</div>
      </div>
      <div>
        <div class="mfd-chart-stat-lb">% via ads</div>
        <div class="mfd-chart-stat-vl">${fmt(adsShare, 0)}%</div>
      </div>
    `;
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 14 — Render: HEALTH CARD
// ══════════════════════════════════════════════════════════════════════

function renderHealthCard(score, breakdown) {
  const cls = classFromScore(score);
  const ringClass = cls.color;
  const stroke = score; // já é 0-100 = pct
  return `
    <div class="mfd-card mfd-health-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">${cls.emoji}</span>Saúde da Conta</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">Classe ${cls.letter}</span>
      </div>
      <div class="mfd-health-top">
        <div class="mfd-health-circle">
          <svg viewBox="0 0 36 36">
            <circle class="ring-bg" cx="18" cy="18" r="15.9155" />
            <circle class="ring ${ringClass}" cx="18" cy="18" r="15.9155"
              stroke-dasharray="${stroke}, 100"
            />
          </svg>
          <div class="mfd-health-num">${Math.round(score)}<small>de 100</small></div>
        </div>
        <div>
          <div class="mfd-health-class">${cls.emoji} ${escapeHtml(cls.label)}
            <small>${escapeHtml(buildHealthAdvice(score, breakdown))}</small>
          </div>
        </div>
      </div>
      <div class="mfd-health-comp">
        ${breakdown.components.map(c => {
          const pct = (c.value / c.max) * 100;
          const tone = pct >= 75 ? 'good' : pct >= 45 ? 'neutral' : 'bad';
          return `
            <div class="mfd-health-comp-item">
              <div class="mfd-health-comp-row">
                <span class="mfd-health-comp-label">
                  ${escapeHtml(c.label)}
                  ${c.what ? `<span class="mfd-tip" data-tip="${escapeHtml(c.what)}" tabindex="0" role="button" aria-label="${escapeHtml(c.what)}">ⓘ</span>` : ''}
                </span>
                <span class="mfd-health-comp-vl">${c.value}/${c.max}</span>
              </div>
              <div class="mfd-health-comp-bar"><div class="mfd-health-comp-fill ${tone}" style="width:${pct}%;"></div></div>
              ${c.hint ? `<div class="mfd-health-comp-hint">${escapeHtml(c.hint)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function buildHealthAdvice(score, breakdown) {
  if (score >= 90) return 'Conta no ponto. Foco em escalar.';
  const weakest = [...breakdown.components].sort((a,b) => (a.value/a.max) - (b.value/b.max))[0];
  if (!weakest) return 'Continue acompanhando os indicadores.';
  const map = {
    'ads':  'Resolva os anúncios com problema de saúde — veja a lista abaixo no painel.',
    'rep':  'Reputação ML caindo — atenção a reclamações, atrasos e cancelamentos.',
    'div':  'Você depende demais de Ads. Invista no orgânico (palavras-chave, ficha técnica, fotos).',
    'trac': 'Tração orgânica caiu — produtos perdendo exposição ou conversão. Olhe os top anúncios.'
  };
  return map[weakest.id] || 'Veja qual componente está mais baixo e ataque ele primeiro.';
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 15 — Render: OPPORTUNITIES
// ══════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// SECTION 13b — Banner "Desde sua última visita" (anomalias)
// ══════════════════════════════════════════════════════════════════════

function buildSinceLastVisitChanges(history, agg, healthScore, streak) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const period = STATE.period || 30;
  const today = todayStr();
  // Pega o snapshot mais recente ANTES de hoje, mesmo período
  const samePeriod = history.filter(h => (h.period || 30) === period);
  if (samePeriod.length < 2) return null;
  const prev = samePeriod
    .filter(h => h.date < today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-1)[0];
  if (!prev) return null;
  const gap = daysBetween(prev.date, today);
  if (gap < 1 || gap > 30) return null; // muito pouco ou muito tempo

  const totalRev = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
  const prevRev = (prev.revenue || 0) + (prev.organic_revenue || 0);
  const roasNow = agg.overall_roas || 0;
  const roasPrev = prev.roas || 0;
  const healthPrev = prev.health || 0;

  const out = [];

  // Receita
  if (prevRev > 0) {
    const pct = ((totalRev - prevRev) / prevRev) * 100;
    if (pct > 15) out.push({ tone: 'good', icon: '📈', text: `Receita subiu <b>${fmt(pct, 0)}%</b> desde sua visita anterior.` });
    else if (pct < -15) out.push({ tone: 'crit', icon: '📉', text: `Receita caiu <b>${fmt(Math.abs(pct), 0)}%</b> desde sua visita anterior.` });
  } else if (totalRev > 0) {
    out.push({ tone: 'good', icon: '🎉', text: `Você teve a primeira receita registrada desde sua visita anterior — <b>${fmtMoneyCompact(totalRev)}</b>.` });
  }

  // ROAS
  if (roasPrev > 0.5 && Math.abs(roasNow - roasPrev) >= 0.5) {
    if (roasNow > roasPrev) out.push({ tone: 'good', icon: '🚀', text: `ROAS subiu de <b>${fmt(roasPrev, 2)}x</b> pra <b>${fmt(roasNow, 2)}x</b>.` });
    else out.push({ tone: 'crit', icon: '⚠️', text: `ROAS caiu de <b>${fmt(roasPrev, 2)}x</b> pra <b>${fmt(roasNow, 2)}x</b>.` });
  }

  // Health Score
  const healthDelta = healthScore - healthPrev;
  if (healthPrev > 0 && Math.abs(healthDelta) >= 10) {
    if (healthDelta > 0) out.push({ tone: 'good', icon: '❤️', text: `Health Score subiu <b>${fmt(healthDelta, 0)} pts</b> (agora ${Math.round(healthScore)}/100).` });
    else out.push({ tone: 'crit', icon: '💔', text: `Health Score caiu <b>${fmt(Math.abs(healthDelta), 0)} pts</b> (agora ${Math.round(healthScore)}/100).` });
  }

  // Streak
  if (streak.current >= 3) {
    out.push({ tone: 'good', icon: '🔥', text: `Você está há <b>${streak.current} dias seguidos</b> acompanhando — recorde pessoal: ${streak.best} dias.` });
  } else if (gap >= 5) {
    out.push({ tone: 'warn', icon: '👋', text: `Bem-vindo de volta — faz <b>${gap} dias</b> desde sua última visita.` });
  }

  if (!out.length) return null;
  return { gap, prevDate: prev.date, items: out.slice(0, 3) };
}

function renderSinceLastVisitBanner(changes) {
  if (!changes || !changes.items?.length) return '';
  const dt = changes.prevDate ? changes.prevDate.split('-').reverse().slice(0, 2).join('/') : '';
  return `
    <div class="mfd-since-banner">
      <div class="mfd-since-banner-header">
        <span class="mfd-since-banner-label">Desde sua última visita${dt ? ` em ${dt}` : ''}</span>
        <span class="mfd-since-banner-gap">há ${changes.gap} ${changes.gap === 1 ? 'dia' : 'dias'}</span>
      </div>
      <div class="mfd-since-items">
        ${changes.items.map(c => `
          <div class="mfd-since-item tone-${c.tone}">
            <span class="mfd-since-icon">${c.icon}</span>
            <span class="mfd-since-text">${c.text}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 14a — Big-picture Summary (resumão narrativo amigável)
// ══════════════════════════════════════════════════════════════════════
// Card de texto contínuo que conta a história dos números pro vendedor
// que não é fluente em métricas. Vira "narrador" da própria conta.

function buildPlainSummary(agg, totals, daily, prevSnap, period, seller) {
  const totalRev = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
  const sales = (agg.total_orders || 0) + (agg.organic_orders || 0);
  const cost = agg.total_cost || 0;
  const roas = agg.overall_roas || 0;
  const tier = friendlyPowerLabel(seller?.seller_reputation?.power_seller_status);

  // Se conta vazia, narrar isso de forma encorajadora
  if (totalRev === 0 && totals.activeItems === 0) {
    return {
      title: 'Sua história começa aqui',
      paragraphs: [
        `Você ainda não tem anúncios ativos. Ative seu primeiro produto e em alguns dias vamos conseguir te mostrar quanto está vendendo, qual seu produto campeão e onde tá o dinheiro escapando.`,
        `Enquanto isso, dá pra explorar o app: <b>Buscador de Catálogos</b> mostra produtos com demanda real esperando vendedor, e o <b>INPI</b> ajuda a validar marcas antes de criar.`
      ]
    };
  }

  // Frase do período com gênero/número certos
  const periodFull = period === 7 ? 'nessa última semana'
    : period === 30 ? 'nesse último mês'
    : period === 60 ? 'nesses últimos 2 meses'
    : period === 90 ? 'neste trimestre'
    : `nesses últimos ${period} dias`;
  const paragraphs = [];

  // Parágrafo 1 — receita total
  if (totalRev > 0) {
    const tierPrefix = tier ? `Como ${tier.label.replace(/^\S+\s/, '')}, você ` : 'Você ';
    const itemsPart = (totals.activeItems > 0)
      ? ` em ${totals.activeItems} ${totals.activeItems === 1 ? 'anúncio ativo' : 'anúncios ativos'}`
      : '';
    paragraphs.push(`${tierPrefix}faturou <b>${fmtMoney(totalRev)}</b> ${periodFull} — ${fmtInt(sales)} ${sales === 1 ? 'unidade vendida' : 'unidades vendidas'}${itemsPart}.`);
  } else if (!Object.keys(agg).length) {
    // ML não devolveu dados de Ads (conta sem campanha) e a medição por pedidos
    // ainda não chegou (ou falhou) — sem fonte, não dá pra afirmar "não vendeu"
    paragraphs.push(`Você tem <b>${totals.activeItems}</b> ${totals.activeItems === 1 ? 'anúncio ativo' : 'anúncios ativos'}. Ainda estou medindo suas vendas do período — se esse aviso persistir, recarregue a página.`);
  } else {
    paragraphs.push(`Você tem <b>${totals.activeItems}</b> ${totals.activeItems === 1 ? 'anúncio ativo' : 'anúncios ativos'}, mas não vendeu nada ${periodFull}. Vale dar uma olhada na exposição: visitas tão chegando? O preço tá competitivo? O título prende a busca?`);
  }

  // Parágrafo 2 — Saúde orgânica das vendas
  const orgRev = agg.organic_revenue || 0;
  const adsRev = agg.total_revenue || 0;
  const orgPct = totalRev > 0 ? Math.round((orgRev / totalRev) * 100) : 0;
  if (totalRev > 0) {
    if (orgPct >= 50) {
      paragraphs.push(`<b>${orgPct}%</b> da sua receita vem do orgânico — sua base é forte, o algoritmo do ML te encontra naturalmente.`);
    } else if (orgPct >= 30) {
      paragraphs.push(`<b>${orgPct}%</b> da receita é orgânica. Tem espaço pra crescer essa parcela ajustando ficha técnica e palavras-chave dos anúncios.`);
    } else if (orgPct > 0) {
      paragraphs.push(`Só <b>${orgPct}%</b> da receita é orgânica — você depende muito de impulso pago. Aumentar a exposição orgânica diminui essa dependência.`);
    }
  }

  // Parágrafo 3 — dia recorde / tendência
  if (Array.isArray(daily) && daily.length > 0) {
    const sorted = [...daily].sort((a, b) => (b.total_amount || 0) + (b.organic_units_amount||0) - ((a.total_amount || 0) + (a.organic_units_amount||0)));
    const top = sorted[0];
    const topRev = (top.total_amount || 0) + (top.organic_units_amount || 0);
    if (topRev > 0) {
      const dt = top.date;
      const fmtDate = dt ? `${dt.slice(8,10)}/${dt.slice(5,7)}` : '—';
      paragraphs.push(`Seu melhor dia foi <b>${fmtDate}</b>, com <b>${fmtMoney(topRev)}</b> faturados. Olhar o que você fez de diferente nesse dia (preço, ads, lançamento, fotos novas) costuma revelar a fórmula que dá pra repetir.`);
    }
  }

  // Parágrafo 4 — comparação vs visita anterior
  if (prevSnap) {
    const revPrev = (prevSnap.revenue || 0) + (prevSnap.organic_revenue || 0);
    if (revPrev > 0) {
      const delta = ((totalRev - revPrev) / revPrev) * 100;
      if (delta > 10) paragraphs.push(`Você está em <b>tendência de alta</b> — receita subiu <b>${fmt(Math.abs(delta), 0)}%</b> desde sua visita anterior. Esse é o melhor momento pra escalar: aumente ads em campeões e procure novos catálogos pra entrar.`);
      else if (delta < -10) paragraphs.push(`Sua receita caiu <b>${fmt(Math.abs(delta), 0)}%</b> desde a última visita. Não é hora de cortar — é hora de investigar. Cheque estoque, preço e se algum concorrente novo apareceu mais barato.`);
    }
  }

  return { title: 'O que está rolando na sua conta', paragraphs };
}

function renderSummaryCard(agg, totals, daily, prevSnap, period, seller) {
  const s = buildPlainSummary(agg, totals, daily, prevSnap, period, seller);
  if (!s.paragraphs.length) return '';
  return `
    <div class="mfd-card mfd-summary-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">📰</span>${escapeHtml(s.title)}</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">resumo em palavras</span>
      </div>
      <div class="mfd-summary-body">
        ${s.paragraphs.map(p => `<p class="mfd-summary-p">${p}</p>`).join('')}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 14b — Reputation Card (linguagem amigável)
// ══════════════════════════════════════════════════════════════════════

// Mapa do level_id ML pra texto amigável + cor
function friendlyLevelLabel(levelId) {
  const map = {
    '5_green':       { short: 'vendedor verde 🟢',       full: 'Vendedor verde 🟢',       desc: 'Top do Mercado Livre — sua reputação está no nível mais alto.', tone: 'good',    color: '#00d68f' },
    '4_light_green': { short: 'vendedor verde claro 🟢', full: 'Vendedor verde claro',    desc: 'Boa reputação — bem perto do nível máximo.',                       tone: 'good',    color: '#22c55e' },
    '3_yellow':      { short: 'vendedor amarelo 🟡',     full: 'Vendedor amarelo',         desc: 'Reputação intermediária — atenção a reclamações e atrasos.',     tone: 'neutral', color: '#f59e0b' },
    '2_orange':      { short: 'vendedor laranja 🟠',     full: 'Vendedor laranja',         desc: 'Reputação em risco — precisa cuidar das métricas para não cair.', tone: 'warn',    color: '#f97316' },
    '1_red':         { short: 'vendedor vermelho 🔴',    full: 'Vendedor vermelho',        desc: 'Reputação crítica — Mercado Livre pode aplicar restrições à sua conta.', tone: 'crit', color: '#ef4444' }
  };
  if (!levelId || !map[levelId]) return { short: '', full: '', desc: '', tone: '', color: '#94a3b8' };
  return map[levelId];
}

// Friendly Power tier (Mercado Líder)
function friendlyPowerLabel(status) {
  const map = {
    'platinum': { label: '👑 MercadoLíder Platinum', desc: 'O nível mais alto da plataforma — selo especial, melhor exposição.', tone: 'platinum' },
    'gold':     { label: '🥇 MercadoLíder Gold',     desc: 'Selo Mercado Líder — acima da média e priorizado nos resultados.',  tone: 'gold' },
    'silver':   { label: '🥈 MercadoLíder Silver',   desc: 'Próximo de subir — continue cuidando das métricas pra virar Gold.', tone: 'silver' }
  };
  return map[status] || null;
}

function renderReputationCard(seller) {
  if (!seller || !seller.seller_reputation) return '';
  const rep = seller.seller_reputation;
  const lvl = friendlyLevelLabel(rep.level_id);
  const power = friendlyPowerLabel(rep.power_seller_status);
  const tx = rep.transactions || {};
  const ratings = tx.ratings || {};
  const total = tx.total || 0;
  const completed = Number(tx.completed) || 0;
  const canceled = Number(tx.canceled) || 0;
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const ratingsPeriod = tx.period || 'historic';
  const isHistoric = ratingsPeriod === 'historic';
  const positivePct = Math.round((ratings.positive || 0) * 100);
  const neutralPct  = Math.round((ratings.neutral || 0) * 100);
  const negativePct = Math.round((ratings.negative || 0) * 100);
  // ML não expõe mais o detalhamento real de avaliações pra muitas contas: a API
  // devolve 0/1/0 (tudo "neutro") ou tudo zero. Esses padrões = sem dado, não
  // "100% neutras" — esconder a barra em vez de mostrar distribuição falsa.
  const ratingsUnavailable = (ratings.positive || 0) === 0 && (ratings.negative || 0) === 0
    && ((ratings.neutral || 0) >= 0.995 || (ratings.neutral || 0) === 0);
  const m = rep.metrics || {};
  const claims = m.claims || {};
  const delays = m.delayed_handling_time || {};
  const cancels = m.cancellations || {};

  const friendlyPeriod = (p) => {
    if (!p) return 'últimos 60 dias';
    const m = String(p).match(/(\d+)\s*(day|days|dias|d)/i);
    if (!m) return p;
    const n = parseInt(m[1], 10);
    if (n >= 360) return 'último ano';
    if (n >= 90) return `últimos ${Math.round(n/30)} meses`;
    return `últimos ${n} dias`;
  };
  const metric = (label, rate, value, period) => {
    const pct = (rate || 0) * 100;
    const tone = pct > 2 ? 'bad' : pct > 1 ? 'neutral' : 'good';
    return `
      <div class="mfd-rep-metric ${tone}">
        <div class="mfd-rep-metric-lb">${escapeHtml(label)}</div>
        <div class="mfd-rep-metric-vl">${fmt(pct, 2)}%</div>
        <div class="mfd-rep-metric-meta">${fmtInt(value || 0)} nos ${escapeHtml(friendlyPeriod(period))}</div>
      </div>
    `;
  };

  // Friendly summary text
  let summary;
  if (lvl.tone === 'good') summary = `Sua reputação está saudável.`;
  else if (lvl.tone === 'neutral') summary = `Sua reputação tá no meio do caminho — dá pra subir cuidando das métricas abaixo.`;
  else if (lvl.tone === 'warn') summary = `Atenção: sua reputação caiu pra zona de risco. Cuide do que está em vermelho.`;
  else if (lvl.tone === 'crit') summary = `Reputação crítica. Foco máximo em reduzir reclamações e cancelamentos.`;
  else if (total > 0 && total < 10) summary = `Você tem ${total} ${total > 1 ? 'avaliações' : 'avaliação'} — o Mercado Livre só calcula nível depois de mais vendas. Continue acumulando.`;
  else summary = `Volume insuficiente pro Mercado Livre calcular um nível ainda. Continue vendendo pra começar a aparecer.`;

  // Substitui o nome quando ML não tem level (conta nova)
  const levelHeader = lvl.full || (total > 0 ? `📈 Reputação em construção` : '📈 Sem avaliações ainda');
  const levelDesc = lvl.desc || (total > 0
    ? 'Mercado Livre só atribui um nível depois de um volume mínimo. Acelere as vendas pra sair desse limbo.'
    : 'Quando seus primeiros pedidos forem entregues e avaliados, sua reputação começa a se formar aqui.');

  // Loja Oficial — vem de /api/users/:id/brands
  const brand = STATE.brandInfo || {};
  const officialBlock = brand.isOfficial
    ? `<div class="mfd-official-pill">
        <span class="mfd-official-pill-label">Loja Oficial</span>
        ${brand.name ? `<span class="mfd-official-pill-sep">·</span><span class="mfd-official-pill-name">${escapeHtml(String(brand.name).toUpperCase())}</span>` : ''}
      </div>`
    : '';

  return `
    <div class="mfd-card mfd-rep-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">🛡️</span>Reputação ML</div>
        ${power ? `<span class="mfd-hero-tier-badge ${power.tone}">${power.label}</span>` : ''}
      </div>

      <div class="mfd-rep-top">
        <div class="mfd-rep-level">
          <span class="mfd-rep-dot" style="background:${lvl.color};box-shadow:0 0 0 4px ${lvl.color}22;"></span>
          <div>
            <div class="mfd-rep-level-name">${escapeHtml(levelHeader)}</div>
            <div class="mfd-rep-level-desc">${escapeHtml(levelDesc)}</div>
          </div>
        </div>
        <div class="mfd-rep-stars">
          <div class="mfd-rep-stars-num">${completionPct}%</div>
          <div class="mfd-rep-stars-meta">vendas completadas<br><b>${fmtInt(completed)}</b> de ${fmtInt(total)} (${fmtInt(canceled)} cancelada${canceled === 1 ? '' : 's'})</div>
        </div>
      </div>

      ${total > 0 ? (ratingsUnavailable ? `
      <div class="mfd-rep-history">
        <div class="mfd-rep-history-lb">Avaliações</div>
        <div class="mfd-rep-history-note">O Mercado Livre não divulga o detalhamento de avaliações dessa conta pela API. Acompanhe suas avaliações direto no painel do Mercado Livre.</div>
      </div>
      ` : `
      <div class="mfd-rep-history">
        <div class="mfd-rep-history-lb">
          Avaliações ${isHistoric ? '(histórico desde a criação da conta)' : `(período: ${escapeHtml(ratingsPeriod)})`}
        </div>
        <div class="mfd-rep-stars-bar">
          <span class="seg good"  style="width:${positivePct}%"></span>
          <span class="seg neutral" style="width:${neutralPct}%"></span>
          <span class="seg bad"   style="width:${negativePct}%"></span>
        </div>
        <div class="mfd-rep-stars-legend">
          <span><b style="color:var(--green-dark);">●</b> ${positivePct}% positivas</span>
          <span><b style="color:var(--yellow);">●</b> ${neutralPct}% neutras</span>
          <span><b style="color:var(--red);">●</b> ${negativePct}% negativas</span>
        </div>
        ${isHistoric && lvl.tone === 'good' ? '<div class="mfd-rep-history-note">As métricas recentes estão saudáveis — esse histórico inclui avaliações antigas que não afetam mais a reputação atual.</div>' : ''}
      </div>
      `) : ''}

      <div class="mfd-rep-summary">${escapeHtml(summary)}</div>

      <div class="mfd-rep-grid">
        ${metric('Reclamações', claims.rate, claims.value, claims.period)}
        ${metric('Atrasos no envio', delays.rate, delays.value, delays.period)}
        ${metric('Cancelamentos', cancels.rate, cancels.value, cancels.period)}
      </div>

      <div class="mfd-rep-foot">
        Métricas oficiais do Mercado Livre · valores acima de 2% começam a derrubar sua reputação
      </div>

      ${officialBlock}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 14c — Achievements / Next Goal (gamificação)
// ══════════════════════════════════════════════════════════════════════
// Combina dados da conta inteira (vidaTotal vs período) pra checar marcos
// "all-time" e marcos do período corrente. Reputação ML também conta.

function buildAchievements(agg, totals, history, streak, seller) {
  const totalRev = (agg.total_revenue || 0) + (agg.organic_revenue || 0);
  const totalOrders = (agg.total_orders || 0) + (agg.organic_orders || 0);
  const adsRev = agg.total_revenue || 0;
  const tacosPct = totalRev > 0 ? ((agg.total_cost || 0) / totalRev * 100) : 0;
  const adsPct = totalRev > 0 ? (adsRev / totalRev * 100) : 0;
  const hasAdsCost = (agg.total_cost || 0) > 0;
  const rep = seller?.seller_reputation || {};
  const lvlId = rep.level_id || '';
  const tier = rep.power_seller_status;
  const repTotal = rep.transactions?.total || 0;
  const repPositive = rep.transactions?.ratings?.positive || 0;

  const list = [
    { id: 'first_sale',  ico: '🎯', title: 'Primeira venda',           desc: 'Bater 1 venda no período',                hit: totalOrders >= 1,   target: 1,    actual: totalOrders, unit: 'venda', kind: 'count' },
    { id: 'r1k',         ico: '💰', title: 'R$ 1.000 faturados',        desc: 'Bater R$ 1.000 no período',               hit: totalRev >= 1000,    target: 1000, actual: totalRev, unit: 'money' },
    { id: 'r10k',        ico: '💎', title: 'R$ 10.000 faturados',       desc: 'Bater R$ 10.000 no período',              hit: totalRev >= 10000,   target: 10000, actual: totalRev, unit: 'money' },
    { id: 'r100k',       ico: '🚀', title: 'R$ 100.000 faturados',      desc: 'Bater R$ 100.000 no período',             hit: totalRev >= 100000,  target: 100000, actual: totalRev, unit: 'money' },
    { id: 'streak7',     ico: '🔥', title: '7 dias seguidos',           desc: 'Acompanhar 7 dias seguidos no app',       hit: (streak.best || streak.current) >= 7, target: 7, actual: Math.max(streak.best || 0, streak.current || 0), unit: 'dias' },
    { id: 'streak30',    ico: '👑', title: 'Mês inteiro consistente',   desc: 'Streak de 30 dias',                       hit: (streak.best || 0) >= 30, target: 30, actual: streak.best || 0, unit: 'dias' },
    { id: 'ads1k',       ico: '🎯', title: 'R$ 1.000 via Ads',          desc: 'Faturar R$ 1.000 vindos de Product Ads no período',   hit: adsRev >= 1000,    target: 1000, actual: adsRev, unit: 'money' },
    { id: 'ads10k',      ico: '📣', title: 'R$ 10.000 via Ads',         desc: 'Faturar R$ 10.000 vindos de Product Ads',             hit: adsRev >= 10000,   target: 10000, actual: adsRev, unit: 'money' },
    { id: 'tacos_master_10k',  ico: '🎚️', title: 'TACOS Master — R$ 10k com 2%', desc: 'R$ 10.000+ em Ads com TACOS abaixo de 2% — eficiência alta, não foi sorte', hit: adsRev >= 10000 && tacosPct < 2, target: 1, actual: (adsRev >= 10000 && tacosPct < 2) ? 1 : 0, unit: 'status', kind: 'binary' },
    { id: 'tacos_master_50k',  ico: '🏅', title: 'Ads Champion — R$ 50k com 3%', desc: 'R$ 50.000+ em Ads com TACOS abaixo de 3% — escala com eficiência', hit: adsRev >= 50000 && tacosPct < 3, target: 1, actual: (adsRev >= 50000 && tacosPct < 3) ? 1 : 0, unit: 'status', kind: 'binary' },
    { id: 'low_dep',     ico: '🌱', title: 'Dependência de Ads baixa',   desc: 'Menos de 60% da receita vindo de Ads — orgânico forte (com pelo menos R$ 5k de receita)', hit: totalRev >= 5000 && adsPct < 60, target: 1, actual: (totalRev >= 5000 && adsPct < 60) ? 1 : 0, unit: 'status', kind: 'binary' },
    { id: 'rep_green',   ico: '🛡️', title: 'Reputação verde',           desc: 'Atingir nível verde no Mercado Livre',    hit: lvlId.startsWith('5_') || lvlId.startsWith('4_'), target: 1, actual: lvlId.startsWith('5_') ? 1 : lvlId.startsWith('4_') ? 0.7 : 0, unit: 'level', kind: 'binary' },
    { id: 'mercadolider', ico: '🥇', title: 'MercadoLíder',              desc: 'Bater status MercadoLíder',              hit: !!tier,                target: 1, actual: tier ? 1 : 0, unit: 'status', kind: 'binary' },
    { id: 'platinum',    ico: '💠', title: 'MercadoLíder Platinum',     desc: 'Topo absoluto da plataforma',             hit: tier === 'platinum',   target: 1, actual: tier === 'platinum' ? 1 : tier === 'gold' ? 0.7 : tier === 'silver' ? 0.4 : 0, unit: 'status', kind: 'binary' },
    { id: 'positive95',  ico: '⭐', title: '95%+ avaliações positivas', desc: 'Manter 95%+ de aprovação com pelo menos 10 vendas avaliadas', hit: repPositive >= 0.95 && repTotal >= 10, target: 1, actual: (repPositive >= 0.95 && repTotal >= 10) ? 1 : Math.min(0.9, repPositive || 0), unit: 'status', kind: 'binary' },
    { id: 'official',    ico: '🏬', title: 'Loja Oficial',              desc: 'Sua conta é Loja Oficial registrada no Mercado Livre', hit: !!(STATE.brandInfo && STATE.brandInfo.isOfficial), target: 1, actual: STATE.brandInfo?.isOfficial ? 1 : 0, unit: 'status', kind: 'binary' }
  ];

  // Sort: completed first (gold trophies), then by progress %
  list.forEach(a => {
    a.progress = a.hit ? 1 : (a.kind === 'binary' ? a.actual : Math.min(1, a.actual / a.target));
  });
  list.sort((a, b) => {
    if (a.hit !== b.hit) return a.hit ? -1 : 1;
    return b.progress - a.progress;
  });

  return list;
}

function pickNextGoal(achievements) {
  // Próxima meta: prioriza marcos de receita/venda primeiros (impacto direto),
  // depois por progresso. Achievements de "qualifier" (precisam volume mínimo)
  // não viram next-goal até o user ter alguma tração.
  const PRIORITY_IDS = ['first_sale', 'r1k', 'r10k', 'r100k', 'ads1k', 'ads10k', 'tacos_master_10k', 'tacos_master_50k', 'low_dep', 'streak7', 'streak30'];
  const pending = achievements.filter(a => !a.hit);
  if (!pending.length) return null;
  for (const id of PRIORITY_IDS) {
    const m = pending.find(a => a.id === id);
    if (m && m.progress < 1) return m;
  }
  // Fallback: primeiro pending por progresso (já sorted)
  return pending[0];
}

function fmtAchievementProgress(a) {
  if (a.hit) return 'Conquistado ✓';
  switch (a.unit) {
    case 'money': return `${fmtMoneyCompact(a.actual)} / ${fmtMoneyCompact(a.target)}`;
    case 'x':     return `${fmt(a.actual, 2)}x / ${a.target}x`;
    case 'pct':   return `${Math.round(a.actual * 100)}% / ${Math.round(a.target * 100)}%`;
    case 'dias':  return `${fmtInt(a.actual)} / ${a.target} dias`;
    case 'venda': return `${fmtInt(a.actual)} / ${a.target} ${a.target === 1 ? 'venda' : 'vendas'}`;
    case 'level': return a.actual >= 1 ? 'Atingido' : 'Pendente';
    case 'status':return a.actual >= 1 ? 'Atingido' : 'Pendente';
    default:      return `${fmt(a.progress * 100, 0)}%`;
  }
}

function renderNextGoalCard(achievements, agg) {
  const next = pickNextGoal(achievements);
  if (!next) {
    // Tudo completo!
    return `
      <div class="mfd-next-goal all-done">
        <div class="mfd-next-goal-ico">🏆</div>
        <div>
          <div class="mfd-next-goal-label">VOCÊ COMPLETOU TODOS OS MARCOS</div>
          <div class="mfd-next-goal-title">Lendário. Hora de definir metas pessoais.</div>
        </div>
      </div>
    `;
  }
  const pct = Math.round(next.progress * 100);
  // Mensagem amigável de "quanto falta"
  let missing;
  switch (next.unit) {
    case 'money': missing = `Faltam ${fmtMoneyCompact(next.target - next.actual)} pra desbloquear`; break;
    case 'x':     missing = `${fmt(next.target - next.actual, 2)}x de ROAS pra chegar lá`; break;
    case 'pct':   missing = `Subir mais ${Math.round((next.target - next.actual) * 100)}pp pra desbloquear`; break;
    case 'dias':  missing = `Mais ${fmtInt(next.target - next.actual)} dia${(next.target-next.actual)>1?'s':''} pra completar`; break;
    case 'venda': missing = `${fmtInt(next.target - next.actual)} ${next.target-next.actual===1?'venda':'vendas'} pra desbloquear`; break;
    case 'level':
    case 'status': missing = next.desc; break;
    default: missing = `${pct}% concluído`;
  }
  return `
    <div class="mfd-next-goal">
      <div class="mfd-next-goal-ico">${next.ico}</div>
      <div class="mfd-next-goal-body">
        <div class="mfd-next-goal-label">PRÓXIMA CONQUISTA</div>
        <div class="mfd-next-goal-title">${escapeHtml(next.title)}</div>
        <div class="mfd-next-goal-meta">${escapeHtml(missing)}</div>
        <div class="mfd-next-goal-bar"><div class="mfd-next-goal-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="mfd-next-goal-pct">${pct}%</div>
    </div>
  `;
}

function renderAchievementsCard(achievements) {
  const completed = achievements.filter(a => a.hit).length;
  return `
    <div class="mfd-card mfd-ach-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">🏅</span>Conquistas</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${completed}/${achievements.length} desbloqueadas</span>
      </div>
      <div class="mfd-ach-grid">
        ${achievements.map(a => `
          <div class="mfd-ach ${a.hit ? 'unlocked' : 'locked'}" title="${escapeHtml(a.desc)} · ${escapeHtml(fmtAchievementProgress(a))}">
            <div class="mfd-ach-ico">${a.ico}</div>
            <div class="mfd-ach-name">${escapeHtml(a.title)}</div>
            <div class="mfd-ach-progress">${escapeHtml(fmtAchievementProgress(a))}</div>
            ${!a.hit && a.progress > 0 ? `<div class="mfd-ach-bar"><div class="mfd-ach-fill" style="width:${Math.round(a.progress*100)}%"></div></div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 14d — Top Ads Items (lista de anúncios em campanha)
// ══════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// SECTION 14f — Padrão semanal (qual dia da semana vende mais)
// ══════════════════════════════════════════════════════════════════════

function buildWeekdayPattern(daily) {
  if (!Array.isArray(daily) || !daily.length) return null;
  const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const buckets = labels.map(l => ({ label: l, revenue: 0, sales: 0, count: 0 }));
  for (const d of daily) {
    if (!d.date) continue;
    const dt = new Date(d.date + 'T12:00:00');
    if (isNaN(dt.getTime())) continue;
    const wd = dt.getDay(); // 0 = Dom
    const rev = (+(d.total_amount || 0)) + (+(d.organic_units_amount || 0));
    const units = (+(d.units_quantity || 0)) + (+(d.organic_units_quantity || 0));
    buckets[wd].revenue += rev;
    buckets[wd].sales += units;
    buckets[wd].count += 1;
  }
  // Médias
  buckets.forEach(b => {
    b.avgRev = b.count > 0 ? b.revenue / b.count : 0;
    b.avgSales = b.count > 0 ? b.sales / b.count : 0;
  });
  return buckets;
}

function renderWeekdayPatternCard(daily) {
  const buckets = buildWeekdayPattern(daily);
  if (!buckets) return '';

  const totalRev = buckets.reduce((s, b) => s + b.revenue, 0);
  if (totalRev <= 0) {
    return `
      <div class="mfd-card">
        <div class="mfd-card-header">
          <div class="mfd-card-title"><span class="ico">📅</span>Padrão da semana</div>
        </div>
        <div class="mfd-empty">Sem receita no período pra calcular padrão semanal. Quando começarem as vendas, mostro aqui qual dia da semana mais vende.</div>
      </div>
    `;
  }

  const maxRev = Math.max(...buckets.map(b => b.avgRev));
  const sorted = [...buckets].filter(b => b.avgRev > 0).sort((a, b) => b.avgRev - a.avgRev);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  // Insight texto
  let insight = '';
  if (best && worst && best !== worst) {
    const ratio = worst.avgRev > 0 ? best.avgRev / worst.avgRev : Infinity;
    const dayMap = { 'Dom': 'domingo', 'Seg': 'segunda', 'Ter': 'terça', 'Qua': 'quarta', 'Qui': 'quinta', 'Sex': 'sexta', 'Sáb': 'sábado' };
    const dayPoss = { 'Dom': 'seu domingo', 'Seg': 'sua segunda', 'Ter': 'sua terça', 'Qua': 'sua quarta', 'Qui': 'sua quinta', 'Sex': 'sua sexta', 'Sáb': 'seu sábado' };
    insight = `Em média, <b>${dayPoss[best.label]}</b> rende <b>${fmtMoneyCompact(best.avgRev)}</b> — esse é o dia mais forte.`;
    if (isFinite(ratio) && ratio >= 2) {
      insight += ` Vende <b>${fmt(ratio, 1)}x mais</b> que ${dayMap[worst.label]}, o dia mais fraco.`;
    }
  } else if (best) {
    insight = `<b>${best.label}</b> é o único dia com vendas registradas até agora.`;
  }

  return `
    <div class="mfd-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">📅</span>Padrão da semana</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">média de receita por dia</span>
      </div>
      <div class="mfd-weekday-grid">
        ${buckets.map(b => {
          const pct = maxRev > 0 ? (b.avgRev / maxRev) * 100 : 0;
          const isBest = best && b.label === best.label && b.avgRev > 0;
          return `
            <div class="mfd-weekday ${isBest ? 'best' : ''} ${b.avgRev === 0 ? 'empty' : ''}">
              <div class="mfd-weekday-bar-container">
                <div class="mfd-weekday-bar" style="height:${pct}%"></div>
              </div>
              <div class="mfd-weekday-label">${b.label}</div>
              <div class="mfd-weekday-value">${b.avgRev > 0 ? fmtMoneyCompact(b.avgRev) : '—'}</div>
            </div>
          `;
        }).join('')}
      </div>
      ${insight ? `<div class="mfd-weekday-insight">${insight}</div>` : ''}
    </div>
  `;
}

function renderTopAdsCard(items, agg) {
  if (!Array.isArray(items) || !items.length) {
    return `
      <div class="mfd-card">
        <div class="mfd-card-header">
          <div class="mfd-card-title"><span class="ico">📦</span>Melhores anúncios em campanha</div>
        </div>
        <div class="mfd-empty">Nenhum anúncio com gasto em ads no período. Crie uma campanha pra começar a ver dados aqui.</div>
      </div>
    `;
  }
  return `
    <div class="mfd-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">📦</span>Melhores anúncios em campanha</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${items.length} ${items.length === 1 ? 'anúncio' : 'anúncios'} · ordem: maior receita</span>
      </div>
      <div class="mfd-topads-list">
        ${items.map((it, i) => renderTopAdsItem(it, i, agg)).join('')}
      </div>
    </div>
  `;
}

// Diagnóstico curto e amigável baseado nas métricas reais do anúncio.
// Compara CTR/CVR contra a média da conta (agg) quando disponível.
// Retorna { text: string, tone: 'good'|'warn'|'crit'|'info' } ou null se sem opinião.
function diagnoseTopAd(it, agg) {
  const cost = it.cost || 0;
  const revenue = it.revenue || 0;
  const orgRev = it.organic_revenue || 0;
  const totalRev = revenue + orgRev;
  const roas = it.roas || 0;
  const ctr = it.ctr || 0;
  const cvr = it.cvr || 0;
  const orders = it.orders || 0;
  const clicks = it.clicks || 0;
  const impressions = it.impressions || 0;

  // Sem nenhum gasto: não opina
  if (cost <= 0) return null;

  // Casos críticos primeiro
  if (cost > 0 && clicks === 0) {
    return { tone: 'warn', text: '⚠ Gastou em ads mas ninguém clicou ainda. Pode ser palavra-chave errada ou imagem/título sem apelo — vale revisar o criativo.' };
  }
  if (roas > 0 && roas < 1 && cost >= 20) {
    return { tone: 'crit', text: '🛑 Cada R$ 1 em ads tá voltando menos que 1x — prejuízo direto. Audite a campanha ou pause até ajustar.' };
  }
  if (clicks >= 3 && orders === 0) {
    return { tone: 'warn', text: '⚠ Tem clique chegando mas ninguém comprou. Geralmente: preço acima da concorrência, descrição/fotos fracas ou estoque baixo gerando desconfiança.' };
  }
  // CTR baixo: <50% da média da conta com volume mínimo de exposição
  const avgCtr = Number(agg?.avg_ctr) || 0;
  if (impressions >= 100 && ctr > 0 && avgCtr > 0 && ctr < avgCtr * 0.5) {
    return { tone: 'warn', text: '👁 CTR baixo (' + fmt(ctr, 2) + '%) — menos da metade da média da sua conta (' + fmt(avgCtr, 2) + '%). Costuma ser título sem palavra-chave forte ou imagem de capa pouco atrativa.' };
  }
  // CTR baixo (fallback sem média da conta disponível)
  if (impressions >= 100 && ctr > 0 && avgCtr === 0 && ctr < 0.5) {
    return { tone: 'warn', text: '👁 CTR baixo (' + fmt(ctr, 2) + '%) — muita gente vendo, pouca clicando. Costuma ser título sem palavra-chave forte ou imagem de capa pouco atrativa.' };
  }
  // Vencedores — relativo à média da conta
  const accRoasDiag = Number(agg?.overall_roas) || 0;
  const accCvrDiag = Number(agg?.avg_cvr) || 0;
  if (roas >= 1 && accRoasDiag > 0 && roas >= accRoasDiag * 2 && cost >= 5) {
    return { tone: 'good', text: '🚀 ROAS de ' + fmt(roas, 2) + 'x — mais que o dobro da média da sua conta (' + fmt(accRoasDiag, 2) + 'x). Subir budget aqui multiplica receita rapidamente.' };
  }
  if (roas >= 1 && accRoasDiag > 0 && roas >= accRoasDiag * 1.3 && cost >= 5) {
    return { tone: 'good', text: '✅ ROAS de ' + fmt(roas, 2) + 'x — acima da média da sua conta (' + fmt(accRoasDiag, 2) + 'x). Tá puxando seu retorno geral pra cima.' };
  }
  if (cvr > 0 && accCvrDiag > 0 && cvr >= accCvrDiag * 1.5 && clicks >= 10) {
    return { tone: 'good', text: '🎯 Conversão de ' + fmt(cvr, 2) + '% — acima da média da sua conta (' + fmt(accCvrDiag, 2) + '%). O funil tá fluindo — proteja esse anúncio e replique a fórmula.' };
  }

  // Volume baixo de gasto: dado insuficiente
  if (cost < 5) {
    return { tone: 'info', text: '📊 Volume de ads baixo até agora (' + fmtMoneyCompact(cost) + ' gastos). Em alguns dias dá pra opinar com mais segurança — ou suba o budget pra acelerar dados.' };
  }

  // Default neutro pra quem teve receita
  if (totalRev > 0) {
    return { tone: 'info', text: '📊 Performance dentro do esperado. Acompanhe os próximos dias e ajuste lance se TACOS subir.' };
  }
  // Gastou um pouco, sem retorno mas também não dá pra cravar
  return { tone: 'info', text: '📊 Sem vendas via ads ainda no período. Olhe o anúncio na Análise pra entender se o problema é exposição (CTR/visitas) ou conversão (preço/descrição).' };
}

function renderTopAdsItem(it, idx, agg) {
  const totalRev = (it.revenue || 0) + (it.organic_revenue || 0);
  const roas = it.roas || 0;
  const tacos = it.tacos || 0;

  // Comparação relativa: ROAS contra média da conta, TACOS contra meta (ou média) da conta.
  // Sem baseline → não pinta nem rotula (evita threshold arbitrário).
  const accRoas = Number(agg?.overall_roas) || 0;
  const accTacos = Number(agg?.avg_tacos) || 0;
  const tacosTarget = Number(window._mfdTacosTarget) || accTacos;

  let roasTone = '', roasToneTxt = '';
  if (accRoas > 0 && roas > 0) {
    if (roas >= accRoas * 1.2)      { roasTone = 'good';    roasToneTxt = `acima da média (${fmt(accRoas, 2)}x)`; }
    else if (roas >= accRoas * 0.8) { roasTone = 'neutral'; roasToneTxt = `na média (${fmt(accRoas, 2)}x)`; }
    else                            { roasTone = 'crit';    roasToneTxt = `abaixo da média (${fmt(accRoas, 2)}x)`; }
  }

  let tacosTone = '', tacosToneTxt = '';
  if (tacosTarget > 0 && tacos > 0) {
    const baselineLabel = (window._mfdTacosTarget && Number(window._mfdTacosTarget) > 0) ? 'da sua meta' : 'da média';
    if (tacos <= tacosTarget * 0.8)      { tacosTone = 'good';    tacosToneTxt = `melhor que ${baselineLabel.replace('da ', 'a ')} (${fmt(tacosTarget, 1)}%)`; }
    else if (tacos <= tacosTarget * 1.2) { tacosTone = 'neutral'; tacosToneTxt = `${baselineLabel.replace('da ', 'na ')} (${fmt(tacosTarget, 1)}%)`; }
    else                                 { tacosTone = 'crit';    tacosToneTxt = `acima ${baselineLabel} (${fmt(tacosTarget, 1)}%)`; }
  }
  const safePerma = (it.permalink || '').replace(/"/g, '');
  const titleEsc = escapeHtml(it.title || it.item_id || '—');
  const thumb = it.thumbnail
    ? `<img src="${escapeHtml(it.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none';" />`
    : `<div class="mfd-topads-noimg">📷</div>`;
  const diag = diagnoseTopAd(it, agg);

  return `
    <div class="mfd-topads-item">
      <div class="mfd-topads-rank">${idx + 1}</div>
      <div class="mfd-topads-thumb">${thumb}</div>
      <div class="mfd-topads-body">
        <div class="mfd-topads-title" title="${titleEsc}">${titleEsc}</div>
        <div class="mfd-topads-meta">
          <span class="mfd-topads-id">${escapeHtml(it.item_id || '—')}</span>
          ${it.catalog_listing ? '<span class="mfd-topads-tag tag-cat">catálogo</span>' : ''}
          ${it.current_level ? `<span class="mfd-topads-tag">${escapeHtml(it.current_level)}</span>` : ''}
        </div>
      </div>
      <div class="mfd-topads-metrics">
        <div class="mfd-topads-metric" title="Receita total gerada pelo anúncio no período (orgânica + via Ads)">
          <div class="mfd-topads-metric-lb">Receita</div>
          <div class="mfd-topads-metric-vl">${fmtMoneyCompact(totalRev)}</div>
        </div>
        <div class="mfd-topads-metric" title="Quanto você gastou em Ads nesse anúncio no período">
          <div class="mfd-topads-metric-lb">Gasto Ads</div>
          <div class="mfd-topads-metric-vl">${fmtMoneyCompact(it.cost || 0)}</div>
        </div>
        <div class="mfd-topads-metric" title="ROAS = Retorno sobre o gasto em Ads (receita ÷ gasto). Comparado contra a média da sua conta — anúncios acima da média rendem mais por real investido.">
          <div class="mfd-topads-metric-lb">ROAS</div>
          <div class="mfd-topads-metric-vl tone-${roasTone}">${fmt(roas, 2)}x</div>
          ${roasToneTxt ? `<div class="mfd-topads-metric-tone tone-${roasTone}">${roasToneTxt}</div>` : ''}
        </div>
        <div class="mfd-topads-metric" title="TACOS = % da receita total gasta em Ads. Comparado com a meta configurada (ou média da conta se não houver meta). Quanto menor, mais saudável.">
          <div class="mfd-topads-metric-lb">TACOS</div>
          <div class="mfd-topads-metric-vl tone-${tacosTone}">${fmt(tacos, 1)}%</div>
          ${tacosToneTxt ? `<div class="mfd-topads-metric-tone tone-${tacosTone}">${tacosToneTxt}</div>` : ''}
        </div>
      </div>
      <div class="mfd-topads-actions">
        ${safePerma ? `<a href="${escapeHtml(safePerma)}" target="_blank" rel="noopener" class="mfd-topads-cta-link">Ver no ML ↗</a>` : ''}
        <button class="mfd-op-cta" data-tool="analyzer" data-item-id="${escapeHtml(it.item_id || '')}">Analisar</button>
      </div>
      ${diag ? `<div class="mfd-topads-diag tone-${diag.tone}">${escapeHtml(diag.text)}</div>` : ''}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 14e — Últimas avaliações (reviews dos top anúncios)
// ══════════════════════════════════════════════════════════════════════

function _starsHtml(rate) {
  const r = Math.round(rate || 0);
  return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r);
}

function _relativeDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'hoje';
    if (days === 1) return 'ontem';
    if (days < 7) return `há ${days} dias`;
    if (days < 30) return `há ${Math.floor(days/7)} ${Math.floor(days/7) === 1 ? 'semana' : 'semanas'}`;
    if (days < 365) return `há ${Math.floor(days/30)} ${Math.floor(days/30) === 1 ? 'mês' : 'meses'}`;
    return `há ${Math.floor(days/365)} ano${Math.floor(days/365) > 1 ? 's' : ''}`;
  } catch (_) { return ''; }
}

function renderReviewsCard(items, reviewsMap) {
  if (!Array.isArray(items) || !items.length) return '';
  // Filtra só itens que têm pelo menos 1 review
  const withReviews = items
    .map(it => ({ item: it, rev: reviewsMap?.[it.item_id] }))
    .filter(x => x.rev && x.rev.total > 0);

  // Header summary global
  let totalReviews = 0, sumRate = 0;
  Object.values(reviewsMap || {}).forEach(r => {
    if (r && r.total > 0) {
      totalReviews += r.total;
      sumRate += (r.rating_average || 0) * r.total;
    }
  });
  const overallAvg = totalReviews > 0 ? sumRate / totalReviews : 0;

  if (!withReviews.length) {
    return `
      <div class="mfd-card">
        <div class="mfd-card-header">
          <div class="mfd-card-title"><span class="ico">⭐</span>Últimas avaliações</div>
        </div>
        <div class="mfd-empty">Seus top anúncios ainda não têm avaliações de compradores. Cada venda concluída pode virar uma — peça aos clientes pra avaliar.</div>
      </div>
    `;
  }

  return `
    <div class="mfd-card mfd-reviews-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">⭐</span>Últimas avaliações dos seus campeões</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">
          ${overallAvg > 0 ? `${fmt(overallAvg, 1)}★ médio` : ''} · ${fmtInt(totalReviews)} avaliações no total
        </span>
      </div>
      <div class="mfd-reviews-list">
        ${withReviews.slice(0, 5).map(({ item, rev }) => renderReviewItem(item, rev)).join('')}
      </div>
    </div>
  `;
}

function renderReviewItem(item, rev) {
  const stars = _starsHtml(rev.rating_average);
  const latest = rev.latest;
  const thumb = item.thumbnail
    ? `<img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none';" />`
    : `<div class="mfd-topads-noimg">📷</div>`;

  return `
    <div class="mfd-review-item">
      <div class="mfd-review-thumb">${thumb}</div>
      <div class="mfd-review-body">
        <div class="mfd-review-title" title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || item.item_id || '—')}</div>
        <div class="mfd-review-rating">
          <span class="mfd-review-stars">${stars}</span>
          <b class="mfd-review-avg">${fmt(rev.rating_average, 1)}</b>
          <span class="mfd-review-total">· ${fmtInt(rev.total)} ${rev.total === 1 ? 'avaliação' : 'avaliações'}</span>
        </div>
        ${latest ? `
          <div class="mfd-review-latest">
            <div class="mfd-review-quote">
              <span class="mfd-review-quote-stars">${_starsHtml(latest.rate)}</span>
              ${latest.title ? `<b>${escapeHtml(latest.title)}.</b> ` : ''}
              <span>${escapeHtml((latest.content || '').slice(0, 200))}${(latest.content || '').length > 200 ? '…' : ''}</span>
            </div>
            <div class="mfd-review-date">${escapeHtml(_relativeDate(latest.date))}</div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function renderOpportunities(ops) {
  if (!ops.length) return '';
  return `
    <div class="mfd-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">🎯</span>Oportunidades pra hoje</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${ops.length} priorizada${ops.length>1?'s':''}</span>
      </div>
      <div class="mfd-ops-list">
        ${ops.map(o => `
          <div class="mfd-op">
            <div class="mfd-op-ico ${o.tone || ''}">${o.ico}</div>
            <div class="mfd-op-body">
              <p class="mfd-op-title">${escapeHtml(o.title)}</p>
              <p class="mfd-op-meta">${o.meta}</p>
            </div>
            ${o.tool
              ? `<button class="mfd-op-cta" data-tool="${escapeHtml(o.tool)}">Abrir</button>`
              : `<button class="mfd-op-cta ghost" disabled style="cursor:default;opacity:.6;">—</button>`}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 16 — Render: PERFORMERS
// ══════════════════════════════════════════════════════════════════════

function renderPerformers(perf) {
  return `
    <div class="mfd-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">🏆</span>Top dias</div>
      </div>
      <div class="mfd-perf-list">
        ${perf.top.length ? perf.top.map(p => `
          <div class="mfd-perf-item">
            <div class="mfd-perf-rank ${p.rank}">${p.rank === 'gold' ? '1' : p.rank === 'silver' ? '2' : '3'}</div>
            <div class="mfd-perf-body">
              <div class="mfd-perf-title">${escapeHtml(p.title)}</div>
              <div class="mfd-perf-meta">${escapeHtml(p.meta)}</div>
            </div>
            <div class="mfd-perf-vl ${p.valueClass || ''}">${p.value}</div>
          </div>
        `).join('') : '<div class="mfd-empty">Sem dias suficientes ainda — volte amanhã.</div>'}
      </div>
    </div>
  `;
}

// Pills visíveis com a lista colapsada (moderações + saúde) — o resto fica
// atrás do "ver todos (+N)" pra não dominar a página em conta problemática.
const PILLS_VISIBLE = 12;

// Nome técnico da moderação (enum da API ML) → rótulo amigável pt-BR.
// Desconhecidos caem no genérico — o motivo/solução abaixo já vem em pt-BR do ML.
function friendlyModerationName(name) {
  const map = {
    'EXACT_DUPLICATE_INTRA_UP': 'Anúncio duplicado',
    'POOR_QUALITY_THUMBNAIL': 'Foto principal de baixa qualidade'
  };
  return map[String(name || '').toUpperCase()] || 'Moderação ativa';
}

function renderModerations() {
  const data = STATE.moderationsData;
  const loading = STATE.moderationsLoading;

  let body;
  if (loading || data === undefined) {
    body = '<div class="mfd-empty">Verificando moderações ativas no Mercado Livre...</div>';
  } else if (data === null) {
    body = '<div class="mfd-empty">Não conseguimos checar moderações agora. Atualize a página pra tentar de novo.</div>';
  } else if (!data.items || data.items.length === 0) {
    body = '<div class="mfd-empty">🎉 Nenhuma moderação ativa no momento — sua conta está limpa.</div>';
  } else {
    const r = data.featured || {};
    const featured = r.item_id ? `
      <a class="mfd-issue-featured bad" href="${escapeHtml(r.url || '#')}" target="_blank">
        <div class="mfd-issue-tag">${escapeHtml(friendlyModerationName(r.name))}</div>
        <div class="mfd-issue-title">${escapeHtml(r.item_id)}</div>
        ${r.reason ? `<div class="mfd-issue-problem"><b>Motivo:</b> ${escapeHtml(r.reason)}</div>` : ''}
        ${r.remedy ? `<div class="mfd-issue-solution"><b>Como resolver:</b> ${escapeHtml(r.remedy)}</div>` : ''}
        <div class="mfd-issue-cta">Abrir análise do anúncio →</div>
      </a>
    ` : '';
    const others = data.items.filter(id => id !== r.item_id);
    const hiddenCount = Math.max(0, others.length - PILLS_VISIBLE);
    const missingNote = data.total > data.items.length ? ` — carregamos os primeiros ${data.items.length}` : '';
    const otherList = others.length ? `
      <div class="mfd-issue-others">
        <small class="mfd-issue-others-label">Outros ${others.length} também com moderação${missingNote}:</small>
        <div class="mfd-issue-others-pills${hiddenCount ? ' collapsed' : ''}">
          ${others.map(id => `<a class="mfd-issue-pill" href="https://app.marketfacil.com.br/analise-anuncio?item=${escapeHtml(id)}" target="_blank">${escapeHtml(id)}</a>`).join('')}
        </div>
        ${hiddenCount ? `<button class="mfd-issue-expand" data-mfd-action="toggle-pills" data-more="ver todos (+${hiddenCount})">ver todos (+${hiddenCount})</button>` : ''}
      </div>
    ` : '';
    body = featured + otherList;
  }

  const count = data?.total || 0;
  const headerLabel = count > 0
    ? `<span class="mfd-issue-count">${count}</span> moderado${count > 1 ? 's' : ''}`
    : '';

  return `
    <div class="mfd-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">⛔</span>Moderações ativas no Mercado Livre</div>
        ${headerLabel ? `<span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${headerLabel}</span>` : ''}
      </div>
      ${body}
    </div>
  `;
}

function patchModerationsCard() {
  const root = document.getElementById(STATE.containerId);
  if (!root) return;
  const headers = root.querySelectorAll('.mfd-card-header .mfd-card-title');
  for (const h of headers) {
    if (h.textContent.includes('Moderações ativas')) {
      const card = h.closest('.mfd-card');
      const next = document.createElement('div');
      next.innerHTML = renderModerations();
      const fresh = next.querySelector('.mfd-card');
      if (fresh && card) card.replaceWith(fresh);
      return;
    }
  }
}

function renderAdsWithIssues() {
  const data = STATE.issuesData;
  const loading = STATE.issuesLoading;

  let body;
  if (loading || data === undefined) {
    body = '<div class="mfd-empty">Verificando a saúde dos seus anúncios...</div>';
  } else if (data === null) {
    // Fetch falhou — NÃO afirmar que está tudo limpo
    body = '<div class="mfd-empty">Não conseguimos verificar a saúde dos anúncios agora. Atualize a página pra tentar de novo.</div>';
  } else if (!data.slots || data.slots.length === 0) {
    body = '<div class="mfd-empty">🎉 Nenhum anúncio com problema de saúde detectado.</div>';
  } else {
    const r = data.result || {};
    const totalCount = data.slots.length;
    const statusLabel = r.status === 'unhealthy' ? 'Crítico' : 'Atenção';
    const statusClass = r.status === 'unhealthy' ? 'bad' : 'warn';
    // Monta o link da Análise com ?item= (abre já preenchido) em vez da URL do proxy
    const featHref = r.id
      ? `https://app.marketfacil.com.br/analise-anuncio?item=${encodeURIComponent(r.id)}`
      : (r.url || '#');
    const featured = r.id ? `
      <a class="mfd-issue-featured ${statusClass}" href="${escapeHtml(featHref)}" target="_blank">
        <div class="mfd-issue-tag">${statusLabel}</div>
        <div class="mfd-issue-title">${escapeHtml(r.name || r.id)}</div>
        ${r.problem ? `<div class="mfd-issue-problem"><b>Problema:</b> ${escapeHtml(r.problem)}</div>` : ''}
        ${r.solution ? `<div class="mfd-issue-solution">${escapeHtml(r.solution)}</div>` : ''}
        <div class="mfd-issue-cta">Abrir análise do anúncio →</div>
      </a>
    ` : '';
    const others = data.slots.filter(id => id !== r.id);
    const hiddenCount = Math.max(0, others.length - PILLS_VISIBLE);
    const otherList = others.length ? `
      <div class="mfd-issue-others">
        <small class="mfd-issue-others-label">Outros ${others.length} com sintoma parecido:</small>
        <div class="mfd-issue-others-pills${hiddenCount ? ' collapsed' : ''}">
          ${others.map(id => `<a class="mfd-issue-pill" href="https://app.marketfacil.com.br/analise-anuncio?item=${escapeHtml(id)}" target="_blank">${escapeHtml(id)}</a>`).join('')}
        </div>
        ${hiddenCount ? `<button class="mfd-issue-expand" data-mfd-action="toggle-pills" data-more="ver todos (+${hiddenCount})">ver todos (+${hiddenCount})</button>` : ''}
      </div>
    ` : '';
    body = featured + otherList;
  }

  const count = data?.slots?.length || 0;
  const headerLabel = count > 0
    ? `<span class="mfd-issue-count">${count}</span> com problema`
    : '';

  return `
    <div class="mfd-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">⚠️</span>Anúncios com problema de saúde</div>
        ${headerLabel ? `<span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${headerLabel}</span>` : ''}
      </div>
      ${body}
    </div>
  `;
}

function patchAdsWithIssues() {
  const root = document.getElementById(STATE.containerId);
  if (!root) return;
  // Encontra o card de "Anúncios com problema" e re-renderiza
  const headers = root.querySelectorAll('.mfd-card-header .mfd-card-title');
  for (const h of headers) {
    if (h.textContent.includes('Anúncios com problema')) {
      const card = h.closest('.mfd-card');
      const next = document.createElement('div');
      next.innerHTML = renderAdsWithIssues();
      const fresh = next.querySelector('.mfd-card');
      if (fresh && card) card.replaceWith(fresh);
      return;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 17 — Render: ACTIVITY HEATMAP (90 dias)
// ══════════════════════════════════════════════════════════════════════

function renderHeatmap(history) {
  // Constrói 91 dias, mais recente à direita
  const today = todayStr();
  const cells = [];
  for (let i = 90; i >= 0; i--) {
    const d = ymdAddDays(today, -i);
    cells.push({ date: d, level: 0 });
  }
  // Mark visited days
  const visited = new Set(history.map(h => h.date));
  cells.forEach(c => {
    if (visited.has(c.date)) {
      // intensidade simples: nível 3 sempre que visitou (poderia variar por # snapshots)
      c.level = 3;
    }
  });
  // Group em colunas de 7 (semana)
  const cols = [];
  for (let i = 0; i < cells.length; i += 7) {
    cols.push(cells.slice(i, i + 7));
  }

  const visited30 = cells.slice(-30).filter(c => c.level > 0).length;
  const visited90 = cells.filter(c => c.level > 0).length;

  return `
    <div class="mfd-card mfd-heatmap-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">📅</span>Sua presença nos últimos 90 dias</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${visited30}/30 últimos · ${visited90}/90 totais</span>
      </div>
      <div class="mfd-heatmap-grid">
        ${cols.map(col => `
          <div class="mfd-heat-col">
            ${col.map(cell => `
              <div class="mfd-heat-cell ${cell.level ? 'l'+cell.level : ''} ${cell.date === today ? 'today' : ''}"
                   title="${cell.date}${cell.level ? ' — você abriu o app' : ''}"></div>
            `).join('')}
          </div>
        `).join('')}
      </div>
      <div class="mfd-heat-meta">
        <span><b>${visited30}</b> dias ativos no último mês ${visited30 >= 18 ? '· consistência de elite 💪' : ''}</span>
        <div class="mfd-heat-legend">
          <span>menos</span>
          <span class="lvl mfd-heat-cell"></span>
          <span class="lvl mfd-heat-cell l1"></span>
          <span class="lvl mfd-heat-cell l2"></span>
          <span class="lvl mfd-heat-cell l3"></span>
          <span class="lvl mfd-heat-cell l4"></span>
          <span>mais</span>
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 18 — Render: DAILY INSIGHT
// ══════════════════════════════════════════════════════════════════════

function renderDailyInsight(insight) {
  if (!insight) return '';
  const cta = insight.cta
    ? `<button class="mfd-insight-cta" data-tool="${escapeHtml(insight.cta.tool)}">${escapeHtml(insight.cta.label)} →</button>`
    : '';
  const txt = typeof insight.text === 'function' ? insight.text() : insight.text;
  return `
    <div class="mfd-insight-daily">
      <div class="mfd-insight-ico">💡</div>
      <div class="mfd-insight-body">
        <div class="mfd-insight-label">Insight do dia</div>
        <p class="mfd-insight-text">${txt}</p>
        ${cta}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 19 — Render: CHECKLIST
// ══════════════════════════════════════════════════════════════════════

function renderChecklist(items) {
  const done = items.filter(i => i.done).length;
  const pct = items.length ? (done / items.length) * 100 : 0;
  return `
    <div class="mfd-card">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">✅</span>Checklist do dia</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${done}/${items.length}</span>
      </div>
      <div class="mfd-check-progress">
        <span>progresso</span>
        <div class="mfd-check-progress-bar"><div class="mfd-check-progress-fill" style="width:${pct}%;"></div></div>
        <span style="font-family:'DM Mono',monospace;font-weight:700;">${Math.round(pct)}%</span>
      </div>
      <div class="mfd-checklist-list">
        ${items.map(i => `
          <div class="mfd-check-item ${i.done ? 'done' : ''}" data-check-id="${escapeHtml(i.id)}">
            <div class="mfd-check-box">${i.done ? '✓' : ''}</div>
            <div class="mfd-check-text">${escapeHtml(i.text)}</div>
            ${i.tool
              ? `<button class="mfd-check-meta mfd-check-open" data-tool="${escapeHtml(i.tool)}" data-check-done="${escapeHtml(i.id)}">${i.meta || '→ abrir'}</button>`
              : `<div class="mfd-check-meta">${i.meta || ''}</div>`}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 20 — Render: TOOLS GRID
// ══════════════════════════════════════════════════════════════════════

const TOOLS = [
  { id: 'analyzer',    name: 'Análise de Anúncio',       desc: 'Diagnóstico completo: MLB, MLBU e catálogo',           ico: '🔍', tone: '',       href: '/analise-anuncio' },
  { id: 'tags',        name: 'Auditoria de Tags',        desc: 'Escaneia a conta toda em busca de tags negativas',     ico: '🚨', tone: 'red',    href: '/auditoria-tags' },
  { id: 'keyword',     name: 'Agente de Palavras-Chave', desc: 'Palavras pra preencher ficha técnica do anúncio',      ico: '🔑', tone: 'yellow', href: '/agente-palavras-chave' },
  { id: 'description', name: 'Agente de Descrições',     desc: 'Gera descrições otimizadas pro anúncio',               ico: '📝', tone: 'yellow', href: 'https://chatgpt.com/g/g-6789d6382c7481918a477d7dc829a0bd-agente-de-descricoes-otimizadas' },
  { id: 'planner',     name: 'Planejador de Ads',        desc: 'TACOS, ROAS e auditoria de campanhas',                 ico: '🎯', tone: 'green',  href: '/planejador-ads' },
  { id: 'catalog',     name: 'Concorrência de Catálogo', desc: 'Quem está acima e abaixo do seu produto',              ico: '⚔️', tone: 'red',    href: '/concorrencia-catalogo' },
  { id: 'finder',      name: 'Buscador de Catálogos',    desc: 'Catálogos abertos com demanda real',                   ico: '💎', tone: 'purple', href: '/buscador-catalogos' },
  { id: 'resize',      name: 'Redimensionar Imagens',    desc: 'Adequa imagens ao padrão ML — remove penalidades',     ico: '🖼️', tone: '',       href: '/redimensionar-imagem' },
  { id: 'autocomplete',name: 'Palavras-Chave Autocompletar', desc: 'Termos reais que compradores digitam',             ico: '⌨️', tone: 'yellow', href: '/palavras-autocompletar' },
  { id: 'category-kw', name: 'Palavras-Chave da Categoria',  desc: 'Tendências em alta no seu nicho',                  ico: '📈', tone: 'yellow', href: '/palavras-categoria' },
  { id: 'inpi',        name: 'Busca INPI',               desc: 'Verifica risco de marca antes de criar produto',       ico: '🏷', tone: '',        href: '/busca-inpi' },
  { id: 'ean',         name: 'Gerador de EAN',           desc: 'Cria códigos EAN pra novos catálogos',                 ico: '🔢', tone: '',        href: '/gerador-ean' }
];

function renderToolsGrid(state) {
  const badges = state.badges || {};
  const featured = state.featured === true;
  return `
    <div class="mfd-card ${featured ? 'mfd-tools-featured' : ''}">
      <div class="mfd-card-header">
        <div class="mfd-card-title"><span class="ico">🧰</span>${featured ? 'Atalhos pras ferramentas' : 'Ferramentas do app'}</div>
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600;">${TOOLS.length} disponíveis</span>
      </div>
      <div class="mfd-tools-grid">
        ${TOOLS.map(t => {
          const badge = badges[t.id] || (t.badge ? { type: t.badge, label: t.badge } : null);
          const tag = t.href ? 'a' : 'button';
          const isExternal = !!t.href && /^https?:/i.test(t.href);
          const linkAttr = t.href ? `href="${escapeHtml(t.href)}"${isExternal ? ' target="_blank" rel="noopener"' : ''}` : '';
          return `
            <${tag} class="mfd-tool" data-tool="${t.id}" ${linkAttr}>
              <div class="mfd-tool-top">
                <div class="mfd-tool-ico ${t.tone}">${t.ico}</div>
                ${badge ? `<span class="mfd-tool-badge ${badge.type || ''}">${escapeHtml(badge.label || badge)}</span>` : ''}
              </div>
              <div class="mfd-tool-name">${escapeHtml(t.name)}</div>
              <div class="mfd-tool-desc">${escapeHtml(t.desc)}</div>
            </${tag}>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 21 — Render: FOOTER
// ══════════════════════════════════════════════════════════════════════

function renderFooter(period) {
  const ts = new Date();
  return `
    <div class="mfd-footer">
      <span>Período: últimos ${period} dias · Marketfacil Dashboard</span>
      <span>${String(ts.getDate()).padStart(2,'0')}/${String(ts.getMonth()+1).padStart(2,'0')}/${ts.getFullYear()} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}</span>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 22 — Render: LOADING / ERROR
// ══════════════════════════════════════════════════════════════════════

function renderLoading(msg) {
  return `
    <div class="mfd-loading">
      <div class="mfd-orbital">
        <div class="mfd-orbital-ring"></div>
        <div class="mfd-orbital-ring"></div>
        <div class="mfd-orbital-dot"></div>
      </div>
      <p class="mfd-loading-msg">${escapeHtml(msg || 'Carregando seu painel...')}</p>
      <div class="mfd-loading-bar"><div class="mfd-loading-bar-fill"></div></div>
    </div>
  `;
}

function renderError(err) {
  // Estados específicos baseados no tipo de falha
  const status = err && err.status;
  if (status === 401 || status === 403) {
    return `
      <div class="mfd-error" style="flex-wrap:wrap;">
        <span style="font-size:1.4rem;">🔌</span>
        <div style="flex:1;min-width:240px;">
          <b>Sua conta do Mercado Livre precisa ser reconectada.</b><br>
          <small style="font-weight:500;color:var(--red-dark);opacity:.8;">O token de acesso expirou (${status}). Reconectar leva 30 segundos e nada se perde.</small>
        </div>
        <button class="mfd-error-retry" data-tool="reconnect">Reconectar conta ML</button>
      </div>
    `;
  }
  if (err && /aguard/i.test(err.message || '')) {
    return `
      <div class="mfd-loading">
        <div class="mfd-orbital">
          <div class="mfd-orbital-ring"></div>
          <div class="mfd-orbital-ring"></div>
          <div class="mfd-orbital-dot"></div>
        </div>
        <p class="mfd-loading-msg">Aguardando autenticação do Mercado Livre…</p>
        <div class="mfd-loading-bar"><div class="mfd-loading-bar-fill"></div></div>
        <small style="margin-top:14px;color:var(--text-muted);font-size:.74rem;max-width:340px;text-align:center;">
          Se isso demorar, verifique se a página está configurada para passar seu token. Em caso de dúvida, fale com o suporte.
        </small>
      </div>
    `;
  }
  // Nunca mostrar err.message cru (endpoint interno / inglês do browser)
  const friendly = status === 429
    ? 'Muitas atualizações em pouco tempo. Espere um minutinho e tente de novo.'
    : (status >= 500
      ? 'Nossos servidores tiveram um soluço. Tente de novo em instantes.'
      : (err && /failed to fetch|networkerror|load failed/i.test(err.message || '')
        ? 'Sem conexão com o servidor — verifique sua internet e tente de novo.'
        : 'Algo deu errado ao carregar seus dados. Tente de novo em instantes.'));
  return `
    <div class="mfd-error">
      <span style="font-size:1.2rem;">⚠️</span>
      <div><b>Não foi possível carregar.</b> ${escapeHtml(friendly)}</div>
      <button class="mfd-error-retry" id="mfd-retry">Tentar de novo</button>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 22.5 — Onboarding mode (cliente sem ML / sem dados)
// ══════════════════════════════════════════════════════════════════════

function renderOnboardingBanner(mode) {
  // mode: 'no-token' | 'no-ads' — fica EM CIMA do dashboard, não substitui
  const noToken = mode === 'no-token';
  const title = noToken
    ? '👋 Bem-vindo ao Marketfacil!'
    : '🚀 Sua conta está conectada — vamos começar';
  const subtitle = noToken
    ? 'Conecte sua conta do Mercado Livre pra desbloquear os dados abaixo.'
    : 'Faça os primeiros passos pra começar a ver métricas reais aqui embaixo.';

  const steps = noToken
    ? [
        { title: 'Conectar Mercado Livre', cta: 'Conectar agora', href: '/minha-conta', primary: true },
        { title: 'Analisar 1 anúncio', cta: 'Análise', href: '/analise-anuncio' },
        { title: 'Verificar tags negativas', cta: 'Auditoria', href: '/auditoria-tags' },
        { title: 'Encontrar palavras pra ficha técnica', cta: 'Agente', href: '/agente-palavras-chave' }
      ]
    : [
        { title: '✓ Mercado Livre conectado', done: true },
        { title: 'Analisar 1 anúncio', cta: 'Análise', href: '/analise-anuncio', primary: true },
        { title: 'Verificar tags negativas', cta: 'Auditoria', href: '/auditoria-tags' },
        { title: 'Buscar catálogos', cta: 'Buscar', href: '/buscador-catalogos' }
      ];

  const stepsHtml = steps.map(s => `
    <a class="mfd-onbb-pill ${s.done ? 'done' : ''} ${s.primary ? 'primary' : ''}" href="${s.href || '#'}">
      <span class="mfd-onbb-pill-title">${escapeHtml(s.title)}</span>
      ${s.cta ? `<span class="mfd-onbb-pill-cta">${escapeHtml(s.cta)} →</span>` : ''}
    </a>
  `).join('');

  return `
    <div class="mfd-onbb">
      <div class="mfd-onbb-header">
        <div>
          <div class="mfd-onbb-title">${title}</div>
          <div class="mfd-onbb-subtitle">${subtitle}</div>
        </div>
      </div>
      <div class="mfd-onbb-steps">${stepsHtml}</div>
    </div>
  `;
}

function renderNoTokenPreview() {
  const features = [
    { icon: '📊', title: 'Visão Geral do Período', desc: 'Receita, vendas, ROAS, TACOS — total, orgânico e ads em colunas.' },
    { icon: '💚', title: 'Saúde da Conta', desc: 'Score 0–100 com 4 indicadores reais da sua conta no Mercado Livre.' },
    { icon: '⭐', title: 'Reputação + Loja Oficial', desc: 'Vermelho/amarelo/verde, MercadoLíder, selos da sua conta.' },
    { icon: '📈', title: 'Tráfego e Vendas Diárias', desc: 'Gráficos separando orgânico de Ads, dia a dia.' },
    { icon: '⚠️', title: 'Anúncios com Problema', desc: 'Pausados, com tags negativas, moderações ativas — tudo no mesmo lugar.' },
    { icon: '🎯', title: 'Checklist + Insight do Dia', desc: 'O que fazer hoje pra mexer no ponteiro.' }
  ];
  const cardsHtml = features.map(f => `
    <div class="mfd-ntp-card">
      <div class="mfd-ntp-icon">${f.icon}</div>
      <div class="mfd-ntp-title">${escapeHtml(f.title)}</div>
      <div class="mfd-ntp-desc">${escapeHtml(f.desc)}</div>
    </div>
  `).join('');
  return `
    <div class="mfd-ntp">
      <div class="mfd-ntp-header">
        <div class="mfd-ntp-eyebrow">Prévia do que você vai ver</div>
        <div class="mfd-ntp-sub">Conecte sua conta do Mercado Livre pra desbloquear todos esses dados em tempo real.</div>
      </div>
      <div class="mfd-ntp-grid">${cardsHtml}</div>
      <div class="mfd-ntp-cta-row">
        <button class="mfd-ntp-cta" data-tool="reconnect">🔌 Conectar Mercado Livre agora</button>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 23 — Aggregate render & event wiring
// ══════════════════════════════════════════════════════════════════════

function renderDashboard() {
  const root = document.getElementById(STATE.containerId);
  if (!root) return;
  if (!STATE.token) {
    // Tenta autodescoberta antes de mostrar onboarding
    if (autoDiscoverToken()) {
      loadAndRender(STATE.period);
      return;
    }
    // Sem token: renderiza dashboard zerado com banner gigante de onboarding em cima
    STATE.data = STATE.data || { aggregated: {}, totals: {}, daily_aggregated: [], campaigns: [] };
    STATE._onbBanner = 'no-token';
  } else {
    delete STATE._onbBanner;
  }
  if (STATE.loading) {
    root.innerHTML = `<div class="mfd-wrapper">${renderLoading()}</div>`;
    return;
  }
  if (STATE.error) {
    root.innerHTML = `<div class="mfd-wrapper">${renderError(STATE.error)}</div>`;
    wireRetry(root);
    return;
  }

  // Sem token: NÃO renderiza cards fake com "—". Só banner + preview do que vai aparecer.
  if (STATE._onbBanner === 'no-token') {
    root.innerHTML = `
      <div class="mfd-wrapper">
        ${renderOnboardingBanner('no-token')}
        ${renderNoTokenPreview()}
        ${renderFooter(STATE.period)}
      </div>
    `;
    wireRetry(root);
    return;
  }

  const data = STATE.data;
  if (!data) {
    root.innerHTML = `<div class="mfd-wrapper">${renderLoading()}</div>`;
    return;
  }

  // Conta com ML conectado mas sem anúncios → banner de "primeiros passos" no topo do dashboard.
  // countsUnknown = a contagem FALHOU; não mostrar onboarding pra vendedor estabelecido.
  const _activeTot = data.totals?.activeItems || 0;
  const _pausedTot = data.totals?.pausedItems || 0;
  if (STATE.token && (_activeTot + _pausedTot === 0) && !data.totals?.countsUnknown) {
    STATE._onbBanner = 'no-ads';
  } else if (STATE._onbBanner === 'no-ads') {
    delete STATE._onbBanner;
  }

  const sid = STATE.sellerId;
  const agg = data.aggregated || {};
  const totals = {
    activeItems: data.totals?.activeItems || 0,
    pausedItems: data.totals?.pausedItems || 0,
    itemsWithAds: data.totals?.itemsWithAds || 0,
    countsUnknown: !!data.totals?.countsUnknown
  };
  const prevSnap = STATE.prevSnapshot;
  const streak = rtGetStreak(sid);
  const history = rtGetHistory(sid);
  const breakdown = computeHealthBreakdown(agg, totals, prevSnap, streak);
  const score = breakdown.total;

  const alerts = buildAlerts(agg, totals, prevSnap, sid);
  const ops = buildOpportunities(agg, totals, prevSnap, streak);
  const perf = buildPerformers(agg, data.daily_aggregated || []);
  const insight = pickInsight({
    agg, totals, prevSnap, streak,
    weekday: new Date().getDay(),
    hasOpps: ops.length > 0
  }, sid);
  const checklist = buildChecklist(agg, totals, sid);

  const seller = STATE.sellerInfo || {};

  const html = `
    <div class="mfd-wrapper">
      ${STATE._onbBanner ? renderOnboardingBanner(STATE._onbBanner) : ''}
      <div class="mfd-row mfd-hero-checklist-row">
        ${renderHero(seller, agg, totals, streak, history)}
        ${renderChecklist(checklist)}
      </div>
      <div class="mfd-row mfd-health-rep-row">
        ${renderHealthCard(score, breakdown)}
        ${renderReputationCard(seller)}
      </div>
      ${renderOrganicVsAds(agg)}
      ${insight ? renderDailyInsight(insight) : ''}
      ${renderPeriodBar()}
      ${renderSinceLastVisitBanner(buildSinceLastVisitChanges(history, agg, score, streak))}
      ${renderAlerts(alerts)}
      ${renderSummaryCard(agg, totals, data.daily_aggregated || [], prevSnap, STATE.period, seller)}
      ${renderToolsGrid({ badges: buildToolBadges(totals, alerts) })}
      ${(() => { const achs = buildAchievements(agg, totals, history, streak, seller); return renderNextGoalCard(achs, agg) + renderAchievementsCard(achs); })()}
      ${renderChartCard()}
      <div class="mfd-row split-even">
        ${renderTrafficChartCard()}
        ${renderSalesChartCard()}
      </div>
      ${renderWeekdayPatternCard(data.daily_aggregated || [])}
      ${renderTopAdsCard(STATE.topAdsItems || [], agg)}
      ${renderReviewsCard(STATE.topAdsItems || [], STATE.reviewsMap || {})}
      <div class="mfd-row mfd-pair-row">
        ${renderAdsWithIssues()}
        ${renderModerations()}
      </div>
      <div class="mfd-row mfd-pair-row">
        ${renderPerformers(perf)}
        ${renderHeatmap(history)}
      </div>
      ${renderFooter(STATE.period)}
      ${renderNotificationDrawer()}
    </div>
  `;
  root.innerHTML = html;
  wireNotifications(root);

  // Mark insight as seen
  if (insight) rtMarkInsightSeen(sid, insight.id);

  // Charts and listeners
  if (window.Chart && data.daily_aggregated) {
    drawRevenueChart(data.daily_aggregated);
    drawTrafficChart(data.daily_aggregated);
    drawSalesChart(data.daily_aggregated);
  }
  wireListeners(root);
}

function buildToolBadges(totals, alerts) {
  const badges = {};
  if (totals.pausedItems > 0) badges.analyzer = { type: '', label: `${totals.pausedItems} pendente${totals.pausedItems>1?'s':''}` };
  const critAlert = alerts.find(a => a.level === 'crit');
  if (critAlert) badges.planner = { type: '', label: '!' };
  return badges;
}

function wireRetry(root) {
  const btn = root.querySelector('#mfd-retry');
  if (btn) btn.addEventListener('click', () => loadAndRender(STATE.period));
  root.querySelectorAll('[data-tool]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.mfd-alert-x')) return;
      const tool = el.dataset.tool;
      if (tool) handleToolClick(tool, el);
    });
  });
}

function wireListeners(root) {
  // Period tabs
  root.querySelectorAll('.mfd-period-tab[data-period]').forEach(tab => {
    tab.addEventListener('click', () => {
      const p = parseInt(tab.dataset.period, 10);
      if (!isNaN(p) && p !== STATE.period) loadAndRender(p);
    });
  });

  // Refresh button
  const refreshBtn = root.querySelector('#mfd-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadAndRender(STATE.period, /*force*/ true));

  // Tool CTAs
  root.querySelectorAll('[data-tool]').forEach(el => {
    el.addEventListener('click', (e) => {
      // Não dispara se for o botão x
      if (e.target.closest('.mfd-alert-x')) return;
      // Item do checklist com tool: marca como feito antes de navegar
      const checkId = el.dataset.checkDone;
      if (checkId && STATE.sellerId) {
        const stored = rtGetChecklist(STATE.sellerId);
        const t = stored && stored.items.find(x => x.id === checkId);
        if (t && !t.done) { t.done = true; rtSetChecklist(STATE.sellerId, stored.items); }
      }
      const tool = el.dataset.tool;
      if (tool) handleToolClick(tool, el);
    });
  });

  // Dismiss alerts
  root.querySelectorAll('[data-dismiss-alert]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.dismissAlert;
      if (id && STATE.sellerId) {
        rtDismissAlert(STATE.sellerId, id);
        renderDashboard();
      }
    });
  });

  // Checklist toggle
  root.querySelectorAll('[data-check-id]').forEach(item => {
    item.addEventListener('click', (e) => {
      // O botão "→ abrir" (data-tool) tem handler próprio — aqui só o toggle
      if (e.target.closest('[data-tool]')) return;
      const id = item.dataset.checkId;
      const sid = STATE.sellerId;
      if (!id || !sid) return;
      const stored = rtGetChecklist(sid);
      if (!stored) return;
      const target = stored.items.find(x => x.id === id);
      if (!target) return;
      target.done = !target.done;
      rtSetChecklist(sid, stored.items);
      renderDashboard();
    });
  });

  // Tooltips ⓘ: alinha pela borda quando perto do limite direito da tela
  root.querySelectorAll('.mfd-tip').forEach(tip => {
    const alignTip = () => {
      const r = tip.getBoundingClientRect();
      if (r.right + 150 > window.innerWidth) tip.setAttribute('data-tip-align', 'right');
      else tip.removeAttribute('data-tip-align');
    };
    tip.addEventListener('mouseenter', alignTip);
    tip.addEventListener('focusin', alignTip);
  });
}

function handleToolClick(tool, el) {
  // Hook configurável: Bubble pode definir window.MFD_onToolClick(tool, ctx)
  if (typeof window.MFD_onToolClick === 'function') {
    try { window.MFD_onToolClick(tool, { el, state: STATE }); return; } catch (_) {}
  }
  // Link externo (ex.: Agente de Descrições): o <a target=_blank> já navega
  const toolDef = TOOLS.find(t => t.id === tool);
  if (toolDef && toolDef.href && /^https?:/i.test(toolDef.href)) return;
  // Fallback: deriva o mapa do array TOOLS (fonte única de verdade dos paths)
  // + extras que não aparecem no grid. window.MFD_TOOL_PATHS sobrescreve tudo.
  const derived = {};
  TOOLS.forEach(t => { if (t.href && t.href.startsWith('/')) derived[t.id] = t.href; });
  derived.image = '/gerar-imagem';
  derived.reconnect = '/minha-conta';
  const map = window.MFD_TOOL_PATHS || derived;
  const path = map[tool];
  if (path && typeof window !== 'undefined' && window.location) {
    // CTA vinculado a um anúncio específico → abre a ferramenta já preenchida (?item=MLB...)
    const itemId = el && el.dataset ? (el.dataset.itemId || '') : '';
    window.location.href = itemId
      ? `${path}${path.includes('?') ? '&' : '?'}item=${encodeURIComponent(itemId)}`
      : path;
  } else if (window.MFD_DEBUG) {
    console.log('[MFD] Tool click sem handler configurado:', tool);
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 24 — Load & Render orchestration
// ══════════════════════════════════════════════════════════════════════

// Espera Bubble ATIVAMENTE refrescar o token (até deadlineMs).
// SÓ retorna true se conseguir um token DIFERENTE do oldToken (prova de refresh).
// Se o Bubble não dispara refresh server-side, polling não adianta — retorna false
// e o caller mostra a tela de reconectar com mais confiança.
async function waitForFreshToken(oldToken, deadlineMs = 8000) {
  const start = Date.now();
  const deadline = start + deadlineMs;
  // Pulso 1: 1.5s inicial pra dar tempo do Bubble disparar refresh
  await new Promise(r => setTimeout(r, 1500));
  let lastSeen = null;
  while (Date.now() < deadline) {
    // 1) Checa se Bubble setou em window.MFD_TOKEN externamente
    if (window.MFD_TOKEN && window.MFD_TOKEN.length >= 50 && window.MFD_TOKEN !== oldToken) {
      STATE.token = window.MFD_TOKEN;
      if (window.MFD_DEBUG) console.log(`[MFD] token MUDOU via window.MFD_TOKEN após ${Date.now()-start}ms`);
      return true;
    }
    // 2) Re-puxa via workflow Bubble (pode ter sido refreshado server-side)
    const fresh = await fetchTokenFromBubble();
    if (fresh && fresh.length >= 50 && fresh !== oldToken) {
      STATE.token = fresh;
      window.MFD_TOKEN = fresh;
      if (window.MFD_DEBUG) console.log(`[MFD] token MUDOU via fetchTokenFromBubble após ${Date.now()-start}ms`);
      return true;
    }
    lastSeen = fresh || window.MFD_TOKEN || null;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.warn(`[MFD] token NÃO mudou em ${deadlineMs}ms — Bubble não está refrescando server-side (len=${(lastSeen || '').length}).`);
  return false;
}

async function loadAndRender(period, forceRefresh, _isAuthRetry) {
  STATE.period = period;
  STATE.loading = true;
  STATE.error = null;
  // Token de requisição: invalida .then de períodos antigos (troca rápida de aba)
  STATE._reqSeq = (STATE._reqSeq || 0) + 1;
  const reqId = STATE._reqSeq;
  // Zera estados derivados do período anterior (senão renderizam dados velhos)
  STATE.visitsLoading = false;
  STATE.visitsData = null;
  STATE.visitsDaily = null;
  STATE.ordersLoading = false;
  STATE.ordersData = undefined;
  STATE.issuesLoading = false;
  STATE.issuesData = undefined;
  STATE.issuesError = false;
  STATE.moderationsLoading = false;
  STATE.moderationsData = undefined;
  renderDashboard();

  try {
    // Snapshot anterior antes de salvar o de hoje
    const sid = STATE.sellerId;

    // Fetch principal — paraleliza
    const aggPromise = fetchAdsAggregated(period);
    const userPromise = STATE.sellerInfo ? Promise.resolve(STATE.sellerInfo) : fetchUserMe();

    const aggData = await aggPromise;
    const seller = await userPromise;
    STATE.sellerInfo = seller;
    // SEMPRE preferir o seller_id do ML (numérico) sobre o que veio do Bubble workflow
    // (que retorna user_id no formato Bubble "1775789877943x...").
    const mlSellerId = aggData?.seller_id || (seller?.id != null ? String(seller.id) : null);
    if (mlSellerId && /^\d+$/.test(mlSellerId)) {
      STATE.sellerId = mlSellerId;
    } else if (!STATE.sellerId && mlSellerId) {
      STATE.sellerId = mlSellerId;
    }

    // Itens ativos / pausados / brand info / top anúncios — em paralelo
    const sidLocal = STATE.sellerId;
    const [activeCount, pausedCount, brandInfo, topAdsItems] = await Promise.all([
      sidLocal ? fetchAdsCount(sidLocal, 'active') : Promise.resolve(0),
      sidLocal ? fetchAdsCount(sidLocal, 'paused') : Promise.resolve(0),
      sidLocal ? fetchBrandInfo(sidLocal) : Promise.resolve({ isOfficial: false, name: null }),
      fetchTopAdsItems(period, 5)
    ]);
    STATE.brandInfo = brandInfo;
    STATE.topAdsItems = topAdsItems;
    STATE.campaigns = aggData.campaigns || [];

    // Fetch reviews dos top anúncios em paralelo (não bloqueia se falhar)
    const topIds = (topAdsItems || []).map(it => it.item_id).filter(Boolean);
    STATE.reviewsMap = await fetchReviewsForItems(topIds);

    // /ads-aggregated não retorna items_with_ads; pode ser 0 — derivamos
    // a partir de presença de campanhas + custo > 0 (proxy razoável).
    const hasActiveAds = (aggData.campaigns || []).some(c => c.status === 'active') || (aggData.aggregated?.total_cost || 0) > 0;
    // null = contagem FALHOU (≠ conta sem anúncios) — não disparar onboarding nesse caso
    const countsUnknown = activeCount == null && pausedCount == null;
    const totals = {
      activeItems: (activeCount != null ? activeCount : 0) || aggData.total_items_account || 0,
      pausedItems: pausedCount != null ? pausedCount : 0,
      itemsWithAds: hasActiveAds ? 1 : 0,  // marcador — é "tem ads ou não"
      countsUnknown
    };

    // Snapshot anterior (antes de salvar hoje)
    STATE.prevSnapshot = sidLocal ? rtGetPrevSnapshot(sidLocal, todayStr(), period) : null;

    // Snapshot de hoje
    if (sidLocal) {
      const snap = {
        revenue:         aggData.aggregated?.total_revenue || 0,
        organic_revenue: aggData.aggregated?.organic_revenue || 0,
        cost:            aggData.aggregated?.total_cost || 0,
        sales:           (aggData.aggregated?.total_orders || 0) + (aggData.aggregated?.organic_orders || 0),
        ads_orders:      aggData.aggregated?.total_orders || 0,
        organic_orders:  aggData.aggregated?.organic_orders || 0,
        tacos:           aggData.aggregated?.avg_tacos || 0,
        roas:            aggData.aggregated?.overall_roas || 0,
        clicks:          aggData.aggregated?.total_clicks || 0,
        impressions:     aggData.aggregated?.total_impressions || 0,
        cvr:             aggData.aggregated?.avg_cvr || 0,
        visits:          0,  // será atualizado depois quando visitsData chegar (em fetchOrganicVisits.then)
        organic_conversion: 0
      };
      STATE._currentSnap = snap;
      rtSaveSnapshot(sidLocal, period, snap);
      rtUpdateRecords(sidLocal, Object.assign({ date: todayStr() }, snap));
      rtUpdateStreak(sidLocal);
    }

    STATE.data = {
      aggregated:       aggData.aggregated || {},
      daily_aggregated: aggData.daily_aggregated || [],
      campaigns:        aggData.campaigns || [],
      totals,
      fetchedAt: Date.now()
    };
    STATE.loading = false;
    renderDashboard();

    // Em paralelo (não bloqueia): busca visitas pra calcular conversão orgânica
    if (sidLocal && (totals.activeItems || 0) > 0) {
      const reqSnap = STATE._currentSnap; // snapshot DESTA requisição (não o global)
      STATE.visitsLoading = true;
      patchOrganicVsCard();
      fetchOrganicVisits(sidLocal, period).then(v => {
        if (reqId !== STATE._reqSeq) return; // período mudou no meio — descarta
        STATE.visitsLoading = false;
        STATE.visitsData = v;
        // Atualiza snapshot com visits + org conversion (não confiável com amostra parcial)
        if (reqSnap && v) {
          const adsClicks = aggData.aggregated?.total_clicks || 0;
          const orgVisits = (v.capped || v.incomplete) ? 0 : Math.max(0, v.total_visits - adsClicks);
          // Mesma base do render: pedidos (total − vendas Ads) quando disponível,
          // senão unidades orgânicas — histórico coerente com o que o card mostra
          const gross = (STATE.ordersData && typeof STATE.ordersData.total_orders === 'number')
            ? STATE.ordersData.total_orders : null;
          const adsOrd = aggData.aggregated?.total_orders || 0;
          const orgSales = gross != null ? Math.max(0, gross - adsOrd) : (aggData.aggregated?.organic_orders || 0);
          const orgConvSnap = orgVisits > 0 ? (orgSales / orgVisits * 100) : 0;
          reqSnap.visits = v.total_visits;
          // >100% = visitas subcontadas (catálogo) — não polui o histórico
          reqSnap.organic_conversion = orgConvSnap > 100 ? 0 : orgConvSnap;
          rtSaveSnapshot(sidLocal, period, reqSnap);
        }
        patchOrganicVsCard();
        patchHealthCard();
      }).catch(() => {
        if (reqId !== STATE._reqSeq) return;
        STATE.visitsLoading = false;
        patchOrganicVsCard();
        patchHealthCard();
      });

      // Em paralelo: conta pedidos (vendas brutas) pro funil de conversão estilo Seller Central.
      // A receita por pedidos é SEMPRE pedida junto: ela é a única fonte exata do
      // total da conta. O organic_units_amount do ML Ads cobre só itens ANUNCIADOS
      // (itens fora de campanha ficam invisíveis), e o agregado por campanha perde
      // histórico de campanhas deletadas/recriadas. Cache de 10min no proxy segura o custo.
      const organicFallback = !aggData.aggregated;
      const needsOrdersRevenue = true;
      STATE.ordersLoading = true;
      fetchOrdersCount(sidLocal, period, needsOrdersRevenue).then(d => {
        if (reqId !== STATE._reqSeq) return;
        STATE.ordersLoading = false;
        STATE.ordersData = d; // null = indisponível (conversões caem pro cálculo por unidades)
        if (reqSnap && d && typeof d.total_orders === 'number') {
          reqSnap.orders = d.total_orders;
          // Se as visitas já chegaram, refaz a conversão orgânica do snapshot na
          // base de pedidos (total − Ads) — quem resolve por último consolida
          const v = STATE.visitsData;
          if (v && v.total_visits > 0 && !v.capped && !v.incomplete) {
            const adsClicks = aggData.aggregated?.total_clicks || 0;
            const adsOrd = aggData.aggregated?.total_orders || 0;
            const orgVisits = Math.max(0, v.total_visits - adsClicks);
            const orgConvSnap = orgVisits > 0 ? (Math.max(0, d.total_orders - adsOrd) / orgVisits * 100) : 0;
            reqSnap.organic_conversion = orgConvSnap > 100 ? 0 : orgConvSnap;
          }
          rtSaveSnapshot(sidLocal, period, reqSnap);
        }
        let revenueApplied = false;
        if (d && d.revenue && typeof d.revenue.amount === 'number' &&
            (organicFallback || d.revenue.amount > 0)) {
          if (organicFallback) {
            // Sintetiza o agregado 100% orgânico no MESMO shape do /ads-aggregated:
            // hero, KPIs, health, resumo e charts passam a funcionar sem nenhum
            // tratamento especial (custo/cliques de Ads ficam zerados de verdade)
            STATE.data.aggregated = {
              total_cost: 0, total_revenue: 0,
              organic_revenue: d.revenue.amount,
              total_clicks: 0, total_impressions: 0,
              total_orders: 0,
              organic_orders: d.revenue.units || 0,
              avg_acos: 0, avg_tacos: 0, overall_roas: 0,
              avg_ctr: 0, avg_cvr: 0, avg_cpc: 0,
              ads_sales_pct: 0,
              organic_only: true,
              revenue_complete: d.revenue.complete !== false
            };
            STATE.data.daily_aggregated = (d.daily || []).map(day => ({
              date: day.date, cost: 0, clicks: 0, prints: 0,
              total_amount: 0,
              organic_units_amount: day.revenue || 0,
              units_quantity: 0,
              organic_units_quantity: day.units || 0
            }));
            revenueApplied = true;
          } else {
            // Reconciliação: orgânico real = pedidos da conta − receita atribuída a
            // Ads. Só aplica quando AUMENTA o orgânico — em conta gigante (pedidos
            // truncados no cap) o piso por pedidos pode ser menor que o summary
            const a = STATE.data.aggregated;
            const adsRev = a.total_revenue || 0;
            const orgFromOrders = Math.max(0, d.revenue.amount - adsRev);
            if (orgFromOrders > (a.organic_revenue || 0)) {
              a.organic_revenue = orgFromOrders;
              a.organic_orders = Math.max(0, (d.revenue.units || 0) - (a.total_orders || 0));
              const totalRevAll = adsRev + orgFromOrders;
              a.avg_tacos = totalRevAll > 0 ? ((a.total_cost || 0) / totalRevAll) * 100 : 0;
              a.ads_sales_pct = totalRevAll > 0 ? (adsRev / totalRevAll) * 100 : 0;
              a.organic_from_orders = true;
              a.revenue_complete = d.revenue.complete !== false;
              const byDate = new Map((d.daily || []).map(day => [day.date, day]));
              STATE.data.daily_aggregated = (STATE.data.daily_aggregated || []).map(day => {
                const o = byDate.get(day.date);
                if (!o) return day;
                byDate.delete(day.date);
                const calcRev = Math.max(0, (o.revenue || 0) - (day.total_amount || 0));
                const calcUnits = Math.max(0, (o.units || 0) - (day.units_quantity || 0));
                return Object.assign({}, day, {
                  organic_units_amount: Math.max(day.organic_units_amount || 0, calcRev),
                  organic_units_quantity: Math.max(day.organic_units_quantity || 0, calcUnits)
                });
              });
              for (const o of byDate.values()) {
                STATE.data.daily_aggregated.push({
                  date: o.date, cost: 0, clicks: 0, prints: 0, total_amount: 0,
                  organic_units_amount: o.revenue || 0,
                  units_quantity: 0,
                  organic_units_quantity: o.units || 0
                });
              }
              STATE.data.daily_aggregated.sort((x, y) => x.date.localeCompare(y.date));
              revenueApplied = true;
            }
          }
        }
        if (revenueApplied) {
          const aggNow = STATE.data.aggregated;
          if (reqSnap) {
            reqSnap.organic_revenue = aggNow.organic_revenue || 0;
            reqSnap.organic_orders = aggNow.organic_orders || 0;
            reqSnap.sales = (aggNow.total_orders || 0) + (aggNow.organic_orders || 0);
            reqSnap.tacos = aggNow.avg_tacos || 0;
            rtSaveSnapshot(sidLocal, period, reqSnap);
            rtUpdateRecords(sidLocal, Object.assign({ date: todayStr() }, reqSnap));
          }
          renderDashboard(); // re-render completo já com a receita reconciliada
        } else {
          patchOrganicVsCard();
        }
      }).catch(() => {
        if (reqId !== STATE._reqSeq) return;
        STATE.ordersLoading = false;
        STATE.ordersData = null;
        patchOrganicVsCard();
      });

      // Comparativo "vs período anterior" pra conta sem Mercado Ads: o snapshot
      // local da visita anterior não existe (ou foi salvo zerado pelo bug do
      // aggregated null) — sem ele, todos os deltas viram "—". Busca os pedidos
      // do período equivalente ANTERIOR e monta um prev sintético com dados reais.
      const prevLocal = STATE.prevSnapshot;
      const prevLocalEmpty = !prevLocal ||
        (((prevLocal.revenue || 0) + (prevLocal.organic_revenue || 0) + (prevLocal.sales || 0)) === 0);
      if (needsOrdersRevenue && prevLocalEmpty) {
        const { from: curFrom } = periodToDates(period);
        const prevRange = { from: shiftYmd(curFrom, -period), to: shiftYmd(curFrom, -1) };
        fetchOrdersCount(sidLocal, period, true, prevRange).then(pd => {
          if (reqId !== STATE._reqSeq) return;
          if (pd && pd.revenue && typeof pd.revenue.amount === 'number' && pd.revenue.amount > 0) {
            STATE.prevSnapshot = {
              _synthetic: true, // não é visita real — banner "desde sua última visita" ignora
              date: prevRange.to,
              revenue: 0,
              organic_revenue: pd.revenue.amount,
              cost: 0,
              sales: pd.revenue.units || 0,
              ads_orders: 0,
              organic_orders: pd.revenue.units || 0,
              tacos: 0, roas: 0, clicks: 0, impressions: 0, cvr: 0,
              visits: 0, organic_conversion: 0
            };
            renderDashboard();
          }
        }).catch(() => {});
      }

      // Em paralelo: busca anúncios com problema (saúde unhealthy/warning)
      STATE.issuesLoading = true;
      patchAdsWithIssues();
      fetchAdsWithIssues(sidLocal).then(d => {
        if (reqId !== STATE._reqSeq) return;
        STATE.issuesLoading = false;
        STATE.issuesData = d; // null = erro (renderAdsWithIssues trata)
        STATE.issuesError = d == null;
        patchAdsWithIssues();
        patchHealthCard();
      }).catch(() => {
        if (reqId !== STATE._reqSeq) return;
        STATE.issuesLoading = false;
        STATE.issuesData = null;
        STATE.issuesError = true;
        patchAdsWithIssues();
        patchHealthCard();
      });

      // Em paralelo: busca moderações ativas (status=pending) + detalhe da primeira
      STATE.moderationsLoading = true;
      patchModerationsCard();
      fetchModerations(sidLocal).then(d => {
        if (reqId !== STATE._reqSeq) return;
        STATE.moderationsLoading = false;
        STATE.moderationsData = d; // null = erro (renderModerations trata)
        patchModerationsCard();
      }).catch(() => {
        if (reqId !== STATE._reqSeq) return;
        STATE.moderationsLoading = false;
        STATE.moderationsData = null;
        patchModerationsCard();
      });

      // Em paralelo: busca visitas diárias por anúncio pra plotar série orgânica no chart
      fetchOrganicVisitsDaily(sidLocal, period).then(d => {
        if (reqId !== STATE._reqSeq) return;
        STATE.visitsDaily = d;
        // Re-desenha o chart de tráfego com a 3ª série
        if (window.Chart && STATE.data?.daily_aggregated) {
          drawTrafficChart(STATE.data.daily_aggregated);
        }
      }).catch(() => {});
    } else if (sidLocal && totals.countsUnknown) {
      // Contagem de anúncios falhou: não dá pra afirmar nada — marca erro de verificação
      STATE.issuesError = true;
      patchHealthCard();
    } else {
      // Sem anúncios ativos: nada pra checar — estados explícitos (não "carregando" eterno)
      STATE.visitsData = { total_visits: 0, sampled_items: 0, capped: false };
      STATE.issuesData = { slots: [] };
      STATE.moderationsData = { items: [], total: 0, featured: null };
      patchOrganicVsCard();
      patchAdsWithIssues();
      patchModerationsCard();
      patchHealthCard();
    }
  } catch (err) {
    const status = err && err.status;
    const isAuthErr = status === 401 || status === 403;
    // Race condition: Bubble pode estar refrescando o token enquanto o dashboard
    // já disparou as chamadas. Se for primeiro erro de auth, espera novo token e tenta de novo.
    if (isAuthErr && !_isAuthRetry) {
      console.warn('[MFD] auth falhou, aguardando refresh do token antes de mostrar erro...');
      const oldToken = STATE.token;
      const refreshed = await waitForFreshToken(oldToken, 6000);
      if (refreshed) {
        STATE.error = null;
        return loadAndRender(period, forceRefresh, /*_isAuthRetry*/ true);
      }
      console.warn('[MFD] refresh não veio em 6s; mostrando tela de reconexão');
    }
    console.error('[MFD] erro:', err.message || err);
    STATE.loading = false;
    STATE.error = err;
    renderDashboard();
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 25 — Public API
// ══════════════════════════════════════════════════════════════════════

// ── Auto-discovery: tenta achar token ML do current user ──
// 1) variáveis explícitas em window (MFD_TOKEN, etc)
// 2) via Bubble workflow getAccessToken2 (autenticado por cookie)
// Retorna false sem token, true se setou STATE.token sincronicamente.
function autoDiscoverToken() {
  if (STATE.token) return true;
  const candidates = [
    'MFD_TOKEN', 'ML_TOKEN', 'MERCADO_LIVRE_TOKEN', 'mlb_token',
    'access_token_ml', 'ml_access_token', 'currentUserMlToken', 'mlAccessToken'
  ];
  for (const k of candidates) {
    const v = window[k];
    if (typeof v === 'string' && v.length >= 50) {
      STATE.token = v;
      if (window.MFD_DEBUG) console.log('[MFD] token auto-detectado em window.' + k);
      return true;
    }
  }
  // Heurística: qualquer string global que comece com "APP_USR-"
  try {
    for (const k of Object.keys(window)) {
      const v = window[k];
      if (typeof v === 'string' && v.startsWith('APP_USR-') && v.length >= 50) {
        STATE.token = v;
        if (window.MFD_DEBUG) console.log('[MFD] token auto-detectado (APP_USR-) em window.' + k);
        return true;
      }
    }
  } catch (_) { /* CSP-safe */ }
  return false;
}

// Async — busca token via Bubble workflow autenticado por cookie da sessão.
// Mesmo padrão usado pelo analyzer.js / ads-planner.js.
async function fetchTokenFromBubble() {
  try {
    const r = await fetch(BUBBLE_TOKEN_URL, { credentials: 'include' });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.response?.access_token || null;
  } catch (_) { return null; }
}

async function fetchSellerIdFromBubble() {
  try {
    const r = await fetch(BUBBLE_USERID_URL, { method: 'POST', credentials: 'include' });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.response?.user_id || d?.user_id || null;
  } catch (_) { return null; }
}

window.MFD_init = async function MFD_init(opts) {
  opts = opts || {};
  STATE.token       = opts.token    || window.MFD_TOKEN || null;
  STATE.sellerId    = opts.sellerId || window.MFD_SELLER_ID || null;
  STATE.containerId = opts.container || 'mfd-root';
  STATE.period      = opts.period || 30;

  if (opts.tacosTarget) window._mfdTacosTarget = opts.tacosTarget;

  if (!document.getElementById(STATE.containerId)) {
    console.warn('[MFD] container', STATE.containerId, 'não encontrado');
    return;
  }

  // 1) Sync auto-discovery (window globals)
  if (!STATE.token) autoDiscoverToken();

  // 2) Async fallback via Bubble workflow (mesmo padrão analyzer/planner)
  if (!STATE.token) {
    // Loading (e não onboarding) enquanto a descoberta roda — evita o flash de
    // "Conecte sua conta" pra quem JÁ está conectado e só espera o workflow
    STATE.loading = true;
    renderDashboard();
    const [tk, sid] = await Promise.all([fetchTokenFromBubble(), fetchSellerIdFromBubble()]);
    if (tk) STATE.token = tk;
    if (sid && !STATE.sellerId) STATE.sellerId = sid;
    if (STATE.token) STATE.loading = false;
  } else if (!STATE.sellerId) {
    // Token veio mas seller_id não — busca async sem bloquear UI
    fetchSellerIdFromBubble().then(s => { if (s && !STATE.sellerId) STATE.sellerId = s; });
  }

  // 3) Último recurso: poll por window.MFD_TOKEN (Bubble pode setar tarde)
  if (!STATE.token) {
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      if (autoDiscoverToken() || (window.MFD_TOKEN && (STATE.token = window.MFD_TOKEN))) {
        clearInterval(poll);
        loadAndRender(STATE.period);
      } else if (tries >= 10) {
        clearInterval(poll);
        STATE.loading = false; // esgotou a descoberta — agora sim onboarding
        renderDashboard();
      }
    }, 1000);
    return;
  }

  loadAndRender(STATE.period);
};

window.MFD_refresh = function () { loadAndRender(STATE.period, true); };

window.MFD_setToken = function (token) {
  STATE.token = token;
  if (STATE.containerId) loadAndRender(STATE.period);
};

// Auto-start: chamar MFD_init independente de token explícito.
// O init resolve token via (1) opts, (2) window.MFD_TOKEN, (3) auto-discovery,
// (4) Bubble workflow getAccessToken2 — então sempre tenta carregar.
if (typeof window.MFD_AUTOSTART === 'undefined' || window.MFD_AUTOSTART) {
  function _mfdAutoStart() {
    if (STATE.token || STATE.containerId) return; // já iniciado
    if (document.getElementById('mfd-root')) {
      window.MFD_init({
        token: window.MFD_TOKEN || null,
        sellerId: window.MFD_SELLER_ID || null,
        container: 'mfd-root'
      });
    } else {
      // Container ainda não no DOM — tenta de novo em 200ms
      setTimeout(_mfdAutoStart, 200);
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_mfdAutoStart, 50);
  } else {
    document.addEventListener('DOMContentLoaded', _mfdAutoStart);
  }
}

// expose helpers úteis para Bubble debug
window.MFD = window.MFD || {};
window.MFD.fmt = fmt;
window.MFD.fmtMoney = fmtMoney;
window.MFD.fmtMoneyCompact = fmtMoneyCompact;
window.MFD.escapeHtml = escapeHtml;
window.MFD.STATE = STATE;
window.MFD.todayStr = todayStr;

})();
