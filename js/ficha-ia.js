/* ============================================================
 * Ficha Técnica com IA — painel do Agente de Palavras-Chave
 *
 * O vendedor escolhe um anúncio da conta e recebe o que dá pra preencher e o que dá pra
 * corrigir na ficha técnica, com o trecho do próprio anúncio que sustenta cada sugestão.
 *
 * O QUE ESTE ARQUIVO **NÃO** FAZ: decidir o que sugerir. Peso, limiar, prompt e a régua de
 * evidência vivem no proxy (/api/gpt-ficha) — este repo é PÚBLICO e o bundle do Bubble é
 * legível no DevTools. Aqui só entra a trava de edição, que já é pública no analyzer e
 * existe como rede de segurança: campo bloqueado não vira nem pergunta pra IA.
 *
 * Regra do Lucas (07/08/2026): "o que o vendedor não puder mexer, ele não pode nem tentar".
 * ============================================================ */
if (window.__mfFichaIaLoaded) { /* guard de re-inject */ } else {
window.__mfFichaIaLoaded = true;

const MFFICHA_PROXY = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';

// Espelham o analyzer. Mudou lá, muda aqui.
const TIPOS_EDITAVEIS = new Set(['string', 'list', 'boolean', 'number', 'number_unit']);
const ATRIBUTOS_SISTEMA_ML = new Set([
  'GIFTABLE', 'VERTICAL_TAGS', 'DESCRIPTIVE_TAGS', 'PACKAGE_DATA_SOURCE',
  'SELLER_PACKAGE_DATA_SOURCE', 'SHIPMENT_PACKING', 'HAZMAT_TRANSPORTABILITY',
  'WITH_POSITIVE_IMPACT', 'PRODUCT_CHEMICAL_FEATURES', 'BATTERIES_FEATURES',
]);
const ATTRS_DA_ASSINATURA = new Set(['ITEM_CONDITION']);
const VARIATION_ATTR_IDS = new Set(['COLOR', 'SIZE', 'MAIN_COLOR', 'SELLER_SKU', 'GTIN']);
// Códigos, não texto de venda — a IA não adivinha código de barras nem registro do Inmetro.
const IDS_FORA = new Set(['GTIN', 'SKU', 'SELLER_SKU', 'UPC', 'EAN', 'JAN', 'ISBN', 'INMETRO_CERTIFICATION_REGISTRATION_NUMBER']);
const PREFIXOS_FORA = ['número de', 'número do', 'numero de', 'numero do', 'registro de', 'registro do'];

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function chaveTexto(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function atributoPreenchido(detail, attrId) {
  const a = ((detail && detail.attributes) || []).find((x) => x && x.id === attrId);
  if (!a) return false;
  if (a.value_name && String(a.value_name).trim() !== '') return true;
  return Array.isArray(a.values) && a.values.some((v) => v && (v.name || v.id));
}

function valorAtual(detail, attrId) {
  const a = ((detail && detail.attributes) || []).find((x) => x && x.id === attrId);
  return (a && a.value_name) ? String(a.value_name).trim() : '';
}

/**
 * Por que este campo não pode ser mexido por aqui? `null` = pode.
 * Mesma régua do `mfMotivoNaoEditavel` do analyzer — os motivos e os porquês estão
 * documentados lá e em internal-docs/FICHA-IA-SPEC.md §3.
 */
function motivoBloqueado(catAttr, detail) {
  if (!catAttr) return 'inexistente';
  if (!TIPOS_EDITAVEIS.has(catAttr.value_type)) return 'tipo';
  if ((catAttr.tags && catAttr.tags.read_only) || ATRIBUTOS_SISTEMA_ML.has(catAttr.id)) return 'sistema';
  const temVariacoes = Array.isArray(detail && detail.variations) && detail.variations.length > 0;
  if (temVariacoes && (catAttr.hierarchy === 'CHILD_PK' || catAttr.hierarchy === 'CHILD_DEPENDENT')) return 'variacao';
  if (temVariacoes && VARIATION_ATTR_IDS.has(String(catAttr.id).toUpperCase())) return 'variacao';
  const emFamilia = !!(detail && detail.user_product_id);
  if (emFamilia && ATTRS_DA_ASSINATURA.has(catAttr.id)) return 'familia';
  if (emFamilia && catAttr.hierarchy === 'PARENT_PK') return 'familia';
  // CHILD_PK vazio: ganhar o atributo muda a assinatura, o UP migra sozinho de família e
  // nem o editor conserta depois (family_id.collision). Não tem volta.
  if (emFamilia && catAttr.hierarchy === 'CHILD_PK' && !atributoPreenchido(detail, catAttr.id)) return 'familia';
  return null;
}

/** Mexer aqui renomeia a variação — exige a flag confirm_rename_variation no PUT. */
function renomeiaVariacao(catAttr, detail) {
  if (!catAttr || catAttr.hierarchy !== 'CHILD_PK') return false;
  const temVariacoes = Array.isArray(detail && detail.variations) && detail.variations.length > 0;
  if (!(detail && detail.user_product_id) && !temVariacoes) return false;
  return atributoPreenchido(detail, catAttr.id);
}

/**
 * Mexer aqui muda o LINK do anúncio (e ele perde a exposição)?
 * Todo CHILD_PK renomeia a variação, mas só o que aparece no título muda o permalink —
 * medido em 10/08/2026. Alertar nos 604 casos treinaria o vendedor a ignorar aviso
 * vermelho, que é o mesmo que não ter aviso. Na dúvida, avisa.
 */
function mudaOLink(catAttr, detail) {
  if (!renomeiaVariacao(catAttr, detail)) return false;
  const titulo = detail && detail.title;
  const valor = valorAtual(detail, catAttr.id);
  if (!titulo || !valor) return true;
  const chave = chaveTexto(valor);
  if (!chave) return true;
  if (chave.length < 2) {
    return String(titulo).split(/\s+/).some((p) => chaveTexto(p) === chave);
  }
  return chaveTexto(titulo).includes(chave);
}

function foraPorSerCodigo(catAttr) {
  if (IDS_FORA.has(String(catAttr.id || '').toUpperCase())) return true;
  const nome = String(catAttr.name || '').toLowerCase();
  return PREFIXOS_FORA.some((p) => nome.startsWith(p));
}

/** Os campos que esta feature pode oferecer, neste anúncio. */
function camposElegiveis(categoryAttributes, detail, obrigatoriosML) {
  return (Array.isArray(categoryAttributes) ? categoryAttributes : [])
    .filter((c) => c && motivoBloqueado(c, detail) === null && !foraPorSerCodigo(c))
    .map((c) => {
      const preenchido = atributoPreenchido(detail, c.id);
      return {
        id: c.id,
        name: c.name,
        value_type: c.value_type,
        value_max_length: c.value_max_length || null,
        obrigatorio: (obrigatoriosML instanceof Set && obrigatoriosML.size > 0)
          ? obrigatoriosML.has(c.id)
          : !!(c.tags && (c.tags.required || c.tags.catalog_required)),
        preenchido,
        valor_atual: preenchido ? valorAtual(detail, c.id) : null,
        values: Array.isArray(c.values) ? c.values.map((v) => ({ id: String(v.id), name: v.name })) : [],
        allowed_units: Array.isArray(c.allowed_units) ? c.allowed_units : [],
        default_unit: c.default_unit || null,
        _extra: !!(c.tags && c.tags.hidden),
        _renomeia: renomeiaVariacao(c, detail),
        _mudaLink: mudaOLink(c, detail),
      };
    });
}

/**
 * As palavras que o Agente descobriu, no formato que o proxy espera.
 * Entrada: o que o `buildMissingWordsMap` do keyword-agent já produz —
 * `[palavra, { count, categories: Set, phrases: [] }]`.
 * A CATEGORIA viaja junto porque quem decide o que fica de fora é o servidor, não o front.
 */
function formatarPalavrasQueFaltam(lista) {
  return (Array.isArray(lista) ? lista : []).slice(0, 30).map((entrada) => {
    const palavra = Array.isArray(entrada) ? entrada[0] : (entrada && entrada.palavra) || '';
    const dados = (Array.isArray(entrada) ? entrada[1] : entrada) || {};
    const cats = dados.categories instanceof Set ? [...dados.categories] : (dados.categorias || []);
    return {
      palavra: String(palavra),
      combos: Array.isArray(dados.phrases) ? dados.phrases.slice(0, 5) : (dados.combos || []),
      buscas: Number(dados.count || dados.buscas) || 0,
      categoria: String(cats[0] || ''),
    };
  }).filter((p) => p.palavra);
}

/** O pedido: só FATOS. Régua nenhuma sai daqui. */
function montarPayload({ detail, descricao, categoryAttributes, obrigatoriosML, palavrasQueFaltam, siteId }) {
  return {
    site_id: siteId || 'MLB',
    titulo: (detail && detail.title) || '',
    descricao: descricao || '',
    ficha_atual: ((detail && detail.attributes) || [])
      .filter((a) => a && a.value_name)
      .map((a) => ({ id: a.id, name: a.name || a.id, value: String(a.value_name) })),
    campos: camposElegiveis(categoryAttributes, detail, obrigatoriosML)
      .map(({ _extra, _renomeia, _mudaLink, ...limpo }) => limpo),
    palavras_que_faltam: formatarPalavrasQueFaltam(palavrasQueFaltam),
  };
}

/* ---------- Busca ---------- */
// Sem retry: é rota de IA. Uma tentativa, e o erro sobe — retry multiplica custo sem
// melhorar resultado. Retry só no scraper, onde a instabilidade é real.
async function buscarSugestoes(payload, userId) {
  let resp;
  try {
    resp = await fetch(MFFICHA_PROXY + '/api/gpt-ficha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (userId || '') },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { estado: 'falha', dados: null };
  }
  if (resp.status === 401) return { estado: 'sessao', dados: null };
  if (resp.status === 403) return { estado: 'sem_plano', dados: null };
  if (resp.status === 429) return { estado: 'ocupado', dados: null };
  if (!resp.ok) return { estado: 'falha', dados: null };
  try {
    return { estado: 'ok', dados: await resp.json() };
  } catch (e) {
    return { estado: 'falha', dados: null };
  }
}

/* ---------- Cache do resultado ---------- */
// Chave = anúncio + assinatura da ficha atual. Ficha mudou -> chave muda -> invalida
// sozinha, sem TTL pra acertar. Escopo por item: chave larga demais é vazamento de dado
// entre contas.
function chaveCache(itemId, campos) {
  const assinatura = (campos || [])
    .map((c) => String(c.id) + '=' + String(c.valor_atual || ''))
    .sort().join('|');
  return String(itemId) + '::' + chaveTexto(assinatura);
}
const cacheSugestoes = new Map();

/* ---------- Separação em seções ---------- */
// Duas dimensões se cruzam aqui. A que decide a SEÇÃO é o risco (campo que muda o link
// sai das listas de lote — um clique não pode resetar a exposição de várias variações de
// uma vez). A que decide a ORDEM dentro da seção é a obrigatoriedade: o vendedor resolve
// o que o ML exige e só então investe tempo nos extras.
function separarSecoes(resposta, campos) {
  const porId = new Map((campos || []).map((c) => [String(c.id), c]));
  const enfeitar = (s) => {
    const campo = porId.get(String(s.id));
    return { ...s, campo: campo || null, nome: (campo && campo.name) || s.name || s.id,
      obrigatorio: !!(campo && campo.obrigatorio), extra: !!(campo && campo._extra) };
  };
  const comEvidencia = [], trocas = [], sohUmAUm = [];
  for (const s of ((resposta && resposta.sugestoes) || [])) {
    const item = enfeitar(s);
    if (item.campo && item.campo._mudaLink) sohUmAUm.push(item);
    else if (s.acao === 'trocar') trocas.push(item);
    else comEvidencia.push(item);
  }
  // Lista 4 (D9): o anúncio NÃO diz isso. Nunca entra nas listas de lote — nem aqui, nem
  // no `marcadosNoLote`. Quem afirma que o produto tem a característica é o vendedor.
  const palavrasNovas = ((resposta && resposta.palavras_novas_sugeridas) || []).map(enfeitar);

  const obrigatorioPrimeiro = (a, b) => (b.obrigatorio ? 1 : 0) - (a.obrigatorio ? 1 : 0);
  comEvidencia.sort(obrigatorioPrimeiro);
  trocas.sort(obrigatorioPrimeiro);
  sohUmAUm.sort(obrigatorioPrimeiro);
  palavrasNovas.sort((a, b) => (b.buscas || 0) - (a.buscas || 0));   // mais buscas primeiro
  return { comEvidencia, trocas, sohUmAUm, palavrasNovas };
}

/**
 * Quantos tokens DISTINTOS o que está marcado acrescenta ao índice.
 * É o número que traduz o trabalho: o ML corta o anúncio se faltar uma palavra da busca,
 * então cada token novo abre buscas que estavam fechadas.
 */
function contarTokensNovos(itens) {
  const tokens = new Set();
  for (const i of (itens || [])) for (const p of (i.palavras_novas || [])) tokens.add(p);
  return tokens.size;
}

// O placar conta só o que o vendedor CONSEGUE mexer — cobrar campo bloqueado é meta falsa.
function contarPlacar(campos) {
  const lista = campos || [];
  return { preenchidos: lista.filter((c) => c.preenchido).length, total: lista.length };
}

/* ---------- Render ---------- */
function linhaSugestao(item, comCheckbox) {
  const marca = item.acao === 'trocar' ? '✏️' : '✅';
  const antesDepois = item.acao === 'trocar'
    ? `<div class="fia-antes">hoje <s>${escapeHtml(item.atual || '')}</s> <span class="fia-mono">(${String(item.atual || '').length})</span></div>`
    : '';
  const check = comCheckbox
    ? `<input type="checkbox" class="fia-check" data-campo="${escapeHtml(item.id)}" checked />`
    : '';
  // O selo diz por que vale a pena: obrigatório é o que o ML cobra; "campo extra" é o que
  // o ML nem mostra no formulário e quase nenhum concorrente preenche.
  const selo = item.obrigatorio
    ? '<span class="fia-selo fia-selo-obrig">o ML pede</span>'
    : (item.extra ? '<span class="fia-selo fia-selo-extra" title="O Mercado Livre não mostra este campo no formulário de publicação — a maioria dos concorrentes deixa em branco.">campo extra</span>' : '');
  // UMA linha de origem por palavra. Composição de fontes diferentes ("aço" de um campo,
  // "inox" da descrição) mostra as duas — é assim que o vendedor pega o caso raro em que a
  // junção não serve pro produto dele.
  const origens = (item.origens || []).map((o) => `
        <div class="fia-origem">
          <span class="fia-origem-palavra">"${escapeHtml(o.palavra)}"</span>
          <span class="fia-origem-seta">←</span>
          <span class="fia-fonte">${escapeHtml(rotuloFonte(o.fonte))}</span>
          <span class="fia-trecho">${escapeHtml(o.trecho)}</span>
        </div>`).join('');
  const ganho = (item.palavras_novas || []).length
    ? `<div class="fia-ganho">+${item.palavras_novas.length} ${item.palavras_novas.length === 1 ? 'palavra nova' : 'palavras novas'}: ${escapeHtml(item.palavras_novas.join(', '))}</div>`
    : '';
  return `
    <div class="fia-linha" data-campo="${escapeHtml(item.id)}">
      <div class="fia-linha-topo">
        ${check}
        <span class="fia-nome">${escapeHtml(item.nome)}</span>
        ${selo}
        <span class="fia-marca">${marca}</span>
        <span class="fia-chars fia-mono">${item.caracteres || String(item.valor).length}/30</span>
      </div>
      ${antesDepois}
      <input type="text" class="fia-valor" data-campo="${escapeHtml(item.id)}" value="${escapeHtml(item.valor)}" />
      ${ganho}
      <div class="fia-evidencia">${origens}</div>
      <button type="button" class="fia-aplicar-um" data-campo="${escapeHtml(item.id)}">Aplicar só este</button>
    </div>`;
}

// Lista 4: nasce SEM checked, e o data-nova é o que o lote usa pra ignorá-la.
function linhaPalavraNova(item) {
  const combos = (item.combos || []).slice(0, 3).map((c) => `<span class="fia-combo">${escapeHtml(c)}</span>`).join('');
  return `
    <div class="fia-linha fia-nova" data-campo="${escapeHtml(item.id)}" data-nova="1">
      <div class="fia-linha-topo">
        <input type="checkbox" class="fia-check-nova" data-campo="${escapeHtml(item.id)}" data-nova="1" />
        <span class="fia-nome">${escapeHtml(item.nome)}</span>
        <span class="fia-marca">🔍</span>
        <span class="fia-chars fia-mono">${item.caracteres || String(item.valor).length}/30</span>
      </div>
      <input type="text" class="fia-valor" data-campo="${escapeHtml(item.id)}" data-nova="1" value="${escapeHtml(item.valor)}" />
      <div class="fia-ganho">+ "${escapeHtml(item.palavra)}" · entra em ${Number(item.buscas) || 0} buscas</div>
      <div class="fia-combos">${combos}</div>
      <div class="fia-alerta-nova">⚠️ Seu anúncio não diz isso hoje.</div>
      <button type="button" class="fia-aplicar-um" data-campo="${escapeHtml(item.id)}" data-nova="1">Aplicar só este</button>
    </div>`;
}

function rotuloFonte(fonte) {
  const f = String(fonte || '');
  if (f === 'titulo') return 'título';
  if (f === 'descricao') return 'descrição';
  if (f.indexOf('atributo:') === 0) return 'outro campo';
  return 'seu anúncio';
}

function blocoErro(icone, titulo, texto, comBotao) {
  return `
    <div class="fia-estado">
      <div class="fia-estado-icone">${icone}</div>
      <p class="fia-estado-titulo">${escapeHtml(titulo)}</p>
      <p class="fia-estado-texto">${escapeHtml(texto)}</p>
      ${comBotao ? '<button type="button" class="fia-retry">Tentar de novo</button>' : ''}
    </div>`;
}

function renderPainel(containerId, { estado, dados, campos, placar }) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Falha NUNCA vira zero: são estados diferentes e a tela precisa dizer qual é.
  if (estado === 'falha') {
    el.innerHTML = blocoErro('🔌', 'Não deu pra consultar a IA agora',
      'Pode ter sido uma instabilidade passageira. Tente de novo em alguns instantes.', true);
    return;
  }
  if (estado === 'ocupado') {
    el.innerHTML = blocoErro('⏱', 'A IA está ocupada agora',
      'Aguarde alguns segundos e tente de novo.', true);
    return;
  }
  if (estado === 'sem_plano') {
    el.innerHTML = blocoErro('🔒', 'Recurso do plano ativo',
      'Ative seu plano para usar o preenchimento com IA.', false);
    return;
  }
  if (estado === 'sessao') {
    el.innerHTML = blocoErro('⏳', 'Sessão expirada',
      'Recarregue a página para continuar.', false);
    return;
  }

  const { comEvidencia, trocas, sohUmAUm, palavrasNovas } = separarSecoes(dados, campos);
  const p = placar || contarPlacar(campos);
  const completo = p.total > 0 && p.preenchidos === p.total;
  const nadaPraFazer = comEvidencia.length === 0 && trocas.length === 0
    && sohUmAUm.length === 0 && palavrasNovas.length === 0;
  const semBase = (dados && dados.sem_base) || [];
  // Conta só o que nasce marcado — o número tem que bater com o que o botão vai salvar.
  const tokensNovos = contarTokensNovos(comEvidencia.concat(trocas));

  const cabecalho = `
    <div class="fia-placar">
      <span class="fia-placar-num">${p.preenchidos} de ${p.total}</span>
      <span class="fia-placar-lbl">campos preenchidos</span>
      ${tokensNovos ? `<span class="fia-placar-tokens" id="fia-tokens" title="O Mercado Livre corta o anúncio se faltar uma palavra da busca. Cada palavra nova abre buscas que estavam fechadas.">+${tokensNovos} ${tokensNovos === 1 ? 'palavra nova' : 'palavras novas'}</span>` : ''}
      ${completo ? '<span class="fia-placar-ok">Nenhum faltando 🎉</span>' : ''}
    </div>`;

  if (nadaPraFazer && completo) {
    el.innerHTML = cabecalho + blocoErro('🎉', 'Ficha completa',
      'Todos os campos que você pode preencher neste anúncio já estão preenchidos.', false);
    return;
  }

  // "Nada passou na régua" é resultado, com caminho — diferente de falha.
  if (nadaPraFazer) {
    el.innerHTML = cabecalho + blocoErro('🔎', 'Não achei base no texto deste anúncio',
      'O título e a descrição não dizem o que preencher nestes campos. Complete a descrição do anúncio e tente de novo.', true)
      + secaoSemBase(semBase);
    return;
  }

  const secao = (titulo, itens, comCheckbox, extra) => itens.length ? `
    <div class="fia-secao">
      <div class="fia-secao-titulo">${titulo} <span class="fia-mono">(${itens.length})</span></div>
      ${extra || ''}
      ${itens.map((i) => linhaSugestao(i, comCheckbox)).join('')}
    </div>` : '';

  // O lote conta SÓ as listas com base no anúncio. Palavra nova e campo caro ficam fora —
  // e o número no botão tem que bater com o que ele vai salvar, senão vira surpresa.
  const totalLote = comEvidencia.length + trocas.length;
  const secaoNovas = palavrasNovas.length ? `
    <div class="fia-secao fia-secao-novas">
      <div class="fia-secao-titulo">🔍 Palavras novas — você decide <span class="fia-mono">(${palavrasNovas.length})</span></div>
      <p class="fia-aviso">Estas palavras abrem buscas que seu anúncio não alcança hoje — mas ele não diz nenhuma delas. Marque só o que é verdade sobre o seu produto.</p>
      ${palavrasNovas.map(linhaPalavraNova).join('')}
    </div>` : '';

  el.innerHTML = cabecalho
    + secao('✅ Achei no seu anúncio', comEvidencia, true)
    + secao('✏️ Vale trocar', trocas, true)
    + (totalLote ? `<button type="button" class="fia-lote">Salvar os ${totalLote} campos marcados</button>` : '')
    + secaoNovas
    + secao('⚠️ Só um a um', sohUmAUm, false,
        '<p class="fia-aviso">Mexer nestes campos muda o link do anúncio e ele perde a exposição que tinha — recomeça como se fosse novo. Só vale se estiver mesmo errado. Por isso ficam fora do botão acima.</p>')
    + secaoSemBase(semBase);
}

// Campo sem base é RESULTADO. Sumir daqui faz o vendedor achar que a ferramenta não olhou.
function secaoSemBase(lista) {
  if (!lista || !lista.length) return '';
  return `
    <div class="fia-secao fia-sem-base">
      <div class="fia-secao-titulo">— Sem base no anúncio <span class="fia-mono">(${lista.length})</span></div>
      <p class="fia-aviso">Nenhum trecho do título ou da descrição diz o valor destes campos. Preencha você — a IA não chuta fato de produto.</p>
      ${lista.map((c) => `<span class="fia-chip">${escapeHtml(c.name || c.id)}</span>`).join('')}
    </div>`;
}

window.MFFicha = {
  motivoBloqueado, renomeiaVariacao, mudaOLink, camposElegiveis, montarPayload,
  formatarPalavrasQueFaltam,
  buscarSugestoes, separarSecoes, contarPlacar, contarTokensNovos, renderPainel,
  linhaPalavraNova, rotuloFonte, chaveCache, _cache: cacheSugestoes,
  escapeHtml, chaveTexto, atributoPreenchido, valorAtual,
  _PROXY: MFFICHA_PROXY,
};

}
