/*
 * menu-saldo.js — linha "créditos de IA" no menu lateral (reusable "Menu Lateral", elemento
 * bTMDR). Mostra quantos créditos restam no mês, com barra fina, e quando renovam. A unidade é
 * o crédito porque a carteira é de toda função com IA (ficha hoje; imagens depois).
 *
 * É só desenho: nenhuma regra de cota mora aqui. Os números vêm prontos do proxy, pelas mesmas
 * duas rotas que o Agente de Palavras-Chave já lê, na mesma ordem (ledger primeiro; desligado,
 * a cota simples), com a mesma redação. Se o Agente diz 38, o menu diz 38.
 *
 * O que ele NÃO faz, de propósito:
 *  - não inventa número: sem resposta, cota desligada ou valor inválido, o cartão fica oculto
 *    (nunca "0 de 0", nunca "erro");
 *  - não alarma: uma cor só, sem âmbar nem vermelho;
 *  - não clica em nada (a compra é a Fase 3).
 *
 * Guarda de dupla execução: o reusable pode estar duas vezes na página e o Bubble pode renderizar
 * o elemento mais de uma vez. O script roda uma vez; o render pinta em TODAS as cópias.
 */
if (!window.__MF_MENU_SALDO__) {
window.__MF_MENU_SALDO__ = true;

const MFSALDO_PROXY = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
const MFSALDO_TTL_MS = 2 * 60 * 1000;
const MFSALDO_EVENTO = 'mf:analises-cota';
const MFSALDO_DICA = 'Hoje, 1 crédito = 1 análise de ficha que ganhou sugestão. Ficha completa não gasta. Em breve, outras funções com IA.';

// O mesmo sparkle que o Agente usa (js/ficha-ia.js, MF_ICONE_IA). Copiado, não importado: o
// menu carrega em toda página, o Agente só na dele.
const MFSALDO_ICONE = '<svg class="mf-ia" viewBox="0 0 24 24" width="12" height="12" role="img" aria-label="Crédito de IA"><path d="M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z"/></svg>';

const estadoSaldo = { userId: null };

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Mesmo formato do Agente (dd/mm): o vendedor lê a mesma data nos dois lugares.
function formatarDia(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}` : '';
}

// `Number(null)` e `Number('')` valem 0 e passariam no isFinite sem ser número de verdade.
function numeroValido(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

function cotaValida(cota) {
  return !!cota && numeroValido(cota.limite) && numeroValido(cota.restante) && Number(cota.limite) > 0;
}

function htmlDoCartao(cota, comprados) {
  const limite = Number(cota.limite);
  const restante = Math.max(0, Math.min(limite, Number(cota.restante)));
  const pct = Math.round((restante / limite) * 100);
  const renova = formatarDia(cota.renova_em);

  // Duas linhas curtas, no tom dos outros itens do menu: o menu tem 224 px úteis e uma frase
  // única saía cortada com reticências. A unidade é o crédito de IA: hoje paga a análise da
  // ficha, depois paga imagem e o que mais vier, e o menu não muda de nome a cada função.
  const frase = MFSALDO_ICONE + ' ' + (restante > 0
    ? `<b>${restante}</b> de ${limite} créditos de IA`
    : 'Créditos de IA acabaram');
  // O "?" usa o tooltip nativo (title): o elemento do Bubble tem overflow hidden e cortaria
  // qualquer balão desenhado por CSS.
  const linha = `<div class="mf-saldo-linha"><span class="mf-saldo-txt">${frase}</span>`
    + `<span class="mf-saldo-ajuda" tabindex="0" role="note" title="${escapeHtml(MFSALDO_DICA)}" aria-label="${escapeHtml(MFSALDO_DICA)}">?</span></div>`;

  const barra = `<div class="mf-saldo-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${limite}" aria-valuenow="${restante}">`
    + `<div class="mf-saldo-cheio" style="width:${pct}%"></div></div>`;

  const rodape = restante > 0
    ? (renova ? `renovam ${escapeHtml(renova)}` : 'renovam no começo do mês')
    : (renova ? `voltam ${escapeHtml(renova)}` : 'voltam no começo do mês');
  // Comprados em linha própria (só quando existem): junto do "renovam" não cabia nos 224 px.
  const c = comprados && numeroValido(comprados.restante) && Number(comprados.restante) > 0 ? comprados : null;
  let compradosHtml = '';
  if (c) {
    const vence = formatarDia(c.vence_em);
    compradosHtml = `<div class="mf-saldo-rod">+${Number(c.restante).toLocaleString('pt-BR')} comprados${vence ? `, vencem ${escapeHtml(vence)}` : ''}</div>`;
  }
  return linha + barra + `<div class="mf-saldo-rod">${rodape}</div>` + compradosHtml;
}

/** Pinta (ou oculta) o cartão em todas as cópias. Devolve true se pintou. */
function render(cota, comprados) {
  const raizes = document.querySelectorAll('.mf-saldo');
  if (!cotaValida(cota)) {
    for (const r of raizes) { r.innerHTML = ''; r.setAttribute('hidden', ''); }
    return false;
  }
  const html = htmlDoCartao(cota, comprados);
  for (const r of raizes) { r.innerHTML = html; r.removeAttribute('hidden'); }
  return true;
}

// ── cache curto para a primeira pintura entre páginas ────────────────────────────────────
// O menu carrega em toda página. Sem isso o cartão piscaria (oculto → número) a cada troca de
// tela. A resposta fresca sempre sobrescreve; o cache nunca vence uma resposta.
function chaveCache(uid) { return 'mf_saldo_' + uid; }
function lerCache(uid) {
  try {
    const bruto = sessionStorage.getItem(chaveCache(uid));
    if (!bruto) return null;
    const d = JSON.parse(bruto);
    if (!d || typeof d.t !== 'number' || Date.now() - d.t > MFSALDO_TTL_MS) return null;
    return d;
  } catch (e) { return null; }
}
function gravarCache(uid, cota, comprados) {
  try { sessionStorage.setItem(chaveCache(uid), JSON.stringify({ t: Date.now(), cota, comprados: comprados || null })); } catch (e) { /* sem storage, sem cache */ }
}
function apagarCache(uid) {
  try { sessionStorage.removeItem(chaveCache(uid)); } catch (e) { /* idem */ }
}

// ── leitura ──────────────────────────────────────────────────────────────────────────────
async function obterUserId() {
  if (estadoSaldo.userId) return estadoSaldo.userId;
  try {
    const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/get-user-id', { method: 'POST' });
    if (!r.ok) return null;
    const d = await r.json();
    estadoSaldo.userId = (d && d.response && d.response.user_id) || (d && d.user_id) || null;
    return estadoSaldo.userId;
  } catch (e) { return null; }
}

async function proxyGet(rota, token) {
  const r = await fetch(MFSALDO_PROXY + rota, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

/**
 * Lê e pinta. Ordem igual à do Agente: ledger de créditos primeiro; desligado ou fora do ar,
 * a cota simples da Fase 1. Devolve a cota pintada, ou null.
 */
async function carregar() {
  let pintouDoCache = false;
  try {
    const uid = await obterUserId();
    if (!uid) { render(null); return null; }

    const guardado = lerCache(uid);
    if (guardado && cotaValida(guardado.cota)) pintouDoCache = render(guardado.cota, guardado.comprados);

    let s = null;
    try { s = await proxyGet('/api/creditos/saldo', uid); } catch (e) { s = null; }
    let cota = null;
    let comprados = null;
    if (s && s.ativo && s.saldo) {
      cota = s.saldo.mes; comprados = s.saldo.comprados;
    } else {
      const r = await proxyGet('/api/gpt-ficha/cota', uid);
      cota = (r && r.cota) || null;
    }
    if (render(cota, comprados)) { gravarCache(uid, cota, comprados); return cota; }
    apagarCache(uid);
    return null;
  } catch (e) {
    // Falha de leitura: o que foi pintado há menos de 2 min continua; sem nada, oculto.
    if (!pintouDoCache) render(null);
    return null;
  }
}

// O Agente avisa quando uma análise termina (mostrarCotaNoTopo dispara este evento com a
// resposta fresca). Sem isso, o menu diria 38 e o Agente 37 na mesma tela.
document.addEventListener(MFSALDO_EVENTO, (ev) => {
  const d = ev && ev.detail;
  if (!d || !cotaValida(d.cota)) return;
  render(d.cota, d.comprados);
  if (estadoSaldo.userId) gravarCache(estadoSaldo.userId, d.cota, d.comprados || null);
});

window.MFSaldo = { render, carregar, htmlDoCartao, cotaValida, formatarDia, EVENTO: MFSALDO_EVENTO };

setTimeout(() => { carregar(); }, 0);

} // end guard
