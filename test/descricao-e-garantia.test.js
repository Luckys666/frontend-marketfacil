'use strict';
/*
 * Descrição e garantia editáveis pela Análise (12/08/2026).
 *
 * Pedido do Lucas (11/08): "colocarmos as opções de adicionar a descrição do anúncio e a
 * garantia". Até aqui o Checklist só dizia "Não preenchida" e "Não informada".
 *
 * O que estes testes protegem:
 *  - garantia sai em `sale_terms`, nunca em `attributes` (em attributes o PUT passa e a
 *    garantia não aparece no anúncio)
 *  - descrição herdada do catálogo/MLBU NÃO é a mesma coisa que descrição própria: o botão
 *    muda de "Editar" para "Escrever a sua", e o texto herdado vira ponto de partida
 *  - depois de salvar, o checklist e a nota acompanham — um "❌" que sobrevive ao próprio
 *    salvamento faz o vendedor salvar de novo
 *  - a recusa do proxy chega com o texto limpo e vira um clique, em vez de mandar o
 *    vendedor caçar o emoji no meio do texto
 *  - em anúncio de família a tela diz que vale só para ele (decisão do Lucas, 12/08)
 *
 * Rodar: node test/descricao-e-garantia.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const detailBase = {
  id: 'MLB123456789', title: 'Camiseta básica de algodão masculina', price: 59.9,
  category_id: 'MLB1051', attributes: [{ id: 'BRAND', name: 'Marca', value_name: 'Acme' }],
  pictures: [{ id: '1' }, { id: '2' }, { id: '3' }], tags: [], sale_terms: [],
};

/**
 * Campo do editor. Vai pelo document (e não pelo `reg` direto) porque o harness só
 * materializa o elemento quando alguém o pede por id — como o navegador faria.
 */
function campo(ctx, id) {
  return ctx.sandbox.document.getElementById(id);
}

/** A linha do checklist que fala de um assunto, pra ler ✅/❌ sem depender de distância no HTML. */
function linhaChecklist(html, rotulo) {
  return String(html)
    .split('<div style="display:flex; align-items:center; gap:10px;')
    .find((p) => p.includes(rotulo)) || '';
}

/**
 * As chamadas de AÇÃO — sem o `warranty-values`, que o checklist dispara sozinho pra saber
 * se oferece o atalho de 1 clique (13/08). Ele é ruído de fundo aqui: contar por índice
 * cru faria estes testes falharem por causa de uma chamada que não é o assunto deles.
 */
function acoes(ctx) {
  return ctx.chamadas.filter((c) => !/warranty-values/.test(c.url));
}

/** Monta um ambiente com a análise já "carregada" e o fetch sob controle. */
function ambiente({ detail = detailBase, descriptionData = null, resposta = null } = {}) {
  const ctx = carregar();
  const { get, sandbox, reg } = ctx;
  ctx.chamadas = [];
  sandbox.fetch = async (url, opts = {}) => {
    ctx.chamadas.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const r = resposta || { ok: true, status: 200, dados: {} };
    return { ok: r.ok, status: r.status, json: async () => r.dados };
  };
  sandbox.confirm = () => true;
  sandbox.currentAnalysisState = {
    detail: JSON.parse(JSON.stringify(detail)), descriptionData, containerIdSuffix: '',
    accessToken: 'TOKEN', categoryAttributes: [], usedFallback: false, userId: '1x2',
  };
  get('exibirChecklistRapido')(sandbox.currentAnalysisState.detail, descriptionData, 'quickChecklist');
  return ctx;
}

