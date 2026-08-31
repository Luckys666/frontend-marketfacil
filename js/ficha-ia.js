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
        // Quem pode receber VÁRIOS valores separados por vírgula. Quem decide é a ML, na
        // tag — não o tipo. `COMPOSITION` é multivalued e aceita "Algodão,Elastano";
        // `SIZE` é `string` igual e aceita UM: "P,M,G" afirma que a mesma peça é P, M e G.
        multivalued: !!(c.tags && c.tags.multivalued),
        _extra: !!(c.tags && c.tags.hidden),
        _renomeia: renomeiaVariacao(c, detail),
        _mudaLink: mudaOLink(c, detail),
      };
    });
}

/**
 * As palavras que o Agente descobriu, guardadas POR ANÚNCIO.
 *
 * Elas não são da sessão: saem do cruzamento entre o que a IA sugeriu e o que AQUELE
 * anúncio já indexa. Numa variável só, as palavras do anúncio analisado antes entravam
 * como sugestão do próximo aberto pelo Seletor — e essa é a lista que afirma
 * característica do produto ("seu anúncio não diz isso hoje"). Mesmo defeito do P1.
 */
const palavrasPorAnuncio = new Map();

function registrarPalavras(itemId, lista) {
  if (!itemId) return;
  palavrasPorAnuncio.set(String(itemId).toUpperCase(), Array.isArray(lista) ? lista : []);
}

function palavrasDoAnuncio(itemId) {
  return palavrasPorAnuncio.get(String(itemId || '').toUpperCase()) || [];
}

/**
 * Caça as palavras que este anúncio NÃO tem, sem passar pela tela do Agente.
 *
 * É o maior ganho da ferramenta e, até aqui, o vendedor só o alcançava se colasse o link
 * no campo de cima e clicasse em ANALISAR. Quem escolhia o anúncio pela lista do Seletor
 * — o caminho principal — recebia a ficha sem nenhuma palavra nova: sobrava só organizar
 * o que o anúncio já dizia, que é o ganho menor.
 *
 * Usa as MESMAS peças do Agente (`window.MFKw`), não uma cópia: a régua de quais palavras
 * faltam é uma só. Falhar aqui não é erro fatal — a ficha ainda vale pelo que o texto do
 * anúncio sustenta, então o erro é engolido e a lista fica vazia.
 */
async function cacarPalavras(itemId, detail, descricao, signal) {
  const Kw = window.MFKw;
  if (!Kw || palavrasPorAnuncio.has(String(itemId).toUpperCase())) return;
  try {
    const uid = await Kw.fetchUserIdForScraping();
    if (!uid) return;

    // ⚠️ NADA DE SCRAPER AQUI. O anúncio é da conta de quem está usando, e o item já veio
    // pela API do ML no começo desta mesma abertura — raspar a página seria pedir de novo,
    // por fora, o que já está na mão. O scraper existe no Agente porque lá o vendedor cola
    // QUALQUER link, inclusive de concorrente; aqui não. Custava crédito de Decodo, corria
    // risco de Anubis e de página instável, e somava segundos ao carregamento (Lucas,
    // 31/08). `extractIndexedWords` só precisa de title + attributes, que o item tem.
    const produto = {
      title: (detail && detail.title) || '',
      attributes: (detail && detail.attributes) || [],
      description: descricao || '',
    };
    if (!produto.title) return;

    const gpt = await Kw.withMintRetry((u) => fetch(Kw.GPT_KEYWORDS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + u },
      body: JSON.stringify({
        texto: produto.title + (produto.description ? '. ' + produto.description : ''),
        site_id: String(itemId).slice(0, 3).toUpperCase(),
      }),
      signal: signal || undefined,
    }));
    if (!gpt.ok) return;
    const keywords = await gpt.json().catch(() => null);
    if (!keywords) return;

    const faltantes = Kw.buildMissingWordsMap(keywords, Kw.extractIndexedWords(produto));
    registrarPalavras(itemId, faltantes.slice(0, 30));
  } catch (e) { /* sem palavras novas a ficha ainda serve; não vira erro na tela */ }
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

/**
 * O pedido: o ID do anúncio e os campos que o vendedor pode mexer. Régua nenhuma sai daqui.
 *
 * O título, a descrição e a ficha atual NÃO viajam mais: quem lê o anúncio é o proxy, no
 * ML, com o token do próprio vendedor. Enquanto vinham daqui, a régua "só sugere o que o
 * anúncio diz" obedecia ao que ESTE CÓDIGO afirmava que o anúncio dizia — e qualquer um
 * com o DevTools aberto reescrevia o "fato" antes de mandar.
 */
