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
      // TODAS as categorias, não a primeira. Uma palavra costuma aparecer em várias, e
      // mandar só `cats[0]` (ordem de inserção) deixava uma marca de concorrente que
      // também apareceu em "utilidades" chegar rotulada como utilidade — passando por
      // cima do bloqueio que existe justamente pra ela. Quem decide é o proxy.
      categorias: cats.map(String),
      categoria: String(cats[0] || ''),   // compat: o proxy antigo lia este campo
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

/* ---------- Escrita ---------- */
function montarAtributo(item, campo) {
  const valor = String(item.valor || '').trim();
  if (item.value_id) return { id: item.id, value_id: String(item.value_id), value_name: valor };
  const exato = ((campo && campo.values) || []).find((v) => v && chaveTexto(v.name) === chaveTexto(valor));
  if (exato) return { id: item.id, value_id: String(exato.id), value_name: exato.name };
  return { id: item.id, value_name: valor };
}

/**
 * Traduz a recusa em algo que o vendedor entende e consegue agir.
 * A recusa do NOSSO proxy vem pronta em `error` com um `code` conhecido — usar o texto
 * dele em vez de reescrever; ele sabe o motivo exato.
 */
function traduzirErro(errData, campo) {
  const nome = (campo && campo.name) || 'campo';
  if (!errData) return 'Erro desconhecido.';

  const codigoProxy = String(errData.code || '');
  if (/^(child_pk_|attr_|category_unavailable_in_family|item_unavailable|title_not_editable)/.test(codigoProxy)) {
    const pronta = String(errData.error || '').trim();
    if (pronta) return pronta;
  }

  const cause = Array.isArray(errData.cause) ? errData.cause[0] : null;
  const code = String((cause && cause.code) || errData.ml_error || errData.error || '');
  const msg = String((cause && cause.message) || errData.message || '');

  if (/Same attributes are used in/i.test(msg)) {
    return `${nome} é definido em cada variação deste anúncio. Edite pela tela de variações no Mercado Livre.`;
  }
  if (/value_not_in_allowed_values/i.test(code)) return `${nome}: escolha uma opção da lista de sugestões — texto livre não é aceito aqui.`;
  if (/required|missing/i.test(code)) return `${nome} é obrigatório — precisa ser preenchido.`;
  if (/invalid_length|too_long|too_short|max_length|min_length/i.test(code)) return `${nome}: tamanho fora do permitido.`;
  if (/invalid_format/i.test(code)) return `${nome}: formato não aceito pelo Mercado Livre.`;
  if (/duplicated|already_exists/i.test(code)) return `${nome}: esse valor já está em uso em outro anúncio seu.`;
  if (/read[_\s-]?only/i.test(code)) return `${nome} não pode ser alterado depois que o anúncio foi publicado.`;
  if (/forbidden|not_allowed|not_authorized/i.test(code)) return `${nome}: esse campo não pode ser alterado nesse anúncio.`;
  // Nunca devolver o texto cru do ML: ele fala "atributo", às vezes em espanhol.
  return `Não foi possível salvar ${nome} agora.`;
}

function erroParcial(payload, campo) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload._family_task_error) {
    const e = payload._family_task_error;
    const cause = Array.isArray(e.cause) ? e.cause[0] : null;
    if (/PA_UNAUTHORIZED|policy[_\s-]?agent/i.test(String(e.code || '')) || /PolicyAgent/i.test(String(e.message || (cause && cause.message) || ''))) {
      return `${(campo && campo.name) || 'Esse campo'} é controlado pela família deste anúncio e o Mercado Livre não autorizou a edição por aqui. Edite direto no painel do Mercado Livre.`;
    }
    return traduzirErro(e, campo);
  }
  if (payload._item_put_error) return traduzirErro(payload._item_put_error, campo);
  return null;
}

/**
 * Aplica um ou vários campos. Quarto ponto de escrita do app, e passa pela MESMA régua
 * dos outros três: campo bloqueado não vira requisição.
 */