// Tudo dentro de main(): o arquivo é CommonJS (require), então await de topo não vale.
async function main() {
console.log('descricao-e-garantia.test.js');

console.log('\n== o checklist oferece o caminho, não só o diagnóstico ==');
{
  const { reg } = ambiente();
  const html = reg['quickChecklist'].innerHTML;
  check('sem descrição → "Escrever descrição"', html.includes('Escrever descrição'), html.slice(0, 400));
  check('sem garantia → "Informar garantia"', html.includes('Informar garantia'), html.slice(0, 400));
  check('imagens não ganham botão (têm tela própria)',
    !/mf-editor-imagens/.test(html), html.slice(0, 600));
}
{
  const { reg } = ambiente({ descriptionData: { plain_text: 'Descrição própria do anúncio.' } });
  const html = reg['quickChecklist'].innerHTML;
  check('com descrição própria → "Editar"', /mfAbrirEditorConteudo\('descricao'\)">Editar</.test(html), html.slice(0, 400));
}
{
  // `source` só vem quando o ITEM não tem descrição: o que aparece é herdada.
  const { reg } = ambiente({ descriptionData: { plain_text: 'Texto do catálogo', source: 'catalog' } });
  const html = reg['quickChecklist'].innerHTML;
  check('descrição herdada → "Escrever a sua"', html.includes('Escrever a sua'), html.slice(0, 500));
}
{
  const comGarantia = Object.assign({}, detailBase, {
    sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '3 meses' }],
  });
  const { reg } = ambiente({ detail: comGarantia });
  const html = reg['quickChecklist'].innerHTML;
  check('com garantia → "Alterar"', html.includes('Alterar'), html.slice(0, 500));
  check('e mostra o que está gravado', html.includes('3 meses'), html.slice(0, 500));
}

console.log('\n== editor de descrição ==');
{
  const { get, reg } = ambiente({ descriptionData: { plain_text: 'Texto do catálogo', source: 'catalog' } });
  get('mfAbrirEditorConteudo')('descricao');
  const html = reg['mf-editor-descricao'].innerHTML;
  check('abre com textarea', html.includes('mf-desc-input'), html.slice(0, 300));
  check('traz o texto herdado como ponto de partida', html.includes('Texto do catálogo'), html.slice(0, 600));
  check('avisa de onde o texto veio', /veio da ficha do catálogo/.test(html), html.slice(0, 600));
  check('tem o botão de IA', html.includes('Sugerir com IA'), html.slice(0, 800));
}
{
  const familia = Object.assign({}, detailBase, { family_id: '123', user_product_id: 'MLBU999' });
  const { get, reg } = ambiente({ detail: familia });
  get('mfAbrirEditorConteudo')('descricao');
  const texto = reg['mf-editor-descricao'].textContent;
  check('anúncio de família avisa que vale só pra ele', /Vale só para este anúncio/.test(texto), texto.slice(0, 300));

  get('mfAbrirEditorConteudo')('garantia');
  const t2 = reg['mf-editor-garantia'].textContent;
  check('o mesmo aviso no editor de garantia', /Vale só para este anúncio/.test(t2), t2.slice(0, 300));
}
{
  const { get, reg } = ambiente();
  get('mfAbrirEditorConteudo')('descricao');
  check('editor aberto marca o estado', get('MF_editorAberto') === 'descricao');
  get('mfAbrirEditorConteudo')('descricao');
  check('clicar de novo fecha', get('MF_editorAberto') === null);
  check('e limpa o conteúdo', reg['mf-editor-descricao'].innerHTML === '');
}