function montarPayload({ detail, categoryAttributes, obrigatoriosML, palavrasQueFaltam }) {
  return {
    item_id: (detail && detail.id) || '',
    // `renomeia_variacao` viaja: é o proxy que decide o que oferecer ao modelo, e campo que
    // renomeia a variação não pode entrar na caça de palavras — o ganho é um token e o
    // custo é o anúncio recomeçar sem a exposição que tinha (Lucas, 31/08).
    campos: camposElegiveis(categoryAttributes, detail, obrigatoriosML)
      .map(({ _extra, _renomeia, _mudaLink, ...limpo }) => ({ ...limpo, renomeia_variacao: !!_renomeia })),
    palavras_que_faltam: formatarPalavrasQueFaltam(palavrasQueFaltam),
  };
}

/* ---------- Busca ---------- */
// Sem retry: é rota de IA. Uma tentativa, e o erro sobe — retry multiplica custo sem
// melhorar resultado. Retry só no scraper, onde a instabilidade é real.
async function buscarSugestoes(payload, userId, mlToken, signal) {
  let resp;
  try {
    resp = await fetch(MFFICHA_PROXY + '/api/gpt-ficha', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (userId || ''),
        // Duas identidades diferentes: o Authorization é o user_id do app (mede consumo de
        // IA); o token do ML é o que autoriza LER o anúncio, e é com ele que o proxy busca
        // as três fontes de evidência.
        'X-ML-Token': String(mlToken || ''),
      },
      body: JSON.stringify(payload),
      signal: signal || undefined,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return { estado: 'cancelado', dados: null };
    return { estado: 'falha', dados: null };
  }
  // O motivo vem no `code`: 403 de plano e 403 de "anúncio não é seu" pedem telas
  // diferentes, e mandar o vendedor ativar um plano que ele já tem é pior que não avisar.
  let corpo = null;
  try { corpo = await resp.json(); } catch (e) { corpo = null; }
  const code = String((corpo && corpo.code) || '');

  if (resp.ok) return { estado: 'ok', dados: corpo };
  if (resp.status === 401) return { estado: 'sessao', dados: null };
  if (resp.status === 403) {
    return { estado: code === 'anuncio_de_outra_conta' ? 'outra_conta' : 'sem_plano', dados: null };
  }
  if (resp.status === 404) return { estado: 'nao_encontrado', dados: null };
  if (resp.status === 429) return { estado: 'ocupado', dados: null };
  if (code === 'anuncio_ilegivel' || code === 'ml_indisponivel') return { estado: 'anuncio_ilegivel', dados: null };
  return { estado: 'falha', dados: null };
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
  // Lista 3 (31/08): o anúncio não diz, a IA acha. Mesmas travas da lista 4 — desmarcada e
  // fora do lote —, porque quem afirma continua sendo o vendedor.
  const palpites = ((resposta && resposta.palpites) || []).map(enfeitar);

  const obrigatorioPrimeiro = (a, b) => (b.obrigatorio ? 1 : 0) - (a.obrigatorio ? 1 : 0);
  comEvidencia.sort(obrigatorioPrimeiro);
  trocas.sort(obrigatorioPrimeiro);
  sohUmAUm.sort(obrigatorioPrimeiro);
  palavrasNovas.sort((a, b) => (b.buscas || 0) - (a.buscas || 0));   // mais buscas primeiro
  return { comEvidencia, trocas, sohUmAUm, palavrasNovas, palpites };
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
        ${selosDeTamanho(item)}
      </div>
      ${antesDepois}
      <input type="text" class="fia-valor" data-campo="${escapeHtml(item.id)}" value="${escapeHtml(item.valor)}" />
      ${ganho}
      <div class="fia-evidencia">${origens}</div>
      <button type="button" class="fia-aplicar-um" data-campo="${escapeHtml(item.id)}">Aplicar só este</button>
    </div>`;
}

/**
 * Lista 3: o palpite. O anúncio não diz — a IA acha que é assim para este produto.
 *
 * Nasce desmarcado e fora do lote, igual à palavra nova: o que muda é a origem da
 * afirmação, e ela fica escrita na linha ("por quê"). Campo vazio não indexa nada, e o
 * vendedor perde mais com o campo em branco do que com um palpite que ele corrige em um
 * clique (Lucas, 31/08).
 */
function linhaPalpite(item) {
  const ganho = (item.palavras_novas || []).length
    ? `<div class="fia-ganho">+${item.palavras_novas.length} ${item.palavras_novas.length === 1 ? 'palavra nova' : 'palavras novas'}: ${escapeHtml(item.palavras_novas.join(', '))}</div>`
    : '';
  return `
    <div class="fia-linha fia-nova" data-campo="${escapeHtml(item.id)}" data-nova="1">
      <div class="fia-linha-topo">
        <input type="checkbox" class="fia-check-nova" data-campo="${escapeHtml(item.id)}" data-nova="1" />
        <span class="fia-nome">${escapeHtml(item.name || item.id)}</span>
        <span class="fia-marca">🤔</span>
        ${selosDeTamanho(item)}
      </div>
      <input type="text" class="fia-valor" data-campo="${escapeHtml(item.id)}" data-nova="1" value="${escapeHtml(item.valor)}" />
      ${ganho}
      ${item.porque ? `<div class="fia-porque">${escapeHtml(item.porque)}</div>` : ''}
      <button type="button" class="fia-aplicar-um" data-campo="${escapeHtml(item.id)}" data-nova="1">Aplicar só este</button>
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
        ${selosDeTamanho(item)}
      </div>
      <input type="text" class="fia-valor" data-campo="${escapeHtml(item.id)}" data-nova="1" value="${escapeHtml(item.valor)}" />
      <div class="fia-ganho">+ "${escapeHtml(item.palavra)}" · entra em ${Number(item.buscas) || 0} buscas</div>
      <div class="fia-combos">${combos}</div>
      <div class="fia-alerta-nova">⚠️ Seu anúncio não diz isso hoje.</div>
      <button type="button" class="fia-aplicar-um" data-campo="${escapeHtml(item.id)}" data-nova="1">Aplicar só este</button>
    </div>`;
}

/**
 * O contador de caracteres só é informação onde ainda cabe escolha.
 *
 * O ML indexa os 30 primeiros caracteres de cada campo, então em campo de TEXTO sobrar
 * espaço é perder busca — e o contador é um chamado pra caçar mais palavra. Mas em campo de
 * lista fechada, sim/não ou número, o valor é único e exato: "Quadrado" ocupa 8 e não existe
 * nada que ocupe mais. Ali o "8/30" acusa um desperdício que não existe e manda o vendedor
 * procurar o que não há — medido em MLB6683355882 (31/08/2026).
 */
function aceitaMaisTexto(campo) {
  const t = String((campo && campo.value_type) || 'string');
  return t !== 'list' && t !== 'boolean' && t !== 'number' && t !== 'number_unit';
}

function selosDeTamanho(item) {
  const usados = item.caracteres || String(item.valor || '').length;
  if (!aceitaMaisTexto(item.campo)) return '';
  const sobra = 30 - usados;
  const dica = sobra > 6
    ? ` <span class="fia-sobra" title="O Mercado Livre indexa os 30 primeiros caracteres deste campo. O que sobra é busca que o anúncio deixa de alcançar.">cabe mais ${sobra}</span>`
    : '';
  return `<span class="fia-chars fia-mono" title="O Mercado Livre indexa os 30 primeiros caracteres deste campo.">${usados}/30</span>${dica}`;
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
  // O anúncio é lido no Mercado Livre, com a conta conectada. Estes três estados dizem o
  // que aconteceu lá — misturar com "não achei base no anúncio" faria o vendedor procurar
  // problema no texto dele quando o problema é outro.
  if (estado === 'outra_conta') {
    el.innerHTML = blocoErro('🔑', 'Esse anúncio não é da sua conta',
      'Ele está em outra conta do Mercado Livre. Volte para a lista e escolha um anúncio seu.', false);
    return;
  }
  if (estado === 'nao_encontrado') {
    el.innerHTML = blocoErro('🔎', 'Não encontrei esse anúncio',
      'Ele pode ter sido excluído no Mercado Livre. Volte para a lista e atualize.', false);
    return;
  }
  if (estado === 'anuncio_ilegivel') {
    el.innerHTML = blocoErro('🔌', 'Não deu pra ler seu anúncio agora',
      'O Mercado Livre não respondeu. Tente de novo em alguns instantes.', true);
    return;
  }

  const { comEvidencia, trocas, sohUmAUm, palavrasNovas, palpites } = separarSecoes(dados, campos);
  const p = placar || contarPlacar(campos);
  const completo = p.total > 0 && p.preenchidos === p.total;
  const nadaPraFazer = comEvidencia.length === 0 && trocas.length === 0
    && sohUmAUm.length === 0 && palavrasNovas.length === 0 && palpites.length === 0;
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

  // Lista 3: o anúncio não diz, a IA acha. Campo vazio não indexa nada, então vale propor —
  // desde que a tela deixe claríssimo de onde veio a afirmação e que quem decide é ele.
  const secaoPalpites = palpites.length ? `
    <div class="fia-secao fia-secao-palpites">
      <div class="fia-secao-titulo">🤔 A IA acha que é isso — confirme <span class="fia-mono">(${palpites.length})</span></div>
      <p class="fia-aviso">Seu anúncio não diz nada sobre estes campos, então isto é o que costuma valer para um produto assim. Campo em branco não aparece em busca nenhuma — vale conferir e marcar o que estiver certo.</p>
      ${palpites.map(linhaPalpite).join('')}
    </div>` : '';

  el.innerHTML = cabecalho
    + secao('✅ Achei no seu anúncio', comEvidencia, true)
    + secao('✏️ Vale trocar', trocas, true)
    + (totalLote ? `<button type="button" class="fia-lote">Salvar os ${totalLote} campos marcados</button>` : '')
    + secaoNovas
    + secaoPalpites
    + secao('⚠️ Só um a um', sohUmAUm, false,
        '<p class="fia-aviso">Mexer nestes campos muda o link do anúncio e ele perde a exposição que tinha — recomeça como se fosse novo. Só vale se estiver mesmo errado. Por isso ficam fora do botão acima.</p>')
    + secaoSemBase(semBase);
}

// Campo sem base é RESULTADO. Sumir daqui faz o vendedor achar que a ferramenta não olhou.
function secaoSemBase(lista) {
  if (!lista || !lista.length) return '';
  return `
    <div class="fia-secao fia-sem-base">
      <div class="fia-secao-titulo">— Estes ficaram com você <span class="fia-mono">(${lista.length})</span></div>
      <p class="fia-aviso">Nem o anúncio diz, nem deu pra supor com segurança. São dados que só você tem — e cada um preenchido é mais uma busca em que o anúncio entra.</p>
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
  // `opts.variacoes` chega quando o clique foi numa linha-produto: são as irmãs da mesma
  // família, que só o Seletor conhece (ele agrupa por family_id). Sem elas, o que a ficha
  // recebe é o produto de UMA variação — e o vendedor não escolhe nada.
  onSelect: function (itemId, opts) {
    window.MFFicha.abrirFichaIA(itemId, (opts && opts.variacoes) || null);
  },

  // O resumo e os filtros aqui são de FICHA E PALAVRAS, não de operação (Lucas, 31/08).
  // Quem abre esta página veio melhorar o que o anúncio DIZ; "Pausados sem estoque",
  // "Estoque quase no fim" e "Corrigir para reativar" são problemas de venda, e ocupavam a
  // primeira tela inteira antes do que ele veio fazer. Ficam os quatro que se resolvem
  // preenchendo campo, na ordem em que rendem:
  //   ficha incompleta é o motivo da página existir; sem GTIN é campo de ficha; perder
  //   exposição é, na maioria das vezes, consequência de ficha pobre.
  chips: ['incomplete_specs', 'missing_gtin', 'unhealthy', 'warning'],

  // Como esta tela só olha os sinais de ficha, "nenhum problema nos seus anúncios" seria
  // falso — a conta pode ter 101 pausados sem estoque, que não são assunto daqui.
  textoSemProblemas: 'Nenhum anúncio seu está com ficha incompleta 🎉 Escolha um abaixo para procurar palavras novas.',

  // "Com desconto" e "Frete grátis abaixo de R$ 79" recortam por preço e frete: úteis pra
  // quem caça margem, ruído pra quem veio escrever ficha.
  filtrosDePreco: false,
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

async function proxyGet(rota, token, signal) {
  const r = await fetch(MFFICHA_PROXY + rota, {
    headers: { Authorization: 'Bearer ' + token },
    signal: signal || undefined,
  });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

const estadoFicha = { itemId: null, detail: null, campos: [], token: null, userId: null, resposta: null };

/**
 * Qual abertura é a válida. `estadoFicha` é um só, e abrirFichaIA tem cinco awaits: abrir o
 * anúncio A, voltar e abrir o B fazia a cadeia de A — que ainda estava no ar — reescrever o
 * estado por cima do B. A tela mostrava A achando que era B, e um salvar() de A que chegasse
 * atrasado marcava campo de B como gravado: a tela passava a mentir sobre o anúncio.
 * Só a última abertura vale; as anteriores viram no-op e são canceladas.
 */
let _geracao = 0;
let _abortar = null;

function novaGeracao() {
  if (_abortar) { try { _abortar.abort(); } catch (e) { /* navegador antigo */ } }
  _abortar = (typeof AbortController === 'function') ? new AbortController() : null;
  _geracao += 1;
  return { id: _geracao, signal: _abortar ? _abortar.signal : undefined };
}

const geracaoVigente = (g) => g === _geracao;

/** O que o vendedor está editando, sempre visível. Sem isto não há como perceber a troca. */
function cabecalhoDoAnuncio(itemId, titulo) {
  const id = escapeHtml(String(itemId || ''));
  return `
    <div class="fia-alvo">
      <span class="fia-alvo-rotulo">Editando</span>
      <span class="fia-alvo-titulo">${escapeHtml(titulo || 'seu anúncio')}</span>
      <span class="fia-alvo-id fia-mono">${id}</span>
    </div>`;
}

/** O seller da conta conectada — o endpoint de itens do produto exige. */
let _sellerId = null;
async function sellerIdDaConta(signal) {
  if (_sellerId) return _sellerId;
  try {
    const me = await proxyGet('/api/users/me', estadoFicha.token, signal);
    _sellerId = String((me && (me.id || (me.body && me.body.id))) || '') || null;
  } catch (e) { _sellerId = null; }
  return _sellerId;
}

function linhaVariacao(item) {
  // O que distingue uma variação da outra é o CHILD_PK — cor, tamanho, desenho. Mostrar
  // o título inteiro não ajuda: ele é quase igual em todas.
  // Só o que o vendedor usa pra reconhecer a peça: cor, tamanho, desenho. `SELLER_SKU` e
  // `GTIN` também são atributos de variação, mas são CÓDIGO — na tela de escolha viravam
  // "Código universal de produto: 7891800840100" ao lado de "Cor: Branco", empurrando o que
  // importa pro fim da linha (visto em conta real, 31/08).
  const distintivos = ((item.attributes || [])
    .filter((a) => a && a.value_name
      && VARIATION_ATTR_IDS.has(String(a.id).toUpperCase())
      && !IDS_FORA.has(String(a.id).toUpperCase()))
    .map((a) => `<span class="fia-var-attr"><b>${escapeHtml(a.name)}:</b> ${escapeHtml(a.value_name)}</span>`)
    .join('')) || '<span class="fia-var-attr">variação sem cor/tamanho definidos</span>';

  const pausado = String(item.status || '') !== 'active';
  const preenchidos = ((item.attributes || []).filter((a) => a && a.value_name)).length;

  return `
    <button type="button" class="fia-var" data-variacao="${escapeHtml(item.id)}">
      <span class="fia-var-topo">
        <span class="fia-var-attrs">${distintivos}</span>
        ${pausado ? '<span class="fia-var-pausado">pausado</span>' : ''}
      </span>
      <span class="fia-var-rodape">
        <span class="fia-var-id fia-mono">${escapeHtml(item.id)}</span>
        <span class="fia-var-campos">${preenchidos} campos preenchidos</span>
      </span>
    </button>`;
}

/**
 * Produto com variações: cada uma tem a SUA ficha, então a escolha acontece aqui.
 * Antes a tela dizia "volte para a lista e abra a variação que você quer melhorar" — o que
 * é jogar o trabalho de volta pro vendedor, e ele nem sempre sabe qual linha da lista
 * corresponde a qual variação.
 */
async function escolherVariacao(produtoId, body, geracao, signal, idsJaConhecidos) {
  body.innerHTML = '<div class="fia-carregando">Vendo as variações deste produto…</div>';

  // Quando o clique veio de uma linha-produto, o Seletor já sabe quais são as irmãs — e
  // são elas que importam, não os itens do user_product (que costuma ter uma só).
  if (Array.isArray(idsJaConhecidos) && idsJaConhecidos.length > 1) {
    await mostrarVariacoes(idsJaConhecidos, produtoId, body, geracao, signal);
    return;
  }

  const seller = await sellerIdDaConta(signal);
  if (!geracaoVigente(geracao)) return;

  let ids = [];
  try {
    const r = await proxyGet(
      '/api/user-products/' + encodeURIComponent(produtoId) + '/items?seller_id=' + encodeURIComponent(seller || ''),
      estadoFicha.token, signal
    );
    // A ML devolve os ids como STRING nesta rota (medido em 31/08), mas aceitar objeto
    // também sai de graça e evita quebrar se ela mudar.
    ids = ((r && r.results) || [])
      .map((x) => (typeof x === 'string' ? x : (x && (x.id || x.item_id))))
      .filter(Boolean)
      .map(String);
  } catch (e) {
    if (!geracaoVigente(geracao) || (e && e.name === 'AbortError')) return;
  }
  if (!geracaoVigente(geracao)) return;

  // Um anúncio só: pedir pra escolher entre uma coisa é clique a troco de nada.
  // Se a ML devolvesse aqui o próprio id do produto, abrir "a única variação" recursaria no
  // mesmo MLBU pra sempre. Só segue com anúncio (MLB) de verdade.
  ids = ids.filter((id) => id !== produtoId && /^ML[A-Z]\d/i.test(id) && !/^ML[A-Z]U/i.test(id));

  if (!ids.length) {
    body.innerHTML = blocoErro('🎨', 'Não achei as variações deste produto',
      'Ele agrupa variações, mas o Mercado Livre não devolveu nenhuma agora. Tente de novo em alguns instantes.', true);
    ligarBotoes();
    return;
  }

  await mostrarVariacoes(ids, produtoId, body, geracao, signal);
}

/** Desenha a escolha. Recebe os ids já resolvidos, venha de onde vier o grupo. */
async function mostrarVariacoes(ids, produtoId, body, geracao, signal) {
  // Um anúncio só: pedir pra escolher entre uma coisa é clique a troco de nada.
  if (ids.length === 1) { await abrirFichaIA(ids[0]); return; }

  let itens = [];
  try {
    const d = await proxyGet('/api/fetch-item?item_id=' + ids.slice(0, 20).join(','), estadoFicha.token, signal);
    itens = (Array.isArray(d) ? d : []).map((x) => (x && x.body) || x).filter((x) => x && x.id);
  } catch (e) {
    if (!geracaoVigente(geracao) || (e && e.name === 'AbortError')) return;
  }
  if (!geracaoVigente(geracao)) return;

  // Sem os detalhes ainda dá pra escolher pelo id — pior, mas melhor que uma parede.
  if (!itens.length) itens = ids.slice(0, 20).map((id) => ({ id, attributes: [], status: 'active' }));

  const cabecalho = document.getElementById('ficha-ia-head');
  if (cabecalho) cabecalho.innerHTML = cabecalhoDoAnuncio(produtoId, (itens[0] && itens[0].title) || null);

  body.innerHTML = `
    <div class="fia-estado-topo">
      <p class="fia-estado-titulo">Qual variação você quer melhorar?</p>
      <p class="fia-estado-texto">Cada variação tem a própria ficha técnica. Escolha uma para ver o que dá pra preencher nela.</p>
    </div>
    <div class="fia-vars">${itens.map(linhaVariacao).join('')}</div>`;
  ligarBotoes();
}

async function abrirFichaIA(itemId, variacoesDoGrupo) {
  const view = document.getElementById('ficha-ia-view');
  const body = document.getElementById('ficha-ia-body');
  const painel = document.getElementById('ficha-ia-painel');
  if (!view || !body) return;
  if (painel) painel.hidden = true;
  view.hidden = false;
  body.innerHTML = '<div class="fia-carregando">Lendo a ficha deste anúncio…</div>';

  // Esta abertura passa a ser a válida; a anterior, se ainda estiver no ar, é cancelada.
  const { id: geracao, signal } = novaGeracao();

  // O anúncio da vez é gravado ANTES de qualquer await. Sem isto, uma falha na primeira
  // abertura deixava `itemId` null (o "Tentar de novo" nunca funcionaria) e, pior: depois
  // de ver o anúncio A, uma falha ao abrir o B fazia o retry recarregar o A — e o próximo
  // salvamento escrevia no anúncio errado.
  estadoFicha.itemId = itemId || null;
  estadoFicha.detail = null;
  estadoFicha.campos = [];
  // O aviso de família é do anúncio ANTERIOR até a gente saber deste. Limpar aqui evita
  // um anúncio solto herdar "faz parte de um grupo de variações" do que veio antes.
  // O ID já entra: durante o carregamento o vendedor precisa saber o que está abrindo.
  const cabecalho = document.getElementById('ficha-ia-head');
  if (cabecalho) cabecalho.innerHTML = cabecalhoDoAnuncio(itemId, null);

  // Família: cada variação tem a sua ficha, e gravar na errada é pior que não gravar. Mas
  // mandar o vendedor "voltar para a lista e achar a variação" é jogar o trabalho de volta
  // pra ele — a escolha acontece aqui mesmo (Lucas, 31/08).
  // Duas portas pro mesmo lugar: o clique numa linha-produto traz as irmãs prontas (o
  // Seletor agrupa por family_id), e um MLBU digitado ou vindo de outro caminho faz a
  // busca pelo produto. Grupo de 2+ manda escolher venha de onde vier.
  const doGrupo = (Array.isArray(variacoesDoGrupo) ? variacoesDoGrupo : [])
    .map(String).filter((id) => /^ML[A-Z]\d/i.test(id) && !/^ML[A-Z]U/i.test(id));

  if (doGrupo.length > 1 || /^ML[A-Z]U\d+$/i.test(String(itemId))) {
    try {
      estadoFicha.token = estadoFicha.token || await tokenDoML();
      if (!geracaoVigente(geracao)) return;
      await escolherVariacao(itemId, body, geracao, signal, doGrupo);
    } catch (e) {
      if (!geracaoVigente(geracao) || (e && e.name === 'AbortError')) return;
      renderPainel('ficha-ia-body', { estado: 'falha', dados: null, campos: [], placar: { preenchidos: 0, total: 0 } });
      ligarBotoes();
    }
    return;
  }

  try {
    const token = estadoFicha.token || await tokenDoML();
    if (!geracaoVigente(geracao)) return;
    estadoFicha.token = token;
    if (!estadoFicha.token) {
      if (typeof window.MF_renderError === 'function') window.MF_renderError(body, 'no_ml_account');
      return;
    }
    const detalhe = await proxyGet('/api/fetch-item?item_id=' + encodeURIComponent(itemId), estadoFicha.token, signal);
    if (!geracaoVigente(geracao)) return;
    // O /api/fetch-item devolve [{ code, body, description }]: a descrição é IRMÃ do
    // `body`, não filha. Lendo `detail.descriptions.plain_text` (que não existe em item
    // nenhum) a descrição vinha SEMPRE vazia — e como ela é a fonte de evidência mais
    // rica, quase toda sugestão morria na régua e a tela dizia "não achei base" em
    // anúncio com descrição cheia.
    const envelope = Array.isArray(detalhe) ? detalhe[0] : null;
    const detail = envelope ? envelope.body : detalhe;
    if (!detail || !detail.id) throw new Error('sem detalhe');
    // A descrição não vai mais no payload da ficha (quem lê é o proxy, no ML), mas serve
    // aqui: é dela que a caça de palavras tira o texto, sem precisar raspar a página.
    const d = (envelope && envelope.description) || detail.description || {};
    const descricao = d.plain_text || d.text || '';

    const nota = document.getElementById('ficha-ia-head');
    if (nota) {
      // Um mesmo produto pode servir mais de um anúncio — a edição propaga entre eles,
      // por desenho do ML. Não é destrutivo, mas surpreende quem não sabe.
      const avisoFamilia = detail.user_product_id
        ? '<p class="fia-aviso">Este anúncio faz parte de um grupo de variações. O que você salvar aqui vale para esta variação.</p>'
        : '';
      nota.innerHTML = cabecalhoDoAnuncio(detail.id, detail.title) + avisoFamilia;
    }

    const cats = await proxyGet('/api/attributes/' + encodeURIComponent(detail.category_id), estadoFicha.token, signal);
    if (!geracaoVigente(geracao)) return;
    // adoption_status só existe em anúncio ATIVO — sem ele, a régua cai pro tags.required
    // da categoria e a tela NÃO afirma que a etapa está completa.
    let obrigatorios = null;
    try {
      const q = await proxyGet('/api/catalog-quality?item_id=' + encodeURIComponent(detail.id), estadoFicha.token, signal);
      const req = q && q.adoption_status && q.adoption_status.required;
      if (req) {
        const ids = [].concat(req.attributes || [], req.missing_attributes || []).filter(Boolean);
        if (ids.length) obrigatorios = new Set(ids);
      }
    } catch (e) { /* sem a lista da ML, vale a da categoria */ }
    if (!geracaoVigente(geracao)) return;

    estadoFicha.itemId = detail.id;
    estadoFicha.detail = detail;
    estadoFicha.campos = camposElegiveis(cats, detail, obrigatorios);

    // As palavras que o anúncio não tem vêm ANTES da chamada da ficha, não depois: a IA
    // precisa delas na mão pra propor onde cada uma cabe. Buscar depois custaria uma
    // segunda chamada paga pro mesmo anúncio.
    if (!palavrasPorAnuncio.has(String(detail.id).toUpperCase())) {
      body.innerHTML = '<div class="fia-carregando">Procurando palavras que seu anúncio ainda não alcança…</div>';
      await cacarPalavras(detail.id, detail, descricao, signal);
      if (!geracaoVigente(geracao)) return;
    }

    const payload = montarPayload({
      detail, categoryAttributes: cats, obrigatoriosML: obrigatorios,
      palavrasQueFaltam: palavrasDoAnuncio(detail.id),
    });

    // Cache por anúncio + assinatura da ficha: voltar pra lista e reabrir o mesmo anúncio
    // não paga a IA de novo. Salvar um campo muda a assinatura e a chave se invalida.
    const chave = chaveCache(detail.id, estadoFicha.campos);
    let r = cacheSugestoes.get(chave);
    if (!r) {
      body.innerHTML = '<div class="fia-carregando">A IA está lendo o texto do seu anúncio…</div>';
      const uid = await obterUserId();
      if (!geracaoVigente(geracao)) return;
      if (!uid) {
        renderPainel('ficha-ia-body', { estado: 'sessao', dados: null, campos: estadoFicha.campos, placar: contarPlacar(estadoFicha.campos) });
        return;
      }
      r = await buscarSugestoes(payload, uid, estadoFicha.token, signal);
      if (!geracaoVigente(geracao)) return;
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
    // Abertura cancelada (o vendedor já abriu outro anúncio) não é erro e não pode pintar
    // a tela do anúncio novo com a falha do antigo.
    if (!geracaoVigente(geracao) || (e && e.name === 'AbortError')) return;
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
    // A escolha da variação abre a ficha DELA. `closest` porque o clique quase sempre cai
    // num span de dentro do botão, não no botão.
    const variacao = typeof alvo.closest === 'function' ? alvo.closest('.fia-var') : null;
    if (variacao && variacao.dataset && variacao.dataset.variacao) {
      await abrirFichaIA(variacao.dataset.variacao);
      return;
    }
    if (alvo.classList.contains('fia-retry')) { abrirFichaIA(estadoFicha.itemId); return; }
    if (alvo.classList.contains('fia-lote')) { await salvar(marcadosNoLote()); return; }
    if (alvo.classList.contains('fia-aplicar-um')) { await salvar(umCampo(alvo)); return; }
  });
}

/**
 * O valor é o da LINHA de onde veio o clique — não o do primeiro `data-campo` igual no DOM.
 *
 * O prompt pede uma proposta por palavra, então duas linhas para o mesmo campo é o caso
 * esperado (uma para "inox", outra para "escovado"). Procurando por `data-campo` no
 * documento inteiro, clicar em "Aplicar" na segunda gravava o valor da primeira — o
 * vendedor publicava uma afirmação que ele não escolheu.
 */
function valorDaLinha(origem) {
  const linha = origem && typeof origem.closest === 'function' ? origem.closest('.fia-linha') : null;
  const input = linha ? linha.querySelector('.fia-valor') : null;
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
    itens.push({ id: c.dataset.campo, valor: valorDaLinha(c) });
  });
  return itens;
}