async function aplicar(itemId, itens, campos, detail, token) {
  const porId = new Map((campos || []).map((c) => [String(c.id), c]));
  const attributes = [];
  const posicaoNoPut = new Map();
  let precisaConfirmar = false;

  for (const item of (itens || [])) {
    const campo = porId.get(String(item.id));
    const motivo = motivoBloqueado(campo, detail);
    if (motivo) {
      const nome = (campo && campo.name) || 'Esse campo';
      const texto = motivo === 'familia'
        ? `${nome} define o grupo de variações deste produto. Mudar por aqui tiraria o anúncio do grupo — edite no Mercado Livre.`
        : motivo === 'variacao'
          ? `${nome} é definido em cada variação — edite pela tela de variações.`
          : `${nome} é preenchido pelo próprio Mercado Livre.`;
      return { ok: false, salvos: 0, erro: texto };
    }
    if (renomeiaVariacao(campo, detail)) precisaConfirmar = true;
    // Um campo, um valor. A lista com base no anúncio e a de palavras novas podem propor
    // valores diferentes pro MESMO campo; mandar os dois faz a ML gravar um e descartar o
    // outro em silêncio, e o vendedor vê na tela um valor que ele não escolheu.
    // Vence o último — que é o que ele marcou por último.
    const montado = montarAtributo(item, campo);
    if (posicaoNoPut.has(item.id)) attributes[posicaoNoPut.get(item.id)] = montado;
    else { posicaoNoPut.set(item.id, attributes.length); attributes.push(montado); }
  }
  if (!attributes.length) return { ok: false, salvos: 0, erro: 'Nenhum campo marcado.' };

  const corpo = precisaConfirmar
    ? { attributes, confirm_rename_variation: true }
    : { attributes };

  let resp;
  try {
    resp = await fetch(MFFICHA_PROXY + '/api/fetch-item-update?item_id=' + encodeURIComponent(itemId), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (e) {
    return { ok: false, salvos: 0, erro: 'Não deu pra salvar agora — verifique sua conexão e tente de novo.' };
  }

  // Qual campo o ML recusou? A ML aponta em `cause[].references` ("item.attributes[2]"
  // ou o id do atributo). Sem procurar, um lote de 5 campos com erro na Marca dizia
  // "Cor: tamanho fora do permitido" — e o vendedor ia consertar o campo errado.
  const campoDoErro = (errData) => {
    const cause = errData && (Array.isArray(errData.cause) ? errData.cause[0] : errData.cause);
    const refs = [].concat((cause && cause.references) || [], String((cause && cause.message) || ''));
    for (const attr of attributes) {
      if (refs.some((r) => String(r).toUpperCase().includes(String(attr.id).toUpperCase()))) {
        return porId.get(String(attr.id));
      }
    }
    const idx = refs.map((r) => /attributes\[(\d+)\]/.exec(String(r))).find(Boolean);
    if (idx && attributes[Number(idx[1])]) return porId.get(String(attributes[Number(idx[1])].id));
    return attributes.length === 1 ? porId.get(String(attributes[0].id)) : null;
  };

  if (!resp.ok) {
    let msg = 'Não foi possível salvar agora.';
    try {
      const err = await resp.json();
      // Sem saber o campo, a mensagem fala do lote — melhor que apontar o errado.
      msg = traduzirErro(err, campoDoErro(err) || { name: 'Um dos campos' }) || msg;
    } catch (_) { /* corpo não-JSON */ }
    return { ok: false, salvos: 0, erro: msg };
  }
  let devolvido = null;
  try { devolvido = await resp.json(); } catch (_) { /* 200 sem corpo */ }
  // 200 no cabeçalho não é sucesso: o proxy roteia família em duas pernas e devolve a
  // recusa DENTRO do corpo. Sem ler isso, a tela mentiria pro vendedor.
  const alvoParcial = campoDoErro((devolvido && (devolvido._family_task_error || devolvido._item_put_error)) || {})
    || (attributes.length === 1 ? porId.get(String(attributes[0].id)) : { name: 'Um dos campos' });
  const parcial = erroParcial(devolvido, alvoParcial);
  if (parcial) return { ok: false, salvos: 0, erro: parcial };

  return { ok: true, salvos: attributes.length, erro: null, atualizado: devolvido };
}

/* ---------- Orquestração ---------- */
// O Agente é a segunda casa do Seletor. Isto precisa rodar ANTES do ad-selector.js.
// O painel vive num wrapper com a MESMA classe de escopo que ele usa na Análise
// (ver build/keyword-agent-bubble.html): assim as 258 regras de css/ad-selector.css
// valem aqui sem que uma linha delas mude — o CSS do Seletor está LIVE.
// `resultsId: null` porque esta página não tem #resultsContainer; hostResultsEl()
// devolve null e os `if (rc)` do seletor seguem valendo.
window.MFSEL_HOST = {
  root: '.ana-wrapper',
  resultsId: null,
  onSelect: function (itemId) { window.MFFicha.abrirFichaIA(itemId); },
};

async function tokenDoML() {
  const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
  if (!r.ok) return null;
  const d = await r.json();
  return (d && d.response && d.response.access_token) || null;
}

// O user_id do app (mint/A2), que as rotas de IA usam como Bearer. O keyword-agent tem
// a mesma chamada, mas o `globalUserId` dele é `let` dentro do bloco do arquivo e nunca
// chega em window — ler window.globalUserId daqui devolvia undefined e TODA chamada de
// IA saía com "Bearer " vazio, que o proxy recusa com 400.
async function obterUserId() {
  if (estadoFicha.userId) return estadoFicha.userId;
  try {
    const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/get-user-id', { method: 'POST' });
    if (!r.ok) return null;
    const d = await r.json();
    estadoFicha.userId = (d && d.response && d.response.user_id) || (d && d.user_id) || null;
    return estadoFicha.userId;
  } catch (e) { return null; }
}

async function proxyGet(rota, token) {
  const r = await fetch(MFFICHA_PROXY + rota, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

const estadoFicha = { itemId: null, detail: null, campos: [], token: null, userId: null, resposta: null };

async function abrirFichaIA(itemId) {
  const view = document.getElementById('ficha-ia-view');
  const body = document.getElementById('ficha-ia-body');
  const painel = document.getElementById('ficha-ia-painel');
  if (!view || !body) return;
  if (painel) painel.hidden = true;
  view.hidden = false;
  body.innerHTML = '<div class="fia-carregando">Lendo a ficha deste anúncio…</div>';

  // O anúncio da vez é gravado ANTES de qualquer await. Sem isto, uma falha na primeira
  // abertura deixava `itemId` null (o "Tentar de novo" nunca funcionaria) e, pior: depois
  // de ver o anúncio A, uma falha ao abrir o B fazia o retry recarregar o A — e o próximo
  // salvamento escrevia no anúncio errado.
  estadoFicha.itemId = itemId || null;
  estadoFicha.detail = null;
  estadoFicha.campos = [];
  // O aviso de família é do anúncio ANTERIOR até a gente saber deste. Limpar aqui evita
  // um anúncio solto herdar "faz parte de um grupo de variações" do que veio antes.
  const cabecalho = document.getElementById('ficha-ia-head');
  if (cabecalho) cabecalho.innerHTML = '';

  // Família: cada variação tem a sua ficha. Sem escolher qual, não há o que sugerir —
  // e gravar na variação errada é pior que não gravar.
  if (/^ML[A-Z]U\d+$/i.test(String(itemId))) {
    body.innerHTML = `
      <div class="fia-estado">
        <div class="fia-estado-icone">🎨</div>
        <p class="fia-estado-titulo">Esse produto tem variações</p>
        <p class="fia-estado-texto">Cada variação tem a própria ficha técnica. Volte para a lista e abra a variação que você quer melhorar.</p>
      </div>`;
    return;
  }

  try {
    estadoFicha.token = estadoFicha.token || await tokenDoML();
    if (!estadoFicha.token) {
      if (typeof window.MF_renderError === 'function') window.MF_renderError(body, 'no_ml_account');
      return;
    }
    const detalhe = await proxyGet('/api/fetch-item?item_id=' + encodeURIComponent(itemId), estadoFicha.token);
    // O /api/fetch-item devolve [{ code, body, description }]: a descrição é IRMÃ do
    // `body`, não filha. Lendo `detail.descriptions.plain_text` (que não existe em item
    // nenhum) a descrição vinha SEMPRE vazia — e como ela é a fonte de evidência mais
    // rica, quase toda sugestão morria na régua e a tela dizia "não achei base" em
    // anúncio com descrição cheia.
    const envelope = Array.isArray(detalhe) ? detalhe[0] : null;
    const detail = envelope ? envelope.body : detalhe;
    if (!detail || !detail.id) throw new Error('sem detalhe');

    if (detail.user_product_id) {
      const nota = document.getElementById('ficha-ia-head');
      // Um mesmo produto pode servir mais de um anúncio — a edição propaga entre eles,
      // por desenho do ML. Não é destrutivo, mas surpreende quem não sabe.
      if (nota) nota.innerHTML = '<p class="fia-aviso">Este anúncio faz parte de um grupo de variações. O que você salvar aqui vale para esta variação.</p>';
    }

    const cats = await proxyGet('/api/attributes/' + encodeURIComponent(detail.category_id), estadoFicha.token);
    // adoption_status só existe em anúncio ATIVO — sem ele, a régua cai pro tags.required
    // da categoria e a tela NÃO afirma que a etapa está completa.
    let obrigatorios = null;
    try {
      const q = await proxyGet('/api/catalog-quality?item_id=' + encodeURIComponent(detail.id), estadoFicha.token);
      const req = q && q.adoption_status && q.adoption_status.required;
      if (req) {
        const ids = [].concat(req.attributes || [], req.missing_attributes || []).filter(Boolean);
        if (ids.length) obrigatorios = new Set(ids);
      }
    } catch (e) { /* sem a lista da ML, vale a da categoria */ }

    const d = (envelope && envelope.description) || detail.description || {};
    const descricao = d.plain_text || d.text || '';
    estadoFicha.itemId = detail.id;
    estadoFicha.detail = detail;
    estadoFicha.campos = camposElegiveis(cats, detail, obrigatorios);

    const payload = montarPayload({
      detail, descricao, categoryAttributes: cats, obrigatoriosML: obrigatorios,
      palavrasQueFaltam: window.MFFicha._palavrasQueFaltam || [],
      siteId: (String(detail.site_id || 'MLB')).toUpperCase(),
    });

    // Cache por anúncio + assinatura da ficha: voltar pra lista e reabrir o mesmo anúncio
    // não paga a IA de novo. Salvar um campo muda a assinatura e a chave se invalida.
    const chave = chaveCache(detail.id, estadoFicha.campos);
    let r = cacheSugestoes.get(chave);
    if (!r) {
      body.innerHTML = '<div class="fia-carregando">A IA está lendo o texto do seu anúncio…</div>';
      const uid = await obterUserId();
      if (!uid) {
        renderPainel('ficha-ia-body', { estado: 'sessao', dados: null, campos: estadoFicha.campos, placar: contarPlacar(estadoFicha.campos) });
        return;
      }
      r = await buscarSugestoes(payload, uid);
      // Falha não entra em cache — senão o botão "tentar de novo" devolveria a mesma falha.
      if (r.estado === 'ok') cacheSugestoes.set(chave, r);
    }
    estadoFicha.resposta = r.estado === 'ok' ? r.dados : null;
    renderPainel('ficha-ia-body', {
      estado: r.estado, dados: r.dados, campos: estadoFicha.campos,
      placar: contarPlacar(estadoFicha.campos),
    });
    ligarBotoes();
  } catch (e) {
    // 401 do ML é conta desconectada, não instabilidade: dizer "tente de novo" manda o
    // vendedor bater na mesma porta pra sempre. É a régua da §8.3 da spec.
    const estado = (e && (e.status === 401 || e.status === 403)) ? 'sessao'
      : (e && e.status === 429) ? 'ocupado'
      : 'falha';
    renderPainel('ficha-ia-body', { estado, dados: null, campos: estadoFicha.campos, placar: contarPlacar(estadoFicha.campos) });
    ligarBotoes();
  }
}

// Sem onclick inline: aspas no valor fechariam a string quando o browser decodifica.
// O #ficha-ia-body sobrevive ao render (renderPainel só troca innerHTML), então cada
// chamada empilhava mais um listener no MESMO elemento. Como salvar() reabre a ficha, o
// segundo clique em "Aplicar só este" disparava DOIS PUTs no anúncio, o terceiro quatro,
// e assim por diante. Delegação se liga uma vez.
let _botoesLigados = false;
function ligarBotoes() {
  const body = document.getElementById('ficha-ia-body');
  if (!body || _botoesLigados) return;
  _botoesLigados = true;
  body.addEventListener('click', async (ev) => {
    const alvo = ev.target;
    if (!alvo) return;
    if (alvo.classList.contains('fia-retry')) { abrirFichaIA(estadoFicha.itemId); return; }
    if (alvo.classList.contains('fia-lote')) { await salvar(marcadosNoLote()); return; }
    if (alvo.classList.contains('fia-aplicar-um')) { await salvar(umCampo(alvo.dataset.campo, !!alvo.dataset.nova)); return; }
  });
}

function valorDigitado(campoId, nova) {
  const seletor = nova
    ? '.fia-valor[data-campo="' + campoId + '"][data-nova="1"]'
    : '.fia-valor[data-campo="' + campoId + '"]:not([data-nova])';
  const input = document.querySelector(seletor);
  return input ? String(input.value || '').trim() : '';
}

/**
 * O lote junta SÓ o que tem base no anúncio.
 * Ficam de fora, por desenho: campo caro (muda o link — não tem checkbox) e palavra nova
 * (checkbox é `.fia-check-nova`, classe diferente de propósito). Se um dia alguém trocar a
 * classe e as duas caírem no mesmo seletor, um clique passa a afirmar característica que o
 * anúncio nunca disse — por isso o seletor aqui é explícito e o teste trava isso.
 */
function marcadosNoLote() {
  const itens = [];
  document.querySelectorAll('.fia-check:not(.fia-check-nova)').forEach((c) => {
    if (!c.checked || c.dataset.nova) return;
    const id = c.dataset.campo;
    itens.push({ id, valor: valorDigitado(id, false) });
  });
  return itens;
}

function umCampo(id, nova) {
  return id ? [{ id, valor: valorDigitado(id, nova) }] : [];
}

async function salvar(itens) {
  const body = document.getElementById('ficha-ia-body');
  if (!body || !itens.length) return;
  const r = await aplicar(estadoFicha.itemId, itens, estadoFicha.campos, estadoFicha.detail, estadoFicha.token);
  if (!r.ok) {
    const aviso = document.createElement('div');
    aviso.className = 'fia-erro';
    aviso.textContent = r.erro;
    body.insertBefore(aviso, body.firstChild);
    return;
  }
  // Estado local acompanha o que foi salvo: o placar sobe na hora, sem refetch.
  for (const item of itens) {
    const campo = estadoFicha.campos.find((c) => c.id === item.id);
    if (campo) { campo.preenchido = true; campo.valor_atual = item.valor; }
    const attrs = (estadoFicha.detail.attributes = estadoFicha.detail.attributes || []);
    const idx = attrs.findIndex((a) => a && a.id === item.id);
    if (idx >= 0) attrs[idx].value_name = item.valor;
    else attrs.push({ id: item.id, value_name: item.valor });
  }
  // Re-render com o que JÁ está na mão: reabrir chamaria fetch-item + attributes +
  // catalog-quality e MAIS uma chamada paga de IA — e o cache não salva, porque a chave
  // inclui o valor dos campos, que acabou de mudar. Salvar 5 campos um a um custaria 5
  // chamadas de IA. O que sai da tela é só o que foi gravado.
  const salvos = new Set(itens.map((i) => String(i.id)));
  if (estadoFicha.resposta) {
    estadoFicha.resposta = {
      ...estadoFicha.resposta,
      sugestoes: (estadoFicha.resposta.sugestoes || []).filter((x) => !salvos.has(String(x.id))),
      palavras_novas_sugeridas: (estadoFicha.resposta.palavras_novas_sugeridas || []).filter((x) => !salvos.has(String(x.id))),
      sem_base: (estadoFicha.resposta.sem_base || []).filter((x) => !salvos.has(String(x.id))),
    };
  }
  renderPainel('ficha-ia-body', {
    estado: 'ok',
    dados: estadoFicha.resposta || { ok: true, sugestoes: [], palavras_novas_sugeridas: [], sem_base: [], descartadas: 0 },
    campos: estadoFicha.campos,
    placar: contarPlacar(estadoFicha.campos),
  });
  const ok = document.createElement('div');
  ok.className = 'fia-ok';
  ok.textContent = r.salvos === 1 ? '1 campo preenchido agora.' : r.salvos + ' campos preenchidos agora.';
  body.insertBefore(ok, body.firstChild);
}

function voltarParaLista() {
  const view = document.getElementById('ficha-ia-view');
  const painel = document.getElementById('ficha-ia-painel');
  if (view) view.hidden = true;
  if (painel) painel.hidden = false;
  // O clique que abriu a ficha passou pelo enterAnalysis do Seletor, que escondeu o
  // #panelView e mostrou o #analysisView. Só desesconder a ficha deixava o vendedor na
  // barra de análise, tendo que clicar num SEGUNDO "voltar" pra ver a lista de novo —
  // e é o exitAnalysis quem redesenha as linhas.
  if (typeof window.MFSelExitAnalysis === 'function') window.MFSelExitAnalysis();
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('ficha-ia-voltar');
  if (btn) btn.addEventListener('click', voltarParaLista);
});

window.MFFicha = {
  motivoBloqueado, renomeiaVariacao, mudaOLink, camposElegiveis, montarPayload,
  formatarPalavrasQueFaltam,
  buscarSugestoes, separarSecoes, contarPlacar, contarTokensNovos, renderPainel,
  linhaPalavraNova, rotuloFonte, chaveCache, _cache: cacheSugestoes,
  montarAtributo, aplicar, traduzirErro, erroParcial,
  abrirFichaIA, voltarParaLista, _palavrasQueFaltam: [],
  // Expostos para o teste de integração alcançar as bordas — foi ali que os 12 defeitos
  // de 30/08 se esconderam enquanto a suíte de lógica pura ficava verde.
  ligarBotoes, salvar, obterUserId,
  _estado: function () { return estadoFicha; },
  escapeHtml, chaveTexto, atributoPreenchido, valorAtual,
  _PROXY: MFFICHA_PROXY,
};

}