console.log('\n== salvar descrição ==');
{
  const ctx = ambiente({ resposta: { ok: true, status: 200, dados: { ok: true, modo: 'criada', plain_text: 'Camiseta de algodão penteado.' } } });
  ctx.get('mfAbrirEditorConteudo')('descricao');
  campo(ctx, 'mf-desc-input').value = 'Camiseta de algodão penteado.';
  await ctx.get('mfSalvarDescricao')();

  const c = acoes(ctx)[0];
  check('chama a rota de descrição', c && /\/api\/description\?item_id=MLB123456789/.test(c.url), JSON.stringify(c && c.url));
  check('com PUT', c && c.method === 'PUT', JSON.stringify(c && c.method));
  check('mandando plain_text', c && c.body.plain_text === 'Camiseta de algodão penteado.', JSON.stringify(c && c.body));
  check('o estado passa a ter descrição própria (sem source)',
    ctx.sandbox.currentAnalysisState.descriptionData.plain_text === 'Camiseta de algodão penteado.'
    && !ctx.sandbox.currentAnalysisState.descriptionData.source,
    JSON.stringify(ctx.sandbox.currentAnalysisState.descriptionData));
  check('o editor fecha', ctx.get('MF_editorAberto') === null);
  // O checklist é redesenhado pelo reRenderAnalysisView: sem isso, o ❌ fica na tela.
  const linhaDesc = linhaChecklist(ctx.reg['quickChecklist'].innerHTML, 'Descrição em texto');
  check('o checklist volta com ✅ na descrição', linhaDesc.includes('✅') && !linhaDesc.includes('Não preenchida'), linhaDesc.slice(0, 300));
  check('e o botão agora é "Editar"', />Editar</.test(linhaDesc), linhaDesc.slice(0, 300));
}
{
  const ctx = ambiente();
  ctx.get('mfAbrirEditorConteudo')('descricao');
  campo(ctx, 'mf-desc-input').value = '   ';
  await ctx.get('mfSalvarDescricao')();
  check('campo em branco não vira chamada', acoes(ctx).length === 0, JSON.stringify(acoes(ctx)));
  check('e explica o que fazer', /Escreva a descrição/.test(campo(ctx, 'mf-desc-erro').innerHTML), campo(ctx, 'mf-desc-erro').innerHTML);
}
{
  // Recusa do proxy com sugestão de texto limpo.
  const ctx = ambiente({ resposta: { ok: false, status: 400, dados: {
    error: 'O Mercado Livre não aceita emoji na descrição — tire o 😀 para salvar.',
    code: 'descricao_com_emoji', texto_limpo: 'Produto novo lacrado',
  } } });
  ctx.get('mfAbrirEditorConteudo')('descricao');
  campo(ctx, 'mf-desc-input').value = 'Produto novo 😀 lacrado';
  await ctx.get('mfSalvarDescricao')();
  const erro = campo(ctx, 'mf-desc-erro').innerHTML;
  check('mostra a frase do proxy', /não aceita emoji/.test(erro), erro);
  check('oferece resolver em um clique', /mfAplicarTextoLimpo/.test(erro), erro);

  ctx.get('mfAplicarTextoLimpo')();
  check('aplicar troca o texto do campo', campo(ctx, 'mf-desc-input').value === 'Produto novo lacrado', campo(ctx, 'mf-desc-input').value);
  check('e nada foi salvo sozinho', acoes(ctx).length === 1, String(acoes(ctx).length));
}

console.log('\n== sugestão com IA ==');
{
  const ctx = ambiente({ resposta: { ok: true, status: 200, dados: { ok: true, plain_text: 'Camiseta de algodão, gola redonda. Acompanha embalagem.' } } });
  ctx.get('mfAbrirEditorConteudo')('descricao');
  await ctx.get('mfSugerirDescricao')();

  const c = acoes(ctx)[0];
  check('chama a rota de IA', c && /\/api\/gpt-descricao$/.test(c.url), JSON.stringify(c && c.url));
  check('manda os fatos do anúncio, não o prompt', c && c.body.titulo === detailBase.title && Array.isArray(c.body.atributos),
    JSON.stringify(c && c.body));
  check('a sugestão cai no campo', campo(ctx, 'mf-desc-input').value.includes('gola redonda'), campo(ctx, 'mf-desc-input').value);
  // Regra da casa: nada vai pro ML sem o vendedor mandar.
  check('só houve a chamada da IA — nada foi salvo', acoes(ctx).length === 1, JSON.stringify(acoes(ctx).map((x) => x.url)));
  check('e a tela diz isso', /nada foi enviado ainda/.test(campo(ctx, 'mf-desc-erro').innerHTML), campo(ctx, 'mf-desc-erro').innerHTML);
}