function umCampo(origem) {
  const id = origem && origem.dataset ? origem.dataset.campo : '';
  return id ? [{ id, valor: valorDaLinha(origem) }] : [];
}

async function salvar(itens) {
  const body = document.getElementById('ficha-ia-body');
  if (!body || !itens.length) return;
  // O alvo é fotografado agora. Se o vendedor trocar de anúncio enquanto o PUT está no ar,
  // o que volta é sobre o anúncio ANTIGO: escrever isso no estado atual marcaria campo do
  // anúncio novo como salvo, e a tela passaria a mentir sobre o que está gravado.
  const geracao = _geracao;
  const alvo = {
    itemId: estadoFicha.itemId,
    detail: estadoFicha.detail,
    campos: estadoFicha.campos,
    token: estadoFicha.token,
  };
  const r = await aplicar(alvo.itemId, itens, alvo.campos, alvo.detail, alvo.token);
  // O PUT foi feito de verdade (e é do anúncio certo); só a TELA não é mais deste assunto.
  if (!geracaoVigente(geracao)) return;
  if (!r.ok) {
    const aviso = document.createElement('div');
    aviso.className = 'fia-erro';
    aviso.textContent = r.erro;
    body.insertBefore(aviso, body.firstChild);
    return;
  }
  // Estado local acompanha o que foi salvo: o placar sobe na hora, sem refetch.
  for (const item of itens) {
    const campo = alvo.campos.find((c) => c.id === item.id);
    if (campo) { campo.preenchido = true; campo.valor_atual = item.valor; }
    const attrs = (alvo.detail.attributes = alvo.detail.attributes || []);
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

// Delegação no document, e NÃO `DOMContentLoaded` + `getElementById`: no Bubble o HTML
// entra por innerHTML e este script roda muito depois do DOMContentLoaded, então aquele
// listener nunca chegava a ser registrado — o botão existia na tela e não fazia nada.
// (O keyword-agent contorna o mesmo problema com bindButton + setTimeout; delegação
// resolve sem depender de quando o elemento aparece, e sobrevive a um re-render.)
document.addEventListener('click', (ev) => {
  const alvo = ev && ev.target && typeof ev.target.closest === 'function'
    ? ev.target.closest('#ficha-ia-voltar')
    : null;
  if (!alvo) return;
  ev.preventDefault();
  voltarParaLista();
});

window.MFFicha = {
  motivoBloqueado, renomeiaVariacao, mudaOLink, camposElegiveis, montarPayload,
  formatarPalavrasQueFaltam,
  buscarSugestoes, separarSecoes, contarPlacar, contarTokensNovos, renderPainel,
  linhaPalavraNova, linhaPalpite, rotuloFonte, chaveCache, _cache: cacheSugestoes,
  montarAtributo, aplicar, traduzirErro, erroParcial,
  abrirFichaIA, voltarParaLista, registrarPalavras, palavrasDoAnuncio,
  // Expostos para o teste de integração alcançar as bordas — foi ali que os 12 defeitos
  // de 30/08 se esconderam enquanto a suíte de lógica pura ficava verde.
  ligarBotoes, salvar, obterUserId,
  _estado: function () { return estadoFicha; },
  escapeHtml, chaveTexto, atributoPreenchido, valorAtual,
  _PROXY: MFFICHA_PROXY,
};

}
