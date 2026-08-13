/**
 * Ad Analyzer Widget Logic
 */

// === MF_renderError — error UI padrão Marketfacil (idempotente) ===
if (typeof window.MF_renderError !== 'function') {
  (function(){
    function buildMcUrl() {
      return window.location.href.includes('version-test')
        ? 'https://app.marketfacil.com.br/version-test/minha-conta'
        : 'https://app.marketfacil.com.br/minha-conta';
    }
    var TYPES = {
      no_ml_account: { icon: '🔐', title: 'Conta do Mercado Livre não conectada', msg: 'Pra usar essa ferramenta, conecte sua conta do Mercado Livre ao Marketfacil em <b>Minha Conta</b>.', cta: { label: 'Conectar conta do ML →', href: buildMcUrl } },
      session_expired: { icon: '⏳', title: 'Sessão expirou', msg: 'Sua sessão com o Mercado Livre expirou. Reconecte sua conta no Marketfacil pra continuar.', cta: { label: 'Reconectar conta →', href: buildMcUrl } },
      forbidden: { icon: '🚫', title: 'Acesso negado', msg: 'O Mercado Livre bloqueou essa requisição. Tente novamente em alguns minutos.', cta: null },
      rate_limited: { icon: '⏱', title: 'Muitas requisições', msg: 'Você atingiu o limite. Aguarde um instante e tente de novo.', cta: null },
      network_error: { icon: '🌐', title: 'Falha de conexão', msg: 'Não foi possível conectar ao Marketfacil. Verifique sua internet e tente novamente.', cta: null }
    };
    function injectStyles() {
      if (document.getElementById('mf-error-styles')) return;
      var style = document.createElement('style');
      style.id = 'mf-error-styles';
      style.textContent = ".mf-error-card{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;text-align:center;font-family:'DM Sans',sans-serif;color:#1e3a5f}.mf-error-icon{font-size:48px;line-height:1;margin-bottom:12px}.mf-error-title{font-size:18px;font-weight:700;margin:0 0 8px 0;color:#1e3a5f}.mf-error-msg{font-size:14px;color:#475569;max-width:480px;margin:0 0 16px 0;line-height:1.45}.mf-error-cta{display:inline-block;padding:10px 20px;background:#1e3a5f;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;transition:background .15s ease}.mf-error-cta:hover{background:#0f172a;color:#fff;text-decoration:none}";
      (document.head || document.body).appendChild(style);
    }
    function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
    window.MF_renderError = function(container, type, opts) {
      if (!container) return;
      injectStyles();
      var cfg = TYPES[type];
      if (!cfg) { container.innerHTML = '<div class="mf-error-card"><p class="mf-error-msg">'+escapeHtml((opts&&opts.msg)||'Erro inesperado.')+'</p></div>'; return; }
      var title = (opts && opts.title) || cfg.title;
      var msg = (opts && opts.msg) || cfg.msg;
      var cta = cfg.cta && (typeof cfg.cta.href === 'function' ? { label: cfg.cta.label, href: cfg.cta.href() } : cfg.cta);
      container.innerHTML = '<div class="mf-error-card mf-error-'+type+'"><div class="mf-error-icon">'+cfg.icon+'</div><p class="mf-error-title">'+escapeHtml(title)+'</p><p class="mf-error-msg">'+msg+'</p>'+(cta?'<a href="'+escapeHtml(cta.href)+'" class="mf-error-cta">'+escapeHtml(cta.label)+'</a>':'')+'</div>';
    };
    window.MF_ERROR_TYPES = Object.keys(TYPES);
  })();
}
// === fim MF_renderError ===

// -------------- Constantes de Configuração --------------
const MIN_CHARS_TITULO_RUIM = 40;
const MIN_CHARS_TITULO_BOM = 50;
const MAX_CHARS_TITULO_BOM = 999; // Sem limite max
const PONTOS_PENALIDADE_TITULO_CURTO = -15;
const PONTOS_PENALIDADE_TITULO_MEDIO = -8;
const TAMANHO_IDEAL_ATRIBUTO = 30;
const PONTOS_PENALIDADE_POR_10_CHARS_DIF_ATR = -2;
const PONTOS_PENALIDADE_POR_PALAVRA_REPETIDA = -3;
const PONTOS_PENALIDADE_SEM_ATRIBUTOS = -15;
const PONTOS_PENALIDADE_MODERATION_PENALTY = -50;
const PONTOS_BONUS_DESCRICAO = 5;
const ATRIBUTOS_IGNORADOS_REPETICAO = new Set([]); // Lista limpa para ser mais rigoroso
const ATRIBUTOS_IGNORADOS_COMPLETAMENTE = new Set(['GTIN', 'SKU', 'SELLER_SKU', 'INMETRO_CERTIFICATION_REGISTRATION_NUMBER']);

// Atributos que o PRÓPRIO ML preenche e o vendedor não edita — não são ficha técnica.
// O caso que trouxe isso à tona: GIFTABLE aparece como "Regalavel: vppfull" (nome em
// espanhol, valor em código interno) em anúncios sem que ninguém saiba o que é, e ainda
// levava penalidade de "atributo muito curto" no score.
// A régua é `read_only` na definição da categoria, NUNCA `hidden`: campo hidden sem
// read_only é preenchível — o ML só não mostra no formulário — e vale ouro justamente
// por quase ninguém preencher (PRODUCT_DATA_SOURCE "Fonte do produto", IS_KIT, medidas
// de roupa). Esses continuam aparecendo normalmente.
// A lista fixa cobre os que vêm no item mas nem constam na lista da categoria (é o caso
// do GIFTABLE), onde não há tags pra consultar.
const ATRIBUTOS_SISTEMA_ML = new Set([
    'GIFTABLE', 'VERTICAL_TAGS', 'DESCRIPTIVE_TAGS', 'PACKAGE_DATA_SOURCE',
    'SELLER_PACKAGE_DATA_SOURCE', 'SHIPMENT_PACKING', 'HAZMAT_TRANSPORTABILITY',
    'WITH_POSITIVE_IMPACT', 'PRODUCT_CHEMICAL_FEATURES', 'BATTERIES_FEATURES'
]);
function ehAtributoDeSistema(attrId) {
    if (ATRIBUTOS_SISTEMA_ML.has(attrId)) return true;
    const cats = window.currentAnalysisState && window.currentAnalysisState.categoryAttributes;
    if (!Array.isArray(cats) || !cats.length) return false;   // sem a lista da categoria, não esconde nada
    const def = cats.find(c => c && c.id === attrId);
    return !!(def && def.tags && def.tags.read_only);
}

// Tipos que o vendedor consegue preencher (o resto nem tem campo de edição)
const MF_TIPOS_EDITAVEIS = new Set(['string', 'list', 'boolean', 'number', 'number_unit']);

// Hierarquias EDITÁVEIS por variação (per-UP). Só PARENT_PK fica fora — é ele que agrupa.
// CHILD_PK saiu em 09/08 e VOLTOU em 10/08: renomear a variação muda o título, o permalink
// e o anúncio perde a exposição — mas travar não protegia ninguém, porque o vendedor faz o
// mesmo pelo Mercado Livre e aí nem lê o aviso. Agora edita com double check
// (mfRenomeiaVariacao + alerta vermelho + confirm_rename_variation no proxy).
// as variações. `FAMILY` entrou em 05/08/2026: o PUT no item grava e o family_id não muda
// (medido em conta real), e o valor vale para a variação editada.
const MF_VARIATION_EDITABLE_HIERARCHIES = new Set(['CHILD_PK', 'CHILD_DEPENDENT', 'ITEM', 'PRODUCT_IDENTIFIER', 'FAMILY']);

// Atributos que entram no cálculo do family_id sem que a `hierarchy` denuncie.
// `ITEM_CONDITION` vem da ML como `hierarchy: ITEM` — cara de campo comum —, mas a doc
// lista ele junto de family_name, domain_id, PARENT_PK e CHILD_PK entre as coisas que
// DEFINEM a família. Trocar Novo↔Usado num anúncio de família muda a assinatura e o
// anúncio sai do grupo. Fora de família não há grupo pra quebrar, então segue editável.
const MF_ATTRS_DA_ASSINATURA = new Set(['ITEM_CONDITION']);

/**
 * O vendedor consegue mexer NESTE campo, NESTE anúncio?
 * Régua única usada pela lista de campos E pela pontuação — se o campo não tem
 * caminho de edição, não pode pesar na nota nem virar tarefa de "o que melhorar".
 * Três motivos tiram o campo da conta:
 *   - `read_only` / lista de sistema: quem preenche é o ML (GIFTABLE e cia);
 *   - atributo de variação num anúncio com variações: edita-se na tela de variações;
 *   - PARENT_PK em anúncio de família (user_product_id): os atributos PARENT_PK são o
 *     que agrupa as variações. A doc do ML (User Products) diz, com todas as letras, que
 *     "modificar os atributos dos itens pode fazer com que saiam da família atual, por
 *     exemplo, ao alterar a marca, modelo". Pedir "preencha a Marca" num item de família
 *     é pedir pro vendedor quebrar o agrupamento do produto;
 *   - CHILD_PK VAZIO em anúncio de família: a assinatura da família usa o *id* do
 *     CHILD_PK, não o valor. Trocar o valor de um que já existe é inofensivo, mas fazer o
 *     item GANHAR um CHILD_PK que ele não tinha muda a assinatura e o UP migra sozinho pra
 *     outra família (medido em conta real com FABRIC_DESIGN). E depois nem dá pra corrigir
 *     pelo editor: a família paralela já existe e a task morre em `family_id.collision`.
 *
 * `hierarchy: FAMILY` (Voltagem da bateria, Tipo de pilha, Forma de caimento…) FICA de
 * fora dessa lista desde 05/08/2026: medido em conta real, o valor grava pelo PUT no item
 * e o family_id dos 8 UPs da família não muda — FAMILY não está na lista fechada que a doc
 * dá para o cálculo do family_id (family_name, domain_id, user_id, PARENT_PK, CHILD_PK,
 * custom, ITEM_CONDITION). O proxy roteia esse tipo pelo PUT /items justamente porque o
 * editor de família o descarta em silêncio. Só vale para o anúncio editado, não para as
 * outras variações.
 */
function mfMotivoNaoEditavel(catAttr, detail) {
    if (!catAttr) return 'inexistente';
    if (!MF_TIPOS_EDITAVEIS.has(catAttr.value_type)) return 'tipo';
    if (catAttr.tags?.read_only || ATRIBUTOS_SISTEMA_ML.has(catAttr.id)) return 'sistema';
    const temVariacoes = Array.isArray(detail?.variations) && detail.variations.length > 0;
    // Anúncio do modelo antigo (variations[]): atributo de variação editado no campo geral
    // faz a ML devolver "Same attributes are used in more than one of item.attributes".
    // A lista fixa cobria só 5 ids conhecidos; a hierarquia da categoria cobre o resto.
    if (temVariacoes && (catAttr.hierarchy === 'CHILD_PK' || catAttr.hierarchy === 'CHILD_DEPENDENT')) return 'variacao';
    if (temVariacoes && (typeof MF_VARIATION_ATTR_IDS !== 'undefined') && MF_VARIATION_ATTR_IDS.has(String(catAttr.id).toUpperCase())) return 'variacao';
    if (detail?.user_product_id && MF_ATTRS_DA_ASSINATURA.has(catAttr.id)) return 'familia';
    if (detail?.user_product_id && catAttr.hierarchy === 'PARENT_PK') return 'familia';
    // CHILD_PK VAZIO em família continua bloqueado: ganhar o atributo muda a assinatura, o
    // UP migra de família sozinho e nem o editor conserta (family_id.collision). Não tem
    // volta, então confirmação não resolve.
    // CHILD_PK PREENCHIDO é editável com double check — ver mfRenomeiaVariacao. O dano lá
    // (perder exposição) é grave mas conhecido, e o vendedor faria no ML de qualquer jeito.
    if (detail?.user_product_id && catAttr.hierarchy === 'CHILD_PK' && !mfAtributoPreenchido(detail, catAttr.id)) return 'familia';
    return null;
}
/**
 * Mexer NESTE campo renomeia a variação — e renomear muda o título, muda o permalink e o
 * anúncio perde a exposição que tinha. Não é bloqueio: é o que exige o alerta vermelho e a
 * confirmação explícita antes de salvar (decisão do Lucas, 10/08/2026).
 *
 * O mesmo acontece se o vendedor renomear pelo Mercado Livre — por isso avisar vale mais
 * que travar: travar só empurra a mesma perda para fora do app, sem ele ler o aviso.
 */
function mfRenomeiaVariacao(catAttr, detail) {
    if (!catAttr || catAttr.hierarchy !== 'CHILD_PK') return false;
    const temVariacoes = Array.isArray(detail?.variations) && detail.variations.length > 0;
    if (!detail?.user_product_id && !temVariacoes) return false;   // item solto: título é do vendedor
    return mfAtributoPreenchido(detail, catAttr.id);
}
// Comparação de texto tolerante: sem acento, sem caixa e sem separador. A ML escreve
// "180ml" no título para um valor gravado como "180 mL" — comparando cru, o campo passaria
// batido justamente onde ele MUDA o link.
function MF_chaveTexto(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
}
/**
 * Mexer neste campo muda o LINK do anúncio?
 *
 * Todo CHILD_PK dá nome à variação, mas nem todo nome de variação entra no título — e é o
 * título que gera o permalink. Medido em conta real (10/08/2026, com reversão):
 *   - MLB6695198754, COLOR "Rosa"→"Coral": o valor aparece no título e o permalink mudou
 *     NO MESMO INSTANTE (…-rosa-rosa-36-_JM → …-rosa-coral-36-_JM), e seguiu mudado por 30 min.
 *   - MLB2177029901, UNITS_PER_PACKAGE "1"→"2": fora do título, permalink intacto o tempo todo.
 * Na mesma conta, 137 CHILD_PK têm o valor no título e 467 não têm. Alertar nos 604 treinava
 * o vendedor a ignorar aviso vermelho — que é o mesmo que não ter aviso.
 *
 * ⚠️ Isto governa só o ALERTA. A flag `confirm_rename_variation` continua saindo em todo
 * CHILD_PK (mfRenomeiaVariacao): o proxy recusa sem ela, e front mais estreito que servidor
 * é recusa permanente na mão do vendedor — foi o erro de 10/08.
 *
 * Na dúvida, avisa: sem título, sem valor, ou com valor curto demais pra casar com segurança,
 * volta ao comportamento conservador.
 */
function mfMudaOLink(catAttr, detail) {
    if (!mfRenomeiaVariacao(catAttr, detail)) return false;
    const titulo = detail?.title;
    const attr = (detail?.attributes || []).find((x) => x && x.id === catAttr.id);
    const valor = (attr?.value_name && String(attr.value_name).trim())
        || (Array.isArray(attr?.values) ? (attr.values.find((v) => v && v.name) || {}).name : null);
    if (!titulo || !valor) return true;
    const chave = MF_chaveTexto(valor);
    if (!chave) return true;
    // Valor de 1 caractere ("P" de tamanho, "1" de unidades) casaria como substring com
    // quase qualquer título — inclusive o "1" que eu MEDI não mudar o link. Aí a régua é
    // palavra inteira: "Camiseta P" casa, "Camiseta Preta" não.
    if (chave.length < 2) {
        return String(titulo).split(/\s+/).some((palavra) => MF_chaveTexto(palavra) === chave);
    }
    // 2+ caracteres: substring sem separadores, porque a ML reescreve o valor no título
    // ("180 mL" vira "180ml") e a comparação por palavra perderia justo esses.
    return MF_chaveTexto(titulo).includes(chave);
}
// O item já tem valor gravado nesse atributo?
function mfAtributoPreenchido(detail, attrId) {
    const a = (detail?.attributes || []).find((x) => x && x.id === attrId);
    if (!a) return false;
    if (a.value_name && String(a.value_name).trim() !== '') return true;
    return Array.isArray(a.values) && a.values.some((v) => v && (v.name || v.id));
}
function mfCampoEditavel(catAttr, detail) { return mfMotivoNaoEditavel(catAttr, detail) === null; }
// Campo que só o Mercado Livre resolve: mexer por aqui quebraria o grupo de variações.
// Esconde o lápis e ganha o selo "só no ML".
function mfSoNoML(catAttr, detail) {
    return mfMotivoNaoEditavel(catAttr, detail) === 'familia';
}
// Explicação curta de por que o campo não pode ser mexido por aqui. Usada só quando algum
// caminho conseguiu chegar no salvar — a tela normal nem oferece esses campos.
function MF_textoCampoBloqueado(catAttr, motivo) {
    const nome = catAttr?.name || 'Este campo';
    if (motivo === 'familia') return `${nome} define o grupo de variações deste produto. Mudar por aqui tiraria o anúncio do grupo — edite no Mercado Livre.`;
    if (motivo === 'variacao') return `${nome} é definido em cada variação — edite pela tela de variações.`;
    if (motivo === 'sistema') return `${nome} é preenchido pelo próprio Mercado Livre.`;
    return `${nome} não pode ser editado por aqui.`;
}
// Obrigatório para o ML (o resto é extra — vale ponto, mas ninguém é reprovado por ele)
function mfCampoObrigatorio(catAttr, obrigatoriosML) {
    // Quando o próprio ML diz quais são os obrigatórios deste anúncio, é ele que manda:
    // `tags.required` é da CATEGORIA e não sabe nada do domínio nem do catálogo do item.
    if (obrigatoriosML instanceof Set && obrigatoriosML.size > 0) {
        return obrigatoriosML.has(catAttr && catAttr.id);
    }
    return !!(catAttr && catAttr.tags && (catAttr.tags.required || catAttr.tags.catalog_required));
}
/**
 * Os obrigatórios segundo a própria ML, de `adoption_status.required` do catalog_quality.
 *
 * Estrutura medida em conta real (10/08/2026): `attributes` são os que o anúncio JÁ tem e
 * `missing_attributes` os que faltam — a lista de obrigatórios é a união dos dois.
 *
 * ⚠️ Nem sempre vem: em 11 anúncios ativos da conta, 9 traziam a lista e 2 vinham com os
 * dois campos `null`. E a API só responde em anúncio ATIVO (400 em pausado e em catálogo).
 * Por isso devolve null quando não sabe, em vez de um Set vazio — Set vazio esvaziaria a
 * etapa "Obrigatórios" e o vendedor perderia a informação que ele já tinha pelas tags.
 */
/**
 * Termos repetidos no título — o caso "Sapatilha … Melissa Rosa **Rosa** 36" (conta real)
 * e "Kit Jogo 3 Panelas … Vaquinha **Vaquinha**".
 *
 * Acontece porque a ML monta o título como `family_name` + valores das variações: se o
 * vendedor já pôs a cor no family_name, ela sai duas vezes. Come caracteres que valiam
 * palavra-chave e fica com cara de erro.
 *
 * ⚠️ DIAGNÓSTICO, SEM BOTÃO. As duas correções possíveis (mexer no family_name ou no nome
 * da variação) resetam o anúncio pelo mecanismo do permalink — medido em 10/08/2026. Este
 * sinal aponta; quem decide corrigir é o vendedor, sabendo o preço.
 */
function MF_termosRepetidosNoTitulo(titulo, termosDaVariacao) {
    if (!titulo || typeof titulo !== 'string') return [];
    const contagem = new Map();
    const original = new Map();
    for (const bruto of titulo.split(/\s+/)) {
        const chave = MF_chaveTexto(bruto);
        // Palavra de 1-2 letras ("e", "de") repete por gramática, não por erro.
        if (chave.length < 3) continue;
        contagem.set(chave, (contagem.get(chave) || 0) + 1);
        if (!original.has(chave)) original.set(chave, bruto);
    }
    let repetidos = [...contagem.entries()].filter(([, n]) => n > 1);

    // Sem o recorte abaixo o sinal acusa repetição legítima: "Kit Máscara Cílios 4d +
    // Máscara Cílios Incolor" é um kit de dois produtos, e o vendedor escreveu assim de
    // propósito (caso real da conta). O que interessa é o family_name já conter a palavra
    // que a ML vai acrescentar de novo como nome da variação — aí sim é desperdício.
    if (Array.isArray(termosDaVariacao) && termosDaVariacao.length) {
        const daVariacao = new Set();
        for (const valor of termosDaVariacao) {
            for (const palavra of String(valor || '').split(/\s+/)) {
                const chave = MF_chaveTexto(palavra);
                if (chave.length >= 3) daVariacao.add(chave);
            }
        }
        repetidos = repetidos.filter(([chave]) => daVariacao.has(chave));
    }

    return repetidos.map(([chave, n]) => ({ termo: original.get(chave), vezes: n }));
}
/** Valores que dão nome à variação deste anúncio (é o que a ML cola no fim do título). */
function MF_valoresDaVariacao(detail, categoryAttributes) {
    const valores = [];
    if (Array.isArray(detail?.attribute_combinations)) {
        for (const a of detail.attribute_combinations) if (a?.value_name) valores.push(a.value_name);
    }
    const hier = {};
    for (const c of (Array.isArray(categoryAttributes) ? categoryAttributes : [])) {
        if (c && c.id) hier[c.id] = c.hierarchy;
    }
    for (const a of (Array.isArray(detail?.attributes) ? detail.attributes : [])) {
        if (a && hier[a.id] === 'CHILD_PK' && a.value_name) valores.push(a.value_name);
    }
    return valores;
}
function mfObrigatoriosDoML(qualidadeFichaData) {
    const req = qualidadeFichaData?.adoption_status?.required;
    if (!req) return null;
    const ids = [
        ...(Array.isArray(req.attributes) ? req.attributes : []),
        ...(Array.isArray(req.missing_attributes) ? req.missing_attributes : [])
    ].filter(Boolean);
    return ids.length ? new Set(ids) : null;
}
const VALORES_IGNORADOS_PENALIDADE = new Set(['isento', 'não aplicável', 'na']);

const tagSignificados = {
    "good_quality_picture": "Anúncio possui fotos de boa qualidade.",
    "good_quality_thumbnail": "A foto principal (miniatura) do anúncio é de boa qualidade.",
    "poor_quality_picture": "Anúncio possui fotos de baixa qualidade.",
    "poor_quality_thumbnail": "A foto principal (miniatura) do anúncio é de baixa qualidade.",
    "brand_verified": "A marca do produto foi verificada pelo Mercado Livre.",
    "extended_warranty_eligible": "O produto é elegível para garantia estendida.",
    "immediate_payment": "Pagamento deve ser feito imediatamente.",
    "cart_eligible": "O produto pode ser adicionado ao carrinho de compras.",
    "incomplete_technical_specs": "A ficha técnica do produto está incompleta (segundo tag do ML).",
    "catalog_product_candidate": "Este anúncio é um candidato a usar o catálogo do Mercado Livre.",
    "moderation_penalty": "Penalidade por moderação. Violação de regra detectada.",
    "free_shipping": "O anúncio oferece frete grátis.",
};
const TAGS_NEGATIVAS = new Set([
    "poor_quality_picture", "poor_quality_thumbnail",
    "incomplete_technical_specs", "moderation_penalty"
]);

const BASE_URL_PROXY = 'https://mlb-proxy-fdb71524fd60.herokuapp.com';
const API_FETCH_ITEM_ENDPOINT = `${BASE_URL_PROXY}/api/fetch-item`; // Rota unificada para item(s) e descrição
const API_USER_PRODUCTS_ENDPOINT = `${BASE_URL_PROXY}/api/user-products`; // ROTA PARA MLBU
const API_ATTRIBUTES_ENDPOINT = `${BASE_URL_PROXY}/api/attributes`;
const API_PERFORMANCE_ENDPOINT = `${BASE_URL_PROXY}/api/performance`;
const API_VISITS_ENDPOINT = `${BASE_URL_PROXY}/api/fetch-visits`; // Rota no backend para visitas
const API_REVIEWS_ENDPOINT = `${BASE_URL_PROXY}/api/fetch-reviews`; // Rota no backend para reviews
const API_ADS_METRICS_ENDPOINT = `${BASE_URL_PROXY}/api/ads-metrics`; // Rota para métricas de Product Ads
// Escrita de descrição e garantia (12/08/2026). O que vale como descrição e o que é uma
// garantia válida é decidido no proxy — daqui só sai o que o vendedor digitou.
const API_DESCRICAO_ENDPOINT = `${BASE_URL_PROXY}/api/description`;
const API_GARANTIA_ENDPOINT = `${BASE_URL_PROXY}/api/warranty`;
const API_GARANTIA_VALORES_ENDPOINT = `${BASE_URL_PROXY}/api/warranty-values`;
const API_GPT_DESCRICAO_ENDPOINT = `${BASE_URL_PROXY}/api/gpt-descricao`;

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function deveIgnorarAtributoPorNome(nome) {
    if (!nome) return false;
    const nomeLower = nome.toLowerCase();
    const FRASES_IGNORADAS_NOME_ATRIBUTO = ['número de', 'número do', 'registro de', 'registro do'];
    return FRASES_IGNORADAS_NOME_ATRIBUTO.some(frase => nomeLower.startsWith(frase));
}

function normalizeMlbId(input) {
    // Aceita qualquer prefixo ML (MLB/MCO/MLA/MLM/MLC/MLU) + variantes de catálogo (MLBU, MCOU, etc.)

    // 1. Link de catálogo: /p/{PREFIX}...
    const catalogMatch = input.match(/\/p\/((?:MLB|MCO|MLA|MLM|MLC|MLU)\w+)/i);
    if (catalogMatch) return { id: catalogMatch[1].toUpperCase(), type: 'catalog' };

    // 2. Link da tela de edição do painel ML: /anuncios/{ID}/modificar/...
    const editMatch = input.match(/\/anuncios\/((?:MLB|MCO|MLA|MLM|MLC|MLU)U?-?\d+)/i);
    if (editMatch) {
        const raw = editMatch[1].toUpperCase().replace('-', '');
        const isUserCat = /^(?:MLB|MCO|MLA|MLM|MLC|MLU)U\d/.test(raw);
        return { id: raw, type: isUserCat ? 'mlbu' : 'mlb' };
    }

    // 3. Catálogo de usuário (MLBU, MCOU, etc)
    const userCatMatch = input.match(/(MLB|MCO|MLA|MLM|MLC|MLU)U-?(\d+)/i);
    if (userCatMatch) {
        return { id: userCatMatch[1].toUpperCase() + 'U' + userCatMatch[2], type: 'mlbu' };
    }

    // 4. Item normal
    const regex = /(MLB|MCO|MLA|MLM|MLC|MLU)-?(\d+)/i;
    const match = input.match(regex);
    if (match) {
        return { id: match[1].toUpperCase() + match[2], type: 'mlb' };
    }
    return null;
}

const API_ANALYZE_IMAGE_ENDPOINT = `${BASE_URL_PROXY}/api/analyze-image`;

window.ignoredAdAttributes = new Set();
window.ignoredCatalogAttributes = new Set();
window.ignoredAttributesGlobally = window.ignoredAdAttributes; // backward compat
window.currentAnalysisState = null;
window.lastCatalogUrl = null;

window.toggleIgnoreAttribute = function (attrId, context) {
    const targetSet = context === 'catalog' ? window.ignoredCatalogAttributes : window.ignoredAdAttributes;
    if (targetSet.has(attrId)) {
        targetSet.delete(attrId);
    } else {
        targetSet.add(attrId);
    }
    // Keep global in sync for backward compat
    window.ignoredAttributesGlobally = window.ignoredAdAttributes;
    if (context !== 'catalog') reRenderAnalysisView();
};

// ============================================================
// Edição inline de atributos de categoria (PUT /items/{id})
// ============================================================
function exampleNumberForUnit(unit) {
    if (!unit) return '30';
    const u = String(unit).toLowerCase().trim();
    // Massa
    if (['g', 'mg'].includes(u)) return '500';
    if (['kg', 'lb', 'lbs', 'oz'].includes(u)) return '1';
    if (['ton', 't'].includes(u)) return '1';
    // Volume
    if (['ml', 'cc'].includes(u)) return '300';
    if (['l', 'gal'].includes(u)) return '1';
    if (['fl oz'].includes(u)) return '16';
    // Comprimento curto
    if (['mm'].includes(u)) return '300';
    if (['cm', '"', 'in', 'pol', 'polegadas'].includes(u)) return '30';
    // Comprimento longo
    if (['m', 'ft', 'yd', 'km', 'mi'].includes(u)) return '1';
    // Tempo
    if (['s', 'seg'].includes(u)) return '60';
    if (['min', 'h', 'hora', 'horas'].includes(u)) return '1';
    if (['dia', 'dias'].includes(u)) return '30';
    if (['mes', 'meses', 'mês', 'meses'].includes(u)) return '12';
    if (['ano', 'anos'].includes(u)) return '1';
    // Potência / Energia
    if (['w', 'mw', 'btu'].includes(u)) return '500';
    if (['kw', 'hp'].includes(u)) return '1';
    // Voltagem
    if (['v'].includes(u)) return '220';
    if (['mv', 'kv'].includes(u)) return '1';
    // Corrente
    if (['a', 'ma'].includes(u)) return '1';
    // Frequência
    if (['hz'].includes(u)) return '60';
    if (['khz', 'mhz', 'ghz'].includes(u)) return '1';
    // Storage
    if (['b', 'bytes'].includes(u)) return '1024';
    if (['kb'].includes(u)) return '256';
    if (['mb'].includes(u)) return '64';
    if (['gb'].includes(u)) return '128';
    if (['tb'].includes(u)) return '1';
    // Resolução / pixels
    if (['px', 'pixels'].includes(u)) return '1080';
    if (['mp', 'megapixels'].includes(u)) return '12';
    if (['ppi', 'dpi'].includes(u)) return '300';
    // Pessoas / unidades
    if (['pessoas', 'lugares', 'assentos', 'cadeiras', 'peças'].includes(u)) return '4';
    // Temperatura
    if (['°c', '°f', 'c', 'f'].includes(u)) return '25';
    // Velocidade
    if (['rpm'].includes(u)) return '1500';
    if (['km/h', 'mph'].includes(u)) return '100';
    // Default
    return '30';
}


// ============================================================
// MF Attribute Validation Helpers
// Pré-valida e traduz erros do ML pra mensagens amigáveis em PT-BR.
// ============================================================
const MF_GTIN_LIKE_IDS = new Set(['GTIN', 'UPC', 'EAN', 'JAN', 'ISBN']);
function MF_isGtinLike(attrId) {
    return MF_GTIN_LIKE_IDS.has(String(attrId || '').toUpperCase());
}

function MF_validateAttrInput(catAttr, rawValue) {
    if (!catAttr) return { ok: true, cleanedValue: rawValue };
    const val = String(rawValue || '').trim();
    if (!val) return { ok: false, error: 'Preencha um valor.' };

    const id = String(catAttr.id || '').toUpperCase();
    const valueType = catAttr.value_type;
    const maxLen = catAttr.value_max_length;
    const name = catAttr.name || 'campo';

    // GTIN/EAN/UPC — limpa não-dígitos e valida tamanho (8, 12, 13 ou 14)
    if (MF_isGtinLike(id)) {
        // Limpa só separadores comuns (espaço, traço, ponto, parêntese), preservando letras pra detectar erro
        const cleaned = val.replace(/[\s\-.()]+/g, '');
        if (/[^\d]/.test(cleaned)) {
            return { ok: false, error: `${name}: digite só números. Use o código de barras do produto (8, 12, 13 ou 14 dígitos).` };
        }
        if (cleaned.length === 0) {
            return { ok: false, error: `${name} precisa ser numérico. Use o código de barras do produto (8, 12, 13 ou 14 dígitos).` };
        }
        const validLengths = [8, 12, 13, 14];
        if (!validLengths.includes(cleaned.length)) {
            return { ok: false, error: `${name} precisa ter 8, 12, 13 ou 14 dígitos. Você digitou ${cleaned.length}.` };
        }
        return { ok: true, cleanedValue: cleaned, autoCleaned: cleaned !== val };
    }

    // SKU — limita pelo max_length da categoria (default 60)
    if (id === 'SELLER_SKU') {
        const limit = maxLen || 60;
        if (val.length > limit) {
            return { ok: false, error: `SKU pode ter no máximo ${limit} caracteres. Você digitou ${val.length}.` };
        }
        return { ok: true, cleanedValue: val };
    }

    // Numéricos / dimensões — precisa começar com dígito; ML exige unidade junto pra number_unit
    if (valueType === 'number' || valueType === 'number_unit') {
        if (!/^[\d.,]/.test(val)) {
            const unit = catAttr.default_unit || (Array.isArray(catAttr.allowed_units) ? (catAttr.allowed_units[0]?.id || catAttr.allowed_units[0]?.name) : '');
            return { ok: false, error: `${name} precisa começar com um número${unit ? ` (ex: 30 ${unit})` : ' (ex: 30)'}.` };
        }
        // number_unit: ML rejeita se não tiver unidade. Se user digitou só dígitos, anexa a unit padrão automaticamente.
        if (valueType === 'number_unit') {
            const unit = catAttr.default_unit || (Array.isArray(catAttr.allowed_units) ? (catAttr.allowed_units[0]?.id || catAttr.allowed_units[0]?.name) : '');
            const hasUnit = /[a-zA-Z]/.test(val);
            if (!hasUnit && unit) {
                return { ok: true, cleanedValue: `${val} ${unit}`, autoCleaned: true };
            }
        }
        return { ok: true, cleanedValue: val };
    }

    // Texto livre com max_length
    if (maxLen && val.length > maxLen) {
        return { ok: false, error: `${name}: máximo de ${maxLen} caracteres. Você digitou ${val.length}.` };
    }

    return { ok: true, cleanedValue: val };
}

function MF_translateMlError(errData, catAttr) {
    const fallbackName = catAttr?.name || 'campo';
    if (!errData) return 'Erro desconhecido.';

    const cause = Array.isArray(errData.cause) ? errData.cause[0] : null;

    // Recusa do NOSSO proxy: vem como { error: "<texto pronto>", code: "<slug>" }. Antes o
    // `code` do proxy era ignorado e `errData.error` entrava no lugar do código — a mensagem
    // saía como "Não foi possível validar Cor. (código: <parágrafo inteiro>)". Valia para
    // TODAS as guardas de família, não só a de renomear.
    const codigoProxy = String(errData.code || '');
    if (/^(child_pk_|attr_|category_unavailable_in_family|item_unavailable|title_not_editable)/.test(codigoProxy)) {
        const pronta = String(errData.error || '').trim();
        if (pronta) return pronta;
    }

    const code = String(cause?.code || errData.ml_error || errData.error || '');
    const rawMsg = String(cause?.message || errData.message || '');

    // Traduz texto ES/EN → PT comum (usado tanto em mensagens mapeadas como no fallback)
    const toPt = (txt) => String(txt || '')
        .replace(/no es valido/gi, 'não é válido')
        .replace(/no es válido/gi, 'não é válido')
        .replace(/debe contener/gi, 'precisa ter')
        .replace(/debe ser/gi, 'precisa ser')
        .replace(/no puede ser/gi, 'não pode ser')
        .replace(/atributo/gi, 'campo')
        .replace(/atributos/gi, 'campos')
        .replace(/El formato/gi, 'O formato')
        .replace(/El valor/gi, 'O valor')
        .replace(/valor del campo/gi, 'valor do campo')
        .replace(/duplicado/gi, 'duplicado (já existe)')
        .replace(/obligatorio/gi, 'obrigatório')
        .replace(/caractere/gi, 'caractere')
        .replace(/Validation error/gi, `Não foi possível validar ${fallbackName}`);

    if (/invalid_format/i.test(code)) {
        return `${fallbackName}: formato inválido. Veja a dica logo abaixo do campo.${rawMsg ? ` (Detalhe: ${toPt(rawMsg)})` : ''}`;
    }
    if (/value_not_in_allowed_values/i.test(code)) {
        return `${fallbackName}: escolha uma opção da lista de sugestões — texto livre não é aceito aqui.`;
    }
    if (/invalid_value/i.test(code)) {
        return `${fallbackName}: valor não aceito pelo Mercado Livre. ${toPt(rawMsg)}`.trim();
    }
    if (/invalid_length|too_long|too_short|max_length|min_length/i.test(code) || /length|too\s+(long|short)|caracteres/i.test(rawMsg)) {
        return `${fallbackName}: tamanho fora do permitido. ${toPt(rawMsg)}`.trim();
    }
    if (/required|missing/i.test(code)) {
        return `${fallbackName} é obrigatório — você precisa preencher esse campo.`;
    }
    if (/duplicated|already_exists/i.test(code)) {
        return `${fallbackName}: esse valor já está em uso em outro anúncio seu.`;
    }
    if (/read[_\s-]?only/i.test(code)) {
        return `${fallbackName} não pode ser editado depois que o anúncio foi publicado.`;
    }
    if (/deprecated/i.test(code)) {
        return `${fallbackName}: esse campo foi descontinuado pelo Mercado Livre.`;
    }
    if (/forbidden|not_allowed|not_authorized/i.test(code) || /forbidden/i.test(rawMsg)) {
        return `${fallbackName}: esse campo não pode ser alterado nessa categoria/anúncio.`;
    }
    if (/conflict/i.test(code)) {
        return `${fallbackName}: conflito com outro campo do anúncio. ${toPt(rawMsg)}`.trim();
    }

    // ML retorna code "item.attributes.invalid" + references com "variation.attribute_combinations"
    // quando o atributo é gerenciado por variação. Detectamos por references (mais robusto que regex em msg).
    const refs = Array.isArray(cause?.references) ? cause.references : [];
    const isVariationConflict = /Same attributes are used in/i.test(rawMsg)
        || refs.some(r => /variation[s]?\.attribute_combinations/i.test(String(r)));
    if (isVariationConflict) {
        return `${fallbackName} é gerenciado por variação nesse anúncio. Não dá pra editar aqui no campo geral — você precisa editar em cada variação separadamente, na página do anúncio no Mercado Livre.`;
    }

    // Fallback: mensagem traduzida + nome do campo + código (se houver)
    const ptMsg = toPt(rawMsg);
    if (ptMsg) {
        return `${fallbackName}: ${ptMsg}`;
    }
    return `Não foi possível validar ${fallbackName}.${code ? ` (código: ${code})` : ''}`;
}

// O proxy mlb-proxy faz roteamento smart para anúncios em família: pode acionar PUT /items + POST family_task em paralelo.
// Quando uma das pernas falha, o proxy ainda devolve 200 com `_family_task_error` ou `_item_put_error` no body.
// Sem esse parser, o front trataria como sucesso e o usuário não veria que o ML rejeitou a alteração.
function MF_translateProxyPartialError(payload, catAttr) {
    if (!payload || typeof payload !== 'object') return null;
    const fieldName = catAttr?.name || 'campo';
    const familyErr = payload._family_task_error;
    const itemErr = payload._item_put_error;

    if (familyErr) {
        const code = String(familyErr.code || familyErr.error || '');
        const cause = Array.isArray(familyErr.cause) ? familyErr.cause[0] : null;
        const rawMsg = String(familyErr.message || cause?.message || '');
        if (/PA_UNAUTHORIZED|policy[_\s-]?agent/i.test(code) || /PolicyAgent/i.test(rawMsg)) {
            return `${fieldName} é controlado pela família deste anúncio e o Mercado Livre não autorizou a edição por aqui. Edite direto na ficha técnica do anúncio no painel do Mercado Livre.`;
        }
        const translated = MF_translateMlError(familyErr, catAttr);
        return translated || `Não foi possível salvar ${fieldName} no Mercado Livre (família de anúncios). Edite direto no painel do ML.`;
    }
    if (itemErr) {
        const translated = MF_translateMlError(itemErr, catAttr);
        return translated || `Não foi possível salvar ${fieldName} no Mercado Livre.`;
    }
    return null;
}

function MF_getAttrPlaceholder(catAttr) {
    if (!catAttr) return '';
    const id = String(catAttr.id || '').toUpperCase();
    if (MF_isGtinLike(id)) return 'ex: 7891234567890 (código de barras, 8/12/13/14 dígitos)';
    if (id === 'SELLER_SKU') return 'ex: SKU-001 (código interno seu)';
    if (id === 'PACKAGE_LENGTH') return 'ex: 30 cm';
    if (id === 'PACKAGE_WIDTH') return 'ex: 20 cm';
    if (id === 'PACKAGE_HEIGHT') return 'ex: 10 cm';
    if (id === 'PACKAGE_WEIGHT') return 'ex: 500 g';
    return '';
}

// Atributos comumente gerenciados por variação no Mercado Livre.
// Se o anúncio tem variations[], editar esses no campo geral resulta em erro
// "Same attributes are used in more than of item.attributes...".
// ============================================================
// MF Snapshot — guarda estado da análise no localStorage para mostrar
// evolução do score e mudanças desde a última visita do vendedor.
// Sem persistir em DB do app — só no browser do user.
// ============================================================
// v2: os snapshots gravados em 11/08/2026 têm 60 dias de visitas dentro de um campo
// chamado `visits30`. Comparar aqueles com os de agora mostraria "📉 Visitas -50%" pra
// todo anúncio já analisado — queda que nunca aconteceu. Trocar a chave descarta a base
// velha: a primeira análise volta a ser "sem comparação", que é a verdade.
const MF_SNAP_KEY = (id) => `mf_analyze_snap_v2_${id}`;

function MF_loadSnap(itemId) {
    if (!itemId) return null;
    try {
        const raw = localStorage.getItem(MF_SNAP_KEY(itemId));
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function MF_saveSnap(itemId, snap) {
    if (!itemId || !snap) return;
    try { localStorage.setItem(MF_SNAP_KEY(itemId), JSON.stringify(snap)); } catch (e) {}
}

/**
 * Recorta a série de visitas nos últimos N dias.
 *
 * A chamada de visitas pede 60 dias porque o card "Desempenho do Anúncio" compara 30 dias
 * com os 30 anteriores. Todo o resto da tela fala em 30 — e somar os 60 num lugar que
 * escreve "em 30d" não é detalhe de rótulo: no card de oportunidades isso dobrava o
 * "+R$ X/mês" e cortava a conversão pela metade (11/08/2026). Quem precisa dos 60 dias
 * pede a série inteira; quem fala em 30 passa por aqui.
 */
function MF_visitasDosUltimos(results, dias = 30) {
    if (!Array.isArray(results)) return [];
    return results.filter((v) => {
        const iso = String(v && v.date || '').slice(0, 10);
        if (!iso) return false;
        const t = new Date(iso + 'T12:00:00').getTime();
        if (isNaN(t)) return false;
        return (Date.now() - t) / 86400000 < dias;
    });
}

function MF_buildSnap(detail, visitsData, adsData, score) {
    const visits30 = MF_visitasDosUltimos(visitsData?.results, 30).reduce((s, v) => s + (v.total || 0), 0);
    let sales30 = 0;
    let adsActive = false;
    let adsLevel = null;
    if (adsData?.has_ads && Array.isArray(adsData.daily)) {
        const ads = adsData.daily.reduce((s, x) => s + (x.units_quantity || 0), 0);
        const org = adsData.daily.reduce((s, x) => s + (x.organic_units_quantity || 0), 0);
        sales30 = ads + org;
        adsActive = !!adsData.has_ads;
        adsLevel = adsData.ad_info?.current_level || null;
    }
    const tags = Array.isArray(detail?.tags) ? detail.tags : [];
    return {
        ts: Date.now(),
        score: typeof score === 'number' ? score : 0,
        visits30,
        sales30,
        soldQuantity: detail?.sold_quantity || 0,
        availableQuantity: detail?.available_quantity || 0,
        price: detail?.price || 0,
        tagsHash: tags.slice().sort().join(','),
        negativeTagsCount: tags.filter(t => TAGS_NEGATIVAS.has(t)).length,
        adsActive,
        adsLevel,
    };
}

function MF_diffSnap(prev, curr) {
    if (!prev) return null;
    const items = [];
    if (prev.score !== curr.score) {
        items.push({ kind: 'score', delta: curr.score - prev.score, prev: prev.score, curr: curr.score });
    }
    const visitsDelta = curr.visits30 - prev.visits30;
    const visitsPct = prev.visits30 > 0 ? Math.round((visitsDelta / prev.visits30) * 100) : 0;
    if (Math.abs(visitsPct) >= 20 && (Math.abs(visitsDelta) >= 5 || prev.visits30 === 0)) {
        items.push({ kind: 'visits', delta: visitsDelta, pct: visitsPct, prev: prev.visits30, curr: curr.visits30 });
    }
    if (prev.sales30 !== curr.sales30) {
        items.push({ kind: 'sales', delta: curr.sales30 - prev.sales30, prev: prev.sales30, curr: curr.sales30 });
    }
    if (prev.tagsHash !== curr.tagsHash) {
        items.push({ kind: 'tags', delta: curr.negativeTagsCount - prev.negativeTagsCount, prev: prev.negativeTagsCount, curr: curr.negativeTagsCount });
    }
    if (prev.adsActive !== curr.adsActive) {
        items.push({ kind: 'adsState', currActive: curr.adsActive });
    }
    // adsLevel (current_level da API de ads) fica fora do diff: jargão interno do ML ("unknown"/"newbie"), sem significado pro usuário.
    return { items, daysSince: Math.floor((curr.ts - prev.ts) / (1000 * 60 * 60 * 24)), prevTs: prev.ts };
}

function MF_renderDiffBanner(diff) {
    if (!diff || !diff.items.length) return '';
    const sinceLabel = diff.daysSince === 0 ? 'hoje' : (diff.daysSince === 1 ? 'ontem' : `${diff.daysSince} dias atrás`);
    const itemsHtml = diff.items.map(i => {
        if (i.kind === 'score') {
            const sign = i.delta > 0 ? '+' : '';
            const color = i.delta > 0 ? '#059669' : '#dc2626';
            const arrow = i.delta > 0 ? '↗' : '↘';
            return `<span style="color:${color}; font-weight:600;">${arrow} Score ${sign}${i.delta}</span> <span style="color:var(--text-muted); font-size:0.7rem;">(${i.prev}→${i.curr})</span>`;
        }
        if (i.kind === 'visits') {
            const sign = i.delta > 0 ? '+' : '';
            const color = i.delta > 0 ? '#059669' : '#dc2626';
            const arrow = i.delta > 0 ? '↗' : '↘';
            return `<span style="color:${color}; font-weight:600;">${arrow} Visitas ${sign}${i.pct}%</span> <span style="color:var(--text-muted); font-size:0.7rem;">(${i.prev}→${i.curr} em 30d)</span>`;
        }
        if (i.kind === 'sales') {
            const sign = i.delta > 0 ? '+' : '';
            const color = i.delta > 0 ? '#059669' : '#dc2626';
            const arrow = i.delta > 0 ? '↗' : '↘';
            return `<span style="color:${color}; font-weight:600;">${arrow} Vendas 30d ${sign}${i.delta}</span>`;
        }
        if (i.kind === 'tags') {
            const color = i.delta > 0 ? '#dc2626' : '#059669';
            const sign = i.delta > 0 ? '+' : '';
            return `<span style="color:${color}; font-weight:600;">Tags negativas ${sign}${i.delta}</span>`;
        }
        if (i.kind === 'adsState') {
            return `<span style="color:${i.currActive ? '#059669' : '#dc2626'}; font-weight:600;">Ads ${i.currActive ? 'ativos' : 'pausados'}</span>`;
        }
        return '';
    }).filter(Boolean).join(' · ');
    return `
        <div style="background:linear-gradient(135deg, var(--blue-light), #f0f8ff); border:1px solid var(--blue); border-left:4px solid var(--blue); padding:10px 14px; border-radius:var(--radius-sm); margin-bottom:12px; display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap;">
            <span style="font-size:1rem; flex-shrink:0;">🔄</span>
            <div style="flex:1; min-width:200px;">
                <div style="font-size:0.78rem; font-weight:600; color:var(--text); margin-bottom:2px;">Mudanças desde sua última análise (${sinceLabel})</div>
                <div style="font-size:0.78rem; color:var(--text-secondary); display:flex; gap:8px; flex-wrap:wrap;">${itemsHtml}</div>
            </div>
        </div>`;
}

function MF_renderScoreDelta(prevSnap, currScore) {
    if (!prevSnap || prevSnap.score === currScore) return '';
    const delta = currScore - prevSnap.score;
    const sign = delta > 0 ? '+' : '';
    const color = delta > 0 ? '#059669' : '#dc2626';
    const arrow = delta > 0 ? '↗' : '↘';
    return `<span style="display:inline-flex; align-items:center; gap:3px; margin-top:4px; padding:2px 8px; background:${delta > 0 ? '#d1fae5' : '#fee2e2'}; border-radius:10px; font-size:0.7rem; color:${color}; font-weight:700;">${arrow} ${sign}${delta} vs última análise</span>`;
}

// ============================================================
// MF Opportunities — calcula oportunidades defensíveis (sem inventar thresholds)
// Cada item tem cálculo simples e auditável.
// ============================================================
// Overrides locais por anúncio (estoque real informado pelo vendedor, oportunidades ocultadas)
const MF_OPP_OVERRIDES_PREFIX = 'mf_opp_overrides_v1_';

function MF_oppLoadOverride(itemId) {
    if (!itemId) return {};
    try {
        const raw = localStorage.getItem(MF_OPP_OVERRIDES_PREFIX + itemId);
        return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) {
        return {};
    }
}

function MF_oppSaveOverride(itemId, kind, patch) {
    if (!itemId || !kind) return;
    try {
        const curr = MF_oppLoadOverride(itemId);
        curr[kind] = Object.assign({}, curr[kind] || {}, patch || {});
        localStorage.setItem(MF_OPP_OVERRIDES_PREFIX + itemId, JSON.stringify(curr));
    } catch (e) { /* localStorage cheio/bloqueado — silencioso */ }
}

const MF_OPP_KIND_ICON = {
    cvr_upside: '📈',
    stuck_stock: '📦',
    ads_off: '🚀',
    tag_specs: '📋',
    tag_pics: '📷',
    ads_hold: '⏸️',
};

function MF_oppPriorityColor(prio) {
    if (prio === 1) return 'var(--red, #dc2626)';
    if (prio === 2) return 'var(--yellow, #f59e0b)';
    return 'var(--blue, #3b82f6)';
}

function _mfSplitByDate(arr) {
    const sorted = [...arr].sort((a, b) => new Date(a.date) - new Date(b.date));
    const mid = Math.floor(sorted.length / 2);
    return { older: sorted.slice(0, mid), recent: sorted.slice(mid) };
}

function _mfTrend(olderSum, recentSum) {
    if (olderSum === 0 && recentSum === 0) return { arrow: '➡️', label: 'estável', dir: 0 };
    if (olderSum === 0) return { arrow: '📈', label: 'em alta', dir: 1 };
    const ratio = recentSum / olderSum;
    if (ratio >= 1.15) return { arrow: '📈', label: 'em alta', dir: 1 };
    if (ratio <= 0.85) return { arrow: '📉', label: 'em queda', dir: -1 };
    return { arrow: '➡️', label: 'estável', dir: 0 };
}

function MF_buildOpportunities(detail, visitsData, adsData, opts) {
    const opps = [];
    const _site = (typeof window !== 'undefined' && window.MF_currentSiteId) ? window.MF_currentSiteId() : 'MLB';
    const _cfg = (typeof window !== 'undefined' && window.MF_getSiteConfig) ? window.MF_getSiteConfig(_site) : { locale: 'pt-BR', currency: 'BRL' };
    const fmtMoney = (n) => new Intl.NumberFormat(_cfg.locale, { style: 'currency', currency: _cfg.currency }).format(n || 0);
    const price = detail?.price || 0;
    // 30 dias de verdade: a série chega com 60 (ver MF_visitasDosUltimos) e os textos
    // daqui prometem "em 30d" — e viram reais no bolso do vendedor.
    const visitas30d = MF_visitasDosUltimos(visitsData?.results, 30);
    const visits30 = visitas30d.reduce((s, v) => s + (v.total || 0), 0);
    const soldQuantityLifetime = detail?.sold_quantity || 0;
    const availableQty = detail?.available_quantity || 0;
    const itemId = detail?.id || '';
    const editUrl = itemId ? `https://www.mercadolivre.com.br/anuncios/${itemId}/modificar` : '';
    const tags = Array.isArray(detail?.tags) ? detail.tags : [];
    const suffix = (opts && typeof opts.suffix === 'string') ? opts.suffix : '';
    const overrides = MF_oppLoadOverride(itemId);

    let sales30 = null;
    if (adsData?.has_ads && Array.isArray(adsData.daily)) {
        const ads = adsData.daily.reduce((s, x) => s + (x.units_quantity || 0), 0);
        const org = adsData.daily.reduce((s, x) => s + (x.organic_units_quantity || 0), 0);
        sales30 = ads + org;
    }

    const push = (opp) => {
        if (overrides[opp.kind] && overrides[opp.kind].hidden) return;
        opps.push(opp);
    };

    // (1) Upside de conversão — só quando temos visits e sales 30d defensíveis
    if (price > 0 && visits30 >= 50 && sales30 !== null) {
        const cvr = visits30 > 0 ? (sales30 / visits30) : 0;
        const cvrPct = cvr * 100;
        const monthlyUpside = visits30 * 0.001 * price;
        if (monthlyUpside >= 1) {
            push({
                kind: 'cvr_upside',
                priority: cvrPct < 2 ? 1 : 3,
                icon: MF_OPP_KIND_ICON.cvr_upside,
                title: `Cada 0,1% a mais em conversão = +${fmtMoney(monthlyUpside)}/mês`,
                detail: `Hoje: ${visits30} visitas em 30d × conversão de ${cvrPct.toFixed(2)}% × ${fmtMoney(price)}.`,
                value: monthlyUpside,
                actions: [],
            });
        }
    }

    // (2) Estoque parado — usa o available_quantity do ML como verdade. Sem override.
    const _stuckCondition = (sales30 === 0) || (!adsData?.has_ads && visits30 === 0);
    if (price > 0 && availableQty > 0 && _stuckCondition && soldQuantityLifetime > 0) {
        const stockValue = availableQty * price;
        const _reason = sales30 === 0 ? 'sem vendas em 30 dias' : 'sem visitas em 30 dias';
        push({
            kind: 'stuck_stock',
            priority: 1,
            icon: MF_OPP_KIND_ICON.stuck_stock,
            title: `${fmtMoney(stockValue)} parados em estoque`,
            detail: `${availableQty.toLocaleString(_cfg.locale)} ${availableQty === 1 ? 'unidade' : 'unidades'} × ${fmtMoney(price)} — ${_reason}. Considere revisar preço, criar um anúncio novo, revisar fotos ou entrar em catálogos.`,
            value: stockValue,
            actions: [
                { type: 'hide', label: 'Ocultar' },
            ],
        });
    }

    // (2.5) Runway de estoque — projeção ajustada por ritmo recente de vendas + tendência de visitas
    if (price > 0 && availableQty > 0 && sales30 !== null && sales30 > 0 && Array.isArray(adsData?.daily) && adsData.daily.length > 0) {
        const dailySplit = _mfSplitByDate(adsData.daily);
        const salesOlder = dailySplit.older.reduce((s, x) => s + (x.units_quantity || 0) + (x.organic_units_quantity || 0), 0);
        const salesRecent = dailySplit.recent.reduce((s, x) => s + (x.units_quantity || 0) + (x.organic_units_quantity || 0), 0);
        const salesTrend = _mfTrend(salesOlder, salesRecent);

        let visitsTrend = null;
        let visitsRatio = 1;
        // Metade de 30 dias é 15 — que é o que a frase abaixo promete. Com a série de 60
        // o "recente vs anterior" virava 30 × 30 enquanto as vendas seguiam 15 × 15, e a
        // projeção de quando o estoque acaba misturava duas escalas.
        if (visitas30d.length >= 4) {
            const visitsSplit = _mfSplitByDate(visitas30d);
            const visitsOlder = visitsSplit.older.reduce((s, v) => s + (v.total || 0), 0);
            const visitsRecent = visitsSplit.recent.reduce((s, v) => s + (v.total || 0), 0);
            visitsTrend = _mfTrend(visitsOlder, visitsRecent);
            if (visitsOlder > 0) visitsRatio = visitsRecent / visitsOlder;
            else if (visitsRecent > 0) visitsRatio = 1.5; // sem dado anterior mas tem visitas atuais → assume crescimento moderado
        }

        // Ritmo: usa últimos 15d (mais responsivo). Aplica boost suave (metade) baseado em visitas, clamp [0.5, 2.5].
        const recentDays = Math.max(1, dailySplit.recent.length);
        const salesRate15 = salesRecent / recentDays;
        const salesRate30 = sales30 / 30;
        const baseRate = salesRate15 > 0 ? salesRate15 : salesRate30;
        const visitsBoost = Math.max(0.5, Math.min(2.5, 1 + (visitsRatio - 1) * 0.5));
        const projectedRate = Math.max(0.01, baseRate * visitsBoost);
        const daysToEmpty = Math.max(1, Math.floor(availableQty / projectedRate));

        let prio = 3;
        if (daysToEmpty <= 7) prio = 1;
        else if (daysToEmpty <= 30) prio = 2;
        if (salesTrend.dir > 0 && prio > 1) prio--;

        const trendLine = `Vendas ${salesTrend.arrow} ${salesTrend.label}`
            + (visitsTrend ? `, visitas ${visitsTrend.arrow} ${visitsTrend.label}` : '')
            + ' (últimos 15d vs 15 anteriores)';
        const boostNote = visitsBoost > 1.05 ? ` Projeção acelerada por +${Math.round((visitsBoost - 1) * 100)}% (visitas em alta).`
                       : visitsBoost < 0.95 ? ` Projeção desacelerada em ${Math.round((1 - visitsBoost) * 100)}% (visitas em queda).`
                       : '';

        // Chart: histórico reconstruído (30d) + projeção ajustada
        const dailyMap = {};
        adsData.daily.forEach(d => {
            if (!d.date) return;
            const key = String(d.date).substring(0, 10);
            dailyMap[key] = (dailyMap[key] || 0) + (d.units_quantity || 0) + (d.organic_units_quantity || 0);
        });
        const _todayDt = new Date();
        _todayDt.setHours(0, 0, 0, 0);
        const _histDays = 30;
        const histPoints = [];
        let _stockBack = availableQty;
        for (let i = 0; i <= _histDays; i++) {
            const _d = new Date(_todayDt);
            _d.setDate(_todayDt.getDate() - i);
            const _key = _d.toISOString().substring(0, 10);
            histPoints.push({ day: -i, stock: _stockBack });
            _stockBack += (dailyMap[_key] || 0);
        }
        histPoints.reverse();
        const _projDays = Math.min(60, daysToEmpty + 3);
        const projPoints = [];
        for (let i = 1; i <= _projDays; i++) {
            projPoints.push({ day: i, stock: Math.max(0, availableQty - projectedRate * i) });
        }

        push({
            kind: 'stock_runway',
            priority: prio,
            icon: '⏳',
            title: `Estoque acaba em ~${daysToEmpty} ${daysToEmpty === 1 ? 'dia' : 'dias'}`,
            detail: `${sales30} ${sales30 === 1 ? 'unidade vendida' : 'unidades vendidas'} em 30d, ${salesRecent} nos últimos 15d (~${salesRate15.toFixed(1)}/dia). Com ${availableQty.toLocaleString(_cfg.locale)} em estoque no ML. ${trendLine}.${boostNote}`,
            value: 0,
            actions: [],
            chart: { history: histPoints, projection: projPoints, currentStock: availableQty, daysToEmpty },
        });
    }

    // (3) Ads pausado em anúncio que já vende organicamente — oportunidade de amplificar
    if (!adsData?.has_ads && soldQuantityLifetime >= 5) {
        push({
            kind: 'ads_off',
            priority: 2,
            icon: MF_OPP_KIND_ICON.ads_off,
            title: `Anúncio vendendo sem Ads`,
            detail: `${soldQuantityLifetime.toLocaleString(_cfg.locale)} ${soldQuantityLifetime === 1 ? 'venda' : 'vendas'} no histórico, sem campanha ativa. Ads pode amplificar a exposição.`,
            value: 0,
            actions: [
                { type: 'external', label: 'Ir pro Planejador de Ads', href: '/planejador-ads' },
            ],
        });
    }

    // (4) Tag `incomplete_technical_specs` — afeta ranking
    if (tags.includes('incomplete_technical_specs')) {
        push({
            kind: 'tag_specs',
            priority: 1,
            icon: MF_OPP_KIND_ICON.tag_specs,
            title: `Ficha técnica incompleta`,
            detail: `O ML marcou esse anúncio com a tag "incomplete_technical_specs" — afeta posicionamento. Preencha os campos da categoria abaixo.`,
            value: 0,
            actions: [
                { type: 'internal', label: 'Ir pra Campos da Categoria', target: 'categoryAttributes' + suffix },
            ],
        });
    }

    // (5) Tag de fotos ruins — trocar foto é ação no ML mesmo
    if (tags.includes('poor_quality_picture') || tags.includes('poor_quality_thumbnail')) {
        push({
            kind: 'tag_pics',
            priority: 2,
            icon: MF_OPP_KIND_ICON.tag_pics,
            title: `Fotos com qualidade baixa`,
            detail: `O ML detectou imagens de baixa qualidade — afeta conversão e ranking. Suba fotos com 1200×1200 ou 1200×1540 (depende da categoria), boa iluminação e produto centralizado, sem texto ou marca d'água sobreposta.`,
            value: 0,
            actions: [
                ...(itemId ? [{ type: 'external', label: '🪄 Melhorar no Redimensionador', href: `/redimensionar-imagem?item=${itemId}` }] : []),
                ...(editUrl ? [{ type: 'external', label: 'Trocar fotos no ML', href: editUrl }] : []),
            ],
        });
    }

    // (7) Publicidade parada — o anúncio está na campanha mas o ML não exibe.
    // Dois erros aqui: lia `current_level`, que é a REPUTAÇÃO do anúncio, então
    // a condição nunca era verdadeira (o "hold" vive em `status`); e o texto
    // mandava mexer no lance, quando a doc da ML diz que a causa é o anúncio
    // estar pausado ou sem estoque no marketplace.
    const _adStatus = adsData?.ad_info?.status;
    if (adsData?.has_ads && _adStatus === 'hold') {
        push({
            kind: 'ads_hold',
            priority: 1,
            icon: MF_OPP_KIND_ICON.ads_hold,
            title: `Publicidade parada neste anúncio`,
            detail: `O anúncio está na campanha, mas o Mercado Livre não o exibe enquanto ele estiver pausado ou sem estoque. Reative o anúncio ou reponha o estoque e a publicidade volta sozinha.`,
            value: 0,
            actions: [
                ...(editUrl ? [{ type: 'external', label: 'Abrir no Mercado Livre', href: editUrl }] : []),
            ],
        });
    }

    opps.sort((a, b) => (a.priority - b.priority) || (b.value - a.value));
    return opps.slice(0, 3);
}

function MF_renderOpportunityCard(opps, opts) {
    if (!opps || opps.length === 0) return '';
    const itemId = opts && opts.itemId ? opts.itemId : '';
    const itemIdJs = String(itemId).replace(/'/g, "\\'");

    const renderActions = (o) => {
        if (!Array.isArray(o.actions) || o.actions.length === 0) return '';
        const btns = o.actions.map(a => {
            const safeLabel = escapeHtml(a.label || 'Ação');
            if (a.type === 'external' && a.href) {
                return `<a href="${escapeHtml(a.href)}" target="_blank" rel="noopener" style="font-size:0.72rem; color:var(--blue, #3b82f6); text-decoration:none; padding:4px 8px; border:1px solid var(--blue, #3b82f6); border-radius:4px;">${safeLabel} →</a>`;
            }
            if (a.type === 'internal' && a.target) {
                const targetJs = String(a.target).replace(/'/g, "\\'");
                return `<button type="button" onclick="window.MF_oppScrollTo('${targetJs}')" style="font-size:0.72rem; color:var(--blue, #3b82f6); background:transparent; border:1px solid var(--blue, #3b82f6); border-radius:4px; padding:4px 8px; cursor:pointer;">${safeLabel} ↓</button>`;
            }
            if (a.type === 'hide') {
                return `<button type="button" onclick="window.MF_oppHide('${itemIdJs}', '${o.kind}')" style="font-size:0.72rem; color:var(--text-muted); background:transparent; border:1px solid var(--border, #d1d5db); border-radius:4px; padding:4px 8px; cursor:pointer;">${safeLabel}</button>`;
            }
            return '';
        }).filter(Boolean).join(' ');
        return btns ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">${btns}</div>` : '';
    };

    if (typeof window !== 'undefined' && !window.MF_runwayChartData) window.MF_runwayChartData = {};

    const itemsHtml = opps.map(o => {
        const color = MF_oppPriorityColor(o.priority);
        const icon = o.icon || '•';
        let chartHtml = '';
        if (o.chart && o.chart.history && o.chart.projection) {
            const chartId = `mf-runway-${escapeHtml(itemId)}-${escapeHtml(o.kind)}`;
            if (typeof window !== 'undefined') window.MF_runwayChartData[chartId] = o.chart;
            chartHtml = `<div style="margin-top:10px; height:90px; position:relative;"><canvas data-mf-runway-chart="${chartId}"></canvas></div>`;
        }
        return `
            <div data-mf-opp-kind="${escapeHtml(o.kind)}" style="border:1px solid var(--border, #e5e7eb); border-radius:var(--radius, 8px); border-left:4px solid ${color}; background:var(--bg-card, #fff); padding:12px 14px; margin-top:10px;">
                <div style="display:flex; gap:10px; align-items:flex-start;">
                    <span style="font-size:1.1rem; line-height:1.2;">${icon}</span>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:0.85rem; font-weight:700; color:var(--text);">${o.title}</div>
                        <div style="font-size:0.75rem; color:var(--text-secondary); line-height:1.45; margin-top:3px;">${o.detail}</div>
                        ${chartHtml}
                        ${renderActions(o)}
                    </div>
                </div>
            </div>`;
    }).join('');

    return `
        <div data-mf-opps-container data-item-id="${escapeHtml(itemId)}" style="background:linear-gradient(135deg, #fef9c3, #fef3c7); border:1px solid #facc15; border-left:4px solid #ca8a04; padding:12px 14px; border-radius:var(--radius-sm, 6px); margin-bottom:12px;">
            <div style="display:flex; gap:10px; align-items:center;">
                <span style="font-size:1.1rem;">💰</span>
                <div style="font-size:0.85rem; font-weight:700; color:var(--text);">Oportunidades</div>
                <span style="font-size:0.7rem; color:var(--text-muted); margin-left:auto;">${opps.length} ${opps.length === 1 ? 'item' : 'itens'}</span>
            </div>
            ${itemsHtml}
        </div>`;
}

function MF_buildPenalties(detail, opts) {
    const penalties = [];
    const tags = Array.isArray(detail?.tags) ? detail.tags : [];
    const suffix = (opts && typeof opts.suffix === 'string') ? opts.suffix : '';

    if (tags.includes('moderation_penalty')) {
        penalties.push({
            kind: 'moderation_penalty',
            icon: '⚠️',
            title: 'Penalidade de moderação',
            detail: 'O anúncio recebeu uma penalidade do ML — exposição reduzida até regularizar. Confira nas seções abaixo o motivo provável.',
            actions: [
                { type: 'internal', label: 'Ver Tags', target: 'tagsTexto' + suffix },
                { type: 'internal', label: 'Ver Qualidade ML', target: 'performanceTexto' + suffix },
            ],
        });
    }

    return penalties;
}

function MF_renderPenaltyCard(penalties) {
    if (!penalties || penalties.length === 0) return '';

    const renderActions = (p) => {
        if (!Array.isArray(p.actions) || p.actions.length === 0) return '';
        const btns = p.actions.map(a => {
            const safeLabel = escapeHtml(a.label || 'Ação');
            if (a.type === 'internal' && a.target) {
                const targetJs = String(a.target).replace(/'/g, "\\'");
                return `<button type="button" onclick="window.MF_oppScrollTo('${targetJs}')" style="font-size:0.72rem; color:#b91c1c; background:transparent; border:1px solid #fca5a5; border-radius:4px; padding:4px 8px; cursor:pointer;">${safeLabel} ↓</button>`;
            }
            if (a.type === 'external' && a.href) {
                return `<a href="${escapeHtml(a.href)}" target="_blank" rel="noopener" style="font-size:0.72rem; color:#b91c1c; text-decoration:none; padding:4px 8px; border:1px solid #fca5a5; border-radius:4px;">${safeLabel} →</a>`;
            }
            return '';
        }).filter(Boolean).join(' ');
        return btns ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">${btns}</div>` : '';
    };

    const itemsHtml = penalties.map(p => `
        <div data-mf-penalty-kind="${escapeHtml(p.kind)}" style="border:1px solid #fca5a5; border-radius:var(--radius, 8px); border-left:4px solid #dc2626; background:var(--bg-card, #fff); padding:12px 14px; margin-top:10px;">
            <div style="display:flex; gap:10px; align-items:flex-start;">
                <span style="font-size:1.1rem; line-height:1.2;">${p.icon || '⚠️'}</span>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:0.85rem; font-weight:700; color:var(--text);">${p.title}</div>
                    <div style="font-size:0.75rem; color:var(--text-secondary); line-height:1.45; margin-top:3px;">${p.detail}</div>
                    ${renderActions(p)}
                </div>
            </div>
        </div>`).join('');

    return `
        <div data-mf-penalties-container style="background:linear-gradient(135deg, #fee2e2, #fecaca); border:1px solid #f87171; border-left:4px solid #dc2626; padding:12px 14px; border-radius:var(--radius-sm, 6px); margin-bottom:12px;">
            <div style="display:flex; gap:10px; align-items:center;">
                <span style="font-size:1.1rem;">⚠️</span>
                <div style="font-size:0.85rem; font-weight:700; color:#991b1b;">${penalties.length === 1 ? 'Penalidade detectada' : 'Penalidades detectadas'}</div>
                <span style="font-size:0.7rem; color:#b91c1c; margin-left:auto;">${penalties.length} ${penalties.length === 1 ? 'item' : 'itens'}</span>
            </div>
            ${itemsHtml}
        </div>`;
}

window.MF_oppScrollTo = function (elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    const prevTransition = el.style.transition;
    el.style.transition = 'outline-color 0.6s ease';
    el.style.outline = '2px solid var(--blue, #3b82f6)';
    el.style.outlineOffset = '4px';
    setTimeout(() => {
        el.style.outline = prevOutline || '';
        el.style.outlineOffset = prevOffset || '';
        el.style.transition = prevTransition || '';
    }, 1500);
};

window.MF_oppHide = function (itemId, kind) {
    if (!itemId || !kind) return;
    MF_oppSaveOverride(itemId, kind, { hidden: true });
    window.MF_oppRefresh();
};

window.MF_oppRefresh = function () {
    const s = window.currentAnalysisState;
    if (!s || !s.detail) return;
    const suffix = s.containerIdSuffix || '';
    const opps = MF_buildOpportunities(s.detail, s.visitsData, s.adsData, { suffix });
    const newHtml = MF_renderOpportunityCard(opps, { suffix, itemId: s.detail.id || '' });
    const containers = document.querySelectorAll('[data-mf-opps-container]');
    containers.forEach(c => {
        const wrapper = c.parentNode;
        if (!wrapper) return;
        if (newHtml) {
            const tmp = document.createElement('div');
            tmp.innerHTML = newHtml;
            const fresh = tmp.firstElementChild;
            if (fresh) {
                wrapper.replaceChild(fresh, c);
                window.MF_oppHydrateRunwayCharts(fresh);
            }
        } else {
            c.remove();
        }
    });
};

window.MF_runwayCharts = window.MF_runwayCharts || {};
window.MF_oppHydrateRunwayCharts = function (rootEl) {
    if (typeof window.Chart === 'undefined') return;
    const root = rootEl || document;
    const canvases = root.querySelectorAll('canvas[data-mf-runway-chart]');
    canvases.forEach(canvas => {
        const id = canvas.getAttribute('data-mf-runway-chart');
        const data = window.MF_runwayChartData && window.MF_runwayChartData[id];
        if (!data) return;
        const existing = window.MF_runwayCharts[id];
        if (existing) { try { existing.destroy(); } catch (e) {} }
        const all = [...data.history, ...data.projection];
        const labels = all.map(p => p.day === 0 ? 'Hoje' : (p.day > 0 ? `+${p.day}d` : `${p.day}d`));
        const histLen = data.history.length;
        const histSeries = all.map((p, i) => i < histLen ? p.stock : null);
        const projSeries = all.map((p, i) => i >= histLen - 1 ? p.stock : null);
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 90);
        grad.addColorStop(0, 'rgba(220, 38, 38, 0.28)');
        grad.addColorStop(1, 'rgba(220, 38, 38, 0)');
        const chart = new window.Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Histórico', data: histSeries, borderColor: '#dc2626', backgroundColor: grad, borderWidth: 1.5, fill: 'origin', tension: 0.25, pointRadius: 0, pointHoverRadius: 3, spanGaps: false },
                    { label: 'Projeção', data: projSeries, borderColor: '#dc2626', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 4], fill: false, tension: 0, pointRadius: 0, pointHoverRadius: 3, spanGaps: false },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => items[0] ? labels[items[0].dataIndex] : '',
                            label: (item) => `${Math.round(item.parsed.y)} unid.`,
                        },
                    },
                },
                scales: {
                    x: { ticks: { font: { size: 9 }, color: '#6b7280', maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { font: { size: 9 }, color: '#6b7280', maxTicksLimit: 4 }, grid: { color: 'rgba(0,0,0,0.05)' } },
                },
            },
        });
        window.MF_runwayCharts[id] = chart;
    });
};

const MF_VARIATION_ATTR_IDS = new Set(['COLOR', 'SIZE', 'MAIN_COLOR', 'SELLER_SKU', 'GTIN']);

window.openAttrEditor = function (attrId) {
    const state = window.currentAnalysisState;
    if (!state) return;
    const catAttr = (state.categoryAttributes || []).find(a => a.id === attrId);
    if (!catAttr) return;

    const wrapper = document.getElementById(`attr-edit-wrapper-${attrId}`);
    if (!wrapper) return;

    // Bloqueia edição se anúncio tem variações E o atributo é normalmente per-variação
    const hasVariations = Array.isArray(state.detail?.variations) && state.detail.variations.length > 0;
    const isVariationAttr = MF_VARIATION_ATTR_IDS.has(String(attrId).toUpperCase());
    if (hasVariations && isVariationAttr) {
        const itemId = state.detail?.id || '';
        const editUrl = itemId ? `https://www.mercadolivre.com.br/anuncios/${itemId}/modificar/variantes` : '';
        wrapper.innerHTML = `
            <div class="attr-edit-box" style="background:var(--yellow-light); border:1px solid var(--yellow); padding:8px; border-radius:6px;">
                <div style="font-size:0.85rem; color:var(--text); margin-bottom:6px;">
                    <strong>${catAttr.name}</strong> é gerenciado por variação nesse anúncio.
                </div>
                <div style="font-size:0.78rem; color:var(--text-secondary); margin-bottom:8px;">
                    Esse anúncio tem ${state.detail.variations.length} variações. Edite esse campo em cada variação separadamente, na página do anúncio no Mercado Livre.
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    ${editUrl ? `<a href="${editUrl}" target="_blank" rel="noopener" class="attr-edit-save" style="text-decoration:none; padding:4px 10px; background:var(--blue); color:white; border-radius:4px; font-size:0.78rem;">Abrir variações no ML →</a>` : ''}
                    <button type="button" onclick="window.cancelAttrEditor('${attrId}')" class="attr-edit-cancel" title="Fechar">✕</button>
                </div>
            </div>
        `;
        return;
    }

    // Campo sem caminho de edição não abre editor nenhum: em vez de deixar o vendedor
    // digitar e levar erro depois, dizemos o motivo e mandamos pro lugar certo.
    const motivoBloqueio = mfMotivoNaoEditavel(catAttr, state.detail);
    if (motivoBloqueio) {
        const idDoItem = state.detail?.id || '';
        const urlML = idDoItem ? `https://www.mercadolivre.com.br/anuncios/${idDoItem}/modificar` : '';
        wrapper.innerHTML = `
            <div class="attr-edit-box" style="background:var(--yellow-light); border:1px solid var(--yellow); padding:8px; border-radius:6px;">
                <div style="font-size:0.82rem; color:var(--text); margin-bottom:8px;">${escapeHtml(MF_textoCampoBloqueado(catAttr, motivoBloqueio))}</div>
                <div style="display:flex; gap:6px; align-items:center;">
                    ${urlML ? `<a href="${urlML}" target="_blank" rel="noopener" class="attr-edit-save" style="text-decoration:none; padding:4px 10px; background:var(--blue); color:white; border-radius:4px; font-size:0.78rem;">Abrir no Mercado Livre →</a>` : ''}
                    <button type="button" onclick="window.cancelAttrEditor('${attrId}')" class="attr-edit-cancel" title="Fechar">✕</button>
                </div>
            </div>`;
        return;
    }

    const currentAd = (state.detail.attributes || []).find(a => a.id === attrId) || {};
    const currentValueName = currentAd.value_name || '';
    const currentValueId = currentAd.value_id || '';

    const allowedValues = Array.isArray(catAttr.values) ? catAttr.values : [];
    const maxLen = catAttr.value_max_length || 255;
    const valueType = catAttr.value_type || 'string';

    let inputHtml;
    let hintExtra = '';
    if (valueType === 'boolean') {
        // Boolean — ML só aceita "Sim" ou "Não" exatos
        const isYes = (currentValueName || '').toLowerCase() === 'sim';
        const isNo = (currentValueName || '').toLowerCase() === 'não';
        inputHtml = `<select id="attr-input-${attrId}" class="attr-edit-input">
            <option value="">-- Selecione --</option>
            <option value="242085" data-name="Sim"${isYes ? ' selected' : ''}>Sim</option>
            <option value="242084" data-name="Não"${isNo ? ' selected' : ''}>Não</option>
        </select>`;
    } else if (valueType === 'list' && allowedValues.length > 0) {
        // Strict list — ML rejeita texto livre aqui, força select
        const opts = allowedValues.map(v => {
            const selected = String(v.id) === String(currentValueId) ? ' selected' : '';
            const nameAttr = String(v.name || '').replace(/"/g, '&quot;');
            return `<option value="${v.id}" data-name="${nameAttr}"${selected}>${escapeHtml(v.name)}</option>`;
        }).join('');
        inputHtml = `<select id="attr-input-${attrId}" class="attr-edit-input">
            <option value="">-- Selecione uma opção --</option>
            ${opts}
        </select>`;
        hintExtra = ` · escolha uma opção da lista (texto livre não é aceito)`;
    } else if (allowedValues.length > 0) {
        // String com sugestões — permite texto livre, ML aceita pra ganhar keywords
        const datalistId = `attr-datalist-${attrId}`;
        const opts = allowedValues.map(v => `<option value="${escapeHtml(v.name)}">`).join('');
        inputHtml = `<input type="text" id="attr-input-${attrId}" class="attr-edit-input" value="${escapeHtml(currentValueName)}" maxlength="${maxLen}" list="${datalistId}" autocomplete="off" placeholder="comece a digitar pra ver sugestões" />
            <datalist id="${datalistId}">${opts}</datalist>`;
        hintExtra = ` · ${allowedValues.length} sugestões disponíveis — pode combinar ou digitar livre`;
    } else if (valueType === 'number' || valueType === 'number_unit') {
        const unit = catAttr.default_unit || (Array.isArray(catAttr.allowed_units) ? (catAttr.allowed_units[0]?.id || catAttr.allowed_units[0]?.name) : '');
        const exNum = exampleNumberForUnit(unit);
        const fromHelper = MF_getAttrPlaceholder(catAttr);
        const placeholder = fromHelper || (valueType === 'number_unit' && unit ? `ex: ${exNum} ${unit}` : `ex: ${exNum}`);
        inputHtml = `<input type="text" id="attr-input-${attrId}" class="attr-edit-input" value="${escapeHtml(currentValueName)}" placeholder="${escapeHtml(placeholder)}" maxlength="${maxLen}" inputmode="decimal" />`;
        hintExtra = valueType === 'number_unit' && unit
            ? ` · digite o valor em ${unit} (ex: ${exNum} ${unit}) — só números`
            : ` · digite só números (ex: ${exNum})`;
    } else {
        // Default: string free text
        const placeholder = MF_getAttrPlaceholder(catAttr);
        const phAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';
        const isGtin = MF_isGtinLike(attrId);
        const inputModeAttr = isGtin ? ' inputmode="numeric"' : '';
        inputHtml = `<input type="text" id="attr-input-${attrId}" class="attr-edit-input" value="${escapeHtml(currentValueName)}" maxlength="${maxLen}"${phAttr}${inputModeAttr} />`;
        if (isGtin) hintExtra = ` · cole o código de barras (só números: 8, 12, 13 ou 14 dígitos)`;
        else if (String(attrId).toUpperCase() === 'SELLER_SKU') hintExtra = ` · seu código interno (qualquer texto, até ${maxLen} caracteres)`;
    }

    // Renomear variação é caro e não tem desfazer: o alerta vem ANTES do campo, e quem
    // confirma tem que passar por cima do botão de cancelar, que é o destaque.
    // Só entra quando o valor REALMENTE está no título (mfMudaOLink) — todo CHILD_PK
    // renomeia a variação, mas só o que aparece no título muda o link. Ver a medição de
    // 10/08 no comentário de mfMudaOLink. A flag do proxy continua saindo em todos.
    const renomeia = mfMudaOLink(catAttr, state.detail);
    wrapper.innerHTML = renomeia ? `
        <div class="attr-edit-box mf-attr-perigo">
            <div class="mf-alerta-renomear">
                <div class="mf-alerta-titulo">⚠️ Isto renomeia a variação — o anúncio perde a exposição</div>
                <div class="mf-alerta-texto">O link do anúncio muda e ele recomeça do zero, como se fosse novo. Acontece igual se você renomear pelo Mercado Livre. Só vale a pena se o nome estiver realmente errado.</div>
            </div>
            ${inputHtml}
            <div class="mf-alerta-acoes">
                <button type="button" onclick="window.cancelAttrEditor('${attrId}')" class="attr-edit-cancel mf-btn-manter">Manter como está</button>
                <button type="button" onclick="window.saveAttr('${attrId}')" class="attr-edit-save mf-btn-renomear">Renomear mesmo assim</button>
            </div>
            <div id="attr-edit-error-${attrId}" class="attr-edit-error" style="display:none;"></div>
            <div class="attr-edit-hint">${catAttr.name}${maxLen && maxLen < 255 ? ` — até ${maxLen} caracteres` : ''}${hintExtra}</div>
        </div>
    ` : `
        <div class="attr-edit-box">
            ${inputHtml}
            <button type="button" onclick="window.saveAttr('${attrId}')" class="attr-edit-save" title="Salvar">✓</button>
            <button type="button" onclick="window.cancelAttrEditor('${attrId}')" class="attr-edit-cancel" title="Cancelar">✕</button>
            <div id="attr-edit-error-${attrId}" class="attr-edit-error" style="display:none;"></div>
            <div class="attr-edit-hint">${catAttr.name}${maxLen && maxLen < 255 ? ` — até ${maxLen} caracteres` : ''}${hintExtra}</div>
        </div>
    `;
    const input = document.getElementById(`attr-input-${attrId}`);
    if (input) {
        input.focus();
        if (input.tagName === 'INPUT' && input.value) input.select();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); window.saveAttr(attrId); }
            if (e.key === 'Escape') { e.preventDefault(); window.cancelAttrEditor(attrId); }
        });
    }
};

window.cancelAttrEditor = function (attrId) {
    // Simple approach: re-render the card to restore original view
    const state = window.currentAnalysisState;
    if (!state) return;
    const containerId = `categoryAttributes${state.containerIdSuffix || ''}`;
    exibirAtributosCategoria(state.categoryAttributes, state.detail.attributes, containerId);
};

window.saveAttr = async function (attrId) {
    const state = window.currentAnalysisState;
    if (!state) return;
    const input = document.getElementById(`attr-input-${attrId}`);
    const errorEl = document.getElementById(`attr-edit-error-${attrId}`);
    if (!input) return;

    const saveBtn = document.querySelector(`#attr-edit-wrapper-${attrId} .attr-edit-save`);
    const cancelBtn = document.querySelector(`#attr-edit-wrapper-${attrId} .attr-edit-cancel`);
    // O botão do fluxo de renomear é textual ("Renomear mesmo assim"), não um ✓ — restaurar
    // o rótulo original em vez de chumbar o símbolo, senão o aviso vira um tico verde.
    const rotuloSalvar = saveBtn ? saveBtn.textContent : '✓';
    const showError = (msg) => {
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = rotuloSalvar; }
        if (cancelBtn) cancelBtn.disabled = false;
        if (input) input.disabled = false;
    };

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
    if (cancelBtn) cancelBtn.disabled = true;
    if (input) input.disabled = true;
    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }

    const catAttr = (state.categoryAttributes || []).find(a => a.id === attrId);
    // Última checagem antes de sair da tela: campo bloqueado não vira requisição.
    const motivoBloqueio = mfMotivoNaoEditavel(catAttr, state.detail);
    if (motivoBloqueio) return showError(MF_textoCampoBloqueado(catAttr, motivoBloqueio));

    let attrPayload;
    if (input.tagName === 'SELECT') {
        const opt = input.options[input.selectedIndex];
        if (!opt || !opt.value) return showError(`Selecione uma opção da lista para "${catAttr?.name || 'este campo'}".`);
        attrPayload = { id: attrId, value_id: opt.value, value_name: opt.dataset.name || opt.textContent.trim() };
    } else {
        const rawVal = (input.value || '').trim();
        // Pré-validação amigável antes de chamar a ML
        const validation = MF_validateAttrInput(catAttr, rawVal);
        if (!validation.ok) return showError(validation.error);
        const val = validation.cleanedValue || rawVal;
        // Se a auto-correção limpou caracteres inválidos (ex: GTIN), reflete no input
        if (validation.autoCleaned && input) input.value = val;
        // Se bater exato com uma allowed_value, manda value_id também (mais robusto)
        const exactMatch = Array.isArray(catAttr?.values)
            ? catAttr.values.find(v => String(v.name || '').toLowerCase() === val.toLowerCase())
            : null;
        if (exactMatch) {
            attrPayload = { id: attrId, value_id: exactMatch.id, value_name: exactMatch.name };
        } else {
            attrPayload = { id: attrId, value_name: val };
        }
    }

    const itemId = state.detail?.id;
    const token = state.accessToken || window._adsAccessToken;
    if (!itemId || !token) return showError('Sessão expirada. Recarregue a página.');

    try {
        const res = await fetch(`${BASE_URL_PROXY}/api/fetch-item-update?item_id=${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            // O proxy recusa renomear variação sem esta confirmação explícita: a rede de
            // segurança continua de pé contra chamada acidental, e só sai do caminho de
            // quem passou pelo alerta vermelho.
            body: JSON.stringify(mfRenomeiaVariacao(catAttr, state.detail)
                ? { attributes: [attrPayload], confirm_rename_variation: true }
                : { attributes: [attrPayload] })
        });
        if (!res.ok) {
            let msg = `Erro ${res.status}`;
            try {
                const err = await res.json();
                msg = MF_translateMlError(err, catAttr) || err.error || err.message || msg;
            } catch (_) {}
            return showError(msg);
        }
        const updated = await res.json();
        const partialErr = MF_translateProxyPartialError(updated, catAttr);
        if (partialErr) return showError(partialErr);
        if (Array.isArray(updated?.attributes)) {
            state.detail.attributes = updated.attributes;
        } else {
            // Optimistic: merge the single attribute into state
            const idx = (state.detail.attributes || []).findIndex(a => a.id === attrId);
            const merged = { ...(idx >= 0 ? state.detail.attributes[idx] : { id: attrId }), ...attrPayload };
            if (idx >= 0) state.detail.attributes[idx] = merged;
            else (state.detail.attributes = state.detail.attributes || []).push(merged);
        }
        // A lista da ML é do carregamento e ela atualiza periodicamente: a linha vai
        // continuar pedindo este campo. Marcar aqui é o que evita o vendedor achar que o
        // salvamento não pegou e fazer tudo de novo pelo Mercado Livre.
        MF_marcaResolvidoNoML(state, attrId);
        exibirPerformance(state.performanceData, `performanceTexto${state.containerIdSuffix || ''}`);

        // Re-render the category card with fresh values
        const containerId = `categoryAttributes${state.containerIdSuffix || ''}`;
        exibirAtributosCategoria(state.categoryAttributes, state.detail.attributes, containerId);
        // Also re-render ficha técnica + score since attributes changed
        processarAtributos(state.detail.attributes, state.detail.title, state.usedFallback, `fichaTecnicaTexto${state.containerIdSuffix || ''}`);
    } catch (e) {
        return showError(e.message || 'Falha de rede');
    }
};

function reRenderAnalysisView() {
    if (!window.currentAnalysisState) return;
    const { detail, descriptionData, usedFallback, containerIdSuffix, categoryAttributes, visitsData, reviewsData, adsData, performanceData } = window.currentAnalysisState;

    // Update dependent components
    processarAtributos(detail.attributes, detail.title, usedFallback, `fichaTecnicaTexto${containerIdSuffix}`);
    exibirAtributosCategoria(categoryAttributes, detail.attributes, `categoryAttributes${containerIdSuffix}`);
    // Checklist junto: descrição e garantia agora se resolvem por ele, e um "❌ Não
    // preenchida" que sobrevive ao próprio salvamento faz o vendedor salvar de novo.
    exibirChecklistRapido(detail, descriptionData, `quickChecklist${containerIdSuffix}`);

    // Re-render score WITH analysisData so improvements panel persists
    const analysisData = { title: detail.title, detail, descriptionData, categoryAttributes, visitsData, reviewsData, adsData };
    // performanceData vai junto: sem ele o card "O que Melhorar" perdia a seção "Ações
    // Recomendadas pelo ML" no primeiro atributo que o vendedor salvasse — as recomendações
    // sumiam sozinhas e não voltavam sem recarregar a página (achado em 10/08/2026).
    exibirPontuacao(calcularPontuacaoQualidade(detail, descriptionData, usedFallback, categoryAttributes), usedFallback, `scoreCircle${containerIdSuffix}`, analysisData, `scoreChecklist${containerIdSuffix}`, performanceData);
}

function getPalavrasUnicas(texto) {
    if (!texto) return new Set();
    return new Set(texto.toLowerCase().replace(/[.,!?;:()"'/\\-]/g, ' ').split(/\s+/).filter(p => p && p.length >= 3));
}

function encontrarIntersecao(set1, set2) {
    const repetidas = [];
    for (const palavra of set1) { if (set2.has(palavra)) repetidas.push(palavra); }
    return repetidas;
}

function definirCorPorQuantidadeCaracteres(caracteresValor, attributeId = null, valorTexto = '') {
    if (VALORES_IGNORADOS_PENALIDADE.has(valorTexto.toLowerCase())) return 'inherit';
    if (attributeId === 'BRAND' && caracteresValor > 0 && caracteresValor < TAMANHO_IDEAL_ATRIBUTO) return 'green';
    if (caracteresValor >= 20 && caracteresValor <= TAMANHO_IDEAL_ATRIBUTO) return 'green';
    if (caracteresValor > TAMANHO_IDEAL_ATRIBUTO && caracteresValor <= TAMANHO_IDEAL_ATRIBUTO + 10) return 'gray';
    if (caracteresValor === 0) return 'red';
    return 'red';
}

// Copiar ID (anúncio, produto, variação) — o vendedor cola direto na busca do ML
window.MF_copiarId = function (valor, botao) {
    const marcarOk = () => {
        if (!botao) return;
        const antes = botao.innerHTML;
        botao.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        botao.style.color = 'var(--green)';
        setTimeout(() => { botao.innerHTML = antes; botao.style.color = ''; }, 1400);
    };
    try {
        navigator.clipboard.writeText(String(valor)).then(marcarOk, () => {});
    } catch (e) { /* sem clipboard: o número está na tela pra copiar na mão */ }
};

function exibirTitulo(titulo, isMlbu = false, containerId = "tituloTexto", detail = null) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Detect if title contains variation name (common in MLB items from MLBU)
    // Variations add " - VariationName" or " VariationName" to the title
    const variations = detail?.variations || [];
    let tituloBase = titulo || '';
    let variacaoNome = '';

    if (variations.length > 0 && detail?.attribute_combinations) {
        // Single item with attribute_combinations = it's a specific variation
        variacaoNome = detail.attribute_combinations.map(a => a.value_name).join(' ');
    } else if (variations.length > 0) {
        // Try to detect variation suffix in title by checking variation attribute names
        for (const v of variations) {
            if (v.attribute_combinations) {
                const varLabel = v.attribute_combinations.map(a => a.value_name).join(' ');
                if (titulo && titulo.endsWith(varLabel)) {
                    tituloBase = titulo.slice(0, -varLabel.length).replace(/[\s\-]+$/, '');
                    variacaoNome = varLabel;
                    break;
                }
            }
        }
    }

    const lenBase = tituloBase.length;
    const lenVar = variacaoNome.length;
    const lenTotal = (titulo || '').length;
    const hasVariation = variacaoNome.length > 0;

    // Para análise, usar o tamanho do título BASE (sem variação)
    const lenAnalise = hasVariation ? lenBase : lenTotal;

    const idealMin = isMlbu ? 50 : MIN_CHARS_TITULO_BOM;

    let state = 'bad';
    let progressPercent = 0;

    if (lenAnalise >= idealMin) {
        state = 'good';
        progressPercent = 100;
    } else if (lenAnalise >= 40) {
        state = 'neutral';
        progressPercent = 70;
    } else {
        progressPercent = Math.max(10, (lenAnalise / 60) * 100);
    }

    const badgeClass = state;
    const badgeText = state === 'good' ? 'Excelente' : (state === 'neutral' ? 'Aceitável' : 'Muito Curto');
    const imgUrl = detail?.pictures?.[0]?.secure_url || '';

    // Título leva pro anúncio à venda no ML — quem está analisando quer ver a página real
    const permalink = detail?.permalink || (detail?.id ? `https://www.mercadolivre.com.br/anuncio/${detail.id}` : '');
    const tituloTexto = hasVariation ? escapeHtml(tituloBase) : (escapeHtml(titulo) || 'Nenhum título encontrado');
    const setaExterna = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0; opacity:.75;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    const tituloExibidoHtml = (permalink && titulo)
        ? `<a href="${escapeHtml(permalink)}" target="_blank" rel="noopener" title="Abrir o anúncio no Mercado Livre" style="color:inherit; text-decoration:none; display:inline-flex; align-items:baseline; gap:6px;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${tituloTexto}${setaExterna}</a>`
        : tituloTexto;

    // Qual variação exatamente está na tela? Analisando uma variação de um produto (MLBU),
    // o nome sozinho não identifica: o vendedor precisa do ID pra achar na tela do ML.
    let variacaoId = null;
    if (Array.isArray(variations) && variations.length) {
        if (detail?.attribute_combinations) {
            const alvo = detail.attribute_combinations.map(a => a.value_name).join('|');
            const achada = variations.find(v => Array.isArray(v.attribute_combinations) &&
                v.attribute_combinations.map(a => a.value_name).join('|') === alvo);
            if (achada) variacaoId = achada.id;
        } else if (variations.length === 1) {
            variacaoId = variations[0].id;   // anúncio com uma variação só: não há ambiguidade
        } else if (variacaoNome) {
            const achada = variations.find(v => Array.isArray(v.attribute_combinations) &&
                v.attribute_combinations.map(a => a.value_name).join(' ') === variacaoNome);
            if (achada) variacaoId = achada.id;
        }
    }
    const copiaSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const chipId = (rotulo, valor, titulo) => `
        <span style="display:inline-flex; align-items:center; gap:5px; padding:3px 8px; background:var(--bg-subtle,#f1f5f9); border-radius:999px; font-size:0.72rem; color:var(--text-secondary);" title="${escapeHtml(titulo || '')}">
            <span style="font-weight:600; color:var(--text-muted);">${rotulo}</span>
            <span class="mono" style="color:var(--text);">${escapeHtml(String(valor))}</span>
            <button type="button" onclick="window.MF_copiarId && window.MF_copiarId('${escapeHtml(String(valor))}', this)" title="Copiar" style="background:none; border:none; padding:0; cursor:pointer; color:var(--text-muted); display:inline-flex;">${copiaSvg}</button>
        </span>`;

    // Sinal de termo repetido. Fica no card do título porque é do título que se trata, e
    // vem SEM ação: corrigir passa por family_name ou nome de variação, e os dois resetam
    // o anúncio (medido em 10/08). Dizer "arrume aqui" seria empurrar o vendedor pro dano.
    const _repetidos = MF_termosRepetidosNoTitulo(
        titulo,
        MF_valoresDaVariacao(detail, window.currentAnalysisState?.categoryAttributes)
    );
    const repetidoHtml = _repetidos.length ? `
        <div style="margin-top:10px; padding:8px 12px; background:var(--yellow-light,#fef3c7); border-radius:var(--radius-sm); border-left:3px solid var(--yellow,#f59e0b);">
            <span class="text-small" style="color:#92400e;">
                <b>${_repetidos.map(r => escapeHtml(r.termo)).join(', ')}</b>
                ${_repetidos.length > 1 ? 'aparecem' : 'aparece'} duas vezes no título.
                Costuma ser o nome da variação repetindo uma palavra que já está no nome do produto —
                gasta caracteres que podiam ser palavra de busca.
            </span>
            <span class="text-small" style="display:block; margin-top:4px; color:var(--text-muted);">
                Só um aviso: arrumar isso muda o título e o link do anúncio, e ele perde a exposição que já tem.
                Vale mais em anúncio novo do que em anúncio que já vende.
            </span>
        </div>` : '';

    // Variation info section
    let varHtml = '';
    if (hasVariation || variacaoId) {
        const varState = lenVar >= 20 ? 'good' : (lenVar >= 10 ? 'neutral' : 'bad');
        varHtml = `
            <div style="margin-top:12px; padding:10px 14px; background:var(--blue-light); border-radius:var(--radius-sm); border-left:3px solid var(--blue);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--blue); font-weight:600;">Nome da Variação</span>
                    ${hasVariation ? `<span class="status-badge ${varState === 'good' ? 'success' : (varState === 'neutral' ? 'muted' : 'error')}" style="font-size:0.65rem;">${lenVar} chars</span>` : ''}
                </div>
                ${hasVariation ? `<span style="font-weight:600; font-size:0.9rem; color:var(--text);">${escapeHtml(variacaoNome)}</span>` : ''}
                ${variacaoId ? `<div style="margin-top:6px;">${chipId('ID da variação', variacaoId, 'Use este número para achar a variação na tela de variações do Mercado Livre')}</div>` : ''}
                ${hasVariation ? '<div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">💡 Use até 30 caracteres para adicionar palavras-chave de busca extras.</div>' : ''}
            </div>`;
    }

    // Situação do anúncio no Mercado Livre. Sem isso, dava para analisar um
    // anúncio pausado (a conta de teste tem 100 deles) sem nada na tela dizer
    // que ele está fora do ar — e a nota, as visitas e o Ads passam a ser lidos
    // como se o anúncio estivesse vendendo.
    const _sub = Array.isArray(detail?.sub_status) ? detail.sub_status : [];
    const situacaoHtml = (() => {
        if (!detail?.status) return '';
        // O sub_status manda, venha o status como vier: a ML devolve bloqueio
        // dela junto de status 'active' também, e aí um selo verde "Ativo"
        // escondia justamente o motivo de o anúncio não vender. Mesmo
        // vocabulário do painel (ad-selector.js), pra não dizer duas coisas
        // diferentes sobre o mesmo anúncio.
        const MF_SUB_STATUS = {
            suspended: { texto: 'Suspenso pelo Mercado Livre', classe: 'error', ajuda: 'O Mercado Livre suspendeu este anúncio. Só ele pode liberar — veja o motivo no painel do ML.' },
            forbidden: { texto: 'Infração', classe: 'error', ajuda: 'O Mercado Livre bloqueou o anúncio por infração de política.' },
            waiting_for_patch: { texto: 'Corrigir para reativar', classe: 'error', ajuda: 'O Mercado Livre pede uma correção antes de o anúncio voltar ao ar.' },
            freezed: { texto: 'Congelado', classe: 'error', ajuda: 'O Mercado Livre congelou este anúncio.' },
            out_of_stock: { texto: 'Pausado — sem estoque', classe: 'neutral', ajuda: 'O Mercado Livre pausou o anúncio porque o estoque acabou.' },
            deleted: { texto: 'Excluído', classe: 'muted', ajuda: 'Este anúncio foi excluído.' },
        };
        const bloqueio = _sub.map(s => MF_SUB_STATUS[s]).find(Boolean);
        if (bloqueio) return `<span class="status-badge ${bloqueio.classe}" title="${escapeHtml(bloqueio.ajuda)}">${bloqueio.texto}</span>`;
        if (detail.status === 'active') return '<span class="status-badge success">Ativo</span>';
        if (detail.status === 'paused') return '<span class="status-badge neutral" title="Este anúncio não está aparecendo para os compradores.">Pausado</span>';
        const outros = { closed: 'Encerrado', under_review: 'Em revisão', inactive: 'Inativo', payment_required: 'Aguardando pagamento' };
        return `<span class="status-badge muted">${outros[detail.status] || 'Situação incomum'}</span>`;
    })();

    // Identificação do que está sendo analisado (anúncio, e o produto quando é família)
    const idsHtml = (detail?.id || detail?.user_product_id || situacaoHtml) ? `
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; align-items:center;">
            ${situacaoHtml}
            ${detail?.id ? chipId('Anúncio', detail.id, 'ID do anúncio no Mercado Livre') : ''}
            ${detail?.user_product_id ? chipId('Produto (MLBU)', detail.user_product_id, 'ID do produto que agrupa as variações') : ''}
        </div>` : '';

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.1s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📝</span>
                <span class="ana-card-title">Análise do Título</span>
                <span class="status-badge ${badgeClass}" style="margin-left:auto;">${badgeText}</span>
            </div>

            <div style="display:flex; gap:20px; align-items:flex-start;">
                ${imgUrl ? (permalink
                    ? `<a href="${escapeHtml(permalink)}" target="_blank" rel="noopener" class="cover-img-glow" style="display:block;" title="Abrir o anúncio no Mercado Livre"><img src="${imgUrl}" style="width:90px; height:90px; object-fit:contain; border-radius:var(--radius-sm); display:block;"></a>`
                    : `<div class="cover-img-glow"><img src="${imgUrl}" style="width:90px; height:90px; object-fit:contain; border-radius:var(--radius-sm); display:block;"></div>`) : ''}
                <div style="flex:1; min-width:0;">
                    <div style="margin-bottom:${hasVariation ? '8' : '20'}px;">
                        <p class="title-display">${tituloExibidoHtml}</p>
                        <div class="char-counter-bar">
                            <div class="char-progress ${state}" style="width: ${progressPercent}%"></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-top:5px;">
                             <span class="text-small">${hasVariation ? `${lenBase} chars (título)` : `${lenTotal} caracteres`}</span>
                             <span class="text-small">Meta: ${idealMin}+</span>
                        </div>
                    </div>

                    ${idsHtml}

                    ${repetidoHtml}
                    ${varHtml}

                    ${state !== 'good' && !hasVariation && (detail?.sold_quantity || 0) === 0 ? `
                    <div class="info-box" style="margin-bottom:0; margin-top:8px; background:#fff7ed; border-color:#fed7aa; color:#9a3412;">
                         <p><strong>Dica:</strong> ${detail?.family_name
                            ? `neste anúncio o título é montado pelo Mercado Livre a partir do <strong>nome do produto</strong> — é ele que se edita, e só enquanto nenhuma variação tiver vendido.`
                            : `como esse anúncio ainda não vendeu, vale otimizar pra ${idealMin}+ caracteres. Depois de começar a vender, <strong>não mexa mais no título</strong> — alterá-lo reseta a indexação do ML.`}</p>
                    </div>
                    ` : ''}
                    ${(() => {
                        // REGRA CRÍTICA: anúncio com QUALQUER venda no histórico não deve ter título alterado.
                        // Alterar reseta indexação do ML e derruba exposição.
                        const soldQty = detail?.sold_quantity || 0;
                        if (state !== 'good' && soldQty > 0) {
                            const _locale = (window.MF_getSiteConfig && window.MF_currentSiteId) ? window.MF_getSiteConfig(window.MF_currentSiteId()).locale : 'pt-BR';
                            return `
                            <div style="margin-top:10px; padding:12px 14px; background:linear-gradient(135deg, #fef3c7, #fde68a); border:1px solid #f59e0b; border-left:4px solid #d97706; border-radius:var(--radius-sm);">
                                <div style="display:flex; align-items:flex-start; gap:10px;">
                                    <span style="font-size:1.2rem; flex-shrink:0;">🛡️</span>
                                    <div style="flex:1; min-width:0;">
                                        <div style="font-weight:700; font-size:0.85rem; color:#78350f; margin-bottom:3px;">Não mexa no título desse anúncio</div>
                                        <div class="text-small" style="color:#78350f; line-height:1.4;">Este anúncio já tem <strong>${soldQty.toLocaleString(_locale)} ${soldQty === 1 ? 'venda' : 'vendas'}</strong>. Mesmo que o título não esteja no tamanho ideal, <strong>alterá-lo reseta a indexação do Mercado Livre</strong> — o anúncio perde posicionamento e exposição. Para subir a qualidade, mexa em fotos, atributos, descrição, garantia e frete; deixe o título como está.</div>
                                    </div>
                                </div>
                            </div>`;
                        }
                        return '';
                    })()}
                </div>
            </div>
        </div>
    `;

    // Animate progress bar width after render
    setTimeout(() => {
        const bar = el.querySelector('.char-progress');
        if (bar) bar.style.width = `${Math.min(100, (lenAnalise / 60) * 100)}%`;
    }, 300);
}

function exibirDescricaoIndicator(descriptionData, containerId = "descricaoIndicator") {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hasDesc = !!(descriptionData && ((descriptionData.plain_text && descriptionData.plain_text.trim()) || (descriptionData.text && descriptionData.text.trim())));
    const badgeClass = hasDesc ? 'success' : 'error';
    const icon = hasDesc ? '✅' : '❌';
    const fromCatalog = descriptionData?.source === 'catalog';
    const text = hasDesc ? (fromCatalog ? 'Do catálogo' : 'Detectada') : 'Sem Texto';

    el.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius);">
            <span style="font-weight:600; font-size:0.9rem;"><span style="margin-right:6px;">📝</span> Descrição</span>
            <span class="status-badge ${badgeClass}">${icon} ${text}</span>
        </div>
    `;
}

/**
 * Este atributo sobrou de uma categoria ANTERIOR do anúncio?
 *
 * Quando o vendedor muda a categoria, a ML **não apaga** os atributos da categoria antiga —
 * eles seguem gravados no item. A Ficha Técnica lista o que está no item, então esses
 * órfãos entravam como se fossem da ficha atual: um "Kit Válvula de Segurança" aparecia
 * com "Tipo de manômetro" e "Tipo de preenchimento líquido" (caso real, MLB3084958679).
 *
 * Sem a lista da categoria (rede falhou, MLBU, catálogo) devolve false: marcar tudo como
 * "de outra categoria" seria acusar sem saber — chamada que falhou não vira veredito.
 */
function mfDeOutraCategoria(attrId) {
    const cats = window.currentAnalysisState && window.currentAnalysisState.categoryAttributes;
    if (!Array.isArray(cats) || !cats.length) return false;
    return !cats.some((c) => c && c.id === attrId);
}
function processarAtributos(fichaTecnica, titulo, usedFallback = false, containerId = "fichaTecnicaTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!Array.isArray(fichaTecnica) || fichaTecnica.length === 0) {
        el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.2s;">
            <div class="ana-card-header"><span class="ana-card-icon">📋</span><span class="ana-card-title">Otimização de Palavras da Ficha Técnica</span></div>
            <p class="text-small">Nenhuma ficha técnica disponível.</p>
        </div>`;
        return;
    }

    const pTit = getPalavrasUnicas(titulo);
    const validAttrs = fichaTecnica.filter(a => typeof a === 'object' && a && a.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id) && !ehAtributoDeSistema(a.id));

    const problemAttrs = [];
    const okAttrs = [];

    const pPorAttr = new Map();
    validAttrs.forEach(a => pPorAttr.set(a.id, getPalavrasUnicas(a.value_name)));

    validAttrs.forEach(attr => {
        const nome = attr.name || attr.id;
        const valor = attr.value_name.trim();
        const vLow = valor.toLowerCase();
        const len = valor.length;
        const ignorarPenalidades = deveIgnorarAtributoPorNome(nome);

        let issues = [];

        if (!ignorarPenalidades) {
            // Check Length
            if (!VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                if (len > TAMANHO_IDEAL_ATRIBUTO) {
                    issues.push('Não Indexa (>30)');
                } else if (len < 20 && attr.id !== 'BRAND') {
                    issues.push('Muito Curto (<20)');
                }
            }

            // Check Repetition — collect exact words and sources
            if (!ATRIBUTOS_IGNORADOS_REPETICAO.has(attr.id) && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                const pAtuais = pPorAttr.get(attr.id);
                const reptTitulo = encontrarIntersecao(pAtuais, pTit);
                if (reptTitulo.length > 0) {
                    const words = reptTitulo.map(w => `<span style="background:#fde68a;color:#92400e;padding:0 3px;border-radius:3px;font-weight:600;">${w}</span>`).join(' ');
                    issues.push(`Repete o Título: ${words}`);
                }

                // Repetition with other attributes
                const dupColors = ['#dbeafe','#fce7f3','#e0e7ff','#fef3c7','#ccfbf1'];
                let colorIdx = 0;
                pPorAttr.forEach((pOutro, outroId) => {
                    if (attr.id !== outroId && !ATRIBUTOS_IGNORADOS_REPETICAO.has(outroId)) {
                        const otherAttr = validAttrs.find(a => a.id === outroId);
                        if (otherAttr && !VALORES_IGNORADOS_PENALIDADE.has(otherAttr.value_name.toLowerCase())) {
                            const palavrasRepetidas = encontrarIntersecao(pAtuais, pOutro);
                            if (palavrasRepetidas.length > 0) {
                                const bg = dupColors[colorIdx % dupColors.length];
                                colorIdx++;
                                const words = palavrasRepetidas.map(w => `<span style="background:${bg};padding:0 3px;border-radius:3px;font-weight:600;">${w}</span>`).join(' ');
                                issues.push(`Duplica com <strong>${otherAttr.name || outroId}</strong>: ${words}`);
                            }
                        }
                    }
                });
            }
        }

        if (issues.length > 0) {
            problemAttrs.push({ id: attr.id, name: nome, value: valor, issues, deOutraCategoria: mfDeOutraCategoria(attr.id) });
        } else {
            okAttrs.push({ id: attr.id, name: nome, value: valor, deOutraCategoria: mfDeOutraCategoria(attr.id) });
        }
    });

    const renderList = (list, isProblem) => {
        if (list.length === 0) return '';
        return list.map(item => {
            const ignored = window.ignoredAdAttributes.has(item.id);
            const issuesHtml = isProblem && !ignored && item.issues ? item.issues.map(iss => `<div style="font-size:0.72rem; color:var(--red-dark); margin-top:3px; line-height:1.3;">⚠ ${iss}</div>`).join('') : '';
            return `
            <div class="attribute-item ${isProblem ? 'problem' : ''}" style="min-width:0; ${ignored ? 'opacity:0.5; filter:grayscale(1);' : ''}">
                <div style="flex-grow:1; min-width:0; overflow:hidden;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="text-label" style="margin-bottom:2px;">${escapeHtml(item.name)}${item.deOutraCategoria ? '<span style="margin-left:6px; font-size:0.65rem; font-weight:600; padding:1px 6px; border-radius:999px; background:var(--bg-subtle,#f1f5f9); color:var(--text-muted); white-space:nowrap;" title="Este campo ficou de uma categoria anterior deste anúncio. Ele não faz parte da ficha da categoria atual e o Mercado Livre não o considera mais — some quando você salvar o anúncio de novo.">de outra categoria</span>' : ''}</span>
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            ${!isProblem && !ignored ? '<span style="color:var(--green); font-weight:bold;">✔</span>' : ''}
                            ${ignored ? '<span style="color:gray; font-size:0.75rem;">Ignorado</span>' : ''}
                            <button onclick="window.toggleIgnoreAttribute('${item.id}', 'ad')" title="${ignored ? 'Incluir' : 'Ignorar'}" class="btn-ignore-clean ${ignored ? 'ignored' : ''}">
                                ${ignored ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'}
                            </button>
                        </div>
                    </div>
                    <span class="text-value" style="word-break:break-word; ${ignored ? 'text-decoration:line-through;' : ''}">${escapeHtml(item.value)}</span>
                    ${issuesHtml}
                </div>
            </div>`;
        }).join('');
    };

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.2s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📋</span>
                <span class="ana-card-title">Otimização de Palavras da Ficha Técnica</span>
                <span class="text-small" style="margin-left:auto; color:var(--text-muted);">${problemAttrs.length + okAttrs.length} atributos</span>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                <div>
                    <div class="specs-group-title problem" style="margin-bottom:8px;">⚠️ Atenção (${problemAttrs.length})</div>
                    ${problemAttrs.length > 0 ? renderList(problemAttrs, true) : '<p class="text-small" style="color:var(--green);">Nenhum problema encontrado 🎉</p>'}
                </div>
                <div>
                    <div class="specs-group-title valid" style="margin-bottom:8px;">✅ Tudo Certo (${okAttrs.length})</div>
                    ${okAttrs.length > 0 ? renderList(okAttrs, false) : '<p class="text-small">Nenhum atributo validado.</p>'}
                </div>
            </div>
            ${usedFallback ? '<p class="text-small" style="margin-top:10px;">ℹ️ Dados via Scraper (Parcial)</p>' : ''}
        </div>
    `;
}

// === Editor de Variações em Lote (modal) ============================================
// Catálogo de tags conhecidas: severity + label amigável + ícone.
// Tags técnicas ou irrelevantes pra UI ficam em "ignored".
const MF_TAG_CATALOG = {
    // Positivas (verde)
    good_quality_picture:        { sev: 'pos', label: 'Imagem boa' },
    good_quality_thumbnail:      { sev: 'pos', label: 'Thumb boa' },
    brand_verified:              { sev: 'pos', label: 'Marca verificada' },
    best_seller_candidate:       { sev: 'pos', label: 'Candidato a top' },
    cart_eligible:               { sev: 'pos', label: 'Carrinho ✓' },
    extended_warranty_eligible:  { sev: 'pos', label: 'Garantia ext.' },
    high_quality:                { sev: 'pos', label: 'Alta qualidade' },
    best_listing:                { sev: 'pos', label: 'Top listing' },
    immediate_payment:           { sev: 'pos', label: 'Pgto imediato' },
    catalog_boost:               { sev: 'pos', label: 'Boost catálogo' },
    supermarket_eligible:        { sev: 'pos', label: 'Supermercado' },
    // Negativas (vermelho)
    poor_quality_picture:        { sev: 'neg', label: 'Imagem ruim' },
    poor_quality_thumbnail:      { sev: 'neg', label: 'Thumb ruim' },
    incomplete_technical_specs:  { sev: 'neg', label: 'Specs incompletas' },
    moderation_penalty:          { sev: 'neg', label: 'Punição mod.' },
    low_health:                  { sev: 'neg', label: 'Saúde baixa' },
    manufacturing_time:          { sev: 'neg', label: 'Sob encomenda' },
    forbidden:                   { sev: 'neg', label: 'Proibido' },
    // Neutras / informacionais (cinza)
    catalog_listing:             { sev: 'info', label: 'Catálogo' },
    dragged_bids_and_visits:     { sev: 'info', label: 'Histórico migrado' },
    // Ignoradas (técnicas)
    user_product_listing:        { sev: 'ignore' },
    variations_migration_uptin:  { sev: 'ignore' },
};

function MF_classifyTag(tag) {
    const meta = MF_TAG_CATALOG[tag];
    if (!meta) return { sev: 'info', label: tag.replace(/_/g, ' ') };
    return meta;
}

// Ícones SVG inline pequenos — usados em chips, badges, etc.
const MF_ICONS = {
    check: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 8 7 12 13 4"></polyline></svg>',
    warn:  '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2 L14.5 13.5 L1.5 13.5 Z"></path><line x1="8" y1="6" x2="8" y2="9.5"></line><circle cx="8" cy="11.6" r="0.6" fill="currentColor"></circle></svg>',
    info:  '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"></circle><line x1="8" y1="7" x2="8" y2="11"></line><circle cx="8" cy="4.6" r="0.6" fill="currentColor"></circle></svg>',
    spark: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M9 1l-1 5h-4l3 2.5-1 5 3.5-2.6 3.5 2.6-1-5 3-2.5h-4z"></path></svg>',
    cart:  '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="13.5" r="1"></circle><circle cx="11" cy="13.5" r="1"></circle><polyline points="1 1 3 1 4.5 9 12.5 9 14 4 4 4"></polyline></svg>',
    img:   '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.4"></rect><circle cx="6" cy="6.5" r="1.2"></circle><polyline points="14 11 10 7 2 13"></polyline></svg>',
    bolt:  '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M9.5 1L3 9h4l-1.5 6L13 7H9z"></path></svg>',
    star:  '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M8 1.2l2.1 4.4 4.7.6-3.4 3.3.8 4.7L8 12l-4.2 2.2.8-4.7-3.4-3.3 4.7-.6z"></path></svg>',
    money: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="1" x2="8" y2="15"></line><path d="M11.5 4.5h-5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4h-5"></path></svg>',
    box:   '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="2 5 8 2 14 5 14 12 8 15 2 12"></polygon><polyline points="2 5 8 8 14 5"></polyline><line x1="8" y1="8" x2="8" y2="15"></line></svg>',
    drop:  '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2 11 6 7 9 10 14 4"></polyline></svg>',
};
function MF_iconForTag(tag) {
    if (/picture|thumbnail/i.test(tag)) return MF_ICONS.img;
    if (/cart_eligible/i.test(tag)) return MF_ICONS.cart;
    if (/best_seller|best_listing|high_quality|brand_verified/i.test(tag)) return MF_ICONS.star;
    if (/immediate_payment/i.test(tag)) return MF_ICONS.bolt;
    return null;
}
function MF_iconForSeverity(sev) {
    return sev === 'pos' ? MF_ICONS.check : sev === 'neg' ? MF_ICONS.warn : sev === 'warn' ? MF_ICONS.warn : MF_ICONS.info;
}

function MF_renderTagsBadges(tags) {
    if (!Array.isArray(tags) || !tags.length) return '<span class="mfd-fb-empty">sem tags</span>';
    const visible = tags.map(t => ({ tag: t, ...MF_classifyTag(t) })).filter(m => m.sev !== 'ignore');
    if (!visible.length) return '<span class="mfd-fb-empty">—</span>';
    // Ordena: neg primeiro, depois pos, depois info
    const order = { neg: 0, pos: 1, info: 2 };
    visible.sort((a, b) => order[a.sev] - order[b.sev]);
    return visible.map(m => {
        const icon = MF_iconForTag(m.tag) || MF_iconForSeverity(m.sev);
        return `<span class="mfd-tag-chip ${m.sev}" title="${escapeHtml(m.tag)}">${icon}<span>${escapeHtml(m.label || m.tag)}</span></span>`;
    }).join('');
}

// Identifica a "melhor variação" da família: mais qualidade + sem problemas + estoque > 1.
function MF_pickHeroVariation(variations) {
    if (!Array.isArray(variations) || variations.length < 2) return null;
    let best = null, bestScore = -1;
    for (const v of variations) {
        const q = v.quality?.performance_score ?? v.quality?.score;
        if (typeof q !== 'number') continue;
        const pct = q <= 1 ? q * 100 : q;
        const stock = v.summary?.available_quantity || 0;
        const status = v.summary?.status;
        if (status !== 'active' || stock <= 1) continue;
        const probs = MF_analyzeVariationProblems(v, variations).problems.length;
        const score = pct - probs * 5 + Math.min(stock, 50) * 0.2;
        if (score > bestScore) { bestScore = score; best = v.up_id; }
    }
    return best;
}

// Detecta problemas específicos de uma variação. Reutiliza categoryAttributes do state.
// `allVariations` é usado pra calcular outliers de preço dentro da família.
function MF_analyzeVariationProblems(variation, allVariations) {
    const problems = [];
    const cats = window.currentAnalysisState?.categoryAttributes || [];
    const itemAttrs = Array.isArray(variation.item_attributes) ? variation.item_attributes : [];
    const itemAttrMap = new Map(itemAttrs.map(a => [a.id, a]));

    // 1) Atributos required + editáveis por variação que estão vazios.
    // Mesma régua do painel de edição (MF_VARIATION_EDITABLE_HIERARCHIES) — se o cartão
    // cobrar um campo, o painel tem que ter onde preencher.
    const VAR_HIER = MF_VARIATION_EDITABLE_HIERARCHIES;
    const EDITABLE_TYPES = new Set(['string', 'list', 'boolean', 'number', 'number_unit']);
    const requiredMissing = [];
    const recommendedMissing = [];
    for (const c of cats) {
        if (!EDITABLE_TYPES.has(c.value_type) || c.tags?.read_only) continue;
        if (!VAR_HIER.has(c.hierarchy)) continue; // só por-variação
        const a = itemAttrMap.get(c.id);
        const filled = !!(a && (a.value_name || (Array.isArray(a.values) && a.values.length)));
        if (filled) continue;
        // CHILD_PK vazio não tem onde ser preenchido (tira a variação da família) —
        // então também não vira problema no cartão. Idem os campos da assinatura.
        if (c.hierarchy === 'CHILD_PK' || MF_ATTRS_DA_ASSINATURA.has(c.id)) continue;
        if (c.tags?.required) requiredMissing.push(c.name || c.id);
        else if (c.tags?.catalog_required || c.tags?.fixed) recommendedMissing.push(c.name || c.id);
    }
    if (requiredMissing.length) {
        problems.push({ sev: 'neg', icon: '⚠', label: `${requiredMissing.length} obrigatório${requiredMissing.length > 1 ? 's' : ''} vazio${requiredMissing.length > 1 ? 's' : ''}`, detail: requiredMissing.join(', ') });
    }
    if (recommendedMissing.length) {
        problems.push({ sev: 'warn', icon: '○', label: `${recommendedMissing.length} recomendado${recommendedMissing.length > 1 ? 's' : ''} vazio${recommendedMissing.length > 1 ? 's' : ''}`, detail: recommendedMissing.join(', ') });
    }

    // 2) GTIN ausente
    const gtinAttr = itemAttrMap.get('GTIN');
    const gtinFilled = !!(gtinAttr && (gtinAttr.value_name || (Array.isArray(gtinAttr.values) && gtinAttr.values.length)));
    const hasGtinInCategory = cats.some(c => c.id === 'GTIN');
    if (hasGtinInCategory && !gtinFilled) {
        problems.push({ sev: 'warn', icon: '#', label: 'GTIN ausente', detail: 'Código universal do produto não preenchido' });
    }

    // 3) SKU ausente
    const skuFilled = !!(itemAttrMap.get('SELLER_SKU')?.value_name);
    if (!skuFilled) {
        problems.push({ sev: 'info', icon: '#', label: 'SKU vazio', detail: 'Sem código interno do vendedor' });
    }

    // 4) Dimensões inválidas (0 ou ausentes)
    const dimAttrs = ['SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WEIGHT'];
    const dimMissing = dimAttrs.filter(id => {
        const a = itemAttrMap.get(id);
        if (!a) return cats.some(c => c.id === id); // se categoria pede e não tem
        const num = parseFloat(String(a.value_name || '').replace(',', '.'));
        return !a.value_name || (isFinite(num) && num <= 0);
    });
    if (dimMissing.length >= 2) {
        problems.push({ sev: 'warn', icon: '📦', label: 'Embalagem incompleta', detail: `${dimMissing.length} medida${dimMissing.length > 1 ? 's' : ''} faltando ou zerada${dimMissing.length > 1 ? 's' : ''}` });
    }

    // 5) Estoque baixo (≤ 1)
    const qty = variation.summary?.available_quantity;
    if (typeof qty === 'number' && qty <= 1) {
        problems.push({ sev: 'warn', icon: '📉', label: qty === 0 ? 'Sem estoque' : 'Estoque crítico', detail: `Apenas ${qty} unidade${qty === 1 ? '' : 's'}` });
    }

    // 6) Preço outlier (>30% diferente da mediana da família)
    const prices = (allVariations || []).map(v => v.summary?.price).filter(p => typeof p === 'number');
    if (prices.length >= 3 && typeof variation.summary?.price === 'number') {
        const sorted = prices.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const diff = Math.abs(variation.summary.price - median) / (median || 1);
        if (diff > 0.30) {
            const sign = variation.summary.price > median ? '+' : '−';
            problems.push({ sev: 'warn', icon: '💲', label: 'Preço fora da curva', detail: `${sign}${Math.round(diff * 100)}% vs mediana R$ ${median.toFixed(2).replace('.', ',')}` });
        }
    }

    // 7) Tags negativas explícitas
    const negTagsCount = Array.isArray(variation.tags) ? variation.tags.filter(t => MF_classifyTag(t).sev === 'neg').length : 0;
    if (negTagsCount) {
        problems.push({ sev: 'neg', icon: '⚠', label: `${negTagsCount} tag${negTagsCount > 1 ? 's' : ''} negativa${negTagsCount > 1 ? 's' : ''}`, detail: variation.tags.filter(t => MF_classifyTag(t).sev === 'neg').map(t => MF_classifyTag(t).label || t).join(', ') });
    }

    // 8) Score qualidade muito baixo
    const qScore = variation.quality?.performance_score ?? variation.quality?.score;
    if (typeof qScore === 'number') {
        const pct = qScore <= 1 ? qScore * 100 : qScore;
        if (pct < 40) problems.push({ sev: 'neg', icon: '⚡', label: 'Qualidade baixa', detail: `Pontuação ${Math.round(pct)} (alvo ≥70)` });
    }

    return { problems };
}

function MF_summarizeFamily(variations) {
    let active = 0, paused = 0, closed = 0;
    let withNegTags = 0, withLowQuality = 0, lowStock = 0;
    let totalStock = 0, maxStock = 0, prices = [];
    let totalSold = 0, maxSold = 0, soldDataPoints = 0;
    for (const v of variations) {
        const s = v.summary || {};
        if (s.status === 'active') active++;
        else if (s.status === 'paused') paused++;
        else if (s.status === 'closed') closed++;
        if (Array.isArray(v.tags) && v.tags.some(t => MF_classifyTag(t).sev === 'neg')) withNegTags++;
        const score = v.quality?.performance_score ?? v.quality?.score;
        if (typeof score === 'number') {
            const pct = score <= 1 ? score * 100 : score;
            if (pct < 70) withLowQuality++;
        }
        const qty = s.available_quantity;
        if (typeof qty === 'number') {
            totalStock += qty;
            if (qty > maxStock) maxStock = qty;
            if (qty <= 1) lowStock++;
        }
        if (typeof s.price === 'number') prices.push(s.price);
        if (typeof s.sold_quantity === 'number') {
            totalSold += s.sold_quantity;
            if (s.sold_quantity > maxSold) maxSold = s.sold_quantity;
            soldDataPoints++;
        }
    }
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;
    const priceRangePct = (minPrice !== null && maxPrice !== null && maxPrice > minPrice)
        ? Math.round(((maxPrice - minPrice) / minPrice) * 100) : 0;
    return { active, paused, closed, withNegTags, withLowQuality, lowStock, totalStock, maxStock, minPrice, maxPrice, priceRangePct, totalSold, maxSold, soldDataPoints, total: variations.length };
}

function MF_renderQualityBadge(quality) {
    if (!quality || typeof quality !== 'object') return '<span class="mfd-fb-empty">—</span>';
    // /item/{id}/performance retorna campos como performance_score, ranking_score, indicators
    const score = typeof quality.performance_score === 'number' ? quality.performance_score
                : typeof quality.score === 'number' ? quality.score
                : null;
    if (score === null) return '<span class="mfd-fb-empty">—</span>';
    const pct = Math.round(score * (score <= 1 ? 100 : 1));
    const cls = pct >= 70 ? 'pos' : pct >= 40 ? 'neutral' : 'neg';
    return `<span class="mfd-fb-tag ${cls}" title="Pontuação de desempenho">${pct}</span>`;
}

function MF_renderPurchaseExpBadge(pe) {
    if (!pe || typeof pe !== 'object') return '<span class="mfd-fb-empty">—</span>';
    // /reputation/items/.../purchase_experience/integrators retorna { score, level, ... }
    const score = typeof pe.score === 'number' ? pe.score
                : typeof pe.global_score === 'number' ? pe.global_score
                : null;
    const level = pe.level || pe.global_level || null;
    if (score === null && !level) return '<span class="mfd-fb-empty">—</span>';
    const cls = level === 'green' || (score !== null && score >= 4) ? 'pos'
              : level === 'yellow' || (score !== null && score >= 3) ? 'neutral'
              : 'neg';
    const label = level || (score !== null ? score.toFixed(1) : '?');
    return `<span class="mfd-fb-tag ${cls}" title="Experiência de compra">${label}</span>`;
}

function MF_renderFamilyEditorSkeleton() {
    const card = `
        <div class="mfd-fb-skeleton-card">
            <div class="mfd-fb-skel-row">
                <div class="mfd-fb-skel-thumb"></div>
                <div class="mfd-fb-skel-body">
                    <div class="mfd-fb-skel-line w-60"></div>
                    <div class="mfd-fb-skel-line w-40"></div>
                    <div class="mfd-fb-skel-stats">
                        <div class="mfd-fb-skel-line w-30"></div>
                        <div class="mfd-fb-skel-line w-30"></div>
                    </div>
                </div>
            </div>
            <div class="mfd-fb-skel-chips">
                <div class="mfd-fb-skel-chip"></div>
                <div class="mfd-fb-skel-chip w-50"></div>
                <div class="mfd-fb-skel-chip w-40"></div>
            </div>
        </div>`;
    return `
        <div class="mfd-fb-skeleton-summary">
            <div class="mfd-fb-skel-line w-50 lg"></div>
            <div class="mfd-fb-skel-chips">
                <div class="mfd-fb-skel-chip"></div>
                <div class="mfd-fb-skel-chip"></div>
                <div class="mfd-fb-skel-chip w-40"></div>
            </div>
        </div>
        <div class="mfd-fb-skeleton-grid">${card}${card}${card}${card}</div>
        <div class="mfd-fb-skeleton-hint">Carregando família…</div>`;
}

function MF_familyEditorEnsureModal() {
    let modal = document.getElementById('mfd-family-editor-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'mfd-family-editor-modal';
    modal.className = 'mfd-fb-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'mfd-fb-title-id');
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="mfd-fb-dialog" role="document">
            <div class="mfd-fb-header">
                <div class="mfd-fb-title" id="mfd-fb-title-id">Editor de Variações em Lote</div>
                <button class="mfd-fb-close" onclick="window.MF_closeFamilyBatchEditor()" title="Fechar (Esc)" aria-label="Fechar editor de variações">✕</button>
            </div>
            <div class="mfd-fb-body" id="mfd-fb-body"></div>
        </div>`;
    document.body.appendChild(modal);
    // Fecha no click no overlay (fora do dialog)
    modal.addEventListener('click', (e) => {
        if (e.target === modal) window.MF_closeFamilyBatchEditor();
    });
    // Iter 11 — ESC fecha o modal
    if (!window.__mfFamilyEditorEscBound) {
        window.__mfFamilyEditorEscBound = true;
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const m = document.getElementById('mfd-family-editor-modal');
            if (m && m.style.display !== 'none') {
                window.MF_closeFamilyBatchEditor();
                e.stopPropagation();
            }
        });
    }
    return modal;
}

window.MF_closeFamilyBatchEditor = function () {
    const modal = document.getElementById('mfd-family-editor-modal');
    if (modal) modal.style.display = 'none';
};

window.MF_openFamilyBatchEditor = async function (upId) {
    const state = window.currentAnalysisState;
    const token = state?.accessToken || window._adsAccessToken;
    if (!upId || !token) return alert('Sessão expirada. Recarregue a página.');

    const modal = MF_familyEditorEnsureModal();
    const body = modal.querySelector('#mfd-fb-body');
    body.innerHTML = MF_renderFamilyEditorSkeleton();
    modal.style.display = 'flex';

    try {
        const siteId = window.MF_CURRENT_SITE || 'MLB';
        const res = await fetch(`${BASE_URL_PROXY}/api/families/overview/${encodeURIComponent(upId)}?site_id=${encodeURIComponent(siteId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            body.innerHTML = `<div class="mfd-fb-error">Não foi possível carregar a família. ${escapeHtml(e.error || `Erro ${res.status}`)}</div>`;
            return;
        }
        const data = await res.json();
        // Guardar o overview pra reuso na etapa 2
        window.__mfFamilyOverview = data;
        MF_renderFamilyOverview(data, body);
    } catch (e) {
        body.innerHTML = `<div class="mfd-fb-error">Falha de rede: ${escapeHtml(e.message)}</div>`;
    }
};

function MF_renderFamilyOverview(data, body) {
    const fam = data.family || {};
    const variations = Array.isArray(data.variations) ? data.variations : [];
    const commonAttrs = Array.isArray(data.common_attrs) ? data.common_attrs : [];
    const cats = window.currentAnalysisState?.categoryAttributes || [];
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));

    // Filtrar comuns que SÃO de hierarquia FAMILY/PARENT_PK pra mostrar como info
    const familyHierAttrs = commonAttrs.filter(a => {
        const cat = catById[a.id];
        return cat && (cat.hierarchy === 'PARENT_PK' || cat.hierarchy === 'FAMILY');
    });
    // Só o PARENT_PK é intocável (agrupa as variações); o resto o vendedor preenche
    // abrindo a variação — a nota do rodapé muda conforme o que caiu na lista.
    const ehAgrupador = (a) => catById[a.id]?.hierarchy === 'PARENT_PK';
    const qtdAgrupador = familyHierAttrs.filter(ehAgrupador).length;
    const notaCompartilhados = qtdAgrupador === familyHierAttrs.length
        ? 'Esses campos agrupam as variações — só o Mercado Livre edita.'
        : (qtdAgrupador === 0
            ? 'Preencha estes campos abrindo a variação.'
            : 'Os marcados agrupam as variações (só o ML edita); os outros você preenche abrindo a variação.');

    const summary = MF_summarizeFamily(variations);
    const heroUpId = MF_pickHeroVariation(variations);
    const variationCardsHtml = variations.map((v, idx) => MF_renderVariationCard(v, idx, variations, heroUpId, summary)).join('');
    // Conta variações com problemas pro sumário
    const variationsWithProblems = variations.filter(v => MF_analyzeVariationProblems(v, variations).problems.length > 0).length;

    // Header sumário: chips com contadores agregados
    const summaryChips = [];
    if (summary.active) summaryChips.push(`<span class="mfd-summary-chip pos">${summary.active} ativa${summary.active > 1 ? 's' : ''}</span>`);
    if (summary.paused) summaryChips.push(`<span class="mfd-summary-chip neutral">${summary.paused} pausada${summary.paused > 1 ? 's' : ''}</span>`);
    if (summary.closed) summaryChips.push(`<span class="mfd-summary-chip neg">${summary.closed} fechada${summary.closed > 1 ? 's' : ''}</span>`);
    if (variationsWithProblems) summaryChips.push(`<span class="mfd-summary-chip neg">${variationsWithProblems} com problemas</span>`);
    if (summary.withLowQuality) summaryChips.push(`<span class="mfd-summary-chip neg">${summary.withLowQuality} qualidade baixa</span>`);
    if (summary.lowStock) summaryChips.push(`<span class="mfd-summary-chip warn">${summary.lowStock} estoque ≤1</span>`);
    summaryChips.push(`<span class="mfd-summary-chip info">Estoque total: ${summary.totalStock}</span>`);
    if (summary.minPrice !== null && summary.maxPrice !== null) {
        const priceTxt = summary.minPrice === summary.maxPrice
            ? `R$ ${summary.minPrice.toFixed(2)}`
            : `R$ ${summary.minPrice.toFixed(2)} – ${summary.maxPrice.toFixed(2)}`;
        summaryChips.push(`<span class="mfd-summary-chip info">${priceTxt}</span>`);
    }

    body.innerHTML = `
        <div class="mfd-fb-summary">
            <div class="mfd-fb-summary-title">${escapeHtml(fam.name || 'Família')}</div>
            <div class="mfd-fb-summary-chips">${summaryChips.join('')}</div>
        </div>
        <div class="mfd-fb-section">
            <div class="mfd-fb-section-title">Compartilhado entre as ${variations.length} variações</div>
            <div class="mfd-fb-shared-grid">
                ${familyHierAttrs.length === 0 ? '<span class="mfd-fb-empty">Nenhum campo compartilhado preenchido.</span>' :
                    familyHierAttrs.map(a => {
                        const cat = catById[a.id];
                        const name = cat?.name || a.name || a.id;
                        const value = a.value_name || (Array.isArray(a.values) ? a.values.map(v => v.name).filter(Boolean).join(', ') : '') || '—';
                        const selo = ehAgrupador(a)
                            ? ` <span class="mfd-fb-shared-tag" title="Este campo é o que agrupa as variações — mudar por aqui tiraria o anúncio do grupo.">só no ML</span>`
                            : '';
                        return `<div class="mfd-fb-shared-row">
                            <span class="mfd-fb-shared-label">${escapeHtml(name)}${selo}</span>
                            <span class="mfd-fb-shared-value">${escapeHtml(value)}</span>
                        </div>`;
                    }).join('')}
            </div>
            <div class="mfd-fb-shared-note">${notaCompartilhados}</div>
        </div>
        <div class="mfd-fb-section">
            <div class="mfd-fb-toolbar">
                <span class="mfd-fb-section-title" style="margin:0;">Por variação <span id="mfd-fb-counter">(${variations.length})</span></span>
                <span class="mfd-fb-toolbar-spacer"></span>
                <label class="mfd-fb-toolbar-label">
                    <input type="checkbox" id="mfd-fb-filter-problems" />
                    <span>Só com problemas</span>
                </label>
                <label class="mfd-fb-toolbar-label">
                    <span>Ordenar</span>
                    <select id="mfd-fb-sort">
                        <option value="default">Padrão</option>
                        <option value="problems">Mais problemas</option>
                        <option value="stock_asc">Menor estoque</option>
                        <option value="stock_desc">Maior estoque</option>
                        <option value="price_asc">Menor preço</option>
                        <option value="price_desc">Maior preço</option>
                        <option value="quality_asc">Pior qualidade</option>
                    </select>
                </label>
            </div>
            <div class="mfd-fb-variations-grid" id="mfd-fb-grid">
                ${variationCardsHtml}
            </div>
        </div>
    `;

    // Wire sort/filter
    const sortSel = body.querySelector('#mfd-fb-sort');
    const filterCk = body.querySelector('#mfd-fb-filter-problems');
    const grid = body.querySelector('#mfd-fb-grid');
    const apply = () => {
        const mode = sortSel.value;
        const onlyProblems = filterCk.checked;
        const enriched = variations.map(v => ({
            v,
            diag: MF_analyzeVariationProblems(v, variations).problems,
        }));
        let list = enriched;
        if (onlyProblems) list = list.filter(e => e.diag.length > 0);
        const cmp = {
            default: (a, b) => 0,
            problems: (a, b) => b.diag.length - a.diag.length,
            stock_asc: (a, b) => (a.v.summary?.available_quantity ?? Infinity) - (b.v.summary?.available_quantity ?? Infinity),
            stock_desc: (a, b) => (b.v.summary?.available_quantity ?? -1) - (a.v.summary?.available_quantity ?? -1),
            price_asc: (a, b) => (a.v.summary?.price ?? Infinity) - (b.v.summary?.price ?? Infinity),
            price_desc: (a, b) => (b.v.summary?.price ?? -1) - (a.v.summary?.price ?? -1),
            quality_asc: (a, b) => ((a.v.quality?.performance_score ?? a.v.quality?.score ?? 1) - (b.v.quality?.performance_score ?? b.v.quality?.score ?? 1)),
        }[mode] || (() => 0);
        list = list.slice().sort(cmp);
        // Iter 11 — atualiza contador "X de Y" quando filtro/sort ativo
        const counter = body.querySelector('#mfd-fb-counter');
        if (counter) {
            const total = variations.length;
            const shown = list.length;
            counter.textContent = (shown === total && mode === 'default') ? `(${total})` : `(${shown} de ${total})`;
            counter.classList.toggle('mfd-fb-counter-active', shown !== total || mode !== 'default');
        }
        grid.innerHTML = list.map(e => MF_renderVariationCard(e.v, 0, variations, heroUpId, summary)).join('') || `
            <div class="mfd-fb-empty-state">
                <div class="mfd-fb-empty-icon">${MF_ICONS.info}</div>
                <div class="mfd-fb-empty-title">Nenhuma variação corresponde</div>
                <div class="mfd-fb-empty-hint">Tente desmarcar "Só com problemas" ou trocar a ordenação.</div>
            </div>`;
    };
    sortSel.addEventListener('change', apply);
    filterCk.addEventListener('change', apply);
}

function MF_renderVariationCard(v, idx, allVariations, heroUpId, familySummary) {
    const s = v.summary || {};
    const ident = [s.color, s.size].filter(Boolean).join(' · ') || s.sku || s.title || v.up_id;
    const diag = MF_analyzeVariationProblems(v, allVariations || []);
    const isHero = heroUpId && v.up_id === heroUpId;
    const status = s.status || '—';
    const statusClass = status === 'active' ? 'pos' : status === 'paused' ? 'warn' : 'neg';
    const statusLabel = { active: 'Ativo', paused: 'Pausado', closed: 'Fechado', under_review: 'Em revisão' }[status] || status;

    // Score qualidade
    let qualityChip = '';
    const qScore = v.quality?.performance_score ?? v.quality?.score;
    if (typeof qScore === 'number') {
        const pct = Math.round(qScore <= 1 ? qScore * 100 : qScore);
        const cls = pct >= 70 ? 'pos' : pct >= 40 ? 'warn' : 'neg';
        qualityChip = `<span class="mfd-tag-chip ${cls}" title="Pontuação de desempenho">${MF_ICONS.bolt}<span>Qualidade ${pct}</span></span>`;
    }
    // Experiência compra
    let peChip = '';
    const peLevel = v.purchase_experience?.level || v.purchase_experience?.global_level;
    const peScore = v.purchase_experience?.score ?? v.purchase_experience?.global_score;
    if (peLevel || typeof peScore === 'number') {
        const cls = peLevel === 'green' || (peScore !== null && peScore >= 4) ? 'pos'
                  : peLevel === 'yellow' || (peScore !== null && peScore >= 3) ? 'warn'
                  : 'neg';
        const label = peLevel ? ({ green: 'Compra boa', yellow: 'Compra média', red: 'Compra ruim' }[peLevel] || peLevel)
                              : `Exp. ${peScore.toFixed(1)}`;
        peChip = `<span class="mfd-tag-chip ${cls}" title="Experiência de compra">${MF_ICONS.cart}<span>${escapeHtml(label)}</span></span>`;
    }

    const priceTxt = (typeof s.price === 'number') ? `R$ ${s.price.toFixed(2).replace('.', ',')}` : '';
    const stockTxt = (typeof s.available_quantity === 'number') ? `${s.available_quantity}` : '';
    const stockClass = (typeof s.available_quantity === 'number' && s.available_quantity <= 1) ? 'mfd-stock-low' : '';

    const heroBadge = isHero ? `<span class="mfd-fb-hero-badge" title="Variação com melhor combinação de qualidade, estoque e ausência de problemas">${MF_ICONS.star}<span>Destaque</span></span>` : '';

    // Comparison bars — só se múltiplas variações + dados disponíveis na família
    let compareHtml = '';
    if (familySummary && Array.isArray(allVariations) && allVariations.length > 1) {
        const bars = [];
        // Estoque na família: este vs maior do conjunto
        if (typeof s.available_quantity === 'number' && familySummary.maxStock > 0) {
            const pct = Math.max(0, Math.min(100, (s.available_quantity / familySummary.maxStock) * 100));
            const sharePct = familySummary.totalStock > 0
                ? Math.round((s.available_quantity / familySummary.totalStock) * 100) : 0;
            const cls = s.available_quantity <= 1 ? 'neg' : s.available_quantity >= familySummary.maxStock ? 'pos' : 'neutral';
            bars.push(`
                <div class="mfd-fb-cmp-row" title="${s.available_quantity} unidade${s.available_quantity === 1 ? '' : 's'} — ${sharePct}% do estoque total da família (${familySummary.totalStock})">
                    <span class="mfd-fb-cmp-label">${MF_ICONS.box}<span>Estoque</span></span>
                    <span class="mfd-fb-cmp-bar"><span class="mfd-fb-cmp-fill ${cls}" style="width:${pct.toFixed(1)}%"></span></span>
                    <span class="mfd-fb-cmp-value">${sharePct}%</span>
                </div>`);
        }
        // Posição no range de preço da família
        if (typeof s.price === 'number'
            && familySummary.minPrice !== null && familySummary.maxPrice !== null
            && familySummary.maxPrice > familySummary.minPrice) {
            const range = familySummary.maxPrice - familySummary.minPrice;
            const pct = Math.max(0, Math.min(100, ((s.price - familySummary.minPrice) / range) * 100));
            const labelPos = s.price === familySummary.minPrice ? 'menor' : s.price === familySummary.maxPrice ? 'maior' : `${Math.round(pct)}%`;
            bars.push(`
                <div class="mfd-fb-cmp-row" title="R$ ${s.price.toFixed(2).replace('.', ',')} entre R$ ${familySummary.minPrice.toFixed(2).replace('.', ',')} e R$ ${familySummary.maxPrice.toFixed(2).replace('.', ',')} da família">
                    <span class="mfd-fb-cmp-label">${MF_ICONS.money}<span>Preço</span></span>
                    <span class="mfd-fb-cmp-scale">
                        <span class="mfd-fb-cmp-scale-track"></span>
                        <span class="mfd-fb-cmp-scale-dot" style="left:${pct.toFixed(1)}%"></span>
                    </span>
                    <span class="mfd-fb-cmp-value">${labelPos}</span>
                </div>`);
        }
        // Score qualidade comparado ao alvo 70
        if (typeof qScore === 'number') {
            const pct = Math.round(qScore <= 1 ? qScore * 100 : qScore);
            const cls = pct >= 70 ? 'pos' : pct >= 40 ? 'warn' : 'neg';
            bars.push(`
                <div class="mfd-fb-cmp-row" title="Pontuação de qualidade ${pct} (alvo ≥70)">
                    <span class="mfd-fb-cmp-label">${MF_ICONS.bolt}<span>Qualidade</span></span>
                    <span class="mfd-fb-cmp-bar"><span class="mfd-fb-cmp-fill ${cls}" style="width:${Math.max(2, pct)}%"></span><span class="mfd-fb-cmp-target" style="left:70%" title="alvo 70"></span></span>
                    <span class="mfd-fb-cmp-value">${pct}</span>
                </div>`);
        }
        // Vendas acumuladas (sold_quantity total) — comparação com a maior da família
        if (typeof s.sold_quantity === 'number'
            && familySummary.maxSold > 0
            && familySummary.soldDataPoints > 1) {
            const pct = Math.max(0, Math.min(100, (s.sold_quantity / familySummary.maxSold) * 100));
            const sharePct = familySummary.totalSold > 0
                ? Math.round((s.sold_quantity / familySummary.totalSold) * 100) : 0;
            const cls = s.sold_quantity === familySummary.maxSold && familySummary.maxSold > 0 ? 'pos'
                      : s.sold_quantity === 0 ? 'neg'
                      : 'neutral';
            bars.push(`
                <div class="mfd-fb-cmp-row" title="${s.sold_quantity} venda${s.sold_quantity === 1 ? '' : 's'} acumuladas — ${sharePct}% das vendas da família (${familySummary.totalSold} total)">
                    <span class="mfd-fb-cmp-label">${MF_ICONS.cart}<span>Vendas</span></span>
                    <span class="mfd-fb-cmp-bar"><span class="mfd-fb-cmp-fill ${cls}" style="width:${pct.toFixed(1)}%"></span></span>
                    <span class="mfd-fb-cmp-value">${sharePct}%</span>
                </div>`);
        }
        if (bars.length) compareHtml = `<div class="mfd-fb-cmp">${bars.join('')}</div>`;
    }

    return `
        <div class="mfd-fb-var-card${isHero ? ' is-hero' : ''}" data-up-id="${escapeHtml(v.up_id || '')}" data-item-id="${escapeHtml(v.item_id || '')}">
            ${heroBadge}
            <div class="mfd-fb-var-head">
                <div class="mfd-fb-var-thumb">
                    ${s.thumbnail ? `<img src="${escapeHtml(s.thumbnail)}" alt="" loading="lazy" />` : ''}
                </div>
                <div class="mfd-fb-var-body">
                    <div class="mfd-fb-var-titlerow">
                        <span class="mfd-fb-var-ident">${escapeHtml(ident)}</span>
                        <span class="mfd-tag-chip ${statusClass} mfd-status-chip">${escapeHtml(statusLabel)}</span>
                    </div>
                    ${s.sku ? `<div class="mfd-fb-var-sku">${escapeHtml(s.sku)}</div>` : ''}
                    <div class="mfd-fb-var-stats">
                        ${priceTxt ? `<span class="mfd-fb-stat"><span class="mfd-fb-stat-label">Preço</span><span class="mfd-fb-stat-value">${priceTxt}</span></span>` : ''}
                        ${stockTxt ? `<span class="mfd-fb-stat ${stockClass}"><span class="mfd-fb-stat-label">Estoque</span><span class="mfd-fb-stat-value">${stockTxt}</span></span>` : ''}
                    </div>
                </div>
                <div class="mfd-fb-var-actions">
                    <button onclick="window.MF_expandVariation('${escapeHtml(v.up_id || '')}')" class="mfd-fb-expand-btn" title="Editar campos desta variação">
                        <span class="mfd-fb-expand-text">Editar</span>
                        <svg class="mfd-fb-expand-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                    ${s.permalink ? `<a href="${escapeHtml(s.permalink)}" target="_blank" rel="noopener" class="mfd-fb-link-btn" title="Abrir no Mercado Livre">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </a>` : ''}
                </div>
            </div>
            <div class="mfd-fb-var-chips">
                ${qualityChip}
                ${peChip}
                ${MF_renderTagsBadges(v.tags)}
            </div>
            ${compareHtml}
            ${diag.problems.length ? `<div class="mfd-fb-var-problems" title="${escapeHtml(diag.problems.map(p => p.label + (p.detail ? ': ' + p.detail : '')).join(' • '))}">
                <span class="mfd-fb-prob-count">${diag.problems.length} problema${diag.problems.length > 1 ? 's' : ''} detectado${diag.problems.length > 1 ? 's' : ''}</span>
                ${diag.problems.slice(0, 3).map(p => `<span class="mfd-fb-prob-chip ${p.sev}">${p.icon} ${escapeHtml(p.label)}</span>`).join('')}
                ${diag.problems.length > 3 ? `<span class="mfd-fb-prob-more">+${diag.problems.length - 3}</span>` : ''}
            </div>` : ''}
        </div>`;
}

window.MF_expandVariation = function (upId) {
    const ov = window.__mfFamilyOverview;
    if (!ov) return;
    const variation = ov.variations.find(v => v.up_id === upId);
    if (!variation) return;

    const card = document.querySelector(`.mfd-fb-var-card[data-up-id="${upId}"]`);
    if (!card) return;

    // Toggle: se já tem painel expandido, colapsa
    let panel = card.querySelector('.mfd-fb-var-edit-panel');
    if (panel) {
        panel.remove();
        card.classList.remove('is-expanded');
        return;
    }

    panel = document.createElement('div');
    panel.className = 'mfd-fb-var-edit-panel';
    panel.innerHTML = MF_renderVariationEditPanel(variation);
    card.appendChild(panel);
    card.classList.add('is-expanded');
    // Iter 9 — smooth scroll mais suave (block 'start' c/ offset evita ficar colado no topo)
    setTimeout(() => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        card.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }, 80);
};

// Essa variação já tem valor gravado no atributo? (versão por-variação do mfAtributoPreenchido)
function MF_renderVariationEditPanel(variation) {
    const cats = window.currentAnalysisState?.categoryAttributes || [];
    const itemAttrs = Array.isArray(variation.item_attributes) ? variation.item_attributes : [];
    const itemAttrMap = new Map(itemAttrs.map(a => [a.id, a]));
    const allVariations = window.__mfFamilyOverview?.variations || [];

    // Filtra atributos da categoria que são editáveis por variação. CHILD_PK ficou fora da
    // lista de hierarquias em 09/08/2026: é o valor dele que dá nome à variação, então
    // mexer aqui muda o título, muda o permalink e o anúncio recomeça o histórico do zero
    // (mesma régua do mfMotivoNaoEditavel — motivo 'nomevariacao').
    const EDITABLE_TYPES = new Set(['string', 'list', 'boolean', 'number', 'number_unit']);
    const editable = cats.filter(c =>
        EDITABLE_TYPES.has(c.value_type)
        && !c.tags?.read_only
        && MF_VARIATION_EDITABLE_HIERARCHIES.has(c.hierarchy)
        && !MF_ATTRS_DA_ASSINATURA.has(c.id)
    );

    // Diagnóstico — usa o mesmo analisador do cartão
    const diag = MF_analyzeVariationProblems(variation, allVariations);
    const diagHtml = diag.problems.length
        ? `<div class="mfd-fb-diag">
            <div class="mfd-fb-diag-title">🩺 Diagnóstico desta variação</div>
            <ul class="mfd-fb-diag-list">
                ${diag.problems.map(p => `<li class="mfd-fb-diag-item ${p.sev}">
                    <span class="mfd-fb-diag-icon">${p.icon}</span>
                    <span class="mfd-fb-diag-label">${escapeHtml(p.label)}</span>
                    ${p.detail ? `<span class="mfd-fb-diag-detail">${escapeHtml(p.detail)}</span>` : ''}
                </li>`).join('')}
            </ul>
        </div>`
        : `<div class="mfd-fb-diag ok">
            <div class="mfd-fb-diag-title">✓ Sem problemas detectados</div>
        </div>`;

    const fieldsHtml = editable.map(c => MF_renderVariationField(c, itemAttrMap.get(c.id), variation.item_id)).join('');
    const healthHtml = MF_renderVariationHealthDetail(variation);
    const peHtml = MF_renderPurchaseExpDetail(variation);

    return `
        <div class="mfd-fb-edit-panel-inner">
            ${diagHtml}
            ${healthHtml}
            ${peHtml}
            <div class="mfd-fb-edit-fields-title">Editar campos por variação</div>
            <div class="mfd-fb-edit-fields">${fieldsHtml || '<span class="mfd-fb-empty">Nenhum campo editável por variação nesta categoria.</span>'}</div>
        </div>`;
}

// Iter 8 — purchase experience detalhado.
// /reputation/items/{id}/purchase_experience/integrators retorna estrutura com level, score, e
// vários campos de breakdown (metrics, items, historic, level_wording, level_status, etc).
// Como o shape varia por categoria/região, renderiza defensivamente: campos primários sempre,
// breakdown opcional se presente.
function MF_renderPurchaseExpDetail(variation) {
    const pe = variation.purchase_experience;
    if (!pe || typeof pe !== 'object') return '';
    const level = (pe.level || pe.global_level || '').toLowerCase();
    const score = typeof pe.score === 'number' ? pe.score
                : typeof pe.global_score === 'number' ? pe.global_score : null;
    const wording = pe.level_wording || pe.level_status || pe.label || '';
    if (!level && score === null) return '';

    const cls = level === 'green' || (score !== null && score >= 4) ? 'pos'
              : level === 'yellow' || (score !== null && score >= 3) ? 'warn'
              : 'neg';
    const levelLabel = level
        ? ({ green: 'Boa', yellow: 'Média', red: 'Ruim' }[level] || level)
        : '';
    const headerChip = `<span class="mfd-tag-chip ${cls}" title="Experiência de compra reportada pelo ML">${MF_ICONS.cart}<span>${levelLabel}${score !== null ? ` · ${score.toFixed(1)}` : ''}</span></span>`;

    // Metrics: ML às vezes retorna { metrics: [{ id, title, status, value }] } ou { items: [...] }.
    // Tenta ambos antes de desistir.
    const rawMetrics = Array.isArray(pe.metrics) ? pe.metrics
                     : Array.isArray(pe.items) ? pe.items
                     : Array.isArray(pe.indicators) ? pe.indicators
                     : null;
    const metrics = rawMetrics
        ? rawMetrics.map(m => ({
            title: m.title || m.name || m.label || m.id || '',
            status: (m.status || m.level || '').toString().toLowerCase(),
            value: m.value ?? m.score ?? null,
            target: m.target ?? null,
            description: m.description || m.wording || m.tooltip || '',
        })).filter(m => m.title)
        : [];

    const metricsHtml = metrics.length
        ? `<ul class="mfd-fb-pe-list">
            ${metrics.slice(0, 12).map(m => {
                const sCls = /good|green|completed|ok|pos/i.test(m.status) ? 'pos'
                           : /regular|yellow|warn|partial/i.test(m.status) ? 'warn'
                           : /bad|red|fail|neg/i.test(m.status) ? 'neg'
                           : 'info';
                const icon = sCls === 'pos' ? MF_ICONS.check
                           : sCls === 'neg' ? MF_ICONS.warn
                           : sCls === 'warn' ? MF_ICONS.warn
                           : MF_ICONS.info;
                const valueTxt = m.value !== null && m.value !== undefined ? `${typeof m.value === 'number' ? m.value : escapeHtml(String(m.value))}${m.target !== null && m.target !== undefined ? ` / ${m.target}` : ''}` : '';
                return `<li class="mfd-fb-pe-item ${sCls}">
                    <span class="mfd-fb-pe-icon">${icon}</span>
                    <span class="mfd-fb-pe-title">${escapeHtml(m.title)}</span>
                    ${valueTxt ? `<span class="mfd-fb-pe-value">${valueTxt}</span>` : ''}
                    ${m.description ? `<span class="mfd-fb-pe-desc">${escapeHtml(String(m.description).slice(0, 120))}</span>` : ''}
                </li>`;
            }).join('')}
            ${metrics.length > 12 ? `<li class="mfd-fb-pe-more">+${metrics.length - 12} métrica${metrics.length - 12 > 1 ? 's' : ''}…</li>` : ''}
        </ul>`
        : '';

    return `
        <div class="mfd-fb-pe">
            <div class="mfd-fb-pe-header">
                <span class="mfd-fb-pe-headline">Experiência de compra</span>
                ${headerChip}
            </div>
            ${wording ? `<div class="mfd-fb-pe-wording">${escapeHtml(wording)}</div>` : ''}
            ${metricsHtml || (level && !metrics.length ? `<div class="mfd-fb-pe-empty">ML não retornou breakdown desta variação — só o nível agregado.</div>` : '')}
        </div>`;
}

// Iter 7 — health indicators detalhados do /item/{id}/performance.
// Reusa extractMLQualityItems pra parsear buckets/variables/rules → pendentes + completados.
function MF_renderVariationHealthDetail(variation) {
    const q = variation.quality;
    if (!q) return '';
    const ml = (typeof extractMLQualityItems === 'function') ? extractMLQualityItems(q) : null;
    if (!ml) return '';
    const score = ml.score;
    const level = (ml.level || '').toLowerCase();
    const levelLabel = ml.level_wording || (level ? ({ good: 'Boa', regular: 'Regular', bad: 'Ruim' }[level] || level) : '');
    const cls = level === 'good' ? 'pos' : level === 'regular' ? 'warn' : 'neg';
    const pending = Array.isArray(ml.pending) ? ml.pending : [];
    const completed = Array.isArray(ml.completed) ? ml.completed : [];

    // Agrupa pendentes por bucket pra densidade visual
    const grouped = {};
    for (const p of pending) {
        const k = p.bucket || 'Outros';
        (grouped[k] = grouped[k] || []).push(p);
    }
    const bucketsHtml = Object.keys(grouped).map(b => `
        <div class="mfd-fb-health-bucket">
            <div class="mfd-fb-health-bucket-title">${escapeHtml(b)}</div>
            <ul class="mfd-fb-health-list">
                ${grouped[b].slice(0, 8).map(p => {
                    const link = p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" rel="noopener" class="mfd-fb-health-link" title="Abrir no Mercado Livre">${MF_ICONS.info}</a>` : '';
                    const lbl = p.label ? `<span class="mfd-fb-health-tag">${escapeHtml(p.label)}</span>` : '';
                    return `<li class="mfd-fb-health-item">
                        <span class="mfd-fb-health-icon">${MF_ICONS.warn}</span>
                        <span class="mfd-fb-health-text">${escapeHtml(p.text || 'Item pendente')}</span>
                        ${lbl}
                        ${link}
                    </li>`;
                }).join('')}
                ${grouped[b].length > 8 ? `<li class="mfd-fb-health-more">+${grouped[b].length - 8} pendente${grouped[b].length - 8 > 1 ? 's' : ''}…</li>` : ''}
            </ul>
        </div>
    `).join('');

    const completedSummary = completed.length
        ? `<div class="mfd-fb-health-completed">${MF_ICONS.check}<span>${completed.length} item${completed.length > 1 ? 's' : ''} já completado${completed.length > 1 ? 's' : ''} pelo ML</span></div>`
        : '';

    if (!pending.length && !completed.length && (score === 0 || score === undefined)) return '';

    return `
        <div class="mfd-fb-health">
            <div class="mfd-fb-health-header">
                <span class="mfd-fb-health-title">Saúde do anúncio (ML)</span>
                <span class="mfd-tag-chip ${cls}" title="Pontuação reportada pelo ML">${MF_ICONS.bolt}<span>Pontuação ${score}${levelLabel ? ` · ${levelLabel}` : ''}</span></span>
            </div>
            ${pending.length ? `<div class="mfd-fb-health-buckets">${bucketsHtml}</div>` : '<div class="mfd-fb-health-allgood">✓ Tudo OK do lado do ML</div>'}
            ${completedSummary}
        </div>`;
}

function MF_renderVariationField(catAttr, currentAttr, itemId) {
    const id = catAttr.id;
    const name = catAttr.name || id;
    const valueType = catAttr.value_type;
    const allowedValues = Array.isArray(catAttr.values) ? catAttr.values : null;
    const currentValueId = currentAttr?.value_id || (currentAttr?.values?.[0]?.id) || '';
    const currentValueName = currentAttr?.value_name || (Array.isArray(currentAttr?.values) ? currentAttr.values.map(v => v.name).filter(Boolean).join(', ') : '') || '';
    const inputId = `mf-var-${itemId}-${id}`;
    const errorId = `mf-var-err-${itemId}-${id}`;

    let inputHtml;
    if (valueType === 'list' && allowedValues && allowedValues.length) {
        inputHtml = `<select id="${inputId}" class="mfd-fb-input">
            <option value="">— selecione —</option>
            ${allowedValues.map(v => `<option value="${escapeHtml(v.id)}" data-name="${escapeHtml(v.name)}" ${String(v.id) === String(currentValueId) ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
        </select>`;
    } else if (valueType === 'boolean') {
        const sel = String(currentValueName).toLowerCase();
        inputHtml = `<select id="${inputId}" class="mfd-fb-input">
            <option value="">—</option>
            <option value="Sim" ${sel === 'sim' ? 'selected' : ''}>Sim</option>
            <option value="Não" ${sel === 'não' || sel === 'nao' ? 'selected' : ''}>Não</option>
        </select>`;
    } else {
        const ph = MF_getAttrPlaceholder(catAttr) || '';
        inputHtml = `<input type="text" id="${inputId}" class="mfd-fb-input" value="${escapeHtml(currentValueName)}" placeholder="${escapeHtml(ph)}" />`;
    }

    // Mesmo double check da ficha: aqui o campo é inline, então o alerta é uma linha
    // vermelha acima do input e o ✓ vira texto — ninguém renomeia no automático.
    // O título vem do overview da família: sem ele mfMudaOLink não consegue afirmar nada e
    // cai no conservador (avisa), que é o lado certo pra errar.
    const _tituloVariacao = (window.__mfFamilyOverview?.variations || [])
        .find(v => v.item_id === itemId)?.summary?.title;
    const renomeia = mfMudaOLink(catAttr, {
        user_product_id: 'familia',
        title: _tituloVariacao,
        attributes: currentAttr ? [currentAttr] : []
    });
    const salvar = `window.MF_saveVariationAttr('${escapeHtml(itemId)}', '${escapeHtml(id)}', '${inputId}', '${errorId}')`;
    return `
        <div class="mfd-fb-edit-field${renomeia ? ' mf-var-perigo' : ''}">
            <label for="${inputId}" class="mfd-fb-edit-label">${escapeHtml(name)}</label>
            ${renomeia ? '<div class="mf-alerta-inline">⚠️ Renomear troca o link do anúncio e ele perde a exposição — aqui ou no Mercado Livre.</div>' : ''}
            ${inputHtml}
            <button onclick="${salvar}" class="mfd-fb-save-btn${renomeia ? ' mf-btn-renomear' : ''}" title="${renomeia ? 'Renomear mesmo assim' : 'Salvar'}">${renomeia ? 'Renomear mesmo assim' : '✓'}</button>
            <div id="${errorId}" class="mfd-fb-edit-error" style="display:none;"></div>
        </div>`;
}

window.MF_saveVariationAttr = async function (itemId, attrId, inputId, errorId) {
    const state = window.currentAnalysisState;
    const token = state?.accessToken || window._adsAccessToken;
    const input = document.getElementById(inputId);
    const errEl = document.getElementById(errorId);
    const showError = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
    const clearError = () => { if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; } };
    if (!input || !token || !itemId) return showError('Sessão expirada — recarregue a página.');
    clearError();

    const cats = state?.categoryAttributes || [];
    const catAttr = cats.find(c => c.id === attrId);

    // Campo que não pode ser mexido não deve nem sair daqui: o painel já não oferece,
    // mas se algum caminho renderizar o botão, a régua barra antes da requisição.
    const variacaoAtual = (window.__mfFamilyOverview?.variations || []).find(v => v.item_id === itemId);
    const motivoBloqueio = mfMotivoNaoEditavel(catAttr, {
        user_product_id: variacaoAtual?.up_id || 'familia',
        attributes: variacaoAtual?.item_attributes || []
    });
    if (motivoBloqueio) return showError(MF_textoCampoBloqueado(catAttr, motivoBloqueio));

    let attrPayload;
    if (input.tagName === 'SELECT') {
        const opt = input.options[input.selectedIndex];
        if (!opt || !opt.value) return showError(`Selecione uma opção para "${catAttr?.name || attrId}".`);
        attrPayload = { id: attrId, value_id: opt.value, value_name: opt.dataset.name || opt.textContent.trim() };
    } else {
        const raw = (input.value || '').trim();
        const validation = MF_validateAttrInput(catAttr, raw);
        if (!validation.ok) return showError(validation.error);
        const val = validation.cleanedValue || raw;
        if (validation.autoCleaned) input.value = val;
        const exact = Array.isArray(catAttr?.values) ? catAttr.values.find(v => String(v.name||'').toLowerCase() === val.toLowerCase()) : null;
        attrPayload = exact ? { id: attrId, value_id: exact.id, value_name: exact.name } : { id: attrId, value_name: val };
    }

    const btn = input.parentElement.querySelector('.mfd-fb-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
        const res = await fetch(`${BASE_URL_PROXY}/api/fetch-item-update?item_id=${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(mfRenomeiaVariacao(catAttr, {
                user_product_id: variacaoAtual?.up_id || 'familia',
                attributes: variacaoAtual?.item_attributes || []
            })
                ? { attributes: [attrPayload], confirm_rename_variation: true }
                : { attributes: [attrPayload] }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = MF_translateMlError(err, catAttr) || err.error || `Erro ${res.status}`;
            return showError(msg);
        }
        const updated = await res.json();
        const partialErr = MF_translateProxyPartialError(updated, catAttr);
        if (partialErr) return showError(partialErr);
        // Sucesso — feedback rápido
        if (btn) { btn.textContent = '✓'; btn.style.background = 'var(--green, #10b981)'; setTimeout(() => { btn.style.background = ''; }, 1500); }
        // Atualiza o overview cacheado
        const ov = window.__mfFamilyOverview;
        if (ov) {
            const variation = ov.variations.find(v => v.item_id === itemId);
            if (variation) {
                const arr = (variation.item_attributes = variation.item_attributes || []);
                const idx = arr.findIndex(a => a.id === attrId);
                if (idx >= 0) arr[idx] = { ...arr[idx], ...attrPayload };
                else arr.push(attrPayload);
            }
        }
    } catch (e) {
        showError(e.message || 'Falha de rede');
    } finally {
        if (btn) btn.disabled = false;
    }
};

function exibirAtributosCategoria(categoryAttributes, adAttributes, containerId = "categoryAttributes") {
    const el = document.getElementById(containerId);
    if (!el) return;

    let contentHtml = '';
    // Include string, list, boolean, number, number_unit — skip only read_only
    const EDITABLE_TYPES = new Set(['string', 'list', 'boolean', 'number', 'number_unit']);
    const stringAttributes = Array.isArray(categoryAttributes) ? categoryAttributes.filter(attr => EDITABLE_TYPES.has(attr.value_type) && !attr.tags?.read_only) : [];

    if (!Array.isArray(categoryAttributes) || stringAttributes.length === 0) {
        // Hide completely if no relevant attributes to show, or show message
        contentHtml = '<p class="text-small">Sem campos adicionais sugeridos para esta categoria.</p>';
    } else {
        const adAttributesMap = new Map(adAttributes.map(attr => [attr.id, attr.value_name]));

        // Sort: Faltando first
        stringAttributes.sort((a, b) => {
            const valA = adAttributesMap.get(a.id);
            const valB = adAttributesMap.get(b.id);
            const filledA = valA && valA.trim() !== '';
            const filledB = valB && valB.trim() !== '';
            return filledA === filledB ? 0 : (filledA ? 1 : -1);
        });

        // Se anúncio tem variações, atributos gerenciados por variação (Cor/Tamanho/SKU/etc)
        // não são editáveis no campo geral — escondemos da lista e mostramos uma nota informativa
        // com link direto pra editar variações no ML.
        const detail = window.currentAnalysisState?.detail;
        const hasVariations = Array.isArray(detail?.variations) && detail.variations.length > 0;
        const variationAttrs = [];

        const missingAttrs = [];
        const filledAttrs = [];
        const isInFamily = !!detail?.user_product_id;
        stringAttributes.forEach(catAttr => {
            const adValue = adAttributesMap.get(catAttr.id);
            const isFilled = adValue && adValue.trim() !== '';
            // Uma régua só, a mesma da pontuação: campo sem caminho de edição não vira tarefa
            const motivo = mfMotivoNaoEditavel(catAttr, detail);
            if (motivo === 'variacao') {
                variationAttrs.push({ catAttr, adValue });
            } else if (motivo) {
                // sistema/família: sai da conta; aparece na nota de rodapé com o motivo
                return;
            } else if (isFilled) {
                filledAttrs.push({ catAttr, adValue });
            } else {
                missingAttrs.push({ catAttr, adValue });
            }
        });

        const renderCatItem = (catAttr, adValue, isFilled) => {
            const isIgnored = window.ignoredAdAttributes.has(catAttr.id);
            // Rede de segurança: campo "só no ML" (PARENT_PK, ou CHILD_PK que dá nome à
            // variação) já sai no filtro acima e não chega aqui. Se um dia chegar por outro
            // caminho, renderiza sem lápis em vez de oferecer uma edição que estraga o anúncio.
            // Atributo `hierarchy: FAMILY` NÃO entra aqui: grava pelo item sem mexer no
            // family_id (medido em conta real) — mesma régua do mfMotivoNaoEditavel.
            const isFamilyControlled = mfSoNoML(catAttr, detail);
            const canEdit = !isIgnored && !catAttr.tags?.read_only && !isFamilyControlled;
            const pencilSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>`;
            return `
             <div class="attribute-item" style="min-width:0; ${!isFilled ? 'background:var(--red-light); border-color:var(--red);' : 'background:var(--green-light); border-color:var(--green);'} ${isIgnored ? 'opacity: 0.5; filter: grayscale(1);' : ''}">
                <div id="attr-edit-wrapper-${catAttr.id}" style="flex-grow: 1; min-width:0; overflow:hidden;">
                    <span class="text-label" style="margin-bottom:2px;">${catAttr.name}${catAttr.tags?.hidden ? ` <span title="O Mercado Livre não mostra este campo no formulário de publicação — a maioria dos concorrentes deixa em branco." style="font-size:0.62rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--blue); border:1px solid #c9dcff; border-radius:4px; padding:0 5px; margin-left:6px; cursor:help; white-space:nowrap;">campo extra</span>` : ''}</span>
                    ${isFilled ? `<span class="text-value" style="word-break:break-word; ${isIgnored ? 'text-decoration: line-through;' : ''}">${adValue}</span>` : '<span class="text-small" style="color:var(--red);">Não preenchido</span>'}
                </div>
                <div style="display:flex; align-items:center; gap: 6px; flex-shrink:0;">
                    ${isFilled && !isIgnored ? '<span style="color:var(--green); font-weight:bold;">✔</span>' : (!isIgnored ? '<span class="status-badge error" style="flex-shrink:0;">Faltando</span>' : '<span style="color:gray; font-size:0.8rem;">Ignorado</span>')}
                    ${canEdit ? `<button onclick="window.openAttrEditor('${catAttr.id}')" title="Editar valor" class="btn-edit-clean" style="padding:2px;">${pencilSvg}</button>` : ''}
                    <button onclick="window.toggleIgnoreAttribute('${catAttr.id}', 'ad')" title="${isIgnored ? 'Incluir na pontuação' : 'Desconsiderar da pontuação'}" class="btn-ignore-clean ${isIgnored ? 'ignored' : ''}" style="padding:2px;">
                        ${isIgnored ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`}
                    </button>
                </div>
            </div>`;
        };

        // Duas etapas: primeiro o que o ML EXIGE, depois os extras. O vendedor resolve
        // os obrigatórios e só então investe tempo nos opcionais — e a nota só cobra
        // o que ele consegue mexer (mfCampoEditavel).
        // Régua de obrigatoriedade: a da ML quando ela diz, a da categoria quando não diz.
        const _obrigatoriosML = mfObrigatoriosDoML(window.currentAnalysisState?.qualidadeFichaData);
        const obrigatorio = (x) => mfCampoObrigatorio(x.catAttr, _obrigatoriosML);
        const grupos = {
            obrFalta: missingAttrs.filter(obrigatorio),
            obrOk: filledAttrs.filter(obrigatorio),
            extraFalta: missingAttrs.filter((x) => !obrigatorio(x)),
            extraOk: filledAttrs.filter((x) => !obrigatorio(x))
        };
        const listar = (arr, preenchido, vazio) => arr.length
            ? arr.map(({ catAttr, adValue }) => renderCatItem(catAttr, adValue, preenchido)).join('')
            : `<p class="text-small" style="color:${preenchido ? 'var(--text-muted)' : 'var(--green)'};">${vazio}</p>`;

        const etapa = (titulo, faltando, preenchidos, cor) => `
            <div style="margin-bottom:16px;">
                <div style="display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                    <span style="font-weight:600; font-size:0.92rem; color:${cor};">${titulo}</span>
                    <span class="text-small" style="color:var(--text-muted);">${preenchidos.length}/${faltando.length + preenchidos.length}</span>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                    <div>
                        <div class="specs-group-title problem" style="margin-bottom:8px;">⚠️ Faltando (${faltando.length})</div>
                        ${listar(faltando, false, 'Nenhum faltando 🎉')}
                    </div>
                    <div>
                        <div class="specs-group-title valid" style="margin-bottom:8px;">✅ Preenchidos (${preenchidos.length})</div>
                        ${listar(preenchidos, true, '—')}
                    </div>
                </div>
            </div>`;

        const etapasHtml =
            etapa('Obrigatórios', grupos.obrFalta, grupos.obrOk, 'var(--red-dark,#b91c1c)') +
            etapa('Extras', grupos.extraFalta, grupos.extraOk, 'var(--blue)');

        // O que ficou de fora vira UMA linha discreta — os nomes ficam no tooltip,
        // pra quem quiser conferir, sem virar parede de texto na tela.
        // Campo que o vendedor não mexe simplesmente não aparece aqui. A explicação
        // ficava numa linha solta que só confundia (Lucas, 05/08) — quando o campo
        // importa de verdade (o ML pede na ficha), ele aparece marcado lá, na seção
        // "Ficha Técnica (visão do Mercado Livre)".
        const notaForaDaConta = '';

        // Banner informativo pros atributos gerenciados por variação
        let variationBanner = '';
        if (variationAttrs.length > 0) {
            const itemId = detail?.id || '';
            const editUrl = itemId ? `https://www.mercadolivre.com.br/anuncios/${itemId}/modificar/variantes` : '';
            const names = variationAttrs.map(v => v.catAttr.name).join(', ');
            variationBanner = `
                <div style="background:var(--yellow-light); border:1px solid var(--yellow); padding:10px 12px; border-radius:6px; margin-bottom:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <span style="font-size:1rem;">🎨</span>
                    <div style="flex:1; min-width:200px;">
                        <div style="font-size:0.82rem; color:var(--text); font-weight:500;">${variationAttrs.length} ${variationAttrs.length === 1 ? 'campo' : 'campos'} gerenciado${variationAttrs.length === 1 ? '' : 's'} por variação</div>
                        <div style="font-size:0.75rem; color:var(--text-secondary);">${names} — esse anúncio tem ${detail.variations.length} variações. Edite na página do anúncio no Mercado Livre.</div>
                    </div>
                    ${editUrl ? `<a href="${editUrl}" target="_blank" rel="noopener" style="text-decoration:none; padding:6px 12px; background:var(--blue); color:white; border-radius:4px; font-size:0.78rem; white-space:nowrap;">Abrir variações no ML →</a>` : ''}
                </div>`;
        }

        contentHtml = `
            ${variationBanner}
            ${etapasHtml}
            ${notaForaDaConta}`;
    }

    // "N campos" no cabeçalho = o que realmente conta (o mesmo conjunto da nota)
    const detalheAtual = window.currentAnalysisState?.detail;
    const totalItems = Array.isArray(categoryAttributes)
        ? categoryAttributes.filter(a => mfCampoEditavel(a, detalheAtual)).length
        : 0;

    // Botão "Editar todas as variações" — só aparece se item está em família ML.
    // O modal abre carregando o overview agregado (tags/quality/experience por variação).
    const upIdForFamily = window.currentAnalysisState?.detail?.user_product_id || null;
    const familyEditorButton = upIdForFamily
        ? `<button onclick="window.MF_openFamilyBatchEditor('${upIdForFamily}')" class="mfd-family-edit-btn" style="margin-left:8px; padding:4px 10px; background:var(--blue); color:white; border:none; border-radius:4px; font-size:0.78rem; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Ver e editar todas as variações deste anúncio em família">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Variações
        </button>`
        : '';

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.25s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📂</span>
                <span class="ana-card-title">Campos da Categoria</span>
                ${familyEditorButton}
                <span class="text-small" style="margin-left:auto; color:var(--text-muted);">${totalItems} campos</span>
            </div>
            ${contentHtml}
        </div>
    `;
}

function exibirInformacaoGarantia(detail, containerId = "warrantyInfo") {
    const el = document.getElementById(containerId);
    if (!el) return;
    const temGarantia = getWarrantyText(detail);
    const badgeClass = temGarantia ? 'success' : 'error';
    const icon = temGarantia ? '✅' : '❌';
    const text = temGarantia ? 'Informada' : 'Ausente';

    el.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius);">
            <span style="font-weight:600; font-size:0.9rem;"><span style="margin-right:6px;">🛡️</span> Garantia</span>
            <span class="status-badge ${badgeClass}">${icon} ${text}</span>
        </div>
    `;
}

// performanceData saiu da assinatura em 10/08/2026: as recomendações da ML Quality API
// ficam SÓ no card "O que Melhorar" (exibirPontuacao). Antes apareciam nos dois — aqui as
// 3 primeiras como "Prioridades ML", lá a lista inteira —, então as 3 primeiras saíam
// duas vezes na mesma tela, mesmo texto e ícone diferente. Só duplicava em anúncio ativo
// com pendência, daí parecer "em algumas contas": em pausado e em catálogo a /performance
// não responde e as duas seções somem juntas. Este card é sobre descrição, garantia e
// imagens — recomendação do ML nunca foi dele.
function exibirChecklistRapido(detail, descriptionData, containerId = "quickChecklist") {
    const el = document.getElementById(containerId);
    if (!el) return;

    // 3 sanity checks básicos (descrição, garantia, imagens) — SEMPRE renderizados
    const hasDesc = !!(descriptionData && ((descriptionData.plain_text && descriptionData.plain_text.trim()) || (descriptionData.text && descriptionData.text.trim())));
    const descSource = descriptionData?.source;
    const descSourceLabel = descSource === 'catalog' ? 'Herdada do catálogo' : (descSource === 'user_product' ? 'Herdada do produto (MLBU)' : 'Detectada');
    const warrantyText = getWarrantyText(detail);
    const hasWarranty = !!warrantyText;

    // Count images per variation (min 3 each)
    let imageDetail = '';
    let imageOk = true;
    const variations = detail?.variations || [];
    if (variations.length > 0) {
        const varProblems = [];
        variations.forEach((v, i) => {
            const picCount = v.picture_ids ? v.picture_ids.length : 0;
            const label = v.attribute_combinations ? v.attribute_combinations.map(a => a.value_name).join('/') : `Variação ${i+1}`;
            if (picCount < 3) {
                varProblems.push(`${label}: ${picCount} foto${picCount !== 1 ? 's' : ''}`);
                imageOk = false;
            }
        });
        const totalPics = detail?.pictures?.length || 0;
        if (varProblems.length > 0) {
            imageDetail = `${totalPics} fotos total — ${varProblems.length} variação(ões) com menos de 3: ${varProblems.join('; ')}`;
        } else {
            imageDetail = `${totalPics} fotos total — todas as ${variations.length} variações com 3+ fotos`;
        }
    } else {
        const imageCount = detail?.pictures?.length || 0;
        imageOk = imageCount >= 3;
        imageDetail = imageOk ? `${imageCount} fotos` : `Mínimo 3 fotos (tem ${imageCount})`;
    }

    // `source` só aparece quando o ITEM não tem descrição própria e a gente foi buscar a
    // herdada. Ou seja: descrição herdada É o caso que este botão resolve — o rótulo muda
    // de "Editar" para "Escrever a sua" porque são coisas diferentes pro vendedor.
    const descHerdada = hasDesc && !!descSource;

    /*
     * ATALHOS DE 1 CLIQUE (Lucas, 13/08/2026) — "só pra ele não precisar escolher".
     *
     * A régua saiu da frase que fechou o assunto: "descrição se não tiver preenchida ainda
     * pode gravar direto". Vale para os dois botões — o atalho grava sozinho apenas onde
     * NÃO há trabalho do vendedor em risco. Campo vazio não tem o que destruir; campo
     * preenchido (inclusive descrição HERDADA, que já aparece no anúncio) volta a pedir
     * a passagem pela tela.
     *
     * O padrão de garantia vem do proxy em `state.garantiaPadrao`: `undefined` = ainda não
     * perguntamos, `null` = a categoria não aceita o nosso padrão, objeto = pode oferecer.
     * Qual é o nosso padrão não se decide aqui.
     */
    const padraoGar = window.currentAnalysisState && window.currentAnalysisState.garantiaPadrao;
    const items = [
        {
            chave: 'descricao',
            ok: hasDesc,
            label: 'Descrição em texto',
            detail: hasDesc ? descSourceLabel : 'Não preenchida',
            acao: hasDesc ? (descHerdada ? 'Escrever a sua' : 'Editar') : 'Escrever descrição',
            acaoRapida: hasDesc ? null : { rotulo: 'Escrever com IA', fn: 'mfDescricaoIAUmClique' },
        },
        {
            chave: 'garantia',
            ok: hasWarranty,
            label: 'Garantia',
            detail: hasWarranty ? warrantyText : 'Não informada',
            acao: hasWarranty ? 'Alterar' : 'Informar garantia',
            acaoRapida: (!hasWarranty && padraoGar)
                ? { rotulo: `Usar ${padraoGar.rotulo || 'o padrão'}`, fn: 'mfGarantiaPadraoUmClique' }
                : null,
        },
        // Imagem tem tela própria (o redimensionador) — botão aqui só levaria a lugar nenhum.
        { chave: 'imagens', ok: imageOk, label: `Imagens${variations.length > 0 ? ` (${variations.length} variações)` : ''}`, detail: imageDetail },
    ];

    // A linha é CLASSE, não estilo inline: com os dois atalhos de 13/08 ela passou a ter
    // dois botões de rótulo comprido, e em 375px eles saíam 145px pra fora do card — que
    // tem overflow escondido, ou seja, o botão manual sumia sem deixar rastro. Media query
    // não alcança estilo inline (foi o mesmo tropeço do grid de métricas em 08/08).
    const renderItem = (item) => `
        <div class="mf-chk-linha${item.ok ? ' mf-chk-ok' : ''}">
            <span style="font-size:1.1rem; flex-shrink:0;">${item.ok ? '✅' : '❌'}</span>
            <div class="mf-chk-texto">
                <span style="font-weight:600; font-size:0.88rem; color:var(--text);">${item.label}</span>
                <span class="text-small" style="display:block; margin-top:1px;">${item.detail}</span>
            </div>
            ${item.acaoRapida ? `<button type="button" class="mf-conteudo-botao mf-conteudo-botao-rapido" id="mf-rapido-${item.chave}" onclick="window.${item.acaoRapida.fn}()">${item.acaoRapida.rotulo}</button>` : ''}
            ${item.acao ? `<button type="button" class="mf-conteudo-botao" onclick="window.mfAbrirEditorConteudo('${item.chave}')">${item.acao}</button>` : ''}
        </div>
        ${item.acao ? `<div id="mf-rapido-erro-${item.chave}" class="mf-conteudo-erro" style="display:none;"></div>` : ''}
        ${item.acao ? `<div id="mf-editor-${item.chave}" class="mf-conteudo-editor" style="display:none;"></div>` : ''}`;


    el.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">✅</span>
                <span class="ana-card-title">Checklist Rápido</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${items.map(renderItem).join('')}
            </div>
        </div>
    `;

    // Só perguntamos o padrão quando ele teria uso: anúncio SEM garantia. Anúncio que já
    // tem não gasta chamada nenhuma. A resposta redesenha este card quando chega.
    if (!hasWarranty) MF_carregaPadraoGarantia(window.currentAnalysisState);
}

/* =========================================================================
   Descrição e garantia: resolver pela tela (12/08/2026, pedido do Lucas de 11/08)

   Até aqui o Checklist só apontava "Não preenchida" e "Não informada". Diagnóstico sem
   caminho de saída é o tipo de tela que o vendedor lê, concorda e fecha.

   Onde mora cada coisa:
   - O que vale como descrição (a ML só aceita texto simples) e o que é uma garantia
     válida são decisões do PROXY. Daqui sai o que o vendedor digitou; a recusa volta
     pronta, com a posição do problema, e esta tela só desenha.
   - Garantia é `sale_terms` (WARRANTY_TYPE + WARRANTY_TIME), nunca `attributes`.

   Vale para o ANÚNCIO ABERTO, não para a família (decisão do Lucas em 12/08): salvar aqui
   não mexe nos irmãos de variação, e a tela diz isso em vez de deixar o vendedor supor.
   ========================================================================= */

// Qual editor está aberto. Um por vez: dois campos grandes abertos ao mesmo tempo empurram
// a página e o vendedor perde de vista o que estava fazendo.
window.MF_editorAberto = null;

function MF_ehFamilia(detail) {
    return !!(detail && detail.family_id);
}

/** Texto atual da descrição — inclusive a herdada, que serve de ponto de partida. */
function MF_descricaoAtual(state) {
    const d = state && state.descriptionData;
    if (!d) return '';
    return String(d.plain_text || d.text || '').trim();
}

/** Lê a garantia gravada e devolve as partes, pra reabrir o editor no que já está lá. */
function MF_garantiaAtual(detail) {
    const termos = Array.isArray(detail && detail.sale_terms) ? detail.sale_terms : [];
    const tipoNome = (termos.find((t) => t && t.id === 'WARRANTY_TYPE') || {}).value_name || '';
    const prazo = (termos.find((t) => t && t.id === 'WARRANTY_TIME') || {}).value_name || '';
    const tipo = /fábrica|fabrica/i.test(tipoNome) ? 'fabrica'
        : (/sem garantia/i.test(tipoNome) ? 'sem' : (tipoNome ? 'vendedor' : ''));
    const m = String(prazo).match(/^(\d+)\s*(dia|dias|m[êe]s|meses|ano|anos)$/i);
    const unidade = m ? ({ dia: 'dias', dias: 'dias', mes: 'meses', 'mês': 'meses', meses: 'meses', ano: 'anos', anos: 'anos' })[m[2].toLowerCase()] : '';
    return { tipo, tempo: m ? m[1] : '', unidade: unidade || 'meses', prazoLiteral: prazo };
}

window.mfFecharEditorConteudo = function () {
    const anterior = window.MF_editorAberto;
    window.MF_editorAberto = null;
    if (!anterior) return;
    const el = document.getElementById(`mf-editor-${anterior}`);
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
};

window.mfAbrirEditorConteudo = function (qual) {
    const state = window.currentAnalysisState;
    if (!state) return;
    if (window.MF_editorAberto === qual) return window.mfFecharEditorConteudo();
    window.mfFecharEditorConteudo();

    const el = document.getElementById(`mf-editor-${qual}`);
    if (!el) return;
    window.MF_editorAberto = qual;
    el.style.display = 'block';
    el.innerHTML = qual === 'descricao' ? MF_editorDescricaoHtml(state) : MF_editorGarantiaHtml(state);

    if (qual === 'descricao') {
        const ta = document.getElementById('mf-desc-input');
        if (ta) {
            ta.focus();
            ta.addEventListener('input', () => MF_atualizaContadorDescricao());
            MF_atualizaContadorDescricao();
        }
    } else {
        MF_ligaEditorGarantia();
        MF_carregarValoresGarantia(state);
    }
};

function MF_avisoFamiliaHtml(detail) {
    if (!MF_ehFamilia(detail)) return '';
    return `<div class="mf-conteudo-aviso">Vale só para este anúncio. As outras variações do grupo seguem com o que já tinham.</div>`;
}

function MF_editorDescricaoHtml(state) {
    const atual = MF_descricaoAtual(state);
    const herdada = !!(state.descriptionData && state.descriptionData.source);
    const origem = herdada
        ? `<div class="mf-conteudo-aviso">O texto abaixo veio ${state.descriptionData.source === 'catalog' ? 'da ficha do catálogo' : 'do seu produto (MLBU)'}. Salvando, ele passa a ser a descrição deste anúncio.</div>`
        : '';
    return `
        <div class="mf-conteudo-box">
            ${origem}
            ${MF_avisoFamiliaHtml(state.detail)}
            <textarea id="mf-desc-input" class="mf-conteudo-textarea" rows="9"
                placeholder="Conte o que o comprador ainda não sabe: medidas, material, o que vem na caixa, como usar.">${escapeHtml(atual)}</textarea>
            <div class="mf-conteudo-rodape">
                <span id="mf-desc-contador" class="text-small"></span>
                <div class="mf-conteudo-acoes">
                    <button type="button" class="mf-btn-secundario" onclick="window.mfSugerirDescricao()" id="mf-desc-sugerir">Sugerir com IA</button>
                    <button type="button" class="mf-btn-secundario" onclick="window.mfFecharEditorConteudo()">Cancelar</button>
                    <button type="button" class="mf-btn-primario" onclick="window.mfSalvarDescricao()" id="mf-desc-salvar">Salvar descrição</button>
                </div>
            </div>
            <div id="mf-desc-erro" class="mf-conteudo-erro" style="display:none;"></div>
            <div class="mf-conteudo-dica">O Mercado Livre aceita só texto simples aqui — sem emoji e sem HTML.</div>
        </div>`;
}

function MF_atualizaContadorDescricao() {
    const ta = document.getElementById('mf-desc-input');
    const cont = document.getElementById('mf-desc-contador');
    if (!ta || !cont) return;
    const n = (ta.value || '').trim().length;
    const loc = (window.MF_getSiteConfig && window.MF_currentSiteId)
        ? window.MF_getSiteConfig(window.MF_currentSiteId()).locale : 'pt-BR';
    // Placar honesto: diz onde está, sem inventar meta. O piso de 400 é o que a sugestão
    // da IA persegue; abaixo disso o texto costuma não responder nada ao comprador.
    cont.textContent = n === 0 ? 'Nada escrito ainda'
        : (n < 400 ? `${n.toLocaleString(loc)} caracteres — dá pra detalhar mais` : `${n.toLocaleString(loc)} caracteres`);
    cont.style.color = n > 0 && n < 400 ? 'var(--text-muted)' : 'var(--text-secondary)';
}

function MF_erroConteudo(id, msg, extraHtml = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `${escapeHtml(msg)}${extraHtml}`;
    el.style.display = 'block';
}

window.mfSalvarDescricao = async function () {
    const state = window.currentAnalysisState;
    const ta = document.getElementById('mf-desc-input');
    const btn = document.getElementById('mf-desc-salvar');
    const erroEl = document.getElementById('mf-desc-erro');
    if (!state || !ta) return;
    if (erroEl) { erroEl.style.display = 'none'; erroEl.innerHTML = ''; }

    const texto = (ta.value || '').trim();
    if (!texto) return MF_erroConteudo('mf-desc-erro', 'Escreva a descrição antes de salvar.');

    const itemId = state.detail && state.detail.id;
    const token = state.accessToken || window._adsAccessToken;
    if (!itemId || !token) return MF_erroConteudo('mf-desc-erro', 'Sessão expirada. Recarregue a página.');

    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    try {
        const res = await fetch(`${API_DESCRICAO_ENDPOINT}?item_id=${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ plain_text: texto }),
        });
        const dados = await res.json().catch(() => ({}));
        if (!res.ok) {
            // O proxy manda o texto sem emoji junto da recusa: em vez de mandar o vendedor
            // procurar o caractere no meio de mil, a tela oferece o ajuste em um clique.
            const oferta = dados.texto_limpo
                ? ` <button type="button" class="mf-link-acao" onclick="window.mfAplicarTextoLimpo()">Tirar e continuar</button>`
                : '';
            if (dados.texto_limpo) window.MF_textoLimpoSugerido = dados.texto_limpo;
            return MF_erroConteudo('mf-desc-erro', dados.error || `Não deu para salvar (erro ${res.status}).`, oferta);
        }

        // Passou a ser descrição PRÓPRIA do anúncio: o `source` da herdada sai junto, senão
        // o checklist continuaria dizendo "Herdada do catálogo" depois de salvar.
        state.descriptionData = { plain_text: dados.plain_text || texto, text: dados.plain_text || texto };
        window.mfFecharEditorConteudo();
        MF_reRenderConteudo(state);
    } catch (e) {
        MF_erroConteudo('mf-desc-erro', e.message || 'Falha de rede.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Salvar descrição'; }
    }
};

window.mfAplicarTextoLimpo = function () {
    const ta = document.getElementById('mf-desc-input');
    if (!ta || !window.MF_textoLimpoSugerido) return;
    ta.value = window.MF_textoLimpoSugerido;
    window.MF_textoLimpoSugerido = null;
    const erroEl = document.getElementById('mf-desc-erro');
    if (erroEl) { erroEl.style.display = 'none'; erroEl.innerHTML = ''; }
    MF_atualizaContadorDescricao();
    ta.focus();
};

window.mfSugerirDescricao = async function () {
    const state = window.currentAnalysisState;
    const ta = document.getElementById('mf-desc-input');
    const btn = document.getElementById('mf-desc-sugerir');
    if (!state || !ta) return;

    // Texto escrito não é sobrescrito sem aviso: a sugestão é ajuda, não substituição.
    if ((ta.value || '').trim() && !window.confirm('Isto substitui o texto que está no campo. Continuar?')) return;

    const detail = state.detail || {};
    const atributos = (detail.attributes || [])
        .filter((a) => a && a.value_name && a.name)
        .map((a) => ({ name: a.name, value: a.value_name }));

    if (btn) { btn.disabled = true; btn.textContent = 'Escrevendo…'; }
    try {
        let uid = state.userId;
        if (!uid) { uid = await fetchUserIdForScraping(); if (uid) state.userId = uid; }
        if (!uid) return MF_erroConteudo('mf-desc-erro', 'Sessão expirada. Recarregue a página.');

        const res = await fetch(API_GPT_DESCRICAO_ENDPOINT, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${uid}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: detail.title || '',
                categoria: (state.categoryName || ''),
                atributos,
                garantia: getWarrantyText(detail) || '',
                site_id: (typeof window.MF_currentSiteId === 'function' ? window.MF_currentSiteId() : 'MLB'),
            }),
        });
        const dados = await res.json().catch(() => ({}));
        if (!res.ok) return MF_erroConteudo('mf-desc-erro', dados.error || 'Não foi possível gerar a sugestão agora.');

        ta.value = dados.plain_text || '';
        MF_atualizaContadorDescricao();
        ta.focus();
        // Nada foi pro Mercado Livre: o texto está no campo e quem salva é o vendedor.
        MF_erroConteudo('mf-desc-erro', 'Sugestão pronta no campo. Leia, ajuste o que quiser e salve — nada foi enviado ainda.');
        const el = document.getElementById('mf-desc-erro');
        if (el) el.className = 'mf-conteudo-erro mf-conteudo-info';
    } catch (e) {
        MF_erroConteudo('mf-desc-erro', e.message || 'Falha de rede.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sugerir com IA'; }
    }
};

/* -------------------------------------------------------------------------
   Atalhos de 1 clique (Lucas, 13/08/2026)

   Os dois gravam direto, e só existem onde o campo está VAZIO — a régua que ele deu:
   "descrição se não tiver preenchida ainda pode gravar direto". Onde há texto do vendedor
   (ou garantia já escolhida), o caminho continua sendo o editor.

   Nenhum dos dois inventa conteúdo: o padrão da garantia vem do proxy e o texto da
   descrição vem da IA pelo proxy. Aqui só se aperta o botão.
   ------------------------------------------------------------------------- */

/** Erro do atalho aparece na própria linha do checklist, onde o vendedor está olhando. */
function MF_erroAtalho(chave, msg) {
    const el = document.getElementById(`mf-rapido-erro-${chave}`);
    if (!el) return;
    el.style.display = 'block';
    el.textContent = msg;
}

/**
 * Busca o padrão de garantia da categoria e, se existir, redesenha o checklist com o botão.
 * `state.garantiaPadrao` fica `null` quando a categoria não aceita — e `null` é resposta,
 * não "ainda não perguntei", então não repetimos a chamada.
 */
/**
 * Cache por CATEGORIA: quem varre a conta analisa vários anúncios da mesma categoria em
 * sequência, e o que cada uma aceita não muda no meio da sessão. Sem isso, o atalho
 * custaria uma chamada por anúncio aberto.
 */
window.MF_padraoGarantiaPorCategoria = window.MF_padraoGarantiaPorCategoria || {};

async function MF_carregaPadraoGarantia(state) {
    if (!state || state.garantiaPadrao !== undefined) return;
    // O checklist é redesenhado a cada salvamento; sem a trava de "em voo", duas
    // renderizações antes da resposta viram duas chamadas pro proxy.
    if (state._garantiaPadraoEmVoo) return;
    const cat = state.detail && state.detail.category_id;
    const token = state.accessToken || window._adsAccessToken;
    if (!cat || !token) return;

    if (Object.prototype.hasOwnProperty.call(window.MF_padraoGarantiaPorCategoria, cat)) {
        state.garantiaPadrao = window.MF_padraoGarantiaPorCategoria[cat];
        if (state.garantiaPadrao) MF_reRenderConteudo(state);
        return;
    }

    state._garantiaPadraoEmVoo = true;
    try {
        const res = await fetch(`${API_GARANTIA_VALORES_ENDPOINT}/${encodeURIComponent(cat)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const dados = await res.json().catch(() => ({}));
        // Proxy antigo (sem o campo) não pode virar "categoria não aceita": sem resposta
        // sobre o padrão, o certo é não oferecer atalho E não fingir que perguntamos.
        if (!res.ok || !Object.prototype.hasOwnProperty.call(dados, 'padrao_sugerido')) return;
        state.garantiaPadrao = dados.padrao_sugerido || null;
        window.MF_padraoGarantiaPorCategoria[cat] = state.garantiaPadrao;
        if (state.garantiaPadrao) MF_reRenderConteudo(state);
    } catch (_) {
        // Silencioso de propósito: é oferta de atalho, não diagnóstico. O caminho manual
        // está na tela do lado.
    } finally {
        state._garantiaPadraoEmVoo = false;
    }
}

window.mfGarantiaPadraoUmClique = async function () {
    const state = window.currentAnalysisState;
    const padrao = state && state.garantiaPadrao;
    if (!state || !padrao) return;

    const btn = document.getElementById('mf-rapido-garantia');
    const itemId = state.detail && state.detail.id;
    const token = state.accessToken || window._adsAccessToken;
    if (!itemId || !token) return MF_erroAtalho('garantia', 'Sessão expirada. Recarregue a página.');

    if (btn) { btn.disabled = true; btn.textContent = 'Gravando…'; }
    try {
        // O corpo é o que o PROXY mandou, repassado inteiro. Montar aqui um "vendedor/7/dias"
        // por conta própria seria a regra de negócio voltando pro front pela porta dos fundos
        // — e quebraria a categoria de lista fechada, que precisa de valor_literal.
        const corpo = padrao.valor_literal
            ? { tipo: padrao.tipo, valor_literal: padrao.valor_literal }
            : { tipo: padrao.tipo, tempo: padrao.tempo, unidade: padrao.unidade };
        const res = await fetch(`${API_GARANTIA_ENDPOINT}?item_id=${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
        });
        const dados = await res.json().catch(() => ({}));
        if (!res.ok) return MF_erroAtalho('garantia', dados.error || `Não deu para gravar (erro ${res.status}).`);

        // O state acompanha o que foi gravado: um "❌ Não informada" que sobrevive ao
        // próprio salvamento faz o vendedor gravar de novo.
        const gravados = Array.isArray(dados.sale_terms) ? dados.sale_terms : [];
        const outros = (state.detail.sale_terms || []).filter((t) => t && t.id !== 'WARRANTY_TYPE' && t.id !== 'WARRANTY_TIME');
        state.detail.sale_terms = outros.concat(gravados.length ? gravados : [
            { id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' },
            { id: 'WARRANTY_TIME', value_name: padrao.valor_literal || `${padrao.tempo} ${padrao.unidade}` },
        ]);
        // Campo LEGADO: `getWarrantyText` prefere ele, e a tela mostraria a garantia velha
        // logo depois de gravar a nova.
        state.detail.warranty = null;
        MF_reRenderConteudo(state);
    } catch (e) {
        MF_erroAtalho('garantia', e.message || 'Falha de rede.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = `Usar ${padrao.rotulo || 'o padrão'}`; }
    }
};

window.mfDescricaoIAUmClique = async function () {
    const state = window.currentAnalysisState;
    if (!state) return;

    const btn = document.getElementById('mf-rapido-descricao');
    const detail = state.detail || {};
    const itemId = detail.id;
    const token = state.accessToken || window._adsAccessToken;
    if (!itemId || !token) return MF_erroAtalho('descricao', 'Sessão expirada. Recarregue a página.');

    if (btn) { btn.disabled = true; btn.textContent = 'Escrevendo…'; }
    try {
        let uid = state.userId;
        if (!uid) { uid = await fetchUserIdForScraping(); if (uid) state.userId = uid; }
        if (!uid) return MF_erroAtalho('descricao', 'Sessão expirada. Recarregue a página.');

        const atributos = (detail.attributes || [])
            .filter((a) => a && a.value_name && a.name)
            .map((a) => ({ name: a.name, value: a.value_name }));

        const gerada = await fetch(API_GPT_DESCRICAO_ENDPOINT, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${uid}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: detail.title || '',
                categoria: (state.categoryName || ''),
                atributos,
                garantia: getWarrantyText(detail) || '',
                site_id: (typeof window.MF_currentSiteId === 'function' ? window.MF_currentSiteId() : 'MLB'),
            }),
        });
        const dadosIA = await gerada.json().catch(() => ({}));
        if (!gerada.ok) return MF_erroAtalho('descricao', dadosIA.error || 'A IA não respondeu agora. Tente de novo em instantes.');

        const texto = String(dadosIA.plain_text || '').trim();
        // IA sem conteúdo NÃO vira gravação. Descrição vazia no ML é pior que descrição
        // faltando: some o diagnóstico e o vendedor acha que resolveu.
        if (!texto) {
            if (btn) { btn.textContent = 'Escrever com IA'; }
            return MF_erroAtalho('descricao', 'A IA não devolveu texto desta vez. Tente de novo, ou escreva pelo botão ao lado.');
        }

        if (btn) btn.textContent = 'Gravando…';
        const res = await fetch(`${API_DESCRICAO_ENDPOINT}?item_id=${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ plain_text: texto }),
        });
        const dados = await res.json().catch(() => ({}));
        if (!res.ok) {
            // Aqui o "Tirar e continuar" do editor não serve: não há campo aberto pra
            // aplicar o texto limpo. Mandamos pro editor com o texto já dentro.
            window.MF_textoIAPendente = texto;
            return MF_erroAtalho('descricao', `${dados.error || `Não deu para gravar (erro ${res.status}).`} Abra "Escrever descrição" para ajustar o texto.`);
        }

        state.descriptionData = { plain_text: dados.plain_text || texto, text: dados.plain_text || texto };
        MF_reRenderConteudo(state);
    } catch (e) {
        MF_erroAtalho('descricao', e.message || 'Falha de rede.');
    } finally {
        if (btn) { btn.disabled = false; if (btn.textContent !== 'Escrever com IA') btn.textContent = 'Escrever com IA'; }
    }
};

function MF_editorGarantiaHtml(state) {
    const atual = MF_garantiaAtual(state.detail);
    const opt = (v, rotulo, sel) => `<option value="${v}"${sel === v ? ' selected' : ''}>${rotulo}</option>`;
    return `
        <div class="mf-conteudo-box">
            ${MF_avisoFamiliaHtml(state.detail)}
            <div class="mf-garantia-linha">
                <label class="mf-conteudo-label">Tipo
                    <select id="mf-gar-tipo" class="mf-conteudo-select">
                        ${opt('vendedor', 'Garantia do vendedor', atual.tipo || 'vendedor')}
                        ${opt('fabrica', 'Garantia de fábrica', atual.tipo)}
                        ${opt('sem', 'Sem garantia', atual.tipo)}
                    </select>
                </label>
                <label class="mf-conteudo-label" id="mf-gar-prazo-campo">Prazo
                    <span class="mf-garantia-prazo">
                        <input type="number" id="mf-gar-tempo" class="mf-conteudo-input" min="1" step="1" value="${escapeHtml(atual.tempo || '')}" placeholder="3" inputmode="numeric" />
                        <select id="mf-gar-unidade" class="mf-conteudo-select">
                            ${opt('dias', 'dias', atual.unidade)}
                            ${opt('meses', 'meses', atual.unidade)}
                            ${opt('anos', 'anos', atual.unidade)}
                        </select>
                    </span>
                </label>
            </div>
            <div id="mf-gar-fechada" style="display:none;"></div>
            <div class="mf-conteudo-rodape">
                <span id="mf-gar-fonte" class="text-small"></span>
                <div class="mf-conteudo-acoes">
                    <button type="button" class="mf-btn-secundario" onclick="window.mfFecharEditorConteudo()">Cancelar</button>
                    <button type="button" class="mf-btn-primario" onclick="window.mfSalvarGarantia()" id="mf-gar-salvar">Salvar garantia</button>
                </div>
            </div>
            <div id="mf-gar-erro" class="mf-conteudo-erro" style="display:none;"></div>
        </div>`;
}

/** "Sem garantia" não tem prazo — o campo some em vez de ficar lá pedindo número à toa. */
function MF_ligaEditorGarantia() {
    const tipo = document.getElementById('mf-gar-tipo');
    const campo = document.getElementById('mf-gar-prazo-campo');
    if (!tipo || !campo) return;
    const ajusta = () => { campo.style.display = tipo.value === 'sem' ? 'none' : ''; };
    tipo.addEventListener('change', ajusta);
    ajusta();
}

/**
 * Pergunta ao proxy o que ESTA categoria aceita. É conveniência: se não vier, o vendedor
 * ainda escolhe tipo e prazo normalmente — por isso a falha aqui não mostra erro.
 */
async function MF_carregarValoresGarantia(state) {
    const catId = state.detail && state.detail.category_id;
    const token = state.accessToken || window._adsAccessToken;
    if (!catId || !token) return;
    try {
        const res = await fetch(`${API_GARANTIA_VALORES_ENDPOINT}/${encodeURIComponent(catId)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) return;
        const dados = await res.json();
        const fonteEl = document.getElementById('mf-gar-fonte');
        if (fonteEl && dados.obrigatoria) fonteEl.textContent = 'Esta categoria pede garantia.';

        // Categoria de lista fechada: o vendedor escolhe um prazo que a ML já publicou, em
        // vez de digitar um número que ela vai recusar depois.
        if (Array.isArray(dados.valores_fechados) && dados.valores_fechados.length) {
            const caixa = document.getElementById('mf-gar-fechada');
            const campoLivre = document.getElementById('mf-gar-prazo-campo');
            if (!caixa) return;
            caixa.style.display = 'block';
            caixa.innerHTML = `<label class="mf-conteudo-label">Prazo
                <select id="mf-gar-literal" class="mf-conteudo-select">
                    ${dados.valores_fechados.map((v) => `<option value="${escapeHtml(v.nome)}">${escapeHtml(v.nome)}</option>`).join('')}
                </select>
            </label>`;
            if (campoLivre) campoLivre.style.display = 'none';
        }
    } catch (e) { /* conveniência: sem lista, o editor segue funcionando */ }
}

window.mfSalvarGarantia = async function () {
    const state = window.currentAnalysisState;
    const btn = document.getElementById('mf-gar-salvar');
    const erroEl = document.getElementById('mf-gar-erro');
    if (!state) return;
    if (erroEl) { erroEl.style.display = 'none'; erroEl.innerHTML = ''; }

    const tipo = (document.getElementById('mf-gar-tipo') || {}).value || '';
    const literalEl = document.getElementById('mf-gar-literal');
    const corpo = literalEl && literalEl.value && tipo !== 'sem'
        ? { tipo, valor_literal: literalEl.value }
        : {
            tipo,
            tempo: Number((document.getElementById('mf-gar-tempo') || {}).value || 0),
            unidade: (document.getElementById('mf-gar-unidade') || {}).value || 'meses',
        };

    const itemId = state.detail && state.detail.id;
    const token = state.accessToken || window._adsAccessToken;
    if (!itemId || !token) return MF_erroConteudo('mf-gar-erro', 'Sessão expirada. Recarregue a página.');

    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    try {
        const res = await fetch(`${API_GARANTIA_ENDPOINT}?item_id=${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
        });
        const dados = await res.json().catch(() => ({}));
        if (!res.ok) return MF_erroConteudo('mf-gar-erro', dados.error || `Não deu para salvar (erro ${res.status}).`);

        // Espelha o que foi gravado.
        const outros = (state.detail.sale_terms || []).filter((t) => t && t.id !== 'WARRANTY_TYPE' && t.id !== 'WARRANTY_TIME');
        state.detail.sale_terms = outros.concat(dados.sale_terms || []);
        // `warranty` é o campo LEGADO e getWarrantyText prefere ele. Deixá-lo de pé faria a
        // tela mostrar a garantia velha logo depois de gravar a nova — o vendedor salvaria
        // de novo achando que não pegou. Quem manda agora é o sale_terms que acabou de ir.
        state.detail.warranty = null;
        window.mfFecharEditorConteudo();
        MF_reRenderConteudo(state);
    } catch (e) {
        MF_erroConteudo('mf-gar-erro', e.message || 'Falha de rede.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Salvar garantia'; }
    }
};

/** Redesenha o que depende de descrição e garantia — inclusive a nota, que muda com eles. */
function MF_reRenderConteudo(state) {
    // O checklist entrou no reRenderAnalysisView: chamar aqui também desenharia duas vezes.
    reRenderAnalysisView();
}

function verificarTags(tags, usedFallback = false, containerId = "tagsTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (usedFallback) {
        el.innerHTML = '<div class="ana-card"><p class="text-small">Análise de tags indisponível (Scraper).</p></div>';
        return;
    }
    if (!Array.isArray(tags) || tags.length === 0) {
        el.innerHTML = '<div class="ana-card"><p class="text-small">Nenhuma tag ativa encontrada.</p></div>';
        return;
    }

    const goodTags = [];
    const alertTags = [];
    const neutralTags = [];

    tags.forEach(tag => {
        const isAlertTag = TAGS_NEGATIVAS.has(tag);
        const isGoodTag = typeof tag === 'string' && (tag.toLowerCase().includes('good_quality') || tag === 'brand_verified');
        const significado = tagSignificados[tag] || null;
        const titleAttr = significado ? `title="${significado}"` : '';
        const displayName = tagSignificados[tag] || tag.replace(/_/g, ' ');
        const badge = `<span class="status-badge ${isAlertTag ? 'error' : (isGoodTag ? 'success' : 'muted')}" title="${tag}" style="cursor:help; font-size:0.72rem;">${displayName}</span>`;
        if (isAlertTag) alertTags.push(badge);
        else if (isGoodTag) goodTags.push(badge);
        else neutralTags.push(badge);
    });

    const renderCol = (title, icon, color, items) => {
        if (items.length === 0) return `<div><div style="font-size:0.78rem; font-weight:700; color:${color}; margin-bottom:8px;">${icon} ${title} (0)</div><div style="padding:12px; text-align:center; background:var(--row-alt); border-radius:var(--radius-sm); border:1px dashed var(--border);"><span class="text-small" style="color:var(--green);">✅ Tudo limpo!</span></div></div>`;
        return `
            <div>
                <div style="font-size:0.78rem; font-weight:700; color:${color}; margin-bottom:8px;">${icon} ${title} (${items.length})</div>
                <div style="display:flex; flex-wrap:wrap; gap:5px;">${items.join('')}</div>
            </div>`;
    };

    // Veredito ANTES do detalhe (Lucas, 12/08): quem abre a análise quer saber se tem
    // problema, não ler 14 etiquetas técnicas pra descobrir. A lista continua inteira —
    // atrás de um clique, pra quem quiser conferir.
    const problemas = alertTags.length;
    const tudoCerto = problemas === 0;
    const veredito = tudoCerto
        ? { icone: '✅', titulo: 'Tudo certo por aqui', cor: 'var(--green)', fundo: 'var(--green-light)',
            frase: 'O Mercado Livre não marcou nada que atrapalhe este anúncio.' }
        : { icone: '⚠️', titulo: `${problemas} ${problemas === 1 ? 'ponto de atenção' : 'pontos de atenção'}`,
            cor: 'var(--red)', fundo: 'var(--red-light)',
            frase: 'O Mercado Livre marcou este anúncio. Abra para ver o que é.' };

    el.innerHTML = `
         <div class="ana-card">
            <div class="ana-card-header" style="margin-bottom:10px;">
                <span class="ana-card-icon">🏷️</span>
                <span class="ana-card-title">Situação no Mercado Livre</span>
                <span class="text-small" style="margin-left:auto; color:var(--text-muted);">${tags.length} ${tags.length === 1 ? 'marcação' : 'marcações'}</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px; padding:12px 14px; background:${veredito.fundo}; border-left:3px solid ${veredito.cor}; border-radius:var(--radius-sm);">
                <span style="font-size:1.3rem; flex-shrink:0;">${veredito.icone}</span>
                <div style="flex:1; min-width:0;">
                    <span style="font-weight:700; font-size:0.9rem; color:var(--text);">${veredito.titulo}</span>
                    <span class="text-small" style="display:block; margin-top:1px;">${veredito.frase}</span>
                </div>
            </div>
            <details class="mf-tags-detalhe"${tudoCerto ? '' : ' open'}>
                <summary>Ver todas as marcações</summary>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:16px; margin-top:12px;">
                    ${renderCol('Boas Práticas', '✅', 'var(--green)', goodTags)}
                    ${renderCol('Atenção', '⚠️', 'var(--red)', alertTags)}
                    ${renderCol('Neutras', 'ℹ️', 'var(--text-muted)', neutralTags)}
                </div>
            </details>
        </div>
    `;
}

function exibirUpTags(tags, containerId = "upTagsTexto") {
    const el = document.getElementById(containerId);
    if (!el) return;
    let html = `<h4 class="section-title-underlined">Tags do Produto (UP)</h4>`;
    if (!Array.isArray(tags) || tags.length === 0) {
        html += `<p class="status-message" style="color: gray;">Nenhuma tag encontrada para este produto.</p>`;
        el.innerHTML = html; return;
    }
    let ulHtml = '<ul>';
    tags.forEach(tag => {
        ulHtml += `<li style="margin-bottom: 4px;"> ℹ️ <strong>${tag}</strong></li>`;
    });
    ulHtml += '</ul>';
    el.innerHTML = html + ulHtml;
}


function exibirPerformance(performanceData, containerId = "performanceTexto") {
    const perfEl = document.getElementById(containerId);
    if (!perfEl) return;

    // Falha NOSSA não pode virar recado da ML: dizer "eles não calcularam" quando quem não
    // conseguiu perguntar fomos nós manda o vendedor procurar problema no lugar errado.
    if (performanceData && performanceData._falhou) {
        perfEl.innerHTML = `
            <div class="ana-card" style="animation-delay: 0.3s;">
                <div class="ana-card-header"><span class="ana-card-icon">⚡</span><span class="ana-card-title">Qualidade do Anúncio (Mercado Livre)</span></div>
                <p class="text-small" style="color:var(--text-muted);">Não deu para consultar o Mercado Livre agora. O dado existe — só não chegou nesta tentativa.</p>
                <button type="button" class="mf-conteudo-botao" onclick="window.mfRecarregarQualidadeML()" style="align-self:flex-start; margin-top:8px;">Tentar de novo</button>
            </div>`;
        return;
    }
    if (!performanceData || typeof performanceData !== 'object' || !performanceData.buckets) {
        perfEl.innerHTML = `
            <div class="ana-card" style="animation-delay: 0.3s;">
                <div class="ana-card-header"><span class="ana-card-icon">⚡</span><span class="ana-card-title">Qualidade do Anúncio (Mercado Livre)</span></div>
                <p class="text-small" style="color:var(--text-muted);">Qualidade ainda não calculada pelo ML. Os anúncios ativos do marketplace têm esse dado atualizado periodicamente.</p>
            </div>`;
        return;
    }

    const score = Math.round(performanceData.score || 0);
    const level = (performanceData.level || '').toLowerCase();
    // Mapeamento nível → cor/label
    const levelMap = {
        excellent: { color: 'var(--green)', bg: 'var(--green-light)', label: 'Excelente' },
        good: { color: 'var(--blue)', bg: 'rgba(0,102,255,0.1)', label: 'Bom' },
        fair: { color: 'var(--yellow)', bg: 'var(--yellow-light)', label: 'Regular' },
        poor: { color: 'var(--red)', bg: 'var(--red-light)', label: 'Ruim' },
        basic: { color: 'var(--yellow)', bg: 'var(--yellow-light)', label: 'Básico' },
        standard: { color: 'var(--blue)', bg: 'rgba(0,102,255,0.1)', label: 'Padrão' },
        premium: { color: 'var(--green)', bg: 'var(--green-light)', label: 'Premium' }
    };
    const lvl = levelMap[level] || (
        score >= 75 ? levelMap.good : (score >= 50 ? levelMap.fair : levelMap.poor)
    );
    const levelLabel = performanceData.level_wording || lvl.label;

    const buckets = Array.isArray(performanceData.buckets) ? performanceData.buckets.filter(b => b && typeof b === 'object') : [];

    // Contadores globais de pending / opportunity / warning
    let totalPending = 0, totalWarning = 0, totalOpportunity = 0;
    buckets.forEach(b => {
        (b.variables || []).forEach(v => {
            if (v.status === 'PENDING') totalPending++;
            (v.rules || []).forEach(r => {
                if (r.status === 'PENDING') {
                    if (r.mode === 'WARNING') totalWarning++;
                    else totalOpportunity++;
                }
            });
        });
    });

    const renderRule = (r, fallbackColor) => {
        const mode = r.mode || 'OPPORTUNITY';
        const isWarn = mode === 'WARNING';
        const ruleColor = isWarn ? 'var(--red)' : fallbackColor;
        const icon = isWarn ? '⚠️' : '💡';
        const title = r.wordings?.title || r.key || '';
        const link = r.wordings?.link;
        const label = r.wordings?.label || 'Ver';
        const linkHtml = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="color:var(--blue); text-decoration:none; font-weight:600; font-size:0.78rem; white-space:nowrap;">${escapeHtml(label)} →</a>` : '';
        return `
            <div style="display:flex; gap:8px; align-items:flex-start; margin-top:6px; padding:8px 10px; background:var(--bg-subtle,#f8fafc); border-left:3px solid ${ruleColor}; border-radius:var(--radius-sm);">
                <span style="font-size:0.85rem;">${icon}</span>
                <div style="flex:1; min-width:0;">
                    <div class="text-small" style="color:var(--text); line-height:1.35;">${escapeHtml(title)}</div>
                </div>
                ${linkHtml}
            </div>`;
    };

    const resolvidosNoML = (window.currentAnalysisState && window.currentAnalysisState.resolvidosNoML) || new Set();

    const renderBucket = (bucket) => {
        const bScore = bucket.score !== undefined ? Math.round(bucket.score) : 0;
        const bLevel = bScore >= 85 ? 'good' : (bScore < 50 ? 'bad' : 'neutral');
        const color = bLevel === 'good' ? 'var(--green)' : (bLevel === 'bad' ? 'var(--red)' : 'var(--yellow)');
        const vars = Array.isArray(bucket.variables) ? bucket.variables : [];
        // Prioriza variáveis pendentes no topo
        vars.sort((a, b) => {
            const ap = a.status === 'PENDING' ? 0 : 1;
            const bp = b.status === 'PENDING' ? 0 : 1;
            return ap - bp;
        });
        let varsHtml = '';
        vars.forEach(v => {
            const vStatus = v.status || 'UNKNOWN';
            const isCompleted = vStatus === 'COMPLETED';
            const vColor = isCompleted ? 'var(--green)' : 'var(--yellow)';
            const icon = isCompleted ? '✓' : '○';
            const vScore = v.score !== undefined ? Math.round(v.score) : null;
            let rulesHtml = '';
            let acaoNaLinha = '';
            if (!isCompleted && Array.isArray(v.rules)) {
                const pendentes = v.rules.filter(r => r.status !== 'COMPLETED');
                // A ML manda MUITAS regras com o texto idêntico ao título da variável logo
                // acima — medido em 11/08/2026: 18 de 36 linhas em 11 anúncios, metade do
                // card. Desenhar as duas fazia a mesma frase sair duas vezes seguidas, que
                // é a "informação repetida" que os vendedores reclamaram.
                //
                // A regra ainda agrega uma coisa que a variável não tem: o LINK da ação.
                // Então some o texto duplicado, não a regra: o link sobe pra linha da
                // variável e a frase aparece uma vez só.
                const tituloVar = MF_chaveTexto(v.title || v.key || '');
                pendentes.forEach((r) => {
                    const tituloRegra = MF_chaveTexto((r.wordings && r.wordings.title) || r.key || '');
                    if (tituloRegra && tituloRegra === tituloVar) {
                        const link = r.wordings && r.wordings.link;
                        if (link && !acaoNaLinha) {
                            const rotulo = (r.wordings && r.wordings.label) || 'Resolver';
                            acaoNaLinha = `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="color:var(--blue); text-decoration:none; font-weight:600; font-size:0.75rem; white-space:nowrap;">${escapeHtml(rotulo)} →</a>`;
                        }
                        return;   // texto já está no título da variável
                    }
                    rulesHtml += renderRule(r, vColor);
                });
            }
            // "na visão do mercado livre ainda tem mensagem falando pra preencher no
            // mercado livre mesmo a gente já tendo ajustado os campos" (Lucas, 13/08).
            // Esta lista é a do CARREGAMENTO da página, e a /performance da ML atualiza
            // periodicamente — então a linha realmente continua lá depois de salvar.
            // Sumir com ela seria mentir na outra direção: não sabemos se a ML aceitou.
            // Fica, marcada, sem prometer prazo que não controlamos.
            const resolvidoAgora = !isCompleted && resolvidosNoML.has(v.key);
            const selo = resolvidoAgora
                ? `<div style="margin:6px 0 0 22px; padding:6px 9px; background:var(--blue-light); border-left:3px solid var(--blue); border-radius:4px; font-size:0.74rem; color:var(--text); line-height:1.35;">✏️ Você resolveu isso agora pelo app. O Mercado Livre leva um tempo para atualizar esta lista.</div>`
                : '';
            varsHtml += `
                <div style="padding:10px 0; border-bottom:1px solid var(--border,#e5e7eb);">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="color:${vColor}; font-weight:700; font-size:0.95rem;">${icon}</span>
                        <span style="flex:1; font-size:0.85rem; font-weight:600; color:var(--text);">${escapeHtml(v.title || v.key || '')}</span>
                        ${acaoNaLinha}
                        ${vScore !== null ? `<span style="font-family:var(--font-mono, 'DM Mono',monospace); font-size:0.75rem; color:${vColor}; font-weight:700;">${vScore}%</span>` : ''}
                    </div>
                    ${selo}
                    ${rulesHtml}
                </div>`;
        });
        return `
            <div style="border:1px solid var(--border,#e5e7eb); border-radius:var(--radius,8px); padding:14px 16px; border-top:3px solid ${color}; background:var(--bg-card,#fff);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-weight:700; font-size:0.92rem; color:var(--text);">${escapeHtml(bucket.title || bucket.key || '')}</span>
                    <span style="font-family:var(--font-mono, 'DM Mono',monospace); font-weight:700; font-size:1rem; color:${color};">${bScore}%</span>
                </div>
                ${varsHtml}
            </div>`;
    };

    const bucketsHtml = buckets.length > 0
        ? `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:14px; margin-top:14px;">${buckets.map(renderBucket).join('')}</div>`
        : '<p class="text-small" style="color:var(--text-muted);">Sem dados de diagnóstico por seção.</p>';

    // Header com score grande estilo trading — segue padrão dos outros cards
    const pendingBadge = totalPending > 0
        ? `<span style="background:${lvl.bg}; color:${lvl.color}; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">${totalPending} pendente${totalPending > 1 ? 's' : ''}</span>`
        : `<span style="background:var(--green-light); color:var(--green); padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">✓ Tudo em dia</span>`;

    const warnBadge = totalWarning > 0
        ? `<span style="background:var(--red-light); color:var(--red); padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700; margin-left:6px;">⚠ ${totalWarning} problema${totalWarning > 1 ? 's' : ''}</span>`
        : '';

    perfEl.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.3s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">⚡</span>
                <span class="ana-card-title">Qualidade do Anúncio (Mercado Livre)</span>
            </div>
            <div style="display:flex; align-items:center; gap:18px; padding:14px; background:linear-gradient(135deg, ${lvl.bg}, transparent); border-radius:var(--radius,8px); border:1px solid var(--border,#e5e7eb);">
                <div style="font-family:var(--font-mono, 'DM Mono',monospace); font-size:2.4rem; font-weight:800; color:${lvl.color}; line-height:1;">${score}<span style="font-size:1.2rem; color:var(--text-muted);">%</span></div>
                <div style="flex:1;">
                    <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:2px;">Nível atual</div>
                    <div style="font-weight:700; font-size:1.1rem; color:${lvl.color};">${escapeHtml(levelLabel)}</div>
                </div>
                <div style="text-align:right;">
                    ${pendingBadge}${warnBadge}
                    <div class="text-small" style="color:var(--text-muted); margin-top:6px; font-size:0.72rem;">Fonte: API Mercado Livre</div>
                </div>
            </div>
            ${bucketsHtml}
        </div>
    `;
}

// Exibe Experiência de Compra do Mercado Livre (API /reputation/items/{id}/purchase_experience/integrators)
/**
 * Moderação ativa do Mercado Livre — o anúncio está parado e o ML já diz o porquê.
 * Card em destaque: enquanto isso não for resolvido, nada mais na análise importa.
 * Só aparece quando existe moderação; sem ela o card não ocupa espaço nenhum.
 */
function exibirModeracao(moderacoes, containerId = "moderacaoAtiva") {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!Array.isArray(moderacoes) || !moderacoes.length) { el.innerHTML = ''; return; }

    const dataBr = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
    };
    const blocos = moderacoes.map((m) => {
        const quando = dataBr(m.data);
        const titulo = m.titulo || 'O Mercado Livre pausou este anúncio';
        return `
            <div style="padding:12px 14px; background:var(--red-light,#fff1f2); border-left:3px solid var(--red); border-radius:var(--radius-sm); margin-top:10px;">
                <div style="font-weight:600; color:var(--red-dark,#b91c1c); font-size:0.9rem;">${escapeHtml(titulo)}</div>
                ${m.motivo ? `<p class="text-small" style="margin:6px 0 0; color:var(--text); line-height:1.45;"><b>Motivo do ML:</b> ${escapeHtml(m.motivo)}</p>` : ''}
                ${m.solucao ? `<p class="text-small" style="margin:6px 0 0; color:var(--text); line-height:1.45;"><b>Como resolver:</b> ${escapeHtml(m.solucao)}</p>` : ''}
                ${quando ? `<p class="text-small" style="margin:6px 0 0; color:var(--text-muted);">Desde ${escapeHtml(quando)}</p>` : ''}
            </div>`;
    }).join('');

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.05s; border:1px solid var(--red);">
            <div class="ana-card-header">
                <span class="ana-card-icon">🚫</span>
                <span class="ana-card-title">Parado pelo Mercado Livre</span>
            </div>
            <p class="text-small" style="margin:0; color:var(--text-secondary);">Este anúncio está fora do ar até a correção abaixo ser feita. O texto é do próprio Mercado Livre.</p>
            ${blocos}
        </div>`;
}

/**
 * Ficha técnica pelos olhos do ML (catalog_quality): quais campos ELE considera
 * que faltam. Complementa — não substitui — a Ficha Técnica e os Campos da
 * Categoria que a análise já mostra: aqui é o veredito da plataforma, não o nosso.
 */
function exibirQualidadeFicha(qualidade, categoryAttributes, containerId = "qualidadeFicha") {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!qualidade) { el.innerHTML = ''; return; }

    // Tradução dos códigos com os atributos da categoria que a análise já buscou
    const nomes = {};
    (Array.isArray(categoryAttributes) ? categoryAttributes : []).forEach((a) => {
        if (a && a.id && a.name) nomes[a.id] = a.name;
    });
    const bonito = (codigo) => nomes[codigo] || codigo;

    const faltando = qualidade.faltando || [];
    const idsFaltando = qualidade.identificadoresFaltando || [];

    if (!faltando.length && !qualidade.semIdentificador) {
        el.innerHTML = `
            <div class="ana-card" style="animation-delay: 0.35s;">
                <div class="ana-card-header"><span class="ana-card-icon">📋</span><span class="ana-card-title">Ficha Técnica (visão do Mercado Livre)</span></div>
                <p class="text-small" style="margin:0; color:var(--green-dark,#047857);">O Mercado Livre considera a ficha deste anúncio completa.</p>
            </div>`;
        return;
    }

    // Dos campos que o ML pede, quais o vendedor NÃO consegue preencher por aqui?
    // (PARENT_PK de item em família: mexer pelo item tira o anúncio do grupo de
    // variações, e o editor de família descarta a mudança). Marcar no próprio chip
    // evita a pergunta "por que esse campo não aparece pra editar?".
    const detalheAtual = window.currentAnalysisState?.detail;
    const defPorId = {};
    (Array.isArray(categoryAttributes) ? categoryAttributes : []).forEach((c) => { if (c && c.id) defPorId[c.id] = c; });
    const soNoML = (codigo) => {
        const def = defPorId[codigo];
        if (!def) return false;
        return mfSoNoML(def, detalheAtual);
    };
    const marcados = faltando.filter(soNoML).length;

    const listaFicha = faltando.length ? `
        <p class="text-small" style="margin:10px 0 6px; color:var(--text-secondary);">Preenchendo estes campos, a ficha fica completa para o ML:</p>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${faltando.map((c) => {
                const fora = soNoML(c);
                const selo = fora
                    ? `<span style="font-size:0.68rem; font-weight:600; opacity:.75; margin-left:6px;" title="Este campo é o que agrupa as variações do produto — mudar por aqui tiraria o anúncio do grupo. Dá para preencher no Mercado Livre.">só no ML</span>`
                    : '';
                const cor = fora ? 'background:var(--bg-subtle,#f1f5f9); color:var(--text-secondary);' : 'background:var(--yellow-light,#fef3c7); color:#92400e;';
                return `<span style="display:inline-flex; align-items:center; padding:4px 10px; ${cor} border-radius:999px; font-size:0.8rem; font-weight:500;">${escapeHtml(bonito(c))}${selo}</span>`;
            }).join('')}
        </div>
        ${marcados ? `<p class="text-small" style="margin:8px 0 0; color:var(--text-muted);">${marcados === 1 ? 'O campo marcado agrupa' : 'Os campos marcados agrupam'} as variações do produto — edite no Mercado Livre.</p>` : ''}` : '';

    const listaIds = qualidade.semIdentificador ? `
        <p class="text-small" style="margin:12px 0 0; color:var(--text);">
            <b>Identificador do produto:</b> falta ${idsFaltando.length ? escapeHtml(idsFaltando.map(bonito).join(', ')) : 'o código de barras (GTIN/EAN)'} — é um dos requisitos de qualidade que o ML mais cobra.
        </p>` : '';

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.35s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">📋</span>
                <span class="ana-card-title">Ficha Técnica (visão do Mercado Livre)</span>
            </div>
            <p class="text-small" style="margin:0; color:var(--text-secondary);">
                ${faltando.length ? `O Mercado Livre aponta <b>${faltando.length} campo(s)</b> faltando na ficha técnica.` : 'A ficha técnica está completa, mas falta identificador do produto.'}
            </p>
            ${listaFicha}
            ${listaIds}
        </div>`;
}

function exibirExperienciaCompra(purchaseData, containerId = "purchaseExperience") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!purchaseData || typeof purchaseData !== 'object' || purchaseData.error) {
        el.innerHTML = `
            <div class="ana-card" style="animation-delay: 0.35s;">
                <div class="ana-card-header"><span class="ana-card-icon">🛒</span><span class="ana-card-title">Experiência de Compra (Mercado Livre)</span></div>
                <p class="text-small" style="color:var(--text-muted);">Dados de experiência de compra indisponíveis no momento.</p>
            </div>`;
        return;
    }

    const title = purchaseData.title?.text || purchaseData.title || '';
    const subtitles = Array.isArray(purchaseData.subtitles) ? purchaseData.subtitles : [];
    const actions = Array.isArray(purchaseData.actions) ? purchaseData.actions : [];
    const reputation = purchaseData.reputation || null;
    const statusRaw = purchaseData.status?.id || null;
    const statusTranslations = {
        active: 'Ativo', paused: 'Pausado', closed: 'Encerrado',
        under_review: 'Em revisão', inactive: 'Inativo', pending: 'Pendente'
    };
    const status = statusRaw ? (statusTranslations[statusRaw] || statusRaw) : null;
    const metricsDetails = purchaseData.metrics_details || null;
    const freeze = purchaseData.freeze?.text || '';

    // Interpola o texto dos subtitles da ML: {0}..{N} são substituídos por placeholders[N]
    // (ML usa "<b>"/"</b>" nos placeholders para destacar trechos em negrito).
    const renderSubtitleText = (s) => {
        const raw = (typeof s === 'string') ? s : (s?.text || '');
        const phs = Array.isArray(s?.placeholders) ? s.placeholders : [];
        const escapedText = escapeHtml(raw);
        return escapedText.replace(/\{(\d+)\}/g, (_m, idx) => {
            const ph = phs[+idx];
            if (ph == null) return '';
            return (ph === '<b>' || ph === '</b>') ? ph : escapeHtml(String(ph));
        });
    };

    // Mapa de cor da reputação ML (gray/green/yellow/orange/red)
    const repColorMap = {
        green: { c: 'var(--green)', bg: 'var(--green-light)', label: 'Ótima experiência' },
        yellow: { c: 'var(--yellow,#f59e0b)', bg: 'var(--yellow-light,#fef3c7)', label: 'Precisa de atenção' },
        orange: { c: '#f97316', bg: '#ffedd5', label: 'Alerta' },
        red: { c: 'var(--red)', bg: 'var(--red-light)', label: 'Crítico' },
        gray: { c: 'var(--text-muted)', bg: 'var(--bg-subtle,#f8fafc)', label: 'Sem dados suficientes' },
        light_gray: { c: 'var(--text-muted)', bg: 'var(--bg-subtle,#f8fafc)', label: 'Sem dados suficientes' }
    };
    const rep = reputation ? (repColorMap[reputation.color] || repColorMap.gray) : null;

    // Header principal
    let headerHtml = '';
    if (rep) {
        const repValueDisplay = (reputation.value != null && reputation.value >= 0) ? `${reputation.value}%` : '—';
        headerHtml = `
            <div style="display:flex; align-items:center; gap:16px; padding:14px; background:linear-gradient(135deg, ${rep.bg}, transparent); border-radius:var(--radius,8px); border:1px solid var(--border,#e5e7eb);">
                <div style="font-family:var(--font-mono, 'DM Mono',monospace); font-size:1.8rem; font-weight:800; color:${rep.c}; line-height:1;">${repValueDisplay}</div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:700; font-size:0.95rem; color:var(--text); line-height:1.3;">${escapeHtml(title || rep.label)}</div>
                    ${subtitles.length > 0 ? subtitles.map(s => `<div class="text-small" style="color:var(--text-muted); margin-top:3px; line-height:1.35;">${renderSubtitleText(s)}</div>`).join('') : ''}
                </div>
                <div style="text-align:right;">
                    <span style="background:${rep.bg}; color:${rep.c}; padding:4px 10px; border-radius:20px; font-size:0.72rem; font-weight:700;">${escapeHtml(rep.label)}</span>
                    ${status ? `<div class="text-small" style="color:var(--text-muted); margin-top:6px; font-size:0.7rem;">Status: ${escapeHtml(status)}</div>` : ''}
                </div>
            </div>`;
    } else {
        headerHtml = `
            <div style="padding:14px; background:var(--bg-subtle,#f8fafc); border-radius:var(--radius,8px); border:1px solid var(--border,#e5e7eb);">
                <div style="font-weight:700; font-size:0.95rem; color:var(--text); line-height:1.35;">${escapeHtml(title)}</div>
                ${subtitles.length > 0 ? subtitles.map(s => `<div class="text-small" style="color:var(--text-muted); margin-top:4px; line-height:1.35;">${renderSubtitleText(s)}</div>`).join('') : ''}
            </div>`;
    }

    // Freeze (alerta de congelamento) — quando houver
    const freezeHtml = freeze ? `
        <div style="margin-top:12px; padding:10px 14px; background:var(--red-light); border-radius:var(--radius-sm); border-left:3px solid var(--red);">
            <span class="text-small" style="color:var(--red-dark); font-weight:600;">🚨 ${escapeHtml(freeze)}</span>
        </div>` : '';

    // Ação recomendada — mensagem derivada dos problemas detectados
    // (as "actions" cruas do ML — "Alterar anúncio", "Pausar a partir da lista" — não fazem sentido fora da UI do Mercado Livre)
    let actionsHtml = '';
    const metricsProblems = (metricsDetails && Array.isArray(metricsDetails.problems)) ? metricsDetails.problems : [];
    if (metricsProblems.length > 0) {
        const recByKey = {
            DIFFERENT_FROM_REQUESTED: 'Verifique se seu anúncio corresponde ao produto enviado para evitar novos problemas.',
            PRODUCT_DEFECTIVE: 'Revise a qualidade e o controle do produto antes do envio para evitar reclamações.',
            PRODUCT_BROKEN: 'Reforce a embalagem para evitar avarias durante o transporte.',
            NOT_DELIVERED: 'Acompanhe os envios e confirme a postagem no prazo para evitar reclamações.',
            DELAYED: 'Revise seus prazos de postagem e logística para evitar atrasos.',
            SHIPPING: 'Revise os prazos e a logística de envio para evitar atrasos.'
        };
        const firstProblem = metricsProblems[0];
        const keyTwo = firstProblem?.level_two?.key || '';
        const recText = recByKey[keyTwo] || 'Verifique se seu anúncio corresponde ao produto enviado para evitar novos problemas.';
        actionsHtml = `
            <div style="margin-top:12px;">
                <div style="font-weight:700; font-size:0.78rem; color:var(--text); text-transform:uppercase; letter-spacing:0.03em; margin-bottom:6px;">Ação recomendada</div>
                <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--yellow-light,#fef3c7);border-radius:var(--radius-sm);border-left:3px solid var(--yellow,#f59e0b);">
                    <span style="flex-shrink:0;">💡</span>
                    <span class="text-small" style="color:var(--text); flex:1; line-height:1.4;">${escapeHtml(recText)}</span>
                </div>
            </div>`;
    }

    // Helper: extrai texto de um campo que pode ser string ou objeto {text, order}
    const fieldText = (f) => {
        if (f == null) return '';
        if (typeof f === 'string') return f;
        if (typeof f === 'object') return f.text || f.title || f.label || '';
        return String(f);
    };

    // Métricas detalhadas — problemas detectados e distribuição por período
    let metricsHtml = '';
    if (metricsDetails) {
        const problems = Array.isArray(metricsDetails.problems) ? metricsDetails.problems : [];
        const dist = metricsDetails.distribution || null;
        const empty = metricsDetails.empty_state_title || '';

        let problemsInner = '';

        // 1) Lista rica de problemas (quando a API traz metrics_details.problems)
        if (problems.length > 0) {
            const renderProblem = p => {
                const tag = fieldText(p.tag);
                const qty = fieldText(p.quantity);
                const l2 = fieldText(p.level_two?.title);
                const l3 = fieldText(p.level_three?.title);
                const remedy = fieldText(p.level_three?.remedy);
                const color = p.color || 'var(--red)';
                return `<div style="padding:10px 12px;background:var(--bg-subtle,#f8fafc);border-radius:var(--radius-sm);border-left:3px solid ${escapeHtml(color)};">
                    ${(tag || qty) ? `<div class="text-small" style="font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:0.68rem;letter-spacing:0.04em;margin-bottom:4px;">${escapeHtml(tag)}${(tag && qty) ? ' • ' : ''}${escapeHtml(qty)}</div>` : ''}
                    ${l2 ? `<div class="text-small" style="color:var(--text);font-weight:600;">${escapeHtml(l2)}</div>` : ''}
                    ${l3 ? `<div class="text-small" style="color:var(--text-muted);margin-top:2px;">${escapeHtml(l3)}</div>` : ''}
                    ${remedy ? `<div class="text-small" style="color:var(--text);margin-top:6px;padding:6px 8px;background:var(--yellow-light,#fef3c7);border-radius:var(--radius-sm);line-height:1.4;">💡 ${escapeHtml(remedy)}</div>` : ''}
                </div>`;
            };
            problemsInner += problems.map(renderProblem).join('');
        }

        // 2) Distribuição por categoria (level_one) — complementar
        if (dist && Array.isArray(dist.level_one) && dist.level_one.length > 0) {
            const renderLvl = l => {
                const title = fieldText(l.title) || fieldText(l.key) || '';
                const pct = (l.percentage != null) ? `${l.percentage}%` : (l.value != null ? l.value : '—');
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--bg-subtle,#f8fafc);border-radius:var(--radius-sm);">
                    <span class="text-small" style="color:var(--text);">${escapeHtml(title)}</span>
                    <span class="text-small" style="font-weight:700; color:var(--red);">${escapeHtml(String(pct))}</span>
                </div>`;
            };
            problemsInner += `<div style="display:flex; flex-direction:column; gap:4px; margin-top:${problems.length > 0 ? '8px' : '0'};">${dist.level_one.map(renderLvl).join('')}</div>`;
        }

        if (problemsInner) {
            metricsHtml = `
                <div style="margin-top:12px;">
                    <div style="font-weight:700; font-size:0.78rem; color:var(--text); text-transform:uppercase; letter-spacing:0.03em; margin-bottom:6px;">Problemas detectados</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">${problemsInner}</div>
                </div>`;
        } else if (empty) {
            metricsHtml = `
                <div style="margin-top:12px; padding:10px 14px; background:var(--green-light); border-radius:var(--radius-sm); border-left:3px solid var(--green);">
                    <span class="text-small" style="color:var(--green-dark); font-weight:600;">✓ ${escapeHtml(empty)}</span>
                </div>`;
        }
    }

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.35s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">🛒</span>
                <span class="ana-card-title">Experiência de Compra (Mercado Livre)</span>
            </div>
            ${headerHtml}
            ${freezeHtml}
            ${actionsHtml}
            ${metricsHtml}
        </div>
    `;
}

// Extrai items de checklist e score a partir da ML Quality API (item/{id}/performance)
function extractMLQualityItems(performanceData) {
    if (!performanceData || !Array.isArray(performanceData.buckets)) return null;
    const pending = [];
    const completed = [];
    performanceData.buckets.forEach(bucket => {
        const bucketLabel = bucket.title || bucket.key || '';
        (bucket.variables || []).forEach(v => {
            const title = v.title || v.key || '';
            if (v.status === 'COMPLETED') {
                completed.push({ text: title, bucket: bucketLabel });
            } else {
                const pendingRules = (v.rules || []).filter(r => r.status !== 'COMPLETED');
                if (pendingRules.length > 0) {
                    pendingRules.forEach(r => {
                        pending.push({
                            text: r.wordings?.title || title,
                            label: r.wordings?.label || null,
                            link: r.wordings?.link || null,
                            mode: r.mode || 'OPPORTUNITY',
                            bucket: bucketLabel
                        });
                    });
                } else {
                    pending.push({ text: title, bucket: bucketLabel, mode: 'OPPORTUNITY', link: null });
                }
            }
        });
    });
    // Uma `variable` com várias `rules` pendentes gera uma linha por regra, mas quando a
    // regra não traz `wordings.title` todas caem no mesmo fallback (o título da variable)
    // e o vendedor vê a mesma frase repetida. Some por texto, mantendo a primeira — e
    // preferindo a que tem link, que é a única acionável.
    const dedup = (lista) => {
        const porTexto = new Map();
        for (const p of lista) {
            const chave = (p.text || '').trim().toLowerCase();
            if (!chave) continue;
            const jaTem = porTexto.get(chave);
            if (!jaTem) { porTexto.set(chave, p); continue; }
            if (!jaTem.link && p.link) porTexto.set(chave, p);
        }
        return [...porTexto.values()];
    };

    return {
        pending: dedup(pending),
        completed: dedup(completed),
        score: Math.round(performanceData.score || 0),
        level: (performanceData.level || '').toLowerCase(),
        level_wording: performanceData.level_wording || null
    };
}

function exibirPontuacao(score, usedFallback = false, containerId = "scoreCircle", analysisData = null, checklistContainerId = "scoreChecklist", performanceData = null) {
    const el = document.getElementById(containerId);
    const checkEl = document.getElementById(checklistContainerId);
    if (!el) return;

    // ML Quality — ADICIONAL ao score heurístico (não substitui). Score grande continua sendo o heurístico MF.
    const mlQuality = extractMLQualityItems(performanceData);

    let level = 'bad';
    if (score >= 75) level = 'good'; else if (score >= 50) level = 'neutral';

    const defs = `
        <defs>
            <linearGradient id="gradientGood" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#00d68f;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
            </linearGradient>
        </defs>
    `;
    const strokeDasharray = `${score}, 100`;
    const celebration = score === 100 ? '<div class="celebration-confetti">🎉</div>' : '';

    let xpGainText = '';
    if (score === 100) xpGainText = '🏆 Classe S: Anúncio Impecável!';
    else if (score >= 75) xpGainText = '⭐ Classe A: Quase Perfeito!';
    else if (score >= 50) xpGainText = '📈 Classe B: Tem Potencial';
    else xpGainText = '⛏️ Classe C: Precisa de Trabalho';

    // Build improvement checklist — SEMPRE do heurístico do analysisData
    let improvementsHtml = '';
    let failedChecks = [];
    let passedChecks = [];
    if (analysisData) {
        const checks = [];
        const d = analysisData;
        // Title check — REGRA CRÍTICA: se anúncio já tem vendas, não sugerir mudar título
        // (alterar título reseta indexação ML e derruba exposição). Ver feedback_titulo_nao_mudar_se_vende.
        const titleLen = (d.title || '').length;
        const hasSales = (d.detail?.sold_quantity || 0) > 0;
        if (titleLen >= 50) {
            checks.push({ ok: true, text: 'Título otimizado' });
        } else if (hasSales) {
            checks.push({ ok: true, text: 'Título mantido (anúncio com histórico de vendas)' });
        } else if (titleLen < 40) {
            checks.push({ ok: false, text: `Título muito curto (${titleLen} chars)` });
        } else {
            checks.push({ ok: false, text: `Título poderia ser maior (${titleLen}/50+)` });
        }
        // Description
        const hasDesc = !!((d.descriptionData?.plain_text?.trim()) || (d.descriptionData?.text?.trim()));
        const src = d.descriptionData?.source;
        const descText = hasDesc
            ? (src === 'catalog' ? 'Descrição herdada do catálogo' : (src === 'user_product' ? 'Descrição herdada do MLBU' : 'Descrição presente'))
            : 'Adicionar descrição em texto';
        checks.push({ ok: hasDesc, text: descText });
        // Warranty
        const hasWarranty = !!getWarrantyText(d.detail);
        checks.push({ ok: hasWarranty, text: hasWarranty ? 'Garantia informada' : 'Informar garantia' });
        // Tags
        const hasBadTags = Array.isArray(d.detail?.tags) && d.detail.tags.some(t => TAGS_NEGATIVAS.has(t));
        checks.push({ ok: !hasBadTags, text: hasBadTags ? 'Tags negativas detectadas' : 'Sem tags negativas' });
        // Attributes (exclude ignored ones)
        const attrs = d.detail?.attributes || [];
        const stringAttrs = attrs.filter(a => a?.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id) && !window.ignoredAdAttributes.has(a.id));
        const filledCount = stringAttrs.length;
        if (filledCount === 0) checks.push({ ok: false, text: 'Ficha técnica vazia' });
        else if (filledCount < 3) checks.push({ ok: false, text: `Poucos atributos (${filledCount})` });
        else checks.push({ ok: true, text: `${filledCount} atributos preenchidos` });
        // Category fields
        if (d.categoryAttributes && Array.isArray(d.categoryAttributes)) {
            // Mesma régua da lista e da nota: só conta o que o vendedor consegue preencher
            const catMap = new Map();
            (d.detail?.attributes || []).forEach(a => { if (a?.value_name) catMap.set(a.id, a.value_name); });
            const missing = d.categoryAttributes.filter(c => {
                if (!mfCampoEditavel(c, d.detail)) return false;   // mesmos tipos e mesma régua da lista
                if (window.ignoredAdAttributes.has(c.id)) return false;
                const v = catMap.get(c.id); return !v || v.trim() === '';
            });
            if (missing.length > 0) checks.push({ ok: false, text: `${missing.length} campos da categoria faltando` });
            else checks.push({ ok: true, text: 'Categoria completa' });
        }
        // Visit trend + ghost ad detection
        if (d.visitsData && d.visitsData.results && !d.visitsData.error) {
            // 30 dias de verdade: a série chega com 60 e as duas frases daqui dizem
            // "em 30 dias". Sem o recorte, o total saía dobrado e "Sem visitas nos últimos
            // 30 dias" parava de acusar quem teve visita só no mês retrasado.
            const results = MF_visitasDosUltimos(d.visitsData.results, 30);
            results.sort((a, b) => new Date(a.date) - new Date(b.date));
            const len = results.length;
            const sumV = arr => arr.reduce((a, c) => a + (c.total || 0), 0);
            const total30 = sumV(results);
            const total7 = sumV(results.slice(Math.max(0, len - 7)));
            const totalPrev7 = sumV(results.slice(Math.max(0, len - 14), Math.max(0, len - 7)));

            // Ghost ad: tem visitas, mas zero vendas em 30 dias (só se Ads ativo, pra termos vendas 30d)
            // Quando há ads, ML retorna units_quantity (ads) + organic_units_quantity (orgânico) por dia.
            const adsDataX = d.adsData;
            if (adsDataX?.has_ads && Array.isArray(adsDataX.daily) && total30 > 0) {
                const ads30 = adsDataX.daily.reduce((s, x) => s + (x.units_quantity || 0), 0);
                const org30 = adsDataX.daily.reduce((s, x) => s + (x.organic_units_quantity || 0), 0);
                if ((ads30 + org30) === 0) {
                    checks.push({ ok: false, text: `${total30} visitas / 0 vendas em 30 dias (problema de conversão)` });
                }
            }

            if (total30 === 0) {
                checks.push({ ok: false, text: 'Sem visitas nos últimos 30 dias' });
            } else {
                let pct = 0;
                if (totalPrev7 === 0) pct = total7 > 0 ? 100 : 0;
                else pct = ((total7 - totalPrev7) / totalPrev7) * 100;

                if (pct < -5) checks.push({ ok: false, text: `Visitas em queda (${pct.toFixed(0)}%)` });
                else if (pct > 5) checks.push({ ok: true, text: `Visitas subindo (+${pct.toFixed(0)}%)` });
                else checks.push({ ok: true, text: `Visitas estáveis (${total30} no mês)` });
            }
        }
        // Reviews
        if (d.reviewsData && d.reviewsData.paging && d.reviewsData.paging.total > 0) {
            const avg = d.reviewsData.rating_average || 0;
            if (avg >= 4) checks.push({ ok: true, text: `Avaliações: ${avg.toFixed(1)} estrelas` });
            else checks.push({ ok: false, text: `Avaliações abaixo de 4 (${avg.toFixed(1)}⭐)` });
        } else {
            checks.push({ ok: false, text: 'Sem avaliações ainda' });
        }

        failedChecks = checks.filter(c => !c.ok);
        passedChecks = checks.filter(c => c.ok);

    }

    // Badge extra quando temos ML Quality (exibido abaixo do score heurístico, sem remover nada)
    let mlBadgeHtml = '';
    if (mlQuality) {
        const levelIcons = { excellent: '🏆', premium: '🏆', good: '⭐', standard: '⭐', fair: '📈', basic: '📈', poor: '⛏️' };
        const iconML = levelIcons[mlQuality.level] || (mlQuality.score >= 75 ? '⭐' : mlQuality.score >= 50 ? '📈' : '⛏️');
        const mlLevelLabel = mlQuality.level_wording || mlQuality.level || '';
        const mlColor = mlQuality.score >= 75 ? 'var(--green)' : (mlQuality.score >= 50 ? 'var(--yellow,#f59e0b)' : 'var(--red)');
        mlBadgeHtml = `
            <div style="margin-top:8px; padding:6px 10px; background:var(--bg-subtle,#f8fafc); border-radius:var(--radius-sm); border:1px solid var(--border,#e5e7eb); display:flex; align-items:center; justify-content:center; gap:6px; width:100%;">
                <span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.03em;">ML</span>
                <span style="font-family:var(--font-mono, 'DM Mono',monospace); font-weight:800; font-size:0.95rem; color:${mlColor};">${mlQuality.score}%</span>
                <span style="font-size:0.72rem; color:${mlColor}; font-weight:600;">${iconML} ${escapeHtml(mlLevelLabel)}</span>
            </div>`;
    }

    // Score evolution badge — pega snap anterior do localStorage
    const _itemIdForSnap = analysisData?.detail?.id;
    const _prevSnap = MF_loadSnap(_itemIdForSnap);
    const scoreDeltaHtml = MF_renderScoreDelta(_prevSnap, score);

    // Score circle card
    el.innerHTML = `
        <div class="ana-card" style="align-items:center; text-align:center; justify-content:center;">
            ${celebration}
            <div class="score-circle-outer" style="width:110px; height:110px;">
                <svg viewBox="0 0 36 36" class="circular-chart">
                    ${defs}
                    <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path class="circle ${level}" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                </svg>
                <span class="score-number" style="font-size:2rem;">${score}</span>
            </div>
            <span class="status-badge ${level === 'good' ? 'success' : (level === 'neutral' ? 'muted' : 'error')}" style="font-size:0.68rem; margin-top:10px;">
                ${xpGainText}
            </span>
            ${scoreDeltaHtml}
            ${usedFallback ? '<p class="text-small" style="margin-top:4px;">⚠ Estimativa</p>' : ''}
            ${mlBadgeHtml}
        </div>
    `;

    // Diff banner + Opportunities: renderiza no container changesBanner se existir + persiste novo snap
    if (_itemIdForSnap && analysisData?.detail) {
        const suffixMatch = (containerId || '').match(/scoreCircle(.*)$/);
        const suffix = suffixMatch ? suffixMatch[1] : '';
        const _currSnap = MF_buildSnap(analysisData.detail, analysisData.visitsData, analysisData.adsData, score);
        const _diff = MF_diffSnap(_prevSnap, _currSnap);
        const bannerHtml = MF_renderDiffBanner(_diff);
        const _opps = MF_buildOpportunities(analysisData.detail, analysisData.visitsData, analysisData.adsData, { suffix });
        const oppsHtml = MF_renderOpportunityCard(_opps, { suffix, itemId: _itemIdForSnap });
        const _penalties = MF_buildPenalties(analysisData.detail, { suffix });
        const penaltyHtml = MF_renderPenaltyCard(_penalties);
        const bannerEl = document.getElementById(`changesBanner${suffix}`);
        if (bannerEl) {
            bannerEl.innerHTML = penaltyHtml + bannerHtml + oppsHtml;
            if (typeof window.MF_oppHydrateRunwayCharts === 'function') window.MF_oppHydrateRunwayCharts(bannerEl);
        }
        MF_saveSnap(_itemIdForSnap, _currSnap);
    }

    // Checklist card — só os checks heurísticos NOSSOS.
    //
    // A seção "Ações Recomendadas pelo ML" saiu daqui em 13/08/2026. Ela renderizava a
    // mesma `mlQuality.pending`, com os mesmos deep links, que o card "Qualidade do Anúncio
    // (Mercado Livre)" já mostra — agrupada por bloco, com % e com as concluídas. Na tela a
    // recomendação saía duas vezes ("Preencha as características principais", "Ofereça
    // frete grátis…", "Participe de uma promoção…" em MLB3264800533).
    //
    // É o mesmo defeito de 11/08 pelo par que sobrou: lá o duplicado era Checklist Rápido ×
    // este card. Decisão do Lucas: fica só no card dedicado. As duas fontes eram o MESMO
    // `performanceData`, então nada some sozinho — sem dado da ML o card dedicado já diz
    // "Qualidade ainda não calculada" e aqui não havia o que mostrar.
    if (checkEl) {
        checkEl.innerHTML = `
            <div class="ana-card" style="height:100%;">
                <div class="ana-card-header" style="padding-bottom:10px; margin-bottom:10px;">
                    <span class="ana-card-icon">📝</span>
                    <span class="ana-card-title">O que Melhorar</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                    ${failedChecks.map((c, i) => `<div class="check-fail-animate" style="display:flex;align-items:center;gap:8px;padding:4px 10px;background:var(--red-light);border-radius:var(--radius-sm);border-left:3px solid var(--red);animation-delay:${i*0.08}s;"><span style="color:var(--red);font-weight:bold;flex-shrink:0;">✖</span><span class="text-small" style="color:var(--red-dark);">${c.text}</span></div>`).join('')}
                    ${passedChecks.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:3px 10px;background:var(--green-light);border-radius:var(--radius-sm);border-left:3px solid var(--green);"><span style="color:var(--green);font-weight:bold;flex-shrink:0;">✔</span><span class="text-small" style="color:var(--green-dark);">${c.text}</span></div>`).join('')}
                </div>
            </div>
        `;
    }

    // Animate stroke
    setTimeout(() => {
        const circle = el.querySelector('.circle');
        if (circle) circle.setAttribute('stroke-dasharray', strokeDasharray);
    }, 200);
}

function appendError(message, containerId = 'resultsContainer') {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    if (containerId === 'resultsContainer') cont.classList.remove('initial-state');
    if (Array.from(cont.querySelectorAll('.error-message')).some(el => el.textContent.includes(message))) return;
    const p = document.createElement('p');
    p.className = 'error-message';
    p.innerHTML = `❌ ${escapeHtml(message)}`;
    cont.appendChild(p);
}

function clearResults() {
    const resultsContainer = document.getElementById('resultsContainer');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
    }
}


function hideLoading() {
    const el = document.getElementById("loadingIndicator");
    if (el) el.style.display = 'none';
}

// --- Credential Fetching (Funções Atualizadas) ---
async function fetchAccessToken() {
    try {
        const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
        if (!r.ok) {
            const d = await r.text(); // Tenta pegar texto se não for JSON
            throw new Error(`HTTP ${r.status}: ${d}`);
        }
        const d = await r.json();
        if (d?.response?.access_token) {
            console.log("Access Token OK.");
            return d.response.access_token;
        }
        console.warn('Token não encontrado na resposta.');
        throw new Error('Token não encontrado na resposta.');
    } catch (e) {
        console.error('Erro ao buscar Access Token:', e.message);
        return null;
    }
}

async function fetchUserIdForScraping() { // Nome da função atualizado
    try {
        const r = await fetch('https://app.marketfacil.com.br/api/1.1/wf/get-user-id', {
            method: 'POST' // Assegura que o método é POST se necessário
        });
        if (!r.ok) {
            const d = await r.text();
            throw new Error(`HTTP ${r.status}: ${d}`);
        }
        const d = await r.json();
        // Lógica mais robusta para extrair user_id
        let uId = d?.response?.user_id || d?.user_id || (typeof d === 'string' && d.match(/^\d+x\d+$/) ? d : null);
        if (uId) {
            console.log("User ID OK.");
            return uId;
        }
        console.warn('User ID não encontrado na resposta.');
        throw new Error('User ID não encontrado na resposta.');
    } catch (e) {
        console.error('Erro ao buscar User ID:', e.message);
        return null;
    }
}

async function fetchApiData(fullUrl, accessToken) {
    console.log(`Buscando dados de ${fullUrl}...`);
    try {
        const response = await fetch(fullUrl, { headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {} });
        console.log(`Status: ${response.status}`);
        if (!response.ok) {
            let errorMsg = `Erro ${response.status}`;
            try { const errorData = await response.json(); errorMsg += `: ${errorData.message || errorData.error || JSON.stringify(errorData)}`; } catch (e) { /*ignore*/ }
            throw new Error(errorMsg);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Erro ao buscar dados:`, error.message);
        return null;
    }
}

async function fetchItemDetails(itemIds, accessToken) {
    const url = `${API_FETCH_ITEM_ENDPOINT}?item_id=${itemIds.join(',')}`;
    return fetchApiData(url, accessToken);
}

// Garantia: campo legado OU sale_terms (itens no modelo UP podem vir com warranty null e a garantia em WARRANTY_TYPE/WARRANTY_TIME).
function getWarrantyText(detail) {
    if (detail?.warranty) return detail.warranty;
    const terms = Array.isArray(detail?.sale_terms) ? detail.sale_terms : [];
    const typeName = terms.find(t => t?.id === 'WARRANTY_TYPE')?.value_name || '';
    const timeName = terms.find(t => t?.id === 'WARRANTY_TIME')?.value_name || '';
    if (typeName && timeName) return `${typeName}: ${timeName}`;
    return typeName || timeName || null;
}

// Extrai qualquer texto de descrição de um payload (item, user-product ou catalog product).
function extractDescriptionText(data) {
    if (!data || typeof data !== 'object') return '';
    if (data.plain_text && String(data.plain_text).trim()) return String(data.plain_text).trim();
    if (data.text && String(data.text).trim()) return String(data.text).trim();
    if (data.short_description?.content && String(data.short_description.content).trim()) return String(data.short_description.content).trim();
    if (typeof data.description === 'string' && data.description.trim()) return data.description.trim();
    if (data.description?.plain_text && String(data.description.plain_text).trim()) return String(data.description.plain_text).trim();
    if (data.description?.text && String(data.description.text).trim()) return String(data.description.text).trim();
    if (Array.isArray(data.main_features) && data.main_features.length > 0) {
        const joined = data.main_features.map(f => (typeof f === 'string' ? f : f?.text || f?.content || '')).filter(Boolean).join('\n');
        if (joined.trim()) return joined.trim();
    }
    return '';
}

// Busca descrição herdada em cadeia: user-product (MLBU) → catalog_product. Retorna null se não achar.
async function fetchInheritedDescription(detail, accessToken) {
    // Tenta user-product primeiro (MLBU é a ficha do vendedor e pode ter descrição própria)
    if (detail?.user_product_id) {
        try {
            const up = await fetchApiData(`${API_USER_PRODUCTS_ENDPOINT}/${detail.user_product_id}`, accessToken);
            const txt = extractDescriptionText(up);
            if (txt) return { plain_text: txt, text: txt, source: 'user_product' };
        } catch (e) { console.warn('Falha ao buscar user-product:', e.message); }
    }
    // Catálogo oficial
    if (detail?.catalog_product_id) {
        try {
            const cat = await fetchApiData(`${BASE_URL_PROXY}/api/fetch-catalog?product_id=${detail.catalog_product_id}`, accessToken);
            const txt = extractDescriptionText(cat);
            if (txt) return { plain_text: txt, text: txt, source: 'catalog' };
        } catch (e) { console.warn('Falha ao buscar catálogo:', e.message); }
    }
    return null;
}

/**
 * Qualidade do anúncio pelos olhos da ML.
 *
 * Não usa `fetchApiData` porque ele devolve `null` para QUALQUER erro, e aqui `null` tem
 * significado próprio: "a ML não calcula qualidade pra este anúncio". Em 13/08/2026 a tela
 * dizia "Qualidade ainda não calculada pelo ML" num anúncio cuja rota respondia 200 com
 * score 58 — a chamada tinha falhado uma vez e o card falou pela ML.
 *
 * 400 continua virando `null` de propósito: é a resposta dela em anúncio pausado e em
 * catálogo, onde a ausência é real.
 */
async function fetchPerformanceData(itemId, accessToken) {
    try {
        const res = await fetch(`${API_PERFORMANCE_ENDPOINT}?item_id=${encodeURIComponent(itemId)}`, {
            headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {},
        });
        if (res.ok) return await res.json();
        if (res.status === 400) return null;
        return { _falhou: true, _status: res.status };
    } catch (e) {
        return { _falhou: true, _motivo: 'rede' };
    }
}

/**
 * Chaves que a ML usa nas linhas de qualidade, para o que o app resolve.
 * Sem a de descrição e a de garantia porque a ML não lista essas duas (medido na conta em
 * 13/08: as 11 variables de um anúncio ativo são UP_TITLE, UP_PICTURES, UP_GTIN,
 * UP_TECHNICAL_SPECIFICATIONS_MAIN, UP_PRICE, UP_FREE_SHIPPING, UP_PROMOTIONS, UP_SHORTS,
 * UP_FINANCING e as de estoque).
 */
const MF_ATTR_PARA_LINHA_ML = { GTIN: 'UP_GTIN', EAN: 'UP_GTIN', UPC: 'UP_GTIN' };

/**
 * Registra que o vendedor resolveu isto AGORA, pelo app. A lista da ML é do carregamento
 * da página e a /performance dela atualiza periodicamente, então a linha continua lá —
 * marcada, para ele não achar que o salvamento não pegou.
 */
function MF_marcaResolvidoNoML(state, attrId) {
    if (!state) return;
    if (!state.resolvidosNoML) state.resolvidosNoML = new Set();
    state.resolvidosNoML.add(MF_ATTR_PARA_LINHA_ML[attrId] || 'UP_TECHNICAL_SPECIFICATIONS_MAIN');
}

window.mfRecarregarQualidadeML = async function () {
    const state = window.currentAnalysisState;
    if (!state || !state.detail) return;
    const alvo = document.getElementById(`performanceTexto${state.containerIdSuffix || ''}`);
    if (alvo) alvo.innerHTML = '<div class="ana-card"><p class="text-small">Consultando o Mercado Livre…</p></div>';
    state.performanceData = await fetchPerformanceData(state.detail.id, state.accessToken || window._adsAccessToken);
    exibirPerformance(state.performanceData, `performanceTexto${state.containerIdSuffix || ''}`);
};
async function fetchPurchaseExperience(itemId, accessToken) {
    const raw = await fetchApiData(`${BASE_URL_PROXY}/api/purchase-experience?item_id=${itemId}`, accessToken);
    // Proxy retorna { [itemId]: {...} } — desembrulha
    return raw && raw[itemId] ? raw[itemId] : raw;
}
async function fetchCategoryAttributes(categoryId, accessToken) { return fetchApiData(`${API_ATTRIBUTES_ENDPOINT}/${categoryId}`, accessToken); }

// Moderação ativa do ML: por que o anúncio está parado e o que fazer para voltar.
// O texto vem escrito pelo próprio Mercado Livre (REASON / REMEDY) — é o único
// diagnóstico da análise que já chega com a solução oficial.
async function fetchModeracaoAtiva(itemId, accessToken) {
    const raw = await fetchApiData(`${BASE_URL_PROXY}/api/moderations/details?item_id=${itemId}`, accessToken);
    const lista = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.results) ? raw.results : []);
    if (!lista.length) return null;
    const limpa = (v) => String(v || '').replace(/<[^>]+>/g, '').trim();
    return lista.map((m) => {
        const wordings = Array.isArray(m && m.wordings) ? m.wordings : [];
        const pega = (tipo) => {
            const achado = wordings.find((x) => String(x.type).toUpperCase() === tipo);
            return achado ? limpa(achado.value) : '';
        };
        return {
            nome: m && m.name ? String(m.name) : '',
            data: m && m.date_created ? String(m.date_created) : '',
            motivo: pega('REASON'),
            solucao: pega('REMEDY'),
            titulo: pega('TITLE')
        };
    }).filter((m) => m.motivo || m.solucao || m.titulo || m.nome);
}

// Ficha técnica pelos olhos do ML: quais atributos ele considera que faltam neste
// anúncio (catalog_quality). Uma chamada por item; os códigos são traduzidos com
// os atributos da categoria que a análise já carrega.
async function fetchQualidadeFicha(itemId, accessToken) {
    const raw = await fetchApiData(`${BASE_URL_PROXY}/api/catalog-quality?item_id=${itemId}`, accessToken);
    if (!raw || raw.available === false) return null;
    const st = (raw.adoption_status || {});
    const ft = st.ft || {};
    const pi = st.pi || {};
    return {
        faltando: Array.isArray(ft.missing_attributes) ? ft.missing_attributes : [],
        preenchidos: Array.isArray(ft.attributes) ? ft.attributes : [],
        fichaCompleta: ft.complete === true,
        semIdentificador: pi.complete === false,
        identificadoresFaltando: Array.isArray(pi.missing_attributes) ? pi.missing_attributes : [],
        // O bloco cru vai junto: `required` é a régua de obrigatoriedade da ML pra ESTE
        // anúncio (mfObrigatoriosDoML). Extrair só `ft` e `pi` fazia a etapa "Obrigatórios"
        // cair no fallback das tags da categoria em 100% dos casos, sem nunca dizer que
        // estava fazendo isso — a feature parecia ligada e nunca rodava.
        adoption_status: raw.adoption_status || null
    };
}

function transformMlbuData(mlbuData) {
    if (!mlbuData || typeof mlbuData !== 'object') return null;
    const transformedAttributes = mlbuData.attributes.map(attr => {
        const value = attr.values && attr.values.length > 0 ? attr.values[0] : {};
        return {
            id: attr.id,
            name: attr.name,
            value_name: value.name || null,
            value_type: attr.value_type || 'string'
        };
    });

    return {
        id: mlbuData.id,
        title: mlbuData.short_name || (mlbuData.name ? mlbuData.name.split(' - ')[0].trim() : ''),
        category_id: mlbuData.domain_id.replace('MLB-', ''),
        seller_id: mlbuData.user_id,
        attributes: transformedAttributes,
        variations: mlbuData.variations || [],
        tags: mlbuData.tags || [],
        warranty: null,
        pictures: mlbuData.pictures || []
    };
}

async function fetchVisits(itemId, accessToken) {
    // Tenta usar o Core se disponível (mesmo usado pelo visits.js)
    if (window.MarketFacilCore && typeof window.MarketFacilCore.getVisits === 'function') {
        try {
            console.log('Utilizando MarketFacilCore.getVisits...');
            return await window.MarketFacilCore.getVisits(itemId, '60'); // 60 dias: ver comentário abaixo
        } catch (e) {
            console.warn('Falha no Core, tentando rota direta...', e);
        }
    }
    // 60 dias, não 30: a linha de "30 dias" do resumo compara com os 30 dias ANTERIORES, e
    // com uma janela de 30 esse período anterior vinha vazio — ou a variação sumia, ou
    // saía um "+5840%" que só dizia que o denominador era zero. Mesma chamada, só o
    // parâmetro muda. O gráfico continua desenhando os últimos 30.
    return fetchApiData(`${API_VISITS_ENDPOINT}?item_id=${itemId}&last=60&unit=day`, accessToken);
}

async function fetchReviews(itemId, accessToken) {
    return fetchApiData(`${API_REVIEWS_ENDPOINT}?item_id=${itemId}`, accessToken);
}

async function fetchAdsMetrics(itemId, accessToken, days = 30) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return fetchApiData(`${API_ADS_METRICS_ENDPOINT}?item_id=${itemId}&date_from=${from}&date_to=${to}`, accessToken);
}

window.reloadAdsMetrics = async function(days) {
    if (!window._adsItemId || !window._adsContainerId) return;
    // Refresh token in case it expired
    try {
        const freshToken = await fetchAccessToken();
        if (freshToken) window._adsAccessToken = freshToken;
    } catch(e) {}
    if (!window._adsAccessToken) return;
    const el = document.getElementById(window._adsContainerId);
    if (el) el.innerHTML = '<div class="ana-card" style="padding:30px; text-align:center;"><span class="text-small">Carregando ads (' + days + ' dias)...</span></div>';
    try {
        const data = await fetchAdsMetrics(window._adsItemId, window._adsAccessToken, days);
        const visits = window.currentAnalysisState?.visitsData || null;
        exibirAdsMetrics(data, window._adsContainerId, days, visits);
    } catch(e) {
        if (el) el.innerHTML = '<div class="ana-card"><p class="text-small error-message">Erro: ' + e.message + '</p></div>';
    }
};

/**
 * Cruza o daily de Ads com as visitas NO PERÍODO QUE OS DOIS COBREM.
 *
 * As duas fontes têm janelas próprias e independentes: as visitas vêm de 60 dias fixos
 * (o card de visitas precisa disso pra comparar 30 dias com os 30 anteriores) e o daily
 * de Ads vem do período escolhido nos botões 7/15/30/60/90. Somar uma contra a outra foi
 * o bug de 11/08/2026 — com 60 dias de visitas e 30 de cliques, o que sobrava como
 * "orgânico" carregava 30 dias que o Ads nem cobriu, e no sentido oposto (90d de Ads
 * contra 60 de visitas) os cliques passavam as visitas e a linha do orgânico zerava.
 *
 * A janela aqui é a INTERSEÇÃO real das duas, e `dias` é o que a tela deve anunciar:
 * escrever "90 dias" num número que cobriu 60 é a mesma mentira, só que por extenso.
 * Sem dia em comum devolve null — a seção some, não inventa.
 */
function MF_janelaCanais(daily, visitResults) {
    const datasDe = (arr) => (arr || [])
        .map((x) => String(x && x.date || '').slice(0, 10))
        .filter(Boolean)
        .sort();
    const dAds = datasDe(daily);
    const dVis = datasDe(visitResults);
    if (!dAds.length || !dVis.length) return null;

    // ISO (AAAA-MM-DD) compara certo como string — sem fuso pra errar no meio do caminho.
    const ini = dAds[0] > dVis[0] ? dAds[0] : dVis[0];
    const fim = dAds[dAds.length - 1] < dVis[dVis.length - 1] ? dAds[dAds.length - 1] : dVis[dVis.length - 1];
    if (ini > fim) return null;
    const dentro = (d) => d >= ini && d <= fim;

    const cliquesPorDia = {};
    let vendasAds = 0, vendasOrganicas = 0;
    for (const a of (daily || [])) {
        const d = String(a && a.date || '').slice(0, 10);
        if (!d || !dentro(d)) continue;
        cliquesPorDia[d] = (cliquesPorDia[d] || 0) + (a.clicks || 0);
        vendasAds += a.units_quantity || 0;
        vendasOrganicas += a.organic_units_quantity || 0;
    }

    let visitasTotal = 0, visitasAds = 0;
    for (const v of (visitResults || [])) {
        const d = String(v && v.date || '').slice(0, 10);
        if (!d || !dentro(d)) continue;
        const total = v.total || 0;
        // Clique não pode passar a visita do dia. O ML conta as duas coisas por caminhos
        // diferentes; sem esse teto um dia desencontrado viraria orgânico negativo.
        visitasTotal += total;
        visitasAds += Math.min(total, cliquesPorDia[d] || 0);
    }

    const dias = Math.round(
        (new Date(fim + 'T12:00:00').getTime() - new Date(ini + 'T12:00:00').getTime()) / 86400000
    ) + 1;

    return {
        ini, fim, dias, dentro,
        visitasTotal, visitasAds, visitasOrganicas: Math.max(0, visitasTotal - visitasAds),
        vendasAds, vendasOrganicas, vendasTotal: vendasAds + vendasOrganicas,
    };
}

function exibirAdsMetrics(adsData, containerId = "adsMetrics", activeDays = 30, visitsData = null) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Store for reload
    window._adsContainerId = containerId;

    if (!adsData || !adsData.has_ads) {
        el.innerHTML = `
            <div class="ana-card">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📢</span>
                    <span class="ana-card-title">Product Ads</span>
                    <span class="status-badge muted" style="margin-left:auto;">Inativo</span>
                </div>
                <p class="text-small">Este anúncio não possui Product Ads ativo.</p>
            </div>`;
        return;
    }

    const daily = adsData.daily || [];
    const adInfo = adsData.ad_info || {};

    // --- 1. Calculate totals from daily data ---
    const sumField = (arr, field) => arr.reduce((s, d) => s + (d[field] || 0), 0);
    const totalImpressions = sumField(daily, 'prints');
    const totalClicks = sumField(daily, 'clicks');
    const totalCost = sumField(daily, 'cost');
    const totalOrders = sumField(daily, 'units_quantity');
    const totalRevenue = sumField(daily, 'total_amount');
    const totalOrganic = sumField(daily, 'organic_units_quantity');

    const totalOrganicRevenue = sumField(daily, 'organic_units_amount');
    const totalAllRevenue = totalRevenue + totalOrganicRevenue; // ads + organic revenue

    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';
    const acos = totalRevenue > 0 ? ((totalCost / totalRevenue) * 100).toFixed(1) : '0.0';
    const tacos = totalAllRevenue > 0 ? ((totalCost / totalAllRevenue) * 100).toFixed(1) : '0.0';
    const convRate = totalClicks > 0 ? ((totalOrders / totalClicks) * 100).toFixed(2) : '0.00';
    const cpc = totalClicks > 0 ? (totalCost / totalClicks) : 0;
    const roas = totalCost > 0 ? (totalRevenue / totalCost) : 0;

    // Visitas: o parâmetro é a fonte, o estado da análise é o resgate. Antes a tabela de
    // canal lia o parâmetro e o gráfico lia o estado — bastava um vir vazio pra metade do
    // card falar de um período e a outra metade de outro.
    const visitsFonte = (visitsData && Array.isArray(visitsData.results) && !visitsData.error)
        ? visitsData
        : ((window.currentAnalysisState && window.currentAnalysisState.visitsData) || null);
    const visitsResults = (visitsFonte && Array.isArray(visitsFonte.results) && !visitsFonte.error)
        ? visitsFonte.results : [];
    // Uma régua só para tudo que mistura visita com Ads: tabela de canal, barra de
    // composição e o gráfico diário. Três contas separadas foi como elas divergiram.
    const canais = MF_janelaCanais(daily, visitsResults);

    // --- 2. Calculate trends: last half vs first half ---
    const sortedDaily = [...daily].sort((a, b) => new Date(a.date) - new Date(b.date));
    const halfIdx = Math.floor(sortedDaily.length / 2);
    const firstHalf = sortedDaily.slice(0, halfIdx);
    const lastHalf = sortedDaily.slice(halfIdx);

    const calcTrend = (lastArr, firstArr, field) => {
        const lastVal = sumField(lastArr, field);
        const firstVal = sumField(firstArr, field);
        if (firstVal === 0) return lastVal > 0 ? 100 : 0;
        return ((lastVal - firstVal) / firstVal * 100);
    };

    const calcRatioTrend = (lastArr, firstArr, numField, denField) => {
        const lastNum = sumField(lastArr, numField);
        const lastDen = sumField(lastArr, denField);
        const firstNum = sumField(firstArr, numField);
        const firstDen = sumField(firstArr, denField);
        const lastRatio = lastDen > 0 ? (lastNum / lastDen) : 0;
        const firstRatio = firstDen > 0 ? (firstNum / firstDen) : 0;
        if (firstRatio === 0) return lastRatio > 0 ? 100 : 0;
        return ((lastRatio - firstRatio) / firstRatio * 100);
    };

    const impTrend = calcTrend(lastHalf, firstHalf, 'prints');
    const clicksTrend = calcTrend(lastHalf, firstHalf, 'clicks');
    const ctrTrend = calcRatioTrend(lastHalf, firstHalf, 'clicks', 'prints');

    // ACOS trend: cost/revenue ratio
    const acosLastNum = sumField(lastHalf, 'cost');
    const acosLastDen = sumField(lastHalf, 'total_amount');
    const acosFirstNum = sumField(firstHalf, 'cost');
    const acosFirstDen = sumField(firstHalf, 'total_amount');
    const acosLast = acosLastDen > 0 ? (acosLastNum / acosLastDen) : 0;
    const acosFirst = acosFirstDen > 0 ? (acosFirstNum / acosFirstDen) : 0;
    const acosTrend = acosFirst > 0 ? ((acosLast - acosFirst) / acosFirst * 100) : (acosLast > 0 ? 100 : 0);

    const cvrTrend = calcRatioTrend(lastHalf, firstHalf, 'units_quantity', 'clicks');

    const _site = (typeof window !== 'undefined' && window.MF_currentSiteId) ? window.MF_currentSiteId() : 'MLB';
    const _cfg = (typeof window !== 'undefined' && window.MF_getSiteConfig) ? window.MF_getSiteConfig(_site) : { locale: 'pt-BR', currency: 'BRL' };
    const fmt = (n) => new Intl.NumberFormat(_cfg.locale).format(n);
    const fmtMoney = (n) => new Intl.NumberFormat(_cfg.locale, { style: 'currency', currency: _cfg.currency }).format(n);

    // Trend badge: green arrow up = good, red arrow down = bad
    // For ACOS, lower is better so invert the color logic
    const trendBadge = (val, invertColor = false) => {
        const n = parseFloat(val.toFixed(0));
        const isPositive = n > 0;
        const color = invertColor
            ? (isPositive ? 'var(--red)' : 'var(--green-dark)')
            : (isPositive ? 'var(--green-dark)' : 'var(--red)');
        const arrow = isPositive ? '&#9650;' : '&#9660;';
        if (Math.abs(n) < 1) return `<span style="color:var(--text-muted);font-size:0.72rem;">— estável</span>`;
        if (n <= -100) return `<span style="color:var(--text-muted);font-size:0.68rem;">sem dados recentes</span>`;
        if (n >= 500) return `<span style="color:${color};font-weight:600;font-size:0.72rem;">${arrow} +∞</span>`;
        return `<span style="color:${color};font-weight:600;font-size:0.72rem;">${arrow} ${Math.abs(n)}%</span>`;
    };

    // --- 3. Period buttons ---
    const periods = [7, 15, 30, 60, 90];
    const periodBtns = periods.map(d => `<button onclick="window.reloadAdsMetrics(${d})" style="padding:4px 12px; border-radius:4px; border:1px solid ${d === activeDays ? 'var(--blue)' : 'var(--border)'}; background:${d === activeDays ? 'var(--blue)' : 'var(--bg-card)'}; color:${d === activeDays ? '#fff' : 'var(--text-secondary)'}; font-size:0.75rem; font-weight:600; cursor:pointer; font-family:inherit; text-transform:none; letter-spacing:0;">${d}d</button>`).join('');

    // Status do anúncio DENTRO da publicidade, em português. Os nomes e o que
    // cada um quer dizer estão na doc de Product Ads da ML (filtro `statuses`);
    // antes o valor saía cru e virava um selo "HOLD" que não diz nada ao vendedor.
    const MF_ADS_STATUS = {
        active: { texto: 'Ativo', classe: 'success', ajuda: 'Este anúncio está rodando na campanha.' },
        paused: { texto: 'Pausado na campanha', classe: 'muted', ajuda: 'O anúncio está na campanha, mas com a publicidade pausada.' },
        hold: { texto: 'Fora do ar', classe: 'muted', ajuda: 'O Mercado Livre desabilitou a publicidade porque o anúncio está pausado ou sem estoque.' },
        idle: { texto: 'Sem campanha', classe: 'muted', ajuda: 'O anúncio pode ser anunciado, mas não está em nenhuma campanha.' },
        delegated: { texto: 'Delegado a outra conta', classe: 'muted', ajuda: 'A publicidade deste anúncio está sob controle de outro anunciante.' },
        revoked: { texto: 'Devolvido para você', classe: 'muted', ajuda: 'O outro anunciante devolveu este anúncio, que voltou para o seu controle.' },
    };
    const _st = MF_ADS_STATUS[adInfo.status];
    const statusBadge = _st
        ? `<span class="status-badge ${_st.classe}" title="${escapeHtml(_st.ajuda)}">${_st.texto}</span>`
        : '<span class="status-badge muted">Sem informação</span>';

    // --- 4. Metrics grid (5 columns) ---
    const metricCard = (label, value, trend, valueColor) => `
        <div style="text-align:center; padding:8px 6px; background:var(--row-alt); border-radius:var(--radius-sm); border:1px solid var(--border); min-width:0;">
            <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
            <div style="font-family:'DM Mono',monospace;font-size:1rem;font-weight:700;color:${valueColor || 'var(--text)'};">${value}</div>
            <div style="margin-top:2px;">${trend}</div>
        </div>`;

    // Campaign info (from adsData.campaign)
    const campaign = adsData.campaign || {};
    const campaignStrategy = campaign.strategy || '—';
    const campaignAcosTarget = campaign.acos_target || null;
    const campaignRoasTarget = campaign.roas_target || null;
    const campaignBudget = campaign.budget || null;
    const campaignName = campaign.name || '—';
    // `current_level` é a REPUTAÇÃO do anúncio (doc de Product Ads), não o
    // estado da publicidade — o selo antigo dizia "Nível: newbie" e sugeria
    // uma escala que não existe. Sem tradução conhecida, não vai pra tela.
    const MF_ADS_REPUTACAO = {
        newbie: { texto: 'Ainda sem histórico', cor: 'yellow' },
        green: { texto: 'Boa reputação', cor: 'green' },
        yellow: { texto: 'Reputação mediana', cor: 'yellow' },
        red: { texto: 'Reputação baixa', cor: 'red' },
    };
    const adLevel = MF_ADS_REPUTACAO[adInfo.current_level] || null;

    const metricsGridHtml = `
        <div class="ana-metrics-grid">
            ${metricCard('Impressões', fmt(totalImpressions), trendBadge(impTrend))}
            ${metricCard('Cliques', fmt(totalClicks), trendBadge(clicksTrend))}
            ${metricCard('CTR', ctr + '%', trendBadge(ctrTrend), parseFloat(ctr) >= 1 ? 'var(--green-dark)' : 'var(--red)')}
            ${metricCard('ACOS', acos + '%', trendBadge(acosTrend, true), parseFloat(acos) > 30 ? 'var(--red)' : (parseFloat(acos) > 15 ? 'var(--yellow)' : 'var(--green-dark)'))}
            ${metricCard('TACOS', tacos + '%', `<span style="font-size:0.65rem;color:var(--text-muted);">Fat. total: ${fmtMoney(totalAllRevenue)}</span>`, parseFloat(tacos) > 20 ? 'var(--red)' : (parseFloat(tacos) > 10 ? 'var(--yellow)' : 'var(--green-dark)'))}
            ${metricCard('Conversão Ads', convRate + '%', trendBadge(cvrTrend), parseFloat(convRate) >= 5 ? 'var(--green-dark)' : 'var(--red)')}
        </div>
        ${(() => {
            // Breakdown Ads × Orgânico × Total — só existe com dia em comum entre visitas e Ads
            if (!canais || canais.visitasTotal <= 0) return '';
            const totalVisits = canais.visitasTotal;
            const adsVisits = canais.visitasAds;
            const organicVisits = canais.visitasOrganicas;
            const adsSales = canais.vendasAds;
            const organicSales = canais.vendasOrganicas;
            const totalSales = canais.vendasTotal;
            const cvr = (sales, vis) => vis > 0 ? ((sales / vis) * 100) : 0;
            const adsCvr = cvr(adsSales, adsVisits);
            const orgCvr = cvr(organicSales, organicVisits);
            const totalCvr = cvr(totalSales, totalVisits);
            const colorFor = (v) => v >= 5 ? 'var(--green-dark)' : (v >= 1 ? 'var(--yellow)' : 'var(--red)');
            const insight = (() => {
                if (totalVisits === 0) return null;
                if (adsCvr > orgCvr * 2 && adsVisits > 10) return { kind: 'info', icon: '💡', text: 'Ads converte muito mais que orgânico — vale subir o lance.' };
                if (orgCvr > adsCvr * 2 && organicVisits > 10) return { kind: 'info', icon: '💡', text: 'Orgânico converte mais que Ads — investir em SEO/preço/título dá mais retorno que aumentar lance.' };
                if (totalCvr < 0.5) return { kind: 'warning', icon: '⚠️', text: 'Conversão geral baixa — revise preço, fotos, descrição, reviews.' };
                return null;
            })();
            const insightHtml = insight ? (() => {
                const isWarn = insight.kind === 'warning';
                const bg = isWarn ? 'var(--yellow-light, #fef3c7)' : 'var(--blue-light, #dbeafe)';
                const bd = isWarn ? 'var(--yellow, #f59e0b)' : 'var(--blue, #3b82f6)';
                return `<div style="margin-top:8px; padding:8px 12px; background:${bg}; border-left:3px solid ${bd}; border-radius:var(--radius-sm, 6px); display:flex; gap:8px; align-items:flex-start;">
                    <span style="font-size:0.95rem; line-height:1.2; flex-shrink:0;">${insight.icon}</span>
                    <span style="font-size:0.78rem; color:var(--text); line-height:1.45;">${insight.text}</span>
                </div>`;
            })() : '';
            return `
            <div style="margin-bottom:16px;">
                <div class="text-small" style="font-weight:600; color:var(--text); margin-bottom:6px;">Conversão por canal (últimos ${canais.dias} dias)</div>
                <div style="border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden;">
                    <div class="ana-channel-row" style="padding:6px 10px; background:var(--row-alt); font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.04em;">
                        <span>Canal</span><span style="text-align:right;">Visitas</span><span style="text-align:right;">Vendas</span><span style="text-align:right;">Conversão</span>
                    </div>
                    <div class="ana-channel-row" style="padding:8px 10px; font-size:0.82rem; border-top:1px solid var(--border);">
                        <span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--blue); margin-right:6px;"></span>Ads</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace;">${fmt(adsVisits)}</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace;">${fmt(adsSales)}</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace; font-weight:700; color:${colorFor(adsCvr)};">${adsCvr.toFixed(2)}%</span>
                    </div>
                    <div class="ana-channel-row" style="padding:8px 10px; font-size:0.82rem; border-top:1px solid var(--border);">
                        <span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--green); margin-right:6px;"></span>Orgânico</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace;">${fmt(organicVisits)}</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace;">${fmt(organicSales)}</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace; font-weight:700; color:${colorFor(orgCvr)};">${orgCvr.toFixed(2)}%</span>
                    </div>
                    <div class="ana-channel-row" style="padding:8px 10px; font-size:0.82rem; border-top:1px solid var(--border); background:var(--bg-subtle, var(--row-alt));">
                        <span style="font-weight:700;">Total</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace; font-weight:700;">${fmt(totalVisits)}</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace; font-weight:700;">${fmt(totalSales)}</span>
                        <span style="text-align:right; font-family:'DM Mono',monospace; font-weight:800; color:${colorFor(totalCvr)};">${totalCvr.toFixed(2)}%</span>
                    </div>
                </div>
                ${insightHtml}
            </div>`;
        })()}
        ${campaign.name ? `
        <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--navy);border-radius:4px;"><span style="font-size:0.65rem;color:rgba(255,255,255,0.5);">Campanha:</span><span style="font-size:0.78rem;font-weight:600;color:#fff;">${campaignName}</span></div>
            <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--row-alt);border-radius:4px;border:1px solid var(--border);"><span style="font-size:0.65rem;color:var(--text-muted);">Estratégia:</span><span style="font-size:0.78rem;font-weight:600;">${campaignStrategy}</span></div>
            ${campaignAcosTarget ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--blue-light);border-radius:4px;"><span style="font-size:0.65rem;color:var(--text-muted);">Meta ACOS:</span><span style="font-family:'DM Mono',monospace;font-size:0.78rem;font-weight:600;color:${parseFloat(acos) <= campaignAcosTarget ? 'var(--green-dark)' : 'var(--red)'};">${campaignAcosTarget}%</span></div>` : ''}
            ${campaignRoasTarget ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--row-alt);border-radius:4px;border:1px solid var(--border);"><span style="font-size:0.65rem;color:var(--text-muted);">Meta ROAS:</span><span style="font-family:'DM Mono',monospace;font-size:0.78rem;font-weight:600;color:${roas >= campaignRoasTarget ? 'var(--green-dark)' : 'var(--red)'};">${campaignRoasTarget.toFixed(1)}x</span></div>` : ''}
            ${campaignBudget ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--row-alt);border-radius:4px;border:1px solid var(--border);"><span style="font-size:0.65rem;color:var(--text-muted);">Orçamento:</span><span style="font-family:'DM Mono',monospace;font-size:0.78rem;font-weight:600;">${fmtMoney(campaignBudget)}</span></div>` : ''}
            ${adLevel ? `<div style="display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--${adLevel.cor}-light);border-radius:4px;" title="Reputação que o Mercado Livre dá a este anúncio dentro da publicidade."><span style="width:6px;height:6px;border-radius:50%;background:var(--${adLevel.cor});"></span><span style="font-size:0.72rem;font-weight:600;">${adLevel.texto}</span></div>` : ''}
        </div>` : ''}`;

    // --- 5. Navy ticker bar ---
    const tickerHtml = `
        <div style="display:flex; gap:16px; flex-wrap:wrap; padding:10px 14px; background:var(--navy); border-radius:var(--radius-sm); color:#fff; margin-bottom:12px; align-items:center;">
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Custo</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;">${fmtMoney(totalCost)}</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Faturamento</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;color:var(--green);">${fmtMoney(totalRevenue)}</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Vendas Ads</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;">${fmt(totalOrders)}</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Vendas Orgânicas</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;">${fmt(totalOrganic)}</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">ROAS</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;color:${roas >= 3 ? 'var(--green)' : 'var(--red)'};">${roas.toFixed(1)}x</span></div>
            <div style="width:1px;height:28px;background:rgba(255,255,255,0.15);"></div>
            <div style="display:flex;flex-direction:column;gap:1px;"><span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">CPC Médio</span><span style="font-family:'DM Mono',monospace;font-weight:600;font-size:0.9rem;">${fmtMoney(cpc)}</span></div>
        </div>`;

    // --- 6. Chart 1 - ACOS Diário (Chart.js) ---
    let acosChartHtml = '';
    const acosCanvasId = 'acosChart_' + Date.now();
    let _acosChartData = null;
    if (sortedDaily.length > 0) {
        // Dia que teve custo e NÃO teve venda não é "0% de ACOS" — é o pior dia possível.
        // A conta antiga (`rev > 0 ? ... : 0`) desenhava barra no chão justamente nos dias
        // em que o vendedor só gastou, que é o oposto do que aconteceu. Sem receita a razão
        // não existe: vira buraco no gráfico, e o tooltip diz o que foi gasto.
        const razaoDiaria = (custo, receita) => {
            if (receita > 0) return parseFloat((custo / receita * 100).toFixed(1));
            return custo > 0 ? null : 0; // null = sem venda no dia (buraco), 0 = dia parado
        };
        const dailyAcosValues = sortedDaily.map(d => razaoDiaria(d.cost || 0, d.total_amount || 0));
        // TACOS = custo sobre o faturamento TOTAL (ads + orgânico). É a métrica que manda:
        // ACOS alto com TACOS baixo é anúncio que vende sozinho e usa Ads de empurrão.
        const dailyTacosValues = sortedDaily.map(d =>
            razaoDiaria(d.cost || 0, (d.total_amount || 0) + (d.organic_units_amount || 0)));
        const dailyCosts = sortedDaily.map(d => d.cost || 0);
        const acosLabels = sortedDaily.map(d => d.date ? new Date(d.date).toLocaleDateString(_cfg ? _cfg.locale : 'pt-BR', { day: '2-digit', month: '2-digit' }) : '');
        const acosColors = dailyAcosValues.map(v => v === null ? 'rgba(148,163,184,0.25)' : (v > 30 ? '#ff3b5c' : (v > 15 ? '#f59e0b' : '#00d68f')));

        _acosChartData = {
            labels: acosLabels, values: dailyAcosValues, colors: acosColors,
            tacos: dailyTacosValues, custos: dailyCosts, target: campaignAcosTarget
        };

        acosChartHtml = `
            <div class="chart-card">
                <div class="chart-card-header">
                    <span class="chart-card-icon">📊</span>
                    <span class="chart-card-label">ACOS e TACOS por dia</span>
                </div>
                <div class="chart-card-body" style="height:200px;position:relative;">
                    <canvas id="${acosCanvasId}"></canvas>
                </div>
                <p class="text-small" style="margin:8px 0 0; color:var(--text-muted); line-height:1.4;">
                    Barras: quanto do faturamento <b>vindo de Ads</b> foi para o anúncio.
                    Linha: quanto do faturamento <b>total</b> (Ads + orgânico) foi para Ads.
                </p>
            </div>`;
    }

    // --- 7. Chart 2 - Visitas Ads vs Orgânico + Linha de Impressões (Chart.js) ---
    let visitsAdsChartHtml = '';
    const visitsCanvasId = 'visitsAdsChart_' + Date.now();
    let _visitsChartData = null;
    if (sortedDaily.length > 0) {
        // Build maps by date
        const adsClicksByDate = {};
        const adsPrintsByDate = {};
        sortedDaily.forEach(d => {
            if (d.date) {
                const key = d.date.substring(0, 10);
                adsClicksByDate[key] = d.clicks || 0;
                adsPrintsByDate[key] = d.prints || 0;
            }
        });

        // Match visits with ads per day — só nos dias que Ads e visitas cobrem juntos.
        // Desenhar os 60 dias das visitas com o Ads de 30 pintava metade do gráfico como
        // 100% orgânico, quando na verdade o Ads nem foi consultado naqueles dias.
        const visitasNaJanela = canais ? visitsResults.filter(v => canais.dentro(String(v && v.date || '').slice(0, 10))) : [];
        const sortedVisits = visitasNaJanela.length > 0
            ? [...visitasNaJanela].sort((a, b) => new Date(a.date) - new Date(b.date))
            : sortedDaily.map(d => ({ date: d.date, total: d.clicks || 0 }));

        const entries = sortedVisits.map(v => {
            const dateKey = v.date ? v.date.substring(0, 10) : '';
            const total = v.total || 0;
            const adsClicks = Math.min(total, adsClicksByDate[dateKey] || 0);
            const prints = adsPrintsByDate[dateKey] || 0;
            return { date: v.date, total, ads: adsClicks, organic: Math.max(0, total - adsClicks), prints };
        });

        const visitsLabels = entries.map(e => e.date ? new Date(e.date).toLocaleDateString(_cfg ? _cfg.locale : 'pt-BR', { day: '2-digit', month: '2-digit' }) : '');
        const organicData = entries.map(e => e.organic);
        const adsData = entries.map(e => e.ads);
        const impressionsData = entries.map(e => e.prints);

        _visitsChartData = { labels: visitsLabels, organic: organicData, ads: adsData, impressions: impressionsData };

        // Total ads vs organic for ratio bar
        let totalVisitsSum = entries.reduce((s, e) => s + e.total, 0);
        let totalAdsSum = entries.reduce((s, e) => s + e.ads, 0);
        const adsPctTotal = totalVisitsSum > 0 ? ((totalAdsSum / totalVisitsSum) * 100) : 0;
        const orgPctTotal = 100 - adsPctTotal;

        visitsAdsChartHtml = `
            <div class="chart-card">
                <div class="chart-card-header">
                    <span class="chart-card-icon">📊</span>
                    <span class="chart-card-label">Visitas Diárias: Ads vs Orgânico + Impressões</span>
                </div>
                <div class="chart-card-body" style="height:220px;position:relative;">
                    <canvas id="${visitsCanvasId}"></canvas>
                </div>
            </div>
            <div style="margin-top:10px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-size:0.68rem;color:var(--text-muted);">Composição do tráfego (${canais ? canais.dias : activeDays}d)</span>
                    <span style="font-size:0.68rem;color:var(--text-muted);">${fmt(totalAdsSum)} ads / ${fmt(totalVisitsSum)} total</span>
                </div>
                <div style="height:12px;border-radius:6px;background:var(--border);overflow:hidden;display:flex;">
                    <div style="width:${adsPctTotal}%;background:var(--blue);display:flex;align-items:center;justify-content:center;">
                        ${adsPctTotal > 8 ? `<span style="font-size:0.5rem;color:#fff;font-weight:700;">${adsPctTotal.toFixed(0)}%</span>` : ''}
                    </div>
                    <div style="flex:1;background:var(--green);display:flex;align-items:center;justify-content:center;">
                        ${orgPctTotal > 8 ? `<span style="font-size:0.5rem;color:#fff;font-weight:700;">${orgPctTotal.toFixed(0)}%</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:2px;">
                    <span style="font-size:0.62rem;color:var(--blue);font-weight:600;">Ads ${adsPctTotal.toFixed(1)}%</span>
                    <span style="font-size:0.62rem;color:var(--green-dark);font-weight:600;">Orgânico ${orgPctTotal.toFixed(1)}%</span>
                </div>
            </div>`;
    }

    // --- 8. Chart 3 - Vendas: Ads vs Orgânico (horizontal ratio bar) ---
    let salesRatioHtml = '';
    const totalSales = totalOrders + totalOrganic;
    if (totalSales > 0) {
        const adsSalesPct = (totalOrders / totalSales) * 100;
        const orgSalesPct = (totalOrganic / totalSales) * 100;

        salesRatioHtml = `
            <div style="margin-top:16px;">
                <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:6px;">Vendas: Ads vs Orgânico</div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:0.72rem;color:var(--text-muted);">${fmt(totalOrders)} ads / ${fmt(totalOrganic)} orgânicas / ${fmt(totalSales)} total</span>
                </div>
                <div style="height:14px;border-radius:7px;background:var(--border);overflow:hidden;display:flex;">
                    <div style="width:${adsSalesPct}%;background:var(--blue);border-radius:7px 0 0 7px;display:flex;align-items:center;justify-content:center;" title="Ads: ${adsSalesPct.toFixed(1)}%">
                        ${adsSalesPct > 10 ? `<span style="font-size:0.55rem;color:#fff;font-weight:700;">${adsSalesPct.toFixed(0)}%</span>` : ''}
                    </div>
                    <div style="flex:1;background:var(--green);display:flex;align-items:center;justify-content:center;" title="Orgânico: ${orgSalesPct.toFixed(1)}%">
                        ${orgSalesPct > 10 ? `<span style="font-size:0.55rem;color:#fff;font-weight:700;">${orgSalesPct.toFixed(0)}%</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:3px;">
                    <span style="font-size:0.65rem;color:var(--blue);font-weight:600;">Ads ${adsSalesPct.toFixed(1)}%</span>
                    <span style="font-size:0.65rem;color:var(--green-dark);font-weight:600;">Orgânico ${orgSalesPct.toFixed(1)}%</span>
                </div>
            </div>`;
    }

    // --- Render ---
    el.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">📢</span>
                <span class="ana-card-title">Product Ads</span>
                ${statusBadge}
                <div style="margin-left:auto; display:flex; gap:3px; align-items:center; flex-wrap:wrap;">
                    ${periodBtns}
                </div>
            </div>

            ${metricsGridHtml}
            ${tickerHtml}
            ${acosChartHtml}
            ${visitsAdsChartHtml}
            ${salesRatioHtml}
        </div>
    `;

    // --- Chart.js initialization (after innerHTML is set) ---
    setTimeout(() => {
        if (typeof Chart === 'undefined') return;

        // ACOS Diário chart
        if (_acosChartData) {
            const acosCtx = document.getElementById(acosCanvasId);
            if (acosCtx) {
                new Chart(acosCtx, {
                    type: 'bar',
                    data: {
                        labels: _acosChartData.labels,
                        datasets: [{
                            label: 'ACOS %',
                            data: _acosChartData.values,
                            backgroundColor: _acosChartData.colors,
                            borderRadius: 3,
                            borderSkipped: false,
                            barPercentage: 0.85,
                            categoryPercentage: 0.9,
                            order: 2
                        }, {
                            // TACOS por cima das barras: é a métrica que manda na leitura
                            // (feedback_product_ads_rules), e lado a lado com o ACOS mostra
                            // o quanto do faturamento é orgânico — a distância entre as duas
                            // linhas É a venda que não veio de Ads.
                            label: 'TACOS %',
                            data: _acosChartData.tacos,
                            type: 'line',
                            borderColor: '#0066ff',
                            backgroundColor: '#0066ff',
                            borderWidth: 2,
                            pointRadius: 2.5,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            spanGaps: false, // dia sem venda vira buraco, não linha reta mentirosa
                            order: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 600 },
                        scales: {
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
                                border: { display: false }
                            },
                            y: {
                                grid: { color: 'rgba(148,163,184,0.1)' },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#94a3b8', callback: v => v + '%' },
                                border: { display: false },
                                beginAtZero: true
                            }
                        },
                        plugins: {
                            title: { display: false },
                            // Duas séries agora: sem legenda o vendedor não sabe qual é qual.
                            legend: {
                                display: true,
                                position: 'top',
                                align: 'end',
                                labels: {
                                    boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle',
                                    font: { size: 10, family: "'DM Sans', sans-serif" }, color: '#94a3b8', padding: 12
                                }
                            },
                            tooltip: {
                                backgroundColor: '#0f172a',
                                titleColor: '#fff',
                                bodyColor: '#00d68f',
                                borderColor: 'rgba(0,102,255,0.3)',
                                borderWidth: 1,
                                padding: 12,
                                cornerRadius: 8,
                                displayColors: true,
                                callbacks: {
                                    label: function(ctx) {
                                        const nome = ctx.dataset.label === 'TACOS %' ? 'TACOS' : 'ACOS';
                                        // null = teve custo e nenhuma venda. Dizer "0%" aqui seria
                                        // elogiar o pior dia do período.
                                        if (ctx.parsed.y === null || ctx.parsed.y === undefined) {
                                            const custo = (_acosChartData.custos || [])[ctx.dataIndex] || 0;
                                            return nome + ': sem venda no dia' + (custo > 0 ? ' (gastou ' + fmtMoney(custo) + ')' : '');
                                        }
                                        return nome + ': ' + ctx.parsed.y + '%';
                                    }
                                }
                            },
                            annotation: _acosChartData.target ? {
                                annotations: {
                                    acosTarget: {
                                        type: 'line',
                                        yMin: _acosChartData.target,
                                        yMax: _acosChartData.target,
                                        borderColor: '#ff3b5c',
                                        borderWidth: 1.5,
                                        borderDash: [6, 4],
                                        label: {
                                            display: true,
                                            content: 'Meta ' + _acosChartData.target + '%',
                                            position: 'end',
                                            backgroundColor: 'rgba(255,59,92,0.85)',
                                            color: '#fff',
                                            font: { size: 9, weight: 'bold' },
                                            padding: { top: 2, bottom: 2, left: 6, right: 6 },
                                            borderRadius: 4
                                        }
                                    }
                                }
                            } : undefined
                        }
                    }
                });
            }
        }

        // Visitas Ads vs Orgânico + Impressões chart
        if (_visitsChartData) {
            const visitsCtx = document.getElementById(visitsCanvasId);
            if (visitsCtx) {
                new Chart(visitsCtx, {
                    type: 'bar',
                    data: {
                        labels: _visitsChartData.labels,
                        datasets: [
                            {
                                label: 'Orgânico',
                                data: _visitsChartData.organic,
                                backgroundColor: '#00d68f',
                                borderRadius: 3,
                                borderSkipped: false,
                                stack: 'visits',
                                order: 2
                            },
                            {
                                label: 'Ads',
                                data: _visitsChartData.ads,
                                backgroundColor: '#0066ff',
                                borderRadius: 3,
                                borderSkipped: false,
                                stack: 'visits',
                                order: 1
                            },
                            {
                                label: 'Impressões',
                                data: _visitsChartData.impressions,
                                type: 'line',
                                borderColor: '#f59e0b',
                                backgroundColor: 'rgba(245,158,11,0.1)',
                                borderWidth: 2,
                                borderDash: [5, 3],
                                pointRadius: 2,
                                pointBackgroundColor: '#f59e0b',
                                pointBorderColor: '#f59e0b',
                                fill: false,
                                yAxisID: 'y1',
                                order: 0
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 600 },
                        scales: {
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
                                border: { display: false },
                                stacked: true
                            },
                            y: {
                                grid: { color: 'rgba(148,163,184,0.1)' },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#94a3b8' },
                                border: { display: false },
                                beginAtZero: true,
                                stacked: true,
                                title: { display: true, text: 'Visitas', font: { size: 9 }, color: '#94a3b8' }
                            },
                            y1: {
                                position: 'right',
                                grid: { display: false },
                                ticks: { font: { size: 9, family: "'DM Mono', monospace" }, color: '#f59e0b' },
                                border: { display: false },
                                beginAtZero: true,
                                title: { display: true, text: 'Impressões', font: { size: 9 }, color: '#f59e0b' }
                            }
                        },
                        plugins: {
                            title: { display: false },
                            legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'rectRounded', padding: 14, font: { size: 10 }, color: '#94a3b8' } },
                            tooltip: {
                                backgroundColor: '#0f172a',
                                titleColor: '#fff',
                                bodyColor: '#00d68f',
                                borderColor: 'rgba(0,102,255,0.3)',
                                borderWidth: 1,
                                padding: 12,
                                cornerRadius: 8,
                                displayColors: true,
                                callbacks: {
                                    afterBody: function(items) {
                                        const idx = items[0]?.dataIndex;
                                        if (idx == null) return '';
                                        const org = _visitsChartData.organic[idx] || 0;
                                        const ads = _visitsChartData.ads[idx] || 0;
                                        const total = org + ads;
                                        const adsPct = total > 0 ? ((ads / total) * 100).toFixed(0) : '0';
                                        return 'Total: ' + total + ' | Ads: ' + adsPct + '%';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
    }, 100);
}

function renderAiImageAnalyzer(detail, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    let picturesHtml = '';

    if (detail.variations && detail.variations.length > 0) {
        // Group variations by each attribute name
        const attrNames = new Set();
        detail.variations.forEach(v => {
            if (v.attribute_combinations) v.attribute_combinations.forEach(a => attrNames.add(a.name));
        });
        const groupOptions = Array.from(attrNames);
        groupOptions.push('Todas'); // always have All option

        // Build variation cards grouped
        const buildVariationCards = (groupName) => {
            let groups = {};
            if (groupName === 'Todas') {
                detail.variations.forEach((v, i) => {
                    const label = v.attribute_combinations ? v.attribute_combinations.map(a => a.value_name).join(' / ') : `Variação ${i + 1}`;
                    if (!groups[label]) groups[label] = { pics: [], variId: v.id };
                    const picIds = v.picture_ids || [];
                    const pics = detail.pictures.filter(p => picIds.includes(p.id));
                    groups[label].pics.push(...pics);
                });
            } else {
                detail.variations.forEach((v, i) => {
                    const attr = v.attribute_combinations?.find(a => a.name === groupName);
                    const key = attr ? attr.value_name : 'Outros';
                    if (!groups[key]) groups[key] = { pics: [], varIds: [] };
                    groups[key].varIds.push(v.id);
                    const picIds = v.picture_ids || [];
                    const uniquePics = detail.pictures.filter(p => picIds.includes(p.id) && !groups[key].pics.some(ep => ep.id === p.id));
                    groups[key].pics.push(...uniquePics);
                });
            }
            let html = '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;">';
            Object.entries(groups).forEach(([label, data]) => {
                if (data.pics.length === 0) return;
                const imgsHtml = data.pics.map(p => `<img src="${p.secure_url}" style="width:40px; height:40px; object-fit:cover; border-radius:5px; border:1px solid var(--border);" alt="Img">`).join('');
                const varId = data.variId || (data.varIds ? data.varIds[0] : 'geral');
                html += `
                <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:var(--row-alt); display:flex; flex-direction:column; justify-content:space-between;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-size:0.78rem; font-weight:700; color:var(--text);">${label}</span>
                        <span style="font-size:0.68rem; color:var(--text-muted);">${data.pics.length} fotos</span>
                    </div>
                    <div style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;">${imgsHtml}</div>
                    <button class="nerd-button" style="padding:5px 8px; font-size:0.72rem; width:100%; justify-content:center;" onclick="iniciarAnaliseIA('${detail.id}', '${varId}')">
                        🪄 Analisar
                    </button>
                    <div id="aiImageResult_${varId}" style="margin-top:6px; display:none;"></div>
                </div>`;
            });
            html += '</div>';
            return html;
        };

        // Tab buttons
        const tabsId = 'varGroupTabs_' + Date.now();
        const containId = 'varGroupContent_' + Date.now();
        let tabsHtml = `<div id="${tabsId}" style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">`;
        const defaultGroup = groupOptions.length > 1 ? groupOptions[0] : 'Todas';
        groupOptions.forEach((opt, i) => {
            const isActive = opt === defaultGroup;
            tabsHtml += `<button onclick="window._switchVarGroup(this, '${containId}', '${opt.replace(/'/g, "\\'")}')"
                style="padding:5px 14px; font-size:0.75rem; border-radius:20px; border:1px solid ${isActive ? 'var(--blue)' : 'var(--border)'}; background:${isActive ? 'var(--blue)' : 'var(--bg-card)'}; color:${isActive ? '#fff' : 'var(--text-muted)'}; cursor:pointer; transition:all 0.2s; font-weight:${isActive ? '600' : '400'};">${opt}</button>`;
        });
        tabsHtml += '</div>';

        picturesHtml = tabsHtml + `<div id="${containId}">${buildVariationCards(defaultGroup)}</div>`;

        // Store builder function globally for tab switching
        window._varBuilders = window._varBuilders || {};
        window._varBuilders[containId] = buildVariationCards;
        window._switchVarGroup = function (btn, cId, group) {
            document.getElementById(cId).innerHTML = window._varBuilders[cId](group);
            btn.parentElement.querySelectorAll('button').forEach(b => {
                b.style.background = 'var(--bg-card)'; b.style.color = 'var(--text-muted)'; b.style.borderColor = 'var(--border)'; b.style.fontWeight = '400';
            });
            btn.style.background = 'var(--blue)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--blue)'; btn.style.fontWeight = '600';
        };
    } else if (detail.pictures && detail.pictures.length > 0) {
        picturesHtml = `
            <div style="margin-bottom: 12px; border: 1px solid rgba(226, 232, 240, 0.6); border-radius: var(--radius-sm); padding: 12px; background: var(--row-alt);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-size:0.85rem; font-weight:bold; color:var(--text);">Imagens Gerais</span>
                    <button class="nerd-button" style="padding: 6px 12px; font-size: 0.8rem;" onclick="iniciarAnaliseIA('${detail.id}', 'geral')">
                        🪄 Analisar Imagens
                    </button>
                </div>
                <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;">`;
        detail.pictures.forEach(pic => {
            picturesHtml += `<img src="${pic.secure_url}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); flex-shrink: 0;" alt="Img">`;
        });
        picturesHtml += `</div>
            <div id="aiImageResult_geral" style="margin-top: 10px; display: none;"></div>
            </div>`;
    } else {
        picturesHtml = '<p class="text-small muted">O anúncio não possui imagens para analisar.</p>';
    }

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.15s; position: relative; overflow: hidden; grid-column: 1 / -1;">
            <div style="position: absolute; top: -50px; right: -50px; width: 100px; height: 100px; background: var(--blue); opacity: 0.1; filter: blur(30px); border-radius: 50%;"></div>
            <div class="ana-card-header" style="margin-bottom: 15px;">
                <span class="ana-card-icon">✨</span>
                <span class="ana-card-title">Analisador de Imagens por IA</span>
                <span class="status-badge success" style="margin-left:auto; background: linear-gradient(135deg, #a855f7, #6366f1); color: white; border: none;">Beta</span>
            </div>
            <p class="text-small" style="margin-bottom:15px; color:var(--text-muted);">As fotos do anúncio são separadas pelas suas variações correspondentes. A IA identificará pontos fortes e melhorias específicas de exposição e quebra de objeções.</p>
            <div>
                ${picturesHtml}
            </div>
        </div>
    `;
}

window.iniciarAnaliseIA = async function (itemId, variationId) {
    const resEl = document.getElementById(`aiImageResult_${variationId}`);
    if (!resEl) return;
    resEl.style.display = 'block';
    resEl.innerHTML = `<p class="text-small" style="color:var(--blue); margin:0;">Processando imagens via IA... ⏳</p>`;
    try {
        const token = window.currentAnalysisState ? window.currentAnalysisState.accessToken : ''; // Optional
        const r = await fetch('${API_ANALYZE_IMAGE_ENDPOINT}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId, variation_id: variationId })
        });
        if (!r.ok) throw new Error('Falha na requisição');
        const data = await r.json();
        resEl.innerHTML = `<div style="background:var(--blue-light); padding: 12px; border-radius: var(--radius-sm); border-left: 3px solid var(--blue);"><p class="text-small">${escapeHtml(data.analysis || 'Análise concluída com sucesso!')}</p></div>`;
    } catch (e) {
        resEl.innerHTML = `<p class="text-small error-message" style="margin:0;">O Analisador de IA ficará disponível em breve. (${escapeHtml(e.message)})</p>`;
    }
}

function exibirTendenciaVisitas(visitsData, containerId = "visitsTrend", adsData = null) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!visitsData || visitsData.error) {
        let motivo = "Indisponível no momento.";
        if (visitsData && visitsData.error === 'not_owner') motivo = "Restrito ao vendedor.";
        else if (visitsData && visitsData.error) motivo = "Erro na busca.";

        el.innerHTML = `
            <div class="ana-card" style="animation-delay: 0.1s;">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📊</span>
                    <span class="ana-card-title">Desempenho do Anúncio</span>
                </div>
                <p class="text-small" style="color: var(--text-muted); font-style:italic;">${motivo}</p>
            </div>`;
        return;
    }

    const results = visitsData.results || [];
    results.sort((a, b) => new Date(a.date) - new Date(b.date));

    const sumVisits = (arr) => arr.reduce((acc, curr) => acc + (curr.total || 0), 0);

    const len = results.length;
    // Filtra por data real (ML retorna só dias com visita — slice por posição daria leitura errada)
    const _now = new Date();
    const _msDay = 86400000;
    const inWindow = (item, daysAgoStart, daysAgoEnd) => {
        if (!item.date) return false;
        const t = new Date(item.date).getTime();
        if (isNaN(t)) return false;
        const ageDays = (_now.getTime() - t) / _msDay;
        return ageDays >= daysAgoStart && ageDays < daysAgoEnd;
    };
    const filterWindow = (start, end) => results.filter(r => inWindow(r, start, end));

    const last7 = filterWindow(0, 7);
    const prev7 = filterWindow(7, 14);
    const last15 = filterWindow(0, 15);
    const prev15 = filterWindow(15, 30);
    const last30 = filterWindow(0, 30);
    const prev30 = filterWindow(30, 60);
    // Janela máxima coberta pelo dataset (em dias)
    const _datesMs = results.map(r => new Date(r.date).getTime()).filter(t => !isNaN(t));
    const _oldestAge = _datesMs.length > 0 ? (_now.getTime() - Math.min(..._datesMs)) / _msDay : 0;

    const total7 = sumVisits(last7);
    const totalPrev7 = sumVisits(prev7);
    const total15 = sumVisits(last15);
    const totalPrev15 = sumVisits(prev15);
    const total30 = sumVisits(last30);
    const totalPrev30 = sumVisits(prev30);

    const calcPct = (curr, prev) => {
        if (prev === 0) return curr > 0 ? 100 : 0;
        return ((curr - prev) / prev) * 100;
    };
    // Sempre mostra % com o que tem (mesmo dado parcial — usuário tem contexto pra interpretar)
    const percentChange7 = calcPct(total7, totalPrev7);
    const percentChange15 = calcPct(total15, totalPrev15);
    const percentChange30 = calcPct(total30, totalPrev30);

    let trend = 'Estável';
    let icon = '➡️';
    let colorClass = 'muted';

    if (percentChange7 > 5) { trend = 'Subindo'; icon = '📈'; colorClass = 'success'; }
    else if (percentChange7 < -5) { trend = 'Caindo'; icon = '📉'; colorClass = 'error'; }

    // Redesenhar com os mesmos dados é o que o botão de ligar/desligar métrica chama —
    // assim os painéis que sobram voltam a dividir a altura, sem buraco branco.
    window.MF_redesenhaVisitas = () => exibirTendenciaVisitas(visitsData, containerId, adsData);

    // A série vem com 60 dias (para o resumo comparar 30 × 30 anteriores); o gráfico
    // desenha os últimos 30, que é o período que o card anuncia.
    const pontosTodos = MF_seriesDiarias(results, adsData && adsData.has_ads ? adsData.daily : null);
    const pontos = pontosTodos.filter((p) => {
        const idade = (Date.now() - new Date(p.dia + 'T12:00:00').getTime()) / 86400000;
        return idade < 30;
    });
    const temVendas = pontos.some((p) => typeof p.vendas === 'number');
    // Disponíveis = o que a conta permite mostrar (sem Ads não há vendas nem conversão).
    // Ativas = as disponíveis que o vendedor não desligou.
    const seriesDisponiveis = MF_SERIES_VISITAS.filter((s) => s.chave === 'visitas' || temVendas);
    const seriesAtivas = seriesDisponiveis.filter((s) => !MF_visOcultas.has(s.chave));

    let svgChart = '';
    if (pontos.length > 0 && total30 > 0) {
        const W = 300, PAD_E = 4, PAD_D = 4;
        const ALT_PAINEL = 46, GAP = 14, TOPO_ROTULO = 12;
        const larg = W - PAD_E - PAD_D;
        const H = seriesAtivas.length * (ALT_PAINEL + TOPO_ROTULO) + (seriesAtivas.length - 1) * GAP;

        let paineis = '';
        seriesAtivas.forEach((s, idx) => {
            const y0 = idx * (ALT_PAINEL + TOPO_ROTULO + GAP) + TOPO_ROTULO;
            const vals = pontos.map((p) => p[s.chave]).filter((v) => typeof v === 'number');
            const max = vals.length ? Math.max(...vals) : 0;
            const d = MF_caminhoSerie(pontos, s.chave, PAD_E, larg, y0, ALT_PAINEL);
            const maxTxt = s.chave === 'conversao' ? max.toFixed(1) + '%' : String(Math.round(max));
            paineis += `
                <g data-serie="${s.chave}">
                    <text x="${PAD_E}" y="${y0 - 3}" font-size="7.5" fill="var(--text-muted)" font-weight="600">${s.rotulo}</text>
                    <text x="${W - PAD_D}" y="${y0 - 3}" font-size="7" fill="var(--text-muted)" text-anchor="end">máx ${maxTxt}</text>
                    <line x1="${PAD_E}" y1="${y0 + ALT_PAINEL}" x2="${W - PAD_D}" y2="${y0 + ALT_PAINEL}" stroke="var(--border,#e5e7eb)" stroke-width="0.5"/>
                    ${d ? `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : ''}
                </g>`;
        });

        svgChart = `
        <div class="mf-vis-chart" style="margin-top:14px; position:relative;" data-pontos='${escapeHtml(JSON.stringify(pontos))}'>
            <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; overflow:visible; display:block;">
                ${paineis}
                <line class="mf-vis-cross" x1="0" y1="0" x2="0" y2="${H}" stroke="var(--text-muted)" stroke-width="0.6" stroke-dasharray="2 2" style="display:none; pointer-events:none;"/>
                <rect class="mf-vis-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent" style="cursor:crosshair;"/>
            </svg>
            <div class="mf-vis-tip" style="display:none; position:absolute; z-index:5; pointer-events:none; background:var(--navy,#0f172a); color:#fff; padding:7px 9px; border-radius:6px; font-size:0.72rem; line-height:1.5; white-space:nowrap; box-shadow:0 4px 14px rgba(0,0,0,.18);"></div>
        </div>
        <div class="mf-vis-legenda" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;">
            ${seriesDisponiveis.map((s) => {
                // O botão da métrica desligada CONTINUA na legenda — some o painel, não o
                // controle, senão não há como religar.
                const off = MF_visOcultas.has(s.chave);
                return `
                <button type="button" class="mf-vis-toggle" data-serie="${s.chave}" aria-pressed="${off ? 'false' : 'true'}"
                    title="${off ? 'Mostrar' : 'Ocultar'} ${escapeHtml(s.rotulo)}"
                    style="display:inline-flex; align-items:center; gap:5px; background:none; border:none; padding:2px 4px; cursor:pointer; font-family:inherit; font-size:0.72rem; color:var(--text-secondary); opacity:${off ? '0.4' : '1'};">
                    <span style="width:12px; height:2px; background:${off ? 'var(--text-muted)' : s.cor}; border-radius:2px; flex-shrink:0;"></span>${s.rotulo}
                </button>`;
            }).join('')}
        </div>`;
    }

    const lowDataWarning = total30 < 10 ? '<div style="margin-top:8px;"><span class="status-badge muted" style="font-size:0.7rem;">⚠️ Poucos dados</span></div>' : '';

    // Sem Ads não há série de vendas por dia — a tabela mostra só visitas, e o card diz
    // por quê em vez de deixar o vendedor procurando as colunas que não vieram.
    const semAdsHtml = (adsData && adsData.has_ads) ? '' : `
        <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border,#e5e7eb);">
            <span class="text-small" style="color:var(--text-muted);">Vendas e conversão aparecem quando o anúncio tem publicidade — é de lá que vem a venda dia a dia.</span>
        </div>`;

    // Resumo por período seguindo as MÉTRICAS ATIVAS (Lucas, 11/08): desligar Vendas tira
    // a coluna de vendas daqui também. Um controle só manda no card inteiro — dois lugares
    // com regras diferentes de "o que está ligado" seria a mesma armadilha das contagens
    // divergentes de campos (05/08).
    const janelas = [
        { rotulo: '7 dias', ini: 0, fim: 7, iniAnt: 7, fimAnt: 14 },
        { rotulo: '15 dias', ini: 0, fim: 15, iniAnt: 15, fimAnt: 30 },
        { rotulo: '30 dias', ini: 0, fim: 30, iniAnt: 30, fimAnt: 60 },
    ];
    // Soma por janela a partir dos MESMOS pontos do gráfico — resumo e gráfico não podem
    // sair de contas diferentes.
    const somaJanela = (ini, fim) => {
        // Usa a série COMPLETA (60d): a janela anterior de "30 dias" mora fora dos 30 do
        // gráfico. Sem isso a comparação não existe.
        const dentro = pontosTodos.filter((p) => {
            const idade = (Date.now() - new Date(p.dia + 'T12:00:00').getTime()) / 86400000;
            return idade >= ini && idade < fim;
        });
        const v = dentro.reduce((s, p) => s + (typeof p.visitas === 'number' ? p.visitas : 0), 0);
        const ven = dentro.reduce((s, p) => s + (typeof p.vendas === 'number' ? p.vendas : 0), 0);
        const temVenda = dentro.some((p) => typeof p.vendas === 'number');
        return {
            visitas: v,
            vendas: temVenda ? ven : null,
            // Conversão da JANELA = vendas da janela ÷ visitas da janela. Média das
            // conversões diárias daria peso igual a um dia de 2 visitas e a um de 200.
            conversao: (temVenda && v > 0) ? (ven / v) * 100 : null,
        };
    };
    const fmtMetrica = (chave, v) => {
        if (typeof v !== 'number') return '—';
        return chave === 'conversao' ? v.toFixed(2).replace('.', ',') + '%' : String(v);
    };
    // A variação vive em COLUNA PRÓPRIA, não colada no número. Junto no mesmo <span>, ela
    // empurrava o valor e cada linha começava num lugar diferente — a tabela parecia solta.
    // Com coluna separada, os números alinham à direita entre si e os selos começam todos
    // na mesma posição, mesmo quando uma linha não tem variação.
    const variacaoHtml = (atual, anterior) => {
        if (typeof atual !== 'number' || typeof anterior !== 'number' || anterior === 0) return '';
        const pct = ((atual - anterior) / anterior) * 100;
        if (Math.abs(pct) < 1) return '';
        const cor = pct > 0 ? 'var(--green-dark)' : 'var(--red-dark)';
        const bg = pct > 0 ? 'var(--green-light)' : 'var(--red-light)';
        return `<span style="font-size:0.6rem; font-weight:700; padding:1px 4px; border-radius:4px; color:${cor}; background:${bg}; white-space:nowrap;">${pct > 0 ? '+' : ''}${pct.toFixed(0)}%</span>`;
    };
    // Por métrica: uma coluna pro número (direita) e uma pro selo (largura fixa).
    const colunas = 'minmax(48px, auto) ' + seriesAtivas.map(() => 'minmax(0, 1fr) 42px').join(' ');
    const resumoHtml = `
        <div style="display:grid; grid-template-columns:${colunas}; gap:7px 8px; align-items:center; margin-bottom:14px;">
            <span></span>
            ${seriesAtivas.map((s) => `
                <span class="text-small" style="color:${s.cor}; font-weight:700; text-align:right;">${s.rotulo}</span>
                <span></span>`).join('')}
            ${janelas.map((j) => {
                const at = somaJanela(j.ini, j.fim);
                const ant = somaJanela(j.iniAnt, j.fimAnt);
                return `<span class="text-small" style="color:var(--text-muted); white-space:nowrap;">${j.rotulo}</span>`
                    + seriesAtivas.map((s) => `
                        <span style="font-family:var(--font-mono,'DM Mono',monospace); font-weight:600; font-size:0.9rem; color:var(--text); text-align:right; white-space:nowrap;">${fmtMetrica(s.chave, at[s.chave])}</span>
                        <span style="text-align:left;">${variacaoHtml(at[s.chave], ant[s.chave])}</span>`).join('');
            }).join('')}
        </div>`;

    el.innerHTML = `
        <div class="ana-card" style="animation-delay: 0.1s;">
            <div class="ana-card-header" style="margin-bottom:10px;">
                <span class="ana-card-icon">📊</span>
                <span class="ana-card-title">Desempenho do Anúncio</span>
            </div>
            ${resumoHtml}
            ${svgChart}
            ${semAdsHtml}
            ${lowDataWarning}
        </div>
    `;
    // Listeners só depois do innerHTML — `<script>` inline não roda por aqui.
    MF_ativarGraficoVisitas(el);
}

/* =========================================================================
   Gráfico do card de visitas — visitas, vendas e conversão dia a dia.
   Pedido do Lucas (11/08/2026): linha em vez de barra, os dados do dia ao passar o
   mouse, e poder desligar uma métrica.

   TRÊS PAINÉIS empilhados, não um gráfico com dois eixos: visitas ficam na casa das
   centenas, vendas na das unidades e conversão em %. Sobrepor isso exigiria dois eixos Y,
   que é o erro clássico de gráfico — a inclinação de uma série passa a depender da escala
   escolhida pra outra, e a comparação vira ilusão de ótica. Empilhado, o eixo X é
   compartilhado e a leitura "as visitas subiram e as vendas não" continua direta.

   Cores validadas contra fundo claro (CVD ΔE 8.9, acima do piso): cada painel tem título
   próprio, então a cor é reforço e não a única identificação.
   ========================================================================= */
const MF_SERIES_VISITAS = [
    { chave: 'visitas',   rotulo: 'Visitas',    cor: '#0066ff', sufixo: '' },
    { chave: 'vendas',    rotulo: 'Vendas',     cor: '#00875a', sufixo: '' },
    { chave: 'conversao', rotulo: 'Conversão',  cor: '#c2410c', sufixo: '%' },
];

/**
 * Dia seguinte em ISO, pelo UTC — somar 86400000 escorrega no horário de verão.
 * Devolve null se a entrada não for data: `toISOString()` de um Invalid Date LANÇA, e
 * quem chama está num laço.
 */
function MF_diaSeguinte(iso) {
    const t = new Date(iso + 'T12:00:00Z');
    if (isNaN(t.getTime())) return null;
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
}

/**
 * Monta as séries diárias a partir das visitas e do daily de Ads.
 *
 * VISITA: dia que a API omite é dia de ZERO visita, e entra como 0. Medido na conta em
 * 13/08/2026 em dois anúncios de tráfego oposto — 48 e 58 registros numa janela de 60
 * dias, nenhum `total: 0` nos dois, menor valor 1. A API simplesmente não devolve o dia
 * sem visita. Tratar essa ausência como desconhecido custava o furo na linha e, pior, o
 * eixo encolhido: 48 pontos ocupando 60 dias ligavam 19/06 direto em 21/06 como se
 * fossem dias seguidos, e a inclinação mentia sobre o ritmo.
 *
 * VENDA: continua `null` quando não há fonte (buraco na linha), nunca 0 — o daily do Ads
 * não omite dia, então falta ali é falta de verdade, e "não vendeu" e "não deu pra saber"
 * não podem virar o mesmo desenho.
 */
function MF_seriesDiarias(results, adsDaily) {
    const porDia = new Map();
    for (const v of (results || [])) {
        const d = (v.date || '').slice(0, 10);
        if (d) porDia.set(d, { dia: d, visitas: Number(v.total) || 0, vendas: null, conversao: null });
    }
    // Preenche só o MIOLO: do primeiro ao último dia que a API devolveu. Fora daí não se
    // sabe se o anúncio existia — e a ponta de hoje ainda está propagando (ver guarda
    // abaixo), então zero ali seria afirmar que o dia acabou sem visita nenhuma.
    //
    // Só entram no cálculo dos limites as chaves que SÃO data. Uma data malformada
    // ordena depois de qualquer '2026-…' (letra > dígito), virava o "último dia" e o
    // laço nunca chegava lá — travava o browser do vendedor. O teto de voltas é o cinto
    // de segurança: a janela pedida é de 60 dias, então 400 nunca é alcançado por dado
    // legítimo.
    const ordenados = [...porDia.keys()].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (ordenados.length > 1) {
        const fim = ordenados[ordenados.length - 1];
        let voltas = 0;
        for (let d = MF_diaSeguinte(ordenados[0]); d && d < fim && voltas < 400; d = MF_diaSeguinte(d)) {
            voltas++;
            if (!porDia.has(d)) porDia.set(d, { dia: d, visitas: 0, vendas: null, conversao: null });
        }
    }
    // O daily do Ads vai de date_from a date_to INCLUSIVE, então traz HOJE — que as visitas
    // ainda não têm. Esse dia entrava como ponto de `visitas: null` e abria um furo na ponta
    // da linha, todo dia, em todo anúncio com Ads (12/08/2026).
    //
    // A guarda é só pra PONTA: dia fora do intervalo que as visitas cobrem não vira ponto.
    // Buraco no meio continua valendo, e anúncio SEM série de visitas nenhuma continua
    // mostrando as vendas do Ads — some o furo, não a informação.
    const diasVisita = [...porDia.keys()].sort();
    const primeiro = diasVisita[0], ultimo = diasVisita[diasVisita.length - 1];
    const temAds = Array.isArray(adsDaily) && adsDaily.length > 0;
    if (temAds) {
        for (const a of adsDaily) {
            const d = (a.date || '').slice(0, 10);
            if (!d) continue;
            if (diasVisita.length && (d < primeiro || d > ultimo)) continue;
            const vendas = (Number(a.units_quantity) || 0) + (Number(a.organic_units_quantity) || 0);
            const linha = porDia.get(d) || { dia: d, visitas: null, vendas: null, conversao: null };
            linha.vendas = vendas;
            // Com visita, a conta normal. Sem visita nenhuma e sem venda, a conversão do dia
            // É zero — nada entrou e nada converteu, e o vendedor lê isso direto. Mas venda
            // em dia de zero visita não vira 0%: a visita que gerou foi contada em outro dia,
            // e dizer "0% de conversão" num dia que VENDEU seria mentira ao contrário. Esse
            // é o único furo que resta na linha de conversão.
            linha.conversao = (linha.visitas > 0) ? (vendas / linha.visitas) * 100
                : (vendas === 0 ? 0 : null);
            porDia.set(d, linha);
        }
    }
    return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * Liga o crosshair, o tooltip e os botões de ligar/desligar série.
 *
 * Pendurado por JS depois do innerHTML: `<script>` dentro de innerHTML não executa, e no
 * Bubble isso já mordeu antes ([[feedback_bubble_innerhtml_script]]).
 */
function MF_ativarGraficoVisitas(raiz) {
    const box = raiz && raiz.querySelector('.mf-vis-chart');
    if (!box) return;
    let pontos = [];
    try { pontos = JSON.parse(box.getAttribute('data-pontos') || '[]'); } catch (e) { return; }
    if (!pontos.length) return;

    const svg = box.querySelector('svg');
    const cross = box.querySelector('.mf-vis-cross');
    const tip = box.querySelector('.mf-vis-tip');
    const vb = (svg.getAttribute('viewBox') || '0 0 300 100').split(/\s+/).map(Number);
    const W = vb[2] || 300, PAD_E = 4, PAD_D = 4;
    const larg = W - PAD_E - PAD_D;
    const escondidas = new Set();

    const fmtDia = (iso) => {
        const p = String(iso).split('-');
        return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
    };
    const valorTexto = (s, v) => {
        if (typeof v !== 'number') return '—';
        return s.chave === 'conversao' ? v.toFixed(2).replace('.', ',') + '%' : String(v);
    };

    // O ponteiro mira a data, não a linha: acha o X mais próximo.
    const mover = (ev) => {
        const r = svg.getBoundingClientRect();
        const xRel = ((ev.clientX - r.left) / r.width) * W;
        const t = Math.min(1, Math.max(0, (xRel - PAD_E) / larg));
        const i = Math.round(t * (pontos.length - 1));
        const p = pontos[i];
        if (!p) return;
        const px = PAD_E + (pontos.length <= 1 ? larg / 2 : (i / (pontos.length - 1)) * larg);
        cross.setAttribute('x1', px); cross.setAttribute('x2', px);
        cross.style.display = '';
        // Um tooltip só, com TODAS as séries daquele dia — o leitor não precisa acertar a linha.
        // Valor em destaque, nome da série secundário; textContent porque o dado é de fora.
        tip.innerHTML = '';
        const cab = document.createElement('div');
        cab.style.cssText = 'font-weight:700; margin-bottom:3px;';
        cab.textContent = fmtDia(p.dia);
        tip.appendChild(cab);
        for (const s of MF_SERIES_VISITAS) {
            if (escondidas.has(s.chave)) continue;
            if (!(s.chave in p)) continue;
            const linha = document.createElement('div');
            linha.style.cssText = 'display:flex; align-items:center; gap:6px;';
            const traco = document.createElement('span');
            traco.style.cssText = `width:10px; height:2px; border-radius:2px; flex-shrink:0; background:${s.cor};`;
            const val = document.createElement('b');
            val.textContent = valorTexto(s, p[s.chave]);
            const nome = document.createElement('span');
            nome.style.cssText = 'opacity:.75;';
            nome.textContent = s.rotulo;
            linha.appendChild(traco); linha.appendChild(val); linha.appendChild(nome);
            tip.appendChild(linha);
        }
        tip.style.display = 'block';
        // Acompanha o ponteiro e desvia da linha: fixo no topo ele tapava justamente o
        // painel de Visitas, que é o primeiro (visto na imagem, não no HTML — o teste de
        // markup passava porque o tooltip "existia").
        const largTip = tip.offsetWidth || 120;
        const altTip = tip.offsetHeight || 70;
        const xPx = (px / W) * r.width;
        const yPx = ev.clientY - r.top;
        tip.style.left = Math.max(0, Math.min(r.width - largTip, xPx + 12)) + 'px';
        tip.style.top = Math.max(0, Math.min(r.height - altTip, yPx - altTip / 2)) + 'px';
        // Perto da borda direita o tooltip vira pro outro lado do cursor.
        if (xPx + 12 + largTip > r.width) tip.style.left = Math.max(0, xPx - largTip - 12) + 'px';
    };
    const sair = () => { cross.style.display = 'none'; tip.style.display = 'none'; };

    const hit = box.querySelector('.mf-vis-hit');
    hit.addEventListener('pointermove', mover);
    hit.addEventListener('pointerleave', sair);
    // Mesmo detalhe no teclado que no mouse.
    hit.addEventListener('focus', () => { if (pontos.length) mover({ clientX: svg.getBoundingClientRect().right }); });
    hit.addEventListener('blur', sair);

    raiz.querySelectorAll('.mf-vis-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const chave = btn.getAttribute('data-serie');
            // Esconder o <g> deixava um buraco branco do tamanho do painel — o espaço
            // continuava reservado. Guarda a escolha e REDESENHA com os painéis que
            // sobraram, que voltam a dividir a altura entre si.
            if (MF_visOcultas.has(chave)) MF_visOcultas.delete(chave); else MF_visOcultas.add(chave);
            // Nunca deixar o card sem nenhum painel: o último aceso não desliga.
            if (MF_visOcultas.size >= MF_SERIES_VISITAS.length) { MF_visOcultas.delete(chave); return; }
            if (typeof window.MF_redesenhaVisitas === 'function') window.MF_redesenhaVisitas();
        });
    });
}
// Séries que o vendedor desligou. Fora da função porque precisa sobreviver ao redesenho.
const MF_visOcultas = new Set();

/** Caminho SVG de uma série, quebrando a linha onde o dado não existe. */
function MF_caminhoSerie(pontos, chave, x0, larg, y0, alt) {
    const vals = pontos.map((p) => p[chave]).filter((v) => typeof v === 'number');
    if (!vals.length) return '';
    const max = Math.max(...vals, chave === 'conversao' ? 1 : 1);
    const n = pontos.length;
    const px = (i) => x0 + (n <= 1 ? larg / 2 : (i / (n - 1)) * larg);
    const py = (v) => y0 + alt - (max > 0 ? (v / max) * alt : 0);
    let d = '';
    let abriu = false;
    pontos.forEach((p, i) => {
        const v = p[chave];
        if (typeof v !== 'number') { abriu = false; return; }   // buraco: não liga os pontos
        const x = px(i).toFixed(1), y = py(v).toFixed(1);
        if (abriu) { d += `L${x} ${y} `; return; }
        // Dia com valor mas sem vizinho válido: `M x y` sozinho NÃO desenha nada — path só
        // com moveTo é invisível, mesmo com stroke-linecap="round". Numa série alternada
        // (dado, buraco, dado…) o gráfico saía vazio COM dados dentro, e era isso que o
        // Lucas via como "furos que não fazem sentido" (12/08/2026). Um segmento de
        // comprimento zero vira um ponto redondo por causa do linecap.
        const proximo = pontos[i + 1];
        const temVizinho = proximo && typeof proximo[chave] === 'number';
        d += temVizinho ? `M${x} ${y} ` : `M${x} ${y} L${x} ${y} `;
        abriu = true;
    });
    return d.trim();
}


function exibirAvaliacoes(reviewsData, containerId = "reviewsContainer") {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!reviewsData || !reviewsData.paging || reviewsData.paging.total === 0) {
        el.innerHTML = `
            <div class="ana-card">
                <div class="ana-card-header"><span class="ana-card-icon">⭐</span><span class="ana-card-title">Avaliações</span></div>
                <p class="text-small">Nenhuma avaliação encontrada.</p>
            </div>`;
        return;
    }

    const average = reviewsData.rating_average || 0;
    const total = reviewsData.paging.total || 0;
    const reviews = reviewsData.reviews || [];

    const starsHtml = (score) => {
        let s = '';
        for (let i = 1; i <= 5; i++) s += i <= Math.round(score) ? '★' : '☆';
        return `<span class="review-stars">${s}</span>`;
    };

    let html = `
        <div class="ana-card" style="animation-delay: 0.1s;">
            <div class="ana-card-header">
                <span class="ana-card-icon">⭐</span>
                <span class="ana-card-title">Avaliações</span>
            </div>
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 20px;">
                <span class="review-score-big">${average.toFixed(1)}</span>
                <div style="display: flex; flex-direction: column;">
                    ${starsHtml(average)}
                    <span class="text-small">${total} opiniões</span>
                </div>
            </div>
            <div class="reviews-list" style="max-height: 250px; overflow-y: auto;">
    `;

    if (reviews.length === 0) {
        html += '<p class="text-small">Sem comentários recentes.</p>';
    } else {
        reviews.slice(0, 5).forEach(rev => {
            html += `
                <div class="review-item">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        ${starsHtml(rev.rate)}
                        <span class="text-small">${new Date(rev.date_created).toLocaleDateString()}</span>
                    </div>
                    <p class="text-small" style="color: var(--text); font-style: italic;">"${rev.content || 'Sem comentário'}"</p>
                </div>
            `;
        });
    }

    html += '</div></div>';
    el.innerHTML = html;
}

async function analisarAnuncio(itemIdToAnalyze = null, append = false) {
    const loader = document.getElementById('loadingIndicator');
    const loadingStep = document.getElementById('loadingStep');
    const loadingFill = document.getElementById('loadingFill');

    const setLoading = (text, pct) => {
        if (loadingStep) loadingStep.textContent = text;
        if (loadingFill) loadingFill.style.width = pct + '%';
    };

    try {
        if (loader) {
            setLoading('Analisando...', 10);
            loader.style.display = 'block';
        }

        if (!append) {
            clearResults();
        }

        let parsed = null;

        if (itemIdToAnalyze) {
            // Chamada programática (clique num item da lista do MLBU/catálogo,
            // deep-link ?item=). Passa pelo MESMO parse do input: fixar
            // type:'mlb' aqui fazia ?item=MLBU… buscar como anúncio comum e
            // morrer em "não foi possível obter os dados do anúncio".
            parsed = normalizeMlbId(String(itemIdToAnalyze)) || { id: itemIdToAnalyze, type: 'mlb' };
        } else {
            const inputEl = document.getElementById('input-url');
            if (inputEl) {
                const val = inputEl.value.trim();
                if (val) parsed = normalizeMlbId(val);
            }
        }

        if (!parsed) {
            appendError('ID ou link inválido. Formato: MLB/MCO/MLA/MLM/MLC/MLU (+ U opcional) + números, link de anúncio ou link de catálogo (/p/...).');
            return;
        }

        const itemId = parsed.id;
        // Detecta site_id do item e torna ATIVO (formatters moeda/locale usam MF_CURRENT_SITE)
        const detectedSite = (window.MF_siteIdFromItemId ? window.MF_siteIdFromItemId(itemId) : 'MLB');
        window.MF_CURRENT_SITE = detectedSite;
        console.log(`--- Iniciando Análise: ${itemId} (tipo: ${parsed.type}, site: ${detectedSite}) ---`);
        let accessToken, userId, detail = null, fetchError = null, usedFallback = false, performanceData = null, visitsData = null, reviewsData = null, descriptionData = null, categoryAttributes = null, adsData = null, purchaseExperienceData = null, moderacaoData = null, qualidadeFichaData = null;

        try {
            [accessToken, userId] = await Promise.all([fetchAccessToken(), fetchUserIdForScraping()]);
            if (!accessToken) console.warn('Access Token indisponível.');
            if (!userId) console.warn('User ID indisponível.');
        } catch (e) {
            console.error("Erro ao buscar credenciais:", e);
            fetchError = new Error('Falha crítica ao obter credenciais da aplicação.');
            fetchError.isAuthError = true;
        }

        let isMlbu = parsed.type === 'mlbu';
        let isCatalog = parsed.type === 'catalog';

        if (accessToken && !fetchError) {
            try {
                if (isCatalog) {
                    // --- CATALOG FLOW ---
                    setLoading('Buscando dados do catálogo...', 20);
                    let catalogData = null;
                    try {
                        catalogData = await fetchApiData(`${BASE_URL_PROXY}/api/fetch-catalog?product_id=${itemId}&site_id=${detectedSite}`, accessToken);
                    } catch(e) {
                        throw new Error(`Catálogo ${itemId} não encontrado ou sem permissão.`);
                    }
                    if (!catalogData || !catalogData.name) {
                        throw new Error(`Catálogo ${itemId} não encontrado. Verifique o link.`);
                    }

                    // Get ML seller_id via /users/me + fetch linked items + category attrs
                    let sellerItems = [];
                    let categoryAttrsForCatalog = null;
                    try {
                        setLoading('Buscando seus anúncios neste catálogo...', 40);
                        const meData = await fetchApiData(`${BASE_URL_PROXY}/api/users/me`, accessToken);
                        if (meData?.id) {
                            const catalogItemsData = await fetchApiData(`${BASE_URL_PROXY}/api/catalog-items?catalog_product_id=${itemId}&seller_id=${meData.id}&site_id=${detectedSite}`, accessToken);
                            if (catalogItemsData?.results?.length > 0) {
                                sellerItems = catalogItemsData.results;
                            }
                        }
                        // Fetch category attributes using category from linked item or domain
                        if (sellerItems.length > 0) {
                            setLoading('Buscando atributos da categoria...', 60);
                            const sampleItem = await fetchItemDetails([sellerItems[0]], accessToken);
                            const catId = sampleItem?.[0]?.body?.category_id;
                            if (catId) {
                                categoryAttrsForCatalog = await fetchCategoryAttributes(catId, accessToken);
                            }
                        }
                    } catch (e) {
                        console.warn('Não foi possível buscar dados completos do catálogo:', e.message);
                    }

                    // Save catalog URL for "back" button
                    window.lastCatalogUrl = itemId;
                    await displayCatalogResults(catalogData, sellerItems, accessToken, categoryAttrsForCatalog);
                    return;
                } else if (isMlbu) {
                    const mlbuData = await fetchApiData(`${API_USER_PRODUCTS_ENDPOINT}/${itemId}`, accessToken);
                    if (mlbuData?.id) {
                        detail = transformMlbuData(mlbuData);
                        console.log('Dados do Produto (MLBU) OK.');

                        const itemsData = await fetchApiData(`${API_USER_PRODUCTS_ENDPOINT}/${itemId}/items?seller_id=${detail.seller_id}`, accessToken);
                        if (itemsData?.results?.length > 0) {
                            // Um anúncio só: a tela "Selecione um anúncio abaixo" com um
                            // item apenas é um clique a troco de nada — vai direto pra
                            // análise dele. Com dois ou mais, a escolha continua.
                            if (itemsData.results.length === 1) {
                                const unico = itemsData.results[0];
                                const unicoId = typeof unico === 'string' ? unico : (unico?.id || unico?.item_id);
                                // Só segue se for OUTRO id e um anúncio (MLB) de verdade.
                                // Se a ML devolvesse aqui o próprio id do produto, o parse
                                // classificaria como MLBU de novo e a análise recursaria
                                // no mesmo id para sempre, travando a página.
                                const ehOutroAnuncio = unicoId && unicoId !== itemId
                                    && (normalizeMlbId(String(unicoId)) || {}).type === 'mlb';
                                if (ehOutroAnuncio) {
                                    console.log(`Produto com um anúncio só (${unicoId}) — abrindo a análise dele direto.`);
                                    return await analisarAnuncio(unicoId, append);
                                }
                            }
                            setLoading('Buscando detalhes dos anúncios...', 70);
                            await displayMlbuResults(detail, itemsData.results, accessToken);
                            return; // Retorna para o finally esconder o loader
                        } else {
                            throw new Error(`Nenhum anúncio (MLB) associado a este produto (MLBU) foi encontrado.`);
                        }
                    } else {
                        throw new Error(`API de Produtos do Usuário: Resposta sem dados válidos.`);
                    }
                } else { // Rota MLB
                    const data = await fetchItemDetails([itemId], accessToken);
                    const itemData = data?.[0];
                    if (itemData?.code === 200 && itemData?.body?.id) {
                        detail = itemData.body;
                        descriptionData = itemData.description || detail.description;
                        console.log('Dados da API de Itens OK.');

                        // Anúncios UP/catálogo: descrição pode viver no user-product (MLBU) ou no catálogo.
                        // Fallback em cadeia: item → user-product → catalog_product.
                        const hasInlineDesc = !!(descriptionData?.plain_text?.trim() || descriptionData?.text?.trim());
                        if (!hasInlineDesc) {
                            // Retry único: o fetch-item engole falha transitória da API de descrição (allSettled
                            // no proxy) — reconsulta a rota dedicada antes de assumir "sem descrição".
                            try {
                                const descRetry = await fetchApiData(`${BASE_URL_PROXY}/api/fetch-item-description?item_id=${itemId}`, accessToken);
                                const retried = descRetry?.[itemId];
                                if (retried?.plain_text?.trim() || retried?.text?.trim()) {
                                    descriptionData = retried;
                                    console.log('Descrição recuperada no retry dedicado.');
                                }
                            } catch (e) { console.warn('Retry de descrição falhou:', e.message); }
                        }
                        const hasDescAfterRetry = !!(descriptionData?.plain_text?.trim() || descriptionData?.text?.trim());
                        if (!hasDescAfterRetry) {
                            const inheritedDesc = await fetchInheritedDescription(detail, accessToken);
                            if (inheritedDesc) {
                                descriptionData = inheritedDesc;
                                console.log(`Descrição herdada de: ${inheritedDesc.source}`);
                            }
                        }
                    } else if (itemData?.code === 403) {
                        throw new Error(`O Mercado Livre bloqueia o acesso aos dados completos de anúncios de outros vendedores. Se este anúncio é seu, verifique se ele pertence à conta do Mercado Livre conectada ao app.`);
                    } else {
                        if (itemData?.code === 404) {
                            throw new Error(`Não encontramos esse anúncio no Mercado Livre. Confira se o link ou o código está certo — e lembre que a análise só funciona com anúncios da conta conectada ao app.`);
                        }
                        if (itemData?.code === 401) {
                            // Falha permanente: mandar "tente de novo" faz o vendedor
                            // repetir para sempre o que só reconectar resolve.
                            const e401 = new Error(`A conexão com o Mercado Livre expirou. Reconecte sua conta em Minha Conta → Adicionar Conta e tente de novo.`);
                            e401.isAuthError = true;
                            throw e401;
                        }
                        throw new Error(`Não conseguimos trazer os dados desse anúncio agora. Tente de novo em alguns segundos; se continuar, confira se ele pertence à conta conectada.`);
                    }
                }
            } catch (e) { console.warn(`Erro na API principal: ${e.message}`); fetchError = e; }
        } else if (!fetchError) {
            fetchError = new Error("Para analisar, você precisa conectar sua conta do Mercado Livre na seção 'Minha Conta'.");
            fetchError.isAuthError = true;
            console.log(fetchError.message);
        }

        if (accessToken && detail) {
            // Ensure both are treated as strings for comparison and handle potential undefined
            // FORCED TO TRUE FOR TESTING VISITS ON ANY AD IN BUBBLE
            const isOwner = true;


            const results = await Promise.allSettled([
                isOwner ? fetchVisits(detail.id, accessToken) : Promise.resolve({ error: 'not_owner' }),
                fetchReviews(detail.id, accessToken),
                fetchAdsMetrics(detail.id, accessToken),
                fetchPerformanceData(detail.id, accessToken).catch(() => null),
                fetchPurchaseExperience(detail.id, accessToken).catch(() => null),
                // Moderação e ficha pelos olhos do ML — uma chamada cada, junto das demais
                fetchModeracaoAtiva(detail.id, accessToken).catch(() => null),
                fetchQualidadeFicha(detail.id, accessToken).catch(() => null)
            ]);
            visitsData = results[0].status === 'fulfilled' ? results[0].value : null;
            reviewsData = results[1].status === 'fulfilled' ? results[1].value : null;
            adsData = results[2].status === 'fulfilled' ? results[2].value : null;
            performanceData = results[3].status === 'fulfilled' ? results[3].value : null;
            purchaseExperienceData = results[4].status === 'fulfilled' ? results[4].value : null;
            moderacaoData = results[5].status === 'fulfilled' ? results[5].value : null;
            qualidadeFichaData = results[6].status === 'fulfilled' ? results[6].value : null;
        }

        if (detail && detail.category_id && accessToken) {
            categoryAttributes = await fetchCategoryAttributes(detail.category_id, accessToken);
        }

        if (detail && typeof detail === 'object') {
            console.log("Processando dados...");
            const containerIdSuffix = append ? Date.now() : '';
            const backBtnHtml = window.lastCatalogUrl ? `<button class="btn-back-catalog" onclick="window.lastCatalogUrl && (document.getElementById('input-url').value = 'https://www.mercadolivre.com.br/catalogo/p/${window.lastCatalogUrl}', handleAnalysisClick())">← Voltar ao Catálogo</button>` : '';

            const containerHtml = `
                <div class="item-analysis-container" id="analysis-container${containerIdSuffix}">
                    ${backBtnHtml}

                    <!-- ROW 0: Mudanças desde a última análise (preenchido por exibirPontuacao via localStorage snapshot) -->
                    <div id="changesBanner${containerIdSuffix}"></div>

                    <!-- ROW 1: Título | Score | Melhorias (3 colunas alinhadas) -->
                    <div style="display:grid; grid-template-columns:1.3fr auto 1fr; gap:16px; align-items:stretch; margin-bottom:16px;">
                        <div id="tituloTexto${containerIdSuffix}"></div>
                        <div id="scoreCircle${containerIdSuffix}"></div>
                        <div id="scoreChecklist${containerIdSuffix}"></div>
                    </div>

                    <!-- ROW 2: Checklist + Visitas + Avaliações (3 colunas iguais) -->
                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:16px;">
                        <div id="quickChecklist${containerIdSuffix}"></div>
                        <div id="visitsTrend${containerIdSuffix}"></div>
                        <div id="reviewsContainer${containerIdSuffix}"></div>
                    </div>

                    <!-- ROW 2.5: Parado pelo Mercado Livre (API /moderations/details) —
                         vem antes dos números porque o anúncio está fora do ar -->
                    <div id="moderacaoAtiva${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 3: Product Ads -->
                    <div id="adsMetrics${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 3.5: Qualidade ML (API /item/{id}/performance) -->
                    <div id="performanceTexto${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 3.6: Experiência de Compra ML (API /reputation/items/{id}/purchase_experience) -->
                    <div id="purchaseExperience${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 3.7: Ficha técnica pelos olhos do ML (API /catalog_quality/status) —
                         complementa a Ficha Técnica abaixo, não substitui -->
                    <div id="qualidadeFicha${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 4: Ficha Técnica -->
                    <div id="fichaTecnicaTexto${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 4: Campos da Categoria -->
                    <div id="categoryAttributes${containerIdSuffix}" style="margin-bottom:16px;"></div>

                    <!-- ROW 5: Tags -->
                    <div id="tagsTexto${containerIdSuffix}" style="margin-bottom:16px;"></div>

                </div>
            `;

            if (append) {
                const resultsContainer = document.getElementById('resultsContainer');
                resultsContainer.insertAdjacentHTML('beforeend', containerHtml);
            } else {
                document.getElementById('resultsContainer').innerHTML = containerHtml;
            }

            // Store global state for UI toggles
            window.currentAnalysisState = {
                detail, descriptionData, performanceData, visitsData, reviewsData, categoryAttributes, usedFallback, containerIdSuffix, accessToken, adsData, moderacaoData, qualidadeFichaData,
                // userId vai junto pra sugestão de descrição não ter que ir buscar de novo
                // no Bubble a cada clique.
                userId
            };

            exibirTitulo(detail.title, isMlbu, `tituloTexto${containerIdSuffix}`, detail);
            exibirChecklistRapido(detail, descriptionData, `quickChecklist${containerIdSuffix}`);
            processarAtributos(detail.attributes, detail.title, usedFallback, `fichaTecnicaTexto${containerIdSuffix}`);
            exibirAtributosCategoria(categoryAttributes, detail.attributes, `categoryAttributes${containerIdSuffix}`);
            verificarTags(detail.tags, usedFallback, `tagsTexto${containerIdSuffix}`);
            exibirTendenciaVisitas(visitsData, `visitsTrend${containerIdSuffix}`, adsData);
            exibirAvaliacoes(reviewsData, `reviewsContainer${containerIdSuffix}`);

            window._adsItemId = detail.id;
            window._adsAccessToken = accessToken;
            exibirAdsMetrics(adsData, `adsMetrics${containerIdSuffix}`, 30, visitsData);

            // Qualidade das publicações (API ML /item/{id}/performance)
            exibirPerformance(performanceData, `performanceTexto${containerIdSuffix}`);

            // Experiência de Compra (API ML /reputation/items/{id}/purchase_experience)
            exibirExperienciaCompra(purchaseExperienceData, `purchaseExperience${containerIdSuffix}`);

            // Moderação ativa (API ML /moderations/details) — motivo e solução do próprio ML
            exibirModeracao(moderacaoData, `moderacaoAtiva${containerIdSuffix}`);

            // Ficha técnica na visão do ML (API ML /catalog_quality/status)
            exibirQualidadeFicha(qualidadeFichaData, categoryAttributes, `qualidadeFicha${containerIdSuffix}`);

            // Pass analysis data for improvements panel (includes visits & reviews)
            const analysisData = { title: detail.title, detail, descriptionData, categoryAttributes, visitsData, reviewsData, adsData };
            // Prioriza score da ML Quality API quando disponível; senão usa heurística interna
            exibirPontuacao(
                calcularPontuacaoQualidade(detail, descriptionData, usedFallback, categoryAttributes),
                usedFallback,
                `scoreCircle${containerIdSuffix}`,
                analysisData,
                `scoreChecklist${containerIdSuffix}`,
                performanceData
            );

            // AI image analysis removed

            console.log("--- Análise Concluída ---");
        }

        if (!detail) {
            const finalMsg = fetchError ? fetchError.message : "Não foi possível obter ou processar dados do anúncio.";
            console.error("Erro Final da Análise:", finalMsg);
            if (!append) {
                clearResults();
            }
            // Padroniza erro de auth via MF_renderError
            if (fetchError && fetchError.isAuthError && typeof window.MF_renderError === 'function') {
                const cont = document.getElementById('resultsContainer');
                if (cont) {
                    cont.classList.remove('initial-state');
                    window.MF_renderError(cont, 'no_ml_account');
                }
            } else {
                appendError(`Falha na análise: ${finalMsg}`);
            }
        }

    } catch (e) {
        console.error("Erro geral na função analisarAnuncio:", e);
        appendError(`Ocorreu um erro inesperado: ${e.message}`);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

async function displayMlbuResults(mlbuDetail, mlbItems, accessToken) {
    const resultsContainer = document.getElementById('resultsContainer');

    // Create Grid Container
    resultsContainer.innerHTML = `
        <div class="analysis-grid">
            <div class="grid-full" id="mlbuHeader"></div>
            <div class="grid-full" id="mlbuItemsList"></div>
        </div>
    `;

    // Header Card (Product Info + Tags)
    const headerEl = document.getElementById("mlbuHeader");
    // As tags do produto saíam cruas da ML e viravam selos tipo "PRIMARY", com
    // cara de status importante. A doc de User Products não define o que elas
    // significam e o vendedor não pode agir sobre nenhuma — então não vão pra
    // tela (decisão do Lucas, 08/08). O dado continua vindo da API.
    const tagsHtml = '';

    const imgUrl = mlbuDetail.pictures && mlbuDetail.pictures.length > 0 ? mlbuDetail.pictures[0].secure_url : '';

    headerEl.innerHTML = `
        <div class="ana-card" style="flex-direction:row; align-items:center; gap:20px; border-top:3px solid var(--blue);">
            ${imgUrl ? `<img src="${imgUrl}" alt="${mlbuDetail.title}" style="width:80px; height:80px; object-fit:contain; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--row-alt); flex-shrink:0;">` : ''}
            <div style="flex:1; min-width:0;">
                <span class="status-badge success" style="margin-bottom:6px; display:inline-flex;">Produto de Usuário (MLBU)</span>
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text); line-height:1.3; margin-top:4px;">${escapeHtml(mlbuDetail.title)}</h3>
                ${tagsHtml}
            </div>
        </div>
    `;

    // Items List
    const listEl = document.getElementById('mlbuItemsList');
    listEl.innerHTML = `
        <div class="ana-card">
            <div class="ana-card-header">
                <span class="ana-card-icon">📦</span>
                <span class="ana-card-title">Anúncios (Itens) Vinculados</span>
            </div>
            <div id="itemsContainer" style="display:flex; flex-direction:column; gap:10px;">
                <p class="text-small" style="margin-bottom:10px;">Selecione um anúncio abaixo para ver a análise detalhada:</p>
            </div>
        </div>
    `;
    const itemsInnerContainer = listEl.querySelector('#itemsContainer');

    const itemsDetails = await fetchItemDetails(mlbItems, accessToken);

    if (itemsDetails && itemsDetails.length > 0) {
        itemsDetails.forEach(itemResp => {
            if (itemResp.code === 200 && itemResp.body) {
                const item = itemResp.body;
                const listingType = item.listing_type_id === 'gold_special' ? 'Clássico' : (item.listing_type_id === 'gold_pro' ? 'Premium' : item.listing_type_id);
                const price = (typeof window !== 'undefined' && window.MF_formatCurrency)
                    ? window.MF_formatCurrency(item.price, item.site_id || (item.currency_id === 'BRL' ? 'MLB' : undefined))
                    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: item.currency_id || 'BRL' }).format(item.price);

                const btn = document.createElement('div');
                btn.className = 'item-list-btn';
                btn.onclick = () => handleAnalysisClick(item.id, false);
                const soldQty = item.sold_quantity || 0;
                btn.innerHTML = `
                    <img src="${item.thumbnail}" class="item-list-img" alt="Thumb">
                    <div style="flex-grow:1;">
                        <span class="text-value" style="font-size:0.95rem;">${escapeHtml(item.title)}</span>
                        <div style="display:flex; gap:10px; margin-top:4px; align-items:center;">
                            <span class="status-badge muted" style="font-size:0.75rem;">${listingType}</span>
                            <span class="text-label" style="color:var(--green);">${price}</span>
                            <span style="font-family:'DM Mono',monospace; font-size:0.78rem; color:var(--text-muted);">${soldQty} vendas</span>
                            <span class="text-small" style="font-family:'DM Mono',monospace; color:var(--blue);">${item.id}</span>
                        </div>
                    </div>
                    <span style="color:var(--blue);">Analisar ➔</span>
                `;
                itemsInnerContainer.appendChild(btn);
            }
        });
    } else {
        itemsInnerContainer.innerHTML += '<p class="text-small error-message">Nenhum anúncio (MLB) encontrado para este produto ou falha ao buscar detalhes.</p>';
    }
}

async function displayCatalogResults(catalogData, sellerItemIds, accessToken, categoryAttrs = null) {
    const resultsContainer = document.getElementById('resultsContainer');
    const catalogId = catalogData.id || catalogData.catalog_product_id;

    const title = catalogData.name || '';
    const titleLen = title.length;
    const pictures = catalogData.pictures || [];
    const attributes = catalogData.attributes || [];
    const imgUrl = pictures.length > 0 ? pictures[0].url : '';

    // Title analysis (catalog max 200 chars, below 150 is bad)
    let titleState = 'good';
    if (titleLen < 80) titleState = 'bad';
    else if (titleLen < 150) titleState = 'neutral';
    const titleBadge = titleState === 'good' ? 'Excelente' : (titleState === 'neutral' ? 'Aceitável' : 'Curto');

    // Cross catalog attributes with ALL possible category attributes
    const catalogAttrMap = new Map();
    attributes.forEach(a => {
        const val = a.values && a.values.length > 0 ? a.values[0].name : null;
        if (val) catalogAttrMap.set(a.id, { name: a.name || a.id, value: val });
    });

    // Use category attributes as the full list if available, otherwise just catalog attrs
    let allAttrs = [];
    if (Array.isArray(categoryAttrs) && categoryAttrs.length > 0) {
        allAttrs = categoryAttrs.filter(a => {
            if (a.value_type !== 'string') return false;
            if (Array.isArray(a.tags) && a.tags.some(t => t === 'read_only' || t?.id === 'read_only')) return false;
            if (a.tags?.read_only) return false;
            // Filter by relevance if available (keep relevant ones)
            if (a.relevance !== undefined && a.relevance === 0) return false;
            return true;
        }).map(a => ({
            id: a.id,
            name: a.name || a.id,
            value: catalogAttrMap.get(a.id)?.value || null
        }));
    } else {
        allAttrs = attributes.map(a => ({
            id: a.id,
            name: a.name || a.id,
            value: a.values && a.values.length > 0 ? a.values[0].name : null
        }));
    }
    const filledAttrs = allAttrs.filter(a => a.value);
    const emptyAttrs = allAttrs.filter(a => !a.value);
    // Limit empty attrs to avoid showing hundreds of irrelevant fields
    const emptyAttrsLimited = emptyAttrs.slice(0, 20);
    const emptyAttrsExtra = emptyAttrs.length - emptyAttrsLimited.length;

    // Description check — aceita short_description.content, description (string/obj), main_features ou parent_id (variação herda do pai)
    const hasDesc = !!(extractDescriptionText(catalogData) || catalogData.parent_id);

    // Images check (min 3)
    const imageOk = pictures.length >= 3;

    // --- CATALOG SCORE ---
    let catScore = 100;
    if (titleLen < 80) catScore -= 15;
    else if (titleLen < 150) catScore -= 8;
    if (!imageOk) catScore -= 10;
    if (!hasDesc) catScore -= 10;
    catScore -= Math.min(emptyAttrs.length * 2, 30);
    catScore = Math.max(0, Math.min(100, catScore));

    let catLevel = 'bad';
    if (catScore >= 75) catLevel = 'good';
    else if (catScore >= 50) catLevel = 'neutral';
    const catClass = catScore >= 75 ? '⭐ Classe A' : (catScore >= 50 ? '📈 Classe B' : '⛏️ Classe C');

    const renderAttr = (attr) => {
        const filled = !!attr.value;
        const ignored = window.ignoredCatalogAttributes.has(attr.id);
        return `
            <div style="padding:6px 10px; background:${ignored ? 'var(--row-alt)' : (filled ? 'var(--green-light)' : 'var(--red-light)')}; border-radius:var(--radius-sm); border-left:3px solid ${ignored ? 'var(--border)' : (filled ? 'var(--green)' : 'var(--red)')}; margin-bottom:4px; ${ignored ? 'opacity:0.5;' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="text-label">${escapeHtml(attr.name)}</span>
                    <button onclick="window.toggleIgnoreAttribute('${attr.id}', 'catalog'); document.getElementById('input-url').dispatchEvent(new Event('reanalyze'));" class="btn-ignore-clean ${ignored ? 'ignored' : ''}" title="${ignored ? 'Incluir' : 'Ignorar'}" style="padding:2px;">
                        ${ignored ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'}
                    </button>
                </div>
                <span class="text-value" style="display:block; ${ignored ? 'text-decoration:line-through;' : ''}">${filled ? escapeHtml(attr.value) : 'Não preenchido'}</span>
            </div>`;
    };

    // Fetch items and FILTER only those actually linked to this catalog
    let itemsHtml = '<p class="text-small" style="color:var(--text-muted); font-style:italic;">Nenhum anúncio seu vinculado a este catálogo. Vincule um anúncio pelo Mercado Livre para que apareça aqui.</p>';
    let linkedCount = 0;
    if (sellerItemIds.length > 0) {
        // Paginate: fetch max 20 items at a time
        let allItemsDetails = [];
        for (let i = 0; i < sellerItemIds.length; i += 20) {
            const chunk = sellerItemIds.slice(i, i + 20);
            const chunkDetails = await fetchItemDetails(chunk, accessToken);
            if (chunkDetails) allItemsDetails = allItemsDetails.concat(chunkDetails);
        }
        const itemsDetails = allItemsDetails;
        if (itemsDetails && itemsDetails.length > 0) {
            const allValidItems = itemsDetails.filter(r => r.code === 200 && r.body);
            // Show ONLY items confirmed linked to this catalog
            const linkedItems = allValidItems.filter(r => r.body.catalog_product_id === catalogId);
            linkedCount = linkedItems.length;

            if (linkedItems.length > 0) {
                const btns = linkedItems.map(itemResp => {
                    const item = itemResp.body;
                    const listingType = item.listing_type_id === 'gold_special' ? 'Clássico' : (item.listing_type_id === 'gold_pro' ? 'Premium' : item.listing_type_id);
                    const price = (typeof window !== 'undefined' && window.MF_formatCurrency)
                    ? window.MF_formatCurrency(item.price, item.site_id || (item.currency_id === 'BRL' ? 'MLB' : undefined))
                    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: item.currency_id || 'BRL' }).format(item.price);
                    const soldQty = item.sold_quantity || 0;
                    return `
                        <div class="item-list-btn" onclick="handleAnalysisClick('${item.id}', false)">
                            <img src="${item.thumbnail}" class="item-list-img" alt="Thumb">
                            <div style="flex-grow:1;">
                                <span class="text-value" style="font-size:0.9rem;">${escapeHtml(item.title)}</span>
                                <div style="display:flex; gap:10px; margin-top:4px; align-items:center;">
                                    <span class="status-badge muted" style="font-size:0.7rem;">${listingType}</span>
                                    <span class="text-label" style="color:var(--green);">${price}</span>
                                    <span style="font-family:'DM Mono',monospace; font-size:0.78rem; color:var(--text-muted);">${soldQty} vendas</span>
                                    <span class="text-small" style="font-family:'DM Mono',monospace; color:var(--blue);">${item.id}</span>
                                </div>
                            </div>
                            <span style="color:var(--blue); font-weight:600; font-size:0.85rem;">Analisar ➔</span>
                        </div>`;
                });
                itemsHtml = btns.join('');
            }
        }
    }

    // Checklist items
    const checkItems = [
        { ok: titleLen >= 150, label: 'Título', detail: titleLen >= 150 ? `${titleLen} caracteres` : `Curto (${titleLen} chars, meta: 150+)` },
        { ok: hasDesc, label: 'Descrição', detail: hasDesc ? 'Preenchida' : 'Sem descrição' },
        { ok: imageOk, label: `Imagens (${pictures.length})`, detail: imageOk ? `${pictures.length} fotos` : `Mínimo 3 (tem ${pictures.length})` },
        { ok: emptyAttrs.length === 0, label: 'Atributos', detail: emptyAttrs.length === 0 ? `Todos preenchidos (${filledAttrs.length})` : `${emptyAttrs.length} vazios de ${allAttrs.length}` },
    ];

    const renderCheck = (item) => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:${item.ok ? 'var(--green-light)' : 'var(--red-light)'}; border-radius:var(--radius-sm); border-left:3px solid ${item.ok ? 'var(--green)' : 'var(--red)'};">
            <span style="font-size:1rem; flex-shrink:0;">${item.ok ? '✅' : '❌'}</span>
            <div style="flex:1;">
                <span style="font-weight:600; font-size:0.85rem; color:var(--text);">${item.label}</span>
                <span class="text-small" style="display:block; margin-top:1px;">${item.detail}</span>
            </div>
        </div>`;

    resultsContainer.innerHTML = `
        <div class="item-analysis-container">
            <!-- ROW 1: Header + Score + Checklist (3 columns like MLB) -->
            <div style="display:grid; grid-template-columns:1.3fr auto 1fr; gap:16px; align-items:stretch; margin-bottom:16px;">
                <!-- Catalog Header -->
                <div class="ana-card" style="border-top:3px solid var(--blue);">
                    <div class="ana-card-header">
                        <span class="ana-card-icon">📦</span>
                        <span class="ana-card-title">Catálogo</span>
                        <span class="status-badge ${titleState === 'good' ? 'success' : (titleState === 'neutral' ? 'muted' : 'error')}" style="margin-left:auto; font-size:0.65rem;">${titleBadge}</span>
                    </div>
                    <div style="display:flex; gap:16px; align-items:flex-start;">
                        ${imgUrl ? `<div class="cover-img-glow"><img src="${imgUrl}" style="width:80px; height:80px; object-fit:contain; border-radius:var(--radius-sm); display:block;"></div>` : ''}
                        <div style="flex:1; min-width:0;">
                            <span class="text-small" style="font-family:'DM Mono',monospace; color:var(--blue); display:block; margin-bottom:4px;">${catalogId}</span>
                            <p class="title-display" style="font-size:1rem; margin-bottom:8px;">${escapeHtml(title)}</p>
                            <div class="char-counter-bar">
                                <div class="char-progress ${titleState}" style="width:${Math.min(100, (titleLen / 200) * 100)}%"></div>
                            </div>
                            <div style="display:flex; justify-content:space-between; margin-top:4px;">
                                <span class="text-small">${titleLen} chars</span>
                                <span class="text-small">Máx: 200</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Score Circle -->
                <div class="ana-card" style="align-items:center; text-align:center; justify-content:center;">
                    <div class="score-circle-outer" style="width:110px; height:110px;">
                        <svg viewBox="0 0 36 36" class="circular-chart">
                            <defs>
                                <linearGradient id="gradientGoodCat" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" style="stop-color:#00d68f;stop-opacity:1" />
                                    <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
                                </linearGradient>
                            </defs>
                            <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path class="circle ${catLevel}" stroke-dasharray="${catScore}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                        </svg>
                        <span class="score-number" style="font-size:2rem;">${catScore}</span>
                    </div>
                    <span class="status-badge ${catLevel === 'good' ? 'success' : (catLevel === 'neutral' ? 'muted' : 'error')}" style="font-size:0.68rem; margin-top:10px;">${catClass}</span>
                </div>

                <!-- Checklist -->
                <div class="ana-card">
                    <div class="ana-card-header" style="padding-bottom:10px; margin-bottom:10px;">
                        <span class="ana-card-icon">✅</span>
                        <span class="ana-card-title">Checklist do Catálogo</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${checkItems.map(renderCheck).join('')}
                    </div>
                </div>
            </div>

            <!-- ROW 2: Attributes (preenchidos esquerda, vazios direita) -->
            <div class="ana-card" style="margin-bottom:16px;">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📋</span>
                    <span class="ana-card-title">Atributos do Catálogo</span>
                    <span class="text-small" style="margin-left:auto;">${filledAttrs.length} preenchidos / ${allAttrs.length} total</span>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <div class="specs-group-title valid" style="margin-bottom:6px;">✅ Preenchidos (${filledAttrs.length})</div>
                        ${filledAttrs.length > 0 ? filledAttrs.map(renderAttr).join('') : '<p class="text-small">Nenhum</p>'}
                    </div>
                    <div>
                        <div class="specs-group-title problem" style="margin-bottom:6px;">⚠️ Vazios (${emptyAttrs.length})</div>
                        ${emptyAttrs.length > 0 ? emptyAttrsLimited.map(renderAttr).join('') + (emptyAttrsExtra > 0 ? `<p class="text-small" style="color:var(--text-muted); margin-top:8px;">...e mais ${emptyAttrsExtra} campos vazios</p>` : '') : '<p class="text-small" style="color:var(--green);">Todos preenchidos! 🎉</p>'}
                    </div>
                </div>
            </div>

            <!-- ROW 3: Seller Items -->
            <div class="ana-card" style="margin-bottom:16px;">
                <div class="ana-card-header">
                    <span class="ana-card-icon">📦</span>
                    <span class="ana-card-title">Seus Anúncios neste Catálogo</span>
                    <span class="text-small" style="margin-left:auto;">${linkedCount} vinculado(s)</span>
                </div>
                <p class="text-small" style="margin-bottom:10px;">Clique num anúncio para ver a análise completa:</p>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    ${itemsHtml}
                </div>
            </div>
        </div>
    `;
}

function handleAnalysisClick(itemId = null, append = false) {
    analisarAnuncio(itemId, append);
}
// Expose to window for Bubble's HTML element scope
window.handleAnalysisClick = handleAnalysisClick;

function initAnalyzerPage() {
    const input = document.getElementById('input-url');
    if (input && !input.dataset.analyzerBound) {
        input.dataset.analyzerBound = '1';
        input.addEventListener('keypress', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAnalysisClick();
            }
        });
    }

    // Auto-load via ?item=MLBxxx (usado pelo Planejador de Ads)
    if (window.__analyzerAutoLoaded) return;
    try {
        const params = new URLSearchParams(window.location.search);
        const autoItem = params.get('item');
        if (autoItem && /^MLB[U]?\d+$/i.test(autoItem)) {
            window.__analyzerAutoLoaded = true;
            if (input) input.value = autoItem;
            setTimeout(() => handleAnalysisClick(autoItem), 300);
        }
    } catch (e) { /* noop */ }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnalyzerPage);
} else {
    initAnalyzerPage();
}

function calcularPontuacaoQualidade(detail, descriptionData, usedFallback = false, categoryAttributes = null) {
    if (!detail || typeof detail !== 'object') return 0;
    let score = 100;
    const title = detail.title || "", titleLen = title.length, pTit = getPalavrasUnicas(title);

    const isMlbu = detail.id && detail.id.startsWith('MLBU');

    // --- TÍTULO (-15 curto, -8 médio) ---
    // REGRA: Se anúncio já tem vendas, não penalizar título — mudá-lo reseta indexação ML.
    const hasSalesForTitle = (detail.sold_quantity || 0) > 0;
    if (!hasSalesForTitle) {
        if (isMlbu) {
            if (titleLen < 40) score += PONTOS_PENALIDADE_TITULO_CURTO;
            else if (titleLen < 50) score += PONTOS_PENALIDADE_TITULO_MEDIO;
        } else {
            if (titleLen < MIN_CHARS_TITULO_RUIM) score += PONTOS_PENALIDADE_TITULO_CURTO;
            else if (titleLen < MIN_CHARS_TITULO_BOM) score += PONTOS_PENALIDADE_TITULO_MEDIO;
        }
    }

    // --- DESCRIÇÃO (-10 se não tem, +3 bônus se tem) ---
    // Aceita plain_text OU text (HTML legado) e considera descrição herdada do catálogo (UP/catalog listings).
    const hasDesc = !!(descriptionData && ((descriptionData.plain_text && descriptionData.plain_text.trim() !== "") || (descriptionData.text && descriptionData.text.trim() !== "")));
    if (hasDesc) score += 3;
    else score -= 10;

    // --- GARANTIA (-5 se não informada) ---
    if (!getWarrantyText(detail)) score -= 5;

    // --- IMAGENS (-5 se menos de 3 no total ou por variação) ---
    const variations = detail.variations || [];
    if (variations.length > 0) {
        const badVars = variations.filter(v => (v.picture_ids?.length || 0) < 3);
        if (badVars.length > 0) score -= 5;
    } else {
        if ((detail.pictures?.length || 0) < 3) score -= 5;
    }

    // --- CAMPOS DA CATEGORIA (-2 por campo faltando, max -20) ---
    // Só entra na conta o campo que o vendedor CONSEGUE mexer neste anúncio
    // (mfCampoEditavel): fora ficam os que o ML preenche sozinho, os gerenciados por
    // variação e os controlados pela família — descontar por eles é cobrar uma tarefa
    // que não existe. Obrigatório e extra pesam igual: os dois são preenchíveis.
    if (categoryAttributes && Array.isArray(categoryAttributes)) {
        const adMap = new Map();
        (detail.attributes || []).forEach(a => { if (a?.value_name) adMap.set(a.id, a.value_name); });
        let missingCount = 0;
        categoryAttributes.forEach(c => {
            // Mesma régua da lista: o que a tela mostra como faltando é o que pesa aqui
            if (!mfCampoEditavel(c, detail)) return;
            if (window.ignoredAdAttributes.has(c.id)) return;
            const v = adMap.get(c.id);
            if (!v || v.trim() === '') missingCount++;
        });
        score -= Math.min(missingCount * 2, 20);
    }

    // --- ATRIBUTOS (tamanho e repetição, max -25 total) ---
    let attrPenalty = 0;
    if (Array.isArray(detail.attributes) && detail.attributes.length > 0) {
        let validCount = 0;
        const validAttrs = detail.attributes.filter(a => typeof a === 'object' && a && a.value_type === 'string' && typeof a.value_name === 'string' && !ATRIBUTOS_IGNORADOS_COMPLETAMENTE.has(a.id) && !window.ignoredAdAttributes.has(a.id) && !ehAtributoDeSistema(a.id));
        const pPorAttr = new Map(); validAttrs.forEach(a => pPorAttr.set(a.id, getPalavrasUnicas(a.value_name)));
        validAttrs.forEach(attr => {
            validCount++;
            const nome = attr.name || attr.id;
            const val = attr.value_name.trim(), vLow = val.toLowerCase(), len = val.length, pAtuais = pPorAttr.get(attr.id);
            const ignorarPenalidades = deveIgnorarAtributoPorNome(nome);

            if (!ignorarPenalidades) {
                if (!VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                    const diff = Math.abs(len - TAMANHO_IDEAL_ATRIBUTO);
                    if (attr.id !== 'BRAND' || len > TAMANHO_IDEAL_ATRIBUTO) {
                        attrPenalty += Math.floor(diff / 10) * PONTOS_PENALIDADE_POR_10_CHARS_DIF_ATR;
                    }
                }
                if (!ATRIBUTOS_IGNORADOS_REPETICAO.has(attr.id) && !VALORES_IGNORADOS_PENALIDADE.has(vLow)) {
                    attrPenalty += encontrarIntersecao(pAtuais, pTit).length * PONTOS_PENALIDADE_POR_PALAVRA_REPETIDA;
                }
            }
        });
        if (validCount === 0) attrPenalty += PONTOS_PENALIDADE_SEM_ATRIBUTOS;
    } else attrPenalty += PONTOS_PENALIDADE_SEM_ATRIBUTOS * 1.5;
    score += Math.max(attrPenalty, -25); // Cap attribute penalties at -25

    // --- TAGS ---
    if (!usedFallback && Array.isArray(detail.tags)) {
        if (detail.tags.includes('moderation_penalty')) score += PONTOS_PENALIDADE_MODERATION_PENALTY;
        if (detail.tags.includes('incomplete_technical_specs')) score -= 15;
        const algumaTagNegativaPresente = detail.tags.some(tagAnuncio => TAGS_NEGATIVAS.has(tagAnuncio));
        if (algumaTagNegativaPresente) {
            if (!detail.tags.includes('moderation_penalty') && !detail.tags.includes('incomplete_technical_specs')) {
                score -= 10;
            }
        }
    }
    return Math.max(0, Math.min(Math.round(score), 100));
}

// End of Analyzer Logic