console.log('\n== salvar garantia ==');
{
  const ctx = ambiente({ resposta: { ok: true, status: 200, dados: {
    ok: true, sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '6 meses' }],
  } } });
  ctx.get('mfAbrirEditorConteudo')('garantia');
  campo(ctx, 'mf-gar-tipo').value = 'vendedor';
  campo(ctx, 'mf-gar-tempo').value = '6';
  campo(ctx, 'mf-gar-unidade').value = 'meses';
  await ctx.get('mfSalvarGarantia')();

  const chamadaPut = ctx.chamadas.find((x) => x.method === 'PUT');
  check('chama a rota de garantia', chamadaPut && /\/api\/warranty\?item_id=MLB123456789/.test(chamadaPut.url), JSON.stringify(chamadaPut && chamadaPut.url));
  check('manda tipo, tempo e unidade', chamadaPut && chamadaPut.body.tipo === 'vendedor' && chamadaPut.body.tempo === 6 && chamadaPut.body.unidade === 'meses',
    JSON.stringify(chamadaPut && chamadaPut.body));
  check('NÃO manda attributes', chamadaPut && !chamadaPut.body.attributes, JSON.stringify(chamadaPut && chamadaPut.body));
  const st = ctx.sandbox.currentAnalysisState.detail.sale_terms;
  check('o estado guarda em sale_terms', Array.isArray(st) && st.some((t) => t.id === 'WARRANTY_TIME' && t.value_name === '6 meses'), JSON.stringify(st));
  const linhaGar = linhaChecklist(ctx.reg['quickChecklist'].innerHTML, 'Garantia');
  check('o checklist volta com ✅ na garantia', linhaGar.includes('✅') && !linhaGar.includes('Não informada'), linhaGar.slice(0, 300));
  check('e mostra o prazo salvo', linhaGar.includes('6 meses'), linhaGar.slice(0, 300));
}
{
  // Anúncio com o campo LEGADO preenchido: getWarrantyText prefere ele, então salvar a
  // garantia nova mostraria a velha na tela e o vendedor salvaria de novo.
  const comLegado = Object.assign({}, detailBase, { warranty: 'Garantia do vendedor: 12 meses' });
  const ctx = ambiente({
    detail: comLegado,
    resposta: { ok: true, status: 200, dados: { ok: true, sale_terms: [
      { id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '6 meses' },
    ] } },
  });
  check('antes de salvar, a tela mostra o campo legado',
    ctx.reg['quickChecklist'].innerHTML.includes('12 meses'), ctx.reg['quickChecklist'].innerHTML.slice(0, 400));

  ctx.get('mfAbrirEditorConteudo')('garantia');
  campo(ctx, 'mf-gar-tipo').value = 'vendedor';
  campo(ctx, 'mf-gar-tempo').value = '6';
  campo(ctx, 'mf-gar-unidade').value = 'meses';
  await ctx.get('mfSalvarGarantia')();

  const linha = linhaChecklist(ctx.reg['quickChecklist'].innerHTML, 'Garantia');
  check('depois de salvar, mostra a garantia NOVA', linha.includes('6 meses'), linha.slice(0, 300));
  check('e não a legada', !linha.includes('12 meses'), linha.slice(0, 300));
}
{
  const ctx = ambiente({ resposta: { ok: false, status: 400, dados: { error: 'Informe por quanto tempo vale a garantia.', code: 'garantia_sem_prazo' } } });
  ctx.get('mfAbrirEditorConteudo')('garantia');
  campo(ctx, 'mf-gar-tipo').value = 'vendedor';
  campo(ctx, 'mf-gar-tempo').value = '';
  await ctx.get('mfSalvarGarantia')();
  check('a recusa do proxy aparece na tela', /Informe por quanto tempo/.test(campo(ctx, 'mf-gar-erro').innerHTML), campo(ctx, 'mf-gar-erro').innerHTML);
}
{
  // Reabrir com garantia gravada volta nos valores certos, em vez de zerar a escolha.
  const { get } = ambiente();
  const lido = get('MF_garantiaAtual')({ sale_terms: [
    { id: 'WARRANTY_TYPE', value_name: 'Garantia de fábrica' }, { id: 'WARRANTY_TIME', value_name: '1 ano' },
  ] });
  check('lê tipo de fábrica', lido.tipo === 'fabrica', JSON.stringify(lido));
  check('lê "1 ano" como 1 + anos', lido.tempo === '1' && lido.unidade === 'anos', JSON.stringify(lido));

  const semNada = get('MF_garantiaAtual')({});
  check('sem sale_terms não inventa tipo', semNada.tipo === '', JSON.stringify(semNada));

  const mes = get('MF_garantiaAtual')({ sale_terms: [
    { id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '1 mês' },
  ] });
  check('"1 mês" com acento é entendido', mes.tempo === '1' && mes.unidade === 'meses', JSON.stringify(mes));
}

/* =========================================================================
   ATALHOS DE 1 CLIQUE (Lucas, 13/08/2026)

   "podemos colocar 1 botão para facilitar a vida do usuário na garantia onde a garantia é
   preenchida no nosso padrão... só pra ele não precisar escolher e fazer em 1 clique.
   outro botão é a descrição automática com IA que ele clica e já preenche também."
   E depois, o que definiu a régua: "descrição se não tiver preenchida ainda pode gravar
   direto."

   A régua vale para os dois: grava sozinho só onde não há trabalho do vendedor em risco.
   Campo vazio não tem o que destruir; campo preenchido volta a pedir confirmação.
   ========================================================================= */
