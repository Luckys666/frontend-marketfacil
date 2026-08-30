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

window.MFFicha = {
  motivoBloqueado, renomeiaVariacao, mudaOLink, camposElegiveis, montarPayload,
  formatarPalavrasQueFaltam,
  escapeHtml, chaveTexto, atributoPreenchido, valorAtual,
  _PROXY: MFFICHA_PROXY,
};

}