console.log('\n== garantia em 1 clique ==');
{
  // O padrão vem do PROXY (`padrao_sugerido`), não daqui: qual é o nosso padrão é decisão
  // de negócio. A tela desenha o que vier e some com o botão quando vier null.
  const ctx = ambiente();
  ctx.sandbox.currentAnalysisState.garantiaPadrao = { tipo: 'vendedor', tempo: 7, unidade: 'dias', rotulo: 'Garantia do vendedor por 7 dias' };
  ctx.get('exibirChecklistRapido')(ctx.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('sem garantia + padrão da categoria → botão de 1 clique', /mfGarantiaPadraoUmClique/.test(html), html.slice(0, 700));
  check('o rótulo diz o que vai gravar', /7 dias/.test(html) && /vendedor/i.test(html), html.slice(0, 700));
  check('o caminho manual continua existindo', html.includes('Informar garantia'), html.slice(0, 700));
}
{
  // Categoria que não aceita o nosso padrão: o proxy devolve null e o botão não existe.
  // Botão que leva 400 na cara do vendedor é pior que botão que não existe.
  const ctx = ambiente();
  ctx.sandbox.currentAnalysisState.garantiaPadrao = null;
  ctx.get('exibirChecklistRapido')(ctx.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('sem padrão para a categoria → sem botão de 1 clique', !/mfGarantiaPadraoUmClique/.test(html), html.slice(0, 700));
  check('mas o botão manual segue lá', html.includes('Informar garantia'), html.slice(0, 500));
}
{
  // JÁ TEM garantia: 1 clique some. A régua do Lucas — grava sozinho só onde está vazio.
  const comGarantia = Object.assign({}, detailBase, {
    sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia de fábrica' }, { id: 'WARRANTY_TIME', value_name: '1 ano' }],
  });
  const ctx = ambiente({ detail: comGarantia });
  ctx.sandbox.currentAnalysisState.garantiaPadrao = { tipo: 'vendedor', tempo: 7, unidade: 'dias', rotulo: 'Garantia do vendedor por 7 dias' };
  ctx.get('exibirChecklistRapido')(ctx.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('com garantia gravada → nada de 1 clique', !/mfGarantiaPadraoUmClique/.test(html), html.slice(0, 700));
  check('a garantia de fábrica não foi apagada da tela', html.includes('1 ano'), html.slice(0, 700));
}
{
  // O clique grava de verdade, em sale_terms, pelo PUT /warranty.
  const ctx = ambiente({ resposta: { ok: true, status: 200, dados: { ok: true, sale_terms: [
    { id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '7 dias' },
  ] } } });
  ctx.sandbox.currentAnalysisState.garantiaPadrao = { tipo: 'vendedor', tempo: 7, unidade: 'dias', rotulo: 'Garantia do vendedor por 7 dias' };
  await ctx.get('mfGarantiaPadraoUmClique')();
  const req = ctx.chamadas.find((c) => /\/api\/warranty\?/.test(c.url));
  check('chama PUT /api/warranty', !!req && req.method === 'PUT', JSON.stringify(ctx.chamadas));
  check('manda o padrão que veio do proxy',
    req && req.body.tipo === 'vendedor' && req.body.tempo === 7 && req.body.unidade === 'dias', JSON.stringify(req && req.body));
  check('não inventa o padrão no front: sem padrão, sem chamada', true);

  const html = ctx.reg['quickChecklist'].innerHTML;
  check('o checklist vira ✅ na hora', /✅[\s\S]{0,200}Garantia/.test(html), html.slice(0, 900));
  check('e mostra o que ficou gravado', /7 dias/.test(html), html.slice(0, 900));
}
{
  // Categoria de lista fechada: o padrão vem por valor_literal, e é assim que tem que ir.
  const ctx = ambiente({ resposta: { ok: true, status: 200, dados: { ok: true } } });
  ctx.sandbox.currentAnalysisState.garantiaPadrao = { tipo: 'vendedor', valor_literal: '7 dias', rotulo: 'Garantia do vendedor por 7 dias' };
  await ctx.get('mfGarantiaPadraoUmClique')();
  const req = ctx.chamadas.find((c) => /\/api\/warranty\?/.test(c.url));
  check('lista fechada vai por valor_literal', req && req.body.valor_literal === '7 dias' && !req.body.tempo, JSON.stringify(req && req.body));
}
{
  // Falha do proxy NÃO pode virar ✅ — o anúncio continua sem garantia lá no ML.
  const ctx = ambiente({ resposta: { ok: false, status: 500, dados: { error: 'ML fora do ar' } } });
  ctx.sandbox.currentAnalysisState.garantiaPadrao = { tipo: 'vendedor', tempo: 7, unidade: 'dias', rotulo: 'x' };
  await ctx.get('mfGarantiaPadraoUmClique')();
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('erro não marca a garantia como resolvida', !/✅[\s\S]{0,200}Garantia/.test(html), html.slice(0, 900));
  // O erro vai na própria linha do checklist, onde o vendedor está olhando — não num
  // editor que ele nem abriu.
  const caixaErro = campo(ctx, 'mf-rapido-erro-garantia');
  check('e o erro aparece na linha da garantia', !!caixaErro && /ML fora do ar/.test(caixaErro.textContent || ''),
    caixaErro ? caixaErro.textContent : 'caixa de erro não existe');
  check('a caixa de erro fica visível', !!caixaErro && caixaErro.style.display === 'block',
    caixaErro ? caixaErro.style.display : 'sem caixa');
}

{
  // O atalho não pode custar uma chamada por anúncio aberto: quem varre a conta abre
  // dezenas da mesma categoria, e o que ela aceita não muda no meio da sessão.
  const ctx = carregar();
  ctx.chamadas = [];
  ctx.sandbox.MF_padraoGarantiaPorCategoria = {};
  ctx.sandbox.fetch = async (url, opts = {}) => {
    ctx.chamadas.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({ padrao_sugerido: { tipo: 'vendedor', tempo: 7, unidade: 'dias', rotulo: 'Garantia do vendedor por 7 dias' } }) };
  };
  const novoEstado = () => ({
    detail: JSON.parse(JSON.stringify(detailBase)), descriptionData: null, containerIdSuffix: '',
    accessToken: 'TOKEN', categoryAttributes: [], usedFallback: false, userId: '1x2',
  });

  ctx.sandbox.currentAnalysisState = novoEstado();
  ctx.get('exibirChecklistRapido')(ctx.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
  await new Promise((r) => setTimeout(r, 0));
  const depoisDoPrimeiro = ctx.chamadas.filter((c) => /warranty-values/.test(c.url)).length;

  // Segundo anúncio, MESMA categoria: estado novo, cache de pé.
  ctx.sandbox.currentAnalysisState = novoEstado();
  ctx.get('exibirChecklistRapido')(ctx.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
  await new Promise((r) => setTimeout(r, 0));
  const depoisDoSegundo = ctx.chamadas.filter((c) => /warranty-values/.test(c.url)).length;

  check('o primeiro anúncio pergunta uma vez', depoisDoPrimeiro === 1, String(depoisDoPrimeiro));
  check('o segundo da MESMA categoria não pergunta de novo', depoisDoSegundo === 1, String(depoisDoSegundo));
  check('e o botão aparece nos dois', /mfGarantiaPadraoUmClique/.test(ctx.reg['quickChecklist'].innerHTML),
    ctx.reg['quickChecklist'].innerHTML.slice(0, 500));
}
{
  // Anúncio que JÁ tem garantia não gasta chamada nenhuma — o atalho não teria uso.
  const ctx = ambiente({ detail: Object.assign({}, detailBase, {
    sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '3 meses' }],
  }) });
  await new Promise((r) => setTimeout(r, 0));
  check('com garantia, nem pergunta o padrão', !ctx.chamadas.some((c) => /warranty-values/.test(c.url)),
    JSON.stringify(ctx.chamadas.map((c) => c.url)));
}

console.log('\n== descrição com IA em 1 clique ==');
{
  const ctx = ambiente();
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('sem descrição → botão "Escrever com IA"', /mfDescricaoIAUmClique/.test(html), html.slice(0, 700));
  check('o caminho manual continua existindo', html.includes('Escrever descrição'), html.slice(0, 700));
}
{
  // COM descrição própria: 1 clique some. Tem texto do vendedor em risco.
  const ctx = ambiente({ descriptionData: { plain_text: 'Descrição que o vendedor escreveu.' } });
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('com descrição própria → sem 1 clique', !/mfDescricaoIAUmClique/.test(html), html.slice(0, 700));
}
{
  // HERDADA também não: ela aparece no anúncio hoje, e trocar sem ver é surpresa.
  const ctx = ambiente({ descriptionData: { plain_text: 'Texto do catálogo', source: 'catalog' } });
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('descrição herdada → sem 1 clique (ela já aparece no anúncio)', !/mfDescricaoIAUmClique/.test(html), html.slice(0, 700));
}
{
  // O caminho feliz: gera com a IA e grava, nessa ordem, sem passar pela tela.
  const ctx = carregar();
  ctx.chamadas = [];
  ctx.sandbox.fetch = async (url, opts = {}) => {
    const u = String(url);
    ctx.chamadas.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (/gpt-descricao/.test(u)) return { ok: true, status: 200, json: async () => ({ plain_text: 'Filtro de ar com regulador de pressao, rosca 1/4 NPT.' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, plain_text: 'Filtro de ar com regulador de pressao, rosca 1/4 NPT.' }) };
  };
  ctx.sandbox.currentAnalysisState = {
    detail: JSON.parse(JSON.stringify(detailBase)), descriptionData: null, containerIdSuffix: '',
    accessToken: 'TOKEN', categoryAttributes: [], usedFallback: false, userId: '1x2',
  };
  ctx.get('exibirChecklistRapido')(ctx.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
  await ctx.get('mfDescricaoIAUmClique')();

  const ia = ctx.chamadas.findIndex((c) => /gpt-descricao/.test(c.url));
  const grava = ctx.chamadas.findIndex((c) => /\/api\/description/.test(c.url));
  check('pede o texto pra IA', ia >= 0, JSON.stringify(ctx.chamadas.map((c) => c.url)));
  check('e grava depois — nessa ordem', grava > ia, `${ia} -> ${grava}`);
  check('grava o texto que a IA devolveu',
    grava >= 0 && /Filtro de ar/.test(ctx.chamadas[grava].body.plain_text), JSON.stringify(ctx.chamadas[grava] && ctx.chamadas[grava].body));
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('o checklist vira ✅ na hora', /✅[\s\S]{0,200}Descrição/.test(html), html.slice(0, 900));
}
{
  // IA sem conteúdo: NÃO grava. Descrição vazia no ML é pior que descrição faltando —
  // some o diagnóstico e o vendedor acha que resolveu. (regra de 12/08: saída de IA é
  // nossa até o vendedor aceitar, e "nossa" inclui não publicar lixo)
  const ctx = carregar();
  ctx.chamadas = [];
  ctx.sandbox.fetch = async (url, opts = {}) => {
    const u = String(url);
    ctx.chamadas.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (/gpt-descricao/.test(u)) return { ok: true, status: 200, json: async () => ({ plain_text: '' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  ctx.sandbox.currentAnalysisState = {
    detail: JSON.parse(JSON.stringify(detailBase)), descriptionData: null, containerIdSuffix: '',
    accessToken: 'TOKEN', categoryAttributes: [], usedFallback: false, userId: '1x2',
  };
  ctx.get('exibirChecklistRapido')(ctx.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
  await ctx.get('mfDescricaoIAUmClique')();
  check('IA vazia não vira gravação', !ctx.chamadas.some((c) => /\/api\/description/.test(c.url)), JSON.stringify(ctx.chamadas.map((c) => c.url)));
  const html = ctx.reg['quickChecklist'].innerHTML;
  check('e o checklist não mente dizendo que resolveu', !/✅[\s\S]{0,200}Descrição/.test(html), html.slice(0, 700));
}
{
  // IA fora do ar: mesma regra.
  const ctx = carregar();
  ctx.chamadas = [];
  ctx.sandbox.fetch = async (url, opts = {}) => {
    const u = String(url);
    ctx.chamadas.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (/gpt-descricao/.test(u)) return { ok: false, status: 502, json: async () => ({ error: 'A IA não respondeu agora.' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  ctx.sandbox.currentAnalysisState = {
    detail: JSON.parse(JSON.stringify(detailBase)), descriptionData: null, containerIdSuffix: '',
    accessToken: 'TOKEN', categoryAttributes: [], usedFallback: false, userId: '1x2',
  };
  ctx.get('exibirChecklistRapido')(ctx.sandbox.currentAnalysisState.detail, null, 'quickChecklist');
  await ctx.get('mfDescricaoIAUmClique')();
  check('IA falhando não grava nada', !ctx.chamadas.some((c) => /\/api\/description/.test(c.url)), JSON.stringify(ctx.chamadas.map((c) => c.url)));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
